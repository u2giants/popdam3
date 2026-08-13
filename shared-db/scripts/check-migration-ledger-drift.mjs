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
//   Exit 0 = checked, no drift. Exit 1 = drift found. Exit 2 = COULD NOT CHECK.
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
 * The two projects this repo owns, matching the refs hard-coded in
 * .github/workflows/*.yml. Named rather than free-form so a typo cannot silently
 * point a "production" check at something that is not production.
 */
export const PROJECT_REFS = {
  production: 'qsllyeztdwjgirsysgai',
  preview: 'rjyboqwcdzcocqgmsyel',
}

/** Thrown when an input cannot be gathered. Never swallowed into a green result. */
export class Unknown extends Error {}

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

export function formatReport({ target, projectRef, baseRef, drift, fileByVersion = {} }) {
  const lines = []
  lines.push(`Migration ledger drift — ${target} (${projectRef})`)
  lines.push(`  merged on ${baseRef}: ${drift.mergedCount} version(s)`)
  lines.push(`  applied in supabase_migrations.schema_migrations: ${drift.appliedCount} version(s)`)
  lines.push('')

  if (!drift.driftFound) {
    lines.push('NO DRIFT. Every version merged to the base branch has a ledger row, and every')
    lines.push('ledger row has a file on the base branch.')
    return lines.join('\n')
  }

  lines.push('DRIFT FOUND.')

  if (drift.mergedNotApplied.length > 0) {
    lines.push('')
    lines.push(`MERGED BUT NOT APPLIED — ${drift.mergedNotApplied.length} version(s):`)
    for (const version of drift.mergedNotApplied) {
      lines.push(`  ${version}  ${fileByVersion[version] ?? ''}`.trimEnd())
    }
    lines.push('')
    lines.push('These are reviewed, merged migrations that are NOT switched on in this database.')
    lines.push('⚠️ Any object they create is ABSENT FROM THE LIVE CATALOG. Do not read that')
    lines.push('absence as "the work was never done" — that is exactly the wrong conclusion')
    lines.push('reported to the owner on 2026-08-13 (issue #892). Read the SQL on main first.')
    lines.push('To fix: apply them through the Shared Supabase Migrations workflow.')
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
  const drift = computeDrift(mainVersions, appliedVersions)

  return { projectRef, baseRef, target, drift, fileByVersion }
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

Exit 0 = checked, no drift.
Exit 1 = DRIFT. Either merged work is not applied, or the ledger has an orphan row.
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
