// Guarded-lane merges start the consumer sync (issue #3264).
//
// GitHub starts no `push` workflow for a push made by the workflow token, so
// a guarded merge (which pushes as github-actions) never fired sync.yml on
// its own. Evidence: PR #3254 merged as 2f204a48 and started no sync run;
// #3263, merged by a human, started run 35351543065.
//
// This test asserts the shape of the fix stays in place: sync.yml accepts a
// manual dispatch, and the guarded merge workflow dispatches it, gated on its
// own merge step succeeding, only after the merge attempt is proven.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const syncYml = readFileSync(new URL('../.github/workflows/sync.yml', import.meta.url), 'utf8')
const guardedMerge = readFileSync(new URL('../.github/workflows/guarded-migration-merge.yml', import.meta.url), 'utf8')

test('sync.yml accepts workflow_dispatch alongside its push trigger', () => {
  assert.match(syncYml, /on:\s*\n\s*push:\s*\n\s*branches: \[main\]\s*\n[\s\S]*workflow_dispatch:/,
    'sync.yml must keep the push trigger and add workflow_dispatch')
})

test('sync.yml refuses to run for any ref other than main, so a manual dispatch cannot target a branch', () => {
  const jobsIdx = syncYml.indexOf('jobs:')
  const jobBlock = syncYml.slice(jobsIdx, syncYml.indexOf('steps:'))
  assert.match(jobBlock, /if:\s*github\.ref == 'refs\/heads\/main'/,
    'the sync job must gate on github.ref == refs/heads/main so workflow_dispatch cannot sync a non-main ref')
})

test('sync.yml pins its source checkout to main', () => {
  const checkoutIdx = syncYml.indexOf('Checkout canonical source')
  const nextStepIdx = syncYml.indexOf('- name:', checkoutIdx + 1)
  const checkoutBlock = syncYml.slice(checkoutIdx, nextStepIdx)
  assert.match(checkoutBlock, /ref: main/, 'the canonical source checkout must pin ref: main')
})

test('guarded merge dispatches sync.yml only after its own merge step succeeds', () => {
  const dispatchIdx = guardedMerge.indexOf('gh workflow run sync.yml')
  assert.ok(dispatchIdx > -1, 'guarded merge workflow must dispatch sync.yml after merging')
  const mergedIdx = guardedMerge.indexOf("test \"$merged\" = '1'")
  assert.ok(mergedIdx > -1 && mergedIdx < dispatchIdx, 'the dispatch step must come after the merge is proven')
  const revokeIdx = guardedMerge.indexOf('Revoke authorization if the guarded merge did not complete')
  assert.ok(revokeIdx > dispatchIdx, 'the dispatch step must run before the revoke/cleanup steps')
})

test('the dispatch step is gated on the merge step outcome, so it never fires on a failed merge', () => {
  const stepBlock = guardedMerge.slice(
    guardedMerge.indexOf('Start the consumer sync for the merge that just landed'),
    guardedMerge.indexOf('Revoke authorization if the guarded merge did not complete'),
  )
  assert.match(stepBlock, /if:\s*steps\.guarded_merge\.outcome == 'success'/,
    'the sync dispatch must be conditioned on the merge step succeeding')
})

test('the merge job declares actions: write, scoped to this job only, for the dispatch', () => {
  const permissionsIdx = guardedMerge.indexOf('permissions:')
  const jobsIdx = guardedMerge.indexOf('jobs:')
  const permissionsBlock = guardedMerge.slice(permissionsIdx, jobsIdx)
  assert.match(permissionsBlock, /actions: write/, 'actions: write must be present in the job permissions block')
})
