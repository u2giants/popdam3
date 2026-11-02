---
issue: 658
status: OPEN
owner: zcode sess_8ac8b36e-1dd7-4c33-939a-98e95b34aad2 (branch feat/search-result-nav, merged & deleted)
---

# Google-Sheets-style Find in OrderList + Master Data — live proof outstanding

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**None — nothing in this workstream needs the owner.** The one human step is
Albert's team simply trying the feature in the app (acceptance, not a decision —
it is the live-proof checkbox on issue #658, not an ask).

## 1. What this application is

PopDAM (u2giants/popdam3) is POP's internal digital-asset manager (React/Vite +
AG Grid, Supabase backend, Coolify on the VPS `hetz`, live at
https://dam.designflow.app). Two of its pages have a "Find" box: OrderList
(/orders) and Master Data (styles page). Before this session Find jumped only to
the most recent match.

## 2. What we set out to do this session, and why

Albert asked (2026-11-02): make search in Master Data and OrderList work like
Google Sheets — show the total number of results and jump directly to each one
with arrows, instead of scrolling through every SKU.

## 3. Current state — what is true right now

Checked 2026-11-02 ~20:00Z (3:00 PM EST):

- **Shipped and LIVE.** PR #659 merged (merge commit https://github.com/u2giants/popdam3/pull/659, `0348c973`); `Publish Frontend Image` succeeded and Coolify deployed it (container `qxj8a0j3tpa9lq4q5rs6pezy-20261102T184905`). Verified in the served bundle: `assets/GridFindStepper-B05oU9oj.js` (contains "Previous match"/"Next match") is deployed and imported by the live OrdersPage/StylesPage chunks.
- UX: next to each Find box a "3 of 12" counter with up/down arrows; Enter = next, Shift+Enter = previous (both wrap), Esc clears. Master Data outlines the current match (other matches keep the old amber highlight). OrderList keeps its existing highlight + scroll.
- Code map (all on main): shared component https://github.com/u2giants/popdam3/blob/main/src/components/grid/GridFindStepper.tsx ; OrderList wiring in `src/pages/OrdersPage.tsx` + `src/hooks/useOrderList.ts` (`findOrderListRow` sends `p_occurrence`, reads `match_count`); Master Data wiring in `src/pages/StylesPage.tsx`; occurrence navigation helper `src/lib/style-tracker-find-navigation.ts`; `vitest.config.ts` now resolves the jsdom setup file absolutely (worktree-safe).
- Tests: `src/pages/OrdersPage.integration.test.tsx` (12 pass, incl. counter + arrow/Enter wrap + zero-match), `src/lib/style-tracker-find-navigation.test.tsx` (2), `src/test/order-list.test.ts` (42). Full suite 799 pass; `order-list-grid`/`erp-review-queue` flake only under full-suite parallel load (pass isolated, also on clean main — AG Grid sized-host quirk).
- **OrderList currently uses the deployment-skew fallback** (it counts matches itself) because the shared-db RPC extension (popcre/shared-db PR #5469, migration `20261102180759`) is on preview but NOT yet in production — it is queued behind unrelated failing promotions there. When it lands, the app switches to the single-RPC path automatically; no code change or deploy needed. Details + next actions: https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-02T2000Z-hetz-zcode-orderlist-find-occurrence.md (merge of that handoff PR pending; if the link 404s, find the file in HANDOFF.d/ of shared-db or its docs-only PR).
- Issue #658 open with `- [ ] live proof` and two progress comments with evidence.
- No sub-agents dispatched this session.

## 4. Everything we tried that did NOT work

- **Running vitest in a git worktree silently bound the jsdom setup file to the CANONICAL checkout** (`Failed to load url /worksp/popdam/src/test/setup.ts`): the relative `setupFiles` path in `vitest.config.ts` resolved outside the worktree, and an empty/symlinked worktree `node_modules` made it worse (duplicate React copies → "Invalid hook call"). Fixes that worked: `setupFiles: [path.resolve(__dirname, "src/test/setup.ts")]` + symlink `node_modules` to the canonical one (the established pattern in this machine's other worktrees). `cp -al` of node_modules fails on `.bin` symlinks — don't retry it.
- **Grepping the live bundle for "Previous match" in the page chunk showed 0** and briefly looked like a failed deploy: Vite had code-split the stepper into a shared `GridFindStepper-*.js` chunk. Verify feature strings across ALL chunks, not just the page chunk.
- Full-suite parallel runs flake two AG Grid suites (see §3) — rerun those files in isolation before believing a failure.

## 5. Root causes and key findings

- Master Data loads ALL rows progressively in the background, so client-side match counting converges to the sheet total; the counter shows "…" while `hasNextPage`. This matches the documented "Find covers loaded rows" contract in `docs/MASTER_DATA.md`.
- OrderList Find must stay server-side (infinite model, 24k rows); the RPC now does occurrence + count in one call. The app's legacy fallback also counts (via PostgREST head-count), so the UX is identical either way — only the number of requests differs.
- `getRowStyle` in StylesPage now uses a memoized match-id Set instead of `JSON.stringify` per row per render.

## 6. Exact next steps

1. A logged-in user (Albert's team): on https://dam.designflow.app search a known SKU in OrderList and in Master Data; step with the arrows/Enter/Shift+Enter; confirm the "N of M" counter, wrap-around, and Master Data's current-match outline. Gate: counter shows real totals and every arrow press scrolls to a different matching row.
2. After the shared-db migration `20261102180759` reaches production (see the shared-db handoff file in §3), confirm the app uses the RPC path (browser network tab: one `find_dam_order_list_row` call with `p_occurrence` per jump; console has no fallback warning).
3. Comment the proof on #658, tick `- [ ] live proof`, close #658, and delete this handoff file in the same change (successor rule).

## 7. Constraints and gotchas in force

- App changes go through feature branch → PR → checks → merge (never push to main directly); frontend deploys only on `src/**` changes via `Publish Frontend Image` + Coolify.
- Green CI ≠ live site: verify the live chunks, not the workflow conclusion alone.
- The AG Grid license warning is accepted (owner instruction 2026-10-11) — ignore it.
- Keep canonical checkouts landing-only; use worktrees (see §4 for the vitest worktree fix).

## 8. Access and environment

- gh CLI authenticated (u2giants). Live verification done over public HTTPS. No credentials appeared this session; secrets sweep: swept, nothing new.
- Docs pass: `docs/ORDER_LIST.md` and `docs/MASTER_DATA.md` Find sections were updated in the merged PR; nothing else is stale.

## 9. Open questions and risks

- None on the app side. The only dependency is the shared-db production promotion timing (external, no user impact while waiting).
- Facts that may be stale: "migration not yet in production" and the live chunk names were true at 2026-11-02T20:00Z.
