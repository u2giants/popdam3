import type { DB } from "../supabase.js";

let demoteCursor: string | null = null;
let demoteDone = false;
let nameTagIds: Map<string, string> | null = null;

/**
 * Mark earlier accepted vision_ai links whose tag is a licensed name as
 * `suggested`, walking files in id order (indexed per file, so folder-based
 * tags sharing those names are never scanned). Nothing is deleted. Returns
 * the number marked in this call.
 */
export async function demoteLicensedNameTags(client: DB, names: ReadonlySet<string>, fileBudget = 3000): Promise<number> {
  if (demoteDone) return 0;
  if (nameTagIds === null) {
    const list = [...names];
    const resolved = new Map<string, string>();
    for (let i = 0; i < list.length; i += 200) {
      const { data, error } = await client.from("style_guide_tags").select("id, normalized_tag").in("normalized_tag", list.slice(i, i + 200));
      if (error) throw new Error(`name tag lookup: ${error.message}`);
      for (const r of data ?? []) resolved.set(r.id as string, r.normalized_tag as string);
    }
    nameTagIds = resolved;
  }
  let marked = 0;
  // Each vision file has at most 18 links. Keep the lookup below the 1,000-row cap.
  const pageSize = 50;
  for (let seen = 0; seen < fileBudget; seen += pageSize) {
    let q = client.from("style_guide_tagging_state").select("style_guide_file_id").eq("pipeline", "vision").eq("status", "completed").order("style_guide_file_id").limit(Math.min(pageSize, fileBudget - seen));
    if (demoteCursor) q = q.gt("style_guide_file_id", demoteCursor);
    const { data: files, error } = await q;
    if (error) throw new Error(`name file page: ${error.message}`);
    const ids = (files ?? []).map(r => r.style_guide_file_id as string);
    if (!ids.length) { demoteDone = true; break; }
    const { data: links, error: le } = await client.from("style_guide_file_tags").select("id, tag_id")
      .in("style_guide_file_id", ids).eq("status", "accepted").eq("source", "vision_ai");
    if (le) throw new Error(`name link lookup: ${le.message}`);
    const hit = (links ?? []).filter(l => nameTagIds!.has(l.tag_id as string)).map(l => l.id as string);
    for (let i = 0; i < hit.length; i += 150) {
      const upd = await client.from("style_guide_file_tags").update({ status: "suggested" }).in("id", hit.slice(i, i + 150));
      if (upd.error) throw new Error(`name link mark: ${upd.error.message}`);
    }
    marked += hit.length;
    demoteCursor = ids[ids.length - 1];
  }
  return marked;
}

let refreshBatch = 1000;
let consecutiveFull = 0;
const FULL_CALLS_BEFORE_GROWTH = 15;

/**
 * Rebuild queued PopSG search records in calls that stay under the API
 * statement timeout: the call size halves on a timeout (down to 50) and grows
 * back after 15 consecutive full calls. Returns the number rebuilt.
 */
export async function refreshSearchSlice(client: DB, maxCalls = 15): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxCalls;) {
    const { data, error } = await client.rpc("refresh_style_guide_matviews", { p_run_id: null, p_search_batch_size: refreshBatch, p_step: "search" });
    if (error) {
      consecutiveFull = 0;
      if (/statement timeout/i.test(error.message) && refreshBatch > 50) { refreshBatch = Math.max(50, Math.floor(refreshBatch / 2)); continue; }
      throw new Error(`search refresh: ${error.message}`);
    }
    const row = (Array.isArray(data) ? data[0] : data) as { search_documents_synced?: number } | null;
    const n = Number(row?.search_documents_synced ?? 0);
    total += n;
    i++;
    if (n < refreshBatch) {
      consecutiveFull = 0;
      break;
    }
    if (++consecutiveFull >= FULL_CALLS_BEFORE_GROWTH) {
      refreshBatch = Math.min(1000, refreshBatch * 2);
      consecutiveFull = 0;
    }
  }
  return total;
}
