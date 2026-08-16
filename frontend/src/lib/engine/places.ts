// Global city/airport/country search for the "From"/"To" wizard steps.
// Backed by data/seed/airports_world.json (3,270 airports w/ scheduled
// service, grouped into cities and countries -- see
// scripts/build-airports.mjs). Lazy-loaded via dynamic import() so the
// dataset ships as its own chunk, fetched only when a picker is actually
// opened, never inflating the main bundle.
//
// The curated 24-airport data/seed/airports.json (Toronto-area origins +
// the 14 destination regions) is unrelated and untouched -- it still
// powers the destination-region list and the map/results display.

import type { PlaceSelection } from "@/lib/types";

export interface PlaceAirport {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

export interface PlaceCity {
  kind: "city";
  key: string; // `${city}|${country}`, stable for React keys/dedup
  city: string;
  country: string;
  airports: string[]; // IATA codes; join with "," for a SerpApi departure_id/arrival_id
}

/** A country expands to SEVERAL destination groups, one per city -- never
 * one giant comma-joined group. Some countries have 40+ airports with
 * scheduled service, and SerpApi documents no limit on how many
 * comma-separated codes departure_id/arrival_id accepts, so joining
 * "every airport in the country" into one call is an unverified risk;
 * multiple normal destination groups (the same shape as picking several
 * cities by hand) sidesteps it entirely. */
export interface PlaceCountry {
  kind: "country";
  key: string; // country code
  code: string;
  name: string;
  cities: { city: string; airports: string[] }[];
}

export type PlaceResult = PlaceCity | PlaceCountry;

interface WorldData {
  airports: PlaceAirport[];
  cities: { city: string; country: string; airports: string[] }[];
  countries: { code: string; name: string; cities: { city: string; airports: string[] }[] }[];
}

interface LoadedPlaces {
  cities: PlaceCity[];
  countries: PlaceCountry[];
  airportsByIata: Map<string, PlaceAirport>;
}

let loaded: LoadedPlaces | null = null;
let loadPromise: Promise<LoadedPlaces> | null = null;

async function ensureLoaded(): Promise<LoadedPlaces> {
  if (loaded) return loaded;
  if (!loadPromise) {
    loadPromise = import("./seed/airports_world.json").then((mod) => {
      const data = (mod.default ?? mod) as unknown as WorldData;
      const airportsByIata = new Map(data.airports.map((a) => [a.iata, a]));
      const cities: PlaceCity[] = data.cities.map((c) => ({
        kind: "city",
        key: `${c.city}|${c.country}`,
        city: c.city,
        country: c.country,
        airports: c.airports,
      }));
      const countries: PlaceCountry[] = data.countries.map((c) => ({
        kind: "country",
        key: c.code,
        code: c.code,
        name: c.name,
        cities: c.cities,
      }));
      loaded = { cities, countries, airportsByIata };
      return loaded;
    });
  }
  return loadPromise;
}

/** Fire-and-forget: call from a picker's onFocus so the chunk is already
 * warm by the time the user finishes typing their first character. */
export function preloadPlaces(): void {
  void ensureLoaded();
}

export function getAirportDetail(iata: string): PlaceAirport | undefined {
  return loaded?.airportsByIata.get(iata);
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function matchScore(name: string, iataCandidates: string[], q: string): number | null {
  const nameLower = normalize(name);
  if (nameLower === q) return 0;
  if (nameLower.startsWith(q)) return 1;
  if (nameLower.includes(q)) return 2;
  if (iataCandidates.some((iata) => iata.toLowerCase() === q)) return 1;
  return null;
}

/** Cities and countries whose name starts with the query rank first, then
 * substring matches, then an exact IATA-code hit (cities only). Ties
 * break alphabetically so results are stable across identical queries.
 * Countries and cities share one ranked list -- typing "japan" surfaces
 * the country ahead of any unrelated partial city match. */
export async function searchPlaces(query: string, limit = 20): Promise<PlaceResult[]> {
  const q = normalize(query);
  if (q.length === 0) return [];
  const { cities, countries } = await ensureLoaded();

  const scored: [number, string, PlaceResult][] = [];
  for (const c of cities) {
    const score = matchScore(c.city, c.airports, q);
    if (score !== null) scored.push([score, c.city, c]);
  }
  for (const c of countries) {
    const score = matchScore(c.name, [c.code], q);
    if (score !== null) scored.push([score, c.name, c]);
  }

  scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return scored.slice(0, limit).map(([, , r]) => r);
}

export function toSelection(city: { city: string; airports: string[] }): PlaceSelection {
  const label = city.airports.length > 1 ? `${city.city} (${city.airports.join(", ")})` : `${city.city} (${city.airports[0]})`;
  return { airports: city.airports, label };
}

/** One PlaceSelection per city in the country -- see PlaceCountry's own
 * comment for why this is never a single joined group. */
export function expandCountry(country: PlaceCountry): PlaceSelection[] {
  return country.cities.map(toSelection);
}

export function joinAirports(iatas: string[]): string {
  return iatas.join(",");
}
