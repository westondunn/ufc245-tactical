from unittest.mock import MagicMock
import pytest

from pipeline.extract import StageOneExtractor
from db.store import Store


class _Provider:
    def __init__(self, response):
        self._response = response
        self.calls = 0
    def chat_json(self, system, user, **kwargs):
        self.calls += 1
        return self._response


def test_extract_writes_signals_and_caches(tmp_path):
    store = Store(str(tmp_path / "p.db"))
    store.init()
    provider = _Provider({
        "fighters_mentioned": ["volkanovski"],
        "signals": [
            {"fighter": "volkanovski", "type": "camp_change", "severity": 2,
             "evidence": "head striking coach left City Kickboxing"}
        ],
        "irrelevant": False,
    })
    extractor = StageOneExtractor(provider=provider, store=store)
    n = extractor.run(
        url="http://x/a",
        source_type="news_article",
        body="Volkanovski's head striking coach left City Kickboxing.",
        fight_id=42,
        fighters_in_scope=["Volkanovski", "Topuria"],
    )
    assert n == 1
    assert provider.calls == 1
    rows = store.signals_for_fight(42)
    assert len(rows) == 1
    assert rows[0]["signal_type"] == "camp_change"

    # Re-run with identical body: cache short-circuits, no LLM call.
    n2 = extractor.run(
        url="http://x/a", source_type="news_article",
        body="Volkanovski's head striking coach left City Kickboxing.",
        fight_id=42, fighters_in_scope=["Volkanovski", "Topuria"],
    )
    assert n2 == 1  # signals already present
    assert provider.calls == 1  # not called again


def test_extract_skips_when_irrelevant(tmp_path):
    store = Store(str(tmp_path / "p.db"))
    store.init()
    provider = _Provider({"fighters_mentioned": [], "signals": [], "irrelevant": True})
    extractor = StageOneExtractor(provider=provider, store=store)
    n = extractor.run(
        url="http://x/b", source_type="news_article", body="An unrelated article.",
        fight_id=42, fighters_in_scope=["Volkanovski"],
    )
    assert n == 0
    assert store.signals_for_fight(42) == []
