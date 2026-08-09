"""Per-slice metric breakdowns. Small slices are flagged, never silently dropped."""
from __future__ import annotations

import numpy as np

from ml.metrics import winner_metrics


def slice_metrics(rows: list, y, p, *, slice_keys: list, min_n: int = 30) -> list:
    y = np.asarray(y, dtype=int)
    p = np.asarray(p, dtype=float)
    out = []
    for key in slice_keys:
        values = sorted({str(r.get(key)) for r in rows})
        for val in values:
            idx = np.array([i for i, r in enumerate(rows) if str(r.get(key)) == val])
            if len(idx) == 0:
                continue
            ys, ps = y[idx], p[idx]
            insufficient = len(idx) < min_n or len(np.unique(ys)) < 2
            row = {"slice": f"{key}={val}", "n": int(len(idx)),
                   "insufficient_sample": bool(insufficient)}
            if len(np.unique(ys)) < 2:
                row.update({"log_loss": None, "brier_score": None, "accuracy": None})
            else:
                m = winner_metrics(ys, ps)
                row.update({"log_loss": m["log_loss"], "brier_score": m["brier_score"],
                            "accuracy": m["accuracy"]})
            out.append(row)
    return out
