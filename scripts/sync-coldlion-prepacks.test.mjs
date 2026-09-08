import assert from "node:assert/strict";
import test from "node:test";
import {
  collectItemDetails,
  collectItems,
  probePrepackDetails,
  projectMerchGroups,
  projectRecord,
} from "./sync-coldlion-prepacks.mjs";

const response = (value) => ({ ok: true, json: async () => value });

test("collectItems proves the terminal page", async () => {
  const pages = [
    { content: [{ itemNo: "A" }], last: false },
    { content: [{ itemNo: "B" }], last: true },
  ];
  const result = await collectItems("secret", async () => response(pages.shift()));
  assert.deepEqual(result, { rows: [{ itemNo: "A" }, { itemNo: "B" }], pagesFetched: 2 });
});

test("itemDetails refuses a page envelope", async () => {
  await assert.rejects(collectItemDetails("secret", async () => response({ content: [] })), /bare array/);
});

test("projection preserves the exact four-part identity and prepack", () => {
  const row = projectRecord({ companyCode: "EDGEHOME", divisionCode: "CW001", itemNo: "A", itemPkey: "K", prePackCode: "PPK1", mGCategory: "X", merchGroup05: "WB" }, "run", "2026-09-08T00:00:00Z");
  assert.equal(row.item_pkey, "K");
  assert.equal(row.pre_pack_code, "PPK1");
  assert.equal(row.mg_category, "X");
  assert.equal(row.merch_group05, undefined);
  assert.match(row.source_hash, /^[0-9a-f]{64}$/);
});

test("merch groups omit cleared slots and retain detail scope", () => {
  const rows = projectMerchGroups({ companyCode: "EDGEHOME", divisionCode: "CW001", itemNo: "A", merchGroup05: "WB", merchGroup05Desc: "Warner", merchGroup06: "" }, "run", "2026-09-08T00:00:00Z", "K");
  assert.equal(rows.length, 1);
  assert.deepEqual({ slot: rows[0].slot_no, code: rows[0].mg_code, itemPkey: rows[0].item_pkey }, { slot: 5, code: "WB", itemPkey: "K" });
});

test("prepack probe records aggregate counts without retaining licensed rows", async () => {
  const result = await probePrepackDetails(["PPK1", "PPK2"], "secret", async (url) => response(url.toString().includes("PPK1") ? [{ itemNo: "A" }] : []));
  assert.equal(result.codesProbed, 2);
  assert.equal(result.rowsFetched, 1);
  assert.equal(result.emptyCodes, 1);
  assert.match(result.sourceHash, /^[0-9a-f]{64}$/);
});
