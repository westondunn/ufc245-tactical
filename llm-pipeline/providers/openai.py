"""OpenAI provider stub. Activated when LLM_PROVIDER=openai."""
from __future__ import annotations
from .base import LLMProvider


class OpenAIProvider(LLMProvider):
    def __init__(self, *, api_key: str, model: str):
        if not api_key:
            raise ValueError("OPENAI_API_KEY is required for the openai provider")
        import openai
        self._client = openai.OpenAI(api_key=api_key)
        self.model = model

    def chat_text(self, system: str, user: str, *, max_tokens: int = 1024,
                  temperature: float = 0.2) -> str:
        resp = self._client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return resp.choices[0].message.content or ""
