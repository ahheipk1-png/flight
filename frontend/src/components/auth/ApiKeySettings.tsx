"use client";

import { useState } from "react";

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
      setError(err instanceof Error ? err.message : "Could not save the key.");
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
      setError(err instanceof Error ? err.message : "Could not remove the key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={variant === "gate" ? "mx-auto max-w-md text-center" : "max-w-md"}>
      {variant === "gate" && (
        <>
          <h2 className="text-lg font-semibold text-slate-800">Add your SerpApi key to search</h2>
          <p className="mt-1 text-sm text-slate-500">
            There&apos;s no shared key — every search runs on your own SerpApi account. Free plans include 250
            searches/month.
          </p>
        </>
      )}

      {hasApiKey && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-left text-sm text-emerald-700">
          A key is saved on your account. {variant === "settings" && "Paste a new one below to replace it."}
        </p>
      )}
      {savedJustNow && variant === "gate" && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Saved — you can search now.</p>
      )}

      <form onSubmit={handleSave} className="mt-4 space-y-3 text-left">
        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">SerpApi key</span>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your key from serpapi.com"
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
            {busy ? "Saving…" : hasApiKey ? "Replace key" : "Save key"}
          </button>
          {hasApiKey && (
            <button
              type="button"
              onClick={handleClear}
              disabled={busy}
              className="rounded-full bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-60"
            >
              Remove
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
