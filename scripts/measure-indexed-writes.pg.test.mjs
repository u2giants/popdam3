// Run only against a disposable local PostgreSQL instance:
// POP_MEASURE_TEST_DATABASE_URL=postgresql://...@127.0.0.1:port/postgres node --test this-file
import { test } from "node:test";
import { strict as assert } from "node:assert";
import pg from "pg";
import Cursor from "pg-cursor";
import { INVENTORY_SQL, PRIMARY_SQL, STATS_SQL } from "./measure-indexed-writes.mjs";
import { normalizeIndexInventory } from "./lib/indexed-write-measurement.mjs";

const url = process.env.POP_MEASURE_TEST_DATABASE_URL;
const enabled = (() => {
  if (!url) return false;
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("integration test requires a local PostgreSQL host");
  }
  return true;
})();

test("real PostgreSQL index dependencies, cursor ordering, and reset behavior", { skip: !enabled }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("CREATE TABLE public.popdam169_fixture (id text PRIMARY KEY, indexed text, active boolean)");
    await client.query("CREATE INDEX popdam169_fixture_expr_partial ON public.popdam169_fixture ((lower(indexed))) WHERE active");
    await client.query("SELECT pg_stat_reset()");
    await client.query("INSERT INTO public.popdam169_fixture VALUES ('a', 'A', true), ('b', 'B', false)");
    const primary = (await client.query(PRIMARY_SQL, ["public.popdam169_fixture"])).rows[0];
    assert.deepEqual(primary.columns, ["id"]);
    const rawInventory = (await client.query(INVENTORY_SQL, ["public.popdam169_fixture"])).rows;
    const inventory = normalizeIndexInventory(rawInventory);
    assert.deepEqual(inventory.columns, ["active", "id", "indexed"]);
    assert.equal(inventory.indexes.length, 2);
    const cursor = client.query(new Cursor(
      "SELECT id FROM public.popdam169_fixture ORDER BY id DESC"));
    try {
      assert.deepEqual((await cursor.read(1)).map((row) => row.id), ["b"]);
      assert.deepEqual((await cursor.read(1)).map((row) => row.id), ["a"]);
      assert.deepEqual(await cursor.read(1), []);
    } finally { await cursor.close(); }
    await client.query("UPDATE public.popdam169_fixture SET indexed = 'C' WHERE id = 'a'");
    await client.query("SELECT pg_stat_clear_snapshot()");
    const before = (await client.query(STATS_SQL, ["public.popdam169_fixture"])).rows[0];
    assert.equal(before.database_name, "postgres");
    assert.equal(before.role_name, "postgres");
    assert.equal(before.read_only, "off");
    await client.query("SELECT pg_stat_reset_single_table_counters('public.popdam169_fixture'::regclass)");
    await client.query("SELECT pg_stat_clear_snapshot()");
    const after = (await client.query(STATS_SQL, ["public.popdam169_fixture"])).rows[0];
    assert.notEqual(after.database_reset_at, before.database_reset_at);
    assert.equal(after.bgwriter_reset_at, before.bgwriter_reset_at);
    assert.ok(Number(after.n_tup_upd) <= Number(before.n_tup_upd));
    assert.equal(Object.hasOwn(after, "table_reset_at"), false);
  } finally {
    await client.query("DROP TABLE IF EXISTS public.popdam169_fixture");
    await client.end();
  }
});
