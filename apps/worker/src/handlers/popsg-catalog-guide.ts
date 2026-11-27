// Catalog guide for PopSG picture tagging (#1505). A file's candidate names
// come from the shared catalog: its licensor folder maps (admin_config
// POPSG_LICENSOR_CATALOG_MAP) to core licensors, its property or style-guide
// folder matches a property of those licensors only, and that property's
// scraped characters are the only names the model may choose.
import { db } from "../supabase.js";
import { LICENSOR_CHARACTER_LIST_LIMIT, NOT_A_CHARACTER } from "./ai-tagging-shared.js";
import { normalizePopSGTag } from "./popsg-tags.js";

export const POPSG_LICENSOR_MAP_KEY = "POPSG_LICENSOR_CATALOG_MAP";

export interface CatalogCharacter { id: string; name: string }
export interface PopSGCatalog {
  licensorMap: Record<string, string[]>;
  licensors: Map<string, string>;
  properties: Array<{ id: string; licensor_id: string; name: string; names: string[] }>;
  propertyCharacters: Map<string, CatalogCharacter[]>;
  licensorCharacters: Map<string, CatalogCharacter[]>;
}
export interface PopSGGuide {
  licensorIds: string[]; propertyIds: string[];
  characters: CatalogCharacter[];
  /** Normalized names this file may carry: characters, its properties, its licensors. */
  allowedNames: Set<string>;
}

const GENERIC = new Set(["style", "guide", "guides", "styleguide", "assets", "asset", "art", "holiday", "packaging", "multi", "property",
  "properties", "classic", "classics", "vintage", "core", "franchise", "collection", "archive", "publishing", "universe", "shows",
  "show", "movie", "live", "action", "theatrical", "releases", "and", "the", "of", "for", "new", "misc", "other", "general", "brand", "logos"]);

/** Folder/property name to comparable words: lowercase, & → and, no bracketed text, no leading "the". */
export function normName(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ").replace(/\bxmas\b/g, "christmas").replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "").replace(/, the$/, "").trim();
}
function keyWords(s: string, ignore: ReadonlySet<string> = new Set()): string[] {
  return normName(s).split(" ").filter(w => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC.has(w) && !ignore.has(w));
}

/**
 * 2 = exact name, 1 = every key word of the folder appears in the property
 * name, 0 = no match. `ignore` holds the licensor's own name words, so a
 * folder named after the licensor never matches every property it owns.
 */
export function folderScore(folder: string, propertyName: string, ignore: ReadonlySet<string> = new Set()): number {
  const f = normName(folder), p = normName(propertyName);
  if (!f || !p) return 0;
  if (f === p) return 2;
  const words = keyWords(folder, ignore);
  if (!words.length) return 0;
  const have = new Set(p.split(" "));
  return words.every(w => have.has(w)) ? 1 : 0;
}

function dedupe(chars: CatalogCharacter[]): CatalogCharacter[] {
  return [...new Map(chars.filter(c => c.id && c.name && !NOT_A_CHARACTER.test(c.name)).map(c => [c.id, c])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resolvePopSGGuide(
  file: { licensor_name: string | null; property_folder: string | null; style_guide_folder: string | null },
  catalog: PopSGCatalog,
): PopSGGuide {
  const licensorIds = catalog.licensorMap[(file.licensor_name ?? "").trim().toLowerCase()] ?? [];
  const scoped = catalog.properties.filter(p => licensorIds.includes(p.licensor_id));
  const ignore = new Set([file.licensor_name ?? "", ...licensorIds.map(id => catalog.licensors.get(id) ?? "")].flatMap(n => normName(n).split(" ")));
  let picked: Array<{ id: string; score: number }> = [];
  for (const folder of [file.style_guide_folder, file.property_folder]) {
    if (!folder) continue;
    const scored = scoped.map(p => ({ id: p.id, score: Math.max(0, ...p.names.map(n => folderScore(folder, n, ignore))) })).filter(s => s.score > 0);
    const best = Math.max(0, ...scored.map(s => s.score));
    if (best) { picked = scored.filter(s => s.score === best); break; }
  }
  let characters: CatalogCharacter[] = [];
  if (picked.length) {
    characters = dedupe(picked.flatMap(p => catalog.propertyCharacters.get(p.id) ?? []));
    if (characters.length > LICENSOR_CHARACTER_LIST_LIMIT) characters = [];
  } else {
    const all = dedupe(licensorIds.flatMap(id => catalog.licensorCharacters.get(id) ?? []));
    characters = all.length <= LICENSOR_CHARACTER_LIST_LIMIT ? all : [];
  }
  const propertyIds = picked.map(p => p.id);
  const allowedNames = new Set<string>();
  for (const c of characters) allowedNames.add(normalizePopSGTag(c.name));
  for (const p of catalog.properties) if (propertyIds.includes(p.id)) for (const n of p.names) allowedNames.add(normalizePopSGTag(n));
  for (const id of licensorIds) { const n = catalog.licensors.get(id); if (n) allowedNames.add(normalizePopSGTag(n)); }
  allowedNames.delete("");
  return { licensorIds, propertyIds, characters, allowedNames };
}

async function readAll<T>(load: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await load(from, from + 999);
    if (error) throw new Error(`catalog ${label}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const TTL_MS = 3_600_000;
let cached: { at: number; catalog: PopSGCatalog } | null = null;

export async function loadPopSGCatalog(): Promise<PopSGCatalog> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.catalog;
  const client = db();
  const core = () => client.schema("core");
  const map = await client.from("admin_config").select("value").eq("key", POPSG_LICENSOR_MAP_KEY).maybeSingle();
  if (map.error || !map.data?.value || typeof map.data.value !== "object") throw new Error(`catalog ${POPSG_LICENSOR_MAP_KEY} missing`);
  const licensors = await readAll<{ id: string; name: string }>((a, b) => core().from("licensor").select("id, name").order("id").range(a, b), "licensor");
  const props = await readAll<{ id: string; licensor_id: string; name: string; short_name: string | null; nickname: string | null; submission_property_name: string | null; status: string | null }>(
    (a, b) => core().from("property").select("id, licensor_id, name, short_name, nickname, submission_property_name, status").order("id").range(a, b), "property");
  const chars = await readAll<{ id: string; licensor_id: string | null; name: string; status: string | null }>(
    (a, b) => core().from("character").select("id, licensor_id, name, status").order("id").range(a, b), "character");
  const links = await readAll<{ property_id: string; character_id: string }>(
    (a, b) => core().from("property_character_associations").select("property_id, character_id").eq("is_current", true).order("property_id").order("character_id").range(a, b), "links");
  const edges = await readAll<{ property_id: string; character_id: string }>(
    (a, b) => core().from("property_character_source_edge").select("property_id, character_id").eq("evidence_kind", "co_occurrence").eq("is_current", true).order("property_id").order("character_id").range(a, b), "edges");
  const live = (s: string | null) => !["archived", "deleted"].includes(s ?? "");
  const charById = new Map(chars.filter(c => live(c.status)).map(c => [c.id, { id: c.id, name: c.name }]));
  const propertyCharacters = new Map<string, CatalogCharacter[]>();
  for (const l of [...links, ...edges]) {
    const c = charById.get(l.character_id);
    if (!c) continue;
    const list = propertyCharacters.get(l.property_id) ?? [];
    list.push(c);
    propertyCharacters.set(l.property_id, list);
  }
  const licensorCharacters = new Map<string, CatalogCharacter[]>();
  for (const c of chars) {
    if (!c.licensor_id || !live(c.status)) continue;
    const list = licensorCharacters.get(c.licensor_id) ?? [];
    list.push({ id: c.id, name: c.name });
    licensorCharacters.set(c.licensor_id, list);
  }
  const catalog: PopSGCatalog = {
    licensorMap: map.data.value as Record<string, string[]>,
    licensors: new Map(licensors.map(l => [l.id, l.name])),
    properties: props.filter(p => live(p.status)).map(p => ({ id: p.id, licensor_id: p.licensor_id, name: p.name,
      names: [p.name, p.short_name, p.nickname, p.submission_property_name].filter((n): n is string => !!n?.trim()) })),
    propertyCharacters, licensorCharacters,
  };
  cached = { at: Date.now(), catalog };
  return catalog;
}
