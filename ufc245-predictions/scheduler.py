"""APScheduler worker process — runs cron jobs independently of the web process.

Schedule:
  - daily_predict:    every day at 06:00 UTC
  - refresh_near:     3x daily at 08:00, 14:00, 20:00 UTC
  - daily_reconcile:  every day at 07:00 UTC
  - weekly_retrain:   every Monday at 05:00 UTC
"""
import logging
import signal
import sys

from apscheduler.schedulers.blocking import BlockingScheduler

from db import init_db
from jobs import daily_predict, refresh_near, daily_reconcile, weekly_retrain

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
logger = logging.getLogger("scheduler")


def main():
    init_db()
    logger.info("Scheduler starting")

    scheduler = BlockingScheduler(timezone="UTC")

    # Daily predictions at 06:00 UTC
    scheduler.add_job(daily_predict, "cron", hour=6, minute=0,
                      id="daily_predict", replace_existing=True)

    # Refresh near-term predictions 3x daily
    scheduler.add_job(refresh_near, "cron", hour="8,14,20", minute=0,
                      id="refresh_near", replace_existing=True)

    # Daily reconciliation at 07:00 UTC
    scheduler.add_job(daily_reconcile, "cron", hour=7, minute=0,
                      id="daily_reconcile", replace_existing=True)

    # Weekly retrain on Mondays at 05:00 UTC
    scheduler.add_job(weekly_retrain, "cron", day_of_week="mon", hour=5, minute=0,
                      id="weekly_retrain", replace_existing=True)

    def shutdown(signum, frame):
        logger.info(f"Received signal {signum}, shutting down")
        scheduler.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    logger.info("Scheduler running. Jobs: daily_predict, refresh_near, "
                "daily_reconcile, weekly_retrain")
    scheduler.start()


if __name__ == "__main__":
    main()
