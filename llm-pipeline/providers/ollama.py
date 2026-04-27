"""Ollama provider — talks to local Ollama runtime via its HTTP API."""
from __future__ import annotations
import httpx

from .base import LLMProvider


class OllamaProvider(LLMProvider):
    def __init__(self, *, base_url: str, model: str, timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    def chat_text(self, system: str, user: str, *, max_tokens: int = 1024,
                  temperature: float = 0.2) -> str:
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "options": {"temperature": temperature, "num_predict": max_tokens},
            "stream": False,
        }
        r = httpx.post(f"{self.base_url}/api/chat", json=body, timeout=self.timeout)
        r.raise_for_status()
        data = r.json()
        return (data.get("message") or {}).get("content", "")
