"""SQLite DAO. One file, no ORM."""
from __future__ import annotations
import hashlib
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

SCHEMA = (Path(__file__).parent / "schema.sql").read_text()


def _sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


class Store:
    """SQLite DAO. Schema auto-initialized on construction. Thread-safe per
    process via short-lived connections. Pass auto_init=False to defer."""

    def __init__(self, path: str, *, auto_init: bool = True):
        self.path = path
        if auto_init:
            self.init()

    def _conn(self) -> sqlite3.Connection:
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        c = sqlite3.connect(self.path)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        return c

    def init(self) -> None:
        with self._conn() as c:
            c.executescript(SCHEMA)

    # --- source cache ---
    def upsert_source(self, url: str, source_type: str, body: str) -> str:
        url_hash = _sha1(url)
        body_sha = _sha1(body)
        now = datetime.utcnow().isoformat()
        with self._conn() as c:
            c.execute(
                """INSERT INTO source_cache (url_hash, url, source_type, fetched_at, body_sha1, body)
                   VALUES (?,?,?,?,?,?)
                   ON CONFLICT(url_hash) DO UPDATE SET
                     fetched_at=excluded.fetched_at, body_sha1=excluded.body_sha1, body=excluded.body""",
                (url_hash, url, source_type, now, body_sha, body),
            )
        return url_hash

    def get_source(self, url: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM source_cache WHERE url_hash = ?", (_sha1(url),)).fetchone()
            return dict(row) if row else None

    def is_body_unchanged(self, url: str, body: str) -> bool:
        cached = self.get_source(url)
        return bool(cached and cached["body_sha1"] == _sha1(body))

    # --- signals ---
    def write_signals(self, url: str, fight_id: int | None, signals: list[dict]) -> int:
        url_hash = _sha1(url)
        now = datetime.utcnow().isoformat()
        n = 0
        with self._conn() as c:
            # Replace prior signals for (url, fight) pair so re-extraction is idempotent.
            c.execute("DELETE FROM soft_signals WHERE url_hash = ? AND COALESCE(fight_id, -1) = COALESCE(?, -1)",
                      (url_hash, fight_id))
            for s in signals:
                c.execute(
                    """INSERT OR REPLACE INTO soft_signals
                       (url_hash, fight_id, fighter_side, fighter_name, signal_type, severity, evidence, extracted_at)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    (url_hash, fight_id, s.get("fighter_side"), s.get("fighter") or "_",
                     s["type"], int(s["severity"]), s["evidence"], now),
                )
                n += 1
        return n

    def signals_for_fight(self, fight_id: int) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM soft_signals WHERE fight_id = ?", (fight_id,)).fetchall()
            return [dict(r) for r in rows]

    # --- pending sync ---
    def queue_pending(self, fight_id: int, payload: dict) -> int:
        now = datetime.utcnow().isoformat()
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO pending_sync (fight_id, payload_json, created_at) VALUES (?,?,?)",
                (fight_id, json.dumps(payload), now),
            )
            return cur.lastrowid

    def get_pending(self, limit: int = 100) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM pending_sync ORDER BY id ASC LIMIT ?", (limit,)).fetchall()
            return [{"id": r["id"], "fight_id": r["fight_id"], "payload": json.loads(r["payload_json"]),
                     "attempts": r["attempts"], "last_error": r["last_error"]} for r in rows]

    def mark_pending_done(self, pending_id: int) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM pending_sync WHERE id = ?", (pending_id,))

    def mark_pending_failed(self, pending_id: int, error: str) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE pending_sync SET attempts = attempts + 1, last_error = ? WHERE id = ?",
                (error[:1000], pending_id),
            )

    # --- run log ---
    def start_run(self) -> int:
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO pipeline_runs (started_at) VALUES (?)",
                (datetime.utcnow().isoformat(),),
            )
            return cur.lastrowid

    def finish_run(self, run_id: int, *, status: str, events_processed: int = 0,
                   fights_predicted: int = 0, predictions_synced: int = 0,
                   error: str | None = None) -> None:
        with self._conn() as c:
            c.execute(
                """UPDATE pipeline_runs SET finished_at=?, status=?, events_processed=?,
                   fights_predicted=?, predictions_synced=?, error=? WHERE id=?""",
                (datetime.utcnow().isoformat(), status, events_processed, fights_predicted,
                 predictions_synced, error, run_id),
            )

    def recent_runs(self, limit: int = 20) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM pipeline_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
            return [dict(r) for r in rows]
