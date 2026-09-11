import test from 'node:test'
import assert from 'node:assert/strict'
import { ActivationError, validateActivationConfig, isGrandfathered } from './agent-work-contract-activation.mjs'

const config = (over = {}) => ({
  schema_version: 1,
  mode: 'enforced',
  activated_at: '2026-09-07',
  grandfathered_prs: [{ number: 12, head_sha: 'a'.repeat(40) }],
  ...over,
})

test('grandfathering binds both the PR number and exact head', () => {
  assert.equal(isGrandfathered(config(), { pr: 12, headSha: 'a'.repeat(40) }), true)
  assert.equal(isGrandfathered(config(), { pr: 12, headSha: 'b'.repeat(40) }), false)
  assert.equal(isGrandfathered(config(), { pr: 13, headSha: 'a'.repeat(40) }), false)
})

test('malformed, duplicate, and unpinned entries are refused', () => {
  assert.throws(() => validateActivationConfig(config({ grandfathered_prs: [12] })), ActivationError)
  assert.throws(() => validateActivationConfig(config({ grandfathered_prs: [{ number: 12, head_sha: 'abc1234' }] })), /40-character/)
  assert.throws(() => validateActivationConfig(config({ grandfathered_prs: [
    { number: 12, head_sha: 'a'.repeat(40) },
    { number: 12, head_sha: 'b'.repeat(40) },
  ] })), /more than once/)
})

test('enforced mode requires a real activation date', () => {
  assert.throws(() => validateActivationConfig(config({ activated_at: null })), /activated_at/)
  assert.doesNotThrow(() => validateActivationConfig(config({ mode: 'report-only', activated_at: null })))
})
