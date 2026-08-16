// Confirms the request params actually sent to the Worker: comma-joined
// airport groups (so SerpApi compares every airport itself in one call)
// and the full passenger/cabin breakdown -- not just a bare adults count.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSerpApiProvider } from "../serpapi";
import type { FareQuery } from "../types";

const QUERY: FareQuery = {
  origin: "YYZ,YTZ,YHM",
  destination: "HND,NRT",
  departDate: "2026-09-18",
  returnDate: "2026-10-02",
  passengers: { adults: 2, children: 1, infants_in_seat: 0, infants_on_lap: 1 },
  travelClass: 3,
  currency: "CAD",
  maxStops: 1,
  tripType: "round_trip",
};

function paramsSentTo(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0];
  return JSON.parse(init.body).params;
}

describe("serpapi request params", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ best_flights: [], other_flights: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("comma-joins the origin and destination airport groups", async () => {
    const provider = buildSerpApiProvider("token");
    await provider.searchRoundTrip(QUERY);
    const params = paramsSentTo(fetchMock);
    expect(params.departure_id).toBe("YYZ,YTZ,YHM");
    expect(params.arrival_id).toBe("HND,NRT");
  });

  it("sends every price-affecting passenger field, not just adults", async () => {
    const provider = buildSerpApiProvider("token");
    await provider.searchRoundTrip(QUERY);
    const params = paramsSentTo(fetchMock);
    expect(params.adults).toBe(2);
    expect(params.children).toBe(1);
    expect(params.infants_in_seat).toBe(0);
    expect(params.infants_on_lap).toBe(1);
    expect(params.travel_class).toBe(3);
  });

  it("carries the same passenger fields on a one-way search", async () => {
    const provider = buildSerpApiProvider("token");
    await provider.searchOneWay(QUERY);
    const params = paramsSentTo(fetchMock);
    expect(params.adults).toBe(2);
    expect(params.travel_class).toBe(3);
    expect(params.type).toBe("2");
  });

  it("carries the same passenger fields on a multi-city search", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ best_flights: [{ flights: [{ departure_airport: { id: "YYZ" }, arrival_airport: { id: "IST" } }], price: 500 }] }),
    });
    const provider = buildSerpApiProvider("token");
    await provider.searchMultiCity(
      [{ origin: "YYZ,YTZ", destination: "IST", date: "2026-09-10" }],
      { passengers: QUERY.passengers, travelClass: QUERY.travelClass, currency: "CAD", maxStops: 1 },
    );
    const params = paramsSentTo(fetchMock);
    expect(params.children).toBe(1);
    expect(params.travel_class).toBe(3);
  });
});
