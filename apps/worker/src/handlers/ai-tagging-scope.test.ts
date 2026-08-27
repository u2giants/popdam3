import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateTagAssetData } from "./ai-tagging-shared.js";
import { writeAssetAiTags } from "./ai-tagging.js";

type FixtureAsset = { id: string; descriptor: string; legacy_tags: string[] };
type FixtureGroup = {
  id: string;
  sku: string;
  authoritative: Record<string, string>;
  assets: FixtureAsset[];
};

const fixturePath = fileURLToPath(new URL("../fixtures/ai-tagging-scope/groups.json", import.meta.url));
const groups = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureGroup[];

function typedResult(tags: string[]) {
  const padded = [...tags, "visible detail", "file-specific treatment", "composed scene", "surface detail"];
  return {
    asset_tags: [...new Set(padded)].slice(0, 18).map((tag) => ({
      tag,
      category: tag.includes("view") ? "view" : tag.match(/blue|black|green|pink|red|silver/) ? "color" : "visible_content",
      confidence: 0.9,
      evidence: [`synthetic evidence for ${tag}`],
    })),
    ai_description: "Synthetic search description for characterization only.",
    scene_description: "Synthetic literal scene description.",
    content_type: "render_mockup",
  };
}

test("scope fixtures are synthetic, diverse, and contain no external image inputs", () => {
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => group.assets.length), [3, 2, 2]);
  assert.ok(groups.every((group) => group.id.match(/^[123]0000000-/)));
  assert.ok(groups.flatMap((group) => group.assets).every((asset) => !("thumbnail_url" in asset)));
});

test("typed asset contract accepts file facts and rejects the legacy flat shape", () => {
  for (const group of groups) {
    for (const asset of group.assets) {
      const fileTags = asset.legacy_tags.filter((tag) => !Object.values(group.authoritative).map((value) => value.toLowerCase()).includes(tag));
      assert.doesNotThrow(() => validateTagAssetData(typedResult(fileTags), "typed_fixture"));
    }
  }
  assert.throws(() => validateTagAssetData({
    tags: ["backpack", "professional photography", "3/4 view", "blue", "licensed product", "mockup"],
    ai_description: "legacy",
    scene_description: "legacy",
    content_type: "product_photo",
  }, "legacy_fixture"), /asset_tags must be an array/);
});

test("production writer uses the atomic manual-wins RPC instead of direct asset_tags upsert", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return { error: null };
    },
  };
  const assetId = groups[0].assets[1].id;
  await writeAssetAiTags(client, assetId, "fixture-model", typedResult(["blue", "3/4 view", "studio scene", "visible zipper"]));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "replace_asset_ai_tag_result");
  assert.equal(calls[0].params.p_asset_id, assetId);
  assert.equal(calls[0].params.p_source, "ai");
  assert.equal(calls[0].params.p_model, "fixture-model");
  assert.deepEqual((calls[0].params.p_tags as Array<Record<string, unknown>>)[0], {
    tag: "blue",
    category: "color",
    status: "active",
    confidence: 0.9,
    evidence: ["synthetic evidence for blue"],
  });
});
