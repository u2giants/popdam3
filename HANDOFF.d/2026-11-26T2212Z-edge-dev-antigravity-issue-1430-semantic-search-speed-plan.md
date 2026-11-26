---
summary: Registers the issue #1430 plan (PopDAM/PopSG semantic search speedups and exact Groups file-count fix); open until Step 10 retires it.
kind: record
status: open
read-when: implementing, resuming, or auditing issue #1430 (PopDAM/PopSG semantic search speed, duplicate Groups search, Groups file-count truncation, closed-sidebar facets, PopSG summary enrichment)
issue: 1430
owner: docs/issue-1430-semantic-search-speed-plan
---

# Handoff — Issue #1430 semantic search speed plan registered

Written 2026-11-26, 5:12 PM EST, by Antigravity on `edge-dev`. Plan-only session: no implementation code written, no database modified, no `popcre/shared-db` claim held.

**Plan (read its STATUS table first; start at Step 1):**
- Relative link: [docs/plans/issue-1430-semantic-search-speed.md](../docs/plans/issue-1430-semantic-search-speed.md)
- GitHub URL (authored on PR branch, intended `main` URL once merged): https://github.com/u2giants/popdam3/blob/docs/issue-1430-semantic-search-speed-plan/docs/plans/issue-1430-semantic-search-speed.md (lands at https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-1430-semantic-search-speed.md)
- Tracking issue: https://github.com/u2giants/popdam3/issues/1430

---

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**None — nothing in this workstream needs the owner.** All business rulings are settled, all technical decisions stay with the AI, and Step 9's PopSG inline-summary cutover is governed by an objective benchmark gate inside the plan.

**Already settled — do NOT re-ask:**
- **Free fixes only (2026-11-10):** Do not upgrade Supabase compute/disk beyond Medium, do not adopt an external vector DB, and do not rent a paid GPU server.
- **Exact search totals only (2026-10-29, `#5053`):** Never show `N+` lower-bound estimates; both group counts and Groups header file counts must be exact across all matching visible groups.
- **Keep error + Retry on semantic failure (`D4`, `#1037`):** Never silently drop to keyword search when embedding, anchor, or text-meaning fails.
- **Keep style-number fast path (`D5`, owner reversal 2026-11-11, `#1061`):** Known item numbers/prefixes and unknown complete catalog-format codes skip spelling, picture vectors, and text-meaning vectors completely.
- **Locked embedding models (`D1`, 2026-10-23, `#4664` & `#1037`):** Keep SigLIP2 768 + Qwen3-Embedding-0.6B (`97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`) 1024 on pgvector/HNSW.
- **AI owns merges and reviews are advisory only (2026-09-28, 2026-10-29, 2026-10-30):** Never ask Albert to approve or merge technical PRs; merge green PRs yourself.

---

## 1. What this application is

- **PopDAM** (https://github.com/u2giants/popdam3, live at https://dam.designflow.app) is POP Creations' internal Digital Asset Manager for licensed product artwork. React/Vite frontend deployed on Coolify (`hetz`), Supabase Edge Functions (`dam-search-ai`), CPU query-embedding service (`apps/text-embed` at https://text-embed.designflow.app), GPU background indexer (`edge-dev`), and Railway worker (`apps/worker`).
- **PopSG** (same repository and Docker image, live at https://sg.designflow.app) is the companion licensor style-guide library (Guides and Files modes).
- **Shared database:** Supabase PostgreSQL project `qsllyeztdwjgirsysgai` (Virginia, Medium compute), shared across POP Creations apps. All structural DDL lives strictly in https://github.com/popcre/shared-db (automatic preview → production promotion). `u2giants/popdam3` keeps a read-only vendored mirror at https://github.com/u2giants/popdam3/tree/c077b3e7dd011e71ffa7aab9f10859871485eea1/shared-db (synced to https://github.com/popcre/shared-db/commit/d384fce) — never edit it.
- **Judged search test set:** Manual GitHub Actions workflow https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/.github/workflows/search-eval.yml running `SEARCH_EVAL_SET_V1` (`set_version = 2026-11-19-1037-artwork`: 137 PopDAM cases, 65 PopSG guides, 65 PopSG files).

---

## 2. What we set out to do this session, and why

On 2026-11-26, Albert asked to inspect PopDAM semantic search alongside Codex `gpt-6.2-astra` (medium effort), identify zero-cost ways to make semantic search faster, measure every candidate strategy at large sample size against live production and read-only Postgres, verify tradeoffs (snapshot freshness and preserving the ~0.33 s style-number fast path), and produce a complete `implementation-plan-writer` plan to implement all proven wins.

In business terms: make everyday PopDAM and PopSG meaning searches noticeably faster at zero extra cost, fix a silent bug where PopDAM Groups file totals drop every style group past #200 (affecting 52% of broad/filtered searches), and keep style-number searches nearly instant and search accuracy at 137/137 (PopDAM) and 65/65 (PopSG).

---

## 3. Current state — what is true right now

- **Baseline commits verified:**
  - `u2giants/popdam3` `origin/main` at https://github.com/u2giants/popdam3/commit/c077b3e7dd011e71ffa7aab9f10859871485eea1 (`shared-db` synced to https://github.com/popcre/shared-db/commit/d384fce).
- **Tracking issue opened:** https://github.com/u2giants/popdam3/issues/1430 (includes `- [ ] live proof`, signed).
- **Plan & handoff registration status:** Being committed on branch `docs/issue-1430-semantic-search-speed-plan` (PR to `u2giants/popdam3` `main`; intended `main` URLs noted above). Check `gh pr list -R u2giants/popdam3` or issue `#1430` comments for the merged commit SHA.
- **Implementation status:** All 10 steps across Phases 1–5 are `⬜ open`. Zero application code or database changes have been made or deployed.
- **Live baseline measured (2026-11-26, 3:50–4:10 PM EST, clean DB window, 0 errors across all runs):**
  - PopDAM full 137-case eval: Pass 1 `end_to_end` 1,103 ms p50 / 2,440 ms p95 (`cards_ready` 1,254 / 2,632 ms); Pass 2 `end_to_end` 934 / 1,760 ms (`cards_ready` 1,053 / 1,873 ms); character kind (N=40) worst tail 3,138 ms p95 (`cards_ready` 3,390 ms p95); code kind (N=19) 327 ms p50 / 462 ms p95.
  - PopSG full 130-case eval: Guides `total_to_cards` 845 ms p50 / 2,977 ms p95 (`guide_summary_enrich` 148 / 546 ms across p50=2 / p95=10 batches; `dup_spelling_call` 196 / 452 ms); Files 751 ms p50 / 2,079 ms p95.
  - Full paired A/B and read-only DB benchmark table lives in the plan §3.

---

## 4. Everything we tried that did NOT work (and ideas rejected with evidence)

Do not revisit any of these dead ends (full detail in plan §7):

1. **Naive SQL `LEFT JOIN public.style_guide_file_groups` view inside `search_style_guide_library_v2`:** Benchmarked on read-only Postgres across all 65 PopSG guide queries (2026-11-26) and measured **196 ms p50 / 1,706 ms p95** — *slower* than the browser's parallel 20-identity chunks (**148 ms p50 / 546 ms p95**) because `style_guide_file_groups` is a view with per-row access checks over `public.style_guide_file_groups_snapshot`. Step 9 MUST join the underlying indexed snapshot table directly inside the already-authorized RPC and prove faster via `EXPLAIN (ANALYZE, BUFFERS)` before shipping.
2. **Skipping global picture retrieval once `>= 10` keyword/text hits qualify:** Rejected in the two-round Codex review because `search_dam_documents` blends `0.15 * semantic_rank` into `rank` for keyword/text matches too — skipping global picture retrieval changes ordering, `min_rank`, and result membership.
3. **Computing the inline scoped picture anchor *after* global `LIMIT 2000`:** Rejected because a scoped licensor/character/property best picture outside the global top 2,000 would be dropped, changing the semantic floor. Must compute scoped max BEFORE global `LIMIT 2000` (falling back to global max only when scoped set is empty).
4. **Running `loadNamedScope` before `checkSpelling`:** Rejected because `loadNamedScope` depends on `knownFullNames` and `spelling.corrected`; running it before spelling risks broadening a misspelled named-character query (violates D1).
5. **Seeding ordinary catalog words into `SEARCH_SPELLING_NAMES`:** Rejected because `SEARCH_SPELLING_NAMES` also feeds `knownFullNames`, alias matching, and PopSG `name` vs `narrowed_name` logic. Use a separate bounded successful-only `countDocs` cache instead.
6. **Removing `copy.deepcopy(_prefix_cache)` in https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/apps/text-embed/main.py#L130-L139:** Rejected because `batch_repeat_interleave(batch)` and `use_cache=True` mutate the KV-cache object in place, which would corrupt the shared prefix cache across requests.
7. **Replacing `justified_visible` scan with `has_default_visible_member` alone:** Measured only **0.0 ms p50 / 2.4 ms p95** warm savings (`N=60`); not worth standalone risk.
8. **Speculative physical storage restructures (`halfvec(768)` on `dam.search_group_vectors`, splitting `dam.search_text_vectors`, partial `dam_search_keys` indexes, `OMP_NUM_THREADS` tuning):** Deferred out of this plan because warm `EXPLAIN (ANALYZE, BUFFERS)` revealed `expand_dam_search_queries` (77 ms p50 / 228 ms p95) is the slowest warm CTE — re-evaluate only in Step 10 after Phases 1–4 land.
9. **Using `1password` MCP `op_run` for >3-minute benchmark scripts:** MCP client calls time out at 3 minutes while the spawned child process keeps running; invoke `op run` directly in shell with `OP_SERVICE_ACCOUNT_TOKEN` for long scripts.

---

## 5. Root causes and key findings

Exact verified anchors on `u2giants/popdam3@c077b3e7` and `popcre/shared-db@d384fce`:

1. **Duplicate Groups search + silent 200-ID file-count truncation:**
   - https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/src/pages/Index.tsx#L177 enables `useStyleGroupAssetCount` whenever `hasActiveFilters(filters)` is true (including any non-empty search).
   - While https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/src/hooks/useStyleGroups.ts#L189-L214 runs filtered `fetchHybridSearchPage`, https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/src/hooks/useStyleGroups.ts#L345-L380 calls `resolveStyleGroupSearch` → `fetchHybridSearchIds(term, "style_group", 500)` (unfiltered!), which https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/supabase/functions/dam-search-ai/index.ts#L591 silently clamps to 200 IDs.
   - Result: +207–223 ms p50 / +592–682 ms p95 latency, +103% p95 `/embed-text-batch` contention on cold misses, and **52% of broad/filtered searches undercounting files** (median 4,110 missing files; p95 37,753).
   - Hidden from tests by https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/src/test/library-mode-queries.test.tsx#L20 mocking `useStyleGroupAssetCount: () => ({ data: 0 })`.
2. **Closed-sidebar facet trap:**
   - https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/src/pages/Index.tsx#L48 defaults `filtersOpen = false`, yet `search_dam_documents` always builds `visible_assets` + `matched_assets` + 5 facet aggregations (skipping saves 136 ms p50 / 2,430 ms p95 filtered, 36 ms p50 / 158 ms p95 narrow).
   - **Critical trap:** https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/src/pages/Index.tsx#L95-L99 enables `useFilterCounts` whenever `activeListData !== undefined && searchFacets === undefined`, so Step 2 MUST guard `useFilterCounts` on `filtersOpen` and explicit `facetsIncluded === false`.
3. **Double scan & unused named-scope asset sets in Postgres:**
   - https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/supabase/functions/dam-search-ai/index.ts#L739-L796 calls `anchor_rpc` sequentially before `search_dam_documents` (scanning 91 MB `dam.search_group_vectors` twice; inline merge cuts −29% buffers with 0/60 parity diffs).
   - https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/shared-db/supabase/migrations/20261225090101_dam_style_group_keyword_index_filters.sql#L64 calls 1-arg `dam_search_named_scope(p_filters)` defaulting `p_need_asset_sets => true` (+342.6 ms p95 waste on group-only named searches).
4. **Preventable pre-search waits & edge overhead:**
   - `action: "search-modes"` (https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/src/lib/dam-search.ts#L74-L102): 232 ms p50 / 366 ms p95 every 30 s idle.
   - Unused `user_roles` query (https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/supabase/functions/dam-search-ai/index.ts#L290): ~62 ms p50 / ~95 ms p95 HTTP/PostgREST RTT on every search.
   - Serial `spelling` → `embed` (https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/supabase/functions/dam-search-ai/index.ts#L638-L670): overlapping after code gates saves 43–47 ms mean / 159–163 ms p95; no in-flight coalescing in https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/supabase/functions/_shared/query-embed-batch.ts#L88-L162.
5. **Multi-variant lower-bound undercount:** https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/supabase/functions/_shared/dam-search-merge.ts#L39-L77 returns `max(variant totals, page rows)`, confirmed undercounting 1/4 multi-variant product expansions (84 vs 86).
6. **PopSG duplicate spelling & hourly snapshot:** https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/supabase/functions/dam-search-ai/index.ts#L518-L546 discards `corrected`, causing https://github.com/u2giants/popdam3/blob/c077b3e7dd011e71ffa7aab9f10859871485eea1/src/pages/popsg/PopSGLibraryPage.tsx#L155 (`expandFallbackTerms`) to run `action: "spelling"` a second time serially (196 ms p50 / 452 ms p95). `public.style_guide_file_groups_snapshot` already refreshes hourly at `:07` (`pg_cron` job 9) and post-scan checks (`pg_cron` job 12), so reading it directly inside `search_style_guide_library_v2` adds zero staleness.

---

## 6. Exact next steps

Run the **Lead launch prompt** at the bottom of [docs/plans/issue-1430-semantic-search-speed.md](../docs/plans/issue-1430-semantic-search-speed.md), executing in phase order (full file/line detail and adversarial-cases table in plan §9–§10):

1. **Phase 1 (Steps 1–3):** Land `popcre/shared-db` migration for exact `total_group_files`, `p_include_facets boolean default true`, and group-only `dam_search_named_scope(p_filters, false)`; verify production ledger; wire `dam-search-ai`, `useStyleGroups`, `useAssets`, and `Index.tsx`; dispatch Step 3 mechanical UI/hook tests to the lower-tier helper. **You'll know it worked when:** production ledger has the migration, `npm test` + real-hook single-request tests pass, and Groups search sends 1 `dam-search-ai` call with exact >200-group file totals and 0 `get_filter_counts` calls while sidebar is closed.
2. **Phase 2 (Steps 4–5):** Preload `getSearchMode()` (with rejection eviction), defer `user_roles` to admin actions only, combine `admin_config` reads, add successful-only `countDocs` cache, add cancellation-isolated in-flight coalescing to `query-embed-batch.ts`, and overlap `checkSpelling` + speculative embed *after* `product_code` & `catalog_format`; dispatch Step 5 unit tests to helper. **You'll know it worked when:** `npm test` passes, `Server-Timing` shows `auth` dropping from ~90 ms to ~28–35 ms p50, admin actions still return 403 for viewers, and style numbers still skip spelling and embed.
3. **Phase 3 (Steps 6–7):** Fold scoped picture anchor (computed BEFORE global top-2,000 cutoff) into `search_dam_documents`, pass mandatory 0/137 read-only parity gate before removing `anchor_rpc`, then add DB-side exact multi-variant union before paging/counting. **You'll know it worked when:** 0/137 parity diffs, `anchor_rpc` disappears from `Server-Timing`, and multi-variant eval queries match exact SQL union totals with 0 undercounts.
4. **Phase 4 (Steps 8–9):** Return `corrected` from `popsg-query-embedding` to remove PopSG's duplicate `action: "spelling"` call; benchmark direct indexed join to `public.style_guide_file_groups_snapshot` (NOT the view) inside `search_style_guide_library_v2`, and ship Step 9 ONLY if `EXPLAIN (ANALYZE, BUFFERS)` beats browser batching (<80 ms p50 / <250 ms p95). **You'll know it worked when:** PopSG makes 0 `action: "spelling"` calls, passes 65/65 guides & 65/65 files, and (if Go gate passes) makes 0 post-RPC `style_guide_file_groups` chunk queries.
5. **Phase 5 (Step 10):** Run two clean `"Search test set"` runs + live browser checks on `dam.designflow.app` and `sg.designflow.app`, capture post-change cold `EXPLAIN`, post signed before/after results on `#1430`, tick `- [x] live proof`, close `#1430`, mark plan `status: done`, and **delete this `HANDOFF.d/` file** in the closeout PR. **You'll know it worked when:** both clean runs score 137/137 PopDAM & 65/65 PopSG (0 errors), `#1430` is closed with live proof, and this file is removed from `main`.

---

## 7. Constraints and gotchas in force

- **Shared DB Gatekeeper:** All DDL in `popcre/shared-db` (claim-first, automatic preview → production promotion); never add files under `supabase/migrations/` or edit vendored `shared-db/` in `u2giants/popdam3`.
- **Canonical checkouts landing-only:** Always work in isolated worktrees from `origin/main`; never push directly to `main`; verify `git var GIT_COMMITTER_IDENT` (`Albert Hazan <u2giants@users.noreply.github.com>`).
- **Public-repo privacy:** Never include licensed names, product SKUs, customer names, or raw `SEARCH_EVAL_SET_V1` query strings in repo files, tests, commits, or public GitHub issues/PRs.
- **Deploy ordering:** Land backward-compatible DB migrations into production BEFORE deploying edge/frontend code calling the new parameters.
- **Clean benchmark windows:** Check for overlapping `shared-db` applies, PopSG crawls, `pg_cron` job 12 (`refresh-style-guide-library-default-snapshot`, not job 13 prewarm), other eval runs, or recent edge deploys within 5 minutes.
- **No holds >30 minutes** and **sign every GitHub post** via `ai-gh-signature`; compute human-facing EST times from system clock (`America/New_York`).

---

## 8. Access and environment

- **CLIs/MCPs:** `gh` (`u2giants` for `popdam3`, `popcre` for `shared-db`), `op` CLI / `1password` MCP (vault `vibe_coding`), Node.js (`npm`, `vitest`), Python 3 (`psycopg` v3), `ai-doc-health`, `ai-doc-safety`, `ai-task-gates`, `ai-pr-wait`.
- **Production URLs:** https://dam.designflow.app, https://sg.designflow.app, https://text-embed.designflow.app, Supabase project `qsllyeztdwjgirsysgai` (pooler `aws-0-us-east-1.pooler.supabase.com:5432`, user `postgres.qsllyeztdwjgirsysgai`, always set `default_transaction_read_only = on` for inspection).
- **1Password vault `vibe_coding` item titles (NEVER paste values):**
  - `DAM AI tester login - PopDAM (viewer, dam.designflow.app, production)`
  - `PopSG / PopDAM AI tester login (sg.designflow.app + dam.designflow.app)`
  - `Supabase DB Password - shared POP database`
  - `PopDAM text-embed SigLIP2 query key - dam-search-ai (edge-dev)`

---

## 9. Open questions and risks

- **Open technical verification (no owner decision needed):**
  1. Whether an indexed join to `public.style_guide_file_groups_snapshot` inside `search_style_guide_library_v2` beats browser chunking (<80 ms p50 / <250 ms p95). Governed by Step 9's mandatory `EXPLAIN (ANALYZE, BUFFERS)` Go/No-Go gate.
  2. Whether `expand_dam_search_queries` (77 ms p50 / 228 ms p95 warm) or `dam.search_group_vectors` (91 MB, 2.6× bloat) still warrant a separate follow-up issue after Phases 1–4 land — decided empirically in Step 10.
- **Key risks & mitigations:**
  - `Index.tsx:98` accidentally firing `get_filter_counts` when facets are omitted → explicitly guarded in Step 2 and pinned in Step 3 real-hook tests.
  - Inline anchor parity drift on scoped queries → mitigated by computing scoped max before global `LIMIT 2000` and requiring 0/137 read-only parity diffs before removing `anchor_rpc`.
  - Speculative embed breaking D5 style-number fast path or throwing 503 on gibberish → strictly gated after `product_code` + `catalog_format` and error-swallowed when `!spelling.meaningful`, pinned in Step 5 unit tests.

---

## Self-audit (mandatory `handoff-writer` gate)

1. **Is this `HANDOFF.d/` file comprehensive enough that a brand-new developer with no project knowledge and no session context could pick up where I left off and not skip a beat?**
   **Yes.** §1 defines PopDAM, PopSG, the shared DB boundary, and `SEARCH_EVAL_SET_V1`; §2 states the business goal and trigger; §3 gives exact baseline commit URLs, issue `#1430`, and measured production baselines; §5 cites exact GitHub URLs + line numbers for every bottleneck and test trap; §6 links directly to [docs/plans/issue-1430-semantic-search-speed.md](../docs/plans/issue-1430-semantic-search-speed.md) with phase-by-phase next actions and verification gates; §8 lists every tool, URL, pooler address, and 1Password item title. Zero machine-local paths appear anywhere in this file.
2. **Is it detailed enough that they could continue as well as I could right now, with all my session knowledge and the relevant background and purpose?**
   **Yes.** §4 captures all 9 rejected approaches and traps discovered during the Codex debate and live DB benchmarks (especially the measured 196/1,706 ms `style_guide_file_groups` view-join trap, the `Index.tsx:98` `useFilterCounts` trigger, the `library-mode-queries.test.tsx:20` mock blind spot, the `expand_dam_search_queries` 77 ms CTE finding, and the `apps/text-embed` `_prefix_cache` deepcopy mutation hazard).
3. **Is every single relevant detail needed for flawless execution included: background, goals, intended outcome, current state, failures, decisions, constraints, risks, exact next actions, and verification evidence?**
   **Yes.** Covered across §0 (settled rulings), §1–§2 (background & goals), §3 (commit/deploy state & baseline evidence), §4 (dead ends), §5 (root causes with GitHub URLs), §6 (ordered next actions with "you'll know it worked when" gates), §7 (constraints/traps), §8 (access/1Password locations), and §9 (open measurement gates & risks), paired with the full 13-section build spec in `docs/plans/issue-1430-semantic-search-speed.md`.
4. **If the owner read ONLY section 0, would he see every business decision I need from him — including the ones outside this workstream — and no technical approval at all?**
   **Yes (verified line-by-line across §1–§9).** Walked §1–§9 checking every sentence mentioning owner rulings, open questions, or gates:
   - §1–§2: factual description + settled business goal from Albert's Nov 26 prompt (no new decision).
   - §3–§5: verified current state, rejected technical options, and code findings (no owner decision).
   - §6–§8: technical execution steps, engineering constraints, and access (zero human approvals requested).
   - §9: two open technical measurement gates (Step 9 `EXPLAIN` Go/No-Go and Step 10 post-change follow-up evaluation) — both purely technical with objective criteria, neither needing a business ruling.
   Therefore §0 accurately states `"None — nothing in this workstream needs the owner"` and consolidates all 6 already-settled owner rulings with dates so no future session re-asks them.
