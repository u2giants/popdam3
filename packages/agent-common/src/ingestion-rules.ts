/**
 * What the bridge scanner lets into the PopDAM library: the built-in rules plus
 * the admin-managed extras stored in admin_config.INGESTION_RULES.
 *
 * Canonical copy. supabase/functions/_shared/ingestion-rules.ts must stay
 * byte-identical (enforced by src/lib/ingestion-rules.test.ts) because edge
 * functions cannot import from packages/. No imports: this runs in Node, Deno
 * and the browser.
 *
 * Extras can only widen the PDF/image keyword lists or exclude more files.
 * New file extensions are not configurable: assets.file_type and the thumbnail
 * pipeline only understand the built-in types.
 */

export const SUPPORTED_EXTENSIONS = [".psd", ".ai", ".pdf", ".png", ".jpg", ".jpeg"] as const;
export const RASTER_EXTENSIONS = [".png", ".jpg", ".jpeg"] as const;
export const PDF_KEYWORDS = [
  "tech pack", "tech_pack", "techpack", "tech-pack",
  "licensing sheet", "licensing-sheet", "licensing_sheet",
  "_comp view", "_compview",
] as const;
export const IMAGE_KEYWORDS = ["comp-view", "compview"] as const;
export const EXCLUDED_FOLDER_PREFIXES = [".", "$", "@", "#"] as const;
/** Display and tester copy of the blocklist in packages/path-filters (test-enforced). */
export const EXCLUDED_FOLDERS = [
  "system volume information", "recycler", "$recycle.bin", "#recycle", "#snapshot", "#snapshots",
  "@eadir", "@sharebin", "@tmp", ".synologyworkingdirectory", "__macosx", ".spotlight-v100",
  ".trashes", ".fseventsd", ".appledouble", ".appledb", ".temporaryitems", "node_modules", ".git",
  ".svn", "recovered", "adobe premiere pro auto-save", "_old", "sample",
] as const;

export type IngestionRuleKind = "pdf_include" | "image_include" | "filename_exclude" | "folder_exclude";

export interface IngestionRule {
  id: string;
  kind: IngestionRuleKind;
  /** Lowercase. Filename "contains" text, or an exact folder name for folder_exclude. */
  value: string;
  enabled: boolean;
  note?: string;
  created_at?: string;
  created_by?: string;
}

const KINDS: readonly string[] = ["pdf_include", "image_include", "filename_exclude", "folder_exclude"];
const MIN_INCLUDE_LENGTH = 3;

/** Returns a problem to show the admin, or null when the value is usable. */
export function validateIngestionRuleValue(kind: IngestionRuleKind, rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) return "Enter some text.";
  if (value.length > 100) return "Keep it under 100 characters.";
  if (/[/\\]/.test(value)) return "Use a single name, without slashes.";
  if ((kind === "pdf_include" || kind === "image_include" || kind === "filename_exclude") && value.length < MIN_INCLUDE_LENGTH) {
    return `Use at least ${MIN_INCLUDE_LENGTH} characters so it cannot match nearly every file.`;
  }
  return null;
}

/** Keeps only well-formed rules, so a damaged setting falls back to the built-ins. */
export function normalizeIngestionRules(raw: unknown): IngestionRule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rules: IngestionRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || typeof r.kind !== "string" || !KINDS.includes(r.kind) || typeof r.value !== "string") continue;
    const kind = r.kind as IngestionRuleKind;
    if (validateIngestionRuleValue(kind, r.value)) continue;
    const value = r.value.trim().toLowerCase();
    const key = `${kind}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({
      id: r.id,
      kind,
      value,
      enabled: r.enabled !== false,
      ...(typeof r.note === "string" && r.note.trim() ? { note: r.note.trim().slice(0, 300) } : {}),
      ...(typeof r.created_at === "string" ? { created_at: r.created_at } : {}),
      ...(typeof r.created_by === "string" ? { created_by: r.created_by } : {}),
    });
  }
  return rules;
}

function firstMatch(lowerName: string, rules: IngestionRule[], kind: IngestionRuleKind): IngestionRule | undefined {
  return rules.find((r) => r.enabled && r.kind === kind && lowerName.includes(r.value));
}

export function isFilenameExcludedByRules(filename: string, rules: IngestionRule[]): boolean {
  return firstMatch(filename.toLowerCase(), rules, "filename_exclude") !== undefined;
}

export function isFolderExcludedByRules(folderName: string, rules: IngestionRule[]): boolean {
  const lower = folderName.toLowerCase();
  return rules.some((r) => r.enabled && r.kind === "folder_exclude" && r.value === lower);
}

export function matchesPdfRules(filename: string, rules: IngestionRule[]): boolean {
  const lower = filename.toLowerCase();
  return PDF_KEYWORDS.some((k) => lower.includes(k)) || firstMatch(lower, rules, "pdf_include") !== undefined;
}

export function matchesImageRules(filename: string, rules: IngestionRule[]): boolean {
  const lower = filename.toLowerCase();
  return IMAGE_KEYWORDS.some((k) => lower.includes(k)) || firstMatch(lower, rules, "image_include") !== undefined;
}

export interface IngestionVerdict {
  ingested: boolean;
  reason: string;
}

/**
 * Name-based verdict for the settings tester. Mirrors the scanner's order.
 * It cannot see the date cutoff or a same-named .pdf beside an .ai file.
 */
export function explainIngestion(path: string, rules: IngestionRule[]): IngestionVerdict {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const filename = segments.pop();
  if (!filename) return { ingested: false, reason: "Enter a file name." };
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot).toLowerCase() : "";
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ingested: false, reason: `${ext || "No extension"} is not an ingested file type.` };
  }
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if ((EXCLUDED_FOLDER_PREFIXES as readonly string[]).includes(seg[0]) || (EXCLUDED_FOLDERS as readonly string[]).includes(lower)) {
      return { ingested: false, reason: `Folder "${seg}" is always skipped.` };
    }
    if (isFolderExcludedByRules(seg, rules)) return { ingested: false, reason: `Your rule skips folder "${seg}".` };
  }
  const excluded = firstMatch(filename.toLowerCase(), rules, "filename_exclude");
  if (excluded) return { ingested: false, reason: `Your rule skips names containing "${excluded.value}".` };
  if (ext === ".pdf" && !matchesPdfRules(filename, rules)) {
    return { ingested: false, reason: "This PDF's name matches no PDF keyword." };
  }
  if ((RASTER_EXTENSIONS as readonly string[]).includes(ext) && !matchesImageRules(filename, rules)) {
    return { ingested: false, reason: "This image's name matches no comp-view keyword." };
  }
  return { ingested: true, reason: `${ext} file passes every name rule.` };
}
