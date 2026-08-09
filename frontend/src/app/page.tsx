"use client";

import { BrandHeader } from "@/components/BrandHeader";
import { ResultsLayout } from "@/components/results/ResultsLayout";
import { SearchForm } from "@/components/search/SearchForm";
import { CompleteState, PreloadCompleteIllustration, SearchingState } from "@/components/search/SearchStates";
import { useMeta } from "@/hooks/useMeta";
import { useSearch } from "@/hooks/useSearch";

export default function Home() {
  const { meta, error: metaError } = useMeta();
  const { uiState, stage, result, error, runSearch, reset } = useSearch();

  return (
    <div className="flex min-h-full flex-col">
      <BrandHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        {uiState === "idle" && (
          <div>
            <div className="mx-auto mb-10 max-w-2xl text-center">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Where could you go?</h1>
              <p className="mt-3 text-slate-500">
                Tell us your time, budget and travel preferences. SmartFlighter searches flexible dates, nearby
                airports, safer connections and worthwhile stopovers for you.
              </p>
            </div>
            <SearchForm meta={meta} metaError={metaError} onSubmit={runSearch} />
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
            <p className="text-lg font-semibold text-slate-800">Something went wrong.</p>
            <p className="mt-1 text-sm text-slate-500">{error}</p>
            <button type="button" onClick={reset} className="mt-6 rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white">
              Try again
            </button>
          </div>
        )}

        {uiState === "results" && result && (
          <ResultsLayout itineraries={result.itineraries} degraded={result.degraded} airports={meta?.airports ?? []} onEditSearch={reset} />
        )}
      </main>
    </div>
  );
}
