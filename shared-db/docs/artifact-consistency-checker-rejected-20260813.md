# A cross-artifact consistency checker was proposed, reviewed by three models, and REJECTED

**Date:** 2026-08-13
**Author:** Claude session in worktree `artifact-consistency-checking-2e6a5b`, at the owner's request
**Status:** decision record. No script was written. No workflow was added. No database was touched.

**Read this before proposing a docs-versus-issues CI check again.** The idea is
attractive, it has been proposed at least twice, and it has been built once and deleted
once. The reasoning below is the whole point of this file: without it the next session
re-derives the proposal from scratch, which is the exact drift problem the checker was
supposed to solve.

---

## 1. What was proposed

The owner asked about `github/spec-kit`, specifically its `/speckit.analyze` command,
which cross-checks a spec against a plan against a task list. Adopting spec-kit itself was
never on the table. The proposal was to steal only that idea: a small script reconciling
**this** repo's own artifacts, wired into CI beside the existing guards.

Four checks were proposed:

1. For each root `plan_*.md`, compare cited issue numbers and claimed phase status against
   real `gh` issue state.
2. Flag `B<n>` write-ups in `HANDOFF.md` with no live linked issue.
3. Flag `HANDOFF.d/` files marked OPEN with no corresponding open issue.
4. Flag issue numbers cited in docs that do not exist or were closed as duplicate.

Plus a required "Open decisions — needs owner" block at the top of every `plan_*.md`,
enforced by an existence guard. Ship report-only for the first week.

## 2. Who reviewed it

Three models, in sequence, each reading this repository directly:

- **Claude (Opus 5)** — wrote the proposal above.
- **GLM 5.2** — via `ai-glm`, session `artifact-consistency-checker-review`. Cut it to one
  check.
- **Grok 4.6** — via `ai-grok-review`, session
  `artifact-consistency-checker-third-opinion`, 11 tool turns, $0.94. Cut it to zero.

Each finding below was independently re-verified by the Claude session against the named
file before it was accepted. Nothing here rests on a model's assertion alone.

## 3. Why it was rejected

### 3.1 Check 2 already existed, false-passed, and was deleted with "Do not rebuild it"

It was **B13** (`HANDOFF.md:2129`). Its `B(\d{1,3})` pattern matched a bare number anywhere
in prose, so it printed OK for B8, B13 and B14 when none of them had an entry at all. The
write-up calls it "a small, broken check with a big name, carrying authority on every pull
request that it had not earned." The script, its tests and its workflow were deleted on
2026-08-07, and the required status context was removed from branch protection by owner
instruction.

Re-joining `B<n>` to GitHub issues also **rebuilds the second tracker** that the 2026-08-09
ruling deliberately tore out (`HANDOFF.md:28` and `:1589`): `## BACKLOG` is a pointer, not
a queue.

### 3.2 This repo already reviewed and rejected the whole family

`plan_coordinator-queue-to-github-issues.md:458` considered repointing B13 at Issues and
ruled it **"acceptable as a fallback, wrong as the plan"** because it puts an external API
on a required gate: an outage becomes either a false pass or a freeze on every schema
change across all five apps.

### 3.3 The docs-to-issues join is not reliable enough to be low-noise

Verified against the five root `plan_*.md` files:

- **Roughly half the `#N` citations are pull requests, not issues.** GitHub numbers both in
  one sequence, so asking `gh` about `#464` returns a PR's merge state, which says nothing
  about the plan's intent. Finished status rows lean *further* toward PRs.
- **Some numbers are session markers** (`marker #601`, `marker #855`). Their closure means
  a session ended, not that work completed.
- **Ranges exist.** `plan_coordinator-queue-to-github-issues.md:23` writes `(#502–#565)`. A
  naive pattern takes two numbers and drops sixty-one.
- **Some status tables cite no issues at all** —
  `plan_dispatch-collision-hardening.md:10–23`.

### 3.4 Check 3 fights the write-once rule

`HANDOFF.d/` files are write-once records (`AGENTS.md:2299`). Their OPEN marker is frozen
at write time. Joining "file says OPEN" to "issue is now closed" fires on every old
handover whose issue later closed, which is the normal end of a session, not drift. Most
files carry no parseable marker to join against in the first place.

### 3.5 The one surviving check would have fired once, wrongly

GLM's narrowed check — a done row whose cell contains the literal `issue #N` where `#N` is
open — has exactly one match in this repo today, and it is a false positive.
`plan_popdam_order_list.md:11` cites `issue #727` as the **provenance of a spreadsheet
hash**, not as a claim that #727 is finished. #727 was left open deliberately.

### 3.6 Report-only is the on-ramp to the B13 failure, not a safety measure

Sessions learn to ignore an advisory annotation. The check then either stays useless
forever or gets promoted to required, where its first false positive gets it deleted. That
is precisely how B13 died. Related: §5.2-A already records hosted runners starving a
required check. Six required checks is already the standing cost.

## 4. The defect this repo actually has, and where the fix lives

The drift that caused real harm was **an unsourced number restated as fact across
documents**, not a document disagreeing with an issue.

The worked example: a claimed preview rehearsal of "86 object assertions and 38 behavior
assertions" reached this plan, an approval note, and a handoff before anyone checked. The
only primary source
(`HANDOFF.d/2026-08-10T0030Z-al8960ofc-claude-orchestrator-nine-agent-fan-out.md:436`) says
**86 object tests and 33 behaviour tests** — 33, not 38 — and describes tests **written in
PR #635**, not a preview run. The figure was wrong, relabelled in transit, and unsourced at
every hop. It is refuted in place at `plan_popdam_order_list.md:10` and
`docs/verification/popdam-order-list-production-approval-2026-08-12/README.md:66`.

**No docs-to-issues checker can see that class of error.** There is no issue to join
against. The mitigation is authoring and review discipline, and it now lives in two places:

- **`AGENTS.md` §4.3** (already in force): state the command that yields the figure, not
  the figure. Stamp any number that must appear, and re-derive before acting.
- **The cross-tool plan standard** (added 2026-08-13 in `u2giants/ai-devops`, commit
  `cd5beeb`, `templates/system/implementation-plan-standard.md` and the
  `implementation-plan-writer` skill): **a status row marked done must cite an artifact** —
  a file path under the verification or tests tree, a commit SHA, a CI run id, or the exact
  command to re-run. A bare count is not evidence, and an issue or PR number alone is not
  evidence either, because it records where a discussion happened, not what was proven.

## 5. The one mechanical check that could earn its place later

Not proposed for now. If a **second** unsourced figure ships despite the authoring rule,
the narrowest defensible check is an **offline lint on status tables only**: a done cell
must name a path that exists under `docs/verification/` or `supabase/tests/`, or a commit
SHA, or an Actions run id. **No `gh`. No issue state. No external API on a gate.** Same
shape as `check-intake-pointer.mjs`. It would have blocked the original 86/38 cell.

It is still gameable — a cell can cite any file — and it would need grandfathering across
existing plans. Build it only on a second failure, never speculatively.

## 6. The strongest argument against this decision, recorded honestly

The B13 write-up itself says prose rots and only a machine check lasts
(`HANDOFF.md:2176`). `AGENTS.md` §4.3 was **already in force** when the 86/33
misquotation shipped, and it did not stop it. So "do nothing" is not free, and treating
B13's social failure as a ban on every document check may be an over-correction. This is
recorded so a future session weighing the offline lint in §5 sees the counter-argument
rather than only the refusal.

## 7. Also settled

- **`/speckit.clarify`'s "open decisions" idea does not need a CI guard.** Plans already
  carry `## OPEN QUESTIONS` (`plan_popdam_order_list.md:19`). B7 (`HANDOFF.md:1919`)
  requires every guard to prove it FIRES on a negative case; a heading-exists check has no
  meaningful negative case beyond "someone deleted the heading". Keep it a plan-authoring
  convention.
- **Adopting spec-kit itself was never justified.** `/speckit.analyze` only understands
  spec-kit's own file layout, so adopting it would not deliver this capability anyway.
