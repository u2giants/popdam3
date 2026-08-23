// Unit tests for the DISPATCH-TIME collision check.
//
// Every test here exercises PURE logic — no `gh`, no network, no database.
// The I/O helpers (gatherClaims / gatherOpenPrObjects) are deliberately not
// covered here; they are thin wrappers whose failure mode is the Unknown
// exception, and the CLI's handling of that is asserted in the last block.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  bodyFromClaimCommand,
  claimBody,
  claimCommand,
  encodeRepoPath,
  localVersionSource,
  findDispatchConflicts,
  formatReport,
  gatherOpenPrObjects,
  nextFreeVersion,
  normalizeObject,
  parseClaimBlock,
  reserveVersion,
  Unknown,
  utcStamp,
  versionRef,
  versionsOnDisk,
} from './check-dispatch-collision.mjs'
import {
  describeCoverage,
  describeDispatchCoverage,
  dispatchObjectKeys,
  DISPATCH_UNMODELLED_FORMS,
  extractObjects,
  extractOperations,
  inventoryDdlVerbs,
} from './check-pr-object-collisions.mjs'

// --- parseClaimBlock -------------------------------------------------------

test('parseClaimBlock reads version and objects out of a fenced block', () => {
  const parsed = parseClaimBlock(
    'Some prose.\n\n```db-claim\nversion: 20260806120000\nobjects:\n  - function plm.foo\n  - table core.licensor\n```\n\nMore prose.',
  )
  assert.deepEqual(parsed, {
    version: '20260806120000',
    writes: ['function plm.foo', 'table core.licensor'],
    reads: [],
    legacyObjects: ['function plm.foo', 'table core.licensor'],
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
  assert.deepEqual(parsed, { version: null, writes: [], reads: [], legacyObjects: [], objects: [] })
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
  assert.match(text, /CHECKED: *column, comment, function/)
  // Since #563 taught the dispatch parser every class, NOT CHECKED is empty —
  // and the report must SAY that rather than print a bare "NOT CHECKED:" line,
  // which reads as a truncated list.
  assert.match(text, /NOT CHECKED: \(no DDL class is unmodelled\)/)
  // The absence of unchecked classes must NOT be allowed to become a verdict.
  assert.match(text, /EVIDENCE, not clearance/)
  assert.match(text, /dynamic SQL/)
})

test('formatReport derives the CHECKED list from the parser, not from a literal', () => {
  // Step 3b taught the parser `alter table`, and this report followed it with
  // no second edit — which is what this test existed to guarantee. It now
  // tracks the DISPATCH coverage, the one the report actually prints.
  const coverage = describeDispatchCoverage()
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
    writes: ['function plm.foo'],
    reads: [],
    legacyObjects: ['function plm.foo'],
    objects: ['function plm.foo'],
  })
})

test('claimCommand round-trips a read-only claim as zero objects', () => {
  const body = bodyFromClaimCommand(claimCommand({ task: 'investigate', objects: [], version: null }))
  assert.deepEqual(parseClaimBlock(body), { version: null, writes: [], reads: [], legacyObjects: [], objects: [] })
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
// THESE FOUR WERE LANDED `todo` AND GENUINELY RED in Phase A, because the parser
// fix was plan step 3b. `node --test` reports a todo test on every run, so the
// gap stayed visible rather than hiding in a `skip`.
//
// STEP 3b (#563) IS NOW DONE, so the `{ todo: … }` option is DELETED from all
// four and they must pass for real. The only change to their bodies is which
// extractor they call: `dispatchObjectKeys` is the DISPATCH policy's reading of
// the SQL, while `extractObjects` remains the merge guard's narrower
// whole-object-replacement reading and is deliberately unchanged. The DDL text
// and the assertion are exactly as landed.

test('an alter table in an open PR collides with a proposal naming that table', () => {
  const prObjects = dispatchObjectKeys('alter table core.licensor add column risk_tier text;')
  assert.deepEqual(prObjects, ['table core.licensor'])
  const result = findDispatchConflicts({ objects: ['table core.licensor'] }, [
    { label: 'PR #501', objects: prObjects, versions: [] },
  ])
  assert.equal(result.overlapFound, true)
})

test('a create table in an open PR collides with a proposal naming that table', () => {
  const prObjects = dispatchObjectKeys('create table core.widget (id uuid primary key);')
  assert.deepEqual(prObjects, ['table core.widget'])
  const result = findDispatchConflicts({ objects: ['table core.widget'] }, [
    { label: 'PR #502', objects: prObjects, versions: [] },
  ])
  assert.equal(result.overlapFound, true)
})

test('a create index in an open PR collides with a proposal naming its table', () => {
  const prObjects = dispatchObjectKeys('create index idx_licensor_code on core.licensor(code);')
  // BOTH identities: an index is a write to its table, and the index name is
  // itself claimable. Emitting only one of the two was a false clear either way.
  assert.deepEqual(prObjects, ['index core.idx_licensor_code', 'table core.licensor'])
  const result = findDispatchConflicts({ objects: ['table core.licensor'] }, [
    { label: 'PR #503', objects: prObjects, versions: [] },
  ])
  assert.equal(result.overlapFound, true)
})

test('a grant in an open PR collides with a proposal naming that table', () => {
  const prObjects = dispatchObjectKeys('grant select on core.licensor to anon;')
  assert.deepEqual(prObjects, ['table core.licensor'])
  const result = findDispatchConflicts({ objects: ['table core.licensor'] }, [
    { label: 'PR #504', objects: prObjects, versions: [] },
  ])
  assert.equal(result.overlapFound, true)
})

// --- the rest of the blind spot named in the issue (#563) ------------------

test('comment on / create type / anonymous index are all visible to dispatch', () => {
  // `comment on column` must reach the TABLE too, or a column comment and a
  // table rewrite run concurrently and one is lost.
  assert.deepEqual(dispatchObjectKeys('comment on column core.t.c is $$x$$;'), [
    'column core.t.c',
    'table core.t',
  ])
  assert.deepEqual(dispatchObjectKeys('create type core.status as enum ($$a$$);'), ['type core.status'])
  // An UNNAMED index still names its table; the optional-name group must not
  // swallow the `on` keyword and lose the target entirely.
  assert.deepEqual(dispatchObjectKeys('create index on core.licensor (code);'), ['table core.licensor'])
})

test('a grant on a schema does NOT masquerade as a table of the same name', () => {
  // The object-type keyword is optional in Postgres and defaults to TABLE, so
  // dropping it entirely would make `grant usage on schema plm` collide with a
  // table called `plm` and miss a real collision on the schema.
  assert.deepEqual(dispatchObjectKeys('grant usage on schema plm to anon;'), ['schema plm'])
  // `on all tables in schema s` must not extract a phantom table named "all".
  assert.deepEqual(dispatchObjectKeys('grant select on all tables in schema pim to anon;'), ['schema pim'])
})

test('a table rename claims the NEW name as well as the old one', () => {
  // Emitting only the old identity lets a second agent claim the new name and
  // collide invisibly.
  assert.deepEqual(dispatchObjectKeys('alter table core.a rename to b;'), ['table core.a', 'table core.b'])
})

test('extractOperations reports action and kind separately, dispatch keys drop the action', () => {
  const ops = extractOperations('alter table core.licensor add column x text;')
  assert.deepEqual(ops, [{ action: 'alter', kind: 'table', target: 'core.licensor' }])
  // Under the dispatch policy ANY write to a target collides with any other, so
  // `alter` and `create` must reduce to the identical comparison key.
  assert.deepEqual(
    dispatchObjectKeys('create table core.licensor (id int);'),
    dispatchObjectKeys('alter table core.licensor add column x text;'),
  )
})

test('the MERGE guard parser is deliberately unchanged by this work', () => {
  // The load-bearing safety property of #563. `check-pr-object-collisions.mjs`
  // is a REQUIRED check on main; widening it would make its own failure
  // messages ("one of these bodies would be silently overwritten") false and
  // would risk exactly the alarm fatigue this workstream exists to cure.
  // Plan step 3a's acceptance rule is satisfied by construction only while this
  // stays true, so it is asserted, not assumed.
  assert.deepEqual(extractObjects('alter table core.licensor add column x text;'), [])
  assert.deepEqual(extractObjects('create table core.widget (id int);'), [])
  assert.deepEqual(extractObjects('grant select on core.licensor to anon;'), [])
  assert.deepEqual(describeCoverage().alterModelled, false)
  // …while the dispatch policy DOES model alter.
  assert.equal(describeDispatchCoverage().alterModelled, true)
})

test('dispatch coverage leaves no known DDL class unmodelled', () => {
  // The report prints this list. If a class reappears here, the report starts
  // telling coordinators the tool is blind to it and this test says so first.
  assert.deepEqual(describeDispatchCoverage().notChecked, [])
})

test('no unmodelled DDL verb hides in the real migrations directory', () => {
  // THE ANTI-REGRESSION MEASUREMENT (plan step 3b). Nothing in this repo would
  // have noticed a NEW large blind class appearing — which is exactly how a
  // parser blind to `alter table` shipped behind a green build. This walks the
  // REAL migrations, not a fixture, so a future migration style that the parser
  // cannot read fails here instead of returning a silent false clear.
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql'))
  assert.ok(files.length > 100, `expected the real migrations directory, saw ${files.length} files`)

  const inventory = inventoryDdlVerbs(files.map((name) => readFileSync(new URL(name, dir), 'utf8')))
  assert.ok(inventory.length > 20, `inventory looks broken, only ${inventory.length} forms found`)

  // A form is acceptable only if the parser MODELS it, or it is listed in
  // DISPATCH_UNMODELLED_FORMS with a written reason. Anything else is a NEW
  // blind class and fails here — the whole point of the measurement.
  const unacknowledged = inventory.filter((entry) => !entry.acknowledged)
  assert.deepEqual(
    unacknowledged.map((e) => `${e.verb} (${e.count}x)`),
    [],
    'DDL forms in supabase/migrations/ that the dispatch parser neither models nor ' +
      'acknowledges. Teach DISPATCH_PATTERNS the form, or add it to ' +
      'DISPATCH_UNMODELLED_FORMS with a reason. Do not delete this test.',
  )

  // The acknowledged-but-unmodelled set must stay SMALL and every entry must
  // carry a real reason, or the escape hatch becomes the new blind spot.
  const unmodelled = inventory.filter((entry) => !entry.modelled)
  for (const entry of unmodelled) {
    const reason = DISPATCH_UNMODELLED_FORMS[entry.verb]
    assert.ok(reason && reason.length > 40, `${entry.verb} needs a real written reason, got: ${reason}`)
  }
  const unmodelledStatements = unmodelled.reduce((sum, e) => sum + e.count, 0)
  const total = inventory.reduce((sum, e) => sum + e.count, 0)
  assert.ok(
    unmodelledStatements / total < 0.05,
    `${unmodelledStatements}/${total} DDL statements are unmodelled — over the 5% ceiling. ` +
      'The dispatch parser has drifted behind what the migrations actually do.',
  )
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

test('literal DDL inside a DO block is visible to dispatch and inventory', () => {
  const sql = `do $$ begin
    alter table dflow.sample_shipment_item add constraint sample_unique unique (id);
  end $$;`
  assert.deepEqual(dispatchObjectKeys(sql), ['table dflow.sample_shipment_item'])
  const inventory = inventoryDdlVerbs([sql])
  assert.ok(inventory.some((entry) => entry.verb === 'alter table'))
})

test('literal DDL inside DO LANGUAGE with a tagged body is visible', () => {
  const sql = `do language plpgsql $guard$ begin
    create table core.tagged_do_table (id bigint);
  end $guard$;`
  assert.deepEqual(dispatchObjectKeys(sql), ['table core.tagged_do_table'])
  const inventory = inventoryDdlVerbs([sql])
  assert.ok(inventory.some((entry) => entry.verb === 'create table'))
})

test('dynamic DDL and function-body prose remain excluded', () => {
  const sql = `create or replace function plm.f() returns void language plpgsql as $body$ begin
    execute 'alter table core.secret add column x text';
  end $body$;`
  assert.deepEqual(dispatchObjectKeys(sql), ['function plm.f'])
})

// --- gatherOpenPrObjects (plan step 2b) ------------------------------------

const SQL = 'create or replace function plm.foo() returns void as $$ begin end $$ language plpgsql;'

/** A fake GitHub, so the gathering LOGIC is testable without a network call. */
const fakeIo = (pulls, filesByPr, bodies = {}) => ({
  listPulls: () => pulls.map(({ changed_files: _omitted, ...pull }) => pull),
  getPull: (_repo, number) => {
    const pull = pulls.find((item) => item.number === number)
    return pull ? { changed_files: filesByPr[number]?.length ?? 0, ...pull } : null
  },
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

test('open PR coverage refuses a truncated or 3000-file GitHub response', () => {
  const one = [FILE('supabase/migrations/20260806120000_x.sql')]
  assert.throws(() => gatherOpenPrObjects('o/r', fakeIo([PR(1, { changed_files: 2 })], { 1: one })), /returned 1 of 2/)
  assert.throws(() => gatherOpenPrObjects('o/r', fakeIo([PR(1, { changed_files: 3000 })], { 1: one })), /3000-file limit/)
})

test('open PRs hydrate detail metadata because the list endpoint omits changed_files', () => {
  let hydrated=0
  const io=fakeIo([PR(984)],{984:[FILE('supabase/migrations/20260806120000_x.sql')]})
  const wrapped={...io,getPull:(...args)=>(hydrated++,io.getPull(...args))}
  const sources=gatherOpenPrObjects('o/r',wrapped)
  assert.equal(hydrated,1)
  assert.equal(sources.length,1)
})

test('open PR gathering fails closed when detail hydration is unreadable', () => {
  const io=fakeIo([PR(984)],{984:[]});io.getPull=()=>null
  assert.throws(()=>gatherOpenPrObjects('o/r',io),/unreadable detail metadata/)
})

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

// --- #670: versions already on disk are a comparison source ----------------

test('#670 localVersionSource turns the on-disk versions into an in-flight source', () => {
  const source = localVersionSource(['20260810130000', '20260810140000', '20260810130000'])
  assert.equal(source.length, 1)
  // De-duplicated and sorted, so the report cannot list the same stamp twice.
  assert.deepEqual(source[0].versions, ['20260810130000', '20260810140000'])
  // It claims NO objects: the object axis is covered by the PR/claim sources,
  // and asserting objects here would over-block every dispatch in the repo.
  assert.deepEqual(source[0].objects, [])
  assert.match(source[0].label, /this checkout/)
})

test('#670 an empty migrations directory contributes NO source, not an empty one', () => {
  // An empty source would make formatReport say "checked against 1 in-flight
  // item", which reads as evidence gathered when none was.
  assert.deepEqual(localVersionSource([]), [])
})

test('#670 a version already on disk is now a CONFLICT, not a clear', () => {
  // The 2026-08-10 near-miss: two agents both chose 20260810130000. Before this,
  // main compared only against open claims and open PRs, so a stamp already
  // written in this checkout came back clear.
  const result = findDispatchConflicts(
    { objects: [], version: '20260810130000' },
    localVersionSource(['20260810130000']),
  )
  assert.equal(result.overlapFound, true)
  assert.equal(result.versionConflicts.length, 1)
  assert.equal(result.versionConflicts[0].version, '20260810130000')
})

test('#670 a free version is still clear against a populated migrations directory', () => {
  const result = findDispatchConflicts(
    { objects: [], version: '20260811090000' },
    localVersionSource(['20260810130000', '20260810140000']),
  )
  assert.equal(result.overlapFound, false)
})

// --- #669: a claim body that cannot lose its fence -------------------------

test('#669 claimBody round-trips through parseClaimBlock', () => {
  // Claim #666 was filed with the right label and a sensible body but WITHOUT
  // the fenced block, which made gatherClaims throw UNKNOWN and jammed the gate
  // for every later dispatch. A file-based body cannot lose the fence to a
  // shell quoting rule the way the bash heredoc did on PowerShell.
  const proposed = { task: 'rewrite promotion fn', objects: ['function plm.foo'], version: '20260811090000' }
  const parsed = parseClaimBlock(claimBody(proposed))
  assert.notEqual(parsed, null)
  assert.equal(parsed.version, '20260811090000')
  assert.deepEqual(parsed.objects, ['function plm.foo'])
})

test('#669 a read-only claim (no objects) still parses', () => {
  const parsed = parseClaimBlock(claimBody({ task: 'read-only audit', objects: [], version: null }))
  assert.notEqual(parsed, null)
  assert.deepEqual(parsed.objects, [])
})

test('#669 the heredoc command and the body file are byte-identical', () => {
  // Two filing routes that drift produce two different claim shapes, and the
  // gate only understands one of them.
  const proposed = { task: 't', objects: ['table core.licensor'], version: '20260811090000' }
  assert.equal(bodyFromClaimCommand(claimCommand(proposed)), claimBody(proposed))
})

test('#669 the printed recipe points PowerShell users at --claim-body-file', () => {
  const command = claimCommand({ task: 't', objects: ['table core.licensor'], version: null })
  assert.match(command, /--claim-body-file/)
})

// --- #670 ATOMIC VERSION RESERVATION ---------------------------------------
//
// The axis NO mechanical check covered. Guard A sees one branch at a time; the
// cross-PR object guard compares objects, not versions; and this script's own
// version check is a READ, so two agents reading in the same minute both get a
// clear. On 2026-08-10 two dispatched agents both landed on 20260810130000 and
// only a human reading an open PR's file list caught it.
//
// `createRefFake` models the ONE property the whole design rests on: GitHub's
// `POST /git/refs` is create-if-absent and answers `422 Reference already
// exists` for a duplicate. The primitive itself was verified live against this
// repository on 2026-08-06 (recorded in plan_dispatch-collision-hardening.md
// step 5); it is not re-verified here because doing so would create permanent
// refs in a shared repository as a side effect of running the test suite.

function createRefFake(preTaken = []) {
  const refs = new Set(preTaken.map((v) => versionRef(v)))
  const calls = []
  return {
    refs,
    calls,
    baseSha: () => 'a'.repeat(40),
    createRef(_repo, ref) {
      calls.push(ref)
      if (refs.has(ref)) return 'exists'
      refs.add(ref)
      return 'created'
    },
  }
}

test('#670 versionRef is deterministic and rejects anything that is not 14 digits', () => {
  assert.equal(versionRef('20260812211000'), 'refs/db-claims/20260812211000')
  assert.equal(versionRef('20260812211000'), versionRef(20260812211000))
  // A junk ref created from a typo would be permanent, so this fails before
  // any network call rather than after one.
  for (const bad of ['2026081221100', '202608122110000', 'main', '', 'abcdefghijklmn']) {
    assert.throws(() => versionRef(bad), Unknown, `expected ${JSON.stringify(bad)} to be rejected`)
  }
})

test('#670 a free version is reserved on the first attempt', () => {
  const io = createRefFake()
  const got = reserveVersion({ stamp: '20260812211000', repo: 'r', sha: 'x', io })
  assert.equal(got.version, '20260812211000')
  assert.equal(got.ref, 'refs/db-claims/20260812211000')
  assert.equal(got.attempts, 1)
  assert.deepEqual(got.skipped, [])
})

test('#670 TWO AGENTS RACING ON THE SAME STAMP CANNOT BOTH GET IT', () => {
  // The whole point of the issue, expressed as the 2026-08-10 near-miss:
  // both agents start from the same number, in the same minute, with the same
  // view of the repository.
  const io = createRefFake()
  const first = reserveVersion({ stamp: '20260810130000', repo: 'r', sha: 'x', io })
  const second = reserveVersion({ stamp: '20260810130000', repo: 'r', sha: 'x', io })
  assert.equal(first.version, '20260810130000')
  assert.notEqual(second.version, first.version)
  assert.equal(second.version, '20260810130001')
  assert.deepEqual(second.skipped, ['20260810130000'])
  // And a third does not get the second's number either.
  const third = reserveVersion({ stamp: '20260810130000', repo: 'r', sha: 'x', io })
  assert.equal(third.version, '20260810130002')
  assert.equal(new Set([first.version, second.version, third.version]).size, 3)
})

test('#670 reservation walks past a run of versions already held', () => {
  const io = createRefFake(['20260812211000', '20260812211001', '20260812211002'])
  const got = reserveVersion({ stamp: '20260812211000', repo: 'r', sha: 'x', io })
  assert.equal(got.version, '20260812211003')
  assert.equal(got.attempts, 4)
  assert.deepEqual(got.skipped, ['20260812211000', '20260812211001', '20260812211002'])
})

test('#670 failure to read versions on disk fails closed', () => {
  assert.throws(
    () => versionsOnDisk('Z:/path-that-must-not-exist/shared-db-migrations'),
    (error) => error instanceof Unknown && /could not read/.test(error.message),
  )
})

test('#670 reservation skips versions already present on disk, a PR, or a claim', () => {
  const io = createRefFake()
  const got = reserveVersion({
    stamp: '20260812211000', repo: 'r', sha: 'x', io,
    unavailableVersions: ['20260812211000', '20260812211001'],
  })
  assert.equal(got.version, '20260812211002')
  assert.deepEqual(got.skipped, ['20260812211000', '20260812211001'])
  assert.deepEqual(io.calls, ['refs/db-claims/20260812211002'])
})

test('#670 exhausting the attempt budget THROWS instead of returning a free-for-all number', () => {
  // The dangerous shortcut would be to give up and hand back an unreserved
  // version, which is precisely the withdrawn --allocate-version behaviour.
  const taken = Array.from({ length: 5 }, (_, i) => String(20260812211000n + BigInt(i)))
  const io = createRefFake(taken)
  assert.throws(
    () => reserveVersion({ stamp: '20260812211000', repo: 'r', sha: 'x', io, maxAttempts: 5 }),
    (error) => error instanceof Unknown && /could not reserve/.test(error.message),
  )
})

test('#670 an UNCLASSIFIED createRef result is never treated as "already taken"', () => {
  // NO SILENT FAILURES. Reading a 403, a rate limit or a dropped connection as
  // "exists" would skip a version that is actually free, and on the last
  // attempt would dress a network failure up as a successful reservation.
  const io = { createRef: () => 'probably fine?' }
  assert.throws(
    () => reserveVersion({ stamp: '20260812211000', repo: 'r', sha: 'x', io }),
    (error) => error instanceof Unknown && /expected 'created' or 'exists'/.test(error.message),
  )
  const throwing = { createRef: () => { throw new Unknown('403 rate limited') } }
  assert.throws(() => reserveVersion({ stamp: '20260812211000', repo: 'r', sha: 'x', io: throwing }), Unknown)
})

test('#670 reservation asks the server exactly once per candidate', () => {
  // A retry loop that re-checked before creating would reopen the
  // read-then-write window the ref exists to close.
  const io = createRefFake(['20260812211000'])
  reserveVersion({ stamp: '20260812211000', repo: 'r', sha: 'x', io })
  assert.deepEqual(io.calls, ['refs/db-claims/20260812211000', 'refs/db-claims/20260812211001'])
})

test('#670 utcStamp produces a 14-digit version that versionRef accepts', () => {
  const stamp = utcStamp(new Date('2026-08-12T21:10:00.000Z'))
  assert.equal(stamp, '20260812211000')
  assert.equal(versionRef(stamp), 'refs/db-claims/20260812211000')
})

// --- READ/WRITE CLAIMS (Step 2, issue #1366) --------------------------------

test('a writes:/reads: claim is parsed into separate lists', () => {
  const parsed = parseClaimBlock('```db-claim\nversion: 20260823120000\nwrites:\n  - table core.a\nreads:\n  - table core.b\n```')
  assert.deepEqual(parsed.writes, ['table core.a'])
  assert.deepEqual(parsed.reads, ['table core.b'])
  assert.deepEqual(parsed.legacyObjects, [], 'a modern claim declares no legacy objects')
})

// LEGACY_OBJECTS_MEANS_WRITES. Reading an old claim as anything weaker than a
// write would let a new writer start against work already in flight.
test('a legacy objects: claim is read as WRITES, never as reads', () => {
  const parsed = parseClaimBlock('```db-claim\nversion: 20260806120000\nobjects:\n  - table core.a\n```')
  assert.deepEqual(parsed.writes, ['table core.a'])
  assert.deepEqual(parsed.reads, [])
  assert.deepEqual(parsed.legacyObjects, ['table core.a'], 'the claim is flagged as legacy so Step 8A can find it')
})

test('an object declared as both a read and a write is reported as a write only', () => {
  const parsed = parseClaimBlock('```db-claim\nwrites:\n  - table core.a\nreads:\n  - table core.a\n  - table core.b\n```')
  assert.deepEqual(parsed.writes, ['table core.a'])
  assert.deepEqual(parsed.reads, ['table core.b'], 'the duplicate is dropped from reads, not from writes')
})

test('reads and writes both normalise case, spacing and duplicates', () => {
  const parsed = parseClaimBlock('```db-claim\nwrites:\n  - TABLE   core.A\n  - table core.a\nreads:\n  * VIEW api.B\n```')
  assert.deepEqual(parsed.writes, ['table core.a'])
  assert.deepEqual(parsed.reads, ['view api.b'])
})
