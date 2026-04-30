# Build Tracker

Every task from every agent role, organised by the 5 phases from blueprint §17. Check boxes as work completes. Cowork updates this daily.

**Last updated:** 2026-04-19 (initial scaffold)

---

## Phase 1 — Foundation (Week 1-2)

### Backend
- [ ] Implement database schema v2 (`backend/src/db/schema.sql`)
- [ ] Wire migration runner and baseline migration
- [ ] Implement `POST /api/session/create`
- [ ] Implement `POST /api/lesson/plan` (calls Qwen, validates against `lesson-plan-response.schema.json`)
- [ ] Implement `POST /api/segment/generate` + render job enqueue
- [ ] Stand up BullMQ queue wiring with Redis
- [ ] Structured logging (pino) + generation_logs table writes

### Manim
- [ ] Docker image with Manim + FFmpeg + LaTeX (`manim-templates/docker/Dockerfile`)
- [ ] Template engine skeleton (spec JSON → Python script)
- [ ] Template: `title_intro`
- [ ] Template: `equation_solve_steps`
- [ ] Template: `graph_function_plot`
- [ ] Template: `worked_example`
- [ ] Template: `recap_summary`
- [ ] Manim worker pulls from queue, uploads MP4 to object storage

### TTS
- [ ] Kokoro wrapper service with streaming output (`KOKORO_LANG_CODE=b`, voice `bf_emma`)
- [ ] Word-level timestamp extraction (timestamped ONNX variant)
- [ ] `POST /api/tts/generate` endpoint

### Training
- [ ] Initial 30–50 golden examples written (5 seeded by Cowork — see `training/data/golden-examples/`)
- [ ] Prompt-engineered baseline (no LoRA yet): measure schema validity on benchmark-prompts

### QA
- [ ] Schema validator harness wired in CI (every file in `schemas/` loads and validates a known-good fixture)

---

## Phase 2 — Player Integration (Week 2-3)

### Frontend
- [ ] React app shell + routing
- [ ] Onboarding questionnaire (year group, curriculum, confidence)
- [ ] `TopicInput` component
- [ ] Remotion Player integration in `LessonPlayer`
- [ ] Dynamic `RemotionComposition` built from segment list
- [ ] Timeline slider with frame-level scrub + branch markers
- [ ] Subtitle overlay with word-level sync
- [ ] Interruption panel (typed-only for Phase 2)
- [ ] Loading states, progressive playback

### Backend
- [ ] `GET /api/segment/:id/status` polling
- [ ] `GET /api/segment/:id/assets`
- [ ] `POST /api/interrupt` (typed only)
- [ ] `GET /api/session/:id/timeline` returning `timeline-state.schema.json`

### Manim
- [ ] Template: `misconception_alert`
- [ ] Template: `definition_card`

---

## Phase 3 — Training & Voice (Week 3-4)

### Data Pipeline
- [ ] YouTube scraper: search, metadata, transcript extractor
- [ ] Quality filter with channel whitelist (see `data-pipeline/curriculum/channel-whitelist.csv`)
- [ ] Topic tagger (LLM-classified transcripts)
- [ ] Transcript → training-example transformer (uses `prompts/transcript-transformer/system.md`)
- [ ] At least 300 reviewed examples in `training/data/processed/`

### Training
- [ ] LoRA training config (`training/configs/qwen_math_lora.yaml`)
- [ ] Fine-tune run on Qwen2.5-Math-7B (rank 16, alpha 32, dropout 0.05, lr 2e-4, 3-5 epochs)
- [ ] Evaluate fine-tuned model on benchmark-prompts: schema validity ≥ 95%, scene compatibility = 100%

### STT
- [ ] Whisper service (faster-whisper) with WebSocket streaming `/api/stt/stream`
- [ ] Math normalization layer (rule-based)
- [ ] Wire voice input into `TopicInput` and `InterruptPanel`

---

## Phase 4 — Polish & Export (Week 4-5)

### Export
- [ ] Remotion server-side render job
- [ ] `POST /api/export/create` + `/status` + `/download`
- [ ] Subtitle file (SRT) generation from word-level timestamps
- [ ] Transcript (TXT) generation
- [ ] Summary notes doc (optional)

### Homework Mode
- [ ] Qwen2.5-VL integration (`POST /api/homework/analyze`)
- [ ] `HomeworkUpload` component with question selection UI
- [ ] Hand-off into lesson engine as `lesson_mode = explain_problem`

### Manim — remaining scene templates
- [ ] `equation_balance`
- [ ] `graph_transformation`
- [ ] `geometry_construction`
- [ ] `geometry_proof`
- [ ] `number_line_operation`
- [ ] `fraction_visual`
- [ ] `table_reveal`
- [ ] `comparison_split`

### Optimisation
- [ ] Latency audit against §11.3 budget
- [ ] Pre-render first 2–3 segments before playback starts
- [ ] Background-render lookahead while playing

---

## Phase 5 — Alpha Release (Week 5-6)

- [ ] Run all 20 benchmark prompts end-to-end; log schema validity, render success, latency P50/P90/P99
- [ ] Extend benchmark set to 50 as described in §15.3
- [ ] Load test: N concurrent sessions (determine N with backend team)
- [ ] Deploy to staging
- [ ] Limited user testing (5–10 students)
- [ ] Fix blocker-tier issues only; defer non-blockers to post-alpha
- [ ] Ship V2 alpha

---

## Cross-cutting (all phases)

- [ ] `docs/progress/blockers.md` kept current
- [ ] `docs/progress/daily-standup.md` used daily
- [ ] New ADRs written for any architecture decision not covered by the blueprint (`docs/decisions/`)
- [ ] Schema changes go through the contracts review (all schemas in `schemas/` are the source of truth; no per-agent copies)
