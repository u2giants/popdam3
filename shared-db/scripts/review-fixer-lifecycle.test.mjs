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
