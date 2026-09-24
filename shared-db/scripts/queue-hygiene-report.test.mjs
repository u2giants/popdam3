// Queue hygiene report tests (issue #3199 Phase A3).
//
// The interactive `--queue-audit` is an orchestrator instrument: it can comment
// on issues and exits 2 whenever dispatchable work exists. The scheduled
// `--queue-hygiene-report` must be neither of those things. Every test here
// asserts one of the three properties the plan locked:
//   1. WRITE-FREE — no mutation hook may be reached, and the wrapper itself
//      throws on every mutation hook it strips (dirty-first: the refusals are
//      proven before the clean paths).
//   2. BACKED-UP IS NOT DIRTY — a queue full of dispatchable structural work is
//      the normal state this report exists to observe, so it exits 0.
//   3. UNREADABLE IS NOT CLEAN — a read failure exits 2; the report never
//      silently degrades into "no findings".
import assert from 'node:assert/strict'
import test from 'node:test'
import { claimBody, WORK_LABEL } from './manage-migration-author-lanes.mjs'
import { main, hygieneReportIo } from './queue-hygiene-report.mjs'
import { githubIo } from './manage-migration-author-lanes.mjs'

const NOW = new Date('2026-09-17T12:00:00Z')

const scope = (status, workType, route, priority, objects = []) => '```db-work-scope\n' + [
  `status: ${status}`,
  `work_type: ${workType}`,
  `route: ${route}`,
  ...(workType === 'structural' ? [
    'service_class: standard-application',
    'change_type: migration',
    'application_return_to: u2giants/example-app',
    'live_assertion: authenticated create-and-read succeeds',
    'generated_types: not-applicable',
  ] : []),
  `priority: ${priority}`,
  'depends_on:',
  ...(objects.length ? ['objects:'] : []),
  ...objects.map((x) => `  - ${x}`),
].join('\n') + '\n```'

const MUTATION_HOOKS = [
  'postCommitStatus', 'updateIssue', 'makeOwnerCommit', 'makeReviewVerdictCommit',
  'createRef', 'deleteRef', 'updateRef', 'atomicReviewRefs', 'atomicReviewMutexRelease',
  'reserveVersion', 'createClaim', 'createIssueIn', 'commentIssue', 'closeIssue',
  'closeClaim', 'contentPreservingRefresh', 'rewriteVersion', 'commitAndPushReversion',
]
// Every OTHER function on githubIo, classified by name as a read. A new githubIo
// hook appears in NEITHER list and fails the classification test below until
// somebody decides which side it is on — the silent-inheritance gap the governed
// review of head fd7d1327 caught (rewriteVersion, commitAndPushReversion).
const KNOWN_READ_HOOKS = new Set([
  'databasePreviewClassification', 'pullRequestFiles', 'readReviewerOperationRoute', 'countLogicalReviewRequests',
  'readPrWithReviewContext', 'observedReviewQuota', 'getRateLimit', 'previewApplyRun', 'verifyPreviewApplyArtifact',
  'readActiveReviewLeases', 'readActiveReviewLeasesOverGit', 'readActiveReviewLeasesOverGraphql', 'readReviewStates',
  'readReviewRefs', 'readReviewRecords', 'openClaims', 'closedClaimsForWork', 'openWorkIssues', 'openIssueNumbers', 'openIssueRows',
  'dependencyStates', 'mergeCommitInMain', 'prSources', 'openPulls', 'readPullStates', 'mergeTouchesMigrations',
  'branchPulls', 'getPr', 'getPrFiles', 'databasePreviewFileSnapshot', 'comparePullRequestFiles', 'getCommitStatus',
  'closingIssuesForPr', 'prStructuralObjects', 'prStructuralInspection', 'getFileAt', 'treeFiles', 'previewGateProof', 'getIssue',
  'getIssueComments', 'getPrReviews', 'readLeaseActivity', 'readReviewerQueue', 'mainSha', 'getCommit',
  'compareCommits', 'readFindings', 'readRef', 'readRefOverApi', 'listRefs', 'listReviewRefsPaged', 'readCommitMessage', 'runState',
  'issueComments', 'readOutcomeEvidence', 'applicationCommitInDefaultBranch', 'verifyProductionApply',
  'verifyLiveAssertion', 'verifyGeneratedTypes', 'readArtifactJson', 'readArtifactFiles', 'reversionFiles',
  'localHead', 'localClean', 'localBranch', 'localWorktreeState', 'verifyArtifact',
  'currentMaxVersion', 'commandAvailable', 'reviewerDoctor', 'reviewerAdmissionOverrides',
  'reviewerUsability', 'resolveOrchestratorEngine', 'orchestratorFlowAdapter', 'flowSnapshot',
])

function fixtureIo({ issues, claims = [], openPulls = [], branchPulls = {} }) {
  const reached = []
  const io = {
    openWorkIssues: () => issues,
    openIssueNumbers: () => issues.map((issue) => issue.number),
    openClaims: () => claims,
    openPulls: () => openPulls,
    branchPulls: (branch) => branchPulls[branch] ?? [],
  }
  // Double belt: hygieneReportIo replaces these with its own refusals, but if a
  // future edit ever stopped wrapping, reaching any of these must still fail
  // the run (and this test) instead of silently succeeding.
  for (const name of MUTATION_HOOKS) io[name] = (...args) => { reached.push(name); throw new Error(`fixture write hook ${name} reached with ${JSON.stringify(args).slice(0, 80)}`) }
  return { io, reached }
}

function runReport(fixture) {
  const out = [], err = []
  const oldLog = console.log, oldError = console.error
  console.log = (...args) => out.push(args.join(' '))
  console.error = (...args) => err.push(args.join(' '))
  try {
    const code = main([], NOW, fixture.io)
    return { code, out: out.join('\n'), err: err.join('\n') }
  } finally {
    console.log = oldLog
    console.error = oldError
  }
}

test('every githubIo function hook is classified: known read or refused mutation', () => {
  // The completeness guard the governed review asked for. Nothing on githubIo
  // may be silent: if this fails, a new hook arrived — decide which list owns it.
  const functionHooks = Object.keys(githubIo).filter((key) => typeof githubIo[key] === 'function')
  assert.ok(functionHooks.length > 50, 'the githubIo surface shrank; this classification needs re-derivation')
  for (const key of functionHooks) {
    assert.ok(KNOWN_READ_HOOKS.has(key) || MUTATION_HOOKS.includes(key),
      `githubIo grew hook ${key}: classify it as a known read or add it to MUTATION_HOOKS — never let it pass through silently`)
  }
  for (const key of MUTATION_HOOKS) assert.ok(typeof githubIo[key] === 'function', `refused hook ${key} no longer exists on githubIo; prune the list`)
})

test('every stripped mutation hook throws from the wrapper (dirty-first)', () => {
  for (const name of MUTATION_HOOKS) {
    const base = { readProbe: () => 'ok' }
    base[name] = () => 'mutation happened'
    const wrapped = hygieneReportIo(base)
    assert.throws(() => wrapped[name](), new RegExp(`read-only queue hygiene report must never call ${name}`), `${name} must be refused`)
    assert.equal(wrapped.readProbe(), 'ok', 'read hooks pass through untouched')
  }
})

test('a backed-up queue full of dispatchable structural work exits 0 and writes nothing', () => {
  const issues = [
    { number: 101, title: 'dispatchable a', createdAt: '2026-09-10T00:00:00Z', labels: [WORK_LABEL], body: scope('ready', 'structural', 'shared-db-orchestrator', 10, ['table core.a']) },
    { number: 102, title: 'dispatchable b', createdAt: '2026-09-11T00:00:00Z', labels: [WORK_LABEL], body: scope('ready', 'structural', 'shared-db-orchestrator', 9, ['crm.customer_ext']) },
  ]
  const fixture = fixtureIo({ issues })
  const result = runReport(fixture)
  assert.equal(result.code, 0, 'a backed-up queue is the normal state, not a hygiene failure')
  assert.deepEqual(fixture.reached, [], 'no mutation hook may be reached')
  const report = JSON.parse(result.out)
  assert.equal(report.mutating, false)
  assert.equal(report.report, 'queue-hygiene')
  assert.deepEqual(report.unlabelled_issues, [])
  assert.deepEqual(report.expired_author_leases, [])
  assert.match(result.err, /Queue hygiene clean/)
})

test('unlabelled issues are reported and the report still exits 0', () => {
  const issues = [
    { number: 201, title: 'invisible', createdAt: '2026-09-01T00:00:00Z', labels: ['something-else'], body: scope('ready', 'repo-maintenance', 'repo-maintenance', 5) },
    { number: 202, title: 'labelled', createdAt: '2026-09-02T00:00:00Z', labels: [WORK_LABEL], body: scope('ready', 'structural', 'shared-db-orchestrator', 5, ['table core.b']) },
  ]
  const fixture = fixtureIo({ issues })
  const result = runReport(fixture)
  assert.equal(result.code, 0, 'reporting a hygiene finding is not a failure for the scheduled run')
  assert.deepEqual(fixture.reached, [])
  const report = JSON.parse(result.out)
  assert.deepEqual(report.unlabelled_issues, [201])
  assert.match(result.err, /UNLABELLED ISSUES: add the `db-work` label to #201/)
})

test('expired author leases are reported with their pull-request state', () => {
  const issues = [
    { number: 301, title: 'queued behind the dead lane', createdAt: '2026-09-05T00:00:00Z', labels: [WORK_LABEL], body: scope('ready', 'structural', 'shared-db-orchestrator', 7, ['table plm.production_lane_canary']) },
  ]
  const claims = [{
    number: 302,
    title: 'CLAIM: #301 canary',
    body: claimBody({
      version: '20260917060000', objects: ['table plm.production_lane_canary'],
      owner: 'agent-gone', branch: 'codex/gone', worktree: 'C:/w/gone',
      expiresAt: new Date('2026-09-17T06:48:11.458Z'),
    }),
  }]
  const fixture = fixtureIo({ issues, claims, branchPulls: { 'codex/gone': [{ merged_at: '2026-09-16T10:00:00Z', merge_commit_sha: 'a'.repeat(40) }] } })
  const result = runReport(fixture)
  assert.equal(result.code, 0)
  assert.deepEqual(fixture.reached, [])
  const report = JSON.parse(result.out)
  assert.equal(report.expired_author_leases.length, 1)
  assert.equal(report.expired_author_leases[0].claim, 302)
  assert.equal(report.expired_author_leases[0].pr_state, 'merged')
  assert.match(result.err, /EXPIRED AUTHOR LEASES: occupancy is locked but no live author lease exists/)
  assert.match(result.err, /claim #302/)
})

test('not-orchestrator work is reported with its age in days', () => {
  const issues = [
    { number: 401, title: 'stale maintenance', createdAt: '2026-09-07T00:00:00Z', labels: [WORK_LABEL], body: scope('ready', 'repo-maintenance', 'repo-maintenance', 5) },
    { number: 402, title: 'needs return', createdAt: '2026-09-02T00:00:00Z', labels: [WORK_LABEL], body: scope('ready', 'application-data', 'application-session', 5) },
  ]
  const fixture = fixtureIo({ issues })
  const result = runReport(fixture)
  assert.equal(result.code, 0)
  assert.deepEqual(fixture.reached, [])
  const report = JSON.parse(result.out)
  const ages = new Map(report.not_orchestrator_work.map((item) => [item.issue, item.age_days]))
  assert.equal(ages.get(401), 10, 'age is whole days from createdAt to now')
  assert.equal(ages.get(402), 15)
  assert.match(result.err, /OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION \(aging\)/)
  assert.match(result.err, /#402 REJECT/)
  assert.match(result.err, /NO RETURN ADDRESS on #402/)
})

test('an unreadable queue exits 2 — the report never degrades into "no findings"', () => {
  const fixture = { io: { openClaims: () => { throw new Error('GitHub refused') } } }
  const result = runReport(fixture)
  assert.equal(result.code, 2)
  assert.match(result.err, /REFUSED: GitHub refused/)
})
