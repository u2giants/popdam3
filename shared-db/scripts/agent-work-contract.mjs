#!/usr/bin/env node
// Provider-neutral agent work contracts (Step 4, issue #1366).
//
// WHAT THIS IS FOR
// ----------------
// Codex, Claude, and any future coding agent are dispatched with prose. Prose is
// not checkable, so nothing in this repository could answer: what exactly was this
// agent allowed to touch, what did it have to prove, and when should it have
// stopped? "Done" meant "the agent said done".
//
// A work contract is that authority, written down before the agent starts, in one
// format regardless of which provider executes it. A completion report is checked
// against it.
//
// WHERE THE AUTHORITY LIVES: A GIT REF, NOT A COMMENT
// ---------------------------------------------------
// The contract is pinned to `refs/db-contracts/<issue>/<generation>` using
// create-if-absent, the same atomic primitive as claims and the acquisition mutex.
// An issue COMMENT cannot carry authority here:
//
//   * comments are editable and deletable, so a contract can be changed after the
//     fact to match whatever was actually built;
//   * every session in this repository authenticates and commits as the same
//     identity, so a comment saying `dispatcher: X` proves nothing about who wrote
//     it.
//
// The comment is still posted, as a human-readable copy. Validation reads the ref.
//
// WHAT THIS LAYER HONESTLY DOES NOT DO
// ------------------------------------
// Create-if-absent gives ORDERING and NON-OVERWRITE. Under one shared GitHub
// identity it does not prove WHO published. A worker can create
// `refs/db-contracts/<issue>/2` itself; the rule that only a dispatcher does so is
// a convention this code cannot enforce. Restricting publication to a distinct
// workflow token (`github-actions[bot]`) is what would make it forgery-resistant,
// at the cost of moving every dispatch into a workflow run.
//
// Nor does "branch absent or still at base_sha" prove work started after
// publication: an agent can commit locally, publish, then push, and git commit
// timestamps are author-controlled. What the ref pin does buy is that the contract
// cannot be WIDENED or BACKDATED afterwards to match what was built.
//
// Say all of that plainly rather than claiming more.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const REPO = process.env.SHARED_DB_REPO ?? 'u2giants/shared-db'
export const CONTRACT_REF_PREFIX = 'refs/db-contracts'
export const CONTRACT_FENCE = 'db-agent-contract'
export const CONTRACT_SCHEMA_VERSION = 1

export class ContractError extends Error {}

const CONTRACT_REQUIRED = Object.freeze([
  'schema_version', 'work_issue', 'work_type', 'route', 'goal', 'base_sha',
  'dispatcher', 'worker', 'branch', 'worktree', 'allowed_paths', 'file_writes',
  'db_reads', 'db_writes', 'prohibited_actions', 'required_checks', 'assumptions',
  'stop_conditions',
])

const STRING_FIELDS = Object.freeze(['work_type', 'route', 'goal', 'base_sha', 'dispatcher', 'worker', 'branch', 'worktree'])
const LIST_FIELDS = Object.freeze(['allowed_paths', 'file_writes', 'db_reads', 'db_writes', 'prohibited_actions', 'required_checks', 'assumptions', 'stop_conditions'])

const SHA_PATTERN = /^[0-9a-f]{7,40}$/

/**
 * Hand-rolled validation, deliberately — see `scripts/check-handoff-contract.mjs`
 * for the precedent. This repository has no root `package.json`, and a partial
 * JSON-Schema implementation that claims to be draft 2020-12 is worse than an
 * honest bespoke validator whose every rule is a readable sentence.
 */
export function validateContract(contract) {
  if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new ContractError('contract must be a JSON object')
  }
  if (contract.schema_version !== CONTRACT_SCHEMA_VERSION) {
    throw new ContractError(`contract schema_version must be ${CONTRACT_SCHEMA_VERSION}`)
  }
  for (const field of CONTRACT_REQUIRED) {
    if (contract[field] === undefined) throw new ContractError(`contract is missing ${field}`)
  }
  // UNKNOWN KEYS ARE REFUSED. A typo'd field name silently drops a constraint,
  // and a dropped constraint is indistinguishable from one that was never set.
  const known = new Set([...CONTRACT_REQUIRED, 'generation'])
  for (const key of Object.keys(contract)) {
    if (!known.has(key)) throw new ContractError(`contract has unknown field ${key}; a typo silently drops a constraint`)
  }
  if (!Number.isInteger(contract.work_issue) || contract.work_issue <= 0) throw new ContractError('contract work_issue must be a positive issue number')
  for (const field of STRING_FIELDS) {
    if (typeof contract[field] !== 'string' || !contract[field].trim()) throw new ContractError(`contract ${field} must be a non-empty string`)
  }
  if (!SHA_PATTERN.test(contract.base_sha)) throw new ContractError('contract base_sha must be a commit SHA')
  for (const field of LIST_FIELDS) {
    if (!Array.isArray(contract[field])) throw new ContractError(`contract ${field} must be an array (use [] for none)`)
    for (const value of contract[field]) {
      if (typeof value !== 'string' || !value.trim()) throw new ContractError(`contract ${field} must contain non-empty strings`)
    }
  }
  if (contract.generation !== undefined && (!Number.isInteger(contract.generation) || contract.generation <= 0)) {
    throw new ContractError('contract generation must be a positive integer when present')
  }
  if (!contract.allowed_paths.length) throw new ContractError('contract allowed_paths must not be empty; a contract that allows nothing to be edited is not a contract')
  for (const pattern of contract.allowed_paths) assertSafePath(pattern)
  for (const pattern of contract.file_writes) assertSafePath(pattern)
  if (!contract.required_checks.length) throw new ContractError('contract required_checks must name at least one command that proves the work')
  if (!contract.stop_conditions.length) throw new ContractError('contract stop_conditions must say when the worker must stop rather than improvise')

  // A REPO-MAINTENANCE CONTRACT TOUCHES NO DATABASE. Stating that explicitly is
  // what makes a zero-database contract a real constraint and not an exemption.
  if (contract.work_type !== 'structural' && (contract.db_reads.length || contract.db_writes.length)) {
    throw new ContractError(`a ${contract.work_type} contract must declare empty db_reads and db_writes`)
  }
  if (contract.work_type === 'structural' && !contract.db_writes.length) {
    throw new ContractError('a structural contract must declare at least one db_write')
  }
  return contract
}

/**
 * Refuse a path pattern that escapes the repository or is broad enough to include
 * its root. `allowed_paths: ["**"]` is not a scope, it is the absence of one.
 */
export function assertSafePath(pattern) {
  const value = String(pattern)
  if (!value.trim()) throw new ContractError('a path pattern must not be empty')
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) throw new ContractError(`path pattern must be repository-relative: ${value}`)
  if (value.split(/[\\/]/).includes('..')) throw new ContractError(`path pattern must not escape the repository: ${value}`)
  if (['**', '**/*', '*', '.', './'].includes(value.trim())) throw new ContractError(`path pattern ${value} covers the whole repository, which is not a scope`)
  return value
}

/**
 * Canonical JSON: object keys sorted at every level, no incidental whitespace.
 * Two contracts that say the same thing must hash the same, or the hash proves
 * nothing.
 */
export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function contractHash(contract) {
  return createHash('sha256').update(canonicalize(contract)).digest('hex')
}

export function contractRef(issue, generation) {
  if (!Number.isInteger(Number(issue)) || Number(issue) <= 0) throw new ContractError('contract ref needs a positive issue number')
  if (!Number.isInteger(Number(generation)) || Number(generation) <= 0) throw new ContractError('contract ref needs a positive generation')
  return `${CONTRACT_REF_PREFIX}/${Number(issue)}/${Number(generation)}`
}

// --- COMPLETION REPORT -----------------------------------------------------
//
// The report is Step 3's `db-work-completion` record with contract fields added.
// There is deliberately NOT a second completion schema: Steps 3 and 4 originally
// defined two that disagreed about whether `pr` was required, which an owner
// ruling outcome cannot satisfy.

const REPORT_ADDED_REQUIRED = Object.freeze([
  'contract_ref', 'contract_sha256', 'head_sha', 'files_changed', 'db_reads',
  'db_writes', 'checks', 'assumptions_resolved', 'stop_conditions_hit',
])

export function validateCompletionReport(report, { validateCompletionRecord }) {
  // Step 3 owns the base record; this only adds the contract half.
  validateCompletionRecord(stripContractFields(report))
  for (const field of REPORT_ADDED_REQUIRED) {
    if (report[field] === undefined) throw new ContractError(`completion report is missing ${field}`)
  }
  if (typeof report.contract_ref !== 'string' || !report.contract_ref.startsWith(`${CONTRACT_REF_PREFIX}/`)) {
    throw new ContractError(`completion report contract_ref must be a ${CONTRACT_REF_PREFIX}/ ref`)
  }
  if (typeof report.contract_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(report.contract_sha256)) {
    throw new ContractError('completion report contract_sha256 must be a sha256 hex digest')
  }
  if (typeof report.head_sha !== 'string' || !SHA_PATTERN.test(report.head_sha)) throw new ContractError('completion report head_sha must be a commit SHA')
  for (const field of ['files_changed', 'db_reads', 'db_writes', 'assumptions_resolved', 'stop_conditions_hit']) {
    if (!Array.isArray(report[field])) throw new ContractError(`completion report ${field} must be an array`)
  }
  if (!Array.isArray(report.checks)) throw new ContractError('completion report checks must be an array')
  for (const check of report.checks) {
    if (!check || typeof check !== 'object') throw new ContractError('each check must be an object')
    if (typeof check.command !== 'string' || !check.command.trim()) throw new ContractError('each check must name the exact command run')
    if (!Number.isInteger(check.exit_code)) throw new ContractError(`check "${check.command}" must record an integer exit_code`)
    if (typeof check.evidence !== 'string' || !check.evidence.trim()) throw new ContractError(`check "${check.command}" must carry evidence, not just a claim of success`)
  }
  return report
}

function stripContractFields(report) {
  const base = { ...report }
  for (const field of REPORT_ADDED_REQUIRED) delete base[field]
  return base
}

/**
 * The heart of the step: does the report actually satisfy the contract it names?
 *
 * Pure, so every refusal below is exhaustively testable without touching GitHub.
 */
export function reconcileReportWithContract(report, contract, { hash = contractHash } = {}) {
  const problems = []
  if (report.work_issue !== contract.work_issue) problems.push(`report is for issue #${report.work_issue}, contract is for #${contract.work_issue}`)

  const expected = hash(contract)
  if (report.contract_sha256 !== expected) {
    problems.push(`report contract_sha256 ${report.contract_sha256} does not match the published contract (${expected}); the contract was changed after the fact or the report names a different one`)
  }

  // FILES CHANGED MUST BE A SUBSET. A worker that edited something outside its
  // allowed paths did not do the job it was authorised to do, whatever the
  // outcome says.
  const permitted = [...contract.allowed_paths, ...contract.file_writes]
  const outside = report.files_changed.filter((file) => !permitted.some((pattern) => pathMatches(pattern, file)))
  if (outside.length) problems.push(`report changed files outside allowed_paths: ${outside.join(', ')}`)

  // DATABASE SETS MUST NOT WIDEN. Reading or writing something the contract did
  // not declare defeats the whole claim system upstream of it.
  const extraWrites = report.db_writes.filter((object) => !contract.db_writes.includes(object))
  if (extraWrites.length) problems.push(`report writes database objects the contract did not authorise: ${extraWrites.join(', ')}`)
  const extraReads = report.db_reads.filter((object) => !contract.db_reads.includes(object) && !contract.db_writes.includes(object))
  if (extraReads.length) problems.push(`report reads database objects the contract did not declare: ${extraReads.join(', ')}`)

  // EVERY REQUIRED CHECK MUST HAVE RUN AND PASSED.
  for (const required of contract.required_checks) {
    const ran = report.checks.find((check) => check.command === required)
    if (!ran) { problems.push(`required check was never run: ${required}`); continue }
    if (ran.exit_code !== 0) problems.push(`required check failed (exit ${ran.exit_code}): ${required}`)
  }

  // A STOP CONDITION THAT FIRED CANNOT END IN SUCCESS. This is the "reported done
  // anyway" failure the whole contract exists to catch.
  if (report.stop_conditions_hit.length && report.outcome === 'merged') {
    problems.push(`report hit stop conditions [${report.stop_conditions_hit.join(', ')}] but claims outcome merged; a stop condition means the work stopped`)
  }
  return { satisfied: problems.length === 0, problems }
}

/** Glob matching for the small subset of patterns a contract may use. */
export function pathMatches(pattern, file) {
  const normalized = String(file).replace(/\\/g, '/')
  const escaped = String(pattern).replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*\//g, ' SLASHSTAR ')
    .replace(/\*\*/g, ' STARSTAR ')
    .replace(/\*/g, '[^/]*')
    .replace(/ SLASHSTAR /g, '(?:.*/)?')
    .replace(/ STARSTAR /g, '.*')
  return new RegExp(`^${escaped}$`).test(normalized)
}

// --- IO --------------------------------------------------------------------

function gh(args, { executor = execFileSync, input } = {}) {
  const options = { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  // stdin must be a pipe for `input` to reach the child; see the same fix in
  // scripts/update-required-checks.mjs, where naming 'ignore' silently sent an
  // empty request body.
  if (input === undefined) options.stdio = ['ignore', 'pipe', 'pipe']
  else options.input = input
  try {
    return executor('gh', args, options)
  } catch (error) {
    throw new ContractError(`GitHub command failed: ${String(error.stderr ?? '').trim() || String(error.message ?? '').trim()}`)
  }
}

export const contractIo = {
  readRef(ref) {
    try { return JSON.parse(gh(['api', `repos/${REPO}/git/ref/${ref.replace(/^refs\//, '')}`])).object.sha }
    catch (error) { if (/HTTP 404|Not Found/i.test(String(error.message))) return null; throw error }
  },
  createRef(ref, sha) { gh(['api', '-X', 'POST', `repos/${REPO}/git/refs`, '-f', `ref=${ref}`, '-f', `sha=${sha}`]) },
  createBlobCommit(message) {
    // The contract text lives in the commit message of an empty-tree commit, the
    // same shape the coordination refs already use.
    return gh(['api', '-X', 'POST', `repos/${REPO}/git/commits`, '-f', `message=${message}`, '-f', 'tree=4b825dc642cb6eb9a060e54bf8d69288fbee4904']).trim()
  },
  readCommitMessage(sha) { return JSON.parse(gh(['api', `repos/${REPO}/git/commits/${sha}`])).message },
  commentIssue(number, body) { gh(['issue', 'comment', String(number), '--repo', REPO, '--body', body]) },
}

/**
 * Publish a contract by CREATING its ref. Create-if-absent means a second
 * publication at the same generation FAILS rather than silently replacing the
 * first — which is the property a comment can never have.
 */
export function publishContract(contract, io = contractIo) {
  validateContract(contract)
  const generation = contract.generation ?? 1
  const ref = contractRef(contract.work_issue, generation)
  if (io.readRef(ref) !== null) {
    throw new ContractError(`${ref} already exists; a contract is immutable. Publish a new generation instead of replacing this one.`)
  }
  const hash = contractHash(contract)
  const commitSha = JSON.parse(io.createBlobCommit([
    `db-agent-contract issue=${contract.work_issue} generation=${generation} sha256=${hash}`,
    '',
    canonicalize(contract),
  ].join('\n'))).sha
  io.createRef(ref, commitSha)

  // READ BACK. An unverified write is not authority, and a worker is about to be
  // released on the strength of it.
  const readBack = io.readRef(ref)
  if (readBack !== commitSha) throw new ContractError(`${ref} did not read back as ${commitSha}; do NOT release the worker`)

  if (io.commentIssue) {
    io.commentIssue(contract.work_issue, [
      `Work contract published at \`${ref}\` (sha256 \`${hash}\`).`,
      '',
      'This comment is a human-readable COPY. The authority is the ref above: validation reads it, not this text.',
      '',
      '```' + CONTRACT_FENCE,
      JSON.stringify(contract, null, 2),
      '```',
    ].join('\n'))
  }
  return { ref, sha: commitSha, hash }
}

/** Read a published contract back out of its ref. */
export function readPublishedContract(ref, io = contractIo) {
  const sha = io.readRef(ref)
  if (sha === null) throw new ContractError(`${ref} does not exist; no contract was published for this work`)
  const message = io.readCommitMessage(sha)
  const body = message.split('\n').slice(2).join('\n').trim()
  let parsed
  try { parsed = JSON.parse(body) } catch { throw new ContractError(`${ref} does not carry a readable contract`) }
  return validateContract(parsed)
}

export const USAGE = `Usage:
  node scripts/agent-work-contract.mjs --validate-contract --contract-file <path>
  node scripts/agent-work-contract.mjs --publish-contract  --contract-file <path>
  node scripts/agent-work-contract.mjs --validate-completion --report-file <path> --contract-file <path>

Exit codes:
  0  valid, or published and read back
  1  refused: the contract or report does not satisfy the rules
  2  usage error, or the input could not be read
`

export function parseArgs(argv) {
  const options = { mode: null, contractFile: null, reportFile: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (arg === '--validate-contract' || arg === '--publish-contract' || arg === '--validate-completion') {
      if (options.mode) throw new ContractError('choose exactly one mode')
      options.mode = arg.slice(2); continue
    }
    const value = argv[i + 1]
    if (arg === '--contract-file') { if (!value || value.startsWith('--')) throw new ContractError('--contract-file requires a path'); options.contractFile = value; i++; continue }
    if (arg === '--report-file') { if (!value || value.startsWith('--')) throw new ContractError('--report-file requires a path'); options.reportFile = value; i++; continue }
    throw new ContractError(`unknown argument ${arg}`)
  }
  return options
}

export async function main(argv, io = {}) {
  const log = io.log ?? ((text) => console.log(text))
  const error = io.error ?? ((text) => console.error(text))
  let options
  try { options = parseArgs(argv) } catch (parseError) { error(String(parseError.message)); error(USAGE); return 2 }
  if (options.help || !options.mode) { log(USAGE); return options.help ? 0 : 2 }

  const readJson = (path, label) => {
    try { return JSON.parse(readFileSync(path, 'utf8')) }
    catch (readError) { throw new ContractError(`${label} is not readable JSON: ${readError.message}`) }
  }

  try {
    if (options.mode === 'validate-contract') {
      if (!options.contractFile) { error('--validate-contract requires --contract-file'); return 2 }
      validateContract(readJson(options.contractFile, '--contract-file'))
      log('Contract is valid.')
      return 0
    }
    if (options.mode === 'publish-contract') {
      if (!options.contractFile) { error('--publish-contract requires --contract-file'); return 2 }
      const published = publishContract(readJson(options.contractFile, '--contract-file'), io.contractIo ?? contractIo)
      log(JSON.stringify(published, null, 2))
      return 0
    }
    if (!options.reportFile || !options.contractFile) { error('--validate-completion requires --report-file and --contract-file'); return 2 }
    const report = readJson(options.reportFile, '--report-file')
    const contract = readJson(options.contractFile, '--contract-file')
    const { validateCompletionRecord } = await import('./lib/work-dependencies.mjs')
    validateCompletionReport(report, { validateCompletionRecord })
    const verdict = reconcileReportWithContract(report, validateContract(contract))
    if (!verdict.satisfied) {
      error('Completion report does NOT satisfy its contract:')
      for (const problem of verdict.problems) error(`  - ${problem}`)
      return 1
    }
    log('Completion report satisfies its contract.')
    return 0
  } catch (failure) {
    if (!(failure instanceof ContractError)) throw failure
    error(String(failure.message))
    return /is not readable JSON/.test(failure.message) ? 2 : 1
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
if (invokedDirectly) process.exitCode = await main(process.argv.slice(2))
