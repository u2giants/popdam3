#!/usr/bin/env node
//
// MIGRATION-LEDGER DRIFT — is what is MERGED the same as what is APPLIED?
//
// WHY THIS EXISTS (issue #892, 2026-08-13)
// ----------------------------------------
//   Six migrations were merged to `main` and never applied to production:
//   20260810190000, 20260810190100, 20260811030000, 20260811050000,
//   20260811060000, 20260811070000. Nothing anywhere reported that.
//
//   The damage was not a broken database. The damage was a WRONG CONCLUSION.
//   An orchestrator read the LIVE production catalog, saw one Disney landing
//   table where Paramount had twenty, and told the business owner that Disney's
//   model had never been built. Seventeen Disney tables existed as reviewed,
//   merged SQL that had simply never been switched on. The owner had to push
//   back before anyone found the truth.
//
//   So the rule this script enforces in software is a rule about EVIDENCE:
//
//     THE LIVE CATALOG IS NOT PROOF THAT WORK WAS NEVER DONE.
//     It is proof of what is APPLIED. Merged-and-unapplied looks exactly like
//     never-written when you only look at the database.
//
// WHAT IT COMPARES, IN BOTH DIRECTIONS
// ------------------------------------
//   A. MERGED BUT NOT APPLIED — a 14-digit version present as a file on
//      `origin/main` with no row in `supabase_migrations.schema_migrations`.
//      This is the #892 defect. Finished work that is invisible in the catalog.
//   B. APPLIED BUT NOT ON MAIN — a ledger row whose version has no file on
//      `origin/main`. An orphan row means DDL ran against the database from
//      somewhere other than reviewed, merged history: a hand-applied statement,
//      a deleted or renumbered file, or a branch applied and never landed.
//      Left alone it also makes a future `db push` skip a version that later
//      arrives legitimately, because Supabase keys the ledger on the version
//      ALONE (AGENTS.md section 4 rule 5, and scripts/check-sql.sh).
//
//   Both are drift. Neither is reported anywhere else in this repo.
//
// NO SILENT FAILURES — THE ONE RULE THIS FILE IS BUILT AROUND
// -----------------------------------------------------------
//   The dangerous answer here is a reassuring one. "No drift" from a run that
//   could not read the ledger is worse than no run at all, because somebody
//   will quote it. So:
//
//     * every input that cannot be gathered raises `Unknown` and exits 2;
//     * an EMPTY ledger is `Unknown`, never "nothing applied". This follows the
//       precedent set by check-sql.sh Guard B ("Refusing to continue as though
//       the ledger were empty"): a project with 400+ migrations returning zero
//       rows means the query, the credential or the permission failed, not that
//       the database is blank;
//     * an EMPTY set of migration files on `origin/main` is `Unknown` too, for
//       the same reason — it would otherwise report every applied row as an
//       orphan and every real gap as clean;
//     * there is no `--quiet`, no `|| true` path, and no exit code that means
//       "I could not check".
//
//   Exit 0 = checked, no actionable drift (retired/held items may still be listed).
//   Exit 1 = actionable drift found. Exit 2 = COULD NOT CHECK.
//
// READ-ONLY. It runs exactly one statement, a constant `select version from
// supabase_migrations.schema_migrations`. It never writes, and it must never be
// given a credential that could.
//
//   node scripts/check-migration-ledger-drift.mjs --target production
//   node scripts/check-migration-ledger-drift.mjs --target preview --json

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const MIGRATIONS_DIR = 'supabase/migrations'

/**
 * The two projects this repo owns. Named rather than free-form so a typo cannot
 * silently point a "production" check at something that is not production.
 *
 * PREVIEW CHANGES WHEN THE BRANCH IS REBUILT. On 2026-08-18 rjyboqwcdzcocqgmsyel was
 * deleted and replaced. The workflow now reads the repository variable
 * PREVIEW_PROJECT_REF; this constant must be updated in the SAME change, or this check
 * silently measures drift against a project nobody uses. It fails closed (Unknown, exit
 * 2) against a project that no longer exists, which is how the stale value was caught.
 */
export const PROJECT_REFS = {
  production: 'qsllyeztdwjgirsysgai',
  preview: 'mvpkijzfmfcxhnzqogzs',
}

/** Thrown when an input cannot be gathered. Never swallowed into a green result. */
export class Unknown extends Error {}

export const PENDING_KINDS = new Set(['genuinely-pending', 'guarded-batch', 'deliberately-held', 'retired'])
export const INTENTIONALLY_EXCLUDED_KINDS = new Set(['deliberately-held', 'retired'])

/**
 * Read the production lane's existing rules instead of maintaining a second list here.
 * Python emits the rule data; JavaScript applies it with the actual ledger. Any import,
 * parse, or coverage failure is UNKNOWN and makes the drift check exit 2.
 */
export function guardClassifications(versions, appliedVersions = []) {
  if (versions.length === 0) return {}
  const program = String.raw`
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / 'scripts'))
from production_migration_guard import HARD_BLOCKED, BUNDLE_20260804, FR_HELD_20260803, FR_COMPATIBILITY_VERSIONS, FR_REMOVAL_VERSIONS, CO_PRESENCE_RULES, ATOMIC_BATCHES, PREVIEW_ONLY_HISTORICAL_RESTORATIONS
from post_batch_app_verification import RETIRED_VERSION_REASONS, RETIRED_VERSIONS
print(json.dumps({
  'retired': sorted(RETIRED_VERSIONS), 'hardBlocked': sorted(HARD_BLOCKED),
  'retiredReasons': RETIRED_VERSION_REASONS,
  'bundle': sorted(BUNDLE_20260804), 'frHeld': sorted(FR_HELD_20260803),
  'previewOnlyHistorical': sorted(PREVIEW_ONLY_HISTORICAL_RESTORATIONS),
  'frCompatibility': sorted(FR_COMPATIBILITY_VERSIONS),
  'frRemoval': sorted(FR_REMOVAL_VERSIONS),
  'coPresence': [{'create': c, 'fixes': sorted(f), 'why': w} for c, f, w in CO_PRESENCE_RULES],
  'atomic': [{'name': n, 'basis': b, 'why': w, 'members': sorted(m)} for n, b, w, m in ATOMIC_BATCHES],
}))
`
  let raw
  try {
    raw = execFileSync('python', ['-c', program, repoRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Unknown(`could not classify pending migrations from the production guard rules: ${error.message}`)
  }
  let rules
  try { rules = JSON.parse(raw) } catch { throw new Unknown('production guard classification returned invalid JSON') }
  const result = classifyPendingWithRules(versions, appliedVersions, rules)
  validatePendingClassifications(versions, result)
  return result
}

export function classifyPendingWithRules(versions, appliedVersions, rules) {
  const applied = new Set(appliedVersions)
  const retired = new Set(rules.retired)
  const hardBlocked = new Set(rules.hardBlocked)
  const bundle = new Set(rules.bundle)
  const frHeld = new Set(rules.frHeld)
  const frCompatibility = new Set(rules.frCompatibility ?? [])
  const frRemoval = new Set(rules.frRemoval)
  const previewOnlyHistorical = new Set(rules.previewOnlyHistorical ?? [])
  const result = {}
  for (const version of versions) {
    if (retired.has(version)) {
      const reason = rules.retiredReasons?.[version] ?? 'never apply this version; its safe replacement or end state is already present'
      result[version] = { kind: 'retired', reason: `RETIRED_VERSIONS: ${reason}.` }
      continue
    }
    if (frHeld.has(version) || frCompatibility.has(version) || frRemoval.has(version)) {
      const suffix = frRemoval.size === 0 ? 'The required FR removal migration set is not yet defined.' : `Full held bundle: ${[...frHeld, ...frRemoval].sort().join(', ')}.`
      result[version] = { kind: 'deliberately-held', reason: `AGENTS.md 6.5 owner ruling holds the compatibility prerequisite, both FR versions, and every FR removal member for one bounded apply. ${suffix}` }
      continue
    }
    if (previewOnlyHistorical.has(version)) {
      result[version] = { kind: 'deliberately-held', reason: 'Preview-only historical restoration: retain truthful preview history and never include this version in a production allowlist.' }
      continue
    }
    if (hardBlocked.has(version)) {
      result[version] = { kind: 'retired', reason: 'production_migration_guard.HARD_BLOCKED: the general production lane refuses this version outright. Do not apply it.' }
      continue
    }
    const matches = []
    if (bundle.has(version)) matches.push('AGENTS.md 6.8 requires the complete four-version ColdLion bundle, never a subset.')
    for (const { name, basis, why, members } of rules.atomic) {
      if (members.includes(version)) matches.push(`${name} ${basis} batch: ${why} Outstanding set: ${members.filter((v) => !applied.has(v)).join(', ')}.`)
    }
    for (const { create, fixes, why } of rules.coPresence) {
      const outstanding = fixes.filter((v) => !applied.has(v))
      if (version === create || (applied.has(create) && outstanding.includes(version))) {
        matches.push(`${why} ${applied.has(create) ? `Create ${create} is already applied; fix-only recovery must carry every outstanding fix.` : ''} Outstanding required fixes: ${outstanding.join(', ')}.`)
      }
    }
    result[version] = matches.length
      ? { kind: 'guarded-batch', reason: matches.join(' ') }
      : { kind: 'genuinely-pending', reason: 'No retirement, owner-hold, atomic-batch, bundle, or ledger-aware co-presence rule names this version. It is still unapproved until the normal bounded promotion workflow passes.' }
  }
  return result
}

export function validatePendingClassifications(versions, classifications) {
  const expected = [...new Set(versions)].sort()
  const actual = Object.keys(classifications ?? {}).sort()
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Unknown(`pending migration classification is incomplete: expected ${expected.join(', ')}, got ${actual.join(', ')}`)
  }
  for (const version of expected) {
    const row = classifications[version]
    if (!PENDING_KINDS.has(row?.kind) || !row?.reason?.trim()) {
      throw new Unknown(`pending migration ${version} has an unknown or reasonless classification`)
    }
  }
}

// ---------------------------------------------------------------------------
// Pure logic — no network, no filesystem. Unit-tested in the .test.mjs sibling.
// ---------------------------------------------------------------------------

/**
 * The 14-digit versions carried by a list of migration paths or filenames.
 *
 * A `.sql` file under the migrations directory whose name does NOT start with a
 * 14-digit stamp is `Unknown`, not "skip". Supabase would ignore it, so it would
 * be merged work that can never apply — the same class of invisible loss this
 * script exists to surface.
 */
export function versionsFromFilenames(names) {
  const versions = []
  for (const name of names) {
    const base = String(name).split('/').pop()
    if (!base || !base.endsWith('.sql')) continue
    const stamp = base.slice(0, 14)
    if (!/^\d{14}$/.test(stamp)) {
      throw new Unknown(
        `${name} is a .sql file under ${MIGRATIONS_DIR} with no leading 14-digit version. ` +
          'Supabase would never apply it. Refusing to report on a migration set I cannot read.',
      )
    }
    versions.push(stamp)
  }
  return [...new Set(versions)].sort()
}

/**
 * Compare merged versions against applied versions, both ways.
 *
 * @param {string[]} mainVersions   versions of the files on origin/main
 * @param {string[]} appliedVersions versions with a row in the ledger
 */
export function computeDrift(mainVersions, appliedVersions) {
  if (!Array.isArray(mainVersions) || mainVersions.length === 0) {
    throw new Unknown(
      `no migration files found on the base branch under ${MIGRATIONS_DIR}. ` +
        'Refusing to continue as though main carried no migrations: that would report ' +
        'every applied row as an orphan and every real gap as clean.',
    )
  }
  if (!Array.isArray(appliedVersions) || appliedVersions.length === 0) {
    throw new Unknown(
      'the migration ledger came back EMPTY. Refusing to continue as though the ledger ' +
        'were empty: on a database this repo has been applying to since 2026-06, zero rows ' +
        'means the query, the credential or the permission failed — not that nothing is applied.',
    )
  }

  const applied = new Set(appliedVersions.map(String))
  const merged = new Set(mainVersions.map(String))

  const mergedNotApplied = [...merged].filter((v) => !applied.has(v)).sort()
  const appliedNotMerged = [...applied].filter((v) => !merged.has(v)).sort()

  return {
    mergedCount: merged.size,
    appliedCount: applied.size,
    mergedNotApplied,
    appliedNotMerged,
    driftFound: mergedNotApplied.length > 0 || appliedNotMerged.length > 0,
  }
}

/**
 * Decide which visible differences are actionable drift. Retired and deliberately-held
 * migrations remain in the report, but their absence from the ledger is the intended
 * end state. Orphan ledger rows and every other merged-but-unapplied classification
 * remain failures.
 */
export function assessDrift(drift, pendingClassifications) {
  const intentionallyExcluded = []
  const actionableMergedNotApplied = []
  for (const version of drift.mergedNotApplied) {
    const classification = pendingClassifications[version]
    if (!classification) throw new Unknown(`pending migration ${version} has no classification`)
    if (INTENTIONALLY_EXCLUDED_KINDS.has(classification.kind)) intentionallyExcluded.push(version)
    else actionableMergedNotApplied.push(version)
  }
  return {
    ...drift,
    intentionallyExcluded,
    actionableMergedNotApplied,
    driftFound: actionableMergedNotApplied.length > 0 || drift.appliedNotMerged.length > 0,
  }
}

export function formatReport({ target, projectRef, baseRef, drift, fileByVersion = {}, pendingClassifications = {} }) {
  const lines = []
  lines.push(`Migration ledger drift — ${target} (${projectRef})`)
  lines.push(`  merged on ${baseRef}: ${drift.mergedCount} version(s)`)
  lines.push(`  applied in supabase_migrations.schema_migrations: ${drift.appliedCount} version(s)`)
  lines.push('')

  if (!drift.driftFound && drift.mergedNotApplied.length === 0) {
    lines.push('NO DRIFT. Every version merged to the base branch has a ledger row, and every')
    lines.push('ledger row has a file on the base branch.')
    return lines.join('\n')
  }

  lines.push(drift.driftFound
    ? 'DRIFT FOUND.'
    : 'NO ACTIONABLE DRIFT. Outstanding versions are intentionally excluded from application.')

  if (drift.mergedNotApplied.length > 0) {
    lines.push('')
    lines.push(`MERGED BUT NOT APPLIED — ${drift.mergedNotApplied.length} version(s):`)
    for (const version of drift.mergedNotApplied) {
      const classification = pendingClassifications[version]
      if (!classification) throw new Unknown(`pending migration ${version} has no classification`)
      lines.push(`  ${version}  [${classification.kind.toUpperCase()}]  ${fileByVersion[version] ?? ''}`.trimEnd())
      lines.push(`    why: ${classification.reason}`)
    }
    lines.push('')
    lines.push('These are reviewed, merged migrations that are NOT switched on in this database.')
    lines.push('⚠️ Any object they create is ABSENT FROM THE LIVE CATALOG. Do not read that')
    lines.push('absence as "the work was never done" — that is exactly the wrong conclusion')
    lines.push('reported to the owner on 2026-08-13 (issue #892). Read the SQL on main first.')
    lines.push('Do not turn this list into a broad apply. RETIRED means never apply; HELD and')
    lines.push('GUARDED entries must satisfy their stated rule; only then may genuinely pending')
    lines.push('work enter the bounded Shared Supabase Migrations workflow.')
    if (drift.intentionallyExcluded?.length > 0) {
      lines.push(`${drift.intentionallyExcluded.length} RETIRED/DELIBERATELY-HELD version(s) above are listed for visibility but do not make this check fail.`)
    }
  }

  if (drift.appliedNotMerged.length > 0) {
    lines.push('')
    lines.push(`APPLIED BUT NOT ON THE BASE BRANCH — ${drift.appliedNotMerged.length} ledger row(s):`)
    for (const version of drift.appliedNotMerged) lines.push(`  ${version}`)
    lines.push('')
    lines.push('An orphan ledger row means DDL reached this database from outside reviewed,')
    lines.push('merged history, or that a merged file was deleted or renumbered afterwards.')
    lines.push('Supabase keys the ledger on the version ALONE, so a later migration that')
    lines.push('legitimately takes one of these versions will be SILENTLY SKIPPED.')
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// I/O — git and the Supabase Management API. Injected, so the logic above can be
// tested without either.
// ---------------------------------------------------------------------------

/**
 * The migration filenames on the base branch.
 *
 * Every failure path here is `Unknown`. check-sql.sh Guard B may SKIP when it
 * cannot resolve the base ref, because a false positive there blocks every pull
 * request. This script has the opposite risk profile: it blocks nothing, it only
 * reports, so an unresolvable base ref must be loud rather than silent.
 */
export function mainMigrationFiles(baseRef = 'origin/main') {
  let resolved = baseRef
  try {
    execFileSync('git', ['-C', repoRoot, 'rev-parse', '--verify', '--quiet', baseRef], { stdio: 'ignore' })
  } catch {
    try {
      execFileSync('git', ['-C', repoRoot, 'fetch', '--quiet', '--no-tags', 'origin', 'main'], { stdio: 'ignore' })
      execFileSync('git', ['-C', repoRoot, 'rev-parse', '--verify', '--quiet', 'FETCH_HEAD'], { stdio: 'ignore' })
      resolved = 'FETCH_HEAD'
    } catch {
      throw new Unknown(
        `could not resolve the base ref \`${baseRef}\` (no git repository, no such ref, or no ` +
          'network to fetch it). In CI give the checkout fetch-depth: 0. Refusing to compare ' +
          'the ledger against a branch I cannot read.',
      )
    }
  }

  let out
  try {
    out = execFileSync('git', ['-C', repoRoot, 'ls-tree', '-r', '--name-only', resolved, '--', MIGRATIONS_DIR], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (error) {
    throw new Unknown(`\`git ls-tree ${resolved}\` failed: ${error.shortMessage || error.message}`)
  }

  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.sql'))
}

/**
 * The applied versions, read through the Supabase Management API.
 *
 * WHY THE MANAGEMENT API AND NOT psql. This script must run from a developer's
 * machine as easily as from CI, and the database password is not available on
 * either without extra setup; `SUPABASE_ACCESS_TOKEN` already exists as a repo
 * secret and is already how other lanes authenticate.
 *
 * THE STATEMENT IS A CONSTANT. There is no interpolation and no way for a caller
 * to supply SQL, so this cannot be turned into a write path by an argument.
 */
export const APPLIED_VERSIONS_SQL =
  'select version from supabase_migrations.schema_migrations order by version'

export async function fetchAppliedVersions(projectRef, token = process.env.SUPABASE_ACCESS_TOKEN) {
  if (!token) {
    throw new Unknown(
      'SUPABASE_ACCESS_TOKEN is not set, so the migration ledger could not be read. ' +
        'This is NOT "no drift" — nothing was compared. Export a Supabase personal access ' +
        'token (read is enough) and run again.',
    )
  }

  let response
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: APPLIED_VERSIONS_SQL }),
    })
  } catch (error) {
    throw new Unknown(`could not reach the Supabase Management API: ${error.message}`)
  }

  const body = await response.text()
  if (!response.ok) {
    throw new Unknown(
      `Supabase Management API returned ${response.status} for project ${projectRef}: ${body.slice(0, 500)}`,
    )
  }

  let rows
  try {
    rows = JSON.parse(body)
  } catch {
    throw new Unknown(`Supabase Management API did not return JSON for project ${projectRef}`)
  }
  if (!Array.isArray(rows)) {
    throw new Unknown(`Supabase Management API returned ${typeof rows}, not a row array`)
  }

  return rows.map((row) => {
    if (!row || typeof row.version === 'undefined' || row.version === null) {
      throw new Unknown('a ledger row came back without a `version` column')
    }
    return String(row.version)
  })
}

// ---------------------------------------------------------------------------
// Orchestration — injectable, so every branch including the unreachable ledger
// is unit-testable without a network.
// ---------------------------------------------------------------------------

export const defaultIo = {
  mainMigrationFiles,
  fetchAppliedVersions,
  guardClassifications,
}

/**
 * @returns {{drift: object, fileByVersion: object}}
 * @throws {Unknown} whenever anything could not be determined.
 */
export async function runDriftCheck({ target, baseRef = 'origin/main', io = defaultIo }) {
  const projectRef = PROJECT_REFS[target]
  if (!projectRef) {
    throw new Unknown(`unknown --target ${JSON.stringify(target)}; expected one of: ${Object.keys(PROJECT_REFS).join(', ')}`)
  }

  const files = await io.mainMigrationFiles(baseRef)
  const mainVersions = versionsFromFilenames(files)
  const fileByVersion = {}
  for (const file of files) fileByVersion[file.split('/').pop().slice(0, 14)] = file

  const appliedVersions = await io.fetchAppliedVersions(projectRef)
  const rawDrift = computeDrift(mainVersions, appliedVersions)
  const classify = io.guardClassifications ?? guardClassifications
  const pendingClassifications = await classify(rawDrift.mergedNotApplied, appliedVersions)
  validatePendingClassifications(rawDrift.mergedNotApplied, pendingClassifications)
  const drift = assessDrift(rawDrift, pendingClassifications)

  return { projectRef, baseRef, target, drift, fileByVersion, pendingClassifications }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { target: null, baseRef: 'origin/main', json: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[(i += 1)]
    if (arg === '--target') options.target = next()
    else if (arg === '--base-ref') options.baseRef = next()
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Unknown(`unknown argument: ${arg}`)
  }
  return options
}

const USAGE = `
Does the migration ledger match what is merged? Reports drift in BOTH directions.

  node scripts/check-migration-ledger-drift.mjs --target production
  node scripts/check-migration-ledger-drift.mjs --target preview --json

Options:
  --target <production|preview>  Which database's ledger to read. Required.
  --base-ref <ref>               Git ref holding the merged truth (default origin/main).
  --json                         Machine-readable output.

Needs SUPABASE_ACCESS_TOKEN (read is enough). Runs ONE constant SELECT.

Exit 0 = checked, no actionable drift. Retired/held versions may still be listed.
Exit 1 = DRIFT. A pending/guarded migration or orphan ledger row exists.
Exit 2 = COULD NOT CHECK. Never read this as "no drift" — nothing was compared.

Remember what a clean live catalog does and does not prove: it proves what is
APPLIED. Merged-but-unapplied work is INVISIBLE in the catalog and looks exactly
like work nobody ever did (issue #892).
`.trim()

export async function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(String(error.message))
    console.error(USAGE)
    return 2
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  if (!options.target) {
    console.error('UNKNOWN: --target is required (production or preview).')
    console.error(USAGE)
    return 2
  }

  let result
  try {
    result = await runDriftCheck({ target: options.target, baseRef: options.baseRef })
  } catch (error) {
    if (!(error instanceof Unknown)) throw error
    console.error(`UNKNOWN: ${error.message}`)
    console.error('')
    console.error('NOTHING WAS COMPARED. This is not a clean result and must never be quoted')
    console.error('as one. Fix the above and run again.')
    return 2
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(formatReport(result))
  }
  return result.drift.driftFound ? 1 : 0
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
// `process.exitCode`, NOT `process.exit()`. Calling process.exit() while the
// Management API socket is still open crashes Node on Windows with a libuv
// assertion (`!(handle->flags & UV_HANDLE_CLOSING)`) and returns 127 — a
// meaningless code that a CI step would read as "some other failure" rather than
// as the DRIFT (1) the script had already decided on and printed. Setting
// exitCode lets the process finish cleanly and preserves the real verdict.
if (invokedDirectly) process.exitCode = await main(process.argv.slice(2))
