"""Scheduled jobs for the prediction service.

Four cron jobs:
  1. daily_predict   — predict next 14 days of fights
  2. refresh_near    — 3x daily refresh for next 48h
  3. daily_reconcile — reconcile last 7 days of results
  4. weekly_retrain  — retrain model on all labeled data
  5. sync_unsynced   — sync local backlog to main app
"""
import os
import logging
from datetime import datetime, timedelta

import httpx
import numpy as np

from model import engineer_features, feature_hash, predict, train, load_model, FEATURE_NAMES
from db import (
    get_latest_model, save_model_record, log_prediction,
    mark_synced, init_db, get_unsynced_predictions
)

logger = logging.getLogger("jobs")

MAIN_APP_URL = os.getenv("MAIN_APP_URL", "http://localhost:3000")
PREDICTION_SERVICE_KEY = os.getenv("PREDICTION_SERVICE_KEY", "")
TIMEOUT = 30.0


def _headers():
    return {"x-prediction-key": PREDICTION_SERVICE_KEY}


def _get_json(path: str) -> dict | list | None:
    try:
        r = httpx.get(f"{MAIN_APP_URL}{path}", timeout=TIMEOUT)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.error(f"GET {path} failed: {e}")
        return None


def _post_json(path: str, body: dict) -> dict | None:
    try:
        r = httpx.post(
            f"{MAIN_APP_URL}{path}",
            json=body,
            headers=_headers(),
            timeout=TIMEOUT
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.error(f"POST {path} failed: {e}")
        return None


def _career_stats_path(fighter_id: int, as_of: str | None = None) -> str:
    if as_of:
        return f"/api/fighters/{fighter_id}/career-stats?as_of={as_of}"
    return f"/api/fighters/{fighter_id}/career-stats"


def _sync_predictions(predictions: list[dict], local_ids: list[int], label: str) -> int:
    if not predictions:
        return 0
    result = _post_json("/api/predictions/ingest", {"predictions": predictions})
    if result:
        mark_synced(local_ids)
        logger.info(f"Synced {len(predictions)} predictions ({label})")
        return len(predictions)
    return 0


def _predict_window(days: int, label: str) -> dict:
    """Predict and sync fights from today through the requested day window."""
    logger.info(f"=== {label} start ===")
    init_db()

    model_rec = get_latest_model()
    if not model_rec:
        logger.warning("No trained model found. Run weekly_retrain first.")
        return {
            "status": "skipped",
            "job": label,
            "reason": "no_model",
            "predicted": 0,
            "synced": 0,
        }

    pipe = load_model(model_rec["blob_path"])
    version = model_rec["version"]

    today = datetime.utcnow().date()
    cutoff = today + timedelta(days=days)

    events = _get_json("/api/events") or []
    predictions = []
    local_prediction_ids = []
    events_checked = 0
    fights_seen = 0

    for ev in events:
        if not ev.get("date"):
            continue
        try:
            ev_date = datetime.strptime(ev["date"], "%Y-%m-%d").date()
        except ValueError:
            continue
        if ev_date < today or ev_date > cutoff:
            continue

        events_checked += 1
        card = _get_json(f"/api/events/{ev['id']}/card")
        if not card or "card" not in card:
            continue

        for bout in card["card"]:
            fights_seen += 1
            red_stats = _get_json(_career_stats_path(bout["red_id"]))
            blue_stats = _get_json(_career_stats_path(bout["blue_id"]))
            red_fighter = red_stats.get("fighter", {}) if red_stats else {}
            blue_fighter = blue_stats.get("fighter", {}) if blue_stats else {}
            r_career = red_stats.get("stats") if red_stats else {}
            b_career = blue_stats.get("stats") if blue_stats else {}

            X = engineer_features(r_career, b_career, red_fighter, blue_fighter)
            fhash = feature_hash(X)
            red_prob, blue_prob = predict(pipe, X)

            local_id = log_prediction(
                fight_id=bout["id"],
                red_id=bout["red_id"],
                blue_id=bout["blue_id"],
                red_prob=red_prob,
                blue_prob=blue_prob,
                model_version=version,
                feature_hash=fhash,
                event_date=ev["date"]
            )
            local_prediction_ids.append(local_id)
            predictions.append({
                "fight_id": bout["id"],
                "red_fighter_id": bout["red_id"],
                "blue_fighter_id": bout["blue_id"],
                "red_win_prob": red_prob,
                "blue_win_prob": blue_prob,
                "model_version": version,
                "feature_hash": fhash,
                "predicted_at": datetime.utcnow().isoformat(),
                "event_date": ev["date"]
            })

    synced = _sync_predictions(predictions, local_prediction_ids, label)
    status = "ok" if synced == len(predictions) else "partial"
    if not predictions:
        status = "ok"

    logger.info(f"=== {label} done ({len(predictions)} predictions, {synced} synced) ===")
    return {
        "status": status,
        "job": label,
        "model_version": version,
        "events_checked": events_checked,
        "fights_seen": fights_seen,
        "predicted": len(predictions),
        "synced": synced,
    }


def sync_unsynced(limit: int = 500) -> int:
    """Sync locally queued unsynced predictions to the main app."""
    init_db()
    queued = get_unsynced_predictions(limit=limit)
    if not queued:
        logger.info("No unsynced prediction backlog")
        return 0

    predictions = [{
        "fight_id": row["fight_id"],
        "red_fighter_id": row["red_fighter_id"],
        "blue_fighter_id": row["blue_fighter_id"],
        "red_win_prob": row["red_win_prob"],
        "blue_win_prob": row["blue_win_prob"],
        "model_version": row["model_version"],
        "feature_hash": row["feature_hash"],
        "predicted_at": row["predicted_at"],
        "event_date": row["event_date"]
    } for row in queued]

    result = _post_json("/api/predictions/ingest", {"predictions": predictions})
    if not result:
        logger.warning("Backlog sync failed")
        return 0

    mark_synced([row["id"] for row in queued])
    logger.info(f"Synced {len(queued)} queued predictions")
    return len(queued)


def daily_predict():
    """Predict outcomes for fights in the next 14 days."""
    return _predict_window(days=14, label="daily_predict")


def refresh_near():
    """Re-predict fights in the next 48 hours (stats may have updated)."""
    return _predict_window(days=2, label="refresh_near")


def daily_reconcile():
    """Reconcile predictions against actual results from last 7 days."""
    logger.info("=== daily_reconcile start ===")

    today = datetime.utcnow().date()
    week_ago = today - timedelta(days=7)

    events = _get_json("/api/events") or []
    results = []

    for ev in events:
        if not ev.get("date"):
            continue
        try:
            ev_date = datetime.strptime(ev["date"], "%Y-%m-%d").date()
        except ValueError:
            continue
        if ev_date < week_ago or ev_date > today:
            continue

        card = _get_json(f"/api/events/{ev['id']}/card")
        if not card or "card" not in card:
            continue

        for bout in card["card"]:
            if bout.get("winner_id"):
                results.append({
                    "fight_id": bout["id"],
                    "actual_winner_id": bout["winner_id"]
                })

    reconciled = 0
    if results:
        resp = _post_json("/api/predictions/reconcile", {"results": results})
        if resp:
            reconciled = int(resp.get("reconciled", 0))
            logger.info(f"Reconciled {reconciled} predictions")

    logger.info(f"=== daily_reconcile done ({len(results)} results checked) ===")
    return {
        "status": "ok",
        "job": "daily_reconcile",
        "results_checked": len(results),
        "reconciled": reconciled,
    }


def weekly_retrain():
    """Retrain the model on all labeled fights with stats."""
    logger.info("=== weekly_retrain start ===")
    init_db()

    events = _get_json("/api/events") or []
    X_all, y_all = [], []

    for ev in events:
        as_of = ev.get("date")
        if not as_of:
            continue
        card = _get_json(f"/api/events/{ev['id']}/card")
        if not card or "card" not in card:
            continue

        for bout in card["card"]:
            if not bout.get("winner_id"):
                continue

            red_stats = _get_json(_career_stats_path(bout["red_id"], as_of=as_of))
            blue_stats = _get_json(_career_stats_path(bout["blue_id"], as_of=as_of))
            r_career = red_stats.get("stats") if red_stats else {}
            b_career = blue_stats.get("stats") if blue_stats else {}
            red_fighter = red_stats.get("fighter", {}) if red_stats else {}
            blue_fighter = blue_stats.get("fighter", {}) if blue_stats else {}

            if not r_career or not b_career:
                continue

            X = engineer_features(r_career, b_career, red_fighter, blue_fighter)
            label = 1 if bout["winner_id"] == bout["red_id"] else 0
            X_all.append(X)
            y_all.append(label)

    if len(X_all) < 20:
        logger.warning(f"Only {len(X_all)} labeled fights -- need at least 20 to train")
        return {
            "status": "skipped",
            "job": "weekly_retrain",
            "reason": "insufficient_labeled_fights",
            "n_train": len(X_all),
            "min_required": 20,
        }

    X_mat = np.array(X_all)
    y_vec = np.array(y_all)
    if len(np.unique(y_vec)) < 2:
        logger.warning("Training skipped: labels only contain one winner side")
        return {
            "status": "skipped",
            "job": "weekly_retrain",
            "reason": "single_class_labels",
            "n_train": len(y_vec),
        }

    pipe, cv_acc, version, blob_path = train(X_mat, y_vec)
    save_model_record(version, blob_path, FEATURE_NAMES, cv_acc, len(y_vec))

    logger.info(f"=== weekly_retrain done: {version}, "
                f"accuracy={cv_acc:.3f}, n={len(y_vec)} ===")
    return {
        "status": "ok",
        "job": "weekly_retrain",
        "model_version": version,
        "accuracy": cv_acc,
        "n_train": len(y_vec),
        "feature_count": len(FEATURE_NAMES),
    }
