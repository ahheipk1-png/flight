"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MOCK_API_KEY, mockProvider } from "@/lib/engine/mock";
import { EngineError, runFlexibleSearch, runMultiCitySearch, type SearchOutcome } from "@/lib/engine/pipeline";
import { buildSerpApiProvider } from "@/lib/engine/serpapi";
import { useLocale } from "@/lib/i18n/LocaleContext";
import type { SearchStage, SearchSubmission } from "@/lib/types";

export type UiState = "idle" | "searching" | "complete" | "results" | "error";

const COMPLETE_HOLD_MS = 700;

/**
 * Same idle -> searching -> complete -> results state machine as before,
 * but the search runs in-process now: the engine (src/lib/engine/) calls
 * back with stage transitions directly instead of the old
 * POST-then-poll-Redis loop against the Python backend.
 */
export function useSearch() {
  const { t } = useLocale();
  const [uiState, setUiState] = useState<UiState>("idle");
  const [stage, setStage] = useState<SearchStage>("queued");
  const [result, setResult] = useState<SearchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopSearch = useCallback(() => {
    abortRef.current?.abort();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  useEffect(() => stopSearch, [stopSearch]);

  const runSearch = useCallback(
    async (submission: SearchSubmission, apiKey: string) => {
      stopSearch();
      setError(null);
      setResult(null);
      setStage("queued");
      setUiState("searching");

      const controller = new AbortController();
      abortRef.current = controller;
      const provider = apiKey === MOCK_API_KEY ? mockProvider : buildSerpApiProvider(apiKey);
      const opts = { provider, onStage: setStage, signal: controller.signal };

      try {
        const outcome =
          submission.tripType === "multi_city"
            ? await runMultiCitySearch(submission.body, opts)
            : await runFlexibleSearch(submission.body, opts);
        if (controller.signal.aborted) return;
        setStage("done");
        setResult(outcome);
        setUiState("complete");
        timeoutRef.current = setTimeout(() => setUiState("results"), COMPLETE_HOLD_MS);
      } catch (err) {
        if (controller.signal.aborted) return;
        setStage("error");
        if (err instanceof EngineError) {
          setError(t(err.key, err.params));
        } else {
          setError(err instanceof Error ? err.message : "Search failed");
        }
        setUiState("error");
      }
    },
    [stopSearch, t],
  );

  const reset = useCallback(() => {
    stopSearch();
    setUiState("idle");
    setResult(null);
    setError(null);
  }, [stopSearch]);

  return { uiState, stage, result, error, runSearch, reset };
}
