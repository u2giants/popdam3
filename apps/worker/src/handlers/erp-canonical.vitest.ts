import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ predictionFilters: [] as unknown[][], writes: 0 }));
vi.mock("../config.js", () => ({ config: {} }));
vi.mock("../supabase.js", () => ({
  db: () => {
    const from = (table: string) => {
      let selectedId: unknown;
      let single = false;
      const q: any = new Proxy({}, { get: (_, method) => {
        if (method === "then") return (resolve: (value: unknown) => unknown) => {
          const data = table === "api.plm_item_list"
            ? [{ id: "legacy-sp", source_system: "coldlion", division_code: "SP001", source_id: "SAME", style_number: "SAME", mg_category: null }]
            : table === "plm.item"
              ? [{ id: "canonical-sp", source_system: "coldlion", item_number: "SAME", raw: { divisionCode: "SP001" } }]
            : table === "product_category_predictions" && selectedId === "canonical-sp"
              ? [{ predicted_category: "Tabletop", status: "approved", confidence: 0.9 }]
              : [];
          return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve);
        };
        return (...args: unknown[]) => {
          if (method === "eq" && table === "product_category_predictions") {
            state.predictionFilters.push(args);
            if (args[0] === "plm_item_id") selectedId = args[1];
          }
          if (method === "maybeSingle") single = true;
          if (method === "insert" || method === "update") state.writes++;
          return q;
        };
      } });
      return q;
    };
    return { from, schema: (schema: string) => ({ from: (table: string) => from(`${schema}.${table}`) }) };
  },
}));

import { handleApplyErpEnrichment } from "./erp.js";

it("the actual worker dry run loads predictions by canonical UUID, never by a shared item number", async () => {
  const result = await handleApplyErpEnrichment({ status: "running", params: { mode: "dry-run" } });
  expect(result).toMatchObject({ ok: true, done: true, total: 1 });
  expect(state.predictionFilters).toEqual([["plm_item_id", "canonical-sp"]]);
  expect(state.writes).toBe(0);
});
