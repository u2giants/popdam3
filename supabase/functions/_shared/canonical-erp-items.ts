import type { ServiceClient } from "./service-client.ts";

export const CANONICAL_ITEM_SCHEMA = "api";
export const CANONICAL_ITEM_VIEW = "plm_item_list";

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

export function canonicalItems(db: ServiceClient) {
  return db.schema(CANONICAL_ITEM_SCHEMA).from(CANONICAL_ITEM_VIEW);
}

export async function canonicalItemIdMap(db: ServiceClient, items: CanonicalItemIdentity[]): Promise<Map<string, string>> {
  const sourceIds = [...new Set(items.map((item) => item.source_id).filter(Boolean))];
  if (sourceIds.length === 0) return new Map();
  const { data, error } = await db.schema("plm").from("item")
    .select("id, source_system, item_number, raw")
    .eq("source_system", "coldlion")
    .in("item_number", sourceIds);
  if (error) throw new Error(`Failed to resolve canonical item IDs: ${error.message}`);
  return new Map((data ?? []).map((item: any) => [
    canonicalItemKey({ source_system: item.source_system, division_code: item.raw?.divisionCode ?? null, source_id: item.item_number }),
    item.id,
  ]));
}

export function canonicalItemKey(item: CanonicalItemIdentity): string {
  return `${item.source_system}|${item.division_code ?? ""}|${item.source_id}`;
}

export function canonicalItemMatchKey(styleNumber: string | null, divisionCode: string | null): string {
  return `${divisionCode ?? ""}|${styleNumber ?? ""}`;
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
