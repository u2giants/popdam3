import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { countOccurrences, evaluate, scanTree } from './check-repository-identity-conformance.mjs'

test('positive control: a live hard-code in an unlisted file is refused', () => {
  const text = "gh(['api', 'repos/u2giants/shared-db/pulls'])"
  assert.equal(countOccurrences(text), 1)
  assert.match(evaluate({ 'scripts/new-thing.mjs': countOccurrences(text) }, {})[0], /hard-coded repository slug/)
})

test('regex-escaped, URL-encoded and split GraphQL owner forms are detected', () => {
  assert.equal(countOccurrences('/^https:\\/\\/github\\.com\\/u2giants\\/shared-db\\/pull/'), 1)
  assert.equal(countOccurrences('repos/u2giants%2Fshared-db'), 1)
  assert.equal(countOccurrences('repository(owner:"u2giants",name:"shared-db")'), 1)
  assert.equal(countOccurrences('owner: "u2giants"'), 1)
})

test('workflow interpolation and helper calls are accepted', () => {
  const clean = [
    'gh api "repos/${GITHUB_REPOSITORY}/pulls/$PR"',
    'gh pr merge "$PR" --repo "$GITHUB_REPOSITORY" --merge --match-head-commit "$SHA"',
    'repository: ${{ github.repository }}',
    "import { currentRepository } from './lib/repository-identity.mjs'",
    'https://github.com/u2giants/ai-devops',
    'author === "u2giants"',
  ].join('\n')
  assert.equal(countOccurrences(clean), 0)
  assert.deepEqual(evaluate({ '.github/workflows/x.yml': 0 }, {}), [])
})

test('allowlist counts are exact in both directions and stale entries fail', () => {
  const list = { 'a.mjs': [2, 'fixture'], 'b.mjs': [1, 'fixture'], 'c.mjs': [1, 'optional', { optional: true }] }
  assert.deepEqual(evaluate({ 'a.mjs': 2, 'b.mjs': 1 }, list), [])
  assert.match(evaluate({ 'a.mjs': 3, 'b.mjs': 1 }, list)[0], /allowlisted 2 but found 3/)
  assert.match(evaluate({ 'a.mjs': 1, 'b.mjs': 1 }, list)[0], /allowlisted 2 but found 1/)
  assert.match(evaluate({ 'a.mjs': 2, 'b.mjs': 0 }, list)[0], /stale allowlist entry/)
  assert.match(evaluate({ 'a.mjs': 2 }, list)[0], /b\.mjs.*stale/)
  assert.match(evaluate({ 'a.mjs': 2, 'b.mjs': 1, 'c.mjs': 0 }, list)[0], /c\.mjs.*stale/)
})

test('the real tree conforms', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  assert.deepEqual(evaluate(scanTree(root)), [])
})
