import { mergeComputedLicenseStatus } from "@/lib/master-data-workflow";
import { supabase } from "@/integrations/supabase/client";
import { filterStyleTrackerCandidates } from "@/lib/style-tracker-candidates";
import { MASTER_DATA_FETCH_BATCH_SIZE, fetchMasterDataPageRanges, STYLE_TRACKER_ROW_SELECT, nextMasterDataPageOffset, shouldFetchNextMasterDataBatch } from "@/lib/master-data-loading";
import { bridgeWriteCounts } from "@/lib/style-tracker-save";
import { type FieldKey, type StyleRow, type ReviewItem, type LinkCandidate, type PickerOption, type AuditLogEntry, type AuditCell, type SavedView } from "./types";
import { MANUAL_CANDIDATE_LIMIT } from "./columns";
import { designerCandidateScore, compactPickerOptions } from "./helpers";

export async function refreshBridgeWithMeasurement() {
  const result = await supabase.rpc("refresh_style_tracker_item_bridge");
  if (import.meta.env.VITE_POP_INDEXED_WRITE_MEASUREMENT === "1") {
    const counts = bridgeWriteCounts(result.data, result.error);
    // Only aggregate result counts. A failed/unknown attempt remains inconclusive.
    console.info("[indexed-write-measurement]", {
      observed_at: new Date().toISOString(),
      table: "plm.style_tracker_item_bridge", path: "style-tracker-refresh",
      attempted_rows: counts?.attempted_rows ?? null,
      succeeded_rows: counts?.succeeded_rows ?? null,
      inserted_rows: counts?.inserted_rows ?? null,
      updated_rows: counts?.updated_rows ?? null,
      base_total_rows: counts?.base_total_rows ?? null,
    });
  }
  return result;
}

export async function fetchRowsPage(sourceSheet: string, pageOffset: number) {
  const fetchBatch = async (from: number) => {
    const { data, error } = await (supabase as any)
      .from("style_tracker_rows_with_bridge")
      .select(STYLE_TRACKER_ROW_SELECT)
      .eq("source_sheet", sourceSheet)
      .order("source_row_number", { ascending: false })
      .range(from, from + MASTER_DATA_FETCH_BATCH_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as StyleRow[];
    if (!rows.length) return rows;
    const { data: statuses, error: statusError } = await (supabase as any).rpc("get_dam_style_tracker_license_status", { p_row_ids: rows.map((row) => row.id) });
    if (statusError) throw statusError;
    return mergeComputedLicenseStatus(rows, statuses ?? []);
  };

  // PostgREST caps responses at 1,000 rows. A query page is four ordered
  // ranges so the grid can render its first 4,000 rows before later pages load.
  const batches = await fetchMasterDataPageRanges(pageOffset, fetchBatch, sourceSheet);
  return {
    rows: batches.flat(),
    hasNextPage: batches.every((batch) => shouldFetchNextMasterDataBatch(batch.length)),
    nextOffset: nextMasterDataPageOffset(pageOffset),
  };
}

export async function fetchCellAuditLog(cell: AuditCell | null) {
  if (!cell) return [] as AuditLogEntry[];
  const { data, error } = await (supabase as any)
    .from("style_tracker_audit_log_with_user")
    .select("*")
    .eq("style_tracker_row_id", cell.row.id)
    .eq("column_letter", cell.column.letter)
    .order("changed_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as AuditLogEntry[];
}

export function activeViewStorageKey(sourceSheet: string) {
  return `master-data-active-view:${sourceSheet}`;
}

export async function fetchSavedViews(userId: string | undefined, sourceSheet: string) {
  if (!userId) return [] as SavedView[];
  const { data, error } = await (supabase as any)
    .from("style_tracker_user_views")
    .select("id, view_name, source_sheet, column_state, filter_model, updated_at")
    .eq("user_id", userId)
    .eq("source_sheet", sourceSheet)
    .order("view_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SavedView[];
}

export async function fetchCount(sourceSheet: string) {
  const { count, error } = await (supabase as any)
    .from("style_tracker_rows_with_bridge")
    .select("id", { count: "exact", head: true })
    .eq("source_sheet", sourceSheet);
  if (error) throw error;
  return count ?? 0;
}

export async function searchCandidates(item: ReviewItem | null) {
  if (!item) return [] as LinkCandidate[];
  if (item.fieldKey === "designer") {
    const options = await fetchDesignerRecords();
    return options
      .map((designer) => ({
        target_schema: "core",
        target_table: "creative_designer",
        target_id: designer.id,
        target_label: designer.name,
        score: designerCandidateScore(item.rawValue, designer.name),
      }))
      .filter((candidate) => candidate.score >= 0.55)
      .sort((a, b) => b.score - a.score || a.target_label.localeCompare(b.target_label))
      .slice(0, 8);
  }
  const fuzzy = await (supabase as any).rpc("search_style_tracker_link_candidates", {
    p_field_key: item.fieldKey,
    p_query: item.rawValue,
    p_limit: 8,
    p_match_mode: "fuzzy",
  });
  if (fuzzy.error) throw fuzzy.error;
  const fuzzyCandidates = filterStyleTrackerCandidates(item.rawValue, (fuzzy.data ?? []) as LinkCandidate[]);
  if (fuzzyCandidates.length) return fuzzyCandidates.slice(0, 8);
  if (item.fieldKey === "sku") return [];
  const all = await (supabase as any).rpc("search_style_tracker_link_candidates", {
    p_field_key: item.fieldKey,
    p_query: item.rawValue,
    p_limit: 500,
    p_match_mode: "all",
  });
  if (all.error) throw all.error;
  return filterStyleTrackerCandidates(item.rawValue, (all.data ?? []) as LinkCandidate[]).slice(0, 8);
}

export async function searchManualCandidates(item: ReviewItem | null, query: string, showAll: boolean) {
  if (!item) return [] as LinkCandidate[];
  const term = query.trim();
  if (!showAll && term.length < 2) return [] as LinkCandidate[];

  if (!showAll && item.fieldKey !== "designer") {
    const { data, error } = await (supabase as any).rpc("search_style_tracker_link_candidates", {
      p_field_key: item.fieldKey,
      p_query: term,
      p_limit: MANUAL_CANDIDATE_LIMIT,
      p_match_mode: "fuzzy",
    });
    if (error) throw error;
    return (data ?? []) as LinkCandidate[];
  }

  return fetchCandidateTableRows(item.fieldKey, term, showAll);
}

export async function fetchCandidateTableRows(fieldKey: FieldKey, query: string, showAll: boolean) {
  const term = query.trim();
  if (fieldKey === "sku") {
    let q = (supabase as any)
      .from("style_groups")
      .select("id, sku")
      .not("sku", "is", null)
      .order("sku", { ascending: true })
      .limit(MANUAL_CANDIDATE_LIMIT);
    if (term) q = q.ilike("sku", `%${term}%`);
    else if (!showAll) return [] as LinkCandidate[];
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as { id: string; sku: string | null }[])
      .filter((row) => row.id && row.sku)
      .map((row) => ({
        target_schema: "public",
        target_table: "style_groups",
        target_id: row.id,
        target_label: row.sku!,
        score: term ? 0.5 : 0,
      }));
  }

  const tableByField: Partial<Record<FieldKey, string>> = {
    customer: "customer",
    licensor: "licensor",
    designer: "creative_designer",
    factory: "factory",
  };
  const table = tableByField[fieldKey];
  if (!table) return [] as LinkCandidate[];

  let q = (supabase as any)
    .schema("core")
    .from(table)
    .select("id, name")
    .not("name", "is", null)
    .order("name", { ascending: true })
    .limit(MANUAL_CANDIDATE_LIMIT);
  if (term) q = q.ilike("name", `%${term}%`);
  else if (!showAll) return [] as LinkCandidate[];

  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as { id: string; name: string | null }[])
    .filter((row) => row.id && row.name)
    .map((row) => ({
      target_schema: "core",
      target_table: table,
      target_id: row.id,
      target_label: row.name!,
      score: term ? 0.5 : 0,
    }));
}

export async function fetchCustomerOptions() {
  const { data, error } = await (supabase as any)
    .schema("api")
    .from("dam_customer_list")
    .select("id, name, display_name")
    .order("display_name", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { id: string; name: string; display_name: string | null }[])
    .map((customer) => ({ id: customer.id, name: customer.display_name?.trim() || customer.name.trim() }))
    .filter((customer) => customer.id && customer.name);
}

export async function fetchLicensorOptions() {
  const { data, error } = await (supabase as any)
    .schema("core")
    .from("licensor")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) throw error;
  return compactPickerOptions(data);
}

export async function fetchDesignerRecords() {
  const { data, error } = await (supabase as any)
    .schema("core")
    .from("creative_designer")
    .select("id, name")
    .eq("status", "active")
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as PickerOption[]).filter((row) => row.id && row.name);
}

export async function fetchDesignerOptions() {
  return compactPickerOptions(await fetchDesignerRecords());
}

/**
 * Vendor picker options from api.dam_factory_list (global active/potential AND
 * DAM extension active). Do not read core.factory directly from the browser.
 * Labels prefer curated display_name. Values remain free-text names until the
 * separate additive factory_id FK tranche lands (not part of this Step 11 change).
 */
export async function fetchFactoryOptions() {
  const { data, error } = await (supabase as any)
    .schema("api")
    .from("dam_factory_list")
    .select("id, name, display_name")
    .order("display_name", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return compactPickerOptions(
    ((data ?? []) as { id: string; name: string | null; display_name: string | null }[]).map((row) => ({
      id: row.id,
      name: row.display_name?.trim() || row.name?.trim() || "",
    })),
  );
}

export async function fetchPackagingTypeOptions() {
  const { data, error } = await (supabase as any)
    .schema("core")
    .from("packaging_type")
    .select("id, name")
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return compactPickerOptions(data);
}
