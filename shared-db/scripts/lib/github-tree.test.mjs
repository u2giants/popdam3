// One tree read per ref, blobs by SHA — proven against known-dirty input (#2342).
//
// Requirement 4 of issue #2342 asks for a test that fails if a gate makes more
// than one Contents call per ref. These tests assert the stronger property the
// implementation actually provides: ZERO Contents calls, exactly one tree read
// per ref however many paths are asked for, and one blob read per distinct blob
// SHA however many refs mention it. The static half of the rule — that no file
// under scripts/ may build a Contents URL at all — is enforced by
// check-github-transport-conformance.mjs and proven in its sibling test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTreeReader, TreeReadError } from './github-tree.mjs'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

/** A fake GitHub that records every endpoint it is asked for. */
function fakeGitHub({ trees, blobs = {}, truncated = false }) {
  const endpoints = []
  return {
    endpoints,
    json: (args) => {
      const endpoint = args[args.length - 1]
      endpoints.push(endpoint)
      const ref = /git\/trees\/([^?]+)/.exec(endpoint)?.[1]
      if (!(ref in trees)) throw new Error(`HTTP 404: no tree for ${ref}`)
      return {
        truncated,
        tree: trees[ref].map(([path, sha]) => ({ path, sha, type: 'blob' })),
      }
    },
    raw: (args) => {
      const endpoint = args[args.length - 1]
      endpoints.push(endpoint)
      const sha = /git\/blobs\/(.+)$/.exec(endpoint)[1]
      if (!(sha in blobs)) throw new Error(`HTTP 404: no blob ${sha}`)
      return blobs[sha]
    },
  }
}

test('many paths at one ref cost ONE tree read and no Contents call', () => {
  const io = fakeGitHub({
    trees: { head: [['supabase/migrations/1_a.sql', SHA_A], ['supabase/migrations/2_b.sql', SHA_B]] },
    blobs: { [SHA_A]: 'select 1;', [SHA_B]: 'select 2;' },
  })
  const reader = createTreeReader(io)

  assert.equal(reader.readFileAtRef('o/r', 'supabase/migrations/1_a.sql', 'head'), 'select 1;')
  assert.equal(reader.readFileAtRef('o/r', 'supabase/migrations/2_b.sql', 'head'), 'select 2;')
  assert.ok(reader.hasPathAtRef('o/r', 'supabase/migrations/1_a.sql', 'head'))

  assert.equal(reader.callCounts().trees, 1, 'one recursive tree read per ref, not one per file')
  assert.equal(io.endpoints.filter((e) => e.includes('/contents/')).length, 0,
    'requirement 4: no Contents call is made at all')
})

test('a blob identical across refs is fetched ONCE, however many refs name it', () => {
  const io = fakeGitHub({
    trees: {
      'head-1': [['supabase/migrations/1_a.sql', SHA_A]],
      'head-2': [['supabase/migrations/1_a.sql', SHA_A]],
      'head-3': [['supabase/migrations/1_a.sql', SHA_A]],
    },
    blobs: { [SHA_A]: 'select 1;' },
  })
  const reader = createTreeReader(io)
  for (const ref of ['head-1', 'head-2', 'head-3']) {
    assert.equal(reader.readFileAtRef('o/r', 'supabase/migrations/1_a.sql', ref), 'select 1;')
  }
  assert.equal(reader.callCounts().trees, 3, 'one tree per distinct ref')
  assert.equal(reader.callCounts().blobs, 1, 'the old per-ref Contents URL fetched this three times')
})

test('absence is read off the tree, never interpreted from a 404', () => {
  const io = fakeGitHub({ trees: { head: [['kept.sql', SHA_A]] }, blobs: { [SHA_A]: 'x' } })
  const reader = createTreeReader(io)
  assert.equal(reader.readFileAtRef('o/r', 'gone.sql', 'head'), null)
  assert.equal(reader.callCounts().blobs, 0, 'an absent path must cost no network call at all')
  assert.ok(!reader.hasPathAtRef('o/r', 'gone.sql', 'head'))
})

test('a TRUNCATED tree is refused, never read as "those files are absent"', () => {
  // The known-dirty case. GitHub truncates above ~100k entries and says so; a
  // truncated tree would make present files look absent, which in a gate whose
  // job is to refuse is a silent FALSE CLEAR — the one outcome worse than a
  // spurious refusal.
  const io = fakeGitHub({ trees: { head: [['a.sql', SHA_A]] }, truncated: true })
  const reader = createTreeReader(io)
  assert.throws(() => reader.readFileAtRef('o/r', 'a.sql', 'head'), (error) => {
    assert.ok(error instanceof TreeReadError)
    assert.match(error.message, /truncated/i)
    assert.match(error.message, /false clear/i)
    return true
  })
})

test('a malformed tree body is refused rather than read as an empty ref', () => {
  const reader = createTreeReader({ json: () => ({ tree: 'not-an-array' }), raw: () => '' })
  assert.throws(() => reader.pathsAtRef('o/r', 'head'), /no tree for o\/r@head/)
})

test('the caller keeps its own named refusal', () => {
  class GateRefusal extends Error {}
  const reader = createTreeReader({
    json: () => ({ truncated: true, tree: [] }),
    raw: () => '',
    wrapError: (detail) => new GateRefusal(detail),
  })
  assert.throws(() => reader.pathsAtRef('o/r', 'head'), GateRefusal)
})

test('pathsAtRef lists every blob path, sorted, from the single read', () => {
  const io = fakeGitHub({ trees: { head: [['b.sql', SHA_B], ['a.sql', SHA_A]] } })
  const reader = createTreeReader(io)
  assert.deepEqual(reader.pathsAtRef('o/r', 'head'), ['a.sql', 'b.sql'])
  assert.deepEqual(reader.pathsAtRef('o/r', 'head'), ['a.sql', 'b.sql'])
  assert.equal(reader.callCounts().trees, 1, 'the tree is cached per ref')
})
