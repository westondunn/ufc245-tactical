---
name: implement-ollama-sdk-provider
description: Integrate the official Ollama Python SDK into the local UFC LLM pipeline with schema-constrained Stage 1 extraction, serialized GPU access, resource cleanup, and tests.
agent: agent
argument-hint: "Implement the provider-first SDK migration. Add any local constraints after the slash command."
---

# Implement the Ollama SDK provider migration

You are working in the `westondunn/ufc245-tactical` repository. Implement the first production-safe slice of the Ollama SDK integration.

## Read before editing

Inspect and follow these repository instructions and current implementations:

- [AGENTS.md](../../AGENTS.md)
- [CLAUDE.md](../../CLAUDE.md)
- [Copilot instructions](../copilot-instructions.md)
- [Review and testing instructions](../instructions/review-testing.instructions.md)
- [Current provider abstraction](../../llm-pipeline/providers/base.py)
- [Current Ollama provider](../../llm-pipeline/providers/ollama.py)
- [Configuration](../../llm-pipeline/config.py)
- [Pipeline orchestrator](../../llm-pipeline/pipeline/orchestrator.py)
- [Stage 1 extraction](../../llm-pipeline/pipeline/extract.py)
- [Stage 2 reasoning](../../llm-pipeline/pipeline/reason.py)
- [Provider tests](../../llm-pipeline/tests/test_providers.py)
- [Extraction tests](../../llm-pipeline/tests/test_extract.py)
- [Configuration tests](../../llm-pipeline/tests/test_config.py)
- [CLI lifecycle](../../llm-pipeline/cli.py)
- [Scheduler lifecycle](../../llm-pipeline/scheduler.py)
- [FastAPI trigger lifecycle](../../llm-pipeline/app.py)
- [Python dependencies](../../llm-pipeline/pyproject.toml)
- [Environment example](../../.env.local.example)

## Preflight safety

1. Run `git status --short` and identify the current branch.
2. Do not discard, overwrite, stash, or reformat unrelated user changes.
3. If the working tree is clean and the current branch is `main`, create:
   `predictions/ollama-sdk-provider`
4. If the working tree is not clean, remain on the current branch and clearly report the condition before editing.
5. Do not commit, push, open a PR, or modify GitHub state unless explicitly asked.

## Goal

Replace the hand-built Ollama `/api/chat` HTTP integration with the official Python SDK while preserving the existing provider abstraction and pipeline behavior.

The completed slice must add:

- Official `ollama.Client` usage inside `llm-pipeline/providers/ollama.py`
- Pydantic/JSON-schema-constrained output support
- A provider-level single-slot GPU semaphore by default
- Explicit SDK client cleanup
- Environment-backed timeout, context, keep-alive, and GPU-concurrency settings
- Typed Stage 1 soft-signal extraction
- Deterministic unit tests that require no live Ollama server or GPU
- Optional documented live-smoke instructions

## Non-goals

Do not do any of the following in this PR:

- Do not change logistic regression, CatBoost, Bradley–Terry, calibration, or other numeric forecasting behavior.
- Do not allow Ollama to gain additional control over winner probability, method probability, or round probability.
- Do not redesign Stage 2 reasoning.
- Do not migrate the whole pipeline to async.
- Do not add Ollama SDK calls to the Node/Express application.
- Do not add agentic tool-calling loops.
- Do not automatically pull or delete models at runtime.
- Do not redesign the SQLite source/signal schema.
- Do not change scrapers, prediction sync contracts, Railway APIs, or frontend behavior.
- Do not pin the Ollama Docker server image in this PR; identify that as a separate follow-up.
- Do not perform broad formatting or unrelated dependency upgrades.

## Required implementation

### 1. Dependency pin

In `llm-pipeline/pyproject.toml`:

- Replace `ollama==0.4.7` with the exact tested pin `ollama==0.6.2`.
- Keep all other dependency changes out of scope unless required for compatibility.
- If dependency resolution proves that `0.6.2` is incompatible, stop and report the evidence before choosing another version.

### 2. Provider abstraction

Update `llm-pipeline/providers/base.py` without breaking Anthropic or OpenAI providers.

Add:

- A generic type variable bound to `pydantic.BaseModel`
- A non-abstract `chat_typed(...)` fallback that:
  - Calls the existing `chat_json(...)`
  - Validates through `response_type.model_validate(...)`
  - Raises `MalformedJSONError` on Pydantic validation failure
- A default no-op `close()` method
- Optional provider-specific exceptions only when they improve error classification without forcing unrelated callers to change

Keep `chat_text(...)` and `chat_json(...)` backward compatible.

### 3. Official Ollama SDK adapter

Refactor `llm-pipeline/providers/ollama.py`.

Requirements:

- Import and use `ollama.Client` and `ollama.ResponseError`.
- Do not issue raw `httpx.post()` calls to `/api/chat`.
- Accept an injected SDK client in the constructor for isolated unit testing.
- Construct the default SDK client with:
  - `host=base_url`
  - an explicit timeout
  - conservative `httpx.Limits`
- Keep the existing `chat_text(...) -> str` contract.
- Pass:
  - `model`
  - system and user messages
  - `stream=False`
  - configured `keep_alive`
  - bounded `num_ctx`
  - bounded `num_predict`
  - caller-supplied temperature
- Reject empty response content with a classified provider error.
- Normalize SDK connection and response failures without exposing prompt text or secrets.
- Implement `close()` and close only clients owned by the provider. An injected test/external client must not be closed unless ownership was explicitly transferred.
- Do not call `pull()` automatically.

### 4. Schema-constrained typed output

Override `chat_typed(...)` in `OllamaProvider`.

Requirements:

- Accept `response_type: type[T]`, where `T` is a Pydantic model.
- Generate `schema = response_type.model_json_schema()`.
- Pass that schema through Ollama's `format` parameter.
- Include a compact serialized copy of the schema in the user instruction to ground the response.
- Default typed calls to `temperature=0`.
- Validate `response.message.content` with `response_type.model_validate_json(...)`.
- Raise `MalformedJSONError` on validation failure.
- Do not perform a second LLM "repair" request for SDK-structured output.
- Preserve the generic `chat_json()` fallback for non-Ollama providers and existing callers.

### 5. GPU serialization

Add a provider-level bounded semaphore.

Requirements:

- Default concurrency: `1`
- All Ollama generation calls, including `chat_text()` and `chat_typed()`, must acquire the same semaphore.
- Validate that configured concurrency is at least `1`.
- HTTP scraping and CPU feature work must remain eligible for existing concurrency.
- Do not globally serialize the entire fight pipeline.

### 6. Configuration

Extend `llm-pipeline/config.py` and `.env.local.example` with:

```text
OLLAMA_TIMEOUT_SECONDS=180
OLLAMA_CONTEXT_LENGTH=4096
OLLAMA_KEEP_ALIVE=15m
OLLAMA_GPU_CONCURRENCY=1
```

Requirements:

- Parse and validate positive numeric values.
- Keep safe defaults when variables are absent.
- Pass these settings through `get_provider(...)`.
- Never log secrets.
- Do not change `MAX_CONCURRENT_FIGHTS`; GPU serialization is a separate provider concern.

### 7. Typed Stage 1 extraction contract

Create `llm-pipeline/pipeline/contracts.py` or an equivalently clear domain-contract module.

Define Pydantic models that preserve the existing Stage 1 contract:

```text
ExtractionResult
  fighters_mentioned: list[str]
  signals: list[ExtractedSignal]
  irrelevant: bool

ExtractedSignal
  fighter: str | None
  type: controlled signal enum
  severity: integer 0..3
  evidence: non-empty string, maximum 1000 characters
```

Controlled signal types must remain:

```text
injury
camp_change
weight_cut_concern
motivation
style_note
recent_form_note
layoff
personal
other
```

Validation rules:

- Maximum eight signals
- An irrelevant result must contain no signals
- Evidence must be non-empty
- Severity must be within `0..3`
- Do not add new storage fields or change database schemas in this PR

Update `StageOneExtractor` to call `provider.chat_typed(...)` with `ExtractionResult`.

Preserve:

- Current cache behavior
- Current 8,000-character body cap
- Current storage mapping
- Current return values
- Current failure behavior unless a test demonstrates that a safer classified failure is needed

Do not migrate Stage 2 to typed output in this PR.

### 8. Resource lifecycle

Ensure SDK clients are closed in all provider-owning execution paths.

Preferred design:

- Add `Orchestrator.close()`
- Add synchronous context-manager support to `Orchestrator`
- Use the context manager in:
  - `llm-pipeline/cli.py`
  - `llm-pipeline/scheduler.py`
  - `llm-pipeline/app.py`

Requirements:

- Cleanup must execute on success and exception paths.
- Mock or externally injected providers must continue to work.
- Do not convert FastAPI routes or the orchestrator to async for this change.

### 9. Tests

Use fake SDK clients and response objects. Unit tests must not require:

- A running Ollama server
- A downloaded model
- Network access
- An NVIDIA GPU

Add or update tests for:

#### Provider behavior

- `chat_text()` calls the SDK with the configured model, messages, options, context, token limit, and keep-alive.
- `chat_text()` returns `response.message.content`.
- Empty content is rejected.
- SDK `ResponseError` is classified.
- Connection errors are classified.
- The injected client path works.
- Owned clients close exactly once.
- Injected clients are not unexpectedly closed.

#### Typed responses

- `chat_typed()` passes the Pydantic JSON Schema through `format`.
- `chat_typed()` validates a valid response.
- Invalid schema output raises `MalformedJSONError`.
- Typed calls default to temperature `0`.
- No repair call is made after schema-validation failure.

#### Concurrency

Create a deterministic thread-based fake client test that records active calls.

Acceptance condition:

```text
maximum simultaneous Ollama SDK calls == configured GPU concurrency
```

The default test must prove the maximum is `1`.

#### Configuration

- Defaults are correct.
- Environment overrides are parsed.
- Zero or negative timeout, context length, or GPU concurrency is rejected.
- `get_provider()` passes the configuration into `OllamaProvider`.

#### Stage 1 extraction

- Existing extraction and cache tests still pass.
- The test provider supports `chat_typed()`.
- Invalid signal type, severity, irrelevant-with-signals, and empty evidence are rejected by Pydantic.
- Storage output remains backward compatible.

#### Lifecycle

- CLI, scheduler, and API trigger paths close the orchestrator/provider when the run ends.
- Exceptions also invoke cleanup.

### 10. Documentation

Update `llm-pipeline/README.md` with a small "Ollama SDK integration" section that documents:

- The four new environment variables
- Unit tests do not require Ollama
- A live smoke test requires the configured model to already exist
- The pipeline never auto-pulls models
- GPU generation is serialized by default
- Stage 1 uses structured outputs
- Stage 2 numeric behavior is unchanged

Do not rewrite unrelated README sections.

## Verification

Run targeted checks first.

From `llm-pipeline/`:

```bash
python -m pip install -e ".[dev]"
python -m pytest \
  tests/test_providers.py \
  tests/test_config.py \
  tests/test_extract.py \
  tests/test_orchestrator.py
```

Then run the complete local pipeline suite:

```bash
python -m pytest
```

From the repository root:

```bash
docker compose config
docker compose build llm-pipeline pipeline-shell
```

Run a live Ollama smoke test only when:

- Docker/NVIDIA runtime is available
- `.env.local` contains valid values
- The configured model is already installed
- No secret values will be printed

A missing GPU, model, network route, `MAIN_APP_URL`, or service key must be reported as an environmental limitation, not hidden or worked around with fabricated data.

## Acceptance criteria

The change is acceptable only when all of the following are true:

1. `llm-pipeline/providers/ollama.py` contains no raw `/api/chat` HTTP request.
2. Only the provider layer imports the Ollama SDK.
3. Existing `chat_text()` and `chat_json()` callers remain compatible.
4. Stage 1 extraction uses Pydantic schema-constrained output.
5. Stage 2 and numeric forecast behavior are unchanged.
6. No more than one Ollama request executes concurrently by default.
7. Unit tests require no live Ollama runtime.
8. SDK clients are explicitly closed.
9. No model is automatically pulled.
10. New configuration has validated defaults.
11. Targeted and complete pipeline tests pass.
12. Docker Compose configuration and builds remain valid.
13. No unrelated files or formatting are changed.

## Required final response

After implementation, report:

### Summary
What changed and why.

### Files changed
One line per file with its responsibility.

### Verification
Every command run and its result.

### Acceptance-criteria matrix
For each acceptance criterion, report `PASS`, `FAIL`, or `BLOCKED`, with evidence.

### Risks and tradeoffs
Call out SDK compatibility, lifecycle, concurrency, and structured-output limitations.

### Environmental blockers
List anything not executable locally, without claiming success.

### Recommended follow-up PRs
Keep these separate from this implementation:

1. Pin and qualify the Ollama server Docker image.
2. Add immutable source snapshots and evidence offsets.
3. Move Stage 2 to narrative-only output.
4. Add local embedding-based article chunk retrieval.
5. Add extraction telemetry and golden-set evaluation.

Do not claim completion if tests were skipped or failed.
