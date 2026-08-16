"use client";

// Typeahead over the global city/airport index (engine/places.ts). Used
// for the From step (single city), each multi-city leg (single city),
// and the To step's city-mode destination list (repeated picks, chips
// managed by the caller). Always resolves to a PlaceSelection -- a set of
// IATA codes to comma-join into one departure_id/arrival_id -- never a
// bare region string, so the same component works for "any city in the
// world", not just the curated set.

import { useCallback, useEffect, useRef, useState } from "react";
import { preloadPlaces, searchPlaces, type PlaceCity } from "@/lib/engine/places";
import { useLocale } from "@/lib/i18n/LocaleContext";
import type { PlaceSelection } from "@/lib/types";

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none";

function toSelection(city: PlaceCity): PlaceSelection {
  const label = city.airports.length > 1 ? `${city.city} (${city.airports.join(", ")})` : `${city.city} (${city.airports[0]})`;
  return { airports: city.airports, label };
}

interface PlacePickerProps {
  placeholder: string;
  onSelect: (selection: PlaceSelection) => void;
  excludeAirports?: string[]; // hide cities that would add nothing new (e.g. already-picked)
  autoFocus?: boolean;
}

export function PlacePicker({ placeholder, onSelect, excludeAirports, autoFocus }: PlacePickerProps) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceCity[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const excludeRef = useRef(excludeAirports);

  useEffect(() => {
    excludeRef.current = excludeAirports;
  }, [excludeAirports]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Debounced imperatively from the input's own onChange (below), not via
  // an effect keyed on `query` -- searchPlaces() is triggered by the user
  // typing, not "synchronized" from state, so it belongs in the event
  // handler that caused it.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const scheduleSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    debounceRef.current = setTimeout(() => {
      searchPlaces(q).then((cities) => {
        if (requestId.current !== id) return; // a newer keystroke superseded this search
        const excluded = new Set(excludeRef.current ?? []);
        setResults(cities.filter((c) => !c.airports.every((a) => excluded.has(a))));
        setLoading(false);
      });
    }, 150);
  }, []);

  function pick(city: PlaceCity) {
    onSelect(toSelection(city));
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          const value = e.target.value;
          setQuery(value);
          setOpen(true);
          scheduleSearch(value.trim());
        }}
        onFocus={() => {
          preloadPlaces();
          setOpen(true);
        }}
        placeholder={placeholder}
        className={INPUT_CLASS}
        autoFocus={autoFocus}
      />
      {open && query.trim().length > 0 && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {loading && <p className="px-3 py-2 text-sm text-slate-400">{t("picker.searching")}</p>}
          {!loading && results.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">{t("picker.noMatches")}</p>}
          {!loading &&
            results.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => pick(c)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-sky-50"
              >
                <span className="font-medium text-slate-800">{c.city}</span>
                <span className="text-xs text-slate-400">
                  {c.country} · {c.airports.join(", ")}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** A picked single place shown as a chip with a "change" affordance, or
 * the picker itself when nothing's picked yet. */
export function PlaceSlot({
  value,
  onChange,
  placeholder,
}: {
  value: PlaceSelection | null;
  onChange: (selection: PlaceSelection | null) => void;
  placeholder: string;
}) {
  const { t } = useLocale();
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <span className="font-medium text-slate-800">{value.label}</span>
        <button type="button" onClick={() => onChange(null)} className="text-xs font-medium text-sky-600 hover:text-sky-700">
          {t("picker.change")}
        </button>
      </div>
    );
  }
  return <PlacePicker placeholder={placeholder} onSelect={onChange} autoFocus />;
}
