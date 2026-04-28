"""UFC LLM Pipeline FastAPI service."""
from __future__ import annotations
import logging
import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, Header, HTTPException

from config import Config
from db.store import Store
from pipeline.orchestrator import Orchestrator

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
logger = logging.getLogger("app")

_store: Store | None = None
_cfg: Config | None = None
_scheduler: BackgroundScheduler | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _store, _cfg, _scheduler
    _cfg = Config.from_env()
    _store = Store(_cfg.pipeline_db_path)
    _store.init()
    if _cfg.enable_scheduler:
        from scheduler import build_scheduler
        _scheduler = build_scheduler(_store)
        _scheduler.start()
        logger.info("scheduler started (cron hour=%d UTC)", _cfg.scheduler_cron_hour)
    logger.info("LLM pipeline started; provider=%s model=%s", _cfg.llm_provider, _cfg.llm_model)
    yield
    if _scheduler:
        _scheduler.shutdown(wait=False)


app = FastAPI(title="UFC LLM Pipeline", version="0.1.0", lifespan=lifespan)


def _require_key(x_prediction_key: str = Header(default="")):
    if not _cfg or not _cfg.prediction_service_key:
        raise HTTPException(503, "PREDICTION_SERVICE_KEY not set")
    if x_prediction_key != _cfg.prediction_service_key:
        raise HTTPException(401, "unauthorized")


@app.get("/healthz")
def healthz():
    return {
        "status": "ok",
        "service": "ufc-llm-pipeline",
        "provider": _cfg.llm_provider if _cfg else None,
        "model": _cfg.llm_model if _cfg else None,
    }


@app.get("/status")
def status():
    runs = _store.recent_runs(limit=1) if _store else []
    return {
        "service": "ufc-llm-pipeline",
        "provider": _cfg.llm_provider if _cfg else None,
        "model": _cfg.llm_model if _cfg else None,
        "main_app_url": _cfg.main_app_url if _cfg else None,
        "scheduler_enabled": _cfg.enable_scheduler if _cfg else False,
        "last_run": runs[0] if runs else None,
        "scrapers_enabled": sorted(_cfg.scrapers_enabled) if _cfg else [],
    }


@app.get("/runs")
def runs():
    return {"runs": _store.recent_runs(limit=20) if _store else []}


@app.post("/trigger/enrich")
def trigger_enrich(
    x_prediction_key: str = Header(default=""),
    dry_run: bool = False,
    event_id: int | None = None,
):
    _require_key(x_prediction_key)
    orch = Orchestrator.from_env(store=_store)
    return orch.run(dry_run=dry_run, only_event=event_id)
