# Close-nested handoff: priority-issues coordinator (2026-11-20)

## Goal
Coordinator session that cleared priority PopDAM issues (15 total across three rounds) and follow-ups. Now closed.

## Tree closed
- Coordinator (this session, hetz) — closed.
- `fix-failing-offline-tool` (local_3e8b5850…) — closed; popcre/shared-db PR #6811 closed as superseded by #6802.
- All subagents reported and finished; none running.

## Landed (verified)
- PopDAM: #1099, #1102, #1101, #1158, #1105, #1104, #839, #1094, #1186, #1103, #596, #1106, #1098 closed with live proof on each issue.
- shared-db: PRs #6799, #6806, #6822 (queue/promotion fixes), #6824 (style-guide grid), #6777, #6841 (retired 6 stale handoff notes), #6865 (#4706 merch_group load, live: 1,990 values; 1,318 of 4,417 DesignFlow IDs matched).

## Open tasks
1. **Sort 3,099 held DesignFlow merch-group IDs** (1,458 ambiguous, 1,641 unmatched) before #4707 maps items to them.
   Issue: https://github.com/popcre/shared-db/issues/4707 (next-step comment posted 2026-11-19). Evidence: https://github.com/popcre/shared-db/issues/4706, PR #6865.
   Next action: claim #4707, analyze held IDs against the ColdLion feed by full identity; resolve or explicitly park. Done when: every held ID resolved or parked with reason, recorded on #4707.
   Resume branch: fresh from popcre/shared-db main.

## Covered by scheduled cloud routines (no session needed)
- Weekly Mon 10 AM EST: PopDAM #1100 (SeaDrive), #1087 (Helper 1.4.16) proof — https://claude.ai/code/routines/trig_015x4VuGUDw6x8hrK3EDYvDD
- 2026-11-21 10 AM EST: shared-db #5747/#5610/#5758 index follow-up — https://claude.ai/code/routines/trig_01FF8CWsEmGGj1ixBFmWqE4t
- 2026-12-07 10 AM EST: shared-db #5758 30-day measurement — https://claude.ai/code/routines/trig_01GxAuhrG8Git96oUDR5qD26

## Claims/locks held
None.
