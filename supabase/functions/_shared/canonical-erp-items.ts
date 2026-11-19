import { uniqueCanonicalItemIds, type CanonicalItemIdentity } from "./canonical-item-identity.js";
export { canonicalItemKey, canonicalItemMatchKey, uniqueCanonicalItemIds, type CanonicalItemIdentity } from "./canonical-item-identity.js";
import type { ServiceClient } from "./service-client.ts";

export const CANONICAL_ITEM_SCHEMA = "api";
export const CANONICAL_ITEM_VIEW = "plm_item_list";

export interface CanonicalMgFields {
  mg_category?: string | null;
  mg01_code?: string | null;
  mg02_code?: string | null;
  mg03_code?: string | null;
  mg04_code?: string | null;
  mg05_code?: string | null;
  mg06_code?: string | null;
}

export function canonicalItems(db: ServiceClient) {
  return db.schema(CANONICAL_ITEM_SCHEMA).from(CANONICAL_ITEM_VIEW);
}

export async function canonicalItemIdMap(db: ServiceClient, items: CanonicalItemIdentity[]): Promise<Map<string, string>> {
  const sourceIds = [...new Set(items.map((item) => item.source_id).filter(Boolean))];
  if (sourceIds.length === 0) return new Map();
  // The plm schema is not exposed through the REST API; read it through the
  // read-only SQL RPC instead of db.schema("plm").
  const list = sourceIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
  const { data, error } = await db.rpc("execute_readonly_query", {
    query_text: `SELECT id, source_system, item_number, jsonb_build_object('divisionCode', raw ->> 'divisionCode') AS raw
      FROM plm.item WHERE source_system = 'coldlion' AND item_number IN (${list})`,
  });
  if (error) throw new Error(`Failed to resolve canonical item IDs: ${error.message}`);
  return uniqueCanonicalItemIds(Array.isArray(data) ? data : []);
}

export function canonicalItemKeySql(alias = "e"): string {
  return `${alias}.source_system || '|' || coalesce(${alias}.division_code, '') || '|' || ${alias}.source_id`;
}

export function predictionSourceId(key: string): string {
  const parts = key.split("|");
  return parts.length === 3 ? parts[2] : key;
}

export function rawMgFieldsFromCanonical(item: CanonicalMgFields): Record<string, string> {
  return Object.fromEntries([
    ["mg_category", item.mg_category],
    ["mg01", item.mg01_code],
    ["mg01_code", item.mg01_code],
    ["mg02", item.mg02_code],
    ["mg02_code", item.mg02_code],
    ["mg03", item.mg03_code],
    ["mg03_code", item.mg03_code],
    ["mg04", item.mg04_code],
    ["mg05", item.mg05_code],
    ["mg06", item.mg06_code],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}
