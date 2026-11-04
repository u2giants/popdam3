# Plan: Review finding: u2giants/popdam3#659 Google-Sheets-style Find stepping in OrderList and Master Data (#658) (u2giants/popdam3#660)
Issue: https://github.com/u2giants/popdam3/issues/660
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

Predecessor handoff for the feature itself: [`HANDOFF.d/2026-11-02T2005Z-hetz-zcode-grid-find-stepper-live-proof.md`](../../HANDOFF.d/2026-11-02T2005Z-hetz-zcode-grid-find-stepper-live-proof.md) (feature #658, closed; PR #659 merged as `0348c973`).

## STATUS

| Step | State | Evidence |
|---|---|---|
| 0. Confirm finding 1 (RPC contract) is live in production | ⬜ open | — (planner verified 2026-11-04 that `20261102180759` is in production `schema_migrations`; re-verify) |
| 1. Guard the debounced Find against `findGeneration` | ⬜ open | — |
| 2. Regression test: a late first-find response never overrides a step | ⬜ open | — |
| 3. PR, CI, merge, frontend deploy verified | ⬜ open | — |
| 4. Live proof on dam.designflow.app and close #660 | ⬜ open | — |

**Where a fresh session starts:** Step 0 (one read-only query), then Step 1.

---

## 1. The ultimate goal

When a user types a search term in the OrderList Find box and immediately presses Enter or the down arrow to go to the second match, the grid must land on the second match and stay there. Today a slow first lookup can arrive late and snap the grid back to match 1, silently skipping a result — the user thinks they stepped and did not. Nothing about counting, wrapping, or Master Data changes.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`; React + Vite + AG Grid; Supabase backend; built to GHCR by `.github/workflows/publish-frontend.yml` and deployed by Coolify app `qxj8a0j3tpa9lq4q5rs6pezy` at https://dam.designflow.app). The OrderList page (`/orders`, `src/pages/OrdersPage.tsx`) shows ~24k order lines through AG Grid's infinite row model; Find is server-side: the RPC `public.find_dam_order_list_row(p_search, p_filters, p_sort, p_occurrence)` returns the Nth match, its row index, and the total match count. Master Data (`src/pages/StylesPage.tsx`) has a client-side Find over loaded rows using the same `GridFindStepper` component.

## 3. What triggered this work

Advisory AI review (StepFun) of merged PR #659 filed #660 with:

1. **Blocking — RPC contract missing.** `useOrderList.ts` sent `p_occurrence` and read `match_count` but no landed migration defined them, so every Find took the legacy full-scan fallback. **Already fixed:** shared-db migration `20261102180759_orderlist_find_occurrence.sql` (vendored at `shared-db/supabase/migrations/20261102180759_orderlist_find_occurrence.sql`, header lines 1-8 describe `p_occurrence` + `match_count`); generated types carry it (`src/integrations/supabase/types.ts:4804-4812`). The planner confirmed on 2026-11-04 by read-only query that version `20261102180759` is present in production `supabase_migrations.schema_migrations`; shared-db issue popcre/shared-db#5467 is closed. The owner's Nov 4 comment on #660 says "Fixed: missing RPC".
2. **Should fix — race: the debounced Find ignores `findGeneration`.** Still open. `src/pages/OrdersPage.tsx:240-273`: the debounced effect's async callback guards only on `cancelled` (`:254`, set by effect cleanup), never on `findGeneration.current`, while `goToFindMatch` (`:217-238`) bumps and checks the generation (`:222, :228, :234`).
3. Further findings were truncated in the issue body (nothing beyond #2 is recorded).

The fixer bot deferred because the source PR was closed.

## 4. Scope — in and out

In: the generation guard in the debounced effect; one integration test; deploy + live proof; closing #660.

**NOT in this plan:**
- Master Data Find (`StylesPage.tsx:49-150`): it is synchronous over loaded rows (`searchMatchIds` memo, `stepMatch` state update) with no async lookup, so the race does not exist there. Leave it.
- Changing `GridFindStepper` (`src/components/grid/GridFindStepper.tsx`) behaviour when `total == null` (arrows enabled while the count is unknown is deliberate — see `:24-26` comment).
- Removing the legacy fallback `findOrderListRowWithLegacyScan` (`src/hooks/useOrderList.ts:395-423`); it is the documented deployment-skew path.
- Any shared-db change.
- Debounce timing (300 ms) or toast wording.

## 5. Current state of the code (main `01fcfc34`, deployed)

- `src/pages/OrdersPage.tsx`
  - State: `search` `:56`, `highlightedRowId` `:57`, `findResult` `:60` (`{ position, count | null }`), `findGeneration = useRef(0)` `:61`.
  - `buildFindRequest` `:204-215` (search + AG Grid filter/sort model).
  - `goToFindMatch(position)` `:217-238`: computes wrapped `target`, `const generation = ++findGeneration.current` `:222`, awaits `findOrderListRow({ ...request, occurrence: target })`, bails if `generation !== findGeneration.current` `:228, :234`, then `setFindResult`, `setHighlightedRowId`, `navigateToOrderListMatch`.
  - Debounced effect `:240-273`: on empty term bumps the generation `:243` and clears state; otherwise `let cancelled = false`, 300 ms timer, `await findOrderListRow(buildFindRequest())` `:255`, `if (cancelled) return` `:256`, then `setFindResult({ position: 1, count: match.matchCount })` `:261` and highlight/navigate `:262-263`. **No generation capture or check — the bug.**
  - Input `:420-437`: Enter → `goToFindMatch((findResult?.position ?? 1) + 1)`; stepper `:440-445` with `onPrev/onNext` similarly. `findResult` is `null` until the first lookup resolves, so the stepper renders with position 1 immediately and both arrows are enabled while `total == null` (`GridFindStepper.tsx:46, :57`).
- `src/hooks/useOrderList.ts`: `findOrderListRow` `:429-446` (RPC path; falls back on `42883`/`PGRST202` only, `:238-241`).
- Tests: `src/pages/OrdersPage.integration.test.tsx` mocks `findOrderListRow` (`:18-19`); existing cases `:146-157` (sends the Find request once), `:161-190` ("counts Find matches and steps between them with arrows and Enter" — asserts the occurrence sequence 1→2→3→1), `:193-203` (zero matches). These resolve the mock immediately, so the race is never exercised.
- Docs: `docs/ORDER_LIST.md:125-130` describes the stepper and RPC; still accurate.

## 6. Key findings and root cause

- Two lookups can be in flight: the 300 ms debounced "first match" lookup and a user-initiated step. The debounced callback writes `position: 1` unconditionally on resolution (`OrdersPage.tsx:261-263`). If the step's RPC resolves first (it often will — same RPC, same cost, and the debounced call started at most 300 ms earlier only if the user typed fast), the later arrival overwrites position/highlight/scroll with match 1. `cancelled` only flips on effect cleanup, i.e. when `search` or `buildFindRequest` changes — a step changes neither.
- `goToFindMatch` already owns the generation protocol: capture, compare after await (`:222, :228, :234`). The debounced effect needs the same two lines.
- Conversely, the debounced effect's own `cancelled` flag stays necessary: a changed term must also discard an in-flight step result — `goToFindMatch` handles that because the empty-term branch bumps the generation (`:243`), but a non-empty term change does not bump it. So **the term-change path should also bump the generation** so a stale step from the previous term cannot land after the new term's first lookup. Both directions are covered by making the debounced effect capture `const generation = ++findGeneration.current` when it schedules, and checking `generation !== findGeneration.current` after the await.
- Finding 1 needs no code: the RPC path is live, and `findOrderListRow` reads `match_count` (`useOrderList.ts:444-445`).

## 7. Approaches considered and REJECTED

- **Disable the arrows/Enter until the first lookup resolves (`loading` prop).** Rejected: makes the box feel laggy on every keystroke and does not fix the ordering problem if the user steps the instant it enables; the generation guard is the established pattern on this page (`countGeneration` `:66`, `findGeneration`).
- **Cancel the debounced timer inside `goToFindMatch`.** Rejected: the timer may already have fired (request in flight); cancelling a timer cannot recall an awaited promise. The generation compare is the only thing that works post-await.
- **Move both lookups into one `useReducer`/queue.** Rejected: larger refactor for a two-line fix; nothing else on the page needs it.
- **Increment the generation inside the timer callback instead of when the effect schedules.** Acceptable alternative; rejected only to keep "any term change invalidates in-flight steps" semantics (section 6, third bullet) which needs the bump to happen on term change, i.e. in the effect body. Implementer may pick either if they test both directions.

## 8. Design decisions (2026-11-04)

- **LOCKED:** Fix is confined to the debounced effect in `OrdersPage.tsx:240-273`: bump + capture the generation at schedule time; check it after the await (in addition to `cancelled`, which can stay or be replaced by the generation check — implementer's call, but the cleanup must still clear the timer).
- **LOCKED:** The test lives in `src/pages/OrdersPage.integration.test.tsx` and drives the mock with deferred promises so the step resolves before the first lookup.
- **LOCKED:** No change to Master Data, `GridFindStepper`, or `useOrderList`.
- **OPEN:** whether to also drop the `cancelled` flag (redundant once the generation check exists). Recommended: keep the cleanup timer clear, remove `cancelled` to leave a single mechanism.

## 9. The plan

**Step 0 — confirm finding 1 live.** Read-only: `select version from supabase_migrations.schema_migrations where version='20261102180759';` via Supabase MCP `execute_sql` (project `qsllyeztdwjgirsysgai`). Also, in a browser session on https://dam.designflow.app (admin test login from 1Password `vibe_coding`, see `docs/1password.md`), type a SKU in OrderList Find and confirm the network tab shows one `rpc/find_dam_order_list_row` call with `p_occurrence` and no console warning "OrderList Find RPC is unavailable". Gate: row present; RPC call seen. Record both in the #660 comment later.

**Step 1 — guard the debounced Find.** `src/pages/OrdersPage.tsx:240-273`. New shape (intent, not verbatim):
```ts
useEffect(() => {
  const term = search.trim();
  const generation = ++findGeneration.current;   // any term change invalidates in-flight lookups and steps
  if (!term) { setHighlightedRowId(null); setFindResult(null); return; }
  const timer = window.setTimeout(async () => {
    const api = gridRef.current?.api;
    if (!api) return;
    try {
      const match = await findOrderListRow(buildFindRequest());
      if (generation !== findGeneration.current) return;   // a step or a newer term won
      ...unchanged state writes...
    } catch (error) {
      if (generation !== findGeneration.current) return;
      toast.error((error as Error).message);
    }
  }, 300);
  return () => window.clearTimeout(timer);
}, [search, buildFindRequest]);
```
Behaviour: a step (`goToFindMatch`) bumps the generation (`:222`), so a later-arriving first-lookup result is discarded; a newer term bumps it, so a stale step result is discarded by `goToFindMatch`'s own check. Dependencies: none. Gate: `npm run typecheck` clean; Step 2 test passes; existing three Find tests still pass.

**Step 2 — regression test.** In `src/pages/OrdersPage.integration.test.tsx` add
`it("keeps the stepped match when the first Find lookup resolves late", …)`:
1. `vi.mocked(findOrderListRow)` first call returns a deferred promise `first` (create with `let resolveFirst; new Promise(r => resolveFirst = r)`); second call resolves immediately with `{ rowId: "r2", index: 1, matchCount: 3 }`.
2. Type `"SKU"`, advance timers 300 ms (the file already uses fake timers for the debounce — follow the pattern at `:161-190`).
3. Press ArrowDown button ("Next match") or Enter → expect `findOrderListRow` last called with `occurrence: 2` and the stepper label `2 of 3`.
4. Now `resolveFirst({ rowId: "r1", index: 0, matchCount: 3 })` and flush.
5. Assert the label is still `2 of 3` and the grid mock's last navigate target/highlight is `r2` (the existing grid mock at `:51-70` exposes what it received — reuse the same assertion style as `:180-189`).
Also add `it("discards a stale step result after the term changes", …)`: start a step on term A with a deferred promise, change the term to B (debounced lookup resolves immediately with position 1 for B), resolve the A step → label remains B's `1 of N` and highlight is B's row.
Gate: both tests fail on current `main` (verify by running them once before Step 1 — this proves they catch the bug) and pass after Step 1.

**Step 3 — ship.** Branch `fix/orderlist-find-debounce-generation`, commit, PR to `main` (reference #660), `bin/ai-pr-wait <pr>` in background, merge. Frontend deploy: `publish-frontend.yml` → GHCR → Coolify; verify the live bundle contains the change (the handoff §4 warns the stepper is code-split: grep **all** chunks, e.g. `curl -s https://dam.designflow.app/assets/OrdersPage-*.js` for a string unique to the new effect, or compare the Coolify container's image digest with the workflow's pushed digest). Gate: CI green, merged SHA deployed.

**Step 4 — live proof + close.** On https://dam.designflow.app/orders with the admin test login: throttle the network (DevTools "Slow 3G"), type a term that has ≥3 matches, press Enter immediately; the counter must read "2 of N" and stay there after the first lookup completes. Screenshot into the #660 comment, tick `- [ ] live proof` on #660, close with `$AI_GH_SIGNATURE`. Update STATUS here and the handoff.

## 10. Tests required

- New: `keeps the stepped match when the first Find lookup resolves late`; `discards a stale step result after the term changes` (both in `src/pages/OrdersPage.integration.test.tsx`).
- Existing must stay green: `src/pages/OrdersPage.integration.test.tsx` (all 12), `src/test/order-list.test.ts` (`normalizes Find RPC input…` `:483`, `clamps the Find occurrence…` `:499`), `src/lib/style-tracker-find-navigation.test.tsx`.
- Suite: `npm run lint && npm run typecheck && npm run test` (root CI). Known flake: `order-list-grid` / `erp-review-queue` under full parallel load — rerun in isolation before believing a failure (handoff §4).

No trust-boundary input crosses here (search term goes to an existing parameterised RPC unchanged), so no adversarial table beyond the race cases above.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR; the AI merges; never push to `main`.
- Frontend only deploys on `src/**` changes through `publish-frontend.yml`; green CI ≠ live — verify the served chunk.
- Running vitest from a worktree: `vitest.config.ts` resolves the setup file absolutely; symlink `node_modules` to the canonical checkout's (handoff §4). Do not `cp -al` node_modules.
- AG Grid license warning in tests is accepted (owner, 2026-10-11).
- Do not touch generated `src/integrations/supabase/types.ts`.
- No shared-db change is needed; if someone proposes one, it belongs in `popcre/shared-db` claim-first — not here.
- Times in EST; sign GitHub posts with `$AI_GH_SIGNATURE`; reviews advisory only.

## 12. Access and environment

- `gh` as `u2giants`; Supabase MCP (confirm project with `get_project_url`); Chrome/Playwright MCP for the live check.
- Admin/tester logins: 1Password vault `vibe_coding`, items listed in `docs/1password.md` (never values).
- Local run: `npm ci && npm run dev` (Vite) against the shared Supabase project; env per `AGENTS.md`.

## 13. Definition of done, risks, open questions

- [ ] Step 0 evidence recorded (migration row + RPC call seen live).
- [ ] Guard in place; two new tests fail-before/pass-after; CI green; PR merged.
- [ ] Deployed SHA verified in the served bundle / Coolify container.
- [ ] Live proof screenshot on #660, `- [ ] live proof` ticked, #660 closed; STATUS and handoff updated.

Risks: minimal — two lines in one effect. Rollback = revert the commit. Open questions: none for Albert.

## Self-audit

1. **Fresh session, no questions?** Yes — sections 5 and 9 give exact lines, the intended code shape, the mock pattern to copy, and the deploy verification trick from the predecessor handoff.
2. **All background and rejected paths?** Yes — section 3 records finding 1 as landed with evidence, section 6 explains both race directions, section 7 lists four rejected fixes.
3. **Goal clear enough to steer by?** Yes — section 1: the stepped match must stick; anything that makes stepping laggy or changes counting/wrapping conflicts with it.
