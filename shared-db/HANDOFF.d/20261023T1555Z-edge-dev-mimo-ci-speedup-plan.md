# Handoff — CI/merge-lane speedup plan (2026-10-23)

## Plan

See [plan_ci-speedup.md](../plan_ci-speedup.md). STATUS table at the top is authoritative.

## Why

Albert Hazan, 2026-10-23: "how can it take 1 hour just to merge and apply 4429 to production? something's wrong with our process." The hour was post-green-CI merge+apply, not the SQL.

## Next action

A fresh session starts at Step A1 of the plan: widen `AUTHOR_CHECKIN_INTERVAL_MINUTES` in `scripts/manage-migration-author-lanes.mjs` from 10 to 60 and update tests.

## Context this session holds

- RLS InitPlan program #4427–#4430 was the workload that surfaced the friction. #4427, #4428, #4429 are merged and production-applied. #4430 (PR #4682) is in flight.
- Reviewer recording on `edge-dev` is fragile (StepFun/DeepSeek skip with exit 77). Recorded as `20261023T142309Z-edge-dev-stepfun-124126`. Do not block the speedup plan on it.
- Owner instructed 2026-10-23: "don't do a second review for #4430" and "the merge lane [must] accept an author check-in older than 10 minutes old."

Posted by MiMo chat ses-ffe5ea037df8fffe3G25lkMmEh on edge-dev
