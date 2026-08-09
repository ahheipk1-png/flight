// Great-circle interpolation for drawing flight-leg arcs, plus
// antimeridian unwrapping so a route like TPE -> YYZ (whose short path
// crosses the 180 deg line over the Pacific) doesn't render as a line
// streaking across the entire map the "long way" around.

export interface LatLon {
  lat: number;
  lon: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Points as [lon, lat] pairs -- GeoJSON coordinate order. */
export type LonLat = [number, number];

function interpolateGreatCircle(from: LatLon, to: LatLon, numPoints: number): LonLat[] {
  const phi1 = toRad(from.lat);
  const lambda1 = toRad(from.lon);
  const phi2 = toRad(to.lat);
  const lambda2 = toRad(to.lon);

  const angularDistance =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((phi2 - phi1) / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin((lambda2 - lambda1) / 2) ** 2,
      ),
    );

  if (angularDistance === 0 || Number.isNaN(angularDistance)) {
    return [[from.lon, from.lat]];
  }

  const points: LonLat[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const a = Math.sin((1 - f) * angularDistance) / Math.sin(angularDistance);
    const b = Math.sin(f * angularDistance) / Math.sin(angularDistance);
    const x = a * Math.cos(phi1) * Math.cos(lambda1) + b * Math.cos(phi2) * Math.cos(lambda2);
    const y = a * Math.cos(phi1) * Math.sin(lambda1) + b * Math.cos(phi2) * Math.sin(lambda2);
    const z = a * Math.sin(phi1) + b * Math.sin(phi2);
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    const lon = toDeg(Math.atan2(y, x));
    points.push([lon, lat]);
  }
  return points;
}

/** Keeps consecutive longitudes within 180 deg of each other by adding/
 * subtracting 360 as needed, so a path crossing the antimeridian extends
 * smoothly past +-180 instead of jumping to the opposite sign.
 */
function unwrapAntimeridian(points: LonLat[]): LonLat[] {
  if (points.length === 0) return points;
  const result: LonLat[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    let lon = points[i][0];
    const lat = points[i][1];
    const prevLon = result[i - 1][0];
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    result.push([lon, lat]);
  }
  return result;
}

export function greatCircleLine(from: LatLon, to: LatLon, numPoints = 64): LonLat[] {
  return unwrapAntimeridian(interpolateGreatCircle(from, to, numPoints));
}
