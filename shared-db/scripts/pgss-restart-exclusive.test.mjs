import test from 'node:test'
import assert from 'node:assert/strict'
import { qualify, checkLease } from './pgss-restart-exclusive.mjs'

const env = {
  GITHUB_REPOSITORY: 'popcre/shared-db',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_WORKFLOW_REF: 'popcre/shared-db/.github/workflows/apply-pgss-capacity-restart.yml@refs/heads/main',
  GITHUB_SHA: 'a'.repeat(40),
  EXPECTED_HEAD: 'a'.repeat(40),
  WORK_ISSUE: '5609',
  MODE: 'preview_only',
  GITHUB_RUN_ID: '100',
  GITHUB_RUN_ATTEMPT: '1',
}

const plan = {
  operation: 'pg-stat-statements-capacity-restart/v1',
  work_issue: 5609,
  source_pr: 42,
  setting: 'pg_stat_statements.max',
  desired: 40000,
  restart_database: true,
  allowed_modes: ['preview_only', 'preview_and_production'],
  expected_pre_effective: [5000, 40000],
  maintenance_window_tz: 'America/New_York',
}

function fixture() {
  return {
    mainSha: () => env.GITHUB_SHA,
    getIssue: () => ({ number: 5609, state: 'open' }),
    getPr: () => ({
      merged: true,
      merge_commit_sha: 'b'.repeat(40),
      base: { ref: 'main', repo: { full_name: 'popcre/shared-db' } },
    }),
  }
}

const git = (args) =>
  args[0] === 'rev-parse' && args[1] === 'HEAD' ? env.GITHUB_SHA : args[0] === 'merge-base' ? '' : 'c'.repeat(40)

test('fixed restart profile qualifies only merged exact source, open issue, and allowed mode', () => {
  assert.equal(qualify(plan, env, 'preview', fixture(), git).admitted, true)
  assert.equal(qualify(plan, { ...env, MODE: 'preview_and_production' }, 'production', fixture(), git).admitted, true)
  // preview_only refuses production target
  assert.throws(() => qualify(plan, env, 'production', fixture(), git))
  for (const changes of [
    { source_pr: null },
    { source_pr: 0 },
    { desired: 50000 },
    { restart_database: false },
    { work_issue: 5610 },
    { maintenance_window_tz: 'UTC' },
  ]) {
    assert.throws(() => qualify({ ...plan, ...changes }, env, 'preview', fixture(), git))
  }
  const closed = fixture()
  closed.getIssue = () => ({ number: 5609, state: 'closed' })
  assert.throws(() => qualify(plan, env, 'preview', closed, git))
  const unmerged = fixture()
  unmerged.getPr = () => ({ merged: false })
  assert.throws(() => qualify(plan, env, 'preview', unmerged, git))
})

test('stale main, source blob drift, and run substitution fail before locks', () => {
  const stale = fixture()
  stale.mainSha = () => 'd'.repeat(40)
  assert.throws(() => qualify(plan, env, 'preview', stale, git))
  assert.throws(() =>
    qualify(plan, env, 'preview', fixture(), (args) =>
      args[0] === 'rev-parse' && args[1].startsWith('b'.repeat(40) + ':') ? 'e'.repeat(40) : git(args),
    ),
  )
  for (const changes of [
    { EXPECTED_HEAD: 'b'.repeat(40) },
    { GITHUB_REF: 'refs/heads/other' },
    { WORK_ISSUE: '5610' },
    { MODE: 'production_only' },
    { GITHUB_WORKFLOW_REF: 'other' },
    { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_RUN_ID: 'invalid' },
  ]) {
    assert.throws(() => qualify(plan, { ...env, ...changes }, 'preview', fixture(), git))
  }
})

const now = Date.now()
const lease = {
  kind: 'preview-maintenance',
  holderId: 'github-actions:100:1:pgss-restart:preview',
  headSha: env.GITHUB_SHA,
  githubRunId: '100',
  githubRunAttempt: 1,
  generation: 1,
  ownerSha: 'f'.repeat(40),
  acquiredAt: new Date(now).toISOString(),
}

test('exact holder and generation fence refuses foreign, expired, or changed work', () => {
  assert.equal(checkLease(lease, 'preview', env, now).generation, 1)
  for (const changes of [
    { holderId: 'foreign' },
    { headSha: 'c'.repeat(40) },
    { githubRunId: '101' },
    { githubRunAttempt: 2 },
    { generation: 0 },
    { ownerSha: 'bad' },
    { kind: 'production' },
    { acquiredAt: new Date(now - 16 * 60 * 1000).toISOString() },
    { acquiredAt: new Date(now + 2 * 60 * 1000).toISOString() },
  ]) {
    assert.throws(() => checkLease({ ...lease, ...changes }, 'preview', env, now))
  }
})
