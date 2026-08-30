# Review brief — PR #1818, issue #1816, head `6ad022271266390f6a7830b95c067b839afa5759`

You are the independent reviewer drawn by this repository's rotation (sequence 557). You are not the author of any commit on this branch, and no earlier finding of yours shaped its content. Two previous reviewers refused earlier heads; their findings shaped the commits you are looking at, which is why neither of them may review this one.

Use relative paths from the repository root. Do not attempt absolute paths.

## What the change does

It makes the exact-head approval rule **enforced at the merge gate** rather than merely documented. Before it, `guarded-migration-merge` proved head identity, base currency, object collisions and the author lease, but never asked whether the bytes being merged had been approved. On PR #1809 a reviewer refused head A, a new commit B answered the findings, and B merged with zero approvals tied to it.

Files in scope:

- `scripts/check-exact-head-approval.mjs` — new. The gate.
- `scripts/check-exact-head-approval.test.mjs` — new. Its suite.
- `.github/workflows/guarded-migration-merge.yml` — invokes the gate twice, once up front and once re-proven under the merge lock.
- `.github/workflows/migration-author-lease.yml` — adds the new suite to the test run.
- `AGENTS.md` and `docs/agents/section-4-anti-collision-rules.md` — prose.

## Inputs already established. These are results, not questions.

**1. The refusal fires. I constructed the case it exists to refuse and confirmed the code path rejects it.** Against live GitHub, at this exact head, with a real assignment present and no approval:

```
PR_NUMBER=1818 REQUESTED_SHA=6ad02227... node scripts/check-exact-head-approval.mjs
REFUSED: no reviewer was ever assigned head 1f83957e...   (exit 2)
```

A gate never seen to refuse anything is not a gate. This one has been seen to refuse.

**2. All four verdict-recognition fixes are mutation-tested.** Reverting any one of them fails the suite — 16 or fewer pass, at least one fails. They are not covered by assertion alone.

**3. A prior reviewer's blocking finding was refuted by measurement, and the refutation is recorded at the call site.** It held that the assignment-ref listing in `gatherApprovalInput` is unpaginated against a ~370-ref namespace, so the gate could never pass. Measured against live GitHub: `git/matching-refs` is not a paged collection. Unpaginated and `--paginate` both return all 421 assignment refs and all 114 replacement refs, including every ref for this PR. The listing is deliberately left unpaginated and the reasoning is in a comment so it is not "fixed" again on the same wrong premise.

You may of course disagree with any of these. If you do, say so and show the measurement that beats mine.

## What I want from you

1. **Read the diff.** Does the new refusal actually close the #1809 hole, or does it merely appear to?
2. **Look for the fail-open direction specifically.** A gate that fails open is worse than no gate, because it manufactures confidence. Is there any path — env var missing, API shape unexpected, exception swallowed, workflow step lacking its environment — where the script exits 0 or is skipped while unapproved bytes merge? Note that the second invocation gets `PR_NUMBER` and `REQUESTED_SHA` from the step-level `env:` block rather than inline; satisfy yourself that is actually true rather than taking my word.
3. **Attack the verdict recognizer with real reviewer output shapes.** Both directions matter. Reading a refusal as an approval authorizes a merge nobody approved. Refusing a genuine approval is subtler and arguably worse in practice, because it presents as reviewers not returning verdicts, so the wrappers get blamed and re-run while the gate is never suspected.
4. **Check the tests can fail.** If a test would pass against a broken implementation, say which one and why.
5. **Check every citation you make against the live file.** A name that "looks right" is not the same as a name that is right. This repository has been bitten by a reviewer asserting an identifier from memory.
6. **Before you trust any empty result** — a grep that finds nothing, an absence you are about to report — run the same search against a case you know is non-empty. Two lanes here today got a confident empty answer that was their own escaping rather than the truth.

## On disagreement

If you raise a blocking finding and I believe it is wrong, I will measure it and put the numbers in front of you. **Do not soften or withdraw a finding to be agreeable.** If my measurement does not actually refute your point, hold it. I would far rather ship this with a recorded open objection from you than with a withdrawal I talked you into — a rebuttal that only ever produces agreement is worth nothing as evidence, and the next person reading this record needs to be able to tell the difference.

Equally, if my measurement does refute it, say so plainly and move on. Both outcomes are useful; only politeness is not.

## Verdict format

End with a line that opens with your verdict token, and name this head in the body:

```
VERDICT: APPROVE
```

or `VERDICT: REVISE`. Include a coverage statement — what you examined and what you did not. A verdict with no coverage statement is not review evidence in this repository. Your analysis and your verdict must agree: an approval whose body describes an unresolved blocking problem is not an approval, and will be rejected as evidence.
