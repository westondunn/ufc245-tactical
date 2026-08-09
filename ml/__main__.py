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
