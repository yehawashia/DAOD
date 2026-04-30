# BRIEF — Architecture & Prompt Engineering

**For:** Grok, DeepSeek
**Excludes:** Implementation details — you don't write code, you specify contracts.

---

## Your north star

You shape the contracts every other agent codes against. A loose schema or a permissive prompt here becomes a thousand edge cases downstream. Be ruthless about specificity.

## What you own

1. **System prompts** — every prompt file in `prompts/`. Iterate them against benchmark inputs; version-tag each change.
2. **JSON schema reviews** — every change to `schemas/*.json` gets a review pass from you before merge.
3. **Scene type definitions** — you propose new scene types (with payload schemas) when the planner repeatedly hits a ceiling. Requires ADR.
4. **Training data format rules** — the canonical `{input, output}` structure, transformation rules from transcripts, rejection criteria.
5. **Mathematical correctness review** — DeepSeek specifically reviews produced lessons for math errors before they become training data.
6. **Timeline-graph algorithm design** — insertion, branch merging, frame renumbering on interruption depth=2.

## Prompt files to maintain

All at `prompts/<role>/system.md`. Each file has a version number and last-modified date in the header — **bump both on every edit**.

- `prompts/lesson-planner/system.md` — the core lesson planner (v0.1)
- `prompts/segment-generator/system.md` — segment expansion (v0.1)
- `prompts/interrupt-handler/system.md` — branch generator (v0.1)
- `prompts/homework-extractor/system.md` — Qwen2.5-VL prompt (v0.1)
- `prompts/transcript-transformer/system.md` — batch training-data transformer (v0.1)

## UK curriculum structure (what the prompts must respect)

Key stages (from national curriculum):
- **KS1** — Years 1–2
- **KS2** — Years 3–6
- **KS3** — Years 7–9
- **KS4** — Years 10–11 (GCSE)
- **KS5** — Years 12–13 (A-Level — out of scope for V2)

Year-group expectations (roughly):
- **Year 5–6:** whole-number arithmetic, fractions, decimals, simple percentages, area/perimeter, basic statistics.
- **Year 7:** negative numbers, directed number, introduction to algebra (substitution, simple equations), ratio & proportion, coordinates, angles in polygons.
- **Year 8:** linear equations, sequences, introduction to graphs of linear functions, angles in parallel lines, percentage change.
- **Year 9:** simultaneous equations, expanding/factorising, inequalities, Pythagoras, basic trigonometry, probability trees.
- **Year 10 (GCSE foundation/higher):** quadratic equations (factorising/formula), graphs of quadratics, algebraic fractions, bearings, trigonometric ratios, transformations.
- **Year 11 (GCSE higher):** circle theorems, vectors, iterative methods, algebraic proof, functions, histograms.

Pedagogical sequence expected per lesson (the prompt enforces): **intuition → definition → worked example → misconception check → recap**.

## Exam boards

- **AQA GCSE Maths** (8300) — standard UK exam board.
- **Edexcel GCSE Maths** (1MA1) — Pearson.
- **OCR GCSE Maths** (J560) — third major board.

The planner should not hard-code a board unless the student picked one; otherwise use the national curriculum as the base reference.

## Review checklist for any prompt change

- [ ] Version bumped? Date updated?
- [ ] OUTPUT SCHEMA reference still matches `schemas/`?
- [ ] Any new rule added has a corresponding benchmark test that will fail without it?
- [ ] Run the new prompt through all 20 benchmark prompts. Report schema validity and latency deltas in the PR.
- [ ] No creator-quoted language in transcript-transformer output (§6.5 legal constraint).
- [ ] No solve-the-problem behaviour in homework-extractor (§8.2).

## Review checklist for any schema change

- [ ] Breaking change flagged (any required field added, any enum narrowed)?
- [ ] All affected examples in `training/data/golden-examples/` and `training/data/benchmarks/` regenerated or re-reviewed?
- [ ] `docs/decisions/` has an ADR explaining why.
- [ ] Backend/Manim briefs updated if the change touches their contracts.

## Do not

- Do not hand-edit code files — that's Claude Code / Codex / Gemini. You change `prompts/`, `schemas/`, `docs/decisions/`.
- Do not approve prompt changes without running benchmarks.
- Do not add a scene type without a corresponding Manim template plan (coordinate with the Manim brief).

## Success criteria

- Fine-tuned model hits ≥ 95% schema validity on benchmarks.
- All prompts have clear version history.
- Every ADR you author is ≤ 1 page and has an explicit decision + alternatives considered.
- Zero untriaged blockers related to "ambiguous contract" in `blockers.md`.
