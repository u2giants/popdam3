import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { evaluateExactHeadApproval as evaluateRaw, gatherApprovalInput, parseAssignmentRef, requireDurableVerdictInput, ApprovalCheckError } from './check-exact-head-approval.mjs'

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
  assert.deepEqual(parseAssignmentRef(`refs/db-review-assignments/1769-1809-${NEW}`), { replacement: false, issue: 1769, pr: 1809, headSha: NEW, slot: 1, replacementSequence: null })
  assert.deepEqual(parseAssignmentRef(`refs/db-review-assignments/1769-1809-${NEW}-slot2`), { replacement: false, issue: 1769, pr: 1809, headSha: NEW, slot: 2, replacementSequence: null })
  // The PRODUCTION shape. `manage-migration-author-lanes.mjs` writes the replacement
  // link as `<base>-<failedSequence>` -- dash, then digits -- and its own namespace
  // predicate requires exactly that. An earlier version of this test asserted a slash
  // form the writer never emits, so the parser passed its tests while discarding every
  // real replacement ref.
  assert.deepEqual(parseAssignmentRef(`refs/db-review-replacements/1769-1809-${NEW}-1`), { replacement: true, issue: 1769, pr: 1809, headSha: NEW, slot: 1, replacementSequence: 1 })
  assert.deepEqual(parseAssignmentRef(`refs/db-review-replacements/1769-1809-${NEW}-slot2-1`), { replacement: true, issue: 1769, pr: 1809, headSha: NEW, slot: 2, replacementSequence: 1 })
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
      if (endpoint.includes('/git/matching-refs/db-review-returns')) return []
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

// ISSUE #2075. `evaluateExactHeadApproval` still contains a comment-text branch,
// used as a predicate library by the tests above and by callers with no access to
// the durable refs. In the MERGE GATE that branch must be unreachable: production
// input always carries the durable verdict artifacts, and if it ever stopped, the
// gate would silently start authorizing merges from comment prose. So the
// boundary refuses rather than falling through.
test('issue 2075: the merge gate refuses input that carries no durable verdict list', () => {
  const input = { pr: 2080, headSha: 'a'.repeat(40), evidence: [], assignments: [] }
  assert.throws(() => requireDurableVerdictInput(input), /never authorized by comment text/)
  assert.throws(() => requireDurableVerdictInput({ ...input, verdicts: null }), /never authorized by comment text/)
  assert.deepEqual(requireDurableVerdictInput({ ...input, verdicts: [] }).verdicts, [])
})

// THE MERGE GATE MUST SEE A RETURNED SLOT.
//
// `--exclude-reviewer` hands a slot back by compare-and-clearing its assignment
// ref and writing a durable return record in its place. This gate listed only the
// live assignment namespaces, so a returned slot did not read as unapproved -- it
// read as a slot that had never existed. Slot 1 approved, slot 2 returned and
// never re-drawn, and the gate authorized the merge: bytes merged over a slot no
// reviewer ever answered. Before returns existed the ref stayed live and the gate
// failed closed, so clearing the ref is what turned this fail-open on, and the
// rule was enforced only by the PREVIEW gate, which runs after the merge.
//
// Driven through the ADAPTER with the ref, commit and comment shapes GitHub
// actually returns, because the gap was in what the adapter never read.
const RETURN_HEAD = 'a'.repeat(40)
function returnedSlotGithub({ redrawSequence = null } = {}) {
  const issue = 1824, pr = 1931
  const assignment1 = '1'.repeat(40), assignment2 = '2'.repeat(40), redraw = '7'.repeat(40)
  const findingsBody = 'review findings', findingsRef = `https://github.com/u2giants/shared-db/pull/${pr}#issuecomment-1`
  const digest = createHash('sha256').update(findingsBody).digest('hex')
  const commits = new Map(), assignmentRefs = [], verdictRefs = []
  const cursor = (sha, sequence, slot, reviewer) => commits.set(sha, { message: `db-coordination reviewer-cursor sequence=${sequence} reviewer=${reviewer} issue=${issue} pr=${pr} head=${RETURN_HEAD} slot=${slot}` })
  const approve = (sha, slot, assignmentSha, reviewer) => {
    const record = { verdict: 'APPROVE', head_sha: RETURN_HEAD, issue, pr, slot, reviewer, assignment_sha: assignmentSha, findings_digest: digest, findings_ref: findingsRef }
    commits.set(sha, { message: `db-review-verdict ${JSON.stringify(record)}`, parents: [{ sha: assignmentSha }] })
    verdictRefs.push({ ref: `refs/db-review-verdicts/${issue}-${pr}-${RETURN_HEAD}${slot === 1 ? '' : `-slot${slot}`}`, object: { sha } })
  }
  cursor(assignment1, 1, 1, 'kimi-k3')
  assignmentRefs.push({ ref: `refs/db-review-assignments/${issue}-${pr}-${RETURN_HEAD}`, object: { sha: assignment1 } })
  approve('4'.repeat(40), 1, assignment1, 'kimi-k3')
  // Slot 2 was assigned, then its reviewer was excluded: the ref is gone and only
  // the return record remains. That record is the whole difference between "this
  // slot is unapproved" and "this slot was never there".
  cursor(assignment2, 2, 2, 'grok-4.6')
  commits.set('8'.repeat(40), { message: `db-coordination reviewer-return reviewer=grok-4.6 issue=${issue} pr=${pr} head=${RETURN_HEAD} slot=2 assignment=${assignment2} sequence=2 reason=independence-conflict`, parents: [{ sha: assignment2 }] })
  const returnRefs = [{ ref: `refs/db-review-returns/${issue}-${pr}-${RETURN_HEAD}-slot2-${assignment2}`, object: { sha: '8'.repeat(40) } }]
  // A re-drawn slot 2, with its own APPROVE. `redrawSequence` is what decides
  // whether it answers the return or is a record the return already superseded.
  if (redrawSequence !== null) {
    cursor(redraw, redrawSequence, 2, 'kimi-k3')
    assignmentRefs.push({ ref: `refs/db-review-assignments/${issue}-${pr}-${RETURN_HEAD}-slot2`, object: { sha: redraw } })
    approve('5'.repeat(40), 2, redraw, 'kimi-k3')
  }
  return {
    json: (args) => {
      const endpoint = args[args.length - 1]
      if (endpoint.includes('/git/matching-refs/db-review-assignments')) return assignmentRefs
      if (endpoint.includes('/git/matching-refs/db-review-replacements')) return []
      if (endpoint.includes('/git/matching-refs/db-review-returns')) return returnRefs
      if (endpoint.includes('/git/matching-refs/db-review-verdicts')) return verdictRefs
      if (endpoint.includes('/git/matching-refs/db-review-verdict-replacements')) return []
      if (/\/git\/commits\/[0-9a-f]{40}$/.test(endpoint)) return commits.get(endpoint.split('/').pop())
      if (endpoint.includes('/issues/comments/')) return { body: findingsBody }
      if (/\/pulls\/\d+$/.test(endpoint)) return { head: { sha: RETURN_HEAD } }
      throw new Error(`unexpected endpoint ${endpoint}`)
    },
    pages: () => [],
  }
}

test('the merge gate refuses a head whose slot was durably returned and never re-drawn', () => {
  const input = gatherApprovalInput({ PR_NUMBER: '1931' }, returnedSlotGithub())
  assert.equal(input.returns.length, 1)
  assert.equal(input.returns[0].slot, 2)
  assert.equal(input.returns[0].sequence, 2)
  assert.throws(() => evaluateExactHeadApproval(input), (error) => error instanceof ApprovalCheckError && /review slot 2 was durably returned/.test(error.message))
})

// "Newer" is the GLOBAL reviewer cursor sequence, spent once by every assignment
// and every replacement out of the same counter -- not the replacement namespace
// tail, which is not a clock. A re-draw that spent a later sequence answers the
// return; a record the return had already superseded does not, even with its own
// APPROVE sitting right there.
test('a returned slot is answered only by an assignment drawn after the returned one', () => {
  assert.equal(evaluateExactHeadApproval(gatherApprovalInput({ PR_NUMBER: '1931' }, returnedSlotGithub({ redrawSequence: 9 }))).approved, true)
  assert.throws(() => evaluateExactHeadApproval(gatherApprovalInput({ PR_NUMBER: '1931' }, returnedSlotGithub({ redrawSequence: 1 }))), /review slot 2 was durably returned/)
})

// The ref name only SELECTS the record; the commit is what is trusted, and it is
// checked back against the name it is stored under. A return record filed under a
// name that does not describe it decides which slot is charged, so a disagreement
// stops the gate rather than being resolved in either direction.
test('a return record whose commit disagrees with its ref name stops the gate', () => {
  const base = returnedSlotGithub()
  const io = { ...base, json: (args) => {
    const endpoint = args[args.length - 1]
    if (endpoint.includes('/git/matching-refs/db-review-returns')) return [{ ref: `refs/db-review-returns/1824-1931-${RETURN_HEAD}-${'2'.repeat(40)}`, object: { sha: '8'.repeat(40) } }]
    return base.json(args)
  } }
  assert.throws(() => gatherApprovalInput({ PR_NUMBER: '1931' }, io), /does not match its ref identity/)
})

// THE NON-READING-REVIEWER RULE AT THE GATE THAT AUTHORIZES MERGES (#2079).
//
// The write-side guard (`recordReviewVerdict`) binds only FUTURE verdicts, and the
// read-side rule (`readReviewVerdicts`) is called only by the PREVIEW gate, which
// under merge-first runs AFTER the merge. This gate is the required context the
// guarded merge workflow waits on, so until it applied the rule, a legacy APPROVE
// from a reviewer that never opened the diff still authorized a merge, and a legacy
// REVISE from that same reviewer blocked the head permanently -- even after the
// sanctioned --replace-failed-reviewer route recorded a fresh reading APPROVE.
// Both directions are asserted, plus a scope control proving a healthy reviewer's
// verdict still counts, so the rule cannot be satisfied by refusing everything.
const NONREAD_HEAD = 'c'.repeat(40)
function nonReadingVerdictGithub({ reviewer = 'deepseek-chat', verdict = 'APPROVE', replacement = null } = {}) {
  const issue = 1987, pr = 1989
  const assignment = '1'.repeat(40), replacementAssignment = '3'.repeat(40)
  const findingsBody = 'review findings', findingsRef = `https://github.com/u2giants/shared-db/pull/${pr}#issuecomment-1`
  const digest = createHash('sha256').update(findingsBody).digest('hex')
  const commits = new Map(), assignmentRefs = [], verdictRefs = [], replacementRefs = [], verdictReplacementRefs = []
  const cursor = (sha, sequence, who) => commits.set(sha, { message: `db-coordination reviewer-cursor sequence=${sequence} reviewer=${who} issue=${issue} pr=${pr} head=${NONREAD_HEAD} slot=1` })
  const record = (sha, who, what, assignmentSha, refs, ref) => {
    const row = { verdict: what, head_sha: NONREAD_HEAD, issue, pr, slot: 1, reviewer: who, assignment_sha: assignmentSha, findings_digest: digest, findings_ref: findingsRef }
    commits.set(sha, { message: `db-review-verdict ${JSON.stringify(row)}`, parents: [{ sha: assignmentSha }] })
    refs.push({ ref, object: { sha } })
  }
  cursor(assignment, 1, reviewer)
  assignmentRefs.push({ ref: `refs/db-review-assignments/${issue}-${pr}-${NONREAD_HEAD}`, object: { sha: assignment } })
  record('4'.repeat(40), reviewer, verdict, assignment, verdictRefs, `refs/db-review-verdicts/${issue}-${pr}-${NONREAD_HEAD}`)
  // The recovery route: a reviewer that reads the code, drawn at the SAME head
  // under the replacement namespace, recording its own APPROVE.
  if (replacement) {
    cursor(replacementAssignment, 2, replacement)
    replacementRefs.push({ ref: `refs/db-review-replacements/${issue}-${pr}-${NONREAD_HEAD}-1`, object: { sha: replacementAssignment } })
    record('5'.repeat(40), replacement, 'APPROVE', replacementAssignment, verdictReplacementRefs, `refs/db-review-verdict-replacements/${issue}-${pr}-${NONREAD_HEAD}-1`)
  }
  return {
    json: (args) => {
      const endpoint = args[args.length - 1]
      if (endpoint.includes('/git/matching-refs/db-review-assignments')) return assignmentRefs
      if (endpoint.includes('/git/matching-refs/db-review-replacements')) return replacementRefs
      if (endpoint.includes('/git/matching-refs/db-review-returns')) return []
      if (endpoint.includes('/git/matching-refs/db-review-verdict-replacements')) return verdictReplacementRefs
      if (endpoint.includes('/git/matching-refs/db-review-verdicts')) return verdictRefs
      if (/\/git\/commits\/[0-9a-f]{40}$/.test(endpoint)) return commits.get(endpoint.split('/').pop())
      if (endpoint.includes('/issues/comments/')) return { body: findingsBody }
      if (/\/pulls\/\d+$/.test(endpoint)) return { head: { sha: NONREAD_HEAD } }
      throw new Error(`unexpected endpoint ${endpoint}`)
    },
    pages: () => [],
  }
}

test('the merge gate does not let an APPROVE from a reviewer that cannot read the repository authorize a merge (#2079)', () => {
  const input = gatherApprovalInput({ PR_NUMBER: '1989' }, nonReadingVerdictGithub({ verdict: 'APPROVE' }))
  assert.equal(input.verdicts.length, 1)
  assert.throws(() => evaluateExactHeadApproval(input), (error) => error instanceof ApprovalCheckError
    && /no durable APPROVE artifact/.test(error.message)
    && /DISREGARDED because their reviewer cannot read the repository/.test(error.message)
    && /deepseek-chat/.test(error.message))
})

test('the merge gate does not let a REVISE from a reviewer that cannot read the repository block a head forever (#2079)', () => {
  // Alone it is absent, not a refusal: the gate must refuse for the ordinary
  // "no durable APPROVE" reason, which --replace-failed-reviewer can answer.
  const alone = gatherApprovalInput({ PR_NUMBER: '1989' }, nonReadingVerdictGithub({ verdict: 'REVISE' }))
  assert.throws(() => evaluateExactHeadApproval(alone), (error) => error instanceof ApprovalCheckError
    && /no durable APPROVE artifact/.test(error.message)
    && !/carries a durable reviewer refusal/.test(error.message))
  // And once the sanctioned recovery route records a reading reviewer's APPROVE at
  // the same head, the disregarded REVISE must not still block the merge.
  const recovered = gatherApprovalInput({ PR_NUMBER: '1989' }, nonReadingVerdictGithub({ verdict: 'REVISE', replacement: 'kimi-k3' }))
  assert.equal(evaluateExactHeadApproval(recovered).approved, true)
})

test('a reviewer that does read the repository still authorizes and still blocks (#2079)', () => {
  assert.equal(evaluateExactHeadApproval(gatherApprovalInput({ PR_NUMBER: '1989' }, nonReadingVerdictGithub({ reviewer: 'kimi-k3', verdict: 'APPROVE' }))).approved, true)
  assert.throws(() => evaluateExactHeadApproval(gatherApprovalInput({ PR_NUMBER: '1989' }, nonReadingVerdictGithub({ reviewer: 'kimi-k3', verdict: 'REVISE' }))), /carries a durable reviewer refusal/)
})
