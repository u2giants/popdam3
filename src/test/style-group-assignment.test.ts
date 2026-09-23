import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { assignStyleGroup, changedStyleGroupFields } from "../../supabase/functions/_shared/style-group-assignment";
import { SkuSerialQueue, skuFromRelativePath } from "../../apps/bridge-agent/src/sku-serial-queue";

function query(result: any) {
  const chain: any = {};
  for (const method of ["select", "eq", "or", "update", "upsert"]) chain[method] = (..._args: any[]) => chain;
  chain.maybeSingle = async () => result;
  chain.single = async () => result;
  Object.defineProperty(chain, "error", { get: () => result.error });
  return chain;
}

describe("style-group ingestion assignment", () => {
  it("does not rewrite an unchanged existing group or asset membership", async () => {
    const group = { id: "group-1", sku: "ABC1234", folder_path: "Decor/ABC1234", is_licensed: true };
    const groups: any[] = [];
    const assets: any[] = [];
    const db: any = { from: (table: string) => {
      const result = table === "style_groups" ? { data: group, error: null } : { data: null, error: null };
      const q = query(result);
      const originalUpdate = q.update;
      q.update = (...args: any[]) => { (table === "style_groups" ? groups : assets).push(args[0]); return originalUpdate(...args); };
      return q;
    }};
    const result = await assignStyleGroup(db, {
      assetId: "asset-1",
      sku: "ABC1234",
      groupFields: { sku: "ABC1234", folder_path: "Decor/ABC1234", is_licensed: true },
      existingGroup: group,
      currentStyleGroupId: "group-1",
    });
    expect(result).toMatchObject({ groupId: "group-1", created: false, metadataUpdated: false });
    expect(groups).toEqual([]);
    expect(assets).toEqual([]);
  });

  it("creates a new SKU once and relies on the membership trigger for cached counts", async () => {
    const calls: Array<{ table: string; method: string; value?: unknown }> = [];
    let lookup = 0;
    const db: any = { from: (table: string) => {
      const chain: any = {};
      for (const method of ["select", "eq"]) chain[method] = (..._args: any[]) => chain;
      chain.or = (value: string) => { calls.push({ table, method: "or", value }); return chain; };
      chain.upsert = (value: unknown) => { calls.push({ table, method: "upsert", value }); return chain; };
      chain.update = (value: unknown) => { calls.push({ table, method: "update", value }); return chain; };
      chain.maybeSingle = async () => ({ data: table === "style_groups" && lookup++ > 0 ? { id: "new-group" } : null, error: null });
      return chain;
    }};
    await assignStyleGroup(db, { assetId: "asset-1", sku: "NEW1234", groupFields: { sku: "NEW1234", folder_path: "Decor/NEW1234" } });
    expect(calls).toEqual([
      { table: "style_groups", method: "upsert", value: { sku: "NEW1234", folder_path: "Decor/NEW1234" } },
      { table: "assets", method: "update", value: { style_group_id: "new-group" } },
      { table: "assets", method: "or", value: "style_group_id.is.null,style_group_id.neq.new-group" },
    ]);
  });

  it("assigns an existing SKU when the current asset membership is NULL", async () => {
    const group = { id: "group-1", sku: "ABC1234" };
    let membership: string | null = null;
    const db: any = { from: (table: string) => {
      if (table === "style_groups") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: group, error: null }) }) }) };
      const chain: any = {
        update: (value: { style_group_id: string }) => { chain.nextGroupId = value.style_group_id; return chain; },
        eq: () => chain,
        or: (filter: string) => {
          if (filter === `style_group_id.is.null,style_group_id.neq.${chain.nextGroupId}` &&
              (membership === null || membership !== chain.nextGroupId)) membership = chain.nextGroupId;
          return { error: null };
        },
      };
      return chain;
    }};
    await assignStyleGroup(db, { assetId: "asset-1", sku: "ABC1234", groupFields: { sku: "ABC1234" }, existingGroup: group, currentStyleGroupId: null });
    expect(membership).toBe("group-1");
  });

  it("writes only genuinely changed metadata", () => {
    expect(changedStyleGroupFields({ sku: "ABC1234", is_licensed: true, licensor_name: null }, { sku: "ABC1234", is_licensed: false, licensor_name: undefined })).toEqual({ is_licensed: false });
  });

  it("surfaces assignment failures so the bridge retry can recover them", async () => {
    const db: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "temporary database failure" } }) }) }) }) };
    await expect(assignStyleGroup(db, { assetId: "asset-1", sku: "ABC1234", groupFields: { sku: "ABC1234" } }))
      .rejects.toThrow("style group lookup failed");
  });

  it("serializes concurrent files for one SKU but keeps different SKUs concurrent", async () => {
    const queue = new SkuSerialQueue();
    const events: string[] = [];
    let release!: () => void;
    const first = queue.run("ABC1234", async () => { events.push("first-start"); await new Promise<void>((resolve) => { release = resolve; }); events.push("first-end"); });
    const second = queue.run("ABC1234", async () => { events.push("second"); });
    const other = queue.run("XYZ1234", async () => { events.push("other"); });
    await Promise.resolve();
    expect(events).toEqual(["first-start", "other"]);
    release();
    await Promise.all([first, second, other]);
    expect(events).toEqual(["first-start", "other", "first-end", "second"]);
    expect(skuFromRelativePath("Decor/ABC1234/sub/file.psd")).toBe("ABC1234");
  });

  it("awaits assignment on new, updated, and moved ingest paths without exact count queries", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../supabase/functions/agent-api/index.ts"), "utf8");
    const ingestionSource = source.slice(source.indexOf("// ── Style group assignment helper"), source.indexOf("// ── Route: update-asset"));
    expect((ingestionSource.match(/await assignToStyleGroup\(/g) ?? [])).toHaveLength(3);
    expect(ingestionSource).not.toContain('select("*", { count: "exact", head: true })');
    expect(ingestionSource).not.toContain('update({ asset_count: memberCount })');
  });
});
