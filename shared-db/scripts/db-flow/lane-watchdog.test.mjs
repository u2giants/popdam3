// Guard: the lane watchdog's decision logic (2026-10-23 incident; see
// scripts/db-flow/lane-watchdog.mjs). Everything here is offline: the pure
// planning functions run against fixture pull requests, check runs, commits
// and dispatch-run listings, proving the exact decisions the live pass makes:
//
//   - a PR head younger than the grace period is never dispatched,
//   - a context with at least one check run (ANY status, including the
//     lane-suffixed replacement names) needs nothing,
//   - a context with ZERO check runs on a stale head plans exactly one
//     dispatch of the owning workflow for that ref,
//   - a dispatch run that already exists for that head produces NOTHING
//     (loop safety: the watchdog never dispatches twice per head),
//   - fork heads and unknown commit dates are skipped, never guessed.
//
// Run: node --test scripts/db-flow/lane-watchdog.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  laneContextJobs,
  contextHasCheckRun,
  headAgeMs,
  planDispatches,
} from './lane-watchdog.mjs'
import { loadRegistry } from './runner-lanes.mjs'

const NOW = Date.parse('2026-10-23T12:00:00Z')
const REPO = 'acme/widgets'
const OLD_COMMIT = { commit: { committer: { date: '2026-10-23T11:00:00Z' } } } // 1h old
const FRESH_COMMIT = { commit: { committer: { date: '2026-10-23T11:59:30Z' } } } // 30s old

// The REAL registry: the watchdog's reading of the lane registry must match
// what runner-lanes.mjs actually loads, not a fixture copy of it.
const registry = loadRegistry()

function fixtureRegistry() {
  return {
    schema_version: 1,
    aggregate_context: 'Aggregate',
    lanes: [{ name: 'ubuntu-latest', label: 'ubuntu-latest', arch: 'x64', class: 'standard', qualified: true }],
    queue_sensitive_jobs: [
      { workflow: 'tools-offline-tests.yml', job_id: 'verify', context: 'Tools offline tests', required_on_main: true, assertions: ['tools-offline-tests'] },
      { workflow: 'coldlion-promotion-contract-tests.yml', job_id: 'contract-tests', context: 'Promotion contract tests (offline)', required_on_main: true, assertions: ['promotion-contract-tests-offline'] },
    ],
  }
}

function pr({ number = 1, sha = 'a'.repeat(40), ref = 'feature/x', repo = REPO } = {}) {
  return { number, head: { sha, ref, repo: { full_name: repo } } }
}

test('the real runner-lanes registry loads and names the lane contexts the watchdog owes', () => {
  const jobs = laneContextJobs(registry)
  assert.ok(jobs.length >= 2, 'expected the registered queue-sensitive jobs')
  for (const job of jobs) {
    assert.ok(job.workflow && job.context, 'each registered job names its owning workflow and context')
    assert.match(job.workflow, /\.yml$/)
  }
})

test('a check run under the stable context name satisfies the context, any status', () => {
  for (const status of ['queued', 'in_progress', 'completed']) {
    assert.equal(contextHasCheckRun('Tools offline tests', [{ name: 'Tools offline tests', status }]), true, status)
  }
})

test('a lane-suffixed replacement run satisfies the context too', () => {
  assert.equal(contextHasCheckRun('Tools offline tests', [{ name: 'Tools offline tests [lane ubuntu-24.04-arm]', status: 'queued' }]), true)
})

test('a similarly named or truncated context does NOT satisfy it', () => {
  assert.equal(contextHasCheckRun('Tools offline tests', [{ name: 'Tools offline tests extra', status: 'completed' }]), false)
  assert.equal(contextHasCheckRun('Tools offline tests', [{ name: 'Promotion contract tests (offline)', status: 'completed' }]), false)
  assert.equal(contextHasCheckRun('Tools offline tests', []), false)
})

test('headAgeMs reads the committer date and refuses to guess', () => {
  assert.equal(headAgeMs(OLD_COMMIT, NOW), 60 * 60 * 1000)
  assert.equal(headAgeMs({ commit: { author: { date: '2026-10-23T10:00:00Z' } } }, NOW), 2 * 60 * 60 * 1000)
  assert.equal(headAgeMs({}, NOW), null)
  assert.equal(headAgeMs({ commit: { committer: { date: 'not a date' } } }, NOW), null)
})

test('a stale head with a missing context plans exactly one dispatch of the owning workflow', () => {
  const shaA = 'a'.repeat(40)
  const plan = planDispatches({
    registry: fixtureRegistry(),
    repo: REPO,
    pulls: [pr({ number: 7, sha: shaA, ref: 'feature/seven' })],
    commitsBySha: { [shaA]: OLD_COMMIT },
    checkRunsBySha: { [shaA]: [{ name: 'Tools offline tests', status: 'queued' }] }, // only ONE of two contexts
    nowMs: NOW,
  })
  assert.equal(plan.dispatches.length, 1)
  assert.deepEqual(plan.dispatches[0], {
    pr: 7,
    workflow: 'coldlion-promotion-contract-tests.yml',
    context: 'Promotion contract tests (offline)',
    ref: 'feature/seven',
    head_sha: shaA,
    reason: plan.dispatches[0].reason,
  })
  assert.match(plan.dispatches[0].reason, /zero check runs/)
})

test('every registered context present (any status) plans nothing', () => {
  const sha = 'b'.repeat(40)
  const plan = planDispatches({
    registry: fixtureRegistry(),
    repo: REPO,
    pulls: [pr({ number: 8, sha })],
    commitsBySha: { [sha]: OLD_COMMIT },
    checkRunsBySha: {
      [sha]: [
        { name: 'Tools offline tests', status: 'queued' },
        { name: 'Promotion contract tests (offline) [lane ubuntu-24.04-arm]', status: 'in_progress' },
      ],
    },
    nowMs: NOW,
  })
  assert.deepEqual(plan.dispatches, [])
})

test('a head younger than the grace period is left alone while CI starts', () => {
  const sha = 'c'.repeat(40)
  const plan = planDispatches({
    registry: fixtureRegistry(),
    repo: REPO,
    pulls: [pr({ number: 9, sha })],
    commitsBySha: { [sha]: FRESH_COMMIT },
    checkRunsBySha: { [sha]: [] },
    nowMs: NOW,
  })
  assert.deepEqual(plan.dispatches, [])
  assert.ok(plan.notes.some((n) => n.action === 'skip-young-head'))
})

test('a head exactly at the grace boundary is evaluated (>= grace)', () => {
  const sha = 'd'.repeat(40)
  const exactlyOld = { commit: { committer: { date: '2026-10-23T11:55:00Z' } } } // exactly 5m
  const plan = planDispatches({
    registry: fixtureRegistry(),
    repo: REPO,
    pulls: [pr({ number: 10, sha })],
    commitsBySha: { [sha]: exactlyOld },
    checkRunsBySha: { [sha]: [] },
    nowMs: NOW,
  })
  assert.equal(plan.dispatches.length, 2) // both registered contexts missing
})

test('an existing dispatch for the head produces NOTHING (loop safety)', () => {
  const sha = 'e'.repeat(40)
  const plan = planDispatches({
    registry: fixtureRegistry(),
    repo: REPO,
    pulls: [pr({ number: 11, sha, ref: 'feature/eleven' })],
    commitsBySha: { [sha]: OLD_COMMIT },
    checkRunsBySha: { [sha]: [] },
    dispatchRunsByWorkflowRef: {
      'tools-offline-tests.yml|feature/eleven': [{ head_sha: sha }],
      'coldlion-promotion-contract-tests.yml|feature/eleven': [{ head_sha: sha }],
    },
    nowMs: NOW,
  })
  assert.deepEqual(plan.dispatches, [])
  assert.equal(plan.notes.filter((n) => n.action === 'skip-already-dispatched').length, 2)
})

test('a dispatch run for an OLDER head does not block the new head', () => {
  const sha = 'f'.repeat(40)
  const plan = planDispatches({
    registry: fixtureRegistry(),
    repo: REPO,
    pulls: [pr({ number: 12, sha, ref: 'feature/twelve' })],
    commitsBySha: { [sha]: OLD_COMMIT },
    checkRunsBySha: { [sha]: [] },
    dispatchRunsByWorkflowRef: {
      'tools-offline-tests.yml|feature/twelve': [{ head_sha: '0'.repeat(40) }], // previous push
      'coldlion-promotion-contract-tests.yml|feature/twelve': [],
    },
    nowMs: NOW,
  })
  assert.equal(plan.dispatches.length, 2)
})

test('a fork head is skipped, never dispatched into the wrong repository', () => {
  const sha = '1'.repeat(40)
  const plan = planDispatches({
    registry: fixtureRegistry(),
    repo: REPO,
    pulls: [pr({ number: 13, sha, repo: 'someoneelse/fork' })],
    commitsBySha: { [sha]: OLD_COMMIT },
    checkRunsBySha: { [sha]: [] },
    nowMs: NOW,
  })
  assert.deepEqual(plan.dispatches, [])
  assert.ok(plan.notes.some((n) => n.action === 'skip-fork-head'))
})

test('an unknown commit date is skipped rather than guessed', () => {
  const sha = '2'.repeat(40)
  const plan = planDispatches({
    registry: fixtureRegistry(),
    repo: REPO,
    pulls: [pr({ number: 14, sha })],
    commitsBySha: {},
    checkRunsBySha: { [sha]: [] },
    nowMs: NOW,
  })
  assert.deepEqual(plan.dispatches, [])
  assert.ok(plan.notes.some((n) => n.action === 'skip-unreadable-head'))
})

test('two PRs sharing one head get ONE dispatch, not two', () => {
  const sha = '3'.repeat(40)
  const plan = planDispatches({
    registry: fixtureRegistry(),
    repo: REPO,
    pulls: [pr({ number: 15, sha, ref: 'shared' }), pr({ number: 16, sha, ref: 'shared' })],
    commitsBySha: { [sha]: OLD_COMMIT },
    checkRunsBySha: { [sha]: [{ name: 'Tools offline tests', status: 'queued' }] },
    nowMs: NOW,
  })
  assert.equal(plan.dispatches.length, 1)
  assert.equal(plan.dispatches[0].workflow, 'coldlion-promotion-contract-tests.yml')
})

test('every planned dispatch targets a workflow registered in the lane registry', () => {
  const sha = '4'.repeat(40)
  const plan = planDispatches({
    registry: fixtureRegistry(),
    repo: REPO,
    pulls: [pr({ number: 17, sha })],
    commitsBySha: { [sha]: OLD_COMMIT },
    checkRunsBySha: { [sha]: [] },
    nowMs: NOW,
  })
  const registered = new Set(fixtureRegistry().queue_sensitive_jobs.map((j) => j.workflow))
  for (const dispatch of plan.dispatches) {
    assert.ok(registered.has(dispatch.workflow), `unregistered workflow planned: ${dispatch.workflow}`)
    assert.match(dispatch.ref, /^[A-Za-z0-9._\/-]+$/, 'refs must be dispatch-safe')
  }
})

test('the watchdog script and its workflow file carry the read-only permission promise', () => {
  const script = readFileSync(new URL('./lane-watchdog.mjs', import.meta.url), 'utf8')
  assert.match(script, /never merges, never pushes/, 'the script states what it never does')
  assert.match(script, /github-transport\.mjs/, 'all GitHub access goes through the shared transport')
  const workflow = readFileSync(new URL('../../.github/workflows/lane-watchdog.yml', import.meta.url), 'utf8')
  assert.match(workflow, /actions: write/, 'dispatching needs actions: write')
  assert.match(workflow, /contents: read[\s\S]*?pull-requests: read/, 'reads stay read-only')
  // No scope, and no step, that could merge, push or rewrite history.
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|issues: write|checks: write/, 'no write scopes beyond actions: write')
  assert.doesNotMatch(workflow, /git push|gh pr merge|gh api -X (?:PATCH|PUT|DELETE)/, 'no merge, push or ref-writing command anywhere')
})

test('lane-watchdog.mjs does not spawn gh directly (transport conformance #2342)', () => {
  const script = readFileSync(new URL('./lane-watchdog.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(script, /\b(?:execFileSync|execFile|spawnSync|spawn)\s*\(\s*['"`]gh['"`]/, 'reads and writes must go through scripts/lib/github-transport.mjs')
})
