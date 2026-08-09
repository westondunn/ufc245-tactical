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
