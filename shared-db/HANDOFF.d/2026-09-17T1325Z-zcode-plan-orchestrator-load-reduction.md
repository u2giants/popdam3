---
issue: 3199
status: OPEN
owner: zcode/plan-orchestrator-required-load-reduction
---

# Orchestrator required-load reduction — plan written, execution not started

**What this is.** Tracking the program to reduce what MUST pass through the
shared-db orchestrator session without reducing safety: queue hygiene
(labels, expired-claim close-out, read-only report workflow), a self-service
additive lane confined to the existing `crm`/`pim`/`dam` schemas (brand-new
schemas were dropped after review), and a zero-touch audit of the #2758
ephemeral route's merge→production hops. The controlling document is
[`plan_orchestrator_required_load_reduction.md`](../plan_orchestrator_required_load_reduction.md) —
**read its STATUS table first.** Issue: [#3199](https://github.com/u2giants/shared-db/issues/3199).

**Where it stands.** Plan authored 2026-09-17 (this session, task class
`prose`, worktree `C:\repos\shared-db\.claude\worktrees\orchestrator-load-plan`,
branch `zcode/plan-orchestrator-required-load-reduction`). Second opinion
obtained: Muse Spark 1.3 could not complete (`ai-muse` failed three times,
"Muse returned malformed event output"; incident
`20260917T141421Z-edge-dev-muse-4088612`), and the owner authorized
substituting Grok 4.6, whose verdict was **sound-with-changes** ($0.43,
review preserved at `.ai/reviews/grok-orchestrator-load-plan-review-20260917T142326Z-4117926.md`
on the authoring worktree). Every material finding is folded into the plan
(wrong A2 command, A3 write-safety, B2 route mechanism, B1 classifier holes,
B3 merge-time enforcement, and the merge-dispatch right now locked in §8).
No phase has been executed.

**Next exact action.** A fresh session starts at plan Step A1: `git fetch
origin --prune`, re-run `node scripts/manage-migration-author-lanes.mjs
--queue-audit` for today's unlabelled list (the plan's 2026-09-17 list will
have moved), then label each issue scope-block-first. Declare the task class
before working (`ai-task-gates start --class …`).

**Do not:** re-plan #2530 here, parallelize the serial lanes, add an
auto-label bot, loosen the Phase B boundary into shared schemas, or weaken
any caller check in the guarded merge workflow. Merging: any
write-authenticated session may dispatch the guarded merge for an approved,
green PR (locked in plan §8 — the workflow, not the caller, is the gate);
#2530's queue still owns the serialization end-state.
