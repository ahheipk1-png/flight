"use client";

import { useLocale } from "@/lib/i18n/LocaleContext";
import type { MessageKey } from "@/lib/i18n/messages";
import type { RankMode } from "@/lib/types";

const TABS: { mode: RankMode; key: MessageKey }[] = [
  { mode: "best", key: "rankingTabs.best" },
  { mode: "cheapest", key: "rankingTabs.cheapest" },
  { mode: "fastest", key: "rankingTabs.fastest" },
];

export function RankingTabs({ mode, onChange }: { mode: RankMode; onChange: (mode: RankMode) => void }) {
  const { t } = useLocale();
  return (
    <div className="inline-flex rounded-full bg-slate-100 p-1">
      {TABS.map((tab) => (
        <button
          key={tab.mode}
          type="button"
          onClick={() => onChange(tab.mode)}
          aria-pressed={mode === tab.mode}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
            mode === tab.mode ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {t(tab.key)}
        </button>
      ))}
    </div>
  );
}
