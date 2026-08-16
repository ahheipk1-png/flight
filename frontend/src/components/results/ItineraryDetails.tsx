"use client";

import { formatDuration, formatMoney, formatTime } from "@/lib/format";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { localizedCityName } from "@/lib/i18n/placeNames";
import type { AirportRef, ItineraryOut, LegOut, TripType } from "@/lib/types";

// Reconstructs where each deliberate multi-city stop falls in the flat
// legs[] list -- ItineraryOut has no per-slice boundary marker of its own,
// only the ordered city_stops list, so this walks legs until each stop's
// airport is reached as a LEG ARRIVAL (matching the backend's own slice
// construction order). Same best-effort-reconstruction approach as
// serpapi_google_flights.py's _partition_into_slices; a display-only
// heuristic, not something search correctness depends on.
function interleaveStops(legs: LegOut[], cityStops: AirportRef[] | null): (LegOut | AirportRef)[] {
  if (!cityStops || cityStops.length === 0) return legs;
  const items: (LegOut | AirportRef)[] = [];
  let stopIdx = 0;
  for (const leg of legs) {
    items.push(leg);
    if (stopIdx < cityStops.length && leg.to_iata === cityStops[stopIdx].iata) {
      items.push(cityStops[stopIdx]);
      stopIdx += 1;
    }
  }
  return items;
}

function isCityStop(item: LegOut | AirportRef): item is AirportRef {
  return "iata" in item;
}

/** Open-jaw's two legs aren't a continuous chain (leg 2 departs from
 * wherever the user picked to fly home from, not from where leg 1
 * landed), so this splits at the first leg whose departure matches
 * return_origin rather than reusing interleaveStops' same-city-in/out
 * assumption. */
function splitOpenJawLegs(legs: LegOut[], returnOrigin: AirportRef | null): { outbound: LegOut[]; inbound: LegOut[] } {
  if (!returnOrigin) return { outbound: legs, inbound: [] };
  const splitIdx = legs.findIndex((leg) => leg.from_iata === returnOrigin.iata);
  if (splitIdx === -1) return { outbound: legs, inbound: [] };
  return { outbound: legs.slice(0, splitIdx), inbound: legs.slice(splitIdx) };
}

function FlightRow({ item }: { item: LegOut }) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="w-14 shrink-0 font-mono text-slate-500">
        {item.carrier}
        {item.flight_number.replace(item.carrier, "")}
      </span>
      <span className="flex-1 text-slate-700">
        {item.from_iata} {formatTime(item.dep_time)} → {item.to_iata} {formatTime(item.arr_time)}
      </span>
      <span className="text-slate-400">{formatDuration(item.duration_min)}</span>
    </div>
  );
}

export function ItineraryDetails({ itinerary, tripType }: { itinerary: ItineraryOut; tripType: TripType }) {
  const { t, locale } = useLocale();
  const isMultiCity = tripType === "multi_city";
  const isOpenJaw = tripType === "open_jaw";
  const chain = isMultiCity ? [itinerary.origin, ...(itinerary.city_stops ?? []), itinerary.destination] : [itinerary.origin, itinerary.destination];
  const rows = isMultiCity ? interleaveStops(itinerary.legs, itinerary.city_stops) : itinerary.legs;

  if (isOpenJaw && itinerary.return_origin) {
    const { outbound, inbound } = splitOpenJawLegs(itinerary.legs, itinerary.return_origin);
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold text-slate-900">
            {localizedCityName(itinerary.origin.iata, itinerary.origin.city, locale)} ({itinerary.origin.iata}) →{" "}
            {localizedCityName(itinerary.destination.iata, itinerary.destination.city, locale)} ({itinerary.destination.iata})
          </h3>
          <p className="text-xl font-bold text-slate-900">{formatMoney(itinerary.fare, itinerary.currency)}</p>
        </div>

        <div className="mt-4 space-y-3">
          {outbound.map((item, idx) => (
            <FlightRow key={`out-${item.flight_number}-${idx}`} item={item} />
          ))}

          <div className="flex items-center gap-2 pl-1 text-sm font-medium text-violet-700">
            <span className="inline-block h-2.5 w-2.5 rotate-45 bg-violet-500" />
            {t("results.flyHomeFrom", { city: localizedCityName(itinerary.return_origin.iata, itinerary.return_origin.city, locale) })}
          </div>

          {inbound.map((item, idx) => (
            <FlightRow key={`in-${item.flight_number}-${idx}`} item={item} />
          ))}
          {itinerary.legs.length === 0 && <p className="text-sm text-slate-400">{t("results.detailNotVerified")}</p>}
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">{t("results.whyThisTrip")}</p>
          <ul className="space-y-1">
            {itinerary.explanations.map((note, idx) => (
              <li key={`${note.key}-${idx}`} className="flex gap-1.5 text-sm text-slate-600">
                <span className="text-emerald-600">✓</span>
                <span>{t(note.key, note.params)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold text-slate-900">
          {chain.map((a, idx) => (
            <span key={`${a.iata}-${idx}`}>
              {idx > 0 && " → "}
              {localizedCityName(a.iata, a.city, locale)} ({a.iata})
            </span>
          ))}
        </h3>
        <p className="text-xl font-bold text-slate-900">{formatMoney(itinerary.fare, itinerary.currency)}</p>
      </div>

      <div className="mt-4 space-y-3">
        {rows.map((item, idx) =>
          isCityStop(item) ? (
            <div key={`stop-${item.iata}-${idx}`} className="flex items-center gap-2 pl-1 text-sm font-medium text-violet-700">
              <span className="inline-block h-2.5 w-2.5 rotate-45 bg-violet-500" />
              {t("results.stopIn", { city: localizedCityName(item.iata, item.city, locale) })}
            </div>
          ) : (
            <div key={`${item.flight_number}-${idx}`} className="flex items-center gap-4 text-sm">
              <span className="w-14 shrink-0 font-mono text-slate-500">
                {item.carrier}
                {item.flight_number.replace(item.carrier, "")}
              </span>
              <span className="flex-1 text-slate-700">
                {item.from_iata} {formatTime(item.dep_time)} → {item.to_iata} {formatTime(item.arr_time)}
              </span>
              <span className="text-slate-400">{formatDuration(item.duration_min)}</span>
            </div>
          ),
        )}
        {itinerary.legs.length === 0 && <p className="text-sm text-slate-400">{t("results.detailNotVerified")}</p>}

        {/* Same-flight connections only -- the backend never puts a
            deliberate multi-city gap in `layovers` (see providers/base.py's
            FareSlice), so this is safe to render unconditionally. */}
        {itinerary.layovers.map(([iata, minutes]) => (
          <div key={iata} className="pl-14 text-sm text-slate-500">
            {t("results.connectionIn", { duration: formatDuration(minutes), iata })}
          </div>
        ))}
      </div>

      {itinerary.ground_transfer && (
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          {t("results.groundTransport", {
            from: itinerary.ground_transfer.from_iata,
            to: itinerary.ground_transfer.to_iata,
            duration: formatDuration(itinerary.ground_transfer.minutes),
            cost: formatMoney(itinerary.ground_transfer.cost, itinerary.ground_transfer.currency),
          })}
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">{t("results.whyThisTrip")}</p>
        <ul className="space-y-1">
          {itinerary.explanations.map((note, idx) => (
            <li key={`${note.key}-${idx}`} className="flex gap-1.5 text-sm text-slate-600">
              <span className="text-emerald-600">✓</span>
              <span>{t(note.key, note.params)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
