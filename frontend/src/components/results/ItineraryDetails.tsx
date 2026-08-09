import { formatDuration, formatMoney, formatTime } from "@/lib/format";
import type { ItineraryOut } from "@/lib/types";

export function ItineraryDetails({ itinerary }: { itinerary: ItineraryOut }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold text-slate-900">
          {itinerary.origin.city} ({itinerary.origin.iata}) → {itinerary.destination.city} ({itinerary.destination.iata})
        </h3>
        <p className="text-xl font-bold text-slate-900">{formatMoney(itinerary.fare, itinerary.currency)}</p>
      </div>

      <div className="mt-4 space-y-3">
        {itinerary.legs.map((leg, idx) => (
          <div key={`${leg.flight_number}-${idx}`} className="flex items-center gap-4 text-sm">
            <span className="w-14 shrink-0 font-mono text-slate-500">{leg.carrier}{leg.flight_number.replace(leg.carrier, "")}</span>
            <span className="flex-1 text-slate-700">
              {leg.from_iata} {formatTime(leg.dep_time)} → {leg.to_iata} {formatTime(leg.arr_time)}
            </span>
            <span className="text-slate-400">{formatDuration(leg.duration_min)}</span>
          </div>
        ))}
        {itinerary.legs.length === 0 && <p className="text-sm text-slate-400">Detailed timing not yet verified.</p>}

        {itinerary.layovers.map(([iata, minutes]) => (
          <div key={iata} className="pl-14 text-sm text-slate-500">
            {formatDuration(minutes)} connection in {iata}
          </div>
        ))}
      </div>

      {itinerary.ground_transfer && (
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          Ground transport {itinerary.ground_transfer.from_iata} → {itinerary.ground_transfer.to_iata}: ~
          {formatDuration(itinerary.ground_transfer.minutes)}, ~{formatMoney(itinerary.ground_transfer.cost, itinerary.ground_transfer.currency)} round trip
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">Why this trip</p>
        <ul className="space-y-1">
          {itinerary.explanations.map((note) => (
            <li key={note} className="flex gap-1.5 text-sm text-slate-600">
              <span className="text-emerald-600">✓</span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
