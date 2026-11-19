import { expect, it, vi } from "vitest";
import * as edge from "../../supabase/functions/_shared/canonical-item-identity.js";
import * as worker from "../../apps/worker/vendor/canonical-item-identity.js";
import { parseFailedRenderMethods } from "@/lib/render-failure-methods";
import { getOrLoadRankedIds, type RankedListCacheEntry } from "@/lib/full-text-search";

it.each([["edge", edge], ["worker", worker]] as const)(
  "preserves canonical item identity across duplicates and ambiguous matches in %s",
  (_scope, adapter) => {
    const item = { id: "a", source_system: "coldlion", item_number: "item", raw: { divisionCode: null } };
    expect(adapter.canonicalItemKey({
      source_id: item.item_number,
      division_code: null,
      source_system: item.source_system,
    })).toBe("coldlion||item");
    expect(adapter.canonicalItemMatchKey(null, "home")).toBe("home|");
    expect(adapter.uniqueCanonicalItemIds([item, item]).get("coldlion||item")).toBe("a");
    expect(adapter.uniqueCanonicalItemIds([item, { ...item, id: "b" }]).has("coldlion||item")).toBe(false);
    expect(adapter.uniqueCanonicalItemIds([item, { ...item, id: "b" }, { ...item, id: "c" }]).size).toBe(0);
    expect(adapter.uniqueCanonicalItemIds([item, { ...item, id: "b", source_system: "other" }])).toEqual(
      new Map([["coldlion||item", "a"], ["other||item", "b"]]),
    );
  },
);

it("shares ranked reads and keeps refresh and failure recovery isolated to each view", async () => {
  const assets = new Map<string, RankedListCacheEntry>();
  const groups = new Map<string, RankedListCacheEntry>();
  const inputs = ["keyword", "mug", "2026-01-01", "{}"];
  const loadAssets = vi.fn<() => Promise<string[]>>()
    .mockResolvedValueOnce(["asset"])
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValueOnce(["fresh asset"]);
  const loadGroups = vi.fn<() => Promise<string[]>>().mockResolvedValue(["group"]);
  await expect(Promise.all([
    getOrLoadRankedIds(assets, inputs, loadAssets),
    getOrLoadRankedIds(assets, inputs, loadAssets),
  ])).resolves.toEqual([["asset"], ["asset"]]);
  expect(loadAssets).toHaveBeenCalledTimes(1);
  await expect(getOrLoadRankedIds(groups, inputs, loadGroups)).resolves.toEqual(["group"]);
  assets.clear();
  await expect(getOrLoadRankedIds(assets, inputs, loadAssets)).rejects.toThrow("temporary failure");
  await expect(getOrLoadRankedIds(assets, inputs, loadAssets)).resolves.toEqual(["fresh asset"]);
  await expect(getOrLoadRankedIds(groups, inputs, loadGroups)).resolves.toEqual(["group"]);
  expect(loadGroups).toHaveBeenCalledTimes(1);
});

it.each([
  ["", []],
  [" | : detail |  ", []],
  [" ShArP: failed | GHOSTSCRIPT : blocked | New Method: unknown ", ["sharp", "ghostscript", "new method"]],
] as const)("preserves Windows and PopSG render method parsing for %j", (error, methods) => {
  expect(parseFailedRenderMethods(error)).toEqual(methods);
});
