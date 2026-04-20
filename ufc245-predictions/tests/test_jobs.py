"""Integration-style tests for prediction job orchestration."""
import os
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, UTC

import numpy as np

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jobs  # noqa: E402
from db import init_db, log_prediction, get_unsynced_predictions  # noqa: E402


@contextmanager
def patched(module, attr, replacement):
    original = getattr(module, attr)
    setattr(module, attr, replacement)
    try:
        yield
    finally:
        setattr(module, attr, original)


def test_daily_predict_marks_only_current_batch_synced():
    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ["PREDICTIONS_DB_PATH"] = os.path.join(tmpdir, "predictions.db")
        init_db()
        upcoming_date = (datetime.now(UTC).date() + timedelta(days=1)).isoformat()

        backlog_id = log_prediction(
            fight_id=9001,
            red_id=1,
            blue_id=2,
            red_prob=0.51,
            blue_prob=0.49,
            model_version="v.backlog",
            feature_hash="old",
            event_date="2026-01-01",
        )

        def fake_get_json(path):
            if path == "/api/events":
                return [{"id": 77, "date": upcoming_date}]
            if path == "/api/events/77/card":
                return {"card": [{"id": 700, "red_id": 11, "blue_id": 22}]}
            if path.startswith("/api/fighters/11/career-stats"):
                return {"fighter": {"reach_cm": 190, "height_cm": 180}, "stats": {"total_fights": 10}}
            if path.startswith("/api/fighters/22/career-stats"):
                return {"fighter": {"reach_cm": 185, "height_cm": 178}, "stats": {"total_fights": 12}}
            return None

        sent_payloads = []

        def fake_post_json(path, body):
            sent_payloads.append((path, body))
            return {"status": "ok"}

        with patched(jobs, "_get_json", fake_get_json), \
                patched(jobs, "_post_json", fake_post_json), \
                patched(jobs, "get_latest_model", lambda: {"blob_path": "unused", "version": "v.test"}), \
                patched(jobs, "load_model", lambda _p: object()), \
                patched(jobs, "engineer_features", lambda *_a, **_k: np.zeros(12)), \
                patched(jobs, "feature_hash", lambda _x: "hash123"), \
                patched(jobs, "predict", lambda _pipe, _x: (0.6, 0.4)):
            jobs.daily_predict()

        assert sent_payloads, "Expected a sync payload to be sent"
        unsynced = get_unsynced_predictions()
        assert len(unsynced) == 1, f"Expected only backlog row unsynced, got {len(unsynced)}"
        assert unsynced[0]["id"] == backlog_id, "Backlog row should remain unsynced"
        print("  PASS: daily_predict marks only current batch rows synced")


def test_weekly_retrain_uses_point_in_time_as_of():
    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ["PREDICTIONS_DB_PATH"] = os.path.join(tmpdir, "predictions.db")
        init_db()

        requested_paths = []

        def fake_get_json(path):
            requested_paths.append(path)
            if path == "/api/events":
                return [{"id": 12, "date": "2024-08-10"}]
            if path == "/api/events/12/card":
                return {
                    "card": [
                        {"id": 1201, "red_id": 101, "blue_id": 202, "winner_id": 101}
                    ]
                }
            if "/api/fighters/101/career-stats?as_of=2024-08-10" in path:
                return {"fighter": {"reach_cm": 190, "height_cm": 180}, "stats": {"total_fights": 8}}
            if "/api/fighters/202/career-stats?as_of=2024-08-10" in path:
                return {"fighter": {"reach_cm": 185, "height_cm": 178}, "stats": {"total_fights": 9}}
            return None

        with patched(jobs, "_get_json", fake_get_json):
            jobs.weekly_retrain()

        assert any("/api/fighters/101/career-stats?as_of=2024-08-10" in p for p in requested_paths)
        assert any("/api/fighters/202/career-stats?as_of=2024-08-10" in p for p in requested_paths)
        print("  PASS: weekly_retrain requests as_of point-in-time stats")


if __name__ == "__main__":
    print("\n=== UFC Predictions Job Tests ===\n")
    test_daily_predict_marks_only_current_batch_synced()
    test_weekly_retrain_uses_point_in_time_as_of()
    print("\n=== All 2 job tests passed ===\n")
