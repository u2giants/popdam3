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
 *
 * Priority tiers (highest → lowest):
 *  1. "mockup" in filename + usable thumbnail
 *  2. "art" in filename + usable thumbnail
 *  3. other files (not mockup/art/packaging) + usable thumbnail
 *  4. "packaging" in filename + usable thumbnail
 *  5. "mockup" in filename, no usable thumbnail
 *  6. "art" in filename, no usable thumbnail
 *  7. other files, no usable thumbnail
 *  8. "packaging" in filename, no usable thumbnail
 *  9. first asset by created_at (fallback)
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

  const fn = (a: typeof assets[0]) => a.filename.toLowerCase();
  const hasMockup = (a: typeof assets[0]) => fn(a).includes("mockup");
  const hasArt = (a: typeof assets[0]) => fn(a).includes("art");
  const hasPackaging = (a: typeof assets[0]) => fn(a).includes("packaging");
  const hasUsableThumbnail = (a: typeof assets[0]) => !!a.thumbnail_url && !a.thumbnail_error;
  const isOther = (a: typeof assets[0]) => !hasMockup(a) && !hasArt(a) && !hasPackaging(a);

  // Tier 1: mockup + usable thumbnail (best)
  const p1 = assets.find((a) => hasMockup(a) && hasUsableThumbnail(a));
  if (p1) return p1.id;

  // Tier 2: art + usable thumbnail
  const p2 = assets.find((a) => hasArt(a) && hasUsableThumbnail(a));
  if (p2) return p2.id;

  // Tier 3: other (not mockup/art/packaging) + usable thumbnail
  const p3 = assets.find((a) => isOther(a) && hasUsableThumbnail(a));
  if (p3) return p3.id;

  // Tier 4: packaging + usable thumbnail
  const p4 = assets.find((a) => hasPackaging(a) && hasUsableThumbnail(a));
  if (p4) return p4.id;

  // Tier 5: mockup, no usable thumbnail
  const p5 = assets.find((a) => hasMockup(a));
  if (p5) return p5.id;

  // Tier 6: art, no usable thumbnail
  const p6 = assets.find((a) => hasArt(a));
  if (p6) return p6.id;

  // Tier 7: other, no usable thumbnail
  const p7 = assets.find((a) => isOther(a));
  if (p7) return p7.id;

  // Tier 8: packaging, no usable thumbnail
  const p8 = assets.find((a) => hasPackaging(a));
  if (p8) return p8.id;

  // Tier 9: fallback — first by created_at
  return assets.sort((a, b) => a.created_at.localeCompare(b.created_at))[0].id;
}
