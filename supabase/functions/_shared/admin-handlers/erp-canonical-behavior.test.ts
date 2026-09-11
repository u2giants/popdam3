import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, any>[]>,
  calls: [] as Array<{ table: string; column: string; value: unknown }>,
  rpc: vi.fn(),
}));

vi.mock("../http.ts", () => ({
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  err: (error: string, status = 400) => new Response(JSON.stringify({ error }), { status }),
}));
vi.mock("../service-client.ts", () => {
  function from(table: string) {
    let rows = [...(fixture.tables[table] ?? [])];
    let single = false;
    const query: any = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        fixture.calls.push({ table, column, value });
        rows = rows.filter(row => row[column] === value); return query;
      },
      in: (column: string, values: unknown[]) => {
        fixture.calls.push({ table, column, value: values });
        rows = rows.filter(row => values.includes(row[column])); return query;
      },
      not: (column: string, _operator: string, value: unknown) => { rows = rows.filter(row => row[column] !== value); return query; },
      neq: (column: string, value: unknown) => { rows = rows.filter(row => row[column] !== value); return query; },
      lt: () => query,
      order: () => query,
      range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return query; },
      limit: (count: number) => { rows = rows.slice(0, count); return query; },
      maybeSingle: () => { single = true; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: single ? rows[0] ?? null : rows, count: rows.length, error: null }).then(resolve),
    };
    return query;
  }
  return { serviceClient: () => ({ from, schema: (schema: string) => ({ from: (table: string) => from(`${schema}.${table}`) }), rpc: fixture.rpc }) };
});

import { handleApplyErpEnrichment } from "./erp-handlers.ts";
import { handleErpItemsBrowse, handleErpItemsDismiss, handleErpReviewQueue } from "./erp-browse-handlers.ts";

beforeEach(() => {
  fixture.calls.length = 0;
  fixture.rpc.mockReset();
  fixture.tables = {
    "api.plm_item_list": [
      { id: "canonical-cw", source_id: "SAME", source_system: "coldlion", division_code: "CW001", style_number: "SAME", item_description: "CW description", mg_category: null },
      { id: "canonical-sp", source_id: "SAME", source_system: "coldlion", division_code: "SP001", style_number: "SAME", item_description: "SP description", mg_category: null },
    ],
    assets: [{ id: "asset-cw", sku: "SAME", division_code: "CW001", is_deleted: false }],
    style_groups: [],
    product_category_predictions: [
      { id: "prediction-cw", plm_item_id: "canonical-cw", erp_item_id: "legacy-cw", external_id: "SAME", predicted_category: "Wall", status: "approved" },
      { id: "prediction-sp", plm_item_id: "canonical-sp", erp_item_id: "legacy-sp", external_id: "SAME", predicted_category: "Tabletop", status: "approved" },
      { id: "unresolved", plm_item_id: null, external_id: "SAME", predicted_category: "Other", status: "pending", item_identity_status: "unresolved" },
    ],
  };
});

describe("canonical ERP handler behavior", () => {
  it("uses the migrated prediction identity for enrichment and keeps divisions separate", async () => {
    const body = await (await handleApplyErpEnrichment({ mode: "dry-run" })).json();
    expect(body.sample_updates).toHaveLength(1);
    expect(body.sample_updates[0]).toMatchObject({ predicted_category: "Wall", matching_asset_count: 1 });
    expect(fixture.calls).toContainEqual({ table: "product_category_predictions", column: "plm_item_id", value: "canonical-cw" });
  });

  it("keeps unresolved history visible without borrowing another division's description", async () => {
    const body = await (await handleErpReviewQueue({ status: "all" })).json();
    expect(body.items.find((row: any) => row.id === "prediction-cw").description).toBe("CW description");
    expect(body.items.find((row: any) => row.id === "prediction-sp").description).toBe("SP description");
    expect(body.items.find((row: any) => row.id === "unresolved")).toMatchObject({ description: null, external_id: "SAME" });
  });

  it("sends dismiss and restore through the ordinary canonical RPC", async () => {
    fixture.rpc.mockResolvedValue({ data: 1, error: null });
    for (const dismiss of [true, false]) {
      const body = await (await handleErpItemsDismiss({ ids: ["coldlion|CW001|SAME"], dismiss })).json();
      expect(body).toEqual({ ok: true, updated: 1, dismissed: dismiss });
      expect(fixture.rpc).toHaveBeenLastCalledWith("set_popdam_item_dismissed", { item_keys: ["coldlion|CW001|SAME"], dismissed: dismiss });
    }
  });

  it("rejects old row IDs and reports a denied dismissal without claiming success", async () => {
    expect((await handleErpItemsDismiss({ ids: ["legacy-cw"] })).status).toBe(400);
    expect(fixture.rpc).not.toHaveBeenCalled();
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    expect((await handleErpItemsDismiss({ ids: ["coldlion|CW001|SAME"] })).status).toBe(500);
  });

  it("binds the actual browse queries to canonical prediction IDs and honors show-dismissed", async () => {
    fixture.rpc.mockResolvedValue({ data: [], error: null });
    await handleErpItemsBrowse({ show_dismissed: false });
    for (const [, params] of fixture.rpc.mock.calls) {
      expect(params.query_text).toContain("candidate.plm_item_id = e.id");
      expect(params.query_text).toContain("e.dismissed = false");
    }
    fixture.rpc.mockClear();
    await handleErpItemsBrowse({ show_dismissed: true });
    for (const [, params] of fixture.rpc.mock.calls) expect(params.query_text).not.toContain("e.dismissed = false");
  });
});
