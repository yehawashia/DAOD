# BRIEF — Training Pipeline

**For:** Gemini (primary, file-heavy pipeline work), DeepSeek (math correctness + training data review)
**Excludes:** Frontend, backend API, Manim rendering.

---

## Your north star

The training pipeline exists to make the lesson planner reliably produce valid lesson-plan JSON for UK curriculum topics. It is **not** a chatbot trainer. Structural fidelity to the schema is non-negotiable — a lesson with beautiful pedagogy and broken JSON is worse than a bland lesson that parses.

## Training objective (blueprint §5.1)

A fine-tuned Qwen that:
- Understands UK curriculum structure by year group.
- Produces `lesson-plan-response` JSON that validates.
- Uses scene types only from the 15-type allowlist.
- Sequences explanations pedagogically (intuition → definition → example → misconception → recap).
- Uses age-appropriate vocabulary.
- Produces useful interruption branch templates.

## Training data format (blueprint §5.4)

Every example is a `{"input": ..., "output": ...}` pair where:
- `input` validates against `schemas/lesson-plan-request.schema.json`
- `output` validates against `schemas/lesson-plan-response.schema.json`

Seed examples are in `training/data/golden-examples/` (5 provided by Cowork — `year7-fractions-addition.json`, `year8-linear-equations.json`, `year9-simultaneous-equations.json`, `year10-quadratic-formula.json`, `year11-circle-theorems.json`).

## LoRA config (blueprint §5.6)

```python
from peft import LoraConfig, TaskType
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj"
    ],
    lora_dropout=0.05,
    bias="none",
    task_type=TaskType.CAUSAL_LM
)
```

Hyperparameters: lr=2e-4, epochs=3-5 (use early stopping on held-out validation), batch size tuned to your GPU, gradient accumulation as needed.

## Dataset size targets (blueprint §5.7)

| Phase | Count | Purpose |
|---|---|---|
| Phase 0 | 20-50 | Prompt engineering validation, schema testing |
| Phase 1 | 100-300 | Few-shot baseline, initial LoRA experiment |
| Phase 2 | 500-1000 | Production LoRA fine-tune |
| Phase 3 | 2000+ | Full curriculum coverage, edge case handling |

## Data sources (blueprint §5.3)

- UK National Curriculum (KS1-KS4 programmes of study) — structural backbone
- GCSE exam specs (AQA, Edexcel, OCR) — topic scoping & difficulty calibration
- Educational video transcripts from whitelisted channels (`data-pipeline/curriculum/channel-whitelist.csv`) — pedagogy patterns
- Textbook worked examples — high-quality canonical examples
- Synthetic examples from strong model + human review — dataset scaling
- Misconception libraries — error-aware teaching

## Transformation pipeline (what you build)

Location: `data-pipeline/transforms/`.

1. **Scraper outputs** land in `data-pipeline/youtube/` (raw) and `data-pipeline/transcripts/` (cleaned).
2. **Transformer** calls a strong LLM using the prompt at `prompts/transcript-transformer/system.md` to produce `{input, output}` training examples.
3. **Validator** runs each produced example through:
   - JSON parse
   - `lesson-plan-request.schema.json` validation
   - `lesson-plan-response.schema.json` validation
   - Scene-type allowlist check
   - Scene-type-specific visual schema validation
4. **Human review** required before files move to `training/data/processed/` (owner: DeepSeek for math correctness, Gemini for pedagogy coherence).
5. Validated examples are added to a Hugging Face `datasets.Dataset` and split into train/val/test.

## Evaluation metrics (blueprint §5.5, §15)

Automated:
- Schema validity rate — must be > 95%.
- Scene-type compatibility — must be 100%.
- Render success rate — must be ≥ 95% (each output plan is rendered end-to-end via Manim worker in eval mode).
- Latency per plan — P50/P90/P99.
- Timeline consistency — no frame gaps, overlaps, or broken return paths.

Manual:
- Mathematical correctness (blind review).
- Year-group appropriateness.
- Pedagogical quality.

Benchmark set: `training/data/benchmarks/benchmark-prompts.json` (20 prompts spanning year groups and topics). Every model checkpoint must be run against this.

## Files you own

```
data-pipeline/
├── youtube/             # Scraper code + raw collected data
├── transcripts/         # Cleaned transcripts (intermediate)
├── transforms/          # Transcript → training-example pipeline
├── curriculum/          # UK curriculum refs, topic map CSV
└── specs/               # Exam board spec PDFs

training/
├── data/
│   ├── raw/
│   ├── processed/
│   ├── golden-examples/ # Cowork seeded 5; expand to 30+
│   └── benchmarks/      # 20 prompts seeded by Cowork
├── configs/             # lora configs, training args YAML
├── scripts/             # train.py, eval.py, export_adapter.py
└── eval/                # Evaluation harness + reports
```

## Do not

- Do not train on raw transcripts directly. Always transform into the canonical schema first.
- Do not mix languages/curriculums — this is UK-only.
- Do not skip human review on synthetic data. The blueprint calls that out specifically.
- Do not deploy a model that drops below the prompt-only baseline on any benchmark metric (§18 risk: fine-tuning degrades quality).

## Success criteria

- Phase 2 LoRA run hits schema validity ≥ 95% and scene compatibility = 100% on benchmarks.
- Transformer pipeline produces ≥ 300 reviewed examples by end of Phase 3.
- Evaluation report (`training/eval/reports/<run_id>.md`) compares fine-tuned vs prompt-only baseline on every metric.
- Adapter is exportable and hot-swappable into the production vLLM server (§11.2).
