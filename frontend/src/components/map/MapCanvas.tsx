"use client";

import { useEffect, useMemo, useRef } from "react";
import type { AirportMeta, ItineraryOut } from "@/lib/types";
import { MapLibreProvider } from "./MapLibreProvider";
import type { MapProvider } from "./MapProvider";

interface MapCanvasProps {
  airports: AirportMeta[];
  selected: ItineraryOut | null;
}

export function MapCanvas({ airports, selected }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<MapProvider | null>(null);

  const airportByIata = useMemo(() => {
    const map = new Map<string, AirportMeta>();
    for (const a of airports) map.set(a.iata, a);
    return map;
  }, [airports]);

  // Mount the map exactly once for this component's lifetime -- spec §5's
  // cost-control principle is to never reload the map per card/selection.
  useEffect(() => {
    if (!containerRef.current) return;
    const provider = new MapLibreProvider();
    provider.mount(containerRef.current);
    providerRef.current = provider;
    return () => {
      provider.destroy();
      providerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || !selected) return;

    // §36 Map Interaction order: clear -> markers -> legs -> fit.
    provider.clearItinerary();

    const originIata = selected.origin.iata;
    provider.addAirportMarker({
      id: `origin-${originIata}`,
      position: { lat: selected.origin.lat, lon: selected.origin.lon },
      role: originIata === "YYZ" ? "origin" : "alternate-origin",
      label: `${selected.origin.city} (${originIata})`,
      popupHtml: `<strong>${originIata}</strong> — ${selected.origin.name}`,
    });
    provider.addAirportMarker({
      id: `dest-${selected.destination.iata}`,
      position: { lat: selected.destination.lat, lon: selected.destination.lon },
      role: "destination",
      label: `${selected.destination.city} (${selected.destination.iata})`,
      popupHtml: `<strong>${selected.destination.iata}</strong> — ${selected.destination.name}`,
    });

    for (const [layoverIata, minutes] of selected.layovers) {
      const airport = airportByIata.get(layoverIata);
      if (!airport) continue;
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      provider.addAirportMarker({
        id: `conn-${layoverIata}`,
        position: { lat: airport.lat, lon: airport.lon },
        role: "connection",
        label: `${airport.city} (${layoverIata})`,
        popupHtml: `<strong>${layoverIata}</strong> — ${hours}h${mins.toString().padStart(2, "0")} connection`,
      });
    }

    const coordsFor = (iata: string) => {
      if (iata === selected.origin.iata) return { lat: selected.origin.lat, lon: selected.origin.lon };
      if (iata === selected.destination.iata) return { lat: selected.destination.lat, lon: selected.destination.lon };
      const airport = airportByIata.get(iata);
      return airport ? { lat: airport.lat, lon: airport.lon } : undefined;
    };

    selected.legs.forEach((leg, idx) => {
      const from = coordsFor(leg.from_iata);
      const to = coordsFor(leg.to_iata);
      if (from && to) provider.drawFlightLeg(`leg-${idx}`, from, to);
    });

    provider.fitItinerary();
  }, [selected, airportByIata]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden rounded-2xl" />;
}
