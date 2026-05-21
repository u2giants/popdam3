import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsServe, json } from "../_shared/http.ts";
import { unwrapConfigString } from "../_shared/config-utils.ts";
import { resolveMg01Code, resolveMg02Code, resolveMg03Code } from "../_shared/mg-codes.ts";

const DEFAULT_ERP_ENDPOINT = "https://api.designflow.app/api/item_master/lib/getApiAllItems";
const BATCH_SIZE = 100;
const WATERMARK_KEY = "ERP_LAST_SYNC_DATE";

/** Format a Date as YYYY-MM-DD */
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

corsServe(async (req: Request) => {
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
        const parsed = unwrapConfigString(wm.value);
        if (parsed && /^\d{4}-\d{2}-\d{2}/.test(parsed)) {
          startDate = parsed.slice(0, 10);
          console.log(`erp-sync: using watermark startDate=${startDate}`);
        }
      }
    }

    // For incremental syncs, default endDate = today. For full syncs, send no
    // date params so the API returns its complete dataset without date filtering,
    // but still record today as the watermark so the next incremental starts here.
    const syncMode = startDate ? "incremental" : "full";
    if (!endDate) {
      endDate = fmtDate(new Date());
    }
    console.log(`erp-sync: mode=${syncMode}, startDate=${startDate ?? "none"}, endDate=${endDate ?? "none"}`);

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

    // ── Resolve endpoint from admin_config ───────────────────────────
    let erpEndpoint = DEFAULT_ERP_ENDPOINT;
    try {
      const { data: endpointRow } = await db.from("admin_config")
        .select("value").eq("key", "ERP_SYNC_ENDPOINT").maybeSingle();
      if (endpointRow?.value) {
        const parsed = unwrapConfigString(endpointRow.value);
        if (parsed?.startsWith("http")) {
          erpEndpoint = parsed;
          console.log(`erp-sync: using configured endpoint: ${erpEndpoint}`);
        }
      }
    } catch { /* use default */ }

    // ── Fetch from ERP API ────────────────────────────────────────────
    let items: unknown[];
    try {
      const url = new URL(erpEndpoint);
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

    // Global dedup across full response — cross-batch duplicates silently
    // collapse to the same DB row and undercount the final total.
    {
      const globalSeen = new Set<string>();
      items = items.filter((item: any) => {
        const id = String(item.itemNum || item.styleNumber || item.itemCode || item.id || "");
        if (!id || globalSeen.has(id)) return false;
        globalSeen.add(id);
        return true;
      });
      console.log(`erp-sync: after global dedup: ${items.length} unique items`);
    }

    let totalUpserted = 0;
    let totalErrors = 0;
    const errorSamples: string[] = [];

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

          // Raw API values — may be letter codes ("A") or full descriptions ("Stretched/Box")
          const mg01Raw = item["Product Type ( Material)"] || item["Product Type (Material)"] || item.mg01 || item.merchGroup01 || null;
          const mg02Raw = item["Product Sub-Type (Construction)"] || item.mg02 || item.merchGroup02 || null;
          const mg03Raw = item["Product Sub-Sub-Type (feature)"] || item["Product Sub-Sub-Type(feature)"] || item.mg03 || item.merchGroup03 || null;

          // Resolve to single-character codes — if the API returned a description,
          // reverse-look it up to its canonical letter code. If resolution fails,
          // store null so the item is flagged rather than storing a description in a code field.
          const mg01Code = resolveMg01Code(mg01Raw);
          const mg02Code = resolveMg02Code(mg01Code, mg02Raw);
          const mg03Code = resolveMg03Code(mg01Code, mg02Code, mg03Raw);

          const erpDate = item.created_date || item.updatedAt || item.lastModified || null;

          return {
            external_id: externalId,
            style_number: item.itemNum || item.styleNumber || null,
            item_description: item.item_name || item.itemDescription || item.description || null,
            mg_category: item.mgCategory || null,
            mg01_code: mg01Code,
            mg02_code: mg02Code,
            mg03_code: mg03Code,
            mg04_code: item.mg04 || item.merchGroup04 || null,
            mg05_code: item.mg05 || item.merchGroup05 || null,
            mg06_code: item.mg06 || item.merchGroup06 || null,
            size_code: item.size || item.sizeCode || null,
            licensor_code: item.licensor || item.licensorCode || null,
            property_code: item.property || item.propertyCode || null,
            division_code: item.divisionCode || null,
            prepack_code: item.prepackCode || null,
            prepack_codes: Array.isArray(item.prepackCodes) && item.prepackCodes.length > 0 ? item.prepackCodes : null,
            erp_updated_at: erpDate,
            sync_run_id: runId,
            synced_at: new Date().toISOString(),
            raw_mg_fields: {
              // Original API values (may be descriptions or codes)
              mg01: mg01Raw,
              mg02: mg02Raw,
              mg03: mg03Raw,
              // Resolved letter codes (null if API value couldn't be matched to schema)
              mg01_code: mg01Code,
              mg02_code: mg02Code,
              mg03_code: mg03Code,
              mg04: item.mg04 || item.merchGroup04,
              mg05: item.mg05 || item.merchGroup05,
              mg06: item.mg06 || item.merchGroup06,
              mgCategory: item.mgCategory,
              mgCategory_nulled_legacy: false,
              size: item.size,
              licensor: item.licensor,
              property: item.property,
              season: item.season,
              status: item.status,
            },
          };
        });

        // Deduplicate by external_id — API sometimes returns the same item twice,
        // which causes Postgres to reject the entire batch with "ON CONFLICT DO UPDATE
        // command cannot affect row a second time".
        const seen = new Set<string>();
        const dedupedRows = normalizedRows.filter((r) => {
          if (seen.has(r.external_id)) return false;
          seen.add(r.external_id);
          return true;
        });

        const { error: upsertErr } = await db.from("erp_items_current")
          .upsert(dedupedRows, { onConflict: "external_id" });

        if (upsertErr) {
          totalErrors += dedupedRows.length;
          if (errorSamples.length < 5) errorSamples.push(upsertErr.message);
        } else {
          totalUpserted += dedupedRows.length;
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
