// SerpApi Google Flights client -- faithful TS port of
// backend/app/providers/serpapi_google_flights.py, with two lightweight-
// build differences: requests go through the Cloudflare Worker proxy
// (SerpApi sends no CORS headers, so a browser can't call it directly;
// the caller's own key travels in the X-Serpapi-Key header and is
// attached server-side), and datetimes are ISO strings, not datetime
// objects (see engine/types.ts).
//
// The parsing functions are pure and pinned by parity goldens generated
// from the Python parsers over the same recorded fixtures -- see
// __tests__/serpapi.parity.test.ts. All Python-side known limitations
// carry over verbatim, most importantly: multi-city is a departure_token
// CHAIN (one paid call per leg, greedy cheapest choice per step, final
// step's price wins), and the first round-trip call returns outbound
// detail only (inbound_detail="indicative").

import { PROXY_BASE } from "./constants";
import type { EngineProvider, FareLeg, FareOption, FareQuery, FareSlice, MultiCityLeg } from "./types";

export class SerpApiError extends Error {}

/** Thrown when the proxy or network fails (vs. SerpApi answering with an
 * error body) -- verification.ts treats both as "degrade to indicative". */
export class ProxyError extends Error {
  constructor(
    message: string,
    public status: number | null,
  ) {
    super(message);
  }
}

/** The Worker's own account gates rejected this (not approved, no key,
 * session expired...). Distinguished from SerpApiError by the "source":
 * "auth" marker the Worker sets, because unlike a fare-provider failure
 * this must NOT silently degrade to indicative pricing -- it needs to
 * reach the user as an account problem they can act on. */
export class AuthGateError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function carrierCode(flightNumber: string | null | undefined, airline: string | null | undefined): string {
  if (flightNumber) {
    const prefix = flightNumber.trim().split(" ")[0];
    if (prefix) return prefix.toUpperCase();
  }
  return (airline || "??").slice(0, 2).toUpperCase();
}

/** "YYYY-MM-DD HH:MM" -> "YYYY-MM-DDTHH:MM" (empty string for missing --
 * the Python port uses datetime.min; both only matter for already-broken
 * data, and layover math below clamps to 0 either way). */
function parseTime(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().replace(" ", "T");
}

interface RawLeg {
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
  airline?: string;
  flight_number?: string;
  duration?: number;
}

interface RawItem {
  flights?: RawLeg[];
  layovers?: { id?: string; duration?: number }[];
  price?: number;
  total_duration?: number;
  departure_token?: string;
}

interface RawResponse {
  error?: unknown;
  best_flights?: RawItem[];
  other_flights?: RawItem[];
}

function parseLeg(leg: RawLeg): FareLeg {
  const dep = leg.departure_airport ?? {};
  const arr = leg.arrival_airport ?? {};
  const flightNumber = leg.flight_number;
  return {
    from_iata: dep.id ?? "",
    to_iata: arr.id ?? "",
    dep_time: parseTime(dep.time),
    arr_time: parseTime(arr.time),
    carrier: carrierCode(flightNumber, leg.airline),
    flight_number: flightNumber ?? "",
    duration_min: Math.trunc(leg.duration ?? 0),
  };
}

function parseItinerary(item: RawItem, currency: string): FareOption | null {
  const rawLegs = item.flights ?? [];
  if (rawLegs.length === 0) return null;

  const legs = rawLegs.map(parseLeg);
  const layovers: [string, number][] = (item.layovers ?? []).map((lo) => [lo.id ?? "", Math.trunc(lo.duration ?? 0)]);

  const price = item.price;
  if (price === null || price === undefined) return null;

  let totalDuration = item.total_duration;
  if (totalDuration === null || totalDuration === undefined) {
    totalDuration = legs.reduce((s, l) => s + l.duration_min, 0) + layovers.reduce((s, [, m]) => s + m, 0);
  }

  const carriers = [...new Set(legs.map((l) => l.carrier))];

  return {
    price: Number(price),
    currency,
    outbound_legs: legs,
    layovers,
    total_duration_min: Math.trunc(totalDuration),
    stops: layovers.length,
    carriers,
    inbound_detail: "indicative",
    slices: [],
  };
}

/** Pure function, no I/O -- parity-golden-tested against the Python parser. */
export function parseResponse(data: RawResponse, query: Pick<FareQuery, "currency" | "maxStops">): FareOption[] {
  if ("error" in data && data.error !== undefined) {
    throw new SerpApiError(String(data.error));
  }
  const items = [...(data.best_flights ?? []), ...(data.other_flights ?? [])];
  const options: FareOption[] = [];
  for (const item of items) {
    const option = parseItinerary(item, query.currency);
    if (option === null) continue;
    if (query.maxStops !== null && option.stops > query.maxStops) continue;
    options.push(option);
  }
  options.sort((a, b) => a.price - b.price);
  return options;
}

function minutesBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 60_000);
}

/** Reconstructs slice boundaries from the flat chain of collected legs:
 * one contiguous run per requested leg, closed when a leg's arrival
 * matches that requested leg's destination (a same-flight connection
 * through an intermediate hub stays inside the slice). */
export function partitionIntoSlices(allLegs: FareLeg[], requestedLegs: MultiCityLeg[]): FareSlice[] {
  const slices: FareSlice[] = [];
  const remaining = [...allLegs];
  for (const leg of requestedLegs) {
    const sliceLegs: FareLeg[] = [];
    while (remaining.length > 0) {
      const nextLeg = remaining.shift()!;
      sliceLegs.push(nextLeg);
      if (nextLeg.to_iata === leg.destination) break;
    }
    if (sliceLegs.length === 0) continue;
    const layovers: [string, number][] = [];
    for (let i = 0; i + 1 < sliceLegs.length; i++) {
      layovers.push([sliceLegs[i].to_iata, Math.max(minutesBetween(sliceLegs[i].arr_time, sliceLegs[i + 1].dep_time), 0)]);
    }
    const duration = sliceLegs.reduce((s, l) => s + l.duration_min, 0) + layovers.reduce((s, [, m]) => s + m, 0);
    slices.push({ legs: sliceLegs, layovers, stops: sliceLegs.length - 1, duration_min: duration });
  }
  return slices;
}

/** Picks the cheapest option from ONE step of the departure_token chain;
 * null when the step has no options. Parity-golden-tested. */
export function cheapestMultiCityStep(data: RawResponse): RawItem | null {
  if ("error" in data && data.error !== undefined) {
    throw new SerpApiError(String(data.error));
  }
  const items = [...(data.best_flights ?? []), ...(data.other_flights ?? [])];
  if (items.length === 0) return null;
  return items.reduce((best, item) => ((item.price ?? Infinity) < (best.price ?? Infinity) ? item : best));
}

/** Assembles the single combined FareOption once the chain is complete;
 * null if any slice exceeds maxStops. Inter-slice gaps (deliberate city
 * stops) never enter `layovers` -- only same-flight connections do. */
export function buildMultiCityOption(
  collectedLegs: FareLeg[],
  finalPrice: number,
  requestedLegs: MultiCityLeg[],
  opts: { currency: string; maxStops: number | null },
): FareOption | null {
  const slices = partitionIntoSlices(collectedLegs, requestedLegs);
  if (opts.maxStops !== null && slices.some((sl) => sl.stops > opts.maxStops!)) return null;
  const carriers = [...new Set(collectedLegs.map((l) => l.carrier))];
  const flatLayovers = slices.flatMap((sl) => sl.layovers);
  return {
    price: Number(finalPrice),
    currency: opts.currency,
    outbound_legs: collectedLegs,
    layovers: flatLayovers,
    total_duration_min: slices.reduce((s, sl) => s + sl.duration_min, 0),
    stops: slices.reduce((s, sl) => s + sl.stops, 0),
    carriers,
    inbound_detail: "indicative",
    slices,
  };
}

async function proxyFetch(
  params: Record<string, string | number>,
  token: string,
  signal?: AbortSignal,
): Promise<RawResponse> {
  let res: Response;
  try {
    res = await fetch(`${PROXY_BASE}/search`, {
      method: "POST",
      // The session token, not a key: the Worker looks up this user's own
      // stored SerpApi key and attaches it server-side, so the key never
      // reaches the browser.
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ params }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ProxyError(err instanceof Error ? err.message : "Network error", null);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ProxyError(`Proxy returned non-JSON (HTTP ${res.status})`, res.status);
  }
  if (!res.ok) {
    const body = data as { error?: unknown; source?: unknown };
    // The Worker marks its own account-gate rejections with source:"auth"
    // so they don't get mistaken for a SerpApi failure and degraded away.
    if (body.source === "auth") throw new AuthGateError(String(body.error ?? `HTTP ${res.status}`), res.status);
    // SerpApi's own {"error": ...} body passes through with its status --
    // surface it as SerpApiError so quota/auth problems read correctly.
    if (body.error !== undefined) throw new SerpApiError(String(body.error));
    throw new ProxyError(`HTTP ${res.status}`, res.status);
  }
  return data as RawResponse;
}

function roundTripParams(query: FareQuery): Record<string, string | number> {
  return {
    engine: "google_flights",
    departure_id: query.origin,
    arrival_id: query.destination,
    outbound_date: query.departDate,
    return_date: query.returnDate,
    currency: query.currency,
    adults: query.adults,
    type: "1",
    gl: "ca",
    hl: "en",
  };
}

function oneWayParams(query: FareQuery): Record<string, string | number> {
  return {
    engine: "google_flights",
    departure_id: query.origin,
    arrival_id: query.destination,
    outbound_date: query.departDate,
    currency: query.currency,
    adults: query.adults,
    type: "2",
    gl: "ca",
    hl: "en",
  };
}

function multiCityParams(legs: MultiCityLeg[], adults: number, currency: string): Record<string, string | number> {
  const multiCityJson = JSON.stringify(
    legs.map((leg) => ({ departure_id: leg.origin, arrival_id: leg.destination, date: leg.date })),
  );
  return {
    engine: "google_flights",
    type: "3",
    multi_city_json: multiCityJson,
    currency,
    adults,
    gl: "ca",
    hl: "en",
  };
}

/** `sessionToken` is the user's login session, not a SerpApi key -- the
 * Worker resolves it to that user's own stored key server-side. */
export function buildSerpApiProvider(sessionToken: string): EngineProvider {
  return {
    name: "serpapi",

    async searchRoundTrip(query, signal) {
      const data = await proxyFetch(roundTripParams(query), sessionToken, signal);
      return parseResponse(data, query);
    },

    async searchOneWay(query, signal) {
      const data = await proxyFetch(oneWayParams(query), sessionToken, signal);
      return parseResponse(data, query);
    },

    async searchMultiCity(legs, opts, signal) {
      // Greedy departure_token chain: one paid call per leg, cheapest
      // choice per step, final step's price is the itinerary total (see
      // the Python module's docstring for the live-verified evidence and
      // its explicitly unproven >2-leg generalization).
      const baseParams = multiCityParams(legs, opts.adults, opts.currency);
      let data = await proxyFetch(baseParams, sessionToken, signal);
      let chosen = cheapestMultiCityStep(data);
      if (chosen === null) return [];
      let collectedLegs = (chosen.flights ?? []).map(parseLeg);
      let price = chosen.price;
      let departureToken = chosen.departure_token;

      for (let i = 0; i < legs.length - 1; i++) {
        if (!departureToken) return []; // chain ended early -- no result rather than an incomplete one
        data = await proxyFetch({ ...baseParams, departure_token: departureToken }, sessionToken, signal);
        chosen = cheapestMultiCityStep(data);
        if (chosen === null) return [];
        collectedLegs = [...collectedLegs, ...(chosen.flights ?? []).map(parseLeg)];
        price = chosen.price;
        departureToken = chosen.departure_token;
      }

      if (price === null || price === undefined) return [];
      const option = buildMultiCityOption(collectedLegs, price, legs, {
        currency: opts.currency,
        maxStops: opts.maxStops,
      });
      return option ? [option] : [];
    },
  };
}
