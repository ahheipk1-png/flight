// Mirrors backend/app/schemas/{search,itinerary,meta}.py exactly.
// Keep field names identical to the Pydantic models -- this file has no
// runtime logic, just the wire shape.

export interface OriginPrefs {
  region: string;
  max_ground_minutes: number;
  min_saving_per_person: number;
}

export interface DestinationPrefs {
  regions: string[];
}

export interface DatePrefs {
  departure_from: string; // ISO date
  departure_to: string;
  // 0/0 is the one-way sentinel (see backend schemas/search.py) -- only
  // valid when trip_type is "one_way", enforced server-side.
  trip_length_min: number;
  trip_length_max: number;
}

export interface BudgetPrefs {
  currency: string;
  max_total: number;
}

export interface ConnectionPrefs {
  max_stops: number;
  min_normal_minutes: number;
  max_normal_minutes: number;
}

// Wire-level trip_type: only what SearchRequest itself carries. Manual
// multi-city is a structurally different request (MultiCitySearchRequest
// below), not a third value of this field -- see TripType for the
// frontend-only UI state union that does include it.
export type SearchTripType = "round_trip" | "one_way";

export interface SearchRequestBody {
  origin: OriginPrefs;
  destination: DestinationPrefs;
  dates: DatePrefs;
  budget: BudgetPrefs;
  connections: ConnectionPrefs;
  adults: number;
  trip_type: SearchTripType;
}

export interface MultiCityLegPref {
  destination: string; // IATA
  date: string; // ISO date
}

// Deliberately separate from SearchRequestBody: no origin.max_ground_minutes/
// min_saving_per_person (no nearby-airport-savings for manual multi-city)
// and no destination.regions/dates window (every leg is explicit). Mirrors
// backend schemas/search.py's MultiCitySearchRequest.
export interface MultiCitySearchRequestBody {
  legs: MultiCityLegPref[];
  budget: BudgetPrefs;
  connections: ConnectionPrefs;
  adults: number;
}

// Frontend-only UI state union -- includes "multi_city", which has no
// SearchTripType wire value of its own (it's a different endpoint/schema
// entirely). SearchForm and useSearch both key off this to decide which
// request shape/endpoint to submit.
export type TripType = SearchTripType | "multi_city";

export type SearchSubmission =
  | { tripType: SearchTripType; body: SearchRequestBody }
  | { tripType: "multi_city"; body: MultiCitySearchRequestBody };

export interface AirportMeta {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  tz: string;
  metro: string;
  region: string;
  is_metro_primary: boolean;
  is_origin_candidate: boolean;
  is_origin_default: boolean;
}

export interface MetroAreaMeta {
  code: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
}

export interface TravelRegionMeta {
  code: string;
  name: string;
  kind: "origin" | "destination";
}

export interface MetaResponse {
  travel_regions: TravelRegionMeta[];
  metro_areas: MetroAreaMeta[];
  airports: AirportMeta[];
  origin_group: string[];
}

export interface AirportRef {
  iata: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
}

export interface LegOut {
  from_iata: string;
  to_iata: string;
  dep_time: string;
  arr_time: string;
  carrier: string;
  flight_number: string;
  duration_min: number;
}

export interface GroundTransferOut {
  from_iata: string;
  to_iata: string;
  minutes: number;
  cost: number;
  currency: string;
}

export type RankMode = "best" | "cheapest" | "fastest";

export interface ItineraryOut {
  id: string;
  origin: AirportRef;
  destination: AirportRef;
  depart_date: string;
  return_date: string;
  trip_length: number;
  fare: number;
  currency: string;
  stops: number;
  total_duration_min: number;
  legs: LegOut[];
  layovers: [string, number][];
  carriers: string[];
  verified: boolean;
  ground_transfer: GroundTransferOut | null;
  // Manual multi-city only: the intermediate leg endpoints in order (not
  // including `destination`, the final leg's arrival). null for round
  // trip/one-way.
  city_stops: AirportRef[] | null;
  explanations: string[];
  rank_scores: { cheapest: number; fastest: number; best: number };
}

export type SearchStage = "queued" | "generating" | "pruning" | "verifying" | "ranking" | "done" | "error";

export interface SearchStateResponse {
  status: "running" | "done" | "error";
  stage: SearchStage;
  degraded: boolean;
  itineraries: ItineraryOut[] | null;
  meta?: { candidate_count: number; candidate_group_count: number; coarse_count: number };
  error?: string;
}

// Mirrors backend/app/schemas/auth.py exactly.

export type AccountStatus = "pending" | "approved" | "denied" | "disabled";

export interface SessionOut {
  token: string;
  username: string;
  is_admin: boolean;
}

export interface MeOut {
  username: string;
  status: AccountStatus;
  is_admin: boolean;
  has_api_key: boolean;
}

export interface AdminAccountOut {
  id: number;
  username: string;
  status: AccountStatus;
  is_admin: boolean;
  has_api_key: boolean;
  created_at: string;
  decided_at: string | null;
}
