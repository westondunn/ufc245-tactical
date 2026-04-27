"""Anthropic provider stub. Activated when LLM_PROVIDER=anthropic."""
from __future__ import annotations
from .base import LLMProvider


class AnthropicProvider(LLMProvider):
    def __init__(self, *, api_key: str, model: str):
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is required for the anthropic provider")
        # Lazy import so the dep is only loaded when this provider is selected.
        import anthropic
        self._client = anthropic.Anthropic(api_key=api_key)
        self.model = model

    def chat_text(self, system: str, user: str, *, max_tokens: int = 1024,
                  temperature: float = 0.2) -> str:
        msg = self._client.messages.create(
            model=self.model,
            system=system,
            messages=[{"role": "user", "content": user}],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return "".join(block.text for block in msg.content if getattr(block, "type", None) == "text")
