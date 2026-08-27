import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateTagAssetData } from "./ai-tagging-shared.js";
import {
  applyBatchTagResult,
  assetTagsForRpc,
  isModelSpecificError,
  writeAssetAiTags,
} from "./ai-tagging.js";
import { ASSET_TAG_CATEGORIES, GROUP_TAG_CATEGORIES } from "../tagging-metadata-policy.js";
import { liveFunctionBody } from "./live-migration-contract.js";

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

// ── Step 5: asset-only scope, shared writers, sibling isolation ──────────────

// Resolved from the NEWEST migration that redefines each function. Pinning one
// hard-coded file would silently pass forever once a later migration supersedes
// it — which is exactly what happened before: 20260825165139 replaced the asset
// writer and dropped the model terms these tests used to assert.
const assetWriter = liveFunctionBody("replace_asset_ai_tag_result");
const tagsArraySync = liveFunctionBody("sync_asset_tags_to_array");
const handlerSource = readFileSync(fileURLToPath(new URL("./ai-tagging.ts", import.meta.url)), "utf8");

/** A supabase-shaped double that records every table and RPC touch. */
function recordingSupabase() {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const tableCalls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const asset = { id: "", filename: "photo.jpg", file_type: "jpg", sku: null };
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return { error: null };
    },
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { ...asset }, error: null }),
        update: (payload: unknown) => {
          tableCalls.push({ table, op: "update", payload });
          return chain;
        },
        upsert: async (payload: unknown) => {
          tableCalls.push({ table, op: "upsert", payload });
          return { error: null };
        },
        then: undefined,
      } as Record<string, unknown>;
      // `update(...).eq(...)` is awaited, so eq must resolve for updates.
      chain.eq = () => ({ ...chain, then: (resolve: (v: unknown) => void) => resolve({ error: null }) });
      return chain;
    },
  };
  return { client, rpcCalls, tableCalls };
}

test("the durable-batch writer uses the same atomic asset-only contract as the normal path", async () => {
  const { client, rpcCalls, tableCalls } = recordingSupabase();
  const assetId = groups[0].assets[1].id;
  await applyBatchTagResult(assetId, typedResult(["blue", "3/4 view", "studio scene", "visible zipper"]), "fixture-model", client as never);

  const tagWrites = rpcCalls.filter((call) => call.name === "replace_asset_ai_tag_result");
  assert.equal(tagWrites.length, 1, "the batch path writes tags through the RPC, not a direct upsert");
  assert.equal(tagWrites[0].params.p_asset_id, assetId);
  assert.equal(tagWrites[0].params.p_source, "ai");
  assert.equal(tagWrites[0].params.p_model, "fixture-model");
  assert.ok(!tableCalls.some((call) => call.table === "asset_tags"), "asset_tags is never written directly");
});

test("neither writer accepts a Style Group category on an asset", () => {
  for (const category of GROUP_TAG_CATEGORIES.filter((value) => !ASSET_TAG_CATEGORIES.includes(value))) {
    assert.throws(() => validateTagAssetData({
      asset_tags: [
        { tag: "floral", category, confidence: 0.9, evidence: ["synthetic"] },
        { tag: "front view", category: "view", confidence: 0.9, evidence: ["synthetic"] },
        { tag: "blue", category: "color", confidence: 0.9, evidence: ["synthetic"] },
        { tag: "zipper", category: "visible_content", confidence: 0.9, evidence: ["synthetic"] },
      ],
      ai_description: "x",
      scene_description: "y",
      content_type: "product_photo",
    }, "group_category_fixture"), /asset-only category/);
  }
});

test("a manual tag and a rejected tombstone both survive an AI re-tag", () => {
  const rows = assetTagsForRpc(typedResult(["blue", "3/4 view"]));
  assert.ok(rows.length > 0);
  for (const row of rows) assert.equal(row.status, "active");

  // These are the two clauses in the LIVE writer that make manual ownership and
  // rejection durable. Whitespace is normalized so formatting cannot break them.
  const body = assetWriter.body.replace(/\s+/g, " ");
  assert.match(
    body,
    /delete from public\.asset_tags where asset_id = p_asset_id and source = v_source and status in \('active', 'candidate'\) and created_by is null/,
    `manual and rejected rows must be out of the delete's reach (${assetWriter.file})`,
  );
  assert.match(
    body,
    /where public\.asset_tags\.created_by is null and public\.asset_tags\.source = excluded\.source and public\.asset_tags\.status in \('active', 'candidate'\)/,
    `an upsert must not overwrite a manual row or resurrect a tombstone (${assetWriter.file})`,
  );
});

test("a re-tag replaces stale AI rows and no code path bypasses the atomic writer", () => {
  assert.match(handlerSource, /rpc\("replace_asset_ai_tag_result"/);
  const directWrites = handlerSource.match(/from\("asset_tags"\)/g) ?? [];
  assert.deepEqual(directWrites, [], "asset_tags must only ever be written by the RPC");

  // The live writer deletes this source's prior AI-owned rows before inserting,
  // inside one transaction, so a stale tag from an earlier run cannot survive and
  // no partial state is ever observable. It is scoped by source, NOT by model, so
  // switching vision models still supersedes the previous run's rows.
  const body = assetWriter.body.replace(/\s+/g, " ");
  assert.match(body, /delete from public\.asset_tags where asset_id = p_asset_id and source = v_source/);
  assert.ok(!/delete from public\.asset_tags[^;]*model = v_model/.test(body),
    "the delete must not be narrowed by model, or a model change would orphan stale rows");
});

test("the assets.tags compatibility array excludes rejected tombstones and never holds group tags", () => {
  const body = tagsArraySync.body;
  assert.match(body, /from public\.asset_tags t/, "the array is built from asset rows only");
  assert.match(body, /t\.status = 'active'/, "candidate and rejected rows are excluded");
  assert.ok(!body.includes("style_group_tags"), "Style Group tags are never appended to assets.tags");
});

test("three sibling files in one group keep their own visual facts and share no file categories", () => {
  const group = groups[0];
  const [techPack, photograph, mockup] = group.assets;
  const fileFacts = (asset: FixtureAsset) =>
    asset.legacy_tags.filter((tag) => !Object.values(group.authoritative)
      .map((value) => value.toLowerCase()).includes(tag));

  // Prove the contamination this separation removes is real: the legacy flat tags
  // genuinely carried the group's product and property identity on every file.
  for (const asset of group.assets) {
    assert.ok(asset.legacy_tags.includes("backpack"), "legacy tags carried the product type");
    assert.ok(asset.legacy_tags.includes("synthetic property"), "legacy tags carried the property");
  }

  const techPackTags = fileFacts(techPack);
  const photographTags = fileFacts(photograph);
  const mockupTags = fileFacts(mockup);

  assert.ok(photographTags.includes("professional photography"), "the photograph owns the photography fact");
  assert.ok(photographTags.includes("3/4 view") && photographTags.includes("blue"));
  assert.ok(techPackTags.includes("tech pack"), "the tech pack owns the technical-document fact");
  assert.ok(!techPackTags.includes("professional photography"), "the tech pack never inherits photography");
  assert.ok(!techPackTags.includes("blue"), "the tech pack never inherits the photograph's colour");
  assert.ok(!photographTags.includes("tech pack"), "the photograph never inherits the tech-pack fact");
  assert.ok(!mockupTags.includes("professional photography") && !mockupTags.includes("tech pack"));

  // Each file's own tags validate as asset-only facts...
  for (const tags of [techPackTags, photographTags, mockupTags]) {
    assert.doesNotThrow(() => validateTagAssetData(typedResult(tags), "sibling_isolation"));
  }
  // ...and none of them carries the group's product or property identity.
  const identity = Object.values(group.authoritative).map((value) => value.toLowerCase());
  for (const tags of [techPackTags, photographTags, mockupTags]) {
    for (const term of identity) assert.ok(!tags.includes(term), `${term} belongs to the Style Group, not a file`);
  }
  // The fixture pins WHICH identity keys belong to the Style Group. Member
  // searchability through those terms is a database guarantee proven by the
  // shared-db Step 2 gate (refresh_dam_search_asset_document unions the group's
  // tags and item_description); it is deliberately not re-asserted here, because
  // this repository cannot execute that function.
  assert.deepEqual(Object.keys(group.authoritative).sort(), ["licensor", "product_type", "property"]);
});

test("a model-specific failure falls back to the second model; an infrastructure failure does not", () => {
  for (const modelFault of [
    "data_inspection_failed",
    "Unable to download the media resource",
    "Failed to download multimodal content",
    "No endpoints found",
  ]) {
    assert.equal(isModelSpecificError(modelFault), true, modelFault);
  }
  for (const infraFault of [
    "canceling statement due to statement timeout",
    "OpenRouter 502: bad gateway",
    "connection reset by peer",
  ]) {
    assert.equal(isModelSpecificError(infraFault), false, infraFault);
  }
});
