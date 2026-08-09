"""Proper scoring metrics for binary winner probabilities."""
from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

_EPS = 1e-6


def _clip(p: np.ndarray) -> np.ndarray:
    return np.clip(np.asarray(p, dtype=float), _EPS, 1 - _EPS)


def calibration_slope_intercept(y: np.ndarray, p: np.ndarray) -> tuple[float, float]:
    """Cox calibration: regress outcomes on logit(p). slope=1, intercept=0 ideal."""
    p = _clip(p)
    logit = np.log(p / (1 - p)).reshape(-1, 1)
    y = np.asarray(y, dtype=int)
    if len(np.unique(y)) < 2:
        return float("nan"), float("nan")
    lr = LogisticRegression(C=1e6, solver="lbfgs", max_iter=1000)
    lr.fit(logit, y)
    return float(lr.coef_[0][0]), float(lr.intercept_[0])


def expected_calibration_error(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> float:
    p = _clip(p)
    y = np.asarray(y, dtype=int)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    n = len(y)
    ece = 0.0
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p > lo) & (p <= hi) if i > 0 else (p >= lo) & (p <= hi)
        if not mask.any():
            continue
        conf = p[mask].mean()
        acc = y[mask].mean()
        ece += (mask.sum() / n) * abs(acc - conf)
    return float(ece)


def reliability_table(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> list:
    p = _clip(p)
    y = np.asarray(y, dtype=int)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    table = []
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p > lo) & (p <= hi) if i > 0 else (p >= lo) & (p <= hi)
        count = int(mask.sum())
        table.append({
            "bin_lo": float(lo), "bin_hi": float(hi), "count": count,
            "mean_predicted": float(p[mask].mean()) if count else None,
            "observed_rate": float(y[mask].mean()) if count else None,
        })
    return table


def winner_metrics(y: np.ndarray, p: np.ndarray) -> dict:
    y = np.asarray(y, dtype=int)
    p = _clip(p)
    slope, intercept = calibration_slope_intercept(y, p)
    two_class = len(np.unique(y)) == 2
    return {
        "n": int(len(y)),
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "brier_score": float(brier_score_loss(y, p)),
        "calibration_slope": slope,
        "calibration_intercept": intercept,
        "expected_calibration_error": expected_calibration_error(y, p),
        "accuracy": float(((p >= 0.5).astype(int) == y).mean()),
        "roc_auc": float(roc_auc_score(y, p)) if two_class else None,
    }
