"""Evaluation runner: trains the existing LR per fold, scores OOF, writes artifacts.

Verdict logic is intentionally conservative and mirrors agent-evaluation-spec.yaml:
- SPLIT-1 is satisfied by the harness (event-grouped walk-forward).
- SYM-1/SYM-2 corner-swap errors are MEASURED and gated at 0.01 / 0.03.
- PIT-2 future-data mutation is asserted here too.
- NUM-1 and PIT-1 are recorded as KNOWN production-path failures (documented,
  not fixed in Phase 0), which forces a `reject` verdict — an evidence-backed
  reject, not a `blocked`.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from model import FEATURE_NAMES, engineer_features
from ml.bootstrap import event_bootstrap_ci
from ml.dataset import build_dataset
from ml.folds import assert_fold_isolation, walk_forward_folds
from ml.metrics import reliability_table, winner_metrics
from ml.slices import slice_metrics

_SLICE_KEYS = ["weight_class", "main_event", "scheduled_rounds", "debutant",
               "history_band", "feature_completeness_band",
               "qualitative_source_coverage"]


def _fit(X, y):
    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("lr", LogisticRegression(C=1.0, max_iter=1000, solver="lbfgs",
                                  class_weight="balanced")),
    ])
    pipe.fit(X, y)
    return pipe


def _index_by_fight(rows):
    return {r["fight_id"]: i for i, r in enumerate(rows)}


def _corner_swap_error(pipe, X_rows) -> tuple[float, float]:
    """Swap red/blue halves of each delta-based vector and measure |p + p' - 1|."""
    errors = []
    for x in X_rows:
        x_swap = _swap_features(x)
        p = pipe.predict_proba(x.reshape(1, -1))[0][1]
        p_swap = pipe.predict_proba(x_swap.reshape(1, -1))[0][1]
        errors.append(abs(p + p_swap - 1.0))
    errors = np.array(errors) if errors else np.array([0.0])
    return float(errors.mean()), float(np.quantile(errors, 0.99))


def _swap_features(x: np.ndarray) -> np.ndarray:
    """Build the red<->blue swapped vector from FEATURE_NAMES layout.

    For a triple (red_v, blue_v, delta) swapping gives (blue_v, red_v, -delta).
    Pure delta features (reach/height) negate. Standalone red/blue pairs swap.
    """
    swapped = x.copy()
    name_to_idx = {n: i for i, n in enumerate(FEATURE_NAMES)}
    handled = set()
    for name, idx in name_to_idx.items():
        if idx in handled:
            continue
        if name.startswith("red_"):
            blue_name = "blue_" + name[len("red_"):]
            if blue_name in name_to_idx:
                j = name_to_idx[blue_name]
                swapped[idx], swapped[j] = x[j], x[idx]
                handled.update({idx, j})
        elif name.endswith("_delta") or name.endswith("_delta_cm"):
            swapped[idx] = -x[idx]
            handled.add(idx)
    return swapped


def run_evaluation(snapshot: dict, *, out_dir, min_train_events: int = 6, step: int = 1,
                   n_boot: int = 1000, seed: int = 42) -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    ds = build_dataset(snapshot)
    folds = walk_forward_folds(ds.rows, min_train_events=min_train_events, step=step)

    split1_ok = True
    try:
        assert_fold_isolation(folds)
    except AssertionError:
        split1_ok = False

    idx_by_fight = _index_by_fight(ds.rows)
    oof_p, oof_y, oof_event, oof_row = [], [], [], []
    fold_results = []

    for fold in folds:
        tr_idx = [idx_by_fight[r["fight_id"]] for r in fold.train_rows]
        va_idx = [idx_by_fight[r["fight_id"]] for r in fold.val_rows]
        X_tr, y_tr = ds.X[tr_idx], ds.y[tr_idx]
        X_va, y_va = ds.X[va_idx], ds.y[va_idx]
        if len(np.unique(y_tr)) < 2:
            continue
        pipe = _fit(X_tr, y_tr)
        p_va = pipe.predict_proba(X_va)[:, 1]
        oof_p.extend(p_va.tolist())
        oof_y.extend(y_va.tolist())
        oof_event.extend([r["event_id"] for r in fold.val_rows])
        oof_row.extend(fold.val_rows)
        if len(np.unique(y_va)) >= 2:
            fm = winner_metrics(np.array(y_va), p_va)
        else:
            fm = {"log_loss": None, "brier_score": None}
        fold_results.append({"fold_id": fold.fold_id,
                             "val_events": ",".join(map(str, sorted({r["event_id"] for r in fold.val_rows}))),
                             "n": len(va_idx),
                             "log_loss": fm["log_loss"], "brier_score": fm["brier_score"]})

    oof_p = np.array(oof_p)
    oof_y = np.array(oof_y, dtype=int)
    oof_event = np.array(oof_event)

    if len(oof_y) >= 2 and len(np.unique(oof_y)) == 2:
        agg = winner_metrics(oof_y, oof_p)
        ll_ci = event_bootstrap_ci(oof_event, oof_y, oof_p, metric="log_loss",
                                   n_boot=n_boot, seed=seed)
        reliability = reliability_table(oof_y, oof_p)
        slices = slice_metrics(oof_row, oof_y, oof_p, slice_keys=_SLICE_KEYS)
    else:
        agg = {k: None for k in ("log_loss", "brier_score", "calibration_slope",
                                 "calibration_intercept", "expected_calibration_error",
                                 "accuracy", "roc_auc")}
        ll_ci = {"point": None, "ci_low": None, "ci_high": None}
        reliability, slices = [], []

    # Corner-swap on a model fit over ALL data (measurement only).
    if len(np.unique(ds.y)) == 2:
        full = _fit(ds.X, ds.y)
        mean_swap, p99_swap = _corner_swap_error(full, list(ds.X))
    else:
        mean_swap, p99_swap = float("nan"), float("nan")

    # PIT-2: re-run the future-data mutation invariant inline.
    pit2_ok = _pit2_holds(snapshot, ds)

    gates = _build_gates(split1_ok, mean_swap, p99_swap, pit2_ok)
    verdict = _verdict(gates)

    _write_artifacts(out, snapshot, ds, folds, fold_results, agg, ll_ci,
                     reliability, slices, gates, mean_swap, p99_swap, verdict)
    return {"verdict": verdict, "aggregate": agg, "n_oof": int(len(oof_y))}


def _pit2_holds(snapshot: dict, ds) -> bool:
    import copy
    mutated = copy.deepcopy(snapshot)
    if not mutated.get("events"):
        return True
    future_date = "9999-01-01"
    mutated["events"].append({"id": -1, "date": future_date, "name": "synthetic-future"})
    mutated["cards"]["-1"] = {"event": {"id": -1, "date": future_date}, "card": []}
    ds_after = build_dataset(mutated)
    return np.array_equal(ds.X, ds_after.X)


def _build_gates(split1_ok, mean_swap, p99_swap, pit2_ok) -> dict:
    def gate(gid, name, result, detail):
        return {"id": gid, "name": name, "result": result, "evidence_detail": detail}

    sym1 = "pass" if (mean_swap == mean_swap and mean_swap <= 0.01) else "fail"
    sym2 = "pass" if (p99_swap == p99_swap and p99_swap <= 0.03) else "fail"
    return {"gates": [
        gate("SPLIT-1", "Event-grouped temporal evaluation",
             "pass" if split1_ok else "fail",
             {"mechanism": "walk_forward_folds + assert_fold_isolation"}),
        gate("PIT-2", "Future-data mutation tests pass",
             "pass" if pit2_ok else "fail",
             {"invariant": "adding a future event leaves earlier feature vectors unchanged"}),
        gate("SYM-1", "Mean corner-swap probability error <= 0.01", sym1,
             {"mean_swap_error": mean_swap, "threshold": 0.01}),
        gate("SYM-2", "P99 corner-swap probability error <= 0.03", sym2,
             {"p99_swap_error": p99_swap, "threshold": 0.03}),
        gate("PIT-1", "No known point-in-time leakage", "fail",
             {"note": "F-001 profile-vintage leakage unaddressed in Phase 0 (provisional)"}),
        gate("NUM-1", "Numeric probabilities independent of Ollama", "fail",
             {"note": "F-003 production path still publishes LLM win_probability"}),
    ]}


def _verdict(gates: dict) -> str:
    # Any required hard-gate failure => reject (spec promotion_logic.reject_when).
    if any(g["result"] == "fail" for g in gates["gates"]):
        return "reject"
    return "shadow"


def _write_artifacts(out, snapshot, ds, folds, fold_results, agg, ll_ci,
                     reliability, slices, gates, mean_swap, p99_swap, verdict):
    (out / "artifact-manifest.json").write_text(json.dumps({
        "database_snapshot_hash": snapshot["_hash"],
        "feature_schema_hash": ds.manifest.feature_schema_hash,
        "dataset_manifest": ds.manifest.to_dict(),
        "fold_manifest": [f.manifest().to_dict() for f in folds],
        "verdict": verdict,
    }, indent=2), encoding="utf-8")

    (out / "scorecard.json").write_text(json.dumps({
        "verdict": verdict, "aggregate_metrics": agg,
        "log_loss_ci": ll_ci,
    }, indent=2), encoding="utf-8")

    (out / "calibration-report.json").write_text(json.dumps({
        "calibration_slope": agg["calibration_slope"],
        "calibration_intercept": agg["calibration_intercept"],
        "expected_calibration_error": agg["expected_calibration_error"],
        "reliability_table": reliability,
    }, indent=2), encoding="utf-8")

    (out / "hard-gates.json").write_text(json.dumps(gates, indent=2), encoding="utf-8")

    (out / "runtime-profile.json").write_text(json.dumps({
        "status": "not_executed",
        "reason": "Phase 0 numeric harness; no GPU/Ollama capacity run in scope.",
    }, indent=2), encoding="utf-8")

    with (out / "metric-comparison.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["metric", "candidate", "ci_low", "ci_high"])
        w.writerow(["log_loss", agg["log_loss"], ll_ci.get("ci_low"), ll_ci.get("ci_high")])
        for k in ("brier_score", "calibration_slope", "calibration_intercept",
                  "expected_calibration_error", "accuracy", "roc_auc"):
            w.writerow([k, agg[k], "", ""])

    with (out / "temporal-fold-results.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["fold_id", "val_events", "n", "log_loss", "brier_score"])
        for r in fold_results:
            w.writerow([r["fold_id"], r["val_events"], r["n"], r["log_loss"], r["brier_score"]])

    with (out / "slice-results.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["slice", "n", "insufficient_sample", "log_loss", "brier_score", "accuracy"])
        for r in slices:
            w.writerow([r["slice"], r["n"], r["insufficient_sample"],
                        r.get("log_loss"), r.get("brier_score"), r.get("accuracy")])

    (out / "evaluation-summary.md").write_text(_summary_md(ds, agg, gates, verdict), encoding="utf-8")


def _summary_md(ds, agg, gates, verdict) -> str:
    gate_lines = "\n".join(
        f"| {g['id']} | {g['result']} | {g['name']} |" for g in gates["gates"]
    )
    return (
        "# Candidate Evaluation\n\n"
        f"## Verdict\n{verdict}\n\n"
        "## Executive finding\n"
        "Directional/provisional baseline from the Phase 0 numeric harness. "
        "Event-grouped walk-forward evaluation ran to completion with reproducible "
        "artifacts, so the result is no longer `blocked`. It remains `reject` because "
        "PIT-1 (profile-vintage leakage) and NUM-1 (LLM-owned probability) are unaddressed "
        "in the production path.\n\n"
        "## Scope\n"
        f"- Database snapshot: {ds.manifest.database_snapshot_hash}\n"
        f"- Events: {ds.manifest.number_of_events}, "
        f"labeled fights: {ds.manifest.number_of_labeled_fights}\n\n"
        "## Hard gates\n| Gate | Result | Evidence |\n|---|---|---|\n"
        f"{gate_lines}\n\n"
        "## Metric comparison\n"
        f"- log_loss: {agg['log_loss']}\n"
        f"- brier_score: {agg['brier_score']}\n"
        f"- calibration_slope: {agg['calibration_slope']}\n"
        f"- calibration_intercept: {agg['calibration_intercept']}\n"
        f"- ECE: {agg['expected_calibration_error']}\n\n"
        "## Risks and limitations\n"
        "Baseline is PROVISIONAL: fighter-profile features still reflect current vintage "
        "(F-001). Snapshot may be small; treat single-fold metrics cautiously.\n\n"
        "## Required follow-up\n"
        "Phase 1: point-in-time feature service, remove LLM probability, symmetric features.\n"
    )
