# BRIEF — Manim Template Library

**For:** Gemini (primary, large-context Manim API work), Claude Code (template-engine wiring + worker)
**Excludes:** Frontend, API routes, training pipeline.

---

## Your north star

The LLM **never** writes Manim Python. It emits a scene specification JSON; you own the deterministic templates that turn that JSON into code. This is the security and reliability wall of V2.

## Scene type allowlist (blueprint §4.4)

Exactly these 15 scene types. No additions without an ADR:

1. `equation_solve_steps` — step-by-step algebraic manipulation
2. `equation_balance` — visual balance/scales metaphor
3. `graph_function_plot` — axes, plots, labeled points, tangent, shading
4. `graph_transformation` — animated stretch/shift/reflect
5. `geometry_construction` — points, lines, angles, circles with labels
6. `geometry_proof` — step-by-step proof with diagram annotation
7. `number_line_operation` — number line with animated jumps
8. `fraction_visual` — bar/pie fractions
9. `table_reveal` — progressive row/column reveal
10. `worked_example` — numbered worked solution
11. `comparison_split` — split-screen comparison
12. `definition_card` — formal definition with key-term highlight
13. `recap_summary` — end-of-lesson key-points animation
14. `title_intro` — topic/year/objective title card
15. `misconception_alert` — common mistake + correction

## Payload schemas (your contracts)

Each scene type has a JSON Schema at `schemas/scene-types/<scene_type>.json`. **Every visual payload passed to a template must be validated against its schema before script generation.**

## Template engine design

Location: `manim-templates/engine/`.

```
engine/
├── __init__.py
├── registry.py         # scene_type -> TemplateClass map
├── base.py             # abstract BaseTemplate: validate(visual), render(visual) -> py_script
├── templates/
│   ├── equation_solve_steps.py
│   ├── graph_function_plot.py
│   └── ... (one per scene type)
└── runner.py           # takes job_payload, writes script.py to sandbox, calls manim CLI
```

Each template subclass exposes:

```python
class EquationSolveStepsTemplate(BaseTemplate):
    scene_type = "equation_solve_steps"
    schema_path = "schemas/scene-types/equation_solve_steps.json"

    def render(self, visual: dict, duration_target_sec: float) -> str:
        """Return Manim scene script as a Python source string."""
        ...
```

## Render worker contract (consumes from backend's BullMQ `render` queue)

Job payload:
```json
{
  "job_id": "uuid",
  "segment_id": "seg_003",
  "scene_type": "equation_solve_steps",
  "visual": { ... },
  "duration_target_sec": 15,
  "resolution": "1280x720",
  "fps": 30,
  "priority": "normal"
}
```

Worker steps:
1. Validate `visual` against `schemas/scene-types/<scene_type>.json`. Reject on failure with structured error.
2. Load template class from `engine.registry`.
3. Call `template.render(visual, duration)` → Python source string.
4. Write to sandbox: `MANIM_SANDBOX_DIR/<job_id>/scene.py`.
5. Execute: `manim -qm --fps <fps> --resolution <WxH> -o <job_id>.mp4 scene.py SceneName` in a subprocess with strict timeout (`MANIM_TIMEOUT_SEC`).
6. Upload MP4 to S3 (`S3_BUCKET_ASSETS`).
7. Update `render_jobs` row: `succeeded` + `segments.video_asset_url`.

## Output format specs

- Container: MP4 (H.264/AAC), Manim default.
- Preview resolution: `MANIM_OUTPUT_RESOLUTION` (1280×720).
- Export resolution: `MANIM_EXPORT_RESOLUTION` (1920×1080) — re-render for export.
- FPS: `MANIM_OUTPUT_FPS` (30).
- Duration: should match `duration_target_sec` ± 1.5s. If a template can't hit it, log a warning and continue.
- Transparent background is acceptable for overlay-friendly scenes; Remotion composites.

## Docker setup

`manim-templates/docker/Dockerfile` must pre-install:
- Python 3.11+
- manim (community edition, latest stable)
- FFmpeg
- Full LaTeX (texlive) for MathTex rendering
- cairo, pango (Manim deps)
- Optional: OpenGL libs for GPU renderer

The image also needs the engine code and Python deps (`pydantic`/`jsonschema` for validation, `boto3` for S3).

Avoid mounting user code. Only the engine + templates go in the image.

## Performance targets

- Simple scenes (`equation_solve_steps`, `definition_card`, `title_intro`, `recap_summary`): ≤ 5s wall-clock.
- Medium scenes (`worked_example`, `fraction_visual`, `number_line_operation`, `table_reveal`, `comparison_split`, `misconception_alert`): ≤ 12s.
- Complex scenes (`graph_function_plot`, `graph_transformation`, `geometry_construction`, `geometry_proof`, `equation_balance`): ≤ 25s.

If interruption latency budget is at risk (§9.2), the branch planner prefers simple scene types. Your job is to make sure the simple ones stay simple.

## Files you own

```
manim-templates/
├── templates/               # One .py per scene_type
├── engine/                  # Registry, base class, runner
├── docker/
│   └── Dockerfile
└── tests/                   # One fixture per template (visual JSON in, MP4 out, duration within ±1.5s)
```

## Do not

- Do not accept arbitrary Python in the job payload. The only executable code is produced by your templates.
- Do not use `eval()` or `exec()` on any content from the LLM.
- Do not add new scene types without an ADR.
- Do not read or write DB directly — results flow back through the worker's status update path.

## Success criteria

- All 15 templates produce deterministic MP4 output from representative fixtures.
- Validation rejects every malformed payload test case.
- Worker processes 3 concurrent jobs on one container without OOM.
- Phase-1 5 templates (`title_intro`, `equation_solve_steps`, `graph_function_plot`, `worked_example`, `recap_summary`) complete by end of Week 2.
