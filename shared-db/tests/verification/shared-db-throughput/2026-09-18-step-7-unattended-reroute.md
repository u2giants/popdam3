# Step 7 live proof: unattended reviewer start reroute (issue #3242)

Programme popcre/ai-devops#401, Step 7. Non-orchestrator work (no database structure change).

## What is being proved

1. The reviewer start watcher runs without a person invoking it. The replacement draw needs `ai-review-preflight` and the reviewer wrappers, which a GitHub-hosted runner does not have, so the unattended runner is the edge-dev scheduled task `\ai-devops\reviewer-start-watch` (popcre/ai-devops#599, `bin/ai-reviewer-start-watch tick` every 2 minutes). It runs `scripts/orchestrator-flow/reviewer-start-watch.mjs --apply` from a fresh clone of `main` and logs each pass to `~/.ai-devops/reviewer-start-watch/tick.log`.
2. One live unstarted reviewer is rerouted by an unattended pass at the first pass after its 10-minute start SLO, while the other slot's verdict stays intact.

Assumption: "within 10 minutes of its draw" is read as "at the first watcher pass after the 10-minute start SLO". A lease cannot be declared a non-start before the SLO ends, so the bound is the SLO plus one pass interval.

## Set-up (staged)

This pull request is itself the subject. Slot 1 is drawn and reviewed normally. Slot 2 is drawn and deliberately never started, so it is a real governed lease that stays unstarted. No watcher pass is invoked by hand.

## Evidence

Subject head `dd63559c8a4cfc2b789aaea6055c4300beddcb63` on #3286. All times UTC, 2026-09-18. Ref times are the commit dates of the refs in `popcre/shared-db`; pass times are the `===` headers in the edge-dev `tick.log`.

| Event | Time | Record |
|---|---|---|
| Slot 1 drawn and started (seq 3318, gemini-3.8-flash-high) | 22:37:00 | `refs/db-review-active-v2/gemini-3.8-flash-high/3242-3286-dd63559c…` |
| Slot 2 drawn, never started (seq 3319, grok-4.6) | 22:37:41 | `refs/db-review-active-v2/grok-4.6/3242-3286-dd63559c…-slot2` |
| Pass before the SLO end: slot 2 `"action": "wait"` | 22:47:23 | `tick.log` |
| 10-minute start SLO ends | 22:47:41 | draw + 10 min |
| Reroute reserved (silence probe and reclaim) | 22:48:34 | `refs/db-start-reroutes/reviewer/review-3242-3286-seq3319-slot2` |
| Dispatch claimed | 22:48:37 | `…-seq3319-slot2--dispatch-claim` |
| Edge-dev pass resumes it and draws the replacement | 22:49:11 | `tick.log`: `"resumed"`, `replace` `"status": "done"` |
| Replacement acknowledged (seq 3323, muse-spark-1.3-contributor, slot 2, `failureCode` `silent_worker_observed`) | 22:49:55 | `…-seq3319-slot2--dispatch-ack`, `"status": "acknowledged"` |

The reroute was reserved 53 seconds after the SLO ended and acknowledged 2 minutes 14 seconds after it, 12 minutes 14 seconds after the draw. No watcher pass or reroute step was invoked by hand. Two unattended runners were live at the time: the edge-dev scheduled task and a GitHub-hosted relay leg (run 35394703227, in progress since 21:02:53). The edge-dev pass completed the replacement draw, which needs `ai-review-preflight`.

Slot 1 stayed intact. Its lease still pointed at `794aa10b` (dated 22:37:00) after the reroute, and no `refs/db-start-reroutes/reviewer/review-3242-3286-seq3318*` ref exists. It was still unchanged at 23:40, when the slot 1 review process ended without a recordable verdict (a reviewer runtime failure, not a watcher action). Slot 2 kept moving without a person: the seq 3323 replacement was not started either and had been rerouted again, to glm-5.3, by 23:40.

### Earlier unattended evidence on #3269

- seq 3272 (slot 2) was rerouted and acknowledged unattended at 19:38:44.
- seq 3299 (slot 2) was reserved at the first pass after its SLO (19:51:54). Completion was held up by a stale author mutex (19:45 to about 20:43) and by the reroute budget counting the lease's own retry (#3283, fixed in #3284, merged as `c9d50300`). The pass at 22:33:04 on `c9d50300` completed it (acknowledged 22:33:56; replacement seq 3312). The #3269 slot 1 verdict stayed intact.
