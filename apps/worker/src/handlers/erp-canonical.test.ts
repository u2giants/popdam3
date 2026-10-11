import test from "node:test";
import assert from "node:assert/strict";
import type { DB } from "../supabase.js";
import { buildErpLogEntries, handleApplyErpEnrichment, latestPredictionByItem, planErpItemUpdate } from "./erp.js";

type State = {
  predictionFilters: unknown[][];
  writes: number;
  calls: string[];
  failOn?: string;
  logged: unknown[];
};

function fakeClient(state: State) {
  const from = (table: string) => {
    let selectedIds: unknown[] = [];
    let single = false;
    let op = "select";
    const q: any = new Proxy({}, {
      get: (_, method) => {
        if (method === "then") {
          return (resolve: (value: unknown) => unknown, reject?: (e: unknown) => unknown) => {
            state.calls.push(`${op}:${table}`);
            if (state.failOn === `${op}:${table}`) {
              return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
            }
            const data = table === "api.plm_item_list"
              ? [{ id: "legacy-sp", source_system: "coldlion", division_code: "SP001", source_id: "SAME", style_number: "SAME", mg_category: null, mg01_code: "M1" }]
              : table === "api.pim_item_picker"
                ? [{ item_id: "canonical-sp", source_system: "coldlion", item_number: "SAME", division_code: "SP001" }]
                : table === "product_category_predictions" && selectedIds.includes("canonical-sp")
                  ? [{ plm_item_id: "canonical-sp", predicted_category: "Tabletop", status: "approved", confidence: 0.9 }]
                  : table === "assets" && op === "select"
                    ? [{ id: "a1", sku: "SAME", division_code: "SP001", mg01_code: null, product_category: "Wall" }]
                    : table === "assets" && op === "update"
                      ? [{ id: "a1" }]
                      : [];
            return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve, reject);
          };
        }
        return (...args: unknown[]) => {
          if ((method === "eq" || method === "in") && table === "product_category_predictions") {
            state.predictionFilters.push([method, ...args]);
            if (args[0] === "plm_item_id") selectedIds = Array.isArray(args[1]) ? args[1] : [args[1]];
          }
          if (method === "maybeSingle" || method === "single") single = true;
          if (method === "insert" || method === "update" || method === "upsert") {
            state.writes++;
            op = method as string;
            if (method === "insert" && table === "erp_enrichment_log") state.logged.push(...(args[0] as unknown[]));
          }
          return q;
        };
      },
    });
    return q;
  };
  return { from, schema: (schema: string) => ({ from: (table: string) => from(`${schema}.${table}`) }) } as unknown as DB;
}

const newState = (failOn?: string): State => ({ predictionFilters: [], writes: 0, calls: [], failOn, logged: [] });

test("the worker dry run loads predictions by canonical UUID in one batched read", async () => {
  const state = newState();
  const result = await handleApplyErpEnrichment({ status: "running", params: { mode: "dry-run" } }, fakeClient(state));
  assert.equal(result.ok, true);
  assert.equal(result.total, 1);
  assert.deepEqual(state.predictionFilters, [["in", "plm_item_id", ["canonical-sp"]]]);
  assert.equal(state.writes, 0);
});

test("apply batches reads and writes the audit log once per page", async () => {
  const state = newState();
  const result = await handleApplyErpEnrichment({ status: "running", params: {} }, fakeClient(state));
  assert.equal(result.ok, true);
  assert.equal(result.assets_updated, 1);
  assert.equal(state.calls.filter((c) => c === "select:product_category_predictions").length, 1);
  assert.equal(state.calls.filter((c) => c === "select:assets").length, 1);
  assert.equal(state.calls.filter((c) => c === "select:style_groups").length, 1);
  assert.equal(state.calls.filter((c) => c === "insert:erp_enrichment_log").length, 1);
  const fields = (state.logged as Array<{ field_name: string; target_id: string }>).map((e) => e.field_name).sort();
  assert.deepEqual(fields, ["mg01_code", "product_category"]);
});

for (const failOn of [
  "select:product_category_predictions",
  "select:assets",
  "select:style_groups",
  "update:assets",
  "update:style_groups",
  "insert:erp_enrichment_log",
]) {
  test(`apply surfaces a ${failOn} error and does not advance the cursor`, async () => {
    const result = await handleApplyErpEnrichment({ status: "running", params: {} }, fakeClient(newState(failOn)));
    assert.equal(result.ok, false);
    assert.equal(result.nextOffset, undefined);
    assert.match(String(result.error), /boom/);
  });
}

test("latestPredictionByItem keeps the first (newest) row per item", () => {
  const map = latestPredictionByItem([
    { plm_item_id: "x", predicted_category: "Wall", confidence: 1, classification_source: "ai", status: "approved" },
    { plm_item_id: "x", predicted_category: "Clock", confidence: 1, classification_source: "ai", status: "approved" },
    { plm_item_id: null, predicted_category: "Clock", confidence: 1, classification_source: "ai", status: "approved" },
  ]);
  assert.equal(map.size, 1);
  assert.equal(map.get("x")?.predicted_category, "Wall");
});

test("planErpItemUpdate prefers reliable mg_category and ignores pending predictions", () => {
  const base = {
    id: "1", source_id: "S", source_system: "coldlion", style_number: "S", item_description: null,
    mg_category: null, mg01_code: null, mg02_code: null, mg03_code: null, size_code: null,
    licensor_code: null, property_code: null, division_code: null, erp_updated_at: null,
  };
  assert.equal(planErpItemUpdate(base, { plm_item_id: "1", predicted_category: "Wall", confidence: 0.4, classification_source: "ai", status: "pending" }), null);
  const reliable = planErpItemUpdate({ ...base, mg_category: "Clock", erp_updated_at: "2025-06-01" }, { plm_item_id: "1", predicted_category: "Wall", confidence: 1, classification_source: "ai", status: "approved" });
  assert.equal(reliable?.updates.product_category, "Clock");
  assert.equal(reliable?.classificationSource, "erp");
  const plan = planErpItemUpdate({ ...base, mg01_code: "M" }, undefined)!;
  const entries = buildErpLogEntries(plan, { mg01_code: "M" }, { type: "asset", id: "a" }, "r");
  assert.equal(entries.length, 0);
});
