import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { primaryAssetCacheFields, selectPrimaryAsset } from "./style-grouping.ts";

const rendered = {
  id: "rendered",
  filename: "art.ai",
  relative_path: "group/art.ai",
  file_type: "ai",
  asset_type: "artwork",
  created_at: "2026-01-01T00:00:00Z",
  thumbnail_url: "https://example.invalid/art.jpg",
  thumbnail_error: null,
};
const cover = {
  ...rendered,
  id: "cover",
  filename: "comp-view.png",
  file_type: "png",
  asset_type: "image",
  thumbnail_url: "https://example.invalid/cover.jpg",
};

describe("render completion primary thumbnail cache", () => {
  it("writes the complete selected-primary cache in the actual completion route", () => {
    const source = readFileSync(new URL("../agent-api/index.ts", import.meta.url), "utf8");
    const route = source.slice(source.indexOf("async function handleCompleteRender("), source.indexOf("// ── Route: trigger-scan"));
    expect(route).toContain('if (!primaryAsset) return err("Selected primary asset not found", 500)');
    expect(route).toMatch(/\.from\("style_groups"\)\s*\.update\(primaryAssetCacheFields\(primaryAsset\)\)/);
  });
  it("switches identity and both cached fields to the selected primary, not the rendered asset", () => {
    const assets = [rendered, cover];
    const primaryId = selectPrimaryAsset(assets);
    expect(primaryId).toBe(cover.id);
    const selected = assets.find((asset) => asset.id === primaryId)!;
    const group = { ...primaryAssetCacheFields(rendered), primary_thumbnail_error: "old failure" };
    Object.assign(group, primaryAssetCacheFields(selected));
    expect(group).toEqual({
      primary_asset_id: cover.id,
      primary_asset_type: cover.asset_type,
      primary_thumbnail_url: cover.thumbnail_url,
      primary_thumbnail_error: null,
    });
  });

  it("clears an old thumbnail and preserves the selected asset's failure", () => {
    const selected = { ...cover, thumbnail_url: null, thumbnail_error: "no_preview" };
    const group = primaryAssetCacheFields(rendered);
    Object.assign(group, primaryAssetCacheFields(selected));
    expect(group.primary_thumbnail_url).toBeNull();
    expect(group.primary_thumbnail_error).toBe("no_preview");
  });

  it("clears both cache fields when the selected asset has neither", () => {
    const fields = primaryAssetCacheFields({ ...cover, thumbnail_url: null, thumbnail_error: null });
    expect(fields.primary_thumbnail_url).toBeNull();
    expect(fields.primary_thumbnail_error).toBeNull();
  });
});
