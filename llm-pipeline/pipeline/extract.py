"""Stage 1: extract structured soft signals from a single source.

Cacheable: if the body sha1 matches what's already in source_cache and we have
signals for this (url, fight_id) pair, the LLM call is skipped.
"""
from __future__ import annotations
import json
import logging
from pathlib import Path

from db.store import Store

logger = logging.getLogger(__name__)

PROMPT = (Path(__file__).resolve().parents[1] / "prompts" / "extract.md").read_text()

ALLOWED_TYPES = {"injury", "camp_change", "weight_cut_concern", "motivation",
                 "style_note", "recent_form_note", "layoff", "personal", "other"}


class StageOneExtractor:
    def __init__(self, *, provider, store: Store):
        self.provider = provider
        self.store = store

    def run(self, *, url: str, source_type: str, body: str,
            fight_id: int | None, fighters_in_scope: list[str]) -> int:
        # Cache short-circuit
        cached_unchanged = self.store.is_body_unchanged(url, body)
        existing = self.store.signals_for_fight(fight_id) if fight_id else []
        if cached_unchanged and any(s["url_hash"] == _store_hash(url) for s in existing):
            return len(existing)

        # Always update the source cache so subsequent runs short-circuit.
        self.store.upsert_source(url, source_type, body)

        user_payload = json.dumps({
            "source_type": source_type,
            "fighters_in_scope": fighters_in_scope,
            "text": body[:8000],  # cap to keep prompts small
        })
        try:
            data = self.provider.chat_json(system=PROMPT, user=user_payload, max_tokens=800)
        except Exception as e:
            logger.warning("extract LLM failed for %s: %s", url, e)
            return 0

        if data.get("irrelevant"):
            return 0
        signals = data.get("signals") or []
        cleaned = []
        for s in signals[:8]:
            stype = (s.get("type") or "other").lower()
            if stype not in ALLOWED_TYPES:
                stype = "other"
            try:
                severity = max(0, min(3, int(s.get("severity") or 0)))
            except (TypeError, ValueError):
                severity = 0
            evidence = (s.get("evidence") or "").strip()[:1000]
            if not evidence:
                continue
            cleaned.append({
                "fighter": (s.get("fighter") or None),
                "fighter_side": None,  # caller fills this from fight context
                "type": stype,
                "severity": severity,
                "evidence": evidence,
            })
        if not cleaned:
            return 0
        self.store.write_signals(url, fight_id, cleaned)
        return len(cleaned)


def _store_hash(url: str) -> str:
    import hashlib
    return hashlib.sha1(url.encode("utf-8")).hexdigest()
