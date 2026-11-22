---
summary: AI tagging and OpenRouter bake-off quirks (entries 58-61) split from KNOWN_QUIRKS.md.
kind: living
status: current
read-when: working on AI tagging, vision bake-offs, or OpenRouter provider pinning
---

# Known Quirks — AI Tagging and Bake-Off

Split from [KNOWN_QUIRKS.md](KNOWN_QUIRKS.md) to keep it under the size budget; numbering is unchanged.

## 58. Some Vision Models Skip the Tool-Call Leg in AI Tagging (2026-07-13)

**File**: `apps/worker/src/handlers/ai-tagging-shared.ts`
(`modelSupportsTools`, `callTagAssetModel`)

**What it looks like**: `callTagAssetModel` attempts three output strategies in
order — tool call, `json_schema`, then `json_object` — but for Gemma and Llama 4
Scout models the tool-call leg is skipped entirely and it goes straight to JSON.
Looks like an inconsistent special case.

**Why**: Gemma models on OpenRouter (e.g. `google/gemma-4-31b-it`) do not
support OpenAI-style function/tool calling. Running the tool leg for them always
fails over, but only after burning a full request that has its own 60s timeout
budget. Llama 4 Scout is image-capable, but some OpenRouter-routed endpoints
reject the image + function-calling combination even when the model can succeed
with structured JSON output. Because the legs run sequentially, a known-brittle
tool leg materially increases
the chance the whole call trips `AI_TIMEOUT_MS` (60s in `ai-tag-bakeoff.ts` and
`ai-tagging.ts`). `modelSupportsTools()` matches `/(^|\/)gemma/i` so both
`gemma-4-31b-it` and `google/gemma-4-31b-it` resolve the same, and
`/(^|\/)llama-4-scout/i` for Scout. Add other non-tool-calling or
endpoint-brittle families to `NON_TOOL_CALLING_MODEL_PATTERNS` only after
observing repeatable failures.

**Root cause of the "operation was aborted due to timeout" errors**: That exact
string is Node's `AbortSignal.timeout()` DOMException — a **client-side** abort
at 60s, not an OpenRouter error. `google/gemma-4-31b-it` is a real, working model
(observed ~7.9s avg, 25s worst across 21 bake-off successes); the 2 failures
were provider-side stalls that blew past 60s. Skipping the tool leg reduces but
does not eliminate these — a genuinely stalled provider can still exceed 60s on
the JSON leg. If you need to absorb that too, raise `AI_TIMEOUT_MS`.

**Future sessions should**: Do not "restore consistency" by making these models
run the tool leg — it only adds latency and timeout risk. This does not weaken
the production Image Tagging contract: the JSON/schema legs still require
`tags`, `ai_description`, and `scene_description` before storing a result. Verify
a model actually supports image + tool calling on the routed endpoint before
removing it from the skip list.

---

## 59. AI Tag Bake-Off Stores Provider Metadata in `raw_output` (2026-07-14)

**File**: `apps/worker/src/openrouter.ts`,
`apps/worker/src/handlers/ai-tag-bakeoff.ts`,
`src/components/settings/AiTagBakeoffTab.tsx`

**What changed**: OpenRouter calls request router metadata
(`X-OpenRouter-Metadata: enabled`), capture `X-Generation-Id`/provider headers,
parse success and error-body `openrouter_metadata`, enrich from
`/api/v1/generation` when possible, and store that under
`ai_tag_bakeoff_results.raw_output._popdam_provider`. The bake-off UI shows
provider/endpoint next to time, tokens, and cost, and summarizes provider
success/failure patterns per run.

**Why**: The same OpenRouter model ID can route to different provider endpoints,
and failures such as image + function-calling rejection can be endpoint-specific.
The bake-off needs to evaluate production Image Tagging behavior, so provider
route evidence must be visible alongside quality/cost/timing.

**Future sessions should**: Keep this metadata best-effort. OpenRouter may omit
headers or generation metadata; OpenRouter cache hits intentionally omit router
metadata; and old rows will show `unknown`. That is missing evidence, not proof
there was no provider route. Avoid adding a shared-db migration for provider
columns unless the app needs filtering/reporting on this metadata outside the
bake-off UI.

**⚠️ Verified caveat (2026-07-14): the `openrouter_metadata.attempts[]` /
`endpoints.available` path likely never populates — treat "which endpoints
failed" as UNSUPPORTED by OpenRouter's API until proven otherwise.** A session
investigating "the same model sometimes fails, sometimes succeeds" checked this
end to end:

- **OpenRouter's own docs** (`/docs/features/provider-routing`,
  `/docs/api-reference/*`) document **no** `openrouter_metadata` object, **no**
  `attempts[]` array, **no** `endpoints.available` array, and **no**
  `X-OpenRouter-Metadata` request header. Those field names appear to be
  assumed, not real. The only documented route attribution is the response
  `model` field and the `/api/v1/generation` endpoint — **both name only the
  endpoint that ultimately *served* the call, never the failed legs of a
  fallback chain.**
- **Production data agrees**: at the time of the check, **0 of 251**
  `ai_tag_bakeoff_results` rows had ever stored a `_popdam_provider` blob, even
  though 143 carried the sibling `_popdam_output_mode` (written in the same
  object spread). Only one bake-off run postdated the tracking commit
  (`ff84eeb`, deploy-window), so this is *partly* "no data yet" — but combined
  with the docs it strongly suggests the metadata never arrives.
- **Could not be confirmed live**: the PopDAM OpenRouter account's
  privacy/data-policy blocks bare text completions (`No endpoints available
  matching your guardrail restrictions and data policy`), so a from-scratch
  probe couldn't capture a real 200 body. Not worth flipping the account
  setting (outward-facing prod config) to test.

**The reliable way to detect a bad endpoint is quirk #60 (pin +
`allow_fallbacks: false`)** — a hard failure then names the exact provider. The
parser is defensively null-safe, so leaving the `attempts[]` code in place is
harmless; just don't expect the failed-leg list to fill in. To close the open
question, run **one** bake-off on the deployed tracking code and check whether a
single `_popdam_provider` blob ever contains a `routerMetadata.attempts` array.

## 60. Pinning an OpenRouter Endpoint to Force One Provider (2026-07-14)

**File**: `apps/worker/src/openrouter.ts` (`buildProviderPin`),
`apps/worker/src/handlers/ai-tagging-shared.ts` (`callTagAssetModel` `provider`
param), `apps/worker/src/handlers/ai-tagging.ts` (config read),
`src/components/settings/ApisTab.tsx` (admin field).

**What it is**: Optional `admin_config.AI_TASK_MODELS.vision_tagging_provider` —
one or more comma-separated OpenRouter provider slugs (e.g. `anthropic` or
`anthropic,amazon-bedrock`). When set, the production Image Tagging worker sends
`provider: { only: [...slugs], allow_fallbacks: false }` on every OpenRouter
leg, forcing the call to those endpoints and **disabling silent fallback**.
Blank = normal routing. Set it in Settings → AI Models → Image Tagging → "Pin
OpenRouter endpoint (optional)".

**Why**: The same model ID load-balances across upstream endpoints (Anthropic
direct, Bedrock, Vertex, DeepInfra, …) that differ in tool-call fidelity,
JSON-schema support, and content filtering — so "sometimes fails" is usually
*which endpoint got picked*. `{only, allow_fallbacks:false}` is exactly
OpenRouter's documented pin structure (verified against
`/docs/features/provider-routing`). With fallbacks off, a flaky endpoint
**hard-fails visibly** instead of silently rerouting, which both stabilizes
production on a known-good endpoint and turns endpoint flakiness into a
deterministic, attributable error.

**Future sessions should**: Use the Vision Bake-Off to discover which provider
slug wins/fails for a given model (its per-run provider success/failure table),
then pin the winner. The bake-off itself is intentionally left **unpinned** — it
must observe natural routing to be a discovery tool. Only Image Tagging reads the
pin today; ERP classification and PDF extraction do not (add a sibling
`*_provider` key + thread `buildProviderPin` if that need appears).

## 61. Vision Bake-Off Uses Hi-Res PDF Pages, but Production Tagging Still Uses 800px Thumbnails (2026-07-14)

**File**: `apps/worker/src/handlers/ai-tag-bakeoff.ts`.

**What it looks like**: Running a Vision Bake-Off on PDF assets should behave exactly like production Image Tagging because both use the shared `tag_asset` contract.

**Actually**: The contract is shared, but the image rendition can differ. Bake-off now prefers the latest 1500px PDF page image stored on `pdf_text_samples.thumbnail_url` and records `raw_output._popdam_image_rendition = "pdf_hires_1500"`. If no PDF page image exists, or for raster/non-PDF assets, it falls back to the 800px `assets.thumbnail_url` and records `"thumbnail_800"`.

**Why**: The render agents already upload 1500px PDF page images to Spaces for PDF text sampling, so the Railway worker can use them without new storage, schema, or agent work. Raster originals are not uploaded to cloud storage; the worker can only reach the 800px thumbnail unless agents create and upload a new hi-res raster rendition.

**Do not change because**: Treat this as a bake-off measurement path, not a silent production behavior change. Production Image Tagging still uses `assets.thumbnail_url`; moving production to hi-res raster inputs requires an agent-side rendition/backfill plan and, likely, a shared-db column for the new URL.

