/**
 * Style grouping utilities.
 * A "style group" = all files sharing the same SKU folder on the NAS.
 * The SKU folder is the immediate parent directory of each asset file.
 */

/**
 * Extract the SKU folder name from a relative path.
 * Walks DOWN the directory tree (root → file) and returns the FIRST
 * (outermost) ancestor that looks like a SKU folder.
 * This ensures that all files inside a SKU folder — including those in
 * sub-folders like "AAE20DCBM01_SAMPLE_OLD" — are grouped under the
 * top-level SKU folder (e.g. "AAE20DCBM01").
 *
 * Returns null if no ancestor matches the SKU pattern
 * (must start with 1-6 letters followed by a digit).
 *
 * Examples:
 *   "Decor/.../CSG10DYMU02/CSG10DYMU02_ART FILE.ai"
 *   → "CSG10DYMU02"
 *
 *   "Decor/.../AA021FPFRA03/ART/file.psd"
 *   → "AA021FPFRA03"
 *
 *   "Decor/.../AAE20DCBM01/AAE20DCBM01_SAMPLE_OLD/file.psd"
 *   → "AAE20DCBM01"  (outermost SKU wins, subfolder absorbed)
 *
 *   "Decor/.../GDC6201/GDC6201_art.ai"
 *   → "GDC6201"
 */
export function extractSkuFolder(relativePath: string): string | null {
  const parts = relativePath.split("/");
  if (parts.length < 2) return null;
  // SKU pattern: 1-6 letters followed by digits/letters (purely alphanumeric, no
  // spaces/underscores/dashes), minimum 10 total characters.
  // The $ anchor is critical — it prevents matching product-category folder names like
  // "AA1_VS1 - Canvas with foil" (which start with letters+digit but contain spaces).
  // Real SKUs are purely alphanumeric: "AA0131P1P01" (11), "CSG10DYMU02" (11).
  const SKU_PATTERN = /^[A-Za-z]{1,6}\d[A-Za-z0-9]*$/;
  // Walk from root toward file — first (outermost) SKU match wins
  for (let i = 0; i < parts.length - 1; i++) {
    const folder = parts[i];
    if (SKU_PATTERN.test(folder) && folder.length >= 10) return folder;
  }
  return null;
}

/**
 * Select the primary asset from a list of assets in the same group.
 *
 * Priority tiers (highest → lowest):
 *  1. in a "photography" subfolder + filename base ends in "3-4" (any file type)
 *  2. "mockup" in filename + usable thumbnail
 *  3. "art" in filename + usable thumbnail
 *  4. other files (not mockup/art/packaging) + usable thumbnail
 *  5. "packaging" in filename + usable thumbnail
 *  6. "mockup" in filename, no usable thumbnail
 *  7. "art" in filename, no usable thumbnail
 *  8. other files, no usable thumbnail
 *  9. "packaging" in filename, no usable thumbnail
 * 10. first asset by created_at (fallback)
 */
export function selectPrimaryAsset(
  assets: Array<{
    id: string;
    filename: string;
    relative_path: string;
    file_type: string;
    created_at: string;
    thumbnail_url?: string | null;
    thumbnail_error?: string | null;
  }>,
): string | null {
  if (assets.length === 0) return null;

  const fn = (a: typeof assets[0]) => a.filename.toLowerCase();
  const isPhotography34 = (a: typeof assets[0]) => {
    const rp = a.relative_path.toLowerCase();
    if (!rp.includes("/professional photos/") && !rp.includes("/prof photos/")) return false;
    const dot = a.filename.lastIndexOf(".");
    const base = (dot >= 0 ? a.filename.slice(0, dot) : a.filename).toLowerCase();
    return base.endsWith("3-4");
  };
  const hasMockup = (a: typeof assets[0]) => fn(a).includes("mockup") || fn(a).includes("mock up");
  const hasArt = (a: typeof assets[0]) => fn(a).includes("art");
  const hasPackaging = (a: typeof assets[0]) => fn(a).includes("packaging");
  const hasUsableThumbnail = (a: typeof assets[0]) => !!a.thumbnail_url && !a.thumbnail_error;
  const isOther = (a: typeof assets[0]) => !hasMockup(a) && !hasArt(a) && !hasPackaging(a);

  // Tier 1: photography subfolder + filename base ends in "3-4" (any file type, any thumbnail state)
  const p1 = assets.find((a) => isPhotography34(a));
  if (p1) return p1.id;

  // Tier 2: mockup + usable thumbnail
  const p2 = assets.find((a) => hasMockup(a) && hasUsableThumbnail(a));
  if (p2) return p2.id;

  // Tier 3: art + usable thumbnail
  const p3 = assets.find((a) => hasArt(a) && hasUsableThumbnail(a));
  if (p3) return p3.id;

  // Tier 4: other (not mockup/art/packaging) + usable thumbnail
  const p4 = assets.find((a) => isOther(a) && hasUsableThumbnail(a));
  if (p4) return p4.id;

  // Tier 5: packaging + usable thumbnail
  const p5 = assets.find((a) => hasPackaging(a) && hasUsableThumbnail(a));
  if (p5) return p5.id;

  // Tier 6: mockup, no usable thumbnail
  const p6 = assets.find((a) => hasMockup(a));
  if (p6) return p6.id;

  // Tier 7: art, no usable thumbnail
  const p7 = assets.find((a) => hasArt(a));
  if (p7) return p7.id;

  // Tier 8: other, no usable thumbnail
  const p8 = assets.find((a) => isOther(a));
  if (p8) return p8.id;

  // Tier 9: packaging, no usable thumbnail
  const p9 = assets.find((a) => hasPackaging(a));
  if (p9) return p9.id;

  // Tier 10: fallback — first by created_at
  return [...assets].sort((a, b) => a.created_at.localeCompare(b.created_at))[0].id;
}
