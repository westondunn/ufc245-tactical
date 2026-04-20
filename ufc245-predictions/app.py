"""UFC Tactical Predictions — FastAPI web process.

Serves prediction status and triggers manual runs.
The scheduler (scheduler.py) handles automated cron jobs.
"""
import os
import logging

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel

from db import init_db, get_latest_model, get_unsynced_predictions
from jobs import daily_predict, refresh_near, daily_reconcile, weekly_retrain

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
logger = logging.getLogger("app")

app = FastAPI(title="UFC Tactical Predictions", version="0.1.0")

PREDICTION_SERVICE_KEY = os.getenv("PREDICTION_SERVICE_KEY", "")


def _require_key(x_prediction_key: str = Header(default="")):
    if not PREDICTION_SERVICE_KEY:
        raise HTTPException(503, "PREDICTION_SERVICE_KEY not set")
    if x_prediction_key != PREDICTION_SERVICE_KEY:
        raise HTTPException(401, "unauthorized")


@app.on_event("startup")
def startup():
    init_db()
    logger.info("Predictions service started")


@app.get("/healthz")
def healthz():
    model = get_latest_model()
    return {
        "status": "ok",
        "service": "ufc-predictions",
        "model_version": model["version"] if model else None,
        "model_accuracy": model["accuracy"] if model else None,
    }


@app.get("/status")
def status():
    model = get_latest_model()
    unsynced = get_unsynced_predictions()
    return {
        "model": model,
        "unsynced_count": len(unsynced),
    }


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
