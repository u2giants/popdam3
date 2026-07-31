#!/usr/bin/env node
//
// Every `### B<n>` item in HANDOFF.md's `## BACKLOG` must be visible to a fresh
// coordinator, and the only place a fresh coordinator is instructed to look is
// the `## REQUEST QUEUE` of COORDINATOR_INTAKE.md.
//
// Why this script exists (2026-07-31): the queue was empty while twelve backlog
// items and about eight other jobs sat in HANDOFF.md. A brand-new coordinator
// read the empty queue, correctly concluded "there is no pending work", and was
// wrong by roughly twenty jobs. Every fix since has been a written rule, and
// written rules are exactly what failed. This is the mechanical one.
//
// DESIGN POSTURE — read this before changing anything here.
//
//   1. A false positive that blocks every pull request is worse than the bug it
//      prevents. This mirrors Guard B in scripts/check-sql.sh, which prints a
//      loud SKIPPED warning and exits 0 when it cannot resolve its base ref
//      rather than failing blindly. If EITHER document cannot be parsed with
//      confidence -- file missing, heading renamed, section absent, no items
//      found at all -- this script warns loudly and exits 0.
//
//   2. It anchors ONLY on the `B<n>` identifier. Both documents are prose, and
//      any attempt at semantic or title matching would manufacture false
//      positives. A backlog item is "queued" if and only if its number appears
//      in the queue.
//
//   3. Sections a request legitimately MOVES to also count. The coordinator
//      lifecycle in COORDINATOR_INTAKE.md moves a block out of REQUEST QUEUE
//      into IN PROGRESS / COMPLETED / TAKEN OVER when it is dispatched or done.
//      Flagging those as "missing from the queue" would be a false positive of
//      exactly the kind rule 1 forbids, so they satisfy the check -- and the
//      report says which section matched, so a stale one is still visible.
//
//   4. The reverse direction (a queue entry naming a `B<n>` that no longer
//      exists in the backlog) is REPORTED as a warning and never fails. Most
//      queue entries are ordinary requests that were never backlog items, and a
//      retired or renumbered backlog item leaving a stale queue entry behind is
//      untidy, not dangerous. Failing on it would block PRs over bookkeeping.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const HANDOFF_FILE = 'HANDOFF.md'
export const INTAKE_FILE = 'COORDINATOR_INTAKE.md'

// The section a fresh coordinator is told to read. This is the one that matters.
const QUEUE_HEADING = /^##\s+REQUEST QUEUE\b/i
// Sections a request legitimately moves to once the coordinator acts on it.
const DOWNSTREAM_HEADINGS = [
  { label: 'IN PROGRESS', pattern: /^##\s+IN PROGRESS\b/i },
  { label: 'COMPLETED', pattern: /^##\s+COMPLETED\b/i },
  { label: 'TAKEN OVER', pattern: /^##\s+TAKEN OVER\b/i },
  { label: 'WAITING ON OTHER PEOPLE', pattern: /^##\s+WAITING ON OTHER PEOPLE\b/i },
]
const BACKLOG_HEADING = /^##\s+BACKLOG\b/i
const BACKLOG_ITEM_HEADING = /^###\s+B(\d{1,3})\b/
// `(?!\s*\.\s*\d)` keeps the sub-headings `B2.0`, `B2.1`, ... of
// COORDINATOR_INTAKE.md Part B2 from being read as a reference to backlog B2.
const B_REFERENCE = /\bB(\d{1,3})\b(?!\s*\.\s*\d)/g
// The opt-out. It lives in the backlog item itself, next to the reason, so an
// exclusion can never become invisible the way a separate allowlist file would.
// Anchored to the START of its own line (bullet / blockquote / bold decoration
// allowed) so that PROSE ABOUT the marker -- "the opt-out marker is
// `no-queue-entry-needed: <reason>`" -- does not accidentally exclude the item
// that documents it. That false positive was hit for real while writing this.
const EXCLUSION_MARKER = /^[\s>*_-]*no-queue-entry-needed:\s*(.*)$/im

/**
 * Slice out an H2 section: the heading line's content up to (not including) the
 * next `## ` heading. `### ` sub-headings stay inside.
 */
function extractSection(text, headingPattern) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => headingPattern.test(line))
  if (start === -1) return null

  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i]) && !/^###/.test(lines[i])) {
      end = i
      break
    }
  }
  return { heading: lines[start], body: lines.slice(start + 1, end).join('\n') }
}

/** Every `### B<n>` item in the backlog section, with its heading and body. */
function extractBacklogItems(sectionBody) {
  const lines = sectionBody.split(/\r?\n/)
  const items = []
  let current = null

  for (const line of lines) {
    const match = BACKLOG_ITEM_HEADING.exec(line)
    if (match) {
      if (current) items.push(current)
      current = { number: Number(match[1]), heading: line.replace(/^#+\s*/, '').trim(), body: [] }
      continue
    }
    if (/^###\s/.test(line)) {
      // A `### ` heading that is not a `B<n>` item ends the current item.
      if (current) items.push(current)
      current = null
      continue
    }
    if (current) current.body.push(line)
  }
  if (current) items.push(current)

  return items.map((item) => ({ ...item, body: item.body.join('\n') }))
}

/** Every distinct `B<n>` number referenced anywhere in a chunk of text. */
function referencedNumbers(text) {
  const found = new Set()
  for (const match of text.matchAll(B_REFERENCE)) found.add(Number(match[1]))
  return found
}

/**
 * The whole check, as a pure function so the tests can drive it without files.
 *
 * @returns {{status: 'ok'|'skipped'|'failed', warnings: string[], notes: string[],
 *            missing: object[], skipped: object[], matched: object[], stale: number[]}}
 */
export function checkBacklogQueueSync({ handoffText, intakeText }) {
  const result = {
    status: 'ok',
    warnings: [],
    notes: [],
    missing: [],
    skipped: [],
    matched: [],
    stale: [],
  }

  const skip = (reason) => {
    result.status = 'skipped'
    result.warnings.push(reason)
    return result
  }

  if (typeof handoffText !== 'string') {
    return skip(`could not read ${HANDOFF_FILE}`)
  }
  if (typeof intakeText !== 'string') {
    return skip(`could not read ${INTAKE_FILE}`)
  }

  const backlogSection = extractSection(handoffText, BACKLOG_HEADING)
  if (!backlogSection) {
    return skip(
      `${HANDOFF_FILE} has no \`## BACKLOG\` heading. Either the backlog was removed or the heading was renamed; this check cannot tell which, so it is not failing you.`,
    )
  }

  const queueSection = extractSection(intakeText, QUEUE_HEADING)
  if (!queueSection) {
    return skip(
      `${INTAKE_FILE} has no \`## REQUEST QUEUE\` heading. The section was removed or renamed; this check cannot tell which, so it is not failing you.`,
    )
  }

  const items = extractBacklogItems(backlogSection.body)
  if (items.length === 0) {
    return skip(
      `${HANDOFF_FILE}'s \`## BACKLOG\` section contains no \`### B<n>\` items. Either the backlog is genuinely empty or the item heading convention changed; this check cannot tell which, so it is not failing you.`,
    )
  }

  const queueNumbers = referencedNumbers(queueSection.body)
  const downstream = new Map()
  for (const { label, pattern } of DOWNSTREAM_HEADINGS) {
    const section = extractSection(intakeText, pattern)
    if (!section) continue
    for (const number of referencedNumbers(section.body)) {
      if (!downstream.has(number)) downstream.set(number, label)
    }
  }

  for (const item of items) {
    const exclusion = EXCLUSION_MARKER.exec(item.body)
    if (exclusion) {
      result.skipped.push({
        number: item.number,
        heading: item.heading,
        reason: exclusion[1].trim() || '(no reason given)',
      })
      continue
    }
    if (queueNumbers.has(item.number)) {
      result.matched.push({ number: item.number, heading: item.heading, section: 'REQUEST QUEUE' })
      continue
    }
    if (downstream.has(item.number)) {
      result.matched.push({
        number: item.number,
        heading: item.heading,
        section: downstream.get(item.number),
      })
      continue
    }
    result.missing.push({ number: item.number, heading: item.heading })
  }

  const backlogNumbers = new Set(items.map((item) => item.number))
  for (const number of [...queueNumbers].sort((a, b) => a - b)) {
    if (!backlogNumbers.has(number)) result.stale.push(number)
  }

  if (result.missing.length > 0) result.status = 'failed'
  return result
}

/** Human-readable report. Returns { lines, exitCode }. */
export function formatReport(result) {
  const lines = []

  if (result.status === 'skipped') {
    lines.push('WARNING: backlog/queue sync check SKIPPED -- the documents could not be parsed')
    lines.push('with confidence, and a false positive here would block every pull request.')
    for (const warning of result.warnings) lines.push(`  ${warning}`)
    lines.push('')
    lines.push(
      `If this appears in CI, confirm that ${HANDOFF_FILE} still has a \`## BACKLOG\` section with`,
    )
    lines.push(
      `\`### B<n> — …\` items and that ${INTAKE_FILE} still has a \`## REQUEST QUEUE\` section, then`,
    )
    lines.push('update scripts/check-backlog-queue-sync.mjs to match the new structure.')
    return { lines, exitCode: 0 }
  }

  for (const entry of result.skipped) {
    lines.push(`SKIPPED B${entry.number} (deliberate exclusion): ${entry.heading}`)
    lines.push(`  reason recorded in ${HANDOFF_FILE}: ${entry.reason}`)
  }

  for (const entry of result.matched) {
    lines.push(`OK      B${entry.number} — found in \`## ${entry.section}\``)
  }

  for (const number of result.stale) {
    lines.push(
      `NOTE    the REQUEST QUEUE references B${number}, which no longer exists in the ${HANDOFF_FILE} BACKLOG.`,
    )
    lines.push(
      '        This is a warning only and never fails: most queue entries are ordinary requests',
    )
    lines.push(
      '        that were never backlog items, and a retired item is untidy, not dangerous.',
    )
  }

  if (result.status === 'failed') {
    lines.push('')
    lines.push(
      `ERROR: backlog item(s) in ${HANDOFF_FILE} have no entry in the ${INTAKE_FILE} REQUEST QUEUE:`,
    )
    for (const entry of result.missing) {
      lines.push('')
      lines.push(`  B${entry.number} — ${entry.heading}`)
    }
    lines.push('')
    lines.push('HOW TO FIX — add ONE short entry per item above to the `## REQUEST QUEUE` section')
    lines.push(`of ${INTAKE_FILE}, using the existing heading convention:`)
    lines.push('')
    lines.push('  ### REQUEST — Backlog B<n> — <short outcome> — <YYYY-MM-DD> — session: <you>')
    lines.push('')
    lines.push(
      `Keep it to a heading, one or two sentences of the outcome needed, and a pointer to the`,
    )
    lines.push(
      `\`### B<n>\` item in ${HANDOFF_FILE} for the detail. Do NOT copy the detail across --`,
    )
    lines.push(
      `${HANDOFF_FILE} is authoritative, and duplicating it is how the two documents drift apart.`,
    )
    lines.push('')
    lines.push('If an item deliberately needs NO queue entry (already-in-force policy, superseded,')
    lines.push(
      `an owner decision), record that in the \`### B<n>\` item itself in ${HANDOFF_FILE} as a line`,
    )
    lines.push('containing:')
    lines.push('')
    lines.push('  no-queue-entry-needed: <the reason, in one sentence>')
    lines.push('')
    lines.push(
      'The check honours that and REPORTS it as skipped, so the exclusion stays visible instead',
    )
    lines.push('of silently disappearing.')
    lines.push('')
    lines.push(
      'WHY THIS IS BLOCKED: on 2026-07-31 a fresh coordinator read an empty REQUEST QUEUE,',
    )
    lines.push(
      `reported "there is no pending work", and was wrong by about twenty jobs sitting in`,
    )
    lines.push(`${HANDOFF_FILE}. The queue is the only place a new coordinator is told to look.`)
    return { lines, exitCode: 1 }
  }

  lines.push('')
  lines.push(
    `Backlog/queue sync passed: ${result.matched.length} backlog item(s) have a queue entry, ` +
      `${result.skipped.length} deliberately excluded.`,
  )
  return { lines, exitCode: 0 }
}

function main() {
  const read = (file) => {
    try {
      return readFileSync(path.join(repoRoot, file), 'utf8')
    } catch {
      return undefined
    }
  }

  const result = checkBacklogQueueSync({
    handoffText: read(HANDOFF_FILE),
    intakeText: read(INTAKE_FILE),
  })
  const { lines, exitCode } = formatReport(result)
  const write = exitCode === 0 && result.status !== 'skipped' ? console.log : console.error
  for (const line of lines) write(line)
  process.exit(exitCode)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
