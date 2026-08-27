import assert from "node:assert/strict";
import test from "node:test";
import { selectStyleGroupRepresentatives } from "./style-group-representatives.js";

const candidates = [
  { id: "primary", is_primary: true, thumbnail_url: "https://example/primary", filename: "sku-front.jpg", content_type: "product_photo", thumbnail_size_bytes: 100 },
  { id: "photo-back", thumbnail_url: "https://example/back", filename: "sku-back.jpg", content_type: "product_photo", thumbnail_size_bytes: 100 },
  { id: "tech-pack", thumbnail_url: "https://example/tech", filename: "sku-tech-pack.pdf", content_type: "technical_document", thumbnail_size_bytes: 100 },
  { id: "mockup", thumbnail_url: "https://example/mockup", filename: "sku-3-4.psd", content_type: "render_mockup", thumbnail_size_bytes: 100 },
  { id: "near-copy", thumbnail_url: "https://example/copy", filename: "sku-front-copy2.jpg", content_type: "product_photo", thumbnail_size_bytes: 100 },
  { id: "no-preview", thumbnail_url: null, filename: "source.ai", content_type: "source_art", thumbnail_size_bytes: 100 },
];

test("selects primary plus deterministic file and view diversity", () => {
  const selected = selectStyleGroupRepresentatives(candidates, { minCount: 4, maxCount: 4, maxPayloadBytes: 1_000 });
  assert.deepEqual(selected.map((candidate) => candidate.id), ["primary", "mockup", "photo-back", "tech-pack"]);
});

test("excludes unavailable previews and near-identical filename revisions", () => {
  const selected = selectStyleGroupRepresentatives(candidates, { maxCount: 8, maxPayloadBytes: 1_000 });
  assert.ok(!selected.some((candidate) => candidate.id === "no-preview"));
  assert.ok(!selected.some((candidate) => candidate.id === "near-copy"));
});

test("honors the payload ceiling after satisfying the bounded minimum", () => {
  const selected = selectStyleGroupRepresentatives(candidates, { minCount: 2, maxCount: 8, maxPayloadBytes: 250 });
  assert.equal(selected.length, 2);
  assert.equal(selected[0].id, "primary");
});

test("selection is stable regardless of database row order", () => {
  const forward = selectStyleGroupRepresentatives(candidates).map((candidate) => candidate.id);
  const reverse = selectStyleGroupRepresentatives([...candidates].reverse()).map((candidate) => candidate.id);
  assert.deepEqual(reverse, forward);
});
