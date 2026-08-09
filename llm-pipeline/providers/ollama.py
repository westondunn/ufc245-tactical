"""Production-safe adapter for the local Ollama Python SDK."""
from __future__ import annotations
import errno
import json
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Mapping

import fcntl
import httpx
from ollama import Client, ResponseError
from pydantic import ValidationError

from .base import (
    LLMProvider,
    MalformedJSONError,
    ProviderConnectionError,
    ProviderError,
    ProviderResponseError,
    T,
)


class OllamaProvider(LLMProvider):
    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        timeout: float = 180.0,
        context_length: int = 4096,
        keep_alive: str = "15m",
        gpu_concurrency: int = 1,
        client: Any | None = None,
        owns_client: bool = False,
        gpu_lock_dir: str | Path | None = None,
    ):
        if timeout <= 0:
            raise ValueError("Ollama timeout must be greater than zero")
        if context_length <= 0:
            raise ValueError("Ollama context length must be greater than zero")
        if gpu_concurrency < 1:
            raise ValueError("Ollama GPU concurrency must be at least one")
        if not keep_alive.strip():
            raise ValueError("Ollama keep-alive must not be empty")

        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = float(timeout)
        self.context_length = int(context_length)
        self.keep_alive = keep_alive
        self.gpu_concurrency = int(gpu_concurrency)
        self._local_slots = threading.BoundedSemaphore(self.gpu_concurrency)
        self._slot_retry = threading.Event()
        self._close_lock = threading.Lock()
        self._closed = False

        default_lock_dir = Path(tempfile.gettempdir()) / "ufc-tactical-ollama-gpu-locks"
        self.gpu_lock_dir = Path(gpu_lock_dir) if gpu_lock_dir else default_lock_dir
        try:
            self.gpu_lock_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            raise ProviderError("Ollama GPU coordination directory is unavailable") from None
        self._slot_paths = [
            self.gpu_lock_dir / f"slot-{index}.lock"
            for index in range(self.gpu_concurrency)
        ]

        if client is None:
            self._client = Client(
                host=self.base_url,
                timeout=httpx.Timeout(self.timeout),
                limits=httpx.Limits(
                    max_connections=self.gpu_concurrency,
                    max_keepalive_connections=1,
                ),
            )
            self._owns_client = True
        else:
            self._client = client
            self._owns_client = owns_client

    @contextmanager
    def _generation_slot(self) -> Iterator[None]:
        """Acquire one in-process and shared-volume GPU generation slot."""
        self._local_slots.acquire()
        locked_file = None
        try:
            while locked_file is None:
                for slot_path in self._slot_paths:
                    try:
                        candidate = slot_path.open("a+b")
                    except OSError:
                        raise ProviderError(
                            "Ollama GPU coordination file is unavailable"
                        ) from None
                    try:
                        fcntl.flock(candidate.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except OSError as exc:
                        candidate.close()
                        if exc.errno not in {errno.EACCES, errno.EAGAIN}:
                            raise ProviderError(
                                "Ollama GPU coordination lock failed"
                            ) from None
                    else:
                        locked_file = candidate
                        break
                if locked_file is None:
                    self._slot_retry.wait(0.05)
            yield
        finally:
            if locked_file is not None:
                try:
                    fcntl.flock(locked_file.fileno(), fcntl.LOCK_UN)
                finally:
                    locked_file.close()
            self._local_slots.release()

    def _options(self, *, max_tokens: int, temperature: float) -> dict[str, Any]:
        num_predict = max(1, min(int(max_tokens), self.context_length))
        return {
            "temperature": temperature,
            "num_ctx": self.context_length,
            "num_predict": num_predict,
        }

    def _chat(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int,
        temperature: float,
        response_format: Mapping[str, Any] | None = None,
    ) -> Any:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "keep_alive": self.keep_alive,
            "options": self._options(
                max_tokens=max_tokens, temperature=temperature,
            ),
        }
        if response_format is not None:
            kwargs["format"] = response_format
        try:
            with self._generation_slot():
                return self._client.chat(**kwargs)
        except ProviderError:
            raise
        except ResponseError as exc:
            status = exc.status_code if exc.status_code >= 0 else "unknown"
            raise ProviderResponseError(
                f"Ollama rejected the request (status={status})"
            ) from None
        except (ConnectionError, httpx.RequestError):
            raise ProviderConnectionError("Unable to reach the local Ollama service") from None

    @staticmethod
    def _content(response: Any) -> str:
        message = getattr(response, "message", None)
        if message is None and isinstance(response, Mapping):
            message = response.get("message")
        content = getattr(message, "content", None)
        if content is None and isinstance(message, Mapping):
            content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ProviderResponseError("Ollama returned empty response content")
        return content

    def chat_text(self, system: str, user: str, *, max_tokens: int = 1024,
                  temperature: float = 0.2) -> str:
        response = self._chat(
            system=system,
            user=user,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return self._content(response)

    def chat_typed(self, system: str, user: str, *, response_type: type[T],
                   max_tokens: int = 1024, temperature: float = 0.0) -> T:
        schema = response_type.model_json_schema()
        compact_schema = json.dumps(schema, sort_keys=True, separators=(",", ":"))
        grounded_user = (
            f"{user}\n\nReturn JSON matching this schema exactly:\n{compact_schema}"
        )
        response = self._chat(
            system=system,
            user=grounded_user,
            max_tokens=max_tokens,
            temperature=temperature,
            response_format=schema,
        )
        content = self._content(response)
        try:
            return response_type.model_validate_json(content)
        except ValidationError:
            raise MalformedJSONError(
                f"Ollama JSON did not match {response_type.__name__}"
            ) from None

    def close(self) -> None:
        with self._close_lock:
            if self._closed:
                return
            self._closed = True
            if self._owns_client:
                self._client.close()
