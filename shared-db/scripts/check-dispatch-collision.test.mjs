// Unit tests for the DISPATCH-TIME collision check.
//
// Every test here exercises PURE logic — no `gh`, no network, no database.
// The I/O helpers (gatherClaims / gatherOpenPrObjects) are deliberately not
// covered here; they are thin wrappers whose failure mode is the Unknown
// exception, and the CLI's handling of that is asserted in the last block.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bodyFromClaimCommand,
  claimCommand,
  findDispatchConflicts,
  formatReport,
  nextFreeVersion,
  normalizeObject,
  parseClaimBlock,
} from './check-dispatch-collision.mjs'

// --- parseClaimBlock -------------------------------------------------------

test('parseClaimBlock reads version and objects out of a fenced block', () => {
  const parsed = parseClaimBlock(
    'Some prose.\n\n```db-claim\nversion: 20260806120000\nobjects:\n  - function plm.foo\n  - table core.licensor\n```\n\nMore prose.',
  )
  assert.deepEqual(parsed, {
    version: '20260806120000',
    objects: ['function plm.foo', 'table core.licensor'],
  })
})

test('parseClaimBlock returns null when there is no block at all', () => {
  // Critical: null means UNKNOWN, not "claims nothing". An unreadable claim
  // must never be silently treated as harmless.
  assert.equal(parseClaimBlock('just prose, no fence'), null)
  assert.equal(parseClaimBlock(undefined), null)
  assert.equal(parseClaimBlock(null), null)
})

test('parseClaimBlock treats a missing/none version as null', () => {
  assert.equal(parseClaimBlock('```db-claim\nversion: none\nobjects:\n  - table core.x\n```').version, null)
  assert.equal(parseClaimBlock('```db-claim\nobjects:\n  - table core.x\n```').version, null)
})

test('parseClaimBlock accepts a read-only claim with no objects', () => {
  const parsed = parseClaimBlock('```db-claim\nversion: none\nobjects:\n```')
  assert.deepEqual(parsed, { version: null, objects: [] })
})

test('parseClaimBlock normalises case, spacing and duplicates', () => {
  const parsed = parseClaimBlock(
    '```db-claim\nobjects:\n  - FUNCTION   plm.Foo\n  - function plm.foo\n  * table core.Bar\n```',
  )
  assert.deepEqual(parsed.objects, ['function plm.foo', 'table core.bar'])
})

test('parseClaimBlock stops collecting objects at a non-list line', () => {
  const parsed = parseClaimBlock(
    '```db-claim\nobjects:\n  - table core.a\nnotes: chatter\n  - table core.b\n```',
  )
  assert.deepEqual(parsed.objects, ['table core.a'])
})

// --- normalizeObject -------------------------------------------------------

test('normalizeObject collapses whitespace and lowercases', () => {
  assert.equal(normalizeObject('  FUNCTION\tplm.Foo  '), 'function plm.foo')
})

// --- findDispatchConflicts -------------------------------------------------

const CLAIM = (label, objects, version = null) => ({ label, objects, version, url: `https://x/${label}` })

test('no overlap is safe to dispatch', () => {
  const result = findDispatchConflicts(
    { objects: ['function plm.foo'] },
    [CLAIM('claim #1', ['table core.licensor'])],
  )
  assert.equal(result.safe, true)
  assert.deepEqual(result.objectConflicts, [])
})

test('the 2026-07-31 four-way case is caught at dispatch', () => {
  // Four sessions each intending `create or replace function
  // plm.promote_coldlion_source_owned`. The FIRST is dispatched and files a
  // claim; the second must be refused before any work happens.
  const inFlight = [CLAIM('claim #1 (agent A)', ['function plm.promote_coldlion_source_owned'])]
  const result = findDispatchConflicts(
    { objects: ['function plm.promote_coldlion_source_owned'] },
    inFlight,
  )
  assert.equal(result.safe, false)
  assert.equal(result.objectConflicts.length, 1)
  assert.deepEqual(result.objectConflicts[0].objects, ['function plm.promote_coldlion_source_owned'])
  assert.equal(result.objectConflicts[0].label, 'claim #1 (agent A)')
})

test('a claim and an open PR are both treated as in flight', () => {
  const result = findDispatchConflicts({ objects: ['table core.licensor'] }, [
    CLAIM('claim #1', ['function plm.foo']),
    CLAIM('PR #500', ['table core.licensor']),
  ])
  assert.equal(result.safe, false)
  assert.equal(result.objectConflicts[0].label, 'PR #500')
})

test('an empty (read-only) proposal never collides', () => {
  const result = findDispatchConflicts({ objects: [] }, [CLAIM('claim #1', ['function plm.foo'])])
  assert.equal(result.safe, true)
})

test('comparison is case- and whitespace-insensitive on both sides', () => {
  const result = findDispatchConflicts(
    { objects: ['FUNCTION  plm.Foo'] },
    [CLAIM('claim #1', ['function plm.foo'])],
  )
  assert.equal(result.safe, false)
})

test('a shared migration version is a conflict even with no object overlap', () => {
  // This is the silent-skip class: Supabase keys its ledger on the version
  // alone, so two migrations sharing 20260722220000 means one never runs.
  const result = findDispatchConflicts(
    { objects: ['table core.a'], version: '20260722220000' },
    [CLAIM('claim #1', ['table core.b'], '20260722220000')],
  )
  assert.equal(result.safe, false)
  assert.deepEqual(result.objectConflicts, [])
  assert.equal(result.versionConflicts.length, 1)
  assert.equal(result.versionConflicts[0].version, '20260722220000')
})

test('different versions do not conflict', () => {
  const result = findDispatchConflicts(
    { objects: ['table core.a'], version: '20260722220000' },
    [CLAIM('claim #1', ['table core.b'], '20260722220001')],
  )
  assert.equal(result.safe, true)
})

// --- nextFreeVersion -------------------------------------------------------

test('nextFreeVersion returns the stamp when it is free', () => {
  assert.equal(nextFreeVersion('20260806120000', ['20260806110000']), '20260806120000')
})

test('nextFreeVersion steps past versions on disk AND versions already claimed', () => {
  // Two agents dispatched in the same minute would otherwise both pick the
  // same now()-derived stamp. This is the mechanical fix for AGENTS.md rule 5.
  assert.equal(
    nextFreeVersion('20260806120000', ['20260806120000', '20260806120001']),
    '20260806120002',
  )
})

test('nextFreeVersion ignores null/undefined entries', () => {
  assert.equal(nextFreeVersion('20260806120000', [null, undefined, '20260806120000']), '20260806120001')
})

// --- formatReport ----------------------------------------------------------

test('formatReport says SAFE TO DISPATCH when clear', () => {
  const proposed = { task: 't', objects: ['function plm.foo'], version: null }
  const result = findDispatchConflicts(proposed, [])
  const text = formatReport({ proposed, inFlight: [], result })
  assert.match(text, /SAFE TO DISPATCH/)
})

test('formatReport says DO NOT DISPATCH and names the holder', () => {
  const proposed = { task: 't', objects: ['function plm.foo'], version: null }
  const inFlight = [CLAIM('claim #7', ['function plm.foo'])]
  const result = findDispatchConflicts(proposed, inFlight)
  const text = formatReport({ proposed, inFlight, result })
  assert.match(text, /DO NOT DISPATCH/)
  assert.match(text, /claim #7/)
  assert.match(text, /function plm\.foo/)
})

test('formatReport explains the silent-skip risk on a version clash', () => {
  const proposed = { task: 't', objects: [], version: '20260722220000' }
  const inFlight = [CLAIM('claim #7', [], '20260722220000')]
  const result = findDispatchConflicts(proposed, inFlight)
  const text = formatReport({ proposed, inFlight, result })
  assert.match(text, /SILENTLY SKIPPED/)
})

// --- claimCommand ----------------------------------------------------------

test('claimCommand emits a parseable db-claim block round-trip', () => {
  const proposed = { task: 'rewrite fn', objects: ['function plm.foo'], version: '20260806120000' }
  const body = bodyFromClaimCommand(claimCommand(proposed))
  assert.deepEqual(parseClaimBlock(body), {
    version: '20260806120000',
    objects: ['function plm.foo'],
  })
})

test('claimCommand round-trips a read-only claim as zero objects', () => {
  const body = bodyFromClaimCommand(claimCommand({ task: 'investigate', objects: [], version: null }))
  assert.deepEqual(parseClaimBlock(body), { version: null, objects: [] })
})

test('claimCommand body contains REAL newlines, not the characters backslash-n', () => {
  // Regression: the first version JSON-escaped the body, so `gh issue create`
  // would have filed an issue whose text was one line containing "\n", which
  // parseClaimBlock rejects. The command must be paste-able into a shell.
  const command = claimCommand({ task: 't', objects: ['table core.a'], version: null })
  assert.ok(!command.includes('\\n'), 'command must not contain escaped newlines')
  assert.match(command, /<<'CLAIM'\n/)
  assert.match(bodyFromClaimCommand(command), /^```db-claim$/m)
})
