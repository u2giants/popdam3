/**
 * ColdLion reference data, read from the shared database mirror only.
 * PopDAM never calls the ColdLion API: merch group details live in
 * coldlion.merch_group_detail and items in plm.item (source_system 'coldlion').
 */

import { createClient } from "./supabase-js.ts";

const COMPANY = "EDGEHOME";

// In-memory cache so each lookup hits the database once per isolate
const cache: Record<string, Record<string, string>> = {};
// In-flight reads, so concurrent callers for the same key share one query.
const inFlight = new Map<string, Promise<Record<string, string>>>();

/** Configuration failures must never be swallowed by per-lookup fallbacks. */
export class ColdLionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColdLionConfigError";
  }
}

type Db = ReturnType<typeof createClient>;
let _db: Db | null = null;

function mirrorDb(): Db {
  if (_db) return _db;
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new ColdLionConfigError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  _db = createClient(url, serviceKey);
  return _db;
}

/** Codes are interpolated into read-only SQL, so only plain code characters are allowed. */
function safeCode(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(value)) throw new Error(`Invalid ColdLion ${label}: ${value}`);
  return value;
}

// The coldlion and plm schemas are not exposed through the REST API; read them
// through the read-only SQL RPC.
async function readMirror<T>(query: string): Promise<T[]> {
  const { data, error } = await mirrorDb().rpc("execute_readonly_query", { query_text: query });
  if (error) throw new Error(`ColdLion mirror read failed: ${error.message}`);
  return Array.isArray(data) ? data as T[] : [];
}

/** mgCode → mgDesc for one (mgTypeCode, divisionCode) list. */
export async function getMgLookup(
  mgTypeCode: string,
  divisionCode: string,
): Promise<Record<string, string>> {
  const cacheKey = `${mgTypeCode}:${divisionCode}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const readPromise = readMgLookup(mgTypeCode, divisionCode, cacheKey);
  inFlight.set(cacheKey, readPromise);
  try {
    return await readPromise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function readMgLookup(
  mgTypeCode: string,
  divisionCode: string,
  cacheKey: string,
): Promise<Record<string, string>> {
  const rows = await readMirror<{ mg_code: string; mg_desc: string | null }>(
    `SELECT mg_code, mg_desc FROM coldlion.merch_group_detail
      WHERE company_code = '${COMPANY}' AND mg_type_code = '${safeCode(mgTypeCode, "MG type")}'
        AND division_code = '${safeCode(divisionCode, "division")}'`,
  );
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.mg_code && row.mg_desc) map[row.mg_code] = row.mg_desc;
  }
  cache[cacheKey] = map;
  return map;
}

export type ColdLionItemInfo = { createdTime: string; divisionCode: string };
const itemCache = new Map<string, ColdLionItemInfo | null>();

/**
 * Creation date and division of one ColdLion item, or null when the mirror has
 * no such item. Throws on read failure so callers never mistake it for "new".
 */
export async function getColdLionItemInfo(itemNo: string): Promise<ColdLionItemInfo | null> {
  const key = itemNo.toUpperCase();
  if (itemCache.has(key)) return itemCache.get(key)!;
  const rows = await readMirror<{ created_time: string | null; division_code: string | null }>(
    `SELECT raw ->> 'createdTime' AS created_time, raw ->> 'divisionCode' AS division_code
      FROM plm.item WHERE source_system = 'coldlion' AND upper(trim(item_number)) = '${safeCode(key, "item number")}'
      ORDER BY raw ->> 'createdTime' LIMIT 1`,
  );
  const hit = rows[0];
  const info = hit?.created_time ? { createdTime: String(hit.created_time), divisionCode: String(hit.division_code ?? "") } : null;
  itemCache.set(key, info);
  return info;
}
