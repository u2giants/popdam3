import type { Tables } from "@/integrations/supabase/types";

export type Asset = Tables<"assets">;

export type SortField = "relevance" | "modified_at" | "file_created_at" | "filename" | "file_size" | "sku" | "asset_count";
export type SortDirection = "asc" | "desc";
export type ViewMode = "grid" | "list";
export type LibraryMode = "groups" | "assets";
export type CardStyle = "gallery" | "editorial" | "compact";

export type FileStatusFilter = "has_preview" | "no_preview_renderable" | "no_pdf_compat" | "no_preview_unsupported";

export interface AssetFilters {
  search: string;
  fileType: string[];
  contentType: string[];
  /** Production material projected from rich-PDF extraction (assets.product_material). */
  productMaterial: string[];
  status: string[];
  workflowStatus: string[];
  isLicensed: boolean | null;
  licensorId: string | null;
  propertyId: string | null;
  assetType: string[];
  artSource: string[];
  tagFilter: string;
  fileStatus: FileStatusFilter[];
  productCategory: string[];
  /** Pipeline stage inferred from the folder under "____New Structure" (multi-select) */
  stage: string[];
  /** Customer inferred from the folder path (single-select) */
  customer: string | null;
  /** Customer program inferred from the folder path (single-select) */
  program: string | null;
}

/** Pipeline stages, as named by the NAS folder tree under "____New Structure". */
export const STAGE_OPTIONS = [
  "In Development",
  "Concept Approved Designs",
  "Product Ideas",
  "Freelancer art",
  "Discontinued",
] as const;

export const defaultFilters: AssetFilters = {
  search: "",
  fileType: [],
  contentType: [],
  productMaterial: [],
  status: [],
  workflowStatus: [],
  isLicensed: null,
  licensorId: null,
  propertyId: null,
  assetType: [],
  artSource: [],
  tagFilter: "",
  fileStatus: [],
  productCategory: [],
  stage: [],
  customer: null,
  program: null,
};

export interface FacetCounts {
  fileType: Record<string, number>;
  status: Record<string, number>;
  workflowStatus: Record<string, number>;
  isLicensed: { true: number; false: number };
  stage: Record<string, number>;
}

export function hasActiveFilters(filters: AssetFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.fileType.length > 0 ||
    filters.contentType.length > 0 ||
    filters.productMaterial.length > 0 ||
    filters.status.length > 0 ||
    filters.workflowStatus.length > 0 ||
    filters.isLicensed !== null ||
    filters.licensorId !== null ||
    filters.propertyId !== null ||
    filters.assetType.length > 0 ||
    filters.artSource.length > 0 ||
    filters.tagFilter !== "" ||
    filters.fileStatus.length > 0 ||
    filters.productCategory.length > 0 ||
    filters.stage.length > 0 ||
    filters.customer !== null ||
    filters.program !== null
  );
}

export function countActiveFilters(filters: AssetFilters): number {
  let count = 0;
  if (filters.fileType.length > 0) count++;
  if (filters.contentType.length > 0) count++;
  if (filters.productMaterial.length > 0) count++;
  if (filters.status.length > 0) count++;
  if (filters.workflowStatus.length > 0) count++;
  if (filters.isLicensed !== null) count++;
  if (filters.licensorId) count++;
  if (filters.propertyId) count++;
  if (filters.assetType.length > 0) count++;
  if (filters.artSource.length > 0) count++;
  if (filters.tagFilter) count++;
  if (filters.fileStatus.length > 0) count++;
  if (filters.productCategory.length > 0) count++;
  if (filters.stage.length > 0) count++;
  if (filters.customer) count++;
  if (filters.program) count++;
  return count;
}
