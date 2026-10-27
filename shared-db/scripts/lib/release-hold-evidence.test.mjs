// Issue #3779 step 2: adversarial cases for the release-hold evidence contracts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ReleaseEvidenceError, RELEASE_EVIDENCE_REF_PREFIX, RECEIPT_IO_MAX_ATTEMPTS, RECEIPT_IO_DEADLINE_MS, CLEANUP_ACTIONS,
  evidenceRef, parseEvidenceRef, isReleaseEvidenceRef, assertRefDeletable, ledgerDigest, evidenceDigest,
  validatePreparedReceipt, validateWriteIntent, validateTerminalReceipt, validateReportingComplete,
  bindEvidenceIdentity, verifyPublishedEvidence, formatEvidenceMessage, parseEvidenceMessage, publishEvidence,
  isReleasableTerminal, authorizesBackendTakeover, decideCleanup,
} from './release-hold-evidence.mjs'
import { releaseOwnedRef, releaseRefOverGit } from './lanes/holds-and-refs.mjs'
import { deleteRefWithReadback } from './lanes/github-wire.mjs'
import { githubIo } from '../manage-migration-author-lanes.mjs'

const H = (c) => c.repeat(40)
const D = (c) => c.repeat(64)
const REQ = '0f3b2b8a-5f1e-4c2d-9a7b-0123456789ab'
const identity = (over = {}) => ({
  repository: 'popcre/shared-db', stage: 'production', request_id: REQ, generation: 2, holder_id: 'github-actions:555',
  source: { pr: 4523, head_sha: H('a'), base_sha: H('b') },
  target: { identifier: 'qsllyeztdwjgirsysgai' },
  producer: { workflow: '.github/workflows/shared-supabase-migrations.yml', run_id: '39529158952', run_attempt: '1' },
  ...over,
})
const prepared = (over = {}) => ({
  schema_version: 1, kind: 'prepared', ...identity(),
  policy_digests: { 'workflow:shared-supabase-migrations.yml': D('1'), 'tool:psql': D('2') },
  migrations: [{ version: '20261021120000', path: 'supabase/migrations/20261021120000_add_thing.sql', sha256: D('3') }],
  ledger_before: { versions: ['20261001000000', '20261010000000'], sha256: ledgerDigest(['20261001000000', '20261010000000']) },
  allowed_operations: ['supabase-db-push'],
  approvals: ['refs/db-review-verdicts/3779-4523-' + H('a')],
  prepared_checks: [{ name: 'production-business-risk-gate', result: 'pass', digest: D('4') }],
  created_at: '2026-10-21T12:00:00Z',
  ...over,
})
const terminal = (over = {}) => ({
  schema_version: 1, kind: 'terminal', ...identity(),
  prepared_ref_sha: H('c'), write_intent_ref_shas: [H('d')],
  command: { exit_code: 0, result: 'verified' },
  ledger_after: { versions: ['20261001000000', '20261010000000', '20261021120000'], sha256: ledgerDigest(['20261001000000', '20261010000000', '20261021120000']) },
  applied_migrations: [{ version: '20261021120000', path: 'supabase/migrations/20261021120000_add_thing.sql', sha256: D('3') }],
  catalog_verification: { outcome: 'verified', digest: D('5') },
  completion_evidence: { kind: 'launched-command-exit', observation_digest: D('6') },
  checks: [{ name: 'catalog-verification', result: 'pass', digest: D('5') }],
  created_at: '2026-10-21T12:30:00Z',
  ...over,
})
const writeIntent = (over = {}) => ({ schema_version: 1, kind: 'write-intent', ...identity(), ordinal: 1, command_kind: 'supabase-db-push', manifest_digest: D('7'), prepared_ref_sha: H('c'), created_at: '2026-10-21T12:05:00Z', ...over })
const reporting = (over = {}) => ({ schema_version: 1, kind: 'reporting-complete', ...identity(), terminal_ref_sha: H('e'), report_artifacts: [{ name: 'production-apply-evidence', artifact_id: '12345', sha256: D('8') }], created_at: '2026-10-21T12:40:00Z', ...over })

function memoryTransport() {
  const refs = new Map(), commits = new Map(); let seq = 0
  return {
    refs, commits, calls: [],
    makeOwnerCommit(message) { const sha = (++seq).toString(16).padStart(40, '0'); commits.set(sha, message); this.calls.push(['commit', sha]); return sha },
    createRef(ref, sha) { this.calls.push(['create', ref, sha]); if (refs.has(ref)) return false; refs.set(ref, sha); return true },
    readRef(ref) { return refs.get(ref) ?? null },
    readCommitMessage(sha) { return commits.get(sha) ?? null },
  }
}

// --- REF NAMES ---------------------------------------------------------------

test('evidence refs use the strict stage allowlist, UUID request id and positive generation', () => {
  const ref = evidenceRef({ stage: 'production', requestId: REQ, generation: 2, record: 'write-intent', ordinal: 3 })
  assert.equal(ref, `${RELEASE_EVIDENCE_REF_PREFIX}/production/${REQ}-g2/write-intent-3`)
  assert.deepEqual(parseEvidenceRef(ref), { stage: 'production', requestId: REQ, generation: 2, record: 'write-intent', ordinal: 3 })
  assert.throws(() => evidenceRef({ stage: 'prod', requestId: REQ, generation: 2, record: 'prepared' }), /stage must be one of/)
  assert.throws(() => evidenceRef({ stage: 'merge', requestId: 'not-a-uuid', generation: 2, record: 'prepared' }), /request id is malformed/)
  assert.throws(() => evidenceRef({ stage: 'merge', requestId: REQ, generation: '2', record: 'prepared' }), /positive integer/)
  assert.throws(() => evidenceRef({ stage: 'merge', requestId: REQ, generation: 0, record: 'prepared' }), /positive integer/)
  assert.throws(() => evidenceRef({ stage: 'merge', requestId: REQ, generation: 1, record: 'terminal', ordinal: 1 }), /carry no ordinal/)
  assert.throws(() => parseEvidenceRef(`${RELEASE_EVIDENCE_REF_PREFIX}/merge/${REQ}-g1/../prepared`), /not a release-evidence ref/)
  assert.throws(() => parseEvidenceRef(`${RELEASE_EVIDENCE_REF_PREFIX}/merge/${REQ}-g01/prepared`), /not a release-evidence ref/)
})

// --- release_evidence_namespace_is_never_pruned -------------------------------

test('release_evidence_namespace_is_never_pruned: every deletion primitive refuses the audit namespace', () => {
  const victim = evidenceRef({ stage: 'merge', requestId: REQ, generation: 1, record: 'terminal' })
  assert.equal(isReleaseEvidenceRef(victim), true)
  assert.throws(() => assertRefDeletable(victim), /never pruned/)
  assert.throws(() => assertRefDeletable(RELEASE_EVIDENCE_REF_PREFIX), /never pruned/)
  assert.throws(() => assertRefDeletable(`${RELEASE_EVIDENCE_REF_PREFIX}/*`), /never pruned|sweep/)
  assert.throws(() => assertRefDeletable('refs/db-release-evidence/production/*'), /never pruned|sweep/)
  assert.throws(() => assertRefDeletable('refs/db-*'), /sweep/)
  assert.throws(() => assertRefDeletable('refs/*'), /sweep/)
  assert.equal(assertRefDeletable('refs/db-coordination/merge'), 'refs/db-coordination/merge')
  assert.equal(assertRefDeletable('refs/db-review-active/x'), 'refs/db-review-active/x')

  // The owner-verified API release path.
  const io = { refs: new Map([[victim, H('1')]]), readRef(ref) { return this.refs.get(ref) ?? null }, deleteRef(ref) { this.refs.delete(ref) } }
  assert.throws(() => releaseOwnedRef(victim, H('1'), io), /never pruned/)
  assert.equal(io.refs.get(victim), H('1'), 'the evidence ref survived the release attempt')
  // The git-protocol fallback release path: refused before any git command runs.
  const ran = []
  assert.throws(() => releaseRefOverGit(victim, H('1'), { run: (...args) => { ran.push(args); return '' }, listRefs: () => new Map([[victim, H('1')]]) }), /never pruned/)
  assert.deepEqual(ran, [])
  // The raw API delete with readback.
  assert.throws(() => deleteRefWithReadback(victim, { run: () => { throw new Error('must not run') }, readRef: () => H('1') }), /never pruned/)
  // The live adapter's deleteRef delegates to the guarded deleteRefWithReadback.
  const source = readFileSync(new URL('../manage-migration-author-lanes.mjs', import.meta.url), 'utf8')
  assert.match(source, /deleteRef\(ref\) \{\n\s*deleteRefWithReadback\(ref,\{/)
  assert.equal(typeof githubIo.deleteRef, 'function')
})

// --- cross_run_preparation_is_rejected -----------------------------------------

test('cross_run_preparation_is_rejected: wrong repo, PR, head, base, target, producer run or attempt refuses by name', () => {
  const doc = validatePreparedReceipt(prepared())
  const mine = identity()
  assert.equal(bindEvidenceIdentity(doc, mine).request_id, REQ)
  const cases = [
    [{ repository: 'popcre/other' }, /repository/],
    [{ source: { ...mine.source, pr: 4524 } }, /source\.pr/],
    [{ source: { ...mine.source, head_sha: H('f') } }, /source\.head_sha/],
    [{ source: { ...mine.source, base_sha: H('f') } }, /source\.base_sha/],
    [{ target: { identifier: 'preview-ref' } }, /target\.identifier/],
    [{ producer: { ...mine.producer, run_id: '1' } }, /producer\.run_id/],
    [{ producer: { ...mine.producer, run_attempt: '2' } }, /producer\.run_attempt/],
    [{ producer: { ...mine.producer, workflow: '.github/workflows/other.yml' } }, /producer\.workflow/],
    [{ stage: 'preview' }, /stage/],
    [{ generation: 3 }, /generation/],
    [{ holder_id: 'github-actions:999' }, /holder_id/],
    [{ request_id: '11111111-2222-4333-8444-555555555555' }, /request_id/],
  ]
  for (const [over, pattern] of cases) {
    assert.throws(() => bindEvidenceIdentity(doc, identity(over)), (error) => error instanceof ReleaseEvidenceError && pattern.test(error.message) && /cross-run evidence refused/.test(error.message), `expected ${pattern} refusal`)
  }
  // A consumer that forgot to state a field cannot bind at all.
  assert.throws(() => bindEvidenceIdentity(doc, { ...mine, producer: { workflow: mine.producer.workflow, run_id: mine.producer.run_id } }), /does not state producer\.run_attempt/)
  assert.throws(() => bindEvidenceIdentity(doc, undefined), /consumer identity is required/)
})

// --- tampered_or_unsafe_preparation_is_rejected --------------------------------

test('tampered_or_unsafe_preparation_is_rejected: unknown fields, versions, traversal, secrets and byte tampering refuse', () => {
  assert.doesNotThrow(() => validatePreparedReceipt(prepared()))
  assert.throws(() => validatePreparedReceipt(prepared({ extra: true })), /unknown field extra/)
  assert.throws(() => validatePreparedReceipt(prepared({ schema_version: 2 })), /schema_version must be 1/)
  assert.throws(() => validatePreparedReceipt(prepared({ kind: 'terminal' })), /record kind must be prepared/)
  assert.throws(() => validatePreparedReceipt(prepared({ source: { pr: 1, head_sha: H('a'), base_sha: H('b'), extra: 1 } })), /source has unknown field/)
  assert.throws(() => validatePreparedReceipt(prepared({ migrations: [{ version: '20261021120000', path: 'supabase/migrations/../../etc/passwd', sha256: D('3') }] })), /unsafe/)
  assert.throws(() => validatePreparedReceipt(prepared({ migrations: [{ version: '20261021120000', path: '/supabase/migrations/20261021120000_x.sql', sha256: D('3') }] })), /unsafe/)
  assert.throws(() => validatePreparedReceipt(prepared({ migrations: [{ version: '20261021120000', path: 'scripts/x.sql', sha256: D('3') }] })), /not a versioned migration path/)
  assert.throws(() => validatePreparedReceipt(prepared({ migrations: [{ version: '20261021120001', path: 'supabase/migrations/20261021120000_x.sql', sha256: D('3') }] })), /does not match/)
  assert.throws(() => validatePreparedReceipt(prepared({ migrations: [{ version: '20261010000000', path: 'supabase/migrations/20261010000000_x.sql', sha256: D('3') }] })), /already in ledger_before/)
  assert.throws(() => validatePreparedReceipt(prepared({ ledger_before: { versions: ['20261001000000'], sha256: D('9') } })), /does not match its versions/)
  assert.throws(() => validatePreparedReceipt(prepared({ ledger_before: { versions: ['20261010000000', '20261001000000'], sha256: ledgerDigest(['20261010000000', '20261001000000']) } })), /strictly ascending/)
  assert.throws(() => validatePreparedReceipt(prepared({ allowed_operations: ['drop-database'] })), /unknown operation/)
  assert.throws(() => validatePreparedReceipt(prepared({ allowed_operations: [] })), /at least one/)
  assert.throws(() => validatePreparedReceipt(prepared({ approvals: ['https://github.com/popcre/shared-db/pull/1#issuecomment-1'] })), /approvals entry is malformed/)
  assert.throws(() => validatePreparedReceipt(prepared({ policy_digests: {} })), /at least one digest/)
  assert.throws(() => validatePreparedReceipt(prepared({ policy_digests: { tool: 'abc' } })), /policy_digests\.tool is malformed/)
  assert.throws(() => validatePreparedReceipt(prepared({ target: { identifier: 'postgresql://postgres:hunter2@db.example.com/postgres' } })), /credential-shaped/)
  assert.throws(() => validatePreparedReceipt(prepared({ holder_id: 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789' })), /credential-shaped|malformed/)
  assert.throws(() => validatePreparedReceipt(prepared({ prepared_checks: [{ name: 'x', result: 'maybe', digest: D('1') }] })), /pass or fail/)
  assert.throws(() => validatePreparedReceipt(prepared({ created_at: 'yesterday' })), /created_at is malformed/)

  // Byte tampering after publication: the digest line no longer matches.
  const message = formatEvidenceMessage(prepared())
  const tampered = message.replace(`"head_sha":"${H('a')}"`, `"head_sha":"${H('f')}"`)
  assert.notEqual(tampered, message)
  assert.throws(() => parseEvidenceMessage(tampered), /do not match the digest line/)
  // Re-signed bytes (a forger who recomputed the digest) parse, but then fail
  // to bind to the consumer's real head.
  const resigned = formatEvidenceMessage(prepared({ source: { pr: 4523, head_sha: H('f'), base_sha: H('b') } }))
  assert.throws(() => verifyPublishedEvidence({ ref: evidenceRef({ stage: 'production', requestId: REQ, generation: 2, record: 'prepared' }), sha: H('1'), message: resigned }, identity()), /source\.head_sha/)
  // Non-canonical bytes refuse even with a matching digest.
  const doc = prepared()
  const loose = JSON.stringify(doc)
  const looseMessage = `db-release-evidence prepared production ${REQ} g2\n\ndigest: ${evidenceDigest(doc)}\n${loose}`
  assert.throws(() => parseEvidenceMessage(looseMessage), /do not match the digest line|not canonical/)
  // A ref that names a different record than it holds refuses.
  assert.throws(() => verifyPublishedEvidence({ ref: evidenceRef({ stage: 'production', requestId: REQ, generation: 2, record: 'terminal' }), sha: H('1'), message }, identity()), /does not name the record it holds/)
  assert.throws(() => verifyPublishedEvidence({ ref: evidenceRef({ stage: 'production', requestId: REQ, generation: 2, record: 'prepared' }), sha: 'short', message }, identity()), /sha is malformed/)
  const ok = verifyPublishedEvidence({ ref: evidenceRef({ stage: 'production', requestId: REQ, generation: 2, record: 'prepared' }), sha: H('1'), message }, identity())
  assert.equal(ok.digest, evidenceDigest(doc))
  assert.throws(() => verifyPublishedEvidence({ ref: ok.ref, sha: H('1'), message }, identity(), { expectedDigest: D('0') }), /differs from the digest this run published/)
})

test('write-intent, terminal and reporting-complete records are strict and distinguish the two completion-evidence kinds', () => {
  assert.doesNotThrow(() => validateWriteIntent(writeIntent()))
  assert.throws(() => validateWriteIntent(writeIntent({ command_kind: 'psql' })), /command_kind must be one of/)
  assert.throws(() => validateWriteIntent(writeIntent({ ordinal: 0 })), /positive integer/)
  assert.throws(() => validateWriteIntent(writeIntent({ note: 'x' })), /unknown field note/)
  assert.doesNotThrow(() => validateTerminalReceipt(terminal()))
  assert.throws(() => validateTerminalReceipt(terminal({ command: { exit_code: 1, result: 'verified' } })), /requires exit_code 0/)
  assert.throws(() => validateTerminalReceipt(terminal({ ledger_after: { versions: ['20261001000000'], sha256: ledgerDigest(['20261001000000']) } })), /missing from ledger_after/)
  assert.throws(() => validateTerminalReceipt(terminal({ completion_evidence: { kind: 'job-finished', observation_digest: D('6') } })), /completion_evidence\.kind must be one of/)
  assert.throws(() => validateTerminalReceipt(terminal({ catalog_verification: { outcome: 'verified', digest: D('5'), rows: [] } })), /unknown field rows/)
  assert.doesNotThrow(() => validateReportingComplete(reporting()))
  assert.throws(() => validateReportingComplete(reporting({ report_artifacts: [{ name: 'x', artifact_id: 'abc', sha256: D('1') }] })), /artifact id is malformed/)

  // Only verified+verified releases after a write; negative/unknown is diagnostic.
  assert.equal(isReleasableTerminal(terminal()), true)
  assert.equal(isReleasableTerminal(terminal({ command: { exit_code: 1, result: 'failed' } })), false)
  assert.equal(isReleasableTerminal(terminal({ command: { exit_code: 0, result: 'unknown' } })), false)
  assert.equal(isReleasableTerminal(terminal({ catalog_verification: { outcome: 'unknown', digest: D('5') } })), false)
  // success_receipt_does_not_authorize_backend_takeover
  assert.equal(authorizesBackendTakeover(terminal()), false)
  assert.equal(authorizesBackendTakeover(terminal({ completion_evidence: { kind: 'qualified-backend-termination', observation_digest: D('6') } })), true)
})

// --- TRANSPORT ------------------------------------------------------------------

test('dry run creates no refs or commits; a real publish is create-only with exact readback', () => {
  const io = memoryTransport()
  const dry = publishEvidence(prepared(), io, { dryRun: true })
  assert.equal(dry.published, false)
  assert.equal(dry.dryRun, true)
  assert.deepEqual(io.calls, [])
  assert.equal(io.refs.size, 0)

  const first = publishEvidence(prepared(), io)
  assert.equal(first.published, true)
  assert.equal(io.refs.get(first.ref), first.sha)
  assert.equal(parseEvidenceMessage(io.readCommitMessage(first.sha)).digest, first.digest)
  // Same payload again: idempotent, no second commit.
  const commitsBefore = io.commits.size
  const again = publishEvidence(prepared(), io)
  assert.equal(again.idempotent, true)
  assert.equal(again.sha, first.sha)
  assert.equal(io.commits.size, commitsBefore)
  // Changed payload at the same ref: refused, never overwritten.
  assert.throws(() => publishEvidence(prepared({ created_at: '2026-10-21T12:00:01Z' }), io), /changed payload refused/)
  assert.equal(io.refs.get(first.ref), first.sha)
})

test('receipt I/O is bounded to three attempts and ninety seconds, and exhaustion names the unresolved state', () => {
  assert.equal(RECEIPT_IO_MAX_ATTEMPTS, 3)
  assert.equal(RECEIPT_IO_DEADLINE_MS, 90_000)
  const io = memoryTransport()
  let creates = 0
  io.createRef = () => { creates++; const error = new Error('502'); error.transientTransport = true; throw error }
  assert.throws(() => publishEvidence(writeIntent(), io), /unresolved after 3 attempts/)
  assert.equal(creates, 3)
  // The deadline, not the attempt count, can also stop retries.
  const slow = memoryTransport(); let t = 0; let slowCreates = 0
  slow.createRef = () => { slowCreates++; t += 60_000; const error = new Error('timeout'); error.transientTransport = true; throw error }
  assert.throws(() => publishEvidence(writeIntent(), slow, { now: () => t }), /unresolved/)
  assert.equal(slowCreates, 2)
  // A readback that does not return our commit is not a proven publication.
  const bad = memoryTransport()
  bad.createRef = (ref) => { bad.refs.set(ref, H('9')); return true }
  assert.throws(() => publishEvidence(writeIntent(), bad), /did not read back/)
  // An incomplete adapter refuses before doing anything.
  assert.throws(() => publishEvidence(writeIntent(), { makeOwnerCommit() {} }), /adapter is incomplete/)
})

// --- CLEANUP DECISION TABLE (§8.1 C) ----------------------------------------------

test('the cleanup decision table covers every boundary and never releases on ambiguity', () => {
  const base = { lease: 'own-generation', write_intents: 0, writer: 'none-proven', apply_result: 'not-applicable', terminal_receipt: 'absent', mandatory_verification_passed: false, reporting_complete: false, own_release_proved: false, restoration_failed: false }
  const d = (over) => decideCleanup({ ...base, ...over })
  assert.equal(d({ lease: 'none' }).action, CLEANUP_ACTIONS.NONE)
  assert.equal(d({}).action, CLEANUP_ACTIONS.RELEASE_OWNER_QUALIFIED)
  assert.equal(d({ writer: 'unknown' }).action, CLEANUP_ACTIONS.RETAIN_QUARANTINE)
  assert.equal(d({ write_intents: 1, writer: 'live' }).action, CLEANUP_ACTIONS.RETAIN_QUARANTINE)
  assert.equal(d({ write_intents: 1, writer: 'unknown' }).action, CLEANUP_ACTIONS.RETAIN_QUARANTINE)
  assert.equal(d({ write_intents: 1, writer: 'none-proven' }).action, CLEANUP_ACTIONS.RETAIN_QUARANTINE)
  assert.equal(d({ write_intents: 1, writer: 'terminated', apply_result: 'failed' }).action, CLEANUP_ACTIONS.RETAIN_RECONCILIATION_ROUTE)
  assert.equal(d({ write_intents: 1, writer: 'terminated', apply_result: 'ambiguous' }).action, CLEANUP_ACTIONS.RETAIN_RECONCILIATION_ROUTE)
  assert.equal(d({ write_intents: 1, writer: 'terminated', apply_result: 'verified', mandatory_verification_passed: true, terminal_receipt: 'absent' }).action, CLEANUP_ACTIONS.RETAIN_BOUNDED_RECEIPT_RETRY)
  assert.equal(d({ write_intents: 1, writer: 'terminated', apply_result: 'verified', mandatory_verification_passed: true, terminal_receipt: 'unreadable' }).action, CLEANUP_ACTIONS.RETAIN_BOUNDED_RECEIPT_RETRY)
  const verified = d({ write_intents: 1, writer: 'terminated', apply_result: 'verified', mandatory_verification_passed: true, terminal_receipt: 'verified' })
  assert.equal(verified.action, CLEANUP_ACTIONS.RELEASE_EXACT_GENERATION)
  assert.match(verified.reason, /reporting obligation only/)
  assert.equal(verified.releases_lease, true)
  assert.equal(d({ write_intents: 1, writer: 'terminated', apply_result: 'verified', mandatory_verification_passed: true, terminal_receipt: 'negative' }).action, CLEANUP_ACTIONS.RETAIN_QUARANTINE)
  assert.equal(d({ write_intents: 1, writer: 'terminated', apply_result: 'verified', mandatory_verification_passed: false, terminal_receipt: 'absent' }).action, CLEANUP_ACTIONS.RETAIN_QUARANTINE)
  assert.equal(d({ lease: 'absent-after-own-release', own_release_proved: true }).action, CLEANUP_ACTIONS.IDEMPOTENT_COMPLETE)
  assert.equal(d({ lease: 'absent-after-own-release', own_release_proved: false }).action, CLEANUP_ACTIONS.REFUSE_STALE_CLEANUP)
  assert.equal(d({ lease: 'absent-after-own-release', own_release_proved: true, terminal_receipt: 'verified', reporting_complete: false }).action, CLEANUP_ACTIONS.PRESERVE_EVIDENCE_REPORTING_OBLIGATION)
  assert.equal(d({ lease: 'successor-or-other-generation', write_intents: 1, writer: 'terminated', apply_result: 'verified', terminal_receipt: 'verified' }).action, CLEANUP_ACTIONS.REFUSE_STALE_CLEANUP)
  assert.equal(d({ restoration_failed: true }).action, CLEANUP_ACTIONS.RETRYABLE_RESTORATION_OBLIGATION)
  assert.throws(() => decideCleanup({ ...base, writer: 'probably-dead' }), /writer state is unknown/)
  assert.throws(() => decideCleanup({ ...base, extra: 1 }), /unknown field/)
  // Only the two release rows release; every other row retains.
  const releasing = Object.values(CLEANUP_ACTIONS).filter((action) => [CLEANUP_ACTIONS.RELEASE_OWNER_QUALIFIED, CLEANUP_ACTIONS.RELEASE_EXACT_GENERATION].includes(action))
  assert.equal(releasing.length, 2)
})
