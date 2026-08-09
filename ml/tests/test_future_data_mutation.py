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
