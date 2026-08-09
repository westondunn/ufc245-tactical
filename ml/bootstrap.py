"""Event-level bootstrap: resample whole events to preserve dependence."""
from __future__ import annotations

import numpy as np
from sklearn.metrics import brier_score_loss, log_loss

_METRICS = {
    "log_loss": lambda y, p: log_loss(y, np.clip(p, 1e-6, 1 - 1e-6), labels=[0, 1]),
    "brier_score": lambda y, p: brier_score_loss(y, np.clip(p, 1e-6, 1 - 1e-6)),
}


def _resample_indices(event_ids: np.ndarray, rng) -> np.ndarray:
    events = np.unique(event_ids)
    drawn = rng.choice(events, size=len(events), replace=True)
    idx = []
    by_event = {ev: np.where(event_ids == ev)[0] for ev in events}
    for ev in drawn:
        idx.append(by_event[ev])
    return np.concatenate(idx) if idx else np.array([], dtype=int)


def event_bootstrap_ci(event_ids, y, p, *, metric="log_loss", n_boot=1000, seed=42,
                       alpha=0.05) -> dict:
    event_ids = np.asarray(event_ids)
    y = np.asarray(y, dtype=int)
    p = np.asarray(p, dtype=float)
    fn = _METRICS[metric]
    rng = np.random.default_rng(seed)
    point = float(fn(y, p))
    samples = []
    for _ in range(n_boot):
        idx = _resample_indices(event_ids, rng)
        if len(np.unique(y[idx])) < 2 and metric == "log_loss":
            continue
        samples.append(fn(y[idx], p[idx]))
    samples = np.array(samples)
    return {
        "metric": metric,
        "point": point,
        "ci_low": float(np.quantile(samples, alpha / 2)),
        "ci_high": float(np.quantile(samples, 1 - alpha / 2)),
        "n_boot": len(samples),
    }


def prob_candidate_improves(event_ids, y, p_base, p_cand, *, metric="log_loss",
                            n_boot=1000, seed=42) -> float:
    """Fraction of event-bootstrap resamples where candidate metric < baseline."""
    event_ids = np.asarray(event_ids)
    y = np.asarray(y, dtype=int)
    fn = _METRICS[metric]
    rng = np.random.default_rng(seed)
    wins = total = 0
    for _ in range(n_boot):
        idx = _resample_indices(event_ids, rng)
        if len(np.unique(y[idx])) < 2 and metric == "log_loss":
            continue
        total += 1
        if fn(y[idx], np.asarray(p_cand)[idx]) < fn(y[idx], np.asarray(p_base)[idx]):
            wins += 1
    return wins / total if total else 0.0
