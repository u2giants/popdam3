import assert from 'node:assert/strict'
import test from 'node:test'
import { changedPathsFromPullRequestFiles, classifyChangedPaths, classifyLightweightMergePullRequestFiles, classifyLightweightMergePaths, isDocumentPath, isDocumentsOnlyChange, isLightweightMergeDocumentPath, isRulebookPath } from './documents-only-change.mjs'

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

test('standalone implementation plans are documents', () => {
  for (const path of ['plan_reviewer_lease_capacity_truth.md', 'docs/plans/plan_orchestrator-workflow-gaps.md']) {
    assert.equal(isRulebookPath(path), false)
    assert.equal(isDocumentPath(path), true)
    assert.equal(isDocumentsOnlyChange([path]), true)
  }
})

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

// ISSUE #3488 (regression). Merged PR #3311 carried `scripts/production_catalog_verification.py`
// and its test file alongside evidence JSON, and the merge path still showed a green
// `Documents-only merge authorization` status. Path classification must refuse any
// non-prose file -- a `.py` in particular -- on BOTH classifiers: the strict
// reviewer-draw path (`classifyChangedPaths`) and the lightweight merge-authorization
// path (`classifyLightweightMergePullRequestFiles`). Nothing here grants an exemption;
// every case below must stay refused.
const CODE_PATHS = [
  'scripts/production_catalog_verification.py',
  'scripts/test_production_catalog_verification.py',
  'tools/load.py',
  'app.py',
  'scripts/manage-migration-author-lanes.mjs',
  'scripts/check-sql.sh',
  'config/settings.json',
  '.github/workflows/guarded-migration-merge.yml',
  'supabase/migrations/20260902120000_add_thing.sql',
]

for (const path of CODE_PATHS) {
  test(`issue #3488: a non-prose file is never documents-only: ${path}`, () => {
    // Alone: a code-only change is not documents-only.
    assert.equal(isDocumentsOnlyChange([path]), false)
    assert.equal(isDocumentPath(path), false)
    assert.equal(isLightweightMergeDocumentPath(path), false)
    assert.equal(classifyChangedPaths([path]).documentsOnly, false)
    assert.equal(classifyLightweightMergePaths([path]).documentsOnly, false)
    // Mixed with genuine prose: the non-prose file removes the exemption.
    const mixed = classifyChangedPaths(['docs/notes.md', 'HANDOFF.d/x.md', path])
    assert.equal(mixed.documentsOnly, false)
    assert.match(mixed.reason, /non-document file/)
    assert.deepEqual(mixed.other, [path])
    const lightweight = classifyLightweightMergePaths(['docs/notes.md', 'HANDOFF.d/x.md', path])
    assert.equal(lightweight.documentsOnly, false)
    assert.match(lightweight.reason, /non-lightweight file/)
    assert.deepEqual(lightweight.other, [path])
  })
}

test('issue #3488: the merged PR #3311 file list is refused by both classifiers', () => {
  // The exact changed-file list of merged PR #3311 (the misclassification report).
  const rows = [
    { filename: '.agent/work/2876/11/completion.json', additions: 51, deletions: 0, changes: 51 },
    { filename: '.agent/work/2876/11/contract.json', additions: 51, deletions: 0, changes: 51 },
    { filename: 'docs/verification/throughput-guard-truth-baseline-20260828.json', additions: 1, deletions: 1, changes: 2 },
    { filename: 'scripts/production_catalog_verification.py', additions: 1, deletions: 1, changes: 2 },
    { filename: 'scripts/test_production_catalog_verification.py', additions: 12, deletions: 0, changes: 12 },
  ]
  const paths = changedPathsFromPullRequestFiles(rows)
  assert.equal(isDocumentsOnlyChange(paths), false)
  const strict = classifyChangedPaths(paths)
  assert.equal(strict.documentsOnly, false)
  assert.match(strict.reason, /non-document file/)
  assert.ok(strict.other.some((p) => p.endsWith('.py')))
  const lightweight = classifyLightweightMergePullRequestFiles(rows)
  assert.equal(lightweight.documentsOnly, false)
  assert.match(lightweight.reason, /non-lightweight file/)
  assert.ok(lightweight.other.some((p) => p.endsWith('.py')))
})

test('issue #3488: a .py-only or .py+md change is refused even through the lightweight classifier rows', () => {
  const pyOnly = [{ filename: 'scripts/production_catalog_verification.py', additions: 1, deletions: 1, changes: 2 }]
  assert.equal(classifyLightweightMergePullRequestFiles(pyOnly).documentsOnly, false)
  const pyAndProse = [
    { filename: 'scripts/production_catalog_verification.py', additions: 1, deletions: 1, changes: 2 },
    { filename: 'docs/note.md', additions: 3, deletions: 0, changes: 3 },
    { filename: 'HANDOFF.d/2026-09-24T0000Z-note.md', additions: 2, deletions: 0, changes: 2 },
  ]
  const verdict = classifyLightweightMergePullRequestFiles(pyAndProse)
  assert.equal(verdict.documentsOnly, false)
  assert.match(verdict.reason, /non-lightweight file/)
  assert.deepEqual(verdict.other, ['scripts/production_catalog_verification.py'])
})

test('issue #3488: the true-prose-only path still grants the exemption', () => {
  const prose = ['HANDOFF.d/2026-09-24T0000Z-note.md', 'docs/verification/run.md', 'plan_reviewer_lease_capacity_truth.md']
  assert.equal(isDocumentsOnlyChange(prose), true)
  assert.equal(classifyChangedPaths(prose).documentsOnly, true)
  assert.equal(classifyLightweightMergePaths(prose).documentsOnly, true)
  assert.equal(
    classifyLightweightMergePullRequestFiles(prose.map((filename) => ({ filename, additions: 1, deletions: 0, changes: 1 }))).documentsOnly,
    true,
  )
})
