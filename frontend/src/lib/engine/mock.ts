// Deterministic in-browser mock provider. Zero network, zero cost. Two
// jobs: (1) the "demo" mode -- the API-key gate accepts the literal key
// "demo" so anyone can exercise the full UI without a SerpApi account or
// spending quota; (2) engine tests. Loosely mirrors the Python mock
// provider's market model (baseline x origin factor x seasonal x weekday
// x deal x noise, plausible hub connections) but does NOT reproduce its
// exact numbers -- Python's Mersenne-Twister semantics aren't worth
// porting; determinism per query is what matters, not cross-language
// numeric parity. Same (query) always -> same options, forever.

import { estimateDistanceKm } from "./mockGeo";
import { ROUTE_BASELINES } from "./seed";
import type { EngineProvider, FareLeg, FareOption, FareQuery, FareSlice } from "./types";

export const MOCK_API_KEY = "demo";

const ORIGIN_FACTOR: Record<string, number> = { YYZ: 1.0, YTZ: 1.05, YHM: 0.88, YKF: 0.95, BUF: 0.75 };

const CONNECTING_HUB: Record<string, string> = {
  HND: "ICN", NRT: "ICN", KIX: "ICN", ITM: "HND", UKB: "KIX",
  ICN: "HND", TPE: "HKG", HKG: "TPE", SIN: "HKG", BKK: "HKG",
  IST: "AMS", DOH: "IST", DXB: "IST",
  LHR: "AMS", CDG: "AMS", AMS: "CDG", FRA: "AMS", LIS: "CDG", OPO: "LIS",
};

const CARRIER_POOL = ["AC", "NH", "OZ", "KE", "CI", "CX", "SQ", "TG", "TK", "QR", "EK", "BA", "AF", "KL", "LH", "TP"];

// --- Seeded PRNG: FNV-1a string hash -> mulberry32 ---

function fnv1a(material: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

class Rng {
  private state: number;

  constructor(material: string) {
    this.state = fnv1a(material);
  }

  random(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.random();
  }

  randint(lo: number, hi: number): number {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  choice<T>(arr: T[]): T {
    return arr[Math.floor(this.random() * arr.length)];
  }
}

function legDurationMin(from: string, to: string): number {
  const km = estimateDistanceKm(from, to);
  return Math.round((km / 830) * 60) + 40;
}

function baseline(destination: string): number {
  return ROUTE_BASELINES.toronto?.[destination] ?? 1100;
}

function seasonalFactor(dateIso: string): number {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((d.getTime() - start) / 86_400_000);
  return 1.0 + 0.12 * Math.sin((2 * Math.PI * dayOfYear) / 365);
}

function weekdayFactor(dateIso: string): number {
  // getUTCDay: Sun=0..Sat=6 -> cheaper mid-week, pricier Fri/Sun.
  return [1.08, 1.0, 0.95, 0.94, 0.97, 1.08, 1.02][new Date(`${dateIso}T00:00:00Z`).getUTCDay()];
}

function tripLengthFactor(nights: number): number {
  if (nights < 7) return 1.15;
  if (nights > 21) return 1.1;
  return 1.0;
}

function priceFor(query: FareQuery, rng: Rng, isOnestop: boolean): number {
  const nights = Math.round((Date.parse(query.returnDate) - Date.parse(query.departDate)) / 86_400_000);
  let price =
    baseline(query.destination) *
    (ORIGIN_FACTOR[query.origin] ?? 1.0) *
    seasonalFactor(query.departDate) *
    weekdayFactor(query.departDate) *
    // One-way has no nights-based pricing; ~60% of the round-trip level.
    (query.tripType === "one_way" ? 0.6 : tripLengthFactor(nights));
  if (isOnestop) price *= rng.uniform(0.85, 0.94);
  if (rng.random() < 0.07) price *= 0.74; // planted deal
  price *= rng.uniform(0.93, 1.08);
  price *= query.adults;
  return Math.round(price * 100) / 100;
}

function isoAt(dateIso: string, hour: number, minuteOffset = 0): string {
  const t = new Date(`${dateIso}T00:00:00Z`);
  t.setUTCMinutes(hour * 60 + minuteOffset);
  return t.toISOString().slice(0, 16);
}

function makeLegs(
  query: Pick<FareQuery, "origin" | "destination" | "departDate">,
  rng: Rng,
  hub: string | null,
): { legs: FareLeg[]; layovers: [string, number][] } {
  const depHour = rng.randint(6, 22);
  const carrier = rng.choice(CARRIER_POOL);

  if (hub === null) {
    const duration = legDurationMin(query.origin, query.destination);
    return {
      legs: [
        {
          from_iata: query.origin,
          to_iata: query.destination,
          dep_time: isoAt(query.departDate, depHour),
          arr_time: isoAt(query.departDate, depHour, duration),
          carrier,
          flight_number: `${carrier}${rng.randint(100, 999)}`,
          duration_min: duration,
        },
      ],
      layovers: [],
    };
  }

  const leg1Min = legDurationMin(query.origin, hub);
  const layoverMin = rng.randint(70, 260);
  const leg2Min = legDurationMin(hub, query.destination);
  const carrier2 = rng.choice(CARRIER_POOL);
  return {
    legs: [
      {
        from_iata: query.origin,
        to_iata: hub,
        dep_time: isoAt(query.departDate, depHour),
        arr_time: isoAt(query.departDate, depHour, leg1Min),
        carrier,
        flight_number: `${carrier}${rng.randint(100, 999)}`,
        duration_min: leg1Min,
      },
      {
        from_iata: hub,
        to_iata: query.destination,
        dep_time: isoAt(query.departDate, depHour, leg1Min + layoverMin),
        arr_time: isoAt(query.departDate, depHour, leg1Min + layoverMin + leg2Min),
        carrier: carrier2,
        flight_number: `${carrier2}${rng.randint(100, 999)}`,
        duration_min: leg2Min,
      },
    ],
    layovers: [[hub, layoverMin]],
  };
}

function makeOption(query: FareQuery, rng: Rng, hub: string | null, price: number): FareOption {
  const { legs, layovers } = makeLegs(query, rng, hub);
  const total = legs.reduce((s, l) => s + l.duration_min, 0) + layovers.reduce((s, [, m]) => s + m, 0);
  return {
    price,
    currency: query.currency,
    outbound_legs: legs,
    layovers,
    total_duration_min: total,
    stops: layovers.length,
    carriers: [...new Set(legs.map((l) => l.carrier))],
    inbound_detail: "full",
    slices: [],
  };
}

function searchDeterministic(query: FareQuery): FareOption[] {
  const rng = new Rng(
    `${query.origin}|${query.destination}|${query.departDate}|${query.returnDate}|${query.currency}|${query.tripType}`,
  );
  const options: FareOption[] = [];

  options.push(makeOption(query, rng, null, priceFor(query, rng, false)));

  const hub = CONNECTING_HUB[query.destination];
  if (hub && hub !== query.origin) {
    options.push(makeOption(query, rng, hub, priceFor(query, rng, true)));
  }
  if (rng.random() < 0.5) {
    options.push(makeOption(query, rng, null, priceFor(query, rng, false)));
  }
  if (hub && rng.random() < 0.4) {
    options.push(makeOption(query, rng, hub, priceFor(query, rng, true)));
  }

  const filtered = query.maxStops === null ? options : options.filter((o) => o.stops <= query.maxStops!);
  filtered.sort((a, b) => a.price - b.price);
  return filtered;
}

export const mockProvider: EngineProvider = {
  name: "mock",

  async searchRoundTrip(query) {
    return searchDeterministic(query);
  },

  async searchOneWay(query) {
    return searchDeterministic(query);
  },

  async searchMultiCity(legs, opts) {
    // One deterministic option: each requested leg becomes a slice
    // (nonstop or one-stop via the hub table), priced like a one-way and
    // summed. Inter-slice gaps never appear in layovers -- matching the
    // real provider's semantics (see serpapi.ts buildMultiCityOption).
    const slices: FareSlice[] = [];
    let price = 0;
    for (const leg of legs) {
      const query: FareQuery = {
        origin: leg.origin,
        destination: leg.destination,
        departDate: leg.date,
        returnDate: leg.date,
        adults: opts.adults,
        currency: opts.currency,
        maxStops: opts.maxStops,
        tripType: "one_way",
      };
      const rng = new Rng(`mc|${leg.origin}|${leg.destination}|${leg.date}|${opts.currency}`);
      const hub = rng.random() < 0.4 ? (CONNECTING_HUB[leg.destination] ?? null) : null;
      const usableHub = hub && hub !== leg.origin ? hub : null;
      const { legs: sliceLegs, layovers } = makeLegs(query, rng, usableHub);
      const duration = sliceLegs.reduce((s, l) => s + l.duration_min, 0) + layovers.reduce((s, [, m]) => s + m, 0);
      const slice: FareSlice = { legs: sliceLegs, layovers, stops: sliceLegs.length - 1, duration_min: duration };
      if (opts.maxStops !== null && slice.stops > opts.maxStops) return [];
      slices.push(slice);
      price += priceFor(query, rng, usableHub !== null);
    }
    const allLegs = slices.flatMap((sl) => sl.legs);
    return [
      {
        price: Math.round(price * 100) / 100,
        currency: opts.currency,
        outbound_legs: allLegs,
        layovers: slices.flatMap((sl) => sl.layovers),
        total_duration_min: slices.reduce((s, sl) => s + sl.duration_min, 0),
        stops: slices.reduce((s, sl) => s + sl.stops, 0),
        carriers: [...new Set(allLegs.map((l) => l.carrier))],
        inbound_detail: "full",
        slices,
      },
    ];
  },
};
