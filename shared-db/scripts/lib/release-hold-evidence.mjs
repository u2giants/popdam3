// Bounded release-hold evidence contracts (issue #3779, plan step 2, §8.1 A–C).
//
// WHAT THIS IS. The strict, versioned schemas for the four operation-evidence
// records a stage holder publishes while it holds an exclusive lease:
//
//   prepared            after acquisition, before the first mutating command
//   write-intent-N      create-only, BEFORE each actual write is launched
//   terminal            after the mandatory post-write verification
//   reporting-complete  after the verbose report upload
//
// plus the pure cleanup decision table (§8.1 C) that says what a cancellation or
// failure boundary may do with the lease, and the deletion-selector guard that
// keeps `refs/db-release-evidence/*` out of every janitor.
//
// WHAT THIS IS NOT. Nothing here grants write authority, review authority or
// apply authority. The existing stage lease (`scripts/lib/exclusive-lease.mjs`,
// `acquireExclusive` / `releaseExclusive` / `recoverExclusive`) remains the sole
// mutation exclusion. A consumer that finds an evidence ref has found evidence of
// an operation, never permission to perform one. There is no receipt service: the
// transport is the existing owner-commit + create-only ref + readback machinery,
// supplied by the caller through the same `io` adapter the lane manager uses.
//
// DRY RUN NEVER CREATES REFS. `publishEvidence` with `dryRun: true` validates,
// hashes and returns what it WOULD publish without touching the adapter at all.

import { canonicalJson, sha256 } from '../db-flow/evidence-bundle.mjs'

export class ReleaseEvidenceError extends Error {}

export const RELEASE_EVIDENCE_SCHEMA_VERSION = 1
export const RELEASE_EVIDENCE_REF_PREFIX = 'refs/db-release-evidence'
export const RELEASE_EVIDENCE_COMMIT_PREFIX = 'db-release-evidence'
export const RELEASE_EVIDENCE_STAGES = Object.freeze(['preview', 'preview-recovery', 'preview-rehearsal', 'merge', 'production'])
export const RELEASE_EVIDENCE_RECORD_KINDS = Object.freeze(['prepared', 'write-intent', 'terminal', 'reporting-complete'])
// Receipt I/O is bounded to three attempts and 90 seconds TOTAL (§8.1 A). This
// bounds retries of the evidence write, never lock lifetime or SQL execution.
export const RECEIPT_IO_MAX_ATTEMPTS = 3
export const RECEIPT_IO_DEADLINE_MS = 90 * 1000

// The two completion-evidence kinds are deliberately distinct (§8.1 A): an
// ordinary success proves "launched command exited and post-state verified";
// only a qualified backend termination observation may ever feed a takeover.
export const COMPLETION_EVIDENCE_KINDS = Object.freeze(['launched-command-exit', 'qualified-backend-termination'])
export const COMMAND_KINDS = Object.freeze(['supabase-db-push', 'atomic-apply', 'ledger-reconciliation', 'protected-merge'])
export const TERMINAL_RESULTS = Object.freeze(['verified', 'failed', 'unknown'])

const SHA40 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const MIGRATION_PATH = /^supabase\/migrations\/(\d{14})_[A-Za-z0-9_.-]+\.sql$/
const MIGRATION_VERSION = /^\d{14}$/
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/
const MAX_STRING = 4096
// Cheap tripwire against the one thing §8.1 A forbids in evidence: credentials.
// Unknown fields are already refused, so this only has to catch a secret pasted
// into a legitimate string field.
const SECRET_SHAPES = [/\bghp_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\bsbp_[a-f0-9]{20,}/, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /\bpostgres(?:ql)?:\/\/[^\s]*:[^\s@]+@/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/]

function fail(message) { throw new ReleaseEvidenceError(message) }

/** Strict canonical positive integer: a JSON number, integral, > 0, no string forms. */
export function parsePositiveInt(value, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive integer`)
  return value
}

function requireString(value, label, pattern) {
  if (typeof value !== 'string' || !value) fail(`${label} is required`)
  if (value.length > MAX_STRING) fail(`${label} is too long`)
  if (pattern && !pattern.test(value)) fail(`${label} is malformed`)
  return value
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label} has unknown field ${key}`)
  for (const key of keys) if (!(key in value)) fail(`${label} is missing ${key}`)
}

function assertNoSecrets(value, label) {
  if (typeof value === 'string') { for (const shape of SECRET_SHAPES) if (shape.test(value)) fail(`${label} contains a credential-shaped value; evidence may not carry secrets`) ; return }
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoSecrets(item, `${label}[${index}]`)); return }
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) assertNoSecrets(item, `${label}.${key}`)
}

// --- REF NAMES --------------------------------------------------------------
//
// refs/db-release-evidence/<stage>/<request-id>-g<generation>/<record>
// Stage is an allowlist, request id a UUID, generation a positive integer and the
// record one of the four kinds (write-intent carries its ordinal).

export function evidenceRef({ stage, requestId, generation, record, ordinal }) {
  if (!RELEASE_EVIDENCE_STAGES.includes(stage)) fail(`stage must be one of ${RELEASE_EVIDENCE_STAGES.join(', ')}`)
  requireString(requestId, 'request id', UUID)
  parsePositiveInt(generation, 'generation')
  if (!RELEASE_EVIDENCE_RECORD_KINDS.includes(record)) fail(`record must be one of ${RELEASE_EVIDENCE_RECORD_KINDS.join(', ')}`)
  let leaf = record
  if (record === 'write-intent') leaf = `write-intent-${parsePositiveInt(ordinal, 'write-intent ordinal')}`
  else if (ordinal !== undefined) fail(`${record} records carry no ordinal`)
  return `${RELEASE_EVIDENCE_REF_PREFIX}/${stage}/${requestId}-g${generation}/${leaf}`
}

export function parseEvidenceRef(ref) {
  const match = /^refs\/db-release-evidence\/([a-z-]+)\/([0-9a-f-]{36})-g([1-9][0-9]{0,9})\/(prepared|write-intent-([1-9][0-9]{0,6})|terminal|reporting-complete)$/.exec(String(ref ?? ''))
  if (!match) fail(`not a release-evidence ref: ${ref}`)
  const [, stage, requestId, generationText, leaf, ordinalText] = match
  if (!RELEASE_EVIDENCE_STAGES.includes(stage)) fail(`release-evidence ref names unknown stage ${stage}`)
  if (!UUID.test(requestId)) fail('release-evidence ref request id is not a UUID')
  const generation = Number(generationText)
  if (!Number.isSafeInteger(generation)) fail('release-evidence ref generation is not a safe integer')
  const record = leaf.startsWith('write-intent-') ? 'write-intent' : leaf
  return { stage, requestId, generation, record, ...(record === 'write-intent' ? { ordinal: Number(ordinalText) } : {}) }
}

/** True when a ref lives in the audit namespace no janitor may delete. */
export function isReleaseEvidenceRef(ref) {
  return typeof ref === 'string' && (ref === RELEASE_EVIDENCE_REF_PREFIX || ref.startsWith(`${RELEASE_EVIDENCE_REF_PREFIX}/`))
}

/**
 * Deletion-selector guard (§8.1 A). Every ref deletion primitive calls this
 * before deleting. Evidence refs are retained until a separately reviewed
 * retention policy exists; freeze TTL expiry, lease cleanup and pruning never
 * reach them. Also refuses a pattern or prefix that would sweep the namespace.
 */
export function assertRefDeletable(ref) {
  const text = String(ref ?? '')
  if (!text) fail('refusing to delete an unnamed ref')
  if (isReleaseEvidenceRef(text)) fail(`refusing to delete ${text}: ${RELEASE_EVIDENCE_REF_PREFIX}/* is immutable audit evidence and is never pruned`)
  if (/[*?[]/.test(text) && (`${RELEASE_EVIDENCE_REF_PREFIX}/`.startsWith(text.replace(/[*?[].*$/, '')) || text.replace(/[*?[].*$/, '').startsWith(RELEASE_EVIDENCE_REF_PREFIX))) {
    fail(`refusing deletion selector ${text}: it would sweep ${RELEASE_EVIDENCE_REF_PREFIX}/*`)
  }
  return text
}

// --- IDENTITY SHARED BY EVERY RECORD ----------------------------------------

const IDENTITY_KEYS = ['repository', 'stage', 'request_id', 'generation', 'holder_id', 'source', 'target', 'producer']
const SOURCE_KEYS = ['pr', 'head_sha', 'base_sha']
const TARGET_KEYS = ['identifier']
const PRODUCER_KEYS = ['workflow', 'run_id', 'run_attempt']

function validateIdentity(doc, label) {
  requireString(doc.repository, `${label} repository`, REPOSITORY)
  if (!RELEASE_EVIDENCE_STAGES.includes(doc.stage)) fail(`${label} stage must be one of ${RELEASE_EVIDENCE_STAGES.join(', ')}`)
  requireString(doc.request_id, `${label} request_id`, UUID)
  parsePositiveInt(doc.generation, `${label} generation`)
  requireString(doc.holder_id, `${label} holder_id`, SAFE_NAME)
  assertExactKeys(doc.source, SOURCE_KEYS, `${label} source`)
  if (doc.source.pr !== null) parsePositiveInt(doc.source.pr, `${label} source.pr`)
  requireString(doc.source.head_sha, `${label} source.head_sha`, SHA40)
  requireString(doc.source.base_sha, `${label} source.base_sha`, SHA40)
  assertExactKeys(doc.target, TARGET_KEYS, `${label} target`)
  requireString(doc.target.identifier, `${label} target.identifier`, SAFE_NAME)
  assertExactKeys(doc.producer, PRODUCER_KEYS, `${label} producer`)
  requireString(doc.producer.workflow, `${label} producer.workflow`, /^\.github\/workflows\/[A-Za-z0-9_.-]+\.yml$/)
  requireString(doc.producer.run_id, `${label} producer.run_id`, /^[1-9][0-9]{0,18}$/)
  requireString(doc.producer.run_attempt, `${label} producer.run_attempt`, /^[1-9][0-9]{0,3}$/)
}

function validateDigestMap(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object of name -> sha256`)
  const names = Object.keys(value)
  if (!names.length) fail(`${label} must name at least one digest`)
  for (const name of names) { requireString(name, `${label} name`, SAFE_NAME); requireString(value[name], `${label}.${name}`, SHA256) }
}

function validateLedger(value, label) {
  assertExactKeys(value, ['versions', 'sha256'], label)
  if (!Array.isArray(value.versions)) fail(`${label}.versions must be an array`)
  const versions = value.versions.map((version) => requireString(version, `${label}.versions entry`, MIGRATION_VERSION))
  for (let index = 1; index < versions.length; index++) if (versions[index] <= versions[index - 1]) fail(`${label}.versions must be strictly ascending`)
  requireString(value.sha256, `${label}.sha256`, SHA256)
  if (value.sha256 !== ledgerDigest(versions)) fail(`${label}.sha256 does not match its versions`)
}

/** The ledger inventory digest everybody computes the same way. */
export function ledgerDigest(versions) { return sha256(canonicalJson([...versions])) }

function validateMigrations(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  let previous = ''
  for (const [index, row] of value.entries()) {
    const rowLabel = `${label}[${index}]`
    assertExactKeys(row, ['version', 'path', 'sha256'], rowLabel)
    requireString(row.version, `${rowLabel}.version`, MIGRATION_VERSION)
    requireString(row.path, `${rowLabel}.path`)
    // Path safety: relative, inside supabase/migrations, no traversal, no
    // backslashes, and the filename version must equal the declared version.
    if (row.path.includes('..') || row.path.includes('\\') || row.path.startsWith('/')) fail(`${rowLabel}.path is unsafe`)
    const match = MIGRATION_PATH.exec(row.path)
    if (!match) fail(`${rowLabel}.path is not a versioned migration path`)
    if (match[1] !== row.version) fail(`${rowLabel}.path version does not match ${rowLabel}.version`)
    requireString(row.sha256, `${rowLabel}.sha256`, SHA256)
    if (row.version <= previous) fail(`${label} must be strictly ascending by version`)
    previous = row.version
  }
}

function validateChecks(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  for (const [index, row] of value.entries()) {
    assertExactKeys(row, ['name', 'result', 'digest'], `${label}[${index}]`)
    requireString(row.name, `${label}[${index}].name`, SAFE_NAME)
    if (!['pass', 'fail'].includes(row.result)) fail(`${label}[${index}].result must be pass or fail`)
    requireString(row.digest, `${label}[${index}].digest`, SHA256)
  }
}

// --- RECORD SCHEMAS ---------------------------------------------------------

const PREPARED_KEYS = ['schema_version', 'kind', ...IDENTITY_KEYS, 'policy_digests', 'migrations', 'ledger_before', 'allowed_operations', 'approvals', 'prepared_checks', 'created_at']
const WRITE_INTENT_KEYS = ['schema_version', 'kind', ...IDENTITY_KEYS, 'ordinal', 'command_kind', 'manifest_digest', 'prepared_ref_sha', 'created_at']
const TERMINAL_KEYS = ['schema_version', 'kind', ...IDENTITY_KEYS, 'prepared_ref_sha', 'write_intent_ref_shas', 'command', 'ledger_after', 'applied_migrations', 'catalog_verification', 'completion_evidence', 'checks', 'created_at']
const REPORTING_KEYS = ['schema_version', 'kind', ...IDENTITY_KEYS, 'terminal_ref_sha', 'report_artifacts', 'created_at']

function validateHeader(doc, kind, keys) {
  assertExactKeys(doc, keys, `${kind} record`)
  // Secrets are refused before any other field check so the refusal names the
  // real problem rather than a format mismatch.
  assertNoSecrets(doc, kind)
  if (doc.schema_version !== RELEASE_EVIDENCE_SCHEMA_VERSION) fail(`${kind} record schema_version must be ${RELEASE_EVIDENCE_SCHEMA_VERSION}`)
  if (doc.kind !== kind) fail(`record kind must be ${kind}`)
  validateIdentity(doc, kind)
  requireString(doc.created_at, `${kind} created_at`, ISO_TIME)
}

/** The prepared receipt: binds everything the writer will act on. Grants nothing. */
export function validatePreparedReceipt(doc) {
  validateHeader(doc, 'prepared', PREPARED_KEYS)
  validateDigestMap(doc.policy_digests, 'prepared policy_digests')
  validateMigrations(doc.migrations, 'prepared migrations')
  validateLedger(doc.ledger_before, 'prepared ledger_before')
  if (!Array.isArray(doc.allowed_operations) || !doc.allowed_operations.length) fail('prepared allowed_operations must name at least one bounded operation')
  for (const op of doc.allowed_operations) if (!COMMAND_KINDS.includes(op)) fail(`prepared allowed_operations has unknown operation ${op}`)
  if (!Array.isArray(doc.approvals)) fail('prepared approvals must be an array')
  for (const approval of doc.approvals) requireString(approval, 'prepared approvals entry', /^refs\/db-review-verdict[A-Za-z0-9_./-]*$/)
  validateChecks(doc.prepared_checks, 'prepared prepared_checks')
  // A migration the prepared ledger already lists cannot be "applied" again.
  const before = new Set(doc.ledger_before.versions)
  for (const row of doc.migrations) if (before.has(row.version)) fail(`prepared migration ${row.version} is already in ledger_before`)
  return Object.freeze(doc)
}

/** A create-only write-intent, published BEFORE the write it names is launched. */
export function validateWriteIntent(doc) {
  validateHeader(doc, 'write-intent', WRITE_INTENT_KEYS)
  parsePositiveInt(doc.ordinal, 'write-intent ordinal')
  if (!COMMAND_KINDS.includes(doc.command_kind)) fail(`write-intent command_kind must be one of ${COMMAND_KINDS.join(', ')}`)
  requireString(doc.manifest_digest, 'write-intent manifest_digest', SHA256)
  requireString(doc.prepared_ref_sha, 'write-intent prepared_ref_sha', SHA40)
  return Object.freeze(doc)
}

/** The terminal receipt. Only `verified` with a verified catalog is releasable after a write. */
export function validateTerminalReceipt(doc) {
  validateHeader(doc, 'terminal', TERMINAL_KEYS)
  requireString(doc.prepared_ref_sha, 'terminal prepared_ref_sha', SHA40)
  if (!Array.isArray(doc.write_intent_ref_shas)) fail('terminal write_intent_ref_shas must be an array')
  for (const sha of doc.write_intent_ref_shas) requireString(sha, 'terminal write_intent_ref_shas entry', SHA40)
  assertExactKeys(doc.command, ['exit_code', 'result'], 'terminal command')
  if (!Number.isSafeInteger(doc.command.exit_code) || doc.command.exit_code < 0) fail('terminal command.exit_code must be a non-negative integer')
  if (!TERMINAL_RESULTS.includes(doc.command.result)) fail(`terminal command.result must be one of ${TERMINAL_RESULTS.join(', ')}`)
  validateLedger(doc.ledger_after, 'terminal ledger_after')
  validateMigrations(doc.applied_migrations, 'terminal applied_migrations')
  assertExactKeys(doc.catalog_verification, ['outcome', 'digest'], 'terminal catalog_verification')
  if (!TERMINAL_RESULTS.includes(doc.catalog_verification.outcome)) fail('terminal catalog_verification.outcome must be verified, failed or unknown')
  requireString(doc.catalog_verification.digest, 'terminal catalog_verification.digest', SHA256)
  assertExactKeys(doc.completion_evidence, ['kind', 'observation_digest'], 'terminal completion_evidence')
  if (!COMPLETION_EVIDENCE_KINDS.includes(doc.completion_evidence.kind)) fail(`terminal completion_evidence.kind must be one of ${COMPLETION_EVIDENCE_KINDS.join(', ')}`)
  requireString(doc.completion_evidence.observation_digest, 'terminal completion_evidence.observation_digest', SHA256)
  validateChecks(doc.checks, 'terminal checks')
  // A verified result must show every applied migration in the post ledger, and
  // a zero exit cannot be paired with a failed result (or vice versa) silently.
  if (doc.command.result === 'verified') {
    if (doc.command.exit_code !== 0) fail('terminal result verified requires exit_code 0')
    const after = new Set(doc.ledger_after.versions)
    for (const row of doc.applied_migrations) if (!after.has(row.version)) fail(`terminal applied migration ${row.version} is missing from ledger_after`)
  }
  return Object.freeze(doc)
}

export function validateReportingComplete(doc) {
  validateHeader(doc, 'reporting-complete', REPORTING_KEYS)
  requireString(doc.terminal_ref_sha, 'reporting-complete terminal_ref_sha', SHA40)
  if (!Array.isArray(doc.report_artifacts)) fail('reporting-complete report_artifacts must be an array')
  for (const [index, row] of doc.report_artifacts.entries()) {
    assertExactKeys(row, ['name', 'artifact_id', 'sha256'], `reporting-complete report_artifacts[${index}]`)
    requireString(row.name, 'report artifact name', SAFE_NAME)
    requireString(row.artifact_id, 'report artifact id', /^[1-9][0-9]{0,18}$/)
    requireString(row.sha256, 'report artifact sha256', SHA256)
  }
  return Object.freeze(doc)
}

const VALIDATORS = Object.freeze({ prepared: validatePreparedReceipt, 'write-intent': validateWriteIntent, terminal: validateTerminalReceipt, 'reporting-complete': validateReportingComplete })

export function validateEvidenceRecord(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail('evidence record must be an object')
  const validator = VALIDATORS[doc.kind]
  if (!validator) fail(`unknown evidence record kind ${String(doc.kind)}`)
  return validator(doc)
}

/** Canonical digest; the same bytes everybody hashes. */
export function evidenceDigest(doc) { return sha256(canonicalJson(doc)) }

// --- AUTHORITY QUESTIONS (answered conservatively) ---------------------------

/**
 * May the holder release its lease on the strength of this terminal receipt?
 * Only a verified command result with a verified catalog outcome. Negative and
 * unknown results are diagnostic, never release authority (§8.1 A).
 */
export function isReleasableTerminal(receipt) {
  const doc = validateTerminalReceipt(receipt)
  return doc.command.result === 'verified' && doc.catalog_verification.outcome === 'verified'
}

/**
 * May this receipt feed a generation takeover? NEVER for an ordinary success
 * receipt: `launched-command-exit` proves the holder's own command exited, not
 * that a foreign backend died. Only an 8c-qualified backend termination
 * observation answers that question, and even then the manager still re-proves
 * run/attempt/lease state under the mutex.
 */
export function authorizesBackendTakeover(receipt) {
  const doc = validateTerminalReceipt(receipt)
  return doc.completion_evidence.kind === 'qualified-backend-termination'
}

// --- CONSUMER BINDING ---------------------------------------------------------

const BOUND_FIELDS = Object.freeze([
  ['repository', (doc) => doc.repository],
  ['stage', (doc) => doc.stage],
  ['request_id', (doc) => doc.request_id],
  ['generation', (doc) => doc.generation],
  ['holder_id', (doc) => doc.holder_id],
  ['source.pr', (doc) => doc.source.pr],
  ['source.head_sha', (doc) => doc.source.head_sha],
  ['source.base_sha', (doc) => doc.source.base_sha],
  ['target.identifier', (doc) => doc.target.identifier],
  ['producer.workflow', (doc) => doc.producer.workflow],
  ['producer.run_id', (doc) => doc.producer.run_id],
  ['producer.run_attempt', (doc) => doc.producer.run_attempt],
])

/**
 * Bind a record to the identity the consumer ALREADY holds (its own acquired
 * lease, its own run, its own source and target). Every mismatch refuses and
 * names the field. `expected` carries the same shape as the record identity;
 * an expected value of `undefined` is a consumer bug and refuses too, because an
 * unchecked field is how a cross-run artifact slips through.
 */
export function bindEvidenceIdentity(record, expected) {
  const doc = validateEvidenceRecord(record)
  if (!expected || typeof expected !== 'object') fail('consumer identity is required to bind evidence')
  for (const [name, read] of BOUND_FIELDS) {
    let want
    try { want = read(expected) } catch { want = undefined }
    if (want === undefined) fail(`consumer identity does not state ${name}; refusing to bind unchecked evidence`)
    const have = read(doc)
    if (have !== want) fail(`evidence ${name} is ${JSON.stringify(have)}, this run is ${JSON.stringify(want)}; cross-run evidence refused`)
  }
  return doc
}

/**
 * Verify a record read back from its ref: the commit message must carry the
 * canonical bytes, the digest must match, the ref name must match the record's
 * own identity, and the record must bind to the consumer. Tampered bytes,
 * unknown fields or versions, traversal paths and credentials all refuse here.
 */
export function verifyPublishedEvidence({ ref, sha, message }, expected, { expectedDigest } = {}) {
  if (!SHA40.test(String(sha ?? ''))) fail('published evidence sha is malformed')
  const named = parseEvidenceRef(ref)
  const parsed = parseEvidenceMessage(message)
  const doc = bindEvidenceIdentity(parsed.doc, expected)
  if (doc.kind !== named.record || doc.stage !== named.stage || doc.request_id !== named.requestId || doc.generation !== named.generation) fail(`evidence ref ${ref} does not name the record it holds`)
  if (named.record === 'write-intent' && doc.ordinal !== named.ordinal) fail('write-intent ordinal does not match its ref')
  const digest = evidenceDigest(doc)
  if (parsed.digest !== digest) fail('evidence digest line does not match the canonical record bytes')
  if (expectedDigest !== undefined && expectedDigest !== digest) fail('evidence digest differs from the digest this run published')
  return { ref, sha, doc, digest }
}

// --- TRANSPORT: owner commit + create-only ref + readback -------------------

export function formatEvidenceMessage(doc) {
  const record = validateEvidenceRecord(doc)
  const body = canonicalJson(record)
  return [`${RELEASE_EVIDENCE_COMMIT_PREFIX} ${record.kind} ${record.stage} ${record.request_id} g${record.generation}`, '', `digest: ${sha256(body)}`, body].join('\n')
}

export function parseEvidenceMessage(message) {
  if (typeof message !== 'string' || !message.startsWith(`${RELEASE_EVIDENCE_COMMIT_PREFIX} `)) fail('commit message is not a release-evidence record')
  const lines = message.split('\n')
  if (lines[1] !== '' || !lines[2]?.startsWith('digest: ') || lines.length !== 4) fail('release-evidence message shape is unrecognised')
  const digest = lines[2].slice('digest: '.length)
  if (!SHA256.test(digest)) fail('release-evidence digest line is malformed')
  const body = lines[3]
  if (sha256(body) !== digest) fail('release-evidence body bytes do not match the digest line')
  let doc
  try { doc = JSON.parse(body) } catch { fail('release-evidence body is not JSON') }
  if (canonicalJson(doc) !== body) fail('release-evidence body is not canonical JSON')
  return { doc: validateEvidenceRecord(doc), digest }
}

function isTransient(error) { return Boolean(error?.transientTransport) }

/**
 * Publish one record through the caller's adapter:
 *   io.makeOwnerCommit(message) -> sha
 *   io.createRef(ref, sha)      -> true | false (exists)
 *   io.readRef(ref)             -> sha | null
 *   io.readCommitMessage(sha)   -> message | null
 *
 * Create-only: an existing ref with the SAME canonical digest is an idempotent
 * retry and succeeds; an existing ref with a different digest refuses and names
 * both digests (changed payload = investigate, never overwrite). Readback must
 * return the exact commit and canonical digest or the publish is not proven.
 * At most three attempts / 90 seconds total; exhaustion returns the exact
 * unresolved state as an error so the caller retains protection.
 */
export function publishEvidence(doc, io, { dryRun = false, now = () => Date.now(), attempts = RECEIPT_IO_MAX_ATTEMPTS, deadlineMs = RECEIPT_IO_DEADLINE_MS } = {}) {
  const record = validateEvidenceRecord(doc)
  const ref = evidenceRef({ stage: record.stage, requestId: record.request_id, generation: record.generation, record: record.kind, ...(record.kind === 'write-intent' ? { ordinal: record.ordinal } : {}) })
  const message = formatEvidenceMessage(record)
  const digest = evidenceDigest(record)
  if (dryRun) return { dryRun: true, published: false, ref, digest, sha: null }
  if (!io || typeof io.makeOwnerCommit !== 'function' || typeof io.createRef !== 'function' || typeof io.readRef !== 'function' || typeof io.readCommitMessage !== 'function') fail('evidence transport adapter is incomplete')
  const started = now()
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (now() - started > deadlineMs) break
    try {
      const existing = io.readRef(ref)
      if (existing !== null) return verifyExisting(existing, 'already published')
      const sha = io.makeOwnerCommit(message)
      if (!SHA40.test(String(sha ?? ''))) fail('evidence commit sha is malformed')
      const created = io.createRef(ref, sha)
      if (created !== true) {
        const after = io.readRef(ref)
        if (after === null) fail(`${ref} create reported existing but reads back absent; unresolved`)
        return verifyExisting(after, 'created concurrently')
      }
      const readBack = io.readRef(ref)
      if (readBack !== sha) fail(`${ref} did not read back as ${sha} (read ${readBack ?? 'absent'}); publication is not proven`)
      const stored = io.readCommitMessage(sha)
      const parsed = parseEvidenceMessage(stored)
      if (parsed.digest !== digest) fail(`${ref} read back digest ${parsed.digest}, published ${digest}`)
      return { dryRun: false, published: true, ref, sha, digest, attempts: attempt }
    } catch (error) {
      if (error instanceof ReleaseEvidenceError && !isTransient(error)) throw error
      lastError = error
      if (attempt === attempts) break
    }
  }
  throw new ReleaseEvidenceError(`${ref} publication unresolved after ${attempts} attempts / ${deadlineMs}ms: ${String(lastError?.message ?? lastError ?? 'deadline exhausted').split('\n')[0]}; retain the lease, do not retry blindly`)

  function verifyExisting(sha, how) {
    const stored = io.readCommitMessage(sha)
    if (!stored) fail(`${ref} exists at ${sha} (${how}) but its commit is unreadable; unresolved`)
    const parsed = parseEvidenceMessage(stored)
    if (parsed.digest !== digest) fail(`${ref} already holds digest ${parsed.digest}, this run would publish ${digest}; changed payload refused, investigate`)
    return { dryRun: false, published: true, idempotent: true, ref, sha, digest }
  }
}

// --- CLEANUP DECISION TABLE (§8.1 C) ------------------------------------------
//
// A pure function of what the cleanup step observed, RE-PROVEN UNDER CURRENT
// OWNERSHIP. Every row of the table is an explicit case; anything else refuses by
// retaining the lease.

export const CLEANUP_ACTIONS = Object.freeze({
  NONE: 'none',
  RELEASE_OWNER_QUALIFIED: 'release-owner-qualified-and-clear-own-revocations',
  RETAIN_QUARANTINE: 'retain-exact-lease-quarantine',
  RETAIN_RECONCILIATION_ROUTE: 'retain-lease-use-named-reconciliation-route',
  RETAIN_BOUNDED_RECEIPT_RETRY: 'retain-lease-bounded-receipt-retry',
  RELEASE_EXACT_GENERATION: 'release-exact-owner-generation-with-readback',
  IDEMPOTENT_COMPLETE: 'idempotent-complete-do-not-touch-successor',
  REFUSE_STALE_CLEANUP: 'refuse-stale-cleanup-never-touch-successor',
  PRESERVE_EVIDENCE_REPORTING_OBLIGATION: 'preserve-terminal-evidence-open-reporting-obligation',
  RETRYABLE_RESTORATION_OBLIGATION: 'retryable-status-restoration-obligation-pending-only',
})

const LEASE_STATES = ['none', 'own-generation', 'absent-after-own-release', 'successor-or-other-generation']
const WRITER_STATES = ['none-proven', 'live', 'unknown', 'terminated']
const APPLY_RESULTS = ['not-applicable', 'verified', 'failed', 'ambiguous']
const TERMINAL_STATES = ['absent', 'unreadable', 'verified', 'negative']

export function decideCleanup(observation) {
  assertExactKeys(observation, ['lease', 'write_intents', 'writer', 'apply_result', 'terminal_receipt', 'mandatory_verification_passed', 'reporting_complete', 'own_release_proved', 'restoration_failed'], 'cleanup observation')
  const o = observation
  if (!LEASE_STATES.includes(o.lease)) fail('cleanup observation lease state is unknown')
  if (!Number.isSafeInteger(o.write_intents) || o.write_intents < 0) fail('cleanup observation write_intents must be a non-negative integer')
  if (!WRITER_STATES.includes(o.writer)) fail('cleanup observation writer state is unknown')
  if (!APPLY_RESULTS.includes(o.apply_result)) fail('cleanup observation apply_result is unknown')
  if (!TERMINAL_STATES.includes(o.terminal_receipt)) fail('cleanup observation terminal_receipt is unknown')
  for (const flag of ['mandatory_verification_passed', 'reporting_complete', 'own_release_proved', 'restoration_failed']) if (typeof o[flag] !== 'boolean') fail(`cleanup observation ${flag} must be boolean`)

  // Row: no lease acquired -> nothing of anyone else's may be touched.
  if (o.lease === 'none') return decision(CLEANUP_ACTIONS.NONE, 'no lease was acquired; no release and no restoration of another run\'s statuses')
  // Row: ref now names a successor / other generation -> never delete or restore for it.
  if (o.lease === 'successor-or-other-generation') return decision(CLEANUP_ACTIONS.REFUSE_STALE_CLEANUP, 'the ref names another generation; stale cleanup refused and the successor is untouched')
  // Row: release already absent after our own proved release -> idempotent.
  if (o.lease === 'absent-after-own-release') {
    if (!o.own_release_proved) return decision(CLEANUP_ACTIONS.REFUSE_STALE_CLEANUP, 'the ref is absent but this run never proved its own release; nothing may be touched')
    if (o.terminal_receipt === 'verified' && !o.reporting_complete) return decision(CLEANUP_ACTIONS.PRESERVE_EVIDENCE_REPORTING_OBLIGATION, 'release completed; reporting-complete is missing, so terminal evidence is preserved and a reporting obligation stays open on #3779')
    return decision(CLEANUP_ACTIONS.IDEMPOTENT_COMPLETE, 'this run already released its own lease; completion is idempotent and no successor is touched')
  }
  // From here the lease is this run's own generation.
  if (o.restoration_failed) return decision(CLEANUP_ACTIONS.RETRYABLE_RESTORATION_OBLIGATION, 'freeze status restoration failed; keep an explicit retryable obligation tied to run id/attempt, pending only, never success')
  if (o.write_intents === 0) {
    if (o.writer === 'none-proven') return decision(CLEANUP_ACTIONS.RELEASE_OWNER_QUALIFIED, 'no write-intent and conclusively no launched writer; owner-qualified release, clearing only this run\'s revocations to pending')
    return decision(CLEANUP_ACTIONS.RETAIN_QUARANTINE, `no write-intent but writer state is ${o.writer}; terminal job status alone never proves no writer, so the lease is retained`)
  }
  // Write-intent exists.
  if (o.writer === 'live' || o.writer === 'unknown') return decision(CLEANUP_ACTIONS.RETAIN_QUARANTINE, `write-intent exists and the writer is ${o.writer}; ordinary always-release is never invoked`)
  if (o.writer === 'none-proven') return decision(CLEANUP_ACTIONS.RETAIN_QUARANTINE, 'write-intent exists but no termination observation was collected; retained')
  // Writer terminated.
  if (o.apply_result === 'failed' || o.apply_result === 'ambiguous') return decision(CLEANUP_ACTIONS.RETAIN_RECONCILIATION_ROUTE, `writer terminated but the apply/ledger/catalog result is ${o.apply_result}; lease retained, named reconciliation route, no automatic replay`)
  if (o.terminal_receipt === 'verified') {
    return decision(CLEANUP_ACTIONS.RELEASE_EXACT_GENERATION, o.reporting_complete ? 'verified terminal receipt; release exact owner/generation with readback' : 'verified terminal receipt; release exact owner/generation with readback; incomplete reporting is a reporting obligation only, never a hold')
  }
  if (o.mandatory_verification_passed && (o.terminal_receipt === 'absent' || o.terminal_receipt === 'unreadable')) return decision(CLEANUP_ACTIONS.RETAIN_BOUNDED_RECEIPT_RETRY, 'mandatory verification passed but the terminal receipt is not durably proven; bounded receipt retries, retain the lease until proven, reconstruction route on restart')
  return decision(CLEANUP_ACTIONS.RETAIN_QUARANTINE, `terminal receipt is ${o.terminal_receipt} and verification ${o.mandatory_verification_passed ? 'passed' : 'did not pass'}; nothing here is release authority`)

  function decision(action, reason) { return Object.freeze({ action, reason, releases_lease: action === CLEANUP_ACTIONS.RELEASE_OWNER_QUALIFIED || action === CLEANUP_ACTIONS.RELEASE_EXACT_GENERATION }) }
}
