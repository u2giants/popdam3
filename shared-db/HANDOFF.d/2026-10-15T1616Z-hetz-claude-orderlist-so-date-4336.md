---
issue: 4336
status: OPEN
owner: claude/issue4336-orderlist-so-filter
---

# Handoff: OrderList SO received date and 12-month window (issue #4336, claim #4337)

Written 2026-10-15 16:16 UTC (12:16 PM EST) on machine `hetz` by Claude session `250902fb-e85f-45d3-a62c-9c18cb217d1e`.
Facts below were checked at that time. Anything older than an hour must be re-checked.

## 0. Business decisions only the owner can make

1. **Add Prod PO Date as a fourth fallback for orders with no SO, Sent PO, or Start Ship date?**
   Blocks: the migration body (one line in the view) and the app's window rule. Recommendation: yes. Prod PO Date (`order_date`) is the production PO date in ColdLion; it is the next most reliable date on the order.
2. **Orders with no window date at all: keep them in the main list (current default) or hide them under "Show old"?**
   Currently they stay visible. Recommendation: keep them visible, so nothing disappears silently.

Already settled, do NOT re-ask:
- The window is the New York calendar, last 12 months, from today (2026-10-15 → 2025-10-15). Decided by the requester on 2026-10-15.
- "Show old" adds the older orders to the same table, and its button label becomes "Hide old" while active. Decided by the requester.
- Other usable dates exist (Prod PO Date, ETD, ETA, Requested Ship, Actual Ship, Warehouse, Cancel). Answered 2026-10-15.

## 1. What this application is

POP Creations' PopDAM app (`u2giants/popdam3`, Supabase project shared with PLM/CRM/DAM) includes the OrderList grid at `/orders`: production orders and their lines, with dates, status, Master Data links, and SO dates pulled from ColdLion. The shared backend is `popcre/shared-db`, which owns all database structure (schema, views, functions) and promotes changes to production through a gated workflow.

The owner (Albert Hazan) asked for `/orders` to show only orders from the last 12 months by SO date. If SO date is blank, use Sent PO date, then Start Ship date. Older orders get a "Show old" button that adds them to the same table.

## 2. What we set out to do and why

- Goal (business): the grid stops showing years of old orders by default, and older ones stay one click away.
- Technical objective: the window has to be computed in the database, because the grid pages through the full result set. The SO received date is not in the view today; it comes from a separate per-page lookup (`public.get_dam_order_sales_order_dates`). Filtering or sorting on it requires the date in SQL, so the database needs a change first.
- Trigger: request from Albert in the popdam session; related open issue is popcre/shared-db#4336 "Enable full-dataset OrderList sorting by SO Date", which asks for the same database object.

## 3. Current state (true at 2026-10-15 16:16 UTC)

### Shared database (popcre/shared-db)
- Issue #4336 (open): db-work-scope block updated by this session (writes: `view api.dam_order_list` and `function dam.orderlist_sales_order_received_date`; reads: `function public.get_dam_order_sales_order_dates`, `table coldlion.order_history_line`; `change_type: view`; `application_return_to: u2giants/popdam3`; `live_assertion` and `generated_types: required` added). Scope note appended, signed.
- Claim #4337 (OPEN, owned by this session): objects claimed exactly as the issue lists; reserved version **20261015154023**. The lease expired at 16:10 UTC. **Expiry does not release objects** (per `docs/agents/anti-collision-summary.md`), so the claim still protects them.
- Branch `claude/issue4336-orderlist-so-filter`, commits:
  - `61702d66` feat: migration `supabase/migrations/20261015154023_orderlist_sales_order_received_date.sql` — https://github.com/popcre/shared-db/blob/claude/issue4336-orderlist-so-filter/supabase/migrations/20261015154023_orderlist_sales_order_received_date.sql
  - `659e4a1d` fix: adds `-- derived-from: 20261009073649` header (the view body comes from that migration). This cleared the "SQL migration guards" check.
- PR popcre/shared-db#4339 (OPEN, MERGEABLE, head `659e4a1d`, body `Closes #4336`, claim #4337). Checks at 16:16 UTC:
  - PASS: SQL migration guards, Cross-PR object collision, Merge queue gate, documents checks, and others.
  - FAIL: **Migration author lease** — needs an owner check-in that requires the retired marker (see Dead ends).
  - FAIL: **Tools offline tests** — main's baseline is red (see Dead ends). It also fails on open PRs #4328, #4331, #4335, #4338.
  - FAIL: Queue-sensitive checks (aggregate), because it wraps Tools offline tests.
  - Reviewer: Muse Spark 1.3 Contributor (wrapper `ai-muse`), drawn by the allocator for slot 1, sequence 6554, at head `61702d66`. **No verdict was visible at 16:16 UTC.** The head has since moved to `659e4a1d`, so the review must be re-drawn or re-confirmed on the new head.
- Local worktree: branch above, clean. Supabase CLI at v2.105.0 installed on `hetz` from the official release tarball (the shim was missing `supabase-go`). `supabase/.temp/project-ref` is linked to the PREVIEW project; it is gitignored.

### Preview database (shared, protected)
- **Nothing was applied to preview as a recorded migration.** `supabase db push --linked --dry-run` listed about 25 older local migrations that preview's ledger lacks (latest on preview: `20261014043757`), so a push would apply other sessions' work. The migration was instead run inside a transaction and rolled back, and the synthetic test also rolled back.
- Rehearsal results (rolled back): 24,020 rows in `api.dam_order_list`; window last 12 months 3,370; older 17,915; no window date 2,735 (preview data is partial).
- Preview's `coldlion.order_history_line` has **0 rows**, and `order_date` is null for all rows. So real SO values cannot be checked there. Synthetic rows (inserted and rolled back, FK checks disabled for that transaction only) confirmed the rule: same stamp gives 2026-03-05; conflicting stamps give null; 23:30 UTC gives the New York date; other company, malformed, garbage, null, and overflowing inputs all give null.

### Production
- Nothing applied. Promotion has not started.

### App (u2giants/popdam3)
- Branch `claude/orderlist-12-month-filter-74714f`, commit `ff817faa` (feature) — https://github.com/u2giants/popdam3/commit/ff817faa
- Draft PR u2giants/popdam3#417 — https://github.com/u2giants/popdam3/pull/417 — **do not merge until the database change is live**. It reads `order_window_date` from the view; merging first breaks the grid.
- Files: `src/lib/order-list.ts` (`orderWindowStart`), `src/hooks/useOrderList.ts` (`orderWindowStart` clause on rows and count), `src/pages/OrdersPage.tsx` (Show old / Hide old button), `src/test/order-list.test.ts`, `src/test/order-list-block-count.test.ts`, `docs/ORDER_LIST.md`.
- Tests: 59 pass across the order-list, block-count, grid and OrdersPage integration suites. Type check shows no errors in changed files (existing unrelated errors in tag-asset tests remain).
- Not done: visual check in the running app against production data.

## 4. What did NOT work (mandatory)

1. **Function claim name.** `--objects "function dam.x(text)"` was refused with "claim must use a schema-qualified exact name". Claim objects for functions take no argument list.
2. **Malformed reads entry on the issue.** `reads: function public.get_dam_order_sales_order_dates(uuid[])` made the parser fail. Fixed by dropping the argument list in the issue body.
3. **Admission gate fields.** `--admit-issue` also needs `change_type`, `application_return_to` (owner/repo slug), `live_assertion`, and `generated_types: required`. All added to the issue body.
4. **Reviewer draw needs `SHARED_DB_AUTHOR_ENGINE=claude` and `SHARED_DB_SESSION_ID`** (both set to this session's values). With `Refs #4336` the draw refused: "one current keyed canonical evidence pair is required". Structural PRs in this repo use `Closes #<issue>` (precedent: #4270, #4143). Changed the body to that.
5. **Preview push.** `supabase db push --linked` (dry run) tried to apply about 25 older migrations (see Preview section). Not run. Rehearsal used a rolled-back transaction instead.
6. **Supabase CLI shim.** The npm-installed shim could not find `supabase-go`. Fixed by installing the matching release tarball.
7. **Author check-in (`--check-in-author`) and stop-author (`--stop-author`)** both refuse with "must execute in the actual owner session". Source (`requireCheckinOwner` and `prepareAuthorHandoff` in `scripts/manage-migration-author-lanes.mjs`): both call the marker adapter `resolveMarker()` (the adapter name is in the code, not repeated here) and require a live marker, which the owner ruling says is retired. **This is the blocker for both the CI "Migration author lease" check and native release of claim #4337.**
8. **Main baseline red.** `scripts/throughput-guard/check-throughput-truth-audit.test.mjs:153` (`current_repository_catalogues_follow_current_discovery`) fails with "truth-audit semantic inventory drift in scripts/check-exact-head-approval.mjs: contains stale semantic site scripts/check-exact-head-approval.mjs:283". It fails **without** this migration too (verified by moving the migration aside). Fix needs a reviewed disposition for that site; it is not a one-line edit.
9. **Claim lease timing.** Claim #4337 lease expired 16:10 UTC. Expiry does not unlock objects, but any future check-in needs a fresh permission.
10. **Git commit identity** on hetz is fine (`Albert Hazan <u2giants@users.noreply.github.com>`).

## 5. Root causes and key findings

- The SO received date is intentionally not in `api.dam_order_list`; it is read per page by a SECURITY DEFINER RPC (`shared-db/supabase/migrations/20261013211042_popdam_sales_order_received_dates.sql`) because `authenticated` cannot read `coldlion.*`. The new helper `dam.orderlist_sales_order_received_date` follows the same pattern, so the view can use it in SQL.
- `order_window_date` = `coalesce(so_date, po.sent_po_date, pol.start_ship_date)`. Null means no date at all.
- Preview's ledger and local migration history have diverged (`docs/agents/standing-facts.md` fact 6-7 and the "migration history is not a clean replay" note in `shared-db/AGENTS.md`).
- The gate for structural PRs runs a truth audit of semantic sites in `scripts/`; main is currently red there, which makes every structural PR fail for reasons unrelated to it.

## 6. Exact next steps

1. **Owner answers §0 items 1 and 2.** If item 1 is yes, add `order_date` as a fourth fallback in both `coalesce` expressions in the migration (view and any helper), re-run the rolled-back rehearsal, and push.
   - You'll know it worked when the rehearsal shows `window_null` drops and the SQL migration guard stays green.
2. **Fix the main baseline (separate maintenance PR, not this one).** Add a reviewed disposition for `scripts/check-exact-head-approval.mjs:283` (run the truth audit, review the site, update the catalogue), and confirm `Tools offline tests` passes on a clean main-based branch.
   - You'll know it worked when `node --test scripts/throughput-guard/check-throughput-truth-audit.test.mjs` passes on a branch from `origin/main`, and PR #4339 shows Tools offline tests passing.
3. **Resolve the marker dependency.** Decide with an AI reviewer whether `requireCheckinOwner` and `prepareAuthorHandoff` should accept the session identity alone (owner ruling retired markers). This is a technical gate change, so it goes to an assigned AI reviewer. Do not forge check-ins or write a marker by hand.
   - You'll know it worked when `--check-in-author` for claim 4337 returns a renewed lease, and "Migration author lease" passes on PR #4339.
4. **Get the reviewer verdict on the current head `659e4a1d`.** Re-draw the reviewer if the Muse draw is for an old head. Use `--assign-reviewer --admit-issue 4336 --issue 4336 --pr 4339 --head-sha <head>` with the author engine and session variables set.
   - You'll know it worked when the PR has an exact-head APPROVE from an assigned reviewer.
5. **Preview rehearsal through the lane.** Acquire the exclusive preview lease through the lane tool, then apply through the recorded path. Do not `db push` the whole backlog by hand.
   - You'll know it worked when preview's ledger records `20261015154023`, and `api.dam_order_list` has `order_window_date`.
6. **Merge PR #4339 by the normal route, then promote** through the existing production workflow (`ai-task-gates check --before shared-db-promotion`). The claim closes with the merge.
   - You'll know it worked when production's `supabase_migrations.schema_migrations` lists `20261015154023` and `select count(*) from api.dam_order_list where order_window_date is not null` runs without error.
7. **Merge popdam3#417** (mark ready first) after step 6. Then check `/orders` in the running app: default shows the last 12 months, "Show old" adds the older orders, "Hide old" removes them.
   - You'll know it worked when the count drops by the window's older-order count and returns on toggle.

## 7. Constraints and gotchas in force

- Shared-db structural work is claim-first, with no marker (owner ruling 2026-10-02).
- Preview is shared and not clean. Always check the target before any write: `cat supabase/.temp/project-ref` must equal `supabase_shared_preview_ref`.
- The Supabase MCP may be bound to production; use the CLI or `psql` for preview work.
- Never edit an applied migration; fix forward.
- Never `supabase migration repair` for the drift. Land or coordinate the other branch.
- Sign GitHub posts with `Posted by Claude chat <id> on <machine>`.
- Do not merge PR #4339 or popdam3#417 yet (see step 1 and §4).

## 8. Access and environment

- GitHub: `gh` authenticated as the user (u2giants) for popdam3; popcre/shared-db access works through `gh` as used here.
- 1Password vault `vibe_coding`, items referenced by ID only:
  - Supabase CLI personal access token: `3t2xoqk5luyz7ffgdhj24gvtpq`
  - Preview branch database password: `qbvfk7umc3n75ejekd65zwd4ty` (field `DB_PASSWORD`)
- Preview project ref: `ai-private-config value supabase_shared_preview_ref` (protected config, never copy it into a file).
- Supabase CLI v2.105.0 installed on hetz from the official release tarball. Supabase CLI wrapper in `scripts/` is not needed for this work.

## 9. Open questions, risks, stale facts

- **Separate task, not in this handoff:** the repo-wide cleanup of retired-role references is written up as its own prompt.
- **Stale facts (checked 2026-10-15 16:16 UTC):** `origin/main` = `bb7bb220`; latest local migration on main = `20261015132149_pm_jev_activity_triage_contract_a.sql`; PR #4339 head `659e4a1d`; claim #4337 lease expired 16:10 UTC. Re-check all before use.
- **Risk:** the window date depends on SO dates that are sometimes ambiguous (see `docs/ORDER_LIST.md` and PR #4144, which says the ColdLion sales-order `createdTime` is not the customer-order entry date). The product owner accepted the current rule (PR #4270, #4143).
- **Risk:** the Ctrl+F find path (`findOrderListRow`) does not apply the window; it can locate a hidden old row. Known gap, not fixed.
- **Risk:** the migration has not been applied to production; the app PR must not merge before it.
- Unresolved: whether the author lease check needs the lane's exact-head reviewer evidence before the check-in can succeed (not tested).

## Next-session prompt

```
Repo: popcre/shared-db. Branch claude/issue4336-orderlist-so-filter. Handoff: https://github.com/popcre/shared-db/blob/claude/handover-issue4336/HANDOFF.d/2026-10-15T1616Z-hetz-claude-orderlist-so-date-4336.md (on main once the handover PR merges).
Goal: make the 12-month OrderList window (SO date → Sent PO → Start Ship) live in production.
Start by asking the owner the two §0 questions in one message, then continue with §6 steps in order. Do not merge PR #4339 until the reviewer verdict, lease check, and preview rehearsal pass. Do not edit other sessions' HANDOFF.d files.
```
