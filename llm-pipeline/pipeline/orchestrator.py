"""End-to-end pipeline runner. One Orchestrator per invocation.

Ties events -> scrapers -> extract -> LR -> reason -> sync. Bounded
concurrency by fight via ThreadPoolExecutor sized to cfg.max_concurrent_fights.
"""
from __future__ import annotations
import concurrent.futures
import logging
from datetime import datetime, timedelta
from pathlib import Path

import httpx

from config import Config
from db.store import Store
from pipeline.extract import StageOneExtractor
from pipeline.reason import StageTwoReasoner
from pipeline.lr_runner import LRRunner
from pipeline.sync import RailwaySync
from providers.base import get_provider
from scrapers.news import NewsScraper
from scrapers.tapology import TapologyScraper
from scrapers.ufc_preview import UFCPreviewScraper

logger = logging.getLogger(__name__)


def _slugify_fighter(name: str) -> str:
    """Slugify a fighter name for tapology lookups (lowercase, hyphenated)."""
    return "".join(c for c in name.lower().replace(" ", "-") if c.isalnum() or c == "-")


class Orchestrator:
    def __init__(self, *, cfg: Config, store: Store, provider, runner: LRRunner):
        self.cfg = cfg
        self.store = store
        self.provider = provider
        self.runner = runner
        self.extractor = StageOneExtractor(provider=provider, store=store)
        self.reasoner = StageTwoReasoner(provider=provider)
        self.sync = RailwaySync(base_url=cfg.main_app_url, key=cfg.prediction_service_key, store=store)
        self.scrapers_enabled = cfg.scrapers_enabled

    @classmethod
    def from_env(cls, *, store: Store, provider=None) -> "Orchestrator":
        cfg = Config.from_env()
        return cls(
            cfg=cfg,
            store=store,
            provider=provider or get_provider(cfg),
            runner=LRRunner.from_env(),
        )

    # ---------- model ----------
    def _load_model(self):
        latest = Path(self.cfg.model_dir) / "latest.txt"
        if not latest.exists():
            raise FileNotFoundError(f"no trained LR at {latest}; run train_local first")
        lines = latest.read_text().splitlines()
        if len(lines) < 2:
            raise FileNotFoundError(f"latest.txt at {latest} is malformed")
        version, blob_path = lines[0].strip(), lines[1].strip()
        return self.runner.load_model(blob_path), version

    # ---------- HTTP helpers ----------
    def _get_json(self, client: httpx.Client, path: str):
        try:
            r = client.get(f"{self.cfg.main_app_url}{path}", timeout=30.0)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            logger.error("GET %s failed: %s", path, e)
            return None

    def _events_in_window(self, client: httpx.Client) -> list[dict]:
        events = self._get_json(client, "/api/events") or []
        today = datetime.utcnow().date()
        cutoff = today + timedelta(days=self.cfg.enrich_horizon_days)
        out = []
        for ev in events:
            try:
                d = datetime.strptime(ev.get("date") or "", "%Y-%m-%d").date()
            except ValueError:
                continue
            if today < d <= cutoff:
                out.append(ev)
        return out

    # ---------- scraping ----------
    def _scrape_for_fight(self, ev: dict, bout: dict) -> list[dict]:
        sources: list[dict] = []
        names = [bout.get("red_name") or "", bout.get("blue_name") or ""]
        if "news" in self.scrapers_enabled:
            try:
                sources.extend(NewsScraper().fetch_for_fighters(names))
            except Exception as e:
                logger.warning("news scraper failed: %s", e)
        if "ufc_preview" in self.scrapers_enabled and ev.get("ufc_slug"):
            try:
                sources.extend(UFCPreviewScraper().fetch_for_event_slug(ev["ufc_slug"]))
            except Exception as e:
                logger.warning("ufc preview failed: %s", e)
        if "tapology" in self.scrapers_enabled:
            tap = TapologyScraper()
            for name in names:
                if not name:
                    continue
                try:
                    item = tap.fetch_for_fighter_slug(_slugify_fighter(name))
                except Exception as e:
                    logger.warning("tapology failed for %s: %s", name, e)
                    item = None
                if item:
                    sources.append(item)
        return sources

    # ---------- per-fight pipeline ----------
    def _process_fight(self, model, model_version: str, ev: dict, bout: dict,
                       dry_run: bool) -> dict | None:
        try:
            with httpx.Client() as client:
                r = self._get_json(client, f"/api/fighters/{bout['red_id']}/career-stats")
                b = self._get_json(client, f"/api/fighters/{bout['blue_id']}/career-stats")
            if not r or not b:
                logger.warning("missing career stats for fight %s; skipping", bout.get("id"))
                return None

            red_fighter = r.get("fighter", {})
            blue_fighter = b.get("fighter", {})
            red_career = r.get("stats", {})
            blue_career = b.get("stats", {})
            X = self.runner.engineer_features(red_career, blue_career, red_fighter, blue_fighter)
            red_prob, blue_prob = self.runner.predict(model, X)
            explain = self.runner.explain(
                model, X,
                red_name=bout.get("red_name") or "Red",
                blue_name=bout.get("blue_name") or "Blue",
            )

            # Scrape + Stage 1 extract
            names = [bout.get("red_name") or "", bout.get("blue_name") or ""]
            for src in self._scrape_for_fight(ev, bout):
                try:
                    self.extractor.run(
                        url=src["url"], source_type=src["source_type"],
                        body=src["body"], fight_id=bout["id"], fighters_in_scope=names,
                    )
                except Exception as e:
                    logger.warning("extract failed for %s: %s", src.get("url"), e)

            signals = self.store.signals_for_fight(bout["id"])

            # Stage 2 reason
            try:
                decision = self.reasoner.run(
                    lr_output={
                        "red_prob": red_prob, "blue_prob": blue_prob,
                        "top_factors": explain.get("factors", []),
                        "summary": explain.get("summary", ""),
                    },
                    red_name=bout.get("red_name") or "Red",
                    blue_name=bout.get("blue_name") or "Blue",
                    soft_signals=signals,
                    bout={
                        "weight_class": bout.get("weight_class"),
                        "title": bool(bout.get("title")),
                        "rounds": int(bout.get("rounds") or 3),
                    },
                )
            except Exception as e:
                logger.warning("reasoning failed for fight %s: %s", bout.get("id"), e)
                return None

            winner = decision["predicted_winner"]
            wp = float(decision["win_probability"])
            red_win_prob = wp if winner == "red" else 1.0 - wp
            blue_win_prob = 1.0 - red_win_prob

            payload = {
                "fight_id": bout["id"],
                "red_fighter_id": bout["red_id"],
                "blue_fighter_id": bout["blue_id"],
                "red_win_prob": red_win_prob,
                "blue_win_prob": blue_win_prob,
                "model_version": f"ensemble-{self.cfg.llm_model}-{model_version}",
                "feature_hash": self.runner.feature_hash(X),
                "predicted_at": datetime.utcnow().isoformat(),
                "event_date": ev.get("date"),
                "predicted_method": decision["predicted_method"],
                "predicted_round": decision["predicted_round"],
                "method_confidence": decision["method_confidence"],
                "narrative_text": decision["rationale"],
                "insights": decision["insights"],
                "enrichment_level": "ensemble",
                "explanation": {
                    "lr_red_prob": red_prob,
                    "lr_blue_prob": blue_prob,
                    "lr_factors": explain.get("factors", []),
                    "agreement_with_lr": decision["agreement_with_lr"],
                },
            }
            if dry_run:
                logger.info("[dry-run] would post: fight=%s winner=%s prob=%.2f method=%s",
                            bout["id"], winner, wp, decision["predicted_method"])
            return payload
        except Exception as e:
            logger.exception("unexpected error in fight %s: %s", bout.get("id"), e)
            return None

    # ---------- top-level run ----------
    def run(self, *, dry_run: bool = False, only_event: int | None = None) -> dict:
        run_id = self.store.start_run()
        try:
            model, model_version = self._load_model()
        except FileNotFoundError as e:
            self.store.finish_run(run_id, status="error", error=str(e))
            return {"status": "error", "error": str(e)}

        events_processed = 0
        predictions: list[dict] = []
        with httpx.Client() as client:
            events = self._events_in_window(client)
            if only_event is not None:
                events = [e for e in events if e.get("id") == only_event]
            for ev in events:
                card = self._get_json(client, f"/api/events/{ev['id']}/card") or {}
                bouts = [b for b in card.get("card", []) if not b.get("winner_id")]
                events_processed += 1
                if not bouts:
                    continue
                max_workers = max(1, int(self.cfg.max_concurrent_fights))
                with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
                    futures = [
                        pool.submit(self._process_fight, model, model_version, ev, b, dry_run)
                        for b in bouts
                    ]
                    for f in concurrent.futures.as_completed(futures):
                        payload = f.result()
                        if payload:
                            predictions.append(payload)

        synced = 0
        if predictions and not dry_run:
            ack = self.sync.post(predictions)
            synced = int(ack.get("ingested", 0))
            synced += self.sync.drain_pending()

        status = "ok"
        if predictions and not dry_run and synced < len(predictions):
            status = "partial"

        self.store.finish_run(
            run_id, status=status,
            events_processed=events_processed,
            fights_predicted=len(predictions),
            predictions_synced=synced,
        )
        return {
            "status": status,
            "events_processed": events_processed,
            "fights_predicted": len(predictions),
            "predictions_synced": synced,
            "dry_run": dry_run,
        }
