/**
 * Style grouping utilities.
 * A "style group" = all files sharing the same SKU folder on the NAS.
 * The SKU folder is the immediate parent directory of each asset file.
 */

/**
 * Extract the SKU folder name from a relative path.
 * The SKU folder is the immediate parent of the file.
 * Returns null if the parent folder doesn't look like a SKU
 * (must start with 1-6 letters followed by a digit).
 *
 * Examples:
 *   "Decor/Character Licensed/____New Structure/Concept Approved Designs/Disney/Frames/CSG10DYMU02/CSG10DYMU02_ART FILE.ai"
 *   → "CSG10DYMU02"
 *
 *   "Decor/Generic Decor/_New structure/DA/62/GDC6201/GDC6201_art.ai"
 *   → "GDC6201"
 */
export function extractSkuFolder(relativePath: string): string | null {
  const parts = relativePath.split("/");
  if (parts.length < 2) return null;
  const parentFolder = parts[parts.length - 2];
  // Must start with 1-6 letters then a digit (loose SKU check)
  if (!/^[A-Za-z]{1,6}\d/i.test(parentFolder)) return null;
  return parentFolder;
}

/**
 * Select the primary asset from a list of assets in the same group.
 * Priority (prefer assets with usable thumbnails at each tier):
 *  1. "ART" in filename + .ai/.psd + usable thumbnail
 *  2. "ART" in filename + .ai/.psd (no thumbnail)
 *  3. "ART" in filename + usable thumbnail
 *  4. "ART" in filename (any)
 *  5. .ai + usable thumbnail
 *  6. .ai (any)
 *  7. .psd + usable thumbnail
 *  8. .psd (any)
 *  9. Any asset with usable thumbnail
 * 10. First asset by created_at
 */
export function selectPrimaryAsset(
  assets: Array<{
    id: string;
    filename: string;
    file_type: string;
    created_at: string;
    thumbnail_url?: string | null;
    thumbnail_error?: string | null;
  }>,
): string | null {
  if (assets.length === 0) return null;

  const hasArt = (f: string) => f.toLowerCase().includes("art");
  const isAiOrPsd = (t: string) => t === "ai" || t === "psd";
  const hasUsableThumbnail = (a: typeof assets[0]) =>
    !!a.thumbnail_url && !a.thumbnail_error;

  // Priority 1: ART + ai/psd + thumbnail
  const p1 = assets.find((a) => hasArt(a.filename) && isAiOrPsd(a.file_type) && hasUsableThumbnail(a));
  if (p1) return p1.id;

  // Priority 2: ART + ai/psd (no thumbnail)
  const p2 = assets.find((a) => hasArt(a.filename) && isAiOrPsd(a.file_type));
  if (p2) return p2.id;

  // Priority 3: ART + thumbnail
  const p3 = assets.find((a) => hasArt(a.filename) && hasUsableThumbnail(a));
  if (p3) return p3.id;

  // Priority 4: ART (any)
  const p4 = assets.find((a) => hasArt(a.filename));
  if (p4) return p4.id;

  // Priority 5: .ai + thumbnail
  const p5 = assets.find((a) => a.file_type === "ai" && hasUsableThumbnail(a));
  if (p5) return p5.id;

  // Priority 6: .ai (any)
  const p6 = assets.find((a) => a.file_type === "ai");
  if (p6) return p6.id;

  // Priority 7: .psd + thumbnail
  const p7 = assets.find((a) => a.file_type === "psd" && hasUsableThumbnail(a));
  if (p7) return p7.id;

  // Priority 8: .psd (any)
  const p8 = assets.find((a) => a.file_type === "psd");
  if (p8) return p8.id;

  // Priority 9: any asset with usable thumbnail
  const p9 = assets.find((a) => hasUsableThumbnail(a));
  if (p9) return p9.id;

  // Priority 10: first by created_at
  return assets.sort((a, b) => a.created_at.localeCompare(b.created_at))[0].id;
}
