/**
 * Pick a sibling PDF to thumbnail in place of an Illustrator/PSD file that
 * could not be rendered (e.g. saved without PDF compatibility).
 *
 * Match order: exact base name, then a single PDF sharing the file's leading
 * token (SKU-style prefix before the first "_", "-", "." or space, at least
 * 6 characters). E.g. "CRM62SWDV01_ART.ai" → "CRM62SWDV01_LICENSING SHEET.pdf".
 * With several prefix matches the shortest name wins (the plain
 * "X tech pack.pdf" over a dated "X tech pack_102423.pdf"); a tie returns null.
 */
const MIN_TOKEN = 6;

function leadingToken(name: string): string {
  return name.toLowerCase().split(/[_\-. ]/)[0] ?? "";
}

export function pickSiblingPdf(fileName: string, dirEntries: string[]): string | null {
  const base = fileName.replace(/\.[^.]+$/, "").toLowerCase();
  const pdfs = dirEntries.filter((f) => f.toLowerCase().endsWith(".pdf"));

  const exact = pdfs.find((f) => f.slice(0, -4).toLowerCase() === base);
  if (exact) return exact;

  const token = leadingToken(base);
  if (token.length < MIN_TOKEN) return null;
  const candidates = pdfs.filter((f) => leadingToken(f) === token);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => a.length - b.length);
  if (sorted.length > 1 && sorted[0].length === sorted[1].length) return null;
  return sorted[0];
}
