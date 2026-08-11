"use client";

import { useEffect, useMemo, useRef } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { localizedCityName } from "@/lib/i18n/placeNames";
import type { AirportMeta, ItineraryOut } from "@/lib/types";
import { MapLibreProvider } from "./MapLibreProvider";
import type { MapProvider } from "./MapProvider";

interface MapCanvasProps {
  airports: AirportMeta[];
  selected: ItineraryOut | null;
}

export function MapCanvas({ airports, selected }: MapCanvasProps) {
  const { locale } = useLocale();
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
      label: `${localizedCityName(originIata, selected.origin.city, locale)} (${originIata})`,
      popupHtml: `<strong>${originIata}</strong> — ${selected.origin.name}`,
    });
    provider.addAirportMarker({
      id: `dest-${selected.destination.iata}`,
      position: { lat: selected.destination.lat, lon: selected.destination.lon },
      role: "destination",
      label: `${localizedCityName(selected.destination.iata, selected.destination.city, locale)} (${selected.destination.iata})`,
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
        label: `${localizedCityName(layoverIata, airport.city, locale)} (${layoverIata})`,
        popupHtml: `<strong>${layoverIata}</strong> — ${hours}h${mins.toString().padStart(2, "0")} connection`,
      });
    }

    // Manual multi-city only -- deliberate chosen stops, distinct from the
    // same-flight connections above (see MapProvider.ts's MarkerRole).
    // AirportRef already carries lat/lon directly, no airportByIata lookup
    // needed.
    for (const stop of selected.city_stops ?? []) {
      provider.addAirportMarker({
        id: `city-stop-${stop.iata}`,
        position: { lat: stop.lat, lon: stop.lon },
        role: "city-stop",
        label: `${localizedCityName(stop.iata, stop.city, locale)} (${stop.iata})`,
        popupHtml: `<strong>${stop.iata}</strong> — ${stop.name}`,
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
  }, [selected, airportByIata, locale]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden rounded-2xl" />;
}
