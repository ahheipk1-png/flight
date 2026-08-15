// End-to-end search orchestration -- port of backend/app/search/
// {spaces,pipeline}.py plus the stage-progression contract of jobs.py.
// Where the backend wrote stages to Redis for the frontend to poll, here
// the caller passes an onStage callback and gets the finished result
// back directly; the stage vocabulary and order are unchanged
// (queued -> generating -> pruning -> verifying -> ranking -> done, with
// multi-city skipping straight to verifying exactly like the backend).

import type {
  AirportRef,
  ItineraryOut,
  MultiCitySearchRequestBody,
  SearchRequestBody,
  SearchStage,
} from "@/lib/types";
import type { MessageKey } from "@/lib/i18n/messages";
import { FARE_CACHE_TTL_EMPTY_MS, FARE_CACHE_TTL_VERIFIED_MS } from "./constants";
import { generateCoarse } from "./candidates";
import { getAirport, getDestinationAirports, getOriginGroup, resolveEquivalence } from "./geo";
import { cacheGet, cacheSet, recordLiveCall } from "./observations";
import { pruneAndExpand } from "./pruning";
import { rank } from "./ranking";
import { ProxyError, SerpApiError } from "./serpapi";
import type { EngineProvider, FareOption, MultiCityLeg, SearchSpace, VerifiedItinerary } from "./types";
import { passesHardConstraints, verifyTop } from "./verification";

/** An error whose message is an i18n key, so the UI can render it in the
 * viewer's language instead of a hardcoded English string. */
export class EngineError extends Error {
  constructor(
    public key: MessageKey,
    public params?: Record<string, string | number>,
  ) {
    super(key);
  }
}

export interface SearchOutcome {
  itineraries: ItineraryOut[];
  degraded: boolean;
  meta: { candidate_count: number; candidate_group_count: number; coarse_count: number };
}

export interface RunOptions {
  provider: EngineProvider;
  onStage?: (stage: SearchStage) => void;
  signal?: AbortSignal;
}

function airportRef(iata: string): AirportRef {
  const a = getAirport(iata);
  if (!a) throw new EngineError("engine.errors.unknownAirport", { iata });
  return { iata: a.iata, name: a.name, city: a.city, lat: a.lat, lon: a.lon };
}

export function parseRequest(req: SearchRequestBody): SearchSpace {
  const originCandidates = getOriginGroup(req.origin.region);
  if (originCandidates.length === 0) {
    throw new EngineError("engine.errors.noOriginGroup");
  }
  const primary =
    originCandidates.find((a) => a.is_origin_default && a.iata === "YYZ") ??
    originCandidates.find((a) => a.is_origin_default) ??
    originCandidates[0];

  const alternates = originCandidates.filter((airport) => {
    if (airport.iata === primary.iata) return false;
    const equiv = resolveEquivalence(primary.iata, airport.iata);
    // No equivalence row, or ground time over the requested tolerance =>
    // dropped here (this is also where BUF falls out at the default 120).
    return equiv !== null && equiv.ground_time_minutes <= req.origin.max_ground_minutes;
  });

  const destinationAll = getDestinationAirports(req.destination.regions);
  if (destinationAll.length === 0) {
    throw new EngineError("engine.errors.noDestinations");
  }
  const destinationPrimaries = getDestinationAirports(req.destination.regions, { primaryOnly: true });

  return {
    primaryOrigin: primary,
    originAirports: [primary, ...alternates],
    alternateOrigins: alternates,
    destinationAirports: destinationAll,
    destinationPrimaries,
    tripType: req.trip_type,
    departureFrom: req.dates.departure_from,
    departureTo: req.dates.departure_to,
    tripLengthMin: req.dates.trip_length_min,
    tripLengthMax: req.dates.trip_length_max,
    maxStops: req.connections.max_stops,
    minNormalMinutes: req.connections.min_normal_minutes,
    maxNormalMinutes: req.connections.max_normal_minutes,
    maxTotal: req.budget.max_total,
    currency: req.budget.currency,
    adults: req.adults,
    maxGroundMinutes: req.origin.max_ground_minutes,
    minSavingPerPerson: req.origin.min_saving_per_person,
  };
}

function toItinerary(
  id: string,
  ranked: ReturnType<typeof rank>[number],
  cityStops: AirportRef[] | null,
): ItineraryOut {
  const it = ranked.verifiedItinerary;
  return {
    id,
    origin: airportRef(it.origin),
    destination: airportRef(it.destination),
    depart_date: it.departDate,
    return_date: it.returnDate,
    trip_length: it.tripLength,
    fare: it.option.price,
    currency: it.option.currency,
    stops: it.option.stops,
    total_duration_min: it.option.total_duration_min,
    legs: it.option.outbound_legs,
    layovers: it.option.layovers,
    carriers: it.option.carriers,
    verified: it.verified,
    ground_transfer: ranked.groundTransfer
      ? {
          from_iata: ranked.groundTransfer.from_iata,
          to_iata: ranked.groundTransfer.to_iata,
          minutes: ranked.groundTransfer.minutes,
          cost: ranked.groundTransfer.cost,
          currency: ranked.groundTransfer.currency,
        }
      : null,
    city_stops: cityStops,
    explanations: ranked.explanations,
    rank_scores: {
      cheapest: it.option.price,
      fastest: it.option.total_duration_min,
      best: ranked.bestScore,
    },
  };
}

export async function runFlexibleSearch(req: SearchRequestBody, opts: RunOptions): Promise<SearchOutcome> {
  const stage = (name: SearchStage) => opts.onStage?.(name);

  stage("generating");
  const space = parseRequest(req);
  const coarse = generateCoarse(space);

  stage("pruning");
  const candidateGroups = pruneAndExpand(space, coarse);

  stage("verifying");
  const { verified, degraded } = await verifyTop(space, candidateGroups, opts.provider, opts.signal);

  stage("ranking");
  const ranked = rank(space, verified);

  return {
    itineraries: ranked.map((r, idx) => toItinerary(`it-${idx}`, r, null)),
    degraded,
    meta: {
      candidate_count: candidateGroups.reduce((s, g) => s + g.candidates.length, 0),
      candidate_group_count: candidateGroups.length,
      coarse_count: coarse.length,
    },
  };
}

function multiCityCacheKey(
  providerName: string,
  legs: MultiCityLeg[],
  opts: { adults: number; currency: string; maxStops: number | null },
): string {
  const legsPart = legs.map((l) => `${l.origin}-${l.destination}-${l.date}`).join("+");
  return `fare:v1:mc:${providerName}:${legsPart}:${opts.currency}:${opts.maxStops}:${opts.adults}`;
}

export async function runMultiCitySearch(req: MultiCitySearchRequestBody, opts: RunOptions): Promise<SearchOutcome> {
  const stage = (name: SearchStage) => opts.onStage?.(name);

  // No coarse grid / pruning for explicit user-chosen legs -- first
  // stage is verifying, exactly like the backend's multi-city job.
  stage("verifying");

  const originCandidates = getOriginGroup("greater_toronto");
  const primary =
    originCandidates.find((a) => a.is_origin_default && a.iata === "YYZ") ??
    originCandidates.find((a) => a.is_origin_default) ??
    originCandidates[0];

  const legAirportRefs = req.legs.map((leg) => airportRef(leg.destination));

  let priorIata = primary.iata;
  const queryLegs: MultiCityLeg[] = req.legs.map((leg) => {
    const built = { origin: priorIata, destination: leg.destination, date: leg.date };
    priorIata = leg.destination;
    return built;
  });

  const providerOpts = { adults: req.adults, currency: req.budget.currency, maxStops: req.connections.max_stops };
  const key = multiCityCacheKey(opts.provider.name, queryLegs, providerOpts);

  let options: FareOption[];
  let degraded = false;
  const cached = cacheGet(key);
  if (cached !== null) {
    options = cached;
  } else {
    try {
      options = await opts.provider.searchMultiCity(queryLegs, providerOpts, opts.signal);
      if (opts.provider.name !== "mock") {
        // One paid call per leg (the departure_token chain) -- count them
        // all in the advisory usage tally.
        for (let i = 0; i < queryLegs.length; i++) recordLiveCall();
      }
      cacheSet(key, options, options.length > 0 ? FARE_CACHE_TTL_VERIFIED_MS : FARE_CACHE_TTL_EMPTY_MS);
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      if (err instanceof SerpApiError || err instanceof ProxyError) {
        options = [];
        degraded = true;
      } else {
        throw err;
      }
    }
  }

  // Minimal space: only the constraint fields are real; the trip-shape
  // fields are inert placeholders (same approach as the backend).
  const space: SearchSpace = {
    primaryOrigin: primary,
    originAirports: [primary],
    alternateOrigins: [],
    destinationAirports: req.legs.map((l) => getAirport(l.destination)!),
    destinationPrimaries: [],
    tripType: "round_trip",
    departureFrom: req.legs[0].date,
    departureTo: req.legs[req.legs.length - 1].date,
    tripLengthMin: 0,
    tripLengthMax: 0,
    maxStops: req.connections.max_stops,
    minNormalMinutes: req.connections.min_normal_minutes,
    maxNormalMinutes: req.connections.max_normal_minutes,
    maxTotal: req.budget.max_total,
    currency: req.budget.currency,
    adults: req.adults,
    maxGroundMinutes: 0,
    minSavingPerPerson: 0,
  };

  const verified: VerifiedItinerary[] = options
    .filter((option) => passesHardConstraints(option, space))
    .map((option) => ({
      origin: primary.iata,
      destination: req.legs[req.legs.length - 1].destination,
      departDate: req.legs[0].date,
      returnDate: req.legs[req.legs.length - 1].date,
      tripLength: 0,
      option,
      verified: !degraded,
    }));

  stage("ranking");
  const ranked = rank(space, verified);

  // Intermediate leg endpoints (all but the final destination), shared by
  // every itinerary -- matches the backend's city_stops construction.
  const cityStops = legAirportRefs.slice(0, -1);

  return {
    itineraries: ranked.map((r, idx) => toItinerary(`mc-${idx}`, r, cityStops)),
    degraded,
    meta: {
      candidate_count: options.length,
      candidate_group_count: options.length > 0 ? 1 : 0,
      coarse_count: 0,
    },
  };
}
