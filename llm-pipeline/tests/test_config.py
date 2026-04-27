import os
from config import Config


def test_config_defaults(monkeypatch):
    monkeypatch.setenv("MAIN_APP_URL", "http://example.test")
    monkeypatch.setenv("PREDICTION_SERVICE_KEY", "secret")
    cfg = Config.from_env()
    assert cfg.llm_provider == "ollama"
    assert cfg.llm_model == "llama3.1:8b"
    assert cfg.enrich_horizon_days == 14
    assert cfg.max_concurrent_fights == 4
    assert cfg.enable_scheduler is False
    assert cfg.scrapers_enabled == {"news", "ufc_preview", "tapology"}


def test_config_requires_main_app_url(monkeypatch):
    monkeypatch.delenv("MAIN_APP_URL", raising=False)
    monkeypatch.setenv("PREDICTION_SERVICE_KEY", "secret")
    try:
        Config.from_env()
    except ValueError as e:
        assert "MAIN_APP_URL" in str(e)
        return
    raise AssertionError("expected ValueError for missing MAIN_APP_URL")


def test_config_scraper_toggles(monkeypatch):
    monkeypatch.setenv("MAIN_APP_URL", "http://example.test")
    monkeypatch.setenv("PREDICTION_SERVICE_KEY", "secret")
    monkeypatch.setenv("ENABLE_SCRAPER_TAPOLOGY", "0")
    cfg = Config.from_env()
    assert "tapology" not in cfg.scrapers_enabled
