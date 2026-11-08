---
issue: 5758
status: OPEN
owner: claude/5758-close-nested-handoff
---

# HANDOFF — #5758 anti-bloat coordinator tree closed (close-nested)

Written 2026-11-08 8:05 AM EST by the #5758 coordinator Claude session on edge-dev3.
Owning issue: https://github.com/popcre/shared-db/issues/5758
Plan (STATUS table is authoritative): https://github.com/popcre/shared-db/blob/main/plan_db-anti-bloat-safeguards.md
Predecessor handoff: https://github.com/popcre/shared-db/blob/main/HANDOFF.d/20261106T1415Z-hetz-claude-5758-anti-bloat-coordinator.md

## 1. Goal
Finish plan Steps 5 and 8, plus three carried follow-ups, so #5758 can close. Albert's authority, quoted: "can we run the cleanup of old history tonight (10pm EST Fri Nov 6 2026) so that we can get moving earlier on resolving these issues?" (item A, now done), and the coordinator brief for Steps 4–8 on #5758.

## 2. Tree closed
All six sessions are closed. None holds claims or locks: each one's closeout check returned ok.
- Item A, the one-shot rotation (session local_a7f0aee2): complete. Its branches were deleted after merge.
- Step 4 (local_6d160c62): complete; claim #5890 closed.
- Step 5 (local_a116387e): snapshot 1 is done; snapshot 2 runs automatically.
- Step 6 (local_abaa5a0d): complete.
- Step 7 (local_278ac5b4): complete.
- Coordinator (this session): this file is its only output.

## 3. Landed (verified merged on GitHub)
- #5929: the one-shot rotation (migration 20261106205842). It ran 2026-11-06 at 10:00 PM EST and deleted 5,073 rows; distinct keys were preserved and the job removed itself. Proof: https://github.com/popcre/shared-db/issues/5758#issuecomment-6701421552
- #5885: the original version of that migration. It was parked, never applied, and superseded by #5929.
- #5918: preview rehearsal now ignores main moves that cannot affect production.
- #5893, #5923 (Step 4): new table `public.style_guide_search_embedding_jobs` and the hts_rag 30-day retention job. Live proof: https://github.com/popcre/shared-db/issues/5758#issuecomment-6694318836
- #5887 (Step 5 snapshot 1): 55 indexes.
- #5888, #5897 (Step 6): `.github/workflows/db-bloat-weekly.yml`, runs Mon 6:00 AM EST, reports to #5886.
- #5900, #5905, #5917, #5920 (Step 7): allowlist `config/table-repack-allowlist.json`. Preview repack proof: run 42274302101.
- The first weekly Sunday rotation ran 2026-11-08 at 3:00 AM EST and succeeded, leaving 0 rows still due for deletion. The #5758 live-proof gates (i) and (ii) passed: https://github.com/popcre/shared-db/issues/5758 (comment of 2026-11-08 6:20 AM EST).

## 4. Open tasks (one nested session each)

### T1. Promotion starvation fix — #5937 (unowned, ready now)
- **Issue:** https://github.com/popcre/shared-db/issues/5937. It supersedes #5915.
- **Goal:** stop urgent migrations from being starved in automatic promotion. Three parts:
  - deadline ordering;
  - a backstop merge freeze after 2 refusals for "main moved", with a 15-minute time-to-live, enforced by the merge-queue gate;
  - "main moved" refusals no longer charge the refund budget.
- **State:** design verdict is in comment 6721796604 on #5937. No code has been written.
- **Next action:** load `shared-db-change`, implement per that verdict, then PR → merge queue.
- **Done when:** the three criteria on #5937 are proven on a real promotion.
- **Resume:** fresh from origin/main.
- **Note:** a blocking check counts as a merge-blocking gate under the lean-checks ruling. Keep the freeze inside the existing merge-queue gate, and do not add a new required check.

### T2. Retire the old assets-only bloat job (ready now)
- **Goal:** remove the assets-bloat job in `.github/workflows/migration-ledger-drift.yml`. The weekly check from Step 6 now covers it.
- **State:** both monitors have run; the weekly check's first live run was 42254443787. The request is on #5747: https://github.com/popcre/shared-db/issues/5747#issuecomment-6691556857. No session has picked it up; searches of other sessions found none.
- **Next action:**
  - Confirm `public.assets` appears in the weekly check output on #5886.
  - Remove only that job, then PR it.
  - Post a note on #5747.
- **Done when:** the job is gone on main, the next weekly run still reports `public.assets`, and #5747 has the note.
- **Don't:** change anything else on `public.assets`; #5747 owns it.

### T3. Step 8 seven-day after-measurement (due Fri 2026-11-13)
- **Goal:** repeat the Step 0 baseline into `docs/verification/db-anti-bloat-5758/<ts>/after.md`. Check two gates:
  - Step 1: nightly updated rows down more than 90%. This already passed, so restate it.
  - Step 4: HOT updates at least 70% over 7 days on `style_guide_search_documents`.
- **Also:** recheck the weekly check's likely-writer attribution, which was empty on Nov 6 because the counters had been reset. Use the Mon 2026-11-09 run on #5886.
- **Existing scheduler:** a desktop scheduled task `shared-db-5758-step8-after-measurement` exists on edge-dev3 for 2026-11-13 3:30 PM EST. It only runs if the app is open. If a coordinator session handles T3 itself, disable that task to avoid running it twice.
- **Next action (on or after 2026-11-13 3:06 PM EST):** measure read-only, commit the evidence, update STATUS row 8, and post on #5758.
- **Done when:** STATUS row 8 has the 7-day evidence.

### T4. Step 5 snapshot 2 and drop decision (after 2026-11-20)
- **State:** snapshot 2 runs automatically on 2026-11-20 at 9:00 AM EST.
- **Next action:**
  - Compare it with snapshot 1: `docs/verification/db-anti-bloat-5758/20261106T1529Z/index-usage-snapshot-1.md`.
  - Choose drops by the plan's Step 5 criteria. Never touch `public.assets`.
  - Claim on #5758, then migrate via PR and automatic promotion.
- **Done when:** STATUS row 5 is ✅ with live evidence.

### T5. Step 8 thirty-day measurement and closing #5758 (after T3 and T4; on or after 2026-12-06)
- **Next action:** repeat the measurement at 30 days. Then:
  - update STATUS row 8 to ✅;
  - close #5758, leaving the Step 3b (designflow-backend#372) and D4 pointers on the issue.
- **Done when:** #5758 is closed with the evidence linked.

## 5. Child handoffs
None. Every child finished, with nothing that needed a handoff file.

## 6. Learned
- Production promotion serialises one PR at a time. Real script merges on main void a running rehearsal; PR #5918 fixed this only for test and doc changes. #5937 is the rest.
- An unapplied migration whose version is older than main's newest needs a re-version, as #5929 did.
