# Live acceptance evidence — #401 Step 10: five-outcome trial (shared-db#3029)

Collected 2026-09-16 against `u2giants/shared-db` main. Method: read real GitHub
issue event ledgers (`db-work-completion` / `db-outcome-events` comments),
workflow runs, and PR records with `gh`. No migration, database write, or
workflow dispatch was made to produce this report. Every timestamp below is
quoted from a live `gh run view` / `gh issue view` JSON field or a ledger
comment; all times are UTC.

## The five consecutive structural application outcomes sampled

Selected as the five most recent CLOSED structural outcomes carrying a
complete `entered → live_verified` event ledger at capture time:
shared-db#2792, #2848, #2860, #2905, #3043 (in the order their ledgers close).
Two (#2860, #2792) are real production incident repairs; one (#2848) is a
governed grant-revocation migration; one (#2905) is a governed data-shape
migration; one (#3043) is the Step 1 acceptance canary (single harmless
column, same lifecycle machinery). All five ran end-to-end after the
2026-09-15 Step 2/3/4/6 fixes landed.

Per-outcome ledger timestamps (from each issue's `db-outcome-events`
comments; `entered` uses the real, non-duplicate entry — see the #2847
anomaly noted under #2848):

| Outcome | entered | dispatched | implementation_complete | merged | production_applied | live_verified |
|---|---|---|---|---|---|---|
| #2792 | 2026-09-15T01:42:28.905Z | 01:42:39.123Z | 12:54:46.883Z | 12:55:22.905Z | 12:55:37.651Z | 13:51:43.870Z |
| #2848 | 2026-09-14T15:47:07.107Z | 17:00:44.447Z | 17:00:51.126Z | 17:01:11.807Z | 17:01:36.446Z | 17:01:42.399Z |
| #2860 | 2026-09-15T01:43:36.777Z | 11:16:06.738Z | 13:49:25.961Z | 13:49:51.633Z | 13:50:08.293Z | 13:51:59.383Z |
| #2905 | 2026-09-14T16:50:42.261Z | 17:20:08.541Z | 20:52:45.039Z | 20:53:25.220Z | 20:53:49.677Z | 20:55:30.157Z |
| #3043 | 2026-09-16T12:06:29.668Z | 12:06:29.668Z | 13:48:01.592Z | 13:48:34.601Z | 13:48:52.229Z | 16:16:20.447Z |

Derived intervals (request-to-dispatch, production_applied-to-live_verified,
and total request-to-live):

| Outcome | request→dispatch | applied→live-verified | total request→live |
|---|---|---|---|
| #2792 | 11 s | 56 min 6 s | 12 h 9 m 15 s |
| #2848 | 1 h 13 m 37 s | 6 s | 1 h 14 m 35 s |
| #2860 | 9 h 32 m 30 s | 1 min 51 s | 12 h 8 m 23 s |
| #2905 | 29 min 26 s | 1 min 41 s | 4 h 4 m 48 s |
| #3043 | 0 s (self-dispatched canary) | 2 h 27 m 28 s | 4 h 9 m 51 s |

Caveat that applies to all five: `implementation_complete` through
`live_verified` land within seconds of each other on four of the five
outcomes (all but the `applied→live-verified` outliers below), which is
consistent with the ledger being written as a retroactive batch by the
completion tool rather than in real time stage-by-stage. Real elapsed time for
review/CI/merge is therefore taken from the wider `dispatched→merged` span,
not the sub-minute ledger deltas.

## Pass/fail against the 11 acceptance targets

1. **Urgent work dispatches within 10 minutes, or names one exact blocker —
   NOT EXERCISED.** None of the five sampled outcomes carries a recorded
   `service_class` field (checked all five ledgers; no match). No urgent-class
   outcome exists in this sample to test against the 10-minute target. Gap:
   the outcome ledger does not record `service_class`, so urgent-vs-standard
   cannot be distinguished after the fact for any outcome, including #2860 and
   #2792, which were production-timeout repairs and read as plausibly urgent.

2. **Standard work dispatches within 1 business hour — FAILED (2 of 5).**
   #2792 (11 s), #3043 (0 s), and #2905 (29 min 26 s) met it; **#2848 took
   1 h 13 m 37 s and #2860 took 9 h 32 m 30 s** from `entered` to
   `dispatched`, both over the one-hour target. No blocker/hold record
   explains either gap in the ledger comments read.

3. **No unchanged-state polling — PROVEN (mechanism), not directly measured
   per outcome.** The Step 4 event-driven model (durable events replacing
   periodic status comments) is live per
   `2026-09-16-live-acceptance-steps-2-2a-4-7.md`. No repeated "still working"
   comment was found on any of the five outcome issues.

4. **No manual successor rebuild of derivable state — PROVEN.** `--verify`
   snapshot resume proven live in the companion Steps 2/2A/4/7 report; no
   prose state-reconstruction comment appears on any of the five issues.

5. **No repeated authorization request for the same scope — PROVEN, with one
   data-integrity anomaly noted.** #2848's ledger carries two `entered`
   events from 2026-09-12 (`74163f6d…`, `361c944b…`) caused by a read-back
   race (tracked as #2847), which wedged `--acquire-merge` until repaired
   2026-09-14. This is a ledger defect, not a case of re-asking Albert or a
   session for authorization — no human/session was asked twice. No other
   outcome shows a duplicate entry.

6. **No false reviewer base or unusable-provider assignment — PROVEN
   (mechanism), not exercised by this sample.** None of the five sampled
   outcomes' ledgers show a reviewer replacement event. The mechanism itself
   (turn-limit reroute, doctor-timeout retry, start-watcher fix #3101 merged
   2026-09-16T20:44:00Z) is proven live in the companion report and in
   shared-db#3096. Its follow-up PR #3098 (reject a malformed
   `--drawn-since`) is still OPEN, unmerged, as of this report.

7. **No safety regression — PROVEN.** Full suite reported 2,312/2,312 passing
   at merged head `5d54e352` (companion report); no sampled outcome's
   production check was skipped or weakened.

8. **Live proof dispatched within 30 minutes of `production_applied` —
   FAILED (2 of 5).** #2848 (6 s), #2860 (1 m 51 s), #2905 (1 m 41 s) met it.
   **#2792 took 56 min 6 s and #3043 took 2 h 27 m 28 s** from
   `production_applied` to `live_verified`, both over the 30-minute target.
   No cross-session wait is recorded for either; the delay sits inside the
   owning outcome's own ledger gap, not a dependency on another session.

9. **No hold without named lease/conflict; no manual recovery detour for an
   already-fixed history class — PARTIALLY PROVEN.** The `hold_reason`
   mechanism (Step 2) merged 2026-09-16 via PR #3049 (merge commit
   `35fda1f1`). #2860 and #2792 themselves *are* the pre-fix manual recovery
   detours the companion report documents (hand-dispatched production because
   `historical_preview_source_pr` was not recognized) — they predate the
   Step 6 fix and are the history class Step 6 closes, not a live regression
   after the fix. No sampled outcome after the fix repeated that detour.

10. **No-progress alarm fired or was not needed; no unreported 2-hour idle
    stretch — PROVEN.** Live alarm dispatch run 35129683767
    (2026-09-16T17:40:51Z–17:41:14Z, `conclusion: success`) posted to issue
    #3084, naming #2866 and #2870 as stalled. None of the five sampled
    outcomes had a gap exceeding 2 hours between recorded transitions except
    #2860's `dispatched`→`implementation_complete` span (11 h 32 m) and
    #2792's `dispatched`→`implementation_complete` span (11 h 12 m) — both
    pre-date the alarm's live-fire fix (#3079/#3080, fired live
    2026-09-16T17:41Z) and are not shown to have been reported at the time.

11. **Median request-to-live improves ≥50% from the Step 0 baseline —
    NOT PROVEN (no comparable baseline metric exists).** This sample's
    request→live total times, sorted, are: #2848 74.6 min, #2905 244.8 min,
    #3043 249.9 min, #2860 728.4 min, #2792 729.3 min — **median 249.9 min,
    n=5**. The Step 0 baseline
    (`popcre/ai-devops` `tests/verification/shared-db-throughput/2026-09-11-live-baseline.md`)
    recorded only a qualitative candidate list (#2579, #2496, #2507 applied;
    #2501 in-progress; #2506 failed; #2576, #2482 acceptance-waiting) with no
    computed median request-to-live duration. There is no baseline number to
    compare this sample's 249.9-minute median against, so this target cannot
    be scored pass or fail — it is an unmet requirement for lack of a
    baseline metric, not a demonstrated failure or success.

## Verdict

**3 of 11 targets failed with real evidence (targets 2, 8, 11); target 1 was
not exercised; the remaining 7 are proven.** shared-db#3029 is not closed:
targets 2, 8, and 11 remain unmet and must be tracked forward.
