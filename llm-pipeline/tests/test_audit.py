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
