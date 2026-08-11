"use client";

import { useMemo, useState } from "react";
import { MapCanvas } from "@/components/map/MapCanvas";
import { useLocale } from "@/lib/i18n/LocaleContext";
import type { AirportMeta, ItineraryOut, RankMode, TripType } from "@/lib/types";
import { ItineraryDetails } from "./ItineraryDetails";
import { RankingTabs } from "./RankingTabs";
import { ResultCard } from "./ResultCard";

interface ResultsLayoutProps {
  itineraries: ItineraryOut[];
  degraded: boolean;
  airports: AirportMeta[];
  tripType: TripType;
  onEditSearch: () => void;
}

// §4's desktop layout (bar / list+map / details) implemented as one grid
// so mobile just needs `order-*`, while lg: explicit placement gives the
// desktop arrangement -- no separate mobile/desktop DOM trees to keep in
// sync. Mobile order per spec: map -> tabs -> cards -> details.
const GRID = "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,440px)_1fr] lg:grid-rows-[auto_1fr_auto]";

export function ResultsLayout({ itineraries, degraded, airports, tripType, onEditSearch }: ResultsLayoutProps) {
  const { t } = useLocale();
  const [mode, setMode] = useState<RankMode>("best");
  const [selectedId, setSelectedId] = useState<string | null>(itineraries[0]?.id ?? null);

  const sorted = useMemo(() => [...itineraries].sort((a, b) => a.rank_scores[mode] - b.rank_scores[mode]), [itineraries, mode]);
  const selected = sorted.find((it) => it.id === selectedId) ?? sorted[0] ?? null;

  if (itineraries.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-lg font-semibold text-slate-800">{t("results.noMatchTitle")}</p>
        <p className="mt-1 text-sm text-slate-500">{t("results.noMatchBody")}</p>
        <button type="button" onClick={onEditSearch} className="mt-6 rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white">
          {t("results.editSearch")}
        </button>
      </div>
    );
  }

  return (
    <div>
      {degraded && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200">
          {t("results.degradedNotice")}
        </div>
      )}
      <div className={GRID}>
        <div className="order-2 flex items-center justify-between lg:order-none lg:col-start-1 lg:row-start-1">
          <RankingTabs mode={mode} onChange={setMode} />
          <button type="button" onClick={onEditSearch} className="text-sm font-medium text-slate-500 hover:text-slate-700">
            {t("results.editSearch")}
          </button>
        </div>

        <div className="order-1 h-[320px] lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-full lg:min-h-[420px]">
          <MapCanvas airports={airports} selected={selected} />
        </div>

        <div className="order-3 space-y-3 lg:order-none lg:col-start-1 lg:row-start-2">
          {sorted.map((it, idx) => (
            <ResultCard
              key={it.id}
              itinerary={it}
              rank={idx}
              tripType={tripType}
              selected={it.id === selected?.id}
              onSelect={() => setSelectedId(it.id)}
            />
          ))}
        </div>

        {selected && (
          <div className="order-4 lg:order-none lg:col-span-2 lg:col-start-1 lg:row-start-3">
            <ItineraryDetails itinerary={selected} tripType={tripType} />
          </div>
        )}
      </div>
    </div>
  );
}
