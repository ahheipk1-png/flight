"use client";

import { formatDate, formatDateRange, formatDuration, formatMoney, routeLabel } from "@/lib/format";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { localizedCityName } from "@/lib/i18n/placeNames";
import type { ItineraryOut, TripType } from "@/lib/types";

interface ResultCardProps {
  itinerary: ItineraryOut;
  rank: number;
  tripType: TripType;
  selected: boolean;
  onSelect: () => void;
}

export function ResultCard({ itinerary, rank, tripType, selected, onSelect }: ResultCardProps) {
  const { t, locale } = useLocale();
  const isOneWay = tripType === "one_way";
  const isMultiCity = tripType === "multi_city";

  const route = isMultiCity
    ? routeLabel([itinerary.origin.iata, ...(itinerary.city_stops ?? []).map((a) => a.iata), itinerary.destination.iata])
    : routeLabel([itinerary.origin.iata, ...itinerary.layovers.map(([iata]) => iata), itinerary.destination.iata]);

  const dateLabel = isOneWay ? formatDate(itinerary.depart_date) : formatDateRange(itinerary.depart_date, itinerary.return_date);
  const lengthLabel = isOneWay
    ? t("results.oneWayLabel")
    : isMultiCity
      ? t("results.multiCityLabel")
      : t("results.tripLengthDays", { days: itinerary.trip_length });

  const stopsLabel =
    itinerary.stops === 0
      ? t("results.nonstop")
      : t(itinerary.stops > 1 ? "results.stopsMany" : "results.stopsOne", { count: itinerary.stops });

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-2xl border p-4 text-left transition-colors ${
        selected ? "border-sky-500 bg-sky-50/60 ring-1 ring-sky-500" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          {rank === 0 && (
            <span className="mb-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold tracking-wide text-amber-700 uppercase">
              {t("results.bestValue")}
            </span>
          )}
          <p className="text-base font-semibold text-slate-900">
            {localizedCityName(itinerary.origin.iata, itinerary.origin.city, locale)} →{" "}
            {localizedCityName(itinerary.destination.iata, itinerary.destination.city, locale)}
          </p>
          <p className="text-sm text-slate-500">
            {dateLabel} · {lengthLabel}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-slate-900">{formatMoney(itinerary.fare, itinerary.currency)}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              itinerary.verified ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
            }`}
          >
            {itinerary.verified ? t("results.verified") : t("results.indicative")}
          </span>
        </div>
      </div>

      <p className="mt-2 font-mono text-sm text-slate-600">{route}</p>
      <p className="text-sm text-slate-500">
        {formatDuration(itinerary.total_duration_min)} · {stopsLabel}
      </p>

      {itinerary.explanations.length > 0 && (
        <ul className="mt-3 space-y-1">
          {itinerary.explanations.slice(0, 3).map((note, idx) => (
            <li key={`${note.key}-${idx}`} className="flex gap-1.5 text-sm text-slate-600">
              <span className="text-emerald-600">✓</span>
              <span>{t(note.key, note.params)}</span>
            </li>
          ))}
        </ul>
      )}
    </button>
  );
}
