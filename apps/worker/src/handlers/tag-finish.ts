/**
 * Deterministic clean-up of a model's tag result, run after the model call so
 * these rules spend no tokens. Owner rules from 2026-11-03 (issue #680).
 */
export const GROUP_SHOT_TAG = "group shot";
/** Owner ruling Nov 3, 2026: "group shot" is itself a character. It belongs to no licensor. */
export const GROUP_SHOT_CHARACTER_ID = "90f4dfa8-b4f9-4880-b2f7-e772f5e40ca7";
const CHARACTER_LIMIT = 3;

/** Albert's asset-type words. Older or near-miss model wording maps onto them; null drops the label. */
const LABEL_RENAMES: Record<string, string | null> = {
  "professional photography": "product photography",
  "product photo": "product photography",
  "product photos": "product photography",
  "straight view": "front view",
  "close-up view": "close-up",
  "closeup": "close-up",
  "close up": "close-up",
  "lifestyle / in-use image": "lifestyle photo",
  "lifestyle image": "lifestyle photo",
  "person holding item / size scale image": "size scale image",
  "artwork": "art",
  "design asset": null,
};

const FILENAME_LABELS: Array<[RegExp, string]> = [
  [/tech[ _-]?pack/, "tech pack"],
  [/licens\w*[ _-]?sheet/, "licensing sheet"],
  [/costing[ _-]?sheet/, "costing sheet"],
  [/mock[ _-]?up/, "product mockup"],
  [/lifestyle/, "lifestyle photo"],
  [/holding|size[ _-]?scale/, "size scale image"],
  [/close[ _-]?up/, "close-up"],
  [/3[ _/-]4/, "3/4 view"],
  [/front/, "front view"],
  [/back/, "back view"],
  [/art(?:work|file)?/, "art"],
  [/packaging/, "packaging design"],
];

/** Asset-type words a file name states outright; a word must stand alone ("Front", not "FRoom"). */
export function labelsFromFilename(filename: string | null | undefined): string[] {
  const name = (filename ?? "").toLowerCase().replace(/\.[a-z0-9]+$/, "");
  const labels: string[] = [];
  for (const [pattern, label] of FILENAME_LABELS) {
    if (new RegExp(`(?:^|[^a-z0-9])(?:${pattern.source})(?:[^a-z0-9]|$)`).test(name)) labels.push(label);
  }
  return labels;
}

/** "Spider-Man (Spidey and His Amazing Friends)" reads as "Spider-Man" in text and tags. */
export function displayCharacterName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+aka\s+.*$/i, "").trim() || name.trim();
}

function joinNames(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Word-boundary match that also treats punctuation in names ("Spider-Man") literally. */
function mentions(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "iu").test(text);
}

/** Staff written out in full. First names alone can't decide this: "Peter Parker" and "Amy Rose" are characters. */
const STAFF_FULL_NAMES = new Set([
  "albert hazan", "sarbani ghosh", "nimesh niyomal", "james ashley", "isaac clark", "khim tugas", "peter paul", "jessica pinilla",
  "beckett schiaparelli", "danilo moreno", "malachi cameron", "jen chaffier", "derrick smith", "deborah salles", "tanisha shah", "zarit calderon",
]);

/** Section headings and print furniture that appear on every sheet, so they tell two files apart for nobody. */
const FORM_TEXT_TAGS = new Set([
  "dimensions", "dimension callouts", "dimensions callouts", "dimension diagram", "dimensions text", "callouts", "measurements",
  "legal line", "legal information", "legal text", "legal sticker", "legal sticker artwork", "copyright text", "made in china",
  "upc sticker", "upc label", "upc placement", "barcode", "sticker placement", "placement instructions",
  "prop 65", "prop 65 label", "prop 65 warning", "prop 65 sticker", "prop 65 warning label", "tsca label",
  "spec table", "spec sheet", "spec layout", "spec sheet layout", "specification table",
  "pantone", "pantone reference", "pantone swatches", "pantone colors", "pantone palette", "color swatches",
  "concept stage", "concept approved designs", "placeholder", "text", "title text", "black text", "white text",
  // Folder names and the company's own name, read from the file path or legal line.
  "character licensed", "new structure", "in development", "customer adopted", "pop creations",
  "ai file", "psd file", "pdf file",
]);

const JUNK_TAG_PATTERNS: RegExp[] = [
  /_/, // machine words: art_piece, ____new structure
  /^(?=[a-z0-9]*\d[a-z0-9]*[a-z])[a-z0-9]{7,10}\d{2}$/, // style codes: mdsh7sesc02
  /^(?:pantone|pms)\b/, // ink references: pantone 186 c
  /^dimensions?\b/,
  /^page \d+(?: of \d+)?$/,
  /^(?:wip|rev|version)\b/,
  /\b(?:ss|fw|fh|aw|sp)\s?(?:20)?\d{2}\b/, // customer seasons: dollar general fw26
  /\b(?:spring|summer|fall|winter)\s+(?:20\d{2})\b/,
  /©|™|®|\ball rights reserved\b|\brelated characters?\b/, // pieces of the legal line
  /[\u0400-\u052F]/, // scanned text in another alphabet
];

/** True for scan debris and form text. Selected characters and sheet facts are added after this check. */
export function isJunkTag(tag: string): boolean {
  return tag.length > 40 || FORM_TEXT_TAGS.has(tag) || STAFF_FULL_NAMES.has(tag) || JUNK_TAG_PATTERNS.some(pattern => pattern.test(tag));
}

export interface SheetTagFacts {
  packaging_type?: string | null;
  retailer?: string | null;
}

export interface FinishTagInput {
  tagData: Record<string, unknown>;
  characterIds: string[];
  characterNames: Map<string, string>;
  filename: string | null | undefined;
  /** True only when the file's style is known to be licensed. */
  licensed: boolean;
  sheet?: SheetTagFacts | null;
  /** True once the shared Group Shot character exists, so a link cannot fail the save. */
  groupShotCharacterExists?: boolean;
  /** Lower-case customer names; a sheet retailer becomes a tag only when it starts with one. */
  customerNames?: string[];
  /** Lower-case designer first names; a person is never a packaging or customer tag. */
  designerFirstNames?: Set<string>;
}

/** Sheet OCR can be junk; only short, wordy values become search tags. */
function sheetTagValue(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length >= 3 && cleaned.length <= 40 && /^[\p{L}][\p{L}\p{N} &'./-]*$/u.test(cleaned) ? cleaned.toLowerCase() : null;
}

export function finishTagResult(input: FinishTagInput): { tagData: Record<string, unknown>; characterIds: string[] } {
  const { tagData, filename, licensed, sheet, characterNames, customerNames = [], designerFirstNames = new Set<string>() } = input;
  const isFirstName = (value: string) => designerFirstNames.has(value);
  const groupShot = input.characterIds.length > CHARACTER_LIMIT;
  // The prompt asks for the most prominent character first.
  const characterIds = groupShot ? input.characterIds.slice(0, 1) : input.characterIds;
  const names = characterIds.map(id => characterNames.get(id)).filter((name): name is string => !!name).map(displayCharacterName);

  const tags = new Map<string, Record<string, unknown>>();
  const add = (tag: string, category: string, evidence: string, existing?: Record<string, unknown>) => {
    if (!tags.has(tag)) tags.set(tag, existing ? { ...existing, tag } : { tag, category, confidence: 1, evidence: [evidence] });
  };
  for (const item of (tagData.asset_tags as Array<Record<string, unknown>>) ?? []) {
    const raw = String(item.tag ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    const renamed = raw in LABEL_RENAMES ? LABEL_RENAMES[raw] : raw;
    // Internal ids and file formats are not search terms, and neither is a designer's own name.
    if (renamed && !/^character id\b/.test(renamed) && !/^(psd|pdf|ai)$/.test(renamed) && !isJunkTag(renamed) && !isFirstName(renamed)) add(renamed, String(item.category), "model", item);
  }
  const fileLabels = labelsFromFilename(filename);
  for (const label of fileLabels) add(label, "file_type", "file name");
  // A file named as a licensing sheet is one sheet, not also a tech pack.
  if (fileLabels.includes("licensing sheet") && !fileLabels.includes("tech pack")) tags.delete("tech pack");
  if (licensed && (tags.has("licensing sheet") || tags.has("costing sheet"))) {
    add("licensing sheet", "file_type", "paired sheet label");
    add("costing sheet", "file_type", "paired sheet label");
  }
  for (const name of names) add(name.toLowerCase(), "visible_content", "selected character");
  // "Group shot" means more than three characters, whatever the model wrote.
  if (!groupShot) tags.delete(GROUP_SHOT_TAG);
  if (groupShot) add(GROUP_SHOT_TAG, "visible_content", "more than three characters");
  const packaging = sheetTagValue(sheet?.packaging_type);
  if (packaging && !designerFirstNames.has(packaging.split(/\s+/)[0])) add(packaging, "other", "sheet packaging type");
  const retailer = sheetTagValue(sheet?.retailer);
  if (retailer && customerNames.some(name => retailer === name || retailer.startsWith(`${name} `))) add(retailer, "other", "sheet original customer");

  let description = String(tagData.ai_description ?? "").trim();
  // "Sally" already names "Sally Doll"; only a wholly absent character is added.
  const missing = names.filter(name => !mentions(description, name) && !(name.split(" ")[0].length >= 4 && mentions(description, name.split(" ")[0])));
  if (missing.length) description = `${description.replace(/[.\s]+$/, "")}, featuring ${joinNames(missing)}.`;
  if (groupShot && !mentions(description, GROUP_SHOT_TAG)) description = `${description.replace(/[.\s]+$/, "")}, ${GROUP_SHOT_TAG}.`;

  const linkedIds = groupShot && input.groupShotCharacterExists ? [...characterIds, GROUP_SHOT_CHARACTER_ID] : characterIds;
  return { tagData: { ...tagData, asset_tags: [...tags.values()], ai_description: description, character_ids: linkedIds }, characterIds: linkedIds };
}

/** A person's first name must be on the known list; sheet misreads ("BUYER") must not become designers. */
export function isKnownDesigner(value: unknown, knownFirstNames: Set<string>): value is string {
  if (typeof value !== "string") return false;
  // A real first name followed by stray model text ("LUIS', art_source...") is not a name.
  if (value.trim().length > 40 || !/^[\p{L}][\p{L} .'/&-]*$/u.test(value.trim()) || /'\s*$/.test(value.trim())) return false;
  const first = value.trim().split(/[\s/&]+/)[0]?.toLowerCase();
  return !!first && knownFirstNames.has(first);
}
