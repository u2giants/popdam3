import test from 'node:test'
import assert from 'node:assert/strict'
import { APPLY_LANE_LOCK_KEY, ApplyLockError, acquireApplyLock, releaseApplyLock } from './apply-lane-advisory-lock.mjs'

const client = (acquired) => ({
  queries: [],
  async query(sql) { this.queries.push(sql); return { rows: [{ acquired }] } },
})

test('the key matches the one registered in docs/advisory-lock-registry.md', () => {
  assert.equal(APPLY_LANE_LOCK_KEY, 620260823, 'changing this silently moves the lock and lets two applies interleave')
})

test('acquiring uses pg_try_advisory_lock, never a blocking wait', async () => {
  const db = client(true)
  await acquireApplyLock(db, { target: 'preview' })
  assert.match(db.queries[0], /pg_try_advisory_lock\(620260823\)/)
  assert.doesNotMatch(db.queries[0], /pg_advisory_lock\(/, 'a blocking wait would queue an apply behind a stale one')
})

// FAIL CLOSED, and never as a silent no-op (advisory-lock registry rule 4).
test('a held lock refuses, names the target, and does not return quietly', async () => {
  await assert.rejects(() => acquireApplyLock(client(false), { target: 'production' }), (error) => {
    assert.ok(error instanceof ApplyLockError)
    assert.match(error.message, /another apply already holds/)
    assert.match(error.message, /production/)
    assert.match(error.message, /wait rather than forcing it/)
    return true
  })
})

test('a refusal that is not a clear true is treated as a refusal', async () => {
  for (const value of [false, null, undefined, 'true']) {
    await assert.rejects(() => acquireApplyLock({ async query() { return { rows: [{ acquired: value }] } } }, { target: 't' }), ApplyLockError)
  }
})

test('the caller must name the target, so a refusal can say what it protected', async () => {
  await assert.rejects(() => acquireApplyLock(client(true), {}), /needs the target/)
  await assert.rejects(() => acquireApplyLock(null, { target: 't' }), /needs a database client/)
})

test('release unlocks the same key', async () => {
  const db = client(true)
  await releaseApplyLock(db)
  assert.match(db.queries[0], /pg_advisory_unlock\(620260823\)/)
})
