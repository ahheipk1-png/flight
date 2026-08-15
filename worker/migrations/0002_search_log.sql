-- One row per proxied SerpApi call, giving the admin dashboard per-user
-- usage counts and a searchable history. Granularity note: one search in
-- the UI fans out into several proxied calls (the verification batch, or
-- one call per multi-city leg), and each row here is one PAID SerpApi
-- call -- so counts read as quota spent, which is the number an admin
-- actually cares about.

CREATE TABLE search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  -- SerpApi's trip type: '1' round trip, '2' one-way, '3' multi-city.
  trip_type TEXT,
  departure_id TEXT,
  arrival_id TEXT,
  outbound_date TEXT,
  return_date TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_search_log_user_created ON search_log(user_id, created_at DESC);
-- For the retention sweep in the daily cron.
CREATE INDEX idx_search_log_created ON search_log(created_at);
