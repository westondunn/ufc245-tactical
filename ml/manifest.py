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
