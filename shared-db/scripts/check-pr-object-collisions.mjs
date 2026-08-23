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
//       API error) it prints a loud error and exits 2. It never
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
//     merge of a colliding set is the one that must be re-checked.
//
//     WHAT PROVIDES THAT RE-CHECK -- corrected 2026-08-23, issue #1366. Earlier
//     text here credited branch protection's "up to date before merge"
//     (`required_status_checks.strict`). That is wrong and it is load-bearing
//     wrong: `strict` is deliberately FALSE by Albert's 2026-08-19 ruling in
//     issue #1286 (strict mode restarted every check suite after every unrelated
//     merge, ~50 minutes/day). The actual re-check for a migration pull request
//     is `.github/workflows/guarded-migration-merge.yml`, which re-runs collision
//     and lease validation on a head containing current `main` while holding the
//     merge lock; a pull request with no migrations is auto-authorized by
//     `.github/workflows/migration-author-lease.yml`. This script is a DETECTOR
//     that gives early feedback; guarded merge is the gate. Do not restore strict
//     mode on the strength of this comment.
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

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`
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

export function canonicalIdentifierParts(raw) {
  // Split into identifier parts WITHOUT destroying whitespace inside a quoted
  // identifier (`"Weird Name"` is one legal Postgres name).
  const text = String(raw)
  const parts = []
  const token = /\s*("(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)\s*(\.|$)/y
  let offset = 0
  while (offset < text.length) {
    token.lastIndex = offset
    const match = token.exec(text)
    if (!match || (match[2] === '.' && token.lastIndex === text.length)) return []
    if (match[1].startsWith('"')) {
      const value = match[1].slice(1, -1).replace(/""/g, '"')
      // PostgreSQL folds an unquoted identifier to lowercase. A quoted name
      // that is already a legal lowercase unquoted identifier therefore names
      // the same object and must use the same collision key.
      parts.push(/^[a-z_][a-z0-9_$]*$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`)
    } else {
      parts.push(match[1].toLowerCase())
    }
    offset = token.lastIndex
    if (!match[2]) break
  }
  return offset === text.length ? parts : []
}

export function canonicalIdentifier(raw) {
  return canonicalIdentifierParts(raw).join('.')
}

function canonical(raw) {
  return canonicalIdentifier(raw)
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

// ---------------------------------------------------------------------------
// BROAD EXTRACTION FOR THE DISPATCH POLICY (plan step 3b).
//
// ONE PARSER FILE, TWO POLICIES — and the split matters more than it looks.
//
//   `PATTERNS` / `extractObjects` above model WHOLE-OBJECT REPLACEMENT, and the
//   merge guard's failure messages are written in those terms ("one of these
//   bodies would be silently overwritten"). Widening `PATTERNS` would make that
//   guard's own explanations false, and it is a REQUIRED check on `main`, so a
//   noisier version of it is the alarm-fatigue disease this workstream exists
//   to cure (plan step 3a).
//
//   So NOTHING above this line changed. `DISPATCH_PATTERNS` is the broader policy used
//   ONLY by the dispatch-time check, whose policy is deliberately broader: any
//   write to the same target collides. It over-blocks, which fails safe, and it
//   costs a coordinator a conversation rather than an agent a whole session.
//
//   Because the merge guard's inputs are untouched, step 3a's acceptance rule
//   ("if >20% of historical concurrent sets produce a new NOISY merge-guard
//   failure, the merge guard keeps its narrow policy") is satisfied BY
//   CONSTRUCTION: the merge guard cannot produce ANY new failure, noisy or
//   otherwise. See docs/verification/dispatch-parser-noise-gate-20260812.md.
//
// The blind spot being closed: `alter table`, `create table`, `create index`,
// `grant`, `comment on` and `create type` were invisible to the dispatch check.
// A migration doing nothing but `alter table core.licensor add column ...`
// reported as touching NO OBJECTS, which read as a clear.
// ---------------------------------------------------------------------------

/**
 * Split a possibly-qualified raw identifier into canonical dotted parts.
 * Quoted identifiers keep their case and any internal whitespace.
 */
function canonicalParts(raw) {
  return canonicalIdentifierParts(raw)
}

/** `core.t.c` -> { table: 'core.t', column: 'core.t.c' }; unqualified -> null table. */
function splitColumnTarget(raw) {
  const parts = canonicalParts(raw)
  if (parts.length < 2) return { table: null, column: parts.join('.') }
  return { table: parts.slice(0, -1).join('.'), column: parts.join('.') }
}

const NOT_ON = String.raw`(?!on\s)`

/**
 * Every DDL shape the DISPATCH policy understands. Each entry produces zero or
 * more `{ action, kind, target }` operations from one regex match.
 *
 * `kinds` is declared per entry rather than inferred, so `describeDispatchCoverage()`
 * can derive CHECKED/NOT CHECKED from this list alone and can never go stale.
 */
const DISPATCH_PATTERNS = [
  // --- tables -------------------------------------------------------------
  {
    kinds: ['table'],
    re: new RegExp(
      String.raw`\bcreate\s+(?:global\s+|local\s+|unlogged\s+)*table\s+(?:if\s+not\s+exists\s+)?(${QUALIFIED})`,
      'gi',
    ),
    map: (m) => [{ action: 'create', kind: 'table', target: canonical(m[1]) }],
  },
  // NOTE the deliberate absence of `temp`/`temporary` above. A TEMP table is
  // session-local scratch space living inside a function body — this repo's
  // promotion functions all create one called `coldlion_promote_rows`. It is
  // not a shared object, so two agents "sharing" one is not a collision, and
  // emitting it would have flagged half the coldlion migrations against each
  // other. Excluding it is the difference between a signal and alarm fatigue.
  {
    kinds: ['table'],
    re: new RegExp(
      String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?(${QUALIFIED})`,
      'gi',
    ),
    map: (m) => [{ action: 'drop', kind: 'table', target: canonical(m[1]) }],
  },
  {
    // `alter table` in ALL its forms. Per plan D9 this is TABLE-level: every
    // alter on a table yields the same key regardless of which column it
    // touches. Two agents altering different columns of one table are blocked.
    // That over-blocks on purpose — column-level identity would let the far
    // worse case (both rewriting the same column) slip through on a typo.
    kinds: ['table'],
    re: new RegExp(
      String.raw`\balter\s+(?:foreign\s+)?table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QUALIFIED})`,
      'gi',
    ),
    map: (m) => [{ action: 'alter', kind: 'table', target: canonical(m[1]) }],
  },
  {
    // RENAME and SET SCHEMA carry TWO identities. Emitting only the old one
    // lets a second agent claim the new name and collide invisibly.
    kinds: ['table'],
    re: new RegExp(
      String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QUALIFIED})\s+rename\s+to\s+(${IDENT})`,
      'gi',
    ),
    map: (m) => {
      const from = canonicalParts(m[1])
      const to = canonicalParts(m[2])
      const schema = from.length > 1 ? from.slice(0, -1).join('.') : null
      return [{ action: 'rename', kind: 'table', target: schema ? `${schema}.${to.join('.')}` : to.join('.') }]
    },
  },
  {
    kinds: ['table'],
    re: new RegExp(
      String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QUALIFIED})\s+set\s+schema\s+(${IDENT})`,
      'gi',
    ),
    map: (m) => {
      const name = canonicalParts(m[1]).slice(-1).join('.')
      return [{ action: 'set_schema', kind: 'table', target: `${canonicalParts(m[2]).join('.')}.${name}` }]
    },
  },

  // --- indexes ------------------------------------------------------------
  {
    // Emits BOTH the index and its owning table: an index is a write to the
    // table (it takes a lock and changes its plan), and two agents adding
    // differently-named indexes to one table is still work worth serializing.
    kinds: ['index', 'table'],
    re: new RegExp(
      String.raw`\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(${NOT_ON}${IDENT}\s+)?on\s+(?:only\s+)?(${QUALIFIED})`,
      'gi',
    ),
    map: (m) => {
      const table = canonical(m[2])
      const ops = [{ action: 'create', kind: 'table', target: table }]
      if (m[1]) {
        let index = canonical(m[1].trim())
        if (!index.includes('.') && table.includes('.')) index = `${table.split('.')[0]}.${index}`
        ops.push({ action: 'create', kind: 'index', target: index })
      }
      return ops
    },
  },
  {
    // `drop index x` usually CANNOT recover the owning table from the SQL
    // alone, so the index is all that is emitted. Said out loud rather than
    // guessed at: a guessed table would be a false collision, and an assumed
    // absence would be a false clear.
    kinds: ['index'],
    re: new RegExp(
      String.raw`\bdrop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?(${QUALIFIED})`,
      'gi',
    ),
    map: (m) => [{ action: 'drop', kind: 'index', target: canonical(m[1]) }],
  },

  {
    // Real in this repo (3 statements). The noun-based check in
    // `inventoryDdlVerbs` would have called `alter index` modelled merely
    // because `index` is a known kind, so without this pattern the inventory
    // reported a blind spot as covered.
    kinds: ['index'],
    re: new RegExp(String.raw`\balter\s+index\s+(?:if\s+exists\s+)?(${QUALIFIED})`, 'gi'),
    map: (m) => [{ action: 'alter', kind: 'index', target: canonical(m[1]) }],
  },

  // --- privileges ---------------------------------------------------------
  {
    // `grant`/`revoke` do NOT always target a table (plan step 3b, Codex's
    // note). The object-type keyword is optional in Postgres and defaults to
    // TABLE, so its absence means table -- but `on schema`, `on sequence`,
    // `on function` must keep their own kind or a grant on a schema would
    // collide with a table of the same name.
    kinds: ['grant', 'table', 'sequence', 'schema', 'function', 'procedure', 'type'],
    re: new RegExp(
      // The two negative lookaheads are both real defects found by replaying
      // this parser over 400 merged pull requests:
      //   `(?!all\s)`  — `on all tables in schema s` extracted a table named
      //                  "all". Its own pattern below handles that form.
      //   `(?!(?:tables|sequences|functions|routines|procedures)\s)` — the
      //                  `alter default privileges … grant all ON TABLES to r`
      //                  form has no object name at all; without this it
      //                  extracted a table literally named "tables", which
      //                  appeared in 5 migrations.
      String.raw`\b(?:grant|revoke)\b[^;]*?\son\s+(?!all\s)(?!(?:tables|sequences|functions|routines|procedures)\s)(?:(table|sequence|schema|function|procedure|routine|type|domain)\s+)?(${QUALIFIED})`,
      'gi',
    ),
    map: (m) => {
      const target = canonical(m[2])
      // PRECISION RULE, not a swallowed failure: when the object-type keyword is
      // absent the target must be SCHEMA-QUALIFIED to be believed. English prose
      // reaches this pattern whenever a `comment on … is '…'` string cannot be
      // stripped cleanly (one migration says "roles do not grant read on their
      // own", yielding a table named "their"). Every real grant in this repo's
      // 437 migrations is schema-qualified, so requiring the dot costs nothing
      // and removes the last phantom. An EXPLICIT keyword is still trusted
      // unqualified, because `grant usage on schema plm` is unambiguous.
      if (!m[1] && !target.includes('.')) return []
      const raw = (m[1] || 'table').toLowerCase()
      // `routine` is Postgres's umbrella for function+procedure; a grant
      // written either way must collide with the other.
      const kinds = raw === 'routine' ? ['function', 'procedure'] : [raw === 'domain' ? 'type' : raw]
      return kinds.map((kind) => ({ action: 'grant', kind, target }))
    },
  },
  {
    // `grant ... on all tables in schema s` touches every table in the schema.
    // Modelled as a write to the SCHEMA: enumerating the tables would need the
    // live database, which this tool must never contact.
    kinds: ['grant', 'schema'],
    re: new RegExp(
      String.raw`\b(?:grant|revoke)\b[^;]*?\son\s+all\s+(?:tables|sequences|functions|procedures|routines)\s+in\s+schema\s+(${IDENT})`,
      'gi',
    ),
    map: (m) => [{ action: 'grant', kind: 'schema', target: canonical(m[1]) }],
  },
  {
    kinds: ['schema'],
    re: new RegExp(
      String.raw`\balter\s+default\s+privileges\b[^;]*?\sin\s+schema\s+(${IDENT})`,
      'gi',
    ),
    map: (m) => [{ action: 'alter', kind: 'schema', target: canonical(m[1]) }],
  },

  // --- comments -----------------------------------------------------------
  {
    // `comment on column core.t.c` must ALSO collide with work on `core.t`
    // (plan step 3b). The column key alone would let a table rewrite and a
    // column comment run concurrently and lose one.
    kinds: ['comment', 'column', 'table'],
    re: new RegExp(String.raw`\bcomment\s+on\s+column\s+(${QUALIFIED}(?:\s*\.\s*${IDENT})?)`, 'gi'),
    map: (m) => {
      const { table, column } = splitColumnTarget(m[1])
      const ops = [{ action: 'comment', kind: 'column', target: column }]
      if (table) ops.push({ action: 'comment', kind: 'table', target: table })
      return ops
    },
  },
  {
    kinds: ['comment', 'table', 'view', 'materialized view', 'function', 'procedure', 'type', 'schema', 'index', 'sequence'],
    re: new RegExp(
      String.raw`\bcomment\s+on\s+(table|view|materialized\s+view|function|procedure|type|domain|schema|index|sequence)\s+(${QUALIFIED})`,
      'gi',
    ),
    map: (m) => {
      const raw = m[1].toLowerCase().replace(/\s+/g, ' ')
      return [{ action: 'comment', kind: raw === 'domain' ? 'type' : raw, target: canonical(m[2]) }]
    },
  },

  // --- types, sequences, schemas -----------------------------------------
  {
    kinds: ['type'],
    re: new RegExp(
      String.raw`\b(?:create|alter|drop)\s+(?:type|domain)\s+(?:if\s+exists\s+)?(${QUALIFIED})`,
      'gi',
    ),
    map: (m) => [{ action: 'write', kind: 'type', target: canonical(m[1]) }],
  },
  {
    kinds: ['sequence'],
    re: new RegExp(
      String.raw`\b(?:create|alter|drop)\s+(?:temp\s+|temporary\s+)*sequence\s+(?:if\s+not\s+exists\s+|if\s+exists\s+)?(${QUALIFIED})`,
      'gi',
    ),
    map: (m) => [{ action: 'write', kind: 'sequence', target: canonical(m[1]) }],
  },
  {
    kinds: ['schema'],
    re: new RegExp(
      String.raw`\b(?:create|drop)\s+schema\s+(?:if\s+not\s+exists\s+|if\s+exists\s+)?(${IDENT})`,
      'gi',
    ),
    map: (m) => [{ action: 'write', kind: 'schema', target: canonical(m[1]) }],
  },

  // --- alter forms of the classes the merge guard already models ----------
  {
    kinds: ['function'],
    re: new RegExp(String.raw`\balter\s+function\s+(${QUALIFIED})`, 'gi'),
    map: (m) => [{ action: 'alter', kind: 'function', target: canonical(m[1]) }],
  },
  {
    kinds: ['procedure'],
    re: new RegExp(String.raw`\balter\s+procedure\s+(${QUALIFIED})`, 'gi'),
    map: (m) => [{ action: 'alter', kind: 'procedure', target: canonical(m[1]) }],
  },
  {
    kinds: ['view'],
    re: new RegExp(String.raw`\balter\s+view\s+(${QUALIFIED})`, 'gi'),
    map: (m) => [{ action: 'alter', kind: 'view', target: canonical(m[1]) }],
  },
  {
    kinds: ['materialized view'],
    re: new RegExp(String.raw`\balter\s+materialized\s+view\s+(${QUALIFIED})`, 'gi'),
    map: (m) => [{ action: 'alter', kind: 'materialized view', target: canonical(m[1]) }],
  },
  {
    kinds: ['view'],
    re: new RegExp(
      String.raw`\bcreate\s+(?:or\s+replace\s+)?view\s+(?:if\s+not\s+exists\s+)?(${QUALIFIED})`,
      'gi',
    ),
    map: (m) => [{ action: 'create', kind: 'view', target: canonical(m[1]) }],
  },
  {
    // `alter policy n on t` needs BOTH identities (plan step 3b).
    kinds: ['policy', 'table'],
    re: new RegExp(String.raw`\balter\s+policy\s+(${IDENT})\s+on\s+(${QUALIFIED})`, 'gi'),
    map: (m) => [
      { action: 'alter', kind: 'policy', target: `${canonical(m[1])} on ${canonical(m[2])}` },
      { action: 'alter', kind: 'table', target: canonical(m[2]) },
    ],
  },
  {
    kinds: ['trigger', 'table'],
    re: new RegExp(String.raw`\balter\s+trigger\s+(${IDENT})\s+on\s+(${QUALIFIED})`, 'gi'),
    map: (m) => [
      { action: 'alter', kind: 'trigger', target: `${canonical(m[1])} on ${canonical(m[2])}` },
      { action: 'alter', kind: 'table', target: canonical(m[2]) },
    ],
  },
]

/** PostgreSQL accepts both `DO $$...$$` and `DO LANGUAGE plpgsql $tag$...$tag$`. */
function dollarQuoteStartsDo(source, offset) {
  return /\bdo(?:\s+language\s+[a-z_][a-z0-9_$]*)?\s*$/i.test(source.slice(0, offset))
}

/**
 * The DISPATCH-policy view of a migration: structured operations rather than
 * flat strings, so a consumer can reason about `action` and `kind` separately.
 *
 * Combines the merge guard's whole-object patterns with the broader dispatch
 * patterns. The two policies overlap, but neither result is promised to be a
 * strict superset of the other because dispatch deliberately ignores dynamic
 * function-body SQL while retaining literal DDL inside `DO` blocks.
 *
 * @returns {{action: string, kind: string, target: string}[]}
 */
export function extractOperations(sql) {
  // DOLLAR-QUOTED BODIES AND STRING LITERALS ARE STRIPPED FIRST, in that order,
  // and this is load-bearing rather than tidying. Every phantom target found
  // while replaying this parser over 400 merged pull requests came from text
  // that only LOOKS like DDL:
  //
  //   `execute 'alter table if exists %s enable row level security'` -> table if
  //   the literal 'CREATE TABLE AS' used as a comparison value       -> table as
  //   'create trigger %I ... on plm.%I'                              -> table plm
  //   prose: '... do not grant read on their own ...'                -> table their
  //
  // The order matters. Stripping single quotes alone left these behind, because
  // apostrophes inside `$$ … $$` function bodies unbalance quote pairing across
  // the whole file and shift every pair after them. Bodies go first.
  //
  // Function bodies remain excluded, but a top-level `DO $$ ... $$` block is
  // different: this repository uses literal DDL inside those blocks as its
  // normal idempotent migration form. Keep the body so those writes are seen.
  const text = normalizeSql(sql)
    .replace(/\$([A-Za-z_]*)\$([\s\S]*?)\$\1\$/g, (whole, _tag, body, offset, source) =>
      dollarQuoteStartsDo(source, offset) ? body : ' ')
    .replace(/'(?:[^']|'')*'/g, " '' ")
  const seen = new Map()
  // Bare SQL keywords are never object names. They appear when an upstream
  // regex over-reaches across statement boundaries, and emitting `table table`
  // would let two unrelated pull requests "collide" on a keyword.
  const KEYWORDS = new Set(['table', 'tables', 'function', 'functions', 'routine', 'routines',
    'sequence', 'sequences', 'view', 'schema', 'index', 'if', 'as', 'only', 'exists', 'all'])
  const add = (op) => {
    if (!op.target) return
    if (KEYWORDS.has(op.target)) return
    seen.set(`${op.action}|${op.kind}|${op.target}`, op)
  }

  // The narrow, whole-object-replacement classes, reusing the SAME regexes the
  // merge guard uses so the two can never disagree about them.
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      if (kind === 'trigger' || kind === 'policy') {
        add({ action: 'replace', kind, target: `${canonical(m[1])} on ${canonical(m[2])}` })
        // The table is part of that object's identity, so work on the table
        // collides with work on its trigger or policy.
        add({ action: 'replace', kind: 'table', target: canonical(m[2]) })
      } else {
        add({ action: 'replace', kind, target: canonical(m[1]) })
      }
    }
  }

  for (const { re, map } of DISPATCH_PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) for (const op of map(m)) add(op)
  }

  return [...seen.values()].sort((a, b) =>
    `${a.kind} ${a.target} ${a.action}`.localeCompare(`${b.kind} ${b.target} ${b.action}`),
  )
}

/**
 * The dispatch policy's comparison keys: `"<kind> <target>"`, the same shape a
 * coordinator hand-types into `--objects` and into a `db-claim` block.
 *
 * The ACTION is deliberately dropped here. Under the dispatch policy any write
 * to a target collides with any other write to it, so `alter table core.x` and
 * `create table core.x` must produce the identical key `table core.x`.
 */
export function dispatchObjectKeys(sql) {
  return [...new Set(extractOperations(sql).map((op) => `${op.kind} ${op.target}`))].sort()
}

/**
 * Coverage for the DISPATCH policy, derived from `DISPATCH_PATTERNS` + `PATTERNS`
 * so it cannot drift from what the code actually reads.
 *
 * @returns {{checked: string[], notChecked: string[], alterModelled: boolean}}
 */
export function describeDispatchCoverage() {
  const checked = new Set(PATTERNS.map((p) => p.kind))
  for (const entry of DISPATCH_PATTERNS) for (const kind of entry.kinds) checked.add(kind)
  return {
    checked: [...checked].sort(),
    notChecked: KNOWN_DDL_CLASSES.filter((kind) => !checked.has(kind)).sort(),
    alterModelled: DISPATCH_PATTERNS.some((p) => /alter/i.test(p.re.source)),
  }
}

/**
 * Leading DDL verbs found across a body of migration SQL, and whether the
 * DISPATCH parser models each one.
 *
 * THIS IS THE ANTI-REGRESSION MEASUREMENT. Nothing in this repo would have
 * noticed a NEW large blind class appearing — that is how a parser blind to
 * `alter table` shipped behind a green build for weeks. The sibling test walks
 * every file in supabase/migrations/ through this and fails if an unmodelled
 * verb exceeds its threshold.
 *
 * @returns {{verb: string, count: number, modelled: boolean}[]} busiest first
 */
export function inventoryDdlVerbs(sqlTexts) {
  const counts = new Map()
  for (const sql of sqlTexts) {
    // STATEMENT-LEADING verbs only. Scanning the whole text for the word "drop"
    // counted English prose inside `raise notice '… values drop beyond
    // threshold'` as DDL and produced junk classes like "drop beyond" — noise
    // that would have made this measurement useless, and useless measurements
    // get deleted. String literals and `$$ … $$` bodies go first for the same
    // reason: DDL nested inside a function body is not the axis two agents
    // collide on, and its prose is pure noise here. Literal DDL inside a
    // top-level DO block is retained because it changes shared objects.
    const text = normalizeSql(sql)
      .replace(/\$([A-Za-z_]*)\$([\s\S]*?)\$\1\$/g, (whole, _tag, body, offset, source) =>
        dollarQuoteStartsDo(source, offset) ? body : ' ')
      .replace(/'(?:[^']|'')*'/g, ' ')
    for (const statement of text.split(';')) {
      const m = /(?:^|\bbegin\s+|\bthen\s+)\s*(create|alter|drop|grant|revoke|comment)\s+((?:or\s+replace\s+|if\s+(?:not\s+)?exists\s+|unique\s+|concurrently\s+|only\s+|materialized\s+|recursive\s+|temp\s+|temporary\s+|global\s+|local\s+|unlogged\s+|foreign\s+|constraint\s+|default\s+)*)([a-z_]+)/i.exec(
        statement,
      )
      if (!m) continue
      // `materialized view` and `default privileges` are two-word object names;
      // the modifier group swallowed the first word, so put it back.
      const modifiers = m[2].toLowerCase()
      let noun = m[3].toLowerCase()
      if (/\bmaterialized\s+$/.test(modifiers)) noun = `materialized ${noun}`
      if (/\bdefault\s+$/.test(modifiers)) noun = `default ${noun}`
      const verb = `${m[1].toLowerCase()} ${noun}`
      counts.set(verb, (counts.get(verb) ?? 0) + 1)
    }
  }

  const modelledKinds = new Set(describeDispatchCoverage().checked)
  return [...counts.entries()]
    .map(([verb, count]) => {
      const noun = verb.slice(verb.indexOf(' ') + 1)
      const modelled =
        modelledKinds.has(noun) ||
        // `grant`/`revoke` name a privilege, and `comment on <kind>` names its
        // kind after the `on`; both are resolved by the patterns above rather
        // than by the noun this crude scan sees.
        /^(grant|revoke|comment)\b/.test(verb) ||
        DISPATCH_MODELLED_EXTRA_FORMS.has(verb)
      return {
        verb,
        count,
        modelled,
        acknowledged: modelled || Object.prototype.hasOwnProperty.call(DISPATCH_UNMODELLED_FORMS, verb),
      }
    })
    .sort((a, b) => b.count - a.count)
}

/** Statement forms the patterns above DO handle but whose noun is not a kind name. */
const DISPATCH_MODELLED_EXTRA_FORMS = new Set(['alter default privileges'])

/**
 * Statement forms this parser knowingly does NOT model, each with the reason.
 *
 * THIS IS NOT AN ALLOWLIST FOR CONVENIENCE. The sibling test fails on any DDL
 * form found in `supabase/migrations/` that is neither modelled nor listed
 * here, so a NEW blind class cannot appear silently — which is exactly how the
 * `alter table` blind spot survived behind a green build. Adding an entry here
 * is a deliberate, reviewed decision that this form is not a collision axis,
 * and it must carry a reason.
 */
export const DISPATCH_UNMODELLED_FORMS = {
  'create extension':
    'Extensions are database-global and idempotent (`if not exists`). Two agents ' +
    'enabling the same extension is a no-op, not a lost overwrite.',
  'drop extension':
    'Database-global like `create extension`, and not a schema object two agents ' +
    'can each author a body for. Nothing here to overwrite.',
  'alter publication':
    'Supabase realtime publication membership. A genuine shared resource, but it is ' +
    'ADDITIVE (`add table`) rather than whole-object replacement, so two agents adding ' +
    'different tables do not overwrite each other. Revisit if a migration ever does ' +
    '`set table`, which IS destructive.',
  'create publication':
    'Database-global Supabase realtime plumbing, created once. Two agents creating ' +
    'the same publication is a hard error at apply time, not a silent overwrite.',
  'alter role':
    'Roles are cluster-global and managed by Supabase, not by this repo. A migration ' +
    'touching one is already outside the object model this tool compares.',
  'create role':
    'Roles are cluster-global and provisioned by Supabase, not owned by this repo. ' +
    'A migration creating one is outside the schema-object model compared here.',
  'create event': 'Event triggers are database-global, not schema objects.',
  'drop event':
    'Event triggers are database-global rather than schema objects, and the two in ' +
    'this repo are dropped and recreated as a pair inside one migration.',
  'alter database': 'Database-level settings, not a schema object.',
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
      for (const object of dispatchObjectKeys(file.sql)) {
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
  const paginated = args.includes('--paginate')
  const actualArgs = paginated && !args.includes('--slurp') ? [...args.slice(0, args.indexOf('--paginate') + 1), '--slurp', ...args.slice(args.indexOf('--paginate') + 1)] : args
  const out = gh(actualArgs)
  try {
    const parsed = JSON.parse(out)
    if (!paginated) return parsed
    if (!Array.isArray(parsed) || parsed.some((page) => !Array.isArray(page))) throw new Error('bad pages')
    return parsed.flat()
  } catch {
    throw new Skip(`\`gh ${actualArgs.join(' ')}\` did not return complete paginated JSON`)
  }
}

export function validateBaseFileAgreement(compareFiles, fallbackFiles) {
  const names = (files) => [...new Set(files.map((file) => file.filename ?? file.path))].sort()
  const primary = names(compareFiles)
  const fallback = names(fallbackFiles)
  if (JSON.stringify(primary) !== JSON.stringify(fallback)) {
    throw new Skip(`Compare and commit-graph fallback disagree (${primary.join(', ')} != ${fallback.join(', ')})`)
  }
  return fallback
}

export function validateFallbackIdentity(pr, liveBase, number, baseRef, headSha) {
  if (pr?.number !== number || pr?.head?.sha !== headSha || pr?.base?.ref !== baseRef || !/^[0-9a-f]{40}$/.test(liveBase ?? '')) {
    throw new Skip('fallback pull-request/base identity mismatch')
  }
}

export function validateFallbackPaths(paths, shallow = false) {
  if (shallow) throw new Skip('fallback commit graph is truncated')
  if (new Set(paths).size !== paths.length) throw new Skip('fallback returned duplicate/truncated path data')
  return paths
}

export function isCompareTransportFailure(error) {
  return /HTTP (?:404|5\d\d)\b/.test(error?.message ?? '')
}

export function parseGitNameStatus(raw) {
  const fields = String(raw).split('\0').filter(Boolean)
  const files = []
  for (let i = 0; i < fields.length;) {
    const status = fields[i++]
    if (/^[RC]\d+/.test(status)) {
      if (i + 1 >= fields.length) throw new Skip('fallback returned truncated rename/copy data')
      i++ // previous path; GitHub Compare identifies a rename by its new path
      files.push({ filename: fields[i++], status: status[0] === 'R' ? 'renamed' : 'copied' })
    } else {
      if (i >= fields.length) throw new Skip('fallback returned truncated name-status data')
      files.push({ filename: fields[i++], status: status === 'D' ? 'removed' : status === 'A' ? 'added' : 'modified' })
    }
  }
  validateFallbackPaths(files.map((file) => `${file.status}:${file.filename}`))
  return files
}

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    throw new Skip(`\`git ${args.join(' ')}\` failed: ${error.message}`)
  }
}

function baseFilesFromCommitGraph(repo, number, baseRef, headSha) {
  const pr = ghJson(['api', `repos/${repo}/pulls/${number}`])
  const liveBase = ghJson(['api', `repos/${repo}/branches/${encodeURIComponent(baseRef)}`])?.commit?.sha
  validateFallbackIdentity(pr, liveBase, number, baseRef, headSha)
  const shallow = git(['rev-parse', '--is-shallow-repository']) === 'true'
  for (const sha of [headSha, liveBase]) {
    const commit = ghJson(['api', `repos/${repo}/commits/${sha}`])
    if (commit?.sha !== sha || commit?.commit?.tree?.sha == null) {
      throw new Skip(`fallback commit/tree identity mismatch for ${sha}`)
    }
    git(['cat-file', '-e', `${sha}^{commit}`])
    if (git(['rev-parse', `${sha}^{tree}`]) !== commit.commit.tree.sha) {
      throw new Skip(`fallback local/GitHub tree identity mismatch for ${sha}`)
    }
  }
  const mergeBase = git(['merge-base', headSha, liveBase])
  if (!/^[0-9a-f]{40}$/.test(mergeBase)) throw new Skip('fallback could not prove an exact merge base')
  const listed = parseGitNameStatus(git(['diff', '--name-status', '-z', mergeBase, liveBase]))
  validateFallbackPaths(listed.map((file) => `${file.status}:${file.filename}`), shallow)
  return { files: listed, baseSha: liveBase }
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
  const pr = ghJson(['api', `repos/${repo}/pulls/${number}`])
  const allFiles = ghJson([
    'api',
    '--paginate',
    `repos/${repo}/pulls/${number}/files?per_page=100`,
  ])
  if (!Number.isInteger(pr?.changed_files)) throw new Skip(`PR #${number} has no trustworthy changed_files count`)
  if (pr.changed_files >= 3000) throw new Skip(`PR #${number} reaches GitHub's 3000-file limit`)
  if (allFiles.length !== pr.changed_files) throw new Skip(`PR #${number} returned ${allFiles.length} of ${pr.changed_files} changed files`)
  const files = allFiles.filter(isMigration)
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

function baseBranchSource(repo, number, baseRef, headSha) {
  let compare
  let compareFailed = false
  try {
    compare = ghJson(['api', baseCompareSpec(repo, headSha, baseRef)])
    if (!Array.isArray(compare?.files)) throw new Skip('Compare returned incomplete file data')
  } catch (error) {
    if (!(error instanceof Skip) || !isCompareTransportFailure(error)) throw error
    compareFailed = true
  }
  const fallback = baseFilesFromCommitGraph(repo, number, baseRef, headSha)
  if (!compareFailed) validateBaseFileAgreement(compare.files, fallback.files)
  const files = (compareFailed ? fallback.files : compare.files).filter(isMigration)
  if (files.length === 0) return null
  return {
    label: `${baseRef} (merged since this PR branched)`,
    files: files.map((file) => ({
      path: file.filename,
      sql: gh([
        'api',
        '-H',
        'Accept: application/vnd.github.raw',
        `repos/${repo}/contents/${encodeURI(file.filename)}?ref=${fallback.baseSha}`,
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
    const base = baseBranchSource(repo, number, baseRef, headSha)
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
    console.error('ERROR: cross-PR object collision guard could not gather complete inputs --', error.message)
    console.warn('No collision checking was performed. This is deliberate: a guard')
    console.warn('that cannot gather its inputs must fail closed. See B6 in HANDOFF.md.')
    return 2
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
