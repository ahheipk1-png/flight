// Wraps whichever mapping library is actually mounted (spec §5) so the
// rest of the app never talks to MapLibre (or a future Google Maps swap)
// directly. See MapLibreProvider.ts for the current implementation.

import type { LatLon } from "./geo";

export type MarkerRole = "origin" | "alternate-origin" | "connection" | "destination";

export interface MapMarker {
  id: string;
  position: LatLon;
  role: MarkerRole;
  label: string;
  popupHtml?: string;
}

export interface MapProvider {
  mount(container: HTMLElement): void;
  addAirportMarker(marker: MapMarker): void;
  /** Present per spec §5's interface even though MVP 1 has no stopovers
   * yet -- keeps the later stopover-discovery phase from needing a new
   * provider method. */
  addStopoverMarker(marker: MapMarker): void;
  drawFlightLeg(id: string, from: LatLon, to: LatLon): void;
  drawGroundLeg(id: string, from: LatLon, to: LatLon): void;
  /** Fits the viewport to everything currently on the map. */
  fitItinerary(): void;
  /** Removes all markers/legs added since mount(), keeping the map
   * instance itself alive (spec §5: never reload the map per card). */
  clearItinerary(): void;
  destroy(): void;
}
