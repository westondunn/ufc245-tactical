import json

import pytest
from pydantic import ValidationError

from db.store import Store
from pipeline.contracts import ExtractionResult
from pipeline.extract import StageOneExtractor


class _Provider:
    def __init__(self, response):
        self._response = response
        self.calls = []

    def chat_typed(self, system, user, *, response_type, **kwargs):
        self.calls.append({
            "system": system,
            "user": user,
            "response_type": response_type,
            **kwargs,
        })
        return response_type.model_validate(self._response)


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
    assert len(provider.calls) == 1
    assert provider.calls[0]["response_type"] is ExtractionResult
    assert provider.calls[0]["max_tokens"] == 800
    rows = store.signals_for_fight(42)
    assert len(rows) == 1
    assert rows[0]["fighter_name"] == "volkanovski"
    assert rows[0]["signal_type"] == "camp_change"
    assert rows[0]["severity"] == 2
    assert rows[0]["evidence"] == "head striking coach left City Kickboxing"

    n2 = extractor.run(
        url="http://x/a", source_type="news_article",
        body="Volkanovski's head striking coach left City Kickboxing.",
        fight_id=42, fighters_in_scope=["Volkanovski", "Topuria"],
    )
    assert n2 == 1
    assert len(provider.calls) == 1


def test_extract_skips_when_irrelevant(tmp_path):
    store = Store(str(tmp_path / "p.db"))
    provider = _Provider({"fighters_mentioned": [], "signals": [], "irrelevant": True})
    extractor = StageOneExtractor(provider=provider, store=store)
    n = extractor.run(
        url="http://x/b", source_type="news_article", body="An unrelated article.",
        fight_id=42, fighters_in_scope=["Volkanovski"],
    )
    assert n == 0
    assert store.signals_for_fight(42) == []


def test_extract_preserves_8000_character_body_cap(tmp_path):
    store = Store(str(tmp_path / "p.db"))
    provider = _Provider({"fighters_mentioned": [], "signals": [], "irrelevant": True})
    extractor = StageOneExtractor(provider=provider, store=store)
    extractor.run(
        url="http://x/c", source_type="news_article", body="x" * 9000,
        fight_id=42, fighters_in_scope=["Fighter"],
    )
    payload = json.loads(provider.calls[0]["user"])
    assert len(payload["text"]) == 8000


@pytest.mark.parametrize(
    "payload",
    [
        {
            "fighters_mentioned": ["a"],
            "signals": [{"fighter": "a", "type": "rumor", "severity": 1,
                         "evidence": "supported"}],
            "irrelevant": False,
        },
        {
            "fighters_mentioned": ["a"],
            "signals": [{"fighter": "a", "type": "injury", "severity": 4,
                         "evidence": "supported"}],
            "irrelevant": False,
        },
        {
            "fighters_mentioned": ["a"],
            "signals": [{"fighter": "a", "type": "injury", "severity": 1,
                         "evidence": "   "}],
            "irrelevant": False,
        },
        {
            "fighters_mentioned": ["a"],
            "signals": [{"fighter": "a", "type": "injury", "severity": 1,
                         "evidence": "supported"}],
            "irrelevant": True,
        },
        {
            "fighters_mentioned": ["a"],
            "signals": [
                {"fighter": "a", "type": "other", "severity": 0,
                 "evidence": str(index)}
                for index in range(9)
            ],
            "irrelevant": False,
        },
    ],
)
def test_extraction_contract_rejects_invalid_results(payload):
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate(payload)
