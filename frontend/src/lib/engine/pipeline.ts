// End-to-end search orchestration. The caller passes an onStage callback
// and gets the finished result back directly; the stage vocabulary and
// order are unchanged (queued -> generating -> pruning -> verifying ->
// ranking -> done, with multi-city skipping straight to verifying).

import type {
  AirportRef,
  ItineraryOut,
  MultiCitySearchRequestBody,
  Passengers,
  SearchRequestBody,
  SearchStage,
  TravelClass,
} from "@/lib/types";
import type { MessageKey } from "@/lib/i18n/messages";
import { FARE_CACHE_TTL_EMPTY_MS, FARE_CACHE_TTL_VERIFIED_MS } from "./constants";
import { generateCoarse } from "./candidates";
import { getAirport, getDestinationAirports } from "./geo";
import { partyKey } from "./indicative";
import { cacheGet, cacheSet, recordLiveCall } from "./observations";
import { getAirportDetail } from "./places";
import { pruneAndExpand } from "./pruning";
import { rank, type RankedItinerary } from "./ranking";
import { ProxyError, SerpApiError } from "./serpapi";
import type { DestinationGroup, EngineProvider, FareOption, MultiCityLeg, SearchSpace, VerifiedItinerary } from "./types";
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
  meta: { candidate_count: number; coarse_count: number };
}

export interface RunOptions {
  provider: EngineProvider;
  onStage?: (stage: SearchStage) => void;
  signal?: AbortSignal;
}

/** Curated seed first (has richer metadata for the ~20 well-known
 * destinations), then the lazily-loaded world dataset (already resident
 * once a PlacePicker has been used this session), then a bare-IATA stub
 * as a last resort -- the code came from a picker, so this should never
 * actually trigger in practice. */
function airportRef(iata: string): AirportRef {
  const curated = getAirport(iata);
  if (curated) return { iata: curated.iata, name: curated.name, city: curated.city, lat: curated.lat, lon: curated.lon };
  const world = getAirportDetail(iata);
  if (world) return { iata: world.iata, name: world.name, city: world.city, lat: world.lat, lon: world.lon };
  return { iata, name: iata, city: iata, lat: 0, lon: 0 };
}

export function parseRequest(req: SearchRequestBody): SearchSpace {
  if (req.origin.airports.length === 0) {
    throw new EngineError("engine.errors.noOriginGroup");
  }

  const destinationGroups: DestinationGroup[] = req.destination.selections
    .map((sel): DestinationGroup => {
      if (sel.kind === "region") {
        const airports = getDestinationAirports([sel.code]);
        return { key: `region:${sel.code}`, joined: airports.map((a) => a.iata).join(","), label: sel.label };
      }
      return { key: `city:${sel.airports.join(",")}`, joined: sel.airports.join(","), label: sel.label };
    })
    .filter((g) => g.joined.length > 0);

  if (destinationGroups.length === 0) {
    throw new EngineError("engine.errors.noDestinations");
  }

  return {
    originGroup: req.origin.airports.join(","),
    originLabel: req.origin.label,
    destinationGroups,
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
    passengers: req.passengers,
    travelClass: req.travel_class,
  };
}

/** The origin/destination airport actually shown to the user is whichever
 * specific airport the result really flew through -- read off the flown
 * legs, not the requested group -- so a joined "YYZ,YTZ,YHM" origin shows
 * as whichever one SerpApi actually picked as cheapest. Falls back to the
 * first airport in the requested group only for the rare degraded/
 * indicative result, which has no real legs at all. */
function toItinerary(id: string, ranked: RankedItinerary, space: SearchSpace): ItineraryOut {
  const it = ranked.verifiedItinerary;
  const legs = it.option.outbound_legs;
  const originIata = legs[0]?.from_iata || space.originGroup.split(",")[0];
  const destinationIata = legs.length > 0 ? legs[legs.length - 1].to_iata : it.destination.joined.split(",")[0];

  const citystops =
    it.option.slices.length > 0 ? it.option.slices.slice(0, -1).map((sl) => airportRef(sl.legs[sl.legs.length - 1].to_iata)) : null;

  return {
    id,
    origin: airportRef(originIata),
    destination: airportRef(destinationIata),
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
    ground_transfer: null,
    city_stops: citystops,
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
  const candidates = pruneAndExpand(space, coarse);

  stage("verifying");
  const { verified, degraded } = await verifyTop(space, candidates, opts.provider, opts.signal);

  stage("ranking");
  const ranked = rank(space, verified);

  return {
    itineraries: ranked.map((r, idx) => toItinerary(`it-${idx}`, r, space)),
    degraded,
    meta: {
      candidate_count: candidates.length,
      coarse_count: coarse.length,
    },
  };
}

function multiCityCacheKey(
  providerName: string,
  legs: MultiCityLeg[],
  opts: { passengers: Passengers; travelClass: TravelClass; currency: string; maxStops: number | null },
): string {
  const legsPart = legs.map((l) => `${l.origin}-${l.destination}-${l.date}`).join("+");
  return `fare:v2:mc:${providerName}:${legsPart}:${opts.currency}:${opts.maxStops}:${partyKey(opts.passengers)}:${opts.travelClass}`;
}

export async function runMultiCitySearch(req: MultiCitySearchRequestBody, opts: RunOptions): Promise<SearchOutcome> {
  const stage = (name: SearchStage) => opts.onStage?.(name);

  // No coarse grid / pruning for explicit user-chosen legs -- first stage
  // is verifying.
  stage("verifying");

  if (req.origin.airports.length === 0) {
    throw new EngineError("engine.errors.noOriginGroup");
  }

  let priorGroup = req.origin.airports.join(",");
  const queryLegs: MultiCityLeg[] = req.legs.map((leg) => {
    const destGroup = leg.destination.airports.join(",");
    const built = { origin: priorGroup, destination: destGroup, date: leg.date };
    priorGroup = destGroup;
    return built;
  });

  const providerOpts = {
    passengers: req.passengers,
    travelClass: req.travel_class,
    currency: req.budget.currency,
    maxStops: req.connections.max_stops,
  };
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

  const finalLeg = req.legs[req.legs.length - 1];
  const destGroup: DestinationGroup = {
    key: `mc:${finalLeg.destination.airports.join(",")}`,
    joined: finalLeg.destination.airports.join(","),
    label: finalLeg.destination.label,
  };

  // Minimal space: only the constraint fields are real; the trip-shape
  // fields are inert placeholders.
  const space: SearchSpace = {
    originGroup: req.origin.airports.join(","),
    originLabel: req.origin.label,
    destinationGroups: [destGroup],
    tripType: "round_trip",
    departureFrom: req.legs[0].date,
    departureTo: finalLeg.date,
    tripLengthMin: 0,
    tripLengthMax: 0,
    maxStops: req.connections.max_stops,
    minNormalMinutes: req.connections.min_normal_minutes,
    maxNormalMinutes: req.connections.max_normal_minutes,
    maxTotal: req.budget.max_total,
    currency: req.budget.currency,
    passengers: req.passengers,
    travelClass: req.travel_class,
  };

  const verified: VerifiedItinerary[] = options
    .filter((option) => passesHardConstraints(option, space))
    .map((option) => ({
      destination: destGroup,
      departDate: req.legs[0].date,
      returnDate: finalLeg.date,
      tripLength: 0,
      option,
      verified: !degraded,
    }));

  stage("ranking");
  const ranked = rank(space, verified);

  return {
    itineraries: ranked.map((r, idx) => toItinerary(`mc-${idx}`, r, space)),
    degraded,
    meta: {
      candidate_count: options.length,
      coarse_count: 0,
    },
  };
}
