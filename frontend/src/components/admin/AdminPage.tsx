"use client";

import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import { useLocale } from "@/lib/i18n/LocaleContext";
import type { MessageKey } from "@/lib/i18n/messages";
import type { AccountStatus, AdminAccountOut, SearchLogEntry } from "@/lib/types";

interface AdminPageProps {
  token: string;
  currentUsername: string;
  onBack: () => void;
}

// toLocaleString() defaults to the browser's OS locale, which can differ
// from whichever language the admin has picked in-app via the switcher --
// this maps our locale to a real Intl tag so the date matches what's
// actually on screen.
const INTL_TAG: Record<string, string> = { "zh-Hant": "zh-TW", "zh-Hans": "zh-CN", en: "en-CA" };

const STATUS_KEY: Record<AccountStatus, MessageKey> = {
  pending: "status.pending",
  approved: "status.approved",
  denied: "status.denied",
  disabled: "status.disabled",
};

// SerpApi's trip-type coding, reusing the search form's own labels.
const TRIP_TYPE_KEY: Record<string, MessageKey> = {
  "1": "form.tripType.roundTrip",
  "2": "form.tripType.oneWay",
  "3": "form.tripType.multiCity",
};

export function AdminPage({ token, currentUsername, onBack }: AdminPageProps) {
  const { t, locale } = useLocale();
  const [accounts, setAccounts] = useState<AdminAccountOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Which account's search history is expanded, and its loaded entries.
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const [history, setHistory] = useState<SearchLogEntry[] | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listAccounts(token);
      setAccounts(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadError"));
    }
  }, [token, t]);

  // Inlined rather than calling load() directly, so this effect has no
  // synchronous setState call in its own body -- only inside .then/.catch,
  // after a real async boundary (see useAuth.ts for the same reasoning).
  // load() itself is still used as-is by the mutation handlers below,
  // called from event handlers rather than an effect.
  useEffect(() => {
    let cancelled = false;
    api.listAccounts(token).then(
      (list) => {
        if (!cancelled) setAccounts(list);
      },
      (err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("admin.loadError"));
      },
    );
    return () => {
      cancelled = true;
    };
    // t() is stable across a given locale's lifetime in practice, but isn't
    // memoized identity-stable -- omitted from deps on purpose so switching
    // languages mid-load doesn't re-trigger a duplicate fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function act(userId: number, action: "approve" | "deny" | "disable") {
    setBusyId(userId);
    setError(null);
    try {
      if (action === "approve") await api.approveAccount(token, userId);
      else if (action === "deny") await api.denyAccount(token, userId);
      else await api.disableAccount(token, userId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.actionFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function setPassword(userId: number, username: string) {
    const pw = window.prompt(t("admin.setPasswordPrompt", { username }));
    if (pw == null) return;
    if (pw.length < 8) {
      window.alert(t("admin.passwordTooShort"));
      return;
    }
    setBusyId(userId);
    try {
      await api.adminSetPassword(token, userId, pw);
      window.alert(t("admin.passwordUpdated", { username }));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : t("admin.setPasswordFailed"));
    } finally {
      setBusyId(null);
    }
  }

  /** Admin override of the user's stored SerpApi key -- e.g. to fix one
   * a friend pasted wrong. Empty input = remove their key. */
  async function setApiKey(userId: number, username: string) {
    const key = window.prompt(t("admin.setApiKeyPrompt", { username }));
    if (key == null) return;
    setBusyId(userId);
    try {
      if (key.trim() === "") {
        await api.adminClearApiKey(token, userId);
      } else {
        await api.adminSetApiKey(token, userId, key.trim());
      }
      window.alert(t("admin.apiKeyUpdated", { username }));
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : t("admin.actionFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleHistory(userId: number) {
    if (historyFor === userId) {
      setHistoryFor(null);
      setHistory(null);
      return;
    }
    setHistoryFor(userId);
    setHistory(null);
    try {
      setHistory(await api.listAccountSearches(token, userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadError"));
      setHistoryFor(null);
    }
  }

  const pending = accounts?.filter((a) => a.status === "pending") ?? [];
  const others = accounts?.filter((a) => a.status !== "pending") ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t("admin.title")}</h1>
        <button type="button" onClick={onBack} className="text-sm font-medium text-sky-600 hover:text-sky-700">
          {t("admin.back")}
        </button>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {accounts === null && !error && <p className="text-sm text-slate-400">{t("admin.loading")}</p>}

      {accounts !== null && (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">
              {t("admin.waitingHeading", { count: pending.length })}
            </h2>
            {pending.length === 0 && <p className="text-sm text-slate-400">{t("admin.noneWaiting")}</p>}
            <div className="space-y-2">
              {pending.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{a.username}</p>
                    <p className="text-xs text-slate-400">
                      {t("admin.requestedAt", { date: new Date(a.created_at).toLocaleString(INTL_TAG[locale]) })} ·{" "}
                      {a.has_api_key ? t("admin.providedKey") : t("admin.noKeyYet")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <ActionButton onClick={() => act(a.id, "approve")} disabled={busyId === a.id} variant="primary">
                      {t("admin.approve")}
                    </ActionButton>
                    <ActionButton onClick={() => act(a.id, "deny")} disabled={busyId === a.id} variant="ghost">
                      {t("admin.deny")}
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">
              {t("admin.allAccountsHeading", { count: others.length })}
            </h2>
            <div className="space-y-2">
              {others.map((a) => (
                <div key={a.id} className="rounded-lg border border-slate-200 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {a.username} <StatusBadge status={a.status} isAdmin={a.is_admin} />
                      </p>
                      <p className="text-xs text-slate-400">
                        {a.has_api_key ? t("admin.hasKey") : t("admin.noKey")} ·{" "}
                        {t("admin.searchCount", { count: a.search_count })}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <ActionButton onClick={() => toggleHistory(a.id)} disabled={busyId === a.id} variant="ghost">
                        {historyFor === a.id ? t("admin.hideHistory") : t("admin.history")}
                      </ActionButton>
                      <ActionButton onClick={() => setApiKey(a.id, a.username)} disabled={busyId === a.id} variant="ghost">
                        {t("admin.setApiKey")}
                      </ActionButton>
                      <ActionButton onClick={() => setPassword(a.id, a.username)} disabled={busyId === a.id} variant="ghost">
                        {t("admin.setPassword")}
                      </ActionButton>
                      {a.status === "approved" && !a.is_admin && a.username !== currentUsername && (
                        <ActionButton onClick={() => act(a.id, "disable")} disabled={busyId === a.id} variant="ghost">
                          {t("admin.disable")}
                        </ActionButton>
                      )}
                      {a.status !== "approved" && (
                        <ActionButton onClick={() => act(a.id, "approve")} disabled={busyId === a.id} variant="primary">
                          {t("admin.approve")}
                        </ActionButton>
                      )}
                    </div>
                  </div>

                  {historyFor === a.id && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      {history === null && <p className="text-xs text-slate-400">{t("admin.loading")}</p>}
                      {history !== null && history.length === 0 && (
                        <p className="text-xs text-slate-400">{t("admin.historyEmpty")}</p>
                      )}
                      {history !== null && history.length > 0 && (
                        <ul className="space-y-1">
                          {history.map((s) => (
                            <li key={s.id} className="flex items-baseline justify-between gap-3 text-xs">
                              <span className="font-mono text-slate-600">
                                {s.departure_id ?? "?"} → {s.arrival_id ?? "?"}
                                <span className="ml-2 font-sans text-slate-400">
                                  {s.outbound_date}
                                  {s.return_date && s.return_date !== s.outbound_date ? ` – ${s.return_date}` : ""}
                                  {s.trip_type && TRIP_TYPE_KEY[s.trip_type] ? ` · ${t(TRIP_TYPE_KEY[s.trip_type])}` : ""}
                                </span>
                              </span>
                              <span className="shrink-0 text-slate-400">
                                {new Date(s.created_at).toLocaleString(INTL_TAG[locale])}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status, isAdmin }: { status: AccountStatus; isAdmin: boolean }) {
  const { t } = useLocale();
  return (
    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
      {t(STATUS_KEY[status])}
      {isAdmin ? t("admin.adminSuffix") : ""}
    </span>
  );
}

function ActionButton({
  onClick,
  disabled,
  variant,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  variant: "primary" | "ghost";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
        variant === "primary" ? "bg-sky-600 text-white hover:bg-sky-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}
