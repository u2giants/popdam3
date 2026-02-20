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

// ── Licensor config: code → name + API slug ─────────────────────────

interface LicensorConfig {
  code: string;
  name: string;
  apiSlug: string;
}

const LICENSORS: LicensorConfig[] = [
  { code: "DS", name: "Disney", apiSlug: "DS" },
  { code: "MV", name: "Marvel", apiSlug: "MV" },
  { code: "WWE", name: "WWE", apiSlug: "WWE" },
];

const API_BASE = "https://api.sandbox.designflow.app/api/autofill/properties-and-characters";

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
  config: LicensorConfig,
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

  // 2) Fetch from DesignFlow API
  let apiData: ApiProperty[];
  try {
    const resp = await fetch(`${API_BASE}/${config.apiSlug}`);
    if (!resp.ok) {
      const text = await resp.text();
      result.errors.push(`API returned ${resp.status} for ${config.apiSlug}: ${text.substring(0, 200)}`);
      return result;
    }
    const body: ApiResponse = await resp.json();
    if (!body.success || !Array.isArray(body.data)) {
      result.errors.push(`API returned success=false or missing data for ${config.apiSlug}`);
      return result;
    }
    apiData = body.data;
  } catch (e) {
    result.errors.push(`Fetch failed for ${config.apiSlug}: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  // 3) Upsert properties + characters
  for (const prop of apiData) {
    const externalPropId = String(prop.id);

    const { data: propRow, error: propErr } = await db
      .from("properties")
      .upsert(
        {
          name: prop.name,
          external_id: externalPropId,
          licensor_id: licensor.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "external_id" },
      )
      .select("id")
      .single();

    if (propErr || !propRow) {
      result.errors.push(`Failed to upsert property "${prop.name}" (ext:${externalPropId}): ${propErr?.message}`);
      continue;
    }
    result.propertiesUpserted++;

    for (const char of prop.characters || []) {
      const externalCharId = String(char.id);

      const { error: charErr } = await db
        .from("characters")
        .upsert(
          {
            name: char.name,
            external_id: externalCharId,
            property_id: propRow.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "external_id" },
        );

      if (charErr) {
        result.errors.push(`Failed to upsert character "${char.name}" (ext:${externalCharId}): ${charErr.message}`);
        continue;
      }
      result.charactersUpserted++;
    }
  }

  return result;
}

// ── Main handler ────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return err("Method not allowed", 405);
  }

  // Authenticate admin
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
    switch (action) {
      case "sync-all": {
        const db = serviceClient();
        const results: SyncResult[] = [];

        for (const lic of LICENSORS) {
          console.log(`Syncing ${lic.name} (${lic.apiSlug})...`);
          const r = await syncLicensor(db, lic);
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
        const licConfig = LICENSORS.find((l) => l.code === code);
        if (!licConfig) {
          return err(`Unknown licensor code: ${code}. Valid codes: ${LICENSORS.map((l) => l.code).join(", ")}`);
        }

        const db = serviceClient();
        const r = await syncLicensor(db, licConfig);
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
