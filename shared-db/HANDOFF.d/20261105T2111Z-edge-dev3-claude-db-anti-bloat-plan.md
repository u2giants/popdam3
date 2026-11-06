---
issue: 5758
status: OPEN
owner: zcode anti-bloat-5758 (PR #5814 merged; plan Phase B remains)
---

# Handoff: database anti-bloat safeguards plan (#5758)

Written 2026-11-05 4:15 PM EST on edge-dev3 by Claude.

**Open work:** the plan [plan_db-anti-bloat-safeguards.md](../plan_db-anti-bloat-safeguards.md) is written; no step is executed. Start at its STATUS table, Step 0.

**What's known:** ~90% of `coldlion.change_log` is ColdLion merch-group descriptions flapping between a value and blank on identical `/items` full snapshots (plan §6 F1). Other churn writers are listed with file refs in plan §3. `public.assets` is out of scope (see [plan_assets-bloat-permanent-fix.md](../plan_assets-bloat-permanent-fix.md)).

**Owner ruling quoted (Albert, 2026-11-05):** ColdLion rotation "everything for the past 7 days, then once a day for the previous 2 months, then once a week for year"; skip-unchanged writes "seems like there's 0 downside".

**Nothing claimed, no preview or production writes made.** All production reads were SELECT-only through the Supabase MCP.

**Update 2026-11-05 (after Muse debate):** Step 1 is now codes-only with labels joined from `coldlion.merch_group_detail`; the 7-blank-nights rule and its business question are withdrawn. New Step 1v: ColdLion vendor bug report under `docs/verification/db-anti-bloat-5758/` plus a stable-paging guard (`/items` has no sort parameter).

**Update 2026-11-05 10:25 PM EST (ZCode, edge-dev):** Phase A landed, split across
two sessions after a same-night collision:

- **Steps 1 + 2 landed by sibling PR #5807** (claims #5777/#5778, production
  applied 2026-11-06 ~03:00 UTC, ledger 20261106021547): description-flap stop
  (descriptions stay ingested per the 2026-09-03 ruling, excluded from change
  hashes; slot hash `{slotNo, mgCode}`) and the weekly `coldlion.rotate_change_log`
  cron (Sunday 08:00 UTC). **Plan D4's codes-only variant (drop
  `item_merch_group.mg_desc`) was NOT what landed — that divergence is an open
  question on #5758.**
- **Step 0 baseline, Step 1v (vendor report + stable-paging guard) and Step 3a
  (sg embedding no-op writer guards) landed by PR #5814** (claim #5779, migration
  20261106024854, production applied 2026-11-06 03:4x UTC; guards verified live
  read-only). Evidence: `docs/verification/db-anti-bloat-5758/`.
- **3c landed on popdam3 main** (f19cbb9c codes-only hash parity; 2f8f907f bridge
  no-op guard).
- **3b (DesignFlow) is BLOCKED on this machine:** the `popcre` GitHub identity is
  not authenticated here; only `u2giants` is. A successor with popcre auth opens
  the PR to `develop` (never self-merged).
- **Phase B (Steps 4-8) untouched.** Step 1's gate verifies on the SECOND nightly
  run after promotion (night of 2026-11-06 into 11-07); live proof stays unchecked
  on #5758 until then. The rotation's first cron run is Sunday 2026-11-08 3:00 AM
  EST.
