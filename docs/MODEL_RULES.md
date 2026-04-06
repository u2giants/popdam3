# AI Model Usage Rules

This document covers two distinct things: (1) which AI models are used inside the PopDAM system, and (2) execution rules for AI coding assistants working on this codebase.

---

## 1. Models Used Inside PopDAM

### Asset Thumbnail Tagging (`ai-tag` edge function)
- Uses **Google Gemini** (vision-capable model) to analyze thumbnail images
- The specific model is **configurable** via `AI_MODELS` in admin_config — `ai-tag` finds the first entry with `provider: "google"` and `capabilities` including `"vision"`
- Falls back to `gemini-2.5-flash-preview-04-17` if `AI_MODELS` config is absent or has no qualifying model
- To change the model: update the `AI_MODELS` array in Settings → Admin Config

### PDF Text Extraction (`pdf-text-sampler.ts` in bridge agent)
- Uses a cascade: mupdf text extraction → OCR (tesseract.js) → AI vision fallback
- The AI vision fallback is **configurable** via `AI_MODELS` + `PDF_EXTRACTION_CONFIG` in admin_config
- `PDF_EXTRACTION_CONFIG.ai_vision_model_id` names the model ID from the `AI_MODELS` catalog to use
- Supports Google Gemini and Anthropic providers
- **Hard limit**: files larger than 100 MB are skipped (logged as warnings, surfaced in the PDF text sample progress UI)

### ERP Product Category Classification
- Uses Claude (via OpenRouter) to classify ERP items into product categories when deterministic MG code rules can't resolve them
- Confidence < 65% → status `pending` (requires human review in the Review Queue)
- Confidence ≥ 65% → status `auto_applied`

---

## 2. Execution Rules for AI Coding Assistants

### Read Before Coding
Before implementing any change, read:
1. `PROJECT_BIBLE.md` — non-negotiable rules (this always wins in a conflict)
2. The relevant doc(s): `SCHEMA.md`, `PATH_UTILS.md`, `API_CONTRACTS.md`, `DEPLOYMENT.md`
3. State which rules apply to the task before writing code

### Change Discipline
- Prefer small, focused diffs over refactors
- If a task touches DB schema or API shapes, update the matching doc in the same commit
- No fix-on-fix: if the same bug persists after two attempts, stop and re-read the relevant docs before trying a third approach
- Don't add features, error handling, or abstractions beyond what was asked

### Fail-Fast Rules
- If a scan reports `files_checked = 0`, treat it as an error unless the scan roots were explicitly validated as empty
- Never return a success response when a core operation processed nothing
- Timestamps must always come from the filesystem (agent-supplied), never from `now()` or defaults

### Truthfulness
- Don't claim something was tested unless the tool actually ran it
- If tests exist, run them; otherwise say "not executed" explicitly

---

## 3. Golden Rule (Repeated Here For Emphasis)

The DAM must **never** modify file timestamps (`mtime`/`birthtime`) on source art files.

Before touching any file, record its original timestamps. After, verify and restore if changed. If restoration fails, halt processing and report a critical error.

This is the single most important invariant in the entire system. See `PROJECT_BIBLE.md §15` for full details.
