# BRIEF — QA & Integration

**For:** Copilot (inline test writing, boilerplate), Claude Code (integration + e2e)
**Excludes:** Implementation of features being tested.

---

## Your north star

Every layer of V2 is testable — schemas, prompts, render, full pipeline. If a check can be automated, it must be automated. The benchmark run is the single gate between a model version and production.

## Test categories

### 1. Schema validation (`tests/schema-validation/`)

- Every file in `schemas/` must parse as valid JSON Schema (draft 2020-12).
- For every schema, a fixture pair: known-good example passes, known-bad example fails.
- Covers: all 7 top-level schemas + all 15 scene-type schemas.
- Runs on every PR.

### 2. Render tests (`tests/render/`)

- One fixture per Manim scene template (`manim-templates/tests/`).
- Input: a `visual` payload JSON from `schemas/scene-types/<scene_type>.json`.
- Expected: MP4 produced, duration within ±1.5s of target, frame count matches fps × duration, no Manim errors.
- Snapshot-based: compare first-frame hash and last-frame hash for regression detection (allow a tiny perceptual delta).

### 3. End-to-end (`tests/e2e/`)

- Spin up the full `docker-compose` stack.
- For each of 3 smoke prompts (Y7, Y9, Y11):
  1. `POST /api/session/create`
  2. `POST /api/lesson/plan`
  3. Poll segment rendering to completion
  4. Fetch timeline state
  5. Assert timeline validates against `schemas/timeline-state.schema.json`
  6. Submit an interruption → assert branch renders
  7. Submit an export request → assert MP4 downloadable

### 4. Integration (`tests/integration/`)

- Queue-level: enqueue a render job, assert a worker consumes and produces output.
- DB-level: lesson-plan write → read round-trips preserve all fields.
- TTS: narration text in → audio + word_timestamps out, timestamps monotonic.

## Benchmark set structure

File: `training/data/benchmarks/benchmark-prompts.json`. 20 items, 5 year groups × 4 topics each (approximately).

Every benchmark run produces a report at `training/eval/reports/<run_id>.md` with:

| Metric | Target |
|---|---|
| Schema validity rate | ≥ 95% |
| Scene-type compatibility | 100% |
| Render success rate | ≥ 95% |
| Timeline consistency | 100% |
| Topic-submit → first audio (P90) | ≤ 5 s |
| Topic-submit → first video (P90) | ≤ 10 s |
| Interruption → first branch video (P90) | ≤ 15 s |
| Math correctness (manual, sampled N=10) | ≥ 9/10 |

## Latency targets (blueprint §11.3)

| User action | Acceptable | Hard limit |
|---|---|---|
| Topic submit → first audio | 3-5 s | 8 s |
| Topic submit → first video frame | 5-10 s | 15 s |
| Interruption → first branch audio | 2-3 s | 5 s |
| Interruption → first branch video | 8-15 s | 20 s |
| Scrub/replay over existing content | < 100 ms | 200 ms |
| Export request → download ready | 30-120 s | 5 min |
| Homework image → problem extraction | 3-5 s | 10 s |

## Smoke test checklist (pre-deploy)

Run before every staging/prod deploy:

- [ ] Schema validation suite green
- [ ] All 15 Manim templates render their fixtures
- [ ] Kokoro produces audio + timestamps for a short narration
- [ ] Whisper WS accepts a 5-second clip and returns a transcript
- [ ] Full e2e for Y7 smoke prompt passes within latency budget
- [ ] Benchmark run: ≥ 95% schema validity, ≥ 95% render success
- [ ] docker-compose up from clean volumes succeeds
- [ ] DB migrations apply to empty DB without errors
- [ ] `.env.example` parses (no undefined references in compose)

## Tools & conventions

- Test runner: backend/frontend each pick one (suggest vitest for both) and document in `docs/testing/`.
- Python (Manim): pytest.
- Coverage gate: start at 60% lines for new code, tighten to 80% in Phase 4.
- Flake policy: quarantine a flaky test within 24h of detection; fix within a week or delete it (with an ADR).

## Files you own

```
tests/
├── e2e/                    # Docker-compose-backed end-to-end
├── schema-validation/      # JSON Schema fixture pairs
├── render/                 # Manim render snapshot tests
└── integration/            # Queue, DB, TTS/STT wiring

docs/testing/               # Test strategy docs per layer
```

## Do not

- Do not mutate the schema files from tests. If a test requires a new schema shape, raise it as a blocker and coordinate with the Architecture & Prompts brief.
- Do not skip a failing benchmark to ship. If benchmarks regress, hold the deploy.
- Do not write test data that encodes a copyrighted question verbatim from an exam paper.

## Success criteria

- CI runs schema + render + integration tiers on every PR in < 10 min.
- E2E tier runs nightly against main; failures page the on-call rota.
- Benchmark gate blocks any model-version deploy that regresses any metric vs the previous adapter.
- All 20 benchmark prompts pass the §11.3 hard latency limits at P99.
