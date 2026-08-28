import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { validateBaseline, summarizeBaseline, BaselineSchemaError } from './baseline-schema.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixture = JSON.parse(await readFile(resolve(root, 'docs/verification/orchestrator-throughput-phase-2-baseline-20260828.json'), 'utf8'))

test('the scrubbed transcript baseline validates and does not invent active effort', () => {
  const summary = summarizeBaseline(fixture)
  assert.equal(summary.issues, 6)
  assert.equal(summary.workersObserved, 3)
  assert.equal(summary.activeEffortMinutes, 'unknown')
  assert.equal(summary.materialLoops, 17)
})

test('claim protection and author capacity cannot be conflated', () => {
  const invalid = structuredClone(fixture)
  invalid.state_model.author_lease = invalid.state_model.claim
  assert.throws(() => validateBaseline(invalid), BaselineSchemaError)
})

test('active effort must remain unknown', () => {
  const invalid = structuredClone(fixture)
  invalid.issues[0].active_effort_minutes = invalid.issues[0].observed_wall_minutes
  assert.throws(() => validateBaseline(invalid), /active effort must remain unknown/)
})

test('impossible event order is rejected', () => {
  const invalid = structuredClone(fixture)
  invalid.timeline[1].timestamp = '2026-08-28T02:00:00Z'
  assert.throws(() => validateBaseline(invalid), /chronological/)
})

test('the baseline cannot assert five workers when only three have worker evidence', () => {
  const invalid = structuredClone(fixture)
  invalid.issues[4].worker_events = 1
  invalid.issues[5].worker_events = 1
  assert.equal(summarizeBaseline(invalid).workersObserved, 5)
  assert.notEqual(summarizeBaseline(fixture).workersObserved, 5)
})
