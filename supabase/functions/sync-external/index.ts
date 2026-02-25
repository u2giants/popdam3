import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return json({ ok: false, error: message }, status);
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ── Auth: JWT validation + admin role check ─────────────────────────

async function authenticateAdmin(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return err("Missing or invalid Authorization header", 401);
  }

  const token = authHeader.replace("Bearer ", "");
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data, error } = await anonClient.auth.getClaims(token);
  if (error || !data?.claims) {
    return err("Invalid or expired token", 401);
  }

  const userId = data.claims.sub as string;
  if (!userId) return err("Invalid token: no subject", 401);

  const db = serviceClient();
  const { data: roleRow } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (!roleRow) {
    return err("Forbidden: admin role required", 403);
  }

  return { userId };
}

// ── Hardcoded fallback (legacy) ─────────────────────────────────────

const API_BASE = "https://api.sandbox.designflow.app/api/autofill/properties-and-characters";

const DEFAULT_SOURCES = [
  { code: "DS", name: "Disney", apiUrl: `${API_BASE}/DS`, enabled: true },
  { code: "MV", name: "Marvel", apiUrl: `${API_BASE}/MV`, enabled: true },
  { code: "WWE", name: "WWE", apiUrl: `${API_BASE}/WWE`, enabled: true },
];

// ── Source config type ──────────────────────────────────────────────

interface SyncSource {
  code: string;
  name: string;
  apiUrl: string;
  apiKey?: string;
  enabled: boolean;
}

// ── Sync logic ──────────────────────────────────────────────────────

interface ApiProperty {
  id: number;
  name: string;
  characters: { id: number; name: string }[];
}

interface ApiResponse {
  success: boolean;
  data: ApiProperty[];
}

interface SyncResult {
  licensor: string;
  propertiesUpserted: number;
  charactersUpserted: number;
  errors: string[];
}

async function syncLicensor(
  db: ReturnType<typeof serviceClient>,
  config: SyncSource,
): Promise<SyncResult> {
  const result: SyncResult = {
    licensor: config.name,
    propertiesUpserted: 0,
    charactersUpserted: 0,
    errors: [],
  };

  // 1) Upsert the licensor
  const { data: licensor, error: licErr } = await db
    .from("licensors")
    .upsert(
      { name: config.name, external_id: config.code, updated_at: new Date().toISOString() },
      { onConflict: "external_id" },
    )
    .select("id")
    .single();

  if (licErr || !licensor) {
    result.errors.push(`Failed to upsert licensor ${config.name}: ${licErr?.message}`);
    return result;
  }

  // 2) Fetch from API
  let apiData: ApiProperty[];
  try {
    const headers: Record<string, string> = {};
    if (config.apiKey) headers["X-API-Key"] = config.apiKey;
    const resp = await fetch(config.apiUrl, { headers });
    if (!resp.ok) {
      const text = await resp.text();
      result.errors.push(`API returned ${resp.status} for ${config.code}: ${text.substring(0, 200)}`);
      return result;
    }
    const body: ApiResponse = await resp.json();
    if (!body.success || !Array.isArray(body.data)) {
      result.errors.push(`API returned success=false or missing data for ${config.code}`);
      return result;
    }
    apiData = body.data;
  } catch (e) {
    result.errors.push(`Fetch failed for ${config.code}: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  // 3) Batch upsert properties
  const now = new Date().toISOString();
  const BATCH = 200;

  const propRows = apiData.map((prop) => ({
    name: prop.name,
    external_id: String(prop.id),
    licensor_id: licensor.id,
    updated_at: now,
  }));

  const propIdMap = new Map<string, string>();
  for (let i = 0; i < propRows.length; i += BATCH) {
    const batch = propRows.slice(i, i + BATCH);
    const { data: upserted, error: propErr } = await db
      .from("properties")
      .upsert(batch, { onConflict: "external_id" })
      .select("id, external_id");

    if (propErr) {
      result.errors.push(`Property batch ${i}-${i + batch.length} failed: ${propErr.message}`);
      continue;
    }
    for (const row of upserted || []) {
      propIdMap.set(row.external_id!, row.id);
    }
    result.propertiesUpserted += (upserted || []).length;
  }

  // 4) Batch upsert characters
  const charRows: { name: string; external_id: string; property_id: string; updated_at: string }[] = [];
  for (const prop of apiData) {
    const propId = propIdMap.get(String(prop.id));
    if (!propId) continue;
    for (const char of prop.characters || []) {
      charRows.push({
        name: char.name,
        external_id: String(char.id),
        property_id: propId,
        updated_at: now,
      });
    }
  }

  for (let i = 0; i < charRows.length; i += BATCH) {
    const batch = charRows.slice(i, i + BATCH);
    const { data: upserted, error: charErr } = await db
      .from("characters")
      .upsert(batch, { onConflict: "external_id" })
      .select("id");

    if (charErr) {
      result.errors.push(`Character batch ${i}-${i + batch.length} failed: ${charErr.message}`);
      continue;
    }
    result.charactersUpserted += (upserted || []).length;
  }

  return result;
}

// ── Load sources from admin_config or fallback ──────────────────────

async function loadSources(db: ReturnType<typeof serviceClient>): Promise<SyncSource[]> {
  const { data: configRow } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "TAXONOMY_SYNC_CONFIG")
    .maybeSingle();

  if (configRow?.value && Array.isArray(configRow.value)) {
    return configRow.value as SyncSource[];
  }
  return DEFAULT_SOURCES;
}

// ── Main handler ────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return err("Method not allowed", 405);
  }

  const authResult = await authenticateAdmin(req);
  if (authResult instanceof Response) return authResult;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = (body.action as string) || "sync-all";

  try {
    const db = serviceClient();
    const allSources = await loadSources(db);

    switch (action) {
      case "sync-all": {
        const activeSources = allSources.filter((s) => s.enabled);
        const results: SyncResult[] = [];

        for (const src of activeSources) {
          console.log(`Syncing ${src.name} (${src.code})...`);
          const r = await syncLicensor(db, src);
          results.push(r);
          console.log(`  → ${r.propertiesUpserted} properties, ${r.charactersUpserted} characters, ${r.errors.length} errors`);
        }

        const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
        return json({
          ok: totalErrors === 0,
          results,
          summary: {
            licensors: results.length,
            totalProperties: results.reduce((s, r) => s + r.propertiesUpserted, 0),
            totalCharacters: results.reduce((s, r) => s + r.charactersUpserted, 0),
            totalErrors,
          },
        });
      }

      case "sync-one": {
        const code = (body.licensor_code as string)?.toUpperCase();
        const srcConfig = allSources.find((s) => s.code === code);
        if (!srcConfig) {
          return err(`Unknown licensor code: ${code}. Valid codes: ${allSources.map((s) => s.code).join(", ")}`);
        }

        const r = await syncLicensor(db, srcConfig);
        return json({ ok: r.errors.length === 0, result: r });
      }

      default:
        return err(`Unknown action: ${action}. Valid: sync-all, sync-one`, 404);
    }
  } catch (e) {
    console.error("sync-external error:", e);
    return err(e instanceof Error ? e.message : "Internal server error", 500);
  }
});
