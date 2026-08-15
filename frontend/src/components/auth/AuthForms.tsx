"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";

interface AuthFormsProps {
  onRegister: (username: string, password: string, serpapiApiKey?: string) => Promise<string>;
  onLogin: (username: string, password: string) => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none";

export function AuthForms({ onRegister, onLogin, error, clearError }: AuthFormsProps) {
  const { t } = useLocale();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [serpapiApiKey, setSerpapiApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  // The backend's raw confirmation text is out of scope for translation
  // this pass (it's dynamically generated, not a fixed UI string) -- the
  // KNOWN success case shows our own translated copy instead once this
  // becomes non-null, ignoring whatever the backend actually said.
  const [justRegistered, setJustRegistered] = useState(false);

  function switchTab(next: "login" | "register") {
    setTab(next);
    clearError();
    setJustRegistered(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (tab === "login") {
        await onLogin(username, password);
      } else {
        await onRegister(username, password, serpapiApiKey || undefined);
        setJustRegistered(true);
        setTab("login");
        setPassword("");
      }
    } catch {
      // error state is already surfaced via the `error` prop
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-6 flex justify-center gap-2">
        <TabButton active={tab === "login"} onClick={() => switchTab("login")}>
          {t("auth.tabLogin")}
        </TabButton>
        <TabButton active={tab === "register"} onClick={() => switchTab("register")}>
          {t("auth.tabRegister")}
        </TabButton>
      </div>

      {justRegistered && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{t("auth.registeredMessage")}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">{t("auth.usernameLabel")}</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength={3}
            maxLength={16}
            required
            autoComplete="username"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">
            {tab === "login" ? t("auth.passwordLabelLogin") : t("auth.passwordLabelRegister")}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            maxLength={64}
            required
            autoComplete={tab === "login" ? "current-password" : "new-password"}
            className={INPUT_CLASS}
          />
        </label>

        {tab === "register" && (
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">{t("auth.apiKeyLabel")}</span>
            <input
              type="text"
              value={serpapiApiKey}
              onChange={(e) => setSerpapiApiKey(e.target.value)}
              placeholder={t("auth.apiKeyPlaceholder")}
              className={INPUT_CLASS}
            />
          </label>
        )}

        {tab === "register" && (
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-600">{t("apiKey.howToGetTitle")}</p>
            <p className="mt-1 text-xs text-slate-500">{t("apiKey.howToGetSteps")}</p>
            <a
              href="https://serpapi.com"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-block text-xs font-medium text-sky-600 hover:text-sky-700"
            >
              {t("apiKey.howToGetLink")}
            </a>
          </div>
        )}

        {tab === "register" && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("apiKey.riskWarning")}</p>
        )}

        {tab === "register" && <p className="text-xs text-slate-400">{t("auth.approvalNote")}</p>}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-sky-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:opacity-60"
        >
          {busy ? t("auth.submitBusy") : tab === "login" ? t("auth.submitLogin") : t("auth.submitRegister")}
        </button>
      </form>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}
