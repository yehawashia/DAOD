# DAOD
# DAOD — Interactive Maths Lesson Engine

## What is DAOD?

DAOD is an AI-powered interactive maths tutoring platform that generates personalised, narrated, animated lessons on demand. A student types a question or topic, and the system produces a full teaching experience — structured segments, voice narration, visual animations, and the ability to interrupt mid-lesson to ask follow-up questions, just like having a real tutor.

The core idea: the AI handles the intelligence (structuring explanations, adapting to the student's level, responding to interruptions), while a purpose-built rendering engine handles the presentation — turning dry text output into an engaging, visual, voice-driven lesson.

DAOD is built for UK maths curriculum (Key Stage 2–4), with onboarding that classifies each student by year group, confidence level, and exam board, so every lesson is scoped appropriately.

---

## V1 — Complete ✅

Version 1 is fully built and functional. It proves the core product loop end to end:

- **Project scaffold and architecture** — full monorepo structure with clear separation of concerns between frontend, backend, prompts, schemas, and rendering.
- **DSL schema** — a structured JSON-based Domain Specific Language that defines how lessons are planned, segmented, and rendered. Every lesson is a sequence of typed segments with scene specifications, narration scripts, and visual instructions.
- **LLM integration (Groq)** — the lesson planning engine uses Groq's Llama 3.3 70B behind an optimised system prompt to generate structured lesson plans as valid JSON. No fine-tuning yet — pure prompt engineering.
- **Text-to-speech (Kokoro)** — each segment's narration script is converted to natural-sounding audio with a teaching-friendly voice, synchronised to the visual playback.
- **Rendering engine** — a canvas/SVG-based renderer that takes scene specifications and animates them in real time: equations appearing step by step, graphs drawing themselves, text reveals timed to narration.
- **Frontend** — a React-based web interface where the student types a question, sees the lesson plan appear, and watches the animated lesson play with voice narration.
- **Interruption handler** — the student can pause mid-lesson, type a follow-up question ("wait, why did you flip the sign?"), and the system generates 1–2 branch segments addressing that specific confusion, inserts them into the timeline, and resumes the main lesson. This is the feature that makes it feel like a tutor rather than a video.

V1 deliberately kept the visual layer simple — animated SVG/canvas primitives rather than full video — to prove the interaction model worked before tackling the harder rendering problem.

---

## V2 — Planned

Version 2 is the next evolution. The core insight from V1 is that the AI itself is a commodity — what makes DAOD valuable is the **presentation layer**. V2 focuses entirely on making lessons feel alive.

### The direction

Rather than the heavy Manim video rendering pipeline originally scoped, V2 is pivoting toward a lighter, faster approach:

- **Animated handwriting** — instead of typed text, lesson content appears as if being handwritten in real time using SVG stroke animation. Think Khan Academy's original format — someone drawing on a dark screen while explaining — but fully automated.
- **Voice-text synchronisation** — word-level timestamps from TTS drive the handwriting animation, so each word appears exactly as the voice says it. The visual and audio are locked together.
- **Full-screen teaching canvas** — lessons take over the screen. Bold, big, alive. Not a chat bubble with text — an immersive teaching experience.
- **Section-based recording** — each section of the lesson is recorded as it plays. Students can rewind, replay, and scrub through the timeline.
- **Video export** — at the end of a lesson, the student can download the entire session (including any interruption branches) as a video file.
- **Homework mode** — snap a photo of a worksheet, the system extracts the questions using vision AI, and generates a step-by-step explanation through the same animated pipeline.
- **Mathematical notation** — proper rendering of fractions, square roots, Greek letters, and equations with the same handwriting animation style.

### Key architectural decisions still being finalised

- Visual rendering model (SVG stroke animation vs canvas-based drawing)
- Voice-text sync method (word-level timestamps vs chunk-based)
- Canvas style (dark background with light writing vs whiteboard)
- Recording and export approach (client-side capture vs server-side render)
- Mathematical notation strategy (KaTeX vs pre-rendered equation SVGs)

### The philosophy

Start with a fast, cheap LLM behind a strong system prompt. Fine-tuning only happens once the product works and specific failure modes are identified that prompting alone can't fix. Training is expensive — don't do it until there's evidence it's needed.

---

## Tech Stack

| Layer | V1 (Current) | V2 (Planned) |
|-------|-------------|--------------|
| LLM | Groq (Llama 3.3 70B) | Groq or fine-tuned model |
| TTS | Kokoro | Kokoro with word-level timestamps |
| Rendering | Canvas/SVG primitives | SVG stroke handwriting animation |
| Frontend | React | React with full-screen teaching canvas |
| Interruptions | Text-based branching | Text + voice input (Whisper) |
| Export | None | Downloadable video (MP4) |
| Homework | None | Vision AI (Qwen2.5-VL) image analysis |

---

## Status

**V1: Complete** — core loop works end to end. Lesson generation, narration, animation, and interruption branching all functional.

**V2: In planning** — architectural decisions being locked down before build begins.

---

*Built with a multi-agent development workflow using Claude Code, Codex, Gemini, Grok, DeepSeek, and Copilot.*
