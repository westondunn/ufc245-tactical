"""Local SQLite storage for model blobs and prediction history."""
import sqlite3
import os
import json
from datetime import datetime

DEFAULT_DB_PATH = "predictions.db"


def get_conn() -> sqlite3.Connection:
    db_path = os.getenv("PREDICTIONS_DB_PATH", DEFAULT_DB_PATH)
    db_dir = os.path.dirname(os.path.abspath(db_path))
    if db_dir and db_dir != ".":
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS model_blobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT NOT NULL UNIQUE,
            blob_path TEXT NOT NULL,
            features TEXT,
            accuracy REAL,
            n_train INTEGER,
            trained_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS prediction_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fight_id INTEGER NOT NULL,
            red_fighter_id INTEGER,
            blue_fighter_id INTEGER,
            red_win_prob REAL NOT NULL,
            blue_win_prob REAL NOT NULL,
            model_version TEXT NOT NULL,
            feature_hash TEXT,
            explanation_json TEXT,
            predicted_method TEXT,
            predicted_round INTEGER,
            predicted_at TEXT NOT NULL,
            event_date TEXT,
            synced INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_pred_log_fight ON prediction_log(fight_id);
        CREATE INDEX IF NOT EXISTS idx_pred_log_synced ON prediction_log(synced);
    """)
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(prediction_log)").fetchall()}
    if "explanation_json" not in cols:
        conn.execute("ALTER TABLE prediction_log ADD COLUMN explanation_json TEXT")
    if "predicted_method" not in cols:
        conn.execute("ALTER TABLE prediction_log ADD COLUMN predicted_method TEXT")
    if "predicted_round" not in cols:
        conn.execute("ALTER TABLE prediction_log ADD COLUMN predicted_round INTEGER")
    conn.commit()
    conn.close()


def save_model_record(version: str, blob_path: str, features: list[str],
                      accuracy: float, n_train: int):
    conn = get_conn()
    conn.execute(
        """INSERT OR REPLACE INTO model_blobs
           (version, blob_path, features, accuracy, n_train, trained_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (version, blob_path, json.dumps(features), accuracy, n_train,
         datetime.utcnow().isoformat())
    )
    conn.commit()
    conn.close()


def get_latest_model() -> dict | None:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM model_blobs ORDER BY trained_at DESC LIMIT 1"
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def log_prediction(fight_id: int, red_id: int, blue_id: int,
                   red_prob: float, blue_prob: float,
                   model_version: str, feature_hash: str,
                   event_date: str | None = None,
                   explanation: dict | None = None,
                   predicted_method: str | None = None,
                   predicted_round: int | None = None) -> int:
    conn = get_conn()
    explanation_json = json.dumps(explanation) if explanation is not None else None
    cursor = conn.execute(
        """INSERT INTO prediction_log
           (fight_id, red_fighter_id, blue_fighter_id, red_win_prob,
            blue_win_prob, model_version, feature_hash, explanation_json,
            predicted_method, predicted_round, predicted_at, event_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (fight_id, red_id, blue_id, red_prob, blue_prob,
         model_version, feature_hash, explanation_json, predicted_method, predicted_round,
         datetime.utcnow().isoformat(), event_date)
    )
    conn.commit()
    conn.close()
    return int(cursor.lastrowid)


def get_unsynced_predictions(limit: int | None = None) -> list[dict]:
    conn = get_conn()
    sql = "SELECT * FROM prediction_log WHERE synced = 0 ORDER BY predicted_at"
    params: tuple = ()
    if limit is not None and limit > 0:
        sql += " LIMIT ?"
        params = (limit,)
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def mark_synced(pred_ids: list[int]):
    if not pred_ids:
        return
    conn = get_conn()
    placeholders = ",".join("?" * len(pred_ids))
    conn.execute(
        f"UPDATE prediction_log SET synced = 1 WHERE id IN ({placeholders})",
        pred_ids
    )
    conn.commit()
    conn.close()
