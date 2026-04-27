import os
import shutil
from pathlib import Path
import pytest
import numpy as np

from pipeline import lr_runner


@pytest.fixture
def shared_model_path(tmp_path, monkeypatch):
    # Copy real model code into tmp shared path so SHARED_MODEL_PATH points at it.
    src = Path(__file__).resolve().parents[2] / "ufc245-predictions" / "model"
    dst = tmp_path / "shared_model"
    shutil.copytree(src, dst)
    monkeypatch.setenv("SHARED_MODEL_PATH", str(dst))
    # Force re-import of the shared model module since prior tests may have cached it.
    import importlib
    if "model" in list(__import__("sys").modules):
        del __import__("sys").modules["model"]
    importlib.reload(lr_runner)
    yield str(dst)


def test_engineer_features_via_runner(shared_model_path):
    runner = lr_runner.LRRunner.from_env()
    red_stats = {"avg_sig_per_fight": 4.5, "sig_accuracy_pct": 50, "total_fights": 10,
                 "total_td_landed": 5, "td_accuracy_pct": 35, "total_control_sec": 300,
                 "total_knockdowns": 1, "total_sub_attempts": 1, "win_pct_last3": 0.66}
    blue_stats = dict(red_stats)
    red_fighter = {"slpm": 4.5, "str_def": 55, "td_def": 65, "reach_cm": 180, "height_cm": 170}
    blue_fighter = dict(red_fighter)
    X = runner.engineer_features(red_stats, blue_stats, red_fighter, blue_fighter)
    assert isinstance(X, np.ndarray)
    assert X.shape[0] == len(runner.feature_names)


def test_predict_with_dummy_model(shared_model_path, tmp_path):
    """Train a 2-class dummy logistic regression and use it for predict()."""
    runner = lr_runner.LRRunner.from_env()
    X = np.random.RandomState(0).randn(40, len(runner.feature_names))
    y = (X[:, 2] > 0).astype(int)
    pipe, _, _, blob = runner.train_and_save(X, y, model_dir=str(tmp_path))
    red_prob, blue_prob = runner.predict(pipe, X[0])
    assert 0.0 <= red_prob <= 1.0
    assert abs((red_prob + blue_prob) - 1.0) < 1e-6
