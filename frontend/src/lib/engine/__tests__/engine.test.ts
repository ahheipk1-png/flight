// Behavior pins for the engine's pure stages + full mock-provider runs.
// These re-assert, in TS, the same behaviors the Python unit tests pin on
// the backend (tests/unit/test_{indicative,pruning,verification,...}.py).

import { beforeEach, describe, expect, it } from "vitest";
import { estimate } from "../indicative";
import { mockProvider } from "../mock";
import { addObservations } from "../observations";
import { parseRequest, runFlexibleSearch, runMultiCitySearch } from "../pipeline";
import { pruneAndExpand } from "../pruning";
import { rank } from "../ranking";
import { resolveEquivalence } from "../geo";
import type { Cell, FareOption, SearchSpace, VerifiedItinerary } from "../types";
import { cacheKey, passesHardConstraints } from "../verification";
import type { SearchRequestBody, SearchStage } from "@/lib/types";

beforeEach(() => {
  window.localStorage.clear();
});

function baseRequest(overrides: Partial<SearchRequestBody> = {}): SearchRequestBody {
  return {
    origin: { region: "greater_toronto", max_ground_minutes: 120, min_saving_per_person: 100 },
    destination: { regions: ["japan"] },
    dates: { departure_from: "2026-09-01", departure_to: "2026-09-20", trip_length_min: 7, trip_length_max: 10 },
    budget: { currency: "CAD", max_total: 50000 },
    connections: { max_stops: 1, min_normal_minutes: 120, max_normal_minutes: 300 },
    adults: 1,
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
        origin: "YYZ",
        destination: "KIX",
        departure_date: "2026-09-18",
        return_date: "2026-10-02",
        trip_type: "round_trip",
        fare: 987,
        observed_at: Date.now(),
      },
    ]);
    const [price, source] = estimate("YYZ", "KIX", "2026-09-18", "2026-10-02", "round_trip");
    expect(price).toBe(987);
    expect(source).toBe("observation_exact");
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
      },
    ]);
    const [rtPrice, rtSource] = estimate("YYZ", "KIX", "2026-09-18", "2026-09-18", "round_trip");
    expect(rtSource).toBe("baseline");
    expect(rtPrice).toBe(1400); // KIX baseline x YYZ factor 1.0

    const [owPrice, owSource] = estimate("YYZ", "KIX", "2026-09-18", "2026-09-18", "one_way");
    expect(owSource).toBe("observation_exact");
    expect(owPrice).toBe(500);
  });

  it("applies the one-way factor at the baseline tier", () => {
    const [owPrice] = estimate("YYZ", "KIX", "2026-09-18", "2026-09-18", "one_way");
    expect(owPrice).toBe(1400 * 0.6);
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
      },
    ]);
    const [price, source] = estimate("YYZ", "KIX", "2026-09-18", "2026-10-02", "round_trip");
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
      adults: 1,
      currency: "CAD",
      maxStops: 1,
    };
    const rt = cacheKey("serpapi", { ...base, tripType: "round_trip" });
    const ow = cacheKey("serpapi", { ...base, tripType: "one_way" });
    expect(rt).not.toBe(ow);
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
    // Two nonstop slices days apart: the gap appears nowhere in layovers,
    // so the connection-comfort window never sees it.
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

  it("enforces the budget", () => {
    const option = bareOption({ price: 99999 });
    expect(passesHardConstraints(option, constraintSpace({ maxTotal: 1200 }))).toBe(false);
  });
});

describe("origin group resolution", () => {
  it("drops BUF at the default 120-minute ground tolerance, keeps the rest", () => {
    const space = parseRequest(baseRequest());
    const iatas = space.originAirports.map((a) => a.iata);
    expect(space.primaryOrigin.iata).toBe("YYZ");
    expect(iatas).toContain("YTZ");
    expect(iatas).toContain("YHM");
    expect(iatas).toContain("YKF");
    expect(iatas).not.toContain("BUF");
  });

  it("max_ground_minutes 0 means same-airport only", () => {
    const space = parseRequest(baseRequest({ origin: { region: "greater_toronto", max_ground_minutes: 0, min_saving_per_person: 100 } }));
    expect(space.originAirports.map((a) => a.iata)).toEqual(["YYZ"]);
  });
});

describe("nearby-airport savings filter (rank)", () => {
  function itin(origin: string, price: number): VerifiedItinerary {
    return {
      origin,
      destination: "KIX",
      departDate: "2026-09-10",
      returnDate: "2026-09-17",
      tripLength: 7,
      option: bareOption({ price }),
      verified: true,
    };
  }

  it("keeps an alt origin only when net saving clears the threshold", () => {
    const space = constraintSpace();
    const equiv = resolveEquivalence("YYZ", "YHM")!;
    const groundRT = equiv.ground_cost_estimate * 2;

    // Just clears: primary 1000, alt priced so net saving == threshold.
    const altPriceKeep = 1000 - space.minSavingPerPerson - groundRT;
    const kept = rank(space, [itin("YYZ", 1000), itin("YHM", altPriceKeep)]);
    expect(kept.map((r) => r.verifiedItinerary.origin)).toContain("YHM");
    const yhm = kept.find((r) => r.verifiedItinerary.origin === "YHM")!;
    expect(yhm.groundTransfer?.net_saving).toBeCloseTo(space.minSavingPerPerson);

    // Just misses by a dollar.
    const missed = rank(space, [itin("YYZ", 1000), itin("YHM", altPriceKeep + 1)]);
    expect(missed.map((r) => r.verifiedItinerary.origin)).not.toContain("YHM");
  });

  it("drops an alt origin with no primary result to compare against", () => {
    const ranked = rank(constraintSpace(), [itin("YHM", 500)]);
    expect(ranked).toHaveLength(0);
  });
});

describe("pruning", () => {
  it("keeps whole groups and falls back when the budget ceiling excludes everything", () => {
    const space = constraintSpace({ maxTotal: 1 }); // ceiling excludes all
    const cells: Cell[] = [
      {
        origin: "YYZ",
        destination: "KIX",
        departDate: "2026-09-05",
        tripLength: 8,
        estimatedPrice: 1400,
        estimateSource: "baseline",
      },
    ];
    const groups = pruneAndExpand(space, cells);
    expect(groups.length).toBeGreaterThan(0); // fallback, not empty
    // Pairing invariant: every group carries every eligible origin.
    for (const g of groups) {
      expect(new Set(g.candidates.map((c) => c.origin)).size).toBe(space.originAirports.length);
    }
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

  it("multi-city: skips to verifying, sets city_stops", async () => {
    const stages: SearchStage[] = [];
    const outcome = await runMultiCitySearch(
      {
        legs: [
          { destination: "IST", date: "2026-09-10" },
          { destination: "BKK", date: "2026-09-15" },
        ],
        budget: { currency: "CAD", max_total: 50000 },
        connections: { max_stops: 1, min_normal_minutes: 120, max_normal_minutes: 300 },
        adults: 1,
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
});
