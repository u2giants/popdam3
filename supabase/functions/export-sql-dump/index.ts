import {
  afterCursorFilter,
  clampChunkSize,
  clearTableSQL,
  decodeCursor,
  encodeCursor,
  insertRowSQL,
  type ManifestEntry,
  manifestEntry,
  parseCutoff,
  snapshotColumn,
} from "../_shared/export-pagination.ts";
/**
 * Chunked SQL data exporter for migration from Lovable Cloud.
 *
 * Two modes:
 *   GET ?action=manifest   → JSON with table names, row counts and a snapshot
 *                            cutoff; counts include only rows inserted by it
 *   GET ?table=X&offset=Y&cutoff=C[&after=K]
 *                          → SQL file with the next rows after keyset cursor K
 *                            (none = start), inserted by C. X-Next-Cursor
 *                            carries the cursor for the following chunk.
 *
 * Live ingestion keeps writing while an export runs (#1132): the cutoff keeps
 * counts stable and keyset paging keeps rows from shifting between chunks.
 * offset only labels the chunk.
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

import { createClient } from "../_shared/supabase-js.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsServe } from "../_shared/http.ts";
import { orderedTableSource, tableSource } from "../_shared/export-tables.ts";

// Tables in dependency order (parents first)
const TABLES_IN_ORDER = [
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

function sqlTarget(table: string): string {
  if (table === "licensors") return "core.licensor";
  if (table === "properties") return "core.property";
  return `public.${table}`;
}

// ── Auth helper ─────────────────────────────────────────────────────

async function authorizeAdmin(req: Request): Promise<boolean> {
  const auth = await requireAdmin(req, { parseMode: "loose", allowServiceRole: true });
  return auth.ok;
}

// ── Main handler ────────────────────────────────────────────────────

corsServe(async (req) => {
  try {
    if (!(await authorizeAdmin(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const db = createClient(supabaseUrl, serviceKey);

    // ── MANIFEST ──────────────────────────────────────────────────
    if (action === "manifest") {
      let chunkSize: number;
      try {
        chunkSize = clampChunkSize(parseInt(url.searchParams.get("chunk_size") ?? String(DEFAULT_CHUNK), 10));
      } catch {
        return new Response(JSON.stringify({ error: "Invalid chunk_size" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const cutoff = new Date().toISOString();
      const tables: ManifestEntry[] = [];

      for (const table of TABLES_IN_ORDER) {
        const col = snapshotColumn(table);
        let countQuery = tableSource(db, table).select("*", { count: "exact", head: true });
        if (col) countQuery = countQuery.lte(col, cutoff);
        const { count, error } = await countQuery;
        try {
          tables.push(manifestEntry(table, count, error, chunkSize));
        } catch (e) {
          // Never release a manifest that silently drops a table (#1082).
          return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e), table, complete: false }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify({ chunkSize, cutoff, tables, complete: true, generated: new Date().toISOString() }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── CHUNK EXPORT ──────────────────────────────────────────────
    const table = url.searchParams.get("table");
    if (!table || !TABLES_IN_ORDER.includes(table)) {
      return new Response(
        JSON.stringify({ error: `Provide ?table=NAME. Valid: ${TABLES_IN_ORDER.join(", ")}` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    let chunkSize: number;
    let cutoff: string | null;
    let afterKey: string[] | null;
    try {
      chunkSize = clampChunkSize(parseInt(url.searchParams.get("chunk_size") ?? String(DEFAULT_CHUNK), 10));
      cutoff = parseCutoff(url.searchParams.get("cutoff"));
      const after = url.searchParams.get("after");
      afterKey = after ? decodeCursor(table, after) : null;
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      return new Response(JSON.stringify({ error: "Invalid offset" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const includeTruncate = url.searchParams.get("truncate") === "true" && offset === 0;
    const col = snapshotColumn(table);

    // Fetch rows in PostgREST pages, keyset-ordered after the cursor
    const rows: Record<string, unknown>[] = [];
    while (rows.length < chunkSize) {
      const requested = Math.min(POSTGREST_PAGE, chunkSize - rows.length);
      let query = orderedTableSource(db, table);
      if (col && cutoff) query = query.lte(col, cutoff);
      if (afterKey) query = query.or(afterCursorFilter(table, afterKey));
      const { data: page, error } = await query.limit(requested);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (!page || page.length === 0) break;
      for (const r of page) rows.push(r as Record<string, unknown>);
      if (page.length < requested) break;
      afterKey = decodeCursor(table, encodeCursor(table, rows[rows.length - 1]));
    }
    const nextCursor = rows.length ? encodeCursor(table, rows[rows.length - 1]) : "";

    // Build SQL
    const lines: string[] = [];
    const chunkIndex = Math.floor(offset / chunkSize);
    lines.push(`-- PopDAM data export: ${table} chunk ${chunkIndex} (offset ${offset}, limit ${chunkSize})`);
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("BEGIN;");
    lines.push("SET session_replication_role = 'replica';");
    lines.push("");

    const clear = includeTruncate ? clearTableSQL(sqlTarget(table)) : null;
    if (clear) {
      lines.push(clear);
      lines.push("");
    }

    if (rows.length === 0) {
      lines.push(`-- ${table}: no rows in this range`);
    } else {
      for (const row of rows) lines.push(insertRowSQL(sqlTarget(table), row));
    }

    lines.push("");
    lines.push("SET session_replication_role = 'origin';");
    lines.push("COMMIT;");
    lines.push("");

    const sqlContent = lines.join("\n");
    const filename = `${table}_chunk${String(chunkIndex).padStart(3, "0")}.sql`;

    return new Response(sqlContent, {
      headers: {
        "Content-Type": "text/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Table": table,
        "X-Offset": String(offset),
        "X-Rows-In-Chunk": String(rows.length),
        "X-Next-Cursor": nextCursor,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
