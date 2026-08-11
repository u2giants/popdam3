# Second-model review of the six skill corrections in `ai-devops` `ec137b2` (#530)

**Reviewer:** Codex GPT-5.6 via `codex exec`, **reasoning effort `medium`** (confirmed in the run
header — Albert's standing rule forbids `high` and `none`).
**Date:** 2026-08-11. **Mode:** read-only sandbox, no file edited by the reviewer.
**Subject:** `u2giants/ai-devops` commit `ec137b2` — "six defects Kimi K3 found in the previous patch".

## Why this review exists

The first skill patch (`11235b9`) was reviewed independently by Kimi K3 and Codex GPT-5.6 and both
found real defects. **The corrections to those defects shipped with no second-model review at
all** — and two of them were *new rules* rather than edits: the marker's failure-handling and the
amended permitted-writes list. This is that missing read.

## Verdict

> **DISAGREE** — the marker query can succeed against the wrong repository, and the marker is
> closed before the session actually ends.

## What was accepted, what was narrowed, and what was acted on

Both blocking claims were **re-verified by hand** before anything was changed. One was confirmed
exactly as stated; one was narrowed.

**1. Marker query missing `--repo` — CONFIRMED, and it is the serious one.**
Line 205's `gh issue list --label orchestrator-marker --state open` was the **only labelled
`gh issue list` in the file without `--repo u2giants/shared-db`** (lines 180 and 258 both had it).
This skill loads into sessions working in other repositories — that is the whole point of a
portable summary. Without `--repo`, `gh` queries whatever repo the session is standing in,
**exits 0**, and returns zero markers, which is indistinguishable from a clear board. The session
then opens a second orchestrator while one is live, defeating the exact lock step 0 enforces.

**Verified live** rather than assumed: an empty-but-successful `gh issue list` exits **0**, a
failed one exits **1**. So Codex's point C is also right — the "a failed call is UNKNOWN, never
absence" rule was **prose only**. It told the agent to confirm success and never how, even though
the exit status is the one thing that distinguishes the two cases.

**2. Marker closed too early — NARROWED, and still real.**
Codex said step 5b closes the marker before the session ends. Step 5b's own text says "close it
**last**", so its *intent* was right and Codex overstated this. But the sharper sub-point holds:
**the numbered order contradicts 5b's own instruction.** Steps 6 through 9 all run after it, and
step 6b even says its output "goes in the handover PR" — the PR step 5 already merged. A literal
agent following the numbers drops the single-orchestrator lock with five steps of closeout to go.

**Both fixed** in `ai-devops` commit `a700b48` (pushed to `main`), and defect 1 is now **locked in
mechanically**: a new `marker-query-without-repo` rule in `scripts/check-skill-drift.mjs` fails CI
if any skill regrows a labelled `gh issue list` without `--repo`. Proven to match the old
defective line and not the fixed one.

## Findings NOT acted on — for the owner

**Point A was cleared.** `git fetch --all --no-prune` is valid git and does what fix 1 claims.
Independently confirmed here: git 2.54.0 accepts `--no-prune`, and `--prune=false` fails with
`option 'prune' takes no value` exactly as the skill documents.

**Point B — the permitted-writes list is not safely closed.** This is a judgement call about how
much authority an orchestrator should have, and it is **left for Albert** rather than decided by a
sub-agent. Codex's loophole is genuine: *"merge a docs-only handover PR it finds open, or its own"*
has no file or content boundary, so a PR carrying a handover **plus** unrelated `AGENTS.md` or
operating-rule changes still qualifies. The handover skill compounds it by telling the orchestrator
to edit stale standing documentation including `AGENTS.md`, which is not one of the five exceptions
— a strict reading forbids it, a loose reading lets the orchestrator author operating-rule changes
that should have been dispatched.

---

## Codex's full report, verbatim

### A. `git fetch --all --no-prune`

Yes. It is valid Git and does what fix 1 claims.

- Git 2.54.0 reports `--[no-]prune`.
- The parser accepted `--no-prune`.
- It disables deletion of stale remote-tracking references, including when pruning is enabled in Git config.
- `--all` fetches every configured remote.
- It still updates existing remote references and downloads objects. It only disables pruning.

This matches the [official Git fetch documentation](https://git-scm.com/docs/git-fetch.html) and the corrected instruction at [SKILL.md:219](C:/repos/ai-devops/skills/claude/shared-db-orchestrator/SKILL.md:219).

A small wording issue remains: `--no-prune` protects remote-tracking references. It does not disable every kind of Git cleanup or maintenance.

### B. The five permitted writes

The list is not safely closed.

The largest loophole is:

> “Merge a docs-only handover PR it finds open, or its own.”

That permission has no file or content boundary at [SKILL.md:153](C:/repos/ai-devops/skills/claude/shared-db-orchestrator/SKILL.md:153). A PR can contain a handover plus unrelated changes to `AGENTS.md`, plans, workflow docs, or other operating rules and still be called “docs-only handover.”

The handover skill now makes this worse. It tells the orchestrator to change stale standing documentation at [SKILL.md:332](C:/repos/ai-devops/skills/claude/shared-db-handover/SKILL.md:332), including `AGENTS.md` at lines 337 through 343. Those edits are not one of the five exceptions. A strict reading forbids them. A loose reading lets the orchestrator author operating-rule changes that should be dispatched.

Other scope problems:

- Commit ec137b2 allowed unrestricted “queue seeding at handover.” It did not require short pointer-only entries. Today’s text finally adds that limit at [SKILL.md:261](C:/repos/ai-devops/skills/claude/shared-db-orchestrator/SKILL.md:261).
- “The handoff files” is plural and does not itself say one new write-once file or forbid editing another session’s handoff.
- “Read it, then merge it” at [SKILL.md:252](C:/repos/ai-devops/skills/claude/shared-db-orchestrator/SKILL.md:252) does not explicitly require checking the PR’s current head and required checks. The winning rulebook requires all six checks and current `head_sha` verification at [AGENTS.md:1342](C:/repos/shared-db/AGENTS.md:1342).

Safe wording would allow one newly created handoff file, tightly scoped issue comments, and merging a handover-only PR after its exact changed-file list and required checks are verified.

### C. UNKNOWN versus absence

The distinction exists in `gh`, but the skill does not enforce it.

GitHub CLI returns:

- `0` when the command succeeds, including a successful query with zero results.
- `1` on ordinary failure.
- `4` when authentication is required.

That is documented in the [GitHub CLI exit-code rules](https://cli.github.com/manual/gh_help_exit-codes).

There is no pipeline in the skill to swallow the status. A direct command preserves it. However, the command at [SKILL.md:205](C:/repos/ai-devops/skills/claude/shared-db-orchestrator/SKILL.md:205) has no conditional check, capture, or forced stop. The failure handling is only prose at lines 206 through 208.

More seriously, the command omits:

```text
--repo u2giants/shared-db
```

A successful query against the wrong current repository returns exit `0` and no markers. That is not UNKNOWN. It looks exactly like a clear board. Because these skills live in `ai-devops` and can be loaded outside `shared-db`, this is a blocking defect.

### D. Marker closure timing

Yes. It creates a marker-free window while the session remains live.

Commit ec137b2 inserted marker closure as step 5b, followed by step 6’s documentation and secrets closers. Today the ordering remains:

- Merge the handover PR at [SKILL.md:295](C:/repos/ai-devops/skills/claude/shared-db-handover/SKILL.md:295).
- Close the marker at [SKILL.md:307](C:/repos/ai-devops/skills/claude/shared-db-handover/SKILL.md:307).
- Then run secrets work, documentation changes, cleanup confirmation, queue checks, and the final handover audit through line 372.

There is also an impossible ordering today: line 354 says the documentation work from step 6b goes into the handover PR, but that PR was already merged and the marker closed in steps 5 and 5b.

The marker must remain open until every later step is complete. Closing it must be the final external action before the session ends.

### E. Missed or newly introduced defects

1. **Wrong-repository marker query:** `gh issue list` lacks `--repo u2giants/shared-db`. A wrong-repo empty result succeeds and defeats the marker.

2. **Fix 4 is not fail-closed:** the command exposes an exit status, but nothing in the command forces the agent to test it before acting.

3. **Fix 5 is still mostly prose:** `gh pr list --state open` does not request `headRefOid`, defaults to 30 results, and also lacks `--repo`. `git fetch --all` does not guarantee that GitHub PR synthetic refs or fork heads are fetched. The skill demands exact PR-head SHAs at [SKILL.md:299](C:/repos/ai-devops/skills/claude/shared-db-orchestrator/SKILL.md:299) without giving a reliable command to obtain and fetch them.

4. **Marker closes too early:** this defeats the single-orchestrator lock during the remaining closeout work.

5. **Permitted-write contradiction:** the orchestrator list permits only handoff files, while the handover skill directs it to edit other durable documentation.

6. **Merge gate is underspecified:** “read it, then merge it” does not explicitly require current-head CI verification required by the live rulebook.

VERDICT: DISAGREE (the marker query can succeed against the wrong repository, and the marker is closed before the session actually ends).
tokens used
108,949
The corrections are not fully safe. Fix 1 is correct, but fixes 2 through 5 leave real coordination gaps.

### A. `git fetch --all --no-prune`

Yes. It is valid Git and does what fix 1 claims.

- Git 2.54.0 reports `--[no-]prune`.
- The parser accepted `--no-prune`.
- It disables deletion of stale remote-tracking references, including when pruning is enabled in Git config.
- `--all` fetches every configured remote.
- It still updates existing remote references and downloads objects. It only disables pruning.

This matches the [official Git fetch documentation](https://git-scm.com/docs/git-fetch.html) and the corrected instruction at [SKILL.md:219](C:/repos/ai-devops/skills/claude/shared-db-orchestrator/SKILL.md:219).

A small wording issue remains: `--no-prune` protects remote-tracking references. It does not disable every kind of Git cleanup or maintenance.

### B. The five permitted writes

The list is not safely closed.

The largest loophole is:

> “Merge a docs-only handover PR it finds open, or its own.”

That permission has no file or content boundary at [SKILL.md:153](C:/repos/ai-devops/skills/claude/shared-db-orchestrator/SKILL.md:153). A PR can contain a handover plus unrelated changes to `AGENTS.md`, plans, workflow docs, or other operating rules and still be called “docs-only handover.”

The handover skill now makes this worse. It tells the orchestrator to change stale standing documentation at [SKILL.md:332](C:/repos/ai-devops/skills/claude/shared-db-handover/SKILL.md:332), including `AGENTS.md` at lines 337 through 343. Those edits are not one of the five exceptions. A strict reading forbids them. A loose reading lets the orchestrator author operating-rule changes that should be dispatched.

Other scope problems:

- Commit ec137b2 allowed unrestricted “queue seeding at handover.” It did not require short pointer-only entries. Today’s text finally adds that limit at [SKILL.md:261](C:/repos/ai-devops/skills/claude/shared-db-orchestrator/SKILL.md:261).
- “The handoff files” is plural and does not itself say one new write-once file or forbid editing another session’s handoff.
- “Read it, then merge it” at [SKILL.md:252](C:/repos/ai-devops/skills/claude/shared-db-orchestrator/SKILL.md:252) does not explicitly require checking the PR’s current head and required checks. The winning rulebook requires all six checks and current `head_sha` verification at [AGENTS.md:1342](C:/repos/shared-db/AGENTS.md:1342).

Safe wording would allow one newly created handoff file, tightly scoped issue comments, and merging a handover-only PR after its exact changed-file list and required checks are verified.

### C. UNKNOWN versus absence

The distinction exists in `gh`, but the skill does not enforce it.

GitHub CLI returns:

- `0` when the command succeeds, including a successful query with zero results.
- `1` on ordinary failure.
- `4` when authentication is required.

That is documented in the [GitHub CLI exit-code rules](https://cli.github.com/manual/gh_help_exit-codes).

There is no pipeline in the skill to swallow the status. A direct command preserves it. However, the command at [SKILL.md:205](C:/repos/ai-devops/skills/claude/shared-db-orchestrator/SKILL.md:205) has no conditional check, capture, or forced stop. The failure handling is only prose at lines 206 through 208.

More seriously, the command omits:

```text
--repo u2giants/shared-db
```

A successful query against the wrong current repository returns exit `0` and no markers. That is not UNKNOWN. It looks exactly like a clear board. Because these skills live in `ai-devops` and can be loaded outside `shared-db`, this is a blocking defect.

### D. Marker closure timing

Yes. It creates a marker-free window while the session remains live.

Commit ec137b2 inserted marker closure as step 5b, followed by step 6’s documentation and secrets closers. Today the ordering remains:

- Merge the handover PR at [SKILL.md:295](C:/repos/ai-devops/skills/claude/shared-db-handover/SKILL.md:295).
- Close the marker at [SKILL.md:307](C:/repos/ai-devops/skills/claude/shared-db-handover/SKILL.md:307).
- Then run secrets work, documentation changes, cleanup confirmation, queue checks, and the final handover audit through line 372.

There is also an impossible ordering today: line 354 says the documentation work from step 6b goes into the handover PR, but that PR was already merged and the marker closed in steps 5 and 5b.

The marker must remain open until every later step is complete. Closing it must be the final external action before the session ends.

### E. Missed or newly introduced defects

1. **Wrong-repository marker query:** `gh issue list` lacks `--repo u2giants/shared-db`. A wrong-repo empty result succeeds and defeats the marker.

2. **Fix 4 is not fail-closed:** the command exposes an exit status, but nothing in the command forces the agent to test it before acting.

3. **Fix 5 is still mostly prose:** `gh pr list --state open` does not request `headRefOid`, defaults to 30 results, and also lacks `--repo`. `git fetch --all` does not guarantee that GitHub PR synthetic refs or fork heads are fetched. The skill demands exact PR-head SHAs at [SKILL.md:299](C:/repos/ai-devops/skills/claude/shared-db-orchestrator/SKILL.md:299) without giving a reliable command to obtain and fetch them.

4. **Marker closes too early:** this defeats the single-orchestrator lock during the remaining closeout work.

5. **Permitted-write contradiction:** the orchestrator list permits only handoff files, while the handover skill directs it to edit other durable documentation.

6. **Merge gate is underspecified:** “read it, then merge it” does not explicitly require current-head CI verification required by the live rulebook.

VERDICT: DISAGREE (the marker query can succeed against the wrong repository, and the marker is closed before the session actually ends).
