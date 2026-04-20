"""Startup behavior tests for the predictions FastAPI app."""
import importlib
import os
import sys
import tempfile

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_scheduler_starts_once():
    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ["ENABLE_SCHEDULER"] = "1"
        os.environ["PREDICTIONS_DB_PATH"] = os.path.join(tmpdir, "predictions.db")

        app_mod = importlib.import_module("app")
        app_mod = importlib.reload(app_mod)

        app_mod.startup()
        app_mod.startup()  # second call should not duplicate jobs or crash

        assert app_mod.scheduler is not None
        assert app_mod.scheduler.running
        assert len(app_mod.scheduler.get_jobs()) == 4

        app_mod.shutdown()
        print("  PASS: app startup registers scheduler exactly once")


if __name__ == "__main__":
    print("\n=== UFC Predictions App Tests ===\n")
    test_scheduler_starts_once()
    print("\n=== All 1 app tests passed ===\n")
