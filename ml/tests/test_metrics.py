import numpy as np

from ml.metrics import winner_metrics, reliability_table


def test_perfect_predictions_have_low_log_loss():
    y = np.array([1, 0, 1, 0, 1, 0])
    p = np.array([0.99, 0.01, 0.99, 0.01, 0.99, 0.01])
    m = winner_metrics(y, p)
    assert m["log_loss"] < 0.05
    assert m["brier_score"] < 0.01
    assert m["accuracy"] == 1.0
    assert m["roc_auc"] == 1.0


def test_metrics_keys_present():
    rng = np.random.default_rng(0)
    y = rng.integers(0, 2, size=200)
    p = rng.uniform(0.2, 0.8, size=200)
    m = winner_metrics(y, p)
    for key in ("log_loss", "brier_score", "calibration_slope",
                "calibration_intercept", "expected_calibration_error",
                "accuracy", "roc_auc"):
        assert key in m and m[key] is not None


def test_reliability_table_bins_sum_to_n():
    y = np.array([1, 0, 1, 0, 1, 1, 0, 0])
    p = np.array([0.9, 0.1, 0.8, 0.2, 0.7, 0.6, 0.3, 0.4])
    table = reliability_table(y, p, n_bins=4)
    assert sum(row["count"] for row in table) == len(y)
