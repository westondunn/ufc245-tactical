"""LLM provider abstraction. All providers expose text, JSON, and typed chat."""
from __future__ import annotations
import json
import re
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError


T = TypeVar("T", bound=BaseModel)


class ProviderError(RuntimeError):
    """Base class for sanitized provider failures."""


class ProviderConnectionError(ProviderError):
    """The provider could not be reached or timed out."""


class ProviderResponseError(ProviderError):
    """The provider returned an unusable response."""


class MalformedJSONError(ProviderError):
    """The provider response was not valid for the requested JSON contract."""


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

    def chat_typed(self, system: str, user: str, *, response_type: type[T],
                   max_tokens: int = 1024, temperature: float = 0.0) -> T:
        """Validate the existing JSON fallback against a Pydantic response type."""
        data = self.chat_json(
            system, user, max_tokens=max_tokens, temperature=temperature,
        )
        try:
            return response_type.model_validate(data)
        except ValidationError:
            raise MalformedJSONError(
                f"Provider JSON did not match {response_type.__name__}"
            ) from None

    def close(self) -> None:
        """Release provider resources. Stateless providers need no cleanup."""
        return None


def get_provider(cfg) -> LLMProvider:
    name = (cfg.llm_provider or "ollama").lower()
    if name == "ollama":
        from .ollama import OllamaProvider
        return OllamaProvider(
            base_url=cfg.ollama_url,
            model=cfg.llm_model,
            timeout=cfg.ollama_timeout_seconds,
            context_length=cfg.ollama_context_length,
            keep_alive=cfg.ollama_keep_alive,
            gpu_concurrency=cfg.ollama_gpu_concurrency,
            gpu_lock_dir=Path(cfg.pipeline_db_path).parent / ".ollama-gpu-locks",
        )
    if name == "anthropic":
        from .anthropic import AnthropicProvider
        return AnthropicProvider(api_key=cfg.anthropic_api_key, model=cfg.llm_model)
    if name == "openai":
        from .openai import OpenAIProvider
        return OpenAIProvider(api_key=cfg.openai_api_key, model=cfg.llm_model)
    raise ValueError(f"unknown LLM_PROVIDER: {name}")
