#!/usr/bin/env node
//
// CROSS-PR OBJECT COLLISION GUARD (HANDOFF.md backlog item B6).
//
// THE FAILURE THIS EXISTS TO CATCH — it already happened, in this repository.
//
//   On 2026-07-31 five background task chips each launched an independent
//   session. FOUR of them authored a forward migration doing
//   `create or replace function plm.promote_coldlion_source_owned(...)`, and
//   three of them picked the identical migration version 20260731170000.
//   `create or replace` replaces the WHOLE function body -- it is
//   last-writer-wins -- so merging any two of those pull requests would have
//   SILENTLY erased the other's fix. No conflict, no error, no failing test.
//
//   Every one of those pull requests passed CI on its own, because the existing
//   guards in scripts/check-sql.sh only ever see ONE branch at a time:
//     * Guard A de-duplicates migration VERSIONS within a single checkout.
//     * Guard B compares this branch's new versions against the base branch's
//       newest version.
//   Neither of them asks GitHub what any OTHER open pull request is doing.
//   That is the gap this script closes.
//
// WHAT IT DOES.
//
//   1. Extracts the set of database objects this pull request creates-or-
//      replaces from its added/modified files under supabase/migrations/.
//   2. Does the same for every OTHER open pull request, reading each one's
//      files at that pull request's own head commit.
//   3. Does the same for everything that has landed on the BASE BRANCH since
//      this pull request branched off it. (This is the B6 "stale base" rule,
//      expressed precisely: a stale base only matters when the base moved in a
//      way that touched an object this pull request also replaces. Failing
//      merely for being behind would red-X every open pull request every time
//      anything merges, which is noise, not safety.)
//   4. Fails if the same object appears in more than one of those sources.
//
// DESIGN POSTURE -- read before changing anything here.
//
//   (a) A false positive that blocks every pull request is worse than the bug
//       it prevents. This mirrors Guard B in scripts/check-sql.sh and
//       scripts/check-backlog-queue-sync.mjs: when the guard cannot gather its
//       inputs with confidence (no `gh`, no token, no pull-request context, an
//       API error) it prints a LOUD SKIPPED warning and exits 0. It never
//       guesses.
//
//   (b) It is deliberately COARSE on function overloads: it keys on
//       `function <schema>.<name>` and ignores the argument list. Two pull
//       requests replacing different overloads of one name is a collision worth
//       a human look, and parsing Postgres argument lists correctly (defaults,
//       `out` params, quoted type names) is a source of wrong answers.
//
//   (c) Comment stripping does NOT use a `$`-anchored regex, and input is
//       newline-normalised first. See HANDOFF.md backlog item B1: with CRLF
//       line endings `split("\n")` leaves a trailing "\r" on every line, `.`
//       does not match `\r`, so a `$`-anchored `/--.*$/` silently strips
//       nothing. That exact bug is live in tools/*.test.mjs today.
//
// WHAT IT CANNOT CATCH -- stated plainly, because a guard oversold is worse
// than no guard.
//
//   * Two pull requests that change the SAME object through DIFFERENT syntax it
//     does not model: `alter table`/`alter function`, `alter ... rename to`,
//     `create ... if not exists` on a table, `grant`/`revoke`, `comment on`,
//     `create rule`, column-level edits, or DDL assembled with `format()` /
//     string concatenation and run through `execute`. (`drop` + `create` IS
//     modelled -- the drop patterns emit the same keys as the create ones. A
//     plain `execute 'create or replace function ...'` string literal is also
//     matched, because string bodies are not stripped.)
//   * A function referred to UNQUALIFIED behind `set search_path`:
//     `create or replace function promote_x()` keys differently from
//     `create or replace function plm.promote_x()`, so those two do NOT
//     collide. There is no safe way to resolve a search_path statically.
//     Migrations in this repo schema-qualify by convention; this guard depends
//     on that convention holding.
//   * Two pull requests that touch DIFFERENT objects which are nonetheless
//     semantically coupled (a view and the function it calls, two migrations
//     rewriting the same table's data).
//   * DDL outside supabase/migrations/ -- e.g. SQL embedded in tools/*.mjs.
//   * A collision with a pull request opened AFTER this run. GitHub does not
//     re-run a green check when a sibling pull request appears, so the last
//     merge of a colliding set is the one that must be re-checked. Branch
//     protection requiring "up to date before merge" is what makes that
//     reliable; this guard does not substitute for it.
//   * Anything at all when it SKIPS (see posture (a)) -- read the warning.
//   * It is not evasion-proof. It is a collision DETECTOR for honest authors
//     working in parallel, not a security control. Splitting the keyword across
//     lines (`create or\nreplace function`) is handled by whitespace
//     normalisation, but a determined author can still hide DDL from it.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MIGRATION_PREFIX = 'supabase/migrations/'

// PR_OBJECT_COLLISION_PATH_PREFIX is a TEST SEAM ONLY, in the same spirit as
// CHECK_SQL_MIGRATION_DIR in scripts/check-sql.sh. It repoints the guard at a
// fixture directory so the fires/does-not-fire behaviour can be rehearsed
// end-to-end against REAL GitHub pull requests without anyone having to author
// throwaway files under supabase/migrations/. CI sets it nowhere; unset, the
// guard watches supabase/migrations/ exactly as documented above.
function pathPrefix(env = process.env) {
  return env.PR_OBJECT_COLLISION_PATH_PREFIX || MIGRATION_PREFIX
}

// ---------------------------------------------------------------------------
// Pure extraction -- unit-tested offline, no GitHub, no database.
// ---------------------------------------------------------------------------

/**
 * Remove SQL comments and collapse whitespace so multi-line DDL headers match.
 * Note the deliberate absence of a `$` anchor in the line-comment regex.
 */
export function normalizeSql(sql) {
  return String(sql)
    .replace(/\r\n?/g, '\n') // CRLF -> LF first (backlog item B1)
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .split('\n')
    .map((line) => line.replace(/--.*/, '')) // line comments, unanchored
    .join('\n')
    .replace(/\s+/g, ' ')
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`
const QUALIFIED = String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`

const PATTERNS = [
  {
    kind: 'function',
    re: new RegExp(
      String.raw`\bcreate\s+or\s+replace\s+function\s+(${QUALIFIED})`,
      'gi',
    ),
  },
  {
    kind: 'procedure',
    re: new RegExp(
      String.raw`\bcreate\s+or\s+replace\s+procedure\s+(${QUALIFIED})`,
      'gi',
    ),
  },
  {
    kind: 'view',
    re: new RegExp(
      String.raw`\bcreate\s+or\s+replace\s+(?:recursive\s+|temp\s+|temporary\s+)*view\s+(${QUALIFIED})`,
      'gi',
    ),
  },
  {
    kind: 'materialized view',
    re: new RegExp(
      String.raw`\bcreate\s+materialized\s+view\s+(?:if\s+not\s+exists\s+)?(${QUALIFIED})`,
      'gi',
    ),
  },
  {
    // A trigger name is unique per TABLE, so the table is part of its identity.
    kind: 'trigger',
    re: new RegExp(
      String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(${IDENT})\s+(?:before|after|instead\s+of)\b[\s\S]*?\son\s+(${QUALIFIED})`,
      'gi',
    ),
  },
  {
    // Likewise a policy name is unique per table.
    kind: 'policy',
    re: new RegExp(
      String.raw`\bcreate\s+policy\s+(${IDENT})\s+on\s+(${QUALIFIED})`,
      'gi',
    ),
  },
  // `drop ... ; create ...` is the other half of the same hazard, and in
  // migration practice it is MORE common than `create or replace` for views
  // (which cannot change a view's column list) . A pull request that drops an
  // object another pull request replaces is just as much a lost overwrite.
  // Added after Kimi K3's review of this pull request pointed out that only one
  // side of that pair was modelled. Keys are identical to the create side, so
  // drop-vs-replace and drop-vs-drop both collide.
  {
    kind: 'function',
    re: new RegExp(
      String.raw`\bdrop\s+function\s+(?:if\s+exists\s+)?(${QUALIFIED})`,
      'gi',
    ),
  },
  {
    kind: 'procedure',
    re: new RegExp(
      String.raw`\bdrop\s+procedure\s+(?:if\s+exists\s+)?(${QUALIFIED})`,
      'gi',
    ),
  },
  {
    kind: 'view',
    re: new RegExp(String.raw`\bdrop\s+view\s+(?:if\s+exists\s+)?(${QUALIFIED})`, 'gi'),
  },
  {
    kind: 'materialized view',
    re: new RegExp(
      String.raw`\bdrop\s+materialized\s+view\s+(?:if\s+exists\s+)?(${QUALIFIED})`,
      'gi',
    ),
  },
  {
    kind: 'trigger',
    re: new RegExp(
      String.raw`\bdrop\s+trigger\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+(${QUALIFIED})`,
      'gi',
    ),
  },
  {
    kind: 'policy',
    re: new RegExp(
      String.raw`\bdrop\s+policy\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+(${QUALIFIED})`,
      'gi',
    ),
  },
]

/**
 * Every DDL class a migration in this repo is known to use. `PATTERNS` covers a
 * SUBSET of these; the rest are the parser's blind spot, measured at ~1,921
 * unmodelled statements versus ~754 modelled (plan §3).
 *
 * Kept here, next to `PATTERNS`, so `describeCoverage()` can derive BOTH lists
 * from one place. When step 3b of plan_dispatch-collision-hardening.md teaches
 * `PATTERNS` a new kind, that kind moves from NOT CHECKED to CHECKED with no
 * other edit — the coverage report cannot silently go stale.
 */
const KNOWN_DDL_CLASSES = [
  'function',
  'procedure',
  'view',
  'materialized view',
  'trigger',
  'policy',
  'table',
  'column',
  'index',
  'grant',
  'comment',
  'type',
  'sequence',
  'schema',
]

/**
 * What the parser can and cannot see, derived from `PATTERNS` rather than
 * written down. Callers print this instead of asserting a clear result.
 *
 * `alterModelled` is derived the same way: today NO pattern contains an `alter`
 * verb at all, which is the single largest hole and must be said out loud.
 *
 * @returns {{checked: string[], notChecked: string[], alterModelled: boolean}}
 */
export function describeCoverage() {
  const checked = [...new Set(PATTERNS.map((p) => p.kind))]
  const checkedSet = new Set(checked)
  return {
    checked: checked.sort(),
    notChecked: KNOWN_DDL_CLASSES.filter((kind) => !checkedSet.has(kind)).sort(),
    alterModelled: PATTERNS.some((p) => /alter/i.test(p.re.source)),
  }
}

function canonical(raw) {
  // Split into identifier parts WITHOUT destroying whitespace inside a quoted
  // identifier (`"Weird Name"` is one legal Postgres name).
  const parts = String(raw).match(/"[^"]*"|[^.\s]+/g) ?? []
  return parts
    .map((part) => (part.startsWith('"') ? part.slice(1, -1) : part.toLowerCase()))
    .join('.')
}

/**
 * @returns {string[]} sorted, de-duplicated object keys, e.g.
 *   `function plm.promote_coldlion_source_owned`
 *   `trigger set_updated_at on public.assets`
 */
export function extractObjects(sql) {
  const text = normalizeSql(sql)
  const found = new Set()
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      if (kind === 'trigger' || kind === 'policy') {
        found.add(`${kind} ${canonical(m[1])} on ${canonical(m[2])}`)
      } else {
        found.add(`${kind} ${canonical(m[1])}`)
      }
    }
  }
  return [...found].sort()
}

/**
 * @param {{label: string, files: {path: string, sql: string}[]}[]} sources
 *   One entry per pull request (plus, optionally, one for the base branch).
 * @param {string} [primaryLabel] The label of THIS pull request. When given,
 *   only collisions that INVOLVE this pull request are `collisions` (i.e. can
 *   fail the build); collisions purely between two OTHER pull requests are
 *   returned separately as `bystanderCollisions` and reported as a note.
 *
 *   This distinction is not theoretical: the live drill for this guard opened
 *   three pull requests -- two colliding on plm.promote_coldlion_source_owned
 *   and one innocent one touching a different view -- and the first version of
 *   this function failed the INNOCENT one, because it saw the other two collide.
 *   Blocking an unrelated author over someone else's collision is exactly the
 *   false positive the design posture forbids.
 *
 * @returns {{collisions: ..., bystanderCollisions: ..., objectsBySource: Record<string, string[]>}}
 */
export function findCollisions(sources, primaryLabel) {
  /** @type {Map<string, Map<string, Set<string>>>} object -> label -> files */
  const index = new Map()
  const objectsBySource = {}

  for (const source of sources) {
    const seen = new Set()
    for (const file of source.files ?? []) {
      for (const object of extractObjects(file.sql)) {
        seen.add(object)
        if (!index.has(object)) index.set(object, new Map())
        const bySource = index.get(object)
        if (!bySource.has(source.label)) bySource.set(source.label, new Set())
        bySource.get(source.label).add(file.path)
      }
    }
    objectsBySource[source.label] = [...seen].sort()
  }

  const collisions = []
  const bystanderCollisions = []
  for (const [object, bySource] of [...index.entries()].sort()) {
    if (bySource.size < 2) continue
    const entry = {
      object,
      sources: [...bySource.entries()]
        .map(([label, files]) => ({ label, files: [...files].sort() }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }
    if (primaryLabel === undefined || bySource.has(primaryLabel)) collisions.push(entry)
    else bystanderCollisions.push(entry)
  }
  return { collisions, bystanderCollisions, objectsBySource }
}

export function formatReport({ collisions, bystanderCollisions = [] }) {
  if (collisions.length === 0) {
    const lines = ['No cross-PR object collisions detected involving this pull request.']
    for (const { object, sources } of bystanderCollisions) {
      lines.push(
        '',
        `NOTE (not a failure for this pull request): ${object} is replaced by more than`,
        'one OTHER in-flight change. Whichever of those merges second must re-derive its',
        'body on top of the first; this pull request is not involved.',
      )
      for (const { label, files } of sources) lines.push(`    - ${label}: ${files.join(', ')}`)
    }
    return lines.join('\n')
  }
  const lines = [
    'ERROR: cross-PR database object collision detected.',
    '',
    'The following object(s) are created-or-replaced by more than one in-flight',
    'change. `create or replace` replaces the WHOLE object body -- it is',
    'last-writer-wins -- so merging both would SILENTLY erase one of them.',
    '',
  ]
  for (const { object, sources } of collisions) {
    lines.push(`  ${object}`)
    for (const { label, files } of sources) {
      lines.push(`    - ${label}: ${files.join(', ')}`)
    }
    lines.push('')
  }
  lines.push(
    'HOW TO FIX: land ONE of them first, then REBASE the other onto the updated',
    'base branch and RE-DERIVE its change on top of the merged body. Do not',
    'resolve this by merging both and hoping git notices -- it will not; the two',
    'migrations are different files, so there is no textual conflict.',
    '',
    'This is HANDOFF.md backlog item B6. See AGENTS.md section 4 rule 1',
    '("one schema change in flight at a time").',
  )
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// GitHub gathering -- everything below skips loudly rather than guessing.
// ---------------------------------------------------------------------------

class Skip extends Error {}

function gh(args) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Skip(`\`gh ${args.join(' ')}\` failed: ${error.message}`)
  }
}

function ghJson(args) {
  const out = gh(args)
  try {
    return JSON.parse(out)
  } catch {
    throw new Skip(`\`gh ${args.join(' ')}\` did not return JSON`)
  }
}

function isMigration(file) {
  return (
    typeof file.filename === 'string' &&
    file.filename.startsWith(pathPrefix()) &&
    file.filename.endsWith('.sql') &&
    file.status !== 'removed'
  )
}

function fetchFiles(repo, number, ref) {
  const files = ghJson([
    'api',
    '--paginate',
    `repos/${repo}/pulls/${number}/files?per_page=100`,
  ]).filter(isMigration)
  return files.map((file) => ({
    path: file.filename,
    sql: gh([
      'api',
      '-H',
      'Accept: application/vnd.github.raw',
      `repos/${repo}/contents/${encodeURI(file.filename)}?ref=${ref}`,
    ]),
  }))
}

/**
 * The compare endpoint that answers "what landed on the base branch since this
 * pull request branched off it".
 *
 * MUST be `<headSha>...<baseRef>`, never `<base.sha>...<baseRef>`. GitHub's
 * three-dot compare starts from merge-base(head, base) -- the real branch point.
 * `pull_request.base.sha` is NOT the branch point: it is the base branch's tip
 * at the time of the event, so `base.sha...baseRef` compares the base branch to
 * (very nearly) itself and returns an empty file list. The first version of this
 * script used exactly that, which made the whole base-branch leg dead code; the
 * defect was found by Kimi K3's review of this pull request and confirmed
 * against the live API (`merge_base_commit.sha` of `<headSha>...main` returns
 * the branch point, `base.sha` does not).
 */
export function baseCompareSpec(repo, headSha, baseRef) {
  return `repos/${repo}/compare/${headSha}...${baseRef}`
}

function baseBranchSource(repo, baseRef, headSha) {
  const compare = ghJson(['api', baseCompareSpec(repo, headSha, baseRef)])
  const files = (compare.files ?? []).filter(isMigration)
  if (files.length === 0) return null
  return {
    label: `${baseRef} (merged since this PR branched)`,
    files: files.map((file) => ({
      path: file.filename,
      sql: gh([
        'api',
        '-H',
        'Accept: application/vnd.github.raw',
        `repos/${repo}/contents/${encodeURI(file.filename)}?ref=${baseRef}`,
      ]),
    })),
  }
}

export function gatherSources(env = process.env) {
  const repo = env.GITHUB_REPOSITORY
  if (!repo) throw new Skip('GITHUB_REPOSITORY is not set')

  let number = env.PR_NUMBER ? Number(env.PR_NUMBER) : undefined
  let baseRef
  let baseSha
  let headSha
  if (env.GITHUB_EVENT_PATH) {
    try {
      const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
      if (event.pull_request) {
        number ??= event.pull_request.number
        baseRef = event.pull_request.base?.ref
        baseSha = event.pull_request.base?.sha
        headSha = event.pull_request.head?.sha
      }
    } catch {
      /* fall through to the explicit checks below */
    }
  }
  if (!number) throw new Skip('not running on a pull request (no PR number)')

  if (!baseRef || !baseSha || !headSha) {
    const pr = ghJson(['api', `repos/${repo}/pulls/${number}`])
    baseRef ??= pr.base?.ref
    baseSha ??= pr.base?.sha
    headSha ??= pr.head?.sha
  }

  const sources = [
    { label: `PR #${number} (this PR)`, files: fetchFiles(repo, number, headSha) },
  ]

  const open = ghJson([
    'api',
    '--paginate',
    `repos/${repo}/pulls?state=open&per_page=100`,
  ])
  for (const pr of open) {
    if (pr.number === Number(number)) continue
    if (pr.draft) continue // a draft is not competing to merge yet
    sources.push({
      label: `PR #${pr.number} "${pr.title}"`,
      files: fetchFiles(repo, pr.number, pr.head?.sha ?? pr.head?.ref),
    })
  }

  if (baseRef && headSha) {
    const base = baseBranchSource(repo, baseRef, headSha)
    if (base) sources.push(base)
  }

  return sources
}

function main() {
  let sources
  try {
    sources = gatherSources()
  } catch (error) {
    if (!(error instanceof Skip)) throw error
    console.warn('WARNING: cross-PR object collision guard SKIPPED --', error.message)
    console.warn('No collision checking was performed. This is deliberate: a guard')
    console.warn('that cannot gather its inputs must not guess. See B6 in HANDOFF.md.')
    return 0
  }

  // Only a collision that INVOLVES this pull request may fail it.
  const result = findCollisions(sources, sources[0].label)
  console.log('Sources inspected:')
  for (const source of sources) {
    const objects = result.objectsBySource[source.label] ?? []
    console.log(`  ${source.label}: ${objects.length ? objects.join('; ') : 'no create-or-replace DDL'}`)
  }
  console.log('')
  const report = formatReport(result)
  if (result.collisions.length > 0) {
    console.error(report)
    return 1
  }
  console.log(report)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // pathToFileURL, never a hand-built `file://` string -- see AGENTS.md 10.3.
  process.exit(main())
}

export const __repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
