"use client";

import { useState } from "react";
import { AdminPage } from "@/components/admin/AdminPage";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { AccountStatusNotice } from "@/components/auth/AccountStatusNotice";
import { ApiKeySettings } from "@/components/auth/ApiKeySettings";
import { AuthForms } from "@/components/auth/AuthForms";
import { BrandHeader } from "@/components/BrandHeader";
import { ResultsLayout } from "@/components/results/ResultsLayout";
import { SearchForm } from "@/components/search/SearchForm";
import { CompleteState, PreloadCompleteIllustration, SearchingState } from "@/components/search/SearchStates";
import { useAuth } from "@/hooks/useAuth";
import { useMeta } from "@/hooks/useMeta";
import { useSearch } from "@/hooks/useSearch";
import { useLocale } from "@/lib/i18n/LocaleContext";
import type { SearchSubmission, TripType } from "@/lib/types";

type View = "app" | "settings" | "admin";

export default function Home() {
  const auth = useAuth();
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
    // The session token -- the Worker resolves it to this user's own
    // stored SerpApi key server-side; the key never reaches the browser.
    runSearch(submission, auth.token!);
  }

  const headerRight =
    auth.token && auth.username ? (
      <AccountMenu
        username={auth.username}
        status={auth.status}
        isAdmin={auth.isAdmin}
        onOpenSettings={() => setView("settings")}
        onOpenAdmin={() => setView("admin")}
        onLogout={() => {
          setView("app");
          reset();
          auth.logout();
        }}
      />
    ) : null;

  if (auth.loading) {
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
        {!auth.token && (
          <div>
            <Hero />
            <AuthForms onRegister={auth.register} onLogin={auth.login} error={auth.error} clearError={auth.clearError} />
          </div>
        )}

        {auth.token && view === "admin" && auth.isAdmin && (
          <AdminPage token={auth.token} currentUsername={auth.username ?? ""} onBack={() => setView("app")} />
        )}

        {auth.token && view === "settings" && (
          <div className="mx-auto max-w-md">
            <div className="mb-6 flex items-center justify-between">
              <h1 className="text-xl font-bold text-slate-900">{t("settings.title")}</h1>
              <button type="button" onClick={() => setView("app")} className="text-sm font-medium text-sky-600 hover:text-sky-700">
                {t("settings.back")}
              </button>
            </div>
            <ApiKeySettings hasApiKey={auth.hasApiKey} onSave={auth.saveApiKey} onClear={auth.removeApiKey} variant="settings" />
          </div>
        )}

        {auth.token && view === "app" && auth.status !== "approved" && auth.status !== null && (
          <AccountStatusNotice status={auth.status} />
        )}

        {auth.token && view === "app" && auth.status === "approved" && !auth.hasApiKey && (
          <ApiKeySettings hasApiKey={auth.hasApiKey} onSave={auth.saveApiKey} onClear={auth.removeApiKey} variant="gate" />
        )}

        {auth.token && view === "app" && auth.status === "approved" && auth.hasApiKey && (
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
