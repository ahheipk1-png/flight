-- Accounts + sessions. Ported from the Python reference's schema
-- (backend/app/models/auth.py + alembic 0002_users.py), adapted to
-- SQLite/D1.
--
-- Timestamps are ISO-8601 strings written by the Worker
-- (new Date().toISOString()), NOT SQLite's DEFAULT CURRENT_TIMESTAMP --
-- that produces "YYYY-MM-DD HH:MM:SS" which neither round-trips through
-- JS Date cleanly nor sorts identically to the ISO strings used
-- everywhere else in this app.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Stored already normalized (trimmed + lowercased) by the Worker, so
  -- UNIQUE is enough; no COLLATE NOCASE, matching the reference's
  -- application-level normalize_username().
  username TEXT NOT NULL UNIQUE,
  -- PBKDF2, self-describing "pbkdf2$<iters>$<salt>$<hash>". One-way.
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'disabled')),
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  -- AES-GCM ciphertext "<iv>.<ct>", NOT a hash: search needs the real
  -- key back. Nullable -- an approved user may not have added one yet.
  serpapi_api_key_encrypted TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
-- Keeps the daily cron sweep's DELETE from scanning the whole table.
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
