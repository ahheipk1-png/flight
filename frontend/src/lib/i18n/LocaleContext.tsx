"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { detectBrowserLocale, loadStoredLocale, saveStoredLocale, type Locale } from "./locale";
import { en, zhHant, zhHans, type MessageKey } from "./messages";

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = {
  "zh-Hant": zhHant,
  "zh-Hans": zhHans,
  en,
};

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // "zh-Hant" for the server render and this component's first client
  // render (must match to avoid a hydration mismatch) -- the effect below
  // then swaps in the stored/detected value shortly after mount, deferred
  // past a microtask so this doesn't read as a synchronous setState call
  // directly in the effect body (see useAuth.ts for the same reasoning).
  const [locale, setLocaleState] = useState<Locale>("zh-Hant");

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLocaleState(loadStoredLocale() ?? detectBrowserLocale());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function setLocale(next: Locale) {
    setLocaleState(next);
    saveStoredLocale(next);
  }

  function t(key: MessageKey, params?: Record<string, string | number>): string {
    return format(DICTIONARIES[locale][key], params);
  }

  return <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within a LocaleProvider");
  return ctx;
}
