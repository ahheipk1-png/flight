/** Per-user usage logging for the admin dashboard. Each row = one paid
 * SerpApi call (a UI search fans out into several), so counts read as
 * quota spent. */

export interface SearchLogRow {
  id: number;
  trip_type: string | null;
  departure_id: string | null;
  arrival_id: string | null;
  outbound_date: string | null;
  return_date: string | null;
  created_at: string;
}

interface RouteSummary {
  trip_type: string | null;
  departure_id: string | null;
  arrival_id: string | null;
  outbound_date: string | null;
  return_date: string | null;
}

/** Pulls a displayable route out of the proxied params. Multi-city
 * (type 3) carries its legs in multi_city_json instead of top-level
 * fields, so summarize it as first-departure -> last-arrival across the
 * legs' date span. */
export function summarizeParams(params: Record<string, string>): RouteSummary {
  if (params.type === "3" && params.multi_city_json) {
    try {
      const legs = JSON.parse(params.multi_city_json) as {
        departure_id?: string;
        arrival_id?: string;
        date?: string;
      }[];
      if (Array.isArray(legs) && legs.length > 0) {
        return {
          trip_type: "3",
          departure_id: legs[0]?.departure_id ?? null,
          arrival_id: legs[legs.length - 1]?.arrival_id ?? null,
          outbound_date: legs[0]?.date ?? null,
          return_date: legs[legs.length - 1]?.date ?? null,
        };
      }
    } catch {
      // fall through to the generic shape below
    }
  }
  return {
    trip_type: params.type ?? null,
    departure_id: params.departure_id ?? null,
    arrival_id: params.arrival_id ?? null,
    outbound_date: params.outbound_date ?? null,
    return_date: params.return_date ?? null,
  };
}

export async function logSearchCall(db: D1Database, userId: number, params: Record<string, string>): Promise<void> {
  const s = summarizeParams(params);
  await db
    .prepare(
      "INSERT INTO search_log (user_id, trip_type, departure_id, arrival_id, outbound_date, return_date, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(userId, s.trip_type, s.departure_id, s.arrival_id, s.outbound_date, s.return_date, new Date().toISOString())
    .run();
}

export async function recentSearches(db: D1Database, userId: number, limit = 50): Promise<SearchLogRow[]> {
  const { results } = await db
    .prepare(
      "SELECT id, trip_type, departure_id, arrival_id, outbound_date, return_date, created_at " +
        "FROM search_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .bind(userId, limit)
    .all<SearchLogRow>();
  return results;
}

const RETENTION_DAYS = 90;

/** Called from the daily cron. Usage counts only ever claim to cover the
 * retention window, so trimming old rows is safe. */
export async function sweepOldSearchLogs(db: D1Database): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  await db.prepare("DELETE FROM search_log WHERE created_at < ?").bind(cutoff).run();
}
