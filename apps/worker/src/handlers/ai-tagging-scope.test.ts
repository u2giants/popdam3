import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateTagAssetData } from "./ai-tagging-shared.js";

type FixtureAsset = { id: string; descriptor: string; legacy_tags: string[] };
type FixtureGroup = {
  id: string;
  sku: string;
  authoritative: Record<string, string>;
  assets: FixtureAsset[];
};

const fixturePath = fileURLToPath(new URL("../fixtures/ai-tagging-scope/groups.json", import.meta.url));
const groups = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureGroup[];

function legacyResult(tags: string[]) {
  const padded = [...tags, "licensed product", "consumer product", "commercial artwork"];
  return {
    tags: [...new Set(padded)].slice(0, 18),
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

test("legacy flat contract accepts mixed group and file facts", () => {
  for (const group of groups) {
    for (const asset of group.assets) {
      assert.doesNotThrow(() => validateTagAssetData(legacyResult(asset.legacy_tags), "legacy_fixture"));
    }
  }

  const photo = groups[0].assets[1].legacy_tags;
  assert.ok(photo.includes("backpack"), "group product fact is stored in the same flat array");
  assert.ok(photo.includes("professional photography"), "file image type is stored in the same flat array");
});

test("legacy asset_id,tag upsert key cannot preserve manual and AI provenance together", () => {
  const manual = { asset_id: groups[0].assets[1].id, tag: "blue", source: "manual" };
  const ai = { asset_id: groups[0].assets[1].id, tag: "blue", source: "ai" };

  assert.deepEqual([manual.asset_id, manual.tag], [ai.asset_id, ai.tag]);
  assert.notEqual(manual.source, ai.source);
  // Current writers upsert AI rows on (asset_id, tag), so this collision is the
  // characterization that Step 2's atomic manual-wins contract must eliminate.
});
