/**
 * Deterministic clean-up of a model's tag result, run after the model call so
 * these rules spend no tokens. Owner rules from 2026-11-03 (issue #680).
 */
export const GROUP_SHOT_TAG = "group shot";
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
  [/art/, "art"],
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
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim() || name.trim();
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
}

/** Sheet OCR can be junk; only short, wordy values become search tags. */
function sheetTagValue(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length >= 3 && cleaned.length <= 40 && /^[\p{L}][\p{L}\p{N} &'./-]*$/u.test(cleaned) ? cleaned.toLowerCase() : null;
}

export function finishTagResult(input: FinishTagInput): { tagData: Record<string, unknown>; characterIds: string[] } {
  const { tagData, filename, licensed, sheet, characterNames } = input;
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
    if (renamed) add(renamed, String(item.category), "model", item);
  }
  for (const label of labelsFromFilename(filename)) add(label, "file_type", "file name");
  if (licensed && (tags.has("licensing sheet") || tags.has("costing sheet"))) {
    add("licensing sheet", "file_type", "paired sheet label");
    add("costing sheet", "file_type", "paired sheet label");
  }
  for (const name of names) add(name.toLowerCase(), "visible_content", "selected character");
  if (groupShot) add(GROUP_SHOT_TAG, "visible_content", "more than three characters");
  const packaging = sheetTagValue(sheet?.packaging_type);
  if (packaging) add(packaging, "other", "sheet packaging type");
  const retailer = sheetTagValue(sheet?.retailer);
  if (retailer) add(retailer, "other", "sheet original customer");

  let description = String(tagData.ai_description ?? "").trim();
  const missing = names.filter(name => !mentions(description, name));
  if (missing.length) description = `${description.replace(/[.\s]+$/, "")}, featuring ${joinNames(missing)}.`;
  if (groupShot && !mentions(description, GROUP_SHOT_TAG)) description = `${description.replace(/[.\s]+$/, "")}, ${GROUP_SHOT_TAG}.`;

  return { tagData: { ...tagData, asset_tags: [...tags.values()], ai_description: description, character_ids: characterIds }, characterIds };
}

/** A person's first name must be on the known list; sheet misreads ("BUYER") must not become designers. */
export function isKnownDesigner(value: unknown, knownFirstNames: Set<string>): value is string {
  if (typeof value !== "string") return false;
  const first = value.trim().split(/[\s/&]+/)[0]?.toLowerCase();
  return !!first && knownFirstNames.has(first);
}
