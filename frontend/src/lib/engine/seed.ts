// Typed access to the bundled seed data (see scripts/sync-seed.mjs --
// data/seed/ at the repo root is the source of truth, shared with the
// Python backend; these copies ship in the static build).
//
// Array order is preserved from the JSON deliberately: the backend's
// equivalents (services/geo.py) have no ORDER BY and rely on seed
// insertion order (YYZ first in the origin group), and parts of the
// pipeline are order-sensitive in the same way.

import type { AirportMeta, MetaResponse, MetroAreaMeta, TravelRegionMeta } from "@/lib/types";
import airportsJson from "./seed/airports.json";
import equivalenceJson from "./seed/airport_equivalence.json";
import metroAreasJson from "./seed/metro_areas.json";
import routeBaselinesJson from "./seed/route_baselines.json";
import travelRegionsJson from "./seed/travel_regions.json";

interface SeedAirport {
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  tz: string;
  metro: string;
  region: string;
  is_metro_primary?: boolean;
  is_origin_candidate?: boolean;
  is_origin_default?: boolean;
}

interface SeedEquivalence {
  a: string;
  b: string;
  ground_time_minutes: number;
  ground_cost_estimate: number;
  currency: string;
  same_metro: boolean;
  same_travel_region: boolean;
}

export const AIRPORTS: AirportMeta[] = (airportsJson as SeedAirport[]).map((a) => ({
  iata: a.iata,
  icao: a.icao ?? null,
  name: a.name,
  city: a.city,
  country: a.country,
  lat: a.lat,
  lon: a.lon,
  tz: a.tz,
  metro: a.metro,
  region: a.region,
  is_metro_primary: a.is_metro_primary ?? false,
  is_origin_candidate: a.is_origin_candidate ?? false,
  is_origin_default: a.is_origin_default ?? false,
}));

export const TRAVEL_REGIONS = travelRegionsJson as TravelRegionMeta[];
export const METRO_AREAS = metroAreasJson as MetroAreaMeta[];
export const EQUIVALENCES = equivalenceJson as SeedEquivalence[];

// route_baselines.json mixes metadata keys (_comment, currency) with the
// metro keys -- filter before use. Shape: origin metro -> dest IATA -> CAD.
const baselinesRaw = routeBaselinesJson as Record<string, unknown>;
export const ROUTE_BASELINES: Record<string, Record<string, number>> = Object.fromEntries(
  Object.entries(baselinesRaw).filter(
    ([key, value]) => !key.startsWith("_") && key !== "currency" && typeof value === "object" && value !== null,
  ),
) as Record<string, Record<string, number>>;

/** Local replacement for GET /api/meta -- identical shape, no network. */
export const META: MetaResponse = {
  travel_regions: TRAVEL_REGIONS,
  metro_areas: METRO_AREAS,
  airports: AIRPORTS,
  origin_group: AIRPORTS.filter((a) => a.is_origin_candidate).map((a) => a.iata),
};
