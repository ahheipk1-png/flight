"use client";

import { useState } from "react";
import { AdminPage } from "@/components/admin/AdminPage";
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

type View = "app" | "settings" | "admin";

export default function Home() {
  const auth = useAuth();
  const { meta, error: metaError } = useMeta();
  const { uiState, stage, result, error, runSearch, reset } = useSearch();
  const [view, setView] = useState<View>("app");

  const headerRight = auth.token ? (
    <nav className="flex items-center gap-4 text-sm">
      <span className="text-slate-500">{auth.username}</span>
      {auth.status === "approved" && (
        <button type="button" onClick={() => setView("settings")} className="font-medium text-slate-600 hover:text-slate-900">
          Settings
        </button>
      )}
      {auth.isAdmin && (
        <button type="button" onClick={() => setView("admin")} className="font-medium text-slate-600 hover:text-slate-900">
          🛠️ Admin
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setView("app");
          reset();
          auth.logout();
        }}
        className="font-medium text-slate-600 hover:text-slate-900"
      >
        Log out
      </button>
    </nav>
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
            <div className="mx-auto mb-10 max-w-2xl text-center">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Where could you go?</h1>
              <p className="mt-3 text-slate-500">
                Tell us your time, budget and travel preferences. SmartFlighter searches flexible dates, nearby
                airports, safer connections and worthwhile stopovers for you.
              </p>
            </div>
            <AuthForms onRegister={auth.register} onLogin={auth.login} error={auth.error} clearError={auth.clearError} />
          </div>
        )}

        {auth.token && view === "admin" && auth.isAdmin && (
          <AdminPage token={auth.token} currentUsername={auth.username ?? ""} onBack={() => setView("app")} />
        )}

        {auth.token && view === "settings" && (
          <div className="mx-auto max-w-md">
            <div className="mb-6 flex items-center justify-between">
              <h1 className="text-xl font-bold text-slate-900">Settings</h1>
              <button type="button" onClick={() => setView("app")} className="text-sm font-medium text-sky-600 hover:text-sky-700">
                ← Back to search
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
                <div className="mx-auto mb-10 max-w-2xl text-center">
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Where could you go?</h1>
                  <p className="mt-3 text-slate-500">
                    Tell us your time, budget and travel preferences. SmartFlighter searches flexible dates, nearby
                    airports, safer connections and worthwhile stopovers for you.
                  </p>
                </div>
                <SearchForm meta={meta} metaError={metaError} onSubmit={(body) => runSearch(body, auth.token!)} />
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
                <button
                  type="button"
                  onClick={reset}
                  className="mt-6 rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Try again
                </button>
              </div>
            )}

            {uiState === "results" && result && (
              <ResultsLayout
                itineraries={result.itineraries}
                degraded={result.degraded}
                airports={meta?.airports ?? []}
                onEditSearch={reset}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
