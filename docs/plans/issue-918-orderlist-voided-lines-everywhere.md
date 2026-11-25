---
summary: Issue #918 plan — make every OrderList read path (row fetch by ID, grid blocks, counts) exclude voided lines and prove it with tests. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-918, or changing how OrderList hides voided lines
---

# Plan: OrderList hides voided lines on every read path (u2giants/popdam3#918)

Issue: https://github.com/u2giants/popdam3/issues/918 — advisory review of PR #916 ("OrderList: hide voided lines (PO 62012008 showed replaced AAH6208)").
Handoff: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-orderlist-buy-sheet-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-orderlist-buy-sheet-plans.md)

Written 2026-11-25 (about 4:15 PM EST) by Claude on `al8960ofc`, plan only. Code references are to `origin/main` at `787c20b8`.

## STATUS

| Step | State | Evidence |
|---|---|---|
| 0. Re-verify finding 1 (Find allowlist) is in production | ⬜ open | — |
| 1. Add the void filter to the by-ID row fetch | ⬜ open | — |
| 2. Tests: block, count, status counts and row fetch exclude voided lines | ⬜ open | — |
| 3. PR, CI, merge, deploy verified | ⬜ open | — |
| 4. Live proof on PO 62012008, close #918 | ⬜ open | — |

**Where a fresh session starts:** Step 0 (one read-only query), then Step 1.

---

## 1. The ultimate goal

When ColdLion (POP's ERP) replaces an item on a sales-order line, the old component lines are "voided" (`line_voided_at` set). Staff looking at the OrderList (`/orders`) must never see those dead lines: on 2026-11-10, PO 62012008 showed replaced item AAH6208 next to its replacement BRG6205, which read as a wrong assortment link. When this plan is done, **a voided line is absent from the grid, from every count, from Find, and from any row fetched by ID — guaranteed by tests, not by one query happening to filter.**

If a step conflicts with this goal, the goal wins — stop and flag it.

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, React + Vite web app in `src/`), whose `/orders` page replaces the legacy OrderList Google Sheet (`docs/ORDER_LIST.md`). It reads the view `api.dam_order_list` in the shared Supabase project `qsllyeztdwjgirsysgai` (schema owned by `popcre/shared-db`; read-only mirror in `shared-db/`). Production: https://dam.designflow.app/orders.

Key code: `src/hooks/useOrderList.ts`
- `orderListFilters` (`:237-242`) appends `{ column: "line_voided_at", operator: "is", value: null }` to every grid filter list.
- `applyOrderListShape` (`:259`) applies filters/search/sort identically to row-ID and count queries.
- `fetchOrderListRowsById` (`:317-332`) hydrates full rows for a list of IDs: `.in("order_line_id", chunk)` with **no** void filter.
- `fetchOrderListBlock` (`:347-…`) ranks IDs with the shape, then calls `fetchOrderListRowsById`.
- `countWhere` / `fetchOrderListStatusCounts` (`:471-490`).
- `findOrderListRow` falls back only on `42883`/`PGRST202` (`isMissingOrderListFindRpc`, `:253-256`).

## 3. What triggered this work

Advisory review issue on merged PR #916 (`fixer-done`/`fixer-deferred` labels are not proof of a fix).

## 4. Scope

In: the open findings below. NOT in: how ColdLion voids lines; showing voided lines anywhere (for example an audit view); `order_voided_at` handling beyond what already exists; Master Data grid.

## 5. Current state

PR #916 is merged and live. Nothing in this plan has started.

## 6. Findings — current status

| # | Finding | Status | Evidence |
|---|---|---|---|
| f1 | Find payload sends `line_voided_at` before the server allowlist accepts it; validation error would not fall back | **Resolved** | Shared-db migration `shared-db/supabase/migrations/20261110221520_orderlist_find_line_voided_filter.sql:9` adds `line_voided_at` and `order_voided_at` to the `find_dam_order_list_row` allowlist; the mirror only receives migrations merged in `popcre/shared-db`. Step 0 confirms it is applied in production |
| f2 | `fetchOrderListRowsById` lacks the void filter | **Open** | `useOrderList.ts:321` |
| f3 | Tests only check the Find payload; grid block, counts and status counts untested for the void filter | **Open** | Only `src/test/order-list.test.ts:493` asserts the filter (Find payload) |

## 7. Approaches considered and rejected

- **Filter voided lines inside the `api.dam_order_list` view.** Rejected for this issue: it is a shared-db structural change that would also hide them from other readers (ColdLion triage at `src/test/coldlion-triage.test.tsx:58` uses voided rows deliberately). The client-side rule is the documented design (`useOrderList.ts:230-236` comment).
- **Filtering in `fetchOrderListBlock` after hydration** (drop rows with `line_voided_at` set). Rejected: the row fetch is the reusable function; filtering at the query is one predicate and covers every caller.

## 8. Design decisions

Locked: rows, counts and Find all apply the same void filter so Find positions match the grid (comment at `useOrderList.ts:230-236`, 2026-11-10). Open: none.

## 9. The plan

### Step 0 — Confirm finding 1 in production (lead-only; read-only production query)
With the Supabase MCP `execute_sql` (read-only) or `psql` against project `qsllyeztdwjgirsysgai`:
```sql
select version from supabase_migrations.schema_migrations where version = '20261110221520';
```
You'll know it worked when one row is returned. If none, stop: Find must not send the filter until it is applied — report `Blocked —` on #918.

### Step 1 — Void filter on the row fetch (helper-ok; one predicate)
`src/hooks/useOrderList.ts:321`: `orderListTable().select(ORDER_LIST_SELECT).in("order_line_id", chunk).is("line_voided_at", null)`. Update the comment at `:327` to "A line deleted or voided between the two requests simply drops out of this block."
Before editing, `git grep -n "fetchOrderListRowsById" src` — if any caller needs voided rows on purpose, stop and ask.
You'll know it worked when test 1 in section 10 passes.
Stop-and-ask trigger: a caller that expects voided rows.

### Step 2 — Tests (helper-ok; names below)
Add to `src/test/order-list.test.ts` (or `src/test/order-list-block-count.test.ts`, which already mocks the query chain — reuse its mock):
1. `fetchOrderListBlock` hydration query includes `.is("line_voided_at", null)`.
2. The ID-ranking query from `applyOrderListShape` includes the `line_voided_at is null` filter.
3. `fetchOrderListCount` (the block count, `:300`) includes it.
4. `fetchOrderListStatusCounts`: every `countWhere` query includes `.is("line_voided_at", null)` (`:473`).
5. A mocked race: ID query returns `[a, b]`, hydration returns only `a` (b voided) → block has one row, no error.
You'll know it worked when `npx vitest run src/test/order-list.test.ts src/test/order-list-block-count.test.ts` passes.

### Step 3 — Land it (lead-only)
Fresh worktree branch, PR to `main`, required checks green, the AI merges, verify the deployed frontend bundle changed (`docs/deployment.md`).

### Step 4 — Live proof (lead-only)
On https://dam.designflow.app/orders, search PO `62012008`: AAH6208 is absent, BRG6205 present; the status counts at the top equal the number of non-voided lines (cross-check read-only: `select count(*) from api.dam_order_list where line_voided_at is null;`). Screenshot + SHA on #918, close it with a signed comment.

## 10. Tests required

The five tests in step 2. Must stay green: `npm run lint`, `npm run typecheck`, `npm run test`.

## 11. Constraints and gotchas

- Feature branch + PR; no DDL in this repo (shared-db only).
- `api.dam_order_list` is read through PostgREST; `.is(col, null)` is the null filter (not `.eq`).
- Do not change `isMissingOrderListFindRpc`: falling back on validation errors would hide real errors (its comment says so).
- Not a trust-boundary change (no outside input); no adversarial table needed.

## 12. Access and environment

`gh` as `u2giants`. Supabase MCP (read-only queries) for project `qsllyeztdwjgirsysgai`; credentials in 1Password vault `vibe_coding` (see `docs/1password.md`), never in chat. Production login: Google SSO with a POP staff account. Local: `npm ci && npm run test`.

## 13. Definition of done, risks, open questions

Done when: step 0 confirmed; f2 fixed; section 10 tests pass; CI green; merged; deployed SHA verified; live proof posted; #918 closed; STATUS rows cite artifacts; handoff entry marked done. Risk: none to data (read-only path); rollback by revert. Open: none.

## Self-audit (2026-11-25)

1. *Fresh session can execute without asking?* Yes — sections 2, 6, 9 name the function, line, predicate, tests and the production check.
2. *All background, including rejections?* Yes — section 7 (view-level filter, post-hydration filter) and section 8.
3. *Goal clear?* Yes — section 1: voided lines absent everywhere, proven by tests.

## Lead launch prompt

```
You are the lead for u2giants/popdam3 plan docs/plans/issue-918-orderlist-voided-lines-everywhere.md (issue #918).
Read AGENTS.md, then this plan's STATUS and sections 1, 6, 11. Work in your own worktree on a new branch from origin/main.
You do Steps 0, 3, 4 yourself (lead-only). Hand Steps 1 and 2 to your helper, in that order.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges, pushes or GitHub posts; when a stop-and-ask trigger fires, bring it to you; if stuck 30 minutes, you take the step back.
Rules sheet: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
You run yourself: npm run lint, npm run typecheck, npm run test, the production read-only checks and the live proof. Update STATUS with artifacts.
```
