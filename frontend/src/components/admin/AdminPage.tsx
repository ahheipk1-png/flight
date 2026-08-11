"use client";

import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { AdminAccountOut } from "@/lib/types";

interface AdminPageProps {
  token: string;
  currentUsername: string;
  onBack: () => void;
}

export function AdminPage({ token, currentUsername, onBack }: AdminPageProps) {
  const [accounts, setAccounts] = useState<AdminAccountOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listAccounts(token);
      setAccounts(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load accounts.");
    }
  }, [token]);

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
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load accounts.");
      },
    );
    return () => {
      cancelled = true;
    };
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
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function setPassword(userId: number, username: string) {
    const pw = window.prompt(`New password for ${username} (8+ characters):`);
    if (pw == null) return;
    if (pw.length < 8) {
      window.alert("Password must be at least 8 characters.");
      return;
    }
    setBusyId(userId);
    try {
      await api.adminSetPassword(token, userId, pw);
      window.alert(`Password updated for ${username}.`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusyId(null);
    }
  }

  const pending = accounts?.filter((a) => a.status === "pending") ?? [];
  const others = accounts?.filter((a) => a.status !== "pending") ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Admin — account requests</h1>
        <button type="button" onClick={onBack} className="text-sm font-medium text-sky-600 hover:text-sky-700">
          ← Back to search
        </button>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {accounts === null && !error && <p className="text-sm text-slate-400">Loading…</p>}

      {accounts !== null && (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">
              Waiting for approval ({pending.length})
            </h2>
            {pending.length === 0 && <p className="text-sm text-slate-400">No accounts waiting.</p>}
            <div className="space-y-2">
              {pending.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{a.username}</p>
                    <p className="text-xs text-slate-400">
                      requested {new Date(a.created_at).toLocaleString()} · {a.has_api_key ? "provided a key" : "no key yet"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <ActionButton onClick={() => act(a.id, "approve")} disabled={busyId === a.id} variant="primary">
                      Approve
                    </ActionButton>
                    <ActionButton onClick={() => act(a.id, "deny")} disabled={busyId === a.id} variant="ghost">
                      Deny
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">All accounts ({others.length})</h2>
            <div className="space-y-2">
              {others.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {a.username} <StatusBadge status={a.status} isAdmin={a.is_admin} />
                    </p>
                    <p className="text-xs text-slate-400">{a.has_api_key ? "has a key" : "no key"}</p>
                  </div>
                  <div className="flex gap-2">
                    <ActionButton onClick={() => setPassword(a.id, a.username)} disabled={busyId === a.id} variant="ghost">
                      Set password
                    </ActionButton>
                    {a.status === "approved" && !a.is_admin && a.username !== currentUsername && (
                      <ActionButton onClick={() => act(a.id, "disable")} disabled={busyId === a.id} variant="ghost">
                        Disable
                      </ActionButton>
                    )}
                    {a.status !== "approved" && (
                      <ActionButton onClick={() => act(a.id, "approve")} disabled={busyId === a.id} variant="primary">
                        Approve
                      </ActionButton>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status, isAdmin }: { status: string; isAdmin: boolean }) {
  return (
    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
      {status}
      {isAdmin ? " · admin" : ""}
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
