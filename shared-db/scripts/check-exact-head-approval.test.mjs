import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateExactHeadApproval as evaluateRaw, gatherApprovalInput, parseAssignmentRef, ApprovalCheckError } from './check-exact-head-approval.mjs'

const OLD = 'b494401028464ef8b2e67fe0b5b1836839b2be36'
const NEW = '8d3c31accd5b21ea669e65f5ae53f5f95cc57337'
const evaluateExactHeadApproval = (input) => evaluateRaw({...input,evidence:(input.evidence??[]).map((row)=>row&&({author_association:'OWNER',...row}))})

test('comment verdicts are unauthorized by default', () => {
  const input={pr:1809,headSha:NEW,assignments:[{issue:1769,pr:1809,headSha:NEW}],evidence:[{body:`VERDICT: APPROVE ${NEW}`}]}
  assert.throws(()=>evaluateRaw(input),/has no APPROVE tied to it/)
  assert.equal(evaluateRaw({...input,evidence:[{...input.evidence[0],author_association:'OWNER'}]}).approved,true)
})

test('an approval tied to the exact head, with an assignment pinned to it, authorizes the merge', () => {
  const result = evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [{ body: `APPROVE ${NEW}` }],
  })
  assert.equal(result.approved, true)
  assert.equal(result.approvals, 1)
})

// This is the exact sequence that put unapproved bytes on main in PR #1809:
// grok-4.6 was assigned OLD and REJECTed it, the author pushed NEW to answer the
// findings, and NEW merged. Nothing in the merge gate looked at NEW.
test('REJECT at one head, then a new commit answering it, does not authorize merging the new head', () => {
  assert.throws(() => evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: OLD }],
    evidence: [{ body: `REJECT ${OLD} -- anchor validation is wrong` }],
  }), (error) => error instanceof ApprovalCheckError && /no reviewer was ever assigned head/.test(error.message))
})

test('an APPROVE of an earlier head never approves the bytes actually being merged', () => {
  assert.throws(() => evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [{ body: `APPROVE ${OLD}` }],
  }), /has no APPROVE tied to it/)
})

test('a reviewer assignment alone is not an approval', () => {
  assert.throws(() => evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [],
  }), /has no APPROVE tied to it/)
})

test('a refusal at the merged head outranks an approval at that same head', () => {
  assert.throws(() => evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [{ body: `APPROVE ${NEW}` }, { body: `REVISE ${NEW}` }],
  }), /unanswered reviewer refusal/)
})

test('GitHub\'s own review states are honoured alongside body verdicts', () => {
  assert.equal(evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [{ commit_id: NEW, state: 'APPROVED', body: '' }],
  }).approved, true)
  assert.throws(() => evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [{ commit_id: NEW, state: 'CHANGES_REQUESTED', body: '' }],
  }), /unanswered reviewer refusal/)
})

test('assignments belonging to a different head are ignored even when several exist', () => {
  assert.throws(() => evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: OLD }, { issue: 1769, pr: 1809, headSha: 'c'.repeat(40) }],
    evidence: [{ body: `APPROVE ${NEW}` }],
  }), /no reviewer was ever assigned head/)
})

test('an inexact or missing head is refused rather than guessed', () => {
  assert.throws(() => evaluateExactHeadApproval({ pr: 1809, headSha: '8d3c31a' }), /exact 40-character head SHA/)
  assert.throws(() => evaluateExactHeadApproval({ pr: 0, headSha: NEW }), /exact pull request number/)
})

// A reviewer replaced after a failure keeps its assignment under the replacement
// namespace, and slot 2 assignments carry a `-slot<N>` suffix. Both are pinned to
// the same head, so both must count -- otherwise a merge whose review genuinely
// happened is refused for lack of an assignment that is sitting right there.
test('slot and replacement assignment refs are recognised as assignments at that head', () => {
  assert.deepEqual(parseAssignmentRef(`refs/db-review-assignments/1769-1809-${NEW}`), { issue: 1769, pr: 1809, headSha: NEW, slot: 1, replacementSequence: null })
  assert.deepEqual(parseAssignmentRef(`refs/db-review-assignments/1769-1809-${NEW}-slot2`), { issue: 1769, pr: 1809, headSha: NEW, slot: 2, replacementSequence: null })
  // The PRODUCTION shape. `manage-migration-author-lanes.mjs` writes the replacement
  // link as `<base>-<failedSequence>` -- dash, then digits -- and its own namespace
  // predicate requires exactly that. An earlier version of this test asserted a slash
  // form the writer never emits, so the parser passed its tests while discarding every
  // real replacement ref.
  assert.deepEqual(parseAssignmentRef(`refs/db-review-replacements/1769-1809-${NEW}-1`), { issue: 1769, pr: 1809, headSha: NEW, slot: 1, replacementSequence: 1 })
  assert.deepEqual(parseAssignmentRef(`refs/db-review-replacements/1769-1809-${NEW}-slot2-1`), { issue: 1769, pr: 1809, headSha: NEW, slot: 2, replacementSequence: 1 })
  assert.equal(parseAssignmentRef(`refs/db-review-replacements/1769-1809-${NEW}/1`), null)
  assert.equal(parseAssignmentRef('refs/heads/main'), null)
  assert.equal(parseAssignmentRef(`refs/db-review-assignments/1769-1809-${NEW.slice(0, 7)}`), null)
})

// A lane locked its own PR by writing a progress note that named the head SHA and
// contained the word REVISE. The note read as a recorded refusal, and under this
// enforced gate that head becomes unmergeable with no comment-shaped symptom.
// A verdict leads its line; prose that mentions one does not.
test('a progress note mentioning a verdict word does not lock or approve a head', () => {
  const note = { body: `Status: pushed a fix at ${NEW}; the earlier REVISE findings are answered here.` }
  assert.throws(() => evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [note],
  }), /has no APPROVE tied to it/)
  assert.equal(evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [note, { body: `APPROVE ${NEW}` }],
  }).approved, true)
  assert.throws(() => evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [{ body: `We should APPROVE ${NEW} once CI is green.` }],
  }), /has no APPROVE tied to it/)
})

test('a real verdict still counts through markdown emphasis, quoting and a later line', () => {
  assert.throws(() => evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [{ body: `Reviewed head ${NEW}.\n\n**REVISE** -- the anchor is wrong.` }],
  }), /unanswered reviewer refusal/)
  assert.equal(evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [{ body: `> APPROVE ${NEW}` }],
  }).approved, true)
})

// The adapter, driven with the shapes GitHub actually returns -- ref rows as
// {ref, object}, review rows as {state, commit_id, body}, comment rows as {body}.
// The evaluation core was covered and this layer was not, and a conversion layer
// whose test shape diverges from production is where this class of defect hides.
function githubLike({ refs, comments = [], reviews = [] }) {
  return {
    json: (args) => {
      const endpoint = args[args.length - 1]
      if (endpoint.includes('/git/matching-refs/db-review-assignments')) return refs.filter((r) => r.ref.includes('assignments'))
      if (endpoint.includes('/git/matching-refs/db-review-replacements')) return refs.filter((r) => r.ref.includes('replacements'))
      if (endpoint.includes('/git/matching-refs/db-review-verdict')) return []
      if (/\/pulls\/\d+$/.test(endpoint)) return { head: { sha: NEW } }
      throw new Error(`unexpected endpoint ${endpoint}`)
    },
    pages: (endpoint) => (endpoint.includes('/reviews') ? reviews : comments),
  }
}

test('the adapter refuses a prose approval when the governed path wrote no verdict artifact', () => {
  const input = gatherApprovalInput({ PR_NUMBER: '1809' }, githubLike({
    refs: [{ ref: `refs/db-review-assignments/1769-1809-${NEW}`, object: { sha: 'e'.repeat(40), type: 'commit' } }],
    reviews: [{ state: 'APPROVED', commit_id: NEW, body: '' }],
  }))
  assert.equal(input.headSha, NEW)
  assert.equal(input.assignments.length, 1)
  assert.throws(()=>evaluateExactHeadApproval(input),/no durable APPROVE artifact/)
})

test('the adapter carries a refusal and a stale-head assignment through unflattened', () => {
  const stale = gatherApprovalInput({ PR_NUMBER: '1809' }, githubLike({
    refs: [{ ref: `refs/db-review-assignments/1769-1809-${OLD}`, object: {} }],
    comments: [{ body: `REJECT ${OLD} -- anchor validation is wrong` }],
  }))
  assert.throws(() => evaluateExactHeadApproval(stale), /no reviewer was ever assigned head/)
  const refused = gatherApprovalInput({ PR_NUMBER: '1809' }, githubLike({
    refs: [{ ref: `refs/db-review-replacements/1769-1809-${NEW}/1`, object: {} }],
    comments: [{ body: `REVISE ${NEW} -- the reconciler still refuses this manifest` }],
  }))
  assert.throws(() => evaluateExactHeadApproval(refused), /no reviewer was ever assigned head/)
})

test('raw verdict-shaped objects cannot cross the approval trust boundary',()=>{
  assert.throws(()=>evaluateRaw({pr:1809,headSha:NEW,assignments:[{pr:1809,headSha:NEW,slot:1,sha:'a'.repeat(40)}],verdicts:[{pr:1809,head_sha:NEW,verdict:'APPROVE',ref:'fake',assignment_sha:'a'.repeat(40)}]}),/without artifact validation/)
})

test('the adapter refuses rather than guesses when the PR number is absent', () => {
  assert.throws(() => gatherApprovalInput({}, githubLike({ refs: [] })), /PR number is unavailable/)
})

// The reviewer wrappers emit `VERDICT: APPROVE`, not a bare `APPROVE` -- the format
// is in this repo's own review archive and in the lanes file's own comment. Anchoring
// on the bare word alone rejected every genuine approval, which is the inverse of the
// defect this file exists to fix and fails closed on VALID input, so it presents as
// reviewers not returning verdicts rather than as a broken gate.
test('the wrapper format VERDICT: APPROVE is recognised, and its refusal form still refuses', () => {
  const pinned = { pr: 1809, headSha: NEW, assignments: [{ issue: 1769, pr: 1809, headSha: NEW }] }
  for (const body of [`VERDICT: APPROVE ${NEW}`, `## VERDICT: APPROVE\n\nhead ${NEW}`, `Reviewed ${NEW}.\n\nverdict: approved`]) {
    assert.equal(evaluateExactHeadApproval({ ...pinned, evidence: [{ body }] }).approved, true, body)
  }
  assert.throws(() => evaluateExactHeadApproval({ ...pinned, evidence: [{ body: `VERDICT: REVISE ${NEW}` }] }), /unanswered reviewer refusal/)
})

// Stripping the label must not strip the verdict. `DO NOT APPROVE` is a refusal to
// approve, and reading it as an approval is the worst single failure this gate could
// have: it authorizes a merge the reviewer explicitly declined to authorize.
// THE #1809 HOLE, REAPPEARING INSIDE THE TOOL BUILT TO CLOSE IT. Under a
// permissive head tie, a comment approving head A that merely mentions head B is
// tied to B and opens a line with APPROVE, so it authorizes B -- bytes nobody
// looked at. Found by codex-gpt-5.6-sol at head 6ad02227 and confirmed by probe:
// the shape approved where it must refuse. An approval must name ONE head.
test('an approval of an earlier head does not carry to a new head it merely mentions', () => {
  const pinned = { pr: 1809, headSha: NEW, assignments: [{ issue: 1769, pr: 1809, headSha: NEW }] }
  assert.throws(() => evaluateExactHeadApproval({
    ...pinned,
    evidence: [{ body: `VERDICT: APPROVE ${OLD}\n\nNote: the author has since pushed ${NEW}.` }],
  }), /has no APPROVE tied to it/)
  // Any second commit-length SHA makes the reference ambiguous, whichever order.
  assert.throws(() => evaluateExactHeadApproval({
    ...pinned,
    evidence: [{ body: `Reviewed ${NEW}, which supersedes ${OLD}.\n\nVERDICT: APPROVE` }],
  }), /has no APPROVE tied to it/)
  // A single-head approval still passes -- the fix must not refuse valid input.
  assert.equal(evaluateExactHeadApproval({ ...pinned, evidence: [{ body: `VERDICT: APPROVE ${NEW}` }] }).approved, true)
  // GitHub's own commit binding is structured data, so it is unambiguous even
  // when the prose mentions other heads.
  assert.equal(evaluateExactHeadApproval({
    ...pinned,
    evidence: [{ commit_id: NEW, state: 'APPROVED', body: `supersedes ${OLD}` }],
  }).approved, true)
})

// The asymmetry is deliberate. A refusal keeps the permissive tie: over-locking
// costs a re-review, over-approving merges unreviewed bytes.
test('a refusal still locks a head it mentions alongside another SHA', () => {
  assert.throws(() => evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [{ body: `VERDICT: REVISE ${OLD}\n\nand the same defect is still present at ${NEW}.` }],
  }), /unanswered reviewer refusal/)
})

test('a labelled non-approval is not turned into an approval by label stripping', () => {
  assert.throws(() => evaluateExactHeadApproval({
    pr: 1809, headSha: NEW,
    assignments: [{ issue: 1769, pr: 1809, headSha: NEW }],
    evidence: [{ body: `VERDICT: DO NOT APPROVE ${NEW}` }],
  }), /has no APPROVE tied to it/)
})

// A conditional approval is a refusal-with-remedy. It must not satisfy the gate --
// and, just as importantly, it must not lock the head either, or a reviewer's own
// conditions strand the head those conditions were meant to be met on.
test('APPROVE WITH CONDITIONS neither authorizes the merge nor locks the head', () => {
  const pinned = { pr: 1809, headSha: NEW, assignments: [{ issue: 1769, pr: 1809, headSha: NEW }] }
  const conditional = { body: `VERDICT: APPROVE WITH CONDITIONS ${NEW} -- rerun the reconciler first` }
  assert.throws(() => evaluateExactHeadApproval({ ...pinned, evidence: [conditional] }), /has no APPROVE tied to it/)
  // Punctuated separators are the same claim. A whitespace-only lookahead read both
  // of these as clean approvals.
  for (const body of [`VERDICT: APPROVE, WITH CONDITIONS ${NEW}`, `VERDICT: APPROVE -- WITH CONDITIONS ${NEW}`]) {
    assert.throws(() => evaluateExactHeadApproval({ ...pinned, evidence: [{ body }] }), /has no APPROVE tied to it/, body)
  }
  assert.equal(evaluateExactHeadApproval({ ...pinned, evidence: [conditional, { body: `VERDICT: APPROVE ${NEW}` }] }).approved, true)
})

// The claim is "with conditions", not the word WITH sitting next to APPROVE. The
// adjacency lookahead this replaces was wrong in BOTH directions at once, and the
// over-refusing direction is the one that fails closed on real approvals.
test('conditional approval is detected by the claim, however it is worded or wrapped', () => {
  const pinned = { pr: 1809, headSha: NEW, assignments: [{ issue: 1769, pr: 1809, headSha: NEW }] }
  for (const body of [
    `VERDICT: APPROVE ONLY WITH CONDITIONS ${NEW}`,
    `VERDICT: APPROVE, BUT WITH CONDITIONS ${NEW}`,
    // Wrapped across two lines by the reviewer's own formatting.
    `Reviewed ${NEW}.\n\nVERDICT: APPROVE\nWITH CONDITIONS: rerun the reconciler first`,
  ]) {
    assert.throws(() => evaluateExactHeadApproval({ ...pinned, evidence: [{ body }] }), /has no APPROVE tied to it/, body)
  }
  // ...and these are unconditional approvals that the adjacency rule wrongly refused.
  for (const body of [`VERDICT: APPROVE WITH no reservations ${NEW}`, `VERDICT: APPROVE WITH confidence ${NEW}`]) {
    assert.equal(evaluateExactHeadApproval({ ...pinned, evidence: [{ body }] }).approved, true, body)
  }
})

// `.ai/reviews/phase6-glm-review.md:7` is literally `## VERDICT: **APPROVED`. An
// archived, genuine approval form that the gate refused is the refuse-all-valid-input
// defect, which surfaces as reviewers apparently not returning verdicts.
test('emphasis after the VERDICT label does not hide the verdict', () => {
  const pinned = { pr: 1809, headSha: NEW, assignments: [{ issue: 1769, pr: 1809, headSha: NEW }] }
  for (const body of [`## VERDICT: **APPROVED**\n\nhead ${NEW}`, `VERDICT: __APPROVE__ ${NEW}`]) {
    assert.equal(evaluateExactHeadApproval({ ...pinned, evidence: [{ body }] }).approved, true, body)
  }
  assert.throws(() => evaluateExactHeadApproval({ ...pinned, evidence: [{ body: `VERDICT: **REVISE** ${NEW}` }] }), /unanswered reviewer refusal/)
  // Stripping emphasis must still not strip letters.
  assert.throws(() => evaluateExactHeadApproval({ ...pinned, evidence: [{ body: `VERDICT: **DO NOT APPROVE** ${NEW}` }] }), /has no APPROVE tied to it/)
})

// A reviewer writing the refusal in prose spells it with a space. Only the
// underscore form locked a head before, so the space form was silently ignorable.
test('REQUEST CHANGES with a space is a refusal, like its underscore form', () => {
  const pinned = { pr: 1809, headSha: NEW, assignments: [{ issue: 1769, pr: 1809, headSha: NEW }] }
  for (const body of [`VERDICT: REQUEST CHANGES ${NEW}`, `VERDICT: REQUEST_CHANGES ${NEW}`]) {
    assert.throws(() => evaluateExactHeadApproval({ ...pinned, evidence: [{ body }] }), /unanswered reviewer refusal/, body)
  }
})
