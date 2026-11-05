import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { checkObjects, proposedObjects, retirementAudit } from './review-fixer-lifecycle.mjs'
import { claimBody, assertLaneAvailable } from './lib/lanes/claims.mjs'

const repo = 'popcre/shared-db'
const objects = ['table core.fixture']
const claim = (branch = 'owner-work') => ({ number: 91, body: claimBody({ version: '20261030190000', objects,
  owner: 'owner-session', branch, worktree: '/tmp/fixture-owner', expiresAt: new Date('2099-01-01') }) })
const io = (claims = [], sources = []) => ({ claims: () => claims, sources: () => sources,
  pull: (_r, n) => ({ number: n, state: 'open', head: { ref: 'review-fix/7', repo: { full_name: repo } } }) })

test('same objects in another migration are deferred to exact claim owner', () => {
  const result = checkObjects({ repo, sourcePr: 1, objects }, io([claim()]))
  assert.equal(result.state, 'defer')
  assert.equal(result.claim, 91)
  assert.match(result.reason, /owner-session/)
})
test('another open PR object conflicts even when file names differ', () => {
  assert.equal(checkObjects({ repo, sourcePr: 1, objects }, io([], [{ label: 'PR #2', objects }])).state, 'defer')
})
test('proposed writes also respect declared readers of the object', () => {
  const readClaim = { number: 92, body: claimBody({ version: '20261030190001', writes: ['table core.other'], reads: objects,
    owner: 'reader-session', branch: 'reader', worktree: '/tmp/reader', expiresAt: new Date('2099-01-01') }) }
  assert.equal(checkObjects({ repo, sourcePr: 1, objects }, io([readClaim])).state, 'defer')
  assert.equal(checkObjects({ repo, sourcePr: 1, objects }, io([], [{ label: 'PR #2', objects: [], reads: objects }])).state, 'defer')
})
test('non-overlap remains clear and source PR number is forwarded for exclusion', () => {
  let source
  const mock = { ...io(), sources: (_repo, n) => { source = n; return [{ label: 'PR #2', objects: ['table core.other'] }] } }
  assert.equal(checkObjects({ repo, sourcePr: 8, objects }, mock).state, 'clear')
  assert.equal(source, 8)
})
test('unreadable claim and failed source reads are errors, never a false clear', () => {
  assert.throws(() => checkObjects({ repo, sourcePr: 1, objects }, io([{ number: 91, body: 'bad' }])), /missing fenced/)
  assert.throws(() => checkObjects({ repo, sourcePr: 1, objects }, { ...io(), sources() { throw new Error('network') } }), /network/)
})
test('retirement audits only exact fixer branch and same repository', () => {
  assert.equal(retirementAudit({ repo, fixPr: 4, issue: 7 }, io()).state, 'clear')
  for (const head of [{ ref: 'owner-work', repo: { full_name: repo } }, { ref: 'review-fix/7', repo: { full_name: 'fork/repo' } }]) {
    assert.throws(() => retirementAudit({ repo, fixPr: 4, issue: 7 }, { ...io(), pull: () => ({ number: 4, state: 'open', head }) }), /exact same-repository/)
  }
})
test('associated claim is preserved with named blocker; no release writes exist', () => {
  const mock = io([claim('review-fix/7')])
  const result = retirementAudit({ repo, fixPr: 4, issue: 7 }, mock)
  assert.equal(result.state, 'defer')
  assert.equal(result.claim, 91)
  assert.match(result.reason, /owner-session.*explicit owner-confirmed release/)
  assert.equal(mock.claims().length, 1)
})
test('closing an unclaimed stale fixer PR removes existing lane occupancy', () => {
  const stale = { label: 'PR #4', objects }
  assert.throws(() => assertLaneAvailable([], objects, new Date(), { prSources: [stale] }), /object collision/)
  assert.equal(retirementAudit({ repo, fixPr: 4, issue: 7 }, io()).state, 'clear')
  assert.doesNotThrow(() => assertLaneAvailable([], objects, new Date(), { prSources: [] }))
})
test('proposed SQL reuses dispatch object parser; hostile paths and symlinks fail', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fixer-lifecycle-'))
  try {
    mkdirSync(path.join(root, 'supabase/migrations'), { recursive: true })
    const name = 'supabase/migrations/20261030190000_test.sql'
    writeFileSync(path.join(root, name), 'alter table core.fixture add column test text;')
    assert.deepEqual(proposedObjects(root, [name]), objects)
    assert.deepEqual(proposedObjects(root, ['README.md']), [])
    assert.throws(() => proposedObjects(root, ['../outside.sql']), /repository-relative/)
    assert.throws(() => proposedObjects(root, ['/etc/passwd']), /repository-relative/)
    assert.throws(() => proposedObjects(root, ['supabase\\migrations\\x.sql']), /repository-relative/)
    const link = 'supabase/migrations/link.sql'
    try {
      symlinkSync(path.join(root, name), path.join(root, link))
      assert.throws(() => proposedObjects(root, [link]), /symlink/)
    } catch (error) { if (!['EPERM', 'ENOSYS'].includes(error.code)) throw error }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('caller lifecycle events are trusted cleanup routes alongside normal fixer dispatch', () => {
  const text = readFileSync(new URL('../.github/workflows/review-fixer.yml', import.meta.url), 'utf8')
  assert.match(text, /^  push:/m)
  assert.match(text, /^  delete:/m)
  assert.match(text, /pull_request_target:\n    types: \[synchronize, closed\]/)
  assert.match(text, /uses: popcre\/ai-devops\/\.github\/workflows\/review-fixer.yml@main/)
  assert.doesNotMatch(text, /ref:.*head|checkout.*head/)
})

const legacyClaim = () => ({ number: 5652, body: '```db-claim\nversion: 20261105074314\nobjects:\n  - table dam.fixture\n```' })
const proseIo = (rows = [{ filename: 'plan_unused-index-cleanup.md', status: 'modified' }]) => {
  const pr = { number: 5659, state: 'open', changed_files: rows.length,
    head: { ref: 'review-fix/5658', sha: 'a'.repeat(40), repo: { full_name: repo } },
    base: { sha: 'b'.repeat(40) } }
  return { claims: () => [legacyClaim()], pull: () => structuredClone(pr), files: () => structuredClone(rows), pr }
}
const retireProse = (mock) => retirementAudit({ repo, fixPr: 5659, issue: 5658 }, mock)
test('#5658 exact plan-only fixer can retire without touching unrelated C2 claims', () => {
  const mock = proseIo()
  let reads = 0
  mock.files = () => { reads++; return [{ filename: 'plan_unused-index-cleanup.md', status: 'modified' }] }
  assert.equal(retireProse(mock).state, 'clear')
  assert.equal(reads, 2)
  assert.equal(mock.claims()[0].number, 5652)
})
test('a named associated lease still defers prose even after a legacy claim', () => {
  const mock = proseIo()
  mock.claims = () => [legacyClaim(), claim('review-fix/5658')]
  mock.files = () => { throw new Error('must not classify around a known owner') }
  assert.equal(retireProse(mock).state, 'defer')
})
test('unreadable claim metadata still fails prose retirement', () => {
  const mock = proseIo()
  mock.claims = () => [legacyClaim(), { number: 3, body: 'unreadable' }]
  assert.throws(() => retireProse(mock), /missing fenced/)
})
test('SQL, code, rulebook, mixed and renames out of protected paths stay refused', () => {
  for (const rows of [
    [{ filename: 'supabase/migrations/20261105074314_fixture.sql', status: 'added' }],
    [{ filename: 'config/fixture.json', status: 'modified' }],
    [{ filename: 'scripts/fixture.mjs', status: 'modified' }],
    [{ filename: 'AGENTS.md', status: 'modified' }],
    [{ filename: 'docs/x.md', status: 'modified' }, { filename: 'x.sql', status: 'modified' }],
    [{ filename: 'docs/x.md', previous_filename: 'old.sql', status: 'renamed' }],
    [{ filename: 'docs/x.md', previous_filename: 'AGENTS.md', status: 'renamed' }],
  ]) assert.throws(() => retireProse(proseIo(rows)), /no readable branch ownership/)
  assert.equal(retireProse(proseIo([{ filename: 'docs/new.md', previous_filename: 'docs/old.md', status: 'renamed' }])).state, 'clear')
})
test('complete positive count and unique valid file metadata are mandatory', () => {
  for (const row of [
    { filename: '/absolute.md', status: 'modified' },
    { filename: '../escape.md', status: 'modified' },
    { filename: 'docs/./x.md', status: 'modified' },
    { filename: 'docs\\x.md', status: 'modified' },
    { filename: 'docs/x\n.md', status: 'modified' },
    { filename: 'docs/x.md', status: 'unknown' },
    { filename: 'docs/x.md' },
    { filename: 'docs/x.md', status: 'renamed' },
    { filename: 'docs/x.md', previous_filename: '../old.md', status: 'renamed' },
  ]) assert.throws(() => retireProse(proseIo([row])), /metadata is invalid/)
  for (const count of [undefined, 0, -1, '1', 2]) {
    const mock = proseIo(); mock.pr.changed_files = count
    assert.throws(() => retireProse(mock), /complete exact PR metadata|truncated/)
  }
  const duplicate = proseIo([{ filename: 'x.md', status: 'added' }, { filename: 'x.md', status: 'modified' }])
  assert.throws(() => retireProse(duplicate), /duplicated/)
  for (const rows of [undefined, null, []]) {
    const mock = proseIo(); mock.files = () => rows
    assert.throws(() => retireProse(mock), /truncated/)
  }
  const missingHash = proseIo(); delete missingHash.pr.head.sha
  assert.throws(() => retireProse(missingHash), /complete exact PR metadata/)
  const unreadable = proseIo(); unreadable.files = () => { throw new Error('read failed') }
  assert.throws(() => retireProse(unreadable), /read failed/)
})
test('moving head/base/count/state or changed complete file list fails closed', () => {
  for (const mutate of [
    (pr) => { pr.head.sha = 'c'.repeat(40) },
    (pr) => { pr.base.sha = 'c'.repeat(40) },
    (pr) => { pr.changed_files = 2 },
    (pr) => { pr.state = 'closed' },
  ]) {
    const mock = proseIo(); let reads = 0
    mock.pull = () => { const pr = structuredClone(mock.pr); if (++reads > 1) mutate(pr); return pr }
    assert.throws(() => retireProse(mock), /changed/)
  }
  const mock = proseIo(); let reads = 0
  mock.files = () => [{ filename: ++reads === 1 ? 'one.md' : 'two.md', status: 'modified' }]
  assert.throws(() => retireProse(mock), /file list changed/)
  const lastRace = proseIo(); let pulls = 0
  lastRace.pull = () => { const pr = structuredClone(lastRace.pr); if (++pulls === 3) pr.head.sha = 'd'.repeat(40); return pr }
  assert.throws(() => retireProse(lastRace), /changed/)
})
