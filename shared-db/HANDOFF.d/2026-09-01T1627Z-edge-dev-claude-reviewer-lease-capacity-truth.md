---
issue: 2058
status: OPEN
owner: claude/find-edge-dev-reviewer-coordination-9ec999
---

# Reviewer lease capacity truth — plan written, implementation not started

- **When:** 2026-09-01 ~16:27 UTC
- **Machine / agent:** `edge-dev` / Claude (Opus 5)
- **Repo:** `u2giants/shared-db`, worktree branch
  `claude/find-edge-dev-reviewer-coordination-9ec999`, off `main` at `bcd2ec1a`
- **Governed issue:** [#2058](https://github.com/u2giants/shared-db/issues/2058)
  (`db-work`, `route: repo-maintenance`) — opened by the orchestrator session that
  hit this same deadlock, four minutes after this session started. Same incident,
  same root cause; see its briefing
  [`2026-09-01T1630Z-edge-dev-codex-reviewer-capacity-deadlock.md`](2026-09-01T1630Z-edge-dev-codex-reviewer-capacity-deadlock.md).
  [#1851](https://github.com/u2giants/shared-db/issues/1851) is the earlier, wider
  record of the same pool and stays open for its two out-of-scope defects.

## What this session did

Investigated a reviewer-coordination failure logged on this machine on
2026-09-01 15:57 UTC, established the root cause by reading the code, and wrote
the implementation plan. **No code was changed. Implementation has not started.**

## The plan

→ **[`plan_reviewer_lease_capacity_truth.md`](../plan_reviewer_lease_capacity_truth.md)**
— read its STATUS table first. A fresh session starts at Step 1.

Five parts: (1) a governed command to release a terminally-failed reviewer's slot
without needing a replacement, (2) timestamped leases so age is readable, (3) a
read-only `--reviewer-capacity` report, (4) refusal messages that name their true
cause, (5) a separate `ai-devops` fix so a reviewer-issue report stops advertising
evidence files it never captured.

## The finding worth not re-deriving

In `scripts/manage-migration-author-lanes.mjs`, freeing a dead reviewer slot is
welded to *successfully drawing a replacement*: the refusal at line 2438 fires
before the release at line 2461. So the one operation that would free capacity
refuses for lack of capacity — a deadlock by construction, worst exactly when
capacity matters most. Separately, `findBusyReviewers` (line 1741) only calls a
lease stale when the PR closed, the head moved, or a verdict exists; a reviewer
that crashed or ran out of turns produces none of those and holds its slot forever.

## Incident evidence (machine-local, in no repository)

`C:\repos\ai-devops\.ai\reviewer-issues\20260901T155739Z-edge-dev-reviewer-coordination-2741130\`
— `details.redacted.txt` is the narrative. A reader on another machine cannot open
it; the plan quotes what matters.

## What is NOT done

Everything in the plan. Also deliberately left open and named in the plan's
out-of-scope list: a per-PR ceiling on roster share (#1851 defect 1) and a wait
queue for lanes (#1851 defect 2).

## Next session

Read the plan, start at Step 1, work in a fresh worktree, PR into `main`, merge it
yourself. This is repository-maintenance work — **do not route it to the
structure/schema orchestrator.**
