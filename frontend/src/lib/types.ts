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

export interface SearchRequestBody {
  origin: OriginPrefs;
  destination: DestinationPrefs;
  dates: DatePrefs;
  budget: BudgetPrefs;
  connections: ConnectionPrefs;
  adults: number;
}

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
