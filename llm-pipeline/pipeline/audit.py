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


def _rationale_disagrees_with_pick(narrative: str, red_name: str, blue_name: str,
                                   ensemble_winner: str) -> bool:
    """Heuristic: scan the rationale for a 'disagree → pick X' phrase that names
    the loser of the structured prediction. Returns True if the rationale's
    direction looks inverted relative to predicted_winner.

    Only fires when both names are present and a clear disagree-marker appears
    near the loser's name; conservative on purpose — false positives would be
    worse than a missed flag here.
    """
    if not narrative or not red_name or not blue_name or ensemble_winner not in {"red", "blue"}:
        return False
    text = narrative.lower()
    red_l = red_name.lower()
    blue_l = blue_name.lower()
    if red_l not in text or blue_l not in text:
        return False

    loser_name = blue_l if ensemble_winner == "red" else red_l
    # Look for "i disagree" / "but ... <loser>" patterns where the rationale
    # leans toward the structured loser. These markers are the LLM's own
    # phrasing in the reason.md prompt's expected output.
    disagree_markers = [
        "i disagree",
        "i would pick",
        "favors",
        "advantage",
        "advantages",
        "edge",
    ]
    # Find the position of "disagree" or similar pivot, then check whether the
    # *loser's* name appears within ~120 chars after it.
    for marker in ("i disagree", "but upon", "however"):
        idx = text.find(marker)
        if idx == -1:
            continue
        window = text[idx:idx + 200]
        if loser_name in window and any(m in window for m in disagree_markers):
            return True
    return False


def audit_prediction(payload: dict, *, fighter_names: tuple[str, str] | None = None) -> dict:
    """Return a compact publishability audit for a single ensemble payload.

    fighter_names is (red_name, blue_name); when supplied it enables the
    rationale-vs-pick consistency heuristic. Optional so existing callers and
    summarize_audits can re-audit DB rows without those fields.
    """
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

    # agreement_with_lr is the LLM's self-reported relationship to the LR
    # baseline. If it says "disagrees" but both pick the same side, the LLM is
    # being inconsistent with itself.
    agreement = explanation.get("agreement_with_lr")
    if (
        agreement == "disagrees"
        and lr_winner is not None
        and ensemble_winner is not None
        and lr_winner == ensemble_winner
    ):
        blockers.append("agreement_with_lr_inconsistent")

    # Rationale text vs. structured pick: catches LLM payloads where the
    # narrative argues for the loser but predicted_winner stayed put.
    red_name, blue_name = (fighter_names or ("", ""))
    if ensemble_winner and _rationale_disagrees_with_pick(
        narrative, red_name, blue_name, ensemble_winner,
    ):
        blockers.append("rationale_pick_mismatch")

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
