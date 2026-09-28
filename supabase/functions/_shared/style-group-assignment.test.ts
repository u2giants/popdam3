import { describe, expect, it, vi } from "vitest";
import { assignStyleGroup } from "./style-group-assignment.ts";

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
