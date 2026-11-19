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
        rows = rows.filter((row) => row[column] === value);
        return query;
      },
      is: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return query;
      },
      in: (column: string, values: unknown[]) => {
        fixture.calls.push({ table, column, value: values });
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      },
      not: (column: string, _operator: string, value: unknown) => {
        rows = rows.filter((row) => row[column] !== value);
        return query;
      },
      neq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] !== value);
        return query;
      },
      lt: () => query,
      order: () => query,
      range: (from: number, to: number) => {
        rows = rows.slice(from, to + 1);
        return query;
      },
      limit: (count: number) => {
        rows = rows.slice(0, count);
        return query;
      },
      maybeSingle: () => {
        single = true;
        return query;
      },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: single ? rows[0] ?? null : rows, count: rows.length, error: null }).then(resolve),
    };
    return query;
  }
  return { serviceClient: () => ({ from, schema: (schema: string) => ({ from: (table: string) => from(`${schema}.${table}`) }), rpc: fixture.rpc }) };
});

import { handleApplyErpEnrichment } from "./erp-handlers.ts";
import { handleErpItemsBrowse, handleErpItemsDismiss, handleErpReviewQueue, skuFromExternalId } from "./erp-browse-handlers.ts";

beforeEach(() => {
  fixture.calls.length = 0;
  fixture.rpc.mockReset();
  // plm is not REST-exposed; handlers read plm.item via execute_readonly_query.
  fixture.rpc.mockImplementation(async (fn: string, params: { query_text?: string }) => {
    const sql = params?.query_text ?? "";
    if (fn !== "execute_readonly_query" || !sql.includes("FROM plm.item")) return { data: [], error: null };
    if (sql.includes("LIMIT 300")) {
      const rows = fixture.tables["api.plm_item_list"]
        .filter((row) => row.source_system === "coldlion" && row.style_number != null && row.style_number !== "")
        .sort((a, b) => {
          if (a.mg_category === null && b.mg_category !== null) return 1;
          if (b.mg_category === null && a.mg_category !== null) return -1;
          return (a.mg_category ?? "").localeCompare(b.mg_category ?? "") || a.source_id.localeCompare(b.source_id);
        });
      return { data: rows.slice(0, 300), error: null };
    }
    const inList = sql.match(/IN \(([^)]*)\)/)?.[1] ?? "";
    const values = [...inList.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    const byId = /WHERE id IN/.test(sql);
    const rows = (fixture.tables["plm.item"] ?? []).filter((row) => values.includes(byId ? row.id : row.item_number));
    return { data: rows, error: null };
  });
  fixture.tables = {
    "api.plm_item_list": [
      {
        id: "legacy-cw",
        source_id: "SAME",
        source_system: "coldlion",
        division_code: "CW001",
        style_number: "SAME",
        item_description: "CW description",
        mg_category: null,
      },
      {
        id: "00000000-0000-4000-8000-0000000000c2",
        source_id: "SAME",
        source_system: "coldlion",
        division_code: "SP001",
        style_number: "SAME",
        item_description: "SP description",
        mg_category: null,
      },
    ],
    "plm.item": [
      {
        id: "00000000-0000-4000-8000-0000000000c1",
        source_system: "coldlion",
        item_number: "SAME",
        description: "CW description",
        raw: { divisionCode: "CW001" },
      },
      {
        id: "00000000-0000-4000-8000-0000000000c2",
        source_system: "coldlion",
        item_number: "SAME",
        description: "SP description",
        raw: { divisionCode: "SP001" },
      },
    ],
    assets: [{ id: "asset-cw", sku: "SAME", division_code: "CW001", is_deleted: false }],
    style_groups: [],
    product_category_predictions: [
      {
        id: "prediction-cw",
        plm_item_id: "00000000-0000-4000-8000-0000000000c1",
        erp_item_id: "legacy-cw",
        external_id: "SAME",
        predicted_category: "Wall",
        status: "approved",
      },
      {
        id: "prediction-sp",
        plm_item_id: "00000000-0000-4000-8000-0000000000c2",
        erp_item_id: "legacy-sp",
        external_id: "SAME",
        predicted_category: "Tabletop",
        status: "approved",
      },
      { id: "unresolved", plm_item_id: null, external_id: "SAME", predicted_category: "Other", status: "pending", item_identity_status: "unresolved" },
    ],
  };
});

describe("canonical ERP handler behavior", () => {
  it("shortlists the first 300 ColdLion rows by category (nulls last) and source ID before matching assets", async () => {
    fixture.tables["api.plm_item_list"] = [
      { source_id: "A-NULL", style_number: "A-NULL", source_system: "coldlion", mg_category: null },
      { source_id: "A-FOREIGN", style_number: "A-FOREIGN", source_system: "other", mg_category: "A" },
      { source_id: "", style_number: "", source_system: "coldlion", mg_category: "A" },
      { source_id: null, style_number: null, source_system: "coldlion", mg_category: "A" },
      ...Array.from({ length: 300 }, (_, index) => {
        const sku = "SKU-" + String(300 - index).padStart(3, "0");
        return { source_id: sku, style_number: sku, source_system: "coldlion", mg_category: "B" };
      }),
      { source_id: "Z-EARLY", style_number: "Z-EARLY", source_system: "coldlion", mg_category: "A" },
    ];
    fixture.tables.assets = [
      { sku: "Z-EARLY", division_code: null, is_deleted: false },
      { sku: "SKU-299", division_code: null, is_deleted: false },
      { sku: "SKU-300", division_code: null, is_deleted: false },
      { sku: "A-NULL", division_code: null, is_deleted: false },
    ];
    fixture.tables["plm.item"] = fixture.tables.assets.map(({ sku }) => ({
      id: sku, source_system: "coldlion", item_number: sku, raw: {},
    }));

    const response = await handleApplyErpEnrichment({ mode: "dry-run" });
    expect(response.status).toBe(200);
    expect(fixture.rpc).toHaveBeenNthCalledWith(1, "execute_readonly_query", {
      query_text: expect.stringMatching(
        /FROM plm\.item\s+WHERE source_system = 'coldlion' AND item_number IS NOT NULL AND item_number <> ''\s+ORDER BY mg_category ASC NULLS LAST, item_number ASC\s+LIMIT 300/,
      ),
    });
    const body = await response.json();
    expect(body.assets_to_update).toBe(2);
    expect(body.sample_updates.map((row: any) => row.sku)).toEqual(["Z-EARLY", "SKU-299"]);
  });

  it("returns a sanitized error when the candidate query fails before any matching", async () => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "SQL with internal details" } });
    const response = await handleApplyErpEnrichment({ mode: "dry-run" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not load ERP preview candidates" });
    expect(fixture.calls).toEqual([]);
  });

  it("returns a sanitized error when canonical identity resolution fails", async () => {
    fixture.rpc.mockImplementationOnce(async () => ({ data: fixture.tables["api.plm_item_list"], error: null }));
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "SQL with internal details" } });
    const response = await handleApplyErpEnrichment({ mode: "dry-run" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not resolve ERP preview item identities" });
  });

  it("uses the migrated prediction identity for enrichment and keeps divisions separate", async () => {
    const body = await (await handleApplyErpEnrichment({ mode: "dry-run" })).json();
    expect(body.sample_updates).toHaveLength(1);
    expect(body.sample_updates[0]).toMatchObject({ predicted_category: "Wall", matching_asset_count: 1 });
    expect(fixture.calls).toContainEqual({ table: "product_category_predictions", column: "plm_item_id", value: "00000000-0000-4000-8000-0000000000c1" });
  });

  it("dry-run totals count only the matched division, as the worker updates by SKU and division", async () => {
    fixture.tables.assets.push({ id: "asset-other-division", sku: "SAME", division_code: "ZZ001", is_deleted: false });
    const body = await (await handleApplyErpEnrichment({ mode: "dry-run" })).json();
    expect(body.assets_to_update).toBe(1);
  });

  it("dry-run skips ambiguous same-division duplicates, matching the worker apply", async () => {
    fixture.tables["plm.item"].push({
      id: "canonical-cw-other-company",
      source_system: "coldlion",
      item_number: "SAME",
      description: "Other company",
      raw: { divisionCode: "CW001" },
    }, {
      id: "canonical-cw-third-company",
      source_system: "coldlion",
      item_number: "SAME",
      raw: { divisionCode: "CW001" },
    });
    const body = await (await handleApplyErpEnrichment({ mode: "dry-run" })).json();
    expect(body.sample_updates ?? []).toHaveLength(0);
    expect(fixture.calls.filter((c) => c.table === "product_category_predictions")).toHaveLength(0);
  });

  it("shows the SKU, not the whole canonical identity, for unresolved new predictions", async () => {
    fixture.tables.product_category_predictions.push({
      id: "unresolved-canonical",
      plm_item_id: null,
      external_id: "coldlion|CW001|NEWSKU",
      predicted_category: "Other",
      status: "pending",
    });
    const body = await (await handleErpReviewQueue({ status: "all" })).json();
    expect(body.items.find((row: any) => row.id === "unresolved-canonical").style_number).toBe("NEWSKU");
    expect(body.items.find((row: any) => row.id === "unresolved").style_number).toBe("SAME");
    expect(skuFromExternalId("coldlion||A|B")).toBe("A|B");
  });

  it("draws a random 10 from existing AI predictions without changing their status", async () => {
    const sample = Array.from({ length: 10 }, (_, i) => ({ id: `sample-${i}`, external_id: `SKU-${i}`, status: "auto_applied", classification_source: "ai" }));
    fixture.rpc.mockResolvedValueOnce({ data: sample, error: null });
    const body = await (await handleErpReviewQueue({ status: "sample", page: 99 })).json();
    expect(fixture.rpc).toHaveBeenCalledWith("execute_readonly_query", {
      query_text: expect.stringMatching(
        /WHERE classification_source = 'ai' AND status IN \('pending', 'auto_applied', 'approved'\)\s+ORDER BY random\(\) LIMIT 10/,
      ),
    });
    expect(body.items).toHaveLength(10);
    expect(body.items.every((item: any) => item.status === "auto_applied")).toBe(true);
    expect(body).toMatchObject({ total: 10, page: 1, page_size: 10, total_pages: 1 });
  });

  it("surfaces a sampling failure instead of showing an empty review sample", async () => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { message: "Sampling unavailable" } });
    const response = await handleErpReviewQueue({ status: "sample" });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Sampling unavailable" });
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
      expect(params.query_text).toContain("candidate.plm_item_id = canonical_item.id");
      expect(params.query_text).toContain("HAVING count(*) = 1");
      expect(params.query_text).not.toContain("LEFT JOIN plm.item canonical_item");
      expect(params.query_text).toContain("e.dismissed = false");
    }
    fixture.rpc.mockClear();
    await handleErpItemsBrowse({ show_dismissed: true });
    for (const [, params] of fixture.rpc.mock.calls) expect(params.query_text).not.toContain("e.dismissed = false");
  });
});
