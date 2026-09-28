// ISSUE #2998 — pre-draw handoff readiness.
//
// The defect this module exists to remove: every pre-condition of a successful
// reviewer handoff used to be checked AFTER the expensive step. A draft PR, a
// conflicted branch, a stale brief, a broken evidence pair, a pull request that
// is not current with main, or a cross-PR collision were each discovered only
// after the draw had consumed reviewer capacity -- so the cost of the bad
// handoff was a wasted reviewer slot and a stalled lane instead of a fast,
// named error.
//
// NO REVIEWER-VISIBLE SIDE EFFECTS. No cursor, assignment, ref, comment or
// repository file is written by anything in this file, and the orchestrating
// caller runs it BEFORE any of those mutations on both draw paths
// (--assign-reviewer and --replace-failed-reviewer). It reads the carried brief
// from disk and reads GitHub through scripts/lib/github-transport.mjs; that
// shared transport may, on real quota exhaustion, write its host-wide quota
// latch in the OS temp directory and print to stderr, exactly as it does for
// every other caller. It spawns no local `git`.
//
// SCOPE, deliberately reduced after the governed reviews of 4f0ff13d and
// 84c6b93c. Kept, because each is provably a definite fact before the draw:
// the carried brief, the evidence pair, the exact live head, and the
// protected-source collision. Removed:
//  - the cross-PR OBJECT collision scan. Its real gather depends on local git
//    objects the CI job gets from actions/checkout but a draw-path worktree may
//    not have, and on one recursive tree read per open PR that no pre-draw cap
//    can bound. The CI object-collision guard (pr-object-collision.yml) and the
//    guarded merge lane remain the authority for object collisions.
//  - the mergeable_state=behind refusal. GitHub recomputes mergeable_state
//    asynchronously and has no "still computing" value for it, so the
//    sanctioned remedy (refresh-code-pr-branch.mjs pushes, then draws at once)
//    could be refused by the state it just fixed; and owner ruling #1286 keeps
//    `strict` false, so `behind` is the normal state here. Being current with
//    main is enforced by the merge lane, never guessed at the draw.
//
// FAIL DIRECTION: only a GENUINE transport fault proceeds -- a transient
// 5xx/connection fault or rate-limit exhaustion, as the shared transport
// itself classifies it. Every other failure is a definite answer and refuses
// by name: an HTTP 404/403/422 (github-transport.mjs: a 404 is an answer, not a
// fault), a partial file list, the 3000-file cap, an unreadable activation
// history, an evidence file not tracked at the head. A refusal here is a
// refusal -- it never contains an approval and never reads as a recorded
// decision. A check that could not run because of transport returns a
// `degraded` marker that the CLI prints, so a degraded pass is never mistaken
// for a full one.
//
// COST: the protected-source scan runs only when this pull request edits a
// protected source. Its snapshot and enrichment reads go through one counted
// reader capped at PRE_DRAW_READ_BUDGET LOGICAL reads: one logical read may be
// several HTTP requests (pagination, and the transport's bounded retries), so
// the cap bounds the burst's shape, not an exact request count. This phase
// runs before, and outside, the reviewer operation's request budget
// (withReviewRequestBudget) on purpose: that budget and its read cache exist
// only inside the mutating operation, and the whole point here is to refuse
// before that operation starts. The ordinary draw (no protected source) adds
// only the evidence-pair reads, and only when the PR carries a pair.
import { readFileSync } from 'node:fs'
import { contractHash, contractRef, reconcileReportWithContract, validateCompletionReport, validateContract, validatePullRequestCompletion } from '../agent-work-contract.mjs'
import { validateCompletionRecord } from './work-dependencies.mjs'
import { resolveEvidencePair } from './agent-evidence-paths.mjs'
import { ghJson, isRateLimitExhausted, isTransientGitHubTransport } from './github-transport.mjs'
import { SNAPSHOT_ENV, loadOpenPullFiles } from './open-pr-files.mjs'
import { gather as gatherSourceSnapshot, openProtectedCollisions, PROTECTED_SOURCE_PATHS } from '../check-pr-source-collisions.mjs'

export class DrawReadinessError extends Error {}

const SHA = /^[0-9a-f]{40}$/
const NO_DRAW = 'No reviewer was drawn and no reviewer capacity was spent'

function refuse(message) {
  throw new DrawReadinessError(`${message}. ${NO_DRAW}.`)
}

// ---------------------------------------------------------------------------
// 1. The carried prompt, VALIDATED (not delivered) before the draw.
//
// Issue #2998 fix 1 asks that a brief be checked before the draw is consumed.
// What this does, and all it does (governed review finding M1): when a caller
// passes --prompt or --prompt-file to the draw, that brief is read and checked
// here -- readable, non-empty, and any `VERDICT: <DECISION> <head>` line it
// already carries must name THIS draw's head. The brief is NOT forwarded to the
// reviewer by the draw and is not bound to the assignment; the governed runner
// still receives its own brief at start time, and it -- not this check --
// injects the terminal head-bound VERDICT instruction (promptHeadContract in
// run-governed-review.mjs). So a brief without a decision line is fine here:
// the runner supplies it. What this removes is the draw spent on a brief the
// runner would refuse at start for a stale head or an unreadable file.
//
// The prompt arguments are OPTIONAL. The documented flow and
// refresh-code-pr-branch re-draw without a brief, and the codex wrapper takes
// no prompt by design (#2244), so absence is not a failure. Passing both
// --prompt and --prompt-file is refused rather than silently ignoring one.
// ---------------------------------------------------------------------------
export function assertDrawPromptContract({ prompt, promptFile, headSha } = {}, { readFile = readFileSync } = {}) {
  if (prompt === undefined && promptFile === undefined) return { carried: false }
  if (prompt !== undefined && promptFile !== undefined) refuse('both --prompt and --prompt-file were given; carry exactly one review brief')
  let text
  if (promptFile !== undefined) {
    try {
      text = readFile(String(promptFile), 'utf8')
    } catch (error) {
      refuse(`the carried review brief --prompt-file ${promptFile} is not readable (${String(error?.message ?? error)})`)
    }
  } else {
    text = String(prompt)
  }
  if (!String(text).trim()) refuse('the carried review brief is empty')
  const head = String(headSha ?? '').toLowerCase()
  if (SHA.test(head)) {
    // Same stale-head rule the runner enforces at start time (promptHeadContract).
    for (const match of String(text).matchAll(/VERDICT:\s*[A-Z_]+[ \t]+([0-9a-f]{7,40})\b/gi)) {
      const named = match[1].toLowerCase()
      if (!head.startsWith(named)) {
        refuse(`the carried review brief binds a decision line to head ${named}, but this draw is for head ${head}`)
      }
    }
  }
  // validatedOnly: the brief was checked, never delivered by this step.
  return { carried: true, headClean: true, validatedOnly: true }
}

// ---------------------------------------------------------------------------
// 2. The contract/completion evidence pair, validated BEFORE the draw.
//
// Issue #2998 fix 3: "the evidence pair is valid". The classification is the
// repository's own resolver. A `current` pair then gets a SUBSET of what the
// enforced CI gate (agent-work-contract.yml -> agent-work-contract-git-
// evidence.mjs) proves: schema, the pair's issue matching this draw's issue,
// reconciliation against the published immutable contract, and (for an open
// pull request) the pull-request binding. It does NOT re-prove git ancestry,
// base anchoring (#2845), files_changed equality with the real diff, the tail
// rule, or generation lineage (#3380) -- those stay the CI gate's job, so a
// pair that passes here can still fail the gate. The subset only moves the
// cheap definite faults in front of the draw.
// `inherited` proceeds: a pull request that changes no evidence file makes no
// evidence claim here, and the enforced CI gate -- grandfathering and
// documents-only exemptions included -- remains the authority on whether a
// pair is required at all. `partial` and `conflicted` are definite bad facts.
// ---------------------------------------------------------------------------
export function evidencePairReadiness({ rows, pr, headSha, issue, prState, io } = {}) {
  if (!Array.isArray(rows)) return { state: 'unreadable' }
  const filenames = rows.map((row) => String(row?.filename ?? ''))
  const pair = resolveEvidencePair(filenames)
  if (pair.state === 'partial') {
    const present = [pair.contract, pair.completion].filter((file) => filenames.includes(file))
    refuse(`this pull request changes only one half of its agent evidence pair (${present.join(', ')}); a contract and its completion report travel together`)
  }
  if (pair.state === 'conflicted') refuse(`this pull request carries more than one agent evidence pair (${pair.key}); exactly one pair may be present (#2708)`)
  if (pair.state === 'inherited') return pair
  // An evidence file that is removed or renamed is not a checked-in pair; the
  // CI evidence validator refuses exactly this shape, so it refuses here too.
  for (const row of rows) {
    const file = String(row?.filename ?? '')
    if (file !== pair.contract && file !== pair.completion) continue
    const status = String(row?.status ?? '').toLowerCase()
    if ((status && status !== 'added' && status !== 'modified') || row?.previous_filename) {
      refuse(`the agent evidence file ${file} is ${status || 'changed'}${row?.previous_filename ? ` from ${row.previous_filename}` : ''}; a pair must be added or modified in place`)
    }
  }
  // `current` -- deep validation. Open pull requests get the full judgment;
  // a non-open pull request keeps classification plus content checks only, so
  // a merged-pull-request draw (#2915) can never be refused by a check that
  // the CI gate would have applied before the merge happened.
  if (prState !== 'open') return { ...pair, validated: false, reason: 'not an open pull request' }
  if (!SHA.test(String(headSha ?? ''))) return { ...pair, validated: false, reason: 'no exact head to read the pair at' }
  if (typeof io?.getFileAt !== 'function') {
    return { ...pair, validated: false, reason: 'this io cannot read evidence files' }
  }
  let contractText, reportText
  try {
    contractText = io.getFileAt(pair.contract, headSha)
    reportText = io.getFileAt(pair.completion, headSha)
  } catch (error) {
    // "Not tracked at this head" is an answer read off the tree, not a fault.
    if (!isPreDrawTransportFault(error)) refuse(`the agent evidence pair could not be read at head ${headSha} (${String(error?.message ?? error)})`)
    return { ...pair, validated: false, degraded: true, reason: 'the evidence pair could not be read (transport)' }
  }
  let contract, report
  try {
    contract = JSON.parse(String(contractText))
    report = JSON.parse(String(reportText))
  } catch (error) {
    refuse(`the agent evidence pair on this pull request is not readable JSON (${String(error?.message ?? error)})`)
  }
  try {
    validateContract(contract)
    validateCompletionReport(report, { validateCompletionRecord })
  } catch (error) {
    refuse(`the agent evidence pair on this pull request does not validate (${String(error?.message ?? error)})`)
  }
  // Exact-object check (governed review gap b): the pair must be THIS draw's
  // issue's pair, not a different issue's fully valid one.
  const drawIssue = Number(issue)
  if (Number.isInteger(drawIssue) && drawIssue > 0) {
    if (Number(contract.work_issue) !== drawIssue) refuse(`the checked-in contract is for issue #${contract.work_issue}, but this draw is for issue #${drawIssue}`)
    if (Number(report.work_issue) !== drawIssue) refuse(`the completion report is for issue #${report.work_issue}, but this draw is for issue #${drawIssue}`)
  }
  const expectedRef = contractRef(contract.work_issue, contract.generation ?? 1)
  if (report.contract_ref !== expectedRef) {
    refuse(`the completion report names contract ref ${report.contract_ref}, but its contract lives at ${expectedRef}`)
  }
  const reconciled = reconcileReportWithContract(report, contract)
  if (!reconciled.satisfied) refuse(`the completion report does not satisfy its contract (${reconciled.problems.join('; ')})`)
  if (prState === 'open') {
    try {
      validatePullRequestCompletion(report, { pr: Number(pr), headSha })
    } catch (error) {
      refuse(`the completion report does not bind this pull request (${String(error?.message ?? error)})`)
    }
  }
  // The keystone: the checked-in contract must be the immutable publication.
  if (typeof io?.readRef !== 'function' || typeof io?.readCommitMessage !== 'function') {
    return { ...pair, validated: false, reason: 'this io cannot read the published contract' }
  }
  let publishedSha
  try {
    publishedSha = io.readRef(report.contract_ref)
  } catch (error) {
    if (!isPreDrawTransportFault(error)) refuse(`the published contract ref ${report.contract_ref} could not be read (${String(error?.message ?? error)})`)
    return { ...pair, validated: false, degraded: true, reason: 'the published contract ref could not be read (transport)' }
  }
  if (publishedSha === null) refuse(`no immutable contract is published at ${report.contract_ref}, so the checked-in pair was never authorised`)
  let message
  try {
    message = io.readCommitMessage(publishedSha)
  } catch (error) {
    if (!isPreDrawTransportFault(error)) refuse(`the published contract commit ${publishedSha} could not be read (${String(error?.message ?? error)})`)
    return { ...pair, validated: false, degraded: true, reason: 'the published contract commit could not be read (transport)' }
  }
  // The live io collapses every failure of this read to null, so the cause is
  // unknown: report it as degraded, never as a pass and never as "transport".
  if (message === null) return { ...pair, validated: false, degraded: true, reason: 'the published contract commit could not be read (cause unknown)' }
  let published
  try {
    published = JSON.parse(String(message).split('\n').slice(2).join('\n').trim())
  } catch (error) {
    refuse(`${report.contract_ref} does not carry a readable immutable contract (${String(error?.message ?? error)})`)
  }
  if (contractHash(published) !== contractHash(contract)) {
    refuse('the checked-in contract does not match the immutable contract published before the work')
  }
  return { ...pair, validated: true }
}

// ---------------------------------------------------------------------------
// 3. Current-with-main: REPORTED, never refused (see SCOPE above).
// ---------------------------------------------------------------------------
export function currentMainReadiness(live) {
  if (!live || typeof live !== 'object') return { state: 'unknown' }
  if (String(live.state ?? '').toLowerCase() !== 'open') return { state: 'not-open' }
  return { state: live.mergeable_state ?? 'unknown' }
}

// ---------------------------------------------------------------------------
// 4. Cross-PR protected-source collision, BEFORE the draw.
// ---------------------------------------------------------------------------

// Cap on LOGICAL reads (see COST above): the open-PR listing, detail and files
// per ready open PR, and five enrichment reads per PR overlapping the source.
export const PRE_DRAW_READ_BUDGET = 200

// Genuine transport faults only, as the shared transport classifies them
// (it tags its wrapped errors with stderr, transientTransport and
// rateLimitExhausted). A 404/403/422 is an answer and is NOT a fault here.
export function isPreDrawTransportFault(error) {
  if (error instanceof DrawReadinessError) return false
  if (error?.transientTransport === true || error?.rateLimitExhausted === true) return true
  return isTransientGitHubTransport(error) || isRateLimitExhausted(error)
}

function defaultGhRead(args) {
  return ghJson(args, { maxBuffer: 32 * 1024 * 1024 })
}

export function budgetedRead(read = defaultGhRead, budget = PRE_DRAW_READ_BUDGET) {
  let used = 0
  const counted = (args) => {
    used += 1
    if (used > budget) refuse(`the pre-draw collision scan needed more than ${budget} logical GitHub reads; it stopped rather than spend an unbounded burst`)
    return read(args)
  }
  counted.used = () => used
  return counted
}

function pages(read, args) {
  const out = read(args)
  if (!Array.isArray(out) || out.some((page) => !Array.isArray(page))) throw new Error(`gh ${args.join(' ')} did not return complete paginated JSON`)
  return out.flat()
}

// The protected-source guard's reads, routed through the counted reader (the
// guard's own defaults would bypass the count).
function sourceReaders(read) {
  return {
    timeline: (repo, number) => pages(read, ['api', '--paginate', '--slurp', `repos/${repo}/issues/${number}/timeline?per_page=100`]),
    detail: (repo, number) => read(['api', `repos/${repo}/pulls/${number}`]),
    commits: (repo, number) => pages(read, ['api', '--paginate', '--slurp', `repos/${repo}/pulls/${number}/commits?per_page=100`]),
    comments: (repo, number) => pages(read, ['api', '--paginate', '--slurp', `repos/${repo}/issues/${number}/comments?per_page=100`]),
    checkRuns: (repo, sha) => {
      const out = read(['api', '--paginate', '--slurp', `repos/${repo}/commits/${sha}/check-runs?per_page=100`])
      if (!Array.isArray(out)) throw new Error(`gh api check-runs for ${sha} did not return complete paginated JSON`)
      return out.flatMap((page) => page?.check_runs ?? [])
    },
  }
}

export function collectHandoffCollisions({ repo, pr, rows, env = process.env, read, budget = PRE_DRAW_READ_BUDGET, gather = gatherSourceSnapshot } = {}) {
  const none = { sourceCollisions: [], reads: 0, degraded: false }
  if (!Array.isArray(rows)) return none
  const paths = rows.flatMap((row) => [String(row?.filename ?? ''), String(row?.previous_filename ?? '')]).filter(Boolean)
  if (!paths.some((file) => PROTECTED_SOURCE_PATHS.has(file))) return none
  const counted = budgetedRead(read, budget)
  const scanEnv = { ...env, GITHUB_REPOSITORY: repo, PR_NUMBER: String(pr) }
  // Neither an event payload nor an exported snapshot file describes THIS
  // pull request for certain, so neither may supply its facts.
  delete scanEnv.GITHUB_EVENT_PATH
  delete scanEnv[SNAPSHOT_ENV]
  const load = (r, n) => loadOpenPullFiles(r, n, { env: scanEnv, read: counted })
  let input
  try {
    input = gather(scanEnv, { load, ...sourceReaders(counted) })
  } catch (error) {
    if (error instanceof DrawReadinessError) throw error
    if (isPreDrawTransportFault(error)) return { sourceCollisions: [], reads: counted.used(), degraded: true }
    refuse(`the protected-source collision guard could not gather complete inputs (${String(error?.message ?? error)}); a guard that cannot gather its inputs fails closed`)
  }
  return { sourceCollisions: openProtectedCollisions(input.current, input.others), reads: counted.used(), degraded: false }
}

// ---------------------------------------------------------------------------
// The one readiness result. Every criterion runs before any mutation; the
// first definite bad fact refuses by name; only a genuine transport fault
// proceeds, and then the result carries degraded markers the CLI prints.
// `path` is 'assign' (first draw) or 'replace' (replacement draw).
// ---------------------------------------------------------------------------
export function preDrawHandoffChecks({ pr, headSha, issue, rows, live, path = 'assign' }, io) {
  const state = live && typeof live === 'object' ? String(live.state ?? '').toLowerCase() : ''
  // Exact live head, first draw only. A replacement whose head moved is left
  // to describeMovedAssignmentHead, which names the exact re-draw command.
  const liveHead = String(live?.head?.sha ?? '').toLowerCase()
  const drawHead = String(headSha ?? '').toLowerCase()
  if (path !== 'replace' && state === 'open' && SHA.test(liveHead) && SHA.test(drawHead) && liveHead !== drawHead) {
    refuse(`--head-sha ${drawHead} is not the live head of PR #${pr} (${liveHead}); a draw binds the exact live head`)
  }
  const evidence = evidencePairReadiness({ rows, pr, headSha, issue, prState: state, io })
  const currentMain = currentMainReadiness(live)
  let collisions = { sourceCollisions: [], reads: 0, degraded: false }
  if (state === 'open' && Array.isArray(rows) && typeof io?.handoffCollisions === 'function') {
    try {
      collisions = io.handoffCollisions(pr, rows, live) ?? collisions
    } catch (error) {
      if (error instanceof DrawReadinessError) throw error
      if (!isPreDrawTransportFault(error)) refuse(`the protected-source collision scan failed (${String(error?.message ?? error)}); a guard that cannot gather its inputs fails closed`)
      collisions = { sourceCollisions: [], reads: 0, degraded: true }
    }
  }
  const sourceCollisions = collisions.sourceCollisions ?? []
  if (sourceCollisions.length) {
    const others = sourceCollisions.map((row) => `PR #${row.pr}`).join(', ')
    refuse(`another ready open pull request edits the same protected coordination source as PR #${pr} (${others}); merge or close the other pull request first`)
  }
  const degraded = [
    evidence.degraded ? `evidence: ${evidence.reason}` : null,
    collisions.degraded ? 'protected-source collision scan: transport fault' : null,
  ].filter(Boolean)
  return { evidence, currentMain, sourceCollisions, collisionReads: collisions.reads ?? 0, degraded }
}
