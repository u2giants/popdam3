# Handoff: database anti-bloat safeguards plan (#5758)

Written 2026-11-05 4:15 PM EST on edge-dev3 by Claude.

**Open work:** the plan [plan_db-anti-bloat-safeguards.md](../plan_db-anti-bloat-safeguards.md) is written; no step is executed. Start at its STATUS table, Step 0.

**What's known:** ~90% of `coldlion.change_log` is ColdLion merch-group descriptions flapping between a value and blank on identical `/items` full snapshots (plan §6 F1). Other churn writers are listed with file refs in plan §3. `public.assets` is out of scope (see [plan_assets-bloat-permanent-fix.md](../plan_assets-bloat-permanent-fix.md)).

**Owner ruling quoted (Albert, 2026-11-05):** ColdLion rotation "everything for the past 7 days, then once a day for the previous 2 months, then once a week for year"; skip-unchanged writes "seems like there's 0 downside".

**Nothing claimed, no preview or production writes made.** All production reads were SELECT-only through the Supabase MCP.
