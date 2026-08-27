import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const COLDLION_BASE = "http://x5.coldlion.com/EhpApi";
const COMPANY = "EDGEHOME";

// In-memory cache so we only fetch once per Edge Function cold start
const cache: Record<string, Record<string, string>> = {};
// In-flight fetches, so concurrent callers for the same key share one request
// instead of each stampeding ColdLion before the cache is populated.
const inFlight = new Map<string, Promise<Record<string, string>>>();
let _apiKey: string | null = null;

async function getApiKey(): Promise<string> {
  if (_apiKey) return _apiKey;
  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await db
      .from("admin_config")
      .select("value")
      .eq("key", "COLDLION_API_KEY")
      .maybeSingle();
    if (data?.value && typeof data.value === "string" && data.value.trim()) {
      _apiKey = data.value.trim();
      return _apiKey;
    }
  } catch (e) {
    console.warn("Failed to read COLDLION_API_KEY from admin_config:", e);
  }
  throw new Error("COLDLION_API_KEY is missing from admin_config");
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
  const apiKey = await getApiKey();
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
    return map;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`ColdLion API fetch failed for ${mgTypeCode}/${divisionCode}: ${message}`);
  }
}
