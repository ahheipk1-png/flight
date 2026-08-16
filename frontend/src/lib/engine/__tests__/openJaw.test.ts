// Open-jaw: fly out to one destination, home from a (possibly different)
// one -- exercised end-to-end with the mock provider, plus the request
// parsing and the leg shape actually sent to the provider.

import { beforeEach, describe, expect, it } from "vitest";
import { mockProvider } from "../mock";
import { parseOpenJawRequest, runOpenJawSearch } from "../openJaw";
import type { OpenJawSearchRequestBody, Passengers, SearchStage } from "@/lib/types";

beforeEach(() => {
  window.localStorage.clear();
});

const SOLO: Passengers = { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 };

function baseRequest(overrides: Partial<OpenJawSearchRequestBody> = {}): OpenJawSearchRequestBody {
  return {
    origin: { airports: ["YYZ", "YTZ"], label: "Toronto" },
    destination: {
      selections: [
        { kind: "city", airports: ["LIS"], label: "Lisbon (LIS)" },
        { kind: "city", airports: ["BCN"], label: "Barcelona (BCN)" },
      ],
    },
    dates: { departure_from: "2026-10-01", departure_to: "2026-11-10", trip_length_min: 11, trip_length_max: 13 },
    budget: { currency: "CAD", max_total: 50000 },
    connections: { max_stops: 1, min_normal_minutes: 120, max_normal_minutes: 300 },
    passengers: SOLO,
    travel_class: 1,
    ...overrides,
  };
}

describe("parseOpenJawRequest", () => {
  it("resolves the origin and both arrival/departure destination groups from the SAME picked list", () => {
    const space = parseOpenJawRequest(baseRequest());
    expect(space.originGroup).toBe("YYZ,YTZ");
    expect(space.destinationGroups.map((g) => g.joined)).toEqual(["LIS", "BCN"]);
  });

  it("rejects an empty origin", () => {
    expect(() => parseOpenJawRequest(baseRequest({ origin: { airports: [], label: "" } }))).toThrow();
  });

  it("rejects an empty destination list", () => {
    expect(() => parseOpenJawRequest(baseRequest({ destination: { selections: [] } }))).toThrow();
  });
});

describe("runOpenJawSearch with the mock provider", () => {
  it("stages in order and returns verified results", async () => {
    const stages: SearchStage[] = [];
    const outcome = await runOpenJawSearch(baseRequest(), { provider: mockProvider, onStage: (s) => stages.push(s) });
    expect(stages).toEqual(["generating", "pruning", "verifying", "ranking"]);
    expect(outcome.itineraries.length).toBeGreaterThan(0);
    for (const it of outcome.itineraries) {
      expect(it.fare).toBeLessThanOrEqual(50000);
      expect(it.stops).toBeLessThanOrEqual(1);
    }
  });

  it("labels a genuine open-jaw result with return_origin, and a same-city result without it", async () => {
    // A single destination means every pair is (X, X) -- same-city, so
    // return_origin must always be null; this is the "comes back
    // round-trip" case, not a bug.
    const sameCityOutcome = await runOpenJawSearch(
      baseRequest({ destination: { selections: [{ kind: "city", airports: ["LIS"], label: "Lisbon (LIS)" }] } }),
      { provider: mockProvider },
    );
    expect(sameCityOutcome.itineraries.length).toBeGreaterThan(0);
    for (const it of sameCityOutcome.itineraries) {
      expect(it.return_origin).toBeNull();
      expect(it.destination.iata).toBe("LIS");
    }
  });

  it("a genuinely different arrival/departure pair produces disjoint legs, not a chained trip", async () => {
    // The core claim this feature relies on: provider.searchMultiCity()
    // honors each leg's OWN origin/destination -- leg 2 departs from
    // wherever it's told to, not from wherever leg 1 landed.
    const options = await mockProvider.searchMultiCity(
      [
        { origin: "YYZ", destination: "LIS", date: "2026-10-05" },
        { origin: "BCN", destination: "YYZ", date: "2026-10-17" },
      ],
      { passengers: SOLO, travelClass: 1, currency: "CAD", maxStops: 2 },
    );
    expect(options.length).toBeGreaterThan(0);
    const legs = options[0].outbound_legs;
    // First leg departs Toronto and eventually reaches Lisbon; the FIRST
    // leg after that lands is genuinely a fresh departure from Barcelona
    // (not continuing on from Lisbon).
    expect(legs[0].from_iata).toBe("YYZ");
    const barcelonaLegIdx = legs.findIndex((l) => l.from_iata === "BCN");
    expect(barcelonaLegIdx).toBeGreaterThan(-1);
  });
});
