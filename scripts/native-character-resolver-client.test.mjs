import test from "node:test";
import assert from "node:assert/strict";
import { nativeCharacterResolverClient } from "./native-character-resolver-client.mjs";
test("resolver reads remain parameterized and cannot mutate or choose arbitrary SQL objects", async () => {
  const calls = [];
  const c = nativeCharacterResolverClient({
    query: async (sql, parameters) => (
      calls.push({ sql, parameters }),
      { rows: [{ id: "safe" }] }
    ),
  });
  const result = await c
    .schema("core")
    .from("character")
    .select("id,name,status")
    .eq("licensor_id", "licensed")
    .ilike("name", "x';delete from assets;--")
    .order("name")
    .limit(200);
  assert.equal(result.data[0].id, "safe");
  assert.equal(calls[0].sql.includes("delete from assets"), false);
  assert.equal(calls[0].parameters[1], "x';delete from assets;--");
  assert.throws(() => c.from("assets"));
  assert.throws(() =>
    c.schema("core").from("character").eq("name;delete", "x"),
  );
  assert.equal(c.schema("core").from("character").insert, undefined);
});
test("alias relation and singular scope reads preserve the application response contract", async () => {
  const calls = [],
    trace = [];
  const c = nativeCharacterResolverClient(
    {
      query: async (sql, parameters) => (
        calls.push({ sql, parameters }),
        { rows: [] }
      ),
    },
    trace,
  );
  assert.deepEqual(
    await c
      .schema("core")
      .from("character_alias")
      .select("alias, character:character_id(id, status)")
      .eq("licensor_id", "lic")
      .limit(50),
    { data: [], error: null },
  );
  assert.equal(calls[0].sql.includes("left join core.character"), true);
  assert.deepEqual(
    await c
      .from("style_groups")
      .select("sku, licensor_id, property_id, is_licensed")
      .eq("id", "group")
      .maybeSingle(),
    { data: null, error: null },
  );
  assert.equal(trace.length, 2);
});
