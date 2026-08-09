// maplibre-gl v6 dropped its default export (the classic `import maplibregl
// from "maplibre-gl"` namespace object) -- everything is a named export now.
import {
  type GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { greatCircleLine, type LatLon } from "./geo";
import type { MapMarker, MapProvider, MarkerRole } from "./MapProvider";

const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const FLIGHT_LEGS_SOURCE = "smartflighter-flight-legs";
const GROUND_LEGS_SOURCE = "smartflighter-ground-legs";

// Under Turbopack's dev server, MapLibre's own worker-URL auto-resolution
// fails (the worker script request comes back as an HTML 404 instead of
// JS, so the worker never starts and no tiles ever load -- markers still
// render since they're plain DOM, which made this easy to miss visually).
// public/maplibre-gl-worker.mjs is a direct copy of
// node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs; re-copy it after
// any maplibre-gl version bump.
let workerUrlConfigured = false;
function ensureWorkerUrlConfigured(): void {
  if (workerUrlConfigured) return;
  setWorkerUrl("/maplibre-gl-worker.mjs");
  workerUrlConfigured = true;
}

const ROLE_COLOR: Record<MarkerRole, string> = {
  origin: "#2196f3",
  "alternate-origin": "#64748b",
  connection: "#64748b",
  destination: "#f59e0b",
};

function makeMarkerElement(role: MarkerRole): HTMLDivElement {
  const el = document.createElement("div");
  const color = ROLE_COLOR[role];
  if (role === "destination") {
    el.style.width = "16px";
    el.style.height = "16px";
    el.style.background = color;
    el.style.clipPath = "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)";
    el.style.filter = "drop-shadow(0 1px 1px rgba(0,0,0,0.35))";
  } else if (role === "connection") {
    el.style.width = "10px";
    el.style.height = "10px";
    el.style.borderRadius = "50%";
    el.style.background = "white";
    el.style.border = `2px solid ${color}`;
  } else {
    el.style.width = "14px";
    el.style.height = "14px";
    el.style.borderRadius = "50%";
    el.style.background = color;
    el.style.border = "2px solid white";
    el.style.boxShadow = "0 1px 2px rgba(0,0,0,0.4)";
  }
  el.style.cursor = "default";
  return el;
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export class MapLibreProvider implements MapProvider {
  private map: MapLibreMap | null = null;
  private markers: Marker[] = [];
  private flightFeatures: GeoJSON.Feature[] = [];
  private groundFeatures: GeoJSON.Feature[] = [];
  private styleUrl: string;
  private pendingBounds: LngLatBounds | null = null;

  constructor(styleUrl?: string) {
    this.styleUrl = styleUrl ?? process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? DEFAULT_STYLE_URL;
  }

  mount(container: HTMLElement): void {
    if (this.map) return; // spec §5: load once, never reload per card/selection
    ensureWorkerUrlConfigured();
    this.map = new MapLibreMap({
      container,
      style: this.styleUrl,
      center: [-40, 35],
      zoom: 1.4,
      attributionControl: { compact: true },
    });
    this.map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    this.map.on("error", (e) => console.error("SmartFlighter map error:", e.error));
    this.map.on("load", () => {
      const map = this.map;
      if (!map) return;
      map.addSource(FLIGHT_LEGS_SOURCE, { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: FLIGHT_LEGS_SOURCE,
        type: "line",
        source: FLIGHT_LEGS_SOURCE,
        paint: { "line-color": "#2196f3", "line-width": 2.5, "line-opacity": 0.85 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addSource(GROUND_LEGS_SOURCE, { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: GROUND_LEGS_SOURCE,
        type: "line",
        source: GROUND_LEGS_SOURCE,
        paint: { "line-color": "#64748b", "line-width": 2, "line-dasharray": [1, 1.5] },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      if (this.pendingBounds) {
        map.fitBounds(this.pendingBounds, { padding: 60, maxZoom: 5 });
        this.pendingBounds = null;
      }
    });
  }

  addAirportMarker(marker: MapMarker): void {
    this.addMarkerInternal(marker);
  }

  addStopoverMarker(marker: MapMarker): void {
    this.addMarkerInternal(marker);
  }

  private addMarkerInternal(marker: MapMarker): void {
    if (!this.map) return;
    const el = makeMarkerElement(marker.role);
    el.title = marker.label;
    const m = new Marker({ element: el, anchor: "center" }).setLngLat([marker.position.lon, marker.position.lat]);
    if (marker.popupHtml) {
      m.setPopup(new Popup({ offset: 12, closeButton: false }).setHTML(marker.popupHtml));
    }
    m.addTo(this.map);
    this.markers.push(m);
  }

  drawFlightLeg(id: string, from: LatLon, to: LatLon): void {
    const coordinates = greatCircleLine(from, to, 64);
    this.flightFeatures.push({ type: "Feature", properties: { id }, geometry: { type: "LineString", coordinates } });
    this.syncSource(FLIGHT_LEGS_SOURCE, this.flightFeatures);
  }

  drawGroundLeg(id: string, from: LatLon, to: LatLon): void {
    const coordinates: [number, number][] = [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ];
    this.groundFeatures.push({ type: "Feature", properties: { id }, geometry: { type: "LineString", coordinates } });
    this.syncSource(GROUND_LEGS_SOURCE, this.groundFeatures);
  }

  private syncSource(id: string, features: GeoJSON.Feature[]) {
    const source = this.map?.getSource<GeoJSONSource>(id);
    source?.setData({ type: "FeatureCollection", features });
  }

  fitItinerary(): void {
    const bounds = new LngLatBounds();
    let any = false;
    for (const feature of [...this.flightFeatures, ...this.groundFeatures]) {
      if (feature.geometry.type !== "LineString") continue;
      for (const [lon, lat] of feature.geometry.coordinates as [number, number][]) {
        bounds.extend([lon, lat]);
        any = true;
      }
    }
    if (!any) return;
    if (this.map?.isStyleLoaded()) {
      this.map.fitBounds(bounds, { padding: 60, maxZoom: 5 });
    } else {
      this.pendingBounds = bounds;
    }
  }

  clearItinerary(): void {
    for (const marker of this.markers) marker.remove();
    this.markers = [];
    this.flightFeatures = [];
    this.groundFeatures = [];
    this.syncSource(FLIGHT_LEGS_SOURCE, this.flightFeatures);
    this.syncSource(GROUND_LEGS_SOURCE, this.groundFeatures);
  }

  destroy(): void {
    this.clearItinerary();
    this.map?.remove();
    this.map = null;
  }
}
