"""Shared pytest fixtures."""
import os
import sys
from pathlib import Path

import pytest
import respx.mocks

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from config import SCRAPER_ENV_VARS


# RESPX 0.21's httpcore hook receives byte-valued methods from HTTPX 0.28.
# Its HTTPX transport hook preserves method-aware route matching.
respx.mocks.DEFAULT_MOCKER = "httpx"


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch, tmp_path):
    """Each test starts from a clean env. Tests that need vars set them explicitly."""
    for var in [
        "LLM_PROVIDER", "LLM_MODEL", "OLLAMA_URL", "OLLAMA_TIMEOUT_SECONDS",
        "OLLAMA_CONTEXT_LENGTH", "OLLAMA_KEEP_ALIVE", "OLLAMA_GPU_CONCURRENCY",
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
        "MAIN_APP_URL", "PREDICTION_SERVICE_KEY",
        "ENRICH_HORIZON_DAYS", "MAX_CONCURRENT_FIGHTS", "ENABLE_SCHEDULER",
        *SCRAPER_ENV_VARS.values(),
    ]:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("PIPELINE_DB_PATH", str(tmp_path / "pipeline.db"))
    monkeypatch.setenv("MODEL_DIR", str(tmp_path / "model_store"))
    monkeypatch.setenv("SCRAPE_CACHE_DIR", str(tmp_path / "scrape_cache"))
    monkeypatch.setenv("SHARED_MODEL_PATH", str(tmp_path / "shared_model"))
