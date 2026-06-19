/**
 * Production PO sync handlers.
 *
 * The PLM endpoint is protected by two tokens. Store secret values as Supabase
 * Edge Function secrets:
 *   PROD_ORDER_GOOGLE_SERVICE_ACCOUNT_JSON  (preferred; mints Cloud Run ID token)
 *   PROD_ORDER_API_TOKEN_2                  (X-User-Authorization)
 *
 * Optional overrides:
 *   PROD_ORDER_API_AUTH_HEADERS = JSON object (secret) with exact headers
 *   PROD_ORDER_API_TOKEN_1 = pre-minted Cloud Run ID token, useful for testing
 *   PROD_ORDER_CLOUD_RUN_AUDIENCE = Cloud Run audience override
 *   admin_config.PROD_ORDER_API_ENDPOINT = "https://..."
 *   admin_config.PROD_ORDER_API_TOKEN_1_HEADER = "x-token-one"
 *   admin_config.PROD_ORDER_API_TOKEN_2_HEADER = "x-token-two"
 */

import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { unwrapConfigString, unwrapConfigValue } from "../config-utils.ts";

const DEFAULT_ENDPOINT = "https://popcre-tracking-prod-677598988032.us-central1.run.app/getProdOrderHeader";
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 2000;
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

type DbClient = ReturnType<typeof serviceClient>;

type NormalizedProdOrder = {
  external_id: string;
  prod_order_number: string;
  style_number: string;
  order_status: string | null;
  customer_code: string | null;
  customer_name: string | null;
  quantity: number | null;
  due_date: string | null;
  order_date: string | null;
  erp_updated_at: string | null;
  raw_payload: Record<string, unknown>;
};

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (value === null || value === undefined) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return null;
}

function firstNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key];
    if (value === null || value === undefined || value === "") continue;
    const num = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function parseDateOnly(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseTimestamp(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeProdOrderRows(raw: unknown, index: number): NormalizedProdOrder[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Row ${index} is not an object`);
  }
  const header = raw as Record<string, unknown>;

  const prodOrderNumber = firstString(header, [
    "prodOrderNo",
    "prodOrderNumber",
    "productionOrderNo",
    "productionOrderNumber",
    "prod_order_number",
    "Prod Reference #",
    "Prod Order No",
    "Production PO #",
    "Production PO",
    "PO #",
    "poNumber",
    "po_num",
    "po",
  ]);
  const details = Array.isArray(header.details)
    ? header.details.filter((detail) => detail && typeof detail === "object" && !Array.isArray(detail)) as Record<string, unknown>[]
    : [header];

  const rowKeys = Object.keys(header).slice(0, 80).join(", ");
  if (!prodOrderNumber) throw new Error(`Row ${index} has no production PO number; keys: ${rowKeys}`);

  const normalized: NormalizedProdOrder[] = [];
  for (let detailIndex = 0; detailIndex < details.length; detailIndex++) {
    const detail = details[detailIndex];
    const styleNumber = firstString(detail, [
      "Item #",
      "matchedItemNumber",
      "itemNumber",
      "itemNum",
      "styleNumber",
      "style_number",
      "styleNo",
      "style",
      "sku",
      "SKU",
    ]) ?? firstString(header, [
      "Item #",
      "matchedItemNumber",
      "itemNumber",
      "itemNum",
      "styleNumber",
      "style_number",
      "styleNo",
      "style",
      "sku",
      "SKU",
    ]);

    if (!styleNumber) {
      const detailKeys = Object.keys(detail).slice(0, 80).join(", ");
      throw new Error(`Row ${index} detail ${detailIndex + 1} has no style number; header keys: ${rowKeys}; detail keys: ${detailKeys}`);
    }

    const externalId = firstString(detail, [
      "pKey",
      "itemId",
      "id",
      "external_id",
      "prodOrderDetailId",
      "prodOrderLineId",
    ]) ?? `${
      firstString(header, [
        "id",
        "external_id",
        "prodOrderHeaderId",
        "prodOrderId",
        "productionOrderId",
      ]) ?? `${prodOrderNumber}`
    }:${styleNumber}:${detailIndex + 1}`;

    normalized.push({
      external_id: externalId,
      prod_order_number: prodOrderNumber,
      style_number: styleNumber,
      order_status: firstString(header, ["status", "orderStatus", "prodOrderStatus", "productionOrderStatus", "Order Was Completed"]),
      customer_code: firstString(header, ["Customer Code", "customerCode", "customer_code", "custCode"]),
      customer_name: firstString(header, ["Customer Desc", "customerName", "customer_name", "customer"]),
      quantity: firstNumber(detail, ["prod_order_qty", "masterQuantity", "quantity", "qty", "orderQty", "orderedQuantity"]) ??
        firstNumber(header, ["Prod Qty", "quantity", "qty", "orderQty", "orderedQuantity", "prodOrderQty"]),
      due_date: parseDateOnly(firstString(header, ["neededDate", "Due Date", "dueDate", "due_date", "Ship Date", "shipDate", "plannedDueDate"])),
      order_date: parseDateOnly(firstString(header, ["PO Date", "orderDate", "order_date", "createdDate", "created_at"])),
      erp_updated_at: parseTimestamp(firstString(header, ["updatedAt", "updated_at", "lastModified", "modifiedDate"])),
      raw_payload: { header, detail },
    });
  }

  return normalized;
}

function extractRows(parsed: unknown): { rows: unknown[]; totalCount: number | null } {
  if (Array.isArray(parsed)) return { rows: parsed, totalCount: null };
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Unexpected response type: ${typeof parsed}`);
  }

  const obj = parsed as Record<string, unknown>;
  const totalCountRaw = obj.totalCount ?? obj.total_count ?? obj.count ?? obj.total;
  const totalCount = typeof totalCountRaw === "number" ? totalCountRaw : Number(totalCountRaw);
  const rowsField = obj.rows ?? obj.data ?? obj.items ?? obj.results ?? obj.records;
  if (Array.isArray(rowsField)) {
    return { rows: rowsField, totalCount: Number.isFinite(totalCount) ? totalCount : null };
  }

  const arrayKey = Object.keys(obj).find((key) => Array.isArray(obj[key]));
  if (arrayKey) {
    return { rows: obj[arrayKey] as unknown[], totalCount: Number.isFinite(totalCount) ? totalCount : null };
  }
  throw new Error(`Response object has keys [${Object.keys(obj).join(", ")}] but no row array`);
}

async function getConfigMap(db: DbClient, keys: string[]): Promise<Record<string, unknown>> {
  const { data } = await db.from("admin_config").select("key, value").in("key", keys);
  const map: Record<string, unknown> = {};
  for (const row of data ?? []) map[row.key] = unwrapConfigValue(row.value);
  return map;
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function mintCloudRunIdentityToken(endpoint: string): Promise<string | null> {
  const rawJson = Deno.env.get("PROD_ORDER_GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!rawJson) return null;

  let serviceAccount: { client_email?: string; private_key?: string };
  try {
    serviceAccount = JSON.parse(rawJson);
  } catch {
    throw new Error("PROD_ORDER_GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("PROD_ORDER_GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key");
  }

  const audience = Deno.env.get("PROD_ORDER_CLOUD_RUN_AUDIENCE")?.trim() ||
    new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: GOOGLE_TOKEN_ENDPOINT,
    target_audience: audience,
    iat: now,
    exp: now + 3600,
  }));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const assertion = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;

  const resp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const parsed = await resp.json().catch(() => ({})) as Record<string, unknown>;
  if (!resp.ok || typeof parsed.id_token !== "string") {
    throw new Error(`Failed to mint Cloud Run identity token: ${String(parsed.error_description || parsed.error || resp.status)}`);
  }
  return parsed.id_token;
}

async function buildHeaders(config: Record<string, unknown>, endpoint: string): Promise<HeadersInit> {
  const envExplicitHeaders = Deno.env.get("PROD_ORDER_API_AUTH_HEADERS");
  if (envExplicitHeaders) {
    try {
      const parsed = JSON.parse(envExplicitHeaders);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // Fall through to token-pair config so a malformed override fails as missing auth.
    }
  }

  const explicitHeaders = config.PROD_ORDER_API_AUTH_HEADERS;
  if (explicitHeaders && typeof explicitHeaders === "object" && !Array.isArray(explicitHeaders)) {
    return explicitHeaders as Record<string, string>;
  }

  const token1 = Deno.env.get("PROD_ORDER_API_TOKEN_1")?.trim() ||
    await mintCloudRunIdentityToken(endpoint) ||
    (typeof config.PROD_ORDER_API_TOKEN_1 === "string" ? config.PROD_ORDER_API_TOKEN_1.trim() : "");
  const token2 = Deno.env.get("PROD_ORDER_API_TOKEN_2")?.trim() ||
    (typeof config.PROD_ORDER_API_TOKEN_2 === "string" ? config.PROD_ORDER_API_TOKEN_2.trim() : "");
  const header1 = typeof config.PROD_ORDER_API_TOKEN_1_HEADER === "string" ? config.PROD_ORDER_API_TOKEN_1_HEADER.trim() : "Authorization";
  const header2 = typeof config.PROD_ORDER_API_TOKEN_2_HEADER === "string" ? config.PROD_ORDER_API_TOKEN_2_HEADER.trim() : "X-User-Authorization";
  const headers: Record<string, string> = {};
  if (token1) headers[header1] = header1.toLowerCase() === "authorization" ? `Bearer ${token1}` : token1;
  if (token2) headers[header2] = token2;
  return headers;
}

export async function handleProdOrderSyncRuns() {
  const db = serviceClient();
  const { data, error } = await db.from("prod_order_sync_runs")
    .select("id, status, started_at, ended_at, total_fetched, total_upserted, total_errors, error_samples, run_metadata, created_by")
    .order("started_at", { ascending: false })
    .limit(10);
  if (error) return err(error.message, 500);
  return json({ ok: true, runs: data ?? [] });
}

export async function handleProdOrderStats() {
  const db = serviceClient();
  const styleNumbers = await getProdOrderStyleNumbers(db);
  const [
    { count: totalOrders },
    { count: matchedStyles },
  ] = await Promise.all([
    db.from("prod_order_headers_current").select("*", { count: "exact", head: true }),
    db.from("style_groups").select("sku", { count: "exact", head: true }).in("sku", styleNumbers),
  ]);

  return json({
    ok: true,
    total_prod_orders: totalOrders ?? 0,
    styles_with_prod_orders: styleNumbers[0] === "__none__" ? 0 : styleNumbers.length,
    matched_style_groups: matchedStyles ?? 0,
  });
}

async function getProdOrderStyleNumbers(db: DbClient): Promise<string[]> {
  const { data } = await db.from("prod_order_headers_current").select("style_number").limit(10000);
  const styles = [...new Set((data ?? []).map((row) => row.style_number).filter(Boolean))];
  return styles.length > 0 ? styles : ["__none__"];
}

export async function handleTriggerProdOrderSync(body: Record<string, unknown> = {}) {
  const db = serviceClient();
  const pageSize = typeof body.page_size === "number" ? Math.max(1, Math.min(500, Math.floor(body.page_size))) : DEFAULT_PAGE_SIZE;
  const maxPages = typeof body.max_pages === "number" ? Math.max(1, Math.min(MAX_PAGES, Math.floor(body.max_pages))) : MAX_PAGES;

  const { data: runningRuns } = await db.from("prod_order_sync_runs")
    .select("id").eq("status", "running").limit(1);
  if (runningRuns && runningRuns.length > 0) {
    return err(`A production PO sync is already running (${runningRuns[0].id})`, 409);
  }

  const config = await getConfigMap(db, [
    "PROD_ORDER_API_ENDPOINT",
    "PROD_ORDER_API_AUTH_HEADERS",
    "PROD_ORDER_API_TOKEN_1",
    "PROD_ORDER_API_TOKEN_2",
    "PROD_ORDER_API_TOKEN_1_HEADER",
    "PROD_ORDER_API_TOKEN_2_HEADER",
  ]);

  const endpoint = unwrapConfigString(config.PROD_ORDER_API_ENDPOINT) ?? DEFAULT_ENDPOINT;
  const headers = await buildHeaders(config, endpoint);
  if (Object.keys(headers as Record<string, string>).length === 0) {
    return err(
      "Missing production PO API credentials. Set PROD_ORDER_GOOGLE_SERVICE_ACCOUNT_JSON and PROD_ORDER_API_TOKEN_2, or set PROD_ORDER_API_AUTH_HEADERS as a Supabase Edge Function secret.",
      400,
    );
  }

  const { data: run, error: runErr } = await db.from("prod_order_sync_runs")
    .insert({
      status: "running",
      created_by: "admin-api",
      run_metadata: { endpoint, page_size: pageSize, max_pages: maxPages },
    })
    .select("id")
    .single();
  if (runErr || !run) return err(runErr?.message ?? "Failed to create production PO sync run", 500);

  let totalFetched = 0;
  let totalUpserted = 0;
  let totalErrors = 0;
  const errorSamples: string[] = [];

  try {
    for (let page = 0; page < maxPages; page++) {
      const startRow = page * pageSize + 1;
      const endRow = startRow + pageSize - 1;
      const url = new URL(endpoint);
      url.searchParams.set("startRow", String(startRow));
      url.searchParams.set("endRow", String(endRow));

      const resp = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(120_000),
      });
      const text = await resp.text();
      if (!resp.ok) {
        throw new Error(`Production PO API returned ${resp.status}: ${text.slice(0, 200)}`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Production PO API returned non-JSON");
      }

      const { rows, totalCount } = extractRows(parsed);
      if (rows.length === 0) break;
      totalFetched += rows.length;

      const normalized: NormalizedProdOrder[] = [];
      for (let i = 0; i < rows.length; i++) {
        try {
          normalized.push(...normalizeProdOrderRows(rows[i], startRow + i));
        } catch (e) {
          totalErrors += 1;
          if (errorSamples.length < 20) errorSamples.push(e instanceof Error ? e.message : String(e));
        }
      }

      const deduped = [...new Map(normalized.map((row) => [row.external_id, row])).values()];

      if (deduped.length > 0) {
        const { error: rawErr } = await db.from("prod_order_headers_raw").insert(deduped.map((row) => ({
          external_id: row.external_id,
          raw_payload: row.raw_payload,
          sync_run_id: run.id,
        })));
        if (rawErr) throw new Error(rawErr.message);

        const { data: upserted, error: upsertErr } = await db.from("prod_order_headers_current")
          .upsert(
            deduped.map((row) => ({
              ...row,
              sync_run_id: run.id,
              synced_at: new Date().toISOString(),
            })),
            { onConflict: "external_id" },
          )
          .select("id");

        if (upsertErr) throw new Error(upsertErr.message);
        totalUpserted += upserted?.length ?? deduped.length;
      }

      if (totalCount !== null && endRow >= totalCount) break;
      if (rows.length < pageSize) break;
    }

    await db.from("prod_order_sync_runs").update({
      status: "completed",
      ended_at: new Date().toISOString(),
      total_fetched: totalFetched,
      total_upserted: totalUpserted,
      total_errors: totalErrors,
      error_samples: errorSamples,
    }).eq("id", run.id);

    return json({
      ok: true,
      run_id: run.id,
      total_fetched: totalFetched,
      total_upserted: totalUpserted,
      total_errors: totalErrors,
      error_samples: errorSamples,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("prod_order_sync_runs").update({
      status: "failed",
      ended_at: new Date().toISOString(),
      total_fetched: totalFetched,
      total_upserted: totalUpserted,
      total_errors: totalErrors + 1,
      error_samples: [...errorSamples, message].slice(0, 20),
    }).eq("id", run.id);
    return err(`Production PO sync failed: ${message}`, 502);
  }
}
