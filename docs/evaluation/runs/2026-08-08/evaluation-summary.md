# Candidate Evaluation

## Verdict
blocked

## Executive finding
The candidate is **unevaluable**. Two independent conditions force `blocked` under the spec's `blocked_when` rules. First, the baseline cannot be reproduced: the repository at the base commit has no dataset manifest, no temporal fold manifest, no event-grouped walk-forward evaluator (the model still uses shuffled `StratifiedKFold`, `ufc245-predictions/model/__init__.py:336`), no immutable database or source snapshots, and none of the 14 required test suites in `agent-evaluation-spec.yaml` (`source_cutoff`, `future_data_mutation`, `corner_swap_invariance`, `historical_replay`, `full_event_12gb_gpu`, etc.) exist. Second, the candidate commit contains **no prediction-related changes**: the diff `0c3afc3..c9819ab` touches only CI workflow files, Playwright dependency bumps, and the evaluation documentation itself — there is no forecasting revision to promote. Independent of the blocked verdict, three hard gates fail on direct static evidence at both commits: PIT-1 (current-profile leakage path, F-001), SPLIT-1 (shuffled cross-validation), and NUM-1 (the LLM generates the published `win_probability`, `llm-pipeline/prompts/reason.md:11` → `llm-pipeline/pipeline/reason.py:48,89`), so even a reproduced baseline could not be promoted against.

## Scope
- Base commit: `0c3afc3fb48e37b1098f2febd1e86ec380cbc5a2` (spec `baseline_review_commit`)
- Candidate commit: `c9819abe26d21f1d086606f1a6e426149f5866e0` (HEAD of `claude/ufc245-tactical-file-org-40b2e7`)
- Hardware: NVIDIA GeForce RTX 4070 SUPER, 12,282 MiB VRAM, driver 595.95, Windows 11 (target 12 GB GPU **verified present**)
- Ollama runtime: `ollama/ollama:latest` container, image `sha256:e009e15e…`, healthy; models `llama3.1:8b` (46e0c10c039e), `qwen3:8b`, `nomic-embed-text`
- Database snapshot: **none exists** (no immutable snapshot or recorded hash)
- Source snapshot: **none exists**
- Fold manifest: **none exists**

## Hard gates
| Gate | Result | Evidence |
|---|---|---|
| PIT-1 | fail | F-001 leakage path present; `train.py:46-50` career-stats `as_of` response includes current profile fields |
| PIT-2 | blocked | No future-data mutation suite exists |
| SPLIT-1 | fail | `StratifiedKFold(shuffle=True)` at `model/__init__.py:336` |
| SPLIT-2 | blocked | No holdout/fold manifest exists to verify |
| SYM-1 / SYM-2 | blocked | No corner-swap test or trained artifacts to measure |
| EVID-1/2/3 | blocked | No source snapshots, publication-time fields, or evidence offsets exist |
| NUM-1 | fail | LLM emits final `win_probability` (`reason.md:11`, `reason.py:48,89`) |
| RUNTIME-1 | blocked | GPU present but no capacity suite and no snapshot to run a full card |
| FALLBACK-1 | blocked | No numeric-only-fallback integration test exists |
| REPRO-1 | fail | Floating `ollama:latest` tag; no artifact lineage registry |
| TEST-1 | blocked | Zero of the required quality suites exist |

## Metric comparison
No metrics computed — see `metric-comparison.csv`. Fabricating values would violate agent rules 7 and 9.

## Calibration
- Slope: not measurable
- Intercept: not measurable
- ECE: not measurable
- Reliability summary: blocked; the published probability is LLM-generated and is prohibited from being treated as calibrated.

## Slice regressions
Blocked — no fold-level predictions exist to slice.

## Extraction quality
Not applicable (no prompt/schema/model/retrieval/cache changes between commits) and blocked (no frozen golden set exists).

## Runtime
Static verification only: target 12 GB GPU present, Ollama container healthy. No full-event run executed. See `runtime-profile.json`.

## Reproducibility
- Artifact manifest complete: **no** — database snapshot, feature schema hash, fold manifest, model/stacker/calibrator artifacts all absent
- Digests recorded: partially — Ollama runtime and model digests recorded in `artifact-manifest.json`
- Independent rerun match: not attempted (nothing to rerun)

## Causal interpretation
There is no observed change to interpret: the base→candidate diff contains no data, feature, model, calibration, prompt, or source-handling changes. The blocked verdict is caused entirely by missing evaluation infrastructure, which is exactly what Phase 0–1 of the roadmap in `forecasting-evaluation-report.md` is meant to build.

## Risks and limitations
- This run is a static assessment plus environment verification; no training, inference, or capacity workload was executed.
- F-001 profile-field leakage is cited from the governing report and corroborated by the career-stats route usage; a runnable future-data mutation test is still needed to make it mechanically provable.
- The provisional scorecard (36.7/100) is carried forward unchanged and remains unmeasured.

## Required follow-up
1. Build Phase 0: pin a database snapshot with a recorded hash, export the feature schema, and run the current model through an event-grouped temporal evaluator to establish a reproducible baseline report.
2. Implement the point-in-time feature service and future-data mutation tests (unblocks PIT-1/PIT-2).
3. Remove the LLM-generated probability from the published path (unblocks NUM-1).
4. Replace shuffled CV with event-grouped walk-forward folds and a frozen fold manifest (unblocks SPLIT-1/SPLIT-2).
5. Pin the Ollama image digest and model digest in `docker-compose.yml` (unblocks REPRO-1).
6. Re-run this evaluation only after a candidate commit actually changes prediction behavior.
