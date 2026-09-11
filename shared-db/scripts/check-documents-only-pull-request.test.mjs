import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyPullRequestFilesPayload, main } from './check-documents-only-pull-request.mjs'

const run = (text) => {
  const out = []
  const err = []
  const code = main(['u2giants/shared-db', '1'], { read: () => text, out: (t) => out.push(t), err: (t) => err.push(t) })
  return { code, out: out.join(''), err: err.join('') }
}

test('a prose-only pull request is documents-only', () => {
  const r = run(JSON.stringify([{ filename: 'HANDOFF.d/2026-09-08T1650Z-edge-dev-claude-x.md' }, { filename: 'docs/notes.txt' }]))
  assert.equal(r.code, 0)
  assert.match(r.out, /^documents-only:/)
})

// THE WHOLE POINT OF ISSUE #2591. Before this, the contract gate forced a prose
// pull request to add these two JSON files, and adding them cancelled the
// documents-only exemption. The gate must be able to see the prose change on its
// own, so the pair is NOT present here -- and that is exactly the case that used
// to fail the contract gate.
test('the evidence pair is not required for the classification to succeed', () => {
  assert.equal(classifyPullRequestFilesPayload(JSON.stringify([{ filename: 'HANDOFF.d/a.md' }])).documentsOnly, true)
})

test('adding the agent evidence pair makes the change non-exempt', () => {
  const r = run(JSON.stringify([{ filename: 'HANDOFF.d/a.md' }, { filename: '.agent/contract.json' }, { filename: '.agent/completion.json' }]))
  assert.equal(r.code, 1)
  assert.match(r.out, /non-document file/)
})

test('rulebook prose is never documents-only', () => {
  for (const path of ['AGENTS.md', 'CLAUDE.md', '.claude/skills/x/SKILL.md', 'plan_thing.md']) {
    assert.equal(run(JSON.stringify([{ filename: path }])).code, 1, `${path} must not be exempt`)
  }
})

test('a rename out of migrations into a .md is not documents-only', () => {
  const r = run(JSON.stringify([{ filename: 'docs/old.md', previous_filename: 'supabase/migrations/20260101000000_x.sql' }]))
  assert.equal(r.code, 1)
})

// FAIL CLOSED. Every unreadable shape must cost the full treatment, never grant
// an exemption, because "we could not tell" is not "it is only prose".
test('unreadable, empty and non-array input are refused', () => {
  assert.equal(run('not json').code, 1)
  assert.equal(run('{}').code, 1)
  assert.equal(run('[]').code, 1)
  assert.equal(classifyPullRequestFilesPayload(undefined).documentsOnly, false)
})

test('a read failure is refused rather than treated as prose', () => {
  const err = []
  const code = main(['u2giants/shared-db', '1'], { read: () => { throw new Error('the GitHub read exploded') }, out: () => {}, err: (t) => err.push(t) })
  assert.equal(code, 1)
  assert.match(err.join(''), /REFUSED/)
})

// Missing or malformed arguments must be a usage error, never an exemption:
// a gate that cannot tell WHICH pull request it is judging must not grant one.
test('missing or malformed arguments are a usage error, not a silent pass', () => {
  const deps = { read: () => '[]', out: () => {}, err: () => {} }
  assert.equal(main([], deps), 2)
  assert.equal(main(['u2giants/shared-db'], deps), 2)
  assert.equal(main(['u2giants/shared-db', 'not-a-number'], deps), 2)
  assert.equal(main(['', '1'], deps), 2)
})

// `gh api --paginate --slurp` gives one array PER PAGE. A 120-file pull request
// would otherwise arrive as [[...],[...]] and be misread as unreadable input.
test('paginated page arrays are flattened, and a mixed shape is refused', () => {
  assert.equal(run(JSON.stringify([[{ filename: 'a.md' }], [{ filename: 'b.md' }]])).code, 0)
  assert.equal(run(JSON.stringify([[{ filename: 'a.md' }], [{ filename: 'c.sql' }]])).code, 1)
  assert.equal(run(JSON.stringify([[{ filename: 'a.md' }], { filename: 'b.md' }])).code, 1)
})
