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
  const isPerson = (value: string) => designerFirstNames.has(value.split(/\s+/)[0]);
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
    // Internal ids and file formats are not search terms.
    // So is scanned text in another alphabet, and a designer's own name.
    if (renamed && !/^character id\b/.test(renamed) && !/^(psd|pdf|ai)$/.test(renamed) && !/[\u0400-\u052F]/.test(renamed) && !isPerson(renamed)) add(renamed, String(item.category), "model", item);
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
  if (packaging && !isPerson(packaging)) add(packaging, "other", "sheet packaging type");
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
  const first = value.trim().split(/[\s/&]+/)[0]?.toLowerCase();
  return !!first && knownFirstNames.has(first);
}
