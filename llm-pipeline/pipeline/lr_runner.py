"""Wraps the shared scikit-learn model code from ufc245-predictions/model.

The container mounts ufc245-predictions/model/ at /shared/model (read-only).
SHARED_MODEL_PATH env var points at that directory; we add its parent to
sys.path and import the package using the basename of that path.

In production: SHARED_MODEL_PATH=/shared/model -> add /shared to sys.path,
import model. In tests the fixture copies to tmp_path/"shared_model" -> add
tmp_path to sys.path, import shared_model. Either way the package contents
are identical (FEATURE_NAMES, engineer_features, predict, ...).
"""
from __future__ import annotations
import importlib
import os
import sys
from pathlib import Path

_SHARED = os.getenv("SHARED_MODEL_PATH", "/shared/model")
_shared_model = None  # type: ignore[assignment]

if _SHARED:
    _shared_path = Path(_SHARED)
    _shared_parent = str(_shared_path.parent)
    _pkg_name = _shared_path.name
    if _shared_parent not in sys.path:
        sys.path.insert(0, _shared_parent)
    # Try to import the shared package now. If the mount/path isn't set up
    # yet (e.g. during pytest collection before fixtures run), defer the
    # failure to call-time. Tests reload this module after copying the
    # shared code into place, which re-runs this import successfully.
    try:
        if _pkg_name in sys.modules:
            _shared_model = importlib.reload(sys.modules[_pkg_name])
        else:
            _shared_model = importlib.import_module(_pkg_name)
    except ModuleNotFoundError:
        _shared_model = None  # type: ignore[assignment]


def _require_shared_model():
    if _shared_model is None:
        raise RuntimeError(
            "Shared model package not importable. "
            f"SHARED_MODEL_PATH={_SHARED!r} did not yield an importable package."
        )
    return _shared_model


class LRRunner:
    def __init__(self, *, shared_model_path: str):
        self.shared_model_path = shared_model_path
        self.feature_names = list(_require_shared_model().FEATURE_NAMES)

    @classmethod
    def from_env(cls) -> "LRRunner":
        return cls(shared_model_path=os.getenv("SHARED_MODEL_PATH", "/shared/model"))

    def engineer_features(self, red_stats, blue_stats, red_fighter, blue_fighter):
        return _require_shared_model().engineer_features(
            red_stats, blue_stats, red_fighter, blue_fighter
        )

    def feature_hash(self, X) -> str:
        return _require_shared_model().feature_hash(X)

    def predict(self, pipe, X) -> tuple[float, float]:
        return _require_shared_model().predict(pipe, X)

    def explain(self, pipe, X, red_name: str, blue_name: str, limit: int = 5) -> dict:
        return _require_shared_model().explain_prediction(
            pipe, X, red_name=red_name, blue_name=blue_name, limit=limit
        )

    def train_and_save(self, X, y, *, model_dir: str):
        os.makedirs(model_dir, exist_ok=True)
        os.environ["MODEL_DIR"] = model_dir
        return _require_shared_model().train(X, y)

    def load_model(self, blob_path: str):
        return _require_shared_model().load_model(blob_path)
