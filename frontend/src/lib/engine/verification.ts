// Live-price (or indicative-fallback) verification of the top candidates
// -- cheapest/most-promising first, up to the live-call budget.
//
// "Degraded" here means a live call FAILED (network, SerpApi error,
// quota). The candidate then falls back to this user's own past
// observation for the same route/dates/party if one exists (a REAL past
// price, not a guess) and is flagged verified=false; with no such
// observation there is nothing honest to show, so the candidate is
// dropped rather than displaying a fabricated number.

import { FARE_CACHE_TTL_EMPTY_MS, FARE_CACHE_TTL_VERIFIED_MS, PER_SEARCH_LIVE_CAP, VERIFY_CONCURRENCY, VERIFY_TOP_N } from "./constants";
import { addDaysIso } from "./dates";
import { estimate, partyKey } from "./indicative";
import { addObservations, cacheGet, cacheSet, recordLiveCall } from "./observations";
import { ProxyError, SerpApiError } from "./serpapi";
import type { Candidate, EngineProvider, FareOption, FareQuery, SearchSpace, VerifiedItinerary } from "./types";

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
  // SerpApi's price is always for the whole party -- max_total is asked
  // for, and must be compared, the same way.
  if (option.price > space.maxTotal) return false;
  return true;
}

export function cacheKey(providerName: string, query: FareQuery): string {
  return `fare:v2:${providerName}:${query.origin}:${query.destination}:${query.departDate}:${query.returnDate}:${query.currency}:${query.maxStops}:${query.tripType}:${partyKey(query.passengers)}:${query.travelClass}`;
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
        party_key: partyKey(query.passengers),
      })),
    );
  }
  return { options, degraded: false };
}

export async function verifyTop(
  space: SearchSpace,
  candidates: Candidate[],
  provider: EngineProvider,
  signal?: AbortSignal,
): Promise<{ verified: VerifiedItinerary[]; degraded: boolean }> {
  const callBudget = Math.min(VERIFY_TOP_N, PER_SEARCH_LIVE_CAP);
  // pruning.ts already sorted candidates signal-first/cheapest-first --
  // just take the top of the live-call budget.
  const toVerify = candidates.slice(0, callBudget);

  let anyDegraded = false;

  async function verifyOne(candidate: Candidate): Promise<VerifiedItinerary | null> {
    const query: FareQuery = {
      origin: space.originGroup,
      destination: candidate.destination.joined,
      departDate: candidate.departDate,
      returnDate: candidateReturnDate(candidate),
      passengers: space.passengers,
      travelClass: space.travelClass,
      currency: space.currency,
      maxStops: space.maxStops,
      tripType: space.tripType,
    };

    const { options, degraded } = await fetchOptions(provider, query, signal);

    if (degraded) {
      anyDegraded = true;
      const [price] = estimate(query.origin, query.destination, query.departDate, query.returnDate, space.tripType, space.passengers);
      if (price === null || price > space.maxTotal) return null;
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
      destination: candidate.destination,
      departDate: candidate.departDate,
      returnDate: query.returnDate,
      tripLength: candidate.tripLength,
      option: best,
      verified: true,
    };
  }

  // Concurrency-limited pool (the original backend used an asyncio
  // semaphore of 4).
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
  // return_date is derived, not stored: depart + tripLength days.
  // tripLength 0 (the one-way sentinel) naturally yields returnDate === departDate.
  return addDaysIso(candidate.departDate, candidate.tripLength);
}
