/**
 * Bulk AI tagging handlers extracted from admin-api.
 */

import { serviceClient } from "../service-client.ts";
import { err, json } from "../http.ts";

// ── Route: bulk-ai-tag / bulk-ai-tag-all ────────────────────────────

export async function handleBulkAiTag(body: Record<string, unknown>, tagAll: boolean) {
  const offset = typeof body.offset === "number" ? body.offset : 0;
  const groupIds = Array.isArray(body.group_ids) ? body.group_ids as string[] : null;
  const BATCH_SIZE = 2; // One 2-wide chunk per admin-api invocation to stay under gateway budget
  const CONCURRENCY = 2; // Single parallel wave matching batch size
  const AI_TAG_TIMEOUT_MS = 25_000;
  const db = serviceClient();

  // Smart-skip: for untagged mode, exclude style groups that already have a tagged representative
  let excludeGroupIds: string[] = [];
  if (!tagAll && !groupIds) {
    const { data: taggedGroups } = await db
      .from("assets")
      .select("style_group_id")
      .eq("is_deleted", false)
      .eq("status", "tagged")
      .not("style_group_id", "is", null)
      .not("ai_tagged_at", "is", null)
      .limit(1000);
    if (taggedGroups) {
      excludeGroupIds = [...new Set(taggedGroups.map((r: { style_group_id: string }) => r.style_group_id))];
    }
  }

  let query = db
    .from("assets")
    .select("id, thumbnail_url, filename, relative_path")
    .eq("is_deleted", false)
    .not("thumbnail_url", "is", null)
    // Skip packaging files — groups with only packaging wait for better siblings
    .not("primary_sort_tier", "in", "(4,8)");

  // Optional group filter (for BulkActionBar group-based tagging)
  if (groupIds && groupIds.length > 0) {
    query = query.in("style_group_id", groupIds);
  }

  if (!tagAll && !groupIds) {
    query = query.neq("status", "tagged");
  }

  // Exclude groups that already have a tagged representative
  if (excludeGroupIds.length > 0 && excludeGroupIds.length <= 200) {
    query = query.not("style_group_id", "in", `(${excludeGroupIds.join(",")})`);
  }

  const { data: assets, error } = await query
    .order("id")
    .range(offset, offset + BATCH_SIZE - 1);

  if (error) return err(error.message, 500);
  if (!assets || assets.length === 0) {
    return json({ ok: true, tagged: 0, failed: 0, skipped: 0, failure_samples: [], skip_samples: [], done: true, nextOffset: offset });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  let tagged = 0;
  let skipped = 0;
  let failed = 0;

  const failureSamples: Array<{
    at: string;
    asset_id: string;
    filename: string;
    relative_path: string;
    thumbnail_url?: string;
    http_status?: number;
    error: string;
  }> = [];

  const skipSamples: Array<{
    at: string;
    asset_id: string;
    filename: string;
    relative_path: string;
    thumbnail_url?: string;
    reason: string;
  }> = [];

  const parseErrorBody = (text: string): string => {
    const trimmed = (text || "").trim();
    if (!trimmed) return "Unknown error";
    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
      const e = typeof parsed?.error === "string" ? parsed.error : null;
      const m = typeof parsed?.message === "string" ? parsed.message : null;
      return (e || m || trimmed).slice(0, 500);
    } catch {
      return trimmed.slice(0, 500);
    }
  };

  // Process assets in parallel chunks of CONCURRENCY
  for (let i = 0; i < assets.length; i += CONCURRENCY) {
    const chunk = assets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (asset) => {
        const res = await fetch(`${supabaseUrl}/functions/v1/ai-tag`, {
          signal: AbortSignal.timeout(AI_TAG_TIMEOUT_MS),
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${anonKey}`,
          },
          body: JSON.stringify({ asset_id: asset.id, force: tagAll }),
        });

        if (res.ok) {
          const result = await res.json();
          return {
            outcome: result.skipped ? "skipped" as const : "tagged" as const,
            asset_id: asset.id as string,
            filename: (asset.filename as string) || "(unknown)",
            relative_path: (asset.relative_path as string) || "(unknown)",
            thumbnail_url: (asset.thumbnail_url as string) || undefined,
            skip_reason: result.skipped ? (result.reason || "Already tagged") : undefined,
          };
        }

        const bodyText = await res.text().catch(() => "");
        return {
          outcome: "failed" as const,
          at: new Date().toISOString(),
          asset_id: asset.id as string,
          filename: (asset.filename as string) || "(unknown)",
          relative_path: (asset.relative_path as string) || "(unknown)",
          thumbnail_url: (asset.thumbnail_url as string) || undefined,
          http_status: res.status,
          error: parseErrorBody(bodyText) || `HTTP ${res.status}`,
        };
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        const v = r.value;
        if (v.outcome === "tagged") tagged++;
        else if (v.outcome === "skipped") {
          skipped++;
          skipSamples.push({
            at: new Date().toISOString(),
            asset_id: v.asset_id,
            filename: v.filename,
            relative_path: v.relative_path,
            thumbnail_url: v.thumbnail_url,
            reason: v.skip_reason || "Already tagged",
          });
        } else if (v.outcome === "failed") {
          failed++;
          console.error("bulk-ai-tag asset failed", { assetId: v.asset_id, httpStatus: v.http_status });
          failureSamples.push({
            at: v.at,
            asset_id: v.asset_id,
            filename: v.filename,
            relative_path: v.relative_path,
            thumbnail_url: v.thumbnail_url,
            http_status: v.http_status,
            error: v.error,
          });
        }
      } else {
        failed++;
        console.error("bulk-ai-tag asset rejected", { error: String(r.reason).slice(0, 200) });
        failureSamples.push({
          at: new Date().toISOString(),
          asset_id: "(unknown)",
          filename: "(unknown)",
          relative_path: "(unknown)",
          error: (r.reason instanceof Error ? r.reason.message : String(r.reason || "Unknown error")).slice(0, 500),
        });
      }
    }
  }

  const done = assets.length < BATCH_SIZE;
  return json({ ok: true, tagged, skipped, failed, failure_samples: failureSamples, skip_samples: skipSamples, done, nextOffset: offset + assets.length });
}

// ── Route: count-untagged-assets ────────────────────────────────────

export async function handleCountUntaggedAssets() {
  const db = serviceClient();

  // Smart count: reflects what bulk-ai-tag will actually process
  // = groups needing a tagged representative + ungrouped untagged assets
  // Written as a plain SELECT (no CTE) so execute_readonly_query validation passes.
  const { data: smartCounts, error: smartErr } = await db.rpc("execute_readonly_query", {
    query_text: `
      SELECT
        (
          SELECT count(DISTINCT a.style_group_id)::int
          FROM assets a
          WHERE a.is_deleted = false
            AND a.thumbnail_url IS NOT NULL
            AND a.primary_sort_tier NOT IN (4, 8)
            AND a.style_group_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM assets ta
              WHERE ta.style_group_id = a.style_group_id
                AND ta.is_deleted = false
                AND ta.status = 'tagged'
                AND ta.ai_tagged_at IS NOT NULL
            )
        ) + (
          SELECT count(*)::int FROM assets
          WHERE is_deleted = false
            AND thumbnail_url IS NOT NULL
            AND primary_sort_tier NOT IN (4, 8)
            AND status != 'tagged'
            AND style_group_id IS NULL
        ) AS smart_count,
        (
          SELECT count(DISTINCT sg.id)::int
          FROM style_groups sg
          WHERE sg.asset_count > 0
            AND NOT EXISTS (
              SELECT 1 FROM assets a
              WHERE a.style_group_id = sg.id
                AND a.is_deleted = false
                AND a.primary_sort_tier NOT IN (4, 8)
            )
            AND NOT EXISTS (
              SELECT 1 FROM assets ta
              WHERE ta.style_group_id = sg.id
                AND ta.is_deleted = false
                AND ta.status = 'tagged'
                AND ta.ai_tagged_at IS NOT NULL
            )
        ) AS waiting_for_siblings
    `,
  });

  if (smartErr) {
    console.error("handleCountUntaggedAssets: execute_readonly_query failed:", smartErr.message);
  }

  const smartCount = (smartCounts as Array<{ smart_count: number; waiting_for_siblings: number }>)?.[0]?.smart_count ?? 0;
  const waitingForSiblings = (smartCounts as Array<{ smart_count: number; waiting_for_siblings: number }>)?.[0]?.waiting_for_siblings ?? 0;

  const { count: totalWithThumb } = await db
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("is_deleted", false)
    .not("thumbnail_url", "is", null);

  return json({
    ok: true,
    count: Number(smartCount),
    totalWithThumbnails: totalWithThumb ?? 0,
    waitingForSiblings: Number(waitingForSiblings),
  });
}
