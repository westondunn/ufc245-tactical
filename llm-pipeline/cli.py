"""CLI entrypoint for the pipeline-shell compose service.

Usage:
  python -m cli enrich [--dry-run] [--event <id>]
  python -m cli train
  python -m cli drain
"""
from __future__ import annotations
import argparse
import json
import sys

from config import Config
from db.store import Store
from pipeline.orchestrator import Orchestrator
from pipeline.sync import RailwaySync
from pipeline.train import train_local


def _store() -> Store:
    cfg = Config.from_env()
    s = Store(cfg.pipeline_db_path)
    s.init()
    return s


def cmd_enrich(args) -> int:
    orch = Orchestrator.from_env(store=_store())
    result = orch.run(dry_run=args.dry_run, only_event=args.event)
    print(json.dumps(result, indent=2, default=str))
    return 0 if result.get("status") in {"ok", "partial"} else 1


def cmd_train(_args) -> int:
    print(json.dumps(train_local(), indent=2, default=str))
    return 0


def cmd_drain(_args) -> int:
    sync = RailwaySync.from_env(store=_store())
    n = sync.drain_pending()
    print(json.dumps({"drained": n}, indent=2))
    return 0


def main():
    p = argparse.ArgumentParser(prog="pipeline-shell")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_enr = sub.add_parser("enrich")
    p_enr.add_argument("--dry-run", action="store_true")
    p_enr.add_argument("--event", type=int, default=None)
    p_enr.set_defaults(func=cmd_enrich)

    p_tr = sub.add_parser("train")
    p_tr.set_defaults(func=cmd_train)

    p_dr = sub.add_parser("drain")
    p_dr.set_defaults(func=cmd_drain)

    args = p.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
