"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";

interface ApiKeySettingsProps {
  hasApiKey: boolean;
  onSave: (key: string) => Promise<void>;
  onClear: () => Promise<void>;
  /** "gate" = shown as a required step before searching; "settings" = shown inside an already-usable app */
  variant?: "gate" | "settings";
}

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none";

export function ApiKeySettings({ hasApiKey, onSave, onClear, variant = "settings" }: ApiKeySettingsProps) {
  const { t } = useLocale();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedJustNow, setSavedJustNow] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(key.trim());
      setKey("");
      setSavedJustNow(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("apiKey.saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setBusy(true);
    setError(null);
    try {
      await onClear();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("apiKey.removeError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={variant === "gate" ? "mx-auto max-w-md text-center" : "max-w-md"}>
      {variant === "gate" && (
        <>
          <h2 className="text-lg font-semibold text-slate-800">{t("apiKey.gateTitle")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("apiKey.gateSubtitle")}</p>
          <p className="mt-2 text-xs text-slate-400">{t("apiKey.demoHint")}</p>

          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-left">
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
        </>
      )}

      {hasApiKey && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-left text-sm text-emerald-700">
          {t("apiKey.savedNote")} {variant === "settings" && t("apiKey.replaceNote")}
        </p>
      )}
      {savedJustNow && variant === "gate" && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{t("apiKey.savedJustNow")}</p>
      )}

      <form onSubmit={handleSave} className="mt-4 space-y-3 text-left">
        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">{t("apiKey.fieldLabel")}</span>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("apiKey.fieldPlaceholder")}
            className={INPUT_CLASS}
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || !key.trim()}
            className="flex-1 rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:opacity-60"
          >
            {busy ? t("apiKey.saveBtnBusy") : hasApiKey ? t("apiKey.replaceBtn") : t("apiKey.saveBtn")}
          </button>
          {hasApiKey && (
            <button
              type="button"
              onClick={handleClear}
              disabled={busy}
              className="rounded-full bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-60"
            >
              {t("apiKey.removeBtn")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
