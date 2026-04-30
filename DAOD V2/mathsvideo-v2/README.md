# Mathsvideo V2

**Interactive Maths Lesson Engine — from deterministic scenes to full animated video generation.**

Manim + Remotion video pipeline, fine-tuned Qwen2.5-Math lesson planner, Kokoro streaming TTS, Whisper voice input, Qwen2.5-VL homework mode.

---

## Repo layout

```
mathsvideo-v2/
├── frontend/           React + Remotion Player
├── backend/            API gateway, lesson service, worker orchestration
├── manim-templates/    Scene templates + spec-to-script engine + Docker
├── data-pipeline/      YouTube scraper, transcript transforms, curriculum refs
├── training/           Golden examples, LoRA configs, benchmarks, eval
├── prompts/            System prompts for every LLM role
├── schemas/            Canonical JSON Schemas (contract every agent codes to)
├── docs/               Architecture, agent briefs, API contracts, progress
├── tests/              e2e, schema, render, integration
└── scripts/            Utility scripts
```

## Source of truth

`v2_technical_blueprint.pdf` (at project parent level) is the single source of truth for design decisions. Every schema, prompt template, scene type, and service boundary in this repo was extracted from it.

## Getting started

1. Copy `.env.example` to `.env` and fill in what's needed for your role.
2. Open `docs/agent-briefs/` and read the brief matching your agent role.
3. Check `docs/progress/build-tracker.md` for your current phase.
4. Log blockers in `docs/progress/blockers.md` as you hit them.

## Agent roles (summary)

| Role | Agents | Brief |
|---|---|---|
| Architecture & Prompts | Grok, DeepSeek | `BRIEF-prompts.md` |
| Backend | Claude Code, Codex | `BRIEF-backend.md` |
| Frontend | Claude Code, Gemini | `BRIEF-frontend.md` |
| Manim Templates | Gemini, Claude Code | `BRIEF-manim.md` |
| Data & Training | Gemini, DeepSeek | `BRIEF-training.md` |
| QA & Integration | Copilot, Claude Code | `BRIEF-qa.md` |

## Build phases

5 phases over ~6 weeks. See `docs/progress/build-tracker.md` for detail.

1. **Foundation** (W1-2) — monorepo, DB, core Manim templates, Kokoro
2. **Player Integration** (W2-3) — Remotion, timeline, interruption panel
3. **Training & Voice** (W3-4) — scraper, LoRA fine-tune, Whisper STT
4. **Polish & Export** (W4-5) — export pipeline, homework mode, scene library
5. **Alpha Release** (W5-6) — benchmark run, load test, staging, ship
