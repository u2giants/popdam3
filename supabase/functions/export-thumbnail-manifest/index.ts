/**
 * Export a flat thumbnail manifest as CSV for migration.
 *
 * GET /export-thumbnail-manifest
 *
 * Returns CSV with columns:
 *   old_asset_id, relative_path, filename, quick_hash, thumbnail_url
 *
 * Only includes rows where thumbnail_url IS NOT NULL.
 * Paginates internally (PostgREST 1000-row pages) and streams the full result.
 *
 * Auth: admin JWT or service role key.
 */

import { corsHeaders, err, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/service-client.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

async function authorizeAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (serviceKey && authHeader.includes(serviceKey)) return true;

  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token || token === serviceKey) return false;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await userClient.auth.getUser(token);
  if (!user || error) return false;

  const svc = serviceClient();
  const { data: roleRow } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  return !!roleRow;
}

function escapeCSV(val: string | null): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!(await authorizeAdmin(req))) {
      return err("Unauthorized", 401);
    }

    const db = serviceClient();
    const PAGE = 1000;
    const columns = ["id", "relative_path", "filename", "quick_hash", "thumbnail_url"];
    const header = "old_asset_id,relative_path,filename,quick_hash,thumbnail_url\n";

    const chunks: string[] = [header];
    let offset = 0;

    while (true) {
      const { data, error } = await db
        .from("assets")
        .select(columns.join(","))
        .not("thumbnail_url", "is", null)
        .eq("is_deleted", false)
        .range(offset, offset + PAGE - 1);

      if (error) return err(error.message, 500);
      if (!data || data.length === 0) break;

      for (const row of data as Array<{ id: string; relative_path: string; filename: string; quick_hash: string; thumbnail_url: string }>) {
        chunks.push(
          [
            escapeCSV(row.id),
            escapeCSV(row.relative_path),
            escapeCSV(row.filename),
            escapeCSV(row.quick_hash),
            escapeCSV(row.thumbnail_url),
          ].join(",") + "\n",
        );
      }

      if (data.length < PAGE) break;
      offset += PAGE;
    }

    const csv = chunks.join("");
    const rowCount = chunks.length - 1; // minus header

    return new Response(csv, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="thumbnail_manifest.csv"`,
        "X-Row-Count": String(rowCount),
      },
    });
  } catch (e) {
    return err(String(e), 500);
  }
});
