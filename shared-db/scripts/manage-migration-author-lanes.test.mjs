import assert from 'node:assert/strict'
import test from 'node:test'
import { assertLaneAvailable, claimBody, LaneError, parseAuthorLease } from './manage-migration-author-lanes.mjs'

const NOW = new Date('2026-08-14T20:00:00Z')
const body = (objects, owner, expires = '2026-08-15T08:00:00.000Z') => claimBody({
  version: `2026081420${owner.padStart(4, '0')}`,
  objects,
  owner: `agent-${owner}`,
  branch: `codex/${owner}`,
  worktree: `C:/worktrees/${owner}`,
  expiresAt: new Date(expires),
})

test('three unrelated authors can hold lanes concurrently', () => {
  const claims = [1, 2].map((number) => ({ number, body: body([`table core.t${number}`], String(number)) }))
  const state = assertLaneAvailable(claims, ['table core.t3'], NOW)
  assert.equal(state.active.length, 2)
})

test('a fourth concurrent author is rejected', () => {
  const claims = [1, 2, 3].map((number) => ({ number, body: body([`table core.t${number}`], String(number)) }))
  assert.throws(() => assertLaneAvailable(claims, ['table core.t4'], NOW), /all 3/)
})

test('overlapping exact object claims are rejected', () => {
  const claims = [{ number: 7, body: body(['function plm.sync_x'], '7') }]
  assert.throws(() => assertLaneAvailable(claims, ['FUNCTION   plm.sync_x'], NOW), /collision.*plm.sync_x/)
})

test('unreadable claims fail closed', () => {
  const claims = [{ number: 9, body: '```db-claim\nobjects:\n - table core.x\n```\n```db-author-lease\nowner: a\n```' }]
  assert.throws(() => assertLaneAvailable(claims, ['table core.y'], NOW), LaneError)
  assert.throws(() => assertLaneAvailable([{ number: 10, body: 'not a claim' }], ['table core.y'], NOW), /missing fenced/)
})

test('expired leases leave the active lane count and are returned for cleanup', () => {
  const claims = [{ number: 4, body: body(['table core.old'], '4', '2026-08-14T19:59:59Z') }]
  const state = assertLaneAvailable(claims, ['table core.new'], NOW)
  assert.equal(state.active.length, 0)
  assert.deepEqual(state.stale.map((claim) => claim.number), [4])
})

test('legacy exact claims remain active until manually closed', () => {
  const lease = parseAuthorLease('```db-claim\nversion: none\nobjects:\n  - table core.legacy\n```', NOW)
  assert.equal(lease.legacy, true)
  assert.equal(lease.active, true)
  const state = assertLaneAvailable([{ number: 10, body: '```db-claim\nversion: none\nobjects:\n  - table core.legacy\n```' }], ['table core.other'], NOW)
  assert.equal(state.active.length, 0)
  assert.throws(() => assertLaneAvailable([{ number: 10, body: '```db-claim\nversion: none\nobjects:\n  - table core.legacy\n```' }], ['table core.legacy'], NOW), /collision/)
})
