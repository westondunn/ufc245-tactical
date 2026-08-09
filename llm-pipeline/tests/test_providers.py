import json
import multiprocessing
import threading
from types import SimpleNamespace

import httpx
import pytest
from pydantic import BaseModel

from providers import ollama as ollama_module
from providers.base import (
    LLMProvider,
    MalformedJSONError,
    ProviderConnectionError,
    ProviderResponseError,
    get_provider,
)
from providers.ollama import OllamaProvider


def _response(content):
    return SimpleNamespace(message=SimpleNamespace(content=content))


class _FakeClient:
    def __init__(self, responses=None, error=None):
        self.responses = list(responses or [])
        self.error = error
        self.calls = []
        self.close_calls = 0

    def chat(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.responses.pop(0)

    def close(self):
        self.close_calls += 1


class _FakeProvider(LLMProvider):
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def chat_text(self, system, user, **kwargs):
        self.calls.append((system, user))
        return self._responses.pop(0)


class _TypedAnswer(BaseModel):
    winner: str
    confidence: float


def _provider(tmp_path, client, **kwargs):
    return OllamaProvider(
        base_url="http://ollama.test:11434",
        model="test-model",
        client=client,
        gpu_lock_dir=tmp_path / "gpu-locks",
        **kwargs,
    )


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
    assert "valid JSON" in p.calls[1][1]


def test_chat_json_raises_after_two_failures():
    p = _FakeProvider(["nope", "still nope"])
    with pytest.raises(MalformedJSONError):
        p.chat_json("sys", "user")


def test_generic_chat_typed_validates_json_fallback():
    p = _FakeProvider(['{"winner":"red","confidence":0.7}'])
    answer = p.chat_typed("sys", "user", response_type=_TypedAnswer)
    assert answer == _TypedAnswer(winner="red", confidence=0.7)


def test_generic_chat_typed_classifies_validation_failure():
    p = _FakeProvider(['{"winner":"red"}'])
    with pytest.raises(MalformedJSONError, match="_TypedAnswer"):
        p.chat_typed("sys", "user", response_type=_TypedAnswer)


def test_owned_client_uses_explicit_sdk_transport_settings(monkeypatch, tmp_path):
    constructed = {}
    client = _FakeClient()

    def fake_client(**kwargs):
        constructed.update(kwargs)
        return client

    monkeypatch.setattr(ollama_module, "Client", fake_client)
    provider = OllamaProvider(
        base_url="http://ollama.test:11434/",
        model="model-a",
        timeout=42.5,
        context_length=2048,
        gpu_concurrency=3,
        gpu_lock_dir=tmp_path,
    )

    assert constructed["host"] == "http://ollama.test:11434"
    assert constructed["timeout"] == httpx.Timeout(42.5)
    assert constructed["limits"].max_connections == 3
    assert constructed["limits"].max_keepalive_connections == 1
    provider.close()
    assert client.close_calls == 1


def test_chat_text_passes_sdk_options_and_returns_content(tmp_path):
    client = _FakeClient([_response("  tactical result  ")])
    provider = _provider(
        tmp_path,
        client,
        context_length=2048,
        keep_alive="9m",
    )

    result = provider.chat_text("system prompt", "user prompt", max_tokens=5000,
                                temperature=0.35)

    assert result == "  tactical result  "
    assert client.calls == [{
        "model": "test-model",
        "messages": [
            {"role": "system", "content": "system prompt"},
            {"role": "user", "content": "user prompt"},
        ],
        "stream": False,
        "keep_alive": "9m",
        "options": {
            "temperature": 0.35,
            "num_ctx": 2048,
            "num_predict": 2048,
        },
    }]


@pytest.mark.parametrize("content", [None, "", "   \n"])
def test_chat_text_rejects_empty_content(tmp_path, content):
    client = _FakeClient([_response(content)])
    provider = _provider(tmp_path, client)
    with pytest.raises(ProviderResponseError, match="empty"):
        provider.chat_text("sys", "user")


def test_sdk_response_error_is_sanitized(tmp_path):
    secret = "prompt-secret-that-must-not-leak"
    error = ollama_module.ResponseError(secret, 500)
    provider = _provider(tmp_path, _FakeClient(error=error))
    with pytest.raises(ProviderResponseError) as caught:
        provider.chat_text("sys", secret)
    assert "status=500" in str(caught.value)
    assert secret not in str(caught.value)


@pytest.mark.parametrize(
    "error",
    [
        ConnectionError("sdk connection failed"),
        httpx.ConnectTimeout("timeout", request=httpx.Request("POST", "http://x")),
    ],
)
def test_connection_errors_are_sanitized(tmp_path, error):
    provider = _provider(tmp_path, _FakeClient(error=error))
    with pytest.raises(ProviderConnectionError, match="local Ollama"):
        provider.chat_text("sys", "user")


def test_injected_client_is_not_closed_without_ownership_transfer(tmp_path):
    client = _FakeClient()
    provider = _provider(tmp_path, client)
    provider.close()
    provider.close()
    assert client.close_calls == 0


def test_injected_owned_client_closes_exactly_once(tmp_path):
    client = _FakeClient()
    provider = _provider(tmp_path, client, owns_client=True)
    provider.close()
    provider.close()
    assert client.close_calls == 1


def test_chat_typed_passes_schema_and_validates_response(tmp_path):
    payload = {"winner": "red", "confidence": 0.81}
    client = _FakeClient([_response(json.dumps(payload))])
    provider = _provider(tmp_path, client)

    result = provider.chat_typed(
        "sys", "original user", response_type=_TypedAnswer, max_tokens=200,
    )

    assert result == _TypedAnswer(**payload)
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["format"] == _TypedAnswer.model_json_schema()
    assert call["options"]["temperature"] == 0.0
    compact = json.dumps(
        _TypedAnswer.model_json_schema(), sort_keys=True, separators=(",", ":"),
    )
    assert call["messages"][1]["content"].endswith(compact)


def test_chat_typed_does_not_repair_invalid_schema_output(tmp_path):
    client = _FakeClient([_response('{"winner":"red"}')])
    provider = _provider(tmp_path, client)
    with pytest.raises(MalformedJSONError, match="_TypedAnswer"):
        provider.chat_typed("sys", "user", response_type=_TypedAnswer)
    assert len(client.calls) == 1


class _BlockingClient:
    def __init__(self):
        self.lock = threading.Lock()
        self.entered = threading.Event()
        self.release = threading.Event()
        self.active = 0
        self.maximum_active = 0

    def chat(self, **_kwargs):
        with self.lock:
            self.active += 1
            self.maximum_active = max(self.maximum_active, self.active)
            self.entered.set()
        if not self.release.wait(5):
            raise AssertionError("test did not release fake SDK call")
        with self.lock:
            self.active -= 1
        return _response("ok")


def test_default_gpu_concurrency_serializes_threads(tmp_path):
    client = _BlockingClient()
    provider = _provider(tmp_path, client)
    second_attempted = threading.Event()

    first = threading.Thread(target=provider.chat_text, args=("sys", "one"))

    def call_second():
        second_attempted.set()
        provider.chat_text("sys", "two")

    second = threading.Thread(target=call_second)
    first.start()
    assert client.entered.wait(2)
    second.start()
    assert second_attempted.wait(2)
    assert not client.release.is_set()
    client.release.set()
    first.join(2)
    second.join(2)

    assert not first.is_alive()
    assert not second.is_alive()
    assert client.maximum_active == 1


class _BarrierClient:
    def __init__(self, parties):
        self.barrier = threading.Barrier(parties)
        self.lock = threading.Lock()
        self.active = 0
        self.maximum_active = 0

    def chat(self, **_kwargs):
        with self.lock:
            self.active += 1
            self.maximum_active = max(self.maximum_active, self.active)
        self.barrier.wait(timeout=5)
        with self.lock:
            self.active -= 1
        return _response("ok")


def test_configured_gpu_concurrency_allows_multiple_slots(tmp_path):
    client = _BarrierClient(2)
    provider = _provider(tmp_path, client, gpu_concurrency=2)
    threads = [
        threading.Thread(target=provider.chat_text, args=("sys", str(index)))
        for index in range(2)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(5)
    assert all(not thread.is_alive() for thread in threads)
    assert client.maximum_active == 2


def _cross_process_call(lock_dir, attempted, entered):
    class ProcessClient:
        def chat(self, **_kwargs):
            entered.set()
            return _response("ok")

    provider = OllamaProvider(
        base_url="http://ollama.test",
        model="test-model",
        client=ProcessClient(),
        gpu_lock_dir=lock_dir,
    )
    attempted.set()
    provider.chat_text("sys", "user")


@pytest.mark.skipif(not hasattr(multiprocessing, "get_context"), reason="requires processes")
def test_gpu_slot_is_shared_across_processes(tmp_path):
    context = multiprocessing.get_context("fork")
    attempted = context.Event()
    entered = context.Event()
    parent = _provider(tmp_path, _FakeClient())

    with parent._generation_slot():
        child = context.Process(
            target=_cross_process_call,
            args=(str(tmp_path / "gpu-locks"), attempted, entered),
        )
        child.start()
        assert attempted.wait(2)
        assert not entered.wait(0.2)

    assert entered.wait(2)
    child.join(2)
    assert child.exitcode == 0


def test_get_provider_returns_configured_ollama(monkeypatch, tmp_path):
    monkeypatch.setenv("MAIN_APP_URL", "http://x")
    monkeypatch.setenv("PREDICTION_SERVICE_KEY", "k")
    monkeypatch.setenv("PIPELINE_DB_PATH", str(tmp_path / "pipeline.db"))
    monkeypatch.setenv("OLLAMA_TIMEOUT_SECONDS", "12.5")
    monkeypatch.setenv("OLLAMA_CONTEXT_LENGTH", "8192")
    monkeypatch.setenv("OLLAMA_KEEP_ALIVE", "3m")
    monkeypatch.setenv("OLLAMA_GPU_CONCURRENCY", "2")
    from config import Config

    fake = _FakeClient()
    constructed = {}

    def fake_sdk_client(**kwargs):
        constructed.update(kwargs)
        return fake

    monkeypatch.setattr(ollama_module, "Client", fake_sdk_client)
    provider = get_provider(Config.from_env())
    assert isinstance(provider, OllamaProvider)
    assert provider.timeout == 12.5
    assert provider.context_length == 8192
    assert provider.keep_alive == "3m"
    assert provider.gpu_concurrency == 2
    assert provider.gpu_lock_dir == tmp_path / ".ollama-gpu-locks"
    provider.close()
    assert fake.close_calls == 1
