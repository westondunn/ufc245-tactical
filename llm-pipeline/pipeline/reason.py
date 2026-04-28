"""Stage 2: reason over LR + soft signals → ensemble prediction."""
from __future__ import annotations
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

PROMPT = (Path(__file__).resolve().parents[1] / "prompts" / "reason.md").read_text()

ALLOWED_METHODS = {"KO/TKO", "Submission", "Decision"}
ALLOWED_AGREEMENT = {"agrees", "tilts_same_way", "disagrees"}


def _aggregate_signals(signals: list[dict]) -> dict:
    """Group raw soft_signals rows by fighter for the prompt."""
    grouped: dict[str, list[dict]] = {}
    for s in signals:
        key = (s.get("fighter_name") or "_").lower()
        grouped.setdefault(key, []).append({
            "type": s.get("signal_type"),
            "severity": s.get("severity"),
            "evidence": s.get("evidence"),
        })
    return grouped


class StageTwoReasoner:
    def __init__(self, *, provider):
        self.provider = provider

    def run(self, *, lr_output: dict, red_name: str, blue_name: str,
            soft_signals: list[dict], bout: dict) -> dict:
        user_payload = json.dumps({
            "lr": lr_output,
            "red_name": red_name,
            "blue_name": blue_name,
            "bout": bout,
            "soft_signals_by_fighter": _aggregate_signals(soft_signals),
        })
        data = self.provider.chat_json(system=PROMPT, user=user_payload, max_tokens=900)

        # Defensive validation; clamp invalid combos rather than failing.
        winner = data.get("predicted_winner")
        if winner not in {"red", "blue"}:
            winner = "red" if lr_output.get("red_prob", 0) >= lr_output.get("blue_prob", 0) else "blue"
        try:
            win_prob = float(data.get("win_probability") or 0.5)
        except (TypeError, ValueError):
            win_prob = 0.5
        win_prob = max(0.5, min(0.99, win_prob))

        method = data.get("predicted_method")
        if method not in ALLOWED_METHODS:
            method = "Decision"
        rnd = data.get("predicted_round")
        if method == "Decision" or rnd in (None, "", 0):
            rnd = None
        else:
            try:
                rnd = max(1, min(5, int(rnd)))
            except (TypeError, ValueError):
                rnd = None
        try:
            method_conf = float(data.get("method_confidence") or 0.0)
        except (TypeError, ValueError):
            method_conf = 0.0
        method_conf = max(0.0, min(1.0, method_conf))

        agreement = data.get("agreement_with_lr")
        if agreement not in ALLOWED_AGREEMENT:
            agreement = "tilts_same_way"

        insights = []
        for item in (data.get("insights") or [])[:8]:
            label = (item.get("label") or "").strip()[:120]
            if not label:
                continue
            try:
                severity = max(0, min(3, int(item.get("severity") or 0)))
            except (TypeError, ValueError):
                severity = 0
            favors = item.get("favors") if item.get("favors") in {"red", "blue", "neither"} else "neither"
            source = (item.get("source") or "").strip()[:60]
            insights.append({"label": label, "severity": severity, "favors": favors, "source": source})

        return {
            "predicted_winner": winner,
            "win_probability": win_prob,
            "predicted_method": method,
            "predicted_round": rnd,
            "method_confidence": method_conf,
            "agreement_with_lr": agreement,
            "rationale": (data.get("rationale") or "").strip()[:1500],
            "insights": insights,
        }
