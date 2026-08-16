// Behavior pins for the engine's pure stages + full mock-provider runs.

import { beforeEach, describe, expect, it } from "vitest";
import { estimate } from "../indicative";
import { mockProvider } from "../mock";
import { addObservations } from "../observations";
import { parseRequest, runFlexibleSearch, runMultiCitySearch } from "../pipeline";
import { pruneAndExpand } from "../pruning";
import { rank } from "../ranking";
import type { Candidate, FareOption, SearchSpace } from "../types";
import { cacheKey, passesHardConstraints } from "../verification";
import type { Passengers, SearchRequestBody, SearchStage } from "@/lib/types";

beforeEach(() => {
  window.localStorage.clear();
});

const SOLO: Passengers = { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 };

function baseRequest(overrides: Partial<SearchRequestBody> = {}): SearchRequestBody {
  return {
    origin: { airports: ["YYZ", "YTZ", "YHM", "YKF"], label: "Toronto" },
    destination: { selections: [{ kind: "region", code: "japan", label: "Japan" }] },
    dates: { departure_from: "2026-09-01", departure_to: "2026-09-20", trip_length_min: 7, trip_length_max: 10 },
    budget: { currency: "CAD", max_total: 50000 },
    connections: { max_stops: 1, min_normal_minutes: 120, max_normal_minutes: 300 },
    passengers: SOLO,
    travel_class: 1,
    trip_type: "round_trip",
    ...overrides,
  };
}

function bareOption(overrides: Partial<FareOption> = {}): FareOption {
  return {
    price: 1000,
    currency: "CAD",
    outbound_legs: [],
    layovers: [],
    total_duration_min: 600,
    stops: 0,
    carriers: ["AC"],
    inbound_detail: "full",
    slices: [],
    ...overrides,
  };
}

describe("indicative estimate", () => {
  it("uses a fresh exact observation (tier 1)", () => {
    addObservations([
      {
        origin: "YYZ,YTZ,YHM,YKF",
        destination: "KIX",
        departure_date: "2026-09-18",
        return_date: "2026-10-02",
        trip_type: "round_trip",
        fare: 987,
        observed_at: Date.now(),
        party_key: "1-0-0-0",
      },
    ]);
    const [price, source] = estimate("YYZ,YTZ,YHM,YKF", "KIX", "2026-09-18", "2026-10-02", "round_trip", SOLO);
    expect(price).toBe(987);
    expect(source).toBe("observation_exact");
  });

  it("returns no signal (never a guess) when this user has no matching history", () => {
    const [price, source] = estimate("YYZ", "KIX", "2026-09-18", "2026-09-18", "one_way", SOLO);
    expect(price).toBeNull();
    expect(source).toBeNull();
  });

  it("never lets a one-way observation answer a round-trip query (or vice versa)", () => {
    addObservations([
      {
        origin: "YYZ",
        destination: "KIX",
        departure_date: "2026-09-18",
        return_date: "2026-09-18",
        trip_type: "one_way",
        fare: 500,
        observed_at: Date.now(),
        party_key: "1-0-0-0",
      },
    ]);
    const [rtPrice] = estimate("YYZ", "KIX", "2026-09-18", "2026-09-18", "round_trip", SOLO);
    expect(rtPrice).toBeNull();

    const [owPrice, owSource] = estimate("YYZ", "KIX", "2026-09-18", "2026-09-18", "one_way", SOLO);
    expect(owSource).toBe("observation_exact");
    expect(owPrice).toBe(500);
  });

  it("never lets a 2-adult observation answer a solo-adult query (or vice versa)", () => {
    addObservations([
      {
        origin: "YYZ",
        destination: "KIX",
        departure_date: "2026-09-18",
        return_date: "2026-09-18",
        trip_type: "one_way",
        fare: 2000,
        observed_at: Date.now(),
        party_key: "2-0-0-0",
      },
    ]);
    const [soloPrice] = estimate("YYZ", "KIX", "2026-09-18", "2026-09-18", "one_way", SOLO);
    expect(soloPrice).toBeNull();

    const [pairPrice] = estimate("YYZ", "KIX", "2026-09-18", "2026-09-18", "one_way", {
      adults: 2,
      children: 0,
      infants_in_seat: 0,
      infants_on_lap: 0,
    });
    expect(pairPrice).toBe(2000);
  });

  it("weights nearby-date observations (tier 2)", () => {
    addObservations([
      {
        origin: "YYZ",
        destination: "KIX",
        departure_date: "2026-09-16",
        return_date: "2026-09-30",
        trip_type: "round_trip",
        fare: 900,
        observed_at: Date.now(),
        party_key: "1-0-0-0",
      },
    ]);
    const [price, source] = estimate("YYZ", "KIX", "2026-09-18", "2026-10-02", "round_trip", SOLO);
    expect(source).toBe("observation_nearest");
    expect(price).toBe(900); // single candidate -> its own fare, flatly projected
  });
});

describe("cache key", () => {
  it("separates one-way from round-trip for identical dates", () => {
    const base = {
      origin: "YYZ",
      destination: "KIX",
      departDate: "2026-09-18",
      returnDate: "2026-09-18",
      passengers: SOLO,
      travelClass: 1 as const,
      currency: "CAD",
      maxStops: 1,
    };
    const rt = cacheKey("serpapi", { ...base, tripType: "round_trip" });
    const ow = cacheKey("serpapi", { ...base, tripType: "one_way" });
    expect(rt).not.toBe(ow);
  });

  it("separates different party sizes for the same route/dates", () => {
    const base = {
      origin: "YYZ",
      destination: "KIX",
      departDate: "2026-09-18",
      returnDate: "2026-09-18",
      travelClass: 1 as const,
      currency: "CAD",
      maxStops: 1,
      tripType: "one_way" as const,
    };
    const solo = cacheKey("serpapi", { ...base, passengers: SOLO });
    const pair = cacheKey("serpapi", { ...base, passengers: { adults: 2, children: 0, infants_in_seat: 0, infants_on_lap: 0 } });
    expect(solo).not.toBe(pair);
  });
});

function constraintSpace(overrides: Partial<SearchSpace> = {}): SearchSpace {
  return {
    ...parseRequest(baseRequest()),
    ...overrides,
  };
}

describe("hard constraints", () => {
  it("rejects an over-long SAME-FLIGHT layover", () => {
    const option = bareOption({ stops: 1, layovers: [["ICN", 2880]] });
    expect(passesHardConstraints(option, constraintSpace())).toBe(false);
  });

  it("accepts a multi-day gap BETWEEN multi-city slices (it is not a layover)", () => {
    const option = bareOption({
      stops: 0,
      layovers: [],
      slices: [
        { legs: [], layovers: [], stops: 0, duration_min: 300 },
        { legs: [], layovers: [], stops: 0, duration_min: 400 },
      ],
    });
    expect(passesHardConstraints(option, constraintSpace())).toBe(true);
  });

  it("still validates connections INSIDE a slice", () => {
    const option = bareOption({
      slices: [{ legs: [], layovers: [["FRA", 400]], stops: 1, duration_min: 700 }],
    });
    expect(passesHardConstraints(option, constraintSpace())).toBe(false);
  });

  it("enforces the budget as a PARTY TOTAL, not per person", () => {
    // Regression: budget is entered as one number for the whole trip
    // (the wizard's Budget step / form.budget.maxTotal), and SerpApi's
    // price is always the party total -- a $2,400 budget for 2 adults
    // (~$1,200/person, entirely reasonable) must NOT be silently rejected
    // by treating $2,400 as if it were a per-person ceiling.
    const twoAdults = { adults: 2, children: 0, infants_in_seat: 0, infants_on_lap: 0 };
    const space = constraintSpace({ maxTotal: 2400, passengers: twoAdults });
    const reasonableFareForTwo = bareOption({ price: 2200 }); // ~$1,100/person
    expect(passesHardConstraints(reasonableFareForTwo, space)).toBe(true);

    const trulyOverBudget = bareOption({ price: 99999 });
    expect(passesHardConstraints(trulyOverBudget, space)).toBe(false);
  });
});

describe("parseRequest", () => {
  it("joins the picked origin airports and resolves region destinations", () => {
    const space = parseRequest(baseRequest());
    expect(space.originGroup).toBe("YYZ,YTZ,YHM,YKF");
    expect(space.originLabel).toBe("Toronto");
    expect(space.destinationGroups).toHaveLength(1);
    expect(space.destinationGroups[0].joined.split(",")).toContain("HND");
  });

  it("resolves a picked city destination without touching the curated region list", () => {
    const space = parseRequest(
      baseRequest({ destination: { selections: [{ kind: "city", airports: ["JFK", "LGA"], label: "New York" }] } }),
    );
    expect(space.destinationGroups).toEqual([{ key: "city:JFK,LGA", joined: "JFK,LGA", label: "New York" }]);
  });

  it("rejects an empty origin", () => {
    expect(() => parseRequest(baseRequest({ origin: { airports: [], label: "" } }))).toThrow();
  });
});

describe("pruning", () => {
  it("falls back to the full list when the budget ceiling excludes every priced candidate", () => {
    const space = constraintSpace({ maxTotal: 1 }); // ceiling excludes anything with a real price signal
    const dest = { key: "city:XXX", joined: "XXX", label: "Nowhere" };
    // A real observation at the exact seed date so the EXPAND phase (which
    // re-estimates every date fresh, not just the coarse cell) actually
    // has a live price signal to exclude via the ceiling.
    addObservations([
      {
        origin: space.originGroup,
        destination: "XXX",
        departure_date: "2026-09-05",
        return_date: "2026-09-13",
        trip_type: "round_trip",
        fare: 1400,
        observed_at: Date.now(),
        party_key: "1-0-0-0",
      },
    ]);
    const coarse: Candidate[] = [
      { destination: dest, departDate: "2026-09-05", tripLength: 8, estimatedPrice: 1400, estimateSource: "observation_exact" },
    ];
    const candidates = pruneAndExpand(space, coarse);
    expect(candidates.length).toBeGreaterThan(0); // fallback, not empty
  });

  it("never fabricates a price for a signal-less candidate", () => {
    const space = constraintSpace();
    const dest = { key: "city:XXX", joined: "XXX", label: "Nowhere" };
    const coarse: Candidate[] = [{ destination: dest, departDate: "2026-09-05", tripLength: 8, estimatedPrice: null, estimateSource: null }];
    const candidates = pruneAndExpand(space, coarse);
    expect(candidates.every((c) => c.estimatedPrice === null)).toBe(true);
  });
});

describe("ranking", () => {
  it("orders by best score and flags below-typical fares", () => {
    const space = constraintSpace();
    const dest = { key: "region:japan", joined: "HND", label: "Japan" };
    const cheap = {
      destination: dest,
      departDate: "2026-09-10",
      returnDate: "2026-09-17",
      tripLength: 7,
      option: bareOption({ price: 500, total_duration_min: 600 }),
      verified: true,
    };
    const pricey = { ...cheap, option: bareOption({ price: 1500, total_duration_min: 600 }) };
    const ranked = rank(space, [pricey, cheap]);
    expect(ranked[0].verifiedItinerary.option.price).toBe(500); // cheapest scores best
    const cheapRanked = ranked.find((r) => r.verifiedItinerary.option.price === 500)!;
    const priceyRanked = ranked.find((r) => r.verifiedItinerary.option.price === 1500)!;
    expect(cheapRanked.explanations.some((e) => e.key === "results.expl.belowTypical")).toBe(true);
    expect(priceyRanked.explanations.some((e) => e.key === "results.expl.belowTypical")).toBe(false);
  });
});

describe("end-to-end with the mock provider", () => {
  it("round trip: stages in order, constraints respected", async () => {
    const stages: SearchStage[] = [];
    const outcome = await runFlexibleSearch(baseRequest(), {
      provider: mockProvider,
      onStage: (s) => stages.push(s),
    });
    expect(stages).toEqual(["generating", "pruning", "verifying", "ranking"]);
    expect(outcome.itineraries.length).toBeGreaterThan(0);
    for (const it of outcome.itineraries) {
      expect(it.stops).toBeLessThanOrEqual(1);
      expect(it.fare).toBeLessThanOrEqual(50000);
      for (const [, minutes] of it.layovers) {
        expect(minutes).toBeGreaterThanOrEqual(120);
        expect(minutes).toBeLessThanOrEqual(300);
      }
      expect(it.city_stops).toBeNull();
    }
    expect(outcome.itineraries[0].id).toBe("it-0");
    expect(outcome.degraded).toBe(false);
  });

  it("one-way: single-date sentinel produces returnDate === departDate", async () => {
    const outcome = await runFlexibleSearch(
      baseRequest({
        trip_type: "one_way",
        dates: { departure_from: "2026-09-01", departure_to: "2026-09-20", trip_length_min: 0, trip_length_max: 0 },
      }),
      { provider: mockProvider },
    );
    expect(outcome.itineraries.length).toBeGreaterThan(0);
    for (const it of outcome.itineraries) {
      expect(it.return_date).toBe(it.depart_date);
      expect(it.trip_length).toBe(0);
    }
  });

  it("2 adults: still returns results (regression -- used to be silently filtered to zero)", async () => {
    const outcome = await runFlexibleSearch(
      baseRequest({
        budget: { currency: "CAD", max_total: 3000 },
        passengers: { adults: 2, children: 0, infants_in_seat: 0, infants_on_lap: 0 },
      }),
      { provider: mockProvider },
    );
    expect(outcome.itineraries.length).toBeGreaterThan(0);
  });

  it("multi-city: skips to verifying, sets city_stops, honors the picked origin", async () => {
    const stages: SearchStage[] = [];
    const outcome = await runMultiCitySearch(
      {
        origin: { airports: ["YYZ"], label: "Toronto" },
        legs: [
          { destination: { airports: ["IST"], label: "Istanbul" }, date: "2026-09-10" },
          { destination: { airports: ["BKK"], label: "Bangkok" }, date: "2026-09-15" },
        ],
        budget: { currency: "CAD", max_total: 50000 },
        connections: { max_stops: 1, min_normal_minutes: 120, max_normal_minutes: 300 },
        passengers: SOLO,
        travel_class: 1,
      },
      { provider: mockProvider, onStage: (s) => stages.push(s) },
    );
    expect(stages).toEqual(["verifying", "ranking"]);
    // The mock is deterministic: this exact leg list always yields a
    // result that passes the default constraints (a strict assertion so
    // the checks below can never be silently skipped).
    expect(outcome.itineraries.length).toBeGreaterThan(0);
    const it = outcome.itineraries[0];
    expect(it.id).toBe("mc-0");
    expect(it.city_stops?.map((a) => a.iata)).toEqual(["IST"]);
    expect(it.origin.iata).toBe("YYZ");
    expect(it.destination.iata).toBe("BKK");
  });

  it("multi-city with a multi-airport origin still flies from one of the picked airports", async () => {
    const outcome = await runMultiCitySearch(
      {
        origin: { airports: ["YYZ", "YTZ"], label: "Toronto" },
        legs: [{ destination: { airports: ["IST"], label: "Istanbul" }, date: "2026-09-10" }],
        budget: { currency: "CAD", max_total: 50000 },
        connections: { max_stops: 1, min_normal_minutes: 120, max_normal_minutes: 300 },
        passengers: SOLO,
        travel_class: 1,
      },
      { provider: mockProvider },
    );
    expect(outcome.itineraries.length).toBeGreaterThan(0);
    expect(["YYZ", "YTZ"]).toContain(outcome.itineraries[0].origin.iata);
  });
});
