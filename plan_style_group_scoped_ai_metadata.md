# Style-Group-Scoped AI Metadata Implementation Plan

Implementation tracker: [GitHub issue #96](https://github.com/u2giants/popdam3/issues/96)
Registered handoff: [`HANDOFF.d/2026-08-24T1402Z-hetz-codex-scoped-ai-metadata-plan.md`](HANDOFF.d/2026-08-24T1402Z-hetz-codex-scoped-ai-metadata-plan.md)

## STATUS — read this first

Fresh sessions start at **Step 1**. Re-read the remaining downstream phases before each marked context cut; do not re-derive completed steps.

| Step | Status | Date | Evidence / next action |
|---|---|---|---|
| 1. Reconfirm baseline and capture fixtures | ⬜ open | 2026-08-24 | Start with the commands and fixture contract in §9 Step 1. |
| 2. Land the governed shared-db contract | ⬜ open | 2026-08-24 | Route the exact objects in §9 Step 2 through the single `u2giants/shared-db` orchestrator. |
| 3. Add typed scope/category policy and structured contracts | ⬜ open | 2026-08-24 | Implement §9 Step 3 only after the shared-db contract is merged/applied. |
| 4. Build the Style Group profile pass | ⬜ open | 2026-08-24 | Implement §9 Step 4. |
| 5. Convert per-file tagging to asset-only visual analysis | ⬜ open | 2026-08-24 | Implement §9 Step 5. |
| 6. Replace propagation with group-metadata refresh | ⬜ open | 2026-08-24 | Implement §9 Step 6; do not remove the user capability. |
| 7. Combine scopes in search and UI | ⬜ open | 2026-08-24 | Implement §9 Step 7 and visually verify both detail panels. |
| 8. Backfill safely and run a bounded production pilot | ⬜ open | 2026-08-24 | Implement §9 Step 8 with exact-target proof and before/after evidence. |
| 9. Full rollout and exact-SHA verification | ⬜ open | 2026-08-24 | Implement §9 Step 9 only after pilot acceptance gates pass. |
| 10. Documentation, issue closure, and handoff retirement | ⬜ open | 2026-08-24 | Implement §9 Step 10 after production verification. |

---

## 1. The ultimate goal

Every PopDAM file must become useful in search without receiving false metadata copied from another file in the same Style Group.

When this work is complete:

- facts that describe the licensed product or SKU—licensor, property, product type, authoritative item description, product category, and supported group artwork concepts—will belong to the Style Group;
- facts that describe one file—photograph versus tech pack, view, visible characters, colors, scene, readable text, artwork placement, and visual treatment—will belong only to that asset;
- searching an asset will use the union of its group facts and its own file facts without physically duplicating group facts onto every member;
- the interface will explain whether a tag came from the Style Group or “This file,” plus its source where useful;
- manual and authoritative business data will always outrank AI suggestions;
- every thumbnail-backed asset will receive its own lightweight visual classification, while files without a usable preview will still benefit from group metadata and will be explicitly marked “visual analysis unavailable,” never falsely marked analyzed.

**If a step conflicts with this goal, the goal wins—stop and flag it.** Do not preserve a legacy behavior merely because this plan names a file that has drifted.

## 2. What this application is

PopDAM is POP Creations’ internal Digital Asset Manager for licensed consumer-product artwork. Designers, salespeople, production staff, and administrators use it to find product artwork, photographs, renders, mockups, technical documents, and source art grouped by SKU.

- Repository: `u2giants/popdam3`
- Normal local path: `/worksp/popdam`
- App branch policy: direct, focused commits to `main`
- Web app: React/Vite/TypeScript under `src/`
- Production UI: `https://dam.designflow.app`
- PopSG sibling mode: `https://sg.designflow.app`; this plan must not change PopSG semantics
- AI/bulk worker: Node/TypeScript under `apps/worker/`, deployed by Railway from `main`
- Edge/admin functions: Supabase Deno functions under `supabase/functions/`
- Shared backend: Supabase project resolved from protected configuration; the production project documented by this repo is `qsllyeztdwjgirsysgai`
- Canonical database-structure repository: `u2giants/shared-db`, normally `/worksp/shared-db`
- Image tagging model selection: `admin_config.AI_TASK_MODELS`; OpenRouter requests use the shared capability planner and structured-output executor

A **Style Group** represents one SKU and contains all related assets. An **asset** is one file. `asset_tags` currently stores normalized per-file tag rows and `assets.tags` is a trigger-maintained denormalized array used by filters.

## 3. What triggered this work

On 2026-08-23 Albert asked how AI tagging could work for all assets when some facts apply to every file in a Style Group—licensor, property, product type, product description, and product artwork—while other facts must remain file-specific—tech pack versus professional photograph, view, scene, and similar visual properties.

Repository inspection confirmed that PopDAM already has a two-level foundation but still produces one flat AI tag list and relies on propagation from one primary asset. The current production behavior can be observed in either detail panel:

1. Open `https://dam.designflow.app` and select a Style Group with multiple dissimilar member files, such as a tech pack, product photograph, and mockup.
2. Open different files inside the group.
3. The UI shows flat `assets.tags`; the group panel offers **Sync Tags to All Group Members**.
4. Running the legacy propagation can apply group-looking tags or descriptions from the primary file to visually different siblings.

This is a feature/data-quality workstream tracked by [issue #96](https://github.com/u2giants/popdam3/issues/96), not a currently declared production incident.

## 4. Scope

### In scope

- A formal ownership policy for group versus asset facts.
- A governed `style_group_tags` data contract with source, category, confidence, status, and evidence.
- Extending `asset_tags` with category/confidence/model/evidence metadata while preserving existing manual tags and the `assets.tags` compatibility array.
- A Style Group AI profile/description that is distinct from authoritative `item_description` and from each asset’s visual descriptions.
- A group-profile AI pass using authoritative metadata, text extraction, and a bounded representative contact sheet.
- A per-asset AI pass that returns only file-specific visual facts.
- Candidate/approval rules for uncertain group-level AI assertions.
- Search rollups that combine group and asset terms at query/index time without copying rows.
- Scope/source labels and safe editing controls in Style Group and Asset detail UI.
- Replacement of legacy propagation with an equivalent **Refresh Group Metadata** capability.
- Safe migration/backfill, bounded pilot, rollback, tests, docs, CI, deployment, and exact-SHA verification.

### NOT in this plan

- Changing which OpenRouter model is selected or redesigning the capability planner; `plan_ai_model_interaction_reliability.md` owns that.
- Changing restart-safe OpenRouter Batch API mechanics; `plan_openrouter_batch_restart_recovery.md` owns that. This plan must consume that work if already landed and must not regress it.
- Replacing DAM search architecture, enabling embeddings, or removing current full-text compatibility wrappers.
- Retagging PopSG or changing PopSG folder semantics.
- Reclassifying the company-wide licensor/property/character taxonomy.
- Treating every character shown in one file as a group-wide character.
- Inferring group facts from a single primary asset.
- Destructive deletion of old tags before the new read/search path is proven.
- Broad UI redesign outside the two detail panels and the existing AI-tagging/operations controls.
- Direct production SQL, app-repo migrations, or any schema work outside `u2giants/shared-db`.

## 5. Current state of the code and deployments

The investigation baseline is PopDAM `main` at `dfe25d6909809648218f3c54afd7909b70e1c641`, which matched `origin/main` when code inspection began on 2026-08-24. Concurrent work advanced `main` before publication; this plan package first landed as `cec4ce39`. A future implementer must fetch and drift-check the current head; do not assume either SHA remains current.

What already exists:

- The canonical tag schema returns a flat `tags: string[]` alongside `ai_description`, `scene_description`, and `content_type` in `supabase/functions/_shared/tag-asset-contract.js:18-52`.
- The prompt explicitly mixes group-like product/property facts with file-like view, image category, style, motif, and color facts in `tag-asset-contract.js:123-168`.
- The worker fetches group/SKU context, calls the shared structured-output path, writes asset fields, deletes prior AI tag rows, and upserts new `asset_tags` in `apps/worker/src/handlers/ai-tagging.ts:136-241` and the corresponding normal-path implementation later in the same file. Both synchronous and durable-batch result application must be changed together.
- `asset_tags` currently has `asset_id`, `tag`, `source`, creator, and timestamps only; generated current shape is visible at `src/integrations/supabase/types.ts:611-645`. `assets.tags` remains the fast denormalized array at `types.ts:646-715`.
- A first two-level metadata release is already deployed: `style_groups.item_description` is product-level and `assets.content_type` is file-level. Canonical migrations are `/worksp/shared-db/supabase/migrations/20260714203100_dam_style_group_item_description.sql`, `20260714203200_dam_asset_content_type.sql`, and `20260714203300_dam_two_level_metadata_search.sql`.
- Rich PDF extraction stores raw PDF facts, rolls product facts into `style_groups.rich_metadata`, projects selected facets, and refreshes search through `/worksp/shared-db/supabase/migrations/20260715183000_dam_rich_pdf_extraction.sql` and `apps/worker/src/handlers/rich-pdf.ts:233-328`.
- The asset UI already labels `style_groups.item_description` as Product and displays file descriptions separately in `src/components/library/AssetDetailPanel.tsx:826-842`.
- The Style Group panel loads every member at `StyleGroupDetailPanel.tsx:517-529`, displays one selected file’s flat tags at `:1170-1205`, and displays its descriptions at `:1209-1260`.
- The asset search fallback uses `cover_description`, `ai_description`, and `scene_description` at `src/hooks/useAssets.ts:41-67`; group fallback columns are defined at `src/hooks/useStyleGroups.ts:63-90`. Normal indexed search goes through shared-db search-document refresh functions.
- The legacy Edge helper `supabase/functions/_shared/tag-propagation.ts:1-228` filters a hard-coded phrase denylist and copies selected fields/tags/characters to siblings. The active bulk worker calls the database RPC through `apps/worker/src/handlers/tag-propagation.ts:1-45`.
- Bulk-operation conflict protection between AI tagging, group rebuild, and propagation exists in `apps/worker/src/operation-loop.ts` and `supabase/functions/_shared/operation-constants.ts`; it must evolve with the new operations rather than be removed.

Exact live deployment of this planning baseline was not re-proven because this session changed documentation only. GitHub/Railway deployment evidence from other open handoffs must not be treated as proof for the eventual implementation. Step 9 requires exact-SHA production proof.

## 6. Key findings and root cause

1. **The output contract has no scope.** A string such as `backpack`, `Frozen`, `professional photography`, or `blue` carries no machine-readable statement about whether it belongs to the SKU or one file. The writer cannot make a safe propagation decision.
2. **The propagation classification is an exact-text blacklist.** `supabase/functions/_shared/tag-propagation.ts:21-49` excludes a limited list. Current controlled prompt terms such as `professional photography`, `straight view`, `3/4 view`, `close-up view`, `lifestyle / in-use image`, `person holding item / size scale image`, and `embellishment placement design` are absent or not exact matches, so vocabulary drift can leak file facts across a group.
3. **The source of truth is the primary asset.** `docs/STYLE_GROUPS.md:49-106` describes propagating primary-asset facts. A primary is chosen for card quality, not because it is an authoritative summary of every sibling.
4. **There is a code/comment contradiction.** `tag-propagation.ts:13-16` says `ai_description` must not propagate, but `:159-169` copies it into blank siblings. A tech pack, mockup, and photograph can therefore share a description that belongs to only one file.
5. **Characters are not safely group-wide.** The legacy path copies every primary asset character association. A SKU folder may contain variants or source art showing different characters. Visible character links must remain asset-specific; a group-level character concept must be separately supported and labeled.
6. **Manual tags can be endangered by ambiguous upsert behavior.** AI writes delete only `source = 'ai'` and then upsert on `(asset_id, tag)` at `apps/worker/src/handlers/ai-tagging.ts:219-223`. If a manual row already owns the same key, AI must not change its source or provenance.
7. **Search already has the right architectural seam.** Shared search documents already combine asset and Style Group metadata. Extending the refresh functions to include `style_group_tags` is safer than duplicating tags across all assets.
8. **Files without thumbnails need honest partial coverage.** Current tagging fails/skips when no thumbnail is available. Those assets can inherit searchable group context at query time, but must not receive invented file-level analysis or a false `ai_tagged_at` success.

Root cause: PopDAM models AI output as “tags attached to a file” and then tries to infer scope after generation. Scope, category, provenance, confidence, and evidence must instead be part of the data contract before anything is persisted or searched.

## 7. Approaches considered and rejected

1. **Keep one flat tag array and expand the blacklist.** Rejected because every new synonym or model phrase recreates the leak; it is impossible to prove complete.
2. **Ask the model to prefix strings with `group:` or `asset:` but keep the same storage.** Rejected because free-form prefixes are presentation conventions, not enforceable ownership, provenance, or query semantics.
3. **Copy group tags to every asset with a new boolean scope column.** Rejected because changes fan out to thousands of rows, drift when assets move groups, create lock contention, complicate removal, and obscure the original source.
4. **Use the primary asset as the group summary.** Rejected because primary selection optimizes preview quality and tagged-age ordering; it does not establish product truth or cross-file consensus.
5. **Treat characters, colors, motifs, or design style as automatically group-wide.** Rejected because variants within a SKU can legitimately differ. These remain asset facts unless authoritative evidence or multi-file corroboration creates a separate group fact.
6. **Replace authoritative Master Data/ERP descriptions with AI prose.** Rejected because AI should enrich discoverability, never override business truth. The AI artwork summary must be a separate labeled field.
7. **Tag only one representative file per group.** Rejected because file type, view, scene, colors, and visible artwork still differ; every previewable asset needs its own lightweight pass.
8. **Run all assets through an expensive full group+file prompt.** Rejected because it repeatedly asks the model to rediscover stable group facts, increases inconsistency and cost, and makes authoritative versus inferred facts harder to distinguish.
9. **Delete legacy tags and propagation immediately.** Rejected because rollback and comparison would be impossible. The rollout must dual-read/measure first, then stop legacy writes, then clean up only after acceptance.
10. **Expose the private `dam` schema to PostgREST.** Rejected. Existing shared-db guidance requires public, narrowly granted RPC wrappers for worker access rather than broadening every app’s API surface.

## 8. Design decisions

### Locked decisions — do not relitigate

These decisions were made on 2026-08-24 from Albert’s requested semantics and the repository findings above.

1. **Ownership is physical, not inferred later.** Group facts live in `style_group_tags`/Style Group fields; file facts live in `asset_tags`/asset fields. No group tag rows are copied onto assets.
2. **Effective search is a union at read/index time.** For an asset, searchable metadata is its Style Group facts plus its own facts. The UI shows both scopes separately.
3. **Structured business identity outranks tags.** Licensor/property/product identity remains in canonical structured fields and authoritative descriptions. Search may surface equivalent labels, but AI cannot overwrite those fields.
4. **Manual > authoritative system source > corroborated group AI > single-file AI.** Lower-priority writers never overwrite higher-priority facts. A manual delete/rejection must not reappear on the next run without a new human action.
5. **Visible characters remain asset-specific.** A group-level character term is a separate candidate/approved group tag supported by evidence; it does not rewrite `asset_characters` on siblings.
6. **Descriptions remain distinct.** `style_groups.item_description` is authoritative product identity; `style_groups.group_ai_description` is a concise artwork/theme summary; `assets.ai_description` is a search-friendly description of that file; `assets.scene_description` is literal visible content.
7. **AI group assertions are candidates by default.** An AI group tag becomes active automatically only when at least two distinct representative assets are cited and confidence is at least `0.85`; otherwise it stays `candidate`. Manual approval can promote it. Thresholds are configuration constants with tests, not prompt-only prose.
8. **No-preview files receive group search context only.** They retain a visible unanalysed state; no synthetic file tags, scene, content type, or `ai_tagged_at` are written.
9. **Preserve the capability.** “Sync Tags to All Group Members” becomes “Refresh Group Metadata.” It recomputes group facts/search documents and never copies file facts.
10. **The production tagging and Vision Bake-Off contract stay aligned.** Bake-off evaluates the new asset-only structured output path; group profiling gets its own bounded evaluation fixture rather than silently changing bake-off meaning.
11. **Schema changes are additive and governed.** They originate in `u2giants/shared-db`; PopDAM app changes wait until the canonical migration is merged and applied through the approved preview-first workflow.

### Open implementation judgments — use these criteria without asking Albert

- Exact SQL object names may change if `shared-db` conventions require it, but the ownership, priority, and no-copy semantics above may not change.
- The representative selector may choose 4–8 assets. Prefer primary plus distinct `content_type`/file-family/view candidates; cap total image bytes and prompt cost. A deterministic selector with fixture tests is required.
- Tag-category names may be refined for clarity, but must at minimum distinguish `product_type`, `property`, `character`, `theme`, `motif`, `visual_style`, `color`, `content_type`, `view`, `artwork_placement`, `readable_text`, and `other`.
- UI colors/icons are a design judgment. Labels must remain explicit: **Style Group**, **This file**, **Candidate**, and source/provenance on hover or detail.

## 9. Numbered implementation plan

### Phase A — establish the contract

#### Step 1 — Reconfirm baseline and capture regression fixtures

**Change/inspect:**

- Read `AGENTS.md`, this plan’s STATUS table, every open `HANDOFF.d/` entry relevant to AI tagging, `docs/STYLE_GROUPS.md`, `docs/BULK_JOBS.md`, `docs/MODEL_RULES.md`, and `/worksp/shared-db/AGENTS.md`.
- Fetch `origin/main`; inspect `git status --short --branch`, `git log -1`, active AI-tagging plans, and the current shared-db status. Preserve concurrent changes and use an isolated current worktree if the ordinary checkout is dirty.
- Capture sanitized, repository-safe fixtures under `apps/worker/src/fixtures/ai-tagging-scope/` for at least three Style Groups, each containing dissimilar assets: tech pack + photograph + mockup; source art + product render; multiple character/color variants. Store IDs as synthetic UUIDs and image inputs as tiny synthetic fixtures or mocked image descriptors—never licensed artwork.
- Add failing characterization tests to `apps/worker/src/handlers/ai-tagging-scope.test.ts` proving the legacy flat contract cannot distinguish group and file facts, and a test proving manual-tag collisions must remain manual.
- Record read-only baseline counts in a dated file under `verification/ai-tagging-scope/<UTC>/baseline.md`: total non-deleted assets, thumbnail-backed assets, untagged assets, Style Groups, group-size distribution, AI/manual tag counts, and counts of known file-specific controlled phrases found on more than one sibling. Use only aggregate counts and synthetic examples; do not commit licensed filenames/content.

**Dependencies:** none. This step is read-only except repository fixtures/tests. It can run while the shared-db issue is being triaged.

**Verification gate:** `cd apps/worker && npm test` passes existing tests and the new characterization test suite demonstrates the intended red/green boundary without contacting an AI provider. The baseline file names the exact query/command and target proof used to derive every count.

#### Step 2 — Land the governed shared-db contract first

**Route, do not self-author from the app session:** open a new `u2giants/shared-db` issue labeled `db-work` that names issue #96 and requests these exact semantics. The single shared-db orchestrator owns branch, timestamp, SQL, preview proof, PR, merge, production promotion approval, consumer sync, and canonical migration note.

**Required logical objects:**

- `public.style_group_tags` with UUID PK, `style_group_id` FK with cascade, normalized `tag`, controlled `category`, controlled `source`, `status` (`active`, `candidate`, `rejected`), nullable confidence constrained `0..1`, `ai_model`, evidence JSONB, creator/timestamps, and uniqueness that prevents duplicate active facts while preserving manual authority/history.
- Add nullable metadata columns to `public.asset_tags`: controlled `category`, confidence `0..1`, `ai_model`, evidence JSONB, and update timestamp. Preserve existing `source`, creator, and `(asset_id, tag)` compatibility. Backfill existing manual rows as category `other`/manual provenance and existing AI rows as `legacy_unscoped`; do not guess a safe scope from text.
- Add `style_groups.group_ai_description`, `group_ai_description_source`, `group_ai_model`, `group_ai_tagged_at`, and evidence asset IDs (array or JSONB per shared-db convention). Do not alter `item_description`.
- Add narrow service-role RPCs for atomic group-profile replacement and atomic asset-AI-result replacement. They must preserve manual rows, replace only the calling AI source/model’s prior rows, validate categories/status/confidence/evidence, refresh search documents, and be retry/idempotency safe.
- Extend `refresh_dam_search_asset_document`, `refresh_dam_search_style_group_document`, `rebuild_dam_search_documents`, and their triggers so asset documents contain active Style Group tags plus asset tags; group documents contain active group tags plus member-specific text as currently intended. Candidate/rejected tags must not enter ordinary search.
- Provide a read contract for UI effective tags, either a narrowly scoped RPC or a view allowed by current RLS. It must return scope, category, source, status, confidence, and manual ownership without copying rows.
- Add indexes for group/status/category/tag lookup and preserve the existing `assets.tags` trigger contract for asset-only tags.
- Do **not** drop or rewrite the historical `propagate_group_tags_batch` in the first migration. Add the new path first so rollback remains possible.

**Dependencies:** Step 1 inventory informs fixture sizes. No dependent PopDAM code lands before this schema is merged/applied according to `/worksp/shared-db/AGENTS.md`.

**Verification gate:** shared-db `scripts/check-sql.sh` passes; preview applies cleanly after immediate target proof; transaction-rolled-back fixture tests prove manual-wins behavior, candidate exclusion, active group tag inclusion in member search, asset-only tag isolation, idempotent replacement, group reassignment behavior, and RLS/service-role access; the merged migration and canonical app note are present on shared-db `main`; production application is performed only through the orchestrator’s current approval procedure and exact ledger/object checks are recorded.

**Fresh-session cut:** after Step 2, use the `fresh-session` skill if context is crowded. The successor must reread Steps 3–10 and confirm the merged database names before editing app code.

#### Step 3 — Add one typed scope/category policy and two structured contracts

**Change:**

- Create `apps/worker/src/tagging-metadata-policy.ts` as the one runtime vocabulary for scope, categories, source priority, confidence/status promotion, and normalization. Do not scatter lists between prompt, writer, UI, and propagation.
- Replace the flat output in `supabase/functions/_shared/tag-asset-contract.js` with an asset-only result containing `asset_tags: [{ tag, category, confidence, evidence }]` plus `ai_description`, `scene_description`, `content_type`, asset-only structured fields, visible `character_ids`, and document-specific extracted names/files. Remove group identity from the model’s writable output; provide it as read-only context.
- Add `supabase/functions/_shared/tag-style-group-contract.js` for `group_ai_description` and `group_tags: [{ tag, category, confidence, evidence_asset_ids }]`. Its prompt receives authoritative structured facts, rich PDF summary, and representative asset descriptors/images; it must prohibit rewriting licensor/property/product identity.
- Update `.d.ts` declarations, Gemini schema conversion, `apps/worker/src/handlers/ai-tagging-shared.ts`, `ai-tag-bakeoff.ts`, and all schema-validation tests. Keep structured-output capability routing untouched.
- Add pure helpers that turn authoritative `style_groups`/ERP/rich-PDF fields into always-active group facts without an AI call. AI does not need to “discover” facts already known.

**Dependencies:** Step 2’s exact database/RPC contract.

**Verification gate:** root `npm test -- --run src/test/tag-asset-contract.test.ts src/test/tag-asset-gemini-schema.test.ts` and worker `npm test` pass. Tests reject a group-scoped category in an asset result, reject file-only categories in a group result, validate confidence/evidence, and prove manual/authoritative priority. No model-name branching is added.

### Phase B — build group and asset writers

#### Step 4 — Build the Style Group profile pass

**Change:**

- Add `apps/worker/src/handlers/ai-style-group-profile.ts` and tests.
- Add a deterministic representative selector in `apps/worker/src/style-group-representatives.ts`. Select primary plus diversity by existing content type, extension/file family, filename view hints, and thumbnail availability; deduplicate near-identical candidates using available stable metadata, never `quick_hash` as a content-unique key; cap at 4–8 images and a bounded total payload.
- Assemble context from `style_groups.item_description`, structured licensor/property/product fields, `rich_metadata`, SKU/folder facts, and representative asset IDs. Use existing public RPC wrappers for private `dam` data; never expose the schema.
- Write authoritative derived facts as active. Write AI profile terms as `candidate` unless the locked two-evidence/0.85 rule is met; write evidence asset IDs and model provenance. Preserve manual approvals/rejections on rerun.
- Register `ai-tag-group-profiles` in `apps/worker/src/operation-loop.ts`, `supabase/functions/_shared/operation-constants.ts`, admin operation labels/config, and conflict maps. It must conflict with `rebuild-style-groups`, asset AI-tag operations, and legacy propagation while they share affected rows/search refreshes.
- Use durable operation state and the already-landed restart-safe batch framework if available. Never introduce a second in-memory external-job state machine.

**Dependencies:** Step 3. Can be developed in parallel with Step 5 after shared types and RPCs are fixed.

**Verification gate:** fixture tests prove deterministic representative selection, bounded payload, two-file corroboration, candidate preservation, manual rejection preservation, idempotent reruns, and restart-safe resume. Worker `npm test` and `npm run build` pass. A mocked group with a tech pack, photo, and mockup produces one group artwork summary without assigning file type/view/color to the group.

#### Step 5 — Convert per-file tagging to asset-only visual analysis

**Change:**

- Update both result writers in `apps/worker/src/handlers/ai-tagging.ts`—durable batch `applyBatchTagResult` and the normal single/per-item path—to call the atomic asset-result RPC. Do not leave divergent writers.
- Update `buildImageTaggingPrompt` in `ai-tagging-shared.ts` to load group context once and clearly mark it read-only. The model should classify only this file’s content type, view, visible characters, visible colors/motifs/style, artwork placement, readable text, `ai_description`, and literal `scene_description`.
- Preserve document extraction fields whose evidence is one file. Do not propagate designer/freelancer names or `files_used` through tags; existing intentional rollups remain separate and conflict-aware.
- AI replacement deletes/replaces only prior AI-owned asset rows. If the same normalized tag is manual, the manual row survives and no AI upsert changes its source.
- Keep `assets.tags` as asset-only compatibility data. Do not append Style Group tags to it.
- For no-thumbnail assets, return a visible `visual_analysis_unavailable` outcome/counter without writing false tag status or descriptions. Search still finds them through the group document/relationship.
- Update bake-off storage/display to show structured asset-only categories while preserving its rule that it mirrors production tagging behavior.

**Dependencies:** Step 3; may run in parallel with Step 4.

**Verification gate:** worker tests cover normal, single-asset, and durable-batch writers; manual collision; re-tag removal of stale AI rows only; character isolation; no-thumbnail behavior; malformed output; provider fallback; and crash/resume. A three-file fixture proves the photograph alone receives photography/view/color tags, the tech pack alone receives technical-document facts, and all three remain searchable by the group product/property terms.

#### Step 6 — Replace propagation with group-metadata refresh

**Change:**

- Change `apps/worker/src/handlers/tag-propagation.ts`, `supabase/functions/_shared/admin-handlers/tag-propagation-handlers.ts`, admin labels, and UI action semantics from copying primary tags to refreshing authoritative/group AI facts and search documents.
- Keep the old operation key/API temporarily as a compatibility alias that invokes the safe refresh and emits a deprecation diagnostic; it must never copy asset rows. Add a new canonical `refresh-group-metadata` operation key.
- Remove `supabase/functions/_shared/tag-propagation.ts` only after searches show no live import/caller and compatibility tests prove the alias. The shared-db orchestrator may retire `propagate_group_tags_batch` in a later additive migration after production has run one full cycle safely.
- Update conflict maps and progress terminology from “assets propagated” to “groups refreshed.” Preserve stop/resume/diagnostics capability.
- Replace the panel button label and confirmation text. Do not silently remove the user’s ability to refresh a group.

**Dependencies:** Steps 4–5.

**Verification gate:** tests prove invoking either old alias or new operation never inserts/updates/deletes sibling `asset_tags`, `asset_characters`, `ai_description`, `scene_description`, `content_type`, or asset visual fields; it does refresh group facts/search and reports group counts. A repository `rg` finds no production path calling the legacy copy helper.

**Fresh-session cut:** after Step 6, update STATUS/evidence and use `fresh-session` if needed. The successor rereads Steps 7–10 and the exact deployed schema/worker state.

### Phase C — search, UI, rollout

#### Step 7 — Combine scopes in search and UI

**Change:**

- Add typed query helpers/hooks for effective tags, preferably `src/hooks/useEffectiveAssetTags.ts`, using the Step 2 read contract. Keep `useAssets.ts`/`useStyleGroups.ts` indexed search as the primary path; update fallback columns only if the shared-db contract exposes safe text fields.
- In `src/components/library/AssetDetailPanel.tsx`, show separate sections/chips for **Style Group** and **This file**. Manual editing defaults to “This file,” with an explicit scoped control for authorized group edits. A group edit must not masquerade as asset data.
- In `src/components/library/StyleGroupDetailPanel.tsx`, show the authoritative Product description, AI Artwork Summary, active group tags, candidates awaiting review, and the selected file’s tags/descriptions separately. Replace **Sync Tags to All Group Members** with **Refresh Group Metadata**.
- Add approve/reject/promote/demote controls for authorized users through admin-api handlers with server-side role checks and audit provenance. Manual rejection survives future AI runs.
- Show source labels/tooltips (Manual, Master Data, ERP, Rich PDF, Group AI, File AI) and confidence only where it helps review; do not burden normal browsing with raw JSON.
- Update tag filters so selecting an effective group tag returns member assets without adding it to `assets.tags`. Preserve file-only tag filtering.
- Extend `docs/UI_OVERVIEW.md` after behavior is verified.

**Dependencies:** Steps 4–6 and shared search refresh.

**Verification gate:** component tests cover scope rendering, default asset edit, explicit group edit, candidate approval/rejection, manual protection, and no-preview messaging. Run `npm test`, `npm run lint`, and `npm run build`. Start the app per `docs/development.md` and visually verify desktop and narrow panels using a synthetic/local dataset: each file shows common group chips plus different file chips, and changing one file tag does not change siblings. Save screenshots under `verification/ai-tagging-scope/<UTC>/ui/`.

#### Step 8 — Backfill safely and run a bounded production pilot

**Change/run:**

- Before every database write, prove the exact target by the current shared-db/application procedure and record the project ref without credentials.
- Backfill existing rows non-destructively: manual asset tags retain ownership; existing AI rows become `legacy_unscoped` and remain searchable during comparison; authoritative group facts are derived deterministically; no legacy text is automatically promoted to a group fact.
- Select a bounded pilot of 20–50 Style Groups covering single/many assets, photos, source art, renders, tech packs, multiple characters/colorways, no thumbnails, and at least one large group. Use existing production assets only within approved internal systems; do not export licensed images to new services.
- Run group profiling, then per-file tagging on the pilot. Store a before/after manifest of IDs and metadata hashes in protected operational evidence; commit only aggregate/synthetic results.
- Human-review a fixed scorecard: zero file-category/view leakage across siblings; authoritative licensor/property/product facts unchanged; manual tags unchanged; candidate behavior correct; descriptions correctly separated; search finds all members via group terms and only relevant files via file terms; cost/latency within agreed existing tagging budget.
- Do not delete legacy rows or run the whole library if any critical criterion fails. Fix, rerun the same pilot idempotently, and update this plan.

**Dependencies:** Steps 2–7 deployed in correct order: schema first, then worker/API/UI.

**Verification gate:** a dated `verification/ai-tagging-scope/<UTC>/pilot-summary.md` cites the exact deployed SHA, target proof, operation IDs, aggregate before/after queries, test assets by protected internal IDs only, screenshots, and every scorecard result. Critical acceptance is 100% for manual preservation, structured identity preservation, and zero cross-file leakage in the reviewed pilot; anything lower blocks Step 9.

#### Step 9 — Full rollout and exact-SHA verification

**Change/run:**

- Roll out in resumable batches: deterministic group facts, group profiles, then asset visual passes. Use operation lanes/conflicts and restart-safe state. Never run legacy propagation concurrently.
- Monitor completed/failed/unavailable counts, provider cost, retry/fallback rate, database errors/locks, search-refresh lag, and Railway restarts. Failure counters must reconcile to every attempted asset/group.
- Keep legacy unscoped tags searchable only for the bounded transition window. After full coverage and review, run a preview/count-only cleanup, then remove or archive only AI-owned legacy rows. Never delete manual rows.
- Push focused PopDAM commits to `main`; verify GitHub CI, Railway worker deployment for the exact worker SHA, frontend image workflow, Coolify activation, and live build SHA/header at `dam.designflow.app`. A green Railway deployment proves worker only, not frontend.
- Run bounded live smoke checks: group-term search, file-term search, group panel, two sibling asset panels, one no-preview asset, one manual edit, one candidate approval, and one safe re-tag.

**Dependencies:** Step 8 acceptance.

**Verification gate:** CI is green for the exact commit; Railway and frontend/Coolify each prove the relevant exact SHA; production aggregates reconcile; no active legacy propagation operation exists; smoke evidence is stored under `verification/ai-tagging-scope/<UTC>/production.md`; and rollback remains possible until cleanup is separately proven.

#### Step 10 — Documentation, issue closure, and handoff retirement

**Change:**

- Update `AGENTS.md`, `docs/STYLE_GROUPS.md`, `docs/BULK_JOBS.md`, `docs/MODEL_RULES.md`, `docs/SCHEMA.md`, `docs/architecture.md`, `docs/UI_OVERVIEW.md`, and relevant configuration/deployment docs with verified final behavior only.
- Update this STATUS table after every executed step with artifact-backed evidence; do not leave pre-implementation claims marked current.
- Add the canonical shared-db migration note and exact merged/apply evidence links.
- Close issue #96 only after Definition of Done passes.
- Delete `HANDOFF.d/2026-08-24T1402Z-hetz-codex-scoped-ai-metadata-plan.md` in the completion commit; git history retains it. Remove this plan’s active-router links only when work is genuinely complete or replace them with the durable topic-doc link.

**Dependencies:** Step 9.

**Verification gate:** repo docs describe the same live behavior observed in production, issue #96 is closed with exact evidence, the open handoff is retired, git status is clean apart from separately owned work, and `origin/main` contains the completion commit.

## 10. Tests required

### Worker/unit contract tests

- `apps/worker/src/tagging-metadata-policy.test.ts`
  - category-to-scope validation;
  - normalization and duplicate handling;
  - source priority/manual wins;
  - 0.85/two-distinct-evidence promotion;
  - candidate/rejection persistence.
- `apps/worker/src/style-group-representatives.test.ts`
  - deterministic representative order;
  - diversity and 4–8 cap;
  - duplicate avoidance without treating `quick_hash` as unique;
  - no-thumbnail and oversized payload handling.
- `apps/worker/src/handlers/ai-style-group-profile.test.ts`
  - authoritative facts require no AI;
  - product identity cannot be overwritten;
  - group-only category enforcement;
  - atomic/idempotent rerun and restart.
- Extend `apps/worker/src/handlers/ai-tagging.test.ts`
  - normal and durable-batch writers use the same asset-only contract;
  - no group categories accepted;
  - manual collisions survive;
  - stale AI rows are replaced;
  - sibling visual facts remain isolated;
  - no-thumbnail is unavailable, not tagged;
  - single-asset scope guard from issue #93 remains green.
- Extend `apps/worker/src/handlers/ai-tagging-batch-state.test.ts` for new serialized result shape and restart behavior.
- Add safe-refresh tests for `apps/worker/src/handlers/tag-propagation.ts` compatibility alias.

### Shared contract/frontend tests

- Extend `src/test/tag-asset-contract.test.ts` and `tag-asset-gemini-schema.test.ts` for structured asset tags and new group contract.
- Add `src/test/effective-tags.test.ts` for group+asset union, candidate exclusion, manual priority, and group reassignment.
- Extend `src/test/asset-search.test.ts`, `style-group-search.test.ts`, and `dam-search.test.ts` for group-term/member matching versus asset-only matching.
- Add component tests for both detail panels’ scope labels, edits, candidates, and unavailable state.

### Shared-db verification

The shared-db orchestrator must add SQL/fixture tests covering constraints, uniqueness, RLS/grants, atomic replacement, manual preservation, candidate exclusion, trigger refresh, search union, idempotency, and reassignment. Tests run in preview inside rollback transactions and cite their artifact; no bare row-count claim is acceptable.

### Commands that must stay green

```bash
cd /worksp/popdam/apps/worker
npm test
npm run build

cd /worksp/popdam
npm test
npm run lint
npm run build

cd /worksp/shared-db
scripts/check-sql.sh
```

Run targeted tests during development, then all commands above before landing. UI changes also require visual proof; test success alone is insufficient.

## 11. Constraints, standing rules, and gotchas

- Read the live repository `AGENTS.md`; it wins over this plan if operating rules change.
- PopDAM app work lands on `main`; shared-db uses branch + PR through its single orchestrator.
- Do not create/edit PopDAM `supabase/migrations/` or the vendored `shared-db/` mirror. All structure originates in `/worksp/shared-db`.
- Planning does not consume a shared-db lane. Implementation Step 2 must create a fresh structural issue and let the orchestrator route it; do not inherit another issue’s lane.
- Prove the database target immediately before every write. Never print secrets.
- Never edit generated `src/integrations/supabase/types.ts`; the normal shared-db/application workflow regenerates it.
- Preserve concurrent work: inspect status, use an isolated current worktree when needed, stage exact owned paths, and never broad-reset/pull/stage.
- Before the first commit, `git var GIT_COMMITTER_IDENT` must be `Albert Hazan <u2giants@users.noreply.github.com>`.
- Do not bypass or disable the existing AI capability planner, operation leases, batch recovery, conflicts, kill switches, or diagnostics.
- Do not equate GitHub’s green `popdam / production` badge with frontend deployment; Railway emits that badge for the worker.
- Do not use `quick_hash` as a unique-content identifier.
- Do not expose licensed artwork, filenames, extracted text, or private metadata in GitHub issues, public logs, test fixtures, screenshots outside approved storage, or external reviewer prompts.
- Treat manual rejections as durable. A subsequent model run cannot silently resurrect rejected group facts.
- Backfills and cleanup must be resumable, observable, and recoverable. Snapshot/manifest before deletion; preview/count-only before mutation.
- “Unknown” must remain visible. Never translate no-thumbnail, model failure, or missing evidence into an invented tag or successful analysis timestamp.

## 12. Access and environment

Verified while drafting on 2026-08-24:

- GitHub CLI can read and create issues in `u2giants/popdam3`; issue #96 was created.
- `/worksp/popdam` was clean on `main` and matched `origin/main` at `dfe25d69` before plan edits.
- `/worksp/shared-db` was clean but 758 commits behind its `origin/main`; do not use that stale ordinary checkout for implementation. The orchestrator must start from a fresh current branch/worktree.
- Git committer identity was correctly configured for Albert.

Not verified in this planning session and therefore must be checked live before use:

- Supabase CLI login and preview/production links;
- Railway dashboard/tool access;
- Coolify access and frontend live SHA;
- an authenticated PopDAM administrator test login;
- OpenRouter account/model availability and budget.

Secrets live in 1Password vault `vibe_coding`. Relevant existing items are documented by repository runbooks and include the Supabase CLI Personal Access Token, shared POP production/preview database passwords, runtime Supabase service credentials, GitHub push credentials, and AI-provider/OpenRouter key collection. Refer to item titles only; never place values in this plan, commands, output, commits, issues, or screenshots.

Local development and checks:

- Follow `docs/development.md` for the frontend dev server and test account procedure.
- Worker commands run from `/worksp/popdam/apps/worker`.
- Root Vite commands run from `/worksp/popdam`.
- Production is `https://dam.designflow.app`; PopSG at `https://sg.designflow.app` is a regression-only check for this work.

## 13. Definition of done, risks, rollback, and open questions

### Definition of done

- [ ] All STATUS rows are complete with artifact-backed evidence.
- [ ] Shared-db schema/RPC/search contract passed preview tests, merged, was promoted through the current approved procedure, and is documented canonically.
- [ ] Every previewable asset can receive asset-only analysis; no-preview assets honestly receive group-only search context.
- [ ] Style Group facts are stored once and effective search combines scopes without copying them.
- [ ] Manual/authoritative metadata survives all group refreshes, re-tags, backfills, and retries.
- [ ] The pilot has zero critical cross-file leakage and passes the scorecard.
- [ ] Legacy propagation no longer copies asset facts, while the refresh capability still works.
- [ ] Search, filters, Asset Detail, Style Group Detail, candidate review, and manual editing behave correctly.
- [ ] All named worker/root/shared-db tests pass and UI screenshots prove the intended behavior.
- [ ] Focused commits are pushed under Albert’s identity; required CI is green.
- [ ] Railway worker, frontend image/Coolify, and live site each prove their relevant exact SHA.
- [ ] Full rollout counters reconcile and production smoke evidence is recorded.
- [ ] Documentation matches live behavior; issue #96 is closed; this handoff is deleted when finished.

### Principal risks and mitigations

- **False group assertions:** candidate-by-default, two-file/0.85 promotion, evidence IDs, manual approval/rejection, authoritative priority.
- **Manual tag loss:** atomic RPC and manual-wins constraints/tests; snapshot before migration/cleanup.
- **Search regression:** additive indexing, dual-read transition, fixture tests, bounded pilot, compatibility wrappers retained.
- **Cost explosion:** one bounded group pass plus lightweight per-file passes, representative cap, resumable batches, measured pilot before full run.
- **Mixed-version deployment:** schema-first rollout, compatibility alias, exact-SHA checks, no destructive cleanup until every consumer is current.
- **Operation lock contention:** explicit lane conflicts, atomic batched RPCs, no copied group rows, monitored pilot.
- **Assets move between groups:** search/effective tags derive current `style_group_id`; no duplicated rows to clean from the asset.
- **Model vocabulary drift:** categories/scopes validated in code/schema, not inferred from tag strings.

### Rollback

1. Stop new group/asset operations through the existing operation controls; do not kill a provider batch whose status is ambiguous.
2. Revert the app/worker to the last verified compatible SHA while leaving additive schema objects in place.
3. Restore legacy reads during the transition using preserved `legacy_unscoped` rows; do not reactivate the unsafe copy writer.
4. Restore AI-owned rows from the protected pre-cleanup manifest only if cleanup had begun. Manual rows must never require restoration because they must never be removed.
5. Roll forward with a corrective shared-db migration; never edit an applied migration or run direct production DDL.

### Genuine open questions and decision criteria

No owner decision is required before implementation. The following are engineering measurements resolved by the pilot:

- **Representative count:** choose the smallest number from 4–8 that captures file-family/content diversity without exceeding current image payload/provider limits.
- **Automatic group-AI promotion:** the locked starting rule is confidence ≥0.85 plus evidence from at least two distinct assets. Tighten or disable auto-promotion if the pilot produces any critical false shared fact; never loosen it merely to increase coverage.
- **Legacy transition duration:** remove AI-owned `legacy_unscoped` rows only after full rollout reconciliation and two successful search/UI smoke passes on separate days or releases. Keep longer if rollback evidence is incomplete.
- **Group character presentation:** keep it as a labeled group tag/candidate unless a future business requirement needs relational group-character filtering. Do not infer sibling `asset_characters` links.

## Mandatory plan self-audit

### Objective checklist

- [x] All 13 sections are present.
- [x] The ultimate goal is first, in business English, and says the goal wins.
- [x] A zero-context session can execute without the planning chat.
- [x] Rejected approaches and reasons are preserved.
- [x] Every numbered step names files/functions, dependencies, behavior, and a verification gate.
- [x] Locked versus open decisions are explicit.
- [x] Out-of-scope work is explicit.
- [x] Tests are named by file and behavior.
- [x] Paths, repos, URLs, identifiers, baseline SHA, and terms are defined.
- [x] Secrets are referenced only by vault/item purpose, never value.
- [x] Definition of Done includes commit, push, CI, deploy, exact-SHA, docs, issue, and handoff retirement.
- [x] This plan and its new `HANDOFF.d/` file link to one another; root `HANDOFF.md` remains untouched.

### Required questions

1. **Could a brand-new AI session execute this plan to perfection without asking Albert anything? Yes.** Sections 1–4 define the business outcome, application, trigger, reproduction, and boundaries. Sections 5–8 preserve exact current behavior, evidence, dead ends, and locked design. Section 9 supplies ten ordered steps with dependencies and proof gates; §§10–13 provide tests, rules, access, rollout, rollback, and measurement criteria. No gap remained after the final reread.
2. **Does the plan carry every piece of background, nuance, and reasoning held by this planning session, including what was ruled out? Yes.** Sections 5–7 record the existing two-level foundation, flat-contract/blacklist/primary-source flaws, description contradiction, manual collision risk, no-preview behavior, and ten rejected alternatives. Section 8 records the final ownership, priority, candidate, description, compatibility, and governance decisions.
3. **Is the ultimate goal clear enough for correct judgment if an implementation step is wrong? Yes.** Section 1 defines the observable user/business outcome and explicitly says the goal wins. Section 8 distinguishes locked semantics from engineering judgments, while §13 gives conservative decision criteria and rollback. An implementer can change mechanics without weakening truth, scope, provenance, or manual authority.

**Self-audit result: PASS.**
