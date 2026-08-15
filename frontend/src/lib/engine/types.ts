// Engine-internal types -- the TS counterpart of backend/app/providers/
// base.py plus the pipeline dataclasses (search/{candidates,pruning,
// spaces,verification}.py). Dates are ISO "YYYY-MM-DD" strings and
// datetimes ISO "YYYY-MM-DDTHH:MM" strings throughout: the engine only
// ever compares/orders them (both orders correctly as strings) or hands
// them to display formatters, so real Date objects would add timezone
// hazards without buying anything.

import type { AirportMeta } from "@/lib/types";

export type EngineTripType = "round_trip" | "one_way";

export interface FareQuery {
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  adults: number;
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

export type EstimateSource = "observation_exact" | "observation_nearest" | "baseline";

export interface Cell {
  origin: string;
  destination: string;
  departDate: string;
  tripLength: number;
  estimatedPrice: number;
  estimateSource: EstimateSource;
}

export interface Candidate {
  origin: string;
  destination: string;
  departDate: string;
  tripLength: number;
  estimatedPrice: number;
  estimateSource: EstimateSource;
}

/** Every origin-airport variant of the same (destination, departDate,
 * tripLength) trip, kept together so verification/ranking can always
 * compare a primary-origin price against an alt-origin price for the
 * exact same trip. Pruning keeps or drops a group whole. */
export interface CandidateGroup {
  destination: string;
  departDate: string;
  tripLength: number;
  candidates: Candidate[];
}

export interface SearchSpace {
  primaryOrigin: AirportMeta;
  originAirports: AirportMeta[];
  alternateOrigins: AirportMeta[];
  destinationAirports: AirportMeta[];
  destinationPrimaries: AirportMeta[];
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
  adults: number;
  maxGroundMinutes: number;
  minSavingPerPerson: number;
}

export interface VerifiedItinerary {
  origin: string;
  destination: string;
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
    opts: { adults: number; currency: string; maxStops: number | null },
    signal?: AbortSignal,
  ): Promise<FareOption[]>;
}
