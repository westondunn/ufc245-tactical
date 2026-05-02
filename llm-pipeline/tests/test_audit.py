from pipeline.audit import audit_prediction, review_record, summarize_audits


def _payload(**overrides):
    base = {
        "fight_id": 1,
        "red_win_prob": 0.61,
        "blue_win_prob": 0.39,
        "predicted_method": "Decision",
        "predicted_round": None,
        "method_confidence": 0.55,
        "narrative_text": "LR leans red and the extracted signals support the same side.",
        "insights": [
            {"label": "Reach edge", "severity": 1, "favors": "red", "source": "lr_features"}
        ],
        "explanation": {"lr_red_prob": 0.58, "lr_blue_prob": 0.42},
    }
    base.update(overrides)
    return base


def test_audit_passes_grounded_small_shift():
    audit = audit_prediction(_payload())
    assert audit["publishable"] is True
    assert audit["grade"] == "pass"
    assert audit["blockers"] == []


def test_audit_blocks_big_flip_without_signal():
    audit = audit_prediction(_payload(
        red_win_prob=0.35,
        blue_win_prob=0.65,
        explanation={"lr_red_prob": 0.66, "lr_blue_prob": 0.34},
        insights=[{"label": "Minor note", "severity": 1, "favors": "blue", "source": "news"}],
    ))
    assert audit["publishable"] is False
    assert "winner_flip_without_strong_signal" in audit["blockers"]
    assert "large_probability_shift_without_strong_signal" in audit["blockers"]


def test_summary_and_review_record_are_compact():
    blocked = _payload(narrative_text="Too short")
    blocked["audit"] = audit_prediction(blocked)
    good = _payload(fight_id=2)
    good["audit"] = audit_prediction(good)
    summary = summarize_audits([blocked, good])
    assert summary["total"] == 2
    assert summary["publishable"] == 1
    assert summary["blocked"] == 1
    record = review_record(good)
    assert set(record).issuperset({"fight_id", "red_win_prob", "audit", "insights"})
    assert "explanation" not in record


def test_agreement_with_lr_inconsistent_blocker():
    # LLM claims "disagrees" with LR but ensemble pick equals LR pick.
    audit = audit_prediction(_payload(
        red_win_prob=0.37,
        blue_win_prob=0.63,
        explanation={
            "lr_red_prob": 0.369,
            "lr_blue_prob": 0.631,
            "agreement_with_lr": "disagrees",
        },
    ))
    assert "agreement_with_lr_inconsistent" in audit["blockers"]
    assert audit["publishable"] is False


def test_agreement_with_lr_agrees_does_not_trigger():
    audit = audit_prediction(_payload(
        explanation={
            "lr_red_prob": 0.58,
            "lr_blue_prob": 0.42,
            "agreement_with_lr": "agrees",
        },
    ))
    assert "agreement_with_lr_inconsistent" not in audit["blockers"]


def test_rationale_pick_mismatch_blocker():
    # Tuivasa vs Sharaf — production payload that prompted this fix.
    audit = audit_prediction(
        _payload(
            red_win_prob=0.37,
            blue_win_prob=0.63,
            narrative_text=(
                "The LR baseline favors Sean Sharaf, but upon reviewing the soft "
                "signals, I disagree due to Tai Tuivasa's significant advantages "
                "in striking pace and takedown defense."
            ),
            explanation={"lr_red_prob": 0.369, "lr_blue_prob": 0.631},
        ),
        fighter_names=("Tai Tuivasa", "Sean Sharaf"),
    )
    assert "rationale_pick_mismatch" in audit["blockers"]
    assert audit["publishable"] is False


def test_rationale_aligned_with_pick_does_not_trigger():
    # Same narrative direction (favors Tuivasa) but the structured pick is
    # also Tuivasa — no inconsistency.
    audit = audit_prediction(
        _payload(
            red_win_prob=0.63,
            blue_win_prob=0.37,
            narrative_text=(
                "I disagree with the baseline; Tai Tuivasa's striking pace and "
                "takedown defense advantages tilt this fight his way."
            ),
            explanation={"lr_red_prob": 0.369, "lr_blue_prob": 0.631},
        ),
        fighter_names=("Tai Tuivasa", "Sean Sharaf"),
    )
    assert "rationale_pick_mismatch" not in audit["blockers"]


def test_rationale_check_skips_when_names_missing():
    # Without fighter_names the heuristic must not fire — keeps re-auditing
    # DB rows safe for callers that don't have name context.
    audit = audit_prediction(_payload(
        red_win_prob=0.37,
        blue_win_prob=0.63,
        narrative_text=(
            "The LR baseline favors Sean Sharaf, but I disagree due to Tai "
            "Tuivasa's striking advantages."
        ),
    ))
    assert "rationale_pick_mismatch" not in audit["blockers"]
