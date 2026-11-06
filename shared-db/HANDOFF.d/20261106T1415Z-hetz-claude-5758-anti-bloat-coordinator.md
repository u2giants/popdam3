# HANDOFF — #5758 database anti-bloat: coordinator for Steps 4–8 and the first history cleanup

Written 2026-11-06 9:15 AM EST by Claude chat 0f66eca0-8065-44b1-8fba-bbc582b004a9 on hetz.
Owning issue: https://github.com/popcre/shared-db/issues/5758
Plan: https://github.com/popcre/shared-db/blob/main/plan_db-anti-bloat-safeguards.md (STATUS table is authoritative)

## 1. Goal
Finish plan_db-anti-bloat-safeguards.md Steps 4–8. Also run the first ColdLion change-history cleanup on
**Fri 2026-11-06 at 10:00 PM EST (03:00 UTC Sat Nov 7)** instead of waiting for the weekly Sunday run. Albert asked for this on
2026-11-06, quoted: "can we run the cleanup of old history tonight (10pm EST Fri Nov 6 2026) so that we can get moving earlier on resolving these issues?"

## 2. Done (verified live on production qsllyeztdwjgirsysgai)
- Step 1 (ColdLion description flapping) landed in PR https://github.com/popcre/shared-db/pull/5807.
  - Nightly merch-group `updated` change_log rows: 43,415 on Nov 5, **0** on Nov 6.
  - item_header `updated` rows: 9,000, then 1,213.
  - Labels are kept: 173,250 of 252,613 slots have mg_desc.
  - Proof comment: https://github.com/popcre/shared-db/issues/5758#issuecomment-6686680128
- Step 2 (rotation) is live:
  - The function `coldlion.rotate_change_log(p_dry_run)` was added by migration 20261106021547, and execute is granted to service_role only.
  - Cron job `coldlion-change-log-rotation` runs `0 8 * * 0` (Sunday 3:00 AM EST). Its first scheduled run is 2026-11-08.
  - Dry-run ranking: daily tier 5,072 rows to delete, weekly 0, older 0, with 0 newest-per-key lost.
- Steps 0, 1v and 3a, and the STATUS update, landed in PR https://github.com/popcre/shared-db/pull/5814 (ZCode session on edge-dev).
- Claims #5777 and #5778 are closed. Review finding #5764 is closed.
- This session holds no claims; ai-shared-db-closeout-check returned ok.

## 3. Remaining work (one nested subsession each; the coordinator only routes and verifies)
A. **Early cleanup tonight (urgent, must be in production before 10:00 PM EST Nov 6).**
   - Claim the cron job on #5758 first. Then reserve a version: `node scripts/check-dispatch-collision.mjs --objects "cron.job coldlion-change-log-rotation-once" --reserve-version`.
   - The migration schedules a one-shot pg_cron job `coldlion-change-log-rotation-once` at `0 3 7 11 *`. The job runs `select * from coldlion.rotate_change_log(false)` and then calls `cron.unschedule('coldlion-change-log-rotation-once')`.
   - Copy the cron pattern from https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261106021547_coldlion_change_log_rotation.sql
   - Land it through a PR, the merge queue and automatic promotion. Never run a manual production command.
   - At 10:05 PM EST, verify read-only:
     - in cron.job_run_details, the job succeeded;
     - in change_log, about 5,072 fewer rows, and the count of distinct (table_name, natural_key) is unchanged;
     - the job is gone.
   - Post the proof on #5758.
   - Fallback if it cannot reach production by 10 PM: let the Sunday 3:00 AM EST run do it and say so on #5758. Do not hand-run it.
B. **Step 4**: move lease/attempt/error off `style_guide_search_documents` into a narrow jobs table. Also add the hts_rag ingest-job 30-day retention. Plan §3 Step 4.
C. **Step 5**: index audit (not `public.assets`). Take the first snapshot now and the second 14 or more days later. Plan Step 5.
D. **Step 6**: weekly bloat check workflow and standing "Weekly database health" issue. Plan Step 6. It must not flag change_log free space as a writer problem.
E. **Step 7**: governed automatic compaction allowlist. Needs D. Plan Step 7.
F. **Step 8**: after-measurement, 7 days and 30 days after Steps 1–4 land. Plan Step 8. It waits on B.

## 4. Order and dependencies
- A first and alone (deadline tonight).
- B, C and D can run in parallel. E waits for D. F waits for B, plus 7 days.
- Each structural item claims its exact objects on #5758 first (claim-first; load shared-db-change).

## 5. Out of scope
`public.assets` belongs to #5747 (plan_assets-bloat-permanent-fix.md). Step 3b (DesignFlow) is blocked on the popcre identity; it is listed in STATUS.

## 6. Tried / learned
- The merge queue ejects migrations whose version is older than main's newest. Re-reserve and rebase.
- `gh pr merge --auto` silently failed once; a plain enqueue worked.
- Wait with `/usr/local/bin/ai-pr-wait <pr> --repo popcre/shared-db` (always pass --repo; exit 2 means rerun).
- The Supabase MCP is read-only on production and cannot call rotate_change_log.
- The production promotion workflow runs one PR at a time, so leave queue time for A.

## 7. Verification
- STATUS rows 4–8 are updated with evidence.
- #5758 live_assertion is ticked.
- #5758 is closed when Step 8 passes.

## 8. Risks
- Rotation deletes history. The function already keeps the newest row per key, and its contract test passed.
- The 10 PM run collides with nothing known. The ColdLion sync is 12:20 AM EST.

## 9. Next action
Coordinator: start subsession A immediately, then B, C and D.
