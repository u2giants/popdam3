#!/usr/bin/env node
//
// DISPATCH-TIME COLLISION CHECK — prevent the collision BEFORE the work is done.
//
// WHY THIS EXISTS, AND WHY THE MERGE-TIME GUARD IS NOT ENOUGH.
//
//   scripts/check-pr-object-collisions.mjs is a MERGE-time guard. It compares
//   open pull requests, so it can only see work that has already been written,
//   committed and pushed. By the time it fires, two agents have each spent a
//   full session producing the same object and one of those sessions is going
//   in the bin. It prevents corruption; it does not prevent waste.
//
//   The 2026-07-31 incident is the case in point: FOUR independent sessions each
//   authored `create or replace function plm.promote_coldlion_source_owned`.
//   At the moment each was DISPATCHED, none of them had a pull request, so
//   there was nothing for a cross-PR guard to compare. Three of those four
//   sessions were wasted no matter which guard caught it later.
//
//   This script closes that window. It answers ONE question, before any work
//   starts: "if I hand out a task that writes these objects, does it collide
//   with anything already in flight?"
//
// WHAT COUNTS AS "IN FLIGHT" — two sources, because either alone has a hole:
//
//   1. CLAIMS — open GitHub issues labelled `db-claim`, each carrying a
//      machine-readable block naming the objects a dispatched agent intends to
//      write. This is the half that covers work with no pull request yet.
//   2. OPEN PULL REQUESTS — migrations already pushed. This covers work whose
//      claim was never filed, including sessions no coordinator dispatched.
//      Nine such pull requests (#442-#450) merged outside coordinator control,
//      so this half is not optional.
//
// WHY A GITHUB ISSUE AND NOT A FILE IN THE REPO.
//
//   A claims FILE would be a single-writer document edited by many concurrent
//   sessions — the exact design that made COORDINATOR_INTAKE.md a merge-conflict
//   magnet. Issues are append-only from the client's point of view, need no
//   clone, no branch and no merge, and survive the death of the session that
//   filed them. Durability matters more than tidiness here: a claim must outlive
//   the context window of the coordinator that made it.
//
// THE HONEST LIMIT — READ THIS BEFORE TRUSTING IT.
//
//   This can only protect work whose write targets are DECLARABLE UP FRONT.
//   "Rewrite the promotion function" is declarable. "Investigate why the sync is
//   slow" is not. The rule that makes the limit safe rather than dangerous:
//   **a task that cannot declare its objects must be dispatched READ-ONLY.**
//   A read-only task cannot collide, so an undeclarable task is never a gap.
//   This script does not enforce that rule; the coordinator does.
//
//   It is therefore a PREVENTION control, layered on top of — never replacing —
//   the merge-time guard, which remains the backstop for everything that was
//   never declared.
//
// DESIGN POSTURE — mirrors check-pr-object-collisions.mjs deliberately.
//
//   A false clear is the dangerous answer, so anything this script cannot
//   determine is reported as UNKNOWN and exits non-zero. It never guesses in
//   the reassuring direction.
//
//   For the same reason THIS SCRIPT PRINTS NO VERDICT. It reports what it
//   compared and, explicitly, which DDL classes it cannot read at all. Exit 0
//   means "completed, no overlap in the classes I can see" — evidence for the
//   coordinator's judgement, never clearance. The earlier "SAFE TO DISPATCH"
//   line was removed for exactly this reason: agents grep for the word and act
//   on it regardless of any caveat printed after it.
//
// NO DATABASE CONTACT: reads GitHub metadata and committed .sql text only.
// It needs no database credentials and must never be given any.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describeCoverage, extractObjects } from './check-pr-object-collisions.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const CLAIM_LABEL = 'db-claim'
export const MIGRATIONS_DIR = 'supabase/migrations'

/** Thrown when an input cannot be gathered. Never swallowed into a green result. */
export class Unknown extends Error {}

// ---------------------------------------------------------------------------
// Pure logic — no network, no filesystem. Unit-tested in the .test.mjs sibling.
// ---------------------------------------------------------------------------

/**
 * Parse the machine-readable block out of a `db-claim` issue body.
 *
 * Expected form (fenced, so it survives Markdown rendering intact):
 *
 *   ```db-claim
 *   version: 20260806120000
 *   objects:
 *     - function plm.promote_coldlion_source_owned
 *     - table core.licensor
 *   ```
 *
 * `version` is optional; `objects` may be empty (a read-only claim). A body with
 * no block at all returns null, which the caller treats as UNKNOWN rather than
 * as "claims nothing" — an unparseable claim must never read as harmless.
 *
 * @returns {{version: string|null, objects: string[]}|null}
 */
export function parseClaimBlock(body) {
  if (typeof body !== 'string') return null
  const fence = /```db-claim\s*\n([\s\S]*?)```/.exec(body)
  if (!fence) return null

  const lines = fence[1].split(/\r?\n/)
  let version = null
  const objects = []
  let inObjects = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const versionMatch = /^version:\s*(\S+)?$/i.exec(line)
    if (versionMatch) {
      const value = versionMatch[1]
      version = value && value.toLowerCase() !== 'none' ? value : null
      inObjects = false
      continue
    }
    if (/^objects:\s*$/i.test(line)) {
      inObjects = true
      continue
    }
    if (inObjects) {
      const item = /^[-*]\s+(.*\S)\s*$/.exec(line)
      if (item) objects.push(normalizeObject(item[1]))
      else inObjects = false
    }
  }

  return { version, objects: [...new Set(objects)].sort() }
}

/**
 * Canonical form for comparison. `extractObjects` already emits
 * `"<kind> <schema>.<name>"` lowercased; hand-typed declarations should match
 * regardless of spacing or case.
 */
export function normalizeObject(text) {
  return String(text).trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Compare a proposed task against everything in flight.
 *
 * A holder carries `versions` (an ARRAY). A pull request may contain several
 * migrations, and the earlier scalar `version` field exposed only the first of
 * them to comparison — a false clear in its own right (plan step 2b, defect 2).
 *
 * The result field is named `overlapFound`, NOT `safe`. This tool cannot see
 * `alter table`, `create table`, `create index` or `grant` at all, so "no
 * overlap in the classes I can read" is evidence, never clearance. A field
 * called `safe` invited callers to keep the old meaning after the printed
 * wording changed.
 *
 * @param {{objects: string[], version?: string|null}} proposed
 * @param {{label: string, objects: string[], versions?: string[], url?: string, draft?: boolean}[]} inFlight
 * @returns {{objectConflicts: object[], versionConflicts: object[], overlapFound: boolean}}
 */
export function findDispatchConflicts(proposed, inFlight) {
  const wanted = new Set((proposed.objects ?? []).map(normalizeObject))
  const objectConflicts = []
  const versionConflicts = []

  for (const holder of inFlight) {
    const overlap = (holder.objects ?? [])
      .map(normalizeObject)
      .filter((object) => wanted.has(object))
    if (overlap.length > 0) {
      objectConflicts.push({
        label: holder.label,
        url: holder.url ?? null,
        objects: [...new Set(overlap)].sort(),
      })
    }
    if (proposed.version) {
      for (const held of holder.versions ?? []) {
        if (held && String(held) === String(proposed.version)) {
          versionConflicts.push({ label: holder.label, url: holder.url ?? null, version: String(held) })
        }
      }
    }
  }

  return {
    objectConflicts,
    versionConflicts,
    overlapFound: objectConflicts.length > 0 || versionConflicts.length > 0,
  }
}

/**
 * The next free migration version, given the versions already on disk and any
 * already handed out to in-flight claims.
 *
 * ⚠️ THIS FUNCTION RESERVES NOTHING, and an earlier version of this comment
 * claimed it "kills the duplicate-timestamp class". It does not. It reads what
 * is taken and returns a candidate; between that read and anyone writing the
 * file, a second agent doing the same read gets the same answer. Only an atomic
 * create-if-absent closes that window — plan step 6 (`--reserve-version`).
 *
 * It is kept because step 6 reuses it to pick the CANDIDATE before attempting
 * the atomic reservation. Duplicate versions that slip through are still caught
 * at merge by `scripts/check-sql.sh`.
 */
export function nextFreeVersion(stamp, taken) {
  const used = new Set(taken.filter(Boolean).map(String))
  let candidate = String(stamp)
  while (used.has(candidate)) candidate = String(BigInt(candidate) + 1n)
  return candidate
}

export function formatReport({ proposed, inFlight, result }) {
  const coverage = describeCoverage()
  const lines = []
  lines.push(`Proposed task: ${proposed.task || '(unnamed)'}`)
  lines.push(`Objects it will write: ${proposed.objects.length ? proposed.objects.join(', ') : '(none — read-only)'}`)
  if (proposed.version) lines.push(`Migration version: ${proposed.version}`)
  if (inFlight.length === 0) {
    lines.push('Checked against 0 in-flight item(s) — NOTHING WAS FOUND TO COMPARE AGAINST.')
    lines.push('That is a statement about the inputs, not a clearance.')
  } else {
    lines.push(`Checked against ${inFlight.length} in-flight item(s).`)
  }
  lines.push('')

  if (!result.overlapFound) {
    const notChecked = [...coverage.notChecked]
    if (!coverage.alterModelled) notChecked.push('and every ALTER form')
    lines.push(
      'No overlap found in the object classes this tool can see.',
      `  CHECKED:     ${coverage.checked.join(', ')}`,
      `  NOT CHECKED: ${notChecked.join(', ')}`,
      '',
      'This is EVIDENCE, not clearance. The coordinator must confirm no collision',
      'in the unchecked classes before dispatching.',
    )
    return lines.join('\n')
  }

  lines.push('DO NOT DISPATCH — this task collides with work already in flight.')
  for (const conflict of result.objectConflicts) {
    lines.push('', `  Collides with ${conflict.label}${conflict.url ? ` (${conflict.url})` : ''}`)
    for (const object of conflict.objects) lines.push(`    - ${object}`)
  }
  for (const conflict of result.versionConflicts) {
    lines.push(
      '',
      `  Migration version ${conflict.version} is already held by ${conflict.label}` +
        `${conflict.url ? ` (${conflict.url})` : ''}.`,
      '    Two migrations sharing a version means one is SILENTLY SKIPPED (AGENTS.md rule 5).',
    )
  }
  lines.push(
    '',
    'What to do instead: wait for that work to merge, fold this into it, or',
    'narrow this task so it writes different objects. Dispatching anyway means',
    'one of the two sessions is thrown away.',
  )
  return lines.join('\n')
}

/**
 * The exact command that records this dispatch as a claim, so the NEXT dispatch
 * can see it. Printed rather than run: filing a claim creates a GitHub issue,
 * and this script is otherwise read-only.
 */
export function claimCommand(proposed) {
  const body = [
    '```db-claim',
    `version: ${proposed.version || 'none'}`,
    'objects:',
    ...(proposed.objects.length ? proposed.objects.map((o) => `  - ${o}`) : ['  # none — read-only task']),
    '```',
    '',
    'Close this issue when the work merges or is abandoned. An open claim blocks',
    'other agents from being dispatched onto the same objects.',
  ].join('\n')

  // A heredoc, NOT a JSON-escaped string. `--body "…\n…"` would put the two
  // literal characters backslash-n into the issue, and parseClaimBlock would
  // then reject the very claim this command just filed.
  return [
    'File the claim so the next dispatch can see it:',
    '',
    '  ⚠️ THIS RECIPE IS BASH-ONLY AND DOES NOT WORK IN POWERSHELL. Pasting it',
    '     into pwsh mangles the body, and this is a PowerShell-first machine —',
    '     which is part of why zero claims have ever been filed. Run it in Git',
    '     Bash, or write the block to a file and use `gh issue create',
    '     --body-file <path>`. Plan step 5 removes this recipe entirely: the',
    '     tool will acquire the claim itself as an atomic git ref.',
    '',
    `  gh issue create --label ${CLAIM_LABEL} \\`,
    `    --title ${JSON.stringify(proposed.task || 'db claim')} \\`,
    '    --body "$(cat <<\'CLAIM\'',
    body,
    'CLAIM',
    '    )"',
  ].join('\n')
}

/**
 * Recover the issue body from a `claimCommand` string. Exists so the tests can
 * prove the emitted command round-trips through parseClaimBlock — the bug this
 * guards against (JSON-escaped `\n` reaching the issue verbatim) was real.
 */
export function bodyFromClaimCommand(command) {
  const match = /<<'CLAIM'\n([\s\S]*?)\nCLAIM\n/.exec(command)
  return match ? match[1] : null
}

// ---------------------------------------------------------------------------
// I/O — GitHub and the working tree.
// ---------------------------------------------------------------------------

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch (error) {
    throw new Unknown(`\`gh ${args.join(' ')}\` failed: ${error.shortMessage || error.message}`)
  }
}

function ghJson(args) {
  const raw = gh(args)
  try {
    return JSON.parse(raw)
  } catch {
    throw new Unknown(`\`gh ${args.join(' ')}\` did not return JSON`)
  }
}

/** Open `db-claim` issues, as in-flight sources. */
export function gatherClaims(repo) {
  const issues = ghJson([
    'api',
    '--paginate',
    `repos/${repo}/issues?state=open&labels=${CLAIM_LABEL}&per_page=100`,
  ])
  return issues
    .filter((issue) => !issue.pull_request) // the issues API also returns PRs
    .map((issue) => {
      const parsed = parseClaimBlock(issue.body)
      if (!parsed) {
        throw new Unknown(
          `issue #${issue.number} is labelled \`${CLAIM_LABEL}\` but has no parseable ` +
            '```db-claim block. Fix or unlabel it; an unreadable claim cannot be ignored.',
        )
      }
      return {
        label: `claim #${issue.number} "${issue.title}"`,
        url: issue.html_url,
        objects: parsed.objects,
        versions: parsed.version ? [parsed.version] : [],
      }
    })
}

/**
 * Percent-encode a repository path for a GitHub API URL, one SEGMENT at a time.
 *
 * ⚠️ Do NOT switch this to `encodeURI`. `encodeURI` leaves `#` alone, so a path
 * containing one truncates at the fragment and the file silently reads as
 * empty — a false clear for that pull request's DDL. `encodeURIComponent` per
 * segment encodes `#`, and rejoining with `/` keeps the path structure.
 */
export function encodeRepoPath(filename) {
  return String(filename).split('/').map(encodeURIComponent).join('/')
}

/**
 * Every open pull request that touches migrations.
 *
 * DRAFTS ARE INCLUDED, and that differs from the merge-time guard on purpose.
 * A draft is not competing to merge, so the merge guard rightly skips it — but
 * at DISPATCH time a draft is somebody actively writing that object right now.
 * Excluding it was a false clear. Including it over-blocks, which fails safe.
 */
export function gatherOpenPrObjects(repo, io = defaultIo) {
  const open = io.listPulls(repo)
  const sources = []
  for (const pr of open) {
    const files = io.listPullFiles(repo, pr.number)
    const objects = new Set()
    const versions = new Set()
    for (const file of files) {
      if (!file.filename.startsWith(`${MIGRATIONS_DIR}/`)) continue
      if (!file.filename.endsWith('.sql')) continue
      // A file this pull request DELETES is not work in flight on that object.
      if (file.status === 'removed') continue
      const stamp = path.basename(file.filename).slice(0, 14)
      // Every migration in the pull request, not just the first: a pull request
      // carrying three migrations previously exposed one version to comparison.
      if (/^\d{14}$/.test(stamp)) versions.add(stamp)
      const sql = io.readFileAtRef(repo, file.filename, pr.head.sha)
      if (!String(sql ?? '').trim()) {
        throw new Unknown(
          `${file.filename} at ${pr.head.sha} came back EMPTY. A migration file that ` +
            'exists cannot be empty; refusing to report it as touching no objects.',
        )
      }
      for (const object of extractObjects(sql)) objects.add(object)
    }
    if (objects.size === 0 && versions.size === 0) continue
    sources.push({
      label: `PR #${pr.number}${pr.draft ? ' [DRAFT]' : ''} "${pr.title}"`,
      url: pr.html_url,
      draft: Boolean(pr.draft),
      objects: [...objects].sort(),
      versions: [...versions].sort(),
    })
  }
  return sources
}

/**
 * The real GitHub calls, isolated so the gathering LOGIC above can be unit
 * tested. `readFileAtRef` reads RAW text: the JSON Contents API used here
 * before can return a null or truncated `content` for a large file WITHOUT an
 * error, which yields an empty object set and a false clear for that pull
 * request. The raw accept header (what the merge guard already uses) has no
 * such mode.
 */
export const defaultIo = {
  listPulls: (repo) => ghJson(['api', '--paginate', `repos/${repo}/pulls?state=open&per_page=100`]),
  listPullFiles: (repo, number) =>
    ghJson(['api', '--paginate', `repos/${repo}/pulls/${number}/files?per_page=100`]),
  readFileAtRef: (repo, filename, ref) =>
    gh([
      'api',
      '-H',
      'Accept: application/vnd.github.raw',
      `repos/${repo}/contents/${encodeRepoPath(filename)}?ref=${encodeURIComponent(ref)}`,
    ]),
}

export function versionsOnDisk() {
  const dir = path.join(repoRoot, MIGRATIONS_DIR)
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.slice(0, 14))
      .filter((stamp) => /^\d{14}$/.test(stamp))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { objects: [], task: '', version: null, sql: null, json: false, allocate: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[(i += 1)]
    if (arg === '--objects') options.objects.push(...String(next()).split(',').map((s) => s.trim()).filter(Boolean))
    else if (arg === '--task') options.task = next()
    else if (arg === '--version') options.version = next()
    else if (arg === '--sql') options.sql = next()
    else if (arg === '--allocate-version') options.allocate = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Unknown(`unknown argument: ${arg}`)
  }
  return options
}

const USAGE = `
Ask BEFORE dispatching: would this task collide with work already in flight?

  node scripts/check-dispatch-collision.mjs --task "rewrite promotion fn" \\
      --objects "function plm.promote_coldlion_source_owned"

  node scripts/check-dispatch-collision.mjs --sql draft.sql

Options:
  --task <text>        Name of the task about to be dispatched (for the report).
  --objects <list>     Comma-separated objects it will WRITE, e.g.
                       "function plm.foo,table core.licensor". Repeatable.
  --sql <path>         Parse a draft migration instead of listing objects.
  --version <stamp>    The 14-digit migration version you intend to use.
  --allocate-version   WITHDRAWN — it reserved nothing. Exits 2. See below.
  --json               Machine-readable output.

Exit 0 = the check completed and found NO OVERLAP IN THE CLASSES IT CAN SEE.
         That is evidence, not clearance: the parser is blind to "alter table",
         "create table", "create index", "grant", "comment on", "create type",
         so a clear result does not mean the objects are free. The report names
         exactly what was and was not checked — read it.
Exit 1 = collision. Exit 2 = could not determine.

A task that cannot declare its objects must be dispatched READ-ONLY.
`.trim()

function main(argv) {
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

  // WITHDRAWN, deliberately BEFORE any network call so the failure is instant
  // and unmistakable. The flag read the versions in use and PRINTED a
  // suggestion; nothing was reserved between that read and anyone writing the
  // file, so two coordinators dispatching in the same minute were handed the
  // same number — the exact class its own comment claimed to have killed.
  if (options.allocate) {
    console.error('--allocate-version is WITHDRAWN. It never reserved anything.')
    console.error('')
    console.error('It read the versions already in use and printed a suggestion. Two')
    console.error('coordinators running it in the same minute both received the same')
    console.error('number, which is the duplicate-timestamp incident it claimed to prevent')
    console.error('(2026-07-22 and 2026-07-28; AGENTS.md rule 5).')
    console.error('')
    console.error('Instead: pick a version manually and rely on the `SQL migration guards`')
    console.error('check (scripts/check-sql.sh), which already blocks duplicates at merge.')
    console.error('An atomic reservation is plan step 6 (`--reserve-version`) — see')
    console.error('plan_dispatch-collision-hardening.md.')
    return 2
  }

  const repo = process.env.GITHUB_REPOSITORY || 'u2giants/shared-db'

  let objects = options.objects.map(normalizeObject)
  if (options.sql) {
    try {
      objects = [...new Set([...objects, ...extractObjects(readFileSync(options.sql, 'utf8'))])]
    } catch (error) {
      console.error(`UNKNOWN: could not read --sql ${options.sql}: ${error.message}`)
      return 2
    }
  }

  let inFlight
  try {
    inFlight = [...gatherClaims(repo), ...gatherOpenPrObjects(repo)]
  } catch (error) {
    if (!(error instanceof Unknown)) throw error
    console.error(`UNKNOWN: ${error.message}`)
    console.error('')
    console.error('Refusing to report "safe to dispatch" on inputs that could not be')
    console.error('gathered. Fix the above, or dispatch the task READ-ONLY.')
    return 2
  }

  const proposed = { task: options.task, objects: [...new Set(objects)].sort(), version: options.version }
  const result = findDispatchConflicts(proposed, inFlight)

  if (options.json) {
    console.log(JSON.stringify({ proposed, inFlight, ...result }, null, 2))
  } else {
    console.log(formatReport({ proposed, inFlight, result }))
    if (!result.overlapFound) console.log('\n' + claimCommand(proposed))
  }
  return result.overlapFound ? 1 : 0
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(main(process.argv.slice(2)))
