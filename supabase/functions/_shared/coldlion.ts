import { ColdLionBreaker } from "./coldlion-breaker.ts";
import { createClient } from "./supabase-js.ts";

// One breaker per isolate: an outage costs one timeout per cooldown, not one per call.
const breaker = new ColdLionBreaker();

const COLDLION_BASE = "http://x5.coldlion.com/EhpApi";
const COMPANY = "EDGEHOME";

// In-memory cache so we only fetch once per Edge Function cold start
const cache: Record<string, Record<string, string>> = {};
// In-flight fetches, so concurrent callers for the same key share one request
// instead of each stampeding ColdLion before the cache is populated.
const inFlight = new Map<string, Promise<Record<string, string>>>();
let _apiKey: string | null = null;

/** Configuration failures must never be swallowed by per-lookup fallbacks. */
export class ColdLionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColdLionConfigError";
  }
}

/**
 * Reads COLDLION_API_KEY. Missing env or a missing/empty row is a configuration
 * error (ColdLionConfigError, must surface). A failed read (network, PostgREST
 * error object, thrown client) is transient and stays non-fatal like any outage.
 */
export async function readColdLionApiKey(): Promise<string> {
  if (_apiKey) return _apiKey;
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new ColdLionConfigError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  let data: { value?: unknown } | null;
  try {
    const db = createClient(url, serviceKey);
    const res = await db
      .from("admin_config")
      .select("value")
      .eq("key", "COLDLION_API_KEY")
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    data = res.data;
  } catch (e) {
    throw new Error(`COLDLION_API_KEY read failed: ${e instanceof Error ? e.message : e}`);
  }
  if (data?.value && typeof data.value === "string" && data.value.trim()) {
    _apiKey = data.value.trim();
    return _apiKey;
  }
  throw new ColdLionConfigError("COLDLION_API_KEY is missing from admin_config");
}

export async function getMgLookup(
  mgTypeCode: string,
  divisionCode: string,
): Promise<Record<string, string>> {
  const cacheKey = `${mgTypeCode}:${divisionCode}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const fetchPromise = fetchMgLookup(mgTypeCode, divisionCode, cacheKey);
  inFlight.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function fetchMgLookup(
  mgTypeCode: string,
  divisionCode: string,
  cacheKey: string,
): Promise<Record<string, string>> {
  const apiKey = await readColdLionApiKey();
  breaker.assertClosed(`${mgTypeCode}/${divisionCode}`);
  const url = `${COLDLION_BASE}/merchGroupDetails?companyCode=${COMPANY}` +
    `&mgTypeCode=${mgTypeCode}&divisionCode=${divisionCode}`;

  try {
    const res = await fetch(url, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`ColdLion API ${mgTypeCode}/${divisionCode} returned ${res.status}`);
    }

    const data = await res.json();
    const map: Record<string, string> = {};
    // API returns a plain array (not wrapped in { value: [...] })
    const items = Array.isArray(data) ? data : (data.value ?? []);
    for (const item of items) {
      map[item.mgCode] = item.mgDesc;
    }
    cache[cacheKey] = map;
    breaker.recordSuccess();
    return map;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    breaker.recordFailure(message);
    throw new Error(`ColdLion API fetch failed for ${mgTypeCode}/${divisionCode}: ${message}`);
  }
}

export type ColdLionItemInfo = { createdTime: string; divisionCode: string };
const itemCache = new Map<string, ColdLionItemInfo | null>();

/**
 * Creation date and division of one ColdLion item, or null when ColdLion has no
 * such item. Throws on API failure so callers never mistake an outage for "new".
 */
export async function getColdLionItemInfo(itemNo: string): Promise<ColdLionItemInfo | null> {
  const key = itemNo.toUpperCase();
  if (itemCache.has(key)) return itemCache.get(key)!;
  const apiKey = await readColdLionApiKey();
  breaker.assertClosed(`items/${key}`);
  const url = `${COLDLION_BASE}/items?companyCode=${COMPANY}&itemNo=${encodeURIComponent(key)}`;
  let data;
  try {
    const res = await fetch(url, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ColdLion API items/${key} returned ${res.status}`);
    data = await res.json();
  } catch (e) {
    breaker.recordFailure(e instanceof Error ? e.message : String(e));
    throw e;
  }
  breaker.recordSuccess();
  const items = Array.isArray(data) ? data : (data.content ?? data.value ?? []);
  const hit = items.find((i: { itemNo?: string }) => i.itemNo?.toUpperCase() === key);
  const info = hit ? { createdTime: String(hit.createdTime), divisionCode: String(hit.divisionCode) } : null;
  itemCache.set(key, info);
  return info;
}
