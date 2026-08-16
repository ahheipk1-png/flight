// Open-jaw search: fly out to one destination, fly home from a
// (possibly different) one, both picked from the SAME destination list
// used everywhere else -- the engine explores (arrival, departure) pairs
// drawn from that one pool, same-city pairs included (an open-jaw search
// that happens to come back round-trip is a valid, often-cheapest
// answer, not a failure).
//
// Each candidate pair costs TWO live calls (a 2-leg multi-city query --
// see below), not one, so the live-call budget only covers half as many
// candidates as a normal flexible search.
//
// The two legs are NOT a chained itinerary: leg 2's origin is the
// departure group, not leg 1's arrival. SerpApi's multi_city_json
// natively supports exactly this (a real Google Flights open-jaw
// itinerary) -- provider.searchMultiCity() already builds whatever
// origin/destination each leg object says, so no provider changes were
// needed to make this work.

import {
  COARSE_DATE_STRIDE_DAYS,
  COARSE_EXPAND_WINDOW_DAYS,
  FARE_CACHE_TTL_EMPTY_MS,
  FARE_CACHE_TTL_VERIFIED_MS,
  PER_SEARCH_LIVE_CAP,
  PRUNE_MAX_CANDIDATES,
  PRUNE_OVERSHOOT_RATIO,
  PRUNE_TOP_CELLS,
  VERIFY_CONCURRENCY,
} from "./constants";
import { addDaysIso } from "./dates";
import { resolveDestinationGroups, toItinerary, EngineError } from "./pipeline";
import { estimate, partyKey } from "./indicative";
import { addObservations, cacheGet, cacheSet, recordLiveCall } from "./observations";
import { rank } from "./ranking";
import { ProxyError, SerpApiError } from "./serpapi";
import type { DestinationGroup, EngineProvider, EstimateSource, FareOption, MultiCityLeg, SearchSpace, VerifiedItinerary } from "./types";
import { passesHardConstraints } from "./verification";
import type { OpenJawSearchRequestBody, SearchStage } from "@/lib/types";
import type { RunOptions, SearchOutcome } from "./pipeline";

export interface OpenJawCandidate {
  arrival: DestinationGroup;
  departure: DestinationGroup;
  departDate: string;
  tripLength: number;
  estimatedPrice: number | null;
  estimateSource: EstimateSource | null;
}

export function parseOpenJawRequest(req: OpenJawSearchRequestBody): SearchSpace {
  if (req.origin.airports.length === 0) {
    throw new EngineError("engine.errors.noOriginGroup");
  }
  const destinationGroups = resolveDestinationGroups(req.destination.selections);
  if (destinationGroups.length === 0) {
    throw new EngineError("engine.errors.noDestinations");
  }
  return {
    originGroup: req.origin.airports.join(","),
    originLabel: req.origin.label,
    destinationGroups,
    // No genuine one-way/round-trip concept for open-jaw; tagging it
    // "round_trip" only affects which observation-cache bucket this
    // user's own past searches land in (see indicative.ts) -- never
    // shown, never used to fabricate a price.
    tripType: "round_trip",
    departureFrom: req.dates.departure_from,
    departureTo: req.dates.departure_to,
    tripLengthMin: req.dates.trip_length_min,
    tripLengthMax: req.dates.trip_length_max,
    maxStops: req.connections.max_stops,
    minNormalMinutes: req.connections.min_normal_minutes,
    maxNormalMinutes: req.connections.max_normal_minutes,
    maxTotal: req.budget.max_total,
    currency: req.budget.currency,
    passengers: req.passengers,
    travelClass: req.travel_class,
  };
}

function generateCoarse(space: SearchSpace): OpenJawCandidate[] {
  const midpointLength = Math.floor((space.tripLengthMin + space.tripLengthMax) / 2);
  const dates = stridedDates(space.departureFrom, space.departureTo, COARSE_DATE_STRIDE_DAYS);

  const candidates: OpenJawCandidate[] = [];
  for (const arrival of space.destinationGroups) {
    for (const departure of space.destinationGroups) {
      for (const depart of dates) {
        const returnDate = addDaysIso(depart, midpointLength);
        const [price, source] = estimate(space.originGroup, arrival.joined, depart, returnDate, space.tripType, space.passengers);
        candidates.push({ arrival, departure, departDate: depart, tripLength: midpointLength, estimatedPrice: price, estimateSource: source });
      }
    }
  }
  return candidates;
}

function stridedDates(startIso: string, endIso: string, strideDays: number): string[] {
  const dates: string[] = [];
  let d = startIso;
  while (d <= endIso) {
    dates.push(d);
    d = addDaysIso(d, strideDays);
  }
  return dates;
}

const SOURCE_RANK: Record<EstimateSource | "none", number> = { observation_exact: 0, observation_nearest: 1, none: 2 };
function rankOf(c: Pick<OpenJawCandidate, "estimateSource">): number {
  return SOURCE_RANK[c.estimateSource ?? "none"];
}
function compareCandidates(a: OpenJawCandidate, b: OpenJawCandidate): number {
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra !== rb) return ra - rb;
  if (ra === 2) return 0;
  return (a.estimatedPrice as number) - (b.estimatedPrice as number);
}

function pruneAndExpand(space: SearchSpace, coarse: OpenJawCandidate[]): OpenJawCandidate[] {
  if (coarse.length === 0) return [];

  // One seed per ARRIVAL destination (its cheapest/most-recent coarse
  // pairing) -- keeps the same "one cheap destination can't hog every
  // slot" property the flexible search has, scoped to the arrival axis
  // since that's the destination a user actually picked to visit.
  const bestPerArrival = new Map<string, OpenJawCandidate>();
  for (const c of coarse) {
    const current = bestPerArrival.get(c.arrival.key);
    if (!current || compareCandidates(c, current) < 0) bestPerArrival.set(c.arrival.key, c);
  }
  const seeds = [...bestPerArrival.values()].sort(compareCandidates).slice(0, PRUNE_TOP_CELLS);

  const seen = new Set<string>();
  const expanded: OpenJawCandidate[] = [];

  for (const seed of seeds) {
    const windowDates: string[] = [];
    for (let offset = -COARSE_EXPAND_WINDOW_DAYS; offset <= COARSE_EXPAND_WINDOW_DAYS; offset++) {
      const d = addDaysIso(seed.departDate, offset);
      if (d >= space.departureFrom && d <= space.departureTo) windowDates.push(d);
    }

    for (const departure of space.destinationGroups) {
      for (const depart of windowDates) {
        for (let tripLength = space.tripLengthMin; tripLength <= space.tripLengthMax; tripLength++) {
          const key = `${seed.arrival.key}|${departure.key}|${depart}|${tripLength}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const returnDate = addDaysIso(depart, tripLength);
          const [price, source] = estimate(space.originGroup, seed.arrival.joined, depart, returnDate, space.tripType, space.passengers);
          expanded.push({ arrival: seed.arrival, departure, departDate: depart, tripLength, estimatedPrice: price, estimateSource: source });
        }
      }
    }
  }

  expanded.sort(compareCandidates);
  const ceiling = space.maxTotal * PRUNE_OVERSHOOT_RATIO;
  const withinBudget = expanded.filter((c) => c.estimatedPrice === null || c.estimatedPrice <= ceiling);
  const survivors = withinBudget.length > 0 ? withinBudget : expanded;
  return survivors.slice(0, PRUNE_MAX_CANDIDATES);
}

function openJawCacheKey(providerName: string, legs: MultiCityLeg[], opts: { currency: string; maxStops: number | null; partyKey: string; travelClass: number }): string {
  const legsPart = legs.map((l) => `${l.origin}-${l.destination}-${l.date}`).join("+");
  return `fare:v2:oj:${providerName}:${legsPart}:${opts.currency}:${opts.maxStops}:${opts.partyKey}:${opts.travelClass}`;
}

async function verifyTop(space: SearchSpace, candidates: OpenJawCandidate[], provider: EngineProvider, signal?: AbortSignal) {
  // Each pair costs two live calls (the 2-leg multi-city chain), so the
  // pair budget is half the normal per-search cap.
  const pairBudget = Math.max(1, Math.floor(PER_SEARCH_LIVE_CAP / 2));
  const toVerify = candidates.slice(0, pairBudget);

  let anyDegraded = false;

  async function verifyOne(candidate: OpenJawCandidate): Promise<VerifiedItinerary | null> {
    const returnDate = addDaysIso(candidate.departDate, candidate.tripLength);
    const legs: MultiCityLeg[] = [
      { origin: space.originGroup, destination: candidate.arrival.joined, date: candidate.departDate },
      { origin: candidate.departure.joined, destination: space.originGroup, date: returnDate },
    ];
    const key = openJawCacheKey(provider.name, legs, {
      currency: space.currency,
      maxStops: space.maxStops,
      partyKey: partyKey(space.passengers),
      travelClass: space.travelClass,
    });

    let options: FareOption[];
    const cached = cacheGet(key);
    if (cached !== null) {
      options = cached;
    } else {
      try {
        options = await provider.searchMultiCity(
          legs,
          { passengers: space.passengers, travelClass: space.travelClass, currency: space.currency, maxStops: space.maxStops },
          signal,
        );
      } catch (err) {
        if (signal?.aborted) throw err;
        if (err instanceof SerpApiError || err instanceof ProxyError) {
          anyDegraded = true;
          return null; // no honest fallback price for a 2-leg pair -- drop it, never guess
        }
        throw err;
      }
      if (provider.name !== "mock") {
        recordLiveCall();
        recordLiveCall(); // two paid calls -- one chain step per leg
      }
      cacheSet(key, options, options.length > 0 ? FARE_CACHE_TTL_VERIFIED_MS : FARE_CACHE_TTL_EMPTY_MS);
      if (options.length > 0) {
        const now = Date.now();
        addObservations(
          options.map((o) => ({
            origin: space.originGroup,
            destination: candidate.arrival.joined,
            departure_date: candidate.departDate,
            return_date: returnDate,
            trip_type: space.tripType,
            fare: o.price,
            observed_at: now,
            party_key: partyKey(space.passengers),
          })),
        );
      }
    }

    const passing = options.filter((o) => passesHardConstraints(o, space));
    if (passing.length === 0) return null;
    const best = passing.reduce((a, b) => (b.price < a.price ? b : a));
    return {
      destination: candidate.arrival,
      returnOrigin: candidate.departure,
      departDate: candidate.departDate,
      returnDate,
      tripLength: candidate.tripLength,
      option: best,
      verified: true,
    };
  }

  const results: (VerifiedItinerary | null)[] = new Array(toVerify.length).fill(null);
  let next = 0;
  async function workerLoop(): Promise<void> {
    while (next < toVerify.length) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const index = next++;
      results[index] = await verifyOne(toVerify[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(VERIFY_CONCURRENCY, toVerify.length) }, workerLoop));

  return { verified: results.filter((r): r is VerifiedItinerary => r !== null), degraded: anyDegraded };
}

export async function runOpenJawSearch(req: OpenJawSearchRequestBody, opts: RunOptions): Promise<SearchOutcome> {
  const stage = (name: SearchStage) => opts.onStage?.(name);

  stage("generating");
  const space = parseOpenJawRequest(req);
  const coarse = generateCoarse(space);

  stage("pruning");
  const candidates = pruneAndExpand(space, coarse);

  stage("verifying");
  const { verified, degraded } = await verifyTop(space, candidates, opts.provider, opts.signal);

  stage("ranking");
  const ranked = rank(space, verified);

  return {
    itineraries: ranked.map((r, idx) => toItinerary(`oj-${idx}`, r, space)),
    degraded,
    meta: { candidate_count: candidates.length, coarse_count: coarse.length },
  };
}
