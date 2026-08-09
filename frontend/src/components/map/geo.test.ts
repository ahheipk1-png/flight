import { describe, expect, it } from "vitest";
import { greatCircleLine } from "./geo";

const YYZ = { lat: 43.6777, lon: -79.6248 };
const LHR = { lat: 51.47, lon: -0.4543 };
const TPE = { lat: 25.0777, lon: 121.2328 };

describe("greatCircleLine", () => {
  it("returns numPoints + 1 points", () => {
    const line = greatCircleLine(YYZ, LHR, 64);
    expect(line).toHaveLength(65);
  });

  it("starts and ends at the input coordinates", () => {
    const line = greatCircleLine(YYZ, LHR, 32);
    expect(line[0][1]).toBeCloseTo(YYZ.lat, 4);
    expect(line[0][0]).toBeCloseTo(YYZ.lon, 4);
    expect(line.at(-1)![1]).toBeCloseTo(LHR.lat, 4);
    // The endpoint may be unwrapped (e.g. 360 added) -- compare modulo 360.
    expect(((line.at(-1)![0] % 360) + 360) % 360).toBeCloseTo(((LHR.lon % 360) + 360) % 360, 4);
  });

  it("handles identical endpoints without dividing by zero", () => {
    const line = greatCircleLine(YYZ, YYZ, 16);
    expect(line.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))).toBe(true);
  });

  it("never jumps more than 180 degrees of longitude between consecutive points", () => {
    // TPE -> YYZ's short path crosses the Pacific / antimeridian.
    for (const [a, b] of [
      [TPE, YYZ],
      [YYZ, TPE],
      [YYZ, LHR],
    ] as const) {
      const line = greatCircleLine(a, b, 64);
      for (let i = 1; i < line.length; i++) {
        const delta = Math.abs(line[i][0] - line[i - 1][0]);
        expect(delta).toBeLessThanOrEqual(180 + 1e-6);
      }
    }
  });

  it("unwraps the antimeridian-crossing TPE -> YYZ route instead of streaking", () => {
    const line = greatCircleLine(TPE, YYZ, 64);
    const lons = line.map(([lon]) => lon);
    // A route that truly crosses the antimeridian, once unwrapped, should
    // NOT contain both a value near +180 and a value near -180 -- that
    // pattern is exactly the un-unwrapped streak this function prevents.
    const hasNearPositive180 = lons.some((lon) => lon > 170);
    const hasNearNegative180 = lons.some((lon) => lon < -170);
    expect(hasNearPositive180 && hasNearNegative180).toBe(false);
  });

  it("does not unnecessarily alter a route that stays well within +-180", () => {
    const line = greatCircleLine(YYZ, LHR, 64);
    for (const [lon] of line) {
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }
  });
});
