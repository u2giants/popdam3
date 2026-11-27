import test from "node:test";
import assert from "node:assert/strict";
import { handlePopSGAiTag, popsgVisionTags, type PopSGVisionFile } from "./popsg-ai-tag.js";
import type { OpState } from "../types.js";

const cfg = { models: ["z-ai/glm-5.3-flash"], run_id: "popsg-1", discover: true, untagged_only: true, concurrency: 4 };
const file = (id: string): PopSGVisionFile => ({ id, filename: `${id}.ai`, relative_path: `x/${id}.ai`, file_extension: "ai", licensor_name: "WB", property_folder: null, style_guide_folder: null, thumbnail_url: "https://t/x.jpg" });
const op = (cursor: unknown = null, run_id = "popsg-1") => ({ status: "running", run_id, cursor } as unknown as OpState);

test("tags only files without a completed vision state and advances the cursor", async () => {
  const seen: string[] = [];
  const r = await handlePopSGAiTag(op(), { config: cfg,
    fetchPage: async () => [file("a"), file("b"), file("c")],
    doneStates: async () => new Map([["b", { status: "completed", attempt_count: 1 }], ["c", { status: "failed", attempt_count: 2 }]]),
    tagFile: async (f, model, attempts) => { seen.push(`${f.id}:${model}:${attempts}`); return f.id === "c" ? { outcome: "failed", error: "missing tag" } : { outcome: "tagged" }; } });
  assert.deepEqual(seen.sort(), ["a:z-ai/glm-5.3-flash:1", "c:z-ai/glm-5.3-flash:3"]);
  assert.equal(r.tagged, 1); assert.equal(r.failed, 1); assert.equal(r.skipped, 1); assert.equal(r.nextOffset, "c"); assert.equal(r.done, false);
});

test("run_id mismatch refuses to run", async () => {
  const r = await handlePopSGAiTag(op(null, "other"), { config: cfg, fetchPage: async () => [] });
  assert.equal(r.ok, false);
});

test("end of pass starts the next pass while anything was tagged in the last hour", async () => {
  const again = await handlePopSGAiTag(op("z"), { config: cfg, fetchPage: async () => [], taggedRecently: async () => true });
  assert.equal(again.done, false); assert.equal(again.nextOffset, 0);
  const done = await handlePopSGAiTag(op("z"), { config: cfg, fetchPage: async () => [], taggedRecently: async () => false });
  assert.equal(done.done, true);
});

test("maps tag_asset items to PopSG facets and drops duplicates", () => {
  const rows = popsgVisionTags({ asset_tags: [{ tag: "Batman", category: "visible_content", confidence: 0.9, evidence: ["logo"] }, { tag: "batman", category: "other" }, { tag: "Red", category: "color", confidence: 3 }] }, "m");
  assert.deepEqual(rows.map(r => [r.normalized, r.facet, r.confidence]), [["batman", "other", 0.9], ["red", "color", 1]]);
});

test("keeps licensed names guessed from the picture but marks them (#1430 accuracy)", () => {
  const rows = popsgVisionTags({ asset_tags: [{ tag: "Example Hero", category: "visible_content" }, { tag: "Tree", category: "visible_content" }] }, "m", new Set(["example hero"]));
  assert.deepEqual(rows.map(r => [r.normalized, r.guessedName]), [["example hero", true], ["tree", false]]);
});

test("name tag marking runs before tagging and its failure never stops tagging", async () => {
  let purged = 0;
  const ok = await handlePopSGAiTag(op(), { config: cfg, demoteNames: async () => { purged++; return 3; }, refreshSearch: async () => { purged++; return 7; }, fetchPage: async () => [file("a")], doneStates: async () => new Map(), tagFile: async () => ({ outcome: "tagged" }) });
  assert.equal(purged, 2); assert.equal(ok.tagged, 1);
  const failing = await handlePopSGAiTag(op(), { config: cfg, demoteNames: async () => { throw new Error("down"); }, refreshSearch: async () => { throw new Error("down"); }, fetchPage: async () => [file("a")], doneStates: async () => new Map(), tagFile: async () => ({ outcome: "tagged" }) });
  assert.equal(failing.ok, true); assert.equal(failing.tagged, 1);
});
