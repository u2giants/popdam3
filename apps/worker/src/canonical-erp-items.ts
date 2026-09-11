import type { DB } from "./supabase.js";

export interface CanonicalItemIdentity {
  source_id: string;
  source_system: string;
  division_code: string | null;
}

export interface CanonicalMgFields {
  mg_category?: string | null;
  mg01_code?: string | null;
  mg02_code?: string | null;
  mg03_code?: string | null;
  mg04_code?: string | null;
  mg05_code?: string | null;
  mg06_code?: string | null;
}

export function canonicalItems(client: DB) {
  return client.schema("api").from("plm_item_list");
}

export async function canonicalItemIdMap(client: DB, items: CanonicalItemIdentity[]): Promise<Map<string, string>> {
  const sourceIds = [...new Set(items.map((item) => item.source_id).filter(Boolean))];
  if (sourceIds.length === 0) return new Map();
  const { data, error } = await client.schema("plm").from("item")
    .select("id, source_system, item_number, raw")
    .eq("source_system", "coldlion")
    .in("item_number", sourceIds);
  if (error) throw new Error(`Failed to resolve canonical item IDs: ${error.message}`);
  return uniqueCanonicalItemIds(data ?? []);
}

/**
 * Maps three-part identities to canonical item IDs. An identity matching more
 * than one canonical item (for example the same number and division under two
 * companies) is ambiguous and is left unresolved rather than guessed.
 */
export function uniqueCanonicalItemIds(
  rows: Array<{ id: string; source_system: string; item_number: string; raw?: { divisionCode?: string | null } | null }>,
): Map<string, string> {
  const ids = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    const key = canonicalItemKey({ source_system: row.source_system, division_code: row.raw?.divisionCode ?? null, source_id: row.item_number });
    if (ambiguous.has(key)) continue;
    const existing = ids.get(key);
    if (existing !== undefined && existing !== row.id) {
      ids.delete(key);
      ambiguous.add(key);
      continue;
    }
    ids.set(key, row.id);
  }
  return ids;
}

/**
 * Picks rows eligible for AI classification. A row whose three-part identity
 * does not resolve to exactly one canonical item is skipped before any AI
 * call: the database would refuse its prediction insert anyway.
 */
export function selectClassificationCandidates<T extends CanonicalItemIdentity & { style_number: string | null }>(
  rows: T[],
  options: { matchedSkuSet: Set<string>; canonicalIds: Map<string, string>; terminalPredictionIds: Set<string>; limit: number },
): T[] {
  const selected: T[] = [];
  for (const row of rows) {
    if (selected.length >= options.limit) break;
    if (!row.style_number) continue;
    if (!options.matchedSkuSet.has(canonicalItemMatchKey(row.style_number, row.division_code))) continue;
    const itemId = options.canonicalIds.get(canonicalItemKey(row));
    if (!itemId) continue;
    if (options.terminalPredictionIds.has(itemId)) continue;
    selected.push(row);
  }
  return selected;
}

/**
 * Keeps only ERP rows whose three-part identity resolves to exactly one
 * canonical item. Ambiguous duplicates (same number and division under two
 * companies) would otherwise write competing values to the same SKU/division,
 * with the last row silently winning.
 */
export function resolvedErpItems<T extends CanonicalItemIdentity>(rows: T[], canonicalIds: Map<string, string>): T[] {
  return rows.filter((row) => canonicalIds.has(canonicalItemKey(row)));
}

export function canonicalItemKey(item: CanonicalItemIdentity): string {
  return `${item.source_system}|${item.division_code ?? ""}|${item.source_id}`;
}

export function canonicalItemMatchKey(styleNumber: string | null, divisionCode: string | null): string {
  return `${divisionCode ?? ""}|${styleNumber ?? ""}`;
}

export function rawMgFieldsFromCanonical(item: CanonicalMgFields): Record<string, string> {
  return Object.fromEntries([
    ["mg_category", item.mg_category],
    ["mg01", item.mg01_code], ["mg01_code", item.mg01_code],
    ["mg02", item.mg02_code], ["mg02_code", item.mg02_code],
    ["mg03", item.mg03_code], ["mg03_code", item.mg03_code],
    ["mg04", item.mg04_code], ["mg05", item.mg05_code], ["mg06", item.mg06_code],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}
