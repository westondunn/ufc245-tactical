"""Train LR locally from Railway main app's API. Mirrors weekly_retrain in
ufc245-predictions/jobs/__init__.py but writes to MODEL_DIR locally."""
from __future__ import annotations
import logging
import os

import httpx
import numpy as np

from config import Config
from pipeline.lr_runner import LRRunner

logger = logging.getLogger(__name__)


def _get_json(client: httpx.Client, base_url: str, path: str):
    try:
        r = client.get(f"{base_url}{path}", timeout=30.0)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.error("GET %s failed: %s", path, e)
        return None


def train_local() -> dict:
    cfg = Config.from_env()
    runner = LRRunner.from_env()

    X_all: list = []
    y_all: list = []

    with httpx.Client() as client:
        events = _get_json(client, cfg.main_app_url, "/api/events") or []
        for ev in events:
            if not ev.get("date"):
                continue
            card = _get_json(client, cfg.main_app_url, f"/api/events/{ev['id']}/card")
            if not card or "card" not in card:
                continue
            for bout in card["card"]:
                if not bout.get("winner_id"):
                    continue
                red_stats = _get_json(
                    client, cfg.main_app_url,
                    f"/api/fighters/{bout['red_id']}/career-stats?as_of={ev['date']}"
                )
                blue_stats = _get_json(
                    client, cfg.main_app_url,
                    f"/api/fighters/{bout['blue_id']}/career-stats?as_of={ev['date']}"
                )
                r_career = (red_stats or {}).get("stats") or {}
                b_career = (blue_stats or {}).get("stats") or {}
                red_fighter = (red_stats or {}).get("fighter") or {}
                blue_fighter = (blue_stats or {}).get("fighter") or {}
                if not r_career or not b_career:
                    continue
                X = runner.engineer_features(r_career, b_career, red_fighter, blue_fighter)
                X_all.append(X)
                y_all.append(1 if bout["winner_id"] == bout["red_id"] else 0)

    if len(X_all) < 20:
        return {"status": "skipped", "reason": "insufficient_labeled_fights",
                "n_train": len(X_all), "min_required": 20}

    X_mat = np.array(X_all)
    y_vec = np.array(y_all)
    if len(np.unique(y_vec)) < 2:
        return {"status": "skipped", "reason": "single_class_labels", "n_train": len(y_vec)}

    pipe, cv_acc, version, blob_path = runner.train_and_save(X_mat, y_vec, model_dir=cfg.model_dir)
    # Persist a "latest" pointer for orchestrator
    latest = os.path.join(cfg.model_dir, "latest.txt")
    with open(latest, "w", encoding="utf-8") as f:
        f.write(f"{version}\n{blob_path}\n{cv_acc:.6f}\n")
    return {"status": "ok", "model_version": version, "blob_path": blob_path,
            "accuracy": float(cv_acc), "n_train": len(y_vec),
            "feature_count": len(runner.feature_names)}
