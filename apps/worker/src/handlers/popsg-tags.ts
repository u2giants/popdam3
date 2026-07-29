// `tag-popsg-files` lives HERE, in the Railway worker — it is not a Supabase edge
// function. This file owns both phases and writes the operation's resume cursor
// (see `processConsensusBatch` below). `supabase/functions/` only carries the
// registry entry in `_shared/operation-constants.ts`.
//
// Cursor contract, mirrored by `isResumableOperationCursor` in
// `src/hooks/usePersistentOperation.ts`: phase 1 emits a bare UUID, phase 2 emits
// `consensus:<base64url>`. base64url means `A-Za-z0-9-_` with no `=` padding — keep
// the writer and the validator on the same encoding if you touch either.

import { db } from "../supabase.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState } from "../types.js";

export const POPSG_TAG_RULE_VERSION = "deterministic-v2";
const BATCH_SIZE = 200;
const TAXONOMY_TTL_MS = 10 * 60 * 1000;

export type PopSGTagFacet =
  | "licensor"
  | "property"
  | "character"
  | "collection"
  | "season"
  | "year"
  | "occasion"
  | "product"
  | "application"
  | "asset_type"
  | "theme"
  | "style"
  | "color"
  | "material_finish"
  | "audience"
  | "language"
  | "workflow"
  | "other";

export interface PopSGTagCandidate {
  tag: string;
  display_name: string;
  facet: PopSGTagFacet;
  source: "path" | "filename" | "folder_consensus";
  confidence: number;
  inherited: boolean;
  evidence: Record<string, unknown>;
}

export interface PopSGTagFile {
  id: string;
  root_label: string;
  relative_path: string;
  filename: string;
  file_extension: string | null;
  licensor_name: string | null;
  property_folder: string | null;
  style_guide_folder: string | null;
  directory_path: string;
  input_fingerprint: string;
}

interface TaxonomyEntry {
  name: string;
  // The normalized string we search for in a path (the alias form for aliases,
  // otherwise the canonical name).
  normalized: string;
  // The normalized canonical tag to emit; defaults to `normalized`. Aliases set
  // this to the canonical row so "wb" surfaces as the "warner brothers" tag.
  canonical?: string;
  facet: "licensor" | "property" | "character";
}

// Curated aliases: a normalized variant mapped to the canonical name exactly as
// it appears in the licensors / properties tables. An alias only ever resolves
// when its canonical row actually exists in the taxonomy, so a bad entry here
// can never invent a licensor/property link — it just does nothing.
// Bucket A: folder short-forms/nicknames whose canonical licensor DOES exist in
// core.licensor. `canonical` must match a core.licensor name (case/punct-insensitive);
// an alias whose canonical is absent is silently ignored, so these can't fabricate links.
const LICENSOR_ALIASES: ReadonlyArray<{ alias: string; canonical: string }> = [
  { alias: "NBC Universal", canonical: "NBC" },
  { alias: "Marvel Style Guide", canonical: "Marvel" },
  { alias: "One Piece", canonical: "TOEI - ONE PIECE" },
  { alias: "Peanuts", canonical: "Peanuts Worldwide" },
  { alias: "Sesame Workshop", canonical: "Sesame Street" },
  // Paramount / Nickelodeon / Viacom are the same licensor family in core.
  { alias: "Paramount", canonical: "Viacom Multi" },
  { alias: "Nickelodeon", canonical: "Viacom Multi" },
  { alias: "Viacom", canonical: "Viacom Multi" },
];
const PROPERTY_ALIASES: ReadonlyArray<{ alias: string; canonical: string }> = [];

interface FieldMatch {
  canonical: string;
  name: string;
}

export interface PopSGTaxonomyLookups {
  licensor: Map<string, FieldMatch>;
  property: Map<string, FieldMatch>;
}

// Build exact-match lookups (normalized field value -> canonical tag) for the
// controlled licensor/property facets. Used both to emit field-derived tags and
// to count raw fields that fail to resolve.
export function buildPopSGTaxonomyLookups(
  taxonomy: readonly TaxonomyEntry[],
): PopSGTaxonomyLookups {
  const licensor = new Map<string, FieldMatch>();
  const property = new Map<string, FieldMatch>();
  for (const entry of taxonomy) {
    const record: FieldMatch = { canonical: entry.canonical ?? entry.normalized, name: entry.name };
    if (entry.facet === "licensor") licensor.set(entry.normalized, record);
    else if (entry.facet === "property") property.set(entry.normalized, record);
  }
  return { licensor, property };
}

// Resolve a raw, ingestion-derived field value (e.g. the licensor folder name)
// to a canonical taxonomy tag by exact normalized match. Returns null when the
// value is empty or does not correspond to any real table row.
export function resolvePopSGField(
  raw: string | null,
  lookup: Map<string, FieldMatch>,
): FieldMatch | null {
  if (!raw) return null;
  const normalized = normalizePopSGTag(raw);
  return normalized ? lookup.get(normalized) ?? null : null;
}

interface TaxonomyCache {
  entries: TaxonomyEntry[];
  loadedAt: number;
}

let taxonomyCache: TaxonomyCache | null = null;

const OPERATIONAL_SEGMENTS = new Set([
  "art",
  "artwork",
  "assets",
  "files",
  "images",
  "links",
  "misc",
  "miscellaneous",
  "new folder",
  "old",
  "archive",
  "archives",
  "source",
  "sources",
  "working",
  "work in progress",
  "wip",
  "final",
  "finals",
  "approved",
  "rejected",
  "copy",
  "copies",
  "backup",
  "core",
  "map",
  "maps",
  "guide info",
  "design",
]);

const PHRASE_TAGS: ReadonlyArray<{
  aliases: readonly string[];
  tag: string;
  display: string;
  facet: PopSGTagFacet;
}> = [
  { aliases: ["all over print", "allover print", "all over pattern", "allover pattern", "aop"], tag: "allover pattern", display: "Allover Pattern", facet: "asset_type" },
  { aliases: ["repeat pattern", "repeating pattern"], tag: "repeat pattern", display: "Repeat Pattern", facet: "asset_type" },
  { aliases: ["placement print", "placed print"], tag: "placement print", display: "Placement Print", facet: "asset_type" },
  { aliases: ["color palette", "colour palette"], tag: "color palette", display: "Color Palette", facet: "asset_type" },
  { aliases: ["style guide", "styleguide"], tag: "style guide", display: "Style Guide", facet: "asset_type" },
  { aliases: ["character art", "character artwork"], tag: "character art", display: "Character Art", facet: "asset_type" },
  { aliases: ["product mockup", "product mock up", "mockup", "mock up"], tag: "mockup", display: "Mockup", facet: "asset_type" },
  { aliases: ["line art", "lineart"], tag: "line art", display: "Line Art", facet: "style" },
  { aliases: ["black and white", "black white", "b w", "monochrome", "mono"], tag: "monochrome", display: "Monochrome", facet: "color" },
  { aliases: ["water colour", "watercolor", "watercolour"], tag: "watercolor", display: "Watercolor", facet: "style" },
  { aliases: ["hand drawn", "handdrawn"], tag: "hand drawn", display: "Hand Drawn", facet: "style" },
  { aliases: ["photo real", "photoreal", "photorealistic"], tag: "photorealistic", display: "Photorealistic", facet: "style" },
  { aliases: ["back to school", "bts"], tag: "back to school", display: "Back to School", facet: "occasion" },
  { aliases: ["valentines day", "valentine s day", "valentine"], tag: "valentine's day", display: "Valentine's Day", facet: "occasion" },
  { aliases: ["mothers day", "mother s day"], tag: "mother's day", display: "Mother's Day", facet: "occasion" },
  { aliases: ["fathers day", "father s day"], tag: "father's day", display: "Father's Day", facet: "occasion" },
];

const WORD_TAGS: Readonly<Record<string, { tag?: string; display?: string; facet: PopSGTagFacet }>> = {
  spring: { facet: "season" },
  summer: { facet: "season" },
  fall: { facet: "season", tag: "autumn", display: "Autumn" },
  autumn: { facet: "season" },
  winter: { facet: "season" },
  christmas: { facet: "occasion" },
  xmas: { facet: "occasion", tag: "christmas", display: "Christmas" },
  halloween: { facet: "occasion" },
  easter: { facet: "occasion" },
  birthday: { facet: "occasion" },
  holiday: { facet: "occasion" },
  packaging: { facet: "application" },
  apparel: { facet: "application" },
  stationery: { facet: "application" },
  tabletop: { facet: "application" },
  bedding: { facet: "application" },
  poster: { facet: "application" },
  posters: { facet: "application", tag: "poster", display: "Poster" },
  icon: { facet: "asset_type" },
  icons: { facet: "asset_type", tag: "icon", display: "Icon" },
  badge: { facet: "asset_type" },
  badges: { facet: "asset_type", tag: "badge", display: "Badge" },
  logo: { facet: "asset_type" },
  logos: { facet: "asset_type", tag: "logo", display: "Logo" },
  pattern: { facet: "asset_type" },
  patterns: { facet: "asset_type", tag: "pattern", display: "Pattern" },
  border: { facet: "asset_type" },
  borders: { facet: "asset_type", tag: "border", display: "Border" },
  background: { facet: "asset_type" },
  backgrounds: { facet: "asset_type", tag: "background", display: "Background" },
  sticker: { facet: "asset_type" },
  stickers: { facet: "asset_type", tag: "sticker", display: "Sticker" },
  photography: { facet: "asset_type" },
  photo: { facet: "asset_type", tag: "photography", display: "Photography" },
  floral: { facet: "theme" },
  florals: { facet: "theme", tag: "floral", display: "Floral" },
  flower: { facet: "theme", tag: "floral", display: "Floral" },
  flowers: { facet: "theme", tag: "floral", display: "Floral" },
  geometric: { facet: "theme" },
  tropical: { facet: "theme" },
  space: { facet: "theme" },
  sports: { facet: "theme" },
  music: { facet: "theme" },
  rainbow: { facet: "theme" },
  retro: { facet: "style" },
  vintage: { facet: "style" },
  minimal: { facet: "style" },
  pastel: { facet: "style" },
  metallic: { facet: "material_finish" },
  foil: { facet: "material_finish" },
  glitter: { facet: "material_finish" },
  embossed: { facet: "material_finish" },
  red: { facet: "color" },
  orange: { facet: "color" },
  yellow: { facet: "color" },
  green: { facet: "color" },
  blue: { facet: "color" },
  purple: { facet: "color" },
  pink: { facet: "color" },
  black: { facet: "color" },
  white: { facet: "color" },
  gold: { facet: "color" },
  silver: { facet: "color" },
  multicolor: { facet: "color" },
  girls: { facet: "audience", tag: "girls", display: "Girls" },
  boys: { facet: "audience", tag: "boys", display: "Boys" },
  infant: { facet: "audience" },
  toddler: { facet: "audience" },
  youth: { facet: "audience" },
  adult: { facet: "audience" },
  hangtag: { facet: "application", display: "Hangtag" },
  banner: { facet: "asset_type" },
};

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizePopSGTag(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[_/\\–—-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripRevisionNoise(value: string): string {
  return value
    .replace(/\b(?:copy|final|approved|rev(?:ision)?|ver(?:sion)?|v)\s*[-_]?\d+[a-z]?\b/gi, " ")
    .replace(/\b\d{1,2}[-_.]\d{1,2}[-_.]\d{2,4}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDirectorySegment(value: string): string {
  return stripRevisionNoise(value)
    .replace(/\bobj[0-9a-f]{12,}\b/gi, " ")
    .replace(/\b\d{6,12}\b/g, " ")
    .replace(/\bfull\b/gi, " ")
    .replace(/^\s*\d{1,3}\s+(?=[a-z])/i, "")
    .replace(/^\s*design\b[\s._-]*/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s._-]+|[\s._-]+$/g, "")
    .trim();
}

function phrasePresent(haystack: string, phrase: string): boolean {
  return (` ${haystack} `).includes(` ${phrase} `);
}

function isOperationalOnly(normalized: string): boolean {
  if (!normalized) return true;
  if (OPERATIONAL_SEGMENTS.has(normalized)) return true;
  if (/^(?:v|ver|version|rev|revision)\s*\d+[a-z]?$/.test(normalized)) return true;
  return false;
}

function addCandidate(
  target: Map<string, PopSGTagCandidate>,
  candidate: PopSGTagCandidate,
): void {
  const normalized = normalizePopSGTag(candidate.tag);
  if (!normalized || isOperationalOnly(normalized)) return;
  const clean = { ...candidate, tag: normalized };
  const key = `${clean.source}:${clean.tag}`;
  const existing = target.get(key);
  if (!existing || clean.confidence > existing.confidence) target.set(key, clean);
}

function inferSemanticTags(
  normalized: string,
  source: "path" | "filename",
  evidence: Record<string, unknown>,
  candidates: Map<string, PopSGTagCandidate>,
): void {
  const consumed = new Set<string>();
  for (const definition of PHRASE_TAGS) {
    const alias = definition.aliases.find((value) => phrasePresent(normalized, value));
    if (!alias) continue;
    alias.split(" ").forEach((word) => consumed.add(word));
    addCandidate(candidates, {
      tag: definition.tag,
      display_name: definition.display,
      facet: definition.facet,
      source,
      confidence: source === "path" ? 0.95 : 0.9,
      inherited: source === "path",
      evidence: { ...evidence, matched_phrase: alias },
    });
  }

  for (const word of normalized.split(" ")) {
    if (!word || consumed.has(word)) continue;
    const definition = WORD_TAGS[word];
    if (!definition) continue;
    const tag = definition.tag ?? word;
    addCandidate(candidates, {
      tag,
      display_name: definition.display ?? titleCase(tag),
      facet: definition.facet,
      source,
      confidence: source === "path" ? 0.92 : 0.87,
      inherited: source === "path",
      evidence: { ...evidence, matched_word: word },
    });
  }

  for (const year of normalized.match(/\b(?:19|20)\d{2}\b/g) ?? []) {
    addCandidate(candidates, {
      tag: year,
      display_name: year,
      facet: "year",
      source,
      confidence: source === "path" ? 0.98 : 0.93,
      inherited: source === "path",
      evidence: { ...evidence, matched_year: year },
    });
  }
}

function inferTaxonomyTags(
  normalized: string,
  taxonomy: readonly TaxonomyEntry[],
  source: "path" | "filename",
  evidence: Record<string, unknown>,
  candidates: Map<string, PopSGTagCandidate>,
): void {
  for (const entry of taxonomy) {
    if (entry.normalized.length < 3 || !phrasePresent(normalized, entry.normalized)) continue;
    addCandidate(candidates, {
      tag: entry.canonical ?? entry.normalized,
      display_name: entry.name,
      facet: entry.facet,
      source,
      confidence: source === "path" ? 0.97 : 0.93,
      inherited: source === "path",
      evidence: { ...evidence, taxonomy_match: entry.name },
    });
  }
}

export function inferPopSGTags(
  file: PopSGTagFile,
  taxonomy: readonly TaxonomyEntry[] = [],
): PopSGTagCandidate[] {
  const candidates = new Map<string, PopSGTagCandidate>();
  const segments = file.relative_path.split("/").filter(Boolean);
  const directorySegments = segments.slice(0, -1);
  const lookups = buildPopSGTaxonomyLookups(taxonomy);

  // Licensor and property are controlled links into the licensors/properties
  // tables. Folder *position* is unreliable (the tree layout varies), so we do
  // NOT infer these facets from depth. Instead we resolve the ingestion-derived
  // field values by exact value match against the real table rows. Placeholder
  // folders like "____New Structure" or "In Development" simply do not resolve
  // and are therefore never linked. Real licensors/properties appearing deeper
  // in the path are still caught by the value-based taxonomy scan below.
  const licensorMatch = resolvePopSGField(file.licensor_name, lookups.licensor);
  if (licensorMatch) {
    addCandidate(candidates, {
      tag: licensorMatch.canonical,
      display_name: licensorMatch.name,
      facet: "licensor",
      source: "path",
      confidence: 1,
      inherited: true,
      evidence: { positional_field: "licensor_name", raw_value: file.licensor_name },
    });
  }
  const propertyMatch = resolvePopSGField(file.property_folder, lookups.property);
  if (propertyMatch) {
    addCandidate(candidates, {
      tag: propertyMatch.canonical,
      display_name: propertyMatch.name,
      facet: "property",
      source: "path",
      confidence: 1,
      inherited: true,
      evidence: { positional_field: "property_folder", raw_value: file.property_folder },
    });
  }

  directorySegments.forEach((rawSegment, depth) => {
    const cleanedSegment = depth < 2 ? stripRevisionNoise(rawSegment) : cleanDirectorySegment(rawSegment);
    const normalized = normalizePopSGTag(cleanedSegment);
    if (!normalized || isOperationalOnly(normalized)) return;
    const evidence = {
      segment: rawSegment,
      cleaned_segment: cleanedSegment,
      normalized_segment: normalized,
      depth,
    };

    // Descriptive folder tags (collection / other). Licensor and property are
    // never derived positionally — only via value match above and the taxonomy
    // scan below.
    if (depth >= 2) {
      const wordCount = normalized.split(" ").length;
      const usefulWholeSegment =
        normalized.length <= (depth === 2 ? 100 : 60)
        && wordCount <= (depth === 2 ? 12 : 7);
      if (usefulWholeSegment) {
        addCandidate(candidates, {
          tag: normalized,
          display_name: cleanedSegment,
          facet: depth === 2 ? "collection" : "other",
          source: "path",
          confidence: depth === 2 ? 0.95 : 0.85,
          inherited: true,
          evidence: {
            ...evidence,
            positional_field: depth === 2 ? "style_guide_folder" : null,
          },
        });
      }
    }

    inferTaxonomyTags(normalized, taxonomy, "path", evidence, candidates);
    inferSemanticTags(normalized, "path", evidence, candidates);
  });

  const basename = file.filename.replace(/\.[^.]+$/, "");
  const normalizedFilename = normalizePopSGTag(stripRevisionNoise(basename));
  const filenameEvidence = { filename: file.filename, normalized_filename: normalizedFilename };
  inferTaxonomyTags(normalizedFilename, taxonomy, "filename", filenameEvidence, candidates);
  inferSemanticTags(normalizedFilename, "filename", filenameEvidence, candidates);

  return [...candidates.values()].sort((a, b) =>
    a.facet.localeCompare(b.facet) || a.tag.localeCompare(b.tag) || a.source.localeCompare(b.source)
  );
}

async function loadTaxonomy(): Promise<TaxonomyEntry[]> {
  if (taxonomyCache && Date.now() - taxonomyCache.loadedAt < TAXONOMY_TTL_MS) {
    return taxonomyCache.entries;
  }

  const client = db();
  // Canonical taxonomy lives in the `core` schema (sourced from DesignFlow PLM /
  // ColdLion), NOT the retired public.licensors/properties tables — see the
  // core-licensor/property contract. core.licensor carries the merch-group
  // `code` (WARNER BROS=WB, AARDMAN ANIMATIONS=AA, TOEI - ONE PIECE=1P); folders
  // frequently store that code rather than the legal name, so we resolve against
  // name AND code. Characters have no populated `core.character` yet (0 rows), so
  // the legacy public.characters catalog remains the only source for that facet.
  const [licensorsResult, propertiesResult, charactersResult] = await Promise.all([
    client.schema("core").from("licensor").select("name, code"),
    client.schema("core").from("property").select("name"),
    client.from("characters").select("name"),
  ]);

  for (const result of [licensorsResult, propertiesResult, charactersResult]) {
    if (result.error) throw new Error(`PopSG taxonomy load failed: ${result.error.message}`);
  }

  const entries: TaxonomyEntry[] = [];
  const canonicalByFacet: Record<TaxonomyEntry["facet"], Map<string, string>> = {
    licensor: new Map(),
    property: new Map(),
    character: new Map(),
  };
  const append = (rows: Array<{ name: string }> | null, facet: TaxonomyEntry["facet"]) => {
    for (const row of rows ?? []) {
      const normalized = normalizePopSGTag(row.name);
      if (!normalized) continue;
      entries.push({ name: row.name, normalized, facet });
      if (!canonicalByFacet[facet].has(normalized)) canonicalByFacet[facet].set(normalized, row.name);
    }
  };
  append(licensorsResult.data as Array<{ name: string }> | null, "licensor");
  append(propertiesResult.data as Array<{ name: string }> | null, "property");
  append(charactersResult.data as Array<{ name: string }> | null, "character");

  // Licensor merch-group code -> canonical licensor name (e.g. "WB" -> Warner
  // Bros). Registered as an alias entry so folders that store the code resolve.
  for (const row of (licensorsResult.data as Array<{ name: string; code: string | null }> | null) ?? []) {
    const canonicalNormalized = normalizePopSGTag(row.name);
    const codeNormalized = row.code ? normalizePopSGTag(row.code) : "";
    if (!canonicalNormalized || !codeNormalized || codeNormalized === canonicalNormalized) continue;
    entries.push({ name: row.name, normalized: codeNormalized, canonical: canonicalNormalized, facet: "licensor" });
  }

  // Aliases resolve to a canonical row only when that row exists in the table.
  const appendAliases = (
    aliases: ReadonlyArray<{ alias: string; canonical: string }>,
    facet: "licensor" | "property",
  ) => {
    for (const { alias, canonical } of aliases) {
      const aliasNormalized = normalizePopSGTag(alias);
      const canonicalNormalized = normalizePopSGTag(canonical);
      const canonicalName = canonicalByFacet[facet].get(canonicalNormalized);
      if (!aliasNormalized || !canonicalName || aliasNormalized === canonicalNormalized) continue;
      entries.push({
        name: canonicalName,
        normalized: aliasNormalized,
        canonical: canonicalNormalized,
        facet,
      });
    }
  };
  appendAliases(LICENSOR_ALIASES, "licensor");
  appendAliases(PROPERTY_ALIASES, "property");

  taxonomyCache = { entries, loadedAt: Date.now() };
  return entries;
}

async function processBatch(
  afterId: string | null,
  rebuild: boolean,
  batchSize = BATCH_SIZE,
): Promise<BatchResult> {
  const client = db();
  const { data, error } = await client.rpc("get_style_guide_deterministic_tag_batch_v2", {
    p_after_id: afterId,
    p_limit: batchSize,
    p_rebuild: rebuild,
  });

  if (error) {
    return { ok: false, done: false, error: error.message, error_stage: "candidate_fetch" };
  }

  const files = (data ?? []) as PopSGTagFile[];
  if (files.length === 0) {
    return { ok: true, done: true, processed: 0, tags_written: 0, failed: 0, nextOffset: null };
  }

  let processed = 0;
  let tagsWritten = 0;
  let failed = 0;
  // Coverage telemetry: how many files carry a raw licensor/property value that
  // does NOT resolve to a real table row. These are the fields a human has to
  // address manually, and the ratio tells us whether value-matching is working.
  let licensorPresent = 0;
  let licensorUnmatched = 0;
  let propertyPresent = 0;
  let propertyUnmatched = 0;
  const failureSamples: Array<{ file_id: string; filename: string; error: string; at: string }> = [];
  const taxonomy = await loadTaxonomy();
  const lookups = buildPopSGTaxonomyLookups(taxonomy);

  for (const file of files) {
    if (file.licensor_name && normalizePopSGTag(file.licensor_name)) {
      licensorPresent += 1;
      if (!resolvePopSGField(file.licensor_name, lookups.licensor)) licensorUnmatched += 1;
    }
    if (file.property_folder && normalizePopSGTag(file.property_folder)) {
      propertyPresent += 1;
      if (!resolvePopSGField(file.property_folder, lookups.property)) propertyUnmatched += 1;
    }
    try {
      const tags = inferPopSGTags(file, taxonomy);
      const { data: written, error: writeError } = await client.rpc(
        "replace_style_guide_deterministic_tags",
        {
          p_file_id: file.id,
          p_tags: tags,
          p_input_fingerprint: file.input_fingerprint,
          p_rule_version: POPSG_TAG_RULE_VERSION,
        },
      );
      if (writeError) throw writeError;
      processed += 1;
      tagsWritten += Number(written ?? tags.length);
    } catch (error) {
      failed += 1;
      failureSamples.push({
        file_id: file.id,
        filename: file.filename,
        error: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      });
    }
  }

  const lastId = files[files.length - 1].id;
  return {
    ok: true,
    done: files.length < batchSize,
    processed,
    tags_written: tagsWritten,
    failed,
    licensor_present: licensorPresent,
    licensor_unmatched: licensorUnmatched,
    property_present: propertyPresent,
    property_unmatched: propertyUnmatched,
    failure_samples: failureSamples,
    nextOffset: lastId,
  };
}

export async function handlePopSGFileTags(opState: OpState): Promise<BatchResult> {
  if (typeof opState.cursor === "string" && opState.cursor.startsWith("consensus:")) {
    const encoded = opState.cursor.slice("consensus:".length);
    const afterKey = encoded ? Buffer.from(encoded, "base64url").toString("utf8") : null;
    return processConsensusBatch(afterKey);
  }

  const afterId =
    typeof opState.cursor === "string" && opState.cursor !== "" && opState.cursor !== "0"
      ? opState.cursor
      : null;
  const rebuild = opState.params?.rebuild === true;
  const deterministic = await processBatch(afterId, rebuild);
  if (!deterministic.ok || !deterministic.done) return deterministic;

  const consensus = await processConsensusBatch(null);
  return {
    ...deterministic,
    done: consensus.done,
    nextOffset: consensus.nextOffset,
    consensus_folders: consensus.consensus_folders,
    consensus_relationships: consensus.consensus_relationships,
  };
}

async function processConsensusBatch(afterKey: string | null): Promise<BatchResult> {
  const { data, error } = await db().rpc("refresh_style_guide_folder_consensus_batch", {
    p_after_key: afterKey,
    p_limit_folders: 100,
    p_rule_version: "folder-consensus-v1",
  });
  if (error) {
    return { ok: false, done: false, error: error.message, error_stage: "tag_write" };
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    next_cursor: string | null;
    folders_processed: number;
    relationships_written: number;
    done: boolean;
  } | null;
  if (!row) {
    return { ok: false, done: false, error: "Folder consensus returned no result" };
  }

  return {
    ok: true,
    done: row.done,
    processed: 0,
    tags_written: 0,
    failed: 0,
    consensus_folders: row.folders_processed ?? 0,
    consensus_relationships: row.relationships_written ?? 0,
    nextOffset: row.done || !row.next_cursor
      ? null
      : `consensus:${Buffer.from(row.next_cursor, "utf8").toString("base64url")}`,
  };
}

let automaticRunActive = false;
let nextAutomaticRunAt = 0;

export async function processPendingPopSGTags(): Promise<void> {
  if (automaticRunActive || Date.now() < nextAutomaticRunAt) return;
  automaticRunActive = true;
  try {
    const result = await processBatch(null, false, 100);
    if (!result.ok) {
      logger.error("popsg-tags: automatic batch failed", { error: result.error });
    } else if ((result.processed as number) > 0 || (result.failed as number) > 0) {
      nextAutomaticRunAt = Date.now() + 5_000;
      logger.info("popsg-tags: automatic batch", {
        processed: result.processed,
        tags_written: result.tags_written,
        failed: result.failed,
      });
    } else {
      nextAutomaticRunAt = Date.now() + 30_000;
    }
  } catch (error) {
    nextAutomaticRunAt = Date.now() + 30_000;
    logger.error("popsg-tags: automatic batch exception", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    automaticRunActive = false;
  }
}
