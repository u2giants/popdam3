# AI Model Usage Rules

This document covers two distinct things: (1) which AI models are used inside the PopDAM system, and (2) execution rules for AI coding assistants working on this codebase.

---

## 1. Models Used Inside PopDAM

### Production Image Tagging (Railway worker)
- Code path: `apps/worker/src/handlers/ai-tagging.ts` plus the shared contract in `apps/worker/src/handlers/ai-tagging-shared.ts`.
- Uses OpenRouter through the worker's `OPENROUTER_API_KEY`. `GOOGLE_AI_API_KEY` exists only as a legacy fallback if no OpenRouter key is configured.
- Model config: `admin_config.AI_TASK_MODELS.vision_tagging`, cached by the worker for 60 seconds. Optional fallback: `vision_tagging_fallback`.
- Default when unset: `google/gemini-2.5-flash`.
- To change the model: Settings → AI Models. This updates `admin_config.AI_TASK_MODELS`; the Railway worker still needs its own `OPENROUTER_API_KEY` env var set in Railway.
- Output contract: every model must return `tags`, `ai_description`, and `scene_description`. The worker accepts OpenRouter tool calling, JSON-schema structured outputs, or JSON mode, then validates the required fields before storing a result.
- Retry behavior: malformed/invalid JSON mode output gets one repair retry with a stricter JSON-only instruction.

### Vision Bake-Off
- Code path: `apps/worker/src/handlers/ai-tag-bakeoff.ts`, reusing `callTagAssetModel()` from `ai-tagging-shared.ts`.
- Purpose: compare candidate models against the **same** production Image Tagging contract without overwriting production tags.
- Model picker source: OpenRouter `/api/v1/models/user`, filtered to the current account's guardrails, image input, available pricing, and at least one supported structured-output path (`tools`, `structured_outputs`, or `response_format` JSON mode).
- Each result stores latency, prompt/completion/total tokens, pricing snapshot, estimated cost, output mode, retry count, and best-effort OpenRouter provider/endpoint metadata under `raw_output._popdam_provider`.
- Provider metadata is best-effort. OpenRouter cache hits, old rows, and some edge/auth/rate-limit failures can show `unknown`.

### Legacy `ai-tag` Edge Function
- Location: `supabase/functions/ai-tag/`.
- This is not the production batch Image Tagging path anymore. It remains for Windows-agent / PDF text extraction support and calls Gemini directly.
- Do not add batch tagging behavior here; batch tagging belongs in the Railway worker.

### PDF Text Extraction (`pdf-text-sampler.ts` in bridge/windows agents)
- Uses a cascade: mupdf text extraction → OCR (tesseract.js) → AI vision fallback.
- The AI vision fallback is configurable separately from production image tagging. See `admin_config.AI_TASK_MODELS.pdf_extraction` and the bridge/windows sampler code before changing it.
- **Hard limit**: files larger than 100 MB are skipped (logged as warnings, surfaced in the PDF text sample progress UI).

### ERP Product Category Classification
- Uses OpenRouter to classify ERP items into product categories when deterministic MG code rules can't resolve them.
- Model config: `admin_config.AI_TASK_MODELS.text_classification`; the current default in `apps/worker/src/handlers/erp.ts` is `anthropic/claude-3.5-haiku`.
- Confidence < 65% → status `pending` (requires human review in the Review Queue).
- Confidence ≥ 65% → status `auto_applied`.

---

## 2. Execution Rules for AI Coding Assistants

### Read Before Coding
Before implementing any change, read:
1. `PROJECT_BIBLE.md` — non-negotiable rules (this always wins in a conflict)
2. The relevant doc(s): `SCHEMA.md`, `PATH_UTILS.md`, `API_CONTRACTS.md`, `deployment.md`
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
