CREATE TABLE IF NOT EXISTS source_cache (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  body_sha1 TEXT NOT NULL,
  body TEXT
);

CREATE TABLE IF NOT EXISTS soft_signals (
  url_hash TEXT NOT NULL,
  fight_id INTEGER,
  fighter_side TEXT,
  fighter_name TEXT,
  signal_type TEXT NOT NULL,
  severity INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  extracted_at TEXT NOT NULL,
  PRIMARY KEY (url_hash, fight_id, fighter_name, signal_type)
);

CREATE INDEX IF NOT EXISTS idx_soft_signals_fight ON soft_signals(fight_id);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT,
  events_processed INTEGER,
  fights_predicted INTEGER,
  predictions_synced INTEGER,
  error TEXT
);

CREATE TABLE IF NOT EXISTS pending_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fight_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
