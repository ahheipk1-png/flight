"use client";

import { useEffect, useState } from "react";
import { getMeta } from "@/lib/api";
import type { MetaResponse } from "@/lib/types";

export function useMeta() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getMeta(controller.signal)
      .then(setMeta)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load airports");
      });
    return () => controller.abort();
  }, []);

  return { meta, error };
}
