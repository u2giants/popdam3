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
  encodeRepoPath,
  findDispatchConflicts,
  formatReport,
  gatherOpenPrObjects,
  nextFreeVersion,
  normalizeObject,
  parseClaimBlock,
  Unknown,
} from './check-dispatch-collision.mjs'
import { describeCoverage, extractObjects } from './check-pr-object-collisions.mjs'

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

// `versions` is an ARRAY: a pull request may carry several migrations, and the
// earlier scalar exposed only the first of them to comparison.
const CLAIM = (label, objects, ...versions) => ({
  label,
  objects,
  versions: versions.filter(Boolean),
  url: `https://x/${label}`,
})

test('no overlap reports overlapFound false', () => {
  const result = findDispatchConflicts(
    { objects: ['function plm.foo'] },
    [CLAIM('claim #1', ['table core.licensor'])],
  )
  assert.equal(result.overlapFound, false)
  assert.deepEqual(result.objectConflicts, [])
})

test('the result carries NO field named `safe`', () => {
  // Renaming the printed sentence alone was cosmetic: a caller reading
  // --json for `"safe": true` would have kept the old meaning. The field is
  // gone, so such a caller breaks loudly instead of quietly.
  const result = findDispatchConflicts({ objects: [] }, [])
  assert.equal('safe' in result, false)
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
  assert.equal(result.overlapFound, true)
  assert.equal(result.objectConflicts.length, 1)
  assert.deepEqual(result.objectConflicts[0].objects, ['function plm.promote_coldlion_source_owned'])
  assert.equal(result.objectConflicts[0].label, 'claim #1 (agent A)')
})

test('a claim and an open PR are both treated as in flight', () => {
  const result = findDispatchConflicts({ objects: ['table core.licensor'] }, [
    CLAIM('claim #1', ['function plm.foo']),
    CLAIM('PR #500', ['table core.licensor']),
  ])
  assert.equal(result.overlapFound, true)
  assert.equal(result.objectConflicts[0].label, 'PR #500')
})

test('an empty (read-only) proposal never collides', () => {
  const result = findDispatchConflicts({ objects: [] }, [CLAIM('claim #1', ['function plm.foo'])])
  assert.equal(result.overlapFound, false)
})

test('comparison is case- and whitespace-insensitive on both sides', () => {
  const result = findDispatchConflicts(
    { objects: ['FUNCTION  plm.Foo'] },
    [CLAIM('claim #1', ['function plm.foo'])],
  )
  assert.equal(result.overlapFound, true)
})

test('a shared migration version is a conflict even with no object overlap', () => {
  // This is the silent-skip class: Supabase keys its ledger on the version
  // alone, so two migrations sharing 20260722220000 means one never runs.
  const result = findDispatchConflicts(
    { objects: ['table core.a'], version: '20260722220000' },
    [CLAIM('claim #1', ['table core.b'], '20260722220000')],
  )
  assert.equal(result.overlapFound, true)
  assert.deepEqual(result.objectConflicts, [])
  assert.equal(result.versionConflicts.length, 1)
  assert.equal(result.versionConflicts[0].version, '20260722220000')
})

test('different versions do not conflict', () => {
  const result = findDispatchConflicts(
    { objects: ['table core.a'], version: '20260722220000' },
    [CLAIM('claim #1', ['table core.b'], '20260722220001')],
  )
  assert.equal(result.overlapFound, false)
})

test('a holder carrying SEVERAL versions is compared on every one of them', () => {
  // Defect: `version ??= stamp` captured only the FIRST migration in a pull
  // request, so a collision on its second or third migration read as clear.
  const result = findDispatchConflicts(
    { objects: [], version: '20260806120002' },
    [CLAIM('PR #500', [], '20260806120000', '20260806120001', '20260806120002')],
  )
  assert.equal(result.overlapFound, true)
  assert.equal(result.versionConflicts[0].version, '20260806120002')
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

test('formatReport prints NO verdict word and names the unchecked classes', () => {
  // The single most important assertion in this file. An advisory tool that
  // prints "SAFE" invites overtrust no matter what follows it, because agents
  // grep for the word and act on it.
  const proposed = { task: 't', objects: ['function plm.foo'], version: null }
  const result = findDispatchConflicts(proposed, [])
  const text = formatReport({ proposed, inFlight: [], result })
  assert.doesNotMatch(text, /safe/i)
  assert.match(text, /No overlap found in the object classes this tool can see/)
  assert.match(text, /CHECKED: *function/)
  assert.match(text, /NOT CHECKED:.*\btable\b/)
  assert.match(text, /EVIDENCE, not clearance/)
})

test('formatReport derives the CHECKED list from the parser, not from a literal', () => {
  // If step 3b teaches the parser `alter table`, this report must follow it
  // with no second edit. Guarding that by comparing against describeCoverage().
  const coverage = describeCoverage()
  const proposed = { task: 't', objects: [], version: null }
  const result = findDispatchConflicts(proposed, [])
  const text = formatReport({ proposed, inFlight: [], result })
  for (const kind of coverage.checked) assert.ok(text.includes(kind), `CHECKED must list ${kind}`)
  for (const kind of coverage.notChecked) assert.ok(text.includes(kind), `NOT CHECKED must list ${kind}`)
})

test('formatReport says plainly when there was NOTHING to compare against', () => {
  const proposed = { task: 't', objects: ['function plm.foo'], version: null }
  const result = findDispatchConflicts(proposed, [])
  const text = formatReport({ proposed, inFlight: [], result })
  assert.match(text, /NOTHING WAS FOUND TO COMPARE AGAINST/)
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

// --- REAL DDL THROUGH THE PARSER (plan step 2) -----------------------------
//
// THE TESTS THAT WOULD HAVE CAUGHT EVERYTHING, and did not exist.
//
// Every other test in this file injects object arrays by hand. None routes SQL
// text through `extractObjects` into `findDispatchConflicts`. Consequence: if
// `extractObjects` returned [] for every input, this whole suite would still
// pass — which is exactly how a parser blind to `alter table` shipped behind a
// green build.
//
// THESE FOUR ARE MARKED `todo` ON PURPOSE, and that is not a way of hiding a
// failure. They are RED right now (verified locally; the output is in the PR
// body for this change), because the parser fix is plan step 3b in Phase B and
// this is Phase A. `node --test` reports a todo test on every run, so the gap
// stays visible, while the required `Cross-PR object collision` job stays
// green — a pull request whose tip is red can never merge, so landing them as
// hard failures would strand this change permanently.
//
// ⚠️ STEP 3b MUST DELETE THE `{ todo: … }` OPTION FROM ALL FOUR. If they are
// still marked todo after the parser is fixed, the fix is unproven.

const TODO_UNTIL_STEP_3B = { todo: 'RED until plan step 3b teaches the parser these DDL forms' }

test('an alter table in an open PR collides with a proposal naming that table', TODO_UNTIL_STEP_3B, () => {
  const prObjects = extractObjects('alter table core.licensor add column risk_tier text;')
  const result = findDispatchConflicts({ objects: ['table core.licensor'] }, [
    { label: 'PR #501', objects: prObjects, versions: [] },
  ])
  assert.equal(result.overlapFound, true)
})

test('a create table in an open PR collides with a proposal naming that table', TODO_UNTIL_STEP_3B, () => {
  const prObjects = extractObjects('create table core.widget (id uuid primary key);')
  const result = findDispatchConflicts({ objects: ['table core.widget'] }, [
    { label: 'PR #502', objects: prObjects, versions: [] },
  ])
  assert.equal(result.overlapFound, true)
})

test('a create index in an open PR collides with a proposal naming its table', TODO_UNTIL_STEP_3B, () => {
  const prObjects = extractObjects('create index idx_licensor_code on core.licensor(code);')
  const result = findDispatchConflicts({ objects: ['table core.licensor'] }, [
    { label: 'PR #503', objects: prObjects, versions: [] },
  ])
  assert.equal(result.overlapFound, true)
})

test('a grant in an open PR collides with a proposal naming that table', TODO_UNTIL_STEP_3B, () => {
  const prObjects = extractObjects('grant select on core.licensor to anon;')
  const result = findDispatchConflicts({ objects: ['table core.licensor'] }, [
    { label: 'PR #504', objects: prObjects, versions: [] },
  ])
  assert.equal(result.overlapFound, true)
})

test('the modelled class DOES route through the parser end to end', () => {
  // The positive control for the four above: proves the wiring itself is
  // sound, so their failure is the parser's blind spot and nothing else.
  const prObjects = extractObjects(
    'create or replace function plm.promote_coldlion_source_owned() returns void as $$ begin end $$ language plpgsql;',
  )
  assert.deepEqual(prObjects, ['function plm.promote_coldlion_source_owned'])
  const result = findDispatchConflicts(
    { objects: ['function plm.promote_coldlion_source_owned'] },
    [{ label: 'PR #505', objects: prObjects, versions: [] }],
  )
  assert.equal(result.overlapFound, true)
})

// --- gatherOpenPrObjects (plan step 2b) ------------------------------------

const SQL = 'create or replace function plm.foo() returns void as $$ begin end $$ language plpgsql;'

/** A fake GitHub, so the gathering LOGIC is testable without a network call. */
const fakeIo = (pulls, filesByPr, bodies = {}) => ({
  listPulls: () => pulls,
  listPullFiles: (_repo, number) => filesByPr[number] ?? [],
  readFileAtRef: (_repo, filename) => (filename in bodies ? bodies[filename] : SQL),
})

const PR = (number, extra = {}) => ({
  number,
  title: `pr ${number}`,
  html_url: `https://x/${number}`,
  draft: false,
  head: { sha: 'deadbee' },
  ...extra,
})

const FILE = (filename, status = 'modified') => ({ filename, status })

test('a DRAFT pull request counts as in flight at dispatch time', () => {
  // Defect: `if (pr.draft) continue`. Correct for the merge guard (a draft is
  // not competing to merge) and a false clear at dispatch, where a draft is
  // someone actively writing that object right now.
  const sources = gatherOpenPrObjects(
    'o/r',
    fakeIo([PR(1, { draft: true })], { 1: [FILE('supabase/migrations/20260806120000_x.sql')] }),
  )
  assert.equal(sources.length, 1)
  assert.equal(sources[0].draft, true)
  assert.match(sources[0].label, /\[DRAFT\]/)
  assert.deepEqual(sources[0].objects, ['function plm.foo'])
})

test('EVERY migration version in a pull request is captured, not just the first', () => {
  const sources = gatherOpenPrObjects(
    'o/r',
    fakeIo([PR(2)], {
      2: [
        FILE('supabase/migrations/20260806120000_a.sql'),
        FILE('supabase/migrations/20260806120001_b.sql'),
        FILE('supabase/migrations/20260806120002_c.sql'),
      ],
    }),
  )
  assert.deepEqual(sources[0].versions, ['20260806120000', '20260806120001', '20260806120002'])
})

test('a DELETED migration file is skipped, not fetched', () => {
  let fetched = 0
  const io = fakeIo([PR(3)], {
    3: [
      FILE('supabase/migrations/20260806120000_gone.sql', 'removed'),
      FILE('supabase/migrations/20260806120001_kept.sql'),
    ],
  })
  const counting = { ...io, readFileAtRef: (...args) => (fetched += 1, io.readFileAtRef(...args)) }
  const sources = gatherOpenPrObjects('o/r', counting)
  assert.equal(fetched, 1, 'a removed file must not be fetched')
  assert.deepEqual(sources[0].versions, ['20260806120001'])
})

test('an EMPTY body for a file that exists raises instead of reading as no objects', () => {
  // The old JSON Contents fetch could return null/truncated `content` for a
  // large file WITHOUT an error — a silent false clear for that PR's DDL.
  const io = fakeIo(
    [PR(4)],
    { 4: [FILE('supabase/migrations/20260806120000_big.sql')] },
    { 'supabase/migrations/20260806120000_big.sql': '' },
  )
  assert.throws(() => gatherOpenPrObjects('o/r', io), Unknown)
})

test('encodeRepoPath encodes # and spaces but keeps the path separators', () => {
  // ⚠️ encodeURI does NOT encode `#`, so a path containing one truncates at
  // the fragment and the file silently reads as empty.
  assert.equal(
    encodeRepoPath('supabase/migrations/20260806_a b#c.sql'),
    'supabase/migrations/20260806_a%20b%23c.sql',
  )
  assert.equal(encodeRepoPath('a/b/c.sql'), 'a/b/c.sql')
})
