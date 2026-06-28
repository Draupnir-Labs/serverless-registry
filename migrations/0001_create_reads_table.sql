-- Read attribution for analytics. One row per authenticated pull (GET/HEAD) on
-- the registry. Inserted fire-and-forget from the Worker; insert failures are
-- swallowed by the Worker so analytics can never break a pull.
CREATE TABLE IF NOT EXISTS reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  repository TEXT,
  kind TEXT,
  status INTEGER NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reads_credential_ts ON reads (credential_id, ts);
CREATE INDEX IF NOT EXISTS idx_reads_repository_ts ON reads (repository, ts);
