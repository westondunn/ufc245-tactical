"""APScheduler wiring. Only used when ENABLE_SCHEDULER=1."""
from __future__ import annotations
import logging

from apscheduler.schedulers.background import BackgroundScheduler

from config import Config
from db.store import Store
from pipeline.orchestrator import Orchestrator
from pipeline.sync import RailwaySync
from pipeline.train import train_local

logger = logging.getLogger(__name__)


def build_scheduler(store: Store) -> BackgroundScheduler:
    cfg = Config.from_env()
    sched = BackgroundScheduler(timezone="UTC")

    def job_enrich():
        Orchestrator.from_env(store=store).run(dry_run=False)

    def job_drain():
        RailwaySync.from_env(store=store).drain_pending()

    def job_retrain():
        train_local()

    sched.add_job(
        job_enrich,
        "cron",
        hour=cfg.scheduler_cron_hour,
        minute=0,
        id="daily_enrich",
        replace_existing=True,
    )
    sched.add_job(
        job_drain,
        "cron",
        minute=15,
        id="drain_pending",
        replace_existing=True,
    )
    sched.add_job(
        job_retrain,
        "cron",
        day_of_week="mon",
        hour=5,
        minute=0,
        id="weekly_retrain",
        replace_existing=True,
    )
    return sched
