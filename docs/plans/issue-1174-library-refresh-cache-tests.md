---
summary: "Issue #1174 plan: prove end to end that the library Refresh and Retry buttons drop the cached ranked search lists and re-read fresh results, and move the style-group cache next to the asset cache. Read its STATUS first."
kind: plan
status: open
read-when: "implementing issue #1174, or changing PopDAM library Refresh, Retry or the ranked-list caches in useAssets / useStyleGroups"
---

# Plan: library Refresh is proven to re-read search results (u2giants/popdam3#1174)

Issue: [#1174](https://github.com/u2giants/popdam3/issues/1174) — advisory review of PR #1170 ("Refresh drops cached ranked relevance lists", fixes #839), merged Nov 19, 2026. The automatic fix PR #1177 was **closed without merging**, so nothing from it is on `main`.
Handoff that registers this plan: [HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-search-group-plans.md](../../HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-search-group-plans.md).
Written November 25, 2026, 3:58 PM EST on `al8960ofc` by Claude Code (worktree `modest-wu-eadf20`), against `origin/main` `787c20b8`. Planning only.

## STATUS — read before executing

| Step | State (Nov 25, 2026) | Evidence |
|---|---|---|
| 0. Findings that need no change | ✅ decided in planning | f1 (Retry also clears caches) is the intended behaviour; f2 (other tabs) is wrong — module variables live per browser tab, see §6 |
| 1. Preflight | ⬜ open | |
| 2. Page-level Refresh test asserts fresh backend reads | ⬜ open | |
| 3. Strengthen the cache-reset test (fresh rows, order) | ⬜ open | |
| 4. Move the style-group cache next to the asset cache | ⬜ open | |
| 5. Land, deploy, live proof, close | ⬜ open | |

**Start at Step 1.**

---

# Part 1 — Why

## 1. Ultimate goal

When a PopDAM user presses **Refresh** (or **Retry** after a search error) in the library, they see what the catalog holds right now, not a list remembered from up to 30 seconds ago — and the test suite proves it, so a future change cannot quietly break it.

**If a step conflicts with this goal, the goal wins — stop and flag it on #1174.**

## 2. What this application is

PopDAM ([u2giants/popdam3](https://github.com/u2giants/popdam3), branch `main`): internal artwork library at https://dam.designflow.app (React + Vite + React Query, served by Coolify; frontend deploys from `main` via `.github/workflows/publish-frontend.yml`). The library page is `src/pages/Index.tsx`. Relevance-sorted searches fetch a ranked id list once and cache it in memory for 30 s per query+filters, so paging does not repeat the search.

## 3. What triggered this work

The reviewer of PR #1170 asked for (f3) a Refresh-button test that proves the click reaches the backend with the caches cleared — the page test `src/test/library-mode-queries.test.tsx:19` mocks `invalidateSearchMode` with `vi.fn()` and never checks the ranked-list caches — and (f5) a stronger reset test: `src/test/relevance-page-fetch.test.ts:153-185` only counts id reads, so it would pass even if stale or empty rows came back. Optional (f4): `useAssets.ts` now imports a cache-clear function from `useStyleGroups.ts`; the cleaner home is `src/lib/full-text-search.ts` beside `setRankedListCacheEntry`. (f6, minor) no case for a refresh after a failed request.

## 4. Scope

In: tests for Refresh/Retry → fresh reads; the cache move (f4). Coordinate with [issue-1200-08 ranked search cache](issue-1200-08-ranked-search-cache.md), which reworks the same caches' keys: if it has landed, move the cache in the shape it left; if it is in progress, rebase after it. `src/test/relevance-page-fetch.test.ts:23` imports `clearStyleGroupRankedListCache` from `useStyleGroups`, so keep a re-export there. NOT in: changing cache lifetime (30 s), cross-tab sync, React Query settings, search ranking, the backend.

# Part 2 — What we already know

## 5. Current state (`main` `787c20b8`)

- `src/hooks/useAssets.ts:15-31`: `assetRankedListCache` (module `Map`), `clearAssetRankedListCache()`, `resetLibrarySearchCaches()` = `invalidateSearchMode()` + both cache clears; imports `clearStyleGroupRankedListCache` from `src/hooks/useStyleGroups.ts`.
- `src/pages/Index.tsx:167-175` `handleRefresh` calls `resetLibrarySearchCaches()` then invalidates six React Query keys; it is both the top bar's `onRefresh` and the error panel's `onRetry`.
- `src/lib/full-text-search.ts` holds `setRankedListCacheEntry` and the `RankedListCacheEntry` type.
- Tests: `src/test/library-mode-queries.test.tsx:43-75` (page flow with mocked `fetchHybridSearchPage`), `src/test/relevance-page-fetch.test.ts:153-185` (`installClient` fake PostgREST with request log).

## 6. Key findings

- Module-level variables are per browser tab (each tab loads its own copy of the JavaScript), so reviewer f2's "a refresh in one tab clears all tabs" is not true; no change.
- Retry clearing the caches (f1) is desired: a failed search should be re-run fresh.
- The page test mocks `fetchHybridSearchPage`, so it cannot see the ranked-list caches; the real cache path is in `useAssets`/`useStyleGroups` relevance sorting, exercised by `relevance-page-fetch.test.ts`'s fake client.

## 7. Rejected approaches

- **Assert on the private `Map`s directly:** tests internals, not behaviour; assert on backend requests and returned rows instead.
- **Drop the 30 s cache:** paging would repeat the full search; the cache is correct, only its reset needs proof.

## 8. Design decisions

- **LOCKED:** Refresh and Retry both reset all three caches (search mode, asset list, style-group list).
- **LOCKED:** the style-group cache and its clear function move to `src/lib/full-text-search.ts`; both hooks import from there; public names unchanged (`clearStyleGroupRankedListCache` re-exported from `useStyleGroups.ts` if anything else imports it — check with a search).
- **OPEN:** whether Step 2 renders the real `useStyleGroups` path or spies on `resetLibrarySearchCaches`. Criterion: the test must fail if `handleRefresh` stops clearing the ranked caches; prefer the real path with the fake client if the page renders with it, else spy on the exported `resetLibrarySearchCaches` and keep Step 3 as the behavioural proof.

# Part 3 — How to build it

## 9. Steps

**Step 1 — Preflight.** `helper-ok` — stop-and-ask if `npm run test` is red on `main`. Worktree from `origin/main`, `npm ci`, `npm run test`. Gate: suite green.

**Step 2 — Page-level Refresh/Retry test.** `lead-only` (the §8 OPEN choice).
- In `src/test/library-mode-queries.test.tsx` add "Refresh and Retry clear the ranked search caches before re-reading": click Refresh → the cache reset ran and the search was called again with the same query; after a mocked failure, Retry does the same.
- Gate: the test passes, and fails when `resetLibrarySearchCaches()` is removed from `handleRefresh` (try it locally, then restore).

**Step 3 — Stronger reset test.** `helper-ok` — stop-and-ask if `installClient` cannot change rows between reads.
- In `relevance-page-fetch.test.ts:153-185`: after `resetLibrarySearchCaches()`, change the fake data (e.g. full-text returns `a2,a1`; rows include `a2`), then assert the full-text RPC request count went up by one per hook, the returned page ids are `["a2","a1"]` in that order, and the row read requested those ids. Add "a refresh after a failed ranked read re-reads instead of reusing the failure".
- Gate: both tests pass.

**Step 4 — Move the style-group cache.** `helper-ok` — stop-and-ask if a third importer appears.
- Move the style-group ranked-list `Map` and `clearStyleGroupRankedListCache` from `src/hooks/useStyleGroups.ts` to `src/lib/full-text-search.ts`; update imports in both hooks; remove `useAssets.ts`'s import from `useStyleGroups`.
- Gate: `npm run test` and `npm run build` green; `grep` shows `useAssets.ts` no longer imports `@/hooks/useStyleGroups`.

**Step 5 — Land and prove.** `lead-only`.
- PR, required checks green, merge (AI merges; reviews advisory). Confirm `publish-frontend.yml` built the merge SHA and https://dam.designflow.app serves it (the stale-site check in `docs/deployment.md`).
- Live: signed in as a viewer, search with relevance sort, press Refresh: DevTools Network shows a new search request (not served from memory). Post SHA, run id and the observation on #1174; close it.

## 10. Tests required

New: "Refresh and Retry clear the ranked search caches before re-reading" (`library-mode-queries.test.tsx`); "a refresh after a failed ranked read re-reads instead of reusing the failure" (`relevance-page-fetch.test.ts`). Strengthened: "drops the cached ranked lists so a refresh re-reads matches (#839)". Must stay green: `npm run test`, `npm run build`.

## 11. Constraints

Feature branch + PR; never push to protected `main`; AI merges after required checks. Frontend only; no database or edge-function change. Visual/live check required for UI behaviour.

## 12. Access

`gh` as `u2giants`. Viewer login: 1Password vault `vibe_coding`, PopDAM test viewer item (never paste values). Local: `npm ci`, `npm run test`, `npm run build`, `npm run dev`.

# Part 4 — Landing it

## 13. Definition of done, risks

Done: Steps 1–5 ✅ with artifacts; merged; checks green; deployed SHA verified on the site; live Refresh observation on #1174; issue closed; plan `status: done`. Risk: the cache move breaks an import — caught by build and tests; rollback by revert. Open: §8 OPEN only.

## Self-audit (Mode A gate)

1. *Executable without questions?* Yes — §5 lines, §9 edits with gates, §12 access.
2. *All background and ruled-out paths?* Yes — §6 explains why f1/f2 need no change, §7 rejected options, the closed fix PR #1177 is named.
3. *Goal clear?* Yes — §1: Refresh shows current data, proven by tests.

## Lead launch prompt

```
Read docs/plans/issue-1174-library-refresh-cache-tests.md in u2giants/popdam3 (STATUS first), then AGENTS.md.
You are the lead. Do Steps 2 and 5 yourself. Hand Steps 1, 3 and 4 to your helper in order and verify each gate yourself.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges, pushes or GitHub posts; bring back any stop-and-ask trigger; if stuck 30 minutes, the lead takes the step back.
Lead checks: npm run test and npm run build green; the new tests fail when the reset is removed; CI green; deployed SHA on dam.designflow.app; live Refresh check.
Delegation sheet: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
```
