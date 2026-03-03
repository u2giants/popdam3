import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, " +
    "x-supabase-client-platform, x-supabase-client-platform-version, " +
    "x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ERP_ENDPOINT = "https://api.item.designflow.app/lib/getApiAllItems";
const BATCH_SIZE = 100;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, error: "Missing env vars" }, 500);
  }

  const db = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Auth: only service role or admin JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Missing auth" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    if (token !== serviceRoleKey) {
      // Validate JWT + admin role
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      let userId: string | undefined;
      try {
        const { data: { user }, error } = await anonClient.auth.getUser(token);
        if (error || !user?.id) return json({ ok: false, error: "Invalid token" }, 401);
        userId = user.id;
      } catch {
        return json({ ok: false, error: "Invalid token" }, 401);
      }
      const { data: roleRow } = await db.from("user_roles").select("role")
        .eq("user_id", userId).eq("role", "admin").maybeSingle();
      if (!roleRow) return json({ ok: false, error: "Admin required" }, 403);
    }

    // Check run lock
    const { data: runningRuns } = await db.from("erp_sync_runs")
      .select("id").eq("status", "running").limit(1);
    if (runningRuns && runningRuns.length > 0) {
      return json({ ok: false, error: "A sync is already running", running_id: runningRuns[0].id }, 409);
    }

    // Create sync run
    const { data: run, error: runErr } = await db.from("erp_sync_runs")
      .insert({ status: "running", created_by: "erp-sync" })
      .select("id").single();
    if (runErr || !run) return json({ ok: false, error: "Failed to create sync run" }, 500);
    const runId = run.id;

    console.log(`erp-sync: starting run ${runId}`);

    // Fetch from ERP API
    let items: unknown[];
    try {
      const resp = await fetch(ERP_ENDPOINT, { signal: AbortSignal.timeout(120_000) });
      if (!resp.ok) throw new Error(`ERP API returned ${resp.status}`);
      const responseText = await resp.text();
      console.log(`erp-sync: raw response length=${responseText.length}, first 200 chars: ${responseText.substring(0, 200)}`);

      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        // Attempt to recover truncated JSON array
        const lastBrace = responseText.lastIndexOf("}");
        if (lastBrace > 0) {
          try {
            parsed = JSON.parse(responseText.substring(0, lastBrace + 1) + "]");
            console.warn(`erp-sync: recovered truncated JSON`);
          } catch {
            throw new Error("Cannot parse ERP response (truncated JSON recovery failed)");
          }
        } else {
          throw new Error("Cannot parse ERP response as JSON");
        }
      }

      // Handle both bare array and wrapper object formats
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        const arrayField = obj.items || obj.data || obj.results || obj.records;
        if (Array.isArray(arrayField)) {
          items = arrayField;
          console.log(`erp-sync: extracted array from wrapper key (length=${items.length})`);
        } else {
          const arrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
          if (arrayKey) {
            items = obj[arrayKey] as unknown[];
            console.log(`erp-sync: extracted array from key "${arrayKey}" (length=${items.length})`);
          } else {
            console.error("erp-sync: response object keys:", Object.keys(obj));
            throw new Error(`ERP response is an object with keys [${Object.keys(obj).join(", ")}] but no array found`);
          }
        }
      } else {
        throw new Error(`ERP response is unexpected type: ${typeof parsed}`);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Unknown fetch error";
      await db.from("erp_sync_runs").update({
        status: "failed",
        ended_at: new Date().toISOString(),
        total_errors: 1,
        error_samples: [errMsg],
      }).eq("id", runId);
      return json({ ok: false, error: `ERP fetch failed: ${errMsg}` }, 502);
    }

    console.log(`erp-sync: fetched ${items.length} items`);

    let totalUpserted = 0;
    let totalErrors = 0;
    const errorSamples: string[] = [];

    // Process in batches
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);

      try {
        // Insert raw snapshots
        const rawRows = batch.map((item: any) => ({
          external_id: String(item.itemNum || item.styleNumber || item.itemCode || item.id || `unknown-${i}`),
          raw_payload: item,
          sync_run_id: runId,
        }));
        await db.from("erp_items_raw").insert(rawRows);

        // Upsert normalized rows
        // Map actual DesignFlow API fields to our schema
        const normalizedRows = batch.map((item: any) => {
          const externalId = String(item.itemNum || item.styleNumber || item.itemCode || item.id || `unknown-${i}`);
          
          // Extract MG codes from DesignFlow field names
          // API uses: "Product Type ( Material)" for MG01, "Product Sub-Type (Construction)" for MG02,
          // "Product Sub-Sub-Type (feature)" for MG03
          const mg01 = item["Product Type ( Material)"] || item["Product Type (Material)"] || item.mg01 || item.merchGroup01 || null;
          const mg02 = item["Product Sub-Type (Construction)"] || item.mg02 || item.merchGroup02 || null;
          const mg03 = item["Product Sub-Sub-Type (feature)"] || item["Product Sub-Sub-Type(feature)"] || item.mg03 || item.merchGroup03 || null;
          
          return {
            external_id: externalId,
            style_number: item.itemNum || item.styleNumber || null,
            item_description: item.item_name || item.itemDescription || item.description || null,
            mg_category: item.mgCategory || null,
            mg01_code: mg01,
            mg02_code: mg02,
            mg03_code: mg03,
            mg04_code: item.mg04 || item.merchGroup04 || null,
            mg05_code: item.mg05 || item.merchGroup05 || null,
            mg06_code: item.mg06 || item.merchGroup06 || null,
            size_code: item.size || item.sizeCode || null,
            licensor_code: item.licensor || item.licensorCode || null,
            property_code: item.property || item.propertyCode || null,
            division_code: item.divisionCode || null,
            erp_updated_at: item.updatedAt || item.lastModified || null,
            sync_run_id: runId,
            synced_at: new Date().toISOString(),
            raw_mg_fields: {
              mg01: mg01,
              mg02: mg02,
              mg03: mg03,
              mg04: item.mg04 || item.merchGroup04,
              mg05: item.mg05 || item.merchGroup05,
              mg06: item.mg06 || item.merchGroup06,
              mgCategory: item.mgCategory,
              size: item.size,
              licensor: item.licensor,
              property: item.property,
              season: item.season,
              status: item.status,
            },
          };
        });

        const { error: upsertErr } = await db.from("erp_items_current")
          .upsert(normalizedRows, { onConflict: "external_id" });

        if (upsertErr) {
          totalErrors += batch.length;
          if (errorSamples.length < 5) errorSamples.push(upsertErr.message);
        } else {
          totalUpserted += batch.length;
        }
      } catch (e) {
        totalErrors += batch.length;
        if (errorSamples.length < 5) {
          errorSamples.push(e instanceof Error ? e.message : "Unknown batch error");
        }
      }

      // Progress update every 500 items
      if (i > 0 && i % 500 === 0) {
        await db.from("erp_sync_runs").update({
          total_fetched: items.length,
          total_upserted: totalUpserted,
          total_errors: totalErrors,
        }).eq("id", runId);
      }
    }

    // Finalize run
    await db.from("erp_sync_runs").update({
      status: totalErrors > 0 && totalUpserted === 0 ? "failed" : "completed",
      ended_at: new Date().toISOString(),
      total_fetched: items.length,
      total_upserted: totalUpserted,
      total_errors: totalErrors,
      error_samples: errorSamples,
    }).eq("id", runId);

    console.log(`erp-sync: run ${runId} completed — fetched=${items.length}, upserted=${totalUpserted}, errors=${totalErrors}`);

    return json({
      ok: true,
      run_id: runId,
      total_fetched: items.length,
      total_upserted: totalUpserted,
      total_errors: totalErrors,
    });
  } catch (e) {
    console.error("erp-sync unhandled error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
