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
                patched(jobs, "explain_prediction", lambda *_a, **_k: {
                    "summary": "Red pressure",
                    "factors": [],
                    "prediction": {"method": "KO/TKO", "round": "R2"},
                }):
            result = jobs.daily_predict()

        assert result["status"] == "ok"
        assert result["predicted"] == 1
        assert result["synced"] == 1
        assert sent_payloads, "Expected a sync payload to be sent"
        assert sent_payloads[0][1]["predictions"][0]["explanation"]["summary"] == "Red pressure"
        assert sent_payloads[0][1]["predictions"][0]["predicted_method"] == "KO/TKO"
        assert sent_payloads[0][1]["predictions"][0]["predicted_round"] == 2
        unsynced = get_unsynced_predictions()
        assert len(unsynced) == 1, f"Expected only backlog row unsynced, got {len(unsynced)}"
        assert unsynced[0]["id"] == backlog_id, "Backlog row should remain unsynced"
        print("  PASS: daily_predict marks only current batch rows synced")


def test_daily_predict_covers_all_future_cards_and_prunes():
    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ["PREDICTIONS_DB_PATH"] = os.path.join(tmpdir, "predictions.db")
        init_db()
        today = datetime.now(UTC).date().isoformat()
        far_future = (datetime.now(UTC).date() + timedelta(days=90)).isoformat()
        past = (datetime.now(UTC).date() - timedelta(days=1)).isoformat()

        def fake_get_json(path):
            if path == "/api/events":
                return [{"id": 1, "date": past}, {"id": 2, "date": far_future}, {"id": 3, "date": today}]
            if path == "/api/events/2/card":
                return {"card": [{"id": 200, "red_id": 11, "blue_id": 22}]}
            if path == "/api/events/3/card":
                raise AssertionError("same-day events are locked and should not be predicted")
            if path.startswith("/api/fighters/"):
                return {"fighter": {"reach_cm": 180, "height_cm": 175}, "stats": {"total_fights": 4}}
            return None

        posted = []

        def fake_post_json(path, body):
            posted.append((path, body))
            return {"status": "ok", "pruned": 3, "before": datetime.now(UTC).date().isoformat()}

        with patched(jobs, "_get_json", fake_get_json), \
                patched(jobs, "_post_json", fake_post_json), \
                patched(jobs, "get_latest_model", lambda: {"blob_path": "unused", "version": "v.future"}), \
                patched(jobs, "load_model", lambda _p: object()), \
                patched(jobs, "engineer_features", lambda *_a, **_k: np.zeros(len(FEATURE_NAMES))), \
                patched(jobs, "feature_hash", lambda _x: "hash-future"), \
                patched(jobs, "predict", lambda _pipe, _x: (0.57, 0.43)), \
                patched(jobs, "explain_prediction", lambda *_a, **_k: {"summary": "Future edge", "factors": [], "categories": []}):
            predict_result = jobs.daily_predict()
            prune_result = jobs.prune_past_predictions()

        assert predict_result["predicted"] == 1
        assert predict_result["events_checked"] == 1
        assert any(path == "/api/predictions/ingest" for path, _ in posted)
        assert prune_result["pruned"] == 3
        assert any(path == "/api/predictions/prune" for path, _ in posted)
        print("  PASS: daily_predict covers all future cards and prune calls main app")


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

        id1 = log_prediction(1001, 10, 20, 0.6, 0.4, "v.sync", "h1", "2026-02-01", predicted_method="Submission", predicted_round=2)
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
        first = next(p for p in payload if p["fight_id"] == 1001)
        assert first["predicted_method"] == "Submission"
        assert first["predicted_round"] == 2

        unsynced_after = get_unsynced_predictions()
        unsynced_ids = {row["id"] for row in unsynced_after}
        assert id3 in unsynced_ids
        assert id1 not in unsynced_ids and id2 not in unsynced_ids
        print("  PASS: sync_unsynced only marks posted rows")


def test_sync_unsynced_marks_locked_rows_done():
    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ["PREDICTIONS_DB_PATH"] = os.path.join(tmpdir, "predictions.db")
        init_db()

        id1 = log_prediction(2001, 10, 20, 0.6, 0.4, "v.sync.lock", "h1", "2026-02-01")
        id2 = log_prediction(2002, 11, 21, 0.55, 0.45, "v.sync.lock", "h2", "2026-02-02")

        def fake_post_json(path, body):
            assert path == "/api/predictions/ingest"
            assert [p["fight_id"] for p in body["predictions"]] == [2001, 2002]
            return {
                "status": "ok",
                "ingested": 1,
                "skipped_locked": 1,
                "accepted_indices": [0],
                "locked_indices": [1],
            }

        with patched(jobs, "_post_json", fake_post_json):
            synced = jobs.sync_unsynced(limit=2)

        assert synced == 1
        unsynced_ids = {row["id"] for row in get_unsynced_predictions()}
        assert id1 not in unsynced_ids and id2 not in unsynced_ids
        print("  PASS: sync_unsynced drains locked prediction rows")


def test_daily_reconcile_captures_official_outcomes():
    today = datetime.now(UTC).date().isoformat()

    def fake_get_json(path):
        if path == "/api/events":
            return [{"id": 88, "date": today}]
        if path == "/api/events/88/card":
            return {
                "card": [
                    {
                        "id": 8801,
                        "red_id": 10,
                        "blue_id": 20,
                        "red_name": "Red One",
                        "blue_name": "Blue One",
                        "winner_id": 10,
                        "method": "KO/TKO",
                        "method_detail": "Punches",
                        "round": 2,
                        "time": "3:14",
                    },
                    {
                        "id": 8802,
                        "red_id": 11,
                        "blue_id": 21,
                        "red_name": "Red Two",
                        "blue_name": "Blue Two",
                        "winner_id": None,
                    },
                ]
            }
        return None

    posted = []

    def fake_post_json(path, body):
        posted.append((path, body))
        if path == "/api/events/88/official-outcomes":
            return {"status": "ok", "captured": len(body["outcomes"])}
        if path == "/api/predictions/reconcile":
            return {"status": "ok", "reconciled": 3}
        return {"status": "ok"}

    with patched(jobs, "_get_json", fake_get_json), patched(jobs, "_post_json", fake_post_json):
        result = jobs.daily_reconcile()

    outcome_post = next((body for path, body in posted if path == "/api/events/88/official-outcomes"), None)
    reconcile_post = next((body for path, body in posted if path == "/api/predictions/reconcile"), None)
    assert outcome_post is not None, "Expected official outcome snapshot post"
    assert len(outcome_post["outcomes"]) == 2
    assert outcome_post["outcomes"][0]["status"] == "official"
    assert outcome_post["outcomes"][0]["method"] == "KO/TKO"
    assert outcome_post["outcomes"][1]["status"] == "in_progress"
    assert reconcile_post["results"][0]["method_detail"] == "Punches"
    assert result["official_outcomes_captured"] == 2
    assert result["reconciled"] == 3
    print("  PASS: daily_reconcile captures official outcomes before scoring")


if __name__ == "__main__":
    print("\n=== UFC Predictions Job Tests ===\n")
    test_daily_predict_marks_only_current_batch_synced()
    test_daily_predict_covers_all_future_cards_and_prunes()
    test_weekly_retrain_uses_point_in_time_as_of()
    test_daily_predict_reports_no_model()
    test_sync_unsynced_marks_posted_rows_only()
    test_sync_unsynced_marks_locked_rows_done()
    test_daily_reconcile_captures_official_outcomes()
    print("\n=== All 7 job tests passed ===\n")
