import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, parseLedger, renderLedger, fetchReading } from './assets-bloat-monitor.mjs'

const base = { heap_bytes: 400e6, live_bytes: 250e6, live_rows: 1, index_bytes: 1, n_dead_tup: 0, last_autovacuum: null }
const at = (d) => new Date(Date.UTC(2026, 10, d)).toISOString()

test('ratio over 2.0 breaches', () => {
  const r = evaluate({ ...base, heap_bytes: 2122317824, live_bytes: 197101984, read_at: at(10), n_tup_upd: 10, n_tup_hot_upd: 5 }, [])
  assert.ok(r.ratio > 10)
  assert.equal(r.breaches.length, 1)
})

test('compact table with no history is within thresholds', () => {
  assert.deepEqual(evaluate({ ...base, read_at: at(10), n_tup_upd: 10, n_tup_hot_upd: 1 }, []).breaches, [])
})

test('7-day HOT ratio uses counter deltas', () => {
  const hist = [{ read_at: at(3), n_tup_upd: 1000, n_tup_hot_upd: 900 }, { read_at: at(8), n_tup_upd: 1500, n_tup_hot_upd: 950 }]
  const r = evaluate({ ...base, read_at: at(10), n_tup_upd: 2000, n_tup_hot_upd: 1500 }, hist)
  assert.equal(r.hot.ratio, 0.6)
  assert.match(r.breaches[0], /HOT ratio 60.0%/)
})

test('HOT window shorter than 7 days does not alert', () => {
  const r = evaluate({ ...base, read_at: at(10), n_tup_upd: 2000, n_tup_hot_upd: 1000 }, [{ read_at: at(8), n_tup_upd: 1000, n_tup_hot_upd: 900 }])
  assert.deepEqual(r.breaches, [])
})

test('stats reset (counters went down) is ignored', () => {
  const r = evaluate({ ...base, read_at: at(10), n_tup_upd: 10, n_tup_hot_upd: 1 }, [{ read_at: at(3), n_tup_upd: 1000, n_tup_hot_upd: 900 }])
  assert.equal(r.hot, null)
})

test('ledger round-trips and tolerates garbage', () => {
  const h = [{ read_at: at(1), n_tup_upd: 1 }]
  assert.deepEqual(parseLedger(renderLedger(h)), h)
  assert.deepEqual(parseLedger('nope'), [])
})

test('zero live bytes refuses', () => {
  assert.throws(() => evaluate({ ...base, live_bytes: 0, read_at: at(1), n_tup_upd: 0, n_tup_hot_upd: 0 }, []))
})

test('fetchReading refuses without token and on API error', async () => {
  await assert.rejects(fetchReading('x', ''))
  await assert.rejects(fetchReading('x', 't', { fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'e' }) }))
})
