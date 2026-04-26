"""Scheduled jobs for the prediction service.

Cron jobs:
  1. daily_maintenance — prune stale rows, reconcile, predict all future fights, sync
  2. daily_predict   — predict all future fights
  2. refresh_near    — 3x daily refresh for next 48h
  3. daily_reconcile — reconcile last 7 days of results
  4. weekly_retrain  — retrain model on all labeled data
  5. sync_unsynced   — sync local backlog to main app
"""
import os
import logging
import re
from datetime import datetime, timedelta

import httpx
import numpy as np

from model import engineer_features, explain_prediction, feature_hash, predict, train, load_model, FEATURE_NAMES
from db import (
    get_latest_model, save_model_record, log_prediction,
    mark_synced, init_db, get_unsynced_predictions
)

logger = logging.getLogger("jobs")

MAIN_APP_URL = os.getenv("MAIN_APP_URL", "http://localhost:3000")
PREDICTION_SERVICE_KEY = os.getenv("PREDICTION_SERVICE_KEY", "")
TIMEOUT = 30.0
SYNC_BATCH_SIZE = max(int(os.getenv("PREDICTION_SYNC_BATCH_SIZE", "20") or "20"), 1)


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


def _voidish_method(method: str | None) -> bool:
    return "draw" in str(method or "").lower() or "no contest" in str(method or "").lower() or str(method or "").upper() == "NC"


def _outcome_status(bout: dict, event_date) -> str:
    if bout.get("official_status"):
        return str(bout["official_status"])
    if bout.get("winner_id"):
        return "official"
    if _voidish_method(bout.get("method")):
        return "void"
    today = datetime.utcnow().date()
    if event_date == today:
        return "in_progress"
    return "pending"


def _build_official_outcome(event: dict, bout: dict, event_date, captured_at: str, source: str) -> dict:
    return {
        "fight_id": bout.get("id"),
        "status": _outcome_status(bout, event_date),
        "winner_id": bout.get("winner_id"),
        "method": bout.get("method"),
        "method_detail": bout.get("method_detail"),
        "round": bout.get("round"),
        "time": bout.get("time"),
        "source": source,
        "captured_at": captured_at,
        "raw": {
            "event_id": event.get("id"),
            "event_date": event.get("date"),
            "red_name": bout.get("red_name"),
            "blue_name": bout.get("blue_name"),
            "official_status": bout.get("official_status"),
        },
    }


def _sync_official_outcomes(event_id: int, outcomes: list[dict]) -> int:
    if not outcomes:
        return 0
    resp = _post_json(f"/api/events/{event_id}/official-outcomes", {"outcomes": outcomes})
    if not resp:
        return 0
    return int(resp.get("captured", 0))


def _round_int(value) -> int | None:
    if value is None or value == "":
        return None
    match = re.search(r"\d+", str(value))
    return int(match.group(0)) if match else None


def _prediction_metadata(explanation: dict | None) -> tuple[str | None, int | None]:
    if not isinstance(explanation, dict):
        return None, None
    containers = [
        explanation,
        explanation.get("prediction") if isinstance(explanation.get("prediction"), dict) else None,
        explanation.get("predicted") if isinstance(explanation.get("predicted"), dict) else None,
        explanation.get("outcome") if isinstance(explanation.get("outcome"), dict) else None,
    ]
    method = None
    round_pick = None
    for item in containers:
        if not item:
            continue
        method = method or item.get("predicted_method") or item.get("method_prediction") or item.get("method")
        round_pick = round_pick or item.get("predicted_round") or item.get("round_prediction") or item.get("round")
    method = str(method).strip() if method is not None else None
    return method or None, _round_int(round_pick)


def _ids_from_indices(local_ids: list[int], indices) -> list[int]:
    if not isinstance(indices, list):
        return []
    ids = []
    for index in indices:
        if isinstance(index, bool) or not isinstance(index, int):
            continue
        if 0 <= index < len(local_ids):
            ids.append(local_ids[index])
    return ids


def _sync_ack(result: dict, local_ids: list[int]) -> tuple[int, int, list[int]]:
    accepted_indices = result.get("accepted_indices")
    locked_indices = result.get("locked_indices")
    if isinstance(accepted_indices, list) or isinstance(locked_indices, list):
        accepted_ids = _ids_from_indices(local_ids, accepted_indices)
        locked_ids = _ids_from_indices(local_ids, locked_indices)
        mark_ids = list(dict.fromkeys(accepted_ids + locked_ids))
        return len(accepted_ids), len(locked_ids), mark_ids

    ingested = int(result.get("ingested", len(local_ids)))
    return ingested, 0, local_ids[:ingested]


def _career_stats_path(fighter_id: int, as_of: str | None = None) -> str:
    if as_of:
        return f"/api/fighters/{fighter_id}/career-stats?as_of={as_of}"
    return f"/api/fighters/{fighter_id}/career-stats"


def _sync_predictions(predictions: list[dict], local_ids: list[int], label: str) -> int:
    if not predictions:
        return 0
    synced = 0
    for start in range(0, len(predictions), SYNC_BATCH_SIZE):
        batch = predictions[start:start + SYNC_BATCH_SIZE]
        batch_ids = local_ids[start:start + SYNC_BATCH_SIZE]
        result = _post_json("/api/predictions/ingest", {"predictions": batch})
        if not result:
            logger.warning(f"Prediction sync batch failed ({label}, offset={start})")
            continue
        ingested, locked, mark_ids = _sync_ack(result, batch_ids)
        if mark_ids:
            mark_synced(mark_ids)
        if ingested > 0:
            synced += ingested
            logger.info(f"Synced {ingested} predictions ({label}, offset={start})")
        if locked > 0:
            logger.info(f"Skipped {locked} locked predictions ({label}, offset={start})")
    return synced


def _predict_window(days: int | None, label: str) -> dict:
    """Predict and sync future fights through the requested day window."""
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
    cutoff = today + timedelta(days=days) if days is not None else None

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
        if ev_date <= today:
            continue
        if cutoff is not None and ev_date > cutoff:
            continue

        events_checked += 1
        card = _get_json(f"/api/events/{ev['id']}/card")
        if not card or "card" not in card:
            continue

        for bout in card["card"]:
            if bout.get("winner_id"):
                continue
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
            explanation = explain_prediction(
                pipe,
                X,
                red_name=bout.get("red_name") or "Red",
                blue_name=bout.get("blue_name") or "Blue",
            )
            predicted_method, predicted_round = _prediction_metadata(explanation)

            local_id = log_prediction(
                fight_id=bout["id"],
                red_id=bout["red_id"],
                blue_id=bout["blue_id"],
                red_prob=red_prob,
                blue_prob=blue_prob,
                model_version=version,
                feature_hash=fhash,
                event_date=ev["date"],
                explanation=explanation,
                predicted_method=predicted_method,
                predicted_round=predicted_round,
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
                "event_date": ev["date"],
                "explanation": explanation,
                "predicted_method": predicted_method,
                "predicted_round": predicted_round,
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

    synced = 0
    for start in range(0, len(queued), SYNC_BATCH_SIZE):
        batch_rows = queued[start:start + SYNC_BATCH_SIZE]
        predictions = [{
            "fight_id": row["fight_id"],
            "red_fighter_id": row["red_fighter_id"],
            "blue_fighter_id": row["blue_fighter_id"],
            "red_win_prob": row["red_win_prob"],
            "blue_win_prob": row["blue_win_prob"],
            "model_version": row["model_version"],
            "feature_hash": row["feature_hash"],
            "predicted_at": row["predicted_at"],
            "event_date": row["event_date"],
            "explanation_json": row.get("explanation_json"),
            "predicted_method": row.get("predicted_method"),
            "predicted_round": row.get("predicted_round"),
        } for row in batch_rows]

        result = _post_json("/api/predictions/ingest", {"predictions": predictions})
        if not result:
            logger.warning(f"Backlog sync batch failed (offset={start})")
            continue

        batch_ids = [row["id"] for row in batch_rows]
        ingested, locked, mark_ids = _sync_ack(result, batch_ids)
        if mark_ids:
            mark_synced(mark_ids)
        if ingested > 0:
            synced += ingested
        if locked > 0:
            logger.info(f"Skipped {locked} locked queued predictions (offset={start})")

    logger.info(f"Synced {synced} queued predictions")
    return synced


def daily_predict():
    """Predict outcomes for every known future fight."""
    return _predict_window(days=None, label="daily_predict")


def refresh_near():
    """Re-predict fights in the next 48 hours (stats may have updated)."""
    result = _predict_window(days=2, label="refresh_near")
    result["official_outcomes"] = capture_official_outcomes(days_back=0, days_forward=2, source="refresh_near")
    if result["status"] == "ok" and result["official_outcomes"]["status"] == "partial":
        result["status"] = "partial"
    return result


def prune_past_predictions():
    """Mark predictions for past or concluded fights stale in the main app."""
    today = datetime.utcnow().date().isoformat()
    resp = _post_json("/api/predictions/prune", {"before": today, "include_concluded": True})
    if not resp:
        return {
            "status": "partial",
            "job": "prune_past_predictions",
            "pruned": 0,
            "reason": "main_app_unavailable",
        }
    return {
        "status": resp.get("status", "ok"),
        "job": "prune_past_predictions",
        "pruned": int(resp.get("pruned", 0)),
        "before": resp.get("before", today),
    }


def capture_official_outcomes(days_back: int = 1, days_forward: int = 2, source: str = "prediction_service") -> dict:
    """Snapshot official/in-progress fight outcomes from the main app card feed."""
    logger.info("=== capture_official_outcomes start ===")
    today = datetime.utcnow().date()
    start_date = today - timedelta(days=days_back)
    end_date = today + timedelta(days=days_forward)
    captured_at = datetime.utcnow().isoformat()

    events = _get_json("/api/events") or []
    events_checked = 0
    outcomes_seen = 0
    outcomes_captured = 0

    for ev in events:
        if not ev.get("date"):
            continue
        try:
            ev_date = datetime.strptime(ev["date"], "%Y-%m-%d").date()
        except ValueError:
            continue
        if ev_date < start_date or ev_date > end_date:
            continue

        card = _get_json(f"/api/events/{ev['id']}/card")
        if not card or "card" not in card:
            continue

        events_checked += 1
        outcomes = [
            _build_official_outcome(ev, bout, ev_date, captured_at, source)
            for bout in card["card"]
            if bout.get("id")
        ]
        outcomes_seen += len(outcomes)
        outcomes_captured += _sync_official_outcomes(ev["id"], outcomes)

    status = "ok" if outcomes_captured == outcomes_seen else "partial"
    if outcomes_seen == 0:
        status = "ok"
    logger.info(f"=== capture_official_outcomes done ({outcomes_captured}/{outcomes_seen}) ===")
    return {
        "status": status,
        "job": "capture_official_outcomes",
        "events_checked": events_checked,
        "outcomes_seen": outcomes_seen,
        "outcomes_captured": outcomes_captured,
    }


def daily_reconcile():
    """Reconcile predictions against actual results from last 7 days."""
    logger.info("=== daily_reconcile start ===")

    today = datetime.utcnow().date()
    week_ago = today - timedelta(days=7)
    captured_at = datetime.utcnow().isoformat()

    events = _get_json("/api/events") or []
    results = []
    official_seen = 0
    official_captured = 0

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

        outcomes = []
        for bout in card["card"]:
            if bout.get("id"):
                outcomes.append(_build_official_outcome(ev, bout, ev_date, captured_at, "daily_reconcile"))
            if bout.get("winner_id"):
                results.append({
                    "fight_id": bout["id"],
                    "actual_winner_id": bout["winner_id"],
                    "method": bout.get("method"),
                    "method_detail": bout.get("method_detail"),
                    "round": bout.get("round"),
                    "time": bout.get("time"),
                    "status": "official",
                    "source": "daily_reconcile",
                })
        official_seen += len(outcomes)
        official_captured += _sync_official_outcomes(ev["id"], outcomes)

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
        "official_outcomes_seen": official_seen,
        "official_outcomes_captured": official_captured,
    }


def daily_maintenance():
    """Daily prediction upkeep after new scrapes/stat imports land."""
    logger.info("=== daily_maintenance start ===")
    prune = prune_past_predictions()
    reconcile = daily_reconcile()
    predict_result = daily_predict()
    synced = sync_unsynced(limit=1000)
    ok = all(part.get("status") == "ok" for part in [prune, reconcile, predict_result])
    result = {
        "status": "ok" if ok else "partial",
        "job": "daily_maintenance",
        "prune": prune,
        "reconcile": reconcile,
        "predict": predict_result,
        "sync": {"status": "ok", "job": "sync_unsynced", "synced": synced},
        "inputs": {
            "scrapes": "main_app_events_and_stats",
            "news": "not_configured",
        },
    }
    logger.info(f"=== daily_maintenance done ({result['status']}) ===")
    return result


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
