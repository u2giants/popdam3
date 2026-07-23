import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPopSGTaxonomyLookups,
  inferPopSGTags,
  normalizePopSGTag,
  resolvePopSGField,
  type PopSGTagFile,
} from "./popsg-tags.js";

function fixture(overrides: Partial<PopSGTagFile> = {}): PopSGTagFile {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    root_label: "styleguides",
    relative_path:
      "Disney/Princess/Ariel/Holiday 2026/Packaging/Patterns/Floral/file.ai",
    filename: "file.ai",
    file_extension: "ai",
    licensor_name: "Disney",
    property_folder: "Princess",
    style_guide_folder: "Ariel",
    directory_path: "Disney/Princess/Ariel/Holiday 2026/Packaging/Patterns/Floral",
    input_fingerprint: "fixture",
    ...overrides,
  };
}

test("normalizes punctuation, camel case, separators, and whitespace", () => {
  assert.equal(normalizePopSGTag("  Spider-Man_AllOverPrint  "), "spider man all over print");
});

test("uses every directory level and preserves path depth evidence", () => {
  const tags = inferPopSGTags(fixture(), [
    { name: "Disney", normalized: "disney", facet: "licensor" },
    { name: "Princess", normalized: "princess", facet: "property" },
    { name: "Ariel", normalized: "ariel", facet: "character" },
  ]);
  const names = new Set(tags.map((tag) => tag.tag));

  for (const expected of [
    "disney",
    "princess",
    "ariel",
    "holiday 2026",
    "packaging",
    "patterns",
    "floral",
    "holiday",
    "2026",
    "pattern",
  ]) {
    assert.ok(names.has(expected), `missing ${expected}`);
  }

  const floral = tags.find((tag) => tag.tag === "floral" && tag.source === "path");
  assert.equal(candidateDepth(floral), 6);
  assert.equal(candidateInherited(floral), true);
});

test("suppresses operational-only folders but keeps meaningful descendants", () => {
  const tags = inferPopSGTags(fixture({
    relative_path: "Marvel/Spider-Man/Final/Approved/Icons/Badges/file.psd",
    directory_path: "Marvel/Spider-Man/Final/Approved/Icons/Badges",
    licensor_name: "Marvel",
    property_folder: "Spider-Man",
    style_guide_folder: "Final",
    filename: "file.psd",
  }));
  const names = new Set(tags.map((tag) => tag.tag));
  assert.equal(names.has("final"), false);
  assert.equal(names.has("approved"), false);
  assert.equal(names.has("icons"), true);
  assert.equal(names.has("icon"), true);
  assert.equal(names.has("badges"), true);
  assert.equal(names.has("badge"), true);
});

test("filename inference emits controlled concepts, not a raw SKU-like filename", () => {
  const tags = inferPopSGTags(fixture({
    relative_path: "Disney/Princess/Ariel/Guide/2994221_BG101.ai",
    directory_path: "Disney/Princess/Ariel/Guide",
    filename: "2994221_BG101_Floral_AllOverPrint_v2.ai",
  }));
  const filenameTags = tags.filter((tag) => tag.source === "filename");
  assert.ok(filenameTags.some((tag) => tag.tag === "floral"));
  assert.ok(filenameTags.some((tag) => tag.tag === "allover pattern"));
  assert.equal(filenameTags.some((tag) => tag.tag.includes("2994221")), false);
  assert.equal(filenameTags.some((tag) => tag.tag.includes("v2")), false);
});

test("removes migration object IDs and numeric ordering prefixes from folder tags", () => {
  const tags = inferPopSGTags(fixture({
    relative_path:
      "Disney/Princess/Friendship-Adventures_-Product-Development-Portfolio-obj0b01d6368146fa37-FULL/50 Character Art/Character Group/file.ai",
    directory_path:
      "Disney/Princess/Friendship-Adventures_-Product-Development-Portfolio-obj0b01d6368146fa37-FULL/50 Character Art/Character Group",
    style_guide_folder:
      "Friendship-Adventures_-Product-Development-Portfolio-obj0b01d6368146fa37-FULL",
  }));
  const names = new Set(tags.map((tag) => tag.tag));
  assert.ok(names.has("friendship adventures product development portfolio"));
  assert.ok(names.has("character art"));
  assert.ok(names.has("character group"));
  assert.equal([...names].some((tag) => tag.includes("obj0b01d")), false);
  assert.equal(names.has("50 character art"), false);
});

test("does not link licensor/property facets for folders absent from the taxonomy", () => {
  const tags = inferPopSGTags(
    fixture({
      relative_path: "____New Structure/In Development/Ariel/Guide/AA0T0DYCR01.ai",
      directory_path: "____New Structure/In Development/Ariel/Guide",
      licensor_name: "____New Structure",
      property_folder: "In Development",
      style_guide_folder: "Ariel",
      filename: "AA0T0DYCR01.ai",
    }),
    [{ name: "Ariel", normalized: "ariel", facet: "character" }],
  );

  assert.equal(tags.some((tag) => tag.facet === "licensor"), false);
  assert.equal(tags.some((tag) => tag.facet === "property"), false);
  assert.equal(tags.some((tag) => tag.tag === "new structure"), false);
  assert.equal(tags.some((tag) => tag.tag === "in development"), false);
});

test("still links licensor/property when the folder matches the taxonomy", () => {
  const tags = inferPopSGTags(fixture(), [
    { name: "Disney", normalized: "disney", facet: "licensor" },
    { name: "Princess", normalized: "princess", facet: "property" },
  ]);
  assert.ok(tags.some((tag) => tag.facet === "licensor" && tag.tag === "disney"));
  assert.ok(tags.some((tag) => tag.facet === "property" && tag.tag === "princess"));
});

test("links a real licensor/property regardless of its depth in the tree", () => {
  // Licensor "Disney" sits at depth 2 here, not depth 0 — position varies.
  const tags = inferPopSGTags(
    fixture({
      relative_path: "Inbound/2026 Drop/Disney/Princess/Guide/file.ai",
      directory_path: "Inbound/2026 Drop/Disney/Princess/Guide",
      licensor_name: "Inbound",
      property_folder: "2026 Drop",
    }),
    [
      { name: "Disney", normalized: "disney", facet: "licensor" },
      { name: "Princess", normalized: "princess", facet: "property" },
    ],
  );
  assert.ok(tags.some((tag) => tag.facet === "licensor" && tag.tag === "disney"));
  assert.ok(tags.some((tag) => tag.facet === "property" && tag.tag === "princess"));
});

test("resolvePopSGField matches by exact value and via aliases, not fuzzily", () => {
  const lookups = buildPopSGTaxonomyLookups([
    { name: "Warner Brothers", normalized: "warner brothers", facet: "licensor" },
    { name: "Warner Brothers", normalized: "wb", canonical: "warner brothers", facet: "licensor" },
  ]);
  assert.equal(resolvePopSGField("Warner Brothers", lookups.licensor)?.canonical, "warner brothers");
  assert.equal(resolvePopSGField("WB", lookups.licensor)?.canonical, "warner brothers");
  // A near-miss must NOT resolve — matching is exact, never fuzzy.
  assert.equal(resolvePopSGField("Warner Bros Pictures", lookups.licensor), null);
  assert.equal(resolvePopSGField("____New Structure", lookups.licensor), null);
});

function candidateDepth(candidate: ReturnType<typeof inferPopSGTags>[number] | undefined): unknown {
  return candidate?.evidence.depth;
}

function candidateInherited(candidate: ReturnType<typeof inferPopSGTags>[number] | undefined): unknown {
  return candidate?.inherited;
}
