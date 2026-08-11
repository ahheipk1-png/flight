"use client";

import { useState } from "react";

interface AuthFormsProps {
  onRegister: (username: string, password: string, serpapiApiKey?: string) => Promise<string>;
  onLogin: (username: string, password: string) => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none";

export function AuthForms({ onRegister, onLogin, error, clearError }: AuthFormsProps) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [serpapiApiKey, setSerpapiApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [registeredMessage, setRegisteredMessage] = useState<string | null>(null);

  function switchTab(t: "login" | "register") {
    setTab(t);
    clearError();
    setRegisteredMessage(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (tab === "login") {
        await onLogin(username, password);
      } else {
        const message = await onRegister(username, password, serpapiApiKey || undefined);
        setRegisteredMessage(message);
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
          Log in
        </TabButton>
        <TabButton active={tab === "register"} onClick={() => switchTab("register")}>
          Request account
        </TabButton>
      </div>

      {registeredMessage && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{registeredMessage}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">Username</span>
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
          <span className="mb-1 block text-sm text-slate-600">{tab === "login" ? "Password" : "Choose a password (8+ characters)"}</span>
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
            <span className="mb-1 block text-sm text-slate-600">Your own SerpApi key (optional now, required to search)</span>
            <input
              type="text"
              value={serpapiApiKey}
              onChange={(e) => setSerpapiApiKey(e.target.value)}
              placeholder="Can add this later in Settings"
              className={INPUT_CLASS}
            />
          </label>
        )}

        {tab === "register" && (
          <p className="text-xs text-slate-400">An admin approves new accounts before your first log-in.</p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-sky-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:opacity-60"
        >
          {busy ? "Please wait…" : tab === "login" ? "Log in" : "Request account"}
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
