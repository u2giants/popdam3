---
issue: 100
status: BLOCKED
owner: codex/orderlist-count-indexes-100
---

# OrderList cold-load timeout — additive shared-db indexes are queued

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

None for diagnosis or implementation direction. The earlier three-option choice is withdrawn because production `EXPLAIN (ANALYZE, BUFFERS)` disproved its premise. The repair is the two additive indexes in shared-db #1657.

If the shared-db production workflow asks Albert to approve the exact promoted migration after preview, recommend approval only when preview proves the expected plan, cold authenticated timing with headroom, and rollback. This is the normal production gate, not a choice among competing fixes.

Already settled — do not re-ask:

- 2026-08-26: rows and exact count remain separate requests; re-merging them recreates the original outage.
- 2026-08-27: approximate totals, a security-definer count RPC, and a summary table are not the repair for this measured cause.
- 2026-08-27: the AG Grid Enterprise licence key is outside this workstream.

## 1. What this application is

PopDAM is POP Creations' internal digital asset manager. Its `/orders` page replaced the legacy OrderList sheet and shows production-order lines to internal staff. App repository `u2giants/popdam3` is locally `/worksp/popdam`; production is `https://dam.designflow.app/orders`. The shared Supabase database is project `qsllyeztdwjgirsysgai`; all structural changes belong in `u2giants/shared-db`, locally `/worksp/shared-db`.

The browser uses the `authenticated` role with an eight-second statement timeout. Rows and exact total are deliberately fetched separately so a slow count degrades honestly instead of taking down the grid.

## 2. What we set out to do this session, and why

This replacement reconciles the 2026-08-27 handoff with later production query-plan evidence. The old file blamed per-row RLS and asked Albert to choose among a security-definer RPC, estimated total, or summary table. A later authenticated production `EXPLAIN` proved that diagnosis and choice false.

The current objective is to land and verify two additive indexes through shared-db #1657, then prove `/orders` no longer approaches the eight-second ceiling on cold loads.

## 3. Current state — what is true right now

- PopDAM issue [#100](https://github.com/u2giants/popdam3/issues/100) is OPEN. No app code change is required for the proposed repair.
- Production baseline on 2026-08-27: unfiltered exact count over `api.dam_order_list` was observed at 3.4 seconds and intermittently contributed to `canceling statement due to statement timeout` on cold page loads.
- Authenticated production `EXPLAIN (ANALYZE, BUFFERS)` showed 24,486 result rows and about 24,835 shared-buffer reads (~194 MB). Major cold reads were sequential scans of `plm.style_tracker_item_bridge` (~132 MB) and `plm.production_order_line` (~57 MB).
- Every relevant read policy is `using (true)` and folds away; warm count was about 161 ms. RLS is not the expensive work.
- `plm.style_tracker_item_bridge` lacks an index on `plm_item_id`, the column used by `api.dam_order_list`. The join genuinely fans out and cannot be pruned.
- Production `hypopg` validation was hypothetical/read-only: adding `(plm_item_id)` changed the bridge scan to Memoize + index scan; adding `(production_order_id, item_id, id)` changed the order-line scan to index-only. Estimated cold reads fell about 90%, from ~24,800 to ~2,000.
- The requested indexes are filed in shared-db [#1657](https://github.com/u2giants/shared-db/issues/1657). That issue is OPEN and queued for the shared-db orchestrator; nothing was written to preview or production.

## 4. Everything we tried that did NOT work

1. **Blaming row-level security.** Disproved by policy inspection and authenticated production plans; all policies are `using (true)` and warm execution is fast.
2. **Security-definer count RPC.** Rejected because it removes a check that costs effectively nothing while retaining the same cold 194 MB scan.
3. **Estimated total.** Rejected as symptom masking; it changes a staff-visible number and does not fix the same cold joins used by row queries.
4. **Maintained summary table.** Rejected as extra machinery for missing indexes.
5. **Re-merging rows and count.** This is the original outage mode and is locked out by `src/test/order-list-block-count.test.ts` and `docs/KNOWN_QUIRKS.md` #75.
6. **Measuring as `postgres` or using only warm timings.** Misleading because the user role has the eight-second ceiling and the failure is cold-cache IO.
7. **Direct production index creation.** Not attempted; shared structure must go through canonical shared-db governance.

## 5. Root causes and key findings

- The root cause is cold sequential IO on two join inputs, led by a missing bridge join index—not RLS.
- `plm.style_tracker_item_bridge` is about five times bloated (roughly 132 MB heap for ~24 MB live data), but the indexes make a repack non-urgent and repack is outside #100.
- The bridge fanout is real, so planner join elimination is not safe; index the join instead.
- Both indexes help the exact count, and the bridge index also helps block row queries that use the same join.
- The repair is additive and requires no generated type or PopDAM API change.
- `CREATE INDEX CONCURRENTLY` must run outside a transaction according to shared-db's non-transactional migration procedure.

## 6. Exact next steps

1. Re-read PopDAM #100, shared-db #1657, current `/worksp/shared-db/AGENTS.md`, and current orchestrator/claim state. Verify exact production/preview target before any write. **You'll know it worked when** #1657 has one live owner and no competing index migration.
2. Through the shared-db orchestrator, author a non-transactional migration creating `plm.style_tracker_item_bridge_plm_item_idx` on `(plm_item_id)` and `plm.production_order_line_count_cover_idx` on `(production_order_id, item_id, id)`, using the repo's safe concurrent-index pattern. **You'll know it worked when** guards and exact-head review pass and rollback is `DROP INDEX CONCURRENTLY` for the two named indexes.
3. Apply to preview first and run production-scale `authenticated` `EXPLAIN (ANALYZE, BUFFERS)` plus cold timing. **You'll know it worked when** there is no sequential scan on the bridge, order lines use the expected index/index-only path, count stays well below eight seconds with stated headroom, and no write-path regression appears.
4. Merge/promote through the canonical workflow, prove the production target, then repeat the authenticated cold plan/timing. **You'll know it worked when** both indexes exist in the production ledger and the real query plan/timing matches the acceptance evidence.
5. Load `https://dam.designflow.app/orders` ten times in fresh browser contexts and record banner/pager/request failures. Keep the row/count split tests unchanged. **You'll know it worked when** ten of ten loads are clean, the exact total appears, and no count approaches the ceiling.
6. Update `docs/KNOWN_QUIRKS.md` #75 and `docs/ORDER_LIST.md` with the final cause, indexes, and measured proof; close #100 and delete this handoff. **You'll know it worked when** issue #100 is CLOSED and no stale issue-100 handoff remains.

## 7. Constraints and gotchas in force

- Shared database structure changes are authored only in `/worksp/shared-db` through branch, PR, preview, merge, and target-proven production workflow.
- Do not create these indexes directly in production, in the Supabase Dashboard, or under PopDAM's historical migrations.
- Preserve two requests for rows and exact count; do not weaken honest unknown-total behavior.
- Test cold as `authenticated`, not merely warm and not as `postgres`.
- Use non-transactional/concurrent index migration rules exactly; these indexes target importer-written tables, so confirm write impact.
- Do not widen scope into bridge-table repack, approximate totals, AG Grid licensing, or other grids.
- Protect concurrent checkouts and stage only owned files.

## 8. Access and environment

- PopDAM: `/worksp/popdam`, GitHub `u2giants/popdam3`, production `dam.designflow.app/orders`.
- Shared DB: `/worksp/shared-db`, GitHub `u2giants/shared-db`, issue #1657.
- Shared Supabase production project: `qsllyeztdwjgirsysgai`.
- Exact preview/production target-proof and credential procedures are in `/worksp/shared-db/AGENTS.md`. Secrets live in 1Password vault `vibe_coding`; never print values.
- GitHub CLI was authenticated during the 2026-08-27 reconciliation. Reverify database access and targets before use.

## 9. Open questions and risks

- The hypothetical plan improvement must be confirmed on preview and then real production; `hypopg` predicts but does not create or benchmark the actual indexes.
- Cold timing is cache/load dependent, so record buffers and plan nodes as well as elapsed time.
- Concurrent index creation still consumes IO/CPU and can fail; follow shared-db monitoring and rollback procedure.
- Bridge-table bloat remains, but repacking it is a separate maintenance decision and is not needed to prove this repair.
- If the actual indexes do not create sufficient cold headroom, stop and re-diagnose from the new plan rather than falling back to the disproved RLS/RPC theory.

## Self-audit

Passed 2026-08-27. Sections 0–9 are complete. §3 records production measurements and exact blocked route; §4 preserves the false diagnosis and every rejected workaround; §5 holds the non-obvious plan/bloat findings; §6 is executable with gates; §§7–9 preserve governance, access, and risks without secrets. A line-by-line sweep found no unresolved owner choice beyond the normal production promotion gate named in §0.
