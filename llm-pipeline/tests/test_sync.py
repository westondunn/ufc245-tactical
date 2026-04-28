import respx
import httpx

from pipeline.sync import RailwaySync
from db.store import Store


@respx.mock
def test_sync_posts_predictions_and_clears_pending(tmp_path, monkeypatch):
    monkeypatch.setenv("MAIN_APP_URL", "http://main.test")
    monkeypatch.setenv("PREDICTION_SERVICE_KEY", "k")
    store = Store(str(tmp_path / "p.db"))
    store.init()
    payload = {"fight_id": 7, "red_fighter_id": 1, "blue_fighter_id": 2,
               "red_win_prob": 0.6, "blue_win_prob": 0.4, "model_version": "v.test",
               "feature_hash": "h", "predicted_at": "2026-04-27T00:00:00",
               "event_date": "2026-05-01", "enrichment_level": "ensemble", "insights": []}
    respx.post("http://main.test/api/predictions/ingest").mock(
        return_value=httpx.Response(200, json={"ingested": 1, "skipped_invalid": 0,
                                               "skipped_locked": 0, "accepted_indices": [0],
                                               "locked_indices": []}),
    )
    sync = RailwaySync.from_env(store=store)
    result = sync.post([payload])
    assert result["ingested"] == 1
    assert store.get_pending() == []


@respx.mock
def test_sync_queues_pending_on_failure(tmp_path, monkeypatch):
    monkeypatch.setenv("MAIN_APP_URL", "http://main.test")
    monkeypatch.setenv("PREDICTION_SERVICE_KEY", "k")
    store = Store(str(tmp_path / "p.db"))
    store.init()
    respx.post("http://main.test/api/predictions/ingest").mock(
        return_value=httpx.Response(503, text="bad gateway")
    )
    sync = RailwaySync.from_env(store=store)
    payload = {"fight_id": 7, "red_fighter_id": 1, "blue_fighter_id": 2,
               "red_win_prob": 0.6, "blue_win_prob": 0.4, "model_version": "v.test",
               "feature_hash": "h", "predicted_at": "2026-04-27T00:00:00",
               "event_date": "2026-05-01", "enrichment_level": "ensemble", "insights": []}
    result = sync.post([payload])
    assert result["ingested"] == 0
    pending = store.get_pending()
    assert len(pending) == 1
    assert pending[0]["fight_id"] == 7


@respx.mock
def test_drain_pending_retries(tmp_path, monkeypatch):
    monkeypatch.setenv("MAIN_APP_URL", "http://main.test")
    monkeypatch.setenv("PREDICTION_SERVICE_KEY", "k")
    store = Store(str(tmp_path / "p.db"))
    store.init()
    payload = {"fight_id": 11, "red_fighter_id": 1, "blue_fighter_id": 2,
               "red_win_prob": 0.55, "blue_win_prob": 0.45, "model_version": "v.t",
               "feature_hash": "h", "predicted_at": "2026-04-27T00:00:00",
               "event_date": "2026-05-01", "enrichment_level": "ensemble", "insights": []}
    store.queue_pending(11, payload)
    respx.post("http://main.test/api/predictions/ingest").mock(
        return_value=httpx.Response(200, json={"ingested": 1, "skipped_invalid": 0,
                                               "skipped_locked": 0, "accepted_indices": [0],
                                               "locked_indices": []})
    )
    sync = RailwaySync.from_env(store=store)
    drained = sync.drain_pending()
    assert drained == 1
    assert store.get_pending() == []
