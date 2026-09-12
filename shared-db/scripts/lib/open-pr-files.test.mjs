import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gatherOpenPullFiles, loadOpenPullFiles, OpenPullFilesError, SNAPSHOT_ENV } from './open-pr-files.mjs'
import { gather as gatherSourceInputs, openProtectedCollisions } from '../check-pr-source-collisions.mjs'
import { findCollisions, gatherSources } from '../check-pr-object-collisions.mjs'

const REPO = 'o/r'
const LANES = 'scripts/manage-migration-author-lanes.mjs'
const MIG = (name) => `supabase/migrations/${name}.sql`

// A fake GitHub. Every PR: detail, file list, and the SQL at its head.
const PULLS = [
  { number: 10, title: 'current', draft: false, created_at: '2026-09-10T10:00:00Z', head: { sha: 'h10', ref: 'b10' }, files: [MIG('20260910100000_a'), LANES] },
  { number: 7, title: 'earlier, same object and same lanes file', draft: false, created_at: '2026-09-09T10:00:00Z', head: { sha: 'h7', ref: 'b7' }, files: [MIG('20260909100000_b'), LANES] },
  { number: 8, title: 'docs only', draft: false, created_at: '2026-09-09T11:00:00Z', head: { sha: 'h8', ref: 'b8' }, files: ['docs/x.md'] },
  { number: 9, title: 'draft touching the same object', draft: true, created_at: '2026-09-09T12:00:00Z', head: { sha: 'h9', ref: 'b9' }, files: [MIG('20260909120000_c'), LANES] },
  { number: 11, title: 'later, different object', draft: false, created_at: '2026-09-10T11:00:00Z', head: { sha: 'h11', ref: 'b11' }, files: [MIG('20260910110000_d')] },
]
const SQL = {
  [`h10:${MIG('20260910100000_a')}`]: 'create or replace function plm.shared() returns void as $$ begin end $$ language plpgsql;',
  [`h7:${MIG('20260909100000_b')}`]: 'create or replace function plm.shared() returns void as $$ begin end $$ language plpgsql;',
  [`h9:${MIG('20260909120000_c')}`]: 'create or replace function plm.shared() returns void as $$ begin end $$ language plpgsql;',
  [`h11:${MIG('20260910110000_d')}`]: 'create or replace function plm.other() returns void as $$ begin end $$ language plpgsql;',
}

function fakeGitHub(pulls = PULLS) {
  const calls = []
  const read = (args) => {
    const endpoint = args[args.length - 1]
    calls.push(endpoint)
    let match
    if (endpoint === `repos/${REPO}/pulls?state=open&per_page=100`) {
      return [pulls.map(({ files: _f, ...pr }) => pr)]
    }
    if ((match = endpoint.match(/^repos\/o\/r\/pulls\/(\d+)\/files/))) {
      return [pulls.find((pr) => pr.number === Number(match[1])).files.map((filename) => ({ filename, status: 'added' }))]
    }
    if ((match = endpoint.match(/^repos\/o\/r\/pulls\/(\d+)$/))) {
      const pr = pulls.find((item) => item.number === Number(match[1]))
      return { ...pr, files: undefined, changed_files: pr.changedFilesOverride ?? pr.files.length }
    }
    throw new Error(`unexpected read ${endpoint}`)
  }
  return { read, calls }
}

const TIMELINES = { 10: [], 7: [], 8: [], 11: [] }

test('the snapshot gathers each ready PR once and skips drafts other than the current one', () => {
  const gh = fakeGitHub()
  const snapshot = gatherOpenPullFiles(REPO, { current: 10, read: gh.read })
  assert.equal(snapshot.current.number, 10)
  assert.deepEqual(snapshot.others.map((pr) => [pr.number, Array.isArray(pr.files)]), [[7, true], [8, true], [9, false], [11, true]])
  assert.equal(gh.calls.filter((c) => c === `repos/${REPO}/pulls/9`).length, 0, 'a draft other than the current PR costs nothing')
})

test('an incomplete file list is refused exactly as before', () => {
  const pulls = PULLS.map((pr) => (pr.number === 8 ? { ...pr, changedFilesOverride: 2 } : pr))
  assert.throws(() => gatherOpenPullFiles(REPO, { current: 10, read: fakeGitHub(pulls).read }), (e) => e instanceof OpenPullFilesError && /returned 1 of 2/.test(e.message))
})

test('source collisions are unchanged, and timelines are read only for overlapping PRs', () => {
  // The pre-snapshot algorithm, reproduced: every ready other PR with its
  // activation date and complete file list.
  const legacyInput = {
    current: { number: 10, activatedAt: '2026-09-10T10:00:00.000Z', files: PULLS[0].files },
    others: PULLS.filter((pr) => pr.number !== 10 && !pr.draft).map((pr) => ({ number: pr.number, title: pr.title, draft: pr.draft, activatedAt: new Date(pr.created_at).toISOString(), files: pr.files })),
  }
  const legacy = openProtectedCollisions(legacyInput.current, legacyInput.others)
  assert.deepEqual(legacy, [{ file: LANES, pr: 7, title: PULLS[1].title }])

  const gh = fakeGitHub()
  const timelinesRead = []
  const env = { GITHUB_REPOSITORY: REPO, PR_NUMBER: '10' }
  const input = gatherSourceInputs(env, {
    load: (repo, number) => loadOpenPullFiles(repo, number, { env: {}, read: gh.read }),
    timeline: (_repo, number) => (timelinesRead.push(number), TIMELINES[number]),
  })
  assert.deepEqual(openProtectedCollisions(input.current, input.others), legacy)
  assert.deepEqual(timelinesRead.sort((a, b) => a - b), [7, 10], 'only the overlapping PR and the current PR')
})

test('no overlap reads no timeline at all and still reports no collision', () => {
  const pulls = PULLS.map((pr) => (pr.number === 7 ? { ...pr, files: [MIG('20260909100000_b')] } : pr))
  const gh = fakeGitHub(pulls)
  const input = gatherSourceInputs({ GITHUB_REPOSITORY: REPO, PR_NUMBER: '10' }, {
    load: (repo, number) => loadOpenPullFiles(repo, number, { env: {}, read: gh.read }),
    timeline: () => assert.fail('a timeline was read with nothing overlapping'),
  })
  assert.deepEqual(openProtectedCollisions(input.current, input.others), [])
})

test('object collisions are identical whether the checks share a snapshot file or gather themselves', () => {
  const env = { GITHUB_REPOSITORY: REPO, PR_NUMBER: '10' }
  const readSql = (_repo, filename, ref) => SQL[`${ref}:${filename}`]
  const deps = (load) => ({ load, readSql, baseSource: () => null, readPull: () => ({ base: { ref: 'main', sha: 'base' }, head: { sha: 'h10' } }) })

  const selfGathered = gatherSources(env, deps((repo, number) => loadOpenPullFiles(repo, number, { env: {}, read: fakeGitHub().read })))

  const dir = mkdtempSync(path.join(tmpdir(), 'open-pr-files-'))
  const file = path.join(dir, 'snapshot.json')
  writeFileSync(file, JSON.stringify(gatherOpenPullFiles(REPO, { current: 10, read: fakeGitHub().read })))
  const noNetwork = () => { throw new Error('the snapshot path must not read GitHub') }
  const shared = gatherSources(env, deps((repo, number) => loadOpenPullFiles(repo, number, { env: { [SNAPSHOT_ENV]: file }, read: noNetwork })))

  assert.deepEqual(shared, selfGathered)
  const result = findCollisions(shared, shared[0].label)
  assert.deepEqual(result, findCollisions(selfGathered, selfGathered[0].label))
  assert.equal(result.collisions.length, 1, 'the earlier ready PR collides; the draft and the different object do not')
  assert.deepEqual(shared.map((s) => s.label), ['PR #10 (this PR)', 'PR #7 "earlier, same object and same lanes file"', 'PR #8 "docs only"', 'PR #11 "later, different object"'])
})

test('a snapshot for another PR, repo, or schema is refused, and an incomplete snapshot fails the object check closed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'open-pr-files-'))
  const file = path.join(dir, 'snapshot.json')
  writeFileSync(file, JSON.stringify(gatherOpenPullFiles(REPO, { current: 10, read: fakeGitHub().read })))
  const env = { [SNAPSHOT_ENV]: file }
  assert.throws(() => loadOpenPullFiles(REPO, 11, { env }), /gathered for PR #10, not #11/)
  assert.throws(() => loadOpenPullFiles('o/other', 10, { env }), /describes o\/r/)
  writeFileSync(file, JSON.stringify({ schema: 'nope' }))
  assert.throws(() => loadOpenPullFiles(REPO, 10, { env }), /unknown schema/)
  // Surfaced to the object check as its own fail-closed Skip (exit 2), not a crash.
  assert.throws(
    () => gatherSources({ GITHUB_REPOSITORY: REPO, PR_NUMBER: '10' }, { load: (repo, number) => loadOpenPullFiles(repo, number, { env }), readPull: () => ({ base: { ref: 'main', sha: 'b' }, head: { sha: 'h10' } }) }),
    (error) => error.constructor.name === 'Skip' && /unknown schema/.test(error.message),
  )
})
