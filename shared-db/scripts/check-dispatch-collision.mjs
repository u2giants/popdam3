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
//   A false "safe to dispatch" is the dangerous answer, so anything this script
//   cannot determine is reported as UNKNOWN and exits non-zero. It never
//   guesses in the reassuring direction. Conversely it makes no network call at
//   all in --offline mode, so the pure logic stays unit-testable.
//
// NO DATABASE CONTACT: reads GitHub metadata and committed .sql text only.
// It needs no database credentials and must never be given any.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { extractObjects } from './check-pr-object-collisions.mjs'

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
 * @param {{objects: string[], version?: string|null}} proposed
 * @param {{label: string, objects: string[], version?: string|null, url?: string}[]} inFlight
 * @returns {{objectConflicts: object[], versionConflicts: object[], safe: boolean}}
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
    if (proposed.version && holder.version && proposed.version === holder.version) {
      versionConflicts.push({ label: holder.label, url: holder.url ?? null, version: holder.version })
    }
  }

  return {
    objectConflicts,
    versionConflicts,
    safe: objectConflicts.length === 0 && versionConflicts.length === 0,
  }
}

/**
 * The next free migration version, given the versions already on disk and any
 * already handed out to in-flight claims.
 *
 * Allocating this AT DISPATCH is what kills the duplicate-timestamp class. Two
 * incidents (2026-07-22, 2026-07-28) and one four-way worktree collision all
 * came from each agent independently choosing `now()`; agents dispatched in the
 * same minute choose the same number. See AGENTS.md rule 5.
 */
export function nextFreeVersion(stamp, taken) {
  const used = new Set(taken.filter(Boolean).map(String))
  let candidate = String(stamp)
  while (used.has(candidate)) candidate = String(BigInt(candidate) + 1n)
  return candidate
}

export function formatReport({ proposed, inFlight, result }) {
  const lines = []
  lines.push(`Proposed task: ${proposed.task || '(unnamed)'}`)
  lines.push(`Objects it will write: ${proposed.objects.length ? proposed.objects.join(', ') : '(none — read-only)'}`)
  if (proposed.version) lines.push(`Migration version: ${proposed.version}`)
  lines.push(`Checked against ${inFlight.length} in-flight item(s).`)
  lines.push('')

  if (result.safe) {
    lines.push('SAFE TO DISPATCH — no in-flight work touches these objects.')
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
        version: parsed.version,
      }
    })
}

/** Open, non-draft pull requests that touch migrations. */
export function gatherOpenPrObjects(repo) {
  const open = ghJson(['api', '--paginate', `repos/${repo}/pulls?state=open&per_page=100`])
  const sources = []
  for (const pr of open) {
    if (pr.draft) continue
    const files = ghJson(['api', '--paginate', `repos/${repo}/pulls/${pr.number}/files?per_page=100`])
    const objects = new Set()
    let version = null
    for (const file of files) {
      if (!file.filename.startsWith(`${MIGRATIONS_DIR}/`)) continue
      if (!file.filename.endsWith('.sql')) continue
      const stamp = path.basename(file.filename).slice(0, 14)
      if (/^\d{14}$/.test(stamp)) version ??= stamp
      const content = ghJson(['api', `repos/${repo}/contents/${file.filename}?ref=${pr.head.sha}`])
      const sql = Buffer.from(content.content ?? '', 'base64').toString('utf8')
      for (const object of extractObjects(sql)) objects.add(object)
    }
    if (objects.size === 0 && !version) continue
    sources.push({
      label: `PR #${pr.number} "${pr.title}"`,
      url: pr.html_url,
      objects: [...objects].sort(),
      version,
    })
  }
  return sources
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

  node scripts/check-dispatch-collision.mjs --sql draft.sql --allocate-version

Options:
  --task <text>        Name of the task about to be dispatched (for the report).
  --objects <list>     Comma-separated objects it will WRITE, e.g.
                       "function plm.foo,table core.licensor". Repeatable.
  --sql <path>         Parse a draft migration instead of listing objects.
  --version <stamp>    The 14-digit migration version you intend to use.
  --allocate-version   Print the next free version instead of supplying one.
  --json               Machine-readable output.

Exit 0 = safe to dispatch. Exit 1 = collision. Exit 2 = could not determine.

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

  let version = options.version
  if (options.allocate) {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
    version = nextFreeVersion(stamp, [...versionsOnDisk(), ...inFlight.map((s) => s.version)])
  }

  const proposed = { task: options.task, objects: [...new Set(objects)].sort(), version }
  const result = findDispatchConflicts(proposed, inFlight)

  if (options.json) {
    console.log(JSON.stringify({ proposed, inFlight, ...result }, null, 2))
  } else {
    console.log(formatReport({ proposed, inFlight, result }))
    if (result.safe && version) console.log(`\nAllocated migration version: ${version}`)
    if (result.safe) console.log('\n' + claimCommand(proposed))
  }
  return result.safe ? 0 : 1
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(main(process.argv.slice(2)))
