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
