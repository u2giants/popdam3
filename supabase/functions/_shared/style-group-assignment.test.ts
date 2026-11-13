import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { assignStyleGroup, unassignStyleGroup } from "./style-group-assignment.ts";

function fixtureDb(result: { data: Array<{ id: string }> | null; error: { message: string } | null }) {
  const select = vi.fn().mockResolvedValue(result);
  const assignment = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    select,
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  };
  const from = vi.fn().mockReturnValue(assignment);
  return { db: { from }, assignment, from };
}

const base = { assetId: "asset-1", sku: "sku-1", groupFields: { sku: "sku-1" }, existingGroup: { id: "group-1", sku: "sku-1" }, currentStyleGroupId: null };

describe("opt-in style-group assignment measurement", () => {
  it("returns the exact affected row count only when requested", async () => {
    const { db, assignment } = fixtureDb({ data: [{ id: "asset-1" }], error: null });
    const observed = vi.fn();
    await assignStyleGroup(db, { ...base, onAssetUpdate: observed });
    expect(observed).toHaveBeenCalledWith(1, 1);
    expect(assignment.select).toHaveBeenCalledWith("id");
  });

  it("does not add a returning read when disabled or membership is unchanged", async () => {
    const { db, assignment } = fixtureDb({ data: [{ id: "asset-1" }], error: null });
    await assignStyleGroup(db, base);
    expect(assignment.select).not.toHaveBeenCalled();
    const observed = vi.fn();
    await assignStyleGroup(db, { ...base, currentStyleGroupId: "group-1", onAssetUpdate: observed });
    expect(observed).not.toHaveBeenCalled();
  });

  it("records zero success and preserves the existing failure", async () => {
    const { db } = fixtureDb({ data: null, error: { message: "failed" } });
    const observed = vi.fn();
    await expect(assignStyleGroup(db, { ...base, onAssetUpdate: observed }))
      .rejects.toThrow("asset style group assignment failed");
    expect(observed).toHaveBeenCalledWith(1, 0);
  });
});

function fixtureClearDb(result: { error: { message: string } | null }) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  };
  const from = vi.fn().mockReturnValue(chain);
  return { db: { from }, chain, from };
}

describe("stale style-group clearing (issue #990)", () => {
  it("clears in one guarded update that skips already-ungrouped assets", async () => {
    const { db, chain } = fixtureClearDb({ error: null });
    await unassignStyleGroup(db, "asset-1");
    expect(chain.update).toHaveBeenCalledWith({ style_group_id: null });
    expect(chain.eq).toHaveBeenCalledWith("id", "asset-1");
    expect(chain.not).toHaveBeenCalledWith("style_group_id", "is", null);
  });

  it("propagates a failed clear instead of leaving drift silent", async () => {
    const { db } = fixtureClearDb({ error: { message: "failed" } });
    await expect(unassignStyleGroup(db, "asset-1"))
      .rejects.toThrow("asset style group clear failed");
  });

  it("is wired into every path change in agent-api", () => {
    const source = readFileSync(new URL("../agent-api/index.ts", import.meta.url), "utf8");
    const assign = source.slice(
      source.indexOf("async function assignToStyleGroup("),
      source.indexOf("// ── Route: ingest"),
    );
    // No-SKU path + a held group → clear; an already-ungrouped asset is not rewritten.
    expect(assign).toMatch(/if \(!sku\) \{[\s\S]*if \(existing\?\.styleGroupId\) await unassignStyleGroup\(db, assetId\);/);

    // Move detection during ingestion passes the held group id so the clear is conditional.
    expect(source).toMatch(
      /assignToStyleGroup\(relativePath, existingByHash\.id, skuFields, reDerived, licensing, db, \{\s*styleGroupId: \(existingByHash\.style_group_id as string \| null\) \?\? null/,
    );

    // The explicit move-asset route reconciles the group to the new path too.
    const moveRoute = source.slice(
      source.indexOf("async function handleMoveAsset("),
      source.indexOf("// ── Route: scan-progress"),
    );
    expect(moveRoute).toContain('select("relative_path, filename, style_group_id")');
    expect(moveRoute).toMatch(/assignToStyleGroup\(newRelativePath, assetId, buildSkuFields\(parsed, licensing\)/);
  });
});
