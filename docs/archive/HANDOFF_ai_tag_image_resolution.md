# Handoff — AI tagging image resolution (Option A vs B decision pending)

Date: 2026-07-14
Scope: what resolution image PopDAM sends to vision models for tagging, and an
unresolved production decision.

Durable homes (this file is the ephemeral handoff for the *pending decision*
only — the shipped behavior and the constraint live in the canonical docs):
- `docs/KNOWN_QUIRKS.md` #61 — bake-off hi-res PDF rendition + why raster can't
  use it without agent work (the Option A/B constraint).
- `docs/MODEL_RULES.md` (Image source) — the bake-off image-source rule and
  `_popdam_image_rendition` values.
Delete this file once the Option A/B production decision below is made.

## TL;DR

- Every vision call today sends the **800px longest-edge, JPEG q85 thumbnail**
  (`assets.thumbnail_url`), base64 inline. Resize happens at ingest in the render
  agents (`.resize(800, 800, { fit: "inside", withoutEnlargement: true })`), not
  at call time.
- `fit: "inside"` caps the **longest** edge only, so wide/tall artwork collapses
  on the short edge (a 4000×1000 banner → 800×200) and text/detail is destroyed
  before the model sees it. This is the strongest reason to send bigger images —
  it hurts PDFs/style guides/tech packs most.
- **Done in this change:** the model bake-off now sends the existing **1500px
  hi-res PDF page** for PDF assets; raster still uses the 800px thumbnail.
- **PENDING DECISION (production path):** how to give the *production* tagger
  higher-res raster images. Option A (agent-side hi-res rendition + backfill) vs
  Option B (resize-on-demand in the worker). **Option B is NOT feasible for
  raster** — see below. Decide before changing the production tagger.

## Key files

- Shared vision plumbing: `apps/worker/src/handlers/ai-tagging-shared.ts`
  - `fetchImageData()` — fetches a URL, base64-encodes, no resize.
  - `callTagAssetModel()` — structured-output ladder: tool_call → json_schema →
    json_object → repair.
- Production tagger (Railway batch): `apps/worker/src/handlers/ai-tagging.ts`
  (uses `assets.thumbnail_url`, 800px).
- Edge tagger (Gemini direct): `supabase/functions/ai-tag/index.ts` (also 800px).
- Bake-off (model comparison, shadow tables only): `apps/worker/src/handlers/ai-tag-bakeoff.ts`.
- Rendition generation (agents, where `sharp` lives):
  `apps/windows-agent/src/renderer.ts`, `apps/bridge-agent/src/thumbnailer.ts`
  (`THUMB_MAX_DIM = 800`, `PDF_HIRES_DIM = 1500` q90).
- Rendition upload keys: `apps/windows-agent/src/uploader.ts`
  (`thumbnails/{id}.jpg`, `pdf-pages/{id}_p{n}.jpg`, `sg-thumbnails/{id}.jpg`).
  PDF hi-res page URL is recorded on `pdf_text_samples.thumbnail_url`.

## What changed in this session (bake-off only, no production impact)

`apps/worker/src/handlers/ai-tag-bakeoff.ts`:
- Added `resolveBakeoffImageUrl(asset)` — prefers the 1500px PDF hi-res page
  (`pdf_text_samples.thumbnail_url`, latest by `sampled_at`) when present, else
  falls back to the 800px `assets.thumbnail_url`.
- `runModel()` now records which rendition was used in
  `raw_output._popdam_image_rendition` (`"pdf_hires_1500"` | `"thumbnail_800"`).
- Production taggers (`ai-tagging.ts`, `ai-tag/index.ts`) are **unchanged** —
  still 800px. This is deliberate: measure in the bake-off first.

To evaluate: run a bake-off over a set of long/rectangular PDFs and compare tag
quality of `pdf_hires_1500` rows vs the old 800px baseline, using the per-model
cost the harness already computes.

## The production decision: Option A vs Option B

Goal: give the production tagger higher-res **raster** images (PNG/JPG/TIFF), not
just PDFs.

### Option A — agent-side hi-res rendition + backfill
- Extend `renderer.ts` / `thumbnailer.ts` to also emit a larger raster rendition
  (e.g. 1500px), upload it (new `hires/` prefix), store its URL on a new
  `assets.hires_url` column (shared-db change — must go through `u2giants/shared-db`).
- Backfill the rendition for existing assets (respect batch limits; big single
  statements on `assets` time out — batch ~20k).
- Production tagger reads `hires_url` when present.
- Cost: agent code change + shared-db migration + storage + one-time backfill.

### Option B — resize-on-demand in the worker
- **NOT FEASIBLE for raster as the architecture stands. Two hard blockers:**
  1. The worker has no image library. `apps/worker/package.json` has only
     `@supabase/supabase-js` and `@aws-sdk/client-s3`; `sharp` lives only in the
     agents. Adding `sharp` to the worker is a native dep on Railway.
  2. Raster **originals are not in cloud storage the worker can reach.** The
     uploader only pushes thumbnails / pdf-pages / sg-thumbnails to DO Spaces;
     the raster original stays on the on-prem source share visible only to the
     render agent. The Railway worker cannot fetch it.
- Net: for raster, "resize on demand" requires the agent to produce and upload a
  hi-res rendition — which **is Option A**. A and B collapse for raster.
- The only place Option B is real today is PDFs, because the 1500px page already
  exists in the cloud — and that is exactly what the bake-off change above uses.

### Recommendation
If the bake-off shows hi-res materially improves tagging, do **Option A** for the
production raster path (there is no viable Option B for raster). Consider also
pointing the production tagger at the 1500px PDF page for PDF assets — a free win
mirroring the bake-off change.

## Related, separate issue — MiniMax M3 JSON errors (NOT resolution)

M3's "lots of JSON errors" is structured-output reliability, not image size.
Levers in `callTagAssetModel` / the `provider` block on `ChatCompletionRequest`
(supported in `openrouter.ts` but currently unset):
- Production Image Tagging now has one bounded same-model retry around the full
  structured-output ladder for intermittent routing/structured-output failures
  (`No endpoints found`, OpenRouter 404, tool-use support errors, malformed tool
  JSON, no parsable JSON). This is separate from the JSON repair retry inside
  `callTagAssetModel` and does not retry content-inspection, thumbnail, or DB
  write failures.
- OpenRouter routes one model ID across multiple provider endpoints and
  load-balances/falls back unless pinned; endpoints differ in tool-calling,
  `response_format`, and `strict` support — a prime cause of intermittent JSON
  failures. The chosen endpoint is already captured in
  `raw_output._popdam_provider`; query failed M3 rows to see if failures cluster.
- `require_parameters: true` — only route to endpoints that support the params
  sent (biggest cheap win; nothing sets a `provider` block today).
- Pin `provider.only` / `provider.order` once the reliable endpoint is known.
- `max_tokens: 1500` likely too low — M3 is a reasoning model; reasoning tokens
  can truncate JSON mid-object. Raise it and/or disable reasoning.
- `strict: true` on the json_schema leg (currently `false`), paired with
  `require_parameters`.
- `temperature: 0` on the primary legs (today only the repair leg sets it).
