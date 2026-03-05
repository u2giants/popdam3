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
const WATERMARK_KEY = "ERP_LAST_SYNC_DATE";
const DEFAULT_CATEGORY_CUTOFF = "2025-05-10";
/** Hard floor: reject any item created before this date */
const INGESTION_MIN_DATE = "2020-01-01";

/** Format a Date as YYYY-MM-DD */
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, error: "Missing env vars" }, 500);
  }

  const db = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Missing auth" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    if (token !== serviceRoleKey) {
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

    // ── Parse request body ────────────────────────────────────────────
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch { /* empty body is fine */ }

    const forceFullSync = body.full_sync === true;
    let startDate: string | undefined = body.startDate as string | undefined;
    let endDate: string | undefined = body.endDate as string | undefined;

    // ── Resolve date range ────────────────────────────────────────────
    // If no explicit dates and not a forced full sync, read watermark
    if (!startDate && !forceFullSync) {
      const { data: wm } = await db.from("admin_config")
        .select("value").eq("key", WATERMARK_KEY).maybeSingle();
      if (wm?.value) {
        // value could be wrapped or raw string
        const raw = typeof wm.value === "string" ? wm.value : (wm.value as any)?.value ?? wm.value;
        const parsed = typeof raw === "string" ? raw : String(raw);
        if (/^\d{4}-\d{2}-\d{2}/.test(parsed)) {
          startDate = parsed.slice(0, 10);
          console.log(`erp-sync: using watermark startDate=${startDate}`);
        }
      }
    }

    // Default endDate = today
    if (!endDate) {
      endDate = fmtDate(new Date());
    }

    const syncMode = startDate ? "incremental" : "full";
    console.log(`erp-sync: mode=${syncMode}, startDate=${startDate ?? "none"}, endDate=${endDate}`);

    // ── Run lock ──────────────────────────────────────────────────────
    const { data: runningRuns } = await db.from("erp_sync_runs")
      .select("id").eq("status", "running").limit(1);
    if (runningRuns && runningRuns.length > 0) {
      return json({ ok: false, error: "A sync is already running", running_id: runningRuns[0].id }, 409);
    }

    // ── Create sync run ───────────────────────────────────────────────
    const runMeta = { sync_mode: syncMode, start_date: startDate ?? null, end_date: endDate };
    const { data: run, error: runErr } = await db.from("erp_sync_runs")
      .insert({ status: "running", created_by: "erp-sync", run_metadata: runMeta })
      .select("id").single();
    if (runErr || !run) return json({ ok: false, error: "Failed to create sync run" }, 500);
    const runId = run.id;

    console.log(`erp-sync: starting run ${runId}`);

    // ── Fetch from ERP API ────────────────────────────────────────────
    let items: unknown[];
    try {
      const url = new URL(ERP_ENDPOINT);
      if (startDate) url.searchParams.set("startDate", startDate);
      if (endDate) url.searchParams.set("endDate", endDate);

      console.log(`erp-sync: fetching ${url.toString()}`);
      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(120_000) });
      if (!resp.ok) throw new Error(`ERP API returned ${resp.status}`);
      const responseText = await resp.text();
      console.log(`erp-sync: raw response length=${responseText.length}, first 200 chars: ${responseText.substring(0, 200)}`);

      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        // Attempt to recover truncated JSON
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

      // Handle wrapper formats: { rows: [...] }, bare array, or other keys
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        // Prioritize "rows" since that's what the API returns
        const arrayField = obj.rows || obj.items || obj.data || obj.results || obj.records;
        if (Array.isArray(arrayField)) {
          items = arrayField;
          console.log(`erp-sync: extracted array from wrapper (length=${items.length}, totalCount=${obj.totalCount ?? "n/a"})`);
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

    // ── Filter out items before ingestion floor ────────────────────────
    const originalCount = items.length;
    items = items.filter((item: any) => {
      const createdDate = item.created_date || item.createdDate || null;
      if (!createdDate) return true; // No date = keep (can't determine age)
      const dateStr = String(createdDate).slice(0, 10);
      return dateStr >= INGESTION_MIN_DATE;
    });
    const rejectedCount = originalCount - items.length;
    if (rejectedCount > 0) {
      console.log(`erp-sync: rejected ${rejectedCount} items created before ${INGESTION_MIN_DATE} (${items.length} remaining)`);
    }

    let totalUpserted = 0;
    let totalErrors = 0;
    const errorSamples: string[] = [];

    // ── Read category cutoff from admin_config ──────────────────────────
    let categoryCutoff = DEFAULT_CATEGORY_CUTOFF;
    try {
      const { data: cutoffRow } = await db.from("admin_config")
        .select("value").eq("key", "ERP_CATEGORY_CUTOFF_DATE").maybeSingle();
      if (cutoffRow?.value) {
        const raw = typeof cutoffRow.value === "string" ? cutoffRow.value : (cutoffRow.value as any)?.value ?? cutoffRow.value;
        const parsed = typeof raw === "string" ? raw : String(raw);
        if (/^\d{4}-\d{2}-\d{2}/.test(parsed)) {
          categoryCutoff = parsed.slice(0, 10);
          console.log(`erp-sync: using category cutoff=${categoryCutoff}`);
        }
      }
    } catch { /* use default */ }

    // ── Process in batches ────────────────────────────────────────────
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
        const normalizedRows = batch.map((item: any) => {
          const externalId = String(item.itemNum || item.styleNumber || item.itemCode || item.id || `unknown-${i}`);

          const mg01 = item["Product Type ( Material)"] || item["Product Type (Material)"] || item.mg01 || item.merchGroup01 || null;
          const mg02 = item["Product Sub-Type (Construction)"] || item.mg02 || item.merchGroup02 || null;
          const mg03 = item["Product Sub-Sub-Type (feature)"] || item["Product Sub-Sub-Type(feature)"] || item.mg03 || item.merchGroup03 || null;

          // Determine ERP date for legacy detection
          const erpDate = item.created_date || item.updatedAt || item.lastModified || null;
          const erpDateStr = erpDate ? String(erpDate).slice(0, 10) : null;
          const isLegacy = erpDateStr && erpDateStr < categoryCutoff;

          return {
            external_id: externalId,
            style_number: item.itemNum || item.styleNumber || null,
            item_description: item.item_name || item.itemDescription || item.description || null,
            mg_category: isLegacy ? null : (item.mgCategory || null),
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
            erp_updated_at: erpDate,
            sync_run_id: runId,
            synced_at: new Date().toISOString(),
            raw_mg_fields: {
              mg01,
              mg02,
              mg03,
              mg04: item.mg04 || item.merchGroup04,
              mg05: item.mg05 || item.merchGroup05,
              mg06: item.mg06 || item.merchGroup06,
              mgCategory: item.mgCategory,
              mgCategory_nulled_legacy: isLegacy || false,
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

    // ── Finalize run ──────────────────────────────────────────────────
    const finalStatus = totalErrors > 0 && totalUpserted === 0 ? "failed" : "completed";
    await db.from("erp_sync_runs").update({
      status: finalStatus,
      ended_at: new Date().toISOString(),
      total_fetched: items.length,
      total_upserted: totalUpserted,
      total_errors: totalErrors,
      error_samples: errorSamples,
    }).eq("id", runId);

    // ── Update watermark on success ───────────────────────────────────
    if (finalStatus === "completed" && endDate) {
      await db.from("admin_config").upsert({
        key: WATERMARK_KEY,
        value: endDate,
        updated_at: new Date().toISOString(),
        updated_by: null,
      }, { onConflict: "key" });
      console.log(`erp-sync: watermark updated to ${endDate}`);
    }

    console.log(`erp-sync: run ${runId} ${finalStatus} — mode=${syncMode}, fetched=${items.length}, upserted=${totalUpserted}, errors=${totalErrors}`);

    return json({
      ok: true,
      run_id: runId,
      sync_mode: syncMode,
      start_date: startDate ?? null,
      end_date: endDate,
      total_fetched: items.length,
      total_upserted: totalUpserted,
      total_errors: totalErrors,
    });
  } catch (e) {
    console.error("erp-sync unhandled error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
