# ml/ — Forecasting Evaluation Harness (Phase 0)

Reproducible, event-grouped, walk-forward evaluation of the existing
logistic-regression winner model. Flips the evaluation in
`docs/evaluation/agent-evaluation-prompt.md` from `blocked` to a measured verdict.

## Run

1. Start the main app locally (see repo README) so its `/api/*` routes serve data.
2. Build an immutable snapshot (records a SHA-256):

   ```bash
   python -m ml snapshot --base-url http://localhost:3000 --out artifacts/snapshot.json
   ```

3. Run the evaluation:

   ```bash
   python -m ml evaluate --snapshot artifacts/snapshot.json --out artifacts/eval-run
   ```

Outputs (in `--out`): `evaluation-summary.md`, `scorecard.json`,
`metric-comparison.csv`, `calibration-report.json`, `temporal-fold-results.csv`,
`slice-results.csv`, `hard-gates.json`, `runtime-profile.json`,
`artifact-manifest.json`.

## Scope & caveats

- **Provisional baseline.** Fighter-profile features still reflect current
  vintage (finding F-001); this harness does not fix that. Expect verdict
  `reject` until Phase 1 (point-in-time feature service, remove LLM-owned
  probability, symmetric features) lands.
- No calibration artifact, ensemble, GPU capacity test, or Ollama extraction
  eval — those are later phases.

## Tests

```bash
python -m pytest ml/tests/ -v
```
