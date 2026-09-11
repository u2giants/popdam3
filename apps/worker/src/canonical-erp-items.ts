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

export function rawMgFieldsFromCanonical(item: CanonicalMgFields): Record<string, string> {
  return Object.fromEntries([
    ["mg_category", item.mg_category],
    ["mg01", item.mg01_code], ["mg01_code", item.mg01_code],
    ["mg02", item.mg02_code], ["mg02_code", item.mg02_code],
    ["mg03", item.mg03_code], ["mg03_code", item.mg03_code],
    ["mg04", item.mg04_code], ["mg05", item.mg05_code], ["mg06", item.mg06_code],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}
