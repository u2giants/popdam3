// Edge function to export large tables as CSV, paginated.
// Bypasses Lovable Cloud's 1000-row CSV export limit.
//
// Auth: requires admin JWT or service-role key

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const authHeader = req.headers.get("authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    let authorized = false;

    // Method 1: service role key
    if (serviceKey && authHeader.includes(serviceKey)) {
      authorized = true;
    }

    // Method 2: admin JWT
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
      return new Response(JSON.stringify({ error: "Unauthorized — requires admin role or service role key" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const table = url.searchParams.get("table");
    const page = parseInt(url.searchParams.get("page") ?? "0", 10);
    const pageSize = Math.min(parseInt(url.searchParams.get("page_size") ?? "50000", 10), 50000);
    const format = url.searchParams.get("format") ?? "csv";

    if (!table || !ALLOWED_TABLES.includes(table)) {
      return new Response(JSON.stringify({ error: `Table not allowed. Valid: ${ALLOWED_TABLES.join(", ")}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(supabaseUrl, serviceKey);

    const { count: totalCount } = await db.from(table).select("*", { count: "exact", head: true });

    // PostgREST caps at 1000 rows per request, so we paginate internally
    const CHUNK = 1000;
    const from = page * pageSize;
    const targetRows = pageSize;
    const rows: Record<string, unknown>[] = [];

    let offset = from;
    while (rows.length < targetRows) {
      const chunkEnd = offset + CHUNK - 1;
      const { data: chunk, error: chunkErr } = await db.from(table).select("*").range(offset, chunkEnd);
      if (chunkErr) {
        return new Response(JSON.stringify({ error: chunkErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!chunk || chunk.length === 0) break;
      for (const r of chunk) rows.push(r as Record<string, unknown>);
      if (chunk.length < CHUNK) break; // no more data
      offset += CHUNK;
    }

    const rows = data ?? [];
    const totalPages = Math.ceil((totalCount ?? 0) / pageSize);

    if (format === "json") {
      return new Response(JSON.stringify({ table, page, pageSize, totalCount, totalPages, rowsInPage: rows.length, data: rows }), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${table}_page${page}.json"` },
      });
    }

    if (rows.length === 0) {
      return new Response(JSON.stringify({ table, page, totalCount, totalPages, rowsInPage: 0, message: "No more data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const columns = Object.keys(rows[0]);
    const csvLines: string[] = [];

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
