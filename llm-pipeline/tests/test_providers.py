import pytest
from providers.base import LLMProvider, get_provider, MalformedJSONError
from providers.ollama import OllamaProvider


class _FakeProvider(LLMProvider):
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []
    def chat_text(self, system, user, **kwargs):
        self.calls.append((system, user))
        return self._responses.pop(0)


def test_chat_json_parses_strict_json():
    p = _FakeProvider(['{"winner": "red", "confidence": 0.6}'])
    out = p.chat_json("sys", "user")
    assert out == {"winner": "red", "confidence": 0.6}


def test_chat_json_strips_markdown_fences():
    p = _FakeProvider(['```json\n{"a":1}\n```'])
    assert p.chat_json("sys", "user") == {"a": 1}


def test_chat_json_retries_on_bad_json_with_fix_prompt():
    p = _FakeProvider(["not json at all", '{"ok":true}'])
    out = p.chat_json("sys", "user")
    assert out == {"ok": True}
    assert len(p.calls) == 2
    # second call must be the repair prompt
    assert "valid JSON" in p.calls[1][1]


def test_chat_json_raises_after_two_failures():
    p = _FakeProvider(["nope", "still nope"])
    with pytest.raises(MalformedJSONError):
        p.chat_json("sys", "user")


def test_get_provider_returns_ollama_by_default(monkeypatch):
    monkeypatch.setenv("MAIN_APP_URL", "http://x")
    monkeypatch.setenv("PREDICTION_SERVICE_KEY", "k")
    from config import Config
    cfg = Config.from_env()
    p = get_provider(cfg)
    assert isinstance(p, OllamaProvider)
