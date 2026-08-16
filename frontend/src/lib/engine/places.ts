// Global city/airport search for the "From"/"To" wizard steps. Backed by
// data/seed/airports_world.json (3,270 airports w/ scheduled service,
// grouped into cities by municipality+country -- see
// scripts/build-airports.mjs). Lazy-loaded via dynamic import() so the
// ~550KB dataset ships as its own chunk, fetched only when a picker is
// actually opened, never inflating the main bundle.
//
// The curated 24-airport data/seed/airports.json (Toronto-area origins +
// the 14 destination regions) is unrelated and untouched -- it still
// powers the destination-region list and the map/results display.

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

interface WorldData {
  airports: PlaceAirport[];
  cities: { city: string; country: string; airports: string[] }[];
}

interface LoadedPlaces {
  cities: PlaceCity[];
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
      loaded = { cities, airportsByIata };
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

/** Cities whose name starts with the query rank first, then substring
 * matches, then an exact IATA-code hit anywhere in the group. Ties break
 * alphabetically so results are stable across identical queries. */
export async function searchPlaces(query: string, limit = 20): Promise<PlaceCity[]> {
  const q = normalize(query);
  if (q.length === 0) return [];
  const { cities } = await ensureLoaded();

  const scored: [number, PlaceCity][] = [];
  for (const c of cities) {
    const cityLower = normalize(c.city);
    let score: number;
    if (cityLower === q) score = 0;
    else if (cityLower.startsWith(q)) score = 1;
    else if (cityLower.includes(q)) score = 2;
    else if (c.airports.some((iata) => iata.toLowerCase() === q)) score = 1;
    else continue;
    scored.push([score, c]);
  }

  scored.sort((a, b) => a[0] - b[0] || a[1].city.localeCompare(b[1].city));
  return scored.slice(0, limit).map(([, c]) => c);
}

export function joinAirports(iatas: string[]): string {
  return iatas.join(",");
}
