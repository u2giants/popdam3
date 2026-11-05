# Plan: PopSG semantic search: restart indexing and finish acceptance (u2giants/popdam3#706)
Issue: https://github.com/u2giants/popdam3/issues/706
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

Parent plans (read their STATUS first, do not duplicate them): [plan_semantic_search_popdam_popsg.md](../../plan_semantic_search_popdam_popsg.md) (combined DAM+SG delivery; SG steps 5–10), [plan_hybrid_search_rollout.md](../../plan_hybrid_search_rollout.md) (DAM history and the November 1 failure contract), [plan_popsg_production_readiness.md](../../plan_popsg_production_readiness.md) (parent #107 gates). This plan is the SG-only execution of what remains for #706; it does not re-plan the database contract (shared-db #4437 stages 1–2 are live).

## STATUS

| Step | State | Evidence |
|---|---|---|
| 1. Fresh baseline of live op/coverage/config | ⬜ open | — |
| 2. Worker: consecutive-failure auto-resume accounting + one bounded claim retry | 🔄 partial | Reset landed for `sg-embed-search` only (#730, `operation-loop.ts:1749`); claim retry (2b) not landed |
| 3. Restart `sg-embed-search` and drain to full active coverage | 🔄 running | Restarted Nov 4, 4:46 PM EST; claim fix shared-db PR 5588 merged; re-measure coverage |
| 4. Edge: `popsg-search` action + per-app `search-modes` | 🔄 superseded in part | #730 shipped `popsg-query-embedding` instead; see §5a |
| 5. Frontend: SG mode adapter, hybrid request path, error/Retry contract | 🔄 partial | Request path landed (#730), switch off; silent keyword fallback violates the contract, see §5a |
| 6. Admin: SG coverage card and SG floor card | ⬜ open | — |
| 7. Re-measure latency at full coverage (broad queries) | ⬜ open | — |
| 8. Relevance gates (fixed suite, NDCG/recall) | 🔄 first run failed | 119-case run at 64% coverage: keyword matches displaced (fix: shared-db PR 5594, OPEN) and nonsense queries return results (floor needed) |
| 9. Activate `POPSG_SEARCH_MODE=hybrid`, observe, rehearse rollback | ⬜ open | — |
| 10. Delete tester `sg-qa-semantic-20261028@popcre.com` | ✅ done | #706 comment Nov 4, 5:05 PM EST: account and invitation deleted; re-check with the step 10 gate only |
| 11. Live proof, docs, STATUS updates, issue checklist | ⬜ open | — |

**Where a fresh session starts:** step 1, then step 2. Steps 2 and 4–6 are independent code work and may run in parallel branches; step 3 needs step 2 deployed; steps 7–9 need step 3 at 100% active coverage and steps 4–6 deployed. Step 10 is independent and may run any time after step 8's drills no longer need the tester.

---

**Superseded failure wording:** see "Reconciliation" in `plan_vector_consolidation.md`; error and Retry wins over any keyword fallback here.

## 5a. Corrections since this plan was written (verified on `origin/main` `e037dd7a` (Nov 4, 2026, 6:05 PM EST) and the #706 comment of 5:05 PM EST)

This overrides §3, §5, §6 and §9 wherever they differ.

- **Claim root cause was wrong in §6.2.** Measured: the claim plans a hash join and full sort of all ~79k pending rows (38.9 s; 4.2 s cold with the ordered index walk). It is a plan problem, not only a transient. Fix: shared-db PR 5588 (merged), pinned plan plus more frequent autovacuum.
- **Wiring exists behind a switch that is off.** #730 added `popsg-query-embedding` (`supabase/functions/dam-search-ai/index.ts:119-137`), which returns the vector to the browser; the browser calls the RPC itself with its own session (`src/pages/popsg/PopSGLibraryPage.tsx:132-178`). Do not also build `popsg-search`; §9 step 4b is superseded unless step 5c below needs it. The vector goes to the browser, but the text-embed key does not, so finding §6.4 still holds.
- **Contract violation to fix.** `fetchPopSGQueryEmbedding` catches every failure and runs keyword only (`PopSGLibraryPage.tsx:142-146`), and `parsePopSGQueryEmbedding` documents the same. That is the silent downgrade the November 1 contract forbids (§6.6, §8 LOCKED). Step 5c must change it before activation: an outage in hybrid mode shows error and Retry. Exception to keep: a product-code query, which skips the embedding on purpose. Test: "a failed embedding in hybrid mode shows an error and Retry, not keyword results". Embedding failure must also be distinguishable from mode `keyword`, so the edge action needs to report it (today `embedding: null` covers both).
- **Parent plan.** `plan_vector_consolidation.md` (#735, owner request Nov 4) now also tracks #706: its Step 2 replaces the `sg-embed-search` lane, Step 5 is the scorecard, Step 6 is activation. Read its STATUS first. Where both cover the same work, it wins; use this file for the #706 checklist and the corrections here. Steps 2b and 6 here are dropped if its Step 2 lands first; say so on #706.

**Gates added by the comment:**
- Step 8 prerequisite: shared-db PR 5594 merged and live. Do not activate before it. Owner: shared-db #4437, claim-first.
- Step 8: choose the floor only after coverage completes; gate "nonsense queries return 0 meaning-only rows" is the case that failed.
- Step 7: hybrid p95 was 10-11 s against the 3 s target. §9 step 7's rule (continue only if hybrid adds no regression over keyword) does **not** pass on this number unless keyword measures the same. Hold activation and record the measured gap on #706; do not close #706 with the target silently unmet.

## November 4, 2026, 9:33 PM EST execution checkpoint

The filename-text vectors were cleared and replaced by the GPU picture lane in #741 / shared-db #5607. Do not restart the retired text-indexing operation. Fresh production aggregate: 234,861 rows, 13,336 inactive, 221,525 active; 33,408 embedded, 185,873 pending with thumbnails, 2,244 waiting for thumbnails, zero errors. Recent writes: 9,372 / 15 minutes and 3,072 / 5 minutes, latest at 9:33 PM EST. At that measured rate the available-thumbnail queue needs approximately five hours; this is an estimate, not acceptance. No intervention is indicated.

This change repairs the remaining silent keyword downgrade: an unsuccessful embedding request now reaches the existing error and Retry view; the edge responds 503 when a required hybrid embedding fails. Keyword mode and confirmed catalog product codes still intentionally omit embeddings. The async product-code bug tracked by #734 is included as the prerequisite; the catalog decision is awaited and ordinary words actually call the embedding service. Retry executes the complete request again, including a fresh mode/config read.

Verification: root lint (zero errors), typecheck, production build, edge Deno check, 17 adapter tests and four edge-helper tests pass. Full-suite first run found one unrelated OrderList timeout; rerunning that suite with the changed suites passed all 35 tests. Live deployment proof remains the coordinator's responsibility. Full coverage, relevance, latency, floor selection and activation remain pending; #706 stays open with live proof unchecked.

## 1. The ultimate goal

Designers and sales staff using the style-guide library at https://sg.designflow.app should be able to type an ordinary description ("cute yellow character holding balloons") and get the useful style-guide files and guides first, while exact names, folder names and licensor/property words keep finding exactly what they find today. Search must stay available (keyword) when the meaning service is down, must never show a record the signed-in user is not allowed to see, and must show the administrator how much of the library is covered by meaning-search.

What is true today that must change: the index that makes this possible stopped on October 28 at 139,537 of ~221,000 active documents; the PopSG page still sends keyword-only searches; nobody has measured whether the meaning results are good or fast enough on the full library.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Semantic search here means adding meaning-based retrieval to the existing search with keyword precision retained; it never means removing exact matches, hiding a failure behind "0 results", or showing weakly related files to avoid an empty page.

## 2. What this application is

- PopDAM/PopSG is one React 18 + Vite + TanStack Query frontend (`src/`), served by Coolify app `qxj8a0j3tpa9lq4q5rs6pezy` at `dam.designflow.app` (PopDAM, licensed-art asset manager) and `sg.designflow.app` (PopSG, style-guide library; hostname selects the mode). Repo `u2giants/popdam3`, default branch `main`, this work on a feature branch + PR.
- Backend: hosted Supabase project `qsllyeztdwjgirsysgai` (Virginia). Edge functions in `supabase/functions/**` deploy through `.github/workflows/deploy-supabase.yml`. Database structure is owned by `popcre/shared-db` (canonical checkout `/worksp/shared-db`); `shared-db/` inside this repo is a read-only mirror.
- Railway worker `apps/worker` runs long operations ("bulk ops") stored in `admin_config.BULK_OPERATIONS`; it auto-deploys on every push to `main`.
- `apps/text-embed` is the SigLIP2 text tower (`google/siglip2-base-patch16-naflex`, 768 dims) at https://text-embed.designflow.app (Coolify on hetz). Its URL/key live in `admin_config.TEXT_EMBED_URL` / `TEXT_EMBED_KEY` (worker) and as Supabase function secrets of the same names (edge). The key's 1Password item: vault `vibe_coding`, "PopDAM text-embed SigLIP2 query key - dam-search-ai (edge-dev)".
- Test logins: 1Password vault `vibe_coding`, items "PopSG / PopDAM AI tester login" (user role) and the administrator item `ai-admin@designflow.app` (admin role with `styleguides` access). Never screenshot PopSG Settings → Setup (renders the NAS password).

## 3. What triggered this work

Issue #706 was split from #107 by the November 4, 2026 audit. The PopSG embedding backfill `sg-embed-search` has been `interrupted` since October 28, 10:34 AM EDT after `claim_sg_search_embedding_documents` statement timeouts exhausted its 10 auto-resume attempts. Live on November 4 (read-only SQL, this planning session): 139,537 embedded, 79,693 claimable pending, 2,233 waiting for a thumbnail, 0 errored, 0 leased, `max(embedding_attempts)=0` on every pending row (they were never claimed; nothing is stuck in backoff).

Reproduce: read `admin_config.BULK_OPERATIONS->'sg-embed-search'` (read-only). Expected now: `status=interrupted`, `interruption_reason_code=statement_timeout`, `auto_resume_attempts=10`, `cursor=90`, `batch_size=100`, `updated_at=2026-10-28T14:34:35Z`, `progress.message="Embedded 100, failed 0, stale 0 of 100 claimed"` (the last batch succeeded; the next claim timed out).

The October 28 app-side acceptance drills (comment on #107, ZCode, 1:56 AM EDT) passed keyword, floor, truthfulness and regression checks at 33.5% coverage but recorded: broad `disney` queries 4.1–12.1 s files / 5.9–8.6 s guides (target warm p95 ≤ 3 s); SG UI sends keyword-only args; relevance gates pending full coverage.

## 4. Scope

### In this plan
- Restart and finish the SG embedding backfill with a worker fix so a long run cannot die from cumulative transient timeouts.
- Wire semantic search into the PopSG Library page behind an SG-specific switch, with the November 1 failure contract (error + Retry, never a silent downgrade).
- Admin coverage card and SG floor card.
- Latency re-measurement, relevance gates, activation, rollback rehearsal, tester deletion, live proof on #706 (and the matching #107 checklist line).

### NOT in this plan
- Any change to `search_style_guide_library_v2`, the claim/meter RPCs, indexes or grants (shared-db only; if step 7 proves a DB-side latency problem, it is filed on shared-db #4437, not fixed here).
- DAM search (#97, #564), image/picture similarity, PDF extraction coverage (#107 gate 7), crawl acceptance (#107 gate 9), tagging.
- Raising any statement timeout, adding a second scheduler, a browser-side embedding loop, or resetting embedded rows.
- Replacing SigLIP2 or changing the 768-dim model (a failed relevance gate stops activation and opens a reviewed model decision instead).
- Telemetry / click tracking.

## 5. Current state of the code (main at `01fcfc34`, 2026-11-04)

Worker (`apps/worker`):
- `apps/worker/src/handlers/embed-sg-search.ts:317-418` `handleEmbedSgSearch`: one batch = `claim_sg_search_embedding_documents(p_limit, p_worker_id, p_lease_seconds=600)` → embed via `POST /embed-text` (concurrency 6, 10 s timeout, text sliced to 8,000 chars) → `upsert_sg_search_embedding`; claim error returns `{ok:false, done:false, error:"claim_sg_search_embedding_documents failed: …", postgres_code}` (lines 341-350). Batch size default 100, max 500 (lines 34-35). Automatic freshness `maybeEmbedPendingSgSearchDocuments` (lines 431-453) only when `POPSG_SEARCH_AUTO_EMBED_ENABLED === true`, 25 docs/minute, called from `apps/worker/src/index.ts:74`.
- `apps/worker/src/operation-loop.ts:58` `AUTO_RESUME_MAX_ATTEMPTS = 10`; `classifyError` (751-765) maps "57014"/"statement timeout" → `statement_timeout`; `nextAutoResumeAt` (772-776) returns `undefined` once `auto_resume_attempts >= 10`; the tick auto-resume block (1157-1200) requires `attempts < 10`. **The success path (1722-1760) never resets `auto_resume_attempts`:** `currentState = {...currentState, error: undefined, interruption_reason_code: undefined, next_auto_resume_at: undefined, …}` keeps the old counter, and `persistOpState` at 1745 writes it back. So the counter is cumulative over the whole run, not consecutive — a 2,000-batch run dies on the tenth transient blip. Registration: `operation-loop.ts:933` dispatch, lane `search-index` (`:445` for DAM; SG lane in `supabase/functions/_shared/operation-constants.ts:57` and `src/components/settings/diagnostics/types.ts:111`).
- `apps/worker/src/operation-retry.ts:19-33` `isValidAutoResumeCursor`: numeric cursor is valid; `sg-embed-search` has a numeric cursor (handler returns no `nextOffset`, loop increments), so auto-resume is eligible until the cap.
- Tests: `apps/worker/src/handlers/embed-sg-search.test.ts` (13 tests, lines 58-192), `apps/worker/src/operation-loop.test.ts` (auto-resume assertions at 199-219).

Database (live, verified 2026-11-04 by read-only SQL): migrations `20261027012301` (stage 1 foundation), `20261027183509` (stage 2 search), `20261028013854` (claim/meter covering indexes) are all in `supabase_migrations.schema_migrations`; indexes `idx_sg_search_documents_claim_pending` and `idx_style_guide_files_thumbnail_live` exist. `EXPLAIN ANALYZE` of the claim's candidate query (`limit 100`, no `FOR UPDATE`) ran in **116 ms warm, 7,810 shared buffer hits, index-only on the claim index** — the planner fix works; the October 28 timeouts were cold-cache/under-write-load transients against the **8 s** statement budget (`authenticator` rolconfig `statement_timeout=8s`; `service_role` has no own setting, so worker RPCs inherit 8 s). `search_style_guide_library_v2` is a single 17-argument overload (`…, p_query_embedding vector, p_min_semantic_score real`) pinned `statement_timeout=30s, work_mem=64MB`; it enforces `has_app_access(auth.uid(),'styleguides')` (mirror `shared-db/supabase/migrations/20261027183509_popsg_semantic_search_stage2.sql:103-104`), ANN cap 2000 / `hnsw.ef_search=100` (`:96, :297-310`), floor applied to semantic-only candidates (`:308`).

Config (live): `SEARCH_MODE=hybrid` (DAM). `POPSG_SEARCH_MODE`, `POPSG_SEARCH_AUTO_EMBED_ENABLED`, `POPSG_SEARCH_MIN_SEMANTIC_SCORE` have **no rows** and **no reference anywhere in app code** (`grep -rn POPSG_SEARCH_MODE src supabase apps` is empty; only `docs/configuration.md:114-115` documents the auto-embed and text-embed keys). `TEXT_EMBED_URL` row exists.

Edge (`supabase/functions/dam-search-ai/index.ts`): `search-modes` (105-116) returns `{modes:{dam}}` via `loadDamSearchMode` (`supabase/functions/_shared/search-access.ts:14-27`, which calls `require_dam_access` and throws 403 otherwise — an SG-only user gets 403 today). `embedQueryText` (48-93): `TEXT_EMBED_URL`/`TEXT_EMBED_KEY` from function secrets, 4 s timeout, one immediate retry, returns `null` on failure. `search` (150-…) is DAM-only (`document_types` asset/style_group). No SG action exists.

Frontend: `src/pages/popsg/PopSGLibraryPage.tsx:130-172` `fetchPopSGV2Page` expands `filters.nameSearch` with `expandFallbackTerms` (`src/lib/dam-search.ts:192`), builds websearch syntax with `buildPopSGV2WebsearchQuery` (`src/pages/popsg/popsgSearchV2.ts:81-89`) and calls `supabase.rpc("search_style_guide_library_v2", buildPopSGV2Args(...))` directly from the browser; `buildPopSGV2Args` (`popsgSearchV2.ts:163-186`) emits no `p_query_embedding`/`p_min_semantic_score`. Query keys `["popsg","groups"|"files", filters, sortField, sortDirection, page, pageSize]` (`:776, :826`); error states `groupsError`/`filesError` exist (`:775, :825`). DAM's mode adapter to copy: `src/lib/dam-search.ts:77-108` (`getSearchMode`, 30 s TTL, sticky last-known-good mode, `invalidateSearchMode`). Tests: `src/pages/popsg/popsgSearchV2.test.ts` (11 cases), `src/test/dam-search.test.ts` (search-modes behaviour at 100-188), `src/test/search-access.test.ts`.

Admin UI: DAM coverage card `src/components/settings/SearchIndexCard.tsx:19-24` (`usePersistentOperation("embed-dam-search")` + edge `embedding-status`); DAM floor card `src/components/settings/SemanticFloorCard.tsx` (`get-config`/`set-config` on `SEARCH_MIN_SEMANTIC_SCORE` via `supabase/functions/_shared/semantic-floor.ts:4,11`). Both are mounted in `src/components/settings/AiTaggingTab.tsx:12-14` (DAM Settings → Processing → AI Tagging). PopSG Settings (`src/pages/popsg/PopSGSettingsPage.tsx`) has "PDF Search Coverage" at `:1058` and uses `usePersistentOperation("tag-popsg-files")` at `:115`; no SG embedding card exists (the October 28 drills read the generic op name "Embed PopSG Search" from `OP_NAMES`, `src/components/settings/diagnostics/types.ts:83`).

Admin API: `update-bulk-op` (`supabase/functions/admin-api/index.ts:687-733`) passes `op_state` to RPC `update_bulk_operation` and refuses `running` when `findRunningConflict` finds a same-lane op. `revoke-invite` (`:533-572`) deletes the invitation row and the auth user (`auth.admin.deleteUser` at `:567`) — the route to delete the tester.

## 6. Key findings and root cause

1. **Why the backfill is dead:** cumulative auto-resume accounting (operation-loop.ts:1722-1760 never resets `auto_resume_attempts`). Ten transient claim timeouts spread over 1,395 successful batches are enough to park the op permanently. Live state confirms it (`auto_resume_attempts=10`, last batch succeeded).
2. **Why claims timed out:** the claim ran under the 8 s PostgREST budget while the backfill itself was writing ~9 docs/s to the same table; the October 28 covering-index migration is live and the candidate walk is now ~0.1 s warm. Cold starts can still exceed 8 s (the meter was measured at 16.3 s first-after-idle on October 28). This is transient by nature; the correct app-side response is a bounded retry plus consecutive-failure accounting, not a timeout increase.
3. **Nothing is wedged in the data:** 0 leased rows, 0 backoff rows, 0 drifted thumbnails, `max(embedding_attempts)=0`; 2,233 docs wait for a thumbnail and will become claimable when a render lands (claim predicate `f.thumbnail_url is not null`, stage 1 mirror `:…` review note M1).
4. **The browser cannot do semantic search on its own:** the text-embed key is a secret, so the query vector must be produced server-side (edge) and the floor must stay server-side (locked in the parent plan). The SG RPC enforces access from `auth.uid()`, so the RPC must be called with the caller's session, never the service role.
5. **SG-only users are locked out of `search-modes`** (403 from `require_dam_access`); the SG wiring needs a per-app answer.
6. **Failure contract (owner request, November 1, #564 / PR #641, `plan_hybrid_search_rollout.md` STATUS):** a failed ranked search shows an error and Retry; it never silently runs a different keyword search. SG must follow the same contract.
7. **Latency gap is on totals/facets for broad terms** (~95k matching rows), not on the ANN leg (semantic probes were 0.34–1.04 s). If it persists at full coverage it is a DB-contract matter for shared-db #4437.

## 7. Approaches considered and rejected

| Approach | Why rejected |
|---|---|
| Raise `AUTO_RESUME_MAX_ATTEMPTS` or remove the cap | Keeps the cumulative bug; a real crash loop would then run forever. Consecutive accounting is the fix. |
| Raise the claim's statement timeout in the RPC or role | Forbidden by standing rules (no timeout increases); the claim is already fast. |
| Reset the op by hand (`update-bulk-op` with `auto_resume_attempts:0`) without the worker fix | Would restart and die again at the tenth blip; allowed only as the restart action *after* the fix is deployed. |
| Browser calls text-embed directly | Exposes the key; rejected. |
| Edge calls the SG RPC with the service role | Bypasses `has_app_access` → leak; rejected. |
| Silent keyword fallback when the edge/hybrid path fails | Contradicts the November 1 owner contract. |
| New edge function `popsg-search-ai` | Duplicates auth/embed/floor code; one action in `dam-search-ai` reuses `embedQueryText`, `authenticateCaller`, `searchAccessStatus`. OPEN: if the function name confuses operators, rename later; do not fork code now. |
| Re-embedding the 139,537 done rows | Same model/dim/preprocessing; nothing invalidated them. |

## 8. Design decisions

**LOCKED (parent plan, October 18; owner contract November 1):**
- SG switch `POPSG_SEARCH_MODE` (`keyword` default), freshness `POPSG_SEARCH_AUTO_EMBED_ENABLED`, floor `POPSG_SEARCH_MIN_SEMANTIC_SCORE` parsed with `parseSemanticFloor`; never reuse DAM's values.
- Query embedding and floor are applied server-side; RPC runs as the caller.
- Hybrid-path failure = visible error + Retry; mode probe failure on a cold start = error; a previously verified mode stays sticky through a transient probe failure.
- Worker: consecutive-failure auto-resume accounting; a successful batch resets the counter.

**OPEN (implementer's judgment, with criteria):**
- Whether the SG mode card lives on PopSG Settings or DAM Settings → AI Tagging: put the coverage card on **PopSG Settings** next to "PDF Search Coverage" (SG operators look there); put the SG floor/mode card beside the DAM one in `AiTaggingTab` only if PopSG Settings has no admin-config editor pattern — check `PopSGSettingsPage.tsx` for an existing `set-config` usage first.
- Initial SG floor value: derive from step 8 judgments; until then leave the row absent (no floor), which the drills showed returns 102 ordered semantic-only hits for a paraphrase and 0 for a non-match at 0.99.

## 9. The plan

### Phase A — baseline and worker fix (steps 1–3)

**Step 1 — Fresh baseline (read-only).** Run `ai-task-gates` declare `code` for the app work and `production` read-only for the SQL. Record: `BULK_OPERATIONS->'sg-embed-search'`; `get_sg_search_embedding_status()` (it is `service_role`-only — read through the worker's admin route or the aggregate SQL below); counts from `style_guide_search_documents` joined to `style_guide_files` (claimable / waiting thumbnail / leased / backoff / errored); the three `POPSG_SEARCH_*` rows; text-embed `GET /health` (expect `ok:true, dim:768`). Save to `docs/verification/popsg-semantic-706-baseline-<date>.md` (aggregates only, no file names). Gate: the file exists and its numbers match `get_sg_search_embedding_status` exactly (the October 28 drill proved the meter equals raw counts).

**Step 2 — Worker fix (`apps/worker`).**
2a. `apps/worker/src/operation-loop.ts` success path (around 1722-1760): after a batch returns `ok:true`, set `auto_resume_attempts: 0` in both the in-memory `currentState` and the `persistOpState` payload. Keep `autoResumeAttempts`/`wasAutoResumed` captured *before* the reset so the `rebuild-style-groups` receipt (`:1770`) still records how many resumes preceded completion.
2b. `apps/worker/src/handlers/embed-sg-search.ts:336-350`: on a claim error whose message/code classifies as `statement_timeout` (reuse `classifyError` from operation-loop or move it to `operation-retry.ts` to avoid a circular import), wait 2 s and retry the claim **once**; surface the second failure exactly as today. No loop.
2c. Tests (`apps/worker/src/operation-loop.test.ts`): "a successful batch resets auto_resume_attempts so only consecutive transient failures count"; "ten consecutive statement timeouts still park the op". Tests (`embed-sg-search.test.ts`): "a single claim statement timeout is retried once before the batch fails"; "two consecutive claim timeouts fail the batch with postgres_code 57014".
2d. `npm ci --prefix apps/worker && npm run build --prefix apps/worker && npm run test --prefix apps/worker` green. Note (parked handoff §6): 19 pre-existing worker-suite failures were reported on main on October 26 — verify on a clean checkout before attributing any failure to this change; if they persist, list them in the PR body and do not "fix" them here.
Gate: PR merged to `main`; Railway deploy shows the merge SHA; worker log line `worker: connected to Supabase — polling loop started` for the new build.

**Step 3 — Restart and drain.** Through the admin UI (Settings → Operations or the SG coverage card from step 6 if already deployed) press Resume, or call admin-api `update-bulk-op` with `{op_key:"sg-embed-search", op_state:{status:"running", auto_resume_attempts:0, params:{batch_size:100}}, only_if_status:"interrupted"}` (service identity; `findRunningConflict` must find no `search-index`-lane op running — check `embed-dam-search`/`rebuild-image-vectors` first). Keep `batch_size` 100 (500 was used on October 27; 100 keeps each claim's `FOR UPDATE` footprint small). Monitor at meaningful transitions only (first batch, ~50%, drain) via the status RPC; expected throughput ~9 docs/s → ~2.5 h for 79,693. Gate: `get_sg_search_embedding_status` shows `pending_documents = 0` (or only rows whose live thumbnail is null) and `errored_documents` explained; op `status=completed` with `message` "PopSG embedding backlog drained: N/N". Then set `POPSG_SEARCH_AUTO_EMBED_ENABLED=true` via `set-config` so nightly crawl additions stay covered (25 docs/min); confirm one automatic batch log line `automatic popsg search embedding batch` within 2 minutes.

### Phase B — application wiring (steps 4–6; independent of Phase A)

**Step 4 — Edge (`supabase/functions/dam-search-ai/index.ts`).**
4a. Extend `search-modes` (105-116): compute `dam` via `loadDamSearchMode` **only if** the caller has DAM access, and `sg` via a new `loadSgSearchMode(caller, readMode)` in `_shared/search-access.ts` that calls `caller.rpc("has_app_access", {required_app:"styleguides"})` and reads `POPSG_SEARCH_MODE` with the service client (same unwrap rules, default `keyword`). Return `{modes:{dam?, sg?}}`; respond 403 only when the caller has neither app. Preserve existing DAM tests in `src/test/search-access.test.ts`; add "returns sg mode for a styleguides-only user and omits dam" and "does not read POPSG_SEARCH_MODE for a user without styleguides access".
4b. New action `popsg-search`: body `{ raw_query: string, rpc_args: object }`. Validate `rpc_args` keys against the exact allow-list of the 15 keyword parameters of `search_style_guide_library_v2` (`p_result_mode, p_query, p_licensors, p_properties, p_style_guides, p_extensions, p_tags, p_preview_states, p_render_exception_states, p_pdf_content_states, p_modified_after, p_modified_before, p_sort, p_limit, p_offset`) with type checks (`p_limit` 1..200, `p_offset` ≥ 0, arrays of strings ≤ 50 items, strings ≤ 2,000 chars); reject any `p_query_embedding`/`p_min_semantic_score` from the client with 400. Server computes `embedding = await embedQueryText(raw_query)` (reuse 48-93) and `floor = parseSemanticFloor(POPSG_SEARCH_MIN_SEMANTIC_SCORE row)`; call `auth.client.rpc("search_style_guide_library_v2", {...rpc_args, p_query_embedding: embedding ? `[${embedding.join(",")}]` : null, p_min_semantic_score: embedding ? floor : null})`. Return `{ok:true, payload, semantic: embedding ? "siglip2" : "skipped"}`. If the RPC fails, return the RPC status (57014 → 503 with `code:"statement_timeout"`), never a substituted keyword call. Service-role callers get 403.
4c. Tests in `supabase/functions/dam-search-ai/*.test.ts` (Deno, pattern of the existing file set): "popsg-search rejects client-supplied embedding/floor", "popsg-search passes null embedding when text-embed is down and reports semantic:skipped", "popsg-search uses the caller client, never the service client, for the RPC".
Gate: `deploy-supabase.yml` run green on the merge SHA; `curl` with the tester's JWT to `/functions/v1/dam-search-ai` `{"action":"search-modes"}` returns `{modes:{sg:"keyword"}}` (row absent) and `popsg-search` with a nonsense phrase returns `semantic:"siglip2"` and 0 rows at floor 0.99 (set temporarily on preview, not production).

**Step 5 — Frontend.**
5a. `src/pages/popsg/popsgSearchV2.ts`: add `getPopSGSearchMode()` / `invalidatePopSGSearchMode()` mirroring `dam-search.ts:77-108` but reading `data.modes.sg` (share the TTL/sticky helper by extracting a small `createModeProbe(key)` in `src/lib/search-mode-probe.ts` used by both adapters — do this only if the extraction keeps `dam-search.test.ts` green unchanged). Add `fetchPopSGHybridChunk(request, rawQuery, signal)` that posts `{action:"popsg-search", raw_query, rpc_args: buildPopSGV2Args(request)}` and runs the result through `parsePopSGV2Payload`.
5b. `PopSGLibraryPage.tsx:130-172`: when `filters.nameSearch` is non-empty and mode is `hybrid`, use `fetchPopSGHybridChunk` with `raw_query = filters.nameSearch` (the raw typed text, **not** the websearch expansion — parent plan finding 2) while `p_query` keeps the expanded websearch string; when mode is `keyword` or there is no query, keep today's direct RPC path byte-for-byte. Add the mode to the query keys (`:776, :826`) so activation/rollback invalidates pages and resets to page 0.
5c. Error contract: an edge/hybrid failure (including a cold mode-probe failure) renders the existing error state with a Retry button that calls `invalidatePopSGSearchMode()` then `refetch`; the page must not show "0 files"/"0 style guides" for a failed search. Reuse the DAM component from PR #641 if it is generic (`src/test/library-search-error.test.tsx` shows its contract); otherwise add `PopSGSearchError`.
5d. Tests: `popsgSearchV2.test.ts` — "hybrid mode sends the raw query and keyword args to the edge, never an embedding"; "keyword mode never calls the edge"; "mode change changes the query key"; `src/test/popsg-search-error.test.tsx` — "a failed hybrid search shows an error and Retry, not zero results"; "Retry after a probe failure re-probes the mode".
Gate: `npm run lint && npm run typecheck && npm run test && npm run build` green; after `publish-frontend.yml` + Coolify, `sg.designflow.app` serves the merge SHA (AGENTS.md stale-site check) and a signed-in tester search in keyword mode is unchanged (same totals as the October 28 drill: `logo` 3,905 files, `disney` 367 guides, modulo crawl churn).

**Step 6 — Admin cards.**
6a. `src/components/settings/PopSGSearchIndexCard.tsx` modeled on `SearchIndexCard.tsx`: `usePersistentOperation("sg-embed-search")`, coverage from a new admin-only edge action `popsg-embedding-status` in `dam-search-ai` (service client → `get_sg_search_embedding_status`, after an admin check identical to DAM's `embedding-status` at `:132`); show embedded / pending / waiting-for-thumbnail / errored and compute coverage over **active** documents (`pending+embedded+waiting`), not `total_documents` (drill defect 5: `total_documents` includes 13,283 inactive rows). Mount on `PopSGSettingsPage.tsx` next to PDF Search Coverage (`:1058`).
6b. SG floor + mode card: generalize `SemanticFloorCard.tsx` to take `configKey` and label; mount an instance for `POPSG_SEARCH_MIN_SEMANTIC_SCORE` and a two-value selector for `POPSG_SEARCH_MODE` (`keyword`/`hybrid`) with saved-value readback. Place per the OPEN decision in §8.
6c. Tests: `src/test/popsg-search-index-card.test.tsx` — "shows coverage over active documents and start/stop/resume"; extend `search-index-card.test.tsx` only if shared code moved.
Gate: signed-in administrator sees the card on `sg.designflow.app/settings` with numbers equal to the status RPC; desktop and mobile screenshots saved (never of the Setup tab).

### Phase C — measure, gate, activate, close (steps 7–11)

**Step 7 — Latency at full coverage.** With the tester session, call `search_style_guide_library_v2` directly (keyword) and `popsg-search` (hybrid) for: browse (no query), `logo`, `disney` (broad), a paraphrase, a nonsense phrase; files and guides; 3 warm runs each; record p50/p95 in `docs/verification/popsg-semantic-706-latency-<date>.md`. Decision rule: warm p95 ≤ 3 s and cold ≤ 6 s pass. If broad queries still exceed 3 s warm, do **not** tune the app; open the finding on shared-db #4437 with the EXPLAIN (totals/facets over the broad keyword set), and continue with steps 8–9 only if the slow queries are keyword-equivalent today (i.e. hybrid adds no regression over the current keyword path).

**Step 8 — Relevance gates.** Use the private `SEARCH_EVAL_SET_V1` (see `docs/SEARCH_EVAL.md`) for the SG Files/Guides subsets (10 queries each: exact filename, character spelling/alias, paraphrase, multi-attribute, tags-only phrase, restrictive filter, no useful match, unsupported language). Pre-label expected useful records in private storage (`/tmp/sgqa/` on hetz; never commit identifiers). Run keyword vs hybrid, compute per-view NDCG@10 and recall of the labeled set, and ANN recall vs an exhaustive eligible-vector oracle (read-only SQL, `set local hnsw.ef_search` cannot be changed by the app; compare the RPC's top-K against a brute-force `order by embedding <=> q limit 2000`). Pass: hybrid NDCG ≥ keyword on every view, no exact-identifier case loses its record, no-match query returns 0 semantic-only rows at the chosen floor. Choose `POPSG_SEARCH_MIN_SEMANTIC_SCORE` from the judgments. Save aggregates to `docs/verification/popsg-semantic-706-relevance-<date>.md`.

**Step 9 — Activate and rehearse rollback.** Snapshot the absent rows privately. `set-config POPSG_SEARCH_MIN_SEMANTIC_SCORE` (step 8 value), then `POPSG_SEARCH_MODE=hybrid`. Prove: `search-modes` returns `sg:"hybrid"` for the tester within 30 s; a paraphrase search in the UI returns semantic hits with the keyword leg's exact hits retained; a signed-in user **without** `styleguides` access gets 403 on `popsg-search`; stop text-embed briefly on Coolify (or point `TEXT_EMBED_URL` secret at a dead host on preview) → the UI shows the error + Retry, not 0 results. Rollback: `POPSG_SEARCH_MODE=keyword` → within 30 s searches use the direct RPC path (network tab shows no `dam-search-ai` call). Re-activate. Gate: all five observations recorded with timestamps (EST) in the acceptance file.

**Step 10 — Delete the tester.** Call admin-api `revoke-invite` for `sg-qa-semantic-20261028@popcre.com` (invitation id `4dcc3f9d-5a65-467e-8f8d-e6e02c523e10`; the route deletes the invitation and the auth user at `index.ts:533-572`). Remove the protected `/tmp/sgqa/tester_creds.txt` on hetz. Gate: `select count(*) from auth.users where email='sg-qa-semantic-20261028@popcre.com'` = 0 and the invitation row is gone.

**Step 11 — Close.** Tick every checkbox on #706 with the artifact links; update `plan_semantic_search_popdam_popsg.md` STATUS rows 5–9 (SG column) and `plan_popsg_production_readiness.md` row 8; `docs/POPSG.md` (semantic search section: switch names, coverage card, failure contract), `docs/configuration.md` (three `POPSG_SEARCH_*` keys), `docs/BULK_JOBS.md` (consecutive-failure accounting, claim retry). Leave `- [ ] live proof` on #706 until the step-9 evidence is posted, then tick it; post the signed closing comment (`$AI_GH_SIGNATURE`). Note on #107 that gate 8's semantic half is delivered.

### Adversarial cases (trust boundary: `popsg-search` edge action)

| External input | Hostile case | Test |
|---|---|---|
| `rpc_args` keys | Client sends `p_query_embedding` / `p_min_semantic_score` / unknown key | "popsg-search rejects client-supplied embedding/floor" (400) |
| `rpc_args.p_limit` / `p_offset` | 0, negative, 10^9, string | "popsg-search clamps or rejects out-of-range paging" |
| `rpc_args` arrays | 10,000-element array, nested objects | "popsg-search rejects oversized or non-string filter arrays" |
| `raw_query` | 1 MB string, control characters, SQL fragments | "popsg-search truncates raw_query to 8,000 chars and passes it only to text-embed" |
| Caller identity | service-role JWT; user without `styleguides`; expired JWT | "popsg-search refuses service-role (403)", "…refuses non-styleguides users (403 from RPC)", "…returns 401 on expired token" |
| text-embed answer | wrong dim, `ok:false`, timeout | "popsg-search falls back to null embedding and reports semantic:skipped" |
| RPC failure | 57014 | "popsg-search surfaces statement_timeout as 503 and never substitutes keyword" |

## 10. Tests required

New (named above): worker 4, edge 3 + adversarial 7, frontend 5, admin card 1. Suites that must stay green: root `npm run lint && npm run typecheck && npm run test` (vitest; includes `dam-search.test.ts`, `search-access.test.ts`, `popsgSearchV2.test.ts`, `library-search-error.test.tsx`), `npm run test --prefix apps/worker`, `npm test --prefix apps/windows-agent` (CI runs it), `npm run build`.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; the AI merges (Albert does not). Wait on CI with `ai-pr-wait <pr>` in the background; never a sleep loop. Sign posts with `$AI_GH_SIGNATURE`.
- No DB structure change here; anything DB-side goes to `popcre/shared-db` claim-first on #4437 with the `shared-db-change` skill. Production DB read-only by default; the only production writes in this plan are through the app's own admin routes (`set-config`, `update-bulk-op`, `revoke-invite`).
- Never raise a statement timeout; never bypass `has_app_access`; never log the text-embed key; never commit licensed file names or paths (private evidence in `/tmp/sgqa/`).
- Do not edit `src/integrations/supabase/types.ts` (generated) or anything under `shared-db/` (mirror).
- `sg-embed-search` shares the `search-index` lane with `embed-dam-search`; `update-bulk-op` refuses a conflicting start — stop/finish the other first.
- Railway auto-deploys the worker on `main`; the frontend needs `publish-frontend.yml` + Coolify and the live header SHA check; edge needs `deploy-supabase.yml` (only triggers on `supabase/functions/**` changes).
- `search_style_guide_library_v2` caps `p_limit` at 200 and the app pages by 200-row chunks (`POPSG_SEARCH_RPC_LIMIT`); keep that in the hybrid path.
- The automatic freshness switch and the manual op share `handleEmbedSgSearch`; a process-local promise guards overlap on one replica only (parent plan step 5). Railway runs one replica; do not scale it without the lane-lease extension.
- Times for humans in EST (`TZ=America/New_York date`).

## 12. Access and environment

- Machine: hetz. `gh` authenticated as `u2giants`; Supabase MCP (`execute_sql`) reaches production read-only; `ai-task-gates`, `ai-pr-wait` on PATH.
- Edge function secrets (`TEXT_EMBED_URL`/`TEXT_EMBED_KEY`) and admin_config keys are set; values only in 1Password `vibe_coding` (text-embed key item named in §2; Supabase runtime keys item "Supabase Runtime Keys - shared POP database (production)").
- Test identities: 1Password `vibe_coding` "PopSG / PopDAM AI tester login" (user), administrator item `ai-admin@designflow.app`; session injection recipe in memory `project_popsg_tester_login.md` (password-grant → `localStorage['sb-popdam-auth-token']`).
- Local run: `npm ci && npm run dev` (frontend), `npm ci --prefix apps/worker && npm run build --prefix apps/worker`, Deno tests `deno test supabase/functions/dam-search-ai`.
- Live: https://sg.designflow.app, https://text-embed.designflow.app/health, Supabase `qsllyeztdwjgirsysgai`.

## 13. Definition of done, risks, open questions

Done when: all 11 STATUS rows cite an artifact; three PRs (worker, edge, frontend+admin) merged with CI green and deployed SHAs verified (Railway, edge run id, Coolify header); backfill at 100% active coverage with auto-freshness on; `POPSG_SEARCH_MODE=hybrid` live with the five step-9 observations; relevance and latency files committed; tester deleted; #706 checkboxes ticked and `live proof` ticked with links; parent plans' STATUS updated; this plan's STATUS marked done.

Risks: (1) cold-cache claim > 8 s on the first batch after idle — covered by the single retry; if it recurs twice in a row the op interrupts and auto-resumes with backoff (15 s…5 min). (2) Broad-query latency fails the 3 s target at full coverage — DB-side; file on #4437, keep hybrid off for SG until resolved only if hybrid is slower than keyword. (3) Rollback is one `set-config`; the worker fix has no data effect; the edge action is additive.

Open: whether `get_sg_search_embedding_status` is grantable to admins directly (check `pg_proc.proacl` in step 1; the plan assumes service-role-only and adds the admin edge action).

## Self-audit

1. *Could a brand-new session execute this without asking anything?* Yes — §5 gives every file:line, §9 gives per-step edits, bodies, commands and gates, §12 gives access by location, §8 fixes the decisions.
2. *Does it carry all background and rejected paths?* Yes — §6 (root cause with live evidence), §7 (eight rejected approaches), §3 (drill numbers and defects), §11 (traps: lane conflicts, 8 s budget, generated files).
3. *Is the goal clear enough to steer when a step is wrong?* Yes — §1 states the business outcome, the three failure modes that must never appear, and the goal-wins rule; §7/§8 say which decisions are locked.
