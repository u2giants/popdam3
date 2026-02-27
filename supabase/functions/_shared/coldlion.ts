import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const COLDLION_BASE = "http://x5.coldlion.com/EhpApi";
const HARDCODED_KEY = "Z21355JALT13A54L9X5";
const COMPANY = "EDGEHOME";

// In-memory cache so we only fetch once per Edge Function cold start
const cache: Record<string, Record<string, string>> = {};
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
  _apiKey = HARDCODED_KEY;
  return _apiKey;
}

export async function getMgLookup(
  mgTypeCode: string,
  divisionCode: string,
): Promise<Record<string, string>> {
  const cacheKey = `${mgTypeCode}:${divisionCode}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const apiKey = await getApiKey();
  const url = `${COLDLION_BASE}/merchGroupDetails?companyCode=${COMPANY}` +
    `&mgTypeCode=${mgTypeCode}&divisionCode=${divisionCode}`;

  try {
    const res = await fetch(url, {
      headers: { "X-API-Key": apiKey },
    });

    if (!res.ok) {
      console.warn(`ColdLion API ${mgTypeCode}/${divisionCode} returned ${res.status}`);
      return {};
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
    console.warn(`ColdLion API fetch failed for ${mgTypeCode}/${divisionCode}:`, e);
    return {};
  }
}

/**
 * Fetch MG05 (licensor/theme) for all three divisions and merge.
 * Licensed codes come from CW001 and SP001.
 * EH001 codes are unlicensed themes.
 */
export async function getLicensorLookup(): Promise<{
  licensors: Record<string, string>; // code → name (licensed)
  themes: Record<string, string>;    // code → name (unlicensed)
}> {
  const [cw, sp, eh] = await Promise.all([
    getMgLookup("05", "CW001"),
    getMgLookup("05", "SP001"),
    getMgLookup("05", "EH001"),
  ]);

  // Merge CW001 and SP001 — these are licensed licensors
  // Remove ZZ (DTR - NO LICENSE) from licensed set
  const licensors: Record<string, string> = { ...cw, ...sp };
  delete licensors["ZZ"];

  return { licensors, themes: eh };
}

/**
 * Fetch MG06 (property) for a specific division
 */
export async function getPropertyLookup(
  divisionCode: string,
): Promise<Record<string, string>> {
  return getMgLookup("06", divisionCode);
}
