// Edge function: full SQL dump of all public tables as INSERT statements.
// Generates a single .sql file that can be run on any Postgres target.
// Handles FK constraints by wrapping everything in a transaction with
// session_replication_role = 'replica' (disables FK checks + triggers).
//
// Auth: service-role key or admin JWT
//
// Usage:
//   GET /functions/v1/export-sql-dump
//   Returns: text/sql attachment
//
// The output SQL is self-contained:
//   BEGIN;
//   SET session_replication_role = 'replica';
//   -- TRUNCATE all tables (optional, controlled by ?truncate=true)
//   -- INSERT INTO ... VALUES (...);
//   SET session_replication_role = 'origin';
//   COMMIT;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tables in dependency order (parents first, children last)
const TABLES_IN_ORDER = [
  "admin_config",
  "licensors",
  "properties",
  "characters",
  "erp_sync_runs",
  "style_groups", // depends on licensors, properties (primary_asset_id is nullable, filled later)
  "assets", // depends on licensors, properties, style_groups, product_subtypes
  "asset_tags", // depends on assets
  "asset_characters", // depends on assets, characters
  "asset_path_history", // depends on assets
  "processing_queue", // depends on assets
  "render_queue", // depends on assets
  "tiff_optimization_queue",
  "hygiene_findings", // depends on assets
  "erp_items_current", // depends on erp_sync_runs
  "erp_items_raw", // depends on erp_sync_runs
  "erp_enrichment_log",
  "product_categories",
  "product_types", // depends on product_categories
  "product_subtypes", // depends on product_types
  "product_category_predictions", // depends on erp_items_current
  "invitations",
  "agent_registrations",
  "agent_pairings", // depends on agent_registrations
];

function escapeSQL(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (typeof val === "object") {
    // jsonb / arrays
    if (Array.isArray(val)) {
      // Could be a text[] array or jsonb array
      // For text arrays like tags, format as Postgres array literal
      const elements = val.map((v) => {
        if (v === null) return "NULL";
        return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      });
      return `'{${elements.join(",")}}'`;
    }
    // jsonb object
    const json = JSON.stringify(val);
    return `'${json.replace(/'/g, "''")}'::jsonb`;
  }
  // string
  const str = String(val);
  return `'${str.replace(/'/g, "''")}'`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth (same as export-table) ──
    const authHeader = req.headers.get("authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    let authorized = false;

    if (serviceKey && authHeader.includes(serviceKey)) {
      authorized = true;
    }
    if (!authorized) {
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (token && token !== serviceKey) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
        if (user && !userErr) {
          const svc = createClient(supabaseUrl, serviceKey);
          const { data: roleRow } = await svc.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
          if (roleRow) authorized = true;
        }
      }
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const includeTruncate = url.searchParams.get("truncate") === "true";
    // Optional: export only specific tables
    const onlyTables = url.searchParams.get("tables")?.split(",").filter(Boolean);

    const db = createClient(supabaseUrl, serviceKey);

    const tablesToExport = onlyTables ? TABLES_IN_ORDER.filter((t) => onlyTables.includes(t)) : TABLES_IN_ORDER;

    const lines: string[] = [];
    lines.push("-- PopDAM full SQL data dump");
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push(`-- Tables: ${tablesToExport.length}`);
    lines.push("");
    lines.push("BEGIN;");
    lines.push("");
    lines.push("-- Disable all triggers and FK constraint checks for import");
    lines.push("SET session_replication_role = 'replica';");
    lines.push("");

    if (includeTruncate) {
      lines.push("-- Truncate tables in reverse order (children first)");
      for (const table of [...tablesToExport].reverse()) {
        lines.push(`TRUNCATE TABLE public.${table} CASCADE;`);
      }
      lines.push("");
    }

    const CHUNK = 1000;
    let totalRows = 0;
    const tableCounts: Record<string, number> = {};

    for (const table of tablesToExport) {
      // Get total count
      const { count } = await db.from(table).select("*", { count: "exact", head: true });
      const tableTotal = count ?? 0;
      tableCounts[table] = tableTotal;

      if (tableTotal === 0) {
        lines.push(`-- ${table}: 0 rows (skipped)`);
        lines.push("");
        continue;
      }

      lines.push(`-- ━━━ ${table}: ${tableTotal} rows ━━━`);

      let offset = 0;
      let firstRow = true;
      let columns: string[] = [];

      while (offset < tableTotal) {
        const { data: chunk, error } = await db
          .from(table)
          .select("*")
          .range(offset, offset + CHUNK - 1);

        if (error) {
          lines.push(`-- ERROR on ${table} at offset ${offset}: ${error.message}`);
          break;
        }
        if (!chunk || chunk.length === 0) break;

        if (firstRow) {
          columns = Object.keys(chunk[0]);
          firstRow = false;
        }

        for (const row of chunk) {
          const values = columns.map((col) => escapeSQL((row as Record<string, unknown>)[col]));
          lines.push(`INSERT INTO public.${table} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${values.join(", ")});`);
        }

        totalRows += chunk.length;
        offset += CHUNK;
      }

      lines.push("");
    }

    lines.push("-- Re-enable triggers and FK checks");
    lines.push("SET session_replication_role = 'origin';");
    lines.push("");
    lines.push("COMMIT;");
    lines.push("");
    lines.push("-- ━━━ Summary ━━━");
    lines.push(`-- Total rows exported: ${totalRows}`);
    for (const [t, c] of Object.entries(tableCounts)) {
      lines.push(`--   ${t}: ${c}`);
    }
    lines.push("");

    const sqlContent = lines.join("\n");

    return new Response(sqlContent, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="popdam-dump-${new Date().toISOString().slice(0, 10)}.sql"`,
        "X-Total-Rows": String(totalRows),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
