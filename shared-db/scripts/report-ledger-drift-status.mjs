#!/usr/bin/env node
//
// LEDGER-DRIFT STATUS REPORT — what is pending, who merged it, who must promote it.
//
// WHY THIS EXISTS (issue #2508)
// ----------------------------
//   The migration-ledger drift check (check-migration-ledger-drift.mjs) correctly
//   reports WHAT is drift. It does not say WHERE each pending version came from or
//   WHO owns its promotion. Alarm issues like #2508 therefore accumulate hand-written
//   status comments that go stale, and every successor session re-researches the same
//   git history from scratch.
//
//   This tool turns a drift-check JSON result into an issue-comment-ready status
//   report: one row per actionable version, with the introducing commit and source
//   PR number recovered from git, plus a compact promotion-candidate list that names
//   the bounded workflow each genuinely-pending version must enter.
//
// READ-ONLY. It reads git history and a JSON file. It never writes to any database,
// never dispatches a workflow, and never touches production.
//
//   node scripts/report-ledger-drift-status.mjs --json drift.json
//   set -o pipefail  # Bash: preserve both commands' failure status
//   node scripts/check-migration-ledger-drift.mjs --target production --json \
//     | node scripts/report-ledger-drift-status.mjs --json -
//
// Exit 0 = no actionable drift. Exit 1 = actionable drift. Exit 2 = UNKNOWN.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
async function readStdin() {
  if (process.stdin.isTTY) throw new Unknown('stdin is a terminal; supply drift JSON or a file path')
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  return raw
}

export class Unknown extends Error {
  constructor(message) { super(message); this.name = 'Unknown' }
}

const VERSION = /^\d{14}$/
const REF = /^[A-Za-z0-9_./~^:{}@-]+$/
const safeText = (value) => String(value).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/`/g, "'").replace(/\|/g, '\\|')

function assertVersions(values, field) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !VERSION.test(value)) || new Set(values).size !== values.length) {
    throw new Unknown(`${field} must be an array of unique 14-digit versions`)
  }
}

function assertOrphanVersions(values) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value || value.length > 128) || new Set(values).size !== values.length) {
    throw new Unknown('drift.appliedNotMerged must be an array of unique nonempty ledger values')
  }
}

/** Refuse partial, contradictory, or unsafe JSON rather than reporting it as clean. */
export function validateDriftResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Unknown('drift JSON must be an object')
  if (!['production', 'preview'].includes(result.target)) throw new Unknown('drift JSON has no supported target')
  if (typeof result.projectRef !== 'string' || !/^[a-z0-9]+$/.test(result.projectRef)) throw new Unknown('drift JSON has no valid projectRef')
  if (typeof result.baseRef !== 'string' || !REF.test(result.baseRef) || result.baseRef.startsWith('-') || result.baseRef.includes('..')) throw new Unknown('drift JSON has no safe baseRef')
  const { drift, fileByVersion, pendingClassifications } = result
  if (!drift || typeof drift !== 'object' || Array.isArray(drift)) throw new Unknown('drift JSON has no drift object')
  if (!Number.isSafeInteger(drift.mergedCount) || drift.mergedCount < 1 || !Number.isSafeInteger(drift.appliedCount) || drift.appliedCount < 1) throw new Unknown('merged and applied counts must both be positive; an empty read is UNKNOWN')
  for (const field of ['mergedNotApplied', 'intentionallyExcluded', 'foreignTarget', 'actionableMergedNotApplied']) assertVersions(drift[field], `drift.${field}`)
  assertOrphanVersions(drift.appliedNotMerged)
  if (drift.mergedCount - drift.appliedCount !== drift.mergedNotApplied.length - drift.appliedNotMerged.length) {
    throw new Unknown('drift counts disagree with version gaps; refusing a possibly partial read')
  }
  const merged = new Set(drift.mergedNotApplied)
  const partitions = [...drift.intentionallyExcluded, ...drift.foreignTarget, ...drift.actionableMergedNotApplied]
  if (partitions.length !== merged.size || new Set(partitions).size !== merged.size || partitions.some((v) => !merged.has(v))) throw new Unknown('drift classification lists disagree with mergedNotApplied')
  const found = drift.actionableMergedNotApplied.length > 0 || drift.appliedNotMerged.length > 0
  if (typeof drift.driftFound !== 'boolean' || drift.driftFound !== found) throw new Unknown('driftFound disagrees with actionable and orphan rows')
  if (!fileByVersion || typeof fileByVersion !== 'object' || Array.isArray(fileByVersion)) throw new Unknown('drift JSON has no fileByVersion')
  if (!pendingClassifications || typeof pendingClassifications !== 'object' || Array.isArray(pendingClassifications)) throw new Unknown('drift JSON has no pendingClassifications')
  if (Object.keys(pendingClassifications).length !== merged.size || [...merged].some((v) => !Object.hasOwn(pendingClassifications, v))) throw new Unknown('pending classifications do not match mergedNotApplied')
  for (const version of merged) {
    const row = pendingClassifications[version]
    if (!row || typeof row.kind !== 'string' || !['genuinely-pending', 'guarded-batch', 'deliberately-held', 'retired', 'base-absent', 'foreign-target'].includes(row.kind) || typeof row.reason !== 'string' || !row.reason.trim()) throw new Unknown(`pending migration ${version} has no valid classification`)
  }
  for (const version of drift.actionableMergedNotApplied) {
    const file = fileByVersion[version]
    if (typeof file !== 'string' || !file.startsWith(`supabase/migrations/${version}`) || !file.endsWith('.sql')) throw new Unknown(`actionable migration ${version} has no valid file`)
  }
  return result
}

// ---------------------------------------------------------------------------
// Pure logic — no network, no filesystem.
// ---------------------------------------------------------------------------

/**
 * Recover a GitHub PR number from a commit subject.
 *
 * Merge commits carry `Merge pull request #1234 from ...`. Squash and rebase
 * merges carry a trailing `(#1234)`. A bare issue reference is not a PR.
 */
export function prNumberFromSubject(subject) {
  const text = String(subject ?? '')
  const merge = text.match(/Merge pull request #(\d+)/)
  if (merge) return Number(merge[1])
  const squash = text.match(/\(#(\d+)\)\s*$/)
  if (squash) return Number(squash[1])
  return null
}

/**
 * The caller adds producer top-level fileByVersion and pendingClassifications
 * to drift before calling. `attribution` is a map of version ->
 * { commit, subject, pr } as recovered from git.
 */
export function buildStatusRows(drift, attribution = {}) {
  const rows = []
  for (const version of drift.actionableMergedNotApplied) {
    const info = attribution[version] ?? {}
    rows.push({
      version,
      file: drift.fileByVersion[version],
      kind: drift.pendingClassifications[version].kind,
      reason: drift.pendingClassifications[version].reason,
      commit: info.commit ?? '',
      subject: info.subject ?? '',
      pr: info.pr ?? null,
    })
  }
  return rows
}

/**
 * Render the issue-comment-ready markdown. Deliberately compact: the alarm issue
 * is a tracker, not a whitepaper. Every line must survive being read six weeks
 * later by a session that has none of this conversation.
 */
export function formatStatusReport({ target, projectRef, baseRef, baseSha, drift, rows }) {
  const lines = []
  const actionable = rows.length
  const excluded = drift.intentionallyExcluded.length
  const foreign = drift.foreignTarget.length
  const orphans = drift.appliedNotMerged.length

  lines.push(`## Ledger drift status — ${safeText(target)} (\`${safeText(projectRef)}\`)`)
  lines.push('')
  lines.push(`Merged on \`${safeText(baseRef)}\`: **${drift.mergedCount}**. Applied in \`supabase_migrations.schema_migrations\`: **${drift.appliedCount}**.`)
  if (baseSha) lines.push(`Attribution history resolved to commit \`${safeText(baseSha)}\` when this report was generated; recheck saved JSON against current history before using it as a live snapshot.`)
  lines.push('')

  if (actionable === 0 && orphans === 0) {
    lines.push('**No actionable drift.**')
    lines.push('')
  }

  if (actionable > 0) {
    lines.push(`### Promotion candidates — ${actionable} genuinely-pending version(s)`)
    lines.push('')
    lines.push('| version | merge/squash PR reference | introducing commit | file | classification |')
    lines.push('|---|---|---|---|---|')
    for (const row of rows) {
      const pr = row.pr ? `#${row.pr}` : 'no PR in commit subject'
      const file = `\`${safeText(row.file.split('/').pop())}\``
      lines.push(`| \`${row.version}\` | ${pr} | \`${safeText(row.commit || 'unattributed')}\` | ${file} | ${safeText(row.kind)}: ${safeText(row.reason)} |`)
    }
    lines.push('')
    lines.push('The supplied drift-check result lists these reviewed, merged migrations as **not applied** in this database.')
    lines.push('⚠️ Any object they create is **absent from the live catalog**. Do not read that absence as "the work was never done" (issue #892).')
    lines.push('')
    lines.push(`**Holders:** each version above needs a ${safeText(target)} apply through the bounded Shared Supabase Migrations workflow. That lane is the orchestrator's single ${safeText(target)} lane, not this session's. This report is detection only — no production action was taken.`)
    lines.push('')
  }

  if (excluded > 0 || foreign > 0) {
    lines.push(`Non-actionable listings: **${excluded}** retired/deliberately-held, **${foreign}** foreign-target. Their absence is the intended end state; see the check output for reasons.`)
    lines.push('')
  }

  if (orphans > 0) {
    lines.push(`### Orphan ledger rows — ${orphans}`)
    lines.push('')
    for (const version of drift.appliedNotMerged) lines.push(`- \`${safeText(version)}\`${VERSION.test(version) ? '' : ' — malformed ledger version'}`)
    lines.push('')
    lines.push('An orphan ledger row means DDL reached this database from outside reviewed, merged history. Supabase keys the ledger on the version alone, so a later migration that legitimately takes one of these versions will be silently skipped.')
    lines.push('')
  }

  lines.push(`*Generated by \`scripts/report-ledger-drift-status.mjs\` from a \`check-migration-ledger-drift --json\` result. Detection/recovery reporting only — no production apply.*`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// I/O — git log for PR attribution. Injected, so the logic above is unit-testable.
// ---------------------------------------------------------------------------

/**
 * The first-parent commit on the base branch that introduced each migration
 * file — for a PR merged with a merge commit, that is the merge commit itself,
 * whose subject carries `Merge pull request #NNNN`. A PR number is recovered
 * from that subject when one is present.
 *
 * `--first-parent` is the key: the raw `git log --diff-filter=A` finds the
 * commit inside the feature branch that created the file, whose subject has no
 * PR number. Walking only first-parent history finds the merge that landed the
 * file on main.
 *
 * Only the versions the caller actually needs attributed are queried — the
 * actionable pending list, never all 700+ merged versions.
 */
export function attributeVersions(fileByVersion, run = execFileSync, baseRef = 'origin/main', root = repoRoot) {
  if (typeof baseRef !== 'string' || !REF.test(baseRef) || baseRef.startsWith('-') || baseRef.includes('..')) throw new Unknown('unsafe baseRef for git attribution')
  const attribution = {}
  for (const [version, file] of Object.entries(fileByVersion ?? {})) {
    if (!file) continue
    let out = ''
    try {
      out = run('git', ['-C', root, 'log', '--first-parent', '--format=%H%x09%s', '--reverse', baseRef, '--', file], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      })
    } catch (error) {
      throw new Unknown(`git attribution unavailable for ${version} at ${baseRef}: ${error.message}`)
    }
    // Prefer the oldest first-parent entry whose subject carries a PR number;
    // fall back to the oldest entry if none does.
    const lines = String(out).trim().split(/\r?\n/).filter(Boolean)
    if (lines.length === 0) throw new Unknown(`git attribution unavailable for ${version} at ${baseRef}: no introducing commit`)
    let chosen = lines[0]
    for (const line of lines) {
      const tab = line.indexOf('\t')
      const subject = tab === -1 ? '' : line.slice(tab + 1)
      if (prNumberFromSubject(subject) !== null) { chosen = line; break }
    }
    const tab = chosen.indexOf('\t')
    const commit = tab === -1 ? chosen : chosen.slice(0, tab)
    const subject = tab === -1 ? '' : chosen.slice(tab + 1)
    attribution[version] = { commit, subject, pr: prNumberFromSubject(subject) }
  }
  return attribution
}

export function resolveBaseCommit(baseRef, run = execFileSync, root = repoRoot) {
  if (typeof baseRef !== 'string' || !REF.test(baseRef) || baseRef.startsWith('-') || baseRef.includes('..')) throw new Unknown('unsafe baseRef for git attribution')
  let sha
  try {
    sha = String(run('git', ['-C', root, 'rev-parse', '--verify', `${baseRef}^{commit}`], { encoding: 'utf8' })).trim()
  } catch (error) {
    throw new Unknown(`attribution history unavailable at ${baseRef}: ${error.message}`)
  }
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Unknown(`attribution history at ${baseRef} did not resolve to a commit`)
  return sha
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { jsonPath: null, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') {
      if (options.jsonPath !== null) throw new Unknown('--json may be supplied only once')
      options.jsonPath = argv[(i += 1)]
      if (!options.jsonPath || options.jsonPath.startsWith('-') && options.jsonPath !== '-') throw new Unknown('--json requires a file path or - for stdin')
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Unknown(`unknown argument: ${arg}`)
    }
  }
  return options
}

const USAGE = `
Turn a check-migration-ledger-drift --json result into an issue-comment-ready
status report with per-version PR attribution.

  set -o pipefail  # Bash: preserve both commands' failure status
  node scripts/check-migration-ledger-drift.mjs --target production --json \\
    | node scripts/report-ledger-drift-status.mjs --json -

  node scripts/report-ledger-drift-status.mjs --json drift.json

Options:
  --json <path|->   Drift-check JSON output. Use - to read stdin.
  --help            Show this help.

Exit 0 = no actionable drift. Exit 1 = actionable drift. Exit 2 = UNKNOWN.
`.trim()

export async function main(argv, { read = readFileSync, stdin = readStdin, run = execFileSync, root = repoRoot, log = console.log, errorLog = console.error } = {}) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    errorLog(String(error.message))
    errorLog(USAGE)
    return 2
  }
  if (options.help) {
    log(USAGE)
    return 0
  }
  if (!options.jsonPath) {
    errorLog('UNKNOWN: --json is required (a file path, or - for stdin).')
    errorLog(USAGE)
    return 2
  }

  let raw
  try {
    raw = options.jsonPath === '-' ? await stdin() : read(options.jsonPath, 'utf8')
  } catch (error) {
    errorLog(`UNKNOWN: could not read drift JSON: ${error.message}`)
    return 2
  }

  let result
  try {
    result = JSON.parse(raw)
  } catch {
    errorLog('UNKNOWN: drift input is not valid JSON.')
    return 2
  }
  try {
    validateDriftResult(result)
  } catch (error) {
    errorLog(`UNKNOWN: ${error.message}`)
    return 2
  }

  // Attribute ONLY the actionable pending versions — never all 700+ merged ones.
  const actionable = result.drift.actionableMergedNotApplied
  const fileByVersion = result.fileByVersion
  const actionableFiles = {}
  for (const v of actionable) {
    if (fileByVersion[v]) actionableFiles[v] = fileByVersion[v]
  }
  const baseRef = result.baseRef
  let attribution
  let baseSha
  try {
    baseSha = resolveBaseCommit(baseRef, run, root)
    attribution = attributeVersions(actionableFiles, run, baseSha, root)
  } catch (error) {
    errorLog(`UNKNOWN: ${error.message}`)
    return 2
  }
  const rows = buildStatusRows(
    { ...result.drift, fileByVersion, pendingClassifications: result.pendingClassifications },
    attribution,
  )
  log(formatStatusReport({
    target: result.target,
    projectRef: result.projectRef,
    baseRef,
    baseSha,
    drift: result.drift,
    rows,
  }))
  return result.drift.driftFound ? 1 : 0
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exitCode = await main(process.argv.slice(2))
