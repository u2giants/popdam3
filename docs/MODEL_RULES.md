# AI Model Usage Rules

## Capability-driven structured output

Image tagging, Vision Bake-Off, and ERP classification share one bounded output
engine. It reads the account-filtered OpenRouter catalog, caches it for ten
minutes, and merges `AI_MODEL_CAPABILITY_OVERRIDES`. Strict schema is preferred
when advertised, followed by JSON object and compatible tool modes. Each method
is attempted at most once, with one final JSON repair attempt.

Malformed JSON, a missing tool call, or business-validation failure may move to
the next supported method. Authentication, authorization, billing, exhausted
rate limits/server retries, invalid media, and content-policy refusal stop the
cascade. Do not add model-name matching code; record unpublished provider facts
in the override setting.

The `tag_asset` response ceiling is 4,000 tokens. Reasoning-capable vision models
can spend more than 1,500 tokens internally before emitting the compact JSON;
lowering this ceiling can turn otherwise valid models into truncated responses.

This document covers two distinct things: (1) which AI models are used inside the PopDAM system, and (2) execution rules for AI coding assistants working on this codebase.

> **Active reliability plan:** [`../plan_ai_model_interaction_reliability.md`](../plan_ai_model_interaction_reliability.md)
> replaces model-name capability guesses, premature structured-output failures,
> silent ERP skips, and split PDF-agent behavior. Read its STATUS table first;
> do not re-derive or re-plan completed steps.

---

## 1. Models Used Inside PopDAM

### Production Image Tagging (Railway worker)
- Code path: `apps/worker/src/handlers/ai-tagging.ts` plus the shared contract in `apps/worker/src/handlers/ai-tagging-shared.ts`.
- Uses OpenRouter through the worker's `OPENROUTER_API_KEY`. The worker no longer falls back to `GOOGLE_AI_API_KEY` (removed 2026-07-14 — a Google key cannot authenticate against openrouter.ai). `GOOGLE_AI_API_KEY` is still live, but only for the on-prem agents' direct-Google PDF text extraction (see PDF Text Extraction below and `docs/KNOWN_QUIRKS.md` #63).
- **Exacto routing (default):** every OpenRouter call is sent with the `:exacto` model variant (`withExactoRouting()` in `openrouter.ts`, applied inside `chatCompletion`), routing to the provider endpoint with the best measured tool-calling accuracy. Free virtual variant, no price premium. A slug with an explicit `:variant` suffix opts out. This is the routing-layer fix for the endpoint-flip failures; see `docs/KNOWN_QUIRKS.md` #62. Applies to all OpenRouter paths (tagging, bake-off, ERP). **Exception:** `minimax/minimax-m3` is excluded from Exacto and hard-pinned to the `minimax` provider via `MODEL_ROUTING_OVERRIDES` (Exacto regressed it ~14%→89% because its only tool-capable endpoint truncates JSON; commit `f532c08`, see #62).
- Model config: `admin_config.AI_TASK_MODELS.vision_tagging`, cached by the worker for 60 seconds. Optional fallback: `vision_tagging_fallback`.
- Default when unset: `qwen/qwen3-vl-32b-instruct` — a hardcoded last-resort in `ai-tagging.ts`, NOT the configured default (the DB row is what runs). Live config as of 2026-07-14: `vision_tagging` = `qwen/qwen3-vl-32b-instruct`, `vision_tagging_fallback` = `minimax/minimax-m3`, `pdf_extraction` = `deepseek/deepseek-v4-flash`, `text_classification` = `deepseek/deepseek-v4-pro`. No Google/Gemini model runs through the worker.
- To change the model: Settings → AI Models. This updates `admin_config.AI_TASK_MODELS`; the Railway worker still needs its own `OPENROUTER_API_KEY` env var set in Railway.
- Output contract: every model must return `tags`, `ai_description`, `scene_description`, and `content_type`. The worker accepts OpenRouter tool calling, JSON-schema structured outputs, or JSON mode, then validates the required fields before storing a result.
- Description contract: `ai_description` is not a creative caption; it is a concise, search-friendly sentence for designers/salespeople looking for reusable licensed product assets. `scene_description` is a literal visual sentence.
- Tag contract: return 6-18 distinct lowercase search tags. The worker rejects blank tags, case-insensitive duplicates, and results outside that range. Avoid filler such as `image`, `design`, `art`, `asset`, `colorful`, and `product` by themselves. Visual categories and views must be supported by the image; filename/path/ERP evidence may supply product context but must not invent a visual classification.
- Controlled image categories (added 2026-08-16): professional photography uses the exact `professional photography` tag plus one of `straight view`, `3/4 view`, `close-up view`, `back view`, `lifestyle / in-use image`, or `person holding item / size scale image`. The size-scale label is for a person deliberately holding or presenting the item mainly to show its physical size relative to a hand or body; natural use or wear remains `lifestyle / in-use image`. Design assets use `design asset` plus the best supported subtype: `product mockup`, `artwork`, `tech pack`, `packaging design`, `embellishment placement design`, or `freelancer illustration`. Magenta placement overlays take priority as `embellishment placement design`. Do not infer freelancer status from drawing style alone; require filename, path, document text, or metadata evidence. The canonical wording and examples live in `supabase/functions/_shared/tag-asset-contract.js` and its identical Railway vendor mirror.
- Retry behavior: malformed/invalid JSON mode output gets one repair retry with a stricter JSON-only instruction inside `callTagAssetModel()`. Production Image Tagging also retries the **same model once** in `tagSingleAsset()` when the full structured-output ladder fails with routing/structured-output symptoms such as OpenRouter 404, `No endpoints found`, tool-use support errors, malformed tool JSON, or no parsable JSON. It does not same-model retry content-inspection failures, missing thumbnails, or DB write errors; after the bounded retry, the configured fallback model can still run for model/provider-specific failures.
- **Endpoint pinning (optional):** `admin_config.AI_TASK_MODELS.vision_tagging_provider` = comma-separated OpenRouter provider slug(s) (e.g. `anthropic`, `anthropic,amazon-bedrock`). When set, the worker sends `provider: { only: [...], allow_fallbacks: false }` on every OpenRouter leg — forcing those endpoints and disabling silent fallback so a flaky endpoint hard-fails visibly. Blank = normal routing. Set it in Settings → AI Models → Image Tagging. Wiring: `buildProviderPin()` in `openrouter.ts` → `callTagAssetModel(..., provider)`. See `docs/KNOWN_QUIRKS.md` #60. Only Image Tagging reads this; ERP/PDF paths do not.

### Vision Bake-Off
- Code path: `apps/worker/src/handlers/ai-tag-bakeoff.ts`, reusing `callTagAssetModel()` from `ai-tagging-shared.ts`.
- Purpose: compare candidate models against the **same** production Image Tagging contract without overwriting production tags.
- Model picker source: OpenRouter `/api/v1/models/user`, filtered to the current account's guardrails, image input, available pricing, and at least one supported structured-output path (`tools`, `structured_outputs`, or `response_format` JSON mode).
- Each result stores latency, prompt/completion/total tokens, pricing snapshot, estimated cost, output mode, retry count, and best-effort OpenRouter provider/endpoint metadata under `raw_output._popdam_provider`.
- Image source: the bake-off uses the highest-resolution rendition already reachable from the cloud worker. For PDF assets it prefers the latest `pdf_text_samples.thumbnail_url` 1500px PDF page image and records `raw_output._popdam_image_rendition = "pdf_hires_1500"`. Non-PDF/raster assets still use the 800px `assets.thumbnail_url` and record `"thumbnail_800"`. This is bake-off only; production Image Tagging still uses `assets.thumbnail_url`.
- Provider metadata is best-effort. OpenRouter cache hits, old rows, and some edge/auth/rate-limit failures can show `unknown`.
- **⚠️ Open question (2026-07-14):** the "which endpoints *failed*" evidence — the `openrouter_metadata.attempts[]` / `endpoints.available` fields the parser reads — is **undocumented by OpenRouter and appears to never populate** (0/251 prod rows had a `_popdam_provider` blob at check time; docs list no such fields or `X-OpenRouter-Metadata` header; a live probe was blocked by the account data-policy). OpenRouter only ever exposes the *serving* endpoint (response `model` + `/api/v1/generation`), not the failed legs. Use the endpoint **pin** (above) to detect a bad endpoint via hard failure. To resolve the open question, run one bake-off on deployed tracking code and check whether any `_popdam_provider.routerMetadata.attempts` array is non-empty. Full detail: `docs/KNOWN_QUIRKS.md` #59.
- The bake-off is intentionally **not** pinned — it must observe natural OpenRouter routing to serve as an endpoint-discovery tool.

### Legacy `ai-tag` Edge Function (REMOVED 2026-07-14)
- Deleted from `supabase/functions/ai-tag/` (source + `config.toml` entry) and from the Supabase project (`supabase functions delete ai-tag`). It was a direct-Gemini batch tagging path with no remaining callers; production batch tagging is the Railway worker.
- Its old note claimed it backed "Windows-agent / PDF text extraction" — that was **wrong**. PDF text extraction is the separate agent path below, which calls Google directly and never invoked this function.
- Do not recreate it. Batch tagging belongs in the Railway worker via OpenRouter.

### PDF Text Extraction (`pdf-text-sampler.ts` in bridge/windows agents)
- Uses a cascade: mupdf text extraction → OCR (tesseract.js) → AI vision fallback.
- The AI vision fallback calls Google's `generativelanguage.googleapis.com` **directly** (not through OpenRouter) using `GOOGLE_AI_API_KEY`, which the agents read via `agent-api`'s config passthrough. This is the only live consumer of `GOOGLE_AI_API_KEY` — keep it configured. See `docs/KNOWN_QUIRKS.md` #63.
- The AI vision fallback is configurable separately from production image tagging. See `admin_config.AI_TASK_MODELS.pdf_extraction` and the bridge/windows sampler code before changing it.
- The AI prompt requires literal transcription of visually legible text in reading order. It forbids inferring, completing, correcting, or inventing unclear text, omits unreadable text, and requests only the transcription. Keep this contract aligned in the bridge sample, bridge backfill, and Windows sample paths.
- **Hard limit**: files larger than 100 MB are skipped (logged as warnings, surfaced in the PDF text sample progress UI).

### Rich PDF Extraction (`rich-pdf-extract` op, Railway worker)
- Extracts structured product data from tech-pack / licensing-sheet PDFs into `dam.pdf_rich_extraction` → `style_groups.rich_metadata`. Code: `apps/worker/src/handlers/rich-pdf.ts`.
- **Uses DeepSeek's DIRECT API, not OpenRouter** (`apps/worker/src/deepseek.ts`, key `DEEPSEEK_API_KEY` in the Railway worker env; value in 1Password `ai-provider-api-keys/deepseek`). Reason: the instructions+schema prefix is identical on every one of ~19k calls, and DeepSeek's automatic prefix caching bills cache hits at ~1/10 — which OpenRouter does not reliably pass through. Keep the stable prompt in the `system` message and the variable PDF text in `user` to maximize cache hits.
- Model config: `admin_config.AI_TASK_MODELS.rich_pdf_extraction` (defaults to `deepseek-chat` in code). JSON mode (`response_format: json_object`).
- General rule: for a cacheable, high-volume LLM batch, prefer the direct provider API over OpenRouter. See `docs/RICH_PDF_EXTRACTION.md` and `docs/KNOWN_QUIRKS.md` #64.

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
