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
