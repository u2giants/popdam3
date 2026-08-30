// Issue #1822 -- a progress comment naming a head SHA and a verdict word must
// not register as a recorded verdict.
//
// EVERY assertion here runs against the SAME regex engine production uses, by
// importing the real predicate. It deliberately does not shell out to `jq`:
// `jq 'test("\\b(APPROVE|REVISE)\\b";"i")'` returns ZERO matches on the very
// comment bodies below, because the doubled backslash collapses to a literal
// \b, which Oniguruma reads as a backspace control character. A verification
// tool whose escaping inverts the answer is worse than no check at all -- it
// was what made this bug look absent while it was actively blocking PR #1818.
//
// It also pins NO line numbers. This file moves constantly; the sidecar that
// pinned line numbers breaks on every shift. Assert on behaviour only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  verdictOpensLine,
  isApprovalFor,
  isVerdictFor,
  anyVerdictFor,
  evidenceTiedToHead,
  gateAuthorizes,
} from './manage-migration-author-lanes.mjs'

const HEAD = '8bb1886a31f89409d06c312d3a9005eff07a1cea'

// ---------------------------------------------------------------------------
// The two REAL comment bodies from PR #1818, verbatim, each in a body that also
// quotes the 40-character head. Copied from the live PR, not paraphrased: a
// test on a synthetic string would be a test of a different program.
// ---------------------------------------------------------------------------
const REAL_APPROVE_PROSE = [
  '**Branch frozen at `8bb1886a31f89409d06c312d3a9005eff07a1cea` while its review runs.**',
  '',
  'Remaining state is `BLOCKED`, which is correct — this needs its exact-head review. **Approval must be pinned to all forty characters of `8bb1886a31f89409d06c312d3a9005eff07a1cea`**, verdict opening its line, and it must be a review of *this delta*: if the reviewer is handed a merge commit with no base, it will review the incoming side and approve something else entirely, exactly as happened on #1813.',
].join('\n')

const REAL_REVISE_PROSE = [
  '**Conflict resolved. Settled head: `8bb1886a31f89409d06c312d3a9005eff07a1cea`. Now MERGEABLE.**',
  '',
  'Three further doctrine entries are ready and are being **deliberately withheld**, because `docs/agents/section-4-anti-collision-rules.md` is one of the six files under review. Pushing them would move the head and void the review — the fourth head in two hours, for prose that can wait an hour. Good additions do not justify moving a head under review; that is exactly the exemption this PR exists to refuse. They land as a follow-up documentation PR after merge, or ride along with any REVISE findings.',
].join('\n')

const comment = (body) => ({ body, state: undefined, commit_id: undefined })

test('both real #1818 progress notes are tied to the head', () => {
  // The tie is what made them dangerous; the fix must not work by accidentally
  // losing the tie.
  assert.equal(evidenceTiedToHead(comment(REAL_APPROVE_PROSE), HEAD), true)
  assert.equal(evidenceTiedToHead(comment(REAL_REVISE_PROSE), HEAD), true)
})

test('the OLD anywhere-in-body reading registered both notes as verdicts', () => {
  // Reproduces the defect exactly as it was written at all nine sites, so the
  // test proves a real behaviour CHANGE rather than merely asserting the new
  // behaviour into existence.
  const oldReading = (body) =>
    body.includes(HEAD) && /\b(?:APPROVE|REVISE|REQUEST_CHANGES)\b/i.test(body)
  assert.equal(oldReading(REAL_APPROVE_PROSE), true)
  assert.equal(oldReading(REAL_REVISE_PROSE), true)
})

test('neither real progress note registers as a verdict under the new rule', () => {
  assert.equal(isVerdictFor(comment(REAL_APPROVE_PROSE), HEAD), false)
  assert.equal(isVerdictFor(comment(REAL_REVISE_PROSE), HEAD), false)
  assert.equal(anyVerdictFor([comment(REAL_APPROVE_PROSE), comment(REAL_REVISE_PROSE)], HEAD), false)
})

test('neither real progress note satisfies the fail-OPEN preview approval gate', () => {
  assert.equal(isApprovalFor(comment(REAL_APPROVE_PROSE), HEAD), false)
  assert.equal(isApprovalFor(comment(REAL_REVISE_PROSE), HEAD), false)
})

// ---------------------------------------------------------------------------
// The capability must survive. A fix that blocks real approvals is not a fix.
// ---------------------------------------------------------------------------
test('a genuine APPROVE opening its line still registers', () => {
  for (const body of [
    `APPROVE\n\nReviewed ${HEAD}. Examined all six files.`,
    `**APPROVE**\n\nHead ${HEAD}.`,
    `> APPROVE\n\nHead ${HEAD}.`,
    `## APPROVED\n\nHead ${HEAD}.`,
    // The form the reviewer wrappers actually emit.
    `VERDICT: APPROVE\n\nHead ${HEAD}, seven-point review follows.`,
  ]) {
    assert.equal(isApprovalFor(comment(body), HEAD), true, body.split('\n')[0])
    assert.equal(isVerdictFor(comment(body), HEAD), true, body.split('\n')[0])
  }
})

test('a genuine refusal opening its line still registers', () => {
  for (const body of [
    `REVISE\n\nHead ${HEAD}. Critical: the adapter never receives this value.`,
    `**REVISE**\n\nHead ${HEAD}.`,
    `VERDICT: REJECT\n\nHead ${HEAD}.`,
    `REQUEST_CHANGES\n\nHead ${HEAD}.`,
  ]) {
    assert.equal(isVerdictFor(comment(body), HEAD), true, body.split('\n')[0])
    // A refusal is a verdict but is NOT an approval -- the asymmetry that
    // would otherwise let a refusal authorize a migration.
    assert.equal(isApprovalFor(comment(body), HEAD), false, body.split('\n')[0])
  }
})

test('structured GitHub review states are still trusted as data, not prose', () => {
  assert.equal(isApprovalFor({ body: '', state: 'APPROVED', commit_id: HEAD }, HEAD), true)
  assert.equal(isVerdictFor({ body: '', state: 'CHANGES_REQUESTED', commit_id: HEAD }, HEAD), true)
  assert.equal(isApprovalFor({ body: '', state: 'CHANGES_REQUESTED', commit_id: HEAD }, HEAD), false)
})

// ---------------------------------------------------------------------------
// The ninth site, which fails OPEN. This is the case live in the repository
// right now: sentences arguing about what approval ought to mean, and sentences
// stating that an approval is ABSENT.
// ---------------------------------------------------------------------------
test('prose stating an approval is ABSENT must not satisfy the preview gate', () => {
  for (const body of [
    `There is no APPROVE tied to ${HEAD}; the review slot is still empty.`,
    `PR #1821 merged with an assignment at ${HEAD} and no APPROVE pinned to it.`,
    `Head ${HEAD} has not been approved. Do not merge.`,
    `Approval must be pinned to all forty characters of ${HEAD}.`,
    `An APPROVE with no coverage statement is not review evidence — head ${HEAD}.`,
  ]) {
    assert.equal(isApprovalFor(comment(body), HEAD), false, body.slice(0, 60))
    assert.equal(isVerdictFor(comment(body), HEAD), false, body.slice(0, 60))
  }
})

// ---------------------------------------------------------------------------
// COMPLYING WITH THE GOVERNANCE RULE MUST NOT LOCK THE HEAD.
//
// A wrong-scope review must be refused PUBLICLY in a PR comment, so that an
// empty review slot reads as a refusal rather than an omission. Writing that
// comment necessarily names the verdict token and the head SHA in one body --
// which is precisely what the old reading treated as a recorded verdict. So
// obeying the rule was what locked the head, and the only escape would have
// been editing the very evidence the gate exists to protect.
//
// Real refusal body from PR #1813 (comment 5466128876), verbatim. It cost
// nothing there only because the head it named was already dead.
// ---------------------------------------------------------------------------
const REAL_REFUSAL_HEAD = '47f918e5487242c9f95bc829e4cab45211a91fd1'
const REAL_REFUSAL_COMMENT = [
  '## Why no approval is recorded on this PR: one was produced and refused',
  '',
  'This is a refusal, not an omission. Reading the empty review slot as "nobody got',
  'around to it" would be the wrong lesson.',
  '',
  'A Codex `diff-review` was commissioned against this PR through the governed',
  'assignment path (sequence 485, `codex-gpt-5.6-sol`) and returned **APPROVE** at',
  'commit `47f918e5487242c9f95bc829e4cab45211a91fd1` — which was, at that moment,',
  "exactly this PR's head. It passed head-pinning cleanly.",
  '',
  'It was refused anyway, because it reviewed the wrong content. Its findings cited',
  '`scripts/orchestrator-flow/reconcile.mjs:16`. That file has **zero lines** in this',
].join('\n')

test('a public wrong-scope refusal comment does not lock the head it names', () => {
  // Under the old reading this locked the head, so obeying the governance rule
  // was self-defeating. This is the case that will regress.
  const oldReading =
    REAL_REFUSAL_COMMENT.includes(REAL_REFUSAL_HEAD) &&
    /\b(?:APPROVE|REVISE|REQUEST_CHANGES)\b/i.test(REAL_REFUSAL_COMMENT)
  assert.equal(oldReading, true, 'fixture must reproduce the old lock')

  assert.equal(evidenceTiedToHead(comment(REAL_REFUSAL_COMMENT), REAL_REFUSAL_HEAD), true)
  assert.equal(isVerdictFor(comment(REAL_REFUSAL_COMMENT), REAL_REFUSAL_HEAD), false)
  // And it must not authorize anything through the fail-open preview gate.
  assert.equal(isApprovalFor(comment(REAL_REFUSAL_COMMENT), REAL_REFUSAL_HEAD), false)
})

// ---------------------------------------------------------------------------
// APPROVE WITH CONDITIONS is a refusal with a remedy.
//
// Accepting it merges before the conditions are met while producing a record
// that says the reviewer approved -- the damage and the evidence of no damage in
// a single act. But recording it as a REFUSAL is its own trap: that locks the
// head, so the reviewer could never clear their own conditions, because a later
// unconditional approval at the same head would be refused as "a verdict already
// exists".
//
// So it must be NEITHER. Both halves are asserted here, in the same test,
// because "does not approve" and "does not lock" are two separate claims and
// only the first one is obvious.
// ---------------------------------------------------------------------------
test('APPROVE WITH CONDITIONS neither approves nor locks the head', () => {
  for (const body of [
    `APPROVE WITH CONDITIONS\n\nHead ${HEAD}. Fix the adapter first.`,
    `VERDICT: APPROVE WITH CONDITIONS\n\nHead ${HEAD}.`,
    `**APPROVE WITH CONDITIONS**\n\nHead ${HEAD}.`,
    `APPROVE, WITH CONDITIONS\n\nHead ${HEAD}.`,
    `APPROVED WITH CONDITION\n\nHead ${HEAD}.`,
  ]) {
    const label = body.split('\n')[0]
    // Half one: it does not authorize.
    assert.equal(isApprovalFor(comment(body), HEAD), false, `approved: ${label}`)
    // Half two: it does not lock. This is the half that is easy to get wrong.
    assert.equal(isVerdictFor(comment(body), HEAD), false, `locked: ${label}`)
  }
})

test('an unconditional APPROVE still clears a head a conditional one touched', () => {
  // The consequence of half two, stated as the behaviour that matters: the
  // reviewer must be able to come back and clear their own conditions.
  const conditional = comment(`APPROVE WITH CONDITIONS\n\nHead ${HEAD}.`)
  const unconditional = comment(`APPROVE\n\nHead ${HEAD}. Conditions met.`)
  assert.equal(anyVerdictFor([conditional], HEAD), false)
  assert.equal(anyVerdictFor([conditional, unconditional], HEAD), true)
  assert.equal(
    [conditional, unconditional].some((row) => isApprovalFor(row, HEAD)),
    true,
  )
})

test('the label strip must not swallow leading words', () => {
  // The inverted failure: a strip that skipped arbitrary leading words would
  // read the plainest possible refusal as the strongest possible approval.
  for (const body of [
    `VERDICT: DO NOT APPROVE\n\nHead ${HEAD}.`,
    `DO NOT APPROVE\n\nHead ${HEAD}.`,
    `VERDICT: NOT APPROVED\n\nHead ${HEAD}.`,
    `CANNOT APPROVE\n\nHead ${HEAD}.`,
  ]) {
    assert.equal(isApprovalFor(comment(body), HEAD), false, body.split('\n')[0])
  }
  // And the label strip still does its actual job.
  assert.equal(isApprovalFor(comment(`VERDICT: APPROVE\n\nHead ${HEAD}.`), HEAD), true)
})

test('KNOWN BOUNDARY: a structured APPROVED state outranks conditional prose', () => {
  // Pinned deliberately so this is a recorded decision, not an oversight.
  //
  // The conditional-approval rule governs PROSE. If a reviewer submits a GitHub
  // review whose structured state is APPROVED but whose body says APPROVE WITH
  // CONDITIONS, the structured state still wins and it counts as an approval.
  //
  // That is intentional for now: the structured state is a deliberate UI action
  // taken by a human or wrapper, not incidental text, and narrowing it here
  // would diverge from the sibling implementation on #1818. It IS a hole -- a
  // reviewer can express a conditional approval that the gate reads as
  // unconditional. Flagged to the coordinator rather than fixed unilaterally.
  const row = { body: 'APPROVE WITH CONDITIONS', state: 'APPROVED', commit_id: HEAD }
  assert.equal(isApprovalFor(row, HEAD), true)
})

test('a verdict word for a DIFFERENT head never counts for this head', () => {
  const other = '0be60cfc34fec94d87b6ea145cf7c6c8657cf968a'
  const body = `APPROVE\n\nReviewed ${other}.`
  assert.equal(isApprovalFor(comment(body), HEAD), false)
  assert.equal(isVerdictFor(comment(body), HEAD), false)
})

test('verdictOpensLine ignores a verdict word that does not open its line', () => {
  assert.equal(verdictOpensLine('we will approve later', /^APPROVE(?:D)?\b/i), false)
  assert.equal(verdictOpensLine('APPROVE', /^APPROVE(?:D)?\b/i), true)
  assert.equal(verdictOpensLine('line one\n   **APPROVE**', /^APPROVE(?:D)?\b/i), true)
  // Word-boundary discipline is preserved: APPROVEMENT is not APPROVE.
  assert.equal(verdictOpensLine('APPROVEMENT of the plan', /^APPROVE(?:D)?\b/i), false)
})

test('empty and malformed evidence is inert', () => {
  assert.equal(anyVerdictFor(undefined, HEAD), false)
  assert.equal(anyVerdictFor([], HEAD), false)
  assert.equal(isVerdictFor({}, HEAD), false)
  assert.equal(isApprovalFor(null, HEAD), false)
})

// ---------------------------------------------------------------------------
// The FAIL-OPEN preview gate. Everything above tests the predicate; these test
// the WIRING that uses it to authorize a migration. Before `gateAuthorizes` was
// extracted, the entire approval check at that call site could be replaced with
// `const approved=true` and the whole suite stayed green, because the only test
// reference to `previewGateProof` is a stub that replaces the method.
// ---------------------------------------------------------------------------
const BUNDLE = 'bundle-1822-abc'
const never = () => {
  throw new Error('assignment lookup called when it should have short-circuited')
}

test('gate: prose merely discussing approval does not authorize a migration', () => {
  const evidence = [comment(`${REAL_APPROVE_PROSE}

Bundle ${BUNDLE}.`)]
  assert.equal(gateAuthorizes(evidence, HEAD, BUNDLE, never), false)
})

test('gate: a real APPROVE opening its line and naming the bundle authorizes', () => {
  const evidence = [comment(`APPROVE

Head ${HEAD}, bundle ${BUNDLE}.`)]
  assert.equal(gateAuthorizes(evidence, HEAD, BUNDLE, never), true)
})

test('gate: an APPROVE without the bundle needs a matching assignment head', () => {
  const evidence = [comment(`APPROVE

Head ${HEAD}.`)]
  // No assignment at this head -> not authorized, even though the verdict is real.
  assert.equal(gateAuthorizes(evidence, HEAD, BUNDLE, () => []), false)
  assert.equal(gateAuthorizes(evidence, HEAD, BUNDLE, () => [{ headSha: 'deadbeef' }]), false)
  // An assignment pinned to this exact head -> authorized.
  assert.equal(gateAuthorizes(evidence, HEAD, BUNDLE, () => [{ headSha: HEAD }]), true)
})

test('gate: APPROVE WITH CONDITIONS does not authorize a migration', () => {
  const evidence = [comment(`APPROVE WITH CONDITIONS

Head ${HEAD}, bundle ${BUNDLE}.`)]
  assert.equal(gateAuthorizes(evidence, HEAD, BUNDLE, never), false)
})

test('gate: evidence tied to another head cannot authorize this one', () => {
  const evidence = [comment(`APPROVE

Head ${REAL_REFUSAL_HEAD}, bundle ${BUNDLE}.`)]
  assert.equal(gateAuthorizes(evidence, HEAD, BUNDLE, never), false)
})

test('gate: the assignment lookup stays lazy (wire budget)', () => {
  // Evidence carrying the bundle id must short-circuit before the network read.
  const evidence = [comment(`APPROVE

Head ${HEAD}, bundle ${BUNDLE}.`)]
  assert.equal(gateAuthorizes(evidence, HEAD, BUNDLE, never), true)
  // Evidence with no approval at all must not trigger it either.
  assert.equal(gateAuthorizes([comment('no verdict here')], HEAD, BUNDLE, never), false)
})

test('gate: empty and malformed evidence fails closed', () => {
  assert.equal(gateAuthorizes(undefined, HEAD, BUNDLE, never), false)
  assert.equal(gateAuthorizes([], HEAD, BUNDLE, never), false)
  assert.equal(gateAuthorizes([{}, null], HEAD, BUNDLE, never), false)
})

test('gate: exact-head refusals never authorize even when they name the bundle', () => {
  const refusals = [
    comment(`REVISE\n\nHead ${HEAD}, bundle ${BUNDLE}.`),
    comment(`VERDICT: REJECT\n\nHead ${HEAD}, bundle ${BUNDLE}.`),
    { body: `Bundle ${BUNDLE}.`, state: 'CHANGES_REQUESTED', commit_id: HEAD },
  ]
  for (const row of refusals) {
    assert.equal(isVerdictFor(row, HEAD), true, 'fixture must be a real refusal verdict')
    assert.equal(gateAuthorizes([row], HEAD, BUNDLE, never), false)
  }
})

test('gate: absent and malformed assignment results remain inert', () => {
  const approval = comment(`APPROVE\n\nHead ${HEAD}.`)
  assert.equal(gateAuthorizes([approval], HEAD, BUNDLE), false)
  assert.equal(gateAuthorizes([approval], HEAD, BUNDLE, () => null), false)
  assert.equal(gateAuthorizes([approval], HEAD, BUNDLE, () => [null, {}, { headSha: null }]), false)
})

test('mutation: swapping isApprovalFor for isVerdictFor makes a refusal authorize', () => {
  const swappedPredicateMutation = (evidence, headSha, bundleId, readAssignments) =>
    (evidence ?? []).some((row) => isVerdictFor(row, headSha) && (
      String(row?.body ?? '').includes(bundleId) ||
      (readAssignments?.() ?? []).some((assignment) => assignment?.headSha === headSha)))
  const refusal = comment(`REVISE\n\nHead ${HEAD}, bundle ${BUNDLE}.`)
  assert.equal(swappedPredicateMutation([refusal], HEAD, BUNDLE, never), true)
  assert.equal(gateAuthorizes([refusal], HEAD, BUNDLE, never), false)
})
