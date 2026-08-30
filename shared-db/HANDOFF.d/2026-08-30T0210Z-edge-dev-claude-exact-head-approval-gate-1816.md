---
issue: 1816
status: OPEN
owner: claude/issue-1816-exact-head-approval-gate
---

# Exact-head approval gate (#1816 / PR #1818) — unblocked, four reviews in flight

## 1. What this workstream is

The guarded merge workflow proved head identity, base currency, object collisions and the
author lease, but never asked whether the bytes being merged had been APPROVED by an
independent reviewer. Under merge-first (AGENTS.md §4 rule 2) the PREVIEW gate runs only
AFTER the merge, so the sequence

    reviewer REJECTs head A -> author pushes head B answering it -> merge B

put bytes on main that no reviewer had ever seen. That is not hypothetical: it happened on
PR #1809 (issue #1769). grok-4.6 was assigned and REJECTed `b494401`, commit `8d3c31a`
answered the findings, and `8d3c31a` merged as `2b68e7e` with zero approvals tied to it.

`scripts/check-exact-head-approval.mjs` and its test file are the fix: an assignment pinned to
the exact head AND an approval tied to that same exact head, both required, wired into
`.github/workflows/guarded-migration-merge.yml`.

## 2. Current state (re-read 2026-08-30, do not trust without re-reading)

- PR #1818 OPEN, MERGEABLE, head **`e3278f1048585c8ef5f6da5a9e311b6af9fdd030`**.
- **Four independent reviewers are assigned AT THAT EXACT HEAD** — slots 1 to 4, refs
  `refs/db-review-assignments/1816-1818-e3278f10...`. Verdicts have NOT landed: the reviews
  array is empty and no comment carries a verdict tied to this head.
- **Therefore do not push to this branch.** Any commit moves the head and voids all four
  assignments. That is why this handoff was published as its own docs PR off `main` instead of
  onto the branch, after an earlier attempt had already been rebased onto it — the rebase was
  discarded rather than pushed.
- Everything the stack was waiting on has MERGED: #1813, #1829 (the shared verdict predicate),
  #1799, #1748. The merge order in the previous version of this file is spent.
- Other sessions pushed onto this branch while it was blocked: two exact-head reviews were
  answered (grok-4.6, kimi-k3) and a **mixed-SHA fail-open in the exact-head gate** was closed
  in `a1efca76`. I have NOT reviewed that commit. Read it before assuming the gate behaves as
  section 5 describes.
- Full suite was 860/860 at `43ed42da`, which is now several commits behind the head. **Re-run
  before merging**: `node --test "scripts/*.test.mjs" "scripts/orchestrator-flow/*.test.mjs"`.
  Note the glob form; bare `node --test scripts/` reports 1 test and 1 failure and means nothing.

## 3. What merging this now requires

Nothing structural blocks it. What is required is a verdict, and the standard is the one this
PR itself exists to impose, applied to itself:

- an APPROVE tied to `e3278f10...`, all forty characters, verdict opening its line,
- written by the review path rather than transcribed by hand,
- reviewing the delta against the correct base, not a merge commit's incoming side.

**Do not merge on silence, and do not merge on a stale approval from an earlier head.** If the
four reviewers return nothing, that is a reviewer-pipeline problem to investigate, not a reason
to relax the gate.

## 4. The two defects found while this sat blocked — both real, both verified

Both are FIXED. Defect (a) was fixed repo-wide by #1829, which is merged; defect (b) was fixed
on this branch in `37dd6a3d`. They are kept here because the reasoning is the reason the code
looks the way it does, and because the line-number inventory below is the map of what #1829
replaced.

**(a) The gate self-locked its own PR.** `manage-migration-author-lanes.mjs` decides whether a
verdict already exists using `body.includes(headSha)` AND the verdict word matched ANYWHERE in
the body. Two of my own progress comments on PR #1818 (`5466141972`, `5466151510`) quote the
40-char head and contain the words "approve" and "REVISE" in ordinary prose. Each therefore
reads as a recorded verdict at the exact head, and `freshVerdict` refuses the assignment with
`review assignment issue, PR head, or verdict changed after mutex acquisition`. The PR locked
itself with the notes explaining why it should not be lockable.

**DO NOT EDIT OR DELETE THOSE TWO COMMENTS.** Editing evidence to satisfy a gate is the thing
the gate exists to prevent, and they are #1829's reproduction fixture.

Site inventory on origin/main: **eight identical longhand copies** at lines 1490, 1497, 1503,
1553, 1763, 1767, 2100, 2146, **plus one variant** at 901 (`previewGateProof`). The variant is
the dangerous one and it fails OPEN: prose quoting the head and containing "approve" —
*including a sentence saying approval is absent* — satisfies the preview gate's approval
requirement. A mechanical replace across "nine identical sites" would have mangled precisely
the site that fails open. All nine are #1829's scope.

**(b) The gate would have rejected every genuine approval.** The reviewer wrappers do not emit
a bare verdict word. They are instructed to end with `VERDICT: APPROVE` or `VERDICT: REVISE`
(see the muse wrapper's own prompt line under `.ai/reviews/`), and the archive shows it bare, as
a `##` heading, lowercase, and past-tense `APPROVED`. My original anchor required the verdict
word to OPEN the line, so it would have refused all of it. That is the inverse of defect (a)
and the more dangerous inverse: a self-locked head fails closed loudly and gets investigated,
while a gate that refuses all VALID input looks like reviewers not returning verdicts, so the
wrappers get blamed and re-run instead of the gate. Fixed in `37dd6a3d`.

## 5. Rulings baked into the code — do not "simplify" these away

- An optional `VERDICT:` label is stripped, **never the verdict**. `VERDICT: DO NOT APPROVE`
  must not read as an approval; a strip that swallowed leading words would authorize precisely
  what the reviewer forbade. Pinned by a test.
- `APPROVE WITH CONDITIONS` does **not** satisfy the gate. The conditions ARE the finding, so
  merging on it merges the state the reviewer declined to authorize while producing an audit
  trail saying they approved. The wording is offered to reviewers verbatim in
  `.ai/reviews/psg4-glm52-review-brief.md`, so it is live input, not a hypothetical.
- But it deliberately does **not** join the refusal pattern. Failing to satisfy the approval
  gate is not the same as recording a refusal: a conditional response must leave the head
  unapproved without LOCKING it, or the reviewer's own conditions strand the head those
  conditions were meant to be met on. Both halves are asserted in one test.

## 6. What was tried and rejected

- **Reviewing #1818 via slot 2** — refuses, because slot 1 must exist first. There is no
  override flag. Not a route around the self-lock.
- **Patching only the one site blocking #1818** — would leave seven live and go green.
- **Putting the lanes-file fix onto this branch** — drops #1818 into the conflict cycle #1813
  just escaped, and #1829 already exists for it.
- **Landing the section 4 doctrine as its own PR now** — `section-4-anti-collision-rules.md` is
  one of #1818's six files, so a separate PR does not avoid the collision, it guarantees one,
  and it publishes doctrine describing a mechanism that is not merged yet.
- **`git checkout --theirs` on the origin/main merge** — every hunk took main's side and the
  wholesale shortcut looked obviously right. Comparing each file against `origin/main` and
  listing only my own removed lines proved main was NOT a superset: this branch holds
  `requireReviewWireCapacity`, `hasVerdictForHead` guards, and extra GraphQL fields that would
  have been silently dropped.

## 7. Withheld work — six section 4 doctrine additions, NOT pushed

Held deliberately because `section-4-anti-collision-rules.md` is under review in this very PR;
moving the head to add prose is the exemption this PR exists to refuse. They land as a
follow-up docs PR after #1818 merges, or ride along with any REVISE. Recorded in PR comment
`5466151510` and here:

1. Check supersethood before taking a side in a merge conflict.
2. Regenerate on drift; verify otherwise.
3. Two ways to absorb a repeated cost is the signal to find its cause.
4. **The instrument rule.** A check that can only ever return "clean" must be proven capable of
   returning "dirty" before its clean result means anything. Concrete case: a `jq` verdict-word
   predicate returned ZERO matches on comment bodies that plainly contain those words, because
   the collapsed `\b` is read by Oniguruma as a backspace, so the predicate silently tested for
   a control character. `grep -niE` found both immediately. I was one step from reporting that
   a peer's correct reproduction did not reproduce. The positive counterpart: two Python edit
   scripts asserted their anchor string was present, the same class of escaping fault hit them,
   and they failed LOUDLY with nothing half-applied. The difference was not care or tool choice
   — one instrument asserted its own precondition and the other did not. Rule: **every check
   asserts its own precondition held.** Do not use `jq` for verdict matching anywhere; assert
   in the same regex engine production uses.
5. **The stacked-mutation rule.** A mutation check that cannot say WHICH change caused the
   failure is not evidence, it is a coincidence with a green tick beside it. It fails in the
   reassuring direction: the suite goes red, the report reads "both mutations verified", and
   the second assertion is unbacked while looking identical to the first. I did exactly this
   here and caught it on re-read. Restore, mutate one thing, observe, restore.
6. **The venue rule.** Before publishing an artifact, ask whether the content may exist in this
   repository at all, separately from whether the change is correct. Every gate built this week
   checks the change; none checks the venue. The pressure that produces the failure is
   evidence-capture itself — the more rigorous the verification culture, the more artifacts get
   committed to prove work was done, and the venue question never gets asked because the motive
   is diligence.

## 8. Open item that outranks this workstream

A repository-wide content-venue problem was found and **escalated to Albert on 2026-08-29**. It
is his call and his alone: nothing has been deleted, edited, or purged, and no lane should merge
another data extract until he rules. Deliberately not described in detail here, because this
file lives in the same repository. The count-level survey is held OUTSIDE the repo in the
session scratchpad as `exposure-summary.md`. No issue was filed for it on purpose — a public
issue enumerating the problem is itself a signpost to it. Two sessions have it in hand; if both
are gone and Albert has not ruled, ask him directly rather than acting.

## 9. Next actions, in order

1. Re-read section 2. It was true at 2026-08-30T02:10Z and this branch moves under other
   sessions.
2. Read `a1efca76` (the mixed-SHA fail-open fix) — it landed on this branch from another
   session and I have not reviewed it.
3. Re-run the full suite at the current head.
4. Wait for the four assigned reviewers. Merge only on an APPROVE meeting the standard in
   section 3. **Do not push to the branch while those assignments are live.**
5. Open the follow-up docs PR with the six additions in section 7.
6. Then converge the duplicated predicate: make this checker import #1829's exported shared
   predicate and delete its local copy. #1829 is merged, so this is now unblocked and is the
   single most valuable follow-up — two implementations that agree today disagree the first
   time either is touched, and the default outcome of "we should unify these eventually" is
   that nobody does. Confirm the shared predicate treats `APPROVE WITH CONDITIONS` the way
   section 5 requires; if it does not, that is a defect in the shared predicate, not here.
7. Delete this file when #1818 is merged and section 7 has landed.
