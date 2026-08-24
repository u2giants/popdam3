# PopDAM Hybrid Search — Safe Implementation and Rollout Plan

**Tracking:** [PopDAM issue #97](https://github.com/u2giants/popdam3/issues/97)

**Plan handoff:** [HANDOFF.d/2026-08-24T1433Z-hetz-codex-hybrid-search-plan.md](HANDOFF.d/2026-08-24T1433Z-hetz-codex-hybrid-search-plan.md)

**Created:** 2026-08-24

**Execution status:** planning complete; implementation has not started

## STATUS — read this first

Fresh sessions start at **Step 1: re-verify repository and live production state**. Do not infer live counts or deployment state from this plan.

| Step | State | Owner/route | Implementation artifact | Verification evidence |
|---|---|---|---|---|
| 1. Re-verify code, schema, deployment, and live coverage | ⬜ open | PopDAM read-only inspection | None yet | Record exact commands/results in this table before changing code |
| 2. Dispatch and land the canonical shared-DB search-maintenance change | ⬜ open | `u2giants/shared-db` orchestrator | Future timestamped migration + PR | Preview SQL assertions, preview timing, merged commit, bounded production approval/apply proof |
| 3. Add authorization-safe hybrid search contract | ⬜ open | Shared-db orchestrator + PopDAM edge function | Future migration/RPC and `supabase/functions/dam-search-ai/index.ts` | Cross-user authorization test proves no inaccessible IDs, ranks, or counts leave the edge function |
| 4. Add resumable embedding worker operation | ⬜ open | PopDAM `main` | Future `apps/worker/src/handlers/embed-search.ts` and registrations | Worker tests plus Railway restart/resume evidence |
| 5. Add bounded automatic freshness loop | ⬜ open | PopDAM worker preferred; DB only if evidence requires it | Future worker scheduler/config | Overlap, lease-expiry, retry, disable, and steady-state lag evidence |
| 6. Add admin coverage and start/stop UI | ⬜ open | PopDAM `main` | Future search-index card in Settings | Component tests and visual screenshot at desktop/mobile widths |
| 7. Complete search UX, score floor, and pagination behavior | ⬜ open | PopDAM `main` plus DB RPC if needed | `src/lib/dam-search.ts`, hooks, library top bar, RPC | Unit/integration tests and browser evidence for deep pages and weak-tail handling |
| 8. Run measured production backfill | ⬜ open | PopDAM op after Albert approval | `BULK_OPERATIONS.embed-dam-search` run | Before/after status artifacts, throughput projection, restart test, categorized residue |
| 9. Enable hybrid mode and verify/observe/rollback | ⬜ open | PopDAM admin config after Albert approval | `admin_config.SEARCH_MODE` data change | Live user-flow screenshots, fallback drill, config rollback proof, deployed SHAs |
| 10. Optional telemetry and evidence-based tuning | ⬜ open; separately gated | Separate shared-db + PopDAM phase | Future telemetry migration/app code | Albert-approved retention, privacy/RLS tests, first analysis artifact |
| 11. Documentation, closeout, and handoff retirement | ⬜ open | Final implementing session | Docs, commits, CI/deploy evidence | Issue #97 closure only after every required gate is proven |

---

## 1. The ultimate goal

POP employees must be able to type ordinary descriptions such as “cozy winter snowman scene,” character names such as “Groot,” or visual attributes such as “blue glitter,” and receive the most useful permitted PopDAM/PopSG assets first. Search must remain available if semantic embedding is unavailable, must never reveal records a user cannot access, and must keep itself current as assets, tags, characters, PDFs, and style groups change.

This is not merely a pgvector launch. It is a safe discovery system: keyword precision plus semantic recall, correct relevance order, bounded weak matches, authorization applied before results leave the server, resumable indexing, visible coverage, and a one-setting rollback to keyword search.

**If a step conflicts with this goal, the goal wins — stop and flag it.** In particular, do not preserve a prescribed implementation when repository code, live schema, authorization rules, or measured production behavior disproves it.

## 2. What this application is

PopDAM is POP Creations’ internal digital-asset manager for licensed consumer-product artwork. PopSG is the style-guide mode served by the same frontend. Designers and sales staff browse more than 100,000 source-art records, thumbnails, metadata, licensed properties, characters, tags, and style groups.

- Application repo: `/worksp/popdam`, GitHub `u2giants/popdam3`, trunk branch `main`.
- Canonical shared-schema repo: `/worksp/shared-db`, GitHub `u2giants/shared-db`; branch + PR through its single orchestrator.
- Frontend: React/Vite in `src/`; production at `https://dam.designflow.app` and `https://sg.designflow.app`, published to GHCR and deployed by Coolify.
- Search edge function: `supabase/functions/dam-search-ai/index.ts`, deployed to Supabase project `qsllyeztdwjgirsysgai` by `Deploy Supabase Edge Functions`.
- Persistent worker: `apps/worker/`, deployed by Railway from every push to PopDAM `main`.
- Database: the shared Supabase project `qsllyeztdwjgirsysgai`; all structural changes are canonical shared-db migrations.
- Runtime feature/config state: `public.admin_config`, managed through authenticated application workflows rather than ad-hoc production SQL.

Read `AGENTS.md`, `CLAUDE.md`, this plan’s STATUS table, `fix_search.md` §§1–2, `docs/BULK_JOBS.md`, `docs/WORKER_LOGIC.md`, `docs/configuration.md`, and the current `/worksp/shared-db/AGENTS.md` before execution. Re-read downstream phases before each context cut because these files and production state can drift.

## 3. What triggered this work

The repository already contains a substantial hybrid-search foundation, but production search has remained keyword-only by default. Existing AI tags and linked character names are not included in the maintained search document, so valuable extraction work cannot reliably drive free-text discovery. Embedding coverage, automatic freshness, production deployment, and live configuration have not been established in this planning session.

The original implementation brief correctly identified the opportunity but contained unsafe or incomplete details:

- It proposed a “batched” rebuild while the current rebuild function deletes and recreates the whole document table.
- It did not fully specify style-group refresh when asset tags/characters change.
- The existing embedding “claim” is a plain select, so concurrent callers can duplicate work.
- The edge function authenticates users but ranks through a service-role client, returning unfiltered result identifiers/ranks before the browser performs its RLS-scoped re-query.
- It coupled telemetry/privacy work to the initial launch even though telemetry is not needed to deliver safe hybrid search.

Reproduction of today’s business gap must be performed in Step 1 against live production: find an asset whose only “Groot” signal is `asset_characters`, and an asset whose only “glitter blue” signals are `asset_tags`; confirm keyword search does not return them before any change. Use approved identifiers in private evidence only—never licensed row contents in public issues or logs.

## 4. Scope — in and out

### In scope

1. Verify existing search schema/code/deployment and obtain current coverage counts.
2. Include asset tags and character names in both asset and style-group search documents.
3. Refresh affected asset and style-group documents efficiently after tag/character relationship changes.
4. Replace destructive whole-table rebuilding with incremental, resumable, bounded maintenance.
5. Add concurrency-safe embedding leases, expiry recovery, bounded retries, and operator-visible error categories.
6. Add a persistent worker operation and bounded automatic freshness loop.
7. Make hybrid search authorization-safe before returning IDs, scores, or counts.
8. Preserve ranked ordering; define result ceiling, deep pagination, minimum-score/weak-tail behavior, and silent fallbacks.
9. Add an admin coverage/readiness card with existing operation start/stop/resume semantics.
10. Enable hybrid mode only after coverage, security, deployment, and rollback gates pass.
11. Document and test the complete operating path.

### NOT in this plan

- Image/CLIP embeddings, image-to-image similarity, a second vector column/table, GPU/API selection, or “find visually similar.” Write a separate costed proposal only; implementation requires Albert’s explicit approval.
- AI-tag confidence, review queues, high-resolution image retries, prompt consolidation, character facets, or group-tag propagation policy redesign from later sections of `fix_search.md`.
- Changing the `gte-small` model or vector dimension without a separate compatibility/migration decision.
- Collecting click telemetry during the initial launch. Step 10 is optional and may begin only after Albert approves retention and scope.
- Direct production SQL, Dashboard edits, app-repo migrations, or a live server edit.
- Weakening RLS, returning service-role search results and relying solely on the browser to hide them, or suppressing errors as a substitute for repair.

## 5. Current state of the code

These are repository observations from 2026-08-24, not proof of current production deployment or data state.

### Already implemented

- Canonical migration `/worksp/shared-db/supabase/migrations/20260713221518_dam_hybrid_search_foundation.sql` creates `extensions.vector`, `public.dam_search_documents`, a stored generated `search_tsv`, GIN/trigram indexes, HNSW cosine index, refresh/rebuild functions, search RPCs, and embedding RPCs.
- Later migration `/worksp/shared-db/supabase/migrations/20260714173500_dam_search_synonyms.sql` replaces `search_dam_documents`; implementations must modify the latest effective definition, not blindly copy the foundation version.
- `supabase/functions/dam-search-ai/index.ts:20-50` manually authenticates a bearer token because `supabase/config.toml:9-10` sets `verify_jwt = false`. `verify_jwt = false` is not itself an auth bypass; the manual check must remain tested.
- `supabase/functions/dam-search-ai/index.ts:117-136` embeds a query with Supabase `gte-small`, then calls `search_dam_documents` using a service-role client.
- `src/lib/dam-search.ts:12-25` reads and parses `admin_config.SEARCH_MODE`, accepting only `keyword` or `hybrid` and defaulting to keyword.
- `src/lib/dam-search.ts:27-65` calls `dam-search-ai` in hybrid mode and silently falls back to the keyword callback on edge-function failure.
- `src/hooks/useAssets.ts:100-143` and `src/hooks/useStyleGroups.ts:124-167` route searches through `fetchSearchIds` and preserve keyword RPC fallback behavior.
- `src/hooks/useAssets.ts:267-283` and `src/hooks/useStyleGroups.ts:256-283` already skip database column ordering/ranging in relevance mode, then call `sortByRank(...).slice(...)`. The old `fix_search.md` §1d claim that relevance is currently discarded is stale.
- Both hooks use `FULL_TEXT_SEARCH_LIMIT = 500` (`src/hooks/useAssets.ts:10`, `src/hooks/useStyleGroups.ts:52`), so client-side relevance pagination has a hard 500-result ceiling.
- `src/test/dam-search.test.ts:10-48` covers edge-result mapping, rank ordering, keyword default, and keyword routing, but not the complete fallback/security/pagination contract.
- `apps/worker/src/operation-loop.ts:46-84`, `:96-125`, `:275-303`, and `:320-350` define operation lanes, progress, result text, and dispatch. The main loop at `:595-850` already supports stop, revision-safe persistence, restart recovery, and failure kill switches.
- Operation-name/lane copies live in `supabase/functions/_shared/operation-constants.ts` and `src/components/settings/diagnostics/types.ts`; their comments require synchronization.
- `src/hooks/usePersistentOperation.ts:122-217` provides the normal atomic start/queue/stop path. The new UI must reuse it.

### Incomplete or unsafe for launch

- Asset search text omits `asset_tags` and `asset_characters`.
- Style-group search text does not aggregate tag/character names from member assets.
- Existing tag/character relationship changes do not maintain the corresponding search documents.
- `rebuild_dam_search_documents()` deletes the whole table before reinserting; it is not a production-safe incremental backfill.
- `claim_dam_search_embedding_documents()` does not claim, lock, or lease rows; two callers can select the same documents.
- `embedding_error` rows are excluded indefinitely without retry scheduling or terminal/transient categorization.
- The service-role search response can contain unauthorized UUIDs/ranks and reveals result-array length before the RLS-scoped asset/style-group re-query.
- There is no operator coverage card or confirmed automatic freshness loop.
- No live coverage counts, deployed edge-function version, Railway version, or production `SEARCH_MODE` value were verified in this planning session.

### Repository state at plan creation

- PopDAM branch was `main`; `git status --short` was clean before editing.
- Both `origin` and `github` resolved to `https://github.com/u2giants/popdam3.git`.
- Committer identity was `Albert Hazan <u2giants@users.noreply.github.com>`.
- No implementation code or database change was made. This plan, its handoff, and router links are the only intended changes.

## 6. Key findings and root causes

1. **The retrieval corpus excludes paid-for metadata.** The effective asset document builder concatenates filename/path/descriptions/business fields/PDF text, but not tags or linked character names. Keyword and semantic search therefore share the same incomplete corpus.
2. **Style-group correctness is a separate requirement.** A style group must aggregate tag/character names across eligible member assets. A relationship change can affect the asset document and its group document; moving a relationship can affect old and new asset/group pairs.
3. **The current full rebuild is destructive and monolithic.** `/worksp/shared-db/.../20260713221518_dam_hybrid_search_foundation.sql:295-437` deletes all search documents, then reinserts. Wrapping this in a migration does not make it batched.
4. **Hash protection is necessary but not sufficient concurrency control.** `upsert_dam_search_embedding` commits only when `content_sha256` still matches, correctly discarding stale embeddings. But the claim RPC is only a stable select, so it cannot prevent duplicate compute.
5. **Errors can become permanent blind spots.** Claiming filters for `embedding is null and embedding_error is null`; without retry metadata/reset, any error removes a document from future automatic attempts.
6. **Authorization occurs at the wrong boundary.** The edge function proves the caller is authenticated, then uses service role for ranking. The later browser query applies RLS, but unauthorized IDs/ranks/count-by-array-length have already crossed the server boundary.
7. **Relevance is already preserved, but only within the fetched ceiling.** The stale architecture note should be corrected. The remaining issue is that a 500-ID candidate list is fetched and sliced client-side, so pages beyond it cannot work honestly.
8. **Semantic search always has a nearest neighbor.** Without a score floor or explicit weak-tail treatment, unrelated records can appear as confident matches. UI wording alone should not be the only control.
9. **Automatic freshness and manual bulk backfill have different purposes.** The manual operation provides measured initial coverage and recovery; a bounded singleton loop handles steady-state edits. They may share claim/lease machinery but must not race wastefully.
10. **Telemetry is valuable but not launch-critical.** It adds privacy, retention, schema, and analysis obligations, so it belongs in a separately approved phase after safe hybrid search works.

## 7. Approaches considered and rejected

1. **Rejected: run the existing full rebuild inside a migration and call it batched.** It deletes the entire index in one transaction, creates avoidable outage/lock/compute risk, and invalidates embeddings all at once.
2. **Rejected: naive row-level tag/character triggers that call a full refresh for every inserted relationship.** Bulk AI tagging can insert many relationships per asset, causing repeated aggregation and write amplification.
3. **Rejected: refresh only the asset document.** Style-group search would remain stale, and updates/moves could leave old groups indexed incorrectly.
4. **Rejected: rely on `content_sha256` as the only concurrency mechanism.** It protects correctness at commit time but still permits duplicate embedding compute and repeated errors.
5. **Rejected: run pg_cron and a worker loop independently against the current pseudo-claim RPC.** Both can select the same rows. Prefer one bounded always-on worker path using real leases; use pg_cron only if measured worker behavior cannot meet the freshness target.
6. **Rejected: return service-role-ranked IDs and assume the browser’s RLS re-query makes it safe.** Opaque UUIDs, ranks, and result counts are still information. Authorization must be enforced before the edge response.
7. **Rejected: return full search documents/metadata from the edge function.** That increases leakage risk and duplicates display-data ownership. Return only authorized entity IDs plus the minimum rank metadata needed by the UI.
8. **Rejected: remove semantic tail results only through vague UI copy.** Add a measured/configurable minimum relevance rule and honest closest-match state.
9. **Rejected: increase the 500 limit arbitrarily.** A larger hard-coded client-side ID list postpones rather than solves deep pagination and can create URL/query-size and database-load problems.
10. **Rejected: launch telemetry with hybrid search.** It delays the user benefit and silently selects a retention policy. Telemetry remains off until Albert explicitly approves retention.
11. **Rejected: build image embeddings now.** They require a new model/dimension/pipeline/cost decision and are explicitly outside this implementation.
12. **Rejected: direct Dashboard SQL or app-repo DDL for speed.** The database is shared; all structure must go through canonical shared-db preview/PR/promotion controls.

## 8. Design decisions already made

### Locked decisions — do not relitigate without new evidence

- **2026-08-24:** Keyword mode remains the default and one-setting rollback until the complete launch gate passes.
- **2026-08-24:** Query embeddings stay server-side; the browser does not embed text.
- **2026-08-24:** Search indexes tags and canonical character names before the large embedding backfill, avoiding two corpus-wide embedding runs.
- **2026-08-24:** Production rebuild is incremental/upsert-based and bounded; no delete-all rebuild.
- **2026-08-24:** Tag/character maintenance updates both affected assets and affected style groups, including old/new relationships.
- **2026-08-24:** Embedding work uses real lease ownership with expiry/recovery and hash-checked writes.
- **2026-08-24:** The automatic freshness path is bounded, idempotent, disabled by configuration for rollback, and protected against overlap. The preferred implementation is the existing Railway worker, not pg_cron calling an HTTP edge function.
- **2026-08-24:** No unauthorized ID, rank, or result count may leave `dam-search-ai`. Browser-side RLS filtering alone is insufficient.
- **2026-08-24:** Existing rank-preservation code is extended, not re-architected.
- **2026-08-24:** Telemetry is a separate optional phase and defaults off.
- **2026-08-24:** Image embeddings are proposal-only.

### Open implementation judgments, with criteria

- **Statement-level transition triggers vs. stale queue:** measure preview bulk-tagging write amplification. Choose statement-level transition-table triggers if they can deduplicate all affected asset/group IDs cheaply; otherwise insert deduplicated IDs into a durable stale-document queue consumed by the refresh worker. Do not choose row-level full refresh.
- **Authorization contract:** prefer an RLS-aware/security-invoker search RPC called with the authenticated user client. If `dam_search_documents` cannot express the application’s row access directly, rank candidates internally and join/filter through RLS-safe asset/style-group relations before returning. Acceptance is behavioral cross-user isolation, not a particular SQL shape.
- **Pagination:** prefer server-side cursor/offset pagination over ranked, authorized results. If the UI product intentionally limits smart search to a maximum number, the limit must be explicit in UX and counts/pages must not imply unavailable deeper results.
- **Semantic floor:** derive an initial threshold from a private representative query set in preview/production dark mode. Store it in `admin_config.SEARCH_MIN_SEMANTIC_SCORE`; default conservatively and allow `null` only when the UI explicitly labels weak closest matches.
- **Retry policy:** classify transient runtime/network/model errors for bounded exponential retry; terminal content/model-dimension errors remain visible and require operator action. Default retry attempts and cooldown must be documented and tested.

## 9. The executable implementation plan

### Phase A — discovery and canonical database contract

**Context cut after Step 3. Before continuing, use the `fresh-session` skill and re-read Steps 4–11.**

### Step 1 — Re-verify repository, schema, deployment, and live state

1. In `/worksp/popdam`, run `git status --short`, `git branch --show-current`, `git log -1 --oneline`, `git var GIT_COMMITTER_IDENT`, and list current handoffs. Do not edit if concurrent changes overlap this plan’s paths.
2. In `/worksp/shared-db`, read its current `AGENTS.md`; run `git status --short`, inspect open `db-work` issues/PRs, and locate the latest effective definitions of every DAM search function with `rg`. Do not assume the foundation migration remains the final definition.
3. Resolve protected production/preview refs with `ai-private-config`. For each read-only database call, prove the target using the canonical shared-db procedure immediately before the call.
4. Record private, reproducible results for:
   - document counts by type and embedded/pending/error status;
   - `get_dam_search_embedding_status()`;
   - `admin_config.SEARCH_MODE`, automatic-loop/search threshold keys if present;
   - duplicate/expired lease state if schema already evolved;
   - tag-only and character-only keyword searches;
   - style-group equivalents.
5. Verify `dam-search-ai` deployment and SHA via the latest `Deploy Supabase Edge Functions` run and live function behavior. Confirm `supabase/config.toml` versus deployed auth behavior; do not equate `verify_jwt=false` with unauthenticated access without testing manual validation.
6. Verify the live frontend build SHA/header and Railway worker deployment independently; a green Railway GitHub deployment does not prove the frontend.
7. Update this STATUS table with artifact paths/run IDs and any divergence. Trust code/live state over this plan and amend downstream steps before implementation.

**You’ll know it worked when:** the STATUS table links to a private verification artifact containing target proof, exact counts, deployed versions, current mode, auth probes, and tag/character baseline searches; no write has occurred.

### Step 2 — Dispatch and land shared-DB indexing, maintenance, and lease primitives

This is structural work. The PopDAM session must create a fully scoped `db-work` issue and stop; the single `shared-db-orchestrator` owns the branch, migration, preview, PR, merge, and approved production promotion.

Required objects/behavior in a new timestamped migration above the current maximum:

1. Replace the latest effective `refresh_dam_search_asset_document(uuid)` definition so deterministic, sorted, deduplicated `asset_tags.tag` and canonical `characters.name` values are in `search_text`. Deterministic ordering is mandatory so hashes do not change nondeterministically.
2. Replace `refresh_dam_search_style_group_document(uuid)` so it aggregates those fields across non-deleted eligible member assets. Define duplicate handling and stable ordering explicitly.
3. Add maintenance for `asset_tags` and `asset_characters` INSERT/UPDATE/DELETE that deduplicates affected old/new asset IDs and old/new style-group IDs. Use transition tables or a durable stale queue based on preview measurement. Never perform repeated full refreshes per relationship row.
4. Add/replace an incremental refresh RPC that accepts a bounded batch/cursor or claims stale IDs. It must upsert changed documents, delete only documents whose source entity is now deleted, retain unchanged embeddings when hashes match, clear embedding/model/timestamp/error when hashes change, and return counts plus a durable continuation token. Do not call the delete-all `rebuild_dam_search_documents()` in production.
5. Replace the pseudo-claim embedding RPC with real lease fields or a sibling lease table: owner token, claimed time, expiry, attempt count, next retry time, and last categorized error. Claim atomically with `FOR UPDATE SKIP LOCKED` or equivalent. Expired leases must be reclaimable.
6. Preserve `upsert_dam_search_embedding` hash matching and additionally require valid lease ownership. A stale hash or lost lease returns false without overwriting newer content.
7. Replace error marking with transient/terminal category, bounded retry count, exponential cooldown, and operator-visible terminal state. Provide an admin-only reset/requeue RPC scoped to selected terminal rows.
8. Preserve least privilege and explicit grants whenever function signatures change. Re-run security-definer execute lockdown checks.
9. Do not hide the data refresh inside an unbounded migration. The migration installs primitives; preview validation may exercise a bounded batch. Production data backfill is Step 8 through the application-owned operation after the merged structural contract is promoted with Albert’s exact approval.

Preview tests must prove tag-only and character-only asset matches, style-group matches, relationship move/delete correctness, deterministic hashes, unchanged embedding retention, changed embedding invalidation, no global delete, lease exclusivity, expired lease recovery, stale-hash refusal, retry exhaustion, and grants.

**You’ll know it worked when:** shared-db SQL checks pass; preview artifacts show object and behavior assertions plus timing; the PR is merged; Albert has approved the exact production structural promotion; the bounded production promotion targets `qsllyeztdwjgirsysgai` with immediate target proof; and post-apply object definitions match the merged migration. Record migration, merge SHA, CI run, and apply proof in STATUS.

### Step 3 — Make the edge search response authorization-safe

1. In shared-db, define the minimum authorization-aware search contract necessary for Step 3. Prefer a security-invoker/RLS-aware RPC callable with the user JWT. If an internal definer function computes candidates, its externally callable wrapper must filter candidates against records the caller can select before returning.
2. In `supabase/functions/dam-search-ai/index.ts`, keep manual bearer authentication and reject missing/invalid tokens. Use a user-scoped Supabase client for the externally visible search call; reserve service role for admin-only `embed-batch` and embedding status operations.
3. Make admin-only actions prove admin/service authority—not merely “any authenticated user.” Test current `requireAuth` behavior: the existing service-role probe can distinguish a service token, but `embedding-status` policy must match the coverage UI’s authorized admin role.
4. Return only authorized `document_type`, `entity_id`, and minimum rank/score fields. Never return title, path, metadata, inaccessible IDs, pre-filter counts, or diagnostic corpus totals to ordinary users.
5. Preserve abort/failure semantics so `src/lib/dam-search.ts` falls back to keyword.
6. Add edge-function tests with at least two users whose accessible asset/style-group sets differ, including a query whose best global match is inaccessible to one user.

**You’ll know it worked when:** an authenticated restricted user receives only IDs they can select, cannot infer inaccessible result count from the response, an unauthenticated request is rejected, an ordinary user cannot invoke embedding actions, and an authorized admin/service worker can. The edge deployment workflow is green and the deployed function passes the same probes.

### Phase B — worker, automatic freshness, and operator UI

**Context cut after Step 7. Before the production backfill, use `fresh-session`, re-read Steps 8–11, and refresh all live measurements.**

### Step 4 — Add the resumable `embed-dam-search` worker operation

1. Create `apps/worker/src/handlers/embed-search.ts`. Inject the RPC/edge client in tests. Each batch atomically claims a bounded leased batch, invokes `dam-search-ai` `{ action: "embed-batch", ... }` with worker credentials and lease token, records embedded/stale/failed/retried/terminal counts, renews or completes leases, and returns `done` only when pending-ready and active-leased counts are zero.
2. The handler must not use an offset cursor over a mutating pending set. Its durable progress is counts plus the database lease state; restart safely resumes by reclaiming expired leases.
3. Tune default batch size only after a small preview/dark production measurement. Make batch size and maximum per-tick work bounded in config/operation params.
4. Register `embed-dam-search` in `apps/worker/src/operation-loop.ts`: import/dispatch, `OP_LANES` as `search-index`, `mergeProgress`, `buildResultMessage`. Reuse the existing stop/revision/retry/kill-switch path; do not bypass `update_bulk_operation`.
5. Mirror name/lane/conflict semantics in `supabase/functions/_shared/operation-constants.ts` and `src/components/settings/diagnostics/types.ts`. It needs no hard conflict with AI tagging because hash+lease correctness handles changing content, but surface churn in progress and avoid waste through the freshness queue.
6. Confirm operation keys remain JSONB keys, not a DB enum; do not request unnecessary DDL.

**You’ll know it worked when:** worker unit tests prove exclusive leases, stale-write discard, transient retry, terminal error, user stop, restart after lease expiry, zero-pending completion, and failure kill-switch behavior; root and worker typechecks pass.

### Step 5 — Add one bounded automatic freshness loop

Preferred design: the existing Railway worker periodically runs a small incremental refresh-and-embed tick when `admin_config.SEARCH_AUTO_EMBED_ENABLED=true`.

1. Add configuration reader/cache in the worker for:
   - `SEARCH_AUTO_EMBED_ENABLED` default `false` until initial rollout;
   - `SEARCH_AUTO_EMBED_INTERVAL_SECONDS` with safe min/max;
   - `SEARCH_EMBED_BATCH_SIZE` with safe min/max;
   - `SEARCH_EMBED_MAX_ATTEMPTS` and retry cooldown bounds.
2. Use the same lease primitives and handler as the manual operation. Add singleton/overlap protection so a scheduled tick yields when the manual operation owns work; never run a second independent pg_cron claimant.
3. Bound each tick by batch count and wall-clock budget. Log aggregate IDs/counts/categories only—never search text or licensed metadata.
4. Disable instantly when the flag is false. Disabling stops new claims but lets an in-flight bounded batch finish safely.
5. Use pg_cron only if a measured Railway limitation prevents the freshness SLO. If selected, return to shared-db governance and design an authenticated, bounded, overlap-safe invocation; document why the worker design failed.
6. Set the initial freshness SLO during Step 1 based on asset-change rate; recommended starting target is pending work ordinarily cleared within 15 minutes without material worker contention.

**You’ll know it worked when:** tests with fake time show disabled behavior, interval bounds, no overlap with manual operation, bounded execution, expired-lease recovery, and no unbounded loop; a dark production observation shows the chosen SLO without affecting other worker lanes.

### Step 6 — Add the admin search-index coverage/control card

1. Create a focused component such as `src/components/settings/SearchIndexCard.tsx`, colocated in the Processing/Operations area rather than inside Vision Bake-Off. Use `RichPdfExtractCard.tsx` only as a visual pattern and `usePersistentOperation("embed-dam-search")` for start/stop/resume.
2. Fetch authorized `embedding-status` data and display total, embedded, pending-ready, leased, retry-waiting, terminal errors, stale documents, last successful automatic tick, and oldest pending age.
3. Start with a confirmation that shows measured batch size and projected duration. Stop must call `op.stop()` and preserve resumability. Add targeted reset/retry control for terminal errors only if the user has admin permission.
4. Show throughput and ETA after enough samples; do not fabricate an ETA before measurement.
5. Poll actively only while running or pending; use the existing idle polling conventions.

**You’ll know it worked when:** component tests cover idle/running/interrupted/completed/error/unauthorized states; stop/resume uses `update-bulk-op`; a screenshot shows readable desktop and narrow layouts; the card agrees with direct status RPC evidence.

### Step 7 — Finish ranked pagination, weak-tail UX, and fallback behavior

1. Extend `src/lib/dam-search.ts` result types to retain authorized rank/semantic score and pagination metadata. Keep `fetchSearchIds` fallback behavior explicit and observable in tests without showing errors to users.
2. Change the authorized search RPC/edge action to accept bounded page/cursor parameters and return enough information for honest paging. Avoid sending an ever-growing ID list into `.in(...)`.
3. Update `src/hooks/useAssets.ts` and `src/hooks/useStyleGroups.ts` to request the current ranked page while preserving the authorized RLS-scoped display-row query. Preserve the returned ranked order with `sortByRank`; keep empty-query browse and chosen column sorting unchanged.
4. Define total-count semantics. Return an authorized exact count only if it can be computed safely within the timeout; otherwise use `has_more` and do not display a misleading exact total.
5. Read `admin_config.SEARCH_MIN_SEMANTIC_SCORE` in the server-side caller. Filter semantic-only results below the configured threshold, while always preserving strong keyword matches. Record rank components privately during dark verification to calibrate the initial value.
6. Add a subtle “Smart search” indicator in `src/components/library/LibraryTopBar.tsx` when mode is hybrid. Show “Showing closest matches” only when results are semantic-only/near the threshold; never imply all results are exact matches.
7. Exercise fallback chain: hybrid edge failure → keyword RPC (with its existing retry) → ILIKE fallback. No user-visible outage or spinner loop.

**You’ll know it worked when:** asset and group searches preserve server rank across at least three pages, pages contain no duplicates/omissions under a stable snapshot, weak-tail copy appears only under the specified score condition, empty browse is unchanged, and forced edge/RPC failures reach the correct fallback in automated tests and browser verification.

### Phase C — measured backfill and launch

### Step 8 — Run the production refresh and embedding backfill

This is the first long-running production data operation and requires Albert’s explicit approval after the report below.

1. Confirm merged/deployed SHAs, live function definitions, target project, automatic loop still disabled, current counts, and that keyword search is healthy.
2. Run a small bounded production sample through the operation. Record start/end times, documents claimed/embedded/stale/retried/failed, edge/worker error categories, and other worker-lane health.
3. Calculate projected full duration from measured throughput and remaining eligible documents. Report it to Albert with the exact scope, rollback (stop operation; keyword remains active), and any terminal residue. Obtain approval before the full run.
4. Start the full operation through the admin UI/normal `BULK_OPERATIONS` workflow. Do not call embedding RPCs manually in a shell loop.
5. During the run, verify a Railway restart: stop/redeploy only through the normal deployment workflow if a safe natural restart cannot be observed; confirm expired/in-flight leases resume without duplicate committed work.
6. Categorize every terminal error. Fix systemic failures and retry; accept residue only when explicitly explained by category and impact. “100%” means all eligible documents embedded, not that errors were removed from the denominator.
7. Enable `SEARCH_AUTO_EMBED_ENABLED` only after the initial backlog is complete and observe steady-state freshness for at least two intervals.

**You’ll know it worked when:** status shows zero pending-ready and zero expired/abandoned leases; all eligible documents are embedded or each terminal exception has a recorded category/owner; restart recovery is proven; automatic freshness clears a newly changed test document within the SLO; keyword mode remained available throughout.

### Step 9 — Enable hybrid mode, verify end to end, and prove rollback

This is user-visible and requires Albert’s explicit approval after Step 8 evidence.

1. Confirm production `SEARCH_MODE=keyword`, record the current value, and change it through the authenticated admin-config workflow/UI—not direct SQL or a migration.
2. Set the calibrated `SEARCH_MIN_SEMANTIC_SCORE`; keep telemetry off.
3. Set `SEARCH_MODE=hybrid` and clear/observe config cache behavior as documented. Do not claim activation until the browser uses the new mode.
4. Verify both PopDAM modes where applicable:
   - descriptive semantic query such as “cozy winter snowman scene”;
   - tag-only “glitter blue” and character-only “Groot” baselines;
   - authorized restricted-user query;
   - empty-query browse;
   - multiple pages/order;
   - smart/closest-match messaging;
   - edge failure → keyword → ILIKE drill.
5. Record frontend live build SHA/header, edge deployment run/SHA, Railway worker SHA, screenshots, and private query evidence.
6. Observe error rate, latency, pending age, terminal errors, and user-reported false positives during a defined initial window. Recommended: active observation for the first hour and daily review for seven days.
7. Prove rollback by setting `SEARCH_MODE=keyword`, confirming browser keyword behavior, then restore hybrid only if the drill is clean and Albert still approves.

**You’ll know it worked when:** authorized users receive meaningfully ranked results, restricted records do not leak, both fallback levels work invisibly, paging/count behavior is honest, live SHAs are recorded, and keyword rollback is demonstrated—not merely documented.

### Phase D — optional evidence-based tuning

### Step 10 — Add telemetry only after separate retention approval

This phase is not required to close the safe hybrid-search launch. Before starting, Albert must approve: enabled populations, captured fields, retention period, deletion mechanism, and whether query text is permitted.

1. Route the new table/RLS/RPC through shared-db. Store the minimum event: normalized/redacted query or one-way query identifier as approved, authorized returned ranks/IDs necessary for analysis, clicked authorized entity, mode, effective weight/threshold, and timestamp. Do not add user-identifying data beyond an already-approved existing identifier.
2. Admin-read only; ordinary users may insert only their own valid click event through a narrow RPC and cannot select telemetry. Gate collection behind `SEARCH_TELEMETRY_ENABLED=false` by default.
3. Implement automatic retention deletion in the canonical migration and prove it in preview before enabling.
4. Emit clicks from the existing asset/style-group open path only when enabled; failure must never block opening the asset.
5. Parameterize semantic weight without breaking existing callers: retain a default of `0.35`, preserve/regrant signatures or add a compatible overload, regenerate types through deployment workflow, and have the server-side caller read `SEARCH_SEMANTIC_WEIGHT` with validated bounds.
6. Collect enough data for a declared minimum sample, then report click-rank distribution, no-click rate, keyword-versus-hybrid comparison, latency, and confidence limitations. Propose a weight change only from this evidence and use a dark/canary rollbackable config change.

**You’ll know it worked when:** Albert’s retention decision is recorded, preview privacy/RLS/retention tests pass, collection is off by default, event failure is non-blocking, and the first analysis is reproducible from a private artifact before any weight changes.

### Step 11 — Documentation, landing, and retirement

1. Keep this STATUS table current after every executed step; never let “current state” describe the pre-change system.
2. Correct `fix_search.md` §§1–2, especially stale §1d; do not mark unrelated recommendations complete.
3. Update `docs/BULK_JOBS.md`, `docs/WORKER_LOGIC.md`, `docs/configuration.md`, and `docs/architecture.md` with the final implemented contract, configuration defaults, status/error semantics, rollback, and deployed path.
4. Update canonical shared-db docs required by its rulebook. Do not duplicate companywide rules into PopDAM.
5. Run focused and full checks, inspect owned diff, stage only owned files, commit directly to PopDAM `main`, and push `origin main` then `github main`. Resolve non-fast-forward only with the documented safe `git rebase --autostash` procedure after fresh status/stash snapshots.
6. Verify CI and deployments by component. Documentation-only commits do not prove app deployments.
7. Close issue #97 only when every required definition-of-done item is met. Delete this plan’s handoff file in the finishing commit; preserve the plan as durable architecture/rollout history unless project convention later archives it.

**You’ll know it worked when:** docs match live behavior, checks/CI pass, exact commits are on remotes, frontend/edge/Railway deployed SHAs are independently proven, issue #97 is closed, and no stale handoff or untracked migration remains.

## 10. Tests required

### Shared-db preview SQL tests

- Asset document contains stable sorted/deduplicated tag and character tokens.
- Style-group document aggregates eligible member metadata and removes it after the last relationship disappears.
- INSERT/UPDATE/DELETE and old/new asset/group transitions refresh every affected document once per statement/bounded queue item.
- Incremental rebuild never deletes unrelated documents and is resumable after a forced interruption.
- Same hash preserves embedding; changed hash clears embedding metadata/error.
- Two concurrent claimers cannot receive the same live lease.
- Expired lease is reclaimed; active foreign lease is rejected.
- Stale-hash or wrong-lease embedding write is refused.
- Transient retry advances attempt/cooldown; terminal/exhausted errors remain visible and resettable by admin only.
- Search RPC returns only caller-authorized IDs/ranks and no unauthorized count.
- Grants/RLS/security-definer search paths meet shared-db security checks.
- Semantic weight/default and minimum-score behavior preserve keyword matches.

### PopDAM edge/function tests

- Missing/invalid JWT rejected.
- Ordinary authenticated user can search but cannot call embedding/status admin actions unless policy explicitly permits coverage reads.
- Two-user isolation test where globally best match is inaccessible.
- Edge response contains no unauthorized ID, rank, title, path, metadata, or count.
- Worker service credential can claim/embed/status; stale lease/hash is handled distinctly from provider failure.
- Embedding text model returns exactly 384 dimensions; mismatches become categorized terminal errors.

### Worker tests

Add `apps/worker/src/handlers/embed-search.test.ts` for empty queue completion, bounded batch, progress merge, stale write, transient retry, terminal error, lease expiry/restart, stop, overlap avoidance, and automatic-loop disable/bounds. Extend operation-loop tests for registration, lane, result message, revision-safe stop, and kill switch.

### Frontend/unit tests

Extend:

- `src/test/dam-search.test.ts`: hybrid result metadata, edge→keyword fallback, keyword→ILIKE signal, minimum score, authorized paging cursor, invalid config defaults.
- `src/test/asset-search.test.ts`: ranked hybrid pages, count/has-more behavior, no duplicates, empty browse unchanged, fallback chain.
- `src/test/style-group-search.test.ts`: same behaviors plus group results derived from member tags/characters.
- New SearchIndexCard tests: coverage states, admin authorization, start/stop/resume, ETA only after measurement, retry-terminal action.
- Library top-bar tests: Smart search and closest-match affordance conditions.

### Commands that must stay green

Use current package scripts after inspecting `package.json`; at minimum run the repository’s lint, TypeScript, root Vitest, and worker test/typecheck commands. Run `/worksp/shared-db/scripts/check-sql.sh` plus all preview checks required by current shared-db `AGENTS.md`. Do not invent a command if scripts changed—record the exact commands/results in STATUS.

### Visual and live verification

- Browser verification at `dam.designflow.app` and applicable `sg.designflow.app` mode.
- Desktop and narrow-width screenshots for the search indicator and admin card.
- Live build SHA/header, edge deployment, Railway worker startup, tag/character searches, multi-page rank, authorization isolation, fallback drill, and keyword rollback.

## 11. Constraints, standing rules, and gotchas

- All database structure belongs in `/worksp/shared-db`; no PopDAM migration, direct DDL, Dashboard SQL, or one-off `execute_sql`.
- A consumer session dispatches shared schema work through the single `shared-db-orchestrator`; it does not author the migration itself.
- Prove the database target immediately before every write, preview and production.
- Preview first. Production structural promotion and the long data backfill are separate approval gates.
- Never reuse a migration timestamp or edit an applied migration.
- App repo changes go directly to `main`; shared-db uses branch + PR. Never force-push or broadly stage.
- Preserve concurrent work and open handoffs. Re-snapshot status before pull/rebase/commit.
- The vendored `shared-db/` directory inside PopDAM is read-only.
- Generated `src/integrations/supabase/types.ts` is regenerated by deployment workflow; never hand-edit.
- `supabase/config.toml verify_jwt=false` requires the manual JWT validation path to stay intact and tested.
- Service role is permitted for worker-only maintenance, not for returning unfiltered user search results.
- Stable sorted aggregation is required; nondeterministic `string_agg` order would churn hashes and embeddings.
- Relationship UPDATE/DELETE must account for OLD and NEW asset/group IDs.
- Do not combine current delete-all rebuild with production rollout.
- Hash matching protects content freshness but does not replace lease ownership.
- Do not log query text, search documents, licensed metadata, secrets, or row contents to CI/issues/public artifacts.
- Automatic loop must be bounded and reversible; do not create competing worker and pg_cron schedulers.
- Railway deploy evidence does not prove frontend deploy evidence.
- A semantic result ceiling/count must be honest; never imply deeper pages exist when only 500 candidates were fetched.
- Telemetry and image embeddings remain off/out of scope until separately approved.

## 12. Access and environment

Expected tools: Git/GitHub CLI, Supabase CLI authenticated through 1Password, protected `ai-private-config`, project package manager/test tools, GitHub Actions, Railway/Coolify/Supabase authenticated interfaces, and browser verification tooling. Verify each at execution time; this planning session did not certify their current authentication.

- Production Supabase project: `qsllyeztdwjgirsysgai`; always resolve/prove through the canonical protected config/runbook.
- 1Password vault: `vibe_coding`.
- Shared-db Supabase CLI PAT item: `Supabase CLI Personal Access Token`.
- Shared production DB password item: `Supabase DB Password - shared POP database`; preview uses the separately named preview item documented in `/worksp/shared-db/AGENTS.md`.
- Worker runtime secrets live in Railway, including `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; never print their values.
- GitHub deploy secrets are documented in `docs/configuration.md`; do not copy values into this plan, logs, argv, or commits.
- Local frontend/test commands must be taken from current `package.json`/`docs/development.md` at execution time.
- Production URLs: `https://dam.designflow.app`, `https://sg.designflow.app`.

If a required canonical credential/tool is broken, repair that capability and verify it normally. Do not substitute an alternate production path.

## 13. Definition of done, risks, rollback, and open questions

### Definition of done

- [ ] Live pre-change state and component SHAs recorded with target proof.
- [ ] Tags and characters searchable for assets and style groups in keyword mode.
- [ ] Incremental maintenance replaces delete-all production rebuilding.
- [ ] Embedding claims are exclusive, leased, expiring, recoverable, hash-safe, and retry-aware.
- [ ] Automatic freshness is bounded, singleton, observable, and config-disableable.
- [ ] No inaccessible ID/rank/count crosses the edge response; cross-user test proves it.
- [ ] Admin coverage/start/stop/resume UI works and is visually verified.
- [ ] Ranked pagination/count semantics and weak-tail score/UX are honest.
- [ ] Full eligible corpus coverage or every terminal residue categorized and accepted.
- [ ] Railway restart/resume and stale-content behavior proven.
- [ ] Hybrid search enabled only after Albert approval; empty browse unchanged.
- [ ] Edge→keyword→ILIKE fallback and keyword rollback proven live.
- [ ] Required tests/checks/CI green.
- [ ] App/shared-db commits, PR/merge, production apply, frontend edge worker deployed SHAs recorded separately.
- [ ] Docs and STATUS reflect live reality; no untracked migration or stale handoff.
- [ ] Issue #97 closed only after all required items above.
- [ ] Telemetry either remains off/outstanding by explicit choice or passes its separate approval/retention phase.
- [ ] Image embeddings remain unimplemented; any proposal is clearly separate.

### Principal risks and mitigations

- **Database load/write amplification:** preview measurement, statement-level dedup/stale queue, bounded batches, no delete-all rebuild, kill switch.
- **Search outage:** keep keyword mode during indexing; single-config rollback; test both fallback levels.
- **Authorization leak:** user-scoped filtering before response; cross-user tests; minimal response fields.
- **Duplicate/wasted embeddings:** atomic lease, expiry, singleton scheduler, hash+lease checked write.
- **Permanent embedding gaps:** categorized retries, visible terminal residue, admin requeue.
- **Bad semantic matches:** calibrated minimum score plus honest closest-match UX and keyword weighting.
- **Pagination dishonesty:** server-side ranked paging/`has_more`, not an arbitrary larger ID ceiling.
- **Concurrent repo work:** owned-path staging, status snapshots, shared-db orchestration.
- **Deployment false positive:** prove frontend, edge, worker, schema, and config independently.

### Rollback

1. Immediate user-facing rollback: set `admin_config.SEARCH_MODE` to `keyword` through the authenticated admin workflow and verify browser behavior.
2. Stop manual embedding via existing operation stop; set `SEARCH_AUTO_EMBED_ENABLED=false` to stop new automatic claims. In-flight bounded work may finish safely.
3. Do not drop the vector/search structures during an incident. They are additive; preserve capability and diagnose.
4. If a new search RPC/edge deployment is faulty, deploy the corrected prior-compatible application version through GitHub while keyword mode remains active. Never live-edit Supabase/server code.
5. Database rollback is forward-fix through shared-db unless its approved migration explicitly supplies a safe reversible path; never edit applied migrations.

### Owner decisions and open questions

1. **Production structural promotion:** Albert must approve the exact merged shared-db migration after preview evidence. Blocks Step 2 production apply.
2. **Full production backfill:** Albert must approve after measured sample throughput and projected duration. Blocks Step 8 full run.
3. **Hybrid mode flip:** Albert must approve after coverage/security/fallback evidence. Blocks Step 9.
4. **Telemetry retention:** no telemetry implementation or enablement until Albert approves fields and retention. Recommended default if pursued: 30 days, query text excluded or normalized/redacted unless expressly approved.
5. **Image embeddings:** separate future investment; not approved by this plan.
6. **Freshness SLO and score threshold:** implementation may choose initial conservative values from measured evidence; report them before launch. Escalate only if the business tradeoff materially changes result coverage.

---

## Mandatory self-audit — final result

### 1. Could a brand-new AI session execute this plan without asking for context?

**Yes.** Sections 1–4 define the business goal, application, trigger, and boundaries. Sections 5–8 preserve exact repository state, line references, findings, rejected paths, and locked/open decisions. Section 9 gives ordered file/function-level implementation steps with dependencies, context cuts, and a verification gate for every step. Sections 10–13 supply exact test behaviors, constraints, access locations, landing proof, rollback, and owner-only approvals.

### 2. Does the plan carry the background, nuance, and reasoning—including rejected approaches?

**Yes.** Sections 5–7 record what is already built, why the original rebuild/trigger/claim/security/telemetry details were unsafe, and twelve rejected approaches with reasons. Section 8 distinguishes decisions that are locked from choices that depend on measured evidence. The STATUS table prevents future sessions from treating plan assumptions as completed facts.

### 3. Is the ultimate goal clear enough for correct judgment if a step is wrong?

**Yes.** Section 1 leads in business language and explicitly says the goal wins over any conflicting step. Sections 4, 8, and 13 define the non-negotiable safety boundaries, open judgment criteria, approval points, and rollback, allowing an implementer to adapt without silently changing intent.

### Checklist grade

- [x] All 13 sections present.
- [x] Ultimate goal is first, plain English, and states that the goal wins.
- [x] Fresh session can proceed without planning-chat context.
- [x] Rejected approaches and reasons are explicit.
- [x] Every implementation step names concrete files/functions/objects and a verification gate.
- [x] Locked and open decisions are labeled.
- [x] Out-of-scope list is explicit.
- [x] Tests name exact behaviors and suites.
- [x] Paths, repos, environments, identifiers, and deployment components are defined.
- [x] Secrets are referenced by vault/item location only.
- [x] Definition of done includes commit, push, CI, deployment, and live SHA verification.
- [x] Plan and this session’s handoff link to each other; root `HANDOFF.md` remains untouched.
