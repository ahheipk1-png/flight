"use client";

import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { AccountStatus } from "@/lib/types";

// localStorage, not an httpOnly cookie -- deliberately matches the
// reference app's pattern (Authorization: Bearer header) rather than
// cookies, which sidesteps SameSite/cross-origin complexity once the
// frontend and backend end up on different real domains in production.
const STORAGE_KEY = "smartflighterAuthSession";

interface StoredSession {
  token: string;
  username: string;
  isAdmin: boolean;
}

function loadStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveStoredSession(s: StoredSession | null) {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (private browsing, etc.) -- session just
    // won't survive a refresh; not fatal to the current page load.
  }
}

export function useAuth() {
  // token/username/isAdmin/loading all seed from localStorage via lazy
  // useState initializers -- computed once, synchronously, at mount --
  // rather than starting empty and setting them from inside the effect
  // below. That leaves the effect with no synchronous setState call in
  // its own body at all (only inside .catch/.finally, after a real async
  // boundary), matching the pattern useMeta.ts already uses.
  const [token, setToken] = useState<string | null>(() => loadStoredSession()?.token ?? null);
  const [username, setUsername] = useState<string | null>(() => loadStoredSession()?.username ?? null);
  const [isAdmin, setIsAdmin] = useState(() => loadStoredSession()?.isAdmin ?? false);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [loading, setLoading] = useState(() => !!loadStoredSession());
  const [error, setError] = useState<string | null>(null);

  const refreshMe = useCallback(async (activeToken: string) => {
    const me = await api.getMe(activeToken);
    setUsername(me.username);
    setIsAdmin(me.is_admin);
    setStatus(me.status);
    setHasApiKey(me.has_api_key);
  }, []);

  useEffect(() => {
    const stored = loadStoredSession();
    if (!stored) return; // loading was already initialized to false in this case
    // Inlined rather than calling refreshMe(stored.token) directly: the
    // linter flags a top-level effect-body call to ANY function that
    // eventually setStates, even past a real await inside it -- it
    // doesn't trace that far. An inline .then/.catch literal (as here,
    // and in AdminPage.tsx's load effect) is what it recognizes as
    // properly deferred. refreshMe itself is still used as-is by login().
    let cancelled = false;
    api.getMe(stored.token).then(
      (me) => {
        if (cancelled) return;
        setUsername(me.username);
        setIsAdmin(me.is_admin);
        setStatus(me.status);
        setHasApiKey(me.has_api_key);
        setLoading(false);
      },
      () => {
        // Stored token is stale/expired -- drop it silently, back to logged-out.
        if (cancelled) return;
        saveStoredSession(null);
        setToken(null);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const register = useCallback(async (u: string, p: string, serpapiApiKey?: string) => {
    setError(null);
    try {
      const r = await api.registerAccount(u, p, serpapiApiKey);
      return r.message;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request an account.");
      throw err;
    }
  }, []);

  const login = useCallback(
    async (u: string, p: string) => {
      setError(null);
      try {
        const session = await api.login(u, p);
        const stored: StoredSession = { token: session.token, username: session.username, isAdmin: session.is_admin };
        saveStoredSession(stored);
        setToken(session.token);
        await refreshMe(session.token);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login failed.");
        throw err;
      }
    },
    [refreshMe],
  );

  const logout = useCallback(async () => {
    if (token) {
      try {
        await api.logout(token);
      } catch {
        // best-effort -- log out locally regardless of whether the server call succeeded
      }
    }
    saveStoredSession(null);
    setToken(null);
    setUsername(null);
    setIsAdmin(false);
    setStatus(null);
    setHasApiKey(false);
  }, [token]);

  const saveApiKey = useCallback(
    async (key: string) => {
      if (!token) return;
      await api.setApiKey(token, key);
      setHasApiKey(true);
    },
    [token],
  );

  const removeApiKey = useCallback(async () => {
    if (!token) return;
    await api.clearApiKey(token);
    setHasApiKey(false);
  }, [token]);

  return {
    token,
    username,
    isAdmin,
    status,
    hasApiKey,
    loading,
    error,
    clearError,
    register,
    login,
    logout,
    saveApiKey,
    removeApiKey,
  };
}
