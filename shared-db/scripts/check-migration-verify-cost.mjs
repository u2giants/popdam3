#!/usr/bin/env node
//
// Refuse ADDED migration verification blocks that read expensive data.
//
// WHY (issue #1285). A self-verification block runs inside the apply
// transaction. A `count(*)` over `api.source_capture_inventory` or any `plm`
// table holds that transaction open for as long as the scan takes, on
// production, with the migration lock held. Shape checks belong in the
// catalogue; data-scale checks belong in a bounded rehearsal outside the apply.
//
// WHAT CHANGED AFTER EXTERNAL REVIEW (grok-4.6, PR #1954)
// -------------------------------------------------------
// The first version matched the NAMES anywhere inside a verification block.
// That was wrong in both directions and the review proved it with this
// repository's own SQL:
//
//   * FALSE POSITIVES. `pg_get_viewdef('api.source_capture_inventory'::regclass)`,
//     `has_table_privilege(..., 'api.source_capture_inventory', 'select')`,
//     `to_regprocedure('plm.finalize_...')` and even
//     `raise exception 'no plm.wildbrain_* tables exist'` were all refused.
//     Those are exactly the catalogue-only shape the guard is supposed to
//     PERMIT -- migration 20260820004338 would not have been mergeable.
//     So the rule is now a READ CONTEXT, not a name: the object must appear
//     where a relation is read or written (`from`, `join`, `into`, `update`,
//     `delete from`, `truncate`, `analyze`, `copy`), or be CALLED as a routine.
//     A name inside a string handed to a catalogue function is a lookup, not a
//     scan.
//
//   * FALSE NEGATIVES. An unmatched dollar tag anywhere in the file made the
//     scan `break` and the file PASS; `do language plpgsql $verify$` was not
//     recognised as a block at all; a comment between `do` and the tag hid it;
//     and `set search_path to plm` made every bare name a plm read that no
//     `plm.` pattern could see.
//
// FAIL CLOSED. Anything this file cannot parse is refused, never passed. The
// one deliberate exception is an EMPTY added-version list, which legitimately
// means "this branch adds no migration" -- the overwhelming majority of pull
// requests -- and is established by `check-sql.sh` before this script runs.
//
// This is a text scanner, not a SQL executor.
// The guard document under docs/, migration-verification-cost-guard.md,
// records what it still cannot see. Its name is spelled without quoting
// here on purpose: a quoted whole path in this file reads as a runtime
// file read to the preview data-surface test.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/

// A string literal is real SQL only when something is about to run it.
// The optional trailing prefix is a PostgreSQL string-literal prefix: `E` for an
// escape string, `U&` for a Unicode string, `B`/`X` for bit strings. Without it,
// `execute E'select ... from plm.big'` did not read as dynamic SQL, so the guard
// blanked the statement and passed the migration (issue #2130).
const DYNAMIC_SQL_LEAD = /\b(?:execute|format)\s*\(?\s*(?:[eEbBxX]|[uU]&)?$/i

// `E'...'` also changes the ESCAPING rules: inside it a backslash escapes the next
// character, so an embedded escaped quote does not end the literal. Reading it with
// the ordinary doubled-quote rule alone would close the string early and misread
// the rest of the file.
const ESCAPE_STRING_PREFIX = /(?:^|[^A-Za-z0-9_])[eE]$/

// One pass that understands the four things a regex cannot: line comments,
// block comments, single-quoted strings and dollar-quoted bodies.
//
// It returns TWO views of the same text, both the same length as the input so
// every offset and line number stays exact:
//
//   masked    -- comments blanked. Used to decide what is a `do` block and
//                whether the block is signalled as verification, which is a
//                judgement that legitimately reads `raise notice 'verify ...'`.
//   scannable -- comments blanked AND the contents of every string literal
//                blanked, EXCEPT a string handed to `execute` or `format`.
//                Used for the prohibited-read patterns. This is what stops
//                `raise exception 'verify 7: plm.finalize_x(...) is missing'`
//                from being read as a call while keeping
//                `execute 'select count(*) from plm.big'` visible.
export function scanSql(sql) {
  const mask = [...sql]
  const scan = [...sql]
  const dollars = []
  const unterminated = []
  let i = 0
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n') { mask[i] = ' '; scan[i] = ' '; i += 1 }
      continue
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2)
      const stop = end < 0 ? sql.length : end + 2
      for (let j = i; j < stop; j += 1) if (sql[j] !== '\n') { mask[j] = ' '; scan[j] = ' ' }
      if (end < 0) unterminated.push({ kind: 'block comment', offset: i })
      i = stop
      continue
    }
    if (sql[i] === "'") {
      const opened = i
      const escapes = ESCAPE_STRING_PREFIX.test(sql.slice(Math.max(0, opened - 2), opened))
      i += 1
      let closed = false
      while (i < sql.length) {
        if (escapes && sql[i] === '\\') { i += 2; continue }
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue }
        if (sql[i] === "'") { i += 1; closed = true; break }
        i += 1
      }
      if (!closed) unterminated.push({ kind: 'string literal', offset: opened })
      const dynamic = DYNAMIC_SQL_LEAD.test(mask.slice(Math.max(0, opened - 120), opened).join(''))
      if (!dynamic) for (let j = opened + 1; j < i - (closed ? 1 : 0); j += 1) if (sql[j] !== '\n') scan[j] = ' '
      continue
    }
    if (sql[i] === '"') {
      const opened = i
      i += 1
      let closed = false
      while (i < sql.length) {
        if (sql[i] === '"') { i += 1; closed = true; break }
        i += 1
      }
      if (!closed) unterminated.push({ kind: 'quoted identifier', offset: opened })
      continue
    }
    const tagMatch = sql[i] === '$' ? DOLLAR_TAG.exec(sql.slice(i)) : null
    if (tagMatch) {
      const tag = tagMatch[0]
      const bodyStart = i + tag.length
      const bodyEnd = sql.indexOf(tag, bodyStart)
      if (bodyEnd < 0) {
        unterminated.push({ kind: `dollar-quoted body ${tag}`, offset: i })
        break
      }
      // Scan the body too, and splice its views back in at the same offsets. A
      // nested dollar-quoted region (a function body inside a `do` block, a
      // `$q$` literal) would otherwise be skipped whole, leaving its comments
      // and its prose strings visible to the patterns.
      const nested = scanSql(sql.slice(bodyStart, bodyEnd))
      for (let j = 0; j < nested.masked.length; j += 1) {
        mask[bodyStart + j] = nested.masked[j]
        scan[bodyStart + j] = nested.scannable[j]
      }
      for (const open of nested.unterminated) unterminated.push({ ...open, offset: open.offset + bodyStart })
      dollars.push({ tag, tagStart: i, bodyStart, bodyEnd })
      i = bodyEnd + tag.length
      continue
    }
    i += 1
  }
  return { masked: mask.join(''), scannable: scan.join(''), dollars, unterminated }
}

// `do $verify$`, `do language plpgsql $verify$`, and the same with comments in
// between -- the lead is read from the COMMENT-BLANKED text, so a comment can
// neither hide the keyword nor forge one.
const DO_LEAD = /\bdo(?:\s+language\s+(?:[A-Za-z_][A-Za-z0-9_]*|"(?:[^"]|"")*"))?$/i

// The lead used to be read through a fixed 200-character window, so a long comment
// or a long LANGUAGE clause between `do` and its tag pushed the keyword out of view
// and the block was never inspected (issue #2130). Comments are already blanked to
// spaces by the scan, so trimming the blanks off the end makes the distance between
// the keyword and the tag irrelevant.
//
// There is no window. A 20 000-character one was still a window and a longer comment
// walked straight past it (external review, muse-spark-1.2, PR #2139).
//
// COLLAPSE FIRST, then trim, and only then look at the tail. Slicing first left a
// 200-character window on UNCOLLAPSED text, so a long comment in the `do`..`language`
// gap pushed `do` out of view exactly as the old window did, while the surviving
// `language plpgsql` kept the lead looking legitimate (external review, glm-5.3,
// PR #2139). After the collapse the lead is `... do language plpgsql`, so the tail is
// a cheap read of a decided answer rather than a limit on what can be seen.
export function doLead(masked, tagStart) {
  return masked.slice(0, tagStart).replace(/\s+/g, ' ').trimEnd().slice(-200)
}

export function verifyBlocks(sql) {
  const { masked, scannable, dollars, unterminated } = scanSql(sql)
  const blocks = []
  for (const region of dollars) {
    if (!DO_LEAD.test(doLead(masked, region.tagStart))) continue
    const lead = sql.slice(Math.max(0, region.tagStart - 400), region.tagStart)
    const signalled = /verify|verification/i.test(region.tag)
      || /raise\s+(?:exception|notice|warning)[\s\S]{0,160}\bverif(?:y|ication)\b/i.test(masked.slice(region.bodyStart, region.bodyEnd))
      || /(?:self[- ]verification|verification(?:\s+block)?|verify(?:\s+block)?)[^\n]*$/im.test(lead)
    if (signalled) {
      blocks.push({
        body: scannable.slice(region.bodyStart, region.bodyEnd),
        literal: masked.slice(region.bodyStart, region.bodyEnd),
        offset: region.bodyStart,
      })
    }
  }
  return {
    blocks,
    unterminated,
    fileScope: fileScopeText(scannable, dollars),
    fileScopeLiteral: fileScopeText(masked, dollars),
  }
}

// The text OUTSIDE every top-level dollar-quoted body: the statements the session
// actually runs between them. Bodies are blanked rather than removed so offsets and
// line numbers stay exact.
export function fileScopeText(scannable, dollars) {
  const out = [...scannable]
  for (const region of dollars) {
    for (let j = region.bodyStart; j < region.bodyEnd; j += 1) if (out[j] !== '\n') out[j] = ' '
  }
  return out.join('')
}

// Anything that points `search_path` at `plm` makes every UNQUALIFIED name a possible
// plm read that no `plm.` pattern can see. The construct is refused rather than
// guessed at, in a verification block and in the statements before one alike: a set
// one level out reaches into the block that follows it (issue #2130).
//
// The KEYWORDS are matched in the scannable view, so the same words sitting inside a
// message string are not mistaken for a statement. The VALUE is then read from the
// masked view, where string CONTENTS are still visible, because `set search_path to
// 'plm'` puts the schema name inside a literal -- reading the value from the
// scannable view saw blanks and passed (external review, muse-spark-1.2, PR #2139).
// `set_config('search_path', 'plm', false)` is the function spelling of the same
// statement and is found the same way.
const SEARCH_PATH_SET = /\bset\s+(?:local\s+|session\s+)?search_path\s*(?:to|=)/gi
const SET_CONFIG_CALL = /\bset_config\s*\(/gi
const STATEMENT_START = /(?:^|;)\s*$/
const NAMES_PLM = /(?:^|[^A-Za-z0-9_])plm(?![A-Za-z0-9_])/i

// `fileScopeOnly` is the discriminator that keeps the `SET search_path` ATTRIBUTE of a
// CREATE FUNCTION allowed: an attribute sits inside the CREATE statement, while a real
// SET STATEMENT begins at the start of the file or after a `;`. 223 migrations here
// carry the attribute form, and it cannot change what a later block resolves.
export function searchPathReachesPlm(scannable, literal, { fileScopeOnly = false } = {}) {
  for (const regex of [SEARCH_PATH_SET, SET_CONFIG_CALL]) {
    regex.lastIndex = 0
    let found
    while ((found = regex.exec(scannable)) !== null) {
      // The statement-start test exists only to tell a SET STATEMENT from the SET
      // ATTRIBUTE of a CREATE FUNCTION. `set_config` is a function call with no such
      // twin, and its only valid file-scope spelling is `select set_config(...)`,
      // which never begins a statement -- so applying the test to it made the
      // file-scope half of that rule unreachable (external review, glm-5.3, PR #2139).
      const attributeRisk = fileScopeOnly && regex === SEARCH_PATH_SET
      if (attributeRisk && !STATEMENT_START.test(scannable.slice(0, found.index))) continue
      // Leading whitespace is skipped before the value is delimited. Searching for the
      // terminator first cut a LINE-WRAPPED value off at its own opening newline and
      // read it as empty (external review, glm-5.3, PR #2139).
      const rest = literal.slice(found.index + found[0].length).replace(/^\s+/, '')
      const stop = rest.search(/[;\n]/)
      const value = stop < 0 ? rest : rest.slice(0, stop)
      if (!NAMES_PLM.test(value)) continue
      if (regex === SET_CONFIG_CALL && !/search_path/i.test(value)) continue
      return found.index
    }
  }
  return -1
}

// A relation name only costs anything when something READS or WRITES it. These
// are the contexts in which it does.
// `truncate table x` is the spelled-out form of `truncate x`; without the optional
// keyword the guard read only the short form (issue #2130).
// A maintenance command puts an option list or VERBOSE between its keyword and the
// object, so `vacuum (analyze) plm.t` and `cluster verbose plm.t` need the gap
// spelled out (external review, glm-5.3, PR #2139).
const MAINTENANCE = String.raw`(?:vacuum(?:\s*\([^)]*\))?(?:\s+full)?(?:\s+freeze)?(?:\s+verbose)?(?:\s+analyze)?|analyze(?:\s*\([^)]*\))?(?:\s+verbose)?|cluster(?:\s+verbose)?|reindex(?:\s*\([^)]*\))?(?:\s+(?:table|index))?(?:\s+concurrently)?|refresh\s+materialized\s+view(?:\s+concurrently)?)`
const READ_CONTEXT = String.raw`\b(?:from|join|into|update|delete\s+from|truncate(?:\s+table)?|copy|${MAINTENANCE})\s+(?:only\s+)?`
const INVENTORY = String.raw`(?:"?api"?\s*\.\s*)?"?source_capture_inventory"?(?![A-Za-z0-9_])`
const PLM_OBJECT = String.raw`"?plm"?\s*\.\s*"?[A-Za-z_][A-Za-z0-9_]*"?`

export const PATTERNS = [
  {
    label: 'api.source_capture_inventory',
    regex: new RegExp(`${READ_CONTEXT}${INVENTORY}`, 'i'),
  },
  {
    label: 'a plm object',
    regex: new RegExp(`${READ_CONTEXT}${PLM_OBJECT}`, 'i'),
  },
  {
    // A routine call is a read too, and it is the one that does not need FROM.
    // The negative lookbehind keeps `to_regprocedure('plm.f(...)')` and every
    // other catalogue lookup out: there the name is opened by a quote.
    label: 'a plm routine',
    regex: /(?<!['"\w.])"?plm"?\s*\.\s*"?[A-Za-z_][A-Za-z0-9_]*"?\s*\(/i,
  },
]

export function inspectSql(name, sql) {
  const failures = []
  const { blocks, unterminated, fileScope, fileScopeLiteral } = verifyBlocks(sql)
  for (const open of unterminated) {
    const line = sql.slice(0, open.offset).split(/\r?\n/).length
    failures.push(`${name}:${line}: unterminated ${open.kind}; this guard cannot read the file and refuses it`)
  }
  for (const block of blocks) {
    for (const pattern of PATTERNS) {
      const found = pattern.regex.exec(block.body)
      if (!found) continue
      const line = sql.slice(0, block.offset + found.index).split(/\r?\n/).length
      failures.push(`${name}:${line}: verification reads ${pattern.label}`)
    }
    const inBlock = searchPathReachesPlm(block.body, block.literal)
    if (inBlock >= 0) {
      const line = sql.slice(0, block.offset + inBlock).split(/\r?\n/).length
      failures.push(`${name}:${line}: verification reads plm through search_path`)
    }
  }
  // Only a search_path set BEFORE a verification block can change what that block
  // reads, so one set after the last block is left alone.
  if (blocks.length) {
    const end = Math.max(...blocks.map((block) => block.offset))
    const reached = searchPathReachesPlm(
      fileScope.slice(0, end),
      fileScopeLiteral.slice(0, end),
      { fileScopeOnly: true },
    )
    if (reached >= 0) {
      const line = sql.slice(0, reached).split(/\r?\n/).length
      failures.push(`${name}:${line}: verification reads a plm object through a statement-level search_path set before it`)
    }
  }
  return failures
}

function main() {
  const [migrationDir, addedVersionsFile] = process.argv.slice(2)
  if (!migrationDir || !addedVersionsFile) {
    console.error('usage: check-migration-verify-cost.mjs <migration-dir> <added-versions-file>')
    process.exit(2)
  }

  const added = new Set(
    readFileSync(addedVersionsFile, 'utf8').match(/^\d{14}$/gm) ?? [],
  )

  // Fixture runs intentionally scan every file. In a real checkout only
  // migrations added by the branch are inspected, so immutable historical SQL
  // is not retroactively judged by a guard introduced later.
  const fixtureMode = Boolean(process.env.CHECK_SQL_MIGRATION_DIR)
  const files = readdirSync(migrationDir)
    .filter(name => /^\d{14}.*\.sql$/i.test(name))
    .filter(name => fixtureMode || added.has(name.slice(0, 14)))

  const failures = []
  for (const name of files) {
    failures.push(...inspectSql(name, readFileSync(path.join(migrationDir, name), 'utf8')))
  }

  if (failures.length) {
    console.error('ERROR: migration verification must not read source_capture_inventory or plm.* data:')
    for (const failure of failures) console.error(`  ${failure}`)
    console.error('Use catalogue metadata for shape checks. Put data-scale validation in a bounded rehearsal outside the apply transaction.')
    process.exit(1)
  }

  console.log(`Verify-cost guard passed: ${files.length} added migration(s) contain no prohibited verification read.`)
}

if (process.argv[1]?.endsWith('check-migration-verify-cost.mjs')) main()
