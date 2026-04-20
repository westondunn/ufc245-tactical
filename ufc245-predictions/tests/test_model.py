"""Smoke tests for the prediction model — runs with synthetic data."""
import os
import sys
import tempfile

import numpy as np

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_engineer_features():
    from model import engineer_features
    red_stats = {
        "avg_sig_per_fight": 45.0, "sig_accuracy_pct": 48.0,
        "total_td_landed": 10, "total_fights": 5,
        "total_control_sec": 300, "win_pct_last3": 0.67
    }
    blue_stats = {
        "avg_sig_per_fight": 38.0, "sig_accuracy_pct": 42.0,
        "total_td_landed": 6, "total_fights": 4,
        "total_control_sec": 120, "win_pct_last3": 0.33
    }
    red_fighter = {"reach_cm": 193, "height_cm": 183}
    blue_fighter = {"reach_cm": 183, "height_cm": 180}

    X = engineer_features(red_stats, blue_stats, red_fighter, blue_fighter)
    assert X.shape == (12,), f"Expected 12 features, got {X.shape}"
    assert X[0] == 45.0  # red sig per fight
    assert X[8] == 10.0  # reach delta
    print("  PASS: engineer_features")


def test_feature_hash():
    from model import feature_hash
    X1 = np.array([1.0, 2.0, 3.0])
    X2 = np.array([1.0, 2.0, 4.0])
    h1 = feature_hash(X1)
    h2 = feature_hash(X2)
    assert len(h1) == 12
    assert h1 != h2
    assert feature_hash(X1) == h1  # deterministic
    print("  PASS: feature_hash")


def test_train_and_predict():
    from model import train, predict, MODEL_DIR
    # Use temp dir for model storage
    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ["MODEL_DIR"] = tmpdir
        # Synthetic data: 50 fights
        rng = np.random.RandomState(42)
        X = rng.randn(50, 12)
        y = (X[:, 0] + X[:, 1] > 0).astype(int)  # simple linear boundary

        pipe, cv_acc, version, blob_path = train(X, y)
        assert pipe is not None
        assert 0.0 <= cv_acc <= 1.0
        assert version.startswith("v0.1.")
        assert os.path.exists(blob_path)
        print(f"  PASS: train (cv_acc={cv_acc:.3f}, version={version})")

        # Predict
        red_prob, blue_prob = predict(pipe, X[0])
        assert 0.0 <= red_prob <= 1.0
        assert 0.0 <= blue_prob <= 1.0
        assert abs(red_prob + blue_prob - 1.0) < 0.01
        print(f"  PASS: predict (red={red_prob:.3f}, blue={blue_prob:.3f})")


def test_db_operations():
    from db import init_db, save_model_record, get_latest_model, log_prediction, get_unsynced_predictions, mark_synced
    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ["PREDICTIONS_DB_PATH"] = os.path.join(tmpdir, "test.db")
        init_db()

        save_model_record("v0.1.test", "/fake/path.joblib",
                          ["f1", "f2"], 0.65, 100)
        model = get_latest_model()
        assert model is not None
        assert model["version"] == "v0.1.test"
        print("  PASS: save/get model record")

        log_prediction(1, 10, 20, 0.6, 0.4, "v0.1.test", "abc123", "2026-05-01")
        unsynced = get_unsynced_predictions()
        assert len(unsynced) == 1
        assert unsynced[0]["fight_id"] == 1
        print("  PASS: log_prediction + get_unsynced")

        mark_synced([unsynced[0]["id"]])
        unsynced2 = get_unsynced_predictions()
        assert len(unsynced2) == 0
        print("  PASS: mark_synced")


def test_empty_inputs():
    from model import engineer_features
    X = engineer_features({}, {}, {}, {})
    assert X.shape == (12,)
    assert not np.any(np.isnan(X))
    print("  PASS: empty inputs produce valid features")


if __name__ == "__main__":
    print("\n=== UFC Predictions Model Tests ===\n")
    test_engineer_features()
    test_feature_hash()
    test_train_and_predict()
    test_db_operations()
    test_empty_inputs()
    print("\n=== All 6 tests passed ===\n")
