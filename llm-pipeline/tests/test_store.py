import sqlite3
from datetime import datetime
from db.store import Store


def test_store_initializes_schema(tmp_path):
    s = Store(str(tmp_path / "p.db"))
    s.init()
    conn = sqlite3.connect(str(tmp_path / "p.db"))
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"source_cache", "soft_signals", "pipeline_runs", "pending_sync"} <= tables


def test_store_caches_source_and_skips_unchanged(tmp_path):
    s = Store(str(tmp_path / "p.db"))
    s.init()
    s.upsert_source("http://x/a", "news_article", "Hello world body")
    cached = s.get_source("http://x/a")
    assert cached["source_type"] == "news_article"
    assert s.is_body_unchanged("http://x/a", "Hello world body") is True
    assert s.is_body_unchanged("http://x/a", "Different body") is False


def test_store_writes_and_reads_signals(tmp_path):
    s = Store(str(tmp_path / "p.db"))
    s.init()
    s.upsert_source("http://x/a", "news_article", "body")
    s.write_signals("http://x/a", fight_id=42, signals=[
        {"fighter": "topuria", "fighter_side": "blue", "type": "weight_cut_concern", "severity": 1, "evidence": "missed weight"},
        {"fighter": None, "fighter_side": None, "type": "style_note", "severity": 0, "evidence": "southpaw vs orthodox"},
    ])
    rows = s.signals_for_fight(42)
    assert len(rows) == 2


def test_pending_sync_roundtrip(tmp_path):
    s = Store(str(tmp_path / "p.db"))
    s.init()
    pid = s.queue_pending(42, {"fight_id": 42, "red_win_prob": 0.6})
    pending = s.get_pending(limit=10)
    assert len(pending) == 1
    assert pending[0]["fight_id"] == 42
    s.mark_pending_done(pid)
    assert s.get_pending(limit=10) == []


def test_pipeline_run_lifecycle(tmp_path):
    s = Store(str(tmp_path / "p.db"))
    s.init()
    run_id = s.start_run()
    s.finish_run(run_id, status="ok", events_processed=1, fights_predicted=12, predictions_synced=12)
    runs = s.recent_runs(limit=5)
    assert len(runs) == 1
    assert runs[0]["status"] == "ok"
