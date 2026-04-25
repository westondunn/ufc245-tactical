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
from model import FEATURE_NAMES  # noqa: E402


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
                patched(jobs, "engineer_features", lambda *_a, **_k: np.zeros(len(FEATURE_NAMES))), \
                patched(jobs, "feature_hash", lambda _x: "hash123"), \
                patched(jobs, "predict", lambda _pipe, _x: (0.6, 0.4)), \
                patched(jobs, "explain_prediction", lambda *_a, **_k: {"summary": "Red pressure", "factors": []}):
            result = jobs.daily_predict()

        assert result["status"] == "ok"
        assert result["predicted"] == 1
        assert result["synced"] == 1
        assert sent_payloads, "Expected a sync payload to be sent"
        assert sent_payloads[0][1]["predictions"][0]["explanation"]["summary"] == "Red pressure"
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
            result = jobs.weekly_retrain()

        assert any("/api/fighters/101/career-stats?as_of=2024-08-10" in p for p in requested_paths)
        assert any("/api/fighters/202/career-stats?as_of=2024-08-10" in p for p in requested_paths)
        assert result["status"] == "skipped"
        assert result["reason"] == "insufficient_labeled_fights"
        print("  PASS: weekly_retrain requests as_of point-in-time stats")


def test_daily_predict_reports_no_model():
    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ["PREDICTIONS_DB_PATH"] = os.path.join(tmpdir, "predictions.db")
        init_db()

        with patched(jobs, "get_latest_model", lambda: None):
            result = jobs.daily_predict()

        assert result["status"] == "skipped"
        assert result["reason"] == "no_model"
        assert result["predicted"] == 0
        print("  PASS: daily_predict reports no model")


def test_sync_unsynced_marks_posted_rows_only():
    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ["PREDICTIONS_DB_PATH"] = os.path.join(tmpdir, "predictions.db")
        init_db()

        id1 = log_prediction(1001, 10, 20, 0.6, 0.4, "v.sync", "h1", "2026-02-01")
        id2 = log_prediction(1002, 11, 21, 0.55, 0.45, "v.sync", "h2", "2026-02-02")
        id3 = log_prediction(1003, 12, 22, 0.52, 0.48, "v.sync", "h3", "2026-02-03")

        posted = []

        def fake_post_json(path, body):
            posted.append((path, body))
            return {"status": "ok"}

        with patched(jobs, "_post_json", fake_post_json):
            synced = jobs.sync_unsynced(limit=2)

        assert synced == 2
        assert posted, "Expected sync payload"
        payload = posted[0][1]["predictions"]
        sent_ids = {p["fight_id"] for p in payload}
        assert sent_ids == {1001, 1002}

        unsynced_after = get_unsynced_predictions()
        unsynced_ids = {row["id"] for row in unsynced_after}
        assert id3 in unsynced_ids
        assert id1 not in unsynced_ids and id2 not in unsynced_ids
        print("  PASS: sync_unsynced only marks posted rows")


if __name__ == "__main__":
    print("\n=== UFC Predictions Job Tests ===\n")
    test_daily_predict_marks_only_current_batch_synced()
    test_weekly_retrain_uses_point_in_time_as_of()
    test_daily_predict_reports_no_model()
    test_sync_unsynced_marks_posted_rows_only()
    print("\n=== All 4 job tests passed ===\n")
