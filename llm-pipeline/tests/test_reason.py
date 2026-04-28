from pipeline.reason import StageTwoReasoner


class _Provider:
    def __init__(self, response):
        self._response = response
    def chat_json(self, system, user, **kwargs):
        return self._response


def test_reasoner_returns_structured_prediction():
    provider = _Provider({
        "predicted_winner": "red", "win_probability": 0.62,
        "predicted_method": "Decision", "predicted_round": None,
        "method_confidence": 0.55, "agreement_with_lr": "agrees",
        "rationale": "LR favors red and soft signals reinforce it.",
        "insights": [
            {"label": "Coach change", "severity": 2, "favors": "red", "source": "MMAJunkie"}
        ],
    })
    reasoner = StageTwoReasoner(provider=provider)
    out = reasoner.run(
        lr_output={"red_prob": 0.58, "blue_prob": 0.42,
                   "top_factors": [{"label": "Striking pace", "favors": "red", "impact": 0.4}],
                   "summary": "red is favored"},
        red_name="Alexander Volkanovski", blue_name="Ilia Topuria",
        soft_signals=[{"fighter_name": "topuria", "signal_type": "camp_change",
                       "severity": 2, "evidence": "..."}],
        bout={"weight_class": "Featherweight", "title": True, "rounds": 5},
    )
    assert out["predicted_winner"] == "red"
    assert out["predicted_method"] == "Decision"
    assert out["predicted_round"] is None
    assert len(out["insights"]) == 1


def test_reasoner_clamps_round_to_null_on_decision():
    provider = _Provider({
        "predicted_winner": "blue", "win_probability": 0.55,
        "predicted_method": "Decision", "predicted_round": 3,  # invalid combo
        "method_confidence": 0.4, "agreement_with_lr": "tilts_same_way",
        "rationale": "...", "insights": [],
    })
    out = StageTwoReasoner(provider=provider).run(
        lr_output={"red_prob": 0.5, "blue_prob": 0.5, "top_factors": [], "summary": "even"},
        red_name="A", blue_name="B", soft_signals=[],
        bout={"weight_class": "Lightweight", "title": False, "rounds": 3},
    )
    assert out["predicted_round"] is None
