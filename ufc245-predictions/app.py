"""UFC Tactical Predictions — FastAPI web process + in-process scheduler."""
import os
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel

from db import init_db, get_latest_model, get_unsynced_predictions
from jobs import daily_predict, refresh_near, daily_reconcile, weekly_retrain

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
logger = logging.getLogger("app")

app = FastAPI(title="UFC Tactical Predictions", version="0.1.0")

PREDICTION_SERVICE_KEY = os.getenv("PREDICTION_SERVICE_KEY", "")
MAIN_APP_URL = os.getenv("MAIN_APP_URL", "http://localhost:3000")
ENABLE_SCHEDULER = os.getenv("ENABLE_SCHEDULER", "1").lower() not in {"0", "false", "no"}
scheduler: BackgroundScheduler | None = None


def _configure_scheduler() -> BackgroundScheduler:
    global scheduler
    if scheduler and scheduler.running:
        return scheduler

    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(daily_predict, "cron", hour=6, minute=0,
                      id="daily_predict", replace_existing=True)
    scheduler.add_job(refresh_near, "cron", hour="8,14,20", minute=0,
                      id="refresh_near", replace_existing=True)
    scheduler.add_job(daily_reconcile, "cron", hour=7, minute=0,
                      id="daily_reconcile", replace_existing=True)
    scheduler.add_job(weekly_retrain, "cron", day_of_week="mon", hour=5, minute=0,
                      id="weekly_retrain", replace_existing=True)
    return scheduler


def _require_key(x_prediction_key: str = Header(default="")):
    if not PREDICTION_SERVICE_KEY:
        raise HTTPException(503, "PREDICTION_SERVICE_KEY not set")
    if x_prediction_key != PREDICTION_SERVICE_KEY:
        raise HTTPException(401, "unauthorized")


@app.on_event("startup")
def startup():
    init_db()
    if ENABLE_SCHEDULER:
        local_scheduler = _configure_scheduler()
        if not local_scheduler.running:
            local_scheduler.start()
            logger.info("In-process scheduler started")
    logger.info("Predictions service started")


@app.get("/healthz")
def healthz():
    model = get_latest_model()
    return {
        "status": "ok",
        "service": "ufc-predictions",
        "model_version": model["version"] if model else None,
        "model_accuracy": model["accuracy"] if model else None,
        "scheduler_running": bool(scheduler and scheduler.running),
        "main_app_url": MAIN_APP_URL,
    }


@app.get("/status")
def status():
    model = get_latest_model()
    unsynced = get_unsynced_predictions()
    jobs = scheduler.get_jobs() if scheduler and scheduler.running else []
    return {
        "model": model,
        "unsynced_count": len(unsynced),
        "scheduler_running": bool(scheduler and scheduler.running),
        "job_count": len(jobs),
        "main_app_url": MAIN_APP_URL,
    }


@app.on_event("shutdown")
def shutdown():
    global scheduler
    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("In-process scheduler stopped")


class TriggerResponse(BaseModel):
    status: str
    job: str


@app.post("/trigger/predict")
def trigger_predict(x_prediction_key: str = Header(default="")):
    _require_key(x_prediction_key)
    daily_predict()
    return TriggerResponse(status="ok", job="daily_predict")


@app.post("/trigger/refresh")
def trigger_refresh(x_prediction_key: str = Header(default="")):
    _require_key(x_prediction_key)
    refresh_near()
    return TriggerResponse(status="ok", job="refresh_near")


@app.post("/trigger/reconcile")
def trigger_reconcile(x_prediction_key: str = Header(default="")):
    _require_key(x_prediction_key)
    daily_reconcile()
    return TriggerResponse(status="ok", job="daily_reconcile")


@app.post("/trigger/retrain")
def trigger_retrain(x_prediction_key: str = Header(default="")):
    _require_key(x_prediction_key)
    weekly_retrain()
    return TriggerResponse(status="ok", job="weekly_retrain")
