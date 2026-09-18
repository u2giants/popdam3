# Live acceptance addendum — #401 Step 10, targets 1, 2 and 11 (shared-db#3029)

Addendum to `2026-09-16-live-acceptance-step10-five-outcome-trial.md`. That
report left three targets open: 1 (urgent dispatch, not exercised), 2
(standard dispatch within 1 hour, failed 2 of 5) and 11 (≥50% median
request-to-live improvement, failed at 25.5%). Follow-ups #3149 (target 2)
and #3148 (target 11) asked for the next live outcomes to be re-scored.

Collected 2026-09-18 around 01:28Z, read-only. Method matches the original:
issue ledger comments (`db-outcome-events` / `db-coordination-event` blocks),
issue `createdAt`/`closedAt`, and PR records read with `gh`. No migration,
database write or workflow dispatch was made to produce this report. All
times UTC.

Reference point: PR #3133 (the 30-minute undispatched alarm) merged at
`2026-09-17T02:54:19Z`.

## Outcomes measured

| Issue | Service class, priority (issue scope) | created | entered | dispatched | closed | entered→dispatched |
|---|---|---|---|---|---|---|
| #3154 | standard-application, 40 | 09-17 03:36:53 | 03:56:43.244 | 03:56:43.244 | 09-17 06:27:28 | 0 s |
| #3174 | standard-application, 50 | 09-17 10:25:32 | 11:20:54.990 | 11:20:54.990 | open (PR #3190 merged) | 0 s |
| #2866 | urgent-application, 1 | 09-14 02:48:13 | 02:53:55.975 | 02:54:54.466 | 09-17 08:07:38 | 58.5 s |
| #2870 | urgent-application, 2 | 09-14 03:21:28 | 03:23:26.705 | 03:23:57.094 | 09-17 08:03:44 | 30.4 s |

#3154 and #3174 are the only structural outcomes dispatched after #3133
merged (all 117 `db-work` issues updated since then were checked). Neither
carries a hold or blocker event. #2866 and #2870 predate #3133 and are
included only as the urgent-class evidence the original sample missed.

## Target 1 — urgent dispatch within 10 minutes, or one exact blocker: PASS

Urgent is a real, recorded class (`service_class: urgent-application` in the
issue's `db-work-scope` block; the lane manager ranks it first). Both urgent
outcomes were dispatched in under one minute of `entered` (58.5 s and
30.4 s). When author capacity then ran out, the ledger named the exact
blocker, verbatim:

> `"event_type": "urgent_waiting_capacity"` … `"detail": "all safe author capacity is occupied or object-protected; no active work was preempted"`

recorded at 03:07:15Z (#2866) and 03:39:38Z (#2870) on 09-14. Work resumed
only at about 09-16 23:26Z (`author_capacity_resumed`), roughly 68 hours
later. The target is met as written; the 68-hour capacity wait is a
throughput cost, not a dispatch failure.

Correction to the original report: it stated no outcome carried a
`service_class`. That was true of its five-outcome sample only; #2866 and
#2870 carry one.

## Target 2 — standard dispatch within 1 hour: PASS (n = 2)

#3154 and #3174 each record `"event_type": "dispatched"` at the same
timestamp as `entered` (0 s). The remaining wait sits before `entered`:
issue creation to `entered` took 19 m 50 s (#3154) and 55 m 22 s (#3174),
against 3.4–24.4 h for pre-#3133 standard outcomes (#3036 11.4 h, #3009
24.4 h). #3148's alarm change (PR #3151) targets exactly that pre-entry wait.

## Target 11 — ≥50% median request-to-live improvement: PASS, with caveats

Definition unchanged from the Step 0 baseline
(`2026-09-16-step0-request-to-live-baseline.md`): issue `createdAt` →
`closedAt`, for issues closed by a merged PR that adds a migration. Baseline
median 47.8 h (n = 41); target ≤ 23.9 h.

Structural outcomes closed after the trial sample (after
2026-09-16T16:16:36Z), hours: #3154 2.8, #3074 3.4, #3071 3.7, #3104 10.6,
#3091 12.7, #3036 20.3, #3009 33.8, #2870 76.7, #2866 77.3.

| Population | n | median | vs 23.9 h |
|---|---|---|---|
| Post-trial outcomes | 9 | 12.7 h | PASS (73% improvement) |
| Post-trial + trial five | 14 | 16.5 h | PASS |
| Post-trial, canaries #3071/#3074 excluded | 7 | 20.3 h | PASS |
| Post-trial + trial, all canaries (#3071, #3074, #3043) excluded | 11 | 33.8 h | FAIL |

Exceptions and caveats:

- The verdict holds in three of four populations and fails only when every
  canary is dropped from both samples. The primary scoring (post-trial,
  same definition as the baseline, n = 9) passes.
- #2866, #3036, #3091 and #3104 closed within four seconds of each other
  (08:07:38–08:07:42Z) and #2870 four minutes earlier; none has a
  `live_verified` event, so their close time may be a batch close rather
  than a live proof.
- Six issues whose migration PRs merged are still open and are excluded
  (#3174, #3023, #2478, #2794, #2611, #2662). Their eventual close times
  will be slower, which biases the median toward faster.
- #3074 has no `db-work` label; it is counted because its PR merged a
  migration.

## Verdict

With the original report, all 11 Step 10 targets now have live evidence:
targets 1, 2 and 11 pass on the outcomes above, with the small samples and
caveats stated. The capacity wait behind target 1 (≈68 h) and the
pre-`entered` wait behind target 2 remain the largest time sinks and are
tracked in #3148's stage analysis.
