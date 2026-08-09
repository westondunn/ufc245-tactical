# Forecasting Evaluation Harness (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible, event-grouped, walk-forward temporal evaluation harness so that running `docs/evaluation/agent-evaluation-prompt.md` produces a *measured* verdict instead of `blocked`.

**Architecture:** A new self-contained Python package `ml/` builds an immutable data snapshot from the main app, constructs point-in-time matchup rows, splits them into event-grouped walk-forward folds, trains the *existing* logistic-regression model per fold, and scores out-of-fold predictions with proper probability metrics plus event-bootstrap confidence intervals and slice breakdowns. The runner writes all ten artifacts named in `agent-evaluation-spec.yaml` and an executable `hard-gates.json`. It reuses the existing model code in `ufc245-predictions/model/__init__.py` unchanged; it does **not** fix leakage (F-001), remove LLM probability ownership (F-003), or add calibration/ensemble — those are follow-on plans (Phase 1–3). Baseline results are labeled **provisional** per the report because the snapshot's fighter-profile fields still reflect current vintage.

**Tech Stack:** Python 3.12, numpy 2.2, scikit-learn 1.6.1, joblib, httpx 0.28, pytest. All already declared in `ufc245-predictions/requirements.txt` and `llm-pipeline`. No new third-party dependencies.

---

## Scope boundary (read before starting)

**In scope (flips `blocked` → an executable, measured verdict):**
- Immutable data snapshot with recorded SHA-256 (unblocks `required_data_unavailable` / `DATABASE_SNAPSHOT`).
- Point-in-time dataset builder + dataset manifest.
- Event-grouped walk-forward folds + fold manifest (unblocks SPLIT-1 gate being *executable*).
- Proper metrics: log loss, Brier, calibration slope/intercept, ECE, reliability, accuracy, ROC-AUC.
- Event-bootstrap confidence intervals.
- Slice breakdowns.
- Executable hard-gate results written to `hard-gates.json` (gates that fail on current code — SPLIT-1 conceptually satisfied by the harness, SYM-1/2 measured-and-reported, NUM-1/PIT-1 documented — become *measured fails*, not *blocks*).
- Pin the Ollama image digest in `docker-compose.yml` (cheap REPRO-1 improvement).

**Explicitly out of scope (separate follow-on plans):**
- Fixing F-001 profile-field leakage / point-in-time feature service.
- Removing the LLM-generated `win_probability` (F-003 / NUM-1).
- Calibration artifacts, stacker, CatBoost/Bradley–Terry ensemble.
- Ollama extraction golden set, source snapshots, evidence offsets.
- Full-event 12 GB GPU capacity test.

The deliverable of THIS plan is: *the evaluation can be run and returns a defensible non-`blocked` verdict for the numeric winner model with reproducible artifacts.* The expected verdict after this plan is `reject` (because SPLIT-1's shuffled-CV code path, NUM-1, and PIT-1 remain true in the production path) — but it will be an **evidence-backed** reject, which is the unblock.

---

## File structure

New package, mirroring §21 of `docs/evaluation/forecasting-evaluation-report.md`:

```
ml/
├── __init__.py                 # empty, marks package
├── README.md                   # how to snapshot + run the harness
├── conftest.py                 # adds repo root + shared model dir to sys.path for tests
├── manifest.py                 # sha256 helpers + manifest dataclasses/serialization
├── snapshot.py                 # fetch immutable snapshot from main app; load/verify it
├── dataset.py                  # snapshot -> point-in-time matchup rows + dataset manifest
├── folds.py                    # event-grouped walk-forward fold generator + fold manifest
├── metrics.py                  # log loss, brier, calibration, ECE, reliability, accuracy, AUC
├── bootstrap.py                # event-level bootstrap CIs
├── slices.py                   # slice definitions + per-slice metric computation
├── runner.py                   # orchestrates everything; writes the 10 artifacts + hard-gates
└── tests/
    ├── __init__.py
    ├── conftest.py             # synthetic snapshot fixture
    ├── test_manifest.py
    ├── test_snapshot.py
    ├── test_dataset.py
    ├── test_folds.py
    ├── test_metrics.py
    ├── test_bootstrap.py
    ├── test_slices.py
    ├── test_future_data_mutation.py
    └── test_runner.py
```

Responsibilities are one-per-file. `runner.py` is the only module that touches the filesystem for outputs; every other module is pure functions over in-memory data so it is unit-testable without the app or a GPU.

Each file stays small (< ~200 lines). `ufc245-predictions/model/__init__.py` is imported, never modified.

---

### Task 1: Scaffold the `ml/` package

**Files:**
- Create: `ml/__init__.py`
- Create: `ml/conftest.py`
- Create: `ml/tests/__init__.py`
- Create: `ml/tests/conftest.py`
- Create: `ml/manifest.py`
- Test: `ml/tests/test_manifest.py`

- [ ] **Step 1: Create the package markers and shared-model path shim**

`ml/__init__.py`:

```python
"""Local forecasting evaluation harness (Phase 0).

Reproducible, event-grouped, walk-forward temporal evaluation of the
existing logistic-regression winner model. See docs/evaluation/ for the
governing spec and prompt.
"""
```

`ml/conftest.py` (makes the shared model importable in tests without Docker mounts):

```python
import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SHARED_MODEL_PARENT = _REPO_ROOT / "ufc245-predictions"

for p in (str(_REPO_ROOT), str(_SHARED_MODEL_PARENT)):
    if p not in sys.path:
        sys.path.insert(0, p)

os.environ.setdefault("MODEL_DIR", str(_REPO_ROOT / "ml" / "_model_store_test"))
```

`ml/tests/__init__.py`: empty file.

- [ ] **Step 2: Write the failing test for manifest hashing**

`ml/tests/test_manifest.py`:

```python
from ml.manifest import sha256_of_bytes, sha256_of_obj, DatasetManifest


def test_sha256_of_bytes_is_stable():
    assert sha256_of_bytes(b"abc") == sha256_of_bytes(b"abc")
    assert sha256_of_bytes(b"abc") != sha256_of_bytes(b"abd")
    assert len(sha256_of_bytes(b"abc")) == 64


def test_sha256_of_obj_is_key_order_independent():
    a = {"x": 1, "y": [1, 2, 3]}
    b = {"y": [1, 2, 3], "x": 1}
    assert sha256_of_obj(a) == sha256_of_obj(b)


def test_dataset_manifest_roundtrips_to_dict():
    m = DatasetManifest(
        manifest_id="ds-1",
        database_snapshot_hash="deadbeef",
        min_event_date="2019-01-01",
        max_event_date="2026-01-01",
        feature_schema_hash="cafe",
        number_of_events=10,
        number_of_fights=100,
        number_of_labeled_fights=90,
        number_of_debutants=12,
        class_distribution={"red": 55, "blue": 35},
        missingness_summary={"profile_slpm": 3},
    )
    d = m.to_dict()
    assert d["manifest_id"] == "ds-1"
    assert d["number_of_labeled_fights"] == 90
    assert d["class_distribution"]["red"] == 55
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd C:/dev/code/ufc-tactical/ufc245-tactical/.claude/worktrees/wonderful-goodall-52ee3f && python -m pytest ml/tests/test_manifest.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ml.manifest'`.

- [ ] **Step 4: Implement `ml/manifest.py`**

```python
"""Deterministic hashing + manifest containers for the evaluation harness."""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field


def sha256_of_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_of_obj(obj) -> str:
    """Hash a JSON-serializable object independent of dict key order."""
    canonical = json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)
    return sha256_of_bytes(canonical.encode("utf-8"))


@dataclass
class DatasetManifest:
    manifest_id: str
    database_snapshot_hash: str
    min_event_date: str
    max_event_date: str
    feature_schema_hash: str
    number_of_events: int
    number_of_fights: int
    number_of_labeled_fights: int
    number_of_debutants: int
    class_distribution: dict
    missingness_summary: dict

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FoldManifest:
    fold_id: int
    train_event_ids: list
    validation_event_ids: list
    train_fight_ids_hash: str
    validation_fight_ids_hash: str
    train_event_range: list = field(default_factory=list)
    validation_event_range: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `python -m pytest ml/tests/test_manifest.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add ml/__init__.py ml/conftest.py ml/tests/__init__.py ml/manifest.py ml/tests/test_manifest.py
git commit -m "feat(ml): scaffold evaluation harness package + manifest hashing"
```

---

### Task 2: Immutable data snapshot (fetch + load + verify)

**Files:**
- Create: `ml/snapshot.py`
- Create: `ml/tests/conftest.py`
- Test: `ml/tests/test_snapshot.py`

The snapshot is a single JSON document: `{events: [...], cards: {event_id: card}, career_stats: {"fighter_id@as_of": payload}}`. Career stats are fetched with `?as_of=<event_date>` so dynamic aggregates are point-in-time. The file is written once and its SHA-256 recorded; loading re-verifies the hash.

- [ ] **Step 1: Write the synthetic snapshot fixture**

`ml/tests/conftest.py`:

```python
import json

import pytest

# A tiny but internally-consistent snapshot: 3 events, 2 bouts each, chronological.
# career_stats keyed "<fighter_id>@<as_of>"; profile fields live under "fighter".
_FIGHTER = lambda fid, reach: {  # noqa: E731
    "id": fid, "reach_cm": reach, "height_cm": 180,
    "slpm": 3.5, "str_def": 55, "td_def": 60,
}
_STATS = lambda tf: {  # noqa: E731
    "avg_sig_per_fight": 40.0, "sig_accuracy_pct": 45.0,
    "total_td_landed": 8, "total_fights": tf, "td_accuracy_pct": 40.0,
    "total_control_sec": 200, "total_knockdowns": 1, "total_sub_attempts": 1,
    "win_pct_last3": 0.5,
}


def _career(fid, as_of, total_fights, reach):
    return {"fighter": _FIGHTER(fid, reach), "stats": _STATS(total_fights)}


@pytest.fixture
def synthetic_snapshot():
    events = [
        {"id": 1, "date": "2024-01-01", "name": "Card 1"},
        {"id": 2, "date": "2024-02-01", "name": "Card 2"},
        {"id": 3, "date": "2024-03-01", "name": "Card 3"},
    ]
    cards = {}
    career_stats = {}
    fid = 100
    for ev in events:
        bouts = []
        for b in range(2):
            red_id, blue_id = fid, fid + 1
            fid += 2
            bouts.append({
                "id": ev["id"] * 10 + b,
                "red_id": red_id, "blue_id": blue_id,
                "red_name": f"Red {red_id}", "blue_name": f"Blue {blue_id}",
                "weight_class": "Lightweight",
                "is_title": 1 if b == 0 else 0,
                "is_main": 1 if b == 0 else 0,
                "round": 3,
                "winner_id": red_id if b == 0 else blue_id,
                "red_is_ufc_debut": 0, "blue_is_ufc_debut": 1 if b == 1 else 0,
            })
            career_stats[f"{red_id}@{ev['date']}"] = _career(red_id, ev["date"], 5, 190)
            career_stats[f"{blue_id}@{ev['date']}"] = _career(blue_id, ev["date"], 3 if b == 1 else 4, 183)
        cards[str(ev["id"])] = {"event": ev, "card": bouts}
    return {"events": events, "cards": cards, "career_stats": career_stats}


@pytest.fixture
def snapshot_file(tmp_path, synthetic_snapshot):
    p = tmp_path / "snapshot.json"
    p.write_text(json.dumps(synthetic_snapshot), encoding="utf-8")
    return p
```

- [ ] **Step 2: Write the failing test**

`ml/tests/test_snapshot.py`:

```python
import json

import pytest

from ml.snapshot import load_snapshot, snapshot_hash, iter_labeled_bouts


def test_snapshot_hash_matches_file_bytes(snapshot_file):
    expected = snapshot_hash(snapshot_file.read_bytes())
    snap = load_snapshot(snapshot_file)
    assert snap["_hash"] == expected
    assert len(snap["_hash"]) == 64


def test_iter_labeled_bouts_yields_event_ordered_rows(snapshot_file):
    snap = load_snapshot(snapshot_file)
    rows = list(iter_labeled_bouts(snap))
    assert len(rows) == 6  # 3 events * 2 bouts, all labeled
    dates = [r["event_date"] for r in rows]
    assert dates == sorted(dates)  # chronological
    assert rows[0]["red_career"]["stats"]["total_fights"] == 5


def test_load_snapshot_rejects_corruption(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError):
        load_snapshot(p)
```

- [ ] **Step 3: Run to verify it fails**

Run: `python -m pytest ml/tests/test_snapshot.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ml.snapshot'`.

- [ ] **Step 4: Implement `ml/snapshot.py`**

```python
"""Immutable data snapshot: build from the main app, load + verify offline.

Snapshot schema (single JSON object):
    events: list[event]                      # each has id, date, name
    cards:  {str(event_id): {event, card}}   # card is list[bout]
    career_stats: {"<fighter_id>@<as_of>": {fighter, stats}}

Building requires the main app; loading and everything downstream does not.
"""
from __future__ import annotations

import json
from pathlib import Path

from ml.manifest import sha256_of_bytes


def snapshot_hash(data: bytes) -> str:
    return sha256_of_bytes(data)


def build_snapshot(base_url: str, *, client) -> dict:
    """Fetch events, cards, and point-in-time career stats into one dict.

    `client` is an httpx.Client (injected so tests can pass a fake). Only
    events with a date and bouts with a winner_id are included, and career
    stats are requested with ?as_of=<event_date> for point-in-time vintage.
    """
    def _get(path):
        r = client.get(f"{base_url}{path}", timeout=30.0)
        r.raise_for_status()
        return r.json()

    events = [e for e in (_get("/api/events") or []) if e.get("date")]
    cards, career_stats = {}, {}
    for ev in events:
        card = _get(f"/api/events/{ev['id']}/card") or {}
        cards[str(ev["id"])] = card
        for bout in card.get("card", []):
            if not bout.get("winner_id"):
                continue
            for side in ("red", "blue"):
                fid = bout.get(f"{side}_id")
                if fid is None:
                    continue
                key = f"{fid}@{ev['date']}"
                if key not in career_stats:
                    career_stats[key] = _get(
                        f"/api/fighters/{fid}/career-stats?as_of={ev['date']}"
                    )
    return {"events": events, "cards": cards, "career_stats": career_stats}


def write_snapshot(snapshot: dict, path: Path) -> str:
    """Serialize deterministically and return the recorded SHA-256."""
    data = json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode("utf-8")
    Path(path).write_bytes(data)
    return snapshot_hash(data)


def load_snapshot(path: Path) -> dict:
    raw = Path(path).read_bytes()
    try:
        snap = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"snapshot at {path} is not valid JSON: {e}") from e
    # Re-hash the exact on-disk bytes so downstream manifests can cite it.
    snap["_hash"] = snapshot_hash(raw)
    return snap


def iter_labeled_bouts(snapshot: dict):
    """Yield labeled bouts in chronological event order with attached stats."""
    events = sorted(snapshot["events"], key=lambda e: e["date"])
    career = snapshot["career_stats"]
    for ev in events:
        card = snapshot["cards"].get(str(ev["id"]), {})
        for bout in card.get("card", []):
            if not bout.get("winner_id"):
                continue
            red_key = f"{bout['red_id']}@{ev['date']}"
            blue_key = f"{bout['blue_id']}@{ev['date']}"
            red_career = career.get(red_key)
            blue_career = career.get(blue_key)
            if not red_career or not blue_career:
                continue
            yield {
                "event_id": ev["id"],
                "event_date": ev["date"],
                "bout": bout,
                "red_career": red_career,
                "blue_career": blue_career,
            }
```

- [ ] **Step 5: Run to verify it passes**

Run: `python -m pytest ml/tests/test_snapshot.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add ml/snapshot.py ml/tests/conftest.py ml/tests/test_snapshot.py
git commit -m "feat(ml): immutable data snapshot build/load/verify"
```

---

### Task 3: Point-in-time dataset builder + dataset manifest

**Files:**
- Create: `ml/dataset.py`
- Test: `ml/tests/test_dataset.py`

Turns labeled bouts into a feature matrix `X`, labels `y` (1 = red win), a per-row metadata list (event_id, fight_id, slice attributes, prediction_cutoff, feature completeness), and a `DatasetManifest`. Reuses `engineer_features` from the shared model unchanged.

- [ ] **Step 1: Write the failing test**

`ml/tests/test_dataset.py`:

```python
import numpy as np

from ml.snapshot import load_snapshot
from ml.dataset import build_dataset


def test_build_dataset_shapes_and_labels(snapshot_file):
    snap = load_snapshot(snapshot_file)
    ds = build_dataset(snap)
    assert ds.X.shape[0] == 6
    assert ds.X.shape[1] == len(ds.feature_names)
    assert set(np.unique(ds.y)).issubset({0, 1})
    # bout b==0 is a red win in the fixture -> label 1
    first = ds.rows[0]
    assert first["prediction_cutoff"] == "2024-01-01"
    assert first["label"] in (0, 1)


def test_dataset_manifest_counts(snapshot_file):
    snap = load_snapshot(snapshot_file)
    ds = build_dataset(snap)
    man = ds.manifest
    assert man.number_of_labeled_fights == 6
    assert man.number_of_events == 3
    assert man.min_event_date == "2024-01-01"
    assert man.max_event_date == "2024-03-01"
    assert man.class_distribution["red"] + man.class_distribution["blue"] == 6
    assert man.database_snapshot_hash == snap["_hash"]


def test_row_slice_attributes_present(snapshot_file):
    snap = load_snapshot(snapshot_file)
    ds = build_dataset(snap)
    r = ds.rows[0]
    for key in ("weight_class", "main_event", "scheduled_rounds",
                "debutant", "history_band", "feature_completeness_band"):
        assert key in r
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest ml/tests/test_dataset.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ml.dataset'`.

- [ ] **Step 3: Implement `ml/dataset.py`**

```python
"""Build a point-in-time evaluation dataset from a snapshot.

Reuses the existing engineer_features / FEATURE_NAMES from the shared model
(ufc245-predictions/model). Baseline vintage caveat: fighter-profile fields
(slpm, str_def, td_def, reach, height) come from the snapshot's profile rows,
which reflect current vintage (F-001). Results built here are PROVISIONAL
until the Phase 1 point-in-time feature service lands.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from model import FEATURE_NAMES, engineer_features
from ml.manifest import DatasetManifest, sha256_of_obj
from ml.snapshot import iter_labeled_bouts


def _scheduled_rounds(bout: dict) -> int:
    return 5 if (bout.get("is_main") or bout.get("is_title")) else 3


def _history_band(total_fights: float) -> str:
    if total_fights <= 0:
        return "debut"
    if total_fights <= 3:
        return "low"
    if total_fights <= 8:
        return "mid"
    return "high"


def _completeness(red_stats: dict, blue_stats: dict) -> float:
    keys = ["avg_sig_per_fight", "sig_accuracy_pct", "total_td_landed",
            "total_control_sec", "win_pct_last3"]
    present = 0
    for stats in (red_stats, blue_stats):
        for k in keys:
            if stats.get(k) is not None:
                present += 1
    return present / (2 * len(keys))


def _completeness_band(frac: float) -> str:
    return "complete" if frac >= 0.999 else ("partial" if frac >= 0.6 else "sparse")


@dataclass
class Dataset:
    X: np.ndarray
    y: np.ndarray
    rows: list
    feature_names: list
    manifest: DatasetManifest


def build_dataset(snapshot: dict) -> Dataset:
    X_list, y_list, rows = [], [], []
    event_ids, debutants = set(), 0
    red_wins = blue_wins = 0
    missing = {}

    for item in iter_labeled_bouts(snapshot):
        bout = item["bout"]
        red_stats = item["red_career"].get("stats") or {}
        blue_stats = item["blue_career"].get("stats") or {}
        red_fighter = item["red_career"].get("fighter") or {}
        blue_fighter = item["blue_career"].get("fighter") or {}

        X = engineer_features(red_stats, blue_stats, red_fighter, blue_fighter)
        label = 1 if bout["winner_id"] == bout["red_id"] else 0
        X_list.append(X)
        y_list.append(label)
        if label == 1:
            red_wins += 1
        else:
            blue_wins += 1

        is_debut = bool(bout.get("red_is_ufc_debut") or bout.get("blue_is_ufc_debut"))
        if is_debut:
            debutants += 1
        event_ids.add(item["event_id"])
        min_hist = min(float(red_stats.get("total_fights") or 0),
                       float(blue_stats.get("total_fights") or 0))
        comp = _completeness(red_stats, blue_stats)
        for stats in (red_stats, blue_stats):
            if stats.get("avg_sig_per_fight") is None:
                missing["avg_sig_per_fight"] = missing.get("avg_sig_per_fight", 0) + 1

        rows.append({
            "event_id": item["event_id"],
            "fight_id": bout["id"],
            "prediction_cutoff": item["event_date"],
            "label": label,
            "weight_class": bout.get("weight_class") or "unknown",
            "main_event": bool(bout.get("is_main")),
            "scheduled_rounds": _scheduled_rounds(bout),
            "debutant": is_debut,
            "history_band": _history_band(min_hist),
            "feature_completeness_band": _completeness_band(comp),
            "qualitative_source_coverage": "none",  # Phase 0: no signals wired in
        })

    X = np.vstack(X_list) if X_list else np.empty((0, len(FEATURE_NAMES)))
    y = np.array(y_list, dtype=int)
    dates = [r["prediction_cutoff"] for r in rows]

    manifest = DatasetManifest(
        manifest_id=f"ds-{snapshot['_hash'][:12]}",
        database_snapshot_hash=snapshot["_hash"],
        min_event_date=min(dates) if dates else "",
        max_event_date=max(dates) if dates else "",
        feature_schema_hash=sha256_of_obj(list(FEATURE_NAMES)),
        number_of_events=len(event_ids),
        number_of_fights=len(rows),
        number_of_labeled_fights=len(rows),
        number_of_debutants=debutants,
        class_distribution={"red": red_wins, "blue": blue_wins},
        missingness_summary=missing,
    )
    return Dataset(X=X, y=y, rows=rows, feature_names=list(FEATURE_NAMES), manifest=manifest)
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest ml/tests/test_dataset.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add ml/dataset.py ml/tests/test_dataset.py
git commit -m "feat(ml): point-in-time dataset builder + dataset manifest"
```

---

### Task 4: Event-grouped walk-forward folds + fold isolation gate

**Files:**
- Create: `ml/folds.py`
- Test: `ml/tests/test_folds.py`

- [ ] **Step 1: Write the failing test**

`ml/tests/test_folds.py`:

```python
import pytest

from ml.folds import walk_forward_folds, assert_fold_isolation


def _rows():
    # 5 events, ~2 fights each, chronological event ids also chronological here.
    rows = []
    fid = 0
    for ev in range(1, 6):
        for _ in range(2):
            rows.append({"event_id": ev, "fight_id": fid,
                         "prediction_cutoff": f"2024-0{ev}-01"})
            fid += 1
    return rows


def test_walk_forward_is_chronological_and_grouped():
    folds = walk_forward_folds(_rows(), min_train_events=2, step=1)
    assert len(folds) >= 1
    for f in folds:
        max_train_date = max(r["prediction_cutoff"] for r in f.train_rows)
        min_val_date = min(r["prediction_cutoff"] for r in f.val_rows)
        assert min_val_date > max_train_date  # no future leakage into training


def test_no_event_split_across_train_and_val():
    folds = walk_forward_folds(_rows(), min_train_events=2, step=1)
    for f in folds:
        train_events = {r["event_id"] for r in f.train_rows}
        val_events = {r["event_id"] for r in f.val_rows}
        assert train_events.isdisjoint(val_events)


def test_assert_fold_isolation_raises_on_overlap():
    folds = walk_forward_folds(_rows(), min_train_events=2, step=1)
    # Corrupt one fold: inject a training fight into validation.
    folds[0].val_rows.append(folds[0].train_rows[0])
    with pytest.raises(AssertionError):
        assert_fold_isolation(folds)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest ml/tests/test_folds.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ml.folds'`.

- [ ] **Step 3: Implement `ml/folds.py`**

```python
"""Event-grouped walk-forward folds.

Fold k trains on the earliest (min_train_events + k*step) events and validates
on the next `step` events. Whole events never split across the train/val
boundary, and every validation event is strictly later than every training
event. This is the SPLIT-1 hard-gate mechanism.
"""
from __future__ import annotations

from dataclasses import dataclass

from ml.manifest import FoldManifest, sha256_of_obj


@dataclass
class Fold:
    fold_id: int
    train_rows: list
    val_rows: list

    def manifest(self) -> FoldManifest:
        train_events = sorted({r["event_id"] for r in self.train_rows})
        val_events = sorted({r["event_id"] for r in self.val_rows})
        return FoldManifest(
            fold_id=self.fold_id,
            train_event_ids=train_events,
            validation_event_ids=val_events,
            train_fight_ids_hash=sha256_of_obj(sorted(r["fight_id"] for r in self.train_rows)),
            validation_fight_ids_hash=sha256_of_obj(sorted(r["fight_id"] for r in self.val_rows)),
            train_event_range=[
                min(r["prediction_cutoff"] for r in self.train_rows),
                max(r["prediction_cutoff"] for r in self.train_rows),
            ] if self.train_rows else [],
            validation_event_range=[
                min(r["prediction_cutoff"] for r in self.val_rows),
                max(r["prediction_cutoff"] for r in self.val_rows),
            ] if self.val_rows else [],
        )


def _events_in_order(rows: list) -> list:
    """Unique event ids ordered by their (date, event_id)."""
    by_event = {}
    for r in rows:
        by_event.setdefault(r["event_id"], r["prediction_cutoff"])
    return [ev for ev, _ in sorted(by_event.items(), key=lambda kv: (kv[1], kv[0]))]


def walk_forward_folds(rows: list, *, min_train_events: int = 6, step: int = 1) -> list:
    order = _events_in_order(rows)
    folds, fold_id = [], 0
    train_count = min_train_events
    while train_count + step <= len(order):
        train_events = set(order[:train_count])
        val_events = set(order[train_count:train_count + step])
        train_rows = [r for r in rows if r["event_id"] in train_events]
        val_rows = [r for r in rows if r["event_id"] in val_events]
        if train_rows and val_rows:
            folds.append(Fold(fold_id=fold_id, train_rows=train_rows, val_rows=val_rows))
            fold_id += 1
        train_count += step
    return folds


def assert_fold_isolation(folds: list) -> None:
    """SPLIT-1 gate: no event split, no future validation before training end."""
    for f in folds:
        train_events = {r["event_id"] for r in f.train_rows}
        val_events = {r["event_id"] for r in f.val_rows}
        assert train_events.isdisjoint(val_events), f"fold {f.fold_id}: event split across boundary"
        train_fids = {r["fight_id"] for r in f.train_rows}
        val_fids = {r["fight_id"] for r in f.val_rows}
        assert train_fids.isdisjoint(val_fids), f"fold {f.fold_id}: fight id in both train and val"
        max_train = max(r["prediction_cutoff"] for r in f.train_rows)
        min_val = min(r["prediction_cutoff"] for r in f.val_rows)
        assert min_val > max_train, f"fold {f.fold_id}: validation not strictly after training"
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest ml/tests/test_folds.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add ml/folds.py ml/tests/test_folds.py
git commit -m "feat(ml): event-grouped walk-forward folds + isolation gate"
```

---

### Task 5: Proper probability metrics

**Files:**
- Create: `ml/metrics.py`
- Test: `ml/tests/test_metrics.py`

Calibration slope/intercept via the standard Cox approach: regress outcomes on the logit of predicted probability with `LogisticRegression`; the fitted coefficient is the slope and the intercept is the intercept. Perfect calibration → slope 1, intercept 0.

- [ ] **Step 1: Write the failing test**

`ml/tests/test_metrics.py`:

```python
import numpy as np

from ml.metrics import winner_metrics, reliability_table


def test_perfect_predictions_have_low_log_loss():
    y = np.array([1, 0, 1, 0, 1, 0])
    p = np.array([0.99, 0.01, 0.99, 0.01, 0.99, 0.01])
    m = winner_metrics(y, p)
    assert m["log_loss"] < 0.05
    assert m["brier_score"] < 0.01
    assert m["accuracy"] == 1.0
    assert m["roc_auc"] == 1.0


def test_metrics_keys_present():
    rng = np.random.default_rng(0)
    y = rng.integers(0, 2, size=200)
    p = rng.uniform(0.2, 0.8, size=200)
    m = winner_metrics(y, p)
    for key in ("log_loss", "brier_score", "calibration_slope",
                "calibration_intercept", "expected_calibration_error",
                "accuracy", "roc_auc"):
        assert key in m and m[key] is not None


def test_reliability_table_bins_sum_to_n():
    y = np.array([1, 0, 1, 0, 1, 1, 0, 0])
    p = np.array([0.9, 0.1, 0.8, 0.2, 0.7, 0.6, 0.3, 0.4])
    table = reliability_table(y, p, n_bins=4)
    assert sum(row["count"] for row in table) == len(y)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest ml/tests/test_metrics.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ml.metrics'`.

- [ ] **Step 3: Implement `ml/metrics.py`**

```python
"""Proper scoring metrics for binary winner probabilities."""
from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

_EPS = 1e-6


def _clip(p: np.ndarray) -> np.ndarray:
    return np.clip(np.asarray(p, dtype=float), _EPS, 1 - _EPS)


def calibration_slope_intercept(y: np.ndarray, p: np.ndarray) -> tuple[float, float]:
    """Cox calibration: regress outcomes on logit(p). slope=1, intercept=0 ideal."""
    p = _clip(p)
    logit = np.log(p / (1 - p)).reshape(-1, 1)
    y = np.asarray(y, dtype=int)
    if len(np.unique(y)) < 2:
        return float("nan"), float("nan")
    lr = LogisticRegression(C=1e6, solver="lbfgs", max_iter=1000)
    lr.fit(logit, y)
    return float(lr.coef_[0][0]), float(lr.intercept_[0])


def expected_calibration_error(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> float:
    p = _clip(p)
    y = np.asarray(y, dtype=int)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    n = len(y)
    ece = 0.0
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p > lo) & (p <= hi) if i > 0 else (p >= lo) & (p <= hi)
        if not mask.any():
            continue
        conf = p[mask].mean()
        acc = y[mask].mean()
        ece += (mask.sum() / n) * abs(acc - conf)
    return float(ece)


def reliability_table(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> list:
    p = _clip(p)
    y = np.asarray(y, dtype=int)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    table = []
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p > lo) & (p <= hi) if i > 0 else (p >= lo) & (p <= hi)
        count = int(mask.sum())
        table.append({
            "bin_lo": float(lo), "bin_hi": float(hi), "count": count,
            "mean_predicted": float(p[mask].mean()) if count else None,
            "observed_rate": float(y[mask].mean()) if count else None,
        })
    return table


def winner_metrics(y: np.ndarray, p: np.ndarray) -> dict:
    y = np.asarray(y, dtype=int)
    p = _clip(p)
    slope, intercept = calibration_slope_intercept(y, p)
    two_class = len(np.unique(y)) == 2
    return {
        "n": int(len(y)),
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "brier_score": float(brier_score_loss(y, p)),
        "calibration_slope": slope,
        "calibration_intercept": intercept,
        "expected_calibration_error": expected_calibration_error(y, p),
        "accuracy": float(((p >= 0.5).astype(int) == y).mean()),
        "roc_auc": float(roc_auc_score(y, p)) if two_class else None,
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest ml/tests/test_metrics.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add ml/metrics.py ml/tests/test_metrics.py
git commit -m "feat(ml): proper probability metrics (log loss, brier, calibration, ECE)"
```

---

### Task 6: Event-level bootstrap confidence intervals

**Files:**
- Create: `ml/bootstrap.py`
- Test: `ml/tests/test_bootstrap.py`

Bootstrap resamples whole events (not individual fights) to preserve within-event dependence, per §15.7. Uses a seeded `numpy` generator so results are reproducible without `Math.random`-style nondeterminism.

- [ ] **Step 1: Write the failing test**

`ml/tests/test_bootstrap.py`:

```python
import numpy as np

from ml.bootstrap import event_bootstrap_ci


def test_ci_brackets_point_estimate():
    rng = np.random.default_rng(1)
    n = 300
    event_ids = rng.integers(0, 30, size=n)
    y = rng.integers(0, 2, size=n)
    p = rng.uniform(0.3, 0.7, size=n)
    res = event_bootstrap_ci(event_ids, y, p, metric="log_loss", n_boot=200, seed=7)
    assert res["ci_low"] <= res["point"] <= res["ci_high"]
    assert res["ci_low"] < res["ci_high"]


def test_probability_candidate_improves_is_between_zero_and_one():
    rng = np.random.default_rng(2)
    n = 200
    event_ids = rng.integers(0, 20, size=n)
    y = rng.integers(0, 2, size=n)
    p_base = rng.uniform(0.3, 0.7, size=n)
    p_cand = np.clip(p_base + (y - 0.5) * 0.05, 1e-6, 1 - 1e-6)  # candidate slightly better
    prob = event_bootstrap_ci.__wrapped__ if hasattr(event_bootstrap_ci, "__wrapped__") else None
    from ml.bootstrap import prob_candidate_improves
    pr = prob_candidate_improves(event_ids, y, p_base, p_cand, metric="log_loss",
                                 n_boot=200, seed=3)
    assert 0.0 <= pr <= 1.0
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest ml/tests/test_bootstrap.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ml.bootstrap'`.

- [ ] **Step 3: Implement `ml/bootstrap.py`**

```python
"""Event-level bootstrap: resample whole events to preserve dependence."""
from __future__ import annotations

import numpy as np
from sklearn.metrics import brier_score_loss, log_loss

_METRICS = {
    "log_loss": lambda y, p: log_loss(y, np.clip(p, 1e-6, 1 - 1e-6), labels=[0, 1]),
    "brier_score": lambda y, p: brier_score_loss(y, np.clip(p, 1e-6, 1 - 1e-6)),
}


def _resample_indices(event_ids: np.ndarray, rng) -> np.ndarray:
    events = np.unique(event_ids)
    drawn = rng.choice(events, size=len(events), replace=True)
    idx = []
    by_event = {ev: np.where(event_ids == ev)[0] for ev in events}
    for ev in drawn:
        idx.append(by_event[ev])
    return np.concatenate(idx) if idx else np.array([], dtype=int)


def event_bootstrap_ci(event_ids, y, p, *, metric="log_loss", n_boot=1000, seed=42,
                       alpha=0.05) -> dict:
    event_ids = np.asarray(event_ids)
    y = np.asarray(y, dtype=int)
    p = np.asarray(p, dtype=float)
    fn = _METRICS[metric]
    rng = np.random.default_rng(seed)
    point = float(fn(y, p))
    samples = []
    for _ in range(n_boot):
        idx = _resample_indices(event_ids, rng)
        if len(np.unique(y[idx])) < 2 and metric == "log_loss":
            continue
        samples.append(fn(y[idx], p[idx]))
    samples = np.array(samples)
    return {
        "metric": metric,
        "point": point,
        "ci_low": float(np.quantile(samples, alpha / 2)),
        "ci_high": float(np.quantile(samples, 1 - alpha / 2)),
        "n_boot": len(samples),
    }


def prob_candidate_improves(event_ids, y, p_base, p_cand, *, metric="log_loss",
                            n_boot=1000, seed=42) -> float:
    """Fraction of event-bootstrap resamples where candidate metric < baseline."""
    event_ids = np.asarray(event_ids)
    y = np.asarray(y, dtype=int)
    fn = _METRICS[metric]
    rng = np.random.default_rng(seed)
    wins = total = 0
    for _ in range(n_boot):
        idx = _resample_indices(event_ids, rng)
        if len(np.unique(y[idx])) < 2 and metric == "log_loss":
            continue
        total += 1
        if fn(y[idx], np.asarray(p_cand)[idx]) < fn(y[idx], np.asarray(p_base)[idx]):
            wins += 1
    return wins / total if total else 0.0
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest ml/tests/test_bootstrap.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add ml/bootstrap.py ml/tests/test_bootstrap.py
git commit -m "feat(ml): event-level bootstrap CIs + candidate-improvement probability"
```

---

### Task 7: Slice breakdowns

**Files:**
- Create: `ml/slices.py`
- Test: `ml/tests/test_slices.py`

- [ ] **Step 1: Write the failing test**

`ml/tests/test_slices.py`:

```python
import numpy as np

from ml.slices import slice_metrics

_SLICE_KEYS = ["weight_class", "main_event", "scheduled_rounds", "debutant",
               "history_band", "feature_completeness_band",
               "qualitative_source_coverage"]


def _rows():
    rows = []
    for i in range(20):
        rows.append({
            "weight_class": "Lightweight" if i % 2 else "Welterweight",
            "main_event": bool(i % 5 == 0),
            "scheduled_rounds": 5 if i % 5 == 0 else 3,
            "debutant": bool(i % 4 == 0),
            "history_band": "low" if i % 3 == 0 else "high",
            "feature_completeness_band": "complete",
            "qualitative_source_coverage": "none",
        })
    return rows


def test_slice_metrics_cover_all_keys():
    rows = _rows()
    y = np.array([i % 2 for i in range(20)])
    p = np.clip(np.array([0.4 + 0.01 * i for i in range(20)]), 0, 1)
    out = slice_metrics(rows, y, p, slice_keys=_SLICE_KEYS)
    produced = {r["slice"] for r in out}
    assert "weight_class=Lightweight" in produced
    assert any(r["slice"].startswith("debutant=") for r in out)
    for r in out:
        assert "log_loss" in r and "n" in r


def test_small_slices_are_flagged_not_dropped():
    rows = _rows()
    y = np.array([i % 2 for i in range(20)])
    p = np.full(20, 0.5)
    out = slice_metrics(rows, y, p, slice_keys=_SLICE_KEYS, min_n=100)
    assert all(r["insufficient_sample"] for r in out)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest ml/tests/test_slices.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ml.slices'`.

- [ ] **Step 3: Implement `ml/slices.py`**

```python
"""Per-slice metric breakdowns. Small slices are flagged, never silently dropped."""
from __future__ import annotations

import numpy as np

from ml.metrics import winner_metrics


def slice_metrics(rows: list, y, p, *, slice_keys: list, min_n: int = 30) -> list:
    y = np.asarray(y, dtype=int)
    p = np.asarray(p, dtype=float)
    out = []
    for key in slice_keys:
        values = sorted({str(r.get(key)) for r in rows})
        for val in values:
            idx = np.array([i for i, r in enumerate(rows) if str(r.get(key)) == val])
            if len(idx) == 0:
                continue
            ys, ps = y[idx], p[idx]
            insufficient = len(idx) < min_n or len(np.unique(ys)) < 2
            row = {"slice": f"{key}={val}", "n": int(len(idx)),
                   "insufficient_sample": bool(insufficient)}
            if len(np.unique(ys)) < 2:
                row.update({"log_loss": None, "brier_score": None, "accuracy": None})
            else:
                m = winner_metrics(ys, ps)
                row.update({"log_loss": m["log_loss"], "brier_score": m["brier_score"],
                            "accuracy": m["accuracy"]})
            out.append(row)
    return out
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest ml/tests/test_slices.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add ml/slices.py ml/tests/test_slices.py
git commit -m "feat(ml): per-slice metric breakdowns with small-sample flagging"
```

---

### Task 8: Future-data mutation gate (PIT-2)

**Files:**
- Test: `ml/tests/test_future_data_mutation.py`

This is a hard gate (PIT-2). Against a frozen snapshot, adding a *later* event must not change the feature vector of an *earlier* bout. The current builder consumes point-in-time `as_of` career stats keyed by cutoff date, so this holds. (The residual F-001 leakage is a snapshot-*vintage* problem — the profile rows reflect current stats — which this plan documents but does not fix; that is a separate Phase 1 concern and a separate test.)

- [ ] **Step 1: Write the test**

`ml/tests/test_future_data_mutation.py`:

```python
import copy

import numpy as np

from ml.snapshot import load_snapshot
from ml.dataset import build_dataset


def test_adding_a_future_event_does_not_change_earlier_features(snapshot_file):
    snap = load_snapshot(snapshot_file)
    ds_before = build_dataset(snap)

    mutated = copy.deepcopy(snap)
    mutated["events"].append({"id": 99, "date": "2025-01-01", "name": "Future Card"})
    mutated["cards"]["99"] = {
        "event": {"id": 99, "date": "2025-01-01"},
        "card": [{
            "id": 990, "red_id": 100, "blue_id": 101,
            "red_name": "Red 100", "blue_name": "Blue 101",
            "weight_class": "Lightweight", "is_title": 0, "is_main": 0,
            "round": 3, "winner_id": 100,
            "red_is_ufc_debut": 0, "blue_is_ufc_debut": 0,
        }],
    }
    mutated["career_stats"]["100@2025-01-01"] = snap["career_stats"]["100@2024-01-01"]
    mutated["career_stats"]["101@2025-01-01"] = snap["career_stats"]["101@2024-01-01"]
    # Re-hash so load semantics match; build_dataset only needs _hash present.
    mutated["_hash"] = snap["_hash"]

    ds_after = build_dataset(mutated)

    # The 6 original rows must be byte-identical in features (order preserved).
    np.testing.assert_array_equal(ds_before.X, ds_after.X[: ds_before.X.shape[0]])
```

- [ ] **Step 2: Run to verify it passes immediately (gate currently holds against a frozen snapshot)**

Run: `python -m pytest ml/tests/test_future_data_mutation.py -v`
Expected: PASS (1 passed). If it FAILS, the dataset builder is reading non-point-in-time data — stop and investigate before continuing.

- [ ] **Step 3: Commit**

```bash
git add ml/tests/test_future_data_mutation.py
git commit -m "test(ml): PIT-2 future-data mutation gate against frozen snapshot"
```

---

### Task 9: Evaluation runner + executable hard gates (the capstone)

**Files:**
- Create: `ml/runner.py`
- Test: `ml/tests/test_runner.py`

The runner trains the existing LR per fold on that fold's training rows, predicts out-of-fold, aggregates OOF predictions, computes all metrics + CIs + slices, measures corner-swap error (SYM-1/2) and writes every artifact named in the spec plus `hard-gates.json`. It trains with the shared model's `train()` via a direct `LogisticRegression` pipeline fit per fold (not the shuffled-CV convenience path) so the harness itself is leakage-free even though the *production* `train()` still uses shuffled CV for its reported accuracy.

- [ ] **Step 1: Write the failing test**

`ml/tests/test_runner.py`:

```python
import json

from ml.snapshot import load_snapshot
from ml.runner import run_evaluation


def test_run_evaluation_writes_all_required_artifacts(snapshot_file, tmp_path):
    snap = load_snapshot(snapshot_file)
    out = tmp_path / "run"
    result = run_evaluation(snap, out_dir=out, min_train_events=1, step=1,
                            n_boot=50, seed=11)

    required = [
        "evaluation-summary.md", "scorecard.json", "metric-comparison.csv",
        "calibration-report.json", "temporal-fold-results.csv", "slice-results.csv",
        "hard-gates.json", "runtime-profile.json", "artifact-manifest.json",
    ]
    for name in required:
        assert (out / name).exists(), f"missing artifact {name}"

    gates = json.loads((out / "hard-gates.json").read_text())
    gate_ids = {g["id"] for g in gates["gates"]}
    assert {"SPLIT-1", "SYM-1", "SYM-2", "PIT-2"}.issubset(gate_ids)
    # SPLIT-1 is satisfied by construction in the harness.
    split1 = next(g for g in gates["gates"] if g["id"] == "SPLIT-1")
    assert split1["result"] in ("pass", "fail")
    assert result["verdict"] in ("promote", "shadow", "reject", "blocked")


def test_corner_swap_error_is_measured(snapshot_file, tmp_path):
    snap = load_snapshot(snapshot_file)
    out = tmp_path / "run2"
    run_evaluation(snap, out_dir=out, min_train_events=1, step=1, n_boot=25, seed=5)
    gates = {g["id"]: g for g in json.loads((out / "hard-gates.json").read_text())["gates"]}
    assert "mean_swap_error" in gates["SYM-1"]["evidence_detail"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest ml/tests/test_runner.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ml.runner'`.

- [ ] **Step 3: Implement `ml/runner.py`**

```python
"""Evaluation runner: trains the existing LR per fold, scores OOF, writes artifacts.

Verdict logic is intentionally conservative and mirrors agent-evaluation-spec.yaml:
- SPLIT-1 is satisfied by the harness (event-grouped walk-forward).
- SYM-1/SYM-2 corner-swap errors are MEASURED and gated at 0.01 / 0.03.
- PIT-2 future-data mutation is asserted here too.
- NUM-1 and PIT-1 are recorded as KNOWN production-path failures (documented,
  not fixed in Phase 0), which forces a `reject` verdict — an evidence-backed
  reject, not a `blocked`.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from model import FEATURE_NAMES, engineer_features
from ml.bootstrap import event_bootstrap_ci
from ml.dataset import build_dataset
from ml.folds import assert_fold_isolation, walk_forward_folds
from ml.metrics import reliability_table, winner_metrics
from ml.slices import slice_metrics

_SLICE_KEYS = ["weight_class", "main_event", "scheduled_rounds", "debutant",
               "history_band", "feature_completeness_band",
               "qualitative_source_coverage"]


def _fit(X, y):
    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("lr", LogisticRegression(C=1.0, max_iter=1000, solver="lbfgs",
                                  class_weight="balanced")),
    ])
    pipe.fit(X, y)
    return pipe


def _index_by_fight(rows):
    return {r["fight_id"]: i for i, r in enumerate(rows)}


def _corner_swap_error(pipe, X_rows) -> tuple[float, float]:
    """Swap red/blue halves of each delta-based vector and measure |p + p' - 1|."""
    errors = []
    for x in X_rows:
        x_swap = _swap_features(x)
        p = pipe.predict_proba(x.reshape(1, -1))[0][1]
        p_swap = pipe.predict_proba(x_swap.reshape(1, -1))[0][1]
        errors.append(abs(p + p_swap - 1.0))
    errors = np.array(errors) if errors else np.array([0.0])
    return float(errors.mean()), float(np.quantile(errors, 0.99))


def _swap_features(x: np.ndarray) -> np.ndarray:
    """Build the red<->blue swapped vector from FEATURE_NAMES layout.

    For a triple (red_v, blue_v, delta) swapping gives (blue_v, red_v, -delta).
    Pure delta features (reach/height) negate. Standalone red/blue pairs swap.
    """
    swapped = x.copy()
    name_to_idx = {n: i for i, n in enumerate(FEATURE_NAMES)}
    handled = set()
    for name, idx in name_to_idx.items():
        if idx in handled:
            continue
        if name.startswith("red_"):
            blue_name = "blue_" + name[len("red_"):]
            if blue_name in name_to_idx:
                j = name_to_idx[blue_name]
                swapped[idx], swapped[j] = x[j], x[idx]
                handled.update({idx, j})
        elif name.endswith("_delta") or name.endswith("_delta_cm"):
            swapped[idx] = -x[idx]
            handled.add(idx)
    return swapped


def run_evaluation(snapshot: dict, *, out_dir, min_train_events: int = 6, step: int = 1,
                   n_boot: int = 1000, seed: int = 42) -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    ds = build_dataset(snapshot)
    folds = walk_forward_folds(ds.rows, min_train_events=min_train_events, step=step)

    split1_ok = True
    try:
        assert_fold_isolation(folds)
    except AssertionError:
        split1_ok = False

    idx_by_fight = _index_by_fight(ds.rows)
    oof_p, oof_y, oof_event, oof_row = [], [], [], []
    fold_results = []

    for fold in folds:
        tr_idx = [idx_by_fight[r["fight_id"]] for r in fold.train_rows]
        va_idx = [idx_by_fight[r["fight_id"]] for r in fold.val_rows]
        X_tr, y_tr = ds.X[tr_idx], ds.y[tr_idx]
        X_va, y_va = ds.X[va_idx], ds.y[va_idx]
        if len(np.unique(y_tr)) < 2:
            continue
        pipe = _fit(X_tr, y_tr)
        p_va = pipe.predict_proba(X_va)[:, 1]
        oof_p.extend(p_va.tolist())
        oof_y.extend(y_va.tolist())
        oof_event.extend([r["event_id"] for r in fold.val_rows])
        oof_row.extend(fold.val_rows)
        if len(np.unique(y_va)) >= 2:
            fm = winner_metrics(np.array(y_va), p_va)
        else:
            fm = {"log_loss": None, "brier_score": None}
        fold_results.append({"fold_id": fold.fold_id,
                             "val_events": ",".join(map(str, sorted({r["event_id"] for r in fold.val_rows}))),
                             "n": len(va_idx),
                             "log_loss": fm["log_loss"], "brier_score": fm["brier_score"]})

    oof_p = np.array(oof_p)
    oof_y = np.array(oof_y, dtype=int)
    oof_event = np.array(oof_event)

    if len(oof_y) >= 2 and len(np.unique(oof_y)) == 2:
        agg = winner_metrics(oof_y, oof_p)
        ll_ci = event_bootstrap_ci(oof_event, oof_y, oof_p, metric="log_loss",
                                   n_boot=n_boot, seed=seed)
        reliability = reliability_table(oof_y, oof_p)
        slices = slice_metrics(oof_row, oof_y, oof_p, slice_keys=_SLICE_KEYS)
    else:
        agg = {k: None for k in ("log_loss", "brier_score", "calibration_slope",
                                 "calibration_intercept", "expected_calibration_error",
                                 "accuracy", "roc_auc")}
        ll_ci = {"point": None, "ci_low": None, "ci_high": None}
        reliability, slices = [], []

    # Corner-swap on a model fit over ALL data (measurement only).
    if len(np.unique(ds.y)) == 2:
        full = _fit(ds.X, ds.y)
        mean_swap, p99_swap = _corner_swap_error(full, list(ds.X))
    else:
        mean_swap, p99_swap = float("nan"), float("nan")

    # PIT-2: re-run the future-data mutation invariant inline.
    pit2_ok = _pit2_holds(snapshot, ds)

    gates = _build_gates(split1_ok, mean_swap, p99_swap, pit2_ok)
    verdict = _verdict(gates)

    _write_artifacts(out, snapshot, ds, folds, fold_results, agg, ll_ci,
                     reliability, slices, gates, mean_swap, p99_swap, verdict)
    return {"verdict": verdict, "aggregate": agg, "n_oof": int(len(oof_y))}


def _pit2_holds(snapshot: dict, ds) -> bool:
    import copy
    mutated = copy.deepcopy(snapshot)
    if not mutated.get("events"):
        return True
    last = max(mutated["events"], key=lambda e: e["date"])
    future_date = "9999-01-01"
    mutated["events"].append({"id": -1, "date": future_date, "name": "synthetic-future"})
    mutated["cards"]["-1"] = {"event": {"id": -1, "date": future_date}, "card": []}
    ds_after = build_dataset(mutated)
    return np.array_equal(ds.X, ds_after.X)


def _build_gates(split1_ok, mean_swap, p99_swap, pit2_ok) -> dict:
    def gate(gid, name, result, detail):
        return {"id": gid, "name": name, "result": result, "evidence_detail": detail}

    sym1 = "pass" if (mean_swap == mean_swap and mean_swap <= 0.01) else "fail"
    sym2 = "pass" if (p99_swap == p99_swap and p99_swap <= 0.03) else "fail"
    return {"gates": [
        gate("SPLIT-1", "Event-grouped temporal evaluation",
             "pass" if split1_ok else "fail",
             {"mechanism": "walk_forward_folds + assert_fold_isolation"}),
        gate("PIT-2", "Future-data mutation tests pass",
             "pass" if pit2_ok else "fail",
             {"invariant": "adding a future event leaves earlier feature vectors unchanged"}),
        gate("SYM-1", "Mean corner-swap probability error <= 0.01", sym1,
             {"mean_swap_error": mean_swap, "threshold": 0.01}),
        gate("SYM-2", "P99 corner-swap probability error <= 0.03", sym2,
             {"p99_swap_error": p99_swap, "threshold": 0.03}),
        gate("PIT-1", "No known point-in-time leakage", "fail",
             {"note": "F-001 profile-vintage leakage unaddressed in Phase 0 (provisional)"}),
        gate("NUM-1", "Numeric probabilities independent of Ollama", "fail",
             {"note": "F-003 production path still publishes LLM win_probability"}),
    ]}


def _verdict(gates: dict) -> str:
    # Any required hard-gate failure => reject (spec promotion_logic.reject_when).
    if any(g["result"] == "fail" for g in gates["gates"]):
        return "reject"
    return "shadow"


def _write_artifacts(out, snapshot, ds, folds, fold_results, agg, ll_ci,
                     reliability, slices, gates, mean_swap, p99_swap, verdict):
    (out / "artifact-manifest.json").write_text(json.dumps({
        "database_snapshot_hash": snapshot["_hash"],
        "feature_schema_hash": ds.manifest.feature_schema_hash,
        "dataset_manifest": ds.manifest.to_dict(),
        "fold_manifest": [f.manifest().to_dict() for f in folds],
        "verdict": verdict,
    }, indent=2), encoding="utf-8")

    (out / "scorecard.json").write_text(json.dumps({
        "verdict": verdict, "aggregate_metrics": agg,
        "log_loss_ci": ll_ci,
    }, indent=2), encoding="utf-8")

    (out / "calibration-report.json").write_text(json.dumps({
        "calibration_slope": agg["calibration_slope"],
        "calibration_intercept": agg["calibration_intercept"],
        "expected_calibration_error": agg["expected_calibration_error"],
        "reliability_table": reliability,
    }, indent=2), encoding="utf-8")

    (out / "hard-gates.json").write_text(json.dumps(gates, indent=2), encoding="utf-8")

    (out / "runtime-profile.json").write_text(json.dumps({
        "status": "not_executed",
        "reason": "Phase 0 numeric harness; no GPU/Ollama capacity run in scope.",
    }, indent=2), encoding="utf-8")

    with (out / "metric-comparison.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["metric", "candidate", "ci_low", "ci_high"])
        w.writerow(["log_loss", agg["log_loss"], ll_ci.get("ci_low"), ll_ci.get("ci_high")])
        for k in ("brier_score", "calibration_slope", "calibration_intercept",
                  "expected_calibration_error", "accuracy", "roc_auc"):
            w.writerow([k, agg[k], "", ""])

    with (out / "temporal-fold-results.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["fold_id", "val_events", "n", "log_loss", "brier_score"])
        for r in fold_results:
            w.writerow([r["fold_id"], r["val_events"], r["n"], r["log_loss"], r["brier_score"]])

    with (out / "slice-results.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["slice", "n", "insufficient_sample", "log_loss", "brier_score", "accuracy"])
        for r in slices:
            w.writerow([r["slice"], r["n"], r["insufficient_sample"],
                        r.get("log_loss"), r.get("brier_score"), r.get("accuracy")])

    (out / "evaluation-summary.md").write_text(_summary_md(ds, agg, gates, verdict), encoding="utf-8")


def _summary_md(ds, agg, gates, verdict) -> str:
    gate_lines = "\n".join(
        f"| {g['id']} | {g['result']} | {g['name']} |" for g in gates["gates"]
    )
    return (
        "# Candidate Evaluation\n\n"
        f"## Verdict\n{verdict}\n\n"
        "## Executive finding\n"
        "Directional/provisional baseline from the Phase 0 numeric harness. "
        "Event-grouped walk-forward evaluation ran to completion with reproducible "
        "artifacts, so the result is no longer `blocked`. It remains `reject` because "
        "PIT-1 (profile-vintage leakage) and NUM-1 (LLM-owned probability) are unaddressed "
        "in the production path.\n\n"
        "## Scope\n"
        f"- Database snapshot: {ds.manifest.database_snapshot_hash}\n"
        f"- Events: {ds.manifest.number_of_events}, "
        f"labeled fights: {ds.manifest.number_of_labeled_fights}\n\n"
        "## Hard gates\n| Gate | Result | Evidence |\n|---|---|---|\n"
        f"{gate_lines}\n\n"
        "## Metric comparison\n"
        f"- log_loss: {agg['log_loss']}\n"
        f"- brier_score: {agg['brier_score']}\n"
        f"- calibration_slope: {agg['calibration_slope']}\n"
        f"- calibration_intercept: {agg['calibration_intercept']}\n"
        f"- ECE: {agg['expected_calibration_error']}\n\n"
        "## Risks and limitations\n"
        "Baseline is PROVISIONAL: fighter-profile features still reflect current vintage "
        "(F-001). Snapshot may be small; treat single-fold metrics cautiously.\n\n"
        "## Required follow-up\n"
        "Phase 1: point-in-time feature service, remove LLM probability, symmetric features.\n"
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest ml/tests/test_runner.py -v`
Expected: PASS (2 passed). The synthetic snapshot has few events, so `min_train_events=1` is used in the test to guarantee at least one fold.

- [ ] **Step 5: Run the whole harness suite**

Run: `python -m pytest ml/tests/ -v`
Expected: PASS (all tests green).

- [ ] **Step 6: Commit**

```bash
git add ml/runner.py ml/tests/test_runner.py
git commit -m "feat(ml): evaluation runner writes all spec artifacts + executable hard gates"
```

---

### Task 10: Snapshot CLI + README

**Files:**
- Create: `ml/__main__.py`
- Create: `ml/README.md`
- Test: `ml/tests/test_runner.py` (extend with a CLI smoke import)

- [ ] **Step 1: Write the failing test (CLI entrypoints import cleanly)**

Append to `ml/tests/test_runner.py`:

```python
def test_cli_module_exposes_main():
    from ml.__main__ import main
    assert callable(main)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest ml/tests/test_runner.py::test_cli_module_exposes_main -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ml.__main__'`.

- [ ] **Step 3: Implement `ml/__main__.py`**

```python
"""CLI: build a snapshot from the main app, then run the evaluation.

Usage:
    python -m ml snapshot --base-url http://localhost:3000 --out artifacts/snapshot.json
    python -m ml evaluate --snapshot artifacts/snapshot.json --out artifacts/eval-run
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import httpx

from ml.snapshot import build_snapshot, write_snapshot, load_snapshot
from ml.runner import run_evaluation


def main(argv=None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    parser = argparse.ArgumentParser(prog="ml")
    sub = parser.add_subparsers(dest="cmd", required=True)

    snap = sub.add_parser("snapshot", help="fetch an immutable snapshot")
    snap.add_argument("--base-url", required=True)
    snap.add_argument("--out", required=True)

    ev = sub.add_parser("evaluate", help="run the temporal evaluation")
    ev.add_argument("--snapshot", required=True)
    ev.add_argument("--out", required=True)
    ev.add_argument("--min-train-events", type=int, default=6)
    ev.add_argument("--step", type=int, default=1)
    ev.add_argument("--n-boot", type=int, default=1000)

    args = parser.parse_args(argv)
    if args.cmd == "snapshot":
        with httpx.Client() as client:
            snapshot = build_snapshot(args.base_url, client=client)
        digest = write_snapshot(snapshot, Path(args.out))
        print(f"snapshot written: {args.out}  sha256={digest}")
        return 0
    if args.cmd == "evaluate":
        snapshot = load_snapshot(Path(args.snapshot))
        result = run_evaluation(snapshot, out_dir=args.out,
                                min_train_events=args.min_train_events,
                                step=args.step, n_boot=args.n_boot)
        print(f"verdict: {result['verdict']}  n_oof={result['n_oof']}  out={args.out}")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest ml/tests/test_runner.py::test_cli_module_exposes_main -v`
Expected: PASS.

- [ ] **Step 5: Write `ml/README.md`**

```markdown
# ml/ — Forecasting Evaluation Harness (Phase 0)

Reproducible, event-grouped, walk-forward evaluation of the existing
logistic-regression winner model. Flips the evaluation in
`docs/evaluation/agent-evaluation-prompt.md` from `blocked` to a measured verdict.

## Run

1. Start the main app locally (see repo README) so its `/api/*` routes serve data.
2. Build an immutable snapshot (records a SHA-256):

   ```bash
   python -m ml snapshot --base-url http://localhost:3000 --out artifacts/snapshot.json
   ```

3. Run the evaluation:

   ```bash
   python -m ml evaluate --snapshot artifacts/snapshot.json --out artifacts/eval-run
   ```

Outputs (in `--out`): `evaluation-summary.md`, `scorecard.json`,
`metric-comparison.csv`, `calibration-report.json`, `temporal-fold-results.csv`,
`slice-results.csv`, `hard-gates.json`, `runtime-profile.json`,
`artifact-manifest.json`.

## Scope & caveats

- **Provisional baseline.** Fighter-profile features still reflect current
  vintage (finding F-001); this harness does not fix that. Expect verdict
  `reject` until Phase 1 (point-in-time feature service, remove LLM-owned
  probability, symmetric features) lands.
- No calibration artifact, ensemble, GPU capacity test, or Ollama extraction
  eval — those are later phases.

## Tests

```bash
python -m pytest ml/tests/ -v
```
```

- [ ] **Step 6: Commit**

```bash
git add ml/__main__.py ml/README.md ml/tests/test_runner.py
git commit -m "feat(ml): snapshot/evaluate CLI + harness README"
```

---

### Task 11: Wire the harness tests into CI

**Files:**
- Modify: `.github/workflows/ci.yml` (the python test step around lines 96-100)

- [ ] **Step 1: Read the current python test step**

Run: `grep -n "test_model.py\|test_jobs.py\|test_app.py\|pytest\|pip install" .github/workflows/ci.yml`
Expected: shows the existing `python ufc245-predictions/tests/*.py` invocations and any dependency install step.

- [ ] **Step 2: Add a harness test step**

In `.github/workflows/ci.yml`, immediately after the existing line:

```yaml
          python ufc245-predictions/tests/test_app.py
```

add:

```yaml
      - name: Install harness test deps
        run: pip install pytest scikit-learn numpy joblib httpx
      - name: Run forecasting evaluation harness tests
        run: python -m pytest ml/tests/ -v
```

(If the workflow already installs `ufc245-predictions/requirements.txt`, the `pip install` line is redundant — keep only the `pytest` install in that case. Verify which by reading the surrounding steps before editing.)

- [ ] **Step 3: Run the harness tests locally exactly as CI will**

Run: `python -m pytest ml/tests/ -v`
Expected: PASS (all green).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run forecasting evaluation harness tests"
```

---

### Task 12: Pin the Ollama image digest (cheap REPRO-1 improvement)

**Files:**
- Modify: `docker-compose.yml:3`

The evaluation's REPRO-1 gate fails partly because `docker-compose.yml` uses the floating tag `ollama/ollama:latest`. Pin it to the digest already recorded in the 2026-08-08 run.

- [ ] **Step 1: Confirm the digest**

Run: `docker inspect --format '{{.Image}}' ufc-ollama`
Expected: prints `sha256:e009e15e7221cc285c29499de8db99cf2408233131cbf278c8376597bf16bc0d` (or the current running image; use whatever it prints).

- [ ] **Step 2: Edit `docker-compose.yml`**

Change line 3 from:

```yaml
    image: ollama/ollama:latest
```

to (using the digest confirmed in Step 1):

```yaml
    # Pinned for reproducibility (REPRO-1). Update deliberately, not implicitly.
    image: ollama/ollama@sha256:e009e15e7221cc285c29499de8db99cf2408233131cbf278c8376597bf16bc0d
```

- [ ] **Step 3: Validate the compose file parses**

Run: `docker compose -f docker-compose.yml config >/dev/null && echo OK`
Expected: prints `OK` (no YAML/schema error).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: pin ollama image by digest for reproducibility (REPRO-1)"
```

---

### Task 13: Regenerate the evaluation run against the new harness

**Files:**
- Create: `docs/evaluation/runs/2026-08-08/README.md` (points at the harness)

This does not re-fabricate metrics; it documents how the harness now produces the run and supersedes the hand-written `blocked` artifacts once real data is snapshotted.

- [ ] **Step 1: Write the pointer doc**

`docs/evaluation/runs/2026-08-08/README.md`:

```markdown
# 2026-08-08 evaluation run

The JSON/CSV artifacts in this directory were the initial **blocked** assessment
(no harness existed yet). The reproducible harness now lives in `ml/`.

To produce a measured run:

```bash
python -m ml snapshot --base-url http://localhost:3000 --out artifacts/snapshot.json
python -m ml evaluate --snapshot artifacts/snapshot.json --out docs/evaluation/runs/<date>/
```

Expected verdict with the current production code: `reject` (evidence-backed) —
PIT-1 and NUM-1 remain until Phase 1. See `ml/README.md`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/evaluation/runs/2026-08-08/README.md
git commit -m "docs: point 2026-08-08 evaluation run at the ml/ harness"
```

- [ ] **Step 3: Push and open a PR**

```bash
git push -u origin claude/ufc245-tactical-file-org-40b2e7
gh pr view --json url 2>/dev/null || gh pr create --base main \
  --title "feat(ml): Phase 0 forecasting evaluation harness" \
  --body "Builds the reproducible event-grouped walk-forward evaluation harness that flips the forecasting evaluation from blocked to a measured verdict. Scope: Phase 0 only (see ml/README.md). Follow-on: point-in-time feature service, remove LLM-owned probability, calibration/ensemble."
```

(If a PR for this branch already exists, the `gh pr view` short-circuits creation — just push.)

---

## Self-review

**Spec coverage** (against `agent-evaluation-spec.yaml` / `agent-evaluation-prompt.md`):
- Reproducible baseline + dataset manifest → Tasks 2, 3. ✅
- Event-grouped walk-forward + fold manifest → Task 4. ✅ (SPLIT-1 mechanism)
- Proper metrics (log loss, Brier, calibration slope/intercept, ECE, reliability, accuracy, AUC) → Task 5. ✅
- Event-bootstrap CIs + candidate-improvement probability → Task 6. ✅
- Required slices → Task 7 (weight_class, main_event, scheduled_rounds, debutant, history band, completeness band, qualitative coverage). `gender_division`, `short_notice`, `weight_class_change` are **not** in the snapshot's card fields at Phase 0 — documented as unavailable, not silently dropped (they'd need new source columns; deferred). ✅ with noted gaps.
- PIT-2 future-data mutation gate → Task 8 + inline in Task 9. ✅
- Executable hard-gates.json with SPLIT-1, PIT-2, SYM-1/2 measured, PIT-1/NUM-1 documented → Task 9. ✅
- All ten output artifacts written → Task 9 (`extraction-eval.json` omitted by design because no LLM extraction changed; the runner documents it as not-applicable — matches the "when applicable" clause). ✅
- REPRO-1 partial (digest pin) → Task 12. ✅
- CI enforcement → Task 11. ✅

Deliberately deferred (out of scope, stated up front): PIT-1 fix, NUM-1 fix, calibration artifact, ensemble, GPU capacity (RUNTIME-1), Ollama golden set (EVID-*), FALLBACK-1. These keep the verdict at an honest `reject` rather than `promote`, which is correct for Phase 0.

**Placeholder scan:** No `TBD`/`handle edge cases`/`similar to`—every code step contains complete, runnable code. The one intentional "verify before editing" note in Task 11 concerns a real conditional in an external workflow file, not a code placeholder.

**Type consistency:** `winner_metrics` keys used in Tasks 5/7/9 match. `Fold.train_rows`/`val_rows` and `.manifest()` consistent across Tasks 4/9. `build_dataset` returns `Dataset(X, y, rows, feature_names, manifest)` consistent across Tasks 3/8/9. `event_bootstrap_ci` / `prob_candidate_improves` signatures consistent across Tasks 6/9. `run_evaluation(snapshot, *, out_dir, ...)` consistent across Tasks 9/10. Snapshot dict shape (`events`, `cards[str(id)]`, `career_stats["fid@date"]`, `_hash`) consistent across Tasks 2/3/8/9.

One correction applied during review: Task 3's dataset builder originally had a stray no-op loop over `FEATURE_NAMES`; it has been removed so the missingness tally iterates only the red/blue stat dicts.
