// Edge function to export large tables as CSV, paginated.
// Bypasses Lovable Cloud's 1000-row CSV export limit.
//
// Usage:
//   GET /export-table?table=asset_tags&page=0&page_size=50000
//   Returns: CSV text with headers on page 0, no headers on subsequent pages
//
// Auth: requires service-role key in Authorization header (not for public use)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Allowlist of exportable tables
const ALLOWED_TABLES = [
  "assets",
  "asset_tags",
  "asset_characters",
  "asset_path_history",
  "style_groups",
  "licensors",
  "properties",
  "characters",
  "admin_config",
  "invitations",
  "processing_queue",
  "render_queue",
  "tiff_optimization_queue",
  "hygiene_findings",
  "erp_items_current",
  "erp_items_raw",
  "erp_sync_runs",
  "erp_enrichment_log",
  "product_categories",
  "product_types",
  "product_subtypes",
  "product_category_predictions",
  "agent_registrations",
  "agent_pairings",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth: accept service role key OR admin JWT
    const authHeader = req.headers.get("authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    let authorized = false;

    // Method 1: service role key
    if (serviceKey && authHeader.includes(serviceKey)) {
      authorized = true;
    }

    // Method 2: admin JWT — verify user + check admin role
    if (!authorized) {
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (token) {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
        if (user && !userErr) {
          // Check admin role via service client
          const svc = createClient(supabaseUrl, serviceKey);
          const { data: roleRow } = await svc.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
          if (roleRow) authorized = true;
        }
      }
    }

    if (!authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized — requires admin role or service role key" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const table = url.searchParams.get("table");
    const page = parseInt(url.searchParams.get("page") ?? "0", 10);
    const pageSize = Math.min(parseInt(url.searchParams.get("page_size") ?? "50000", 10), 50000);
    const format = url.searchParams.get("format") ?? "csv"; // csv or json

    if (!table || !ALLOWED_TABLES.includes(table)) {
      return new Response(JSON.stringify({ error: `Table not allowed. Valid: ${ALLOWED_TABLES.join(", ")}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const db = createClient(supabaseUrl, serviceKey);

    // Get total count first
    const { count: totalCount } = await db.from(table).select("*", { count: "exact", head: true });

    // Fetch page
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await db.from(table).select("*").range(from, to);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = data ?? [];
    const totalPages = Math.ceil((totalCount ?? 0) / pageSize);

    if (format === "json") {
      return new Response(JSON.stringify({ table, page, pageSize, totalCount, totalPages, rowsInPage: rows.length, data: rows }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${table}_page${page}.json"`,
        },
      });
    }

    // CSV format
    if (rows.length === 0) {
      return new Response(JSON.stringify({ table, page, totalCount, totalPages, rowsInPage: 0, message: "No more data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const columns = Object.keys(rows[0]);
    const csvLines: string[] = [];

    // Header on page 0 only
    if (page === 0) {
      csvLines.push(columns.map((c) => `"${c}"`).join(","));
    }

    for (const row of rows) {
      const values = columns.map((col) => {
        const val = (row as Record<string, unknown>)[col];
        if (val === null || val === undefined) return "";
        if (typeof val === "object") return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
        const str = String(val);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      });
      csvLines.push(values.join(","));
    }

    const csvContent = csvLines.join("\n") + "\n";

    return new Response(csvContent, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${table}_page${page}.csv"`,
        "X-Total-Count": String(totalCount ?? 0),
        "X-Total-Pages": String(totalPages),
        "X-Page": String(page),
        "X-Page-Size": String(pageSize),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
