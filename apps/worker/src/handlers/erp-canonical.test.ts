import test from "node:test";
import assert from "node:assert/strict";
import type { DB } from "../supabase.js";
import { handleApplyErpEnrichment } from "./erp.js";

function fakeClient(state: { predictionFilters: unknown[][]; writes: number }) {
  const from = (table: string) => {
    let selectedId: unknown;
    let single = false;
    const q: any = new Proxy({}, {
      get: (_, method) => {
        if (method === "then") {
          return (resolve: (value: unknown) => unknown, reject?: (e: unknown) => unknown) => {
            const data = table === "api.plm_item_list"
              ? [{ id: "legacy-sp", source_system: "coldlion", division_code: "SP001", source_id: "SAME", style_number: "SAME", mg_category: null }]
              : table === "api.pim_item_picker"
                ? [{ item_id: "canonical-sp", source_system: "coldlion", item_number: "SAME", division_code: "SP001" }]
                : table === "product_category_predictions" && selectedId === "canonical-sp"
                  ? [{ predicted_category: "Tabletop", status: "approved", confidence: 0.9 }]
                  : [];
            return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve, reject);
          };
        }
        return (...args: unknown[]) => {
          if (method === "eq" && table === "product_category_predictions") {
            state.predictionFilters.push(args);
            if (args[0] === "plm_item_id") selectedId = args[1];
          }
          if (method === "maybeSingle" || method === "single") single = true;
          if (method === "insert" || method === "update" || method === "upsert") state.writes++;
          return q;
        };
      },
    });
    return q;
  };
  return { from, schema: (schema: string) => ({ from: (table: string) => from(`${schema}.${table}`) }) } as unknown as DB;
}

test("the worker dry run loads predictions by canonical UUID, never by a shared item number", async () => {
  const state = { predictionFilters: [] as unknown[][], writes: 0 };
  const result = await handleApplyErpEnrichment({ status: "running", params: { mode: "dry-run" } }, fakeClient(state));
  assert.equal(result.ok, true);
  assert.equal(result.total, 1);
  assert.deepEqual(state.predictionFilters, [["plm_item_id", "canonical-sp"]]);
  assert.equal(state.writes, 0);
});
