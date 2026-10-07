# fix_search.md — AI Tagging & Search Remediation Plan

**Author:** architecture review
**Scope:** Close the generation ↔ retrieval gap in the PopDAM AI image-tagging + search system so non-technical employees can actually find assets among 100k+ files.
**Status:** proposed — not yet implemented.

> **Active execution plan:** [`plan_hybrid_search_rollout.md`](plan_hybrid_search_rollout.md)
> supersedes §§1–2 for implementation and rollout safety. Read its STATUS table first.
> In particular, this document's §1d claim that relevance ordering is currently broken is stale;
> the hooks already preserve ranked ID order within their current 500-result ceiling.
> Do **not** execute §2a's old instruction to call the delete-all `rebuild_dam_search_documents()`
> inside a migration. The active plan replaces it with bounded incremental maintenance, preserves
> the later rich-PDF search fields, coordinates active asset/Style Group tags with issue #96, and
> runs exactly one final embedding backfill.

---

## 0. Guardrails (read before touching anything)

This repo shares Supabase backend `qsllyeztdwjgirsysgai` with the other POP apps. **Every schema/RPC/trigger/table change below is a shared-DB change** and MUST be authored in canonical `u2giants/shared-db` (`/worksp/shared-db`) as a branch + PR + timestamped migration, preview-first, AI-owned merge, **before** any dependent app code lands here. No app-side DDL, no new files under this repo's `supabase/migrations/`. See `CLAUDE.md` and `shared-db/AGENTS.md`.

Each work item below is tagged:

- **[DB]** → author in `/worksp/shared-db` (migration + preview + PR).
- **[APP]** → this repo, `main`-only (worker / edge functions / frontend).

App-side edge-function code lives here under `supabase/functions/**`; the worker under `apps/worker/**` (Railway auto-rebuilds on push to `main`).

**Feature-flag everything** behind `admin_config` keys so each change can ship dark and be toggled without a deploy (mirrors the existing `AI_TASK_MODELS` / `TAGGING_INSTRUCTIONS` pattern).

---

## 1. Recommendation 1 — Turn on semantic (hybrid) search in the UI

**Problem.** Today's migration `20260713221518_dam_hybrid_search_foundation.sql` already rewired `search_assets_full_text` / `search_style_groups_full_text` to be thin wrappers over `search_dam_documents(p_query, p_limit, p_document_types, p_query_embedding => NULL)`. The hybrid RPC, the `dam_search_documents.embedding vector(384)` column, and the HNSW cosine index all exist. The only caller that passes a real embedding is the **unused** `supabase/functions/dam-search-ai/index.ts` edge function. So the UI runs keyword-only against a hybrid-capable engine. Query-time embedding must happen server-side because it uses Supabase's built-in `gte-small` model (`Supabase.ai.Session`), which is only available in the edge runtime — the browser cannot embed.

### 1a. [DB] Ensure embeddings are actually populated
- Confirm/complete the backfill: `dam_search_documents.embedding` is populated for the whole corpus. The claim/upsert/status RPCs already exist (`claim_dam_search_embedding_documents`, `upsert_dam_search_embedding`, `get_dam_search_embedding_status`).
- Add nothing new in DB unless status RPC reveals gaps; the schema is ready.

### 1b. [APP] Drive the backfill to completion
- Add a worker op `embed-dam-search` in `apps/worker/src/handlers/` that loops calling the `dam-search-ai` edge function `action: "embed-batch"` (service-role) until `get_dam_search_embedding_status` reports 0 pending. Reuse the existing batch/cursor pattern from `handleBulkAiTag` (`apps/worker/src/handlers/ai-tagging.ts:245`).
- Alternatively schedule it via pg_cron **[DB]** invoking the edge function on an interval so new/edited assets self-embed. The `dam_search_documents` triggers already null the embedding + reset `content_sha256` on content change, so an incremental loop keeps it fresh.
- Add an admin panel readout of embedding coverage (`embedding-status` action) next to the Vision Bake-Off card.

### 1c. [APP] Route library search through the semantic edge function
- In `src/hooks/useAssets.ts`, replace the direct `supabase.rpc("search_assets_full_text", …)` call inside `fetchAssetFullTextIds` (line 66) with a call to the `dam-search-ai` edge function `action: "search"` (via `supabase.functions.invoke`), which embeds the query and passes it to `search_dam_documents`. Same for `useStyleGroups.ts` (`search_style_groups_full_text`).
- Keep the existing keyword RPC as an automatic fallback on edge-function error/timeout (extend `shouldFallbackFromFullTextRpc`, `useAssets.ts:54`), so a cold edge function never breaks search.
- Gate behind `admin_config.SEARCH_MODE` = `keyword` | `hybrid` (default `keyword` until validated), read once and cached like `useVisibilityDate`.

### 1d. [APP] Preserve relevance ordering (critical, currently broken for ranked search)
- **Root issue:** the ID-handoff pattern fetches ranked IDs then does `query.in("id", ids)` followed by `query.order(assetSortField)` (`useAssets.ts:209–215`), which **discards the RPC's relevance ranking**. Acceptable for keyword + default sort; fatal for semantic — the whole point is ordering by meaning.
- Add a `sortField === "relevance"` mode that preserves the RPC/edge order. Implement by ordering the final `assets` fetch to match the returned ID array position:
  - Simplest: have the edge/RPC already return full display rows (it returns `metadata` jsonb + score) and render directly, bypassing the re-query for the search case.
  - Or add a `p_return_rows` mode to `search_dam_documents` **[DB]** that returns the columns the grid needs, ranked, so no re-sort is needed.
- Make `relevance` the default sort whenever a search term is present; fall back to the user's chosen column sort when the box is empty.

### 1e. [APP] UX for non-technical users
- Add a subtle "Smart search" indicator + a "did you mean / showing closest matches" affordance so semantic results (which are never empty) don't read as false positives.
- Log query → click-through (which result the user opened) into an `admin_config`-gated telemetry table **[DB]** to later tune the `keyword_rank + semantic_rank * 0.35` blend weight (`search_dam_documents`, currently hard-coded at 0.35).

**Acceptance:** typing "cozy winter snowman scene" returns the right assets ranked by meaning; empty-query browse is unchanged; edge outage silently degrades to keyword.

---

## 2. Recommendation 2 — Make the AI tags & characters searchable

**Problem.** Neither the legacy tsvector nor the new `dam_search_documents.search_text` includes `asset_tags` or `asset_characters`. The `search_text` builder (`refresh_dam_search_asset_document`, migration `20260713221518_…:90–112`) concatenates only `filename, relative_path, cover_description, ai_description, scene_description, customer, program, licensor_name, property_name, product_category, pdf.extracted_text`. So the freeform tag array (`elsa, snowflake, blue, glitter`) and per-asset character links are **write-only for discovery** — you pay to extract them and then can't search them.

### 2a. [DB] Extend the `search_text` builders to include tags + character names
- In `/worksp/shared-db`, add a migration that redefines `refresh_dam_search_asset_document` (and the bulk rebuild variant near `…:340–370`, and the `style_group` builder) to `LEFT JOIN LATERAL` two aggregates and append them to the `concat_ws`:
  ```sql
  left join lateral (
    select string_agg(distinct at.tag, ' ') as tags
    from public.asset_tags at
    where at.asset_id = a.id
  ) tg on true
  left join lateral (
    select string_agg(distinct c.name, ' ') as character_names
    from public.asset_characters ac
    join public.characters c on c.id = ac.character_id
    where ac.asset_id = a.id
  ) ch on true
  ```
  then add `tg.tags, ch.character_names` to the `concat_ws(...)` that builds `v_search_text`.
- Because `search_tsv` is a **stored generated column** off `search_text`, no index change is needed — the GIN index picks it up automatically once `search_text` is rebuilt.
- Trigger coverage: add triggers on `asset_tags` and `asset_characters` (INSERT/UPDATE/DELETE) that call `refresh_dam_search_asset_document(asset_id)` so tag edits re-index. Today only `assets`, `style_groups`, `pdf_text_samples` have refresh triggers (`…:439–548`).
- Run the one-time bulk rebuild in the same migration (the existing full-rebuild function already exists — just re-run it after the definition change), gated by `set statement_timeout`, batched per the project's ~20k backfill rule (memory: `project_db_backfill_batching`) to avoid compute timeouts.

### 2b. [DB] Re-embed after search_text changes
- Changing `search_text` changes `content_sha256`, so the embedding-refresh loop (§1b) will naturally re-embed affected docs. Confirm the rebuild resets `embedding`/`content_sha256` for touched rows so semantic search also benefits from the new tag/character text.

### 2c. [APP] No frontend change required
- Because both keyword and semantic ride on `search_text`/`search_tsv`, tags and character names become searchable in both modes for free once §2a lands.

**Acceptance:** searching "groot" returns assets whose only "groot" signal is an `asset_characters` link; searching "glitter blue" hits tag-only matches.

---

## 3. Recommendation 3 — Confidence signal + human-sampling review queue

**Problem.** Vision tags write straight to production with no confidence and no QA. Contrast the ERP classifier, which returns `confidence` and gates auto-apply at 0.65 with a review queue (`apps/worker/src/handlers/erp.ts`). Across 100k+ assets there is currently **no measurement of tag precision/recall**, so you can't tell a good model change from a bad one except by eyeballing the bake-off.

### 3a. [APP] Add confidence to the extraction contract
- In `apps/worker/src/handlers/ai-tagging-shared.ts`, extend `TAG_ASSET_SCHEMA` (line 7) with:
  - `overall_confidence: number 0–1`
  - optional per-field confidence for the high-stakes fields (`character_ids`, `licensor_id`, `property_id`, `cover_description`).
- Update the prompt (`buildImageTaggingPrompt`, line 169) to instruct the model to self-report calibrated confidence and to prefer low confidence over guessing (reuse the ERP prompt's calibration language).

### 3b. [DB] Persist confidence + a review queue
- Migration in `/worksp/shared-db`:
  - Add `ai_tag_confidence numeric` (and optional `ai_tag_field_confidence jsonb`) to `assets`.
  - New table `ai_tag_review_queue (asset_id, model, payload jsonb, overall_confidence, reason, status, created_at, reviewed_by, reviewed_at, decision)`.
- Write path (`apps/worker/src/handlers/ai-tagging.ts`, `tagSingleAsset` ~line 148): still persist tags, but when `overall_confidence < admin_config.AI_TAG_REVIEW_THRESHOLD` (default 0.65) **or** a licensor/property/character was returned that failed a cross-check, also enqueue into `ai_tag_review_queue`.

### 3c. [APP] Sampling + review UI
- Even for high-confidence writes, enqueue a random **N%** sample (config `AI_TAG_SAMPLE_RATE`) so precision is measured continuously, not just on failures.
- Build a review tab in Settings > Processing (next to the Vision Bake-Off) that shows the thumbnail + proposed tags + confidence, with accept / correct / reject. Corrections write back to `asset_tags` (source `human`) and become labeled eval data.
- Track accept-rate per model → this is your live precision metric and feeds Bake-Off winner selection with real numbers instead of spot checks.

**Acceptance:** a dashboard shows rolling tag precision per model; low-confidence assets never silently poison search without a review path.

---

## 4. Recommendation 4 — Collapse the triplicated prompt/schema

**Problem.** Three copies of prompt + taxonomy-fetch + schema:
1. `apps/worker/src/handlers/ai-tagging-shared.ts` (worker + bake-off — already consolidated ✅)
2. `supabase/functions/ai-tag/index.ts` (Gemini-direct edge, 508 lines — third copy)

They have **already drifted**: the edge copy has an extra "7b. Product type" instruction the worker lacks, and uses plain `"string"` types where the worker uses nullable unions (`["string","null"]`). Two code paths now emit subtly different extraction contracts for the same task.

### 4a. [APP] Decide the edge function's fate
- **Preferred: retire it.** Per the model-selection brief, `supabase/functions/ai-tag/index.ts` is now only invoked by the older Windows-agent path. If the Windows/bridge agent can call the worker (or the worker's tagging entrypoint) instead, delete the edge function and route that path to the single shared implementation.
- **If it must stay** (e.g., the agent needs an HTTP endpoint that isn't the worker): extract the shared logic into a runtime-neutral module and have both consume it.

### 4b. [APP] Extract a shared, runtime-neutral tagging core
- The blocker is runtime: the worker is Node (`apps/worker`), the edge function is Deno (`supabase/functions`), and they call different providers (OpenRouter vs Gemini-direct). Extract the **provider-independent** pieces into a shared module:
  - `TAG_ASSET_SCHEMA` (single source of truth)
  - `buildImageTaggingPrompt` + all taxonomy/ERP/PDF-context fetching
  - `isStyleGuideSourcePdf` (the edge currently re-implements the filename check inline at `ai-tag/index.ts:477–483`)
- Options: publish as a tiny internal package imported by both, or (lighter) generate the schema/prompt from one canonical `.ts` + a codegen step checked in CI. Add a CI test that asserts the edge and worker schemas are byte-identical to prevent re-drift.
- Route the edge function through OpenRouter too (drop the direct Gemini call) so provider behavior is identical across paths.

**Acceptance:** exactly one definition of the prompt and schema; a CI check fails if a second copy diverges.

---

## 5. Recommendation 5 — Low-confidence high-res retry

**Problem.** The vision model only ever sees the **thumbnail** (`fetchImageData(asset.thumbnail_url)`, `ai-tagging-shared.ts:161`), not the full-resolution source. Reading small style numbers and distinguishing similar licensed characters is exactly where low resolution hurts, and there's no second pass.

### 5a. [APP] Full-res retry on weak results
- After the first pass in `tagSingleAsset` (`apps/worker/src/handlers/ai-tagging.ts:137`), if `overall_confidence < AI_TAG_HIRES_THRESHOLD` **or** `character_ids`/`licensor_id` came back empty for an asset that clearly should have them (e.g., path implies a licensed program), re-run once against a higher-resolution render.
- Source of the high-res image: reuse the render/thumbnail pipeline to produce a larger derivative (e.g., 1024–2048px) on demand rather than the standard small thumbnail. If only the small thumbnail exists, request a one-off larger render from the agent that already renders thumbnails.
- Keep it bounded: retry at most once, only for the low-confidence tail, so bulk cost stays on cheap Flash for the 90%+ that are fine.

### 5b. [APP] Record which tier produced the result
- Store `ai_tag_image_tier` (`thumbnail` | `hires`) alongside `ai_model` so the Bake-Off / review dashboard can measure how much high-res actually buys.

**Acceptance:** assets with unreadable-at-thumbnail style numbers or ambiguous characters get a measurable accuracy lift; bulk cost barely moves.

---

## 6. "Other architectural observations" — plans

### 6a. Smart-skip: one representative tagged per style group
**Observation.** `handleBulkAiTag` excludes whole `style_group_id`s that already have a tagged representative (`ai-tagging.ts:283–315`). So typically **one** asset per group is tagged; siblings are skipped, not enriched.
**Fix plan [APP]:**
- Verify the UI actually surfaces group-level metadata on sibling assets. If the grid reads per-asset columns (`ai_description`, `tags`, `asset_characters`), skipped siblings show blank → they're invisible to tag/character search even though the group is "tagged."
- Add a **propagation step**: after a representative is tagged, copy group-shared fields (character links, licensor/property, cover_description, tags) to siblings in the same `style_group_id` — or make search/display resolve through the group. Preferred: a `[DB]` view/materialized column that inherits group-level tags so search (which rides `search_text` per asset) sees them without duplicating rows.
- Add an admin toggle `AI_TAG_PROPAGATE_GROUP` to choose "tag one + propagate" vs "tag every asset."

### 6b. Single-image, single-turn, no self-verify
**Observation.** No mechanism catches systematic misrecognition (consistently wrong character) at scale.
**Fix plan:**
- Covered structurally by §3 (confidence + sampling review) — the sampling queue is the scale-level self-verify.
- Optional cheap add: for the high-value licensed-character fields only, a second lightweight verification call ("is character X actually present in this image? yes/no + confidence") on a sampled subset, logged to the review dashboard. Do **not** double every call — target the sampled/low-confidence tail to control cost.

### 6c. Provider coupling in the legacy edge path
**Observation.** `ai-tag/index.ts` calls Gemini directly, bypassing the OpenRouter gateway that makes models swappable from the admin panel.
**Fix plan [APP]:** folded into §4b — route the edge path through OpenRouter (or retire it) so model selection stays 100% admin-configurable with no code path pinned to one provider.

---

## 7. "Two other confirmations" — plans

### 7a. No search-by-character exists anywhere
**Confirmation.** `asset_characters` is written by the tagger and **never queried for discovery**; there is no search-by-character path. All character-linking work is currently display/filter-only.
**Fix plan:**
- §2a already makes character **names** full-text- and semantic-searchable (free-text "groot" works).
- Add explicit **structured** character discovery for power users [APP]:
  - A character facet in the library filter rail (like the existing licensor/property facets in `useFilterOptions`), backed by a `[DB]` `get_character_facets` RPC (character → asset_count, scoped to current filters).
  - A `filters.characterId` filter in `useAssets.ts` `applyFilters` that joins `asset_characters` (mirror the `licensorId`/`propertyId` handling at lines 134–139).
- This turns the character taxonomy from write-only metadata into a first-class browse dimension ("show me every asset with Elsa").

### 7b. Edge/worker prompt drift (item "7b", nullable vs plain types)
**Confirmation.** The third copy isn't just redundant — it emits a **different extraction contract** (extra "7b. Product type" instruction; plain `"string"` vs nullable unions), so the two paths can produce structurally different outputs for the same asset.
**Fix plan:** fully covered by §4 (single source of truth + CI byte-identical assertion). Until §4 lands, do an **immediate reconciliation** [APP]: manually sync `ai-tag/index.ts`'s prompt item list and schema types to match `ai-tagging-shared.ts` so the two contracts converge in the interim.

---

## 8. Suggested sequencing

Ordered by impact-per-effort and dependency:

1. **§2 (tags/characters into `search_text`)** — [DB], smallest change, unlocks metadata already paid for. Highest ROI. Ship first.
2. **§1 (semantic search on)** — [DB backfill] + [APP wiring]. The RPC/index/edge already exist; biggest UX win for non-technical users. Includes the §1d relevance-ordering fix.
3. **§7a character facet** — cheap [APP] add once §2 lands; big findability gain.
4. **§4 de-duplication + §7b reconciliation** — removes drift/correctness risk before adding more to the schema.
5. **§3 confidence + review queue** — gives you the measurement to trust everything above.
6. **§5 high-res retry** and **§6a group propagation** — accuracy/coverage polish once measurement (§3) exists to prove they help.

## 9. Cross-cutting

- **Feature flags:** `SEARCH_MODE`, `AI_TAG_REVIEW_THRESHOLD`, `AI_TAG_SAMPLE_RATE`, `AI_TAG_HIRES_THRESHOLD`, `AI_TAG_PROPAGATE_GROUP` — all in `admin_config`, all defaulting to current behavior so each item ships dark.
- **Testing:** extend `src/test/asset-search.test.ts` and `style-group-search.test.ts` with tag-only and character-only query cases (§2) and a relevance-ordering case (§1d). Add a worker test for the confidence/review-enqueue branch (§3).
- **Every [DB] item** goes through `/worksp/shared-db` (branch + PR + timestamped migration + preview) and is merged **before** the matching [APP] change is written here. Backfills batched ~20k to avoid compute timeouts.
- **No workarounds:** if the `gte-small` edge embedding or the render pipeline for high-res isn't reachable in an environment, stop and report the missing capability rather than silently degrading (per project policy).
