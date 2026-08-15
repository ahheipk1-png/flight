"use client";

import { useState } from "react";
import { ApiKeySettings } from "@/components/auth/ApiKeySettings";
import { BrandHeader } from "@/components/BrandHeader";
import { ResultsLayout } from "@/components/results/ResultsLayout";
import { SearchForm } from "@/components/search/SearchForm";
import { CompleteState, PreloadCompleteIllustration, SearchingState } from "@/components/search/SearchStates";
import { useApiKey } from "@/hooks/useApiKey";
import { useMeta } from "@/hooks/useMeta";
import { useSearch } from "@/hooks/useSearch";
import { useLocale } from "@/lib/i18n/LocaleContext";
import type { SearchSubmission, TripType } from "@/lib/types";

type View = "app" | "settings";

export default function Home() {
  const keyState = useApiKey();
  const { meta, error: metaError } = useMeta();
  const { uiState, stage, result, error, runSearch, reset } = useSearch();
  const [view, setView] = useState<View>("app");
  // Captured at submit time: once trip_length_min/max can legitimately be
  // 0 for either a one-way sentinel or a genuine same-day round trip, the
  // result alone can't disambiguate which the results screen should
  // render as -- the frontend already knows what it asked for.
  const [lastTripType, setLastTripType] = useState<TripType>("round_trip");
  const { t } = useLocale();

  function handleSearchSubmit(submission: SearchSubmission) {
    setLastTripType(submission.tripType);
    runSearch(submission, keyState.apiKey!);
  }

  const headerRight = (
    <nav className="flex items-center gap-4 text-sm">
      {keyState.isDemo && (
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
          {t("nav.demoBadge")}
        </span>
      )}
      {keyState.hasApiKey && (
        <button type="button" onClick={() => setView("settings")} className="font-medium text-slate-600 hover:text-slate-900">
          {t("nav.settings")}
        </button>
      )}
    </nav>
  );

  if (keyState.loading) {
    return (
      <div className="flex min-h-full flex-col">
        <BrandHeader />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <BrandHeader right={headerRight} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        {view === "settings" && (
          <div className="mx-auto max-w-md">
            <div className="mb-6 flex items-center justify-between">
              <h1 className="text-xl font-bold text-slate-900">{t("settings.title")}</h1>
              <button type="button" onClick={() => setView("app")} className="text-sm font-medium text-sky-600 hover:text-sky-700">
                {t("settings.back")}
              </button>
            </div>
            <ApiKeySettings
              hasApiKey={keyState.hasApiKey}
              onSave={async (key) => keyState.saveApiKey(key)}
              onClear={async () => keyState.removeApiKey()}
              variant="settings"
            />
          </div>
        )}

        {view === "app" && !keyState.hasApiKey && (
          <div>
            <Hero />
            <ApiKeySettings
              hasApiKey={false}
              onSave={async (key) => keyState.saveApiKey(key)}
              onClear={async () => keyState.removeApiKey()}
              variant="gate"
            />
          </div>
        )}

        {view === "app" && keyState.hasApiKey && (
          <>
            {uiState === "idle" && (
              <div>
                <Hero />
                <SearchForm meta={meta} metaError={metaError} onSubmit={handleSearchSubmit} />
              </div>
            )}

            {uiState === "searching" && (
              <>
                <PreloadCompleteIllustration />
                <SearchingState stage={stage} />
              </>
            )}

            {uiState === "complete" && <CompleteState />}

            {uiState === "error" && (
              <div className="mx-auto max-w-lg py-16 text-center">
                <p className="text-lg font-semibold text-slate-800">{t("error.title")}</p>
                <p className="mt-1 text-sm text-slate-500">{error}</p>
                <button
                  type="button"
                  onClick={reset}
                  className="mt-6 rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  {t("error.retry")}
                </button>
              </div>
            )}

            {uiState === "results" && result && (
              <ResultsLayout
                itineraries={result.itineraries}
                degraded={result.degraded}
                airports={meta.airports}
                tripType={lastTripType}
                onEditSearch={reset}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Hero() {
  const { t } = useLocale();
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{t("home.heading")}</h1>
      <p className="mt-3 text-slate-500">{t("home.subheading")}</p>
    </div>
  );
}
