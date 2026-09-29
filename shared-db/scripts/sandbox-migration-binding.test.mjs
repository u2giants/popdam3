import test from 'node:test'
import assert from 'node:assert/strict'
import { checkSourcePr, checkDryRun, BindingRefusal, SANDBOX_WORKFLOW_PATH } from './sandbox-migration-binding.mjs'

const MAIN = 'a'.repeat(40)
const pr = { number: 7, merged: true, merge_commit_sha: 'b'.repeat(40), head: { sha: 'c'.repeat(40) } }
const files = [{ status: 'added', filename: 'supabase/migrations/20260101000000_x.sql' }]
const yes = () => true

test('a merged, on-main source PR that added every version yields its head', () => {
  assert.equal(checkSourcePr({ pr, files, commitSha: MAIN, allowlist: '20260101000000', isAncestor: yes }), 'c'.repeat(40))
})

test('unmerged, off-main, unauthored, modified-only and malformed inputs refuse', () => {
  const cases = [
    { pr: { ...pr, merged: false } },
    { isAncestor: () => false },
    { allowlist: '20260102000000' },
    { files: [{ status: 'modified', filename: files[0].filename }] },
    { allowlist: '' },
    { allowlist: '20260101000000,20260101000000' },
    { allowlist: '20260102000000,20260101000000' },
    { commitSha: 'main' },
    { pr: { ...pr, merge_commit_sha: null } },
  ]
  for (const c of cases) {
    assert.throws(() => checkSourcePr({ pr, files, commitSha: MAIN, allowlist: '20260101000000', isAncestor: yes, ...c }), BindingRefusal)
  }
})

test('dry-run evidence must be a successful dispatch of this workflow at the exact commit', () => {
  const run = { id: 1, path: SANDBOX_WORKFLOW_PATH, conclusion: 'success', head_sha: MAIN, event: 'workflow_dispatch' }
  const artifacts = [{ name: `sandbox-migration-dry-run-${MAIN}` }]
  checkDryRun({ run, artifacts, commitSha: MAIN })
  for (const change of [{ path: '.github/workflows/shared-supabase-migrations.yml' }, { conclusion: 'failure' }, { head_sha: 'd'.repeat(40) }, { event: 'push' }]) {
    assert.throws(() => checkDryRun({ run: { ...run, ...change }, artifacts, commitSha: MAIN }), BindingRefusal)
  }
  for (const bad of [[], [{ name: `sandbox-migration-apply-${MAIN}` }], [...artifacts, { name: `sandbox-migration-apply-${MAIN}` }]]) {
    assert.throws(() => checkDryRun({ run, artifacts: bad, commitSha: MAIN }), BindingRefusal)
  }
})
