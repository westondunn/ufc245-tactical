"""Fight outcome prediction model.

The production model is intentionally compact: a regularized logistic
regression over matchup deltas, point-in-time career aggregates, profile
metrics, and recent form. It stays explainable and behaves well on the small,
noisy labeled set available in this project.
"""
import hashlib
import os
from datetime import datetime

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

MODEL_DIR = "model_store"


def _model_dir() -> str:
    return os.getenv("MODEL_DIR", MODEL_DIR)

FEATURE_NAMES = [
    "red_sig_str_landed_avg",
    "blue_sig_str_landed_avg",
    "sig_str_landed_avg_delta",
    "red_sig_accuracy",
    "blue_sig_accuracy",
    "sig_accuracy_delta",
    "red_td_landed_avg",
    "blue_td_landed_avg",
    "td_landed_avg_delta",
    "red_td_accuracy",
    "blue_td_accuracy",
    "td_accuracy_delta",
    "red_ctrl_sec_avg",
    "blue_ctrl_sec_avg",
    "ctrl_sec_avg_delta",
    "red_knockdowns_avg",
    "blue_knockdowns_avg",
    "knockdowns_avg_delta",
    "red_sub_attempts_avg",
    "blue_sub_attempts_avg",
    "sub_attempts_avg_delta",
    "reach_delta_cm",
    "height_delta_cm",
    "red_profile_slpm",
    "blue_profile_slpm",
    "profile_slpm_delta",
    "red_profile_str_def",
    "blue_profile_str_def",
    "profile_str_def_delta",
    "red_profile_td_def",
    "blue_profile_td_def",
    "profile_td_def_delta",
    "red_win_pct_last3",
    "blue_win_pct_last3",
    "win_pct_last3_delta",
    "red_experience",
    "blue_experience",
    "experience_delta",
]

FEATURE_LABELS = {
    "sig_str_landed_avg_delta": "Striking pace",
    "sig_accuracy_delta": "Striking accuracy",
    "td_landed_avg_delta": "Takedown volume",
    "td_accuracy_delta": "Takedown accuracy",
    "ctrl_sec_avg_delta": "Control time",
    "knockdowns_avg_delta": "Knockdown threat",
    "sub_attempts_avg_delta": "Submission activity",
    "reach_delta_cm": "Reach",
    "height_delta_cm": "Height",
    "profile_slpm_delta": "Profile striking pace",
    "profile_str_def_delta": "Striking defense",
    "profile_td_def_delta": "Takedown defense",
    "win_pct_last3_delta": "Recent form",
    "experience_delta": "UFC experience",
}

FEATURE_EVIDENCE = {
    "sig_str_landed_avg_delta": {
        "category": "Striking volume",
        "red_feature": "red_sig_str_landed_avg",
        "blue_feature": "blue_sig_str_landed_avg",
        "unit": "sig. strikes/fight",
        "source": "career_stats.avg_sig_per_fight",
    },
    "sig_accuracy_delta": {
        "category": "Striking efficiency",
        "red_feature": "red_sig_accuracy",
        "blue_feature": "blue_sig_accuracy",
        "unit": "pct",
        "source": "career_stats.sig_accuracy_pct",
    },
    "td_landed_avg_delta": {
        "category": "Wrestling volume",
        "red_feature": "red_td_landed_avg",
        "blue_feature": "blue_td_landed_avg",
        "unit": "takedowns/fight",
        "source": "career_stats.total_td_landed / total_fights",
    },
    "td_accuracy_delta": {
        "category": "Wrestling efficiency",
        "red_feature": "red_td_accuracy",
        "blue_feature": "blue_td_accuracy",
        "unit": "pct",
        "source": "career_stats.td_accuracy_pct",
    },
    "ctrl_sec_avg_delta": {
        "category": "Control",
        "red_feature": "red_ctrl_sec_avg",
        "blue_feature": "blue_ctrl_sec_avg",
        "unit": "sec/fight",
        "source": "career_stats.total_control_sec / total_fights",
    },
    "knockdowns_avg_delta": {
        "category": "Power",
        "red_feature": "red_knockdowns_avg",
        "blue_feature": "blue_knockdowns_avg",
        "unit": "knockdowns/fight",
        "source": "career_stats.total_knockdowns / total_fights",
    },
    "sub_attempts_avg_delta": {
        "category": "Submission threat",
        "red_feature": "red_sub_attempts_avg",
        "blue_feature": "blue_sub_attempts_avg",
        "unit": "sub attempts/fight",
        "source": "career_stats.total_sub_attempts / total_fights",
    },
    "reach_delta_cm": {
        "category": "Physical tools",
        "red_feature": None,
        "blue_feature": None,
        "unit": "cm reach edge",
        "source": "fighter_profile.reach_cm",
    },
    "height_delta_cm": {
        "category": "Physical tools",
        "red_feature": None,
        "blue_feature": None,
        "unit": "cm height edge",
        "source": "fighter_profile.height_cm",
    },
    "profile_slpm_delta": {
        "category": "Profile striking pace",
        "red_feature": "red_profile_slpm",
        "blue_feature": "blue_profile_slpm",
        "unit": "SLpM",
        "source": "fighter_profile.slpm",
    },
    "profile_str_def_delta": {
        "category": "Striking defense",
        "red_feature": "red_profile_str_def",
        "blue_feature": "blue_profile_str_def",
        "unit": "pct",
        "source": "fighter_profile.str_def",
    },
    "profile_td_def_delta": {
        "category": "Takedown defense",
        "red_feature": "red_profile_td_def",
        "blue_feature": "blue_profile_td_def",
        "unit": "pct",
        "source": "fighter_profile.td_def",
    },
    "win_pct_last3_delta": {
        "category": "Recent form",
        "red_feature": "red_win_pct_last3",
        "blue_feature": "blue_win_pct_last3",
        "unit": "pct",
        "source": "career_stats.win_pct_last3",
    },
    "experience_delta": {
        "category": "Experience",
        "red_feature": "red_experience",
        "blue_feature": "blue_experience",
        "unit": "UFC fights",
        "source": "career_stats.total_fights",
    },
}


def _feature_value(values: dict, feature: str | None):
    if not feature:
        return None
    value = values.get(feature)
    return None if value is None else float(value)


def _build_factor_evidence(feature: str, raw_value: float, values: dict,
                           red_name: str, blue_name: str) -> dict:
    meta = FEATURE_EVIDENCE.get(feature, {})
    red_value = _feature_value(values, meta.get("red_feature"))
    blue_value = _feature_value(values, meta.get("blue_feature"))
    return {
        "category": meta.get("category", "Model factor"),
        "source": meta.get("source", "engineered_features"),
        "unit": meta.get("unit", "delta"),
        "red": {"fighter": red_name, "value": red_value},
        "blue": {"fighter": blue_name, "value": blue_value},
        "delta": raw_value,
        "interpretation": (
            f"{red_name} leads this metric." if raw_value > 0
            else f"{blue_name} leads this metric." if raw_value < 0
            else "This metric is even."
        ),
    }


def _build_categories(factors: list[dict]) -> list[dict]:
    grouped: dict[str, dict] = {}
    for factor in factors:
        evidence = factor.get("evidence") or {}
        category = evidence.get("category") or "Model factor"
        bucket = grouped.setdefault(category, {
            "category": category,
            "net_impact": 0.0,
            "favors": None,
            "evidence": [],
        })
        signed = factor["impact"] if factor.get("favors") == "red" else -factor["impact"]
        bucket["net_impact"] += signed
        bucket["evidence"].append({
            "label": factor.get("label"),
            "favors": factor.get("favors"),
            "fighter": factor.get("fighter"),
            "impact": factor.get("impact"),
            "value": factor.get("value"),
            "source": evidence.get("source"),
            "unit": evidence.get("unit"),
            "red": evidence.get("red"),
            "blue": evidence.get("blue"),
            "delta": evidence.get("delta"),
            "interpretation": evidence.get("interpretation"),
        })

    categories = []
    for bucket in grouped.values():
        net = float(bucket["net_impact"])
        bucket["net_impact"] = abs(net)
        bucket["favors"] = "red" if net >= 0 else "blue"
        bucket["evidence"].sort(key=lambda item: item.get("impact") or 0, reverse=True)
        categories.append(bucket)
    categories.sort(key=lambda item: item["net_impact"], reverse=True)
    return categories

def engineer_features(red_stats: dict, blue_stats: dict,
                      red_fighter: dict, blue_fighter: dict) -> np.ndarray:
    """Build feature vector from fighter stats and profiles.

    All inputs come from the main app's API responses.
    Returns a 1D numpy array of shape (n_features,).
    """
    def safe(d, key, default=0.0):
        v = d.get(key) if d else None
        try:
            return float(v) if v is not None else default
        except (TypeError, ValueError):
            return default

    def per_fight(stats, key):
        return safe(stats, key) / max(safe(stats, "total_fights", 1), 1)

    red_sig = safe(red_stats, "avg_sig_per_fight")
    blue_sig = safe(blue_stats, "avg_sig_per_fight")
    red_acc = safe(red_stats, "sig_accuracy_pct") / 100.0
    blue_acc = safe(blue_stats, "sig_accuracy_pct") / 100.0
    red_td = per_fight(red_stats, "total_td_landed")
    blue_td = per_fight(blue_stats, "total_td_landed")
    red_td_acc = safe(red_stats, "td_accuracy_pct") / 100.0
    blue_td_acc = safe(blue_stats, "td_accuracy_pct") / 100.0
    red_ctrl = per_fight(red_stats, "total_control_sec")
    blue_ctrl = per_fight(blue_stats, "total_control_sec")
    red_kd = per_fight(red_stats, "total_knockdowns")
    blue_kd = per_fight(blue_stats, "total_knockdowns")
    red_sub = per_fight(red_stats, "total_sub_attempts")
    blue_sub = per_fight(blue_stats, "total_sub_attempts")
    red_slpm = safe(red_fighter, "slpm")
    blue_slpm = safe(blue_fighter, "slpm")
    red_str_def = safe(red_fighter, "str_def") / 100.0
    blue_str_def = safe(blue_fighter, "str_def") / 100.0
    red_td_def = safe(red_fighter, "td_def") / 100.0
    blue_td_def = safe(blue_fighter, "td_def") / 100.0
    red_recent = safe(red_stats, "win_pct_last3", 0.5)
    blue_recent = safe(blue_stats, "win_pct_last3", 0.5)
    red_exp = safe(red_stats, "total_fights")
    blue_exp = safe(blue_stats, "total_fights")

    features = [
        red_sig, blue_sig, red_sig - blue_sig,
        red_acc, blue_acc, red_acc - blue_acc,
        red_td, blue_td, red_td - blue_td,
        red_td_acc, blue_td_acc, red_td_acc - blue_td_acc,
        red_ctrl, blue_ctrl, red_ctrl - blue_ctrl,
        red_kd, blue_kd, red_kd - blue_kd,
        red_sub, blue_sub, red_sub - blue_sub,
        safe(red_fighter, "reach_cm") - safe(blue_fighter, "reach_cm"),
        safe(red_fighter, "height_cm") - safe(blue_fighter, "height_cm"),
        red_slpm, blue_slpm, red_slpm - blue_slpm,
        red_str_def, blue_str_def, red_str_def - blue_str_def,
        red_td_def, blue_td_def, red_td_def - blue_td_def,
        red_recent, blue_recent, red_recent - blue_recent,
        red_exp, blue_exp, red_exp - blue_exp,
    ]
    return np.nan_to_num(np.array(features, dtype=np.float64), nan=0.0, posinf=0.0, neginf=0.0)


def feature_hash(X: np.ndarray) -> str:
    """Compute a short hash of the feature vector for dedup."""
    return hashlib.md5(X.tobytes()).hexdigest()[:12]


def train(X: np.ndarray, y: np.ndarray) -> tuple:
    """Train a logistic regression pipeline.

    Returns (pipeline, cv_accuracy, version_string).
    """
    model_dir = _model_dir()
    os.makedirs(model_dir, exist_ok=True)

    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("lr", LogisticRegression(
            C=1.0, max_iter=1000, solver="lbfgs", class_weight="balanced"
        ))
    ])

    if len(np.unique(y)) < 2:
        raise ValueError("Training labels must contain both red and blue wins")

    _, class_counts = np.unique(y, return_counts=True)
    n_folds = min(5, int(class_counts.min()))
    if n_folds >= 2:
        cv = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=42)
        scores = cross_val_score(pipe, X, y, cv=cv, scoring="accuracy")
        cv_acc = float(scores.mean())
    else:
        cv_acc = 0.0

    # Fit on all data
    pipe.fit(X, y)

    version = f"v0.2.{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    blob_path = os.path.join(model_dir, f"{version}.joblib")
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


def explain_prediction(pipe, X: np.ndarray, red_name: str = "Red",
                       blue_name: str = "Blue", limit: int = 5) -> dict:
    """Explain a logistic-regression prediction with top feature contributions.

    Positive contributions favor the red corner. Negative contributions favor
    the blue corner. Values are model-logit contributions after scaler
    transformation, so they are directional rather than standalone odds.
    """
    red_prob, blue_prob = predict(pipe, X)
    favored_corner = "red" if red_prob >= blue_prob else "blue"
    favored_name = red_name if favored_corner == "red" else blue_name

    lr = pipe.named_steps.get("lr") if hasattr(pipe, "named_steps") else None
    scaler = pipe.named_steps.get("scaler") if hasattr(pipe, "named_steps") else None
    if lr is None or scaler is None or not hasattr(lr, "coef_"):
        return {
            "favored_corner": favored_corner,
            "favored_name": favored_name,
            "confidence": max(red_prob, blue_prob),
            "summary": f"{favored_name} is favored by the model.",
            "factors": [],
            "categories": [],
        }

    scaled = scaler.transform(X.reshape(1, -1))[0]
    coefs = lr.coef_[0]
    contributions = scaled * coefs
    values = {name: float(X[idx]) for idx, name in enumerate(FEATURE_NAMES)}

    factors = []
    for idx, feature in enumerate(FEATURE_NAMES):
        if feature not in FEATURE_LABELS:
            continue
        contribution = float(contributions[idx])
        if abs(contribution) < 0.01:
            continue
        raw_value = float(X[idx])
        favors_corner = "red" if contribution > 0 else "blue"
        factors.append({
            "feature": feature,
            "label": FEATURE_LABELS[feature],
            "favors": favors_corner,
            "fighter": red_name if favors_corner == "red" else blue_name,
            "value": raw_value,
            "impact": abs(contribution),
            "direction": "positive" if contribution > 0 else "negative",
            "evidence": _build_factor_evidence(feature, raw_value, values, red_name, blue_name),
        })

    factors.sort(key=lambda f: f["impact"], reverse=True)
    top = factors[:limit]
    categories = _build_categories(factors)
    if top:
        lead = top[0]
        summary = (
            f"{favored_name} is favored, led by {lead['label'].lower()} "
            f"favoring {lead['fighter']}."
        )
    else:
        summary = f"{favored_name} is favored, but no single factor dominates."

    return {
        "favored_corner": favored_corner,
        "favored_name": favored_name,
        "confidence": max(red_prob, blue_prob),
        "summary": summary,
        "factors": top,
        "categories": categories,
    }
