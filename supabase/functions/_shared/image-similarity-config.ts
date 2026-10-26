/**
 * Image-similarity tunables, validation and band logic — shared by the edge
 * function `image-similarity`, the frontend, and their tests (plan Muse 18:
 * one defaults module per surface; the frontend re-exports this file from
 * src/lib/image-similarity-config.ts, same pattern as search-access.ts).
 *
 * Every value is admin_config-tunable (Step 6); the constants here are only
 * the fallbacks used when a key is missing or unparsable. Band labels are
 * frontend-only; the database never stores them.
 */

export const IMAGE_SIM_ENABLED_KEY = "IMAGE_SIM_ENABLED";
export const IMAGE_EMBED_ENABLED_KEY = "IMAGE_EMBED_ENABLED";
export const IMAGE_SIM_FLOOR_KEY = "IMAGE_SIM_FLOOR";
export const IMAGE_SIM_DINO_WEIGHT_KEY = "IMAGE_SIM_DINO_WEIGHT";
export const IMAGE_SIM_TOP_K_KEY = "IMAGE_SIM_TOP_K";
export const IMAGE_SIM_BAND_SAME_EXPORT_KEY = "IMAGE_SIM_BAND_SAME_EXPORT";
export const IMAGE_SIM_BAND_SAME_ART_KEY = "IMAGE_SIM_BAND_SAME_ART";
export const IMAGE_SIM_BAND_CLOSE_KEY = "IMAGE_SIM_BAND_CLOSE";
export const IMAGE_SIM_EMBEDDING_MODEL_KEY = "IMAGE_SIM_EMBEDDING_MODEL";
export const IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS_KEY = "IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS";
export const IMAGE_SIM_REEMBED_IN_PROGRESS_KEY = "IMAGE_SIM_REEMBED_IN_PROGRESS";

export const IMAGE_SIM_DEFAULTS = {
  floor: 0.9,
  dinoWeight: 0.6,
  topK: 200,
  limit: 50,
  bandSameExport: 0.98,
  bandSameArt: 0.94,
  bandClose: 0.9,
} as const;

/** Edge wait budget: poll the query job every 2 s up to 15 s wall clock. */
export const IMAGE_SIM_POLL_INTERVAL_MS = 2_000;
export const IMAGE_SIM_MAX_WAIT_MS = 15_000;
/** Upload cap: 15 MB decoded image bytes (the DB wrapper caps at 16 MB). */
export const IMAGE_SIM_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Magic-byte sniffing — must stay in sync with the poller config.py set. */
const MAGIC_SIGNATURES: ReadonlyArray<readonly [Uint8Array, string]> = [
  [new Uint8Array([0xff, 0xd8, 0xff]), "JPEG"],
  [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "PNG"],
  [new TextEncoder().encode("GIF87a"), "GIF"],
  [new TextEncoder().encode("GIF89a"), "GIF"],
  [new TextEncoder().encode("BM"), "BMP"],
];

export function sniffMagicBytes(data: Uint8Array): string | null {
  for (const [prefix, name] of MAGIC_SIGNATURES) {
    if (data.length >= prefix.length && data.subarray(0, prefix.length).every((b, i) => b === prefix[i])) {
      return name;
    }
  }
  // WebP: "RIFF" at 0..4 and "WEBP" at 8..12
  const riff = new TextEncoder().encode("RIFF");
  const webp = new TextEncoder().encode("WEBP");
  if (
    data.length >= 12 &&
    data.subarray(0, 4).every((b, i) => b === riff[i]) &&
    data.subarray(8, 12).every((b, i) => b === webp[i])
  ) {
    return "WEBP";
  }
  return null;
}

export type UploadValidation =
  | { ok: true; format: string; bytes: number }
  | { ok: false; httpStatus: 400 | 413; reason: string };

export function validateUploadPayload(data: Uint8Array): UploadValidation {
  if (!data || data.length === 0) {
    return { ok: false, httpStatus: 400, reason: "Empty upload" };
  }
  if (data.length > IMAGE_SIM_MAX_UPLOAD_BYTES) {
    return { ok: false, httpStatus: 413, reason: `Image exceeds ${IMAGE_SIM_MAX_UPLOAD_BYTES} bytes` };
  }
  const format = sniffMagicBytes(data);
  if (!format) {
    return { ok: false, httpStatus: 400, reason: "Unsupported image format (use JPEG, PNG, WebP, GIF or BMP)" };
  }
  return { ok: true, format, bytes: data.length };
}

/** admin_config rows come back as {key, value} with jsonb values. */
export function configValue(row: { key: string; value: unknown } | null | undefined): unknown {
  if (!row) return undefined;
  const v = row.value;
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in (v as Record<string, unknown>)) {
    return (v as Record<string, unknown>).value;
  }
  return v;
}

export function parseNumber01(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, Math.trunc(n));
}

export function parseFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

export interface ImageSimTunables {
  floor: number;
  dinoWeight: number;
  topK: number;
  limit: number;
  modelStamps: string[];
}

/**
 * Resolve the search tunables the edge MUST pass through to the RPC
 * (DeepSeek B3) from admin_config rows. `rows` is the raw `.select()` result.
 */
export function resolveTunables(
  rows: Array<{ key: string; value: unknown }> | null,
): ImageSimTunables {
  const byKey = new Map((rows ?? []).map((r) => [r.key, r]));
  const get = (key: string) => configValue(byKey.get(key) ?? null);
  return {
    floor: parseNumber01(get(IMAGE_SIM_FLOOR_KEY), IMAGE_SIM_DEFAULTS.floor),
    dinoWeight: parseNumber01(get(IMAGE_SIM_DINO_WEIGHT_KEY), IMAGE_SIM_DEFAULTS.dinoWeight),
    topK: parsePositiveInt(get(IMAGE_SIM_TOP_K_KEY), IMAGE_SIM_DEFAULTS.topK, 1000),
    limit: IMAGE_SIM_DEFAULTS.limit,
    modelStamps: buildModelStamps(rows),
  };
}

/**
 * Model-stamp window: normally just [current]; while a re-embed is in
 * progress, [current, previous] so old vectors stay searchable until the
 * backfill finishes (Muse 8 / DeepSeek B4).
 */
export function buildModelStamps(rows: Array<{ key: string; value: unknown }> | null): string[] {
  const byKey = new Map((rows ?? []).map((r) => [r.key, r]));
  const current = configValue(byKey.get(IMAGE_SIM_EMBEDDING_MODEL_KEY));
  const previous = configValue(byKey.get(IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS_KEY));
  const reembed = parseFlag(configValue(byKey.get(IMAGE_SIM_REEMBED_IN_PROGRESS_KEY)));
  const stamps = new Set<string>();
  if (typeof current === "string" && current.trim()) stamps.add(current.trim());
  if (reembed && typeof previous === "string" && previous.trim()) stamps.add(previous.trim());
  return [...stamps];
}

export type ImageSimBand = "same_export" | "same_art" | "close" | "review";

/**
 * Band a match belongs to, given its combined percentage (0–100 scale, as
 * returned by search_dam_image_similarity). Anything under the floor is
 * hidden upstream (the RPC filters it); "review" only appears when an admin
 * lowered the floor below the close band.
 */
export function bandForScore(
  combinedPct: number,
  bands: { sameExport?: number; sameArt?: number; close?: number; floor?: number } = {},
): ImageSimBand | null {
  const sameExport = (bands.sameExport ?? IMAGE_SIM_DEFAULTS.bandSameExport) * 100;
  const sameArt = (bands.sameArt ?? IMAGE_SIM_DEFAULTS.bandSameArt) * 100;
  const close = (bands.close ?? IMAGE_SIM_DEFAULTS.bandClose) * 100;
  const floor = (bands.floor ?? IMAGE_SIM_DEFAULTS.floor) * 100;
  if (combinedPct < floor) return null; // hidden
  if (combinedPct >= sameExport) return "same_export";
  if (combinedPct >= sameArt) return "same_art";
  if (combinedPct >= close) return "close";
  return "review";
}

export const BAND_LABELS: Record<ImageSimBand, string> = {
  same_export: "Same export",
  same_art: "Same artwork",
  close: "Close match",
  review: "Below bands — review",
};

export interface ImageSimMatch {
  asset_id: string;
  dino_pct: number;
  siglip_pct: number;
  combined_pct: number;
  thumbnail_url: string;
  filename: string;
  relative_path: string;
  sku: string | null;
}

/** Stable response body shared by both edge actions. */
export interface ImageSimResponse {
  status: "ok" | "pending" | "unavailable" | "rejected" | "disabled";
  query_job_id?: string;
  reason?: string | null;
  matches: ImageSimMatch[];
  floor?: number;
  weights?: { dino: number };
  truncated?: boolean;
}
