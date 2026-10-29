import test from "node:test";
import assert from "node:assert/strict";
import { resolveCharacterScope, skuLicensorCode } from "./ai-tagging-shared.js";

const passthrough = <T>(query: PromiseLike<T>) => Promise.resolve(query);
const noop = () => {};

function fakeClient(group: Record<string, unknown> | null, licensors: { id: string; code: string }[]) {
  const table = (name: string) => {
    let code: unknown;
    const chain = {
      select: () => chain,
      eq: (_column: string, value: unknown) => { code = value; return chain; },
      maybeSingle: async () => ({ data: name === "style_groups" ? group : null, error: null }),
      limit: async () => ({ data: licensors.filter(l => l.code === code), error: null }),
    };
    return chain;
  };
  return { from: table, schema: () => ({ from: table }) } as never;
}

test("skuLicensorCode reads the licensor code from characters 6-7", () => {
  assert.equal(skuLicensorCode("HXPS2MVDP01"), "MV");
  assert.equal(skuLicensorCode("VS162PNUT01"), "PN");
  assert.equal(skuLicensorCode("abc"), null);
  assert.equal(skuLicensorCode(null), null);
});

test("grouped assets scope characters by their Style Group licensing", async () => {
  const scope = await resolveCharacterScope(fakeClient({ sku: "X", licensor_id: "gl", property_id: "gp", is_licensed: true }, []),
    { style_group_id: "g", licensor_id: "al", property_id: "ap", sku: null }, passthrough, noop);
  assert.deepEqual(scope, { licensor_id: "gl", property_id: "gp", unlicensed: false });
});

test("unlicensed Style Groups get no character catalog", async () => {
  const scope = await resolveCharacterScope(fakeClient({ sku: "VDE83HDFAN01", licensor_id: null, property_id: null, is_licensed: false }, []),
    { style_group_id: "g", licensor_id: null, property_id: null, sku: null }, passthrough, noop);
  assert.equal(scope.unlicensed, true);
});

test("without licensing ids the SKU licensor code scopes characters, never the global list", async () => {
  const scope = await resolveCharacterScope(fakeClient({ sku: "VS162PNUT01", licensor_id: null, property_id: null, is_licensed: true }, [{ id: "peanuts", code: "PN" }]),
    { style_group_id: "g", licensor_id: null, property_id: null, sku: null }, passthrough, noop);
  assert.deepEqual(scope, { licensor_id: "peanuts", property_id: null, unlicensed: false });
});
