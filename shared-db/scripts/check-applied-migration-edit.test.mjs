import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HISTORICAL_RESTORATIONS } from './historical-migration-restorations.mjs'
import { EDIT_STATUSES, findingsFor, restorationAllows, formatReport, main, MIGRATIONS_DIR, parseArgs, parseEditedMigrations, PROJECT_REFS, runCheck, Unknown, versionOf, editedMigrations } from './check-applied-migration-edit.mjs'

const APPLIED = '20260831234750'
const NEW = '20260903120000'
const file = (version, name = 'thing') => `${MIGRATIONS_DIR}/${version}_${name}.sql`
const z = (...fields) => fields.join('\0') + '\0'

// --- parsing -------------------------------------------------------------

// This test used to assert the opposite. Incident #2037 is why it was inverted:
// `20260831234750` was created AND edited on one branch, so against main it was
// status `A`, and the guard that skipped `A` would have passed PR #2009 -- the
// pull request that caused the very incident this guard exists to prevent.
// What makes an edit forbidden is the VERSION being applied, not the file status.
test('issue 2037 an ADDED migration IS compared, because the incident arrived as one', () => {
  assert.deepEqual(parseEditedMigrations(z('A', file(NEW))), [{ version: NEW, file: file(NEW), kind: 'added' }])
})

// Reviewer finding, muse-spark-1.3-contributor at head ff39204f: only paths[0]
// was examined, so a rename INTO the migrations directory, or one that changes
// the version prefix, carried the applied version on the destination path alone
// and was skipped.
test('issue 2037 a rename is judged on BOTH paths, not only the source', () => {
  const outside = 'docs/scratch/thing.sql'
  const renamedIn = parseEditedMigrations(z('R100', outside, file(APPLIED)))
  assert.deepEqual(renamedIn.map((e) => e.version), [APPLIED], 'a rename INTO the migrations directory must be seen')
  const reversioned = parseEditedMigrations(z('R090', file(APPLIED), file(NEW)))
  assert.deepEqual(reversioned.map((e) => e.version).sort(), [APPLIED, NEW].sort(), 'a rename that changes the version touches both versions')
})

test('issue 2037 an added file whose version is already applied is REFUSED', () => {
  const edits = [{ version: APPLIED, file: file(APPLIED), kind: 'added' }]
  const findings = findingsFor(edits, { preview: new Set([APPLIED]), production: new Set() })
  assert.equal(findings.length, 1)
  assert.deepEqual(findings[0].appliedIn, ['preview'])
})

test('issue 2037 a modified migration is an edit', () => {
  assert.deepEqual(parseEditedMigrations(z('M', file(APPLIED))), [{ version: APPLIED, file: file(APPLIED), kind: 'modified' }])
})

test('issue 2037 deletion and rename are edits, and a rename keeps both paths straight', () => {
  const parsed = parseEditedMigrations(z('D', file(APPLIED), 'R096', file(NEW), file(NEW, 'renamed')))
  assert.deepEqual(parsed, [
    { version: APPLIED, file: file(APPLIED), kind: 'deleted' },
    { version: NEW, file: file(NEW), kind: 'renamed', renamedTo: file(NEW, 'renamed') },
  ])
})

test('issue 2037 a rename does not swallow the record that follows it', () => {
  // The two-path record is the one that can mis-frame the rest of the stream.
  const parsed = parseEditedMigrations(z('R100', file(NEW), file(NEW, 'moved'), 'M', file(APPLIED)))
  assert.deepEqual(parsed.map((edit) => edit.kind), ['renamed', 'modified'])
  assert.equal(parsed[1].file, file(APPLIED))
})

test('issue 2037 a path containing a space survives, because the stream is NUL-delimited', () => {
  const spaced = `${MIGRATIONS_DIR}/${APPLIED}_two words.sql`
  assert.deepEqual(parseEditedMigrations(z('M', spaced)), [{ version: APPLIED, file: spaced, kind: 'modified' }])
})

test('issue 2037 files outside supabase/migrations and non-sql files are ignored', () => {
  assert.deepEqual(parseEditedMigrations(z('M', 'docs/20260831234750_note.sql', 'M', `${MIGRATIONS_DIR}/${APPLIED}_x.md`, 'M', `${MIGRATIONS_DIR}/README.sql`)), [])
})

test('issue 2037 every declared edit status is honoured, A included', () => {
  assert.equal(EDIT_STATUSES.A, 'added')
  for (const letter of Object.keys(EDIT_STATUSES)) {
    const pathCount = letter === 'R' || letter === 'C' ? 2 : 1
    const fields = pathCount === 2 ? [letter + '100', file(APPLIED), file(NEW)] : [letter, file(APPLIED)]
    // A rename or copy across two versions is TWO edits: both sides are judged.
    assert.equal(parseEditedMigrations(z(...fields)).length, pathCount, `status ${letter} should be an edit`)
  }
})

test('issue 2037 versionOf only accepts a 14-digit prefix', () => {
  assert.equal(versionOf(file(APPLIED)), APPLIED)
  assert.equal(versionOf(`${MIGRATIONS_DIR}/2026_short.sql`), null)
})

// --- findings ------------------------------------------------------------

test('issue 2037 an edit to an UNAPPLIED version is allowed', () => {
  const edits = [{ version: NEW, file: file(NEW), kind: 'modified' }]
  assert.deepEqual(findingsFor(edits, { production: new Set([APPLIED]), preview: new Set([APPLIED]) }), [])
})

test('issue 2037 preview alone is enough to refuse — the incident was preview-only', () => {
  const edits = [{ version: APPLIED, file: file(APPLIED), kind: 'modified' }]
  const findings = findingsFor(edits, { production: new Set([NEW]), preview: new Set([APPLIED]) })
  assert.equal(findings.length, 1)
  assert.deepEqual(findings[0].appliedIn, ['preview'])
})

test('issue 2037 a version applied in both is reported as both', () => {
  const findings = findingsFor([{ version: APPLIED, file: file(APPLIED), kind: 'deleted' }], { production: new Set([APPLIED]), preview: new Set([APPLIED]) })
  assert.deepEqual(findings[0].appliedIn, ['production', 'preview'])
})

// --- orchestration -------------------------------------------------------

// The one registered historical restoration, read from the registry the merge
// lane reads, so the test cannot drift from what the guard will actually accept.
const RESTORED_FILE = HISTORICAL_RESTORATIONS['20260831234750'].filename
const RESTORED_BODY = readFileSync(new URL(`../${RESTORED_FILE}`, import.meta.url), 'utf8')

const io = (edits, ledgers, bodies = new Map()) => ({
  editedMigrations: () => edits,
  readMigration: (f) => bodies.get(f) ?? null,
  appliedVersions: async (ref) => {
    const name = Object.entries(PROJECT_REFS).find(([, value]) => value === ref)?.[0]
    assert.ok(name, `unexpected project ref ${ref}`)
    const versions = ledgers[name]
    if (versions instanceof Error) throw versions
    return versions
  },
})

test('issue 2037 no migration edit means NO ledger is read at all', async () => {
  let reads = 0
  const result = await runCheck({ io: { editedMigrations: () => [], appliedVersions: async () => { reads += 1; return new Set([APPLIED]) } } })
  assert.equal(reads, 0)
  assert.deepEqual(result.ledgersRead, [])
  assert.deepEqual(result.findings, [])
})

test('issue 2037 both ledgers are read when a migration file was touched', async () => {
  const result = await runCheck({ io: io([{ version: NEW, file: file(NEW), kind: 'modified' }], { production: new Set([APPLIED]), preview: new Set([APPLIED]) }) })
  assert.deepEqual(result.ledgersRead.sort(), ['preview', 'production'])
})

test('issue 2037 an unreadable ledger FAILS CLOSED rather than reporting no edit', async () => {
  const edits = [{ version: APPLIED, file: file(APPLIED), kind: 'modified' }]
  await assert.rejects(runCheck({ io: io(edits, { production: new Unknown('token missing'), preview: new Set([APPLIED]) }) }), /token missing/)
})

test('issue 2037 an EMPTY ledger is unknown, not clean', async () => {
  const edits = [{ version: APPLIED, file: file(APPLIED), kind: 'modified' }]
  await assert.rejects(runCheck({ io: io(edits, { production: new Set(), preview: new Set([APPLIED]) }) }), /came back empty/)
})

// --- sanctioned restorations ---------------------------------------------

test('issue 2037 the exact registered restoration is ALLOWED, and the report says why', async () => {
  const version = '20260831234750'
  const edits = [{ version, file: RESTORED_FILE, kind: 'modified' }]
  const result = await runCheck({ io: io(edits, { production: new Set([version]), preview: new Set([version]) }, new Map([[RESTORED_FILE, RESTORED_BODY]])) })
  assert.deepEqual(result.findings, [], 'the exact applied bytes are the one sanctioned repair')
  assert.equal(result.findings.allowed.length, 1)
  assert.match(formatReport(edits, result.findings).join(String.fromCharCode(10)), /ALLOWED: 20260831234750/)
})

// A restoration authorizes ONE BODY. If it authorized the VERSION, an entry would
// be a standing licence to ship anything under it -- the hole the first draft of
// this guard had, when the sanctioned list was a separate JSON file of versions.
test('issue 2037 one changed byte in a registered restoration is REFUSED', async () => {
  const version = '20260831234750'
  const edits = [{ version, file: RESTORED_FILE, kind: 'modified' }]
  const tampered = `${RESTORED_BODY}
-- one more comment
`
  const result = await runCheck({ io: io(edits, { production: new Set([version]), preview: new Set([version]) }, new Map([[RESTORED_FILE, tampered]])) })
  assert.equal(result.findings.length, 1, 'anything but the registered bytes is still an edit to an applied version')
})

test('issue 2037 an unregistered version is never sanctioned, whatever its bytes', () => {
  assert.equal(restorationAllows(file(NEW), 'anything at all'), null)
  assert.equal(restorationAllows(RESTORED_FILE, null), null, 'an unreadable file is not a sanctioned restoration')
})

// --- exit codes and report ------------------------------------------------

const capture = () => { const lines = []; return { sink: (line) => lines.push(String(line)), lines } }

test('issue 2037 exit 0 and a plain sentence when nothing was touched', async () => {
  const out = capture()
  const code = await main([], { run: async () => ({ edits: [], findings: [], ledgersRead: [] }), log: out.sink, error: out.sink })
  assert.equal(code, 0)
  assert.match(out.lines.join(String.fromCharCode(10)), /touches no migration file at all/)
})

test('issue 2037 exit 1 and the fix-forward instruction when an applied migration was edited', async () => {
  const out = capture()
  const edits = [{ version: APPLIED, file: file(APPLIED), kind: 'modified' }]
  const code = await main([], { run: async () => ({ edits, findings: [{ ...edits[0], appliedIn: ['preview'] }], ledgersRead: ['production', 'preview'] }), log: out.sink, error: out.sink })
  assert.equal(code, 1)
  const text = out.lines.join('\n')
  assert.match(text, /REFUSED/)
  assert.match(text, new RegExp(APPLIED))
  assert.match(text, /FIX FORWARD/)
  assert.match(text, /#2037/)
})

test('issue 2037 exit 2 says explicitly that nothing was compared', async () => {
  const out = capture()
  const code = await main([], { run: async () => { throw new Unknown('the preview ledger is unreadable') }, log: out.sink, error: out.sink })
  assert.equal(code, 2)
  const text = out.lines.join('\n')
  assert.match(text, /COULD NOT RUN/)
  assert.match(text, /Nothing was compared/)
})

test('issue 2037 a bad argument is exit 2, never a silent pass', async () => {
  const out = capture()
  assert.equal(await main(['--nope'], { run: async () => ({ edits: [], findings: [], ledgersRead: [] }), log: out.sink, error: out.sink }), 2)
})

test('issue 2037 --base is honoured and defaults to origin/main', () => {
  assert.equal(parseArgs([]).baseRef, 'origin/main')
  assert.equal(parseArgs(['--base', 'origin/develop']).baseRef, 'origin/develop')
})

test('issue 2037 the report names the kind of every touched file', () => {
  const edits = [{ version: NEW, file: file(NEW), kind: 'renamed', renamedTo: file(NEW, 'moved') }]
  const text = formatReport(edits, []).join('\n')
  assert.match(text, /renamed/)
  assert.match(text, /->/)
  assert.match(text, /no applied migration was edited/)
})

// --- real git ------------------------------------------------------------

test('issue 2037 the git invocation is a three-dot diff scoped to the migrations directory', () => {
  let seen = null
  editedMigrations('origin/main', { executor: (...args) => { seen = args; return '' } })
  assert.equal(seen[0], 'git')
  assert.ok(seen[1].includes('origin/main...HEAD'), 'must be a three-dot diff against the merge base')
  assert.ok(seen[1].includes('-z'), 'must be NUL-delimited')
  assert.equal(seen[1][seen[1].length - 1], MIGRATIONS_DIR)
})

test('issue 2037 a git failure is UNKNOWN, not an empty edit list', () => {
  assert.throws(() => editedMigrations('origin/main', { executor: () => { throw new Error('no such ref') } }), Unknown)
})
