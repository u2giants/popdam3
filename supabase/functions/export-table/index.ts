import { exportRange } from "../_shared/export-pagination.ts";
// Edge function to export large tables as CSV, paginated.
// Bypasses Lovable Cloud's 1000-row CSV export limit.
//
// Auth: requires admin JWT or service-role key

import { createClient } from "../_shared/supabase-js.ts";

import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsServe } from "../_shared/http.ts";
import { orderedTableSource, tableSource } from "../_shared/export-tables.ts";

const ALLOWED_TABLES = [
  "assets",
  "asset_tags",
  "asset_characters",
  "asset_path_history",
  "style_groups",
  "licensors",
  "properties",
  "characters",
  "invitations",
  "processing_queue",
  "render_queue",
  "tiff_optimization_queue",
  "hygiene_findings",
  "plm_item_list",
  "erp_sync_runs",
  "erp_enrichment_log",
  "product_categories",
  "product_types",
  "product_subtypes",
  "product_category_predictions",
  "agent_registrations",
  "agent_pairings",
];

corsServe(async (req) => {
  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const auth = await requireAdmin(req, { parseMode: "loose", allowServiceRole: true });
    if (!auth.ok) {
      // Every failure reason keeps this function's historical 401 + bare body.
      return new Response(JSON.stringify({ error: "Unauthorized — requires admin role or service role key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const table = url.searchParams.get("table");
    const page = parseInt(url.searchParams.get("page") ?? "0", 10);
    const pageSize = Math.min(parseInt(url.searchParams.get("page_size") ?? "50000", 10), 50000);
    const format = url.searchParams.get("format") ?? "csv";
    if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || !Number.isSafeInteger(page * pageSize)) {
      return new Response(JSON.stringify({ error: "Invalid page or page_size" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    if (!table || !ALLOWED_TABLES.includes(table)) {
      return new Response(JSON.stringify({ error: `Table not allowed. Valid: ${ALLOWED_TABLES.join(", ")}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const db = createClient(supabaseUrl, serviceKey);

    const { count: totalCount, error: countErr } = await tableSource(db, table).select("*", { count: "exact", head: true });
    // A failed count must not be exported as "0 rows" or a page of the wrong size (#1097)
    if (countErr || typeof totalCount !== "number") {
      return new Response(JSON.stringify({ error: `Count failed for ${table}: ${countErr?.message ?? "count missing"}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // PostgREST caps at 1000 rows per request, so we paginate internally
    const CHUNK = 1000;
    const from = page * pageSize;
    const targetRows = pageSize;
    const rows: Record<string, unknown>[] = [];

    let offset = from;
    while (rows.length < targetRows) {
      const [, chunkEnd] = exportRange(offset, targetRows - rows.length, CHUNK);
      const { data: chunk, error: chunkErr } = await orderedTableSource(db, table).range(offset, chunkEnd);
      if (chunkErr) {
        return new Response(JSON.stringify({ error: chunkErr.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (!chunk || chunk.length === 0) break; // past the last row
      for (const r of chunk) rows.push(r as Record<string, unknown>);
      // A short chunk is not proof of the end: advance by what was actually returned
      offset += chunk.length;
    }

    const totalPages = Math.ceil((totalCount ?? 0) / pageSize);

    if (format === "json") {
      return new Response(JSON.stringify({ table, page, pageSize, totalCount, totalPages, rowsInPage: rows.length, data: rows }), {
        headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${table}_page${page}.json"` },
      });
    }

    if (rows.length === 0) {
      return new Response(JSON.stringify({ table, page, totalCount, totalPages, rowsInPage: 0, message: "No more data" }), {
        headers: { "Content-Type": "application/json" },
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
        if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      });
      csvLines.push(values.join(","));
    }

    const csvContent = csvLines.join("\n") + "\n";

    return new Response(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${table}_page${page}.csv"`,
        "X-Total-Count": String(totalCount ?? 0),
        "X-Total-Pages": String(totalPages),
        "X-Rows-In-Page": String(rows.length),
        "X-Page": String(page),
        "X-Page-Size": String(pageSize),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
