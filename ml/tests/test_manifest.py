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
