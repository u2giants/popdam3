/**
 * Which licensors a search names (issue #892).
 *
 * The picture leg matches what a product LOOKS like, so "<licensor> toy chest"
 * also returned every other licensor's toy chest. When a search names a
 * licensor, search_dam_documents keeps a picture-only match only if it belongs
 * to that licensor (p_filters.semanticLicensorIds, popcre/shared-db#6002).
 * Keyword matches are never affected.
 *
 * Browser and Deno shared code: keep this dependency-free.
 */

export type LicensorName = { id: string; name: string };

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Ids of every licensor whose whole name appears, on word boundaries, in any of the texts. */
export function namedLicensorIds(texts: ReadonlyArray<string | null | undefined>, licensors: ReadonlyArray<LicensorName>): string[] {
  const padded = texts.map((text) => ` ${normalize(text ?? "")} `).filter((text) => text.trim());
  const ids = new Set<string>();
  for (const { id, name } of licensors) {
    const wanted = normalize(name);
    if (wanted && padded.some((text) => text.includes(` ${wanted} `))) ids.add(id);
  }
  return [...ids].sort();
}

/** Filters for one search call: the licensor scope applies only when pictures are searched. */
export function withSemanticLicensorScope(
  filters: Record<string, unknown>,
  licensorIds: ReadonlyArray<string>,
  usesPictures: boolean,
): Record<string, unknown> {
  // An explicit licensor filter already limits every match; nothing to add.
  if (!usesPictures || licensorIds.length === 0 || filters.licensorId) return filters;
  return { ...filters, semanticLicensorIds: [...licensorIds] };
}
