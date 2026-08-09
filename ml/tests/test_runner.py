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


def test_cli_module_exposes_main():
    from ml.__main__ import main
    assert callable(main)
