"""LLM provider abstraction. All providers expose chat_text / chat_json."""
from __future__ import annotations
import json
import re
from abc import ABC, abstractmethod
from typing import Any


class MalformedJSONError(RuntimeError):
    pass


_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)


def _strip_fences(s: str) -> str:
    s = s.strip()
    m = _FENCE_RE.match(s)
    return m.group(1).strip() if m else s


class LLMProvider(ABC):
    @abstractmethod
    def chat_text(self, system: str, user: str, *, max_tokens: int = 1024,
                  temperature: float = 0.2) -> str:
        ...

    def chat_json(self, system: str, user: str, *, max_tokens: int = 1024,
                  temperature: float = 0.0) -> dict[str, Any]:
        """Call chat_text and parse JSON. One repair retry on parse failure."""
        raw = self.chat_text(system, user, max_tokens=max_tokens, temperature=temperature)
        try:
            return json.loads(_strip_fences(raw))
        except json.JSONDecodeError:
            pass
        repair_user = (
            "Your previous response was not valid JSON. Re-read the original request "
            "and respond with ONLY valid JSON matching the requested schema. No prose, "
            "no markdown fences, no explanation. Original request:\n\n" + user
            + "\n\nYour previous (invalid) response:\n" + raw
        )
        raw2 = self.chat_text(system, repair_user, max_tokens=max_tokens, temperature=0.0)
        try:
            return json.loads(_strip_fences(raw2))
        except json.JSONDecodeError as e:
            raise MalformedJSONError(f"Provider returned non-JSON twice: {e}") from e


def get_provider(cfg) -> LLMProvider:
    name = (cfg.llm_provider or "ollama").lower()
    if name == "ollama":
        from .ollama import OllamaProvider
        return OllamaProvider(base_url=cfg.ollama_url, model=cfg.llm_model)
    if name == "anthropic":
        from .anthropic import AnthropicProvider
        return AnthropicProvider(api_key=cfg.anthropic_api_key, model=cfg.llm_model)
    if name == "openai":
        from .openai import OpenAIProvider
        return OpenAIProvider(api_key=cfg.openai_api_key, model=cfg.llm_model)
    raise ValueError(f"unknown LLM_PROVIDER: {name}")
