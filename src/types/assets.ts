import type { Tables } from "@/integrations/supabase/types";

export type Asset = Tables<"assets">;

export type SortField = "modified_at" | "file_created_at" | "filename" | "file_size";
export type SortDirection = "asc" | "desc";
export type ViewMode = "grid" | "list";

export interface AssetFilters {
  search: string;
  fileType: string[];
  status: string[];
  workflowStatus: string[];
  isLicensed: boolean | null;
  licensorId: string | null;
  propertyId: string | null;
  assetType: string[];
  artSource: string[];
}

export const defaultFilters: AssetFilters = {
  search: "",
  fileType: [],
  status: [],
  workflowStatus: [],
  isLicensed: null,
  licensorId: null,
  propertyId: null,
  assetType: [],
  artSource: [],
};

export interface FilterCounts {
  fileType: Record<string, number>;
  status: Record<string, number>;
  workflowStatus: Record<string, number>;
  isLicensed: { true: number; false: number };
}

export function hasActiveFilters(filters: AssetFilters): boolean {
  return (
    filters.search !== "" ||
    filters.fileType.length > 0 ||
    filters.status.length > 0 ||
    filters.workflowStatus.length > 0 ||
    filters.isLicensed !== null ||
    filters.licensorId !== null ||
    filters.propertyId !== null ||
    filters.assetType.length > 0 ||
    filters.artSource.length > 0
  );
}

export function countActiveFilters(filters: AssetFilters): number {
  let count = 0;
  if (filters.fileType.length > 0) count++;
  if (filters.status.length > 0) count++;
  if (filters.workflowStatus.length > 0) count++;
  if (filters.isLicensed !== null) count++;
  if (filters.licensorId) count++;
  if (filters.propertyId) count++;
  if (filters.assetType.length > 0) count++;
  if (filters.artSource.length > 0) count++;
  return count;
}
