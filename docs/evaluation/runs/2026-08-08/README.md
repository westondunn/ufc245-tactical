# 2026-08-08 evaluation run

The JSON/CSV artifacts in this directory were the initial **blocked** assessment
(no harness existed yet). The reproducible harness now lives in `ml/`.

To produce a measured run:

```bash
python -m ml snapshot --base-url http://localhost:3000 --out artifacts/snapshot.json
python -m ml evaluate --snapshot artifacts/snapshot.json --out docs/evaluation/runs/<date>/
```

Expected verdict with the current production code: `reject` (evidence-backed) —
PIT-1 and NUM-1 remain until Phase 1. See `ml/README.md`.
