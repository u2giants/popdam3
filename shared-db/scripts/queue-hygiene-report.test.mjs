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
import { main, hygieneReportIo, dependencyHygiene } from './queue-hygiene-report.mjs'
import { githubIo } from './manage-migration-author-lanes.mjs'
import { stageEventKey } from './lib/work-stage-evidence.mjs'
import { expectedOperatorAssociation } from './lib/repository-identity.mjs'
import { createHash } from 'node:crypto'

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
  'postCommitStatus', 'updateIssue', 'makeOwnerCommit', 'makeReviewVerdictCommit', 'pauseReviewerFailure',
  'createRef', 'deleteRef', 'releaseRefOverGit', 'updateRef', 'atomicReviewRefs', 'atomicReviewMutexRelease',
  'reserveVersion', 'createClaim', 'createIssueIn', 'commentIssue', 'closeIssue',
  'closeClaim', 'contentPreservingRefresh', 'rewriteVersion', 'commitAndPushReversion',
]
// Every OTHER function on githubIo, classified by name as a read. A new githubIo
// hook appears in NEITHER list and fails the classification test below until
// somebody decides which side it is on — the silent-inheritance gap the governed
// review of head fd7d1327 caught (rewriteVersion, commitAndPushReversion).
const KNOWN_READ_HOOKS = new Set([
  'databasePreviewClassification', 'pullRequestFiles', 'handoffCollisions', 'readReviewerOperationRoute', 'countLogicalReviewRequests',
  'readPrWithReviewContext', 'observedReviewQuota', 'getRateLimit', 'previewApplyRun', 'verifyPreviewApplyArtifact',
  'readActiveReviewLeases', 'readActiveReviewLeasesOverGit', 'readActiveReviewLeasesOverGraphql', 'readReviewStates',
  'readReviewRefs', 'readReviewRecords', 'readReviewFailureCommit', 'readPaidReviewStarts', 'reviewContentComparison', 'openClaims', 'closedClaimsForWork', 'openWorkIssues', 'openIssueNumbers', 'openIssueRows',
  'dependencyStates', 'mergeCommitInMain', 'prSources', 'openPulls', 'readPullStates', 'mergeTouchesMigrations',
  'branchPulls', 'getPr', 'getPrFiles', 'databasePreviewFileSnapshot', 'comparePullRequestFiles', 'getCommitStatus',
  'verifyNonclosingMaintenanceBinding', 'prepareNonclosingEvidenceGit',
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
    getIssueComments: () => [],
    getIssue: number => issues.find(issue => issue.number === number),
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
    { number: 102, title: 'dispatchable b', createdAt: '2026-09-11T00:00:00Z', labels: [WORK_LABEL], body: scope('ready', 'structural', 'shared-db-orchestrator', 9, ['table crm.customer_ext']) },
  ]
  const fixture = fixtureIo({ issues })
  const result = runReport(fixture)
  assert.equal(result.code, 0, `a backed-up queue is the normal state, not a hygiene failure: ${result.err}`)
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

const work = (number, dependencies = '', extra = {}) => ({ number, state: 'open', labels: [WORK_LABEL],
  body: 'owner: assigned-agent\n' + scope('ready', 'repo-maintenance', 'repo-maintenance', 5).replace('depends_on:', `depends_on: ${dependencies}`), ...extra })

test('legacy prerequisites retain complete-stage semantics and actionable owners', () => {
  const issues = [work(1, '#2'), work(2)]
  const result = dependencyHygiene(issues, fixtureIo({ issues }).io, 'popcre/shared-db')
  const dependency = result.outcomes[0].dependencies[0]
  assert.equal(dependency.required_stage, 'complete')
  assert.equal(dependency.satisfied, false)
  assert.equal(dependency.owner, 'assigned-agent')
  assert.match(dependency.next_step, /Owner must resolve/)
  assert.equal(result.outcomes[0].current_failing_gate, dependency.reason)
  assert.deepEqual(result.verified_but_open, [])
})

test('cycles, ownerless work and duplicate API rows are visible without mutation', () => {
  const issues = [work(1, '2'), work(2, '1', { body: scope('ready', 'repo-maintenance', 'repo-maintenance', 5).replace('depends_on:', 'depends_on: 1') })]
  const { io, reached } = fixtureIo({ issues })
  const result = dependencyHygiene([...issues, issues[0]], hygieneReportIo(io), 'popcre/shared-db')
  assert.equal(result.outcomes.length, 2)
  assert.deepEqual(result.dependency_cycles, [[1, 2, 1]])
  assert.deepEqual(result.missing_owners, [2])
  assert.equal(result.outcomes[1].next_step, 'Assign an owner.')
  assert.deepEqual(reached, [])
})

test('closed without proof is not accepted and unknown history is not success', () => {
  const issues = [work(1, '2')], fixture = fixtureIo({ issues })
  fixture.io.getIssue = () => work(2, '', { state: 'closed', closed_at: '2026-09-19T00:00:00Z' })
  let result = dependencyHygiene(issues, fixture.io, 'popcre/shared-db')
  assert.equal(result.outcomes[0].dependencies[0].satisfied, false)
  fixture.io.getIssue = () => { throw new Error('HTTP 429') }
  result = dependencyHygiene(issues, fixture.io, 'popcre/shared-db')
  assert.equal(result.outcomes[0].dependencies[0].status, 'unknown')
  assert.match(result.unverifiable[0].reason, /429/)
})

test('counterfeit or stale terminal events never appear as verified delivery', () => {
  const issues = [work(1)], fixture = fixtureIo({ issues })
  const event = { schema_version: 1, repository: 'popcre/shared-db', work_issue: 1, stage: 'application-accepted',
    pr: 99, head_sha: 'a'.repeat(40), merge_sha: 'b'.repeat(40), evidence_digest: 'c'.repeat(64),
    evidence_ref: 'https://github.com/popcre/shared-db/issues/1#issuecomment-10' }
  event.event_id = stageEventKey(event)
  const comment = { author: 'u2giants', author_association: expectedOperatorAssociation(), body: '```db-work-stage\n' + JSON.stringify(event) + '\n```' }
  fixture.io.issueComments = () => []
  fixture.io.readRef = () => null
  for (const author of ['attacker', 'u2giants']) {
    fixture.io.getIssueComments = () => [{ ...comment, author }]
    const result = dependencyHygiene(issues, fixture.io, 'popcre/shared-db')
    assert.deepEqual(result.verified_but_open, [])
    assert.equal(result.outcomes[0].delivery, 'unverifiable')
  }
})

test('CLI reports unreadable comments as an incomplete report with nonzero exit', () => {
  const fixture = fixtureIo({ issues: [work(1)] })
  fixture.io.getIssueComments = () => { throw new Error('comments unavailable') }
  const result = runReport(fixture)
  assert.equal(result.code, 2)
  assert.match(JSON.parse(result.out).dependency_hygiene.unverifiable[0].reason, /comments unavailable/)
})

test('owner omitted by queue projection is read from GitHub, unreadable owner is not ownerless', () => {
  const issues = [work(1, '', { body: scope('ready', 'repo-maintenance', 'repo-maintenance', 5) })]
  const fixture = fixtureIo({ issues })
  fixture.io.getIssue = () => ({ ...issues[0], assignees: [{ login: 'actual-owner' }] })
  let report = dependencyHygiene(issues, fixture.io, 'popcre/shared-db')
  assert.equal(report.outcomes[0].owner, 'actual-owner')
  assert.deepEqual(report.missing_owners, [])
  fixture.io.getIssue = () => { throw new Error('ownership API unavailable') }
  report = dependencyHygiene(issues, fixture.io, 'popcre/shared-db')
  assert.deepEqual(report.missing_owners, [])
  assert.equal(report.unverifiable.length, 1)
})

test('malformed scope remains a visible unknown alongside other outcomes', () => {
  const issues = [work(1, '', { body: '```db-work-scope\nstatus: invented\n```' }), work(2)]
  const report = dependencyHygiene(issues, fixtureIo({ issues }).io, 'popcre/shared-db')
  assert.equal(report.outcomes.length, 2)
  assert.equal(report.outcomes[0].delivery, 'unverifiable')
  assert.match(report.outcomes[0].current_failing_gate, /status/)
})

test('CLI accepts a proven explicit stage while legacy dependencies still await closure', () => {
  const issues = [work(1, '2@implementation-merged'), work(2), work(3, '2')]
  const fixture = fixtureIo({ issues }), repository = 'popcre/shared-db'
  const facts = { repository, work_issue: 2, pr: 99, head_sha: 'a'.repeat(40), merge_sha: 'b'.repeat(40) }
  const event = { schema_version: 1, ...facts, stage: 'implementation-merged', evidence_ref: `https://github.com/${repository}/pull/99`,
    evidence_digest: createHash('sha256').update(JSON.stringify(facts)).digest('hex') }
  event.event_id = stageEventKey(event)
  const comments = [{ author: 'u2giants', author_association: expectedOperatorAssociation(), body: '```db-work-stage\n' + JSON.stringify(event) + '\n```' }]
  Object.assign(fixture.io, {
    getIssueComments: n => n === 2 ? comments : [], issueComments: n => n === 2 ? comments : [],
    readRef: ref => ref.startsWith('refs/db-work-stage-revocations/') ? null : 'c'.repeat(40),
    getCommit: () => ({ message: 'db-work-stage ' + JSON.stringify(event) }),
    getPr: () => ({ merged_at: NOW.toISOString(), head: { sha: facts.head_sha }, merge_commit_sha: facts.merge_sha, base: { repo: { full_name: repository }, ref: 'main' } }),
    closingIssuesForPr: () => [{ number: 2 }], mergeCommitInMain: () => true,
  })
  const result = runReport(fixture)
  assert.equal(result.code, 0, result.err)
  const report = JSON.parse(result.out).dependency_hygiene
  assert.equal(report.outcomes[0].dependencies[0].satisfied, true)
  assert.equal(report.outcomes[2].dependencies[0].satisfied, false)
  assert.deepEqual(fixture.reached, [])
  fixture.io.readRef = () => 'c'.repeat(40) // revocation became visible
  const revoked = runReport(fixture)
  assert.equal(revoked.code, 2)
  assert.equal(JSON.parse(revoked.out).dependency_hygiene.outcomes[0].dependencies[0].satisfied, false)
})

test('accepted maintenance is reported awaiting closure only after actual PR linkage verification', () => {
  const issues = [work(1)], fixture = fixtureIo({ issues })
  const record = { schema_version: 1, work_issue: 1, outcome: 'merged', pr: 99, merge_sha: 'a'.repeat(40), migration_versions: [] }
  const comments = [{ author: 'u2giants', author_association: expectedOperatorAssociation(), body: '```db-work-completion\n' + JSON.stringify(record) + '\n```' }]
  Object.assign(fixture.io, { getIssueComments: () => comments, issueComments: () => comments,
    getPr: () => ({ merged_at: NOW.toISOString(), merge_commit_sha: record.merge_sha, base: { repo: { full_name: 'popcre/shared-db' }, ref: 'main' } }),
    getPrFiles: () => [{ filename: 'scripts/example.mjs' }], readRef: () => 'b'.repeat(40),
    compareCommits: () => ({ status: 'ahead', behind_by: 0 }), closingIssuesForPr: () => [{ number: 1 }], mergeCommitInMain: () => true,
  })
  let report = dependencyHygiene(issues, hygieneReportIo(fixture.io), 'popcre/shared-db')
  assert.deepEqual(report.verified_but_open, [1])
  assert.deepEqual(fixture.reached, [])
  fixture.io.closingIssuesForPr = () => [{ number: 2 }]
  report = dependencyHygiene(issues, hygieneReportIo(fixture.io), 'popcre/shared-db')
  assert.deepEqual(report.verified_but_open, [])
  assert.equal(report.outcomes[0].delivery, 'unverifiable')
})
