import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  HANDOFF_FILE,
  INTAKE_FILE,
  checkBacklogQueueSync,
  formatReport,
} from './check-backlog-queue-sync.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const handoff = (items) => `# Handoff

## Something else

Prose that mentions B99 outside the backlog and must be ignored.

## BACKLOG — repository-level improvements

${items}

## AFTER THE BACKLOG

More prose mentioning B77 that must be ignored.
`

const intake = (queue, extra = '') => `# Intake

## Part B2 — keeping this file swept

### B2.0 — whose job it is

### B2.1 — section lifecycle

## REQUEST QUEUE

${queue}

## IN PROGRESS

${extra}

## COMPLETED
`

test('passes when every backlog item has a queue entry', () => {
  const result = checkBacklogQueueSync({
    handoffText: handoff('### B1 — first thing\n\nDetail.\n\n### B2 — second thing\n\nDetail.'),
    intakeText: intake(
      '### REQUEST — Backlog B1 — do the first thing — 2026-07-31\n\n### REQUEST — Backlog B2 — do the second thing — 2026-07-31',
    ),
  })

  assert.equal(result.status, 'ok')
  assert.deepEqual(result.missing, [])
  assert.deepEqual(
    result.matched.map((entry) => [entry.number, entry.section]),
    [
      [1, 'REQUEST QUEUE'],
      [2, 'REQUEST QUEUE'],
    ],
  )
  assert.equal(formatReport(result).exitCode, 0)
})

test('fails and names the item when one backlog item is missing from the queue', () => {
  const result = checkBacklogQueueSync({
    handoffText: handoff('### B1 — first thing\n\nDetail.\n\n### B2 — the forgotten one\n\nDetail.'),
    intakeText: intake('### REQUEST — Backlog B1 — do the first thing — 2026-07-31'),
  })

  assert.equal(result.status, 'failed')
  assert.deepEqual(
    result.missing.map((entry) => entry.number),
    [2],
  )

  const report = formatReport(result)
  assert.equal(report.exitCode, 1)
  const text = report.lines.join('\n')
  assert.match(text, /B2 — B2 — the forgotten one/)
  assert.match(text, /### REQUEST — Backlog B<n>/)
  assert.match(text, /no-queue-entry-needed:/)
  assert.ok(!text.includes('B1 — B1 — first thing'), 'the matched item must not be reported missing')
})

test('honours a deliberate exclusion and reports it as skipped, not silently', () => {
  const result = checkBacklogQueueSync({
    handoffText: handoff(
      '### B4 — backlog discipline (already-in-force policy)\n\nno-queue-entry-needed: already-in-force policy, no action for anyone to take.\n',
    ),
    intakeText: intake('(queue is empty)'),
  })

  assert.equal(result.status, 'ok')
  assert.deepEqual(result.missing, [])
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].number, 4)
  assert.match(result.skipped[0].reason, /already-in-force policy/)

  const report = formatReport(result)
  assert.equal(report.exitCode, 0)
  assert.match(report.lines.join('\n'), /SKIPPED B4 \(deliberate exclusion\)/)
})

test('prose ABOUT the opt-out marker does not accidentally exclude the item', () => {
  const result = checkBacklogQueueSync({
    handoffText: handoff(
      '### B13 — the CI check itself\n\nThe opt-out marker is `no-queue-entry-needed: <reason>` written inside the item.\n',
    ),
    intakeText: intake('(queue is empty)'),
  })

  assert.deepEqual(result.skipped, [])
  assert.equal(result.status, 'failed')
  assert.deepEqual(
    result.missing.map((entry) => entry.number),
    [13],
  )
})

test('the marker still works with bullet or blockquote decoration', () => {
  for (const line of [
    'no-queue-entry-needed: plain.',
    '- no-queue-entry-needed: bulleted.',
    '> no-queue-entry-needed: quoted.',
    '**no-queue-entry-needed:** bolded.',
  ]) {
    const result = checkBacklogQueueSync({
      handoffText: handoff(`### B4 — parked\n\n${line}\n`),
      intakeText: intake('(queue is empty)'),
    })
    assert.equal(result.status, 'ok', line)
    assert.equal(result.skipped.length, 1, line)
  }
})

test('accepts an item that the coordinator already moved out of the queue', () => {
  const result = checkBacklogQueueSync({
    handoffText: handoff('### B8 — dispatched work\n\nDetail.'),
    intakeText: intake('(queue is empty)', '### REQUEST — Backlog B8 — dispatched 2026-07-31'),
  })

  assert.equal(result.status, 'ok')
  assert.deepEqual(
    result.matched.map((entry) => [entry.number, entry.section]),
    [[8, 'IN PROGRESS']],
  )
})

test('warns and exits 0 when the BACKLOG section is absent', () => {
  const result = checkBacklogQueueSync({
    handoffText: '# Handoff\n\n## Notes\n\nNothing here.\n',
    intakeText: intake('### REQUEST — Backlog B1 — something'),
  })

  assert.equal(result.status, 'skipped')
  assert.match(result.warnings[0], /no `## BACKLOG` heading/)
  const report = formatReport(result)
  assert.equal(report.exitCode, 0)
  assert.match(report.lines.join('\n'), /SKIPPED/)
})

test('warns and exits 0 when the REQUEST QUEUE section is renamed away', () => {
  const result = checkBacklogQueueSync({
    handoffText: handoff('### B1 — first thing\n\nDetail.'),
    intakeText: '# Intake\n\n## INBOX\n\nRenamed section.\n',
  })

  assert.equal(result.status, 'skipped')
  assert.match(result.warnings[0], /no `## REQUEST QUEUE` heading/)
  assert.equal(formatReport(result).exitCode, 0)
})

test('warns and exits 0 when the backlog item heading convention changed', () => {
  const result = checkBacklogQueueSync({
    handoffText: handoff('### Item one — renamed convention\n\nDetail.'),
    intakeText: intake('(queue is empty)'),
  })

  assert.equal(result.status, 'skipped')
  assert.match(result.warnings[0], /no `### B<n>` items/)
  assert.equal(formatReport(result).exitCode, 0)
})

test('warns and exits 0 when either file cannot be read', () => {
  assert.equal(
    checkBacklogQueueSync({ handoffText: undefined, intakeText: intake('') }).status,
    'skipped',
  )
  assert.equal(
    checkBacklogQueueSync({ handoffText: handoff('### B1 — x'), intakeText: undefined }).status,
    'skipped',
  )
})

test('still FAILS on an empty queue when both documents parsed fine (the 2026-07-31 bug)', () => {
  const result = checkBacklogQueueSync({
    handoffText: handoff('### B1 — a\n\nx\n\n### B2 — b\n\nx'),
    intakeText: intake('_No open requests._'),
  })

  assert.equal(result.status, 'failed')
  assert.deepEqual(
    result.missing.map((entry) => entry.number),
    [1, 2],
  )
})

test('a queue entry for a non-existent B-number is reported but never fails', () => {
  const result = checkBacklogQueueSync({
    handoffText: handoff('### B1 — first thing\n\nDetail.'),
    intakeText: intake(
      '### REQUEST — Backlog B1 — do it\n\n### REQUEST — Backlog B42 — retired item',
    ),
  })

  assert.equal(result.status, 'ok')
  assert.deepEqual(result.stale, [42])
  const report = formatReport(result)
  assert.equal(report.exitCode, 0)
  assert.match(report.lines.join('\n'), /references B42, which no longer exists/)
})

test('the `B2.0` / `B2.1` sub-headings of the intake file are not read as a reference to B2', () => {
  const result = checkBacklogQueueSync({
    handoffText: handoff('### B2 — second thing\n\nDetail.'),
    intakeText: intake('(queue is empty)'),
  })

  assert.equal(result.status, 'failed')
  assert.deepEqual(
    result.missing.map((entry) => entry.number),
    [2],
  )
})

test('the real repository documents are in sync today', () => {
  const result = checkBacklogQueueSync({
    handoffText: readFileSync(path.join(repoRoot, HANDOFF_FILE), 'utf8'),
    intakeText: readFileSync(path.join(repoRoot, INTAKE_FILE), 'utf8'),
  })

  assert.notEqual(result.status, 'skipped', formatReport(result).lines.join('\n'))
  assert.equal(result.status, 'ok', formatReport(result).lines.join('\n'))
})
