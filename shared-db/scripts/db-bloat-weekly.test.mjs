import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, renderReading, parseLedger, renderLedger, READING_SQL } from './db-bloat-weekly.mjs'

const MB = 1048576
const tbl = (o) => ({ tbl: 'x.t', heap_bytes: 200 * MB, index_bytes: 50 * MB, est_rows: 1000, live_bytes: 150 * MB,
  n_tup_ins: 0, n_tup_upd: 0, n_tup_hot_upd: 0, n_tup_del: 0, top_writer: 'update x.t set a=1', ...o })
const rd = (at, tables, reset = null) => ({ read_at: at, stats_reset: reset, tables })

test('SQL is a single read-only SELECT', () => {
  assert.match(READING_SQL, /^with t as/)
  assert.doesNotMatch(READING_SQL, /\b(alter|drop|vacuum|truncate|create)\b/i)
})

test('heap/live over 2 on an update-churned table is flagged with its writer', () => {
  const [r] = evaluate(rd('2026-11-09T11:00:00Z', [tbl({ heap_bytes: 500 * MB, n_tup_upd: 10, n_tup_del: 1 })]), null)
  assert.equal(r.flags.length, 1)
  assert.match(renderReading(rd('2026-11-09T11:00:00Z', []), [r], null, { target: 'production', runUrl: 'u' }), /Likely writer: `update x.t/)
})

test('coldlion.change_log free space after rotation is never a writer flag', () => {
  const [r] = evaluate(rd('2026-11-09T11:00:00Z', [tbl({ tbl: 'coldlion.change_log', heap_bytes: 900 * MB, n_tup_upd: 50, n_tup_del: 0 })]), null)
  assert.deepEqual(r.flags, [])
  assert.match(r.notes[0], /not a writer problem/)
})

test('delete-dominated space on any table is reclaimable, not flagged', () => {
  const prev = rd('2026-11-02T11:00:00Z', [tbl({ heap_bytes: 500 * MB, n_tup_upd: 100, n_tup_del: 0 })])
  const [r] = evaluate(rd('2026-11-09T11:00:00Z', [tbl({ heap_bytes: 500 * MB, n_tup_upd: 110, n_tup_del: 5000 })]), prev)
  assert.deepEqual(r.flags, [])
})

test('index/heap growth > 50% and low HOT with churn are flagged week-over-week', () => {
  const prev = rd('2026-11-02T11:00:00Z', [tbl({ index_bytes: 40 * MB, n_tup_upd: 0, n_tup_hot_upd: 0 })])
  const [r] = evaluate(rd('2026-11-09T11:00:00Z', [tbl({ index_bytes: 100 * MB, n_tup_upd: 7000, n_tup_hot_upd: 1000 })]), prev)
  assert.equal(r.flags.length, 2)
})

test('a stats reset between readings disables deltas', () => {
  const prev = rd('2026-11-02T11:00:00Z', [tbl({ n_tup_upd: 0 })], '2026-10-01T00:00:00Z')
  const [r] = evaluate(rd('2026-11-09T11:00:00Z', [tbl({ n_tup_upd: 7000, n_tup_hot_upd: 0 })], '2026-11-05T00:00:00Z'), prev)
  assert.equal(r.updPerRowDay, null)
  assert.deepEqual(r.flags, [])
})

test('ledger round-trips without writer text', () => {
  const reading = rd('2026-11-09T11:00:00Z', [tbl({})])
  const back = parseLedger(renderLedger(reading))
  assert.equal(back.tables[0].tbl, 'x.t')
  assert.equal(back.tables[0].top_writer, undefined)
  assert.equal(parseLedger('nothing'), null)
})
