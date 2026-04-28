"""Push ensemble predictions to Railway main app /api/predictions/ingest.
Failures queue to pending_sync; drain_pending() retries on subsequent runs."""
from __future__ import annotations
import logging
from typing import Iterable

import httpx

from config import Config
from db.store import Store

logger = logging.getLogger(__name__)
BATCH_SIZE = 20


class RailwaySync:
    def __init__(self, *, base_url: str, key: str, store: Store):
        self.base_url = base_url.rstrip("/")
        self.key = key
        self.store = store

    @classmethod
    def from_env(cls, *, store: Store) -> "RailwaySync":
        cfg = Config.from_env()
        return cls(base_url=cfg.main_app_url, key=cfg.prediction_service_key, store=store)

    def _post(self, predictions: list[dict]) -> dict | None:
        try:
            r = httpx.post(
                f"{self.base_url}/api/predictions/ingest",
                json={"predictions": predictions},
                headers={"x-prediction-key": self.key},
                timeout=30.0,
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            logger.warning("ingest POST failed: %s", e)
            return None

    def post(self, predictions: Iterable[dict]) -> dict:
        items = list(predictions)
        ingested = 0
        for start in range(0, len(items), BATCH_SIZE):
            batch = items[start:start + BATCH_SIZE]
            ack = self._post(batch)
            if not ack:
                for p in batch:
                    self.store.queue_pending(p["fight_id"], p)
                continue
            ingested += int(ack.get("ingested", 0))
        return {"ingested": ingested}

    def drain_pending(self) -> int:
        pending = self.store.get_pending(limit=200)
        if not pending:
            return 0
        drained = 0
        for start in range(0, len(pending), BATCH_SIZE):
            batch = pending[start:start + BATCH_SIZE]
            payloads = [p["payload"] for p in batch]
            ack = self._post(payloads)
            if not ack:
                for p in batch:
                    self.store.mark_pending_failed(p["id"], "ingest failed")
                continue
            for p in batch:
                self.store.mark_pending_done(p["id"])
            drained += int(ack.get("ingested", 0))
        return drained
