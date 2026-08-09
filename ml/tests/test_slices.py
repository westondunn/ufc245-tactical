import numpy as np

from ml.slices import slice_metrics

_SLICE_KEYS = ["weight_class", "main_event", "scheduled_rounds", "debutant",
               "history_band", "feature_completeness_band",
               "qualitative_source_coverage"]


def _rows():
    rows = []
    for i in range(20):
        rows.append({
            "weight_class": "Lightweight" if i % 2 else "Welterweight",
            "main_event": bool(i % 5 == 0),
            "scheduled_rounds": 5 if i % 5 == 0 else 3,
            "debutant": bool(i % 4 == 0),
            "history_band": "low" if i % 3 == 0 else "high",
            "feature_completeness_band": "complete",
            "qualitative_source_coverage": "none",
        })
    return rows


def test_slice_metrics_cover_all_keys():
    rows = _rows()
    y = np.array([i % 2 for i in range(20)])
    p = np.clip(np.array([0.4 + 0.01 * i for i in range(20)]), 0, 1)
    out = slice_metrics(rows, y, p, slice_keys=_SLICE_KEYS)
    produced = {r["slice"] for r in out}
    assert "weight_class=Lightweight" in produced
    assert any(r["slice"].startswith("debutant=") for r in out)
    for r in out:
        assert "log_loss" in r and "n" in r


def test_small_slices_are_flagged_not_dropped():
    rows = _rows()
    y = np.array([i % 2 for i in range(20)])
    p = np.full(20, 0.5)
    out = slice_metrics(rows, y, p, slice_keys=_SLICE_KEYS, min_n=100)
    assert all(r["insufficient_sample"] for r in out)
