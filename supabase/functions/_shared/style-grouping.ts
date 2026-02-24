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
 * Priority:
 * 1. Filename contains "ART" (case-insensitive) AND extension is .ai or .psd
 * 2. Filename contains "ART" (any extension)
 * 3. First .ai file
 * 4. First .psd file
 * 5. First asset by created_at
 */
export function selectPrimaryAsset(
  assets: Array<{ id: string; filename: string; file_type: string; created_at: string }>,
): string | null {
  if (assets.length === 0) return null;

  const hasArt = (f: string) => f.toLowerCase().includes("art");
  const isAiOrPsd = (t: string) => t === "ai" || t === "psd";

  // Priority 1
  const p1 = assets.find((a) => hasArt(a.filename) && isAiOrPsd(a.file_type));
  if (p1) return p1.id;

  // Priority 2
  const p2 = assets.find((a) => hasArt(a.filename));
  if (p2) return p2.id;

  // Priority 3
  const p3 = assets.find((a) => a.file_type === "ai");
  if (p3) return p3.id;

  // Priority 4
  const p4 = assets.find((a) => a.file_type === "psd");
  if (p4) return p4.id;

  // Priority 5
  return assets.sort((a, b) => a.created_at.localeCompare(b.created_at))[0].id;
}
