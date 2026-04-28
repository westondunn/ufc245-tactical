import shutil
from pathlib import Path
import respx
import httpx
import numpy as np


def test_orchestrator_runs_one_event_end_to_end(tmp_path, monkeypatch):
    # Wire shared model code
    src = Path(__file__).resolve().parents[2] / "ufc245-predictions" / "model"
    dst = tmp_path / "shared_model"
    shutil.copytree(src, dst)
    monkeypatch.setenv("SHARED_MODEL_PATH", str(dst))
    monkeypatch.setenv("MAIN_APP_URL", "http://main.test")
    monkeypatch.setenv("PREDICTION_SERVICE_KEY", "k")
    monkeypatch.setenv("MODEL_DIR", str(tmp_path / "model_store"))

    # Force lr_runner to re-import against the new SHARED_MODEL_PATH
    import importlib, sys
    if "model" in sys.modules:
        del sys.modules["model"]
    if "shared_model" in sys.modules:
        del sys.modules["shared_model"]
    from pipeline import lr_runner
    importlib.reload(lr_runner)
    # Reload orchestrator so it picks up the reloaded LRRunner.
    if "pipeline.orchestrator" in sys.modules:
        importlib.reload(sys.modules["pipeline.orchestrator"])

    from pipeline.lr_runner import LRRunner
    from pipeline.orchestrator import Orchestrator
    from db.store import Store

    # Train a tiny LR to disk so the orchestrator finds a model.
    runner = LRRunner.from_env()
    X = np.random.RandomState(0).randn(40, len(runner.feature_names))
    y = (X[:, 2] > 0).astype(int)
    pipe, _, version, blob = runner.train_and_save(X, y, model_dir=str(tmp_path / "model_store"))
    Path(tmp_path / "model_store" / "latest.txt").write_text(f"{version}\n{blob}\n0.6\n")

    class StubProvider:
        def chat_json(self, system, user, **kwargs):
            # Stage 1: irrelevant
            if "fighters_in_scope" in user:
                return {"fighters_mentioned": [], "signals": [], "irrelevant": True}
            # Stage 2: fixed reasoning
            return {
                "predicted_winner": "red", "win_probability": 0.61,
                "predicted_method": "Decision", "predicted_round": None,
                "method_confidence": 0.5, "agreement_with_lr": "agrees",
                "rationale": "LR + signals.", "insights": [],
            }

    # Use a date in the future so the event window matches.
    from datetime import datetime, timedelta
    future_date = (datetime.utcnow().date() + timedelta(days=7)).strftime("%Y-%m-%d")

    with respx.mock:
        respx.get("http://main.test/api/events").mock(return_value=httpx.Response(200, json=[
            {"id": 99, "name": "UFC Test", "date": future_date}
        ]))
        respx.get("http://main.test/api/events/99/card").mock(return_value=httpx.Response(200, json={
            "card": [
                {"id": 700, "red_id": 1, "blue_id": 2, "red_name": "A", "blue_name": "B"}
            ]
        }))
        for fid in (1, 2):
            respx.get(f"http://main.test/api/fighters/{fid}/career-stats").mock(
                return_value=httpx.Response(200, json={
                    "fighter": {"slpm": 4.5, "str_def": 55, "td_def": 65, "reach_cm": 180, "height_cm": 170},
                    "stats": {"avg_sig_per_fight": 4.5, "sig_accuracy_pct": 50, "total_fights": 10,
                              "total_td_landed": 5, "td_accuracy_pct": 35, "total_control_sec": 300,
                              "total_knockdowns": 1, "total_sub_attempts": 1, "win_pct_last3": 0.66}
                })
            )
        respx.post("http://main.test/api/predictions/ingest").mock(
            return_value=httpx.Response(200, json={"ingested": 1, "skipped_invalid": 0,
                                                   "skipped_locked": 0, "accepted_indices": [0],
                                                   "locked_indices": []})
        )

        store = Store(str(tmp_path / "p.db"))
        store.init()
        orch = Orchestrator.from_env(store=store, provider=StubProvider())
        # Disable scrapers so we don't hit RSS in tests.
        orch.scrapers_enabled = frozenset()
        result = orch.run(dry_run=False)

    assert result["status"] in {"ok", "partial"}
    assert result["fights_predicted"] >= 1
    assert result["predictions_synced"] >= 1
