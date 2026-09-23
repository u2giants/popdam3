#!/usr/bin/env node
// GUARD (issue #2037): refuse a pull request that EDITS a migration file whose
// version has already been applied to preview or production.
//
// WHY THIS EXISTS
// ---------------
// On 2026-09-01 `20260831234750_hts_rag_durable_precedent_contract.sql` was
// applied to preview by run 33454217961, and eight minutes later a second
// session pushed a commit to the same pull request that REWROTE that same file:
// CHECK regexes widened, constraints added, an index dropped, grants widened, a
// policy split. The pull request then merged.
//
// A version can be applied only once. Supabase's ledger keys on the version
// alone, so the edited body is never replayed anywhere it has already run.
// Preview permanently held the PRE-edit body; `main` held the POST-edit body;
// and the preview rehearsal pinned to that run had rehearsed SQL that no longer
// existed. AGENTS.md 6.x rule 4 has always forbidden this ("never edit a
// migration that has already been applied anywhere") -- but nothing MECHANICAL
// refused the push, so the rule was enforced only by whoever happened to be
// reading. That is the gap this closes.
//
// WHAT COUNTS AS AN EDIT
// ----------------------
// Any change to an existing migration file: modified, deleted, or renamed. A
// rename is an edit because the ledger keys on the version, so renaming the file
// detaches the applied version from the only record of what it ran. ADDING a new
// migration is the normal case and is never flagged.
//
// COST, AND WHY THE LEDGER READ IS CONDITIONAL
// --------------------------------------------
// The ledgers are read ONLY when the diff actually touches an existing migration
// file. On every other pull request -- the overwhelming majority -- this guard
// makes no network call at all and cannot fail for an unrelated reason. In the
// rare case where it does have to look, it FAILS CLOSED: an unreadable ledger
// exits 2, because "we could not check" must never be reported as "not applied".
//
// THE PREVIEW-ONLY PRE-MERGE EXCEPTION (PR #2933, check run 34922885252)
// ----------------------------------------------------------------------
// The governed flow applies an open pull request's migration to preview BEFORE
// it merges. Any later push to that pull request then found its own version in
// the preview ledger and went permanently red, even with the file untouched.
// The one exception: an ADDED file whose version is in the PREVIEW ledger and
// NOT in production is allowed only when the file reproduces exactly the
// statements preview's own ledger row recorded when it ran that version. The
// evidence is the database's durable record of what it executed, never the
// branch. Every statement must match byte for byte and in order; only whitespace
// and `;` separators BETWEEN statements are free, because both appliers store
// each statement trimmed and never execute the separators. A missing, empty,
// malformed or unreadable row refuses (fail closed). Production-applied versions,
// modified/deleted/renamed files and any changed statement byte stay refused, so
// incident #2037 (an applied body rewritten on the branch) is still caught. A
// version belongs to exactly one version claim, so preview's row for it is the
// apply made for this pull request's claim.
//
// READ-ONLY. It runs the same single constant SELECT as the drift check and,
// only for that exception's candidates, one SELECT of a validated 14-digit
// version's `statements` on preview. No code path issues any other statement.
//
//   node scripts/check-applied-migration-edit.mjs --base origin/main

import { execFileSync } from 'node:child_process'
import { resolveBaseRef, gitProbe } from './lib/resolve-base-ref.mjs'
import fs from 'node:fs'
import { HISTORICAL_RESTORATIONS, validateHistoricalRestorationFile } from './historical-migration-restorations.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAppliedVersions, PROJECT_REFS, Unknown } from './orchestrator-flow/read-preview-ledger.mjs'
export { fetchAppliedVersions, PROJECT_REFS, Unknown }

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const MIGRATIONS_DIR = 'supabase/migrations'

// EVERY touched migration is compared, INCLUDING an added one. `A` was excluded
// once, on the reasoning that adding a migration is the normal way one arrives.
// That reasoning is wrong, and incident #2037 is the proof: `20260831234750` was
// added and then edited on the SAME branch (`9078fc17` then `461d40ec`, merged
// together as PR #2009), so against main it was status `A` for the whole life of
// the pull request. A guard that skips `A` would have passed the pull request
// that caused the incident it exists to prevent. What makes an edit forbidden is
// the VERSION already being in a ledger, never the file's status against main.
export const EDIT_STATUSES = Object.freeze({ A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed' })

/**
 * The one sanctioned change to an already-applied version: restoring the file to
 * the exact bytes that were applied. Without it, widening this guard to added
 * files would also block the only correct remedy -- issue #2035 performed exactly
 * that repair for this incident.
 *
 * The sanctioned set is NOT a new list. `HISTORICAL_RESTORATIONS` already exists,
 * is frozen in code rather than data, pins each version to a file digest, a
 * statement digest and a byte count, and the merge lane already enforces it. A
 * second registry was written for this guard and then removed: two pinned digests
 * for one version can disagree -- they did, over CRLF normalization -- and a
 * version with two answers has none. This guard asks the same question of the
 * same authority, so a restoration it allows is one the merge lane will accept.
 *
 * The test is on BYTES, never on the version, so an entry authorizes one content
 * and can never become a standing licence to ship anything under that version.
 */
export function restorationAllows(file, raw) {
  if (raw === null || raw === undefined) return null
  try { validateHistoricalRestorationFile(file, raw) } catch { return null }
  return HISTORICAL_RESTORATIONS[versionOf(file)] ?? null
}

/**
 * Pure. True only when `raw` (CRLF-normalized, as the appliers read it) is
 * exactly the ledger statements, in order, with nothing but whitespace and `;`
 * before, between and after them. Any doubt -- a non-array, an empty list, a
 * non-string, blank or untrimmed statement, a bare CR, an unreadable file -- is
 * false.
 */
export function fileMatchesLedgerStatements(raw, statements) {
  if (typeof raw !== 'string' || !Array.isArray(statements) || statements.length === 0) return false
  if (raw.replaceAll('\r\n', '').includes('\r')) return false
  const text = raw.replaceAll('\r\n', '\n')
  let cursor = 0
  for (const statement of statements) {
    if (typeof statement !== 'string' || statement === '' || statement !== statement.trim()) return false
    while (cursor < text.length && /[\s;]/.test(text[cursor])) cursor += 1
    if (!text.startsWith(statement, cursor)) return false
    cursor += statement.length
    // The statement must END here: a ledger `select 1` never matches `select 12`.
    if (cursor < text.length && !/[\s;]/.test(text[cursor])) return false
  }
  return /^[\s;]*$/.test(text.slice(cursor))
}

/**
 * Pure. The preview-only pre-merge exception described in the header. Returns
 * null (refuse) unless every condition holds.
 */
export function previewApplyAllows(edit, appliedIn, raw, previewStatements) {
  if (edit?.kind !== 'added' || appliedIn.length !== 1 || appliedIn[0] !== 'preview') return null
  if (!(previewStatements instanceof Map) || !previewStatements.has(edit.version)) return null
  const statements = previewStatements.get(edit.version)
  if (!fileMatchesLedgerStatements(raw, statements)) return null
  return { statementCount: statements.length }
}

/**
 * Reads the `statements` preview recorded for one version. Returns the array,
 * or throws Unknown. Preview only: it refuses the production project ref.
 */
export async function fetchLedgerStatements(projectRef, version, token = process.env.SUPABASE_ACCESS_TOKEN, { fetchImpl = fetch } = {}) {
  if (projectRef !== PROJECT_REFS.preview) throw new Unknown('ledger statements are read from the preview project only')
  if (!/^\d{14}$/.test(String(version ?? ''))) throw new Unknown('version must be exactly 14 digits')
  if (!token) throw new Unknown('SUPABASE_ACCESS_TOKEN is not set, so preview statements could not be read')
  const query = `select statements from supabase_migrations.schema_migrations where version = '${version}'`
  let response
  try {
    response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
  } catch (error) { throw new Unknown(`could not reach the Supabase Management API: ${error.message}`) }
  const body = await response.text()
  if (!response.ok) throw new Unknown(`Supabase Management API returned ${response.status} for project ${projectRef}`)
  let rows
  try { rows = JSON.parse(body) } catch { throw new Unknown('Supabase Management API did not return JSON') }
  if (!Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0]?.statements)) throw new Unknown(`expected exactly one preview ledger row with a statements array for ${version}`)
  return rows[0].statements
}

export function versionOf(file) {
  const match = /^(\d{14})_/.exec(path.basename(String(file ?? '')))
  return match ? match[1] : null
}

/**
 * Pure. Parses `git diff --name-status -z` output into the edits this guard
 * cares about. NUL-delimited so a path with a space, a quote or a newline in it
 * cannot split into two fields and disappear from the finding list.
 */
export function parseEditedMigrations(nameStatusZ) {
  const fields = String(nameStatusZ ?? '').split('\0').filter((field) => field !== '')
  const edits = []
  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index]
    if (!/^[A-Z]\d*$/.test(status)) continue
    const letter = status[0]
    // A rename or copy carries TWO paths: the old one, then the new one.
    const pathCount = letter === 'R' || letter === 'C' ? 2 : 1
    const paths = fields.slice(index + 1, index + 1 + pathCount)
    index += pathCount
    if (paths.length !== pathCount) break
    const kind = EDIT_STATUSES[letter]
    if (!kind) continue
    // BOTH SIDES OF A RENAME OR COPY ARE SUBJECTS. Only the source path used to
    // be examined. A rename INTO the migrations directory from elsewhere, or one
    // that changes the version prefix, carries the applied version only on the
    // DESTINATION path, and was skipped entirely. Each distinct version touched
    // by the record becomes its own edit, so neither side can hide one.
    const seen = new Set()
    for (const subject of paths) {
      if (!subject.startsWith(`${MIGRATIONS_DIR}/`) || !subject.endsWith('.sql')) continue
      const version = versionOf(subject)
      if (!version || seen.has(version)) continue
      seen.add(version)
      edits.push({ version, file: subject, kind, ...(pathCount === 2 ? { renamedTo: paths[1] } : {}) })
    }
  }
  return edits
}

export function editedMigrations(baseRef, { executor = execFileSync, cwd = repoRoot } = {}) {
  let raw
  // Issue #3280 governed review round 2: on a merge_group run origin/<base> does
  // not exist, so resolve the ref (fetching the branch if needed) before diffing.
  // Resolution throws rather than skipping, so the Unknown below still fires.
  const runGit = (args) => executor('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  let resolved
  // A resolution failure is a git failure, and this guard's contract (issue
  // #2037) is that a git failure is UNKNOWN -- never an empty edit list.
  try { resolved = resolveBaseRef(baseRef, { git: gitProbe(runGit) }) }
  catch (error) { throw new Unknown(`could not resolve ${baseRef}: ${error.message}`) }
  try {
    raw = executor('git', ['diff', '--name-status', '-z', '--find-renames', `${resolved}...HEAD`, '--', MIGRATIONS_DIR], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Unknown(`could not diff ${MIGRATIONS_DIR} against ${baseRef}: ${error.message}`)
  }
  return parseEditedMigrations(raw)
}

/**
 * Pure. Given the edits and each ledger's applied versions, say which edits are
 * forbidden and where each was already applied.
 */
export function findingsFor(edits, ledgers, bodies = new Map(), previewStatements = new Map()) {
  const findings = []
  const allowed = []
  for (const edit of edits) {
    const appliedIn = Object.entries(ledgers).filter(([, versions]) => versions.has(edit.version)).map(([name]) => name)
    if (appliedIn.length === 0) continue
    const restoration = restorationAllows(edit.file, bodies.get(edit.file))
    if (restoration) { allowed.push({ ...edit, appliedIn, restoration }); continue }
    const previewApply = previewApplyAllows(edit, appliedIn, bodies.get(edit.file), previewStatements)
    if (previewApply) { allowed.push({ ...edit, appliedIn, previewApply }); continue }
    findings.push({ ...edit, appliedIn })
  }
  // Non-enumerable: the allowed list rides along for the report, but `findings`
  // must still compare equal to a plain array of the refusals.
  Object.defineProperty(findings, 'allowed', { value: allowed, enumerable: false })
  return findings
}

export function formatReport(edits, findings) {
  const lines = []
  if (edits.length === 0) return ['This change touches no migration file at all.']
  lines.push(`This change touches ${edits.length} migration file(s):`)
  for (const edit of edits) lines.push(`  ${edit.kind.padEnd(12)} ${edit.file}${edit.renamedTo ? ` -> ${edit.renamedTo}` : ''}`)
  lines.push('')
  const allowed = findings.allowed ?? []
  for (const entry of allowed) {
    if (entry.previewApply) lines.push(`ALLOWED: ${entry.version} is an added file applied in preview only (never production), and it reproduces exactly the ${entry.previewApply.statementCount} statement(s) preview's own ledger recorded for that version.`)
    else lines.push(`ALLOWED: ${entry.version} is applied in ${entry.appliedIn.join(', ')}, and this file is byte-for-byte the approved historical restoration registered in scripts/historical-migration-restorations.mjs (${entry.restoration.name}).`)
  }
  if (allowed.length > 0) lines.push('')
  if (findings.length === 0) {
    lines.push('No version touched here is present in the preview or production ledger without sanction, so no applied migration was edited.')
    return lines
  }
  lines.push(`REFUSED: ${findings.length} of them carry a version that has ALREADY BEEN APPLIED and can never be replayed:`)
  for (const finding of findings) {
    lines.push(`  ${finding.version}  applied in: ${finding.appliedIn.join(', ')}  (${finding.kind})`)
  }
  lines.push('')
  lines.push('A version is applied only once. The database keeps the body it ran; this branch would leave')
  lines.push('a different body on main, and any rehearsal evidence for that version would describe SQL that')
  lines.push('no longer exists (AGENTS.md 6.x rule 4, incident issue #2037).')
  lines.push('')
  lines.push('An ADDED file is refused on the same terms: incident #2037 arrived as an added file, because the')
  lines.push('version was created and then edited on one branch, so it never showed as modified against main.')
  lines.push('An added file applied to PREVIEW ONLY passes solely when it reproduces exactly the statements')
  lines.push("preview's ledger recorded for that version; a refusal here means they differ or could not be read.")
  lines.push('')
  lines.push('FIX FORWARD: restore the file to the body that was applied and put the change in a NEW migration at a')
  lines.push('newly reserved version, written to be a no-op where the applied shape already matches. If this change')
  lines.push('IS the exact restoration of the bytes that were applied, it must match its registered entry in')
  lines.push('scripts/historical-migration-restorations.mjs byte for byte -- the registry the merge lane reads.')
  return lines
}

export const defaultIo = {
  editedMigrations,
  async appliedVersions(projectRef) { return new Set(await fetchAppliedVersions(projectRef)) },
  previewStatements(projectRef, version) { return fetchLedgerStatements(projectRef, version) },
  readMigration(file) {
    try { return fs.readFileSync(path.join(repoRoot, file), 'utf8') }
    catch { return null }
  },
}

export async function runCheck({ baseRef = 'origin/main', io = defaultIo } = {}) {
  const edits = io.editedMigrations(baseRef)
  // The whole point of the conditional read: an ordinary pull request never
  // touches the network here, so this guard cannot go red for a reason that has
  // nothing to do with it.
  if (edits.length === 0) return { edits, findings: [], ledgersRead: [] }
  const ledgers = {}
  for (const [name, projectRef] of Object.entries(PROJECT_REFS)) {
    ledgers[name] = await io.appliedVersions(projectRef)
    if (!(ledgers[name] instanceof Set) || ledgers[name].size === 0) throw new Unknown(`the ${name} ledger came back empty, so nothing was compared`)
  }
  const bodies = new Map(edits.map((edit) => [edit.file, io.readMigration(edit.file)]))
  // Statements are read only for the preview-only exception's candidates. An
  // unreadable row is left absent, which previewApplyAllows refuses.
  const previewStatements = new Map()
  for (const edit of edits) {
    if (edit.kind !== 'added' || !ledgers.preview.has(edit.version) || ledgers.production.has(edit.version)) continue
    if (restorationAllows(edit.file, bodies.get(edit.file)) || typeof io.previewStatements !== 'function') continue
    try { previewStatements.set(edit.version, await io.previewStatements(PROJECT_REFS.preview, edit.version)) } catch { /* fail closed: stays refused */ }
  }
  return { edits, findings: findingsFor(edits, ledgers, bodies, previewStatements), ledgersRead: Object.keys(ledgers) }
}

export function parseArgs(argv) {
  const options = { baseRef: 'origin/main', help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--base') options.baseRef = argv[index += 1]
    else if (arg === '--help' || arg === '-h') options.help = true
    else return { ...options, error: `unrecognised argument ${JSON.stringify(arg)}` }
  }
  if (!options.baseRef) return { ...options, error: '--base requires a ref' }
  return options
}

export async function main(argv, { run = runCheck, log = console.log, error = console.error } = {}) {
  const options = parseArgs(argv)
  if (options.error) { error(`UNKNOWN: ${options.error}`); return 2 }
  if (options.help) { log('Usage: node scripts/check-applied-migration-edit.mjs [--base <ref>]'); return 0 }
  let result
  try { result = await run({ baseRef: options.baseRef }) } catch (problem) {
    error(`UNKNOWN: the applied-migration-edit guard COULD NOT RUN — ${problem.message}`)
    error('Nothing was compared. Do not read this as "no applied migration was edited".')
    return 2
  }
  for (const line of formatReport(result.edits, result.findings)) log(line)
  return result.findings.length > 0 ? 1 : 0
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exitCode = await main(process.argv.slice(2))
