import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migrationPath = new URL('../supabase/migrations/20260823233716_reconcile_dflow_referenced_sequence_ceilings.sql', import.meta.url)
const sql = readFileSync(migrationPath, 'utf8')

const expected = new Map([
  ['dflow."AuditLog_id_seq"', ['dflow."AuditLog"', 'id', 1000000, 610745]],
  ['dflow."Factory_id_seq"', ['dflow."Factory"', 'id', 1000, 201]],
  ['dflow."MerchGroup_mg_id_seq"', ['dflow."merchGroup"', 'mg_id', 10000, 4867]],
  ['dflow."ProdOrderHeader_id_seq"', ['dflow."ProdOrderHeader"', 'id', 100000, 15298]],
  ['dflow."RFQContainer_RFQContainer_id_seq"', ['dflow."RFQContainer"', 'RFQContainer_id', 100, 26]],
  ['dflow."RFQGroup_RFQGroup_id_seq"', ['dflow."RFQGroup"', 'RFQGroup_id', 1000, 424]],
  ['dflow."RFQItem_rfqItem_id_seq"', ['dflow."RFQItem"', 'rfqItem_id', 100000, 18128]],
  ['dflow."RFQVendor_RFQVendor_id_seq"', ['dflow."RFQVendor"', 'RFQVendor_id', 100000, 36912]],
  ['dflow."StandardizedGroup_id_seq"', ['dflow."StandardizedGroup"', 'id', 1000, 94]],
  ['dflow."StandardizedSize_id_seq"', ['dflow."StandardizedSize"', 'id', 1000, 644]],
  ['dflow.customers_customers_id_seq', ['dflow.customers', 'customers_id', 1000, 57]],
  ['dflow."externalCustomer_id_seq"', ['dflow."externalCustomer"', 'id', 30000000, 19142539]],
  ['dflow."externalVendor_id_seq"', ['dflow."externalVendor"', 'id', 20000000, 12258025]],
  ['dflow."licensingStatus_id_seq"', ['dflow."licensingStatus"', 'id', 100000, 16468]],
  ['dflow.user_notification_id_seq', ['dflow.user_notification', 'id', 1000000, 108207]],
  ['dflow.users_id_seq', ['dflow.users', 'id', 1000, 72]],
  ['dflow.vendor_vendor_id_seq', ['dflow.vendor', 'vendor_id', 1000, 299]],
  ['dflow."itemHeader_item_num_id_pk _seq"', ['dflow."itemHeader"', 'item_id_pk', 100000, 19877]],
])

const lists = [...sql.matchAll(/from \(values([\s\S]*?)\) as audited\(sequence_name, table_name, id_column, floor_value, external_ceiling\)/g)]
assert.equal(lists.length, 2, 'migration and verification must each carry one audited sequence list')

function parseList(body) {
  const rows = [...body.matchAll(/\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+)::bigint,\s*(\d+)::bigint\)/g)]
  assert.equal(rows.length, 18, 'each audited list must contain exactly 18 sequences')
  return new Map(rows.map(([, name, table, column, floor, ceiling]) => [name, [table, column, Number(floor), Number(ceiling)]]))
}

for (const list of lists) assert.deepEqual(parseList(list[1]), expected)

for (const [name, [, , floor, ceiling]] of expected) {
  assert.ok(floor > ceiling, `${name}: floor must clear its measured external ceiling`)
}

assert.match(sql, /v_target := greatest\(v\.floor_value, v_max_id\)/)
assert.match(sql, /v_next := case when v_is_called then v_current \+ 1 else v_current end/g)
assert.match(sql, /if v_next <= v_target then[\s\S]*perform setval\(v_seq, v_target, true\)/)
assert.match(sql, /if v_next <= v_max_id then/)
assert.match(sql, /if v_next <= v\.external_ceiling then/)
assert.equal((sql.match(/to_regclass\(/g) ?? []).length, 4, 'both blocks must guard sequence and table resolution')

assert.equal((sql.match(/perform setval\(/g) ?? []).length, 1, 'all writes must flow through the exact 18-row audited list')

console.log('issue #1315 sequence reconciliation contract: 18 exact sequences, floors, ceilings, guards, and exclusions verified')
