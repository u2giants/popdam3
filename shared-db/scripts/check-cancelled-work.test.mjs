/**
 * Tests for the cancelled-work guard (plan item C2, issue #619).
 *
 * NO DATABASE, NO NETWORK, NO GIT. The diff is injected.
 *
 * The two mitigations the plan makes mandatory are both asserted here: the rot
 * valve, and that the table is the only copy. The false-positive budget from
 * check-skill-drift's first run is asserted too -- a wrapped correction must
 * not fail.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CANCELLED,
  addedLines,
  findReintroduced,
  formatReport,
  main,
  validateTable,
} from './check-cancelled-work.mjs'

const diffOf = (file, ...lines) =>
  [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, ...lines.map((l) => `+${l}`)].join(
    '\n',
  )

const io = (diff) => ({ diff: () => diff })

// --- the real cancellations -------------------------------------------------

test('reintroducing the R-SEC-1 git-history scrub FAILS', () => {
  const diff = diffOf('docs/plan.md', 'Step 3: scrub the Disney CSV from git history with filter-repo.')
  const findings = findReintroduced(diff)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].id, 'R-SEC-1c-history-rewrite')
  assert.equal(main([], io(diff)), 1)
})

test('reintroducing "make the repo private" FAILS', () => {
  const diff = diffOf('docs/plan.md', 'First we should make the repository private again.')
  const findings = findReintroduced(diff)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].id, 'make-shared-db-private')
  assert.equal(main([], io(diff)), 1)
})

test('an unrelated change PASSES', () => {
  const diff = diffOf('docs/plan.md', 'Add a column to the order line table.')
  assert.equal(findReintroduced(diff).length, 0)
  assert.equal(main([], io(diff)), 0)
})

// --- the false-positive budget ---------------------------------------------

test('a line that CANCELS the instruction does not fail', () => {
  const diff = diffOf('AGENTS.md', 'Do not rewrite this repository git history for that reason.')
  assert.equal(findReintroduced(diff).length, 0)
})

test('a correction that WRAPS onto the next line does not fail', () => {
  // check-skill-drift produced three false positives of exactly this shape on
  // its first run: the pattern was line-scoped, the correction was not.
  const diff = diffOf(
    'AGENTS.md',
    'The request asks to scrub the extract from git history.',
    'That request is cancelled — the owner ruled the data is not sensitive.',
  )
  assert.equal(findReintroduced(diff).length, 0)
})

test('the escape does not leak across files', () => {
  const diff = [
    diffOf('a.md', 'make the repository private'),
    diffOf('b.md', 'this is cancelled'),
  ].join('\n')
  assert.equal(findReintroduced(diff).length, 1, 'a cancellation in another file must not excuse it')
})

test('the guard does not fail on its own table', () => {
  // This file and the script necessarily contain every pattern they look for.
  const selfDiff = diffOf(
    'scripts/check-cancelled-work.mjs',
    "what: 'make u2giants/shared-db private',",
  )
  assert.equal(main([], io(selfDiff)), 0)
})

// --- the rot valve, which the plan makes mandatory --------------------------

test('an EMPTY table fails — gutting it is not a quiet pass', () => {
  const problems = validateTable([])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /EMPTY/)
})

test('a row without a REASON fails', () => {
  const problems = validateTable([
    { id: 'x', what: 'w', ruling: 'r', pattern: /x/, unless: /y/ },
  ])
  assert.ok(problems.some((p) => /REASON/.test(p)))
})

test('a row without a RULING reference fails', () => {
  const problems = validateTable([
    { id: 'x', what: 'w', reason: 'r', pattern: /x/, unless: /y/ },
  ])
  assert.ok(problems.some((p) => /RULING/.test(p)))
})

test('a row without an `unless` escape fails', () => {
  const problems = validateTable([{ id: 'x', what: 'w', ruling: 'r', reason: 'r', pattern: /x/ }])
  assert.ok(problems.some((p) => /unless/.test(p)))
})

test('duplicate ids fail', () => {
  const row = { id: 'x', what: 'w', ruling: 'r', reason: 'r', pattern: /x/, unless: /y/ }
  assert.ok(validateTable([row, { ...row }]).some((p) => /duplicate/.test(p)))
})

test('the shipped table passes its own rot valve', () => {
  assert.deepEqual(validateTable(), [])
  assert.ok(CANCELLED.length >= 2, 'seeded with the two known cancellations')
})

// --- failure modes that must be loud ----------------------------------------

test('an unreadable diff FAILS rather than passing', () => {
  const exit = main([], {
    diff: () => {
      throw new Error('unknown revision origin/main')
    },
  })
  assert.equal(exit, 1, 'a diff we cannot read is not a clean diff')
})

test('only ADDED lines are scanned, never removed ones', () => {
  // Deleting a cancelled instruction is the fix, not the offence.
  const diff = [
    'diff --git a/x.md b/x.md',
    '--- a/x.md',
    '+++ b/x.md',
    '-make the repository private',
  ].join('\n')
  assert.equal(addedLines(diff).length, 0)
  assert.equal(findReintroduced(diff).length, 0)
})

test('the report names the ruling and the reason, not just the match', () => {
  const findings = findReintroduced(diffOf('x.md', 'make the repository private'))
  const report = formatReport(findings)
  assert.match(report, /ruling:/)
  assert.match(report, /why:/)
  assert.match(report, /branch protection/i)
  assert.match(report, /Do not work around this check/)
})
