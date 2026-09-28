import { test } from "node:test";
import { strict as assert } from "node:assert";
import { assessWindow, compareSortedRows, normalizeIndexInventory, summarizeResultReceipt } from "./indexed-write-measurement.mjs";

const inventory = normalizeIndexInventory([
  { index_name: "expression_and_partial", definition: "CREATE INDEX expression_and_partial ON t ((lower(name))) WHERE active",
    columns: ["name", "active", "name"] },
  { index_name: "primary", definition: "CREATE UNIQUE INDEX primary ON t (id)", columns: ["id"] },
]);
const stats = (overrides = {}) => ({ project_ref: "qsllyeztdwjgirsysgai", table: "public.assets",
  server_started_at: "start", bgwriter_reset_at: "reset", database_reset_at: null, table_reset_at: null,
  n_tup_ins: "10", n_tup_upd: "20", n_tup_hot_upd: "2", n_tup_newpage_upd: "3", ...overrides });
const operation = { name: "one bounded ingest", paths: ["ingest-update"], source_commit: "a".repeat(40),
  result_receipt_sha256: "b".repeat(64), single_writer_receipt_sha256: "c".repeat(64),
  attempted_rows: 4, succeeded_rows: 3 };
const snapshot = (id, version, values) => ({ id, version, values: JSON.stringify(values) });
const asyncRows = async function* (rows) { yield* rows; };

test("catalog inventory keeps expression and partial predicate dependencies", () => {
  assert.deepEqual(inventory.columns, ["active", "id", "name"]);
  assert.throws(() => normalizeIndexInventory([{ index_name: "unknown", definition: "INDEX", columns: [] }]), /unresolved/);
});

test("sums only real result events inside the snapshot bounds", () => {
  const bounds = { table: "public.assets", paths: ["ingest-update", "style-group-assignment"],
    afterBefore: "2026-09-28T01:00:00Z", beforeAfter: "2026-09-28T02:00:00Z" };
  const receipt = { events: [
    { table: bounds.table, path: "ingest-update", observed_at: "2026-09-28T01:10:00Z", attempted_rows: 2, succeeded_rows: 1 },
    { table: bounds.table, path: "style-group-assignment", observed_at: "2026-09-28T01:20:00Z", attempted_rows: 1, succeeded_rows: 1 },
  ] };
  assert.deepEqual(summarizeResultReceipt(receipt, bounds), { attempted_rows: 3, succeeded_rows: 2 });
  assert.throws(() => summarizeResultReceipt({ events: [{ ...receipt.events[0], succeeded_rows: null }] }, bounds), /nonnegative/);
  assert.throws(() => summarizeResultReceipt({ events: [{ ...receipt.events[0], observed_at: bounds.beforeAfter }] }, bounds), /outside/);
  assert.throws(() => summarizeResultReceipt({ events: [{ ...receipt.events[0], path: "other" }] }, bounds), /outside/);
});

test("compares inserts, indexed changes, and unchanged-index updates including NULL", async () => {
  const counts = await compareSortedRows(asyncRows([
    snapshot('["1"]', "1", { active: true, name: null }),
    snapshot('["2"]', "2", { active: true, name: "a" }),
    snapshot('["3"]', "3", { active: false, name: "b" }),
  ]), asyncRows([
    snapshot('["1"]', "4", { active: true, name: null }),
    snapshot('["2"]', "5", { active: true, name: "B" }),
    snapshot('["3"]', "3", { active: false, name: "b" }),
    snapshot('["4"]', "6", { active: true, name: "c" }),
  ]));
  assert.equal(counts.updated_rows, 2);
  assert.equal(counts.indexed_value_changed, 1);
  assert.equal(counts.hot_eligible_unchanged_index, 1);
  assert.equal(counts.inserted_rows, 1);
  const report = assessWindow({ before: { inventory, stats: stats(), finished_at: "before" },
    after: { inventory, stats: stats({ n_tup_ins: "11", n_tup_upd: "22", n_tup_hot_upd: "3", n_tup_newpage_upd: "4" }), started_at: "after" },
    counts, operation });
  assert.equal(report.succeeded_rows, 3);
  assert.equal(report.failed_rows, 1);
  assert.equal(report.table_delta.n_tup_hot_upd, 1);
});

test("rejects retries, concurrent writers, failure count mismatch, reset, and index drift", () => {
  const counts = { updated_rows: 2, inserted_rows: 1, indexed_value_changed: 1, hot_eligible_unchanged_index: 1 };
  const before = { inventory, stats: stats() };
  const after = { inventory, stats: stats({ n_tup_ins: "11", n_tup_upd: "22", n_tup_hot_upd: "3", n_tup_newpage_upd: "4" }) };
  assert.throws(() => assessWindow({ before, after: { ...after, stats: stats({ n_tup_ins: "11", n_tup_upd: "23" }) }, counts, operation }), /repeated, concurrent/);
  assert.throws(() => assessWindow({ before, after, counts, operation: { ...operation, succeeded_rows: 2 } }), /do not match/);
  assert.throws(() => assessWindow({ before, after: { ...after, stats: stats({ ...after.stats, bgwriter_reset_at: "new" }) }, counts, operation }), /reset identity/);
  assert.throws(() => assessWindow({ before, after: { ...after, inventory: { ...inventory, indexes: [] } }, counts, operation }), /index definitions/);
  assert.throws(() => assessWindow({ before, after, counts, operation: { ...operation, single_writer_receipt_sha256: "" } }), /single-writer/);
});

test("rejects missing rows, duplicate IDs, and changed values without an update", async () => {
  await assert.rejects(compareSortedRows(asyncRows([snapshot('["1"]', "1", {})]), asyncRows([])), /disappeared/);
  await assert.rejects(compareSortedRows(asyncRows([snapshot('["1"]', "1", {}), snapshot('["1"]', "1", {})]),
    asyncRows([snapshot('["1"]', "1", {})])), /unsorted/);
  await assert.rejects(compareSortedRows(asyncRows([snapshot('["1"]', "1", { active: false })]),
    asyncRows([snapshot('["1"]', "1", { active: true })])), /without a tuple version/);
});
