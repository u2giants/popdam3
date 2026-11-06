// Offline tests for the Step 7 repack proposer (popcre/shared-db#5758). No GitHub, no database.
import test from 'node:test'
import assert from 'node:assert/strict'
import { choose, buildEntry, operationId, loadAllowlist, loadPolicy } from './db-repack-proposer.mjs'

const MB = 1048576
const row = (tbl, ratio, o = {}) => ({ tbl, ratio, heap_bytes: 500 * MB, index_bytes: 200 * MB, flags: ratio > 2 ? ['heap/live'] : [], notes: [], ...o })
const ctx = (o = {}) => ({ policy: { schema_version: 1, operations: {} }, allowlist: loadAllowlist(), done: () => true, openClaims: [], diskAvail: 50 * 2 ** 30, ...o })

test('committed allowlist keeps public.assets manual and excludes change_log', () => {
  const a = loadAllowlist()
  assert.equal(a.find((x) => x.table === 'public.assets').automatic, false)
  assert.ok(!a.some((x) => x.table === 'coldlion.change_log'))
})
test('flagged allowlisted table over 2.5 is chosen; worst first', () => {
  const { candidate } = choose([row('plm.item', 2.6), row('plm.item_import', 3.1)], ctx())
  assert.equal(candidate.tbl, 'plm.item_import')
})
test('ratio at or below 2.5 is not compacted', () => {
  assert.equal(choose([row('plm.item', 2.4)], ctx()).candidate, null)
})
test('non-allowlisted and manual-only tables are never proposed', () => {
  assert.equal(choose([row('public.assets', 9), row('coldlion.change_log', 9), row('public.other', 9)], ctx()).candidate, null)
})
test('free disk below heap + indexes + 1 GiB refuses', () => {
  assert.equal(choose([row('plm.item', 3)], ctx({ diskAvail: 700 * MB + (1 << 30) - 1 })).candidate, null)
})
test('heap above the allowlisted limit refuses', () => {
  assert.equal(choose([row('plm.item', 3, { heap_bytes: 1025 * MB })], ctx()).candidate, null)
})
test('second concurrent operation refused: an unfinished repack blocks any proposal', () => {
  const policy = { schema_version: 1, operations: { 'repack-x': { kind: 'table-repack/v1' } } }
  const r = choose([row('plm.item', 3)], ctx({ policy, done: () => false }))
  assert.equal(r.candidate, null); assert.match(r.log[0], /never two repacks/)
})
test('another open claim on the table refuses', () => {
  assert.equal(choose([row('plm.item', 3)], ctx({ openClaims: [{ body: '- table plm.item\n' }] })).candidate, null)
})
test('test mode picks the named automatic table regardless of ratio, never a manual one', () => {
  assert.equal(choose([row('plm.item', 1.1)], ctx({ testTable: 'plm.item' })).candidate.tbl, 'plm.item')
  assert.equal(choose([row('public.assets', 9)], ctx({ testTable: 'public.assets' })).candidate, null)
})
test('entry reuses the pinned client, validates as an operation id, and marks preview_only in test mode', () => {
  const e = buildEntry(loadPolicy(), { table: 'plm.item', pr: 9, claim: 8, work: 5886, previewOnly: true })
  assert.equal(e.preview_only, true); assert.match(e.client_sha256, /^[a-f0-9]{64}$/)
  const id = operationId('plm.item', '2026-11-09')
  assert.match(id, /^repack-[a-z0-9-]{1,33}$/); assert.ok(id.length <= 40)
  assert.equal(buildEntry(loadPolicy(), { table: 'plm.item', pr: 9, claim: 8, work: 5886 }).preview_only, undefined)
})
