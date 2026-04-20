"""Logistic regression fight prediction model.

Baseline: ~10 engineered features from striking/grappling deltas,
physical attributes, and recent form. Designed for small datasets
(n >= 50 labeled fights).
"""
import hashlib
import os
from datetime import datetime

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

MODEL_DIR = os.getenv("MODEL_DIR", "model_store")

# Feature names used in the current model version
FEATURE_NAMES = [
    "red_sig_str_landed_avg",
    "blue_sig_str_landed_avg",
    "red_sig_accuracy",
    "blue_sig_accuracy",
    "red_td_landed_avg",
    "blue_td_landed_avg",
    "red_ctrl_sec_avg",
    "blue_ctrl_sec_avg",
    "reach_delta_cm",
    "height_delta_cm",
    "red_win_pct_last3",
    "blue_win_pct_last3",
]


def engineer_features(red_stats: dict, blue_stats: dict,
                      red_fighter: dict, blue_fighter: dict) -> np.ndarray:
    """Build feature vector from fighter stats and profiles.

    All inputs come from the main app's API responses.
    Returns a 1D numpy array of shape (n_features,).
    """
    def safe(d, key, default=0.0):
        v = d.get(key) if d else None
        return float(v) if v is not None else default

    features = [
        safe(red_stats, "avg_sig_per_fight"),
        safe(blue_stats, "avg_sig_per_fight"),
        safe(red_stats, "sig_accuracy_pct") / 100.0,
        safe(blue_stats, "sig_accuracy_pct") / 100.0,
        safe(red_stats, "total_td_landed") / max(safe(red_stats, "total_fights", 1), 1),
        safe(blue_stats, "total_td_landed") / max(safe(blue_stats, "total_fights", 1), 1),
        safe(red_stats, "total_control_sec") / max(safe(red_stats, "total_fights", 1), 1),
        safe(blue_stats, "total_control_sec") / max(safe(blue_stats, "total_fights", 1), 1),
        safe(red_fighter, "reach_cm") - safe(blue_fighter, "reach_cm"),
        safe(red_fighter, "height_cm") - safe(blue_fighter, "height_cm"),
        safe(red_stats, "win_pct_last3", 0.5),
        safe(blue_stats, "win_pct_last3", 0.5),
    ]
    return np.array(features, dtype=np.float64)


def feature_hash(X: np.ndarray) -> str:
    """Compute a short hash of the feature vector for dedup."""
    return hashlib.md5(X.tobytes()).hexdigest()[:12]


def train(X: np.ndarray, y: np.ndarray) -> tuple:
    """Train a logistic regression pipeline.

    Returns (pipeline, cv_accuracy, version_string).
    """
    os.makedirs(MODEL_DIR, exist_ok=True)

    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("lr", LogisticRegression(
            C=1.0, max_iter=1000, solver="lbfgs", class_weight="balanced"
        ))
    ])

    # Cross-validate
    n_folds = min(5, len(y))
    if n_folds >= 2:
        scores = cross_val_score(pipe, X, y, cv=n_folds, scoring="accuracy")
        cv_acc = float(scores.mean())
    else:
        cv_acc = 0.0

    # Fit on all data
    pipe.fit(X, y)

    version = f"v0.1.{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    blob_path = os.path.join(MODEL_DIR, f"{version}.joblib")
    joblib.dump(pipe, blob_path)

    return pipe, cv_acc, version, blob_path


def load_model(blob_path: str):
    """Load a trained pipeline from disk."""
    return joblib.load(blob_path)


def predict(pipe, X: np.ndarray) -> tuple[float, float]:
    """Predict red/blue win probabilities.

    Returns (red_win_prob, blue_win_prob).
    """
    proba = pipe.predict_proba(X.reshape(1, -1))[0]
    # Class 0 = blue wins, class 1 = red wins (label encoding)
    if len(proba) == 2:
        red_prob = float(proba[1])
        blue_prob = float(proba[0])
    else:
        red_prob = blue_prob = 0.5
    return red_prob, blue_prob
