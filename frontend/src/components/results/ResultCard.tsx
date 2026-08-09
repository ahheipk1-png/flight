import { formatDateRange, formatDuration, formatMoney, routeLabel } from "@/lib/format";
import type { ItineraryOut } from "@/lib/types";

interface ResultCardProps {
  itinerary: ItineraryOut;
  rank: number;
  selected: boolean;
  onSelect: () => void;
}

export function ResultCard({ itinerary, rank, selected, onSelect }: ResultCardProps) {
  const route = routeLabel([itinerary.origin.iata, ...itinerary.layovers.map(([iata]) => iata), itinerary.destination.iata]);

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
              Best value
            </span>
          )}
          <p className="text-base font-semibold text-slate-900">
            {itinerary.origin.city} → {itinerary.destination.city}
          </p>
          <p className="text-sm text-slate-500">
            {formatDateRange(itinerary.depart_date, itinerary.return_date)} · {itinerary.trip_length} days
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-slate-900">{formatMoney(itinerary.fare, itinerary.currency)}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              itinerary.verified ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
            }`}
          >
            {itinerary.verified ? "Verified" : "Indicative"}
          </span>
        </div>
      </div>

      <p className="mt-2 font-mono text-sm text-slate-600">{route}</p>
      <p className="text-sm text-slate-500">
        {formatDuration(itinerary.total_duration_min)} · {itinerary.stops === 0 ? "Nonstop" : `${itinerary.stops} stop${itinerary.stops > 1 ? "s" : ""}`}
      </p>

      {itinerary.explanations.length > 0 && (
        <ul className="mt-3 space-y-1">
          {itinerary.explanations.slice(0, 3).map((note) => (
            <li key={note} className="flex gap-1.5 text-sm text-slate-600">
              <span className="text-emerald-600">✓</span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
    </button>
  );
}
