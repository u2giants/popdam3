---
summary: Issue #470 plan: Audit backlog — efficiency. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-470
---

# Plan: Audit backlog — efficiency (u2giants/popdam3#470)
Issue: https://github.com/u2giants/popdam3/issues/470
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

Source: [`docs/audit-2026-10-21.md`](../audit-2026-10-21.md) → "Backlog →
Efficiency". The issue's 2026-11-04 comment ranks: relevance fetch, asset
count, filter options, tagging prompt, then the rest; heartbeat prune rated
minor; sell-through export "now page-side". Every item below was re-verified
against this worktree (HEAD `01fcfc34`; `origin/main` `4409e2d3` differs only
in tagging files unrelated to these lines, except `ai-tagging-shared.ts` —
re-check its line numbers after rebasing).

## STATUS — 2026-11-05

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Relevance-sorted search: rank server-side, fetch only the page | open with search owner | Reserved relevance paths; do not overlap the coordinator's search delivery |
| 2 | `useStyleGroupAssetCount`: one aggregate call instead of paging 1000 rows | old source held; replacement prepared/caller open | Old #5630/version20261105042549 must never apply; #5631 stays open. Replacement #5647 current forward version 20261105074303 / head 1c6c9a53, fresh full DB CI 41989521874 passed with actual order/populated-filter fixtures; prior unapplied reservation 20261105061837 and head 40487c693 / full DB CI41981017768 success retained as history. Retirement source prepared; actual delivered-producer candidate patch/rebase, exact-hash atomic-runner opt-in and native production/live delivery remain |
| 3 | `get-filter-options`: one grouped count query instead of N+M counts | old source held; replacement prepared/caller open | Same open #5628 replacement; preserve current nondeleted taxonomy scope |
| 4 | Tagging prompt: cache static reads; avoid redundant generation lookup | lookup deployed; cache prepared/held | App #764 lookup, #782 cache head 59f8cbc9; 518 worker tests; live read-only prompt parity, repeated static reads 6→3, deployment pending |
| 5 | Order-list status counts: one RPC/grouped count | old source held; replacement prepared/caller open | Same open #5628 replacement; five-status/NULL and populated access/filter fixtures in held #5644 |
| 6 | Sell-through export: parallel, de-duplicated thumbnail fetches | live proof recorded | App #764/#770: five rows/two unique thumbnail URLs cause two fetches and five workbook image placements |
| 7 | Grids: memoize cards; bridge scanner: drop redundant `lstat` | cards deployed; scanner held | All three card layouts preserve selection live; draft #766 must wait for verified full scan completion |
| 8 | Heartbeat `render_queue` prune: once per hour | deployed; direct live efficiency proof open | App #764/#773; stateful repeated-heartbeat harness passes; hourly per warm instance with retry on failure |
| 9 | Audit doc + STATUS updated; #470 closed with before/after numbers | open | Do not close until every outstanding caller, search, machine/deployment and live proof is finished |

Next: health #5623 is merged but still awaits its four production receipts; canonical #5660 repairs its atomic release route under VA policy custody. Then the ordered train continues through producer/character delivery and Step3 before Styles 74249, aggregate 74303 and browse 74314. Each later singleton requires an exact-hash atomic-runner opt-in; actual health-release evidence disproved the normal-CLI atomicity assumption. Hard-retire unapplied 20261105042549 under the new producer; #5644 alone cannot resolve #5631. Replacement live parity/access proof precedes dependent callers. Cache #782 remains held for the original grouping job’s terminal result and resumed full tagging. Canonical instruction/catalog cache freshness is up to five minutes; per-asset context stays fresh. Never stop or reset the full tagging run.

---

## 1. The ultimate goal

PopDAM's slowest everyday screens get fast without changing what they show:
searching the library with "relevance" sort returns a page in one round-trip
instead of pulling 500 rows; the file-count badge on a filtered library stops
walking the whole table; the licensor/property filter list loads in one
query; tagging a picture costs one or two database reads instead of eight
and one OpenRouter call instead of two. Nothing about results, counts, or
tags changes — only how much work produces them.

**If a step conflicts with this goal, the goal wins — stop and flag it.** A
speed-up that changes a count, a ranking, or a tag is a bug, not an
optimization.

## 2. What this application is

PopDAM (`github.com/u2giants/popdam3`, `u2giants`, branch `main`): internal
Digital Asset Manager; React + Vite web app `src/` at
https://dam.designflow.app (Coolify from GHCR); Railway worker
`apps/worker/` (Node, auto-deploys on push to `main`); Supabase edge
functions `supabase/functions/**` (Deno; `deploy-supabase.yml`; project
`qsllyeztdwjgirsysgai`); bridge agent `apps/bridge-agent/` (Docker on NAS
`edgesynology1` via `publish-bridge-agent.yml`). Database schema belongs to
`popcre/shared-db` (`/worksp/shared-db`; read-only mirror in `shared-db/`).
CI: `.github/workflows/ci.yml` (root lint/typecheck/vitest, worker
build+test, windows-agent test, build).

## 3. What triggered this work

The 2026-10-21 audit's efficiency backlog; #470 tracks it. Re-verified
2026-11-04 by a prior session (issue comment) and again here with line
evidence (§5). Users feel it as slow relevance searches and a filter panel
that takes seconds to open.

## 4. Scope

**In:** the nine items above with measurements before/after.
**NOT in this plan:** correctness items (#469 plan), security items, dead
code/duplication, the hybrid-search ranking itself (`src/lib/dam-search.ts`),
any UI redesign, any change to what a count or search returns, PopSG search
paths (`PopSGLibraryPage`), and schema work beyond the two RPCs named in
steps 1 and 2 (which go through shared-db).

## 5. Current state — finding by finding (verified 2026-11-04)

**1. Relevance search fetches 500 rows then slices client-side** — *present.*
`src/hooks/useAssets.ts:11` `FULL_TEXT_SEARCH_LIMIT = 500`; `:118-124`
`fetchSearchIds(..., FULL_TEXT_SEARCH_LIMIT)` gets up to 500 ranked ids;
`:422-431` when `useRelevance` the query gets **no** `.order()`/`.range()`,
so `applyFilters` (`.in("id", ids)`) returns all ≤500 full rows; `:456-458`
`sortByRank(...).slice(from, to+1)` keeps one page. Same in
`src/hooks/useStyleGroups.ts:54`, `:286-296`, `:313`. The hybrid path
(`useAssets.ts:383-399`) already fetches only the page's ids
(`fetchHybridSearchPage({limit, offset})`) — the keyword path does not.

**2. `useStyleGroupAssetCount` pages the table to sum a column** — *present.*
`src/hooks/useStyleGroups.ts:360-392`: loop of
`.select("asset_count").order("id").range(from, from+999)` summing in JS;
used by `src/pages/Index.tsx:158` whenever groups mode has filters. Existing
RPCs in shared-db that aggregate: `public.get_filter_counts`,
`public.get_effective_filter_counts` (`shared-db/supabase/migrations/20260830110517_popdam_effective_asset_filters.sql`,
`20260901142825_popdam_effective_count_performance.sql`) — neither returns a
sum of `style_groups.asset_count` for an arbitrary filter set (checked by
grep for `asset_count` in their bodies: only used as a predicate).

**3. `get-filter-options` runs one count per licensor and per property** —
*present.* `supabase/functions/_shared/admin-handlers/agent-handlers.ts:1354-1400`:
`for (const lic of licensors)` → `assets.select("id",{count:"exact",head:true}).eq("licensor_id")`,
then the same per property. With ~40 licensors and hundreds of properties
that is hundreds of sequential count queries per open of the filter panel.
`public.get_filter_counts` exists (shared-db) and already returns per-licensor
and per-property counts for the library filter UI — check its signature
before writing a new one.

**4. Tagging prompt: ~8 reads per asset; OpenRouter doubled** — *present.*
`apps/worker/src/handlers/ai-tagging-shared.ts:320-400` `buildImageTaggingPrompt`:
`admin_config` TAGGING_INSTRUCTIONS (`:327-331`), licensor by SKU code
(`:305`), `property_character_associations` (`:345`),
`property_character_source_edge` (`:356`), `property` (`:366`), `character`
by licensor (`:373`), canonical ERP item (`:397+`), plus more below. None
cached; `TAGGING_INSTRUCTIONS` and the per-property character lists are the
same for every asset in a run. `apps/worker/src/openrouter.ts:453-477`
`enrichProviderInfo` does a GET `/generation?id=` **after every chat
completion** (`:505`), i.e. 2 HTTP calls per asset, only to fill provider /
endpoint / upstream fields already mostly present in response headers
(`collectProviderInfo`).

**5. Order-list status counts: four sequential counts** — *present but
deliberate.* `src/hooks/useOrderList.ts:463-474` runs four `count:"exact"`
queries serially; the comment says concurrency previously contended with
row requests. Invalidated after every save (`:563`). The fix is one query,
not four concurrent ones.

**6. Sell-through export fetches thumbnails serially and once per row** —
*present, page-side.* `src/lib/sell-through-export.ts:317-335`:
`for (let i …) await fetchThumbnail(previewRow.match.thumbnailUrl)` — serial,
and the same SKU appearing on several rows is fetched each time. The fetch
goes through `admin-api fetch-thumbnail-by-url` (`src/pages/SellThroughExportPage.tsx:107-114`).

**7a. Grids render un-memoized cards** — *present.* `src/components/library/AssetGrid.tsx:95`
`function AssetCard(...)` plain function, mapped at `:344`;
`StyleGroupGrid.tsx:619` maps groups to inline cards. Page size can be 1000.
**7b. Bridge scanner `lstat` + `Dirent`** — *present, small.*
`apps/bridge-agent/src/scanner.ts:171-172` `lstat(fullPath)` for every
entry only to call `isSymbolicLink()`; `readdir(..., {withFileTypes:true})`
entries already answer that (`entry.isSymbolicLink()`), and `entry.isDirectory()`
is already used at `:178`. (The separate `stat` the audit mentioned is further
down for files; keep it — size/mtime are needed.)

**8. Heartbeat prunes `render_queue` every call** — *present, rated minor.*
`supabase/functions/agent-api/index.ts:385-395`: a `delete … lt(created_at,
now-3d)` inside every heartbeat (agents heartbeat every 5–30 s).

## 6. Key findings and root causes

- Items 1 and 2 cannot be fixed well client-side: PostgREST cannot sort by
  "position in this id list", and summing a column needs an aggregate. Both
  need an RPC in shared-db (claim-first; this repo never ships migrations).
- Item 3 does **not** need a new RPC if `public.get_filter_counts` already
  returns licensor/property asset counts — read its body first
  (`grep -n "get_filter_counts" -A60 shared-db/supabase/migrations/*.sql`).
  If it does, the handler becomes one RPC call.
- Item 4's reads are per-asset because the function is called per asset
  from `ai-tagging.ts` and `ai-tag-bakeoff.ts`; a run-scoped cache keyed by
  `property_id`/`licensor_id` with a TTL of the run (or 5 min) removes most
  of them. The existing `options.client` injection (`:321`) makes this
  testable.
- `enrichProviderInfo` is skipped automatically when `generationId` is
  missing (`:454`); the cheap fix is to call it only when the headers left
  `provider`/`endpoint`/`model` **all** null, or behind a config flag used by
  the bakeoff only.

## 7. Approaches considered and REJECTED

- **Raise `FULL_TEXT_SEARCH_LIMIT` to the page size** — rejected: the ranked
  id list is what defines relevance order; truncating it to one page changes
  which rows appear on page 2.
- **Client-side cache of the 500-row result across pages** — rejected: still
  fetches 500 rows on the first page and the filters make the key explode.
- **Count via `count:"exact"` on `style_groups`** for item 2 — rejected: the
  badge is a **sum of `asset_count`**, not a row count.
- **Parallelize the per-licensor counts** (item 3) — rejected: moves the
  load from latency to DB concurrency; one grouped query is both cheaper and
  faster.
- **Remove `enrichProviderInfo` entirely** — rejected: the bakeoff reports
  upstream provider/endpoint; keep it where that report needs it.
- **Memoize grids with `useMemo` on the array** — rejected: the cards
  re-render because props are new closures; `React.memo` on the card with
  stable callbacks is the fix.

## 8. Design decisions

LOCKED:
- 2026-11-04: steps 1 and 2 get RPCs in shared-db (`search_dam_ranked_page`
  returning the page's rows ordered by rank; `sum_style_group_asset_count`
  taking the same filter payload as `filter_effective_assets`/
  `get_effective_filter_counts`). Names are proposals; shared-db's reviewer
  may rename — the plan's tests reference the TS wrapper, not the SQL name.
- 2026-11-04: item 5 becomes **one** RPC or one `select … group by` done
  through an existing RPC if shared-db has one; four concurrent counts are
  explicitly not the fix (comment at `useOrderList.ts:464-465`).
- 2026-11-04: item 8 — prune at most once per hour per function instance
  (module-level `lastPruneAt`), not per heartbeat; or move it to the nightly
  job if one exists (`grep -rn "pg_cron\|cron" shared-db/supabase/migrations`).
- 2026-11-04: every step records a before/after number in the PR body:
  network request count or DB time from the Supabase MCP `get_advisors` /
  `query_logs`, or the browser Network tab for client steps.

OPEN:
- Whether step 1's RPC also serves PopSG (`sg.designflow.app`) — default no.
- Thumbnail concurrency for step 6 — default 4.

## 9. The plan

**Step 1 — relevance page server-side.**
1a. shared-db (claim-first on the existing PopDAM search issue; `shared-db-change`
skill): RPC that takes `p_ids uuid[]` (ranked, ≤500), `p_from int`,
`p_to int`, `p_document_type text` and returns rows of `assets` or
`style_groups` in id-array order for that slice (`array_position(p_ids, id)`).
Same `security` posture as `search_dam_document_counts`
(`shared-db/supabase/migrations/20260713221518_dam_hybrid_search_foundation.sql:837`).
1b. `src/hooks/useAssets.ts:422-458`: when `useRelevance`, call the RPC with
the ids slice instead of the unbounded select; keep the exact count from
`buildAssetCountQuery`. Same in `useStyleGroups.ts:286-313`. `sortByRank`
stays for the hybrid path.
Gate: `src/test/library-relevance-page.test.ts` (new): with 1 200 fake ids
and page 2 of 50, the query asks for exactly ids[50..99] and no `slice`;
existing `dam-search` tests green. Live: Network tab on a relevance search
shows one page-sized response (≤ 50 rows) instead of ~500.

**Step 2 — asset-count sum.** 2a. shared-db RPC
`sum_style_group_asset_count(p_filters jsonb, p_min_date timestamptz)`
reusing the filter builder of `get_effective_filter_counts`. 2b.
`src/hooks/useStyleGroups.ts:360-392` → single `supabase.rpc(...)`; delete
the loop. Existing tests `src/test/library-group-count.test.tsx` and
`dam-search-denial.test.ts` updated to stub the RPC.
Gate: tests green; live: Network tab shows one call where there were N/1000.

**Step 3 — filter options.** Read `get_filter_counts`; if it returns
licensor/property counts, `handleGetFilterOptions` (`agent-handlers.ts:1354-1400`)
becomes: fetch licensors + properties (two selects, as now) and one RPC call,
then join in memory; else ask shared-db for a grouped-count RPC
(`select licensor_id, count(*) … group by`). Keep the response shape
(`licensors[], properties[]` with `asset_count`, filtered `> 0`).
Gate: `supabase/functions/_shared/admin-handlers/filter-options.test.ts`
(new, Deno; stub client) asserts ≤ 3 queries; `deno test`. Live: filter panel
opens < 1 s (measure with the Network tab, note before/after).

**Step 4 — tagging prompt.** In `ai-tagging-shared.ts`: add a module-level
`PromptCache` (Map keyed by `TAGGING_INSTRUCTIONS`, `licensor:<id>`,
`property:<id>` → value + `expiresAt`, TTL 5 min; `options.cache` override
for tests; `clearPromptCache()` exported and called at run start in
`ai-tagging.ts` and `ai-tag-bakeoff.ts`). Wrap the reads at `:327`, `:345`,
`:356`, `:366`, `:373`. Do **not** cache the per-asset ERP/description reads
(`:397+`). In `openrouter.ts:505`, call `enrichProviderInfo` only when
`collectProviderInfo` left `provider` **and** `endpoint` null, or when the
caller passes `{ enrichProvider: true }` (bakeoff does).
Gate: `apps/worker/src/handlers/ai-tagging-shared.test.ts` (new or extend
`ai-tagging-scope.test.ts`): `prompt reads static config once per run for
many assets` (stub client counts `.from()` calls: 2 assets same property → 1
read each for config/associations/edges); `apps/worker/src/openrouter.test.ts`:
`generation lookup is skipped when headers carry provider info`.

**Step 5 — order-list counts.** `src/hooks/useOrderList.ts:463-474`: replace
the four counts with one grouped query — if shared-db has an RPC over
`order_list` returning `(status_bucket, n)`, use it; else (no schema change
needed) one `select master_data_match_status, item_id` is too wide — so
**ask shared-db for the RPC** (claim-first; tiny). Keep the returned shape.
Gate: `src/test/order-list-status-counts.test.ts` (new): one call, same four
numbers from a stubbed `(bucket,n)` set.

**Step 6 — sell-through thumbnails.** `src/lib/sell-through-export.ts:317-335`:
build `uniqueUrls = new Set(rows.map(r => r.match?.thumbnailUrl))`, fetch
with a concurrency-4 pool (`Promise` queue; no new dependency), store
`url → imageId`, then place images per row from the map.
Gate: extend `src/test/sell-through-export.test.ts`: `thumbnails are
fetched once per unique url and placed on every row` (count fetch calls:
5 rows, 2 unique urls → 2 fetches, 5 placements).

**Step 7 — grids and scanner.** `AssetGrid.tsx:95` → `const AssetCard =
memo(function AssetCard(...))` with `onSelect`/`onOpenDetail` wrapped in
`useCallback` in the parent (`:320`); same for the group card in
`StyleGroupGrid.tsx:619` (extract to `StyleGroupCard` if inline). Scanner:
`apps/bridge-agent/src/scanner.ts:170-176` → `if (entry.isSymbolicLink()) continue;`
and remove the `lstat` try/catch (keep the `files_stat_failed` counter for
the later `stat`). Keep `lstat` import only if still used elsewhere.
Gate: React Profiler (dev) shows cards not re-rendering on selection change
of another card; `apps/bridge-agent` tests green (`npm test --prefix
apps/bridge-agent` if present; else `npm run build --prefix apps/bridge-agent`).

**Step 8 — heartbeat prune.** `agent-api/index.ts:385-395`: module-level
`let lastPruneAt = 0`; run the delete only if `Date.now() - lastPruneAt >
3_600_000`. Gate: `supabase/functions/_shared/heartbeat-*.test.ts` pattern —
add `render_queue prune runs at most hourly` with a stubbed clock.

**Step 9 — close.** Update `docs/audit-2026-10-21.md` efficiency lines
(strike + PR number), this STATUS with artifacts, comment on #470 with
before/after numbers per step, sign `$AI_GH_SIGNATURE`, close.

Parallelism: 1a/2a/5 (shared-db) first as one claim; 3, 4, 6, 7, 8 are
independent app PRs. Context cut after the shared-db claim lands.

### Adversarial-cases table (trust boundary: filter payloads and id lists sent to RPCs; external thumbnail URLs)

| Input | Hostile case | Required behavior | Test |
|---|---|---|---|
| ranked id list | 0 ids | empty page, count 0, no RPC error | `relevance page with no ids returns empty` |
| ranked id list | 501 ids / non-uuid | wrapper truncates to limit; RPC rejects non-uuid with a surfaced error | `relevance page rejects non-uuid ids` |
| page range | `from > ids.length` | empty page, count unchanged | `relevance page past the end is empty` |
| filter payload | unknown filter key | RPC ignores it (same as `filter_effective_assets`) | shared-db test in its own repo |
| thumbnail url | same url 50 times | one fetch | `thumbnails are fetched once per unique url …` |
| thumbnail url | one fetch fails | other rows still get images; failure recorded once per url | `thumbnail failure is recorded per url` |
| prompt cache | property changes mid-run | TTL ≤ 5 min and `clearPromptCache()` at run start | `prompt cache expires` |
| heartbeat | 1 000 heartbeats in an hour | 1 prune | `render_queue prune runs at most hourly` |

## 10. Tests required

Named in each step's gate: `library-relevance-page.test.ts` (3 tests),
`library-group-count.test.tsx` (updated), `filter-options.test.ts` (Deno),
`ai-tagging-shared.test.ts` (`prompt reads static config once per run for
many assets`, `prompt cache expires`), `openrouter.test.ts` (`generation
lookup is skipped when headers carry provider info`),
`order-list-status-counts.test.ts`, `sell-through-export.test.ts` (2 new),
`heartbeat` prune test. Existing: root `npm test`, `typecheck`, `lint`,
`build`; worker `npm test --prefix apps/worker`; Deno tests run locally and
pasted into the PR body (CI does not run Deno tests).

## 11. Constraints, standing rules, gotchas

- Every RPC lives in `popcre/shared-db` (`/worksp/shared-db`), claim-first on
  the existing issue, `shared-db-change` + `supabase-postgres-best-practices`
  skills; promotion to production is automatic — never a manual SQL run. App
  PRs that depend on an RPC must degrade safely until it is live (feature
  check: if the RPC returns `42883` undefined-function, fall back to the
  current code path and log once) — no silent breakage.
- Production DB is read-only by default; measure with the Supabase MCP
  (`query_logs`, `get_advisors`) and the browser Network tab, never by
  running write statements.
- Never change what a count/search/tag returns; tests assert equality with
  the old path on fixtures.
- Branch + PR per step; AI merges; `ai-pr-wait` in the background.
- `ai-tagging-shared.ts` is under active change on `main` (#680 series) —
  rebase before editing and re-grep line numbers.
- Sign GitHub posts with `$AI_GH_SIGNATURE`; EST for humans.

## 12. Access and environment

- hetz; `/worksp/popdam` landing-only → worktree per PR; `/worksp/shared-db`
  likewise.
- `gh` as `u2giants`; `ai-pr-wait`, `ai-task-gates` on PATH.
- Supabase MCP → project `qsllyeztdwjgirsysgai` (read-only use).
- Tester login: 1Password `vibe_coding` → "DAM AI tester login - PopDAM
  (designer, dam.designflow.app, production)".
- Local: `npm ci && npm run dev` (8080); worker `npm ci --prefix apps/worker`;
  Deno for edge tests (`deno --version` to confirm it is installed; if not,
  `curl -fsSL https://deno.land/install.sh | sh` into `$HOME`).

## 13. Definition of done, risks, open questions

Done: each STATUS row cites a merge SHA, test names, and a before/after
measurement; shared-db RPCs promoted; `docs/audit-2026-10-21.md` updated;
#470 closed with the numbers.

Risks: (a) shared-db claim queue delays steps 1/2/5 — do 3, 4, 6, 7, 8
meanwhile; (b) `get_filter_counts` semantics may differ from the admin
handler's (deleted assets, visibility date) — compare outputs on production
read-only before switching; (c) memoized cards can go stale if a prop is
mutated in place — cards receive new objects from TanStack, fine.
Rollback: revert per PR; RPCs are additive.

Open: §8 OPEN items.

## Self-audit

1. **Fresh session, no questions?** Yes — §5 pins every finding to lines and
   state, §9 names files, RPC shapes, fallbacks and gates, §12 the tools.
2. **All background and rejections?** Yes — §6 explains why 1/2 need RPCs
   and 3 may not, §7 lists six rejected shortcuts, §8 locks the measurement
   rule and the "one query, not four concurrent" decision with its source.
3. **Goal clear enough to steer?** Yes — §1 states "same results, less work"
   and that any change in output is a bug.

Execution: OpenRouter known provider/endpoint metadata now avoids its redundant generation lookup (13 OpenRouter tests pass). Prompt cache waits Track T1 release of ai-tagging-shared.ts. Aggregate prerequisite popcre/shared-db#5630, claim #5628, is in progress. Relevance paths are reserved for the coordinator’s V-B child; do not close #470 until that proof arrives.
