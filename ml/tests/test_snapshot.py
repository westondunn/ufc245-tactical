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
