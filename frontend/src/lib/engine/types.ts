// Engine-internal types -- the TS counterpart of backend/app/providers/
// base.py plus the pipeline dataclasses (search/{candidates,pruning,
// spaces,verification}.py). Dates are ISO "YYYY-MM-DD" strings and
// datetimes ISO "YYYY-MM-DDTHH:MM" strings throughout: the engine only
// ever compares/orders them (both orders correctly as strings) or hands
// them to display formatters, so real Date objects would add timezone
// hazards without buying anything.

import type { Passengers, TravelClass } from "@/lib/types";

export type EngineTripType = "round_trip" | "one_way";

export interface FareQuery {
  // Comma-joined IATA groups (e.g. "YYZ,YTZ,YHM") -- already resolved by
  // the time they reach here. SerpApi compares every airport in the group
  // itself, so the engine never needs a per-airport loop.
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  passengers: Passengers;
  travelClass: TravelClass;
  currency: string;
  maxStops: number | null;
  // Disambiguates the one-way sentinel (returnDate === departDate) from a
  // genuine same-day round trip -- never inferred from date equality.
  tripType: EngineTripType;
}

export interface FareLeg {
  from_iata: string;
  to_iata: string;
  dep_time: string;
  arr_time: string;
  carrier: string;
  flight_number: string;
  duration_min: number;
}

/** One flown leg of a manual multi-city itinerary (YYZ->IST is one slice,
 * IST->BKK the next). Each slice's own connections are validated against
 * the connection-comfort window like any round-trip option; the deliberate
 * multi-day gap BETWEEN slices never enters that check. */
export interface FareSlice {
  legs: FareLeg[];
  layovers: [string, number][];
  stops: number;
  duration_min: number;
}

export interface MultiCityLeg {
  origin: string;
  destination: string;
  date: string;
}

export interface FareOption {
  price: number;
  currency: string;
  outbound_legs: FareLeg[];
  layovers: [string, number][]; // (airport iata, minutes) -- same-flight connections only
  total_duration_min: number;
  stops: number;
  carriers: string[];
  inbound_detail: "indicative" | "full";
  // Populated only by multi-city searches; empty otherwise.
  slices: FareSlice[];
}

export type EstimateSource = "observation_exact" | "observation_nearest";

/** A destination group ready to query: either a curated region or a
 * picked city, always resolved to a joined IATA string by the time the
 * pipeline builds one. */
export interface DestinationGroup {
  key: string;
  joined: string;
  label: string;
}

export interface Candidate {
  destination: DestinationGroup;
  departDate: string;
  tripLength: number;
  // null = no price signal available (no matching past observation from
  // THIS user) -- never a fabricated number. Candidates without a signal
  // keep their original date-stride order rather than being sorted by a
  // guess; see indicative.ts.
  estimatedPrice: number | null;
  estimateSource: EstimateSource | null;
}

export interface SearchSpace {
  originGroup: string; // comma-joined IATA codes, ready for departure_id
  originLabel: string;
  destinationGroups: DestinationGroup[];
  tripType: EngineTripType;
  departureFrom: string;
  departureTo: string;
  tripLengthMin: number;
  tripLengthMax: number;
  maxStops: number;
  minNormalMinutes: number;
  maxNormalMinutes: number;
  maxTotal: number;
  currency: string;
  passengers: Passengers;
  travelClass: TravelClass;
}

export interface VerifiedItinerary {
  destination: DestinationGroup;
  // Open-jaw only: the group flown OUT OF on the way home. Undefined for
  // every other trip type (round trip/one-way always return to
  // `destination`'s own airport; multi-city has no "home" concept at all).
  returnOrigin?: DestinationGroup;
  departDate: string;
  returnDate: string;
  tripLength: number;
  option: FareOption;
  verified: boolean; // false = indicative fallback (live call failed)
}

/** The provider surface both serpapi.ts and mock.ts implement -- the TS
 * counterpart of the FareProvider protocol. */
export interface EngineProvider {
  name: string;
  searchRoundTrip(query: FareQuery, signal?: AbortSignal): Promise<FareOption[]>;
  searchOneWay(query: FareQuery, signal?: AbortSignal): Promise<FareOption[]>;
  searchMultiCity(
    legs: MultiCityLeg[],
    opts: { passengers: Passengers; travelClass: TravelClass; currency: string; maxStops: number | null },
    signal?: AbortSignal,
  ): Promise<FareOption[]>;
}
