# BRIEF — Backend Implementation

**For:** Claude Code, Codex
**Split:** Claude Code owns architecturally complex services (lesson orchestration, interruption engine, timeline management). Codex owns straightforward wrappers (TTS, STT, asset management).
**Excludes:** Frontend React/Remotion work, training pipeline, YouTube scraper, Manim template internals.

---

## Your north star

Every API response the backend emits must validate against a schema in `schemas/`. Every LLM output must be validated before it leaves the service boundary. If the schema says it's wrong, it's wrong — retry or fail visibly, do not repair silently.

## Service topology (blueprint §3.3)

| Service | Responsibility |
|---|---|
| API Gateway | Session management, routing, auth, rate limiting |
| Lesson Service | Lesson planning, segment generation, interruption handling — calls Qwen |
| Manim Render Workers | Pool that executes Manim scripts (owned by Manim track; you wire the queue) |
| TTS Service | Kokoro wrapper — accepts text, returns audio + word timestamps |
| Vision Service | Qwen2.5-VL wrapper — accepts image, returns structured problem extraction |
| STT Service | Whisper wrapper — WebSocket streaming transcript |
| Composition Service | Remotion — combines video+audio+subtitles into playable units |
| Export Service | Remotion server-side render → final MP4 |
| Asset Storage | S3-compatible object store |
| Database | PostgreSQL |
| Job Queue | Redis / BullMQ |

## API endpoints (blueprint §13)

| Endpoint | Responsibility |
|---|---|
| `POST /api/session/create` | Create session with onboarding context |
| `POST /api/lesson/plan` | Generate lesson plan from topic + context |
| `POST /api/segment/generate` | Generate segment scene specs and queue render jobs |
| `GET  /api/segment/:id/status` | Poll render status for a segment |
| `GET  /api/segment/:id/assets` | Get video/audio URLs for rendered segment |
| `POST /api/interrupt` | Submit interruption, generate branch, queue branch renders |
| `GET  /api/session/:id/timeline` | Full frame-level timeline state |
| `POST /api/tts/generate` | TTS audio for a segment's narration |
| `POST /api/homework/analyze` | Submit homework image for problem extraction |
| `POST /api/export/create` | Queue final video export job |
| `GET  /api/export/:id/status` | Poll export job status |
| `GET  /api/export/:id/download` | Download completed export |
| `WS   /api/stt/stream` | WebSocket streaming speech-to-text |

## Database schema (blueprint §12)

Tables: `users`, `sessions`, `lesson_plans`, `segments`, `interruptions`, `timeline_state`, `render_jobs`, `exports`, `generation_logs`, `training_data`, `video_transcripts`. Full column list in the blueprint; encode in `backend/src/db/schema.sql`.

## Qwen client contract

- Endpoint: `QWEN_API_URL` (vLLM, OpenAI-compatible).
- LoRA adapter: `QWEN_LORA_ADAPTER` loaded via vLLM `--lora-modules`.
- Request temperature: ≤ 0.2 for structured output; ≤ 0.4 for narration variation.
- **Validate every response** against `schemas/lesson-plan-response.schema.json` (for `/lesson/plan`) or `schemas/interruption-response.schema.json` (for `/interrupt`). On parse fail: retry once with "return only JSON" prefix; on second fail return 502 to caller and log to `generation_logs`.
- Log every call: `prompt_version`, `model`, `latency_ms`, `parse_success`, `tokens_in`, `tokens_out`.

## Kokoro TTS wrapper contract

- Inputs: `{text, voice, lang_code, speed, stream}`.
- Output: stream of audio chunks + final `word_timestamps` array `[{word, start_ms, end_ms}, ...]`.
- Endpoint: internal HTTP `POST /tts/generate` streaming.
- Default: `lang_code=b`, `voice=bf_emma`, `speed=1.0` (from `.env`).
- Word timestamps are mandatory — they drive subtitle sync in the Remotion composition.

## Manim worker job format

Jobs are pushed to BullMQ queue `render`. Job payload:
```json
{
  "job_id": "uuid",
  "segment_id": "seg_003",
  "session_id": "sess_456",
  "scene_type": "equation_solve_steps",
  "visual": { ... },          // must validate against schemas/scene-types/<scene_type>.json
  "duration_target_sec": 15,
  "resolution": "1280x720",
  "fps": 30,
  "priority": "normal"        // "high" for interruption branches
}
```
Worker writes `render_jobs` row transitions: `queued → running → succeeded | failed`. On success, update `segments.video_asset_url`.

## Queue design

- Queue `render` (Manim) — concurrency per worker = `QUEUE_RENDER_CONCURRENCY` (default 3).
- Queue `tts` — Kokoro. Concurrency = `QUEUE_TTS_CONCURRENCY` (default 5).
- Queue `export` — Remotion server-side render. Concurrency = 1.
- Dead-letter handling: retry 2x with exponential backoff, then mark job failed and emit an alert.
- **Priority lane:** interruption-branch jobs jump the queue. Use BullMQ priorities or a separate queue.

## Latency targets (blueprint §11.3)

- Topic submit → first audio: ≤ 5s (hard limit 8s)
- Topic submit → first video frame: ≤ 10s (hard 15s)
- Interruption → first branch audio: ≤ 3s (hard 5s)
- Interruption → first branch video: ≤ 15s (hard 20s)
- Scrub/replay over existing content: instant (< 100ms)

Your service boundaries need timeout/abort wiring to meet these.

## Files you own

```
backend/
├── src/
│   ├── routes/              # One file per endpoint group
│   ├── services/
│   │   ├── lesson.ts        # Claude Code — orchestration + Qwen client
│   │   ├── interruption.ts  # Claude Code — branch planner
│   │   ├── timeline.ts      # Claude Code — timeline graph operations
│   │   ├── tts.ts           # Codex — Kokoro wrapper
│   │   ├── stt.ts           # Codex — Whisper WS
│   │   ├── vision.ts        # Codex — Qwen2.5-VL wrapper
│   │   ├── export.ts        # Codex — Remotion render job orchestration
│   │   └── assets.ts        # Codex — object storage client
│   ├── db/
│   │   ├── schema.sql
│   │   └── migrations/
│   ├── workers/             # Queue consumers (Manim results, TTS results, export)
│   ├── config/              # env loader, feature flags
│   └── types/               # Generated TS types from schemas/
├── package.json
└── Dockerfile               # You create this
```

## Do not

- Do not invent endpoints not listed in §13 without writing an ADR first (`docs/decisions/`).
- Do not have the LLM return free-form strings — always schemas.
- Do not do any Remotion composition work here; that's the Composition Service owned partially by you but UX stays in frontend.
- Do not embed prompts in code. Read from `prompts/<role>/system.md` at boot and version-tag them.

## Success criteria

- All 13 endpoints live and schema-valid.
- All 11 DB tables created, migrated, indexed.
- Benchmark run (20 prompts in `training/data/benchmarks/benchmark-prompts.json`) returns ≥ 95% schema validity and meets §11.3 latency targets at P90.
