# Step 0 request-to-live baseline and target 11 score (shared-db#3128, #3029)

Collected 2026-09-16 from live `gh` data against `u2giants/shared-db` main at
`0c16ff3f`. Read-only: no migration, database write, or workflow dispatch.

## Why a shared proxy definition is required

Target 11 of the Step 10 trial
([report](2026-09-16-live-acceptance-step10-five-outcome-trial.md)) measures
request→live as ledger `entered` → `live_verified`. That ledger
(`db-outcome-events`) did not exist before the #401 changes: none of the Step 0
candidates (#2579, #2496, #2507, #2501, #2506) carries a ledger comment
(checked, 0 each). The ledger's `entered` is also not the request time: #2792
was created 2026-09-11T17:06:42Z but `entered` 2026-09-15T01:42:28Z.

Both sides are therefore measured with one definition that exists for every
outcome: **request→live = issue `createdAt` → issue `closedAt`**, for the issue
closed by a merged PR that added a file under `supabase/migrations/`.

## Baseline sample (pre-#401, Step 0 week)

Every first-parent merge to main adding a migration between
2026-09-04T00:00:00Z and 2026-09-11T00:00:00Z (the Step 0 baseline date): 44
PRs. Issue link from the PR's `closingIssuesReferences`, else the issue number
in the branch name. Excluded: PR #2386 (issue #2204 still open). Two older PRs
share an issue with a later PR and are counted once via the later PR (#2447 →
#2439, #2512 → #2506). n = 41.

Commands: `git log origin/main --since=2026-09-04T00:00:00Z
--until=2026-09-11T00:00:00Z --first-parent --diff-filter=A --
supabase/migrations`, then `gh pr view <n> --json
closingIssuesReferences,headRefName,mergedAt` and `gh issue view <n> --json
createdAt,closedAt`.

| PR | Issue | Link source | PR merged | Issue created | Issue closed | Hours |
|---|---|---|---|---|---|---|
| #2316 | #2313 | closingIssuesReferences | 2026-09-04T19:06:14Z | 2026-09-04T17:23:06Z | 2026-09-04T20:08:26Z | 2.8 |
| #2505 | #2496 | closingIssuesReferences | 2026-09-07T14:39:29Z | 2026-09-07T12:03:03Z | 2026-09-07T14:48:30Z | 2.8 |
| #2360 | #2349 | closingIssuesReferences | 2026-09-05T04:00:20Z | 2026-09-04T22:53:59Z | 2026-09-05T04:13:39Z | 5.3 |
| #2649 | #2644 | closingIssuesReferences | 2026-09-10T00:06:57Z | 2026-09-09T18:01:57Z | 2026-09-10T00:26:02Z | 6.4 |
| #2674 | #2670 | closingIssuesReferences | 2026-09-10T14:55:21Z | 2026-09-10T12:31:31Z | 2026-09-10T22:42:52Z | 10.2 |
| #2384 | #2331 | closingIssuesReferences | 2026-09-05T08:17:08Z | 2026-09-04T21:09:42Z | 2026-09-05T08:30:41Z | 11.3 |
| #2388 | #2333 | closingIssuesReferences | 2026-09-05T10:28:58Z | 2026-09-04T21:23:59Z | 2026-09-05T11:09:26Z | 13.8 |
| #2423 | #2408 | closingIssuesReferences | 2026-09-06T13:26:24Z | 2026-09-06T03:42:23Z | 2026-09-06T22:25:36Z | 18.7 |
| #2513 | #2509 | branch name | 2026-09-08T07:42:18Z | 2026-09-07T13:11:57Z | 2026-09-08T12:46:18Z | 23.6 |
| #2474 | #2419 | closingIssuesReferences | 2026-09-07T05:32:04Z | 2026-09-06T04:01:05Z | 2026-09-07T05:32:28Z | 25.5 |
| #2627 | #2580 | branch name | 2026-09-09T19:49:17Z | 2026-09-08T15:11:00Z | 2026-09-09T20:08:38Z | 29.0 |
| #2259 | #2202 | closingIssuesReferences | 2026-09-04T15:44:45Z | 2026-09-03T12:10:32Z | 2026-09-04T17:30:41Z | 29.3 |
| #2651 | #2622 | closingIssuesReferences | 2026-09-10T04:27:30Z | 2026-09-09T02:47:51Z | 2026-09-10T14:38:23Z | 35.8 |
| #2584 | #2535 | closingIssuesReferences | 2026-09-08T21:43:44Z | 2026-09-07T17:21:34Z | 2026-09-09T06:18:03Z | 36.9 |
| #2382 | #2203 | branch name | 2026-09-05T07:12:46Z | 2026-09-03T12:14:59Z | 2026-09-05T07:25:54Z | 43.2 |
| #2339 | #2212 | branch name | 2026-09-05T13:08:05Z | 2026-09-03T16:46:00Z | 2026-09-05T13:08:48Z | 44.4 |
| #2452 | #2449 | branch name | 2026-09-08T03:02:35Z | 2026-09-06T14:49:07Z | 2026-09-08T12:16:44Z | 45.5 |
| #2397 | #2214 | branch name | 2026-09-05T15:49:00Z | 2026-09-03T17:14:38Z | 2026-09-05T15:49:17Z | 46.6 |
| #2399 | #2213 | closingIssuesReferences | 2026-09-05T16:12:39Z | 2026-09-03T17:14:37Z | 2026-09-05T16:13:00Z | 47.0 |
| #2201 | #2196 | closingIssuesReferences | 2026-09-05T10:59:09Z | 2026-09-03T12:05:19Z | 2026-09-05T11:05:00Z | 47.0 |
| #2200 | #2172 | closingIssuesReferences | 2026-09-05T02:33:30Z | 2026-09-03T02:48:52Z | 2026-09-05T02:39:27Z | 47.8 |
| #2415 | #2355 | closingIssuesReferences | 2026-09-07T02:55:08Z | 2026-09-05T01:30:51Z | 2026-09-07T02:58:31Z | 49.5 |
| #2676 | #2576 | closingIssuesReferences | 2026-09-10T15:55:24Z | 2026-09-08T13:17:38Z | 2026-09-10T15:56:21Z | 50.6 |
| #2409 | #2334 | branch name | 2026-09-07T05:15:54Z | 2026-09-04T21:24:13Z | 2026-09-07T05:16:47Z | 55.9 |
| #2490 | #2335 | closingIssuesReferences | 2026-09-07T06:15:53Z | 2026-09-04T21:24:24Z | 2026-09-07T06:16:25Z | 56.9 |
| #2185 | #2175 | branch name | 2026-09-05T12:11:01Z | 2026-09-03T02:48:58Z | 2026-09-05T12:11:18Z | 57.4 |
| #2228 | #2159 | closingIssuesReferences | 2026-09-05T11:38:15Z | 2026-09-03T02:10:41Z | 2026-09-05T11:38:39Z | 57.5 |
| #2183 | #2177 | closingIssuesReferences | 2026-09-05T13:21:32Z | 2026-09-03T02:50:42Z | 2026-09-05T13:22:04Z | 58.5 |
| #2186 | #2173 | closingIssuesReferences | 2026-09-05T13:37:42Z | 2026-09-03T02:48:53Z | 2026-09-05T13:38:13Z | 58.8 |
| #2398 | #2174 | closingIssuesReferences | 2026-09-05T15:29:28Z | 2026-09-03T02:48:57Z | 2026-09-05T15:29:50Z | 60.7 |
| #2612 | #2440 | closingIssuesReferences | 2026-09-09T06:06:52Z | 2026-09-06T13:41:38Z | 2026-09-09T06:18:05Z | 64.6 |
| #2634 | #2466 | closingIssuesReferences | 2026-09-09T18:15:28Z | 2026-09-06T18:42:10Z | 2026-09-09T18:29:45Z | 71.8 |
| #2631 | #2543 | closingIssuesReferences | 2026-09-10T03:31:15Z | 2026-09-07T19:25:02Z | 2026-09-10T19:54:50Z | 72.5 |
| #2523 | #2356 | branch name | 2026-09-08T16:12:48Z | 2026-09-05T01:30:52Z | 2026-09-08T16:22:01Z | 86.9 |
| #2425 | #2403 | branch name | 2026-09-09T16:41:29Z | 2026-09-06T00:44:37Z | 2026-09-10T13:26:24Z | 108.7 |
| #2654 | #2439 | closingIssuesReferences | 2026-09-09T21:44:13Z | 2026-09-06T13:41:10Z | 2026-09-11T09:24:19Z | 115.7 |
| #2502 | #2045 | closingIssuesReferences | 2026-09-07T12:48:45Z | 2026-09-01T11:01:24Z | 2026-09-07T12:59:56Z | 146.0 |
| #2542 | #2506 | branch name | 2026-09-09T00:39:54Z | 2026-09-07T12:38:08Z | 2026-09-15T01:18:49Z | 180.7 |
| #2230 | #2151 | closingIssuesReferences | 2026-09-04T12:27:32Z | 2026-09-03T00:50:39Z | 2026-09-11T12:41:41Z | 203.9 |
| #2380 | #718 | closingIssuesReferences | 2026-09-05T05:25:27Z | 2026-08-10T23:03:15Z | 2026-09-05T11:09:27Z | 612.1 |
| #2292 | #552 | branch name | 2026-09-05T06:27:21Z | 2026-08-07T19:03:43Z | 2026-09-05T11:09:29Z | 688.1 |

**Step 0 baseline median: 47.8 h (n = 41; 21st value, #2172).**

## Trial sample, same definition

| Issue | Created | Closed | Hours |
|---|---|---|---|
| #2792 | 2026-09-11T17:06:42Z | 2026-09-15T13:51:57Z | 92.8 |
| #2848 | 2026-09-12T06:03:44Z | 2026-09-14T17:02:57Z | 59.0 |
| #2860 | 2026-09-14T02:13:20Z | 2026-09-15T13:52:14Z | 35.6 |
| #2905 | 2026-09-14T16:50:35Z | 2026-09-14T20:55:42Z | 4.1 |
| #3043 | 2026-09-16T12:06:26Z | 2026-09-16T16:16:36Z | 4.2 |

**Trial median: 35.6 h (n = 5, #2860).**

## Target 11 score

Improvement = (47.8 − 35.6) / 47.8 = **25.5%**; target is ≥50%.
**Target 11: FAIL.**

Exceptions: trial n is 5, so one outcome moves the median sharply; the
ledger-based trial median (249.9 min) uses a different start point and is not
compared with this baseline; issue close time can lag the real live proof on
both sides.
