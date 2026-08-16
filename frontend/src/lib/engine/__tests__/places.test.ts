// Global city/country search over data/seed/airports_world.json.

import { describe, expect, it } from "vitest";
import { expandCountry, getAirportDetail, joinAirports, searchPlaces, type PlaceCity, type PlaceCountry } from "../places";

function cities(results: Awaited<ReturnType<typeof searchPlaces>>): PlaceCity[] {
  return results.filter((r): r is PlaceCity => r.kind === "city");
}
function countries(results: Awaited<ReturnType<typeof searchPlaces>>): PlaceCountry[] {
  return results.filter((r): r is PlaceCountry => r.kind === "country");
}

describe("searchPlaces", () => {
  it("finds a well-known city and groups its airports together", async () => {
    const toronto = cities(await searchPlaces("toronto")).find((c) => c.city === "Toronto");
    expect(toronto).toBeDefined();
    expect(toronto!.airports).toEqual(expect.arrayContaining(["YYZ"]));
  });

  it("matches a bare IATA code", async () => {
    const results = cities(await searchPlaces("HKG"));
    expect(results.some((c) => c.airports.includes("HKG"))).toBe(true);
  });

  it("ranks exact/prefix matches before substring matches", async () => {
    const results = await searchPlaces("london");
    const first = results[0];
    const name = first.kind === "city" ? first.city : first.name;
    expect(name.toLowerCase().startsWith("london")).toBe(true);
  });

  it("returns nothing for an empty query", async () => {
    expect(await searchPlaces("")).toEqual([]);
    expect(await searchPlaces("   ")).toEqual([]);
  });

  it("surfaces a matching country alongside cities", async () => {
    const results = countries(await searchPlaces("japan"));
    expect(results.some((c) => c.code === "JP")).toBe(true);
  });

  it("ranks an exact country match ahead of unrelated substring city matches", async () => {
    const results = await searchPlaces("japan");
    expect(results[0].kind).toBe("country");
  });
});

describe("expandCountry", () => {
  it("expands to one PlaceSelection per city, never one giant joined group", async () => {
    const results = countries(await searchPlaces("japan"));
    const japan = results.find((c) => c.code === "JP")!;
    const selections = expandCountry(japan);
    expect(selections.length).toBe(japan.cities.length);
    expect(selections.length).toBeGreaterThan(1);
    // Every selection is its own small group -- not one selection
    // holding every airport in the country.
    for (const s of selections) {
      expect(s.airports.length).toBeLessThan(10);
    }
    // A well-known city is genuinely present, not truncated away.
    expect(selections.some((s) => s.label.startsWith("Tokyo"))).toBe(true);
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
