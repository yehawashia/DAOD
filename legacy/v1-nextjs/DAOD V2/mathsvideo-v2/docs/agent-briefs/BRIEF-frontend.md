# BRIEF — Frontend Implementation

**For:** Claude Code (primary), Gemini (large-context Remotion work)
**Excludes:** Backend internals, training pipeline, Manim template Python.

---

## Your north star

The lesson player must feel like a video, not a loading state. Pre-render the first 2–3 segments, start audio before video if necessary, keep the timeline scrubbable the moment any segment is ready.

## Tech stack (blueprint §14.1)

- React 18+ with TypeScript
- Remotion Player (embedded) for playback; Remotion Render runs server-side in backend
- Zustand **or** Redux Toolkit (pick one, justify in an ADR)
- Web Audio API for audio coordination
- MediaRecorder API for voice capture
- WebSocket for streaming STT (`WS /api/stt/stream`)
- Tailwind CSS

## Component list (blueprint §14.2)

| Component | Responsibility |
|---|---|
| `AppShell` | Layout, navigation, mode switching |
| `OnboardingFlow` | Year group, curriculum, confidence questionnaire |
| `TopicInput` | Text input + dictation button + math normalisation preview |
| `HomeworkUpload` | Camera/file upload, preview, question selection |
| `LessonPlayer` | Remotion Player wrapper with custom controls |
| `RemotionComposition` | Dynamic composition from segment list + branch list |
| `TimelineSlider` | Frame-level slider with branch markers and scrub |
| `SubtitleOverlay` | Word-synced subtitle display over video |
| `InterruptPanel` | Slide-up panel with text input + mic button |
| `LoadingState` | Progress indicator during render |
| `ExportPanel` | Export status, download button, transcript view |
| `RecapView` | End-of-session summary |

## Playback state machine (blueprint §14.3)

States (implement exactly these transitions):
```
idle → onboarding → awaiting_topic → generating_plan
  → rendering_initial → playing ⇄ paused
    → interrupt_input → generating_branch → playing_branch → returning_to_main → playing
  → session_complete → exporting → export_ready
  error (reachable from any state)
```

Model as a real state machine (XState or a typed reducer). Invalid transitions must throw in dev and be logged in prod.

## Remotion integration requirements

- Backend returns `timeline-state` JSON matching `schemas/timeline-state.schema.json`.
- `RemotionComposition` reads that JSON and renders `Sequence` blocks exactly as shown in blueprint §4.6.
- For live playback: Remotion Player.
- For export: backend uses Remotion Render with the same composition code — so **do not put display-only logic in the composition that would break headless render**.

## Timeline slider spec

- Frame-level granularity (fps = `timeline.fps`).
- Branch markers: small icons at `trigger_frame` on the main path.
- Click a branch marker → seek into the branch.
- Scrub over already-rendered segments must feel instant (< 100 ms response).
- Scrub into un-rendered segments: show a faint lock overlay; do not allow seek past the currently-rendered frontier.

## Interruption panel UX

- Triggered by pause-button long-press OR mic-button tap OR keyboard shortcut (space+i).
- Two input modes: typed text and voice (via `WS /api/stt/stream`).
- Voice mode: show live transcript, allow edit before submit.
- On submit → `POST /api/interrupt` → state transitions to `generating_branch`.
- While waiting, show an optimistic "your tutor is thinking..." animation with the question echoed back.
- When first branch segment's first audio chunk is ready (audio-first strategy, blueprint §7.1), begin playback.

## Loading states

- Pre-render gate: show a "Preparing your lesson..." animation with topic and year group echoed.
- Poll `GET /api/segment/:id/status` for the first N segments (configurable).
- Graceful degradation: if Manim is slow, start audio-only playback with static background and animated subtitles (§4.7).

## State management contract

Whatever store you pick, expose these slices:
```
session:     { id, year_group, curriculum, confidence }
playbackFSM: { state, currentFrame, currentSegmentId }
timeline:    { fps, main_path, branches, version }
segments:    { byId: Record<string, Segment & { render_status, assets }> }
interrupt:   { active, questionDraft, history[] }
export:      { jobId, status, downloadUrl }
```

## Files you own

```
frontend/
├── src/
│   ├── components/          # One folder per top-level component
│   ├── pages/               # Route-level containers
│   ├── renderer/            # Remotion compositions
│   ├── state/               # Store + state machine
│   ├── types/               # Generated from schemas/
│   ├── utils/               # Math normalization client-side, etc
├── public/
├── package.json
└── Dockerfile               # You create this
```

## Do not

- Do not reimplement backend logic client-side (branching decisions, LoRA prompts, math normalization — those live server-side).
- Do not write Manim Python. Ever.
- Do not copy schema JSON into frontend source; generate TypeScript types from `schemas/` at build time.
- Do not fetch LLM responses directly from the browser — always through backend endpoints.

## Success criteria

- All 12 components render in Storybook with fixture data.
- State machine hits every transition in an e2e run (`tests/e2e/`).
- Timeline scrub latency < 100 ms on cached segments.
- Full lesson playback from a benchmark prompt works end-to-end against the Phase-1 backend.
