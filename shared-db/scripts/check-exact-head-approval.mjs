#!/usr/bin/env node
// Merge authorization requires a rotation-assigned APPROVE tied to the EXACT head
// being merged. ("Rotation-assigned", not "independent": see WHAT THIS GATE DOES
// NOT CHECK below. The word independent describes the assignment process and is
// deliberately absent from this file's messages, which must not claim more than
// the check performs.)
//
// Why this file exists (#1816): the guarded-migration-merge workflow proved head
// identity, base currency, object collisions and the author lease, but never once
// asked whether the bytes being merged had been approved. The exact-head rule was
// enforced by convention in the orchestrator's instructions and by the PREVIEW
// gate -- which, under merge-first (AGENTS.md section 4 rule 2), only runs AFTER
// the merge. So the sequence
//
//     reviewer REJECTs head A  ->  author pushes head B answering it  ->  merge B
//
// merged bytes no reviewer had ever seen. That happened on PR #1809 (issue #1769):
// grok-4.6 was assigned and REJECTed b494401, commit 8d3c31a answered the findings,
// and 8d3c31a merged as 2b68e7e with zero approvals tied to it.
//
// An assignment is not an approval and an approval at an older head is not an
// approval of these bytes. Both are required, both pinned to the same exact SHA.
//
// WHAT THIS GATE DOES NOT CHECK -- stated here so nobody reads more into a pass
// than it carries. It enforces `an assignment exists at this head` AND `an approval
// exists at this head`, not `the assigned reviewer approved`. Assignment refs record
// {issue, pr, headSha} and no reviewer identity. Free-text evidence is accepted only
// from OWNER, MEMBER or COLLABORATOR associations, closing the public-comment
// forgery, but that still does not bind the assigned provider to the commenter. The word
// "independent" here describes the assignment PROCESS -- the rotation in
// `manage-migration-author-lanes.mjs`, which picks the reviewer and refuses the
// live orchestrator's own engine -- and is not a property this file verifies.
// One deliberate limit remains: fenced or indented code containing a verdict line
// counts.
//
// A SECOND "deliberate limit" recorded here previously was not one. It said the
// head tie matched the SHA anywhere in the body for approvals as well as refusals,
// and reasoned that a comment quoting an old approval while naming the new head
// counting at the new head was an acceptable cost. It was not acceptable: it was
// PR #1809's failure rebuilt inside the tool written to prevent it, and a probe
// confirmed the shape authorized a head nobody had reviewed. See
// `unambiguouslyTiedToHead` below for what replaced it. Recorded here rather than
// deleted, because "we considered this and accepted it" is exactly how a fail-open
// survives review, and the next reader should see that this file has made that
// mistake once already.
// Against the status quo this replaces -- nothing at all, which merged unapproved
// bytes on PR #1809 -- it is a process-integrity gate and a large improvement. It is
// not proof of reviewer identity, and it should never be cited as one.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { REPO, REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_REPLACEMENT_REF_PREFIX, REVIEW_RETURN_REF_PREFIX, parseAssignmentRef, parseReviewCursor, parseReviewReturn, reviewReturnRef, reviewerReadsRepository } from './manage-migration-author-lanes.mjs'
import { approvalLine, evidenceTiedToHead, refusalLine, trustedVerdictEvidence, unambiguouslyTiedToHead } from './lib/review-verdict.mjs'
import { REVIEW_VERDICT_REF_PREFIX, REVIEW_VERDICT_REPLACEMENT_REF_PREFIX, isValidatedVerdictArtifact, parseVerdictCommit, parseVerdictRef, validateVerdictArtifact } from './lib/review-verdict-artifact.mjs'

export class ApprovalCheckError extends Error {}

// A decision is "tied" to a head when GitHub records it against that commit or the
// author wrote the SHA into the body. Same rule the preview gate uses, so the two
// gates cannot drift into disagreeing about what a reviewer approved.
const tiedToHead = evidenceTiedToHead
// APPROVALS need a STRICTER tie than refusals, and the difference is the whole
// #1809 hole reappearing inside the tool built to close it. Under the permissive
// tie, a comment approving head A that merely MENTIONS head B ("VERDICT: APPROVE
// <A> ... the author has since pushed <B>") is tied to B and opens a line with
// APPROVE, so it authorizes B -- bytes nobody looked at. That is exactly #1809.
//
// So an approval counts for this head only when the reference is UNAMBIGUOUS:
//   - GitHub itself bound the review to this commit (`commit_id`), which is
//     structured data rather than prose and cannot be ambiguous; or
//   - the body names this head and names NO OTHER commit-length SHA at all.
//
// Two SHAs in one body means the reader cannot tell which one the verdict is
// about, and the safe reading of an ambiguous authorization is to refuse it.
// Genuine wrapper approvals name exactly one head in a header, so they still pass.
//
// Refusals deliberately KEEP the permissive tie. The asymmetry is on purpose:
// over-counting a refusal locks a head that maybe did not need locking, which
// costs a re-review; over-counting an approval merges unreviewed bytes. When a
// tie is uncertain, both errors must fall on the side of not merging.
// The shared predicate implements this rule for every merge, preview, assignment,
// replacement and reviewer-lease consumer. Do not recreate it in this file.
// A VERDICT is a line that OPENS with the verdict word -- not prose that happens to
// mention it. A lane wrote a progress note on its own PR naming the head SHA and the
// word REVISE, and permanently locked its own head: the note read as a recorded
// refusal. Under an ENFORCED gate a self-locked head is unmergeable, and the failure
// looks like an unexplained refusal rather than anything comment-shaped. So the verdict
// word must lead its line (markdown emphasis and quoting allowed), which is how the
// reviewer wrappers emit it and is not how anyone writes a status update. The rule is
// applied symmetrically: prose cannot grant an approval either.
// The reviewer wrappers do not emit a bare verdict word: they are instructed to
// end with `VERDICT: APPROVE` / `VERDICT: REVISE`, and the reviews in .ai/reviews
// show it in the wild as `VERDICT: APPROVE`, `## VERDICT: APPROVE` and
// `VERDICT: APPROVED`. Anchoring on the bare word alone would have rejected every
// genuine approval this repo produces -- the inverse of the defect this file fixes,
// and the more dangerous inverse: a self-locked head fails closed loudly and gets
// investigated, while a gate that refuses all valid input looks like reviewers not
// returning verdicts, so the wrappers get blamed and re-run instead of the gate.
// The optional label is stripped, never the verdict itself: `VERDICT: DO NOT
// APPROVE` still does not open with APPROVE and is still not an approval.
// Emphasis is stripped on BOTH sides of the label. `## VERDICT: **APPROVED**` is a
// real form in this repo's archive (`.ai/reviews/phase6-glm-review.md:7`), and an
// earlier version stripped emphasis only before the label, so that genuine approval
// was refused -- the refuse-all-valid-input direction, which is the dangerous one
// because it presents as reviewers not returning verdicts rather than as a gate bug.
// Only whitespace and emphasis marks are stripped, never letters: `VERDICT: DO NOT
// APPROVE` still does not open with APPROVE.
// `APPROVE WITH CONDITIONS` is a refusal-with-remedy, not an approval: the
// conditions ARE the reviewer's finding, so merging on it merges the state the
// reviewer declined to authorize -- while producing an audit trail saying they
// approved. `psg4-glm52-review-brief.md` offers reviewers exactly that wording.
// Matching it because the line opens with APPROVE is the anywhere-in-body defect
// in miniature: matching the token instead of the claim.
//
// It deliberately does NOT join REFUSAL. Failing to satisfy the approval gate is
// not the same as recording a refusal: a conditional response must leave the head
// unapproved without LOCKING it, or the reviewer's own conditions strand the head
// those conditions were meant to be met on -- the self-lock through a new door.
// Detection is on the CLAIM, not on adjacency to the word APPROVE. A lookahead for
// `WITH` immediately after APPROVE was wrong in both directions: it missed
// `APPROVE ONLY WITH CONDITIONS` and `APPROVE, BUT WITH CONDITIONS`, and it wrongly
// refused `APPROVE WITH no reservations` and `APPROVE WITH confidence`, which are
// unconditional approvals. So the test is the phrase "with condition(s)" appearing
// anywhere on the verdict line -- and on the line after it, because reviewers wrap
// and `VERDICT: APPROVE` / `WITH CONDITIONS: ...` is the same claim split in two.
// The boundary is "no more letters or digits", not `\b`. Underscore is a word
// character, so `\b` did not fire on the markdown emphasis form `__APPROVE__`.
// REJECT is a real verdict word in this repo's reviewer wrappers alongside REVISE
// and GitHub's own CHANGES_REQUESTED. Omitting any of them would let a refusal at
// the merged head be silently outvoted by an approval that came before it. The
// space-separated `REQUEST CHANGES` counts too: it is how a reviewer writing prose
// spells the same refusal, and only the underscore form was recognised before.

export function evaluateExactHeadApproval(input) {
  const { pr, headSha, evidence = [], assignments = [], verdicts } = input
  if (!/^[0-9a-f]{40}$/i.test(String(headSha ?? ''))) throw new ApprovalCheckError('an exact 40-character head SHA is required')
  if (!Number.isInteger(Number(pr)) || Number(pr) <= 0) throw new ApprovalCheckError('an exact pull request number is required')

  const atThisHead = assignments.filter((row) => String(row.headSha ?? '').toLowerCase() === String(headSha).toLowerCase())
  if (!atThisHead.length) throw new ApprovalCheckError(`no reviewer was ever assigned head ${headSha}; an assignment pinned to an earlier head does not carry forward to new commits`)

  // A RETURNED SLOT IS AN UNAPPROVED SLOT, NEVER A VANISHED ONE.
  //
  // `--exclude-reviewer` hands a slot back by compare-and-clearing its assignment
  // ref and writing a durable return record in its place. Before that existed the
  // ref stayed live, so this gate went on demanding an APPROVE that was never
  // coming and failed closed. Clearing the ref is what made the slot disappear
  // from the listing below instead -- and a slot this gate cannot see is a slot it
  // cannot require. Slot 1 approved, slot 2 returned and never re-drawn, and the
  // loop over the surviving slots passed: a merge authorized over a slot no
  // reviewer had answered, which is the exact outcome the return was written to
  // prevent. `assertDurableReviewApproval` in the lanes script enforced this rule,
  // but its only caller is the PREVIEW gate, which under merge-first runs AFTER
  // the merge -- and not at all for a docs-only pull request.
  //
  // So the return records are read here too, and ordered the same way: "newer" is
  // the GLOBAL reviewer cursor sequence, spent once by every assignment and every
  // replacement out of the same durable counter, never the replacement namespace
  // tail. A namespace tail is not a clock -- comparing it made a slot whose
  // replacement had been returned permanently unanswerable, because re-drawing the
  // original recreates a ref with no tail at all. A returned slot is answered by
  // exactly one thing: a live assignment for that same slot drawn after the
  // returned one, carrying its own APPROVE below.
  const returns = (input.returns ?? []).filter((row) => String(row.headSha ?? headSha).toLowerCase() === String(headSha).toLowerCase())
  const returnedShas = new Set(returns.map((row) => String(row.assignmentSha ?? '').toLowerCase()))
  const pinned = atThisHead.filter((row) => !returnedShas.has(String(row.sha ?? '').toLowerCase()))
  const liveBySlot = new Map()
  for (const assignment of pinned) {
    const prior = liveBySlot.get(assignment.slot)
    if (!prior || Number(assignment.replacementSequence ?? 0) > Number(prior.replacementSequence ?? 0)) liveBySlot.set(assignment.slot, assignment)
  }
  const sequenceOf = (row, label) => { const value = Number(row?.sequence); if (!Number.isInteger(value) || value < 1) throw new ApprovalCheckError(`${label} has no readable reviewer sequence`); return value }
  const newestReturned = new Map()
  for (const row of returns) { const sequence = sequenceOf(row, `durable reviewer return ${row.ref ?? ''} for slot ${row.slot}`); if (!(newestReturned.get(row.slot) >= sequence)) newestReturned.set(row.slot, sequence) }
  for (const [slot, sequence] of newestReturned) {
    const live = liveBySlot.get(slot)
    if (!live || sequenceOf(live, `assignment ${live.ref ?? live.sha}`) <= sequence) throw new ApprovalCheckError(`review slot ${slot} was durably returned for head ${headSha} and has no live exact-head assignment newer than the returned one; it cannot be satisfied by another slot, nor by a record the returned one had already superseded. Draw a new reviewer for this exact head and slot and have that assignment record its own APPROVE.`)
  }
  if (!pinned.length) throw new ApprovalCheckError(`every reviewer assignment pinned to head ${headSha} was durably returned; a returned slot is an unapproved slot`)

  if (Object.prototype.hasOwnProperty.call(input, 'verdicts')) {
    const all = (verdicts ?? []).filter((row) => Number(row.pr) === Number(pr) && String(row.head_sha).toLowerCase() === String(headSha).toLowerCase())
    if (all.some((row) => !isValidatedVerdictArtifact(row))) throw new ApprovalCheckError('durable verdict input crossed the approval boundary without artifact validation')
    if (new Set(all.map((row) => row.ref)).size !== all.length) throw new ApprovalCheckError('duplicate durable verdict refs cannot be counted')
    // THE NON-READING-REVIEWER RULE, ENFORCED AT THE GATE THAT AUTHORIZES MERGES (#2079).
    //
    // The same rule `readReviewVerdicts` applies on the write/preview side, applied
    // here because THIS is the required context the guarded merge workflow waits on
    // (`.github/workflows/guarded-migration-merge.yml`), and under merge-first the
    // preview gate runs after the merge. A rule enforced only there is not enforced
    // at merge time: a legacy APPROVE from a reviewer that never opened the diff
    // would still authorize, and a legacy REVISE from that same reviewer would block
    // the head forever even after the sanctioned replacement route records a fresh
    // APPROVE. Both directions are disregarded, identically. Every row here is a
    // validated artifact, so `reviewer` is present and was checked against the
    // assignment; an unknown name fails closed to "cannot read".
    const disregarded = all.filter((row) => !reviewerReadsRepository(row.reviewer))
    const exact = all.filter((row) => reviewerReadsRepository(row.reviewer))
    const disregardedNote = disregarded.length ? ` (${disregarded.length} durable verdict artifact(s) at this head are DISREGARDED because their reviewer cannot read the repository: ${disregarded.map((row) => `${row.ref} by ${row.reviewer}`).join(', ')}. Re-review the slot with --replace-failed-reviewer --failure-code reviewer_cannot_read_repository)` : ''
    if (exact.some((row) => row.verdict !== 'APPROVE')) throw new ApprovalCheckError(`head ${headSha} carries a durable reviewer refusal; answer it with a new commit and a fresh exact-head review${disregardedNote}`)
    const approvals = exact.filter((row) => row.verdict === 'APPROVE')
    if (!approvals.length) throw new ApprovalCheckError(`head ${headSha} has no durable APPROVE artifact; a review that wrote no artifact never authorizes a merge${disregardedNote}`)
    const latestBySlot = liveBySlot
    for (const assignment of latestBySlot.values()) if (!approvals.some((row) => row.assignment_sha === assignment.sha)) throw new ApprovalCheckError(`review slot ${assignment.slot} has no durable APPROVE for its latest exact-head assignment${disregardedNote}`)
    return { approved: true, head_sha: headSha, pr: Number(pr), assignments: latestBySlot.size, approvals: new Set(approvals.map((row) => row.ref)).size }
  }

  // COMMENT TEXT IS NOT A VERDICT IN PRODUCTION (issue #2075).
  // Reaching this point means the caller supplied no `verdicts` key at all.
  // `gatherApprovalInput` ALWAYS supplies one, and `main` refuses below if it
  // ever stops doing so, so in the merge gate this branch is unreachable. It
  // survives only as a predicate library for tests and for callers that have no
  // access to the durable refs, and it can never authorize a merge on its own.
  const authenticated = evidence.filter(trustedVerdictEvidence)
  const atHead = authenticated.filter((row) => tiedToHead(row, headSha))
  const state = (row) => String(row.state ?? '').toUpperCase()
  const refusals = atHead.filter((row) => refusalLine(row.body) || state(row) === 'CHANGES_REQUESTED')
  if (refusals.length) throw new ApprovalCheckError(`head ${headSha} carries an unanswered reviewer refusal; answer it with a new commit and a fresh exact-head review`)

  const approvals = authenticated
    .filter((row) => unambiguouslyTiedToHead(row, headSha))
    .filter((row) => approvalLine(row.body) || state(row) === 'APPROVED')
  if (!approvals.length) throw new ApprovalCheckError(`head ${headSha} has no APPROVE tied to it; an approval of an earlier head never approves these bytes`)

  return { approved: true, head_sha: headSha, pr: Number(pr), assignments: pinned.length, approvals: approvals.length }
}

function gh(args) { try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) } catch (e) { throw new ApprovalCheckError(`GitHub read failed: ${e.stderr || e.message}`) } }
function json(args) { const raw = gh(args); try { return JSON.parse(raw) } catch { throw new ApprovalCheckError('GitHub returned malformed JSON') } }
function pages(endpoint) { const result = json(['api', '--paginate', '--slurp', endpoint]); if (!Array.isArray(result) || result.some((x) => !Array.isArray(x))) throw new ApprovalCheckError(`GitHub pagination for ${endpoint} is malformed`); return result.flat() }

// ONE ref parser, imported from the writer that names the refs. This file used to
// carry its own copy of the pattern. The copy was byte-identical to the writer's
// on the day it was written and had already been wrong once before that -- it
// accepted a slash-form replacement tail production has never emitted, so every
// real replacement ref parsed to null while its tests passed. Two copies of the
// authority on a ref name is the adapter drift this file's own header warns
// about, so there is now one, and it lives beside the code that writes the names.
// Re-exported because this file's tests exercise the parser through this module.
export { parseAssignmentRef }

// Assignment refs are named <issue>-<pr>-<headSha>, so the pull request alone is
// enough to find them; the work issue never has to be guessed here.
// `deps` exists so this ADAPTER can be tested against real GitHub payload shapes.
// The evaluation core was tested and the adapter that feeds it was not -- which is
// where the same class of defect has now hidden twice repo-wide: a conversion layer
// whose test-time shape diverges from the one production produces. Nothing is
// stubbed in production; the defaults are the real readers.
export function gatherApprovalInput(env = process.env, deps = { json, pages }) {
  const { json: readJson = json, pages: readPages = pages } = deps
  let event = {}; if (env.GITHUB_EVENT_PATH) event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const pr = Number(env.PR_NUMBER || event.pull_request?.number); if (!pr) throw new ApprovalCheckError('PR number is unavailable')
  const headSha = String(env.REQUESTED_SHA || readJson(['api', `repos/${REPO}/pulls/${pr}`])?.head?.sha || '')
  const issueNumbers = new Set([pr])
  // Slot 2 assignments are suffixed `-slot<N>`, and a reviewer replaced after a
  // failure keeps its own ref under the replacement namespace, pinned to the SAME
  // head. Both are genuine independent assignments to these exact bytes, so both
  // count; ignoring either would refuse a merge whose review really did happen.
  //
  // This listing is deliberately UNPAGINATED, unlike the evidence reads below. A
  // review of this file called that a blocking defect on the reasoning that the
  // namespace holds ~370 refs and GitHub pages at 30/100, so recent refs would fall
  // off page one and the gate could never pass. Measured against live GitHub on
  // 2026-08-30 instead of assumed: `git/matching-refs` is not a paged collection.
  // The unpaginated read and `--paginate` both returned all 421 assignment refs and
  // all 114 replacement refs, including every ref for this PR. Do not "fix" this by
  // switching to the paginated reader without re-measuring: matching-refs returns
  // the whole match set, and the extra requests count against the per-process wire
  // budget (#1767) that reviewer operations already run close to.
  const refs = [REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_REPLACEMENT_REF_PREFIX].flatMap((prefix) => {
    const rows = readJson(['api', `repos/${REPO}/git/matching-refs/${prefix.replace(/^refs\//, '')}/`])
    return Array.isArray(rows) ? rows : []
  })
  const assignments = refs.flatMap((row) => {
    const parsed = parseAssignmentRef(row.ref)
    if (!parsed || parsed.pr !== pr) return []
    issueNumbers.add(parsed.issue)
    return [{...parsed,ref:row.ref,sha:row.object?.sha}]
  })
  const commitCache = new Map()
  const commitOf = (sha) => { if (!commitCache.has(sha)) commitCache.set(sha, readJson(['api', `repos/${REPO}/git/commits/${sha}`])); return commitCache.get(sha) }
  // The return namespace, read for the SAME reason the assignment namespace is:
  // it is what says whether a slot still owes an answer. Prefiltered on the ref
  // name so a repository-wide namespace costs one request and no commit reads
  // when this pull request has no returns -- but the ref name only SELECTS. What
  // is trusted is the commit, checked back against the name it is stored under,
  // because a ref name is a label and this answer decides whether bytes merge.
  const returnRows = (() => { const rows = readJson(['api', `repos/${REPO}/git/matching-refs/${REVIEW_RETURN_REF_PREFIX.replace(/^refs\//, '')}/`]); return Array.isArray(rows) ? rows : [] })()
    .filter((row) => new RegExp('^' + REVIEW_RETURN_REF_PREFIX + '/\\d+-' + pr + '-' + headSha.toLowerCase() + '(?:-slot\\d+)?-[0-9a-f]{40}$').test(String(row.ref ?? '')))
  const returns = returnRows.map((row) => {
    let parsed
    try { parsed = parseReviewReturn(commitOf(row.object?.sha)) } catch (error) { throw new ApprovalCheckError(`durable reviewer return ${row.ref} is invalid: ${error.message}`) }
    if (parsed.pr !== pr || parsed.headSha !== headSha.toLowerCase() || row.ref !== reviewReturnRef(parsed)) throw new ApprovalCheckError(`durable reviewer return ${row.ref} does not match its ref identity`)
    // `sequence=` is optional only so a record written before it existed still
    // parses; such a record is ordered by reading the retired assignment commit,
    // which stays reachable because the return commit is parented on it.
    const sequence = parsed.sequence ?? Number(parseReviewCursor(commitOf(parsed.assignmentSha))?.sequence)
    return {...parsed, ref: row.ref, sequence}
  })
  // Cursor sequences are only needed to order a slot against something returned
  // for it, so the per-assignment commit reads are spent only when there is a
  // return to order against.
  if (returns.length) for (const assignment of assignments) assignment.sequence = Number(parseReviewCursor(commitOf(assignment.sha))?.sequence)
  const verdictRows = [REVIEW_VERDICT_REF_PREFIX, REVIEW_VERDICT_REPLACEMENT_REF_PREFIX].flatMap((prefix) => {
    const rows = readJson(['api', `repos/${REPO}/git/matching-refs/${prefix.replace(/^refs\//, '')}/`])
    return Array.isArray(rows) ? rows : []
  }).filter((row)=>{const parsed=parseVerdictRef(row.ref);return parsed?.pr===pr&&parsed.headSha===headSha.toLowerCase()})
  const verdicts=verdictRows.map((row)=>{
    const named=parseVerdictRef(row.ref),sha=row.object?.sha
    const commit=readJson(['api',`repos/${REPO}/git/commits/${sha}`]),record=parseVerdictCommit(commit)
    const slot=named.slot===1?'':`-slot${named.slot}`
    const expectedAssignment=named.replacementSequence===null
      ?`${REVIEW_ASSIGNMENT_REF_PREFIX}/${named.issue}-${named.pr}-${named.headSha}${slot}`
      :`${REVIEW_REPLACEMENT_REF_PREFIX}/${named.issue}-${named.pr}-${named.headSha}${slot}-${named.replacementSequence}`
    const assignment=assignments.find((candidate)=>candidate.ref===expectedAssignment)
    if(!assignment?.sha)throw new ApprovalCheckError(`verdict ${row.ref} has no exact assignment object`)
    const assignmentCommit=commitOf(assignment.sha),cursor=parseReviewCursor(assignmentCommit)
    const commentId=/#issuecomment-(\d+)$/.exec(String(record.findings_ref??''))?.[1]
    if(!commentId)throw new ApprovalCheckError(`verdict ${row.ref} has an invalid findings reference`)
    const findingsBody=readJson(['api',`repos/${REPO}/issues/comments/${commentId}`])?.body
    try{return validateVerdictArtifact({ref:row.ref,sha,commit,findingsBody,assignment:{sha:assignment.sha,reviewer:cursor.reviewer}})}
    catch(error){throw new ApprovalCheckError(`verdict ${row.ref} is invalid: ${error.message}`)}
  })
  const evidence = [
    ...[...issueNumbers].flatMap((number) => readPages(`repos/${REPO}/issues/${number}/comments?per_page=100`)),
    ...readPages(`repos/${REPO}/pulls/${pr}/reviews?per_page=100`),
  ]
  return { pr, headSha, evidence, assignments, returns, verdicts }
}

// A merge is authorized by create-only verdict artifacts, never by comment prose.
// `gatherApprovalInput` always supplies a `verdicts` array; if it ever stopped,
// `evaluateExactHeadApproval` would silently fall back to reading decision words
// out of comments -- the exact trust that produced issue #2075. This boundary
// refuses instead of falling back, and it is exported so that refusal is testable.
export function requireDurableVerdictInput(input) {
  if (!Array.isArray(input?.verdicts)) throw new ApprovalCheckError('durable reviewer verdict artifacts could not be read; a merge is never authorized by comment text')
  return input
}

export function main(env = process.env) {
  try {
    const result = evaluateExactHeadApproval(requireDurableVerdictInput(gatherApprovalInput(env)))
    console.log(`Exact-head approval verified: PR #${result.pr} head ${result.head_sha} (${result.approvals} approval(s), ${result.assignments} pinned assignment(s)).`)
    return 0
  } catch (e) { console.error(`REFUSED: ${e.message}`); return 2 }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main()
