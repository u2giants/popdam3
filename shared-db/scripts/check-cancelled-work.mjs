#!/usr/bin/env node
/**
 * Guard: a pull request must not reintroduce an instruction an owner ruling
 * has already CANCELLED.
 *
 * Plan item C2 of `plan_orchestrator-workflow-gaps.md`, issue #619.
 *
 * WHY THIS EXISTS
 * ---------------
 * Item C's finding, proven twice on 2026-08-07: an owner ruling reaches the
 * NEXT session, never the one already running. Albert ruled the Disney extract
 * was not sensitive at ~17:00. At 22:26 a live session filed issue #578 asking
 * for the git-history scrub that ruling had just cancelled.
 *
 * Nothing can reach a running session, and this guard does not pretend to. What
 * it does is make the next thing that session COMMITS fail loudly.
 *
 * THE TWO MITIGATIONS THE PLAN REQUIRES -- both present, or do not build it
 * ------------------------------------------------------------------------
 *  1. THE TABLE LIVES ONLY HERE, where the check consumes it. There is no
 *     second copy in prose. A list nothing reads is a list nothing updates.
 *  2. A ROT VALVE. `validateTable` fails if the table is empty, or if any row
 *     lacks a reason or a ruling reference. Silently gutting the table is
 *     therefore not a quiet way to make this check pass.
 *
 * Shape follows `scripts/check-skill-drift.mjs`: a committed table, each row
 * carrying its own reason and the rule it violates, consumed by exactly one
 * check. That script also demonstrated the trap to budget for -- on its first
 * run it found three real defects AND produced three false positives, all from
 * line-scoped patterns where the correction wrapped onto the next line. So the
 * patterns here are matched against the diff with surrounding context joined,
 * and every row carries an `unless` escape for the legitimate mention.
 *
 * USAGE
 *   node scripts/check-cancelled-work.mjs [--base origin/main]
 *
 * EXIT CODES
 *   0  no cancelled instruction reintroduced
 *   1  a cancelled instruction was reintroduced, or the table has rotted
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * THE TABLE. This is the only copy. Do not mirror it into a document.
 *
 * Each row:
 *   id       stable handle, used in the failure message
 *   what     one line: the instruction that is cancelled
 *   ruling   WHERE the cancellation is recorded. Required by the rot valve.
 *   reason   WHY it is cancelled. Required by the rot valve. Per-row, never
 *            a shared blurb -- the plan is explicit that a bare list rots.
 *   pattern  what a reintroduction looks like in an added diff line
 *   unless   a legitimate mention that must NOT fail. Every row needs one,
 *            because this file itself mentions all of them.
 */
export const CANCELLED = [
  {
    id: 'R-SEC-1c-history-rewrite',
    what: "rewrite this repository's git history to scrub the Disney OPA extract",
    ruling: 'AGENTS.md §6 owner ruling (2), Albert Hazan, 2026-08-07',
    reason:
      'The owner ruled the Disney OPA property/character extract is NOT sensitive and may ' +
      'stay in this public repo. R-SEC-1 part (c) is cancelled outright. Rewriting shared ' +
      'history breaks every clone and every open branch, for a premise that is overruled.',
    pattern: /\b(scrub|rewrite|purge|filter-repo|filter-branch|bfg)\b[^\n]{0,80}\b(git )?histor/i,
    unless: /\b(cancelled|overruled|superseded|do not|never|must not|forbidden)\b/i,
  },
  {
    id: 'make-shared-db-private',
    what: 'make u2giants/shared-db private',
    ruling: 'AGENTS.md §6 owner ruling (2) and the branch-protection note beneath it',
    reason:
      'Going private SILENTLY REMOVED ALL BRANCH PROTECTION on 2026-08-07 -- a private repo ' +
      'on this account plan cannot have it -- and nobody noticed for about two hours. The ' +
      'reason for going private (the Disney extract) was overruled the same day. Visibility ' +
      'and protection are coupled: never change one without checking the other.',
    pattern:
      /\b(make|set|turn|switch|flip)\b[^\n]{0,40}\b(repo|repository|shared-db)\b[^\n]{0,40}\bprivate\b/i,
    unless: /\b(cancelled|overruled|superseded|do not|never|must not|forbidden|was made)\b/i,
  },
]

// ---------------------------------------------------------------------------
// Rot valve
// ---------------------------------------------------------------------------

/**
 * The plan: "the check must fail if the table is empty or if a row lacks a
 * reason, so silently gutting it is not a quiet way to make the check pass."
 */
export function validateTable(table = CANCELLED) {
  const problems = []
  if (!Array.isArray(table) || table.length === 0) {
    problems.push(
      'the cancelled-work table is EMPTY. That is not a pass — it means the guard was ' +
        'gutted. Restore the rows or delete this check deliberately, with a reason.',
    )
    return problems
  }
  const seen = new Set()
  table.forEach((row, i) => {
    const at = row?.id ? `row \`${row.id}\`` : `row ${i}`
    if (!row?.id) problems.push(`${at} has no id`)
    else if (seen.has(row.id)) problems.push(`${at} is a duplicate id`)
    else seen.add(row.id)
    if (!row?.what?.trim()) problems.push(`${at} does not say WHAT is cancelled`)
    if (!row?.ruling?.trim()) problems.push(`${at} does not cite the RULING that cancelled it`)
    if (!row?.reason?.trim()) problems.push(`${at} has no REASON — a bare list rots; see plan item C2`)
    if (!(row?.pattern instanceof RegExp)) problems.push(`${at} has no detection pattern`)
    if (!(row?.unless instanceof RegExp))
      problems.push(`${at} has no \`unless\` escape, so it will fail on its own documentation`)
  })
  return problems
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Added lines only, with their file, from a unified diff. */
export function addedLines(diff) {
  const out = []
  let file = null
  for (const line of String(diff).split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6)
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      out.push({ file, text: line.slice(1) })
    }
  }
  return out
}

/**
 * Scan added lines for a reintroduced instruction.
 *
 * Line-scoped matching produced three false positives in check-skill-drift on
 * its first run, all because the correction wrapped to the next line. So the
 * `unless` escape is evaluated against the line joined with its neighbours.
 */
export function findReintroduced(diff, table = CANCELLED, { skipFiles = [] } = {}) {
  const lines = addedLines(diff)
  const findings = []

  lines.forEach((line, i) => {
    if (!line.file) return
    if (skipFiles.some((f) => line.file === f)) return

    const context = [lines[i - 1], line, lines[i + 1]]
      .filter((l) => l && l.file === line.file)
      .map((l) => l.text)
      .join(' ')

    for (const row of table) {
      if (!row.pattern.test(line.text)) continue
      if (row.unless.test(context)) continue
      findings.push({ id: row.id, file: line.file, text: line.text.trim(), row })
    }
  })

  return findings
}

export function formatReport(findings) {
  const lines = ['FAIL: this pull request reintroduces work an owner ruling CANCELLED.', '']
  for (const f of findings) {
    lines.push(`  ${f.file}`)
    lines.push(`    + ${f.text}`)
    lines.push(`    cancelled: ${f.row.what}`)
    lines.push(`    ruling:    ${f.row.ruling}`)
    lines.push(`    why:       ${f.row.reason}`)
    lines.push('')
  }
  lines.push(
    'If the ruling has genuinely changed, change the ruling FIRST and remove the row from ' +
      'scripts/check-cancelled-work.mjs in the same pull request, with the new ruling cited. ' +
      'Do not work around this check.',
  )
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const defaultIo = {
  diff: (base) =>
    execFileSync('git', ['diff', '--unified=0', `${base}...HEAD`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
}

export function main(argv = [], io = defaultIo) {
  const baseFlag = argv.indexOf('--base')
  const base = baseFlag !== -1 ? argv[baseFlag + 1] : 'origin/main'

  const rot = validateTable()
  if (rot.length > 0) {
    console.error('FAIL: the cancelled-work table has rotted.')
    for (const p of rot) console.error(`  - ${p}`)
    return 1
  }

  let diff
  try {
    diff = io.diff(base)
  } catch (error) {
    // Loud. A diff we cannot read is not a clean diff.
    console.error(`FAIL: could not read the diff against ${base}: ${error.message}`)
    console.error('This is NOT a pass. Fetch the base ref and run again.')
    return 1
  }

  // This file is the table's only home, so it necessarily contains every
  // pattern it looks for. Exclude it, and nothing else.
  const findings = findReintroduced(diff, CANCELLED, {
    skipFiles: ['scripts/check-cancelled-work.mjs', 'scripts/check-cancelled-work.test.mjs'],
  })

  if (findings.length === 0) {
    console.log(`OK — no cancelled instruction reintroduced (${CANCELLED.length} row(s) checked).`)
    return 0
  }

  console.error(formatReport(findings))
  return 1
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(main(process.argv.slice(2)))
