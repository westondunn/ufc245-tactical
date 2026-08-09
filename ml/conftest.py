import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SHARED_MODEL_PARENT = _REPO_ROOT / "ufc245-predictions"

for p in (str(_REPO_ROOT), str(_SHARED_MODEL_PARENT)):
    if p not in sys.path:
        sys.path.insert(0, p)

os.environ.setdefault("MODEL_DIR", str(_REPO_ROOT / "ml" / "_model_store_test"))
