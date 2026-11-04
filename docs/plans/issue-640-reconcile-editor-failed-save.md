# Plan: Review finding: u2giants/popdam3#639 OrderList: retain columns and allow reconciliation corrections (u2giants/popdam3#640)
Issue: https://github.com/u2giants/popdam3/issues/640
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Confirm both findings still exist on `main` | ⬜ open | — |
| 2 | Keep the Reconcile editor mounted during a failed save (drop the `isFetching` guard, stop cache reuse on re-open) | ⬜ open | — |
| 3 | Failed-save regression test through the real react-query lifecycle | ⬜ open | — |
| 4 | Remove the auth-resolution remount of `OrderListGrid` on the Orders page | ⬜ open | — |
| 5 | Regression test: one initial fetch, saved layout still applied after auth resolves | ⬜ open | — |
| 6 | Docs touch (`docs/ORDER_LIST.md`), PR, CI, merge, deploy | ⬜ open | — |
| 7 | Live proof on dam.designflow.app and close #640 | ⬜ open | — |

**Where a fresh session starts:** step 1 (a two-minute re-check), then step 2. Nothing has been implemented; both findings are confirmed present on `main` as of 2026-11-04 (see section 5).

---

## 1. The ultimate goal

When a member of staff corrects an order line on the **To reconcile** screen and the save is rejected (bad value, network blip, database timeout), they must **keep what they typed** and see the error, so they can fix and retry. Today a rejected save silently throws the typed corrections away and re-shows the original row, which is worse than no editor at all: the person believes the correction was made or re-types it blind.

Secondary: the OrderList page must not fetch its first block of rows twice and flash default columns before the person's saved column layout appears. That costs a wasted database read on every page open and makes the saved layout look unreliable.

**If a step conflicts with this goal, the goal wins — stop and flag it.** In particular: never "fix" the lost-edits problem by making the save silently succeed or by hiding the error toast.

## 2. What this application is

PopDAM is POP Creations' internal digital asset manager (React + Vite + Tailwind front end in `src/`, Supabase backend shared with the other POP apps, Railway worker in `apps/worker/`). Read `AGENTS.md` first. The OrderList feature (`/orders`) is the production-order list that replaced the legacy Google "OrderList" sheet; the **To reconcile** screen (`/reconcile`, `src/pages/ReconcilePage.tsx`) shows lines where the ColdLion ERP import and the Google sheet disagree, and lets staff pick the right answer or open the full order editor. Docs: `docs/ORDER_LIST.md`; backend contract `shared-db/plan_popdam_order_list.md` (vendored mirror). The front end deploys from `main` via `.github/workflows/publish-frontend.yml` → GHCR → Coolify app `qxj8a0j3tpa9lq4q5rs6pezy` at https://dam.designflow.app. Repo: `u2giants/popdam3`, default branch `main`.

## 3. What triggered this work

PR #639 ("OrderList: retain columns and allow reconciliation corrections", merged 2026-11-02 as `5681f153`) added per-user column persistence to the OrderList grid and an "Edit this order line" path on the Reconcile screen. The advisory AI review (reviewer: stepfun, workflow run 41367774872) approved the column persistence and raised two findings, recorded as issue #640 (label `review-finding`, `fixer-deferred` — the automatic fixer could not act because the source PR was already closed):

1. **Failed save in the Reconcile editor discards unsaved edits (REVISE).** The editor render guard includes `!editRow.isFetching`; a failed save invalidates the edit-row query, which refetches, which unmounts the editor and remounts it from the original row.
2. **Minor: redundant remount on auth resolution.** `OrdersPage.tsx` keys `OrderListGrid` on `user?.id`, so when the user resolves from `null` to an id the grid remounts, re-fetches the first block and can flash default columns.

Reproduction of finding 1 (production, https://dam.designflow.app/reconcile): open any item, click **Edit this order line**, change a field to something the database will reject (e.g. a non-numeric quantity that bypasses local validation, or simply pull the network while saving), click **Save changes**. Observed: toast "OrderList save failed: …" **and** the dialog blinks and reopens with the original values.

## 4. Scope

**In:**
- `src/pages/ReconcilePage.tsx` editor mount guard and edit-row query caching.
- `src/hooks/useColdLionTriage.ts` (`useColdLionTriageEditRow`) if cache behaviour must change.
- `src/pages/OrdersPage.tsx` grid keying.
- Tests in `src/test/coldlion-triage.test.tsx` and `src/test/order-list-grid.test.tsx` (or a new `src/test/orders-page-grid-mount.test.tsx`).
- One paragraph in `docs/ORDER_LIST.md`.

**NOT in this plan:**
- Any change to `OrderEditorDialog` validation rules or fields.
- The pre-existing behaviour that the editor always sends `company_id` even when empty (the reviewer explicitly called it out of scope).
- Column-persistence logic in `src/components/orders/OrderListGrid.tsx` / `src/lib/order-list-column-storage.ts` (reviewed and approved as correct).
- Database objects (`update_dam_order`, `api.dam_order_list`) — owned by `popcre/shared-db`.
- The OrdersPage editor flow (already holds its row in local state and has no `isFetching` guard; it is the reference behaviour).

## 5. Current state of the code (verified on this worktree at `01fcfc34`, which contains `origin/main`)

Finding 1 is **still present**:
- `src/pages/ReconcilePage.tsx:202-212` — guard is `editingLineId && editRow.data && !editRow.isFetching && !editRow.error`, then `<OrderEditorDialog key={editingLineId} mode="edit" row={editRow.data} … onSubmit={… updateOrder.mutate({…}, { onSuccess: () => setEditingLineId(null) })} />`.
- `src/pages/ReconcilePage.tsx:147-151` — `useUpdateOrder(() => { invalidate COLDLION_TRIAGE_QUERY_KEY, ["coldlion-triage-candidates"], ["coldlion-triage-edit"] })`.
- `src/hooks/useOrderList.ts:547-566` — `useOrderListMutation` runs `onRowsChanged?.()` inside `onSettled`, i.e. **on failure too** (by design: "a rejected save can never leave a wrong value sitting in the grid"). `onError` toasts `OrderList save failed: …`.
- `src/hooks/useColdLionTriage.ts:75-89` — `useColdLionTriageEditRow(lineId)` with `staleTime: 0`, `refetchOnWindowFocus: false`, default `gcTime`.
- `src/components/orders/OrderEditorDialog.tsx:68-69` — form values live in `useState(() => initialValues(row))`: the initialiser runs once per mount, so a mounted dialog keeps edits even if `row` changes, and an unmounted one loses them.
- `src/test/coldlion-triage.test.tsx:29-32` mocks `@/hooks/useOrderList` with `useUpdateOrder: () => ({ isPending: false, mutate: editSave })` — `editSave` is a bare `vi.fn()`, so no test exercises `onSettled`/invalidation. The existing editor tests are at lines 97-122.

Finding 2 is **still present**:
- `src/pages/OrdersPage.tsx:514-516` — `<OrderListGrid key={user?.id ?? "anonymous"} userId={user?.id} …>`.
- `src/pages/OrdersPage.tsx:51` — `const { user, loading: authLoading } = useAuth();` (`authLoading` already exists).
- `src/components/orders/OrderListGrid.tsx:326-336` — `onGridReady` calls `readOrderListColumns(userId)` **once**, then sets `columnsReady.current = true`; `onStateUpdated`/`onGridPreDestroyed` save with the current `userId`. So `userId` is read for restore only at grid-ready time: if the grid mounted while `user` was still `null`, the saved layout is never applied unless something remounts the grid — which is exactly why the `key` was added.

Nothing on a branch; no PR open for #640.

## 6. Key findings and root cause

- **Root cause, finding 1:** react-query's `onSettled` fires after both success and failure. The Reconcile page's `onRowsChanged` invalidates `["coldlion-triage-edit"]`; the active edit-row query refetches; `isFetching` flips true; the guard drops the dialog; the refetch completes; the dialog remounts via the same `key` and re-derives `initialValues` from the (unchanged) row. Edits are gone, and because `onError` already toasted, the person sees an error *and* a reset form.
- **Why the guard exists at all:** it was meant to avoid opening the editor on stale data. But `key={editingLineId}` plus `staleTime: 0` already guarantee a fresh fetch per open; the guard only matters for the "same line re-opened within `gcTime`" case, where cached data mounts the dialog before the refetch lands and the once-only `useState` initialiser would freeze the stale values. That case must be handled some other way (step 2).
- **Root cause, finding 2:** `useAuth()` resolves asynchronously, so on first render `user` is `null` → grid mounts keyed `"anonymous"`, calls the datasource for block 0, then `user` resolves → key changes → grid unmounts/remounts → block 0 fetched again, default columns visible until `onGridReady` applies the saved layout. Removing the `key` alone would **break** layout restore when auth resolves late (section 5, `OrderListGrid.tsx:326-329`); the grid must simply not mount until auth has resolved.
- Cost reference: the OrderList first-block read is the one that hit the cold statement cap in October (memory `project_prod_cold_warm_statement_ceiling`, popdam3 #560); issuing it twice per page open is not free.

## 7. Approaches considered and rejected

| Approach | Why rejected |
|---|---|
| Remove the `["coldlion-triage-edit"]` invalidation from `onRowsChanged` | Then a *successful* save followed by re-opening the same line could show pre-save values from cache. The invalidation is correct; the guard is the bug. |
| Make `useOrderListMutation` call `onRowsChanged` only `onSuccess` | Changes the OrdersPage contract ("a rejected save can never leave a wrong value in the grid", `useOrderList.ts:542-545`) for every mutation. Out of scope and wrong. |
| Keep `!editRow.isFetching` but hold the row in page state (`useState`) like OrdersPage | Works but duplicates the row in two places; simpler to drop the guard and set `gcTime: 0` on the edit query so there is never cached data to mount from. |
| Fix finding 2 by removing the `key` only | Breaks layout restore when `user` resolves after `onGridReady` (section 6). Must gate on `authLoading` instead. |
| Fix finding 2 by re-applying column state in a `useEffect` on `userId` change inside `OrderListGrid` | More moving parts inside the reviewed-and-approved persistence code; gating the mount is one line and keeps `OrderListGrid` untouched. |
| Test finding 1 with the existing bare `editSave` mock | Cannot catch the bug — the reviewer said so explicitly. The test must run a real `useMutation` with a real `onSettled`. |

## 8. Design decisions

- **LOCKED (2026-11-04):** the editor stays mounted across a failed save; the error is shown by the existing `toast.error` in `useOrderListMutation` (no new error UI). Closing on success stays as is (`onSuccess: () => setEditingLineId(null)`).
- **LOCKED:** `useColdLionTriageEditRow` gets `gcTime: 0` so re-opening a line always mounts the dialog from a fresh fetch (no stale cached row can seed the form). `staleTime: 0` stays.
- **LOCKED:** `OrderListGrid` on `OrdersPage` renders only when `!authLoading`; the `key={user?.id ?? "anonymous"}` prop is removed. `userId={user?.id}` stays. `OrderListGrid.tsx` is not edited.
- **OPEN (implementer's call):** what to render in the grid slot while `authLoading` is true — recommended: the same `Loader2` spinner pattern used elsewhere on the page, or nothing. Either is acceptable; it is visible for well under a second.
- **OPEN:** whether the failed-save test lives in `src/test/coldlion-triage.test.tsx` (recommended, reuses fakes) or a new file.

## 9. The plan

### Step 1 — Re-confirm the findings on the implementation branch
- Create a feature branch from `origin/main` in a fresh worktree (e.g. `fix/640-reconcile-editor-keeps-edits`).
- Check `src/pages/ReconcilePage.tsx` guard still contains `!editRow.isFetching` and `src/pages/OrdersPage.tsx` still has `key={user?.id ?? "anonymous"}`. If either is gone, the corresponding steps collapse to "add the regression test and cite the landing commit".
- **Gate:** `grep -n "isFetching" src/pages/ReconcilePage.tsx` shows line ~202 and `grep -n 'key={user' src/pages/OrdersPage.tsx` shows line ~515.

### Step 2 — Keep the Reconcile editor mounted across a failed save
- `src/pages/ReconcilePage.tsx:202` → change the guard to `editingLineId && editRow.data && !editRow.error ? (…)`.
- `src/hooks/useColdLionTriageEditRow` (`src/hooks/useColdLionTriage.ts:75-89`) → add `gcTime: 0` next to `staleTime: 0` with a one-line comment: "Never seed the editor from a cached row; the dialog initialises its form once per mount."
- Intended behaviour: save fails → toast → dialog stays open with the typed values → person edits/retries or cancels. Save succeeds → dialog closes → list refreshes. Re-open same line → spinner ("Loading order line…") then fresh values.
- Note the `error` branch at `ReconcilePage.tsx:194-200` still shows "Could not load this order line. No changes were made." and the `isLoading` branch at `:193` still shows the loading status; neither changes.
- **Gate:** step 3's test passes; the existing four Reconcile tests still pass (`npx vitest run src/test/coldlion-triage.test.tsx`).

### Step 3 — Failed-save regression test (real react-query lifecycle)
- In `src/test/coldlion-triage.test.tsx`, change the `@/hooks/useOrderList` mock so `useUpdateOrder(onRowsChanged)` returns a **real** `useMutation` (import from `@tanstack/react-query` inside the mock factory via `vi.importActual` or by using the already-imported module — `vi.mock` factories can import; use `await vi.importActual("@tanstack/react-query")` or reference the top-level import, which Vitest hoists safely when the factory only closes over it at call time):
  ```ts
  useUpdateOrder: (onRowsChanged?: () => void) => useMutation({
    mutationFn: async (payload: unknown) => { editSave(payload); const r = await rpc("update_dam_order", payload); if (r?.error) throw r.error; },
    onSettled: () => onRowsChanged?.(),
  }),
  ```
  Keep `editSave` assertions in the existing "opens the current order line…" test working (they assert `editSave` was called with the payload and a second argument; with a real mutation the second argument is the per-call options object — `expect.anything()` still matches).
- Add test **"keeps the typed correction and the dialog open when the save is rejected"**:
  1. `listRows = [row({ coldlion_unmatched: true })]`; `rpc.mockImplementation((name) => name === "update_dam_order" ? Promise.resolve({ data: null, error: new Error("quantity must be positive") }) : Promise.resolve({ data: null, error: null }))`.
  2. Render, click "Edit this order line", change "Style #" to `CORRECTSKU`, click "Save changes".
  3. `await waitFor(() => expect(rpc).toHaveBeenCalledWith("update_dam_order", expect.anything()))`.
  4. Assert `toast.error` was called (import the mocked `sonner` toast) and that `screen.getByLabelText("Style #")` is still in the document with value `CORRECTSKU` — also after a further `await waitFor(...)` tick so the invalidation-triggered refetch has completed (the fake `single()` resolves immediately).
- Add test **"re-opening a line never shows a stale cached row"** (covers `gcTime: 0`): open the editor, cancel (`onClose`), mutate the fake `single()` return (e.g. `order_person: "Changed person"`), re-open, assert the Loading status appears first and the new value is what the form shows.
- Also add a counter on the fake `single()` to assert it is called once per open.
- **Gate:** both new tests fail on `main`'s guard (delete the fix temporarily to confirm) and pass with step 2.

### Step 4 — Stop remounting `OrderListGrid` when auth resolves
- `src/pages/OrdersPage.tsx:514-516` → remove `key={user?.id ?? "anonymous"}`; wrap the grid in `{authLoading ? <spinner/null> : <OrderListGrid userId={user?.id} … />}` inside the existing `<div className="h-full min-h-0 …">` so the layout box does not collapse.
- Check `gridRef` consumers in OrdersPage (`:353` `if (!api || !user?.id) return;`) still behave: they already guard on the api being present.
- Intended behaviour: the grid mounts once, after the user is known; `onGridReady` reads the saved layout with the real `userId` on first ready; exactly one `getRows` for block 0.
- **Gate:** step 5 test; manual: open `/orders`, DevTools network shows a single `dam_order_list` block-0 request on load.

### Step 5 — Regression test for a single mount
- `src/test/order-list-grid.test.tsx` currently renders `OrderListGrid` directly (tests at lines 60-160) and does not cover OrdersPage. Add a small page-level test (new file `src/test/orders-page-grid-mount.test.tsx` is fine) that mocks `@/hooks/useAuth` to return `{ user: null, loading: true }` first and `{ user: { id: "u1" }, loading: false }` after a rerender, mocks `OrderListGrid` with a `vi.fn()` component that records mount count (`useEffect(() => { mounts++ }, [])`), and asserts: **"the OrderList grid mounts once, with the user id, after auth resolves"** — zero mounts while loading, exactly one mount after, `userId === "u1"`.
- If mocking the page's many hooks is disproportionate, the acceptable minimum is a datasource spy: render `OrdersPage` with a mocked `useAuth` sequence and assert the datasource `getRows` is invoked once. Pick whichever the existing `src/test/orders-page*.test.tsx` files (check `ls src/test | grep -i order`) make cheapest.
- **Gate:** test fails with the `key` prop restored, passes without.

### Step 6 — Docs, PR, CI, merge, deploy
- `docs/ORDER_LIST.md`: in the Reconcile / order-editor paragraph, add one sentence: "A rejected save keeps the editor open with the typed values; the error is shown as a toast." In "Automatic column settings" (line 85), add: "The grid mounts only after sign-in state is known, so the saved layout is applied on the first render."
- Commit as Albert's verified identity, push, open PR to `main` titled `fix(orders): keep Reconcile edits on a failed save; mount OrderList grid once (#640)` with body `Closes #640` and the attribution lines from the session reminder. Sign GitHub posts with `$AI_GH_SIGNATURE`.
- Run `bin/ai-pr-wait <pr>` in the background; do other work; rerun on exit 2. CI = `npm ci && npm run lint && npm run typecheck && npm run test` + worker/windows-agent builds + `npm run build`.
- Merge (the AI merges; Albert does not). Confirm `publish-frontend.yml` succeeded and the Coolify app serves the new SHA (`docs/deployment.md` → verifying the deployed commit).
- **Gate:** PR merged, CI green, deployed SHA equals the merge commit.

### Step 7 — Live proof and close
- On https://dam.designflow.app/reconcile with a tester login (1Password `vibe_coding`, PopDAM tester items — see `docs/1password.md`), open an item, edit a line, force a rejected save (an invalid value the RPC rejects), observe: toast + dialog still open with the typed value. Screenshot.
- On `/orders`: hard reload, confirm one block-0 request and the saved column layout applied without a default-columns flash. Screenshot or network capture.
- Post the evidence on #640 (signed), tick `- [ ] live proof`, close the issue.
- **Gate:** issue closed with screenshots attached.

## 10. Tests required

New (named by behaviour):
- `src/test/coldlion-triage.test.tsx` → "keeps the typed correction and the dialog open when the save is rejected".
- `src/test/coldlion-triage.test.tsx` → "re-opening a line never shows a stale cached row".
- `src/test/orders-page-grid-mount.test.tsx` (or equivalent) → "the OrderList grid mounts once, with the user id, after auth resolves".

Must stay green: `npm run test` (vitest, root) — specifically `src/test/coldlion-triage.test.tsx`, `src/test/order-list-grid.test.tsx`, `src/test/order-list-column-storage.test.ts`; `npm run lint`; `npm run typecheck`; `npm run build`.

No trust-boundary input is introduced (no new parsers, uploads, money or external data), so no adversarial-cases table is required; the external input (the RPC error) is covered by the rejected-save test.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; never push to `main`; the AI merges. Each write task uses its own worktree.
- No database changes in this repo; `update_dam_order` and `api.dam_order_list` belong to `popcre/shared-db` (claim-first on the existing issue there if anything DB-side were needed — nothing is).
- Do not touch `OrderListGrid.tsx` persistence code; it was reviewed as correct.
- `useOrderListMutation` must keep calling `onRowsChanged` on failure (OrdersPage relies on it).
- `vi.mock` factories are hoisted: a factory that references a top-level import must only *use* it inside the returned function (allowed) — do not call it at factory evaluation time.
- UI work needs visual verification (step 7 screenshots), not just unit tests.
- Reviews are advisory; never wait on one. Required checks are lean.
- Quote times to humans in EST.

## 12. Access and environment

- Worktree root for planning: `/worksp/popdam/.claude/worktrees/github-issues-implementation-plans-09bb39`; implement in your own worktree of `u2giants/popdam3`.
- `gh` is authenticated as `u2giants`. CI waiter: `bin/ai-pr-wait <pr>` (background).
- Local run: `npm ci && npm run dev` (see `docs/development.md`); tests `npm run test` / `npx vitest run <file>`.
- Production front end: https://dam.designflow.app (Coolify app `qxj8a0j3tpa9lq4q5rs6pezy`). Supabase project `qsllyeztdwjgirsysgai`.
- Test logins: 1Password vault `vibe_coding`, PopDAM per-role tester items (titles in `docs/1password.md`; never values).

## 13. Definition of done, risks, open questions

Done when:
- [ ] Guard no longer includes `isFetching`; `gcTime: 0` on the edit-row query.
- [ ] `key` prop removed; grid gated on `!authLoading`.
- [ ] Three new tests pass; full root suite, lint, typecheck, build green.
- [ ] Docs sentence added in `docs/ORDER_LIST.md`.
- [ ] PR merged to `main`; `publish-frontend.yml` green; deployed SHA verified.
- [ ] Live proof posted on #640; issue closed; this plan's STATUS table updated with artifacts (test file paths, commit SHA, CI run id).

Risks and rollback:
- If gating on `authLoading` ever leaves the grid unmounted (auth stuck loading), the page shows a spinner forever — but the rest of the page would already be unusable in that state. Rollback is a one-line revert.
- Removing the `isFetching` guard means the dialog's `row` prop can change under it after a refetch; the form ignores that by design (state initialised once). Acceptable and intended.

Open questions: none that need Albert. The two OPEN items in section 8 are implementer choices.

## Self-audit

1. **Could a brand-new session execute this without asking anything?** Yes — sections 5 and 9 give exact `file:line` targets, the test shapes (step 3/5) include the mock rewrite the reviewer said was necessary, and section 12 names the environment and logins by location.
2. **Does it carry every piece of background and what was ruled out?** Yes — section 6 explains the `onSettled` mechanism and why the bare `key` removal would break layout restore; section 7 lists six rejected alternatives with reasons.
3. **Is the goal clear enough to steer by if a step is wrong?** Yes — section 1 states the business outcome (typed corrections survive a rejected save; one fetch, no column flash) and forbids hiding the error as a "fix".
