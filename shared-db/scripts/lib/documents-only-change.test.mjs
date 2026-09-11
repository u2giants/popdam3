import assert from 'node:assert/strict'
import test from 'node:test'
import { changedPathsFromPullRequestFiles, classifyChangedPaths, isDocumentPath, isDocumentsOnlyChange, isRulebookPath } from './documents-only-change.mjs'

// The exemption exists because PR #2034 (two documentation files) spent two
// reviewer draws, two dead-reviewer replacements and three review runs. Every
// test below asks the opposite question: what must NOT be exempted.

test('prose documents are documents-only', () => {
  const verdict = classifyChangedPaths(['HANDOFF.d/2026-09-02T0000Z-note.md', 'docs/verification/run.md', 'README.md', 'notes.txt'])
  assert.equal(verdict.documentsOnly, true)
  assert.equal(verdict.other.length, 0)
})

// RULEBOOK FILES. These are prose by extension and instructions by function: a
// bad edit to one of them steers every later session, so they keep the full
// treatment. This is the test that must fail if the exclusion list is dropped.
for (const path of [
  'AGENTS.md',
  'agents.md',
  'apps/popdam/AGENTS.md',
  'CLAUDE.md',
  '.claude/skills/shared-db-change/SKILL.md',
  'skills/claude/shared-db-orchestrator/SKILL.md',
  '.claude/agents/reviewer.md',
  'plan_reviewer_lease_capacity_truth.md',
  'docs/plans/plan_orchestrator-workflow-gaps.md',
]) {
  test(`a rulebook file is never a document: ${path}`, () => {
    assert.equal(isRulebookPath(path), true)
    assert.equal(isDocumentPath(path), false)
    assert.equal(isDocumentsOnlyChange([path]), false)
    // Mixed with genuine prose, the whole change is still not exempt.
    const verdict = classifyChangedPaths(['README.md', path])
    assert.equal(verdict.documentsOnly, false)
    assert.match(verdict.reason, /rulebook file/)
  })
}

// ONE non-document file removes the exemption for the whole pull request.
for (const path of [
  'supabase/migrations/20260902120000_add_thing.sql',
  'scripts/manage-migration-author-lanes.mjs',
  'scripts/check-exact-head-approval.test.mjs',
  '.github/workflows/guarded-migration-merge.yml',
  'scripts/check-sql.sh',
  'tools/load.py',
  'config/settings.json',
  'docs/diagram.svg',
]) {
  test(`a mixed change is never documents-only: ${path}`, () => {
    const verdict = classifyChangedPaths(['docs/notes.md', 'HANDOFF.md', path])
    assert.equal(verdict.documentsOnly, false)
    assert.match(verdict.reason, /non-document file/)
    assert.deepEqual(verdict.other, [path])
  })
}

// FAIL CLOSED. "We could not tell" must cost a review, never grant an exemption.
test('an unreadable or empty file list is never documents-only', () => {
  assert.equal(isDocumentsOnlyChange([]), false)
  assert.match(classifyChangedPaths([]).reason, /no changed files were reported/)
  assert.equal(isDocumentsOnlyChange(null), false)
  assert.equal(isDocumentsOnlyChange(undefined), false)
  assert.equal(isDocumentsOnlyChange(['docs/a.md', null]), false)
  assert.equal(isDocumentsOnlyChange(['docs/a.md', 42]), false)
  assert.equal(isDocumentsOnlyChange(['docs/a.md', '   ']), false)
  // An extension nobody listed is not a document by default.
  assert.equal(isDocumentPath('docs/notes.adoc'), false)
  assert.equal(isDocumentPath('LICENSE'), false)
})

// A rename must be judged on where the bytes came from as well as where they
// landed: a migration renamed to a `.md` is still a migration change.
test('a rename carries its previous path into the classification', () => {
  const rows = [{ filename: 'docs/retired-migration.md', previous_filename: 'supabase/migrations/20260902120000_add_thing.sql' }]
  const paths = changedPathsFromPullRequestFiles(rows)
  assert.deepEqual(paths, ['docs/retired-migration.md', 'supabase/migrations/20260902120000_add_thing.sql'])
  assert.equal(isDocumentsOnlyChange(paths), false)
})

test('a malformed GitHub file row fails the whole classification closed', () => {
  assert.equal(isDocumentsOnlyChange(changedPathsFromPullRequestFiles([{ filename: 'docs/a.md' }, { body: 'not a file row' }])), false)
  assert.equal(changedPathsFromPullRequestFiles('nonsense'), null)
  assert.equal(isDocumentsOnlyChange(changedPathsFromPullRequestFiles('nonsense')), false)
})

test('windows-style and dot-relative paths classify the same as posix ones', () => {
  assert.equal(isRulebookPath('.\\.claude\\skills\\x\\SKILL.md'), true)
  assert.equal(isDocumentsOnlyChange(['./docs/notes.md']), true)
})
