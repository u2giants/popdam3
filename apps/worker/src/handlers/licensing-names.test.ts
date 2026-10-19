import test from "node:test";
import assert from "node:assert/strict";
import { resolveLicensingNames } from "./ai-tagging-shared.js";

function fakeClient(rows: Record<string, Record<string, unknown>>) {
  const reads: string[] = [];
  const table = (name: string) => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => { reads.push(name); return { data: rows[name] ?? null, error: null }; } };
    return chain;
  };
  return { reads, client: { from: table, schema: () => ({ from: table }) } as never };
}

test("grouped assets take licensing names from their Style Group, not their own columns", async () => {
  const c = fakeClient({ style_groups: { licensor_name: "Marvel", property_name: "Spider-Man" }, licensor: { name: "Wrong" }, property: { name: "Wrong" } });
  const names = await resolveLicensingNames(c.client, { style_group_id: "g", licensor_id: "l", property_id: "p" });
  assert.deepEqual(names, { licensorName: "Marvel", propertyName: "Spider-Man" });
  assert.deepEqual(c.reads, ["style_groups"]);
});

test("ungrouped assets fall back to their own licensor and property", async () => {
  const c = fakeClient({ licensor: { name: "Disney" }, property: { name: "Mickey Mouse" } });
  assert.deepEqual(await resolveLicensingNames(c.client, { style_group_id: null, licensor_id: "l", property_id: "p" }), { licensorName: "Disney", propertyName: "Mickey Mouse" });
  assert.deepEqual(await resolveLicensingNames(c.client, { style_group_id: null, licensor_id: null, property_id: null }), { licensorName: null, propertyName: null });
});
