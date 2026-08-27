import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Effective metadata for one asset — the union of the facts its Style Group owns
 * and the facts that describe this file alone.
 *
 * Group facts are NOT copied onto member assets; they are read live through the
 * governed contract `public.get_effective_asset_metadata`. That is the whole
 * point of issue #96: a technical drawing must be findable by the product's
 * shared facts without inheriting a photograph's view or colours.
 */

export type TagScope = "style_group" | "asset";
export type TagStatus = "active" | "candidate" | "rejected";

export type EffectiveTag = {
  scope: TagScope;
  tag: string;
  category: string;
  source: string;
  status: TagStatus;
  confidence: number | null;
  model: string | null;
  createdBy: string | null;
};

export type EffectiveAssetMetadata = {
  /** Shared product/artwork facts, owned by the Style Group. */
  groupTags: EffectiveTag[];
  /** Group facts the AI suggested but that are not confirmed yet. */
  groupCandidates: EffectiveTag[];
  /** Facts that describe this file only. */
  assetTags: EffectiveTag[];
  /** Asset-scope suggestions awaiting review. */
  assetCandidates: EffectiveTag[];
  /** Rejected facts, kept as tombstones so an AI rerun cannot reinstate them. */
  rejected: EffectiveTag[];
  /** Identity to display/filter by: the group's when grouped, the asset's when not. */
  effectiveLicensorId: string | null;
  effectivePropertyId: string | null;
  styleGroupId: string | null;
};

/** Human labels for where a fact came from. Shown as a chip tooltip. */
export const TAG_SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  authoritative: "Master Data",
  erp: "ERP",
  rich_pdf: "Rich PDF",
  group_ai: "Group AI",
  file_ai: "File AI",
  ai: "File AI",
  legacy_unscoped: "Legacy (unscoped)",
};

export function tagSourceLabel(source: string | null | undefined): string {
  if (!source) return "Unknown";
  return TAG_SOURCE_LABELS[source] ?? source;
}

/** Sources whose facts come from business data and are never AI guesses. */
export function isAuthoritativeSource(source: string | null | undefined): boolean {
  return source === "manual" || source === "authoritative" || source === "erp";
}

type RawRow = {
  scope: string;
  tag: string;
  category: string;
  source: string;
  status: string;
  confidence: number | null;
  model: string | null;
  created_by: string | null;
  effective_licensor_id: string | null;
  effective_property_id: string | null;
  style_group_id: string | null;
};

export function groupEffectiveRows(rows: RawRow[]): EffectiveAssetMetadata {
  const result: EffectiveAssetMetadata = {
    groupTags: [],
    groupCandidates: [],
    assetTags: [],
    assetCandidates: [],
    rejected: [],
    effectiveLicensorId: null,
    effectivePropertyId: null,
    styleGroupId: null,
  };

  for (const row of rows) {
    result.effectiveLicensorId ??= row.effective_licensor_id;
    result.effectivePropertyId ??= row.effective_property_id;
    result.styleGroupId ??= row.style_group_id;

    const tag: EffectiveTag = {
      scope: row.scope === "style_group" ? "style_group" : "asset",
      tag: row.tag,
      category: row.category,
      source: row.source,
      status: (["active", "candidate", "rejected"].includes(row.status) ? row.status : "active") as TagStatus,
      confidence: row.confidence,
      model: row.model,
      createdBy: row.created_by,
    };

    if (tag.status === "rejected") result.rejected.push(tag);
    else if (tag.scope === "style_group") {
      (tag.status === "candidate" ? result.groupCandidates : result.groupTags).push(tag);
    } else {
      (tag.status === "candidate" ? result.assetCandidates : result.assetTags).push(tag);
    }
  }

  // Manual and business-owned facts first, then AI, then alphabetical — the same
  // priority order the writers enforce.
  const rank = (tag: EffectiveTag) => (isAuthoritativeSource(tag.source) ? 0 : 1);
  for (const list of [result.groupTags, result.groupCandidates, result.assetTags, result.assetCandidates, result.rejected]) {
    list.sort((a, b) => rank(a) - rank(b) || a.tag.localeCompare(b.tag));
  }
  return result;
}

export function useEffectiveAssetTags(assetId: string | null | undefined) {
  return useQuery({
    queryKey: ["effective-asset-tags", assetId],
    enabled: Boolean(assetId),
    queryFn: async (): Promise<EffectiveAssetMetadata> => {
      const { data, error } = await supabase.rpc("get_effective_asset_metadata", { p_asset_id: assetId as string });
      if (error) throw error;
      return groupEffectiveRows((data ?? []) as unknown as RawRow[]);
    },
  });
}
