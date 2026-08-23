import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ContractError, CONTRACT_SCHEMA_VERSION, CONTRACT_REF_PREFIX,
  validateContract, assertSafePath, canonicalize, contractHash, contractRef,
  validateCompletionReport, reconcileReportWithContract, pathMatches,
  publishContract, readPublishedContract, parseArgs, main,
} from './agent-work-contract.mjs'
import { validateCompletionRecord } from './lib/work-dependencies.mjs'

const contract = (over = {}) => ({
  schema_version: CONTRACT_SCHEMA_VERSION,
  work_issue: 42,
  work_type: 'structural',
  route: 'shared-db-orchestrator',
  goal: 'add the licensor bridge table',
  base_sha: 'abc1234',
  dispatcher: 'shared-db-orchestrator',
  worker: 'codex',
  branch: 'codex/issue-42',
  worktree: '.claude/worktrees/issue-42',
  allowed_paths: ['supabase/migrations/**'],
  file_writes: ['supabase/migrations/20260823120000_bridge.sql'],
  db_reads: ['table core.licensor'],
  db_writes: ['table plm.bridge'],
  prohibited_actions: ['do not push to production'],
  required_checks: ['node --test scripts/*.test.mjs'],
  assumptions: ['core.licensor already exists'],
  stop_conditions: ['stop if the migration needs a second table'],
  ...over,
})

const report = (over = {}) => ({
  schema_version: 1,
  work_issue: 42,
  outcome: 'merged',
  pr: 7,
  merge_sha: 'def5678',
  migration_versions: ['20260823120000'],
  contract_ref: `${CONTRACT_REF_PREFIX}/42/1`,
  contract_sha256: contractHash(contract()),
  head_sha: 'aaa1111',
  files_changed: ['supabase/migrations/20260823120000_bridge.sql'],
  db_reads: ['table core.licensor'],
  db_writes: ['table plm.bridge'],
  checks: [{ command: 'node --test scripts/*.test.mjs', exit_code: 0, evidence: '596 pass, 0 fail' }],
  assumptions_resolved: ['core.licensor exists'],
  stop_conditions_hit: [],
  ...over,
})

// --- CONTRACT VALIDATION ---------------------------------------------------

test('a complete contract validates', () => {
  assert.doesNotThrow(() => validateContract(contract()))
})

test('every required field is required', () => {
  for (const field of ['work_issue', 'goal', 'base_sha', 'dispatcher', 'worker', 'branch', 'worktree', 'allowed_paths', 'required_checks', 'stop_conditions']) {
    const broken = contract()
    delete broken[field]
    assert.throws(() => validateContract(broken), new RegExp(`missing ${field}`), `${field} must be required`)
  }
})

// A TYPO'D FIELD SILENTLY DROPS A CONSTRAINT, and a dropped constraint looks
// exactly like one that was never set.
test('an unknown field is refused rather than ignored', () => {
  assert.throws(() => validateContract({ ...contract(), allowed_path: ['x'] }), /unknown field allowed_path/)
})

test('a contract that allows nothing, proves nothing, or never stops is refused', () => {
  assert.throws(() => validateContract(contract({ allowed_paths: [] })), /allowed_paths must not be empty/)
  assert.throws(() => validateContract(contract({ required_checks: [] })), /at least one command that proves the work/)
  assert.throws(() => validateContract(contract({ stop_conditions: [] })), /when the worker must stop/)
})

// `allowed_paths: ["**"]` is not a scope, it is the absence of one.
test('a path pattern cannot escape the repository or cover all of it', () => {
  assert.throws(() => assertSafePath('/etc/passwd'), /repository-relative/)
  assert.throws(() => assertSafePath('C:/Windows'), /repository-relative/)
  assert.throws(() => assertSafePath('../other-repo/**'), /must not escape/)
  assert.throws(() => assertSafePath('supabase/../../x'), /must not escape/)
  assert.throws(() => assertSafePath('**'), /covers the whole repository/)
  assert.throws(() => assertSafePath('*'), /covers the whole repository/)
  assert.doesNotThrow(() => assertSafePath('supabase/migrations/**'))
})

// A zero-database contract is a real constraint, not an exemption.
test('a repo-maintenance contract must declare no database access, and structural must declare a write', () => {
  const repo = contract({ work_type: 'repo-maintenance', route: 'repo-maintenance', db_reads: [], db_writes: [] })
  assert.doesNotThrow(() => validateContract(repo))
  assert.throws(() => validateContract({ ...repo, db_writes: ['table core.a'] }), /must declare empty db_reads and db_writes/)
  assert.throws(() => validateContract(contract({ db_writes: [] })), /structural contract must declare at least one db_write/)
})

// --- HASHING ---------------------------------------------------------------
//
// Two contracts that SAY the same thing must hash the same, or the hash proves
// nothing about whether the contract changed.

test('the hash is stable under key order and formatting', () => {
  const a = contract()
  const b = Object.fromEntries(Object.entries(a).reverse())
  assert.equal(contractHash(a), contractHash(b))
  assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }))
})

test('the hash changes when any term changes', () => {
  assert.notEqual(contractHash(contract()), contractHash(contract({ goal: 'something else' })))
  assert.notEqual(contractHash(contract()), contractHash(contract({ allowed_paths: ['supabase/**'] })))
})

test('contractRef refuses a nonsense issue or generation', () => {
  assert.equal(contractRef(42, 1), `${CONTRACT_REF_PREFIX}/42/1`)
  assert.throws(() => contractRef(0, 1), /positive issue number/)
  assert.throws(() => contractRef(42, 0), /positive generation/)
})

// --- PATH MATCHING ---------------------------------------------------------

test('path patterns match the way a contract author would expect', () => {
  assert.equal(pathMatches('supabase/migrations/**', 'supabase/migrations/20260823_a.sql'), true)
  assert.equal(pathMatches('supabase/migrations/**', 'supabase/migrations/nested/a.sql'), true)
  assert.equal(pathMatches('supabase/migrations/**', 'scripts/a.mjs'), false)
  assert.equal(pathMatches('scripts/*.mjs', 'scripts/a.mjs'), true)
  assert.equal(pathMatches('scripts/*.mjs', 'scripts/lib/a.mjs'), false, 'a single star must not cross a directory boundary')
  assert.equal(pathMatches('docs/a.md', 'docs/a.md'), true)
  assert.equal(pathMatches('supabase/migrations/**', 'supabase\\migrations\\a.sql'), true, 'Windows paths must compare equal')
})

// --- COMPLETION REPORT -----------------------------------------------------

test('a complete report validates', () => {
  assert.doesNotThrow(() => validateCompletionReport(report(), { validateCompletionRecord }))
})

test('the report carries the Step 3 record, so its rules still apply', () => {
  assert.throws(() => validateCompletionReport(report({ pr: undefined }), { validateCompletionRecord }), /must name its pr number/)
  assert.throws(() => validateCompletionReport(report({ outcome: 'cancelled', reason: undefined }), { validateCompletionRecord }), /must give a reason/)
})

test('contract fields are required on top of it', () => {
  for (const field of ['contract_ref', 'contract_sha256', 'head_sha', 'files_changed', 'checks']) {
    const broken = report()
    delete broken[field]
    assert.throws(() => validateCompletionReport(broken, { validateCompletionRecord }), new RegExp(`missing ${field}`))
  }
})

// A CHECK WITHOUT EVIDENCE IS A CLAIM OF SUCCESS, which is what this whole layer
// exists to stop being sufficient.
test('a check must record its command, exit code and evidence', () => {
  assert.throws(() => validateCompletionReport(report({ checks: [{ exit_code: 0, evidence: 'x' }] }), { validateCompletionRecord }), /must name the exact command/)
  assert.throws(() => validateCompletionReport(report({ checks: [{ command: 'a', evidence: 'x' }] }), { validateCompletionRecord }), /integer exit_code/)
  assert.throws(() => validateCompletionReport(report({ checks: [{ command: 'a', exit_code: 0 }] }), { validateCompletionRecord }), /must carry evidence, not just a claim/)
})

// --- RECONCILIATION: the heart of the step ---------------------------------

test('a faithful report satisfies its contract', () => {
  assert.equal(reconcileReportWithContract(report(), contract()).satisfied, true)
})

// The contract was edited after the fact to match what got built.
test('a report whose hash does not match the published contract is refused', () => {
  const verdict = reconcileReportWithContract(report(), contract({ goal: 'a wider goal added later' }))
  assert.equal(verdict.satisfied, false)
  assert.match(verdict.problems.join(' '), /changed after the fact/)
})

test('a report that changed files outside allowed_paths is refused', () => {
  const verdict = reconcileReportWithContract(report({ files_changed: ['supabase/migrations/20260823120000_bridge.sql', 'scripts/secret.mjs'] }), contract())
  assert.equal(verdict.satisfied, false)
  assert.match(verdict.problems.join(' '), /outside allowed_paths: scripts\/secret\.mjs/)
})

// WIDENING IS THE FAILURE MODE. A worker that writes an object its contract never
// named has defeated the claim system upstream of it.
test('a report that widens its database writes or reads is refused', () => {
  const wider = reconcileReportWithContract(report({ db_writes: ['table plm.bridge', 'table core.licensor_secret'] }), contract())
  assert.match(wider.problems.join(' '), /did not authorise: table core\.licensor_secret/)

  const read = reconcileReportWithContract(report({ db_reads: ['table core.licensor', 'table core.other'] }), contract())
  assert.match(read.problems.join(' '), /did not declare: table core\.other/)
})

test('reading an object the contract declared as a write is allowed', () => {
  assert.equal(reconcileReportWithContract(report({ db_reads: ['table plm.bridge'] }), contract()).satisfied, true)
})

test('a required check that never ran, or ran and failed, is refused', () => {
  const missing = reconcileReportWithContract(report({ checks: [] }), contract())
  assert.match(missing.problems.join(' '), /never run: node --test/)
  const failed = reconcileReportWithContract(report({ checks: [{ command: 'node --test scripts/*.test.mjs', exit_code: 1, evidence: '3 failing' }] }), contract())
  assert.match(failed.problems.join(' '), /failed \(exit 1\)/)
})

// "REPORTED DONE ANYWAY" is precisely the failure the contract exists to catch.
test('a report that hit a stop condition cannot also claim success', () => {
  const verdict = reconcileReportWithContract(report({ stop_conditions_hit: ['needed a second table'] }), contract())
  assert.equal(verdict.satisfied, false)
  assert.match(verdict.problems.join(' '), /but claims outcome merged/)
})

test('a report that hit a stop condition and says so honestly is fine', () => {
  const honest = report({ outcome: 'returned', reason: 'scope changed', stop_conditions_hit: ['needed a second table'], pr: undefined, merge_sha: undefined, migration_versions: undefined })
  assert.equal(reconcileReportWithContract(honest, contract()).satisfied, true)
})

test('a report for a different issue is refused', () => {
  assert.match(reconcileReportWithContract(report({ work_issue: 43 }), contract()).problems.join(' '), /report is for issue #43/)
})

// --- PUBLISHING ------------------------------------------------------------

function publishIo({ existing = null } = {}) {
  const refs = new Map()
  const commits = new Map()
  const comments = []
  if (existing) refs.set(existing, 'oldsha')
  return {
    refs, commits, comments,
    readRef: (ref) => refs.get(ref) ?? null,
    createRef: (ref, sha) => { if (refs.has(ref)) throw new ContractError('reference already exists'); refs.set(ref, sha) },
    createBlobCommit: (message) => { const sha = `commit${commits.size + 1}`; commits.set(sha, message); return JSON.stringify({ sha }) },
    readCommitMessage: (sha) => commits.get(sha),
    commentIssue: (number, body) => comments.push({ number, body }),
  }
}

test('publishing creates the ref, reads it back, and posts a human-readable copy', () => {
  const io = publishIo()
  const published = publishContract(contract(), io)
  assert.equal(published.ref, `${CONTRACT_REF_PREFIX}/42/1`)
  assert.equal(published.hash, contractHash(contract()))
  assert.equal(io.refs.get(published.ref), published.sha)
  assert.equal(io.comments.length, 1)
  assert.match(io.comments[0].body, /authority is the ref above/)
})

// CREATE-IF-ABSENT is the property a comment can never have.
test('publishing twice at the same generation FAILS instead of replacing', () => {
  const io = publishIo({ existing: `${CONTRACT_REF_PREFIX}/42/1` })
  assert.throws(() => publishContract(contract(), io), /already exists; a contract is immutable/)
})

test('a new generation gets its own ref', () => {
  const io = publishIo({ existing: `${CONTRACT_REF_PREFIX}/42/1` })
  const published = publishContract(contract({ generation: 2 }), io)
  assert.equal(published.ref, `${CONTRACT_REF_PREFIX}/42/2`)
})

test('a published contract reads back identically', () => {
  const io = publishIo()
  const { ref } = publishContract(contract(), io)
  assert.equal(contractHash(readPublishedContract(ref, io)), contractHash(contract()))
})

test('reading a contract that was never published is an error, not an empty contract', () => {
  assert.throws(() => readPublishedContract(`${CONTRACT_REF_PREFIX}/99/1`, publishIo()), /does not exist; no contract was published/)
})

// --- CLI -------------------------------------------------------------------

test('parseArgs refuses two modes and unknown arguments', () => {
  assert.throws(() => parseArgs(['--validate-contract', '--publish-contract']), /exactly one mode/)
  assert.throws(() => parseArgs(['--nope']), /unknown argument/)
  assert.throws(() => parseArgs(['--contract-file']), /requires a path/)
})

test('main exits 2 on usage errors and 0 on --help', async () => {
  const quiet = { log() {}, error() {} }
  assert.equal(await main(['--help'], quiet), 0)
  assert.equal(await main([], quiet), 2)
  assert.equal(await main(['--validate-contract'], quiet), 2)
})

test('ContractError is the single error type callers catch', () => {
  assert.throws(() => validateContract(null), ContractError)
  assert.throws(() => assertSafePath('**'), ContractError)
})
