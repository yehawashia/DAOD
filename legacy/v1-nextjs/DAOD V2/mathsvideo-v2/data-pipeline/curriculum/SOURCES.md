# Curriculum Reference — Official Download Sources

The Cowork sandbox cannot reach gov.uk or exam-board domains (egress allowlist blocks anything outside package registries). Download these PDFs manually and drop them into the paths listed below. The topic-map.csv and channel-whitelist.csv in this folder do not depend on them.

---

## UK National Curriculum — Mathematics

| Key stages | File to save as | Source URL |
|---|---|---|
| KS1 & KS2 (Years 1-6) | `data-pipeline/curriculum/national-curriculum-maths-primary.pdf` | <https://www.gov.uk/government/publications/national-curriculum-in-england-mathematics-programmes-of-study> → download the "primary" PDF |
| KS3 (Years 7-9) | `data-pipeline/curriculum/national-curriculum-maths-secondary.pdf` | Same landing page → download the "KS3" / "secondary" PDF |
| KS1 & KS2 non-statutory guidance | `data-pipeline/curriculum/maths-guidance-ks1-ks2.pdf` | <https://www.gov.uk/government/publications/teaching-mathematics-in-primary-schools> |

## Exam Board Specifications

| Board | Code | File to save as | Source URL |
|---|---|---|---|
| AQA GCSE Maths | 8300 | `data-pipeline/specs/aqa-gcse-maths-spec.pdf` | <https://www.aqa.org.uk/subjects/mathematics/gcse/mathematics-8300/specification> |
| Edexcel (Pearson) GCSE Maths | 1MA1 | `data-pipeline/specs/edexcel-gcse-maths-spec.pdf` | <https://qualifications.pearson.com/en/qualifications/edexcel-gcses/mathematics-2015.html> → "Specification" PDF |
| OCR GCSE Maths | J560 | `data-pipeline/specs/ocr-gcse-maths-spec.pdf` | <https://www.ocr.org.uk/qualifications/gcse/mathematics-j560-from-2015/> → "Specification" PDF |

## Notes for the data-pipeline agent

- Once PDFs are in place, run the transcript/spec parser you build under `data-pipeline/transforms/` to extract topic lists, objectives, and progression sequences into structured JSON. Cross-reference against `topic-map.csv` which already lists Y5-Y11 topics with curriculum and exam-board references.
- These documents are updated periodically. Re-download at the start of each training run; log the document version in `training/data/raw/<date>/curriculum-manifest.json`.
- Copyright: these are Crown-copyright / exam-board documents. Do not redistribute. They are reference only for training-data construction.
