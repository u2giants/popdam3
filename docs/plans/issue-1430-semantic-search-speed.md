---
summary: Issue #1430 plan: speed up PopDAM and PopSG semantic search and fix 200-group file-count truncation across five phases. Read its STATUS first.
kind: plan
status: open
read-when: implementing, resuming, or verifying issue #1430 (PopDAM/PopSG semantic search speed, Groups file-count truncation, anchor merge, closed-sidebar facets, PopSG enrichment)
---

# Plan: Speed up PopDAM and PopSG semantic search and fix Groups file-count truncation (u2giants/popdam3#1430)

Issue: https://github.com/u2giants/popdam3/issues/1430
Handoff (registers this plan): [HANDOFF.d/2026-11-26T2212Z-edge-dev-antigravity-issue-1430-semantic-search-speed-plan.md](../../HANDOFF.d/2026-11-26T2212Z-edge-dev-antigravity-issue-1430-semantic-search-speed-plan.md)
Written 2026-11-26, 5:12 PM EST, by Antigravity on `edge-dev` (plan-only session; no implementation code written, no database changed, no shared-db claim held).

## STATUS (read first — 2026-11-26 5:12 PM EST)

Start at **Step 1**. Every step below is `⬜ open`. When marking any row `✅ done`, cite a verifiable artifact (commit SHA, test file + passing command, CI run ID, or shared-db production migration ledger entry) — never a bare count or PR number alone. Until live proof passes in Step 10, keep `- [ ] live proof` checked open on `#1430` and never open a second ticket for that gap.

| Step | Phase | What | Owner | State | Evidence |
|---|---|---|---|---|---|
| 1 | 1 | Shared-DB migration (`popcre/shared-db`): exact `total_group_files`, `p_include_facets boolean default true`, and group-only `dam_search_named_scope(p_filters, false)` in `search_dam_documents` | `lead-only` | ⬜ open | — |
| 2 | 1 | App + edge wiring: consume `total_group_files`, stop duplicate Groups `useStyleGroupAssetCount` hybrid search, pass `includeFacets: filtersOpen` with explicit `facetsIncluded` state | `lead-only` | ⬜ open | — |
| 3 | 1 | Mechanical UI/hook tests for single-request Groups search, >200-group & filtered-below-200 file counts, keyword-mode fallback, and closed-to-open Filter Sidebar facet fetch | `helper-ok` | ⬜ open | — |
| 4 | 2 | Preload `getSearchMode()`, defer `user_roles` to admin actions, combine `admin_config` reads, add successful-only `countDocs` cache, coalesce in-flight embeds, overlap spelling + speculative embed after code gates | `lead-only` | ✅ done | Code commit `21e351bc2` (search-mode preload + rejection eviction, lazy `isAdmin()`, one `admin_config` read, `countDocs` LRU, in-flight embed coalescing, speculative embed after both code gates); typecheck 0, lint 0 errors |
| 5 | 2 | Mechanical unit tests for Phase 2 edge & browser contracts (preload/error eviction, role deferral, config fail-closed/open, `countDocs` cache, embed coalescing, speculative embed discard/retry, style-number fast path) | `helper-ok` | ✅ done | Tests `503cc55ac`: `npx vitest run src/test/dam-search.test.ts supabase/functions/_shared/query-embed-batch.test.ts supabase/functions/dam-search-ai/index.test.ts` → 88/88 pass (2026-11-26 6:15 PM EST). Live proof after merge `d32b5c0` (6:25 PM EST, production, test viewer): `embedding-status` and `reset-embedding-errors` → 403; `search-modes` and two typed searches → 200 with results; Server-Timing `auth` 22–27 ms (was ~90), one `search_config` read, embed overlapping spelling |
| 6 | 3 | Shared-DB migration + edge cleanup: fold scoped picture-anchor calculation into `search_dam_documents` (before global top-2,000 cutoff), verify 0/137 parity, remove separate `anchor_rpc` | `lead-only` | ⬜ open | — |
| 7 | 3 | Shared-DB migration + edge update: DB-side exact multi-variant union before paging/counting (eliminating `dam-search-merge.ts` disjoint-union undercount) | `lead-only` | ⬜ open | — |
| 8 | 4 | PopSG single-call spelling: return `corrected` from `popsg-query-embedding` and remove redundant serial `action: "spelling"` round-trip from `PopSGLibraryPage.tsx` | `lead-only` | ✅ done | PR #1432 merged `7301666ba`; CI run 45908552474, edge deploy 45908552503 ✅, frontend publish 45908552530 ✅ (live asset `index-aLsIRtN7.js`); live sg.designflow.app typed search made 1 `dam-search-ai` call, 0 `spelling` (2026-11-26 6:12 PM EST); 65/65 PopSG eval left to Step 10 |
| 9 | 4 | PopSG inline guide summary: benchmark and join returned page guide identities directly against indexed `public.style_guide_file_groups_snapshot` (NOT the view) inside `search_style_guide_library_v2`, then remove browser enrichment chunks | `lead-only` | ⬜ open | — |
| 10 | 5 | Two clean Search test set readings + live browser timing & exactness proof, post-change cold `EXPLAIN` audit, signed before/after report on `#1430`, tick `- [ ] live proof`, retire handoff, close `#1430` | `lead-only` | ⬜ open | — |

---

## Part 1 — Why

### 1. The ultimate goal

POP Creations staff search two libraries every workday: **PopDAM** (product artwork organized into style groups and files) and **PopSG** (licensor style guides). Today a typed PopDAM meaning search typically waits ~1.1–1.4 seconds (with slow searches reaching 2.4–3.4 seconds) and a typed PopSG guide search reaches ~3.0 seconds at the 95th percentile — and on more than half of broad PopDAM style-group searches, the total file count shown in the top bar silently drops files beyond the first 200 groups. Meanwhile, style-number searches already feel nearly instant (~0.33 seconds typical) and must stay that way.

When this plan is complete, with **zero paid infrastructure upgrades**:

1. **PopDAM meaning searches feel markedly faster** — both typical searches and slow named-character or broad-category searches — by eliminating a duplicate background search on every typed Groups query, skipping hidden Filter Sidebar count work while the sidebar is closed, removing avoidable pre-search waits (idle mode probes, unused role lookups, serial spelling/embed waits), and merging duplicate database scans into one query.
2. **PopDAM Groups file counts are exact across every matching style group** — never silently cut off at 200 groups, never undercounting filtered groups ranked past 200, and never undercounting disjoint multi-variant expansions — while preserving exact group totals (never `N+` lower bounds).
3. **Style-number searches stay nearly instant (and get slightly faster)** — known item numbers and unknown full catalog-format codes still skip spelling, picture vectors, and text-meaning vectors completely.
4. **PopSG style-guide searches drop redundant network waits** — no second serial spelling round-trip, and whole-guide file counts/sizes/paths come back inside the search response (from the same hourly snapshot already used today, with zero added staleness) only after proving the database query beats today's browser batching.
5. **Search accuracy and safety contracts are 100% preserved** — PopDAM stays at 137/137 and PopSG stays at 65/65 guides & 65/65 files on the judged test set (`SEARCH_EVAL_SET_V1`), error-and-Retry behavior never silently degrades to keywords, named-character and licensor scoping stay exact, and authorization stays strictly server-side.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Never trade away search accuracy, exact counts, the style-number fast path, error-and-Retry behavior, or spend money to chase a timing number.

### 2. What this application is

- **PopDAM** (`u2giants/popdam3`, default branch `main`, live at `https://dam.designflow.app`) — internal Digital Asset Manager for licensed consumer-product art.
  - React web UI (`src/`, Vite + Tailwind + Shadcn, deployed via Coolify on host `hetz` from GHCR built by `.github/workflows/publish-frontend.yml`).
  - Supabase Edge Functions (`supabase/functions/`, Deno, deployed on merge to `main` via `.github/workflows/deploy-supabase.yml`). Main search endpoint: `dam-search-ai`.
  - Query text-embedding service (`apps/text-embed/`, FastAPI + PyTorch on CPU, live at `https://text-embed.designflow.app`). Serves both locked query models in one `/embed-text-batch` forward pass: `google/siglip2-base-patch16-naflex` (768-dim picture-space text tower) and `Qwen/Qwen3-Embedding-0.6B@97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3` (1024-dim text-meaning tower).
  - GPU indexing poller (`apps/image-embed-worker/` on Windows host `edge-dev`, scheduled task `PopDAM-ImageEmbedWorker`), Railway cloud worker (`apps/worker/`), Synology NAS bridge agent (`apps/bridge-agent/`), Windows render agent (`apps/windows-agent/`), Electron helper (`apps/popdam-helper/`).
- **PopSG** (same repository and Docker image; hostname `https://sg.designflow.app` selects style-guide mode at runtime) — licensor style-guide library with Guides and Files views.
- **Shared database** — Supabase PostgreSQL project `qsllyeztdwjgirsysgai` (Virginia, Medium compute, shared across PopDAM, PopSG, PopCRM, PopPIM/PLM, DesignFlow, and HTS).
  - Canonical structure repository: **`popcre/shared-db`** (default branch `main`; `u2giants/shared-db` redirects for URLs only and fails `gh search`). Every database function, column, or index change is authored in `popcre/shared-db` under claim-first discipline and reaches production only through its automatic preview-rehearsal → production promotion workflow.
  - `u2giants/popdam3` keeps a read-only vendored snapshot at `shared-db/` (synced to `popcre/shared-db@d384fce` at the time this plan was written). Never edit `shared-db/` directly and never add files under `supabase/migrations/`.
- **Judged Search Test Set** — GitHub Actions workflow `"Search test set"` (`.github/workflows/search-eval.yml`, manual dispatch requiring a `label` input) runs `scripts/search-eval/run.mjs` against production as a signed-in viewer and uploads artifact `search-eval-report` (`report.json`). Current judged version: `set_version = 2026-11-19-1037-artwork` (137 PopDAM cases, 65 PopSG guide cases, 65 PopSG file cases; method in [docs/SEARCH_EVAL.md](../SEARCH_EVAL.md); per-step timing in `scripts/search-eval/step-timing.mjs`).
- **Coordination boundary with open issue `#804`** — [docs/plans/issue-804-database-slowness-closeout.md](issue-804-database-slowness-closeout.md) owns closing out the November whole-database slowness investigation (the four unmeasured background leads, tagging-run measurement, photo-indexing proof, and the final ranked Nov account). Issue `#1430` (this plan) owns the **new** semantic-search speed optimizations and Groups file-count truncation fix discovered and benchmarked on 2026-11-26.

### 3. What triggered this work

On 2026-11-26, Albert asked to review PopDAM semantic search with an independent second opinion (Codex `gpt-6.2-astra` at medium effort), brainstorm ways to make semantic search faster without paid upgrades, measure every candidate strategy at large sample size against live production and read-only Postgres, verify tradeoffs (snapshot refresh cadence and preservation of the near-instant style-number search path), and turn the proven wins into an executable implementation plan.

Two rounds of code-anchored independent review converged on four concrete speedup areas plus an exactness bug fix. Every strategy was measured on **2026-11-26 between 3:50 PM and 4:10 PM EST** in a verified clean database window (1–2 active `supabase_admin` sessions, zero errors across all runs) against the full judged set (`2026-11-19-1037-artwork`):

| Benchmark (2026-11-26, 3:50–4:10 PM EST) | Sample N | Baseline | Measured alternative / finding | Observed impact |
|---|---:|---|---|---|
| PopDAM full eval Pass 1 (first-hit) / Pass 2 (warm) | 137 | `end_to_end` 1,103 / 934 ms p50; 2,440 / 1,760 ms p95 (`cards_ready` 1,254 / 1,053 ms p50; 2,632 / 1,873 ms p95) | Character kind (N=40) worst tail: `end_to_end` 3,138 ms p95 (`cards_ready` 3,390 ms p95), `anchor_rpc` 126 ms p50 / 1,833 ms p95; Product kind (N=20) `spelling` 90.4 ms p50 / 1,500.8 ms p95 (timeout); Code kind (N=19) 327 ms p50 / 462 ms p95 | Baseline to beat; style numbers stay fast |
| Strategy 1: Live paired A/B — duplicate vs single Groups search | 60 paired | Duplicate UI: `cards_ms` 1,347 p50 / 2,936 p95; `settled_ms` 1,363 p50 / 3,025 p95 | Single search: `cards_ms` = `settled_ms` = 1,140 p50 / 2,343 p95 | Saves **207–223 ms p50, 592–682 ms p95** (paired delta p95: 1,441 ms cards / 1,811 ms settled) |
| Direct `/embed-text-batch` solo vs 2 concurrent misses | 30 solo / 60 pair | Solo: 154 ms server / 166 ms wall p50; 173 / 190 ms p95 | Concurrent-2: 222 ms server / 239 ms wall p50 (+44%); 351 / 364 ms p95 (+103%) | Confirms duplicate search doubles embed tail |
| Read-only DB: Exact `total_group_files` inside `search_dam_documents` | 60 | Current 200-ID clamp undercounts **31/60 cases (52%)**; median **4,110** missing files (p95: **37,753**) | Exact `sum(sg.asset_count)` across all matching visible groups | **+4.96 ms p50** (mean −10.9 ms) to fix 52% undercount & remove second search |
| Read-only DB: Group-only `dam_search_named_scope(p_filters, false)` | 51 | `p_need_asset_sets => true`: 30.7 ms p50 / 385.3 ms p95 / 86.6 ms mean (8,108 bufs p50) | `p_need_asset_sets => false`: 19.3 ms p50 / 245.4 ms p95 / 54.0 ms mean (4,694 bufs p50) | Saves **8.2 ms p50 / 342.6 ms p95 / 32.6 ms mean**, −42% buffers |
| Read-only DB: Inline picture anchor inside `search_dam_documents` | 60 (27 named) | Two RPCs: 40,403 bufs p50; live `anchor_rpc` (N=113) 76 / 64 ms p50, 737 / 359 ms p95 (character p95: 1,833 ms) | Single merged query: 30,261 bufs p50 (**−29% buffers**), **0/60 parity diffs**; named subset saves 17.3 ms p50 / 431.0 ms p95 / 100.3 ms mean in SQL alone + eliminates HTTP/PostgREST RTT | Cuts full `anchor_rpc` round-trip & 11,530 buffers/search |
| Read-only DB: Skip closed-sidebar facets (`p_include_facets = false`) | 40 filtered / 29 narrow | Filtered: 466.6 ms p50; Narrow unfiltered: 235.0 ms p50 | Filtered: 287.6 ms p50 (paired save **136.1 ms p50, 378.0 ms mean, 2,430.1 ms p95**, −8,084 bufs); Narrow: 204.6 ms p50 (paired save **35.9 ms p50, 158.1 ms p95**, −993 bufs) | Big win whenever Filter Sidebar is closed (the default) |
| Live pre-search probes (`search-modes` & `user_roles`) | 40 | `action: "search-modes"`: 232.3 ms p50 / 365.6 ms p95; edge `auth`: 90.5 ms p50 / 135–148 ms p95 vs `/auth/v1/user` 27.9 ms p50 / 41.1 ms p95 | Preload mode + defer `user_roles` to admin actions only | Saves **232 ms p50 / 366 ms p95** after 30 s idle + **~62 ms p50 / ~95 ms p95** every search |
| Counterfactual spelling + speculative embed overlap | 113 semantic | Serial `spelling` → `embed` (51–53/137 cases have `spelling > 20 ms`; product p95 hit 1,500 ms timeout) | Overlap after code gates (`product_code` + `catalog_format`) | Saves **43–47 ms mean, 159–163 ms p95** |
| Read-only DB: Multi-variant disjoint-union audit | 4 multi-variant | Edge `max(variant totals)` lower bound | True DB union | Confirmed undercount on 1/4 cases (reported 84 vs true union 86) |
| PopSG full eval live (Guides + Files) | 65 + 65 | Guides `total_to_cards` 845 ms p50 / 2,977 ms p95 (`dup_spelling_call` 196 / 452 ms; `guide_summary_enrich` 148 / 546 ms across p50=2 / p95=10 batches); Files 751 / 2,079 ms | Removing duplicate spelling saves **−297 ms p95** on Files immediately; naive SQL join to `style_guide_file_groups` view took **196 / 1,706 ms (SLOWER!)** | Must remove duplicate spelling AND join indexed snapshot table (not view) with `EXPLAIN` proof |

### 4. Scope — in and out

**In this plan:**
- All 10 steps in Phases 1–5 (PopDAM duplicate search removal & exact Groups file counts, closed-sidebar facet deferral, group-only named-scope optimization, pre-search mode preload & edge concurrency/auth/config/spelling-embed overlap, inline DB picture anchor, exact DB multi-variant union, PopSG single-call spelling, benchmark-gated PopSG inline snapshot summary, and full live proof + closeout on `#1430`).

**NOT in this plan (explicitly out of scope):**
- Issue `#804` closeout deliverables (autovacuum re-measure, four leftover background jobs, whole-DB cost ranking, tagging-run `#680` effect, photo-indexing proof) → owned by [docs/plans/issue-804-database-slowness-closeout.md](issue-804-database-slowness-closeout.md).
- Any paid infrastructure change (Supabase compute/disk upgrade beyond Medium, external vector DB, rented GPU server) → forbidden by owner ruling 2026-11-10.
- Changing embedding models, vector dimensions, or removing either the SigLIP2 picture leg or Qwen3 text-meaning leg → locked (`docs/decisions/2026-10-23-one-embedding-mechanism-siglip2.md`, `#1037`).
- Making `edge-dev` GPU PC a live dependency for typed user queries → forbidden (single point of failure).
- Speculative physical storage restructures (`halfvec(768)` conversion on `dam.search_group_vectors`, splitting `dam.search_text_vectors` into per-type tables, adding partial `dam_search_keys` indexes, changing `OMP_NUM_THREADS` in `apps/text-embed`) — do **not** mix into Phases 1–4. Step 10 runs a clean post-change cold `EXPLAIN (ANALYZE, BUFFERS)` and decides whether a separate follow-up issue is warranted.
- Changing PopSG search relevance ranking or snapshot refresh schedule (hourly at `:07` + post-scan checks) → out of scope; preserve current relevance and snapshot cadence.
- Modifying `public.assets` bloat or unrelated shared-db tables → owned by `popcre/shared-db` weekly bloat safeguards (`shared-db#5886`).

---

## Part 2 — What we already know

### 5. Current state of the code

Baseline verified at `u2giants/popdam3@c077b3e7` (`origin/main`) and vendored `shared-db/` at `popcre/shared-db@d384fce`. No implementation code for `#1430` exists on any branch; nothing is deployed.

**PopDAM frontend & search client (`u2giants/popdam3@c077b3e7`):**
- `src/pages/Index.tsx:48` — Filter Sidebar defaults closed (`filtersOpen = false`).
- `src/pages/Index.tsx:84-99` — `useStyleGroups` / `useAssets` fetch ranked hybrid pages; lines 95–99 compute `searchFacets = searching ? activeListData?.searchFacets : undefined` and enable `useFilterCounts(..., !searching || (activeListData !== undefined && searchFacets === undefined))`. **Trap:** omitting facets from hybrid search without guarding line 98 will immediately trigger `useFilterCounts` (`get_filter_counts`)!
- `src/pages/Index.tsx:177,194,226` — `useStyleGroupAssetCount(filters, visibilityDate, isGroupsMode && hasLibraryFilters)` is enabled whenever `hasActiveFilters(filters)` (`src/types/assets.ts:78-80`) is true — which includes ANY non-empty `filters.search`! Line 226 displays `filteredGroupAssetCount ?? 0` as the Groups header `fileCount`.
- `src/hooks/useStyleGroups.ts:189-214` — `useStyleGroups` calls `fetchHybridSearchPage({ query, documentType: "style_group", limit: effectivePageSize, offset: from, filters: buildDamSearchFilters(filters) })` directly (bypassing `searchIdCache`), then hydrates rows from `style_groups`.
- `src/hooks/useStyleGroups.ts:345-380` — `useStyleGroupAssetCount` runs concurrently with `useStyleGroups` and calls `resolveStyleGroupSearch(filters.search)` → `src/lib/full-text-search.ts:112-155` → `fetchHybridSearchIds(term, "style_group", 500)` (`src/lib/dam-search.ts:147-154`, passing **NO sidebar filters**!). Because `dam-search-ai/index.ts:591` clamps `limit` to `200`, this second full hybrid search silently returns at most 200 unfiltered IDs, and `useStyleGroupAssetCount` then filters those ≤200 IDs and sums whole-group `style_groups.asset_count`.
- `src/hooks/useAssets.ts:340-366` — Files mode hybrid search calls `fetchHybridSearchPage({ query, documentType: "asset", limit, offset, filters })` and always requests facets.
- `src/test/library-mode-queries.test.tsx:20` — mocks `useStyleGroupAssetCount: () => ({ data: 0 })`, which hid the duplicate hybrid search from all existing UI tests.
- `src/lib/dam-search.ts:74-108` — `getSearchMode()` caches `action: "search-modes"` with `SEARCH_MODE_TTL_MS = 30_000` and is only called lazily after the user types and submits a search. Rejected cold promises remain cached until `searchModeExpiresAt` unless invalidated.

**PopDAM & PopSG Edge Function (`supabase/functions/dam-search-ai/index.ts` and `_shared/`):**
- `supabase/functions/dam-search-ai/index.ts:272-292,486` — `authenticateCaller` runs on every POST and always queries `serviceClient().from("user_roles").select("role").eq("user_id", result.userId)` (line 290) even though `auth.admin` is only checked in `embedding-status` (line 564) and `reset-embedding-errors` (line 572).
- `supabase/functions/dam-search-ai/index.ts:256-269` — `spellingLookup.countDocs(word, signal)` queries `dam_search_keys` (`count: "estimated"`) with no cache; common catalog words outside `SEARCH_SPELLING_NAMES` hit Postgres up to 4 times per search.
- `supabase/functions/dam-search-ai/index.ts:505-547` — `action === "popsg-query-embedding"` calls `getPopSGQueryEmbedding` (`_shared/popsg-query-embedding.ts:12-25`), which runs `checkSpelling(query)` and `embed(query)` in parallel, then discards `checked.corrected` instead of returning it to PopSG.
- `supabase/functions/dam-search-ai/index.ts:591` — clamps `limit` to `Math.min(200, ...)`.
- `supabase/functions/dam-search-ai/index.ts:605-670` — runs `product_code` → `catalog_format` → `spelling` (with `text_leg_config` started at line 631) → then `prepare` (`embed`, separate `floor_config` read at line 666, `licensors`, `loadNamedScope` at line 668) serially.
- `supabase/functions/dam-search-ai/index.ts:731-810` — for each variant in `queryVariants`, runs `anchor_rpc` (`dam_search_semantic_anchor` / `_scoped` / `_named`, lines 748–771) sequentially **before** `search_dam_documents` (lines 774–801).
- `supabase/functions/_shared/query-embed-batch.ts:88-162` — LRU cache (`MAX_CACHE_ENTRIES = 256`) caches finished vectors only; has no in-flight promise coalescing for simultaneous cold misses on the same isolate.
- `supabase/functions/_shared/dam-search-merge.ts:39-77` — merges multi-variant pages in memory and returns `total_count = Math.max(totalCount, results.length)` (a lower bound on disjoint unions).

**PopSG frontend (`src/pages/popsg/`):**
- `src/pages/popsg/PopSGLibraryPage.tsx:154-169` — runs `expandFallbackTerms(filters.nameSearch)` (`src/lib/dam-search.ts:192-226`, which calls RPC `expand_dam_search_queries` and then serially calls `dam-search-ai` `action: "spelling"`) in parallel with `fetchPopSGQueryEmbedding(filters.nameSearch.trim())` (which ALREADY called `checkSpelling`!).
- `src/pages/popsg/PopSGLibraryPage.tsx:207-238` and `src/pages/popsg/popsgSearchV2.ts:147-165,339-368` — after `search_style_guide_library_v2` returns a page of guides, the browser chunks guide identities in groups of 20 (`POPSG_SUMMARY_IDENTITIES_PER_QUERY = 20`) and sends parallel PostgREST queries to `style_guide_file_groups` (`count: "exact"`) to sum whole-guide `file_count`, `total_size_bytes`, and collect distinct `member_directory_paths`.

**Shared database (`popcre/shared-db@d384fce`, vendored read-only in `shared-db/`):**
- `search_dam_documents`: `shared-db/supabase/migrations/20261225090101_dam_style_group_keyword_index_filters.sql:22-742`.
  - Line 64 calls 1-arg `public.dam_search_named_scope(p_filters)` which defaults `p_need_asset_sets => true` (`20261225010417:109-125`, `20261225120101:9-102`), materializing unused `character_assets` and `property_assets` even on `style_group`-only searches.
  - Always runs `visible_assets` + `matched_assets` + 5 facet aggregations on filtered and narrow searches (no `p_include_facets` toggle yet).
  - Returns no `total_group_files` column.
- Semantic anchors: `20261201100000_sandbox_catchup_dam_hts_archive_public.sql:2991-3088` (`dam_search_semantic_anchor`, `_scoped`) and `20261225010417_dam_named_anchor_group_scope_only.sql:127-203` (`dam_search_semantic_anchor_named`).
- `search_style_guide_library_v2`: `20261201100000_sandbox_catchup_dam_hts_archive_public.sql:9364+` (already supports `p_include_facets boolean default true`, passed as `false` by `popsgSearchV2.ts:219`).
- `public.style_guide_file_groups`: live Postgres **view** over `public.style_guide_file_groups_snapshot` with a per-row access gate. Refreshed **hourly at `:07`** by `pg_cron` job 9 (`refresh-style-guide-matviews`) and post-scan checks every 15 minutes (`pg_cron` job 12 `refresh-style-guide-library-default-snapshot`).

### 6. Key findings and root causes

1. **Duplicate Groups search + 200-group truncation bug:** Every typed search in PopDAM Groups mode fires two concurrent full hybrid searches (`useStyleGroups` with filters, and `useStyleGroupAssetCount` via `resolveStyleGroupSearch` requesting 500 unfiltered IDs that `dam-search-ai:591` silently clamps to 200). On cold misses both hit single-threaded `apps/text-embed` concurrently, increasing embed p95 by **+103%** (190 → 364 ms), and the second search undercounts total files on **52% of broad/filtered searches** (median 4,110 missing files; p95 37,753 missing files; filtered groups ranked >200 drop to 0). Computing exact `total_group_files` inside `search_dam_documents` adds only **+4.96 ms p50** and eliminates the duplicate search completely.
2. **Double vector scan & wasted named-scope asset sets:** Calling `anchor_rpc` before `search_dam_documents` scans `dam.search_group_vectors` (91 MB heap, ~2.6× bloated relative to ~35 MB raw for 11,504 rows) twice, runs `require_dam_access()` twice, and runs `dam_search_named_scope()` twice — and inside `search_dam_documents:64`, the 1-arg call defaults `p_need_asset_sets => true`, building unused asset sets on style-group-only searches (+342.6 ms p95 waste on named queries). Folding the anchor into `search_dam_documents` cuts **29% of buffer reads** (−11,530 buffers p50) and eliminates the HTTP/PostgREST round-trip plus up to 1.83 s cold `anchor_rpc` tail.
3. **Closed-sidebar facet tax:** `Index.tsx:48` opens with `filtersOpen = false`, yet `search_dam_documents` computes `visible_assets` + `matched_assets` + 5 facet aggregations on every filtered or narrow search. Skipping them when the sidebar is closed saves **136 ms p50 / 2,430 ms p95** on filtered searches and **36 ms p50 / 158 ms p95** on narrow unfiltered searches.
4. **Preventable pre-search & edge serial waits:** `search-modes` blocks for **232 ms p50 / 366 ms p95** every 30 s idle; `authenticateCaller` pays **~62 ms p50 / ~95 ms p95** HTTP/PostgREST RTT for an unused `user_roles` check (SQL itself is 0.04 ms); `text_leg_config` and `floor_config` make two uncached `admin_config` reads; `spelling` runs serially before `embed` and hits `dam_search_keys` repeatedly for ordinary catalog words (product-kind p95 hit the 1.5 s spelling timeout).
5. **Multi-variant exactness defect:** `dam-search-merge.ts` returns `max(variant totals, page rows)`, which undercounts disjoint unions (verified live: 84 reported vs 86 actual on 1 of 4 multi-variant product expansions).
6. **PopSG redundant spelling & view-join trap:** PopSG runs `checkSpelling` twice per typed search (once in `popsg-query-embedding` where `corrected` is discarded, then again serially in `expandFallbackTerms`). For guide summaries, joining returned guides to the `public.style_guide_file_groups` **view** via `jsonb_to_recordset` took **196 ms p50 / 1,706 ms p95** — *slower* than the browser's parallel chunked queries (148 ms p50 / 546 ms p95) because the view applies per-row access checks and prevented indexed lookup. Reading the underlying indexed `public.style_guide_file_groups_snapshot` table directly inside already-authorized `search_style_guide_library_v2` avoids view overhead and adds zero staleness relative to today.
7. **Warm SQL CTE profile surprise (`EXPLAIN (ANALYZE, BUFFERS)`, N=30):** On warm cache, `queries` (`expand_dam_search_queries`) is the single slowest CTE in `search_dam_documents` at **77.0 ms p50 / 228.2 ms p95 / 103.0 ms mean** — ahead of `semantic_exact` (35.8 ms p50, 11,507 bufs), `substring_matches` (29.3 ms p50 / 114 ms p95), `text_candidates` (14.9 ms p50), `product_types` (8.7 ms p50 / 71.4 ms p95), `word_form_keys` (8.5 ms p50), and `justified_visible` (0.0 ms p50 / 2.6 ms p95). That confirms we must NOT blindly rewrite vector storage before landing Phases 1–4 and re-profiling.

### 7. Approaches considered and REJECTED, and why

Do **not** resurrect any of these during implementation:

1. **Skipping global picture retrieval when `>= 10` keyword/text hits qualify.** *Rejected (Codex debate Round 1 → 2):* `search_dam_documents` blends `0.15 * semantic_rank` into `rank` for keyword/text hits too; skipping global picture retrieval changes ranking order, `min_rank` filtering, and membership/totals.
2. **Computing the inline picture anchor *after* the global `LIMIT 2000` vector cutoff.** *Rejected:* when a search is scoped to a licensor, character, or property whose best matching picture falls outside the global top 2,000, computing the anchor after `LIMIT 2000` drops the scoped anchor and shifts the floor. The scoped anchor MUST be computed over the full scoped candidate set *before* any global `LIMIT 2000` truncation (falling back to global max only when the scoped set is empty).
3. **Running `loadNamedScope` before `checkSpelling`.** *Rejected:* `loadNamedScope` depends on `knownFullNames` and `spelling.corrected`; running it before spelling with a cold or uncorrected query can miss a misspelled character name and broaden a named-character search in violation of owner ruling D1.
4. **Seeding ordinary catalog words into `SEARCH_SPELLING_NAMES`.** *Rejected:* `SEARCH_SPELLING_NAMES` drives `knownFullNames`, alias lookup, and PopSG name expansion. Polluting it with product/catalog words breaks PopSG `name` vs `narrowed_name` logic and named-scope matching. Cache `countDocs` in its own bounded, short-TTL, successful-only map instead.
5. **Removing `copy.deepcopy(_prefix_cache)` in `apps/text-embed/main.py:130`.** *Rejected:* lines 131–138 call `cache.batch_repeat_interleave(batch)` and pass `past_key_values=cache` with `use_cache=True`, both of which mutate the KV-cache object in place. Removing the copy corrupts the shared startup `_prefix_cache` on the second request.
6. **Naive SQL `LEFT JOIN public.style_guide_file_groups` view inside `search_style_guide_library_v2`.** *Rejected (measured 2026-11-26, N=65):* ran **196 ms p50 / 1,706 ms p95** — worse than the browser's parallel chunked fetch (**148 ms p50 / 546 ms p95**). Step 9 must query the underlying indexed `public.style_guide_file_groups_snapshot` table directly and prove via `EXPLAIN (ANALYZE, BUFFERS)` that it beats browser enrichment before touching `PopSGLibraryPage.tsx`.
7. **Replacing `justified_visible` scan with `has_default_visible_member` alone as a standalone phase.** *Rejected as standalone:* measured **0.0 ms p50 / 2.4 ms p95** warm savings (`db5`, N=60). Only worth considering as a tiny cleanup inside Step 6 if freshness guarantees on `has_default_visible_member` are verified 100% identical to `assets` visibility; never risk stale visibility for 2 ms.
8. **Blindly converting `dam.search_group_vectors` to `halfvec(768)`, splitting `dam.search_text_vectors`, adding partial `dam_search_keys` indexes, or tuning `OMP_NUM_THREADS` before Phases 1–4.** *Rejected for this plan:* higher migration/parity risk for unproven net win while higher-ROI zero-risk wins sit unshipped and `expand_dam_search_queries` (77 ms p50) dominates warm SQL. Re-evaluate only after Step 10's post-change cold `EXPLAIN`.
9. **Paid compute/disk upgrades, external vector DB, rented GPU server, or routing live user queries to `edge-dev`.** *Rejected:* violates locked owner rulings (2026-11-10 free-fixes-only, `docs/decisions/2026-10-23-one-embedding-mechanism-siglip2.md`, no hard SPOF on `edge-dev`).

### 8. Design decisions

**Locked — do NOT relitigate:**
- **Zero paid upgrades** (owner ruling 2026-11-10): Supabase stays on Medium; no external vector DB or paid GPU host.
- **Exact totals only, never lower bounds or `N+`** (owner ruling 2026-10-29, `#5053`, pinned by `src/test/dam-search-exact-counts.test.tsx`). Applies to both `total_count` and `total_group_files`.
- **Whole-group file-count semantics in Groups mode** (locked 2026-11-26): `total_group_files` in PopDAM Groups mode sums `style_groups.asset_count` across **every** matching visible style group (matching today's intended `useStyleGroupAssetCount` semantics, just without the 200-ID clamp bug) — independent of page `limit`/`offset`.
- **Error + Retry on embedding/search failure (D4)** (locked, `#1037`): never silently drop to keyword search when embedding, anchor, or text-meaning fails; never drop a failing variant in a multi-variant query.
- **Style-number fast path (D5 & owner reversal 2026-11-11)** (`docs/decisions/2026-11-11-complete-catalog-code-not-in-catalog-matches-by-words.md`, `#1061`): known item numbers/prefixes and unknown complete catalog-format codes skip spelling, vector settings, and vector embedding completely. Speculative embedding MUST NEVER start before `isProductCodeSearch` and `hasCatalogCodeFormat` both resolve `false`.
- **Locked embedding models & schema boundary** (`docs/decisions/2026-10-23-one-embedding-mechanism-siglip2.md`, `docs/decisions/2026-10-25-dam-schema-reached-through-public-wrappers.md`, `#1037`): SigLIP2 768 + Qwen3-Embedding-0.6B (`97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`) 1024; `dam.*` accessed only via `public` `SECURITY DEFINER` wrappers; all DDL exclusively in `popcre/shared-db` via automatic preview → production promotion.
- **Named-character / licensor / property scoping (D1, `#892`, `#1037`)**: named character restricts all legs; named licensor/property restricts picture-only leg and scopes the picture anchor.
- **PopSG access isolation** (`dam-search-ai/index.ts:506`): PopSG endpoints (`popsg-query-embedding`, `spelling`, `search_style_guide_library_v2`) must work for PopSG-only users who do NOT hold DAM access.
- **Reviews are advisory only & AI owns merges** (owner rulings 2026-10-29, 2026-10-30, 2026-09-28): never wait on review approval or ask Albert to approve/merge technical PRs.

**Open — implementer judgment with criteria:**
- **Step 1/2 `total_group_files` transport shape:** May be returned either as a column on `search_dam_documents` rows (like `total_count`) or inside the `facets` JSONB object — **criterion:** prefer a top-level `total_group_files bigint` return column (matching `total_count`) OR an always-present top-level JSON field in `dam-search-ai` so it remains populated even when `p_include_facets = false`! Keep `search_dam_documents` backward-compatible for any older caller during deploy overlap.
- **Step 4 `countDocs` cache TTL & size:** Choose a bounded LRU (e.g., 512–1,024 entries, 5–10 min TTL) that caches **only** successful counts and never caches errors/timeouts — **criterion:** bounded memory per isolate, fresh enough that newly ingested words become recognized within minutes.
- **Step 7 DB multi-variant signature:** Either add an optional `p_query_variants jsonb default null` parameter to `search_dam_documents` or introduce a dedicated `public.search_dam_documents_multi(...)` wrapper reusing the shared SQL core — **criterion:** whichever keeps `search_dam_documents` cleaner, strictly enforces `require_dam_access()` once, preserves single-variant fast path with zero regression, and passes `popcre/shared-db` contract tests cleanly.
- **Step 9 PopSG snapshot index:** If `public.style_guide_file_groups_snapshot` lacks a composite btree index on `(root_label, licensor_name, property_folder, style_guide_folder, style_guide_name)` (or `NULLS NOT DISTINCT` / expression index matching the 5-tuple lookup), add that index in the same `popcre/shared-db` migration and prove via `EXPLAIN (ANALYZE, BUFFERS)` that the in-RPC enrichment beats browser batching (148 ms p50 / 546 ms p95) on the 65-guide test set. If even with the index it does not beat browser batching, stop and document the measurement on `#1430` rather than shipping a regression.

---

## Part 3 — How to build it

### 9. Executable steps

> **Multi-phase execution rule:** This plan has 5 phases with explicit context cut points. At every cut point, run the `fresh-session` check and **re-read all downstream phases before starting the next phase** to catch drift against what just landed. Never add any hold, wait, retry delay, or timeout longer than 30 minutes.

---

#### Phase 1 — PopDAM Duplicate Search Removal, Exact Groups File Totals & Closed-Sidebar Facets

##### Step 1 — Shared-DB migration: exact `total_group_files`, `p_include_facets`, and group-only named scope
- **Who:** `lead-only` — shared-database structural migration (`popcre/shared-db`) affecting live search RPC contract and access enforcement.
- **Dependencies:** None (start here). Read `shared-db-change` skill and claim scope in `popcre/shared-db` before editing.
- **What to change (in `popcre/shared-db`):**
  1. Create a new timestamped migration updating `public.search_dam_documents` (current definition: `shared-db/supabase/migrations/20261225090101_dam_style_group_keyword_index_filters.sql:22-742`):
     - Add backward-compatible trailing parameter `p_include_facets boolean default true` so existing deployed callers continue working during rollout.
     - Add `total_group_files bigint` to the return shape (or populate a dedicated always-present summary field; see §8 open criterion — it MUST be returned even when `p_include_facets = false`). When `style_group` is in `p_document_types`, compute `coalesce(sum(sg.asset_count), 0)` across **every** matching visible `style_group` in the full authorized result set (joining `public.style_groups sg ON sg.id = r.style_group_id`), independent of `p_limit`/`p_offset`, matching the exact visibility and filter rules already applied to `r`. For `asset`-only searches, return `null` (or `0` clearly documented as N/A for asset-only mode).
     - Fix line 64 of `search_dam_documents`: pass `p_need_asset_sets => ('asset' = ANY(v_doc_types))` (or `v_need_assets`) to `public.dam_search_named_scope(p_filters, v_need_assets)` instead of the 1-arg call that defaults to `true`.
     - When `p_include_facets = false`, bypass `visible_assets`, `matched_assets`, and the 5 facet aggregations completely (returning `'{}'::jsonb` for facets while keeping exact `total_count`, `total_group_files`, `has_more`, `word_form_overflow`, and `page_documents` 100% identical to `p_include_facets = true`).
  2. Add/update SQL contract tests in `popcre/shared-db/supabase/tests/` proving:
     - `p_include_facets = false` returns identical ordered `entity_id`s, `rank`s, `total_count`, `total_group_files`, and `has_more` as `p_include_facets = true` on both unfiltered and filtered searches.
     - `total_group_files` equals the exact sum of `style_groups.asset_count` across >200 matching visible groups and across filtered groups ranked beyond position 200.
     - Style-group-only named searches pass `p_need_asset_sets = false` and produce identical results to `true`.
     - Unauthorized callers are still rejected by `require_dam_access()`.
  3. Open PR in `popcre/shared-db`, let preview rehearsal + contract tests pass, merge it, wait for automatic production promotion to complete (bounded wait, never >30 min), and verify the migration version appears in the production ledger before starting Step 2.
- **How it should behave when done:** A single `search_dam_documents` call returns exact `total_count` AND exact `total_group_files` across all matching groups, skips facet work when `p_include_facets = false`, and avoids materializing unused named-scope asset sets on group-only calls.
- **Verification gate — you'll know it worked when:** The `popcre/shared-db` migration is merged and confirmed in production's migration ledger, all shared-db SQL contract tests pass, and a read-only `EXPLAIN (ANALYZE, BUFFERS)` probe confirms `p_include_facets = false` skips `visible_assets`/`matched_assets` and `total_group_files` matches exact `sum(style_groups.asset_count)` across >200 groups.

##### Step 2 — Wire PopDAM edge function and React UI to consume `total_group_files`, stop duplicate Groups search, and defer closed-sidebar facets
- **Who:** `lead-only` — reshapes live search response contract, React Query hook orchestration, and error/access-denial states across `dam-search-ai`, `useStyleGroups`, `useAssets`, and `Index.tsx`.
- **Dependencies:** Step 1 live in production (and `shared-db` mirror synced if needed; never edit `shared-db/` by hand).
- **What to change (in `u2giants/popdam3`):**
  1. `supabase/functions/dam-search-ai/index.ts:581-850`:
     - Parse optional boolean `body.include_facets` (default `true` when omitted or non-boolean for backward compatibility; strictly coerce only explicit `false` to `false`).
     - Forward `p_include_facets: includeFacets` to `search_dam_documents` (line 775).
     - Extract `total_group_files` from the RPC rows (alongside `total_count` at lines 831–837), preserve it through `supabase/functions/_shared/dam-search-merge.ts` (`SearchPage.total_group_files?: number | null`), and return `total_group_files` + `facets_included: includeFacets` in the JSON response (lines 841–849).
  2. `src/lib/dam-search.ts:23-37,110-145`:
     - Extend `DamSearchRequest` with `includeFacets?: boolean` and `DamSearchPage` with `totalGroupFiles: number | null` and `facetsIncluded: boolean`.
     - Pass `include_facets: includeFacets` in `invokeSearch` (line 118) when provided, and read `total_group_files` and `facets_included` (defaulting `facetsIncluded` to `includeFacets !== false` if absent during deploy overlap) in `fetchHybridSearchPage`.
  3. `src/hooks/useStyleGroups.ts:171-214,345-380` and `src/hooks/useAssets.ts:322-366`:
     - Accept `includeFacets = true` parameter in `useStyleGroups` and `useAssets` and include it cleanly in `queryKey` (or keep facet fetching cleanly keyed so opening the sidebar triggers a facet-inclusive refetch without wiping displayed cards — use `placeholderData: keepPreviousData` or separate facet state so the grid does not flash blank when the user clicks "Filters"!).
     - In `useStyleGroups` hybrid branch (lines 190–214), pass `includeFacets` to `fetchHybridSearchPage` and return `totalGroupFiles: ranked.totalGroupFiles`, `searchFacets: ranked.facetsIncluded ? parseDamSearchFacets(ranked.facets) : undefined`, and `facetsIncluded: ranked.facetsIncluded`.
     - In `useAssets` hybrid branch (lines 342–366), pass `includeFacets` and return `searchFacets: ranked.facetsIncluded ? parseDamSearchFacets(ranked.facets) : undefined` and `facetsIncluded: ranked.facetsIncluded`.
  4. `src/pages/Index.tsx:82-104,177,192-227`:
     - Pass `filtersOpen` as `includeFacets` to `useStyleGroups` and `useAssets`.
     - **Critical guard at line 95–103:** Track `const facetsOmitted = searching && activeListData?.facetsIncluded === false;`. Enable `useFilterCounts` ONLY when `filtersOpen && (!searching || (activeListData !== undefined && searchFacets === undefined && !facetsOmitted))`. Never fire `get_filter_counts` when the Filter Sidebar is closed or when hybrid search deliberately omitted facets! When the user opens the sidebar (`filtersOpen` flips `false → true`), the active hybrid query refetches with `includeFacets: true` while keeping previous cards visible and displays loading/updated facet counts without flashing stale pre-search counts.
     - **Critical guard at lines 177, 194, 226:** Enable `useStyleGroupAssetCount` ONLY when `isGroupsMode && hasLibraryFilters && (!searching || (sgData !== undefined && sgData.totalGroupFiles === undefined))`. This completely eliminates the second hybrid search in Groups mode while preserving `useStyleGroupAssetCount` for non-search filtered browsing (e.g. licensor filter with empty search box) and for keyword search mode!
     - On line 226, set `fileCount` in Groups mode to `hasLibraryFilters ? (sgData?.totalGroupFiles ?? filteredGroupAssetCount ?? 0) : (totalAssets ?? 0)`.
     - On line 194, ensure `countsUnavailable` reflects `activeQueryError` when searching in hybrid mode and `groupCountError || groupAssetCountError` when using separate count hooks.
- **How it should behave when done:** Typing a query in PopDAM Groups mode with the Filter Sidebar closed sends **exactly one** `dam-search-ai` search request (`include_facets: false`), displays cards and the exact total file count across all matching groups immediately, fires zero `useStyleGroupAssetCount` and zero `get_filter_counts` requests, and smoothly fetches current facets if the user clicks "Filters".
- **Verification gate — you'll know it worked when:** `npm run typecheck && npm run lint && npm test` passes locally, and a live or mocked network trace of typing a query in PopDAM Groups mode shows exactly 1 `dam-search-ai` call (`include_facets: false`), 0 calls to `resolveStyleGroupSearch` / `get_filter_counts`, and clicking "Filters" triggers 1 `include_facets: true` search that populates `FilterSidebar` without blanking the grid.

##### Step 3 — Mechanical UI and hook tests for Phase 1
- **Who:** `helper-ok` — mechanical test additions with exact target files, test cases, and pass commands; no architectural decisions.
- **Stop-and-ask trigger:** Stop and ask the lead immediately if any existing test in `src/test/library-mode-queries.test.tsx`, `src/test/style-group-search.test.ts`, or `supabase/functions/dam-search-ai/index.test.ts` fails due to a mismatch in the Step 2 contract, or if mocking `useStyleGroupAssetCount` behaves differently than specified.
- **Dependencies:** Step 2 complete.
- **What to change (in `u2giants/popdam3`):**
  1. `src/test/library-mode-queries.test.tsx`:
     - Add a dedicated test (without mocking away `useStyleGroupAssetCount` — or in a sibling test file `src/test/library-groups-single-search.test.tsx` that imports the real `useStyleGroupAssetCount`!) proving:
       - Typing a search in Groups mode with sidebar closed sends **exactly 1** `fetchHybridSearchPage` call with `includeFacets: false`, **0** calls to `resolveStyleGroupSearch` / `fetchHybridSearchIds`, and **0** calls to `get_filter_counts`.
       - The header displays the exact `totalGroupFiles` returned by `fetchHybridSearchPage` even when `totalCount > 200` (e.g. 512 groups, 14,320 files) and even when filtered groups would rank past 200.
       - Clicking "Filters" while a search is active triggers `fetchHybridSearchPage` with `includeFacets: true`, populates `FilterSidebar` facets, does NOT fire `get_filter_counts`, and does NOT show stale pre-search facets while loading.
       - Switching to keyword mode (`mode.value = "keyword"`) still executes `useStyleGroupAssetCount` and `get_filter_counts` cleanly.
       - Non-search filtered browsing (`search === ""`, licensor selected) still executes `useStyleGroupAssetCount`.
  2. `supabase/functions/dam-search-ai/index.test.ts`:
     - Add tests verifying `include_facets: false` forwards `p_include_facets: false` and returns `facets_included: false` + `total_group_files`; omitting `include_facets` or passing a non-boolean (`"false"`, `0`, `null`) defaults safely to `p_include_facets: true`.
- **How it should behave when done:** The mock blind spot at `src/test/library-mode-queries.test.tsx:20` can never silently regress the duplicate search again.
- **Verification gate — you'll know it worked when:** `npx vitest run src/test/library-mode-queries.test.tsx src/test/library-groups-single-search.test.tsx supabase/functions/dam-search-ai/index.test.ts` passes with 0 failures and `npm test` is green.

---

> **Context cut point 1 (after Phase 1 merges and deploys):** Pair with `fresh-session` if context is heavy. Update this plan's STATUS table with Phase 1 commit SHAs / CI runs, then re-read Phase 2 before starting Step 4.

---

#### Phase 2 — Pre-Search Waits, Edge Concurrency & Speculative Embed Overlap (No DB DDL)

##### Step 4 — Search-mode preload, deferred `user_roles`, combined `admin_config`, `countDocs` cache, in-flight embed coalescing & speculative embed overlap
- **Who:** `lead-only` — touches authentication/authorization, fail-closed vs fail-open config parsing, concurrency coalescing, and speculative error handling on the critical search path.
- **Dependencies:** Phase 1 deployed (independent of DB DDL).
- **What to change (in `u2giants/popdam3`):**
  1. **Browser `search-modes` preload (`src/lib/dam-search.ts:74-108` & `src/pages/Index.tsx`):**
     - Add `preloadSearchMode(): void` (calling `getSearchMode().catch(() => {})` on library mount after user session is ready and on search input focus) so the first search after load or after 30 s idle does not pay the 232 ms p50 / 366 ms p95 `search-modes` round-trip sequentially.
     - Fix rejected-promise caching in `getSearchMode()`: if the probe rejects (transient error OR access denial 401/403), clear `searchModePromise = null` and `searchModeExpiresAt = 0` in the rejection path so clicking **Retry** always probes again instead of replaying a cached rejection!
     - Preserve `searchAccessStatus(error)` fail-loud behavior (never substitute `lastKnownGoodMode` on 401/403) and preserve `SEARCH_MODE_TTL_MS` (30–60 s max so admin mode switches still take effect promptly).
  2. **Defer `user_roles` to admin actions only (`supabase/functions/dam-search-ai/index.ts:272-292,563-579`):**
     - Split `authenticateCaller` so it verifies the user session via `authenticateUser(...)` and builds the caller-scoped `auth.client` **without** querying `user_roles`.
     - Provide a lazy helper `auth.isAdmin(): Promise<boolean>` that runs the `user_roles` query only when called by `action === "embedding-status"` (line 564) or `action === "reset-embedding-errors"` (line 572).
     - Keep `serviceRole` fast path returning `isAdmin: async () => true`.
     - **Never** weaken RLS or `require_dam_access()` — all search actions still execute with the caller-scoped `auth.client`.
  3. **Combine `admin_config` reads (`supabase/functions/dam-search-ai/index.ts:631-637,651-652,664-667,682-687`):**
     - Fetch `SEARCH_TEXT_LEG_MODE_KEY`, `SEARCH_TEXT_EMBEDDING_MODEL_KEY`, `SEARCH_TEXT_MIN_SCORE_KEY`, `SEARCH_TEXT_SCORE_MARGIN_KEY`, and `SEARCH_MIN_SEMANTIC_SCORE_KEY` in **one** `.in("key", [...])` query (only when `!codeSearch`), preserving the exact fail-closed behavior for `textLegSettings` (DB read error → 503 `Search unavailable`) while keeping `SEARCH_MIN_SEMANTIC_SCORE_KEY` optional (missing or unparseable floor value → `null`, never 503).
  4. **Bounded, successful-only `countDocs` cache (`supabase/functions/dam-search-ai/index.ts:256-269`):**
     - Add a separate per-isolate LRU cache (`MAX = 512`, TTL = 5 minutes) keyed by normalized lowercase word for `spellingLookup.countDocs`.
     - Cache **only** successful numeric results; never cache errors, aborts, or timeouts.
     - **Do NOT** add catalog words to `SEARCH_SPELLING_NAMES` or `knownFullNames` (§7 #4).
  5. **In-flight promise coalescing in `supabase/functions/_shared/query-embed-batch.ts:88-162`:**
     - Add an `inFlight` map keyed by the exact normalized request signature (method + sorted unique miss texts) so two simultaneous cold misses on the same isolate share **one** HTTP call to `/embed-text-batch` instead of queuing two serialized CPU forward passes (+103% p95).
     - **Cancellation isolation:** the shared transport call MUST NOT bind to the first caller's request `AbortSignal`; instead each caller awaits the shared promise (racing its own signal if needed) and removes the `inFlight` entry in `.finally()`. Never cache failed outcomes.
  6. **Overlap `checkSpelling` with speculative single-batch embedding (`supabase/functions/dam-search-ai/index.ts:605-705`):**
     - Keep `product_code` (line 605) and `catalog_format` (line 613) running FIRST, completely unchanged. If `codeSearch` is true, skip spelling, config, and embedding immediately — **style-number fast path untouched!**
     - When `!codeSearch`:
       - Compute the initial pre-spelling semantic variant texts: `const initialExpanded = expandProductQueries(query); const initialSemanticTexts = [...new Set(initialExpanded.filter(v => v.semantic).map(v => v.query))];`.
       - Start `combinedConfig`, `checkSpelling(query, spellingLookup)`, `licensorNames()`, AND — once `combinedConfig` resolves (or in parallel with spelling if config is awaited quickly, OR start a single `/embed-text-batch` call for `initialSemanticTexts` immediately because `/embed-text-batch` already returns BOTH SigLIP2 and Qwen3 vectors in one response!) — run `spelling` and `embed(initialSemanticTexts)` **concurrently**!
       - **Important detail:** Inspect `queryEmbedder.embedAllWithText(initialSemanticTexts)` vs `embedAll`: when `textLeg.on` is true (normal production state), `/embed-text-batch` returns both picture + text vectors in one pass. If `textLeg.on` is false, `embedAll` still uses `/embed-text-batch` (ignoring `textVectors`). Verify `combinedConfig` vs speculative embed so that:
         - If `!spelling.meaningful`: ignore/swallow any rejection from the speculative embed promise (attach `.catch(() => null)` so there are no unhandled rejections!) and skip pictures cleanly (`usePictures = false`).
         - If `spelling.meaningful` and `spelling.corrected` introduces additional semantic texts not in `initialSemanticTexts`: call `queryEmbedder` for the missing corrected texts only (the already-cached `initialSemanticTexts` hit the LRU cache at 0 ms!).
         - Keep `loadNamedScope([query, spelling.corrected], requestSignal)` running **after** `checkSpelling` resolves (§7 #3).
         - Preserve D4 fail-loud: if `usePictures` is true and any required picture or text-meaning vector is missing or model-mismatched, return `503 Search unavailable`.
- **How it should behave when done:** Idle searches no longer stall on `search-modes`; every search drops the ~62 ms p50 / ~95 ms p95 unused `user_roles` RTT; spelling and embedding run in parallel after code gates (~160 ms p95 saved); concurrent cold misses coalesce cleanly; and style-number searches remain untouched on the fast path.
- **Verification gate — you'll know it worked when:** `npm run typecheck && npm run lint && npm test` passes, `Server-Timing` on a live/staging search shows `auth` dropping from ~90 ms to ~28–35 ms p50 and `spelling` overlapping `embed` (with `product_code` still completing before either starts), and a live viewer hitting `embedding-status` still gets HTTP `403`.

##### Step 5 — Mechanical unit tests for Phase 2
- **Who:** `helper-ok` — mechanical unit test additions with explicit assertions and test files.
- **Stop-and-ask trigger:** Stop and ask the lead if any mock in `dam-search-ai/index.test.ts` fails because of the new `admin_config` query shape or lazy `isAdmin()` helper, or if `Server-Timing` assertions conflict with existing tests.
- **Dependencies:** Step 4 complete.
- **What to change (in `u2giants/popdam3`):**
  1. `src/test/dam-search.test.ts`:
     - Test `preloadSearchMode()` warms the cache so the subsequent `getSearchMode()` makes 0 extra invokes.
     - Test a cold failure in `getSearchMode()` evicts the rejected promise so the next call (Retry) invokes `search-modes` again.
     - Test a 401/403 access denial on `search-modes` throws and does NOT fall back to `lastKnownGoodMode`.
  2. `supabase/functions/_shared/query-embed-batch.test.ts`:
     - Test two concurrent cold misses for the same texts invoke `transport.embedBatch` exactly **once** and both resolve with identical vectors.
     - Test a failed batch is NOT cached and a subsequent call retries `transport.embedBatch`.
     - Test cancelling caller A does not fail caller B awaiting the coalesced embed.
  3. `supabase/functions/dam-search-ai/index.test.ts`:
     - Test `action: "search"` and `action: "search-modes"` make **0** queries to `user_roles`.
     - Test `action: "embedding-status"` and `action: "reset-embedding-errors"` STILL query `user_roles` and return `403` for a non-admin viewer and `200` for an admin.
     - Test combined `admin_config` read: DB error → `503` (fail closed); missing floor key → succeeds with `null` floor (fail open).
     - Test `countDocs` cache: repeated word hits DB once; thrown/timed-out `countDocs` is NOT cached and retries on next call.
     - Test speculative embed: (a) on `productCode = true` or `unknownCatalogFormat = true`, neither `checkSpelling` nor `embed` is called; (b) on `meaningful = false`, a rejecting speculative embed does NOT return 503 or leak an unhandled rejection — search runs keyword-only cleanly; (c) on `corrected !== null`, corrected semantic variant is embedded while original variant reuses cached vector; (d) `loadNamedScope` receives `[query, spelling.corrected]` after spelling resolves.
- **How it should behave when done:** Every Phase 2 safety invariant (admin auth, D4 fail-loud, D5 style-number fast path, D1 named scope after spelling, coalescing cancellation safety) is permanently pinned by fast unit tests.
- **Verification gate — you'll know it worked when:** `npx vitest run src/test/dam-search.test.ts supabase/functions/_shared/query-embed-batch.test.ts supabase/functions/dam-search-ai/index.test.ts` and `npm test` pass with 0 failures.

---

> **Context cut point 2 (after Phase 2 merges and deploys):** Pair with `fresh-session`. Update STATUS table with commit SHAs / CI runs, verify `step-timing.mjs --first-hit` shows expected `auth` and overlap gains, then re-read Phase 3 before starting Step 6.

---

#### Phase 3 — Database Picture-Anchor Merge & Exact Multi-Variant Union

##### Step 6 — Shared-DB migration + edge cleanup: inline scoped picture anchor inside `search_dam_documents`
- **Who:** `lead-only` — core SQL ranking/floor math in `popcre/shared-db` + live 137-case parity verification before removing `anchor_rpc`.
- **Dependencies:** Phase 1 live (uses updated `search_dam_documents`). Follow `shared-db-change` skill (claim-first).
- **What to change:**
  1. **In `popcre/shared-db` (new timestamped migration):**
     - Update `public.search_dam_documents` so that when `p_query_embedding IS NOT NULL` and `p_min_semantic_score` is passed as the base configured floor (or via an explicit backward-compatible boolean `p_compute_anchor boolean default false` so old callers passing an already-anchored floor keep exact old behavior during deploy overlap!):
       - Compute `best_semantic_score` inside the **same** query using a single scan of `dam.search_group_vectors` (for style-group mode) and the exact allowed-set scan (for asset mode), reusing the already-computed `require_dam_access()` and `dam_search_named_scope()` results.
       - **CRITICAL ordering rule (§7 #2):** Compute the scoped `max(semantic_rank)` (applying `semanticLicensorIds`, named property, and named character scope exactly as `dam_search_semantic_anchor_named` / `_scoped` do) **BEFORE** any global `LIMIT 2000` vector cutoff! If the scoped set has zero picture vectors, fall back to the global max (matching current `_scoped`/`_named` anchor behavior — verify exact fallback semantics against `20261201100000:2991-3088` and `20261225010417:127-203`).
       - Apply the exact same `effectiveSemanticFloor(p_min_semantic_score, best_semantic_score)` margin formula (`supabase/functions/_shared/semantic-floor.ts` — verify constants match bit-for-bit!).
     - Keep `dam_search_semantic_anchor*` RPCs intact for backward compatibility during deploy overlap (do not drop them in this migration).
     - Add SQL contract tests in `popcre/shared-db/supabase/tests/` testing:
       - Parity between `p_compute_anchor = true` and the two-RPC (`anchor_rpc` → `search_dam_documents`) path across unscoped, licensor-scoped, named-character, named-property, and asset-mode queries.
       - Specifically include a fixture where the scoped best picture sits **outside** the global top-2,000 vector candidates, proving the scoped anchor still finds it.
     - Merge `popcre/shared-db` PR and wait for automatic production promotion to complete.
  2. **Read-only parity check against live production BEFORE removing `anchor_rpc`:**
     - Run a read-only parity script across all 137 PopDAM cases comparing top-20 ordered IDs, `total_count`, and `total_group_files` between the old two-RPC path and `p_compute_anchor = true`. **Gate:** **0/137 parity mismatches** (or every single diff explained down to floating-point tie-breaking and verified neutral/better on the 137/137 scorecard).
  3. **In `u2giants/popdam3` (`supabase/functions/dam-search-ai/index.ts:731-802`):**
     - Pass `p_min_semantic_score: minSemanticScore` (raw admin floor) and `p_compute_anchor: true` to `search_dam_documents`, and remove the separate `anchor_rpc` call block (lines 739–773).
     - Update `supabase/functions/dam-search-ai/index.test.ts` to assert `anchor_rpc` is no longer called and `p_compute_anchor: true` + raw floor are passed cleanly.
- **How it should behave when done:** Every single-variant semantic search executes **one** database RPC instead of two, cutting ~11,530 buffers/search and eliminating `anchor_rpc` HTTP/PostgREST RTT and cold anchor tails (previously up to 1.83 s on character queries) with zero ranking regressions.
- **Verification gate — you'll know it worked when:** Shared-db migration is in the production ledger, read-only 137-case parity check shows 0 unexplained diffs, `dam-search-ai` deploys cleanly, `Server-Timing` shows no `anchor_rpc` step, and `scripts/search-eval/run.mjs` scores 137/137 on PopDAM.

##### Step 7 — Shared-DB migration + edge update: DB-side exact multi-variant union before paging/counting
- **Who:** `lead-only` — SQL set-union, deduplication, and exact total/file-count semantics across product-phrase query variants (`popcre/shared-db` + `dam-search-ai`).
- **Dependencies:** Step 6 live in production (so each variant uses the inline anchor cleanly). Follow `shared-db-change` skill (claim-first).
- **What to change:**
  1. **In `popcre/shared-db` (new timestamped migration):**
     - Implement DB-side multi-variant execution (either `public.search_dam_documents_multi(p_variants jsonb, ...)` or an optional `p_variants jsonb default null` parameter on `search_dam_documents` per §8 open criterion) that:
       - Enforces `require_dam_access()` once.
       - Evaluates each variant (`query`, optional `query_embedding`, optional `query_text_embedding`, optional `semantic_scope` / `named_scope`) using the exact same per-variant candidate, inline-anchor, and ranking math as single-variant `search_dam_documents`.
       - Deduplicates across variants by `(document_type, entity_id)`, keeping `max(keyword_rank)`, `max(semantic_rank)`, and `max(rank)` (matching `supabase/functions/_shared/dam-search-merge.ts:58-64`), sorted by `rank DESC, document_type ASC, entity_id ASC`.
       - Computes **exact** `total_count` over the deduplicated union BEFORE applying `p_limit`/`p_offset`, **exact** `total_group_files` (`sum(sg.asset_count)` over the deduplicated union of visible style groups, NEVER double-counting a group matched by two variants!), exact `has_more`, and exact union facets when `p_include_facets = true`.
       - Preserves `word_form_overflow` handling identically.
     - Add SQL contract tests in `popcre/shared-db/supabase/tests/` covering:
       - Disjoint variant sets (proving `total_count = |A| + |B|`, not `max(|A|, |B|)`).
       - Overlapping variant sets (proving shared groups are counted once in `total_count` and once in `total_group_files`, taking `max(rank)`).
       - Nested variant sets (proving exact agreement with superset).
       - Pagination across page 1 and page 2 of a union (`offset > 0` returns disjoint slices summing to `total_count` with zero skipped or duplicated rows).
       - Unauthorized caller rejection.
     - Merge `popcre/shared-db` PR and wait for automatic production promotion.
  2. **In `u2giants/popdam3` (`supabase/functions/dam-search-ai/index.ts:731-850` & `_shared/dam-search-merge.ts`):**
     - When `queryVariants.length === 1`, keep the direct single-variant `search_dam_documents` call (zero extra JSON overhead).
     - When `queryVariants.length > 1`, pass the full `queryVariants` array (with each variant's embeddings and scope) to the DB multi-variant RPC in **one** call (with the existing 1-retry-on-transient-error policy and fail-loud `503` on failure — never returning a partial subset of variants).
     - Update `supabase/functions/dam-search-ai/index.test.ts` to verify single-variant stays on single path and multi-variant sends all variants to the multi-variant RPC and returns its exact `total_count` and `total_group_files`.
- **How it should behave when done:** Multi-variant product-phrase searches make one DB call instead of 2–3 concurrent calls, report exact union totals and exact deduplicated group file totals on every page (fixing the confirmed 84-vs-86 undercount), and paginate accurately past page 1.
- **Verification gate — you'll know it worked when:** Shared-db contract tests prove exact disjoint/overlapping/nested union totals and `total_group_files`, `npm test` passes, and live verification on the 4 multi-variant eval cases shows exact union totals matching direct read-only SQL union counts (0 undercounts).

---

> **Context cut point 3 (after Phase 3 merges and deploys):** Pair with `fresh-session`. Update STATUS table with commit SHAs / CI runs / parity evidence, then re-read Phase 4 before starting Step 8.

---

#### Phase 4 — PopSG Style-Guide Speedups

##### Step 8 — PopSG single-call spelling (eliminate redundant `action: "spelling"` round-trip)
- **Who:** `lead-only` — touches PopSG edge contract (`popsg-query-embedding`) and PopSG search orchestration (`PopSGLibraryPage.tsx`, `popsgSearchV2.ts`), where PopSG-only access isolation and zero-result fallback order are security/accuracy boundaries.
- **Dependencies:** Independent of Phase 3 (can run after Phase 2, ordered here for clean phase boundaries).
- **What to change (in `u2giants/popdam3`):**
  1. `supabase/functions/_shared/popsg-query-embedding.ts:12-25`:
     - Return `corrected: checked.corrected` alongside `{ embedding, skipped }` from `getPopSGQueryEmbedding` (preserving `corrected: null` when skipped for keyword/product_code or `!checked.meaningful`).
  2. `supabase/functions/dam-search-ai/index.ts:505-547`:
     - Include `corrected: semantic.corrected ?? null` in the JSON response of `action === "popsg-query-embedding"`.
     - Preserve PopSG-only access: NO `require_dam_access()` check here (line 506).
  3. `src/pages/popsg/popsgSearchV2.ts:172-189`:
     - Extend `parsePopSGQueryEmbedding` to parse and return `corrected: typeof row.corrected === "string" && row.corrected.trim() ? row.corrected.trim() : null`.
  4. `src/lib/dam-search.ts:192-226` and `src/pages/popsg/PopSGLibraryPage.tsx:154-169,193-197`:
     - Add an optional parameter to `expandFallbackTerms(rawTerm, options?: { skipRemoteSpelling?: boolean; correctedTerm?: string | null })` (or extract a clean helper `expandSynonymTerms(rawTerm)` that calls ONLY `expand_dam_search_queries` + separator variants without `action: "spelling"`).
     - In `PopSGLibraryPage.tsx:154-158`: run `expandSynonymTerms(filters.nameSearch)` in parallel with `fetchPopSGQueryEmbedding(filters.nameSearch.trim(), signal)`, then merge `corrected` (plus its hyphen/space variants, exactly matching `expandFallbackTerms:200-206`!) into `expandedTerms` before calling `buildPopSGV2WebsearchQuery`.
     - Leave `action: "spelling"` in `dam-search-ai` intact for backward compatibility with any other caller (e.g. PopDAM keyword fallback path in `full-text-search.ts:96`).
     - Update `supabase/functions/_shared/popsg-query-embedding.test.ts` and `src/pages/popsg/` tests to assert `corrected` is returned and merged identically, and `PopSGLibraryPage` makes **0** `action: "spelling"` calls during a normal PopSG search.
- **How it should behave when done:** Every PopSG search saves the full serial `action: "spelling"` round-trip (measured 196 ms p50 / 452 ms p95; −297 ms p95 on PopSG Files) while keeping identical query expansion, zero-result fallback behavior, and PopSG-only user access.
- **Verification gate — you'll know it worked when:** `npm test` passes, a network trace on `sg.designflow.app` shows 0 calls to `action: "spelling"` on typed PopSG searches, and `scripts/search-eval/run.mjs` scores 65/65 on PopSG guides and 65/65 on PopSG files.

##### Step 9 — Benchmark-gated PopSG inline whole-guide summary inside `search_style_guide_library_v2`
- **Who:** `lead-only` — shared-database RPC change in `popcre/shared-db` gated by mandatory `EXPLAIN (ANALYZE, BUFFERS)` proof against the measured browser baseline (148 ms p50 / 546 ms p95).
- **Dependencies:** Step 8 deployed. Follow `shared-db-change` skill (claim-first).
- **What to change:**
  1. **Mandatory pre-edit read-only benchmark (do NOT skip):**
     - Inspect existing indexes on `public.style_guide_file_groups_snapshot` in read-only Postgres.
     - Verify the exact 5-tuple grouping semantics from `src/pages/popsg/popsgSearchV2.ts:323-368`: each returned guide row is enriched by aggregating ALL rows in `public.style_guide_file_groups_snapshot` matching `(root_label, licensor_name, property_folder, style_guide_folder, style_guide_name)` using `IS NOT DISTINCT FROM` (handling `NULL` folders safely!):
       - `whole_guide_file_count = sum(s.file_count)`
       - `total_size_bytes = sum(s.total_size_bytes)`
       - `member_directory_paths = array_agg(DISTINCT s.directory_path ORDER BY s.directory_path) FILTER (WHERE s.directory_path IS NOT NULL)`
     - **CRITICAL TRAP (§7 #6):** Query **`public.style_guide_file_groups_snapshot` directly** inside `search_style_guide_library_v2` (which has ALREADY enforced PopSG authorization at function entry!). **NEVER** join to the `public.style_guide_file_groups` view — we measured that at 196 ms p50 / 1,706 ms p95 (slower than browser batching!).
     - Test via `hypopg` / read-only `EXPLAIN (ANALYZE, BUFFERS)` whether a composite index on `public.style_guide_file_groups_snapshot (root_label, licensor_name, property_folder, style_guide_folder, style_guide_name)` (or `coalesce(...)` expression index matching `IS NOT DISTINCT FROM` lookups) gives an Index Scan with sub-50 ms p95 across the 65 PopSG guide queries.
     - **Hard Go/No-Go gate:** Proceed ONLY if the measured in-RPC enrichment adds **< 80 ms p50 and < 250 ms p95** (beating browser chunked enrichment's 148 ms p50 / 546 ms p95 cleanly!). If it does not beat browser batching even with an index, record the `EXPLAIN` output on `#1430`, mark Step 9 skipped-by-measurement, and proceed directly to Step 10.
  2. **In `popcre/shared-db` (new timestamped migration, if Go gate passes):**
     - Add the verified index on `public.style_guide_file_groups_snapshot` (if needed).
     - Update `public.search_style_guide_library_v2` (guide mode only) to return `whole_guide_file_count`, `total_size_bytes`, and `member_directory_paths` on each paginated guide row (applied AFTER `LIMIT`/`OFFSET`, so only the visible page's guide identities are joined to `style_guide_file_groups_snapshot`!), while keeping `matched_file_count` intact for any caller that reads it.
     - Add SQL contract tests in `popcre/shared-db/supabase/tests/` proving:
       - Whole-guide `whole_guide_file_count`, `total_size_bytes`, and `member_directory_paths` match `enrichPopSGV2Guides` bit-for-bit across single-directory guides, multi-directory guides, guides with `NULL` `style_guide_folder` / `property_folder`, and filtered searches (where matched files < whole guide files — the card and detail drawer must still show the whole guide!).
       - PopSG-only user succeeds; unauthorized user is denied.
     - Merge `popcre/shared-db` PR and wait for automatic production promotion.
  3. **In `u2giants/popdam3` (`src/pages/popsg/popsgSearchV2.ts:293-368` & `src/pages/popsg/PopSGLibraryPage.tsx:207-238`):**
     - Update `mapPopSGV2Guide` to read `whole_guide_file_count`, `total_size_bytes`, and `member_directory_paths` directly when present on the RPC row (preserving the `directory_path: memberDirectoryPaths.length === 1 ? memberDirectoryPaths[0] : guide.directory_path` rule from line 364).
     - In `PopSGLibraryPage.tsx:207-238`, skip the `style_guide_file_groups` chunked enrichment fetch whenever the RPC already returned whole-guide summary fields (keeping a clean fallback only if a guide row lacks `total_size_bytes` during brief deploy overlap, or removing the browser loop cleanly once Step 9 DB migration is live).
     - Add unit tests in `src/test/` verifying `mapPopSGV2Guide` maps inline whole-guide fields (including multi-directory and null-folder guides) and `fetchPopSGV2Page` makes **0** PostgREST requests to `style_guide_file_groups`.
- **How it should behave when done:** PopSG guide searches display whole-guide file counts, byte totals, and detail-drawer directory paths immediately from the single `search_style_guide_library_v2` response (reading the exact same hourly snapshot as today — zero added staleness), eliminating 2–10 post-RPC PostgREST round-trips per search.
- **Verification gate — you'll know it worked when:** Pre-merge `EXPLAIN (ANALYZE, BUFFERS)` beats 148 ms p50 / 546 ms p95, shared-db contract tests and `npm test` pass, live `sg.designflow.app` network trace shows 0 `style_guide_file_groups` requests after `search_style_guide_library_v2`, and card counts/sizes match the open detail drawer on filtered and multi-directory guides.

---

> **Context cut point 4 (after Phase 4 merges and deploys):** Pair with `fresh-session`. Update STATUS table with commit SHAs / CI runs / EXPLAIN proof, then re-read Phase 5 before starting Step 10.

---

#### Phase 5 — Live Proof, Post-Change Measurements & Closeout

##### Step 10 — Two clean Search test set runs, live browser verification, post-change `EXPLAIN` audit, and issue `#1430` closeout
- **Who:** `lead-only` — live production acceptance judgment, accuracy verification, and issue/handoff retirement.
- **Dependencies:** Steps 1–9 merged, deployed (verified live frontend SHA + edge deploy workflow green + all shared-db migrations in production ledger).
- **What to do:**
  1. **Verify clean DB window before each benchmark** (no shared-db deploy, no PopSG crawl, no cron job 12 `refresh-style-guide-library-default-snapshot` overlap, no concurrent eval run, no edge deploy within 5 minutes — see §11).
  2. **Run two clean `"Search test set"` GitHub Actions runs** (`.github/workflows/search-eval.yml`, labels e.g. `issue-1430-post-run1` and `issue-1430-post-run2`) and inspect `report.json` from both artifacts:
     - PopDAM accuracy MUST be **137/137** (0 errors).
     - PopSG guides accuracy MUST be **65/65** and files **65/65** (0 errors).
     - Record p50 and p95 for PopDAM overall, character kind, product kind, code kind (confirming style numbers remain ~0.3–0.5 s!), and PopSG guides & files.
  3. **Run live browser + end-to-end verification against `https://dam.designflow.app` and `https://sg.designflow.app`** (authenticated viewer tester from 1Password):
     - Confirm PopDAM Groups search fires **1** `dam-search-ai` call (`include_facets: false`), **0** duplicate Groups searches, **0** `get_filter_counts` calls while Filter Sidebar is closed.
     - Confirm a broad query matching >200 groups and a filtered query whose matching groups rank past 200 display exact whole-group file counts matching read-only Postgres `sum(style_groups.asset_count)`.
     - Click "Filters" with a search active and confirm current facet counts populate cleanly without blanking cards or flashing stale counts.
     - Confirm a known style number and an unknown catalog-format code execute quickly with `spelling` and `embed` absent from `Server-Timing`.
     - Confirm PopSG guide search makes 0 `action: "spelling"` calls and (if Step 9 shipped) 0 `style_guide_file_groups` chunk requests, and guide card counts/sizes agree with the open detail drawer.
     - Confirm error+Retry still appears on simulated failure and access denial (`403`) still works for unauthorized callers.
  4. **Run a post-change cold `EXPLAIN (ANALYZE, BUFFERS)`** on representative PopDAM & PopSG queries (read-only) to measure remaining warm & cold bottlenecks — specifically noting `expand_dam_search_queries` (was 77 ms p50 / 228 ms p95) and `dam.search_group_vectors` (was 91 MB, 2.6× bloat). Record in the `#1430` closing note whether a separate follow-up issue is justified (do NOT fold speculative storage changes into `#1430`).
  5. **Close out documentation & issue:**
     - Post one signed before/after summary comment on `u2giants/popdam3#1430` (with run IDs, deployed commit SHAs, production migration versions, EST timestamps, and zero licensed names/SKUs/eval queries).
     - Tick `- [x] live proof` in `#1430`'s body and close `#1430`.
     - In a final cleanup PR on `u2giants/popdam3`: mark all rows `✅ done` (with verifiable artifacts) in this plan's STATUS table and update its frontmatter `status: done`, delete `HANDOFF.d/2026-11-26T2212Z-edge-dev-antigravity-issue-1430-semantic-search-speed-plan.md`, update `AGENTS.md` and `docs/SEARCH_PERFORMANCE.md` to reflect the shipped architecture, regenerate `docs/INDEX.md` (`ai-doc-health --repo . --fix-index`), pass `ai-doc-safety`, and merge.
- **Verification gate — you'll know it worked when:** Both clean `"Search test set"` runs score 137/137 PopDAM & 65/65 PopSG (0 errors) with measured p50/p95 improvements over the Nov 26 baseline, live browser checks pass, `#1430` has `- [x] live proof` and is closed, and this plan's `HANDOFF.d/` file is retired on `main`.

---

#### Adversarial-Cases Table (Trust-Boundary Inputs)

Every external input crossing the browser ↔ Edge Function ↔ Postgres trust boundary MUST be covered by a named test before its phase is marked done:

| External Input / Boundary | Hostile or Edge Case | Required Behavior | Named Test Proving It |
|---|---|---|---|
| `body.include_facets` (`dam-search-ai`) | Non-boolean tampering (`"false"`, `0`, `null`, `{}`) | Strictly default to `true` unless `=== false`; never crash or leak unexpected types to RPC | `supabase/functions/dam-search-ai/index.test.ts` — `"defaults non-boolean include_facets safely to true"` (Step 3) |
| `body.limit` & `body.offset` (`dam-search-ai`) | `limit: 5000`, `limit: -1`, `offset: 999999`, `NaN` | Clamp `limit` to `[1, 200]` and `offset` to `[0, 10000]`; `total_count` and `total_group_files` remain exact and independent of paging | `supabase/functions/dam-search-ai/index.test.ts` + `popcre/shared-db` contract test `"total_group_files stays exact beyond 200-group page clamp"` (Steps 1, 3) |
| `body.filters` JSON (`dam-search-ai` & SQL) | Array, primitive, deeply unexpected keys, or forged `semanticLicensorIds` / `namedScope` keys from caller | Reject non-object/array with `400 Invalid filters`; server overwrites/controls internal semantic scope keys — caller cannot inject scope bypass | `supabase/functions/dam-search-ai/index.test.ts` — `"rejects malformed filters and ignores caller-injected internal scope keys"` (Step 3) |
| Authorization on `dam-search-ai` search & admin actions | Authenticated non-admin viewer calls `embedding-status` or `reset-embedding-errors`; revoked/non-DAM user calls `search` or `search-modes` | Admin actions lazily query `user_roles` and return `403`; search actions enforce `require_dam_access()` via caller JWT and return `403` without substituting `lastKnownGoodMode` | `supabase/functions/dam-search-ai/index.test.ts` — `"defers user_roles on search while enforcing 403 on admin actions"` + `src/test/dam-search.test.ts` — `"does not fall back to cached mode on 403 denial"` (Steps 4, 5) |
| PopSG-only user (no DAM access) | User with PopSG permission only calls `popsg-query-embedding` and `search_style_guide_library_v2` | Succeeds and returns `corrected`, `expansion`, `fallback`, and inline guide summaries; unauthorized user with neither PopSG nor DAM access is rejected | `supabase/functions/_shared/popsg-query-embedding.test.ts` + `popcre/shared-db` contract test `"popsg v2 inline summary enforces PopSG access without requiring DAM access"` (Steps 8, 9) |
| Catalog item-number / SKU query (`D5`) | Known item prefix OR unknown full catalog-format code | Completes `product_code` and `catalog_format` FIRST; NEVER invokes `checkSpelling`, `admin_config`, or speculative `embed` | `supabase/functions/dam-search-ai/index.test.ts` — `"skips spelling and speculative embed for known and unknown catalog codes"` (Step 5) |
| Gibberish / non-meaningful query during speculative embed | Query where `checkSpelling` returns `meaningful: false` while speculative `embed` fails/times out | Discards speculative embed error cleanly (no unhandled rejection, no `503`), executes keyword-only search | `supabase/functions/dam-search-ai/index.test.ts` — `"swallows speculative embed failure when spelling marks query not meaningful"` (Step 5) |
| Transient `text-embed` or `admin_config` failure on meaningful query (`D4`) | `/embed-text-batch` returns 500/timeout or `admin_config` read errors | Fails loud with `503 Search unavailable` (never silent keyword downgrade); rejected promise is NOT cached in `query-embed-batch` or `countDocs` | `supabase/functions/dam-search-ai/index.test.ts` + `supabase/functions/_shared/query-embed-batch.test.ts` — `"fails closed without caching embed or config errors"` (Step 5) |
| Concurrent cold embed misses + caller abort | Request A aborts mid-flight while Request B awaits the same coalesced `/embed-text-batch` call | Request B still completes cleanly with valid vectors; `inFlight` entry is cleaned up in `.finally()` | `supabase/functions/_shared/query-embed-batch.test.ts` — `"isolates caller cancellation across coalesced in-flight requests"` (Step 5) |
| Scoped picture anchor outside global top-2,000 | Scoped licensor/character/property best picture ranks #2,500 globally | Inline anchor computes scoped max BEFORE global top-2,000 cutoff and preserves exact floor parity with separate `anchor_rpc` | `popcre/shared-db` SQL contract test `"inline scoped anchor evaluates before global 2000 cutoff"` (Step 6) |
| Multi-variant disjoint, overlapping & failing variants | Disjoint sets (true union > max variant), overlapping sets (shared group counted once in `total_count` and `total_group_files`), or 1 variant erroring | Exact deduplicated union `total_count` and `total_group_files` across pages; any variant error fails the whole request (`503`) | `popcre/shared-db` SQL contract test `"multi-variant union reports exact deduplicated counts across disjoint and overlapping pages"` + `dam-search-ai/index.test.ts` (Step 7) |
| PopSG guide 5-tuple with `NULL`s, quotes, commas & multi-directory paths | Guide row where `property_folder` or `style_guide_folder` is `NULL`, name contains quotes/commas, or files span multiple directories under a filter | `IS NOT DISTINCT FROM` joins accurately, sums whole-guide `file_count` and `total_size_bytes` (ignoring file filter), and returns deduplicated `member_directory_paths` | `popcre/shared-db` SQL contract test `"popsg v2 inline summary handles null folders, punctuation, multi-directory guides, and active filters"` (Step 9) |
| Closed-to-open Filter Sidebar transition | User searches with sidebar closed, then clicks "Filters" (and/or switches Groups ↔ Files or hits Retry) | `get_filter_counts` never fires on hybrid search; opening sidebar refetches with `includeFacets: true` without blanking cards or flashing stale pre-search facets | `src/test/library-groups-single-search.test.tsx` — `"omits facets while sidebar closed and loads fresh facets on open without stale flash"` (Step 3) |

---

### 10. Tests required

**Existing suites that MUST stay green on every `u2giants/popdam3` PR:**
- `npm run typecheck`
- `npm run lint`
- `npm test` (Vitest suite covering `src/test/**` and `supabase/functions/**`)
- `node --test scripts/search-eval/*.test.mjs`
- `bash scripts/test-task-gates.sh && bash scripts/test-supabase-deploy-target.sh`

**New/expanded tests required by phase:**
- **Phase 1 (`popcre/shared-db`):** SQL contract tests in `popcre/shared-db/supabase/tests/` for `search_dam_documents` (`total_group_files` exact >200 & filtered-below-200, `p_include_facets = false` parity, group-only `dam_search_named_scope(p_filters, false)` parity, unauthorized access denial).
- **Phase 1 (`u2giants/popdam3`):**
  - `src/test/library-groups-single-search.test.tsx` (real `useStyleGroupAssetCount`, no mock hiding it): single hybrid request in Groups mode, exact >200-group file total, closed-sidebar facet omission (`get_filter_counts` not called), open-sidebar facet refetch without stale flash, keyword mode & non-search filtered browsing preserved.
  - `src/test/library-mode-queries.test.tsx`: updated for `includeFacets` contract.
  - `supabase/functions/dam-search-ai/index.test.ts`: `include_facets` boolean validation, `total_group_files` & `facets_included` response contract, malformed `filters` rejection.
- **Phase 2 (`u2giants/popdam3`):**
  - `src/test/dam-search.test.ts`: `preloadSearchMode()`, rejected cold promise eviction on Retry, 401/403 denial never returning `lastKnownGoodMode`.
  - `supabase/functions/_shared/query-embed-batch.test.ts`: concurrent cold-miss coalescing (1 transport call), no failure caching, caller-cancellation isolation.
  - `supabase/functions/dam-search-ai/index.test.ts`: 0 `user_roles` calls on search/search-modes, 403/200 enforcement on `embedding-status` / `reset-embedding-errors`, combined `admin_config` fail-closed vs optional floor fail-open, `countDocs` cache hit + error non-caching, speculative embed skipped on catalog codes, speculative embed error swallowed on `!meaningful`, corrected-variant incremental embed, `loadNamedScope` ordering after spelling.
- **Phase 3 (`popcre/shared-db` & `u2giants/popdam3`):**
  - `popcre/shared-db/supabase/tests/`: inline scoped anchor parity (including scoped best picture outside global top 2,000), asset-mode anchor parity, multi-variant exact disjoint/overlapping/nested union & pagination (`total_count`, `total_group_files`, `has_more`).
  - `supabase/functions/dam-search-ai/index.test.ts`: `anchor_rpc` eliminated, `p_compute_anchor: true` passed, multi-variant single RPC call + fail-loud on error.
- **Phase 4 (`popcre/shared-db` & `u2giants/popdam3`):**
  - `supabase/functions/_shared/popsg-query-embedding.test.ts`: returns `corrected` cleanly without requiring DAM access.
  - `src/test/` PopSG unit tests: `parsePopSGQueryEmbedding` reads `corrected`, `fetchPopSGV2Page` makes 0 `action: "spelling"` calls and (after Step 9) 0 `style_guide_file_groups` requests, `mapPopSGV2Guide` maps inline whole-guide counts/sizes/paths.
  - `popcre/shared-db/supabase/tests/`: `search_style_guide_library_v2` inline `style_guide_file_groups_snapshot` enrichment parity (null folders, punctuation, multi-directory guides, active filters, PopSG-only access).

---

### 11. Constraints, standing rules, and gotchas

1. **Shared DB Gatekeeper (hard rule):** Never put SQL DDL in `u2giants/popdam3` (`supabase/migrations/` is guarded by `shared-db-guard.yml`) and never edit vendored `shared-db/`. Author all database changes in `popcre/shared-db` using claim-first discipline (`shared-db-change` skill). Changes reach production ONLY via `popcre/shared-db`'s automatic preview → production promotion workflow.
2. **Worktrees & branch protection:** Never edit canonical checkouts directly and never push directly to `main`. Create an isolated worktree from `origin/main` per phase/PR, run `git var GIT_COMMITTER_IDENT` (must be `Albert Hazan <u2giants@users.noreply.github.com>`), open a PR, and merge it yourself once CI is green (never `--admin` or `--squash` on merge-queue repos; never ask Albert to merge).
3. **Declare task gates:** Run `ai-task-gates start --class <class>` (`ui-live-workflow` for `src/**`, `deployment` for `supabase/functions/**`, `code` for docs/router edits) and recheck before shipping (`ai-task-gates check --before ...`).
4. **Public-repo privacy (CRITICAL):** `u2giants/popdam3` is public. Never put licensed brand/character/property names, product SKU strings, raw query strings from `SEARCH_EVAL_SET_V1`, customer names, or database row data into code comments, tests, plans, handoffs, commit messages, or public GitHub issues/PRs.
5. **Sign every GitHub issue/PR/comment:** Use `ai-gh-signature` (`Posted by <tool> chat "<display name>" on <machine>`). Preserve existing signatures when editing bodies.
6. **Quote every human-facing time in EST (`America/New_York`):** On Windows, `TZ=America/New_York date` ignores `TZ` in Git Bash / PowerShell; compute EST via `node -e "console.log(new Date().toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}) + ' EST')"` or `python -c` with `zoneinfo`.
7. **No holds >30 minutes:** Never build or wait on any hold, cool-down, retry delay, or stuck process longer than 30 minutes.
8. **Clean-window rules for benchmarks (from `#804`):** A speed reading is contaminated if any of these ran within 5 minutes: a `popcre/shared-db` production migration apply, a PopSG crawl, `pg_cron` job **12** (`refresh-style-guide-library-default-snapshot`), another `"Search test set"` run, or an edge function deploy. Note: `pg_cron` job **13** is `prewarm-style-guide-search` (every 10 min) — do not confuse job 12 with job 13.
9. **Trap 1 — `src/pages/Index.tsx:98` `useFilterCounts` trigger:** If `useStyleGroups`/`useAssets` returns `searchFacets: undefined` because `includeFacets` was `false`, line 98 will immediately fire `useFilterCounts` (`get_filter_counts`) unless guarded by `filtersOpen` and `facetsIncluded === false`.
10. **Trap 2 — `src/test/library-mode-queries.test.tsx:20` mock blind spot:** That test file mocks `useStyleGroupAssetCount` to `{ data: 0 }`, which is why the duplicate Groups search went undetected. Step 3 MUST test with the real `useStyleGroupAssetCount` hook.
11. **Trap 3 — `public.style_guide_file_groups` view vs `public.style_guide_file_groups_snapshot` table:** The view runs per-row access checks and measured 196 ms p50 / 1,706 ms p95 when joined in SQL (slower than browser batching!). Step 9 MUST join the underlying indexed snapshot table inside the already-authorized RPC and verify `EXPLAIN (ANALYZE, BUFFERS)` beats browser batching.
12. **Trap 4 — `dam-search-ai` deploy overlap:** Deploy DB migrations (with backward-compatible defaults like `p_include_facets boolean default true`, `p_compute_anchor boolean default false`) and confirm them in the production ledger BEFORE deploying edge/frontend code that calls the new parameters.
13. **Trap 5 — `apps/text-embed` `_prefix_cache` mutation:** Do not remove `copy.deepcopy(_prefix_cache)` in `apps/text-embed/main.py:130`.

---

### 12. Access and environment

- **Authenticated CLIs / MCPs expected:** `gh` (GitHub CLI — `u2giants` for `u2giants/popdam3`, `popcre` for `popcre/shared-db`; never mix identities), `op` CLI and/or `1password` MCP server (Service Account scoped strictly to vault **`vibe_coding`**), Node.js (`npm`, `vitest`, `node --test`), Python 3 (`psycopg` v3 for read-only DB `EXPLAIN`/parity checks), `ai-doc-health`, `ai-doc-safety`, `ai-task-gates`, `ai-gh`, `ai-pr-wait`.
- **Target URLs & environments:**
  - PopDAM production: `https://dam.designflow.app` (Coolify on `hetz`, built from `u2giants/popdam3` `main`).
  - PopSG production: `https://sg.designflow.app` (same deployment).
  - Text-embed service: `https://text-embed.designflow.app` (Coolify on `hetz`, CPU).
  - Supabase project ref: `qsllyeztdwjgirsysgai` (`https://qsllyeztdwjgirsysgai.supabase.co`, Virginia, Medium compute).
  - Read-only Postgres session pooler: host `aws-0-us-east-1.pooler.supabase.com`, port `5432`, database `postgres`, user `postgres.qsllyeztdwjgirsysgai` (use `SET default_transaction_read_only = on` on every inspection/benchmark connection!).
- **Secrets & test logins (1Password vault `vibe_coding` — item titles ONLY, never paste values into chat, files, or logs):**
  - PopDAM viewer tester: `DAM AI tester login - PopDAM (viewer, dam.designflow.app, production)`
  - PopSG + PopDAM tester: `PopSG / PopDAM AI tester login (sg.designflow.app + dam.designflow.app)`
  - Shared Postgres password: `Supabase DB Password - shared POP database`
  - Text-embed API key: `PopDAM text-embed SigLIP2 query key - dam-search-ai (edge-dev)`
  - Inject via `op run` (never write plaintext `.env` files with live credentials; avoid `1password` MCP `op_run` for scripts running >2.5 minutes because MCP tool calls time out at 3 minutes — run `op run` directly in shell with `OP_SERVICE_ACCOUNT_TOKEN`).
- **Running locally:**
  - `npm ci` (if dependencies missing in a fresh worktree), `npm run dev` (local Vite frontend), `npm test`, `npm run lint`, `npm run typecheck`.
  - Per-step live PopDAM timing: `node scripts/search-eval/step-timing.mjs --first-hit` (credentials injected via `op run`).
  - Full search test set: dispatch `.github/workflows/search-eval.yml` with `gh workflow run search-eval.yml -R u2giants/popdam3 -f label=<name>`.

---

## Part 4 — Landing it

### 13. Definition of done, risks, rollback, and open questions

**Definition of Done (every item must pass before closing `#1430`):**
- [ ] All shared-db migrations (Steps 1, 6, 7, and Step 9 if Go gate passed) merged in `popcre/shared-db`, preview-rehearsed, SQL contract tests green, and verified present in production's migration ledger.
- [ ] All `u2giants/popdam3` changes (Steps 2, 3, 4, 5, 6, 7, 8, and Step 9 if Go gate passed) merged via PRs to `main` with CI green (`ci.yml`, `task-gates.yml`, `shared-db-guard.yml`, `edge-functions-format.yml`).
- [ ] Deployed production frontend SHA (`dam.designflow.app` / `sg.designflow.app`) and `deploy-supabase.yml` edge function deploy verified against merged `main` commits.
- [ ] All unit/UI/edge tests named in §10 passing (`npm run typecheck && npm run lint && npm test && node --test scripts/search-eval/*.test.mjs`).
- [ ] Two clean `"Search test set"` workflow runs pass with **137/137 PopDAM**, **65/65 PopSG guides**, **65/65 PopSG files**, **0 errors**, improved p50/p95 vs the 2026-11-26 baseline, and style-number fast path preserved (~0.3–0.5 s).
- [ ] Live browser proof verified on `dam.designflow.app` (1 request on Groups search, exact >200-group & filtered-below-200 file counts, closed-to-open Filter Sidebar facets, error+Retry, 403 access denial) and `sg.designflow.app` (0 `action: "spelling"` calls, whole-guide drawer agreement).
- [ ] Signed before/after summary + post-change cold `EXPLAIN` summary posted on `u2giants/popdam3#1430`; `- [x] live proof` ticked; `#1430` closed.
- [ ] This plan's STATUS table updated with verifiable artifacts (`status: done`), `HANDOFF.d/2026-11-26T2212Z-edge-dev-antigravity-issue-1430-semantic-search-speed-plan.md` deleted, `AGENTS.md` and `docs/SEARCH_PERFORMANCE.md` updated, and `docs/INDEX.md` regenerated (`ai-doc-health --repo . --fix-index`) with `ai-doc-safety` passing.

**Risks and rollback per phase:**
- **Phase 1 (duplicate search + `total_group_files` + `p_include_facets`):**
  - *Risk:* Stale or missing facets when opening Filter Sidebar, or accidentally triggering `useFilterCounts` when facets are omitted.
  - *Rollback:* Revert frontend/edge PR on `u2giants/popdam3` (Coolify rollback by `:<sha>` tag + re-run `deploy-supabase.yml` from reverted `main`). Shared-db Step 1 migration is backward-compatible (`p_include_facets default true`), so DB rollback is not needed for app revert.
- **Phase 2 (preload + role deferral + speculative embed):**
  - *Risk:* Unhandled promise rejection if speculative embed fails on gibberish, or accidental embed start on catalog codes, or stale `countDocs` cache.
  - *Rollback:* Pure app/edge revert on `u2giants/popdam3`; zero DB changes involved.
- **Phase 3 (inline anchor + multi-variant union):**
  - *Risk:* Subtle floor or ranking parity drift on scoped queries if scoped anchor is computed after `LIMIT 2000`.
  - *Mitigation & rollback:* Mandatory 0/137 read-only parity gate BEFORE removing `anchor_rpc` in `dam-search-ai`; keep legacy `dam_search_semantic_anchor*` RPCs in place so reverting the `dam-search-ai` PR immediately restores the two-RPC path with zero DB migration needed.
- **Phase 4 (PopSG single-call spelling + inline snapshot summary):**
  - *Risk:* Inline snapshot SQL join slower than browser parallel batches, or mismatch with detail drawer on multi-directory/filtered guides.
  - *Mitigation & rollback:* Mandatory pre-merge `EXPLAIN (ANALYZE, BUFFERS)` Go/No-Go gate (<80 ms p50 / <250 ms p95) and SQL contract parity tests; reverting the frontend PR restores browser chunked enrichment immediately without touching the DB.

**Open questions (to be answered by evidence during execution — none need owner input):**
1. **Does an indexed direct join to `public.style_guide_file_groups_snapshot` beat browser batching in Step 9?** *Decision criterion:* Measured `EXPLAIN (ANALYZE, BUFFERS)` across the 65 PopSG guide queries must show `< 80 ms p50` and `< 250 ms p95` added cost (beating 148 ms p50 / 546 ms p95 browser batching). If not, skip Step 9's SQL/UI cutover and document the evidence on `#1430`.
2. **After Phases 1–4 ship, do `expand_dam_search_queries` (77 ms p50 / 228 ms p95 warm) or `dam.search_group_vectors` (91 MB, 2.6× bloat) still materially affect end-to-end p95?** *Decision criterion:* Measure via Step 10's post-change cold `EXPLAIN (ANALYZE, BUFFERS)`. If either remains a top-2 latency contributor (>150 ms p95), open a focused follow-up issue in `popcre/shared-db` rather than expanding `#1430`.

---

## Lead launch prompt

```text
You are the lead session executing the implementation plan for u2giants/popdam3#1430:
https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-1430-semantic-search-speed.md

Start immediately:
1. Read `AGENTS.md`, then read `docs/plans/issue-1430-semantic-search-speed.md` (STATUS table first) and its registered handoff `HANDOFF.d/2026-11-26T2212Z-edge-dev-antigravity-issue-1430-semantic-search-speed-plan.md`.
2. Execute the open steps in exact phase order starting at the first `⬜ open` step in the STATUS table. Never skip verification gates and never edit canonical checkouts directly — use isolated worktrees from `origin/main` in `u2giants/popdam3` and `popcre/shared-db`.
3. Delegation rules (full policy: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md):
   - You (the lead) perform all `lead-only` steps yourself (Steps 1, 2, 4, 6, 7, 8, 9, 10) and run all live verifications, shared-db claims/PRs, merges, and GitHub posts yourself.
   - Dispatch `helper-ok` steps (Step 3 after Step 2; Step 5 after Step 4) to your helper with exact file paths, exact assertions from §9–§10, and the step's stop-and-ask trigger.
   - Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
   - Helper contract: return finished work or an evidenced blocker; make no design decisions; never merge PRs or post to GitHub; stop and ask you immediately when a stop-and-ask trigger fires; take the step back if the helper is stuck for 30 minutes.
   - After every helper step, inspect the diff and run `npm run typecheck && npm run lint && npm test` yourself before committing.
4. At each phase boundary (after Phase 1, Phase 2, Phase 3, and Phase 4), update the plan's STATUS table with verifiable artifacts (commit SHAs, CI run IDs, migration versions), check context headroom (`fresh-session`), and re-read downstream phases for drift before proceeding.
5. Never put licensed names, product SKUs, or raw `SEARCH_EVAL_SET_V1` query strings into public repo files or GitHub issues/PRs. Never ask the owner to approve or merge technical PRs; merge green PRs yourself. Complete Step 10 live proof before ticking `- [x] live proof` and closing #1430.
```

---

## Self-audit (mandatory `implementation-plan-writer` gate)

**Checklist verification (every item graded against this file):**
- All 13 sections present: **YES** (§1–§13 all complete).
- Ultimate goal in plain business English up top + *"If a step conflicts with this goal, the goal wins — stop and flag it."*: **YES** (§1).
- Fresh session can execute without asking a single question or reading the planning chat: **YES** (§1–§12 carry every code anchor, benchmark baseline, trap, 1Password item title, SQL semantics, and verification gate).
- Rejected approaches and failed attempts documented with why: **YES** (§7, all 9 rejected items including the measured PopSG view-join slowdown and `_prefix_cache` deepcopy trap).
- Every step names concrete files/functions and has a verification gate: **YES** (Steps 1–10 in §9).
- Every step marked `lead-only` or `helper-ok` with a reason, zero model names in steps, and every `helper-ok` step has a stop-and-ask trigger: **YES** (STATUS table + §9; model names appear ONLY in the verbatim required helper sentence inside the Lead launch prompt).
- Trust-boundary work carries an adversarial-cases table with every row naming a test: **YES** (§9 Adversarial-Cases Table, 13 rows, every row names a specific test).
- Locked vs open decisions labeled: **YES** (§8).
- Explicit out-of-scope list: **YES** (§4).
- Tests specified by file and behavior, not "add tests": **YES** (§9 & §10).
- Every term, path, URL, identifier, and SHA defined or referenced: **YES** (§2, §5, §12).
- Secrets referenced by vault + item title only, never by value: **YES** (§12).
- Definition of done includes commit/push/CI/deploy/live-proof verification: **YES** (§13).
- Plan links to this session's new `HANDOFF.d/` file and that handoff links back to this plan; root `HANDOFF.md` untouched: **YES** (top of file + `HANDOFF.d/2026-11-26T2212Z-edge-dev-antigravity-issue-1430-semantic-search-speed-plan.md`).

**Three audit questions:**

1. **Could a brand-new AI session with no project knowledge and no context from this conversation execute this plan to perfection, without asking me anything?**
   **Yes.** §2 defines PopDAM, PopSG, the shared database (`popcre/shared-db` vs vendored read-only `shared-db/`), live URLs, and the judged test set (`2026-11-19-1037-artwork`). §5 pins exact `file:line` locations at `u2giants/popdam3@c077b3e7` and `popcre/shared-db@d384fce`. §9 gives 10 concrete ordered steps with exact target files, behavior, dependencies, role marks, stop-and-ask triggers, and verification gates, plus 13 adversarial trust-boundary rows each paired with a named test. §11 explicitly surfaces all five non-obvious traps (`Index.tsx:98` `useFilterCounts` fallback, `library-mode-queries.test.tsx:20` mock blind spot, `style_guide_file_groups` view vs snapshot table, backward-compatible DB deploy ordering, and `apps/text-embed` `_prefix_cache` mutation). §12 lists every CLI, pooler host, and 1Password item title needed to execute and verify live.
   *Gap checked:* Initial outline almost omitted Files mode (`src/hooks/useAssets.ts:340-366`) from `p_include_facets` wiring and `src/pages/Index.tsx:98`'s `useFilterCounts` trigger condition; both were verified against the actual source files at `c077b3e7` and integrated into Step 2, Step 3, and §11 Trap 1.

2. **Does the plan carry every piece of background, nuance, and reasoning I currently hold — including what we ruled out and why?**
   **Yes.** §3 preserves the complete 2026-11-26 measured benchmark baseline (sample sizes, p50/p95/mean, clean-window conditions, and exact 52% / 4,110 median missing-file truncation data) without leaking any private licensed names or eval queries. §6 records every root cause including the unexpected warm `EXPLAIN` finding (`expand_dam_search_queries` at 77 ms p50 / 228 ms p95) and `dam.search_group_vectors` 2.6× bloat. §7 documents all 9 rejected approaches from our Codex 6.2-Astra debate and live DB benchmarks — including why skipping global picture retrieval on `>=10` hits breaks scoring, why scoped anchor must run before global `LIMIT 2000`, why `loadNamedScope` stays after spelling, why catalog words stay out of `SEARCH_SPELLING_NAMES`, why `copy.deepcopy(_prefix_cache)` stays intact, and why joining the `style_guide_file_groups` view was rejected after measuring 196/1,706 ms.

3. **Is the ultimate goal stated clearly enough that the implementer could make a correct judgment call if a step turns out to be wrong?**
   **Yes.** §1 leads with plain business English describing the five concrete user outcomes (faster meaning searches at zero spend, exact Groups file counts across all matching groups, preserved near-instant style-number fast path, faster PopSG without extra staleness, and 100% preserved 137/137 + 65/65 accuracy and error+Retry/RLS safety) followed explicitly by *"If a step conflicts with this goal, the goal wins — stop and flag it."* §8 cleanly separates locked invariants from open implementation choices with objective criteria, and Step 9 embeds an explicit measurable Go/No-Go gate so an implementer never ships a PopSG SQL regression to satisfy a checklist step.

*Optional fresh-reader pilot:* Skipped (not requested; mandatory self-audit gate completed above).
