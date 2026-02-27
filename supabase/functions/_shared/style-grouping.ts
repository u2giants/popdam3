/**
 * Style grouping utilities.
 * A "style group" = all files sharing the same SKU folder on the NAS.
 * The SKU folder is the immediate parent directory of each asset file.
 */

/**
 * Extract the SKU folder name from a relative path.
 * Walks up the directory tree (starting from immediate parent) to find
 * the nearest ancestor that looks like a SKU folder.
 * Returns null if no ancestor matches the SKU pattern
 * (must start with 1-6 letters followed by a digit).
 *
 * Examples:
 *   "Decor/.../CSG10DYMU02/CSG10DYMU02_ART FILE.ai"
 *   → "CSG10DYMU02"
 *
 *   "Decor/.../AA021FPFRA03/ART/file.psd"
 *   → "AA021FPFRA03"  (walks past "ART" to find the SKU)
 *
 *   "Decor/.../GDC6201/GDC6201_art.ai"
 *   → "GDC6201"
 */
export function extractSkuFolder(relativePath: string): string | null {
  const parts = relativePath.split("/");
  if (parts.length < 2) return null;
  const SKU_PATTERN = /^[A-Za-z]{1,6}\d/;
  // Walk from immediate parent upward
  for (let i = parts.length - 2; i >= 0; i--) {
    if (SKU_PATTERN.test(parts[i])) return parts[i];
  }
  return null;
}

/**
 * Select the primary asset from a list of assets in the same group.
 * Key invariant: an asset with a usable thumbnail ALWAYS beats one without.
 * Priority:
 *  1. "ART" in filename + .ai/.psd + usable thumbnail  (best)
 *  2. any .ai/.psd + usable thumbnail
 *  3. any asset with usable thumbnail
 *  4. "ART" + .ai/.psd, no thumbnail error (pending render)
 *  5. "ART" + .ai/.psd (even if broken)
 *  6. any .ai/.psd
 *  7. first asset by created_at
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

  // Priority 1: ART + ai/psd + usable thumbnail (best)
  const p1 = assets.find((a) => hasArt(a.filename) && isAiOrPsd(a.file_type) && hasUsableThumbnail(a));
  if (p1) return p1.id;

  // Priority 2: any ai/psd + usable thumbnail
  const p2 = assets.find((a) => isAiOrPsd(a.file_type) && hasUsableThumbnail(a));
  if (p2) return p2.id;

  // Priority 3: any usable thumbnail regardless of file type
  const p3 = assets.find((a) => hasUsableThumbnail(a));
  if (p3) return p3.id;

  // Priority 4: ART + ai/psd, no thumbnail error (not yet thumbnailed, not broken)
  const p4 = assets.find((a) => hasArt(a.filename) && isAiOrPsd(a.file_type) && !a.thumbnail_error);
  if (p4) return p4.id;

  // Priority 5: ART + ai/psd (even if broken — best metadata)
  const p5 = assets.find((a) => hasArt(a.filename) && isAiOrPsd(a.file_type));
  if (p5) return p5.id;

  // Priority 6: any ai/psd
  const p6 = assets.find((a) => isAiOrPsd(a.file_type));
  if (p6) return p6.id;

  // Priority 7: first by created_at
  return assets.sort((a, b) => a.created_at.localeCompare(b.created_at))[0].id;
}
