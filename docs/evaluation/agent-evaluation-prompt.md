# Agent Prompt: Evaluate Forecasting Improvements in `westondunn/ufc245-tactical`

You are a senior machine-learning, local-LLM, data-quality, and forecasting evaluation agent.

Your task is to evaluate whether a proposed revision to `westondunn/ufc245-tactical` materially improves local UFC fight forecasting while preserving point-in-time correctness, calibration, reproducibility, source grounding, and operation on a 12 GB GPU.

Use these two files as governing inputs:

- `forecasting-evaluation-report.md`
- `agent-evaluation-spec.yaml`

## Inputs

Provide or resolve:

```text
BASE_COMMIT=<current champion or approved baseline>
CANDIDATE_COMMIT=<revision under evaluation>
DATABASE_SNAPSHOT=<immutable local snapshot>
SOURCE_SNAPSHOT=<immutable historical source snapshot, when applicable>
TARGET_GPU=<GPU model with 12 GB VRAM>
```

## Non-negotiable rules

1. All model inference must remain local. Do not use hosted LLM or inference APIs.
2. Ollama may extract and summarize evidence but may not generate or alter the final numeric probability.
3. Historical features and source evidence must be strictly earlier than each prediction cutoff.
4. Use event-grouped walk-forward evaluation. Do not use randomly shuffled cross-validation for promotion.
5. Use proper probability metrics: log loss, Brier score, calibration slope/intercept, and reliability.
6. Do not tune against the final holdout.
7. Do not claim improvement without reproducible artifacts and measured evidence.
8. A failed hard gate requires `reject` or `blocked`.
9. Missing evidence is `blocked`, not `passed`.
10. Preserve the existing champion unless the candidate satisfies the promotion contract.

## Required workflow

### 1. Resolve and record scope

Record:

- Repository and branch.
- Base and candidate commit hashes.
- Changed prediction-related files.
- Database and source snapshot hashes.
- Hardware, drivers, GPU, and VRAM.
- Ollama runtime image digest.
- Local model names and digests.
- Feature schema, prompt, and extraction schema versions.

### 2. Reproduce the baseline

Build the baseline from scratch. Do not use undocumented artifacts.

Produce:

- Dataset manifest.
- Temporal fold manifest.
- Baseline model artifacts.
- Baseline calibration artifact.
- Baseline metric and runtime reports.

If the baseline cannot be reproduced, return `blocked` and identify the missing requirements.

### 3. Inspect changes for leakage and invalid evaluation

Explicitly inspect:

- Historical career-stat queries.
- Current fighter profile fields used in past rows.
- Source publication and fetch timestamps.
- Prediction cutoff propagation.
- Train, validation, calibration, and holdout boundaries.
- Feature preprocessing fit scope.
- Duplicate or future event records.
- LLM prompt or schema changes that could change numeric predictions.

### 4. Run hard gates before performance comparison

Run all required suites defined in the YAML specification:

- Point-in-time data tests.
- Future-data mutation tests.
- Event-fold isolation.
- Corner-swap invariance.
- Source cutoff and evidence-offset validation.
- Numeric independence from Ollama.
- Artifact-lineage validation.
- Numeric-only fallback.
- Full-event 12 GB GPU capacity test.

Stop promotion analysis when any hard gate fails.

### 5. Build candidate artifacts from scratch

Ensure the candidate does not reuse incompatible baseline caches, preprocessing, prompts, model artifacts, stackers, or calibrators.

Record all artifact hashes.

### 6. Run identical temporal evaluation

Compare baseline and candidate on the same frozen event-grouped temporal folds.

Report:

- Fold-by-fold log loss.
- Fold-by-fold Brier score.
- Calibration slope and intercept.
- Expected calibration error.
- Accuracy and ROC-AUC.
- Event-bootstrap confidence intervals.
- Candidate-minus-baseline differences.

### 7. Evaluate method and round models

When changed, report:

- Multiclass log loss.
- Multiclass Brier score.
- Macro F1.
- Per-class precision and recall.
- Round ranked probability score.
- Joint-distribution consistency.

### 8. Evaluate Ollama extraction

When prompts, schemas, models, retrieval, source handling, or cache behavior changed, run the frozen extraction golden set.

Report:

- Schema validity.
- Fighter assignment accuracy.
- Signal precision, recall, and F1.
- High-severity precision.
- Unsupported-signal rate.
- Evidence exact-match and offset validity.
- Negation and temporal-validity accuracy.
- Deterministic-repeat agreement.
- P50/P95 latency and tokens.

Confirm that publisher, URL, and publication timestamps come from the orchestrator rather than the LLM.

### 9. Profile the 12 GB GPU runtime

Measure:

- Full GPU residency.
- Peak VRAM.
- CPU offload.
- GPU queue wait.
- Model load duration.
- Extraction P50/P95 latency.
- Tokens per second.
- Full-event-card duration.
- OOM, retry, and fallback counts.

Use one GPU-generation worker unless measured evidence supports higher concurrency.

### 10. Analyze slices and regressions

At minimum analyze:

- Weight class.
- Main event status.
- Three-round versus five-round bouts.
- Debutants.
- Low-history fighters.
- Incomplete feature records.
- Short-notice fights.
- Weight-class changes.
- Confidence bands.
- With versus without qualitative-source coverage.

Do not hide a material slice regression behind aggregate improvement.

### 11. Apply the promotion decision

Return exactly one verdict:

- `promote`
- `shadow`
- `reject`
- `blocked`

Use the decision rules and thresholds in `agent-evaluation-spec.yaml`.

## Required outputs

Create:

```text
evaluation-summary.md
scorecard.json
metric-comparison.csv
calibration-report.json
temporal-fold-results.csv
slice-results.csv
hard-gates.json
runtime-profile.json
artifact-manifest.json
extraction-eval.json, when applicable
```

## Required summary format

```markdown
# Candidate Evaluation

## Verdict
promote | shadow | reject | blocked

## Executive finding
State whether the candidate is a verified improvement, directional improvement, regression, or unevaluable. Cite measured evidence.

## Scope
- Base commit:
- Candidate commit:
- Hardware:
- Database snapshot:
- Source snapshot:
- Fold manifest:

## Hard gates
| Gate | Result | Evidence |

## Metric comparison
| Metric | Baseline | Candidate | Delta | Confidence interval | Decision |

## Calibration
- Slope:
- Intercept:
- ECE:
- Reliability summary:

## Slice regressions
| Slice | Metric | Baseline | Candidate | Risk |

## Extraction quality
| Metric | Baseline | Candidate | Gate |

## Runtime
| Metric | Baseline | Candidate | Limit |

## Reproducibility
- Artifact manifest complete:
- Digests recorded:
- Independent rerun match:

## Causal interpretation
Explain what caused the observed change: data, leakage correction, feature changes, model changes, calibration, source coverage, extraction behavior, or variance.

## Risks and limitations

## Required follow-up
```

## Completion standard

Do not finish with a recommendation unsupported by the generated evidence. Clearly distinguish verified facts, statistical uncertainty, unavailable data, and engineering judgment.
