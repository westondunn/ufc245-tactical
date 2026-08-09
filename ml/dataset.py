"""Build a point-in-time evaluation dataset from a snapshot.

Reuses the existing engineer_features / FEATURE_NAMES from the shared model
(ufc245-predictions/model). Baseline vintage caveat: fighter-profile fields
(slpm, str_def, td_def, reach, height) come from the snapshot's profile rows,
which reflect current vintage (F-001). Results built here are PROVISIONAL
until the Phase 1 point-in-time feature service lands.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from model import FEATURE_NAMES, engineer_features
from ml.manifest import DatasetManifest, sha256_of_obj
from ml.snapshot import iter_labeled_bouts


def _scheduled_rounds(bout: dict) -> int:
    return 5 if (bout.get("is_main") or bout.get("is_title")) else 3


def _history_band(total_fights: float) -> str:
    if total_fights <= 0:
        return "debut"
    if total_fights <= 3:
        return "low"
    if total_fights <= 8:
        return "mid"
    return "high"


def _completeness(red_stats: dict, blue_stats: dict) -> float:
    keys = ["avg_sig_per_fight", "sig_accuracy_pct", "total_td_landed",
            "total_control_sec", "win_pct_last3"]
    present = 0
    for stats in (red_stats, blue_stats):
        for k in keys:
            if stats.get(k) is not None:
                present += 1
    return present / (2 * len(keys))


def _completeness_band(frac: float) -> str:
    return "complete" if frac >= 0.999 else ("partial" if frac >= 0.6 else "sparse")


@dataclass
class Dataset:
    X: np.ndarray
    y: np.ndarray
    rows: list
    feature_names: list
    manifest: DatasetManifest


def build_dataset(snapshot: dict) -> Dataset:
    X_list, y_list, rows = [], [], []
    event_ids, debutants = set(), 0
    red_wins = blue_wins = 0
    missing = {}

    for item in iter_labeled_bouts(snapshot):
        bout = item["bout"]
        red_stats = item["red_career"].get("stats") or {}
        blue_stats = item["blue_career"].get("stats") or {}
        red_fighter = item["red_career"].get("fighter") or {}
        blue_fighter = item["blue_career"].get("fighter") or {}

        X = engineer_features(red_stats, blue_stats, red_fighter, blue_fighter)
        label = 1 if bout["winner_id"] == bout["red_id"] else 0
        X_list.append(X)
        y_list.append(label)
        if label == 1:
            red_wins += 1
        else:
            blue_wins += 1

        is_debut = bool(bout.get("red_is_ufc_debut") or bout.get("blue_is_ufc_debut"))
        if is_debut:
            debutants += 1
        event_ids.add(item["event_id"])
        min_hist = min(float(red_stats.get("total_fights") or 0),
                       float(blue_stats.get("total_fights") or 0))
        comp = _completeness(red_stats, blue_stats)
        for stats in (red_stats, blue_stats):
            if stats.get("avg_sig_per_fight") is None:
                missing["avg_sig_per_fight"] = missing.get("avg_sig_per_fight", 0) + 1

        rows.append({
            "event_id": item["event_id"],
            "fight_id": bout["id"],
            "prediction_cutoff": item["event_date"],
            "label": label,
            "weight_class": bout.get("weight_class") or "unknown",
            "main_event": bool(bout.get("is_main")),
            "scheduled_rounds": _scheduled_rounds(bout),
            "debutant": is_debut,
            "history_band": _history_band(min_hist),
            "feature_completeness_band": _completeness_band(comp),
            "qualitative_source_coverage": "none",  # Phase 0: no signals wired in
        })

    X = np.vstack(X_list) if X_list else np.empty((0, len(FEATURE_NAMES)))
    y = np.array(y_list, dtype=int)
    dates = [r["prediction_cutoff"] for r in rows]

    manifest = DatasetManifest(
        manifest_id=f"ds-{snapshot['_hash'][:12]}",
        database_snapshot_hash=snapshot["_hash"],
        min_event_date=min(dates) if dates else "",
        max_event_date=max(dates) if dates else "",
        feature_schema_hash=sha256_of_obj(list(FEATURE_NAMES)),
        number_of_events=len(event_ids),
        number_of_fights=len(rows),
        number_of_labeled_fights=len(rows),
        number_of_debutants=debutants,
        class_distribution={"red": red_wins, "blue": blue_wins},
        missingness_summary=missing,
    )
    return Dataset(X=X, y=y, rows=rows, feature_names=list(FEATURE_NAMES), manifest=manifest)
