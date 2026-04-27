from unittest.mock import patch
import shutil
from pathlib import Path
import respx
import httpx

from pipeline.train import train_local


@respx.mock
def test_train_local_skips_when_too_few_fights(tmp_path, monkeypatch):
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

    respx.get("http://main.test/api/events").mock(return_value=httpx.Response(200, json=[]))
    result = train_local()
    assert result["status"] == "skipped"
    assert result["reason"] == "insufficient_labeled_fights"
