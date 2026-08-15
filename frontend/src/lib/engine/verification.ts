// Live-price (or indicative-fallback) verification of the top candidate
// groups -- port of backend/app/search/verification.py plus the caching/
// observation-recording half of services/fares.py (the browser has no
// separate service layer).
//
// Groups are verified whole, cheapest-group-first: a group is only taken
// if ALL its origin variants fit the remaining live-call budget, which
// keeps a primary-origin result and its alt-origin siblings verified
// together -- ranking.ts's nearby-airport filter depends on that pairing.
//
// "Degraded" here means a live call FAILED (network, SerpApi error,
// quota) -- the client-side analogue of the backend's budget-exhaustion
// trigger. The candidate then falls back to an indicative estimate and is
// flagged verified=false rather than erroring the whole search.

import {
  FARE_CACHE_TTL_EMPTY_MS,
  FARE_CACHE_TTL_VERIFIED_MS,
  PER_SEARCH_LIVE_CAP,
  VERIFY_CONCURRENCY,
  VERIFY_TOP_N,
} from "./constants";
import { addDaysIso } from "./dates";
import { estimate } from "./indicative";
import { addObservations, cacheGet, cacheSet, recordLiveCall } from "./observations";
import { groupBestPrice } from "./pruning";
import { ProxyError, SerpApiError } from "./serpapi";
import type { Candidate, CandidateGroup, EngineProvider, FareOption, FareQuery, SearchSpace, VerifiedItinerary } from "./types";

export function passesHardConstraints(option: FareOption, space: SearchSpace): boolean {
  if (option.slices.length > 0) {
    // Manual multi-city: validate each flown slice independently. The
    // deliberate gap BETWEEN slices (a multi-day city stop) is not a
    // layover and must never be checked against the connection-comfort
    // window -- that window means "is this a comfortable flight
    // connection", not "is this a reasonable time to spend in a city".
    for (const sl of option.slices) {
      if (sl.stops > space.maxStops) return false;
      for (const [, minutes] of sl.layovers) {
        if (minutes < space.minNormalMinutes || minutes > space.maxNormalMinutes) return false;
      }
    }
  } else {
    if (option.stops > space.maxStops) return false;
    for (const [, minutes] of option.layovers) {
      if (minutes < space.minNormalMinutes || minutes > space.maxNormalMinutes) return false;
    }
  }
  // Budget is per person (adults=1 is the supported default).
  if (option.price > space.maxTotal) return false;
  return true;
}

export function selectCandidatesToVerify(groups: CandidateGroup[], callBudget: number): Candidate[] {
  const selected: CandidateGroup[] = [];
  let used = 0;
  for (const group of groups) {
    if (used + group.candidates.length > callBudget) continue; // whole groups only -- try smaller ones
    selected.push(group);
    used += group.candidates.length;
    if (used >= callBudget) break;
  }
  if (selected.length > 0) return selected.flatMap((g) => g.candidates);
  if (groups.length === 0) return [];

  // Budget too tight for even the cheapest whole group -- verify as much
  // of it as fits rather than nothing (sacrifices pairing for this one
  // group, only under budgets tighter than any real default).
  const cheapest = [...groups].sort((a, b) => groupBestPrice(a) - groupBestPrice(b))[0];
  return [...cheapest.candidates].sort((a, b) => a.estimatedPrice - b.estimatedPrice).slice(0, callBudget);
}

export function cacheKey(providerName: string, query: FareQuery): string {
  return `fare:v1:${providerName}:${query.origin}:${query.destination}:${query.departDate}:${query.returnDate}:${query.currency}:${query.maxStops}:${query.tripType}`;
}

async function fetchOptions(
  provider: EngineProvider,
  query: FareQuery,
  signal?: AbortSignal,
): Promise<{ options: FareOption[]; degraded: boolean }> {
  const key = cacheKey(provider.name, query);
  const cached = cacheGet(key);
  if (cached !== null) return { options: cached, degraded: false };

  let options: FareOption[];
  try {
    options =
      query.tripType === "one_way"
        ? await provider.searchOneWay(query, signal)
        : await provider.searchRoundTrip(query, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof SerpApiError || err instanceof ProxyError) {
      return { options: [], degraded: true };
    }
    throw err;
  }

  if (provider.name !== "mock") recordLiveCall();
  cacheSet(key, options, options.length > 0 ? FARE_CACHE_TTL_VERIFIED_MS : FARE_CACHE_TTL_EMPTY_MS);
  if (options.length > 0) {
    const now = Date.now();
    addObservations(
      options.map((o) => ({
        origin: query.origin,
        destination: query.destination,
        departure_date: query.departDate,
        return_date: query.returnDate,
        trip_type: query.tripType,
        fare: o.price,
        observed_at: now,
      })),
    );
  }
  return { options, degraded: false };
}

export async function verifyTop(
  space: SearchSpace,
  groups: CandidateGroup[],
  provider: EngineProvider,
  signal?: AbortSignal,
): Promise<{ verified: VerifiedItinerary[]; degraded: boolean }> {
  const callBudget = Math.min(VERIFY_TOP_N, PER_SEARCH_LIVE_CAP);
  const toVerify = selectCandidatesToVerify(groups, callBudget);

  let anyDegraded = false;

  async function verifyOne(candidate: Candidate): Promise<VerifiedItinerary | null> {
    const query: FareQuery = {
      origin: candidate.origin,
      destination: candidate.destination,
      departDate: candidate.departDate,
      returnDate: candidateReturnDate(candidate),
      adults: space.adults,
      currency: space.currency,
      maxStops: space.maxStops,
      tripType: space.tripType,
    };

    const { options, degraded } = await fetchOptions(provider, query, signal);

    if (degraded) {
      anyDegraded = true;
      const [price] = estimate(candidate.origin, candidate.destination, query.departDate, query.returnDate, space.tripType);
      if (price > space.maxTotal) return null;
      const fallback: FareOption = {
        price,
        currency: space.currency,
        outbound_legs: [],
        layovers: [],
        total_duration_min: 0,
        stops: 0,
        carriers: [],
        inbound_detail: "indicative",
        slices: [],
      };
      return {
        origin: candidate.origin,
        destination: candidate.destination,
        departDate: candidate.departDate,
        returnDate: query.returnDate,
        tripLength: candidate.tripLength,
        option: fallback,
        verified: false,
      };
    }

    const passing = options.filter((o) => passesHardConstraints(o, space));
    if (passing.length === 0) return null;
    const best = passing.reduce((a, b) => (b.price < a.price ? b : a));
    return {
      origin: candidate.origin,
      destination: candidate.destination,
      departDate: candidate.departDate,
      returnDate: query.returnDate,
      tripLength: candidate.tripLength,
      option: best,
      verified: true,
    };
  }

  // Concurrency-limited pool (the backend uses an asyncio semaphore of 4).
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

function candidateReturnDate(candidate: Candidate): string {
  // return_date is derived, not stored: depart + tripLength days --
  // matches the Python Candidate.return_date property. tripLength 0 (the
  // one-way sentinel) naturally yields returnDate === departDate.
  return addDaysIso(candidate.departDate, candidate.tripLength);
}
