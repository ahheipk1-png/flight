"use client";

import { useEffect, useState } from "react";
import { MOCK_API_KEY } from "@/lib/engine/mock";

const STORAGE_KEY = "smartflighterSerpApiKey";

/**
 * The lightweight build's entire "account system": the visitor's own
 * SerpApi key, kept in their own browser's localStorage. It is sent
 * per-request to the Worker proxy (which attaches it server-side and
 * stores nothing) and never leaves this device otherwise. The literal
 * key "demo" switches every search to the built-in deterministic mock
 * provider -- full UI, zero quota spent.
 */
export function useApiKey() {
  // Starts null+loading on the server AND the first client render (the
  // static export prerenders with no storage access), then the effect
  // swaps in the stored key just after mount -- same hydration-safety
  // pattern as LocaleProvider, including deferring the setState past a
  // microtask so the set-state-in-effect lint recognizes it as async.
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        setApiKey(window.localStorage.getItem(STORAGE_KEY));
      } catch {
        setApiKey(null);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function saveApiKey(key: string): void {
    const trimmed = key.trim();
    if (!trimmed) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      // Storage unavailable (private mode etc.) -- keep it for the session.
    }
    setApiKey(trimmed);
  }

  function removeApiKey(): void {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setApiKey(null);
  }

  return {
    apiKey,
    hasApiKey: apiKey !== null && apiKey !== "",
    isDemo: apiKey === MOCK_API_KEY,
    loading,
    saveApiKey,
    removeApiKey,
  };
}
