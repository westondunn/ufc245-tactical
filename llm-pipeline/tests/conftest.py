"""Shared pytest fixtures."""
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch, tmp_path):
    """Each test starts from a clean env. Tests that need vars set them explicitly."""
    for var in [
        "LLM_PROVIDER", "LLM_MODEL", "OLLAMA_URL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
        "MAIN_APP_URL", "PREDICTION_SERVICE_KEY",
        "ENRICH_HORIZON_DAYS", "MAX_CONCURRENT_FIGHTS", "ENABLE_SCHEDULER",
        "ENABLE_SCRAPER_NEWS", "ENABLE_SCRAPER_UFC_PREVIEW", "ENABLE_SCRAPER_TAPOLOGY",
    ]:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("PIPELINE_DB_PATH", str(tmp_path / "pipeline.db"))
    monkeypatch.setenv("MODEL_DIR", str(tmp_path / "model_store"))
    monkeypatch.setenv("SCRAPE_CACHE_DIR", str(tmp_path / "scrape_cache"))
    monkeypatch.setenv("SHARED_MODEL_PATH", str(tmp_path / "shared_model"))
