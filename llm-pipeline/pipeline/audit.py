"""Pre-sync audit helpers for ensemble predictions.

The audit is intentionally deterministic: it turns the local model output into a
small promotion report so dry-runs are reviewable before anything is posted.
"""
from __future__ import annotations


def _prob_delta(payload: dict) -> float | None:
    explanation = payload.get("explanation") or {}
    lr_red = explanation.get("lr_red_prob")
    red = payload.get("red_win_prob")
    try:
        return abs(float(red) - float(lr_red))
    except (TypeError, ValueError):
        return None


def _winner_side(red_prob, blue_prob) -> str | None:
    try:
        red = float(red_prob)
        blue = float(blue_prob)
    except (TypeError, ValueError):
        return None
    return "red" if red >= blue else "blue"


def audit_prediction(payload: dict) -> dict:
    """Return a compact publishability audit for a single ensemble payload."""
    blockers: list[str] = []
    warnings: list[str] = []
    insights = payload.get("insights") if isinstance(payload.get("insights"), list) else []
    narrative = (payload.get("narrative_text") or "").strip()

    try:
        red_prob = float(payload.get("red_win_prob"))
        blue_prob = float(payload.get("blue_win_prob"))
    except (TypeError, ValueError):
        red_prob = blue_prob = None

    confidence = max(red_prob, blue_prob) if red_prob is not None and blue_prob is not None else None
    if confidence is None:
        blockers.append("missing_probabilities")
    elif not 0.5 <= confidence <= 0.99:
        blockers.append("probability_out_of_expected_range")

    if len(narrative) < 40:
        blockers.append("rationale_too_short")
    if not insights:
        warnings.append("no_insights")

    strong_signal_count = 0
    missing_source_count = 0
    for item in insights:
        try:
            severity = int(item.get("severity") or 0)
        except (TypeError, ValueError):
            severity = 0
        if severity >= 2:
            strong_signal_count += 1
        if not (item.get("source") or "").strip():
            missing_source_count += 1
    if missing_source_count:
        warnings.append("insights_missing_source")

    delta = _prob_delta(payload)
    if delta is not None and delta >= 0.18 and strong_signal_count == 0:
        blockers.append("large_probability_shift_without_strong_signal")

    explanation = payload.get("explanation") or {}
    lr_winner = _winner_side(explanation.get("lr_red_prob"), explanation.get("lr_blue_prob"))
    ensemble_winner = _winner_side(red_prob, blue_prob)
    winner_flip = bool(lr_winner and ensemble_winner and lr_winner != ensemble_winner)
    if winner_flip and strong_signal_count == 0:
        blockers.append("winner_flip_without_strong_signal")

    method_conf = payload.get("method_confidence")
    try:
        method_conf_value = float(method_conf) if method_conf is not None else None
    except (TypeError, ValueError):
        method_conf_value = None
    if method_conf_value is not None and method_conf_value < 0.35:
        warnings.append("low_method_confidence")

    grade = "pass"
    if blockers:
        grade = "block"
    elif warnings:
        grade = "review"

    return {
        "publishable": not blockers,
        "grade": grade,
        "blockers": blockers,
        "warnings": warnings,
        "lr_probability_delta": delta,
        "winner_flip": winner_flip,
        "strong_signal_count": strong_signal_count,
        "confidence": confidence,
    }


def summarize_audits(predictions: list[dict]) -> dict:
    audits = [p.get("audit") or audit_prediction(p) for p in predictions]
    blocker_counts: dict[str, int] = {}
    warning_counts: dict[str, int] = {}
    for audit in audits:
        for key in audit.get("blockers", []):
            blocker_counts[key] = blocker_counts.get(key, 0) + 1
        for key in audit.get("warnings", []):
            warning_counts[key] = warning_counts.get(key, 0) + 1
    return {
        "total": len(audits),
        "publishable": sum(1 for a in audits if a.get("publishable")),
        "review": sum(1 for a in audits if a.get("grade") == "review"),
        "blocked": sum(1 for a in audits if a.get("grade") == "block"),
        "blockers": blocker_counts,
        "warnings": warning_counts,
    }


def review_record(payload: dict) -> dict:
    """Trim a prediction payload to the fields useful in dry-run review."""
    return {
        "fight_id": payload.get("fight_id"),
        "model_version": payload.get("model_version"),
        "red_win_prob": payload.get("red_win_prob"),
        "blue_win_prob": payload.get("blue_win_prob"),
        "predicted_method": payload.get("predicted_method"),
        "predicted_round": payload.get("predicted_round"),
        "method_confidence": payload.get("method_confidence"),
        "narrative_text": payload.get("narrative_text"),
        "insights": payload.get("insights") or [],
        "audit": payload.get("audit") or audit_prediction(payload),
    }
