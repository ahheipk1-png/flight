export type Locale = "zh-Hant" | "zh-Hans" | "en";

export const LOCALES: Locale[] = ["zh-Hant", "zh-Hans", "en"];
const STORAGE_KEY = "smartflighterLocale";

export function isLocale(value: string): value is Locale {
  return (LOCALES as string[]).includes(value);
}

/**
 * Traditional Chinese is the stated default for this site (not English) --
 * detection only exists to correctly catch Simplified-Chinese-preferring
 * visitors (zh-CN/zh-SG/zh-Hans) rather than showing them Traditional too.
 * Everything else -- English, any other language, or no signal at all --
 * falls back to Traditional Chinese, matching that explicit default.
 */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return "zh-Hant";
  const candidates = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const raw of candidates) {
    const lower = (raw || "").toLowerCase();
    if (!lower.startsWith("zh")) continue;
    if (lower.includes("cn") || lower.includes("sg") || lower.includes("hans")) return "zh-Hans";
    return "zh-Hant"; // zh-TW, zh-HK, zh-MO, zh-Hant, or bare "zh"
  }
  return "zh-Hant";
}

export function loadStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function saveStoredLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // localStorage unavailable (private browsing, etc.) -- the choice just
    // won't survive a refresh; not fatal to the current page load.
  }
}
