/**
 * Chunked SQL data exporter for migration from Lovable Cloud.
 *
 * Two modes:
 *   GET ?action=manifest   → JSON with table names + row counts
 *   GET ?table=X&offset=Y  → SQL file with INSERT batch for that chunk
 *
 * Each chunk is a self-contained transaction:
 *   BEGIN;
 *   SET session_replication_role = 'replica';
 *   INSERT INTO ...;
 *   SET session_replication_role = 'origin';
 *   COMMIT;
 *
 * Auth: admin JWT (the function uses its internal service role key for reads).
 *
 * Chunk sizing: default 5000 rows per request. At ~1KB/row average this
 * keeps response size well under 50MB and execution time under 30s,
 * safely within Supabase Edge Function limits (60s wall clock, ~150MB RAM).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsServe } from "../_shared/http.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tables in dependency order (parents first)
const TABLES_IN_ORDER = [
  "admin_config",
  "licensors",
  "properties",
  "characters",
  "erp_sync_runs",
  "style_groups",
  "assets",
  "asset_tags",
  "asset_characters",
  "asset_path_history",
  "processing_queue",
  "render_queue",
  "tiff_optimization_queue",
  "hygiene_findings",
  "erp_items_current",
  "erp_items_raw",
  "erp_enrichment_log",
  "product_categories",
  "product_types",
  "product_subtypes",
  "product_category_predictions",
  "invitations",
  "agent_registrations",
  "agent_pairings",
];

const DEFAULT_CHUNK = 5000;
const POSTGREST_PAGE = 1000; // PostgREST max per request

// ── SQL escaping ────────────────────────────────────────────────────

function escapeSQL(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (typeof val === "object") {
    if (Array.isArray(val)) {
      const elements = val.map((v) => {
        if (v === null) return "NULL";
        return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      });
      return `'{${elements.join(",")}}'`;
    }
    const json = JSON.stringify(val);
    return `'${json.replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

// ── Auth helper ─────────────────────────────────────────────────────

async function authorizeAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  // Service role key (for automated calls)
  if (serviceKey && authHeader.includes(serviceKey)) return true;

  // Admin JWT
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token || token === serviceKey) return false;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await userClient.auth.getUser(token);
  if (!user || error) return false;

  const svc = createClient(supabaseUrl, serviceKey);
  const { data: roleRow } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  return !!roleRow;
}

// ── Main handler ────────────────────────────────────────────────────

corsServe(async (req) => {
  try {
    if (!(await authorizeAdmin(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const db = createClient(supabaseUrl, serviceKey);

    // ── MANIFEST ──────────────────────────────────────────────────
    if (action === "manifest") {
      const chunkSize = parseInt(url.searchParams.get("chunk_size") ?? String(DEFAULT_CHUNK), 10);
      const tables: { table: string; rows: number; chunks: number }[] = [];

      for (const table of TABLES_IN_ORDER) {
        const { count } = await db.from(table).select("*", { count: "exact", head: true });
        const rows = count ?? 0;
        tables.push({ table, rows, chunks: rows === 0 ? 0 : Math.ceil(rows / chunkSize) });
      }

      return new Response(JSON.stringify({ chunkSize, tables, generated: new Date().toISOString() }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CHUNK EXPORT ──────────────────────────────────────────────
    const table = url.searchParams.get("table");
    if (!table || !TABLES_IN_ORDER.includes(table)) {
      return new Response(
        JSON.stringify({ error: `Provide ?table=NAME. Valid: ${TABLES_IN_ORDER.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const chunkSize = Math.min(
      parseInt(url.searchParams.get("chunk_size") ?? String(DEFAULT_CHUNK), 10),
      10000,
    );
    const includeTruncate = url.searchParams.get("truncate") === "true" && offset === 0;

    // Fetch rows in PostgREST pages
    const rows: Record<string, unknown>[] = [];
    let pgOffset = offset;
    while (rows.length < chunkSize) {
      const { data: page, error } = await db
        .from(table)
        .select("*")
        .range(pgOffset, pgOffset + POSTGREST_PAGE - 1);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!page || page.length === 0) break;
      for (const r of page) rows.push(r as Record<string, unknown>);
      if (page.length < POSTGREST_PAGE) break;
      pgOffset += POSTGREST_PAGE;
    }

    // Build SQL
    const lines: string[] = [];
    const chunkIndex = Math.floor(offset / chunkSize);
    lines.push(`-- PopDAM data export: ${table} chunk ${chunkIndex} (offset ${offset}, limit ${chunkSize})`);
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("BEGIN;");
    lines.push("SET session_replication_role = 'replica';");
    lines.push("");

    if (includeTruncate) {
      lines.push(`TRUNCATE TABLE public.${table} CASCADE;`);
      lines.push("");
    }

    if (rows.length === 0) {
      lines.push(`-- ${table}: no rows in this range`);
    } else {
      const columns = Object.keys(rows[0]);
      const colList = columns.map((c) => `"${c}"`).join(", ");

      for (const row of rows) {
        const values = columns.map((col) => escapeSQL(row[col]));
        lines.push(`INSERT INTO public.${table} (${colList}) VALUES (${values.join(", ")});`);
      }
    }

    lines.push("");
    lines.push("SET session_replication_role = 'origin';");
    lines.push("COMMIT;");
    lines.push("");

    const sqlContent = lines.join("\n");
    const filename = `${table}_chunk${String(chunkIndex).padStart(3, "0")}.sql`;

    return new Response(sqlContent, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Table": table,
        "X-Offset": String(offset),
        "X-Rows-In-Chunk": String(rows.length),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
