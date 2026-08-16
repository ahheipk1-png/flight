// Global city search over data/seed/airports_world.json.

import { describe, expect, it } from "vitest";
import { getAirportDetail, joinAirports, searchPlaces } from "../places";

describe("searchPlaces", () => {
  it("finds a well-known city and groups its airports together", async () => {
    const results = await searchPlaces("toronto");
    const toronto = results.find((c) => c.city === "Toronto");
    expect(toronto).toBeDefined();
    expect(toronto!.airports).toEqual(expect.arrayContaining(["YYZ"]));
  });

  it("matches a bare IATA code", async () => {
    const results = await searchPlaces("HKG");
    expect(results.some((c) => c.airports.includes("HKG"))).toBe(true);
  });

  it("ranks exact/prefix matches before substring matches", async () => {
    const results = await searchPlaces("london");
    expect(results[0].city.toLowerCase().startsWith("london")).toBe(true);
  });

  it("returns nothing for an empty query", async () => {
    expect(await searchPlaces("")).toEqual([]);
    expect(await searchPlaces("   ")).toEqual([]);
  });
});

describe("getAirportDetail", () => {
  it("resolves a specific airport's name/city/coordinates after a search has warmed the cache", async () => {
    await searchPlaces("tokyo");
    const hnd = getAirportDetail("HND");
    expect(hnd?.city).toBeTruthy();
    expect(typeof hnd?.lat).toBe("number");
  });
});

describe("joinAirports", () => {
  it("comma-joins in the given order", () => {
    expect(joinAirports(["YYZ", "YTZ", "YHM"])).toBe("YYZ,YTZ,YHM");
  });
});
