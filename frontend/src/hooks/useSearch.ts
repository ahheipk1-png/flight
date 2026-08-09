"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSearchState, postSearch } from "@/lib/api";
import type { ItineraryOut, SearchRequestBody, SearchStage } from "@/lib/types";

export type UiState = "idle" | "searching" | "complete" | "results" | "error";

const POLL_INTERVAL_MS = 700;
const COMPLETE_HOLD_MS = 700;

export const STAGE_LABEL: Record<SearchStage, string> = {
  queued: "Getting started…",
  generating: "Checking flexible dates and destinations…",
  pruning: "Narrowing down the best neighborhoods…",
  verifying: "Checking live prices and connections…",
  ranking: "Comparing nearby airports and stopovers…",
  done: "Done",
  error: "Something went wrong",
};

interface SearchResultState {
  itineraries: ItineraryOut[];
  degraded: boolean;
  meta?: { candidate_count: number; candidate_group_count: number; coarse_count: number };
}

export function useSearch() {
  const [uiState, setUiState] = useState<UiState>("idle");
  const [stage, setStage] = useState<SearchStage>("queued");
  const [result, setResult] = useState<SearchResultState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollAbortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    pollAbortRef.current?.abort();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const runSearch = useCallback(
    async (body: SearchRequestBody) => {
      stopPolling();
      setError(null);
      setResult(null);
      setStage("queued");
      setUiState("searching");

      try {
        const { search_id } = await postSearch(body);
        const poll = async () => {
          const controller = new AbortController();
          pollAbortRef.current = controller;
          try {
            const state = await getSearchState(search_id, controller.signal);
            setStage(state.stage);

            if (state.status === "done") {
              setResult({ itineraries: state.itineraries ?? [], degraded: state.degraded, meta: state.meta });
              setUiState("complete");
              timeoutRef.current = setTimeout(() => setUiState("results"), COMPLETE_HOLD_MS);
              return;
            }
            if (state.status === "error") {
              setError(state.error ?? "Search failed");
              setUiState("error");
              return;
            }
            timeoutRef.current = setTimeout(poll, POLL_INTERVAL_MS);
          } catch (err) {
            if (controller.signal.aborted) return;
            setError(err instanceof Error ? err.message : "Search failed");
            setUiState("error");
          }
        };
        await poll();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start search");
        setUiState("error");
      }
    },
    [stopPolling],
  );

  const reset = useCallback(() => {
    stopPolling();
    setUiState("idle");
    setResult(null);
    setError(null);
  }, [stopPolling]);

  return { uiState, stage, result, error, runSearch, reset };
}
