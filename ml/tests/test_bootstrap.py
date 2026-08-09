import numpy as np

from ml.bootstrap import event_bootstrap_ci, prob_candidate_improves


def test_ci_brackets_point_estimate():
    rng = np.random.default_rng(1)
    n = 300
    event_ids = rng.integers(0, 30, size=n)
    y = rng.integers(0, 2, size=n)
    p = rng.uniform(0.3, 0.7, size=n)
    res = event_bootstrap_ci(event_ids, y, p, metric="log_loss", n_boot=200, seed=7)
    assert res["ci_low"] <= res["point"] <= res["ci_high"]
    assert res["ci_low"] < res["ci_high"]


def test_probability_candidate_improves_is_between_zero_and_one():
    rng = np.random.default_rng(2)
    n = 200
    event_ids = rng.integers(0, 20, size=n)
    y = rng.integers(0, 2, size=n)
    p_base = rng.uniform(0.3, 0.7, size=n)
    p_cand = np.clip(p_base + (y - 0.5) * 0.05, 1e-6, 1 - 1e-6)  # candidate slightly better
    pr = prob_candidate_improves(event_ids, y, p_base, p_cand, metric="log_loss",
                                 n_boot=200, seed=3)
    assert 0.0 <= pr <= 1.0
