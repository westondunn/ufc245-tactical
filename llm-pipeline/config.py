"""Environment-backed configuration. Validated on startup."""
from __future__ import annotations
import os
from dataclasses import dataclass, field


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", ""}


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    llm_provider: str
    llm_model: str
    ollama_url: str
    anthropic_api_key: str
    openai_api_key: str

    main_app_url: str
    prediction_service_key: str

    enrich_horizon_days: int
    max_concurrent_fights: int
    enable_scheduler: bool
    scheduler_cron_hour: int

    pipeline_db_path: str
    model_dir: str
    scrape_cache_dir: str
    shared_model_path: str

    scrapers_enabled: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def from_env(cls) -> "Config":
        main_url = os.getenv("MAIN_APP_URL", "").strip()
        if not main_url:
            raise ValueError("MAIN_APP_URL is required")
        key = os.getenv("PREDICTION_SERVICE_KEY", "").strip()
        if not key:
            raise ValueError("PREDICTION_SERVICE_KEY is required")

        enabled: set[str] = set()
        if _bool_env("ENABLE_SCRAPER_NEWS", True):
            enabled.add("news")
        if _bool_env("ENABLE_SCRAPER_UFC_PREVIEW", True):
            enabled.add("ufc_preview")
        if _bool_env("ENABLE_SCRAPER_TAPOLOGY", True):
            enabled.add("tapology")

        return cls(
            llm_provider=os.getenv("LLM_PROVIDER", "ollama").lower(),
            llm_model=os.getenv("LLM_MODEL", "llama3.1:8b"),
            ollama_url=os.getenv("OLLAMA_URL", "http://ollama:11434"),
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
            openai_api_key=os.getenv("OPENAI_API_KEY", ""),
            main_app_url=main_url.rstrip("/"),
            prediction_service_key=key,
            enrich_horizon_days=_int_env("ENRICH_HORIZON_DAYS", 14),
            max_concurrent_fights=_int_env("MAX_CONCURRENT_FIGHTS", 4),
            enable_scheduler=_bool_env("ENABLE_SCHEDULER", False),
            scheduler_cron_hour=_int_env("SCHEDULER_CRON_HOUR", 8),
            pipeline_db_path=os.getenv("PIPELINE_DB_PATH", "/data/pipeline.db"),
            model_dir=os.getenv("MODEL_DIR", "/data/model_store"),
            scrape_cache_dir=os.getenv("SCRAPE_CACHE_DIR", "/data/scrape_cache"),
            shared_model_path=os.getenv("SHARED_MODEL_PATH", "/shared/model"),
            scrapers_enabled=frozenset(enabled),
        )
