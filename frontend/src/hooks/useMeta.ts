"use client";

import { META } from "@/lib/engine/seed";
import type { MetaResponse } from "@/lib/types";

/**
 * Airports/regions/metros now ship with the bundle (engine seed data)
 * instead of coming from GET /api/meta. The {meta, error} shape is kept
 * so SearchForm and the results screen are untouched; error is always
 * null because there is nothing left to fail.
 */
export function useMeta(): { meta: MetaResponse; error: string | null } {
  return { meta: META, error: null };
}
