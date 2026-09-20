export type PopSGSearchMode = "guides" | "files";
export type PopSGSearchSortField = "modified_at" | "name" | "size";
export type PopSGSearchSortDirection = "asc" | "desc";
export type PopSGPreviewFilter = "any" | "has" | "missing";

export interface PopSGSearchFilters {
  licensor: string;
  property: string;
  query: string;
  extensions: string[];
  preview: PopSGPreviewFilter;
}

export interface PopSGSearchRequest {
  mode: PopSGSearchMode;
  filters: PopSGSearchFilters;
  sortField: PopSGSearchSortField;
  sortDirection: PopSGSearchSortDirection;
  limit: number;
  offset: number;
}

export interface PopSGSearchPayload {
  result_mode: PopSGSearchMode;
  total: number;
  limit: number;
  offset: number;
  sort: string;
  query: string | null;
  results: Record<string, unknown>[];
  facets: Record<string, unknown>;
}

export interface PopSGV2FileViewRow {
  id: string;
  filename: string;
  relative_path: string;
  directory_path: string;
  file_extension: string | null;
  licensor_name: string | null;
  property_folder: string | null;
  size_bytes: number | null;
  modified_at: string | null;
  thumbnail_url: string | null;
  thumbnail_error: string | null;
  render_exception_state: string | null;
  has_talent_likeness: null;
}

export interface PopSGV2GuideViewRow {
  group_key: string;
  root_label: string | null;
  directory_path: string;
  licensor_name: string | null;
  property_folder: string | null;
  style_guide_folder: string | null;
  style_guide_name: string;
  file_count: number;
  latest_modified_at: string | null;
  total_size_bytes: number | null;
  sample_thumbnail_url: string | null;
  member_directory_paths: string[];
}

export interface PopSGGuideSummaryRow {
  root_label: string | null;
  directory_path: string | null;
  licensor_name: string | null;
  property_folder: string | null;
  style_guide_folder: string | null;
  style_guide_name: string | null;
  file_count: number | null;
  total_size_bytes: number | null;
}

export const POPSG_SEARCH_RPC_LIMIT = 200;
export const POPSG_SUMMARY_PAGE_SIZE = 1_000;
export const POPSG_SUMMARY_MAX_ROWS = 5_000;
export const POPSG_SUMMARY_IDENTITIES_PER_QUERY = 20;

export function buildPopSGV2WebsearchQuery(terms: string[]): string {
  const normalized = Array.from(new Set(terms.map((term) => term
    .replace(/["\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase())
    .filter(Boolean)));
  return normalized.map((term, index) => index === 0 ? term : `"${term}"`).join(" OR ");
}

/**
 * The v2 contract intentionally exposes only stable indexed sorts. Keep the
 * legacy view path for the two unsupported UI choices until the RPC grows an
 * equivalent size/name-desc contract; silently changing their ordering would
 * make pagination incorrect.
 */
export function getPopSGV2Sort(
  field: PopSGSearchSortField,
  direction: PopSGSearchSortDirection,
  query = "",
): string | null {
  // Search is always ranked by the comprehensive v2 contract. Falling back to
  // a path-only view just to honor a secondary sort would silently drop tag-
  // and PDF-text-only matches.
  if (query.trim()) return "relevance";
  if (field === "modified_at") return direction === "asc" ? "modified_asc" : "modified_desc";
  if (field === "name" && direction === "asc") return "name_asc";
  return null;
}

export function canUsePopSGV2(
  mode: PopSGSearchMode,
  preview: PopSGPreviewFilter,
  field: PopSGSearchSortField,
  direction: PopSGSearchSortDirection,
  query = "",
): boolean {
  if (!getPopSGV2Sort(field, direction, query)) return false;
  // During search the UI explicitly labels Preview as a matching-file filter,
  // so v2's child-before-group semantics are truthful and comprehensive.
  if (query.trim()) return true;
  // The v2 guide filter selects matching children before grouping. The current
  // UI means "the guide has/has no sample preview", so keep that whole-guide
  // behavior on the summary view until the RPC exposes guide-level semantics.
  return mode !== "guides" || preview === "any";
}

export function getPopSGSummaryContinuationOffsets(total: number): number[] {
  if (total > POPSG_SUMMARY_MAX_ROWS) {
    throw new Error("PopSG guide summary exceeded the bounded enrichment limit.");
  }
  const offsets: number[] = [];
  for (let offset = POPSG_SUMMARY_PAGE_SIZE; offset < total; offset += POPSG_SUMMARY_PAGE_SIZE) {
    offsets.push(offset);
  }
  return offsets;
}

function postgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildPopSGSummaryIdentityFilters(guides: PopSGV2GuideViewRow[]): string[] {
  const clauses = guides.map((guide) => {
    const fields = [
      ["root_label", guide.root_label],
      ["licensor_name", guide.licensor_name],
      ["property_folder", guide.property_folder],
      ["style_guide_folder", guide.style_guide_folder],
      ["style_guide_name", guide.style_guide_name],
    ] as const;
    return `and(${fields.map(([key, value]) => value === null
      ? `${key}.is.null`
      : `${key}.eq.${postgrestValue(value)}`).join(",")})`;
  });
  const filters: string[] = [];
  for (let index = 0; index < clauses.length; index += POPSG_SUMMARY_IDENTITIES_PER_QUERY) {
    filters.push(clauses.slice(index, index + POPSG_SUMMARY_IDENTITIES_PER_QUERY).join(","));
  }
  return filters;
}

export function buildPopSGV2Args(request: PopSGSearchRequest) {
  const sort = getPopSGV2Sort(request.sortField, request.sortDirection, request.filters.query);
  if (!sort) throw new Error("The requested sort is not supported by PopSG search v2.");

  return {
    p_result_mode: request.mode,
    p_query: request.filters.query || undefined,
    p_licensors: request.filters.licensor === "all" ? undefined : [request.filters.licensor],
    p_properties: request.filters.property === "all" ? undefined : [request.filters.property],
    p_extensions:
      request.mode === "files" && request.filters.extensions.length > 0
        ? request.filters.extensions
        : undefined,
    p_preview_states:
      request.filters.preview === "has"
        ? ["available"]
        : request.filters.preview === "missing"
          ? ["missing"]
          : undefined,
    p_sort: sort,
    p_limit: Math.max(1, Math.min(request.limit, POPSG_SEARCH_RPC_LIMIT)),
    p_offset: Math.max(0, request.offset),
  };
}

export function parsePopSGV2Payload(value: unknown): PopSGSearchPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PopSG search returned an invalid response.");
  }

  const payload = value as Record<string, unknown>;
  if (
    (payload.result_mode !== "guides" && payload.result_mode !== "files") ||
    typeof payload.total !== "number" ||
    !Number.isFinite(payload.total) ||
    !Array.isArray(payload.results)
  ) {
    throw new Error("PopSG search returned an invalid response.");
  }

  return {
    result_mode: payload.result_mode,
    total: Math.max(0, Math.trunc(payload.total)),
    limit: typeof payload.limit === "number" ? payload.limit : POPSG_SEARCH_RPC_LIMIT,
    offset: typeof payload.offset === "number" ? payload.offset : 0,
    sort: typeof payload.sort === "string" ? payload.sort : "modified_desc",
    query: typeof payload.query === "string" ? payload.query : null,
    results: payload.results.filter(
      (row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row),
    ),
    facets:
      payload.facets && typeof payload.facets === "object" && !Array.isArray(payload.facets)
        ? payload.facets as Record<string, unknown>
        : {},
  };
}

function stringValue(row: Record<string, unknown>, key: string): string | null {
  return typeof row[key] === "string" ? row[key] : null;
}

function numberValue(row: Record<string, unknown>, key: string): number | null {
  return typeof row[key] === "number" && Number.isFinite(row[key]) ? row[key] : null;
}

export function mapPopSGV2File(row: Record<string, unknown>): PopSGV2FileViewRow {
  const id = stringValue(row, "style_guide_file_id");
  const filename = stringValue(row, "filename");
  const relativePath = stringValue(row, "relative_path");
  const directoryPath = stringValue(row, "directory_path");
  if (!id || !filename || relativePath === null || directoryPath === null) {
    throw new Error("PopSG search returned an incomplete file result.");
  }

  const renderState = stringValue(row, "render_exception_state");
  return {
    id,
    filename,
    relative_path: relativePath,
    directory_path: directoryPath,
    file_extension: stringValue(row, "file_extension"),
    licensor_name: stringValue(row, "licensor_name"),
    property_folder: stringValue(row, "property_folder"),
    size_bytes: numberValue(row, "size_bytes"),
    modified_at: stringValue(row, "modified_at"),
    thumbnail_url: stringValue(row, "thumbnail_url"),
    thumbnail_error:
      renderState === "recoverable_error" || renderState === "terminal_exception"
        ? renderState
        : null,
    render_exception_state: renderState,
    has_talent_likeness: null,
  };
}

export function mapPopSGV2Guide(row: Record<string, unknown>): PopSGV2GuideViewRow {
  const groupKey = stringValue(row, "guide_key");
  const styleGuideName = stringValue(row, "style_guide_name");
  if (!groupKey || !styleGuideName) {
    throw new Error("PopSG search returned an incomplete guide result.");
  }

  const licensor = stringValue(row, "licensor_name");
  const property = stringValue(row, "property_folder");
  const styleGuideFolder = stringValue(row, "style_guide_folder");
  const pathParts = [licensor, property, styleGuideFolder ?? styleGuideName]
    .filter((part): part is string => !!part)
    .filter((part, index, parts) => index === 0 || part !== parts[index - 1]);

  return {
    group_key: groupKey,
    root_label: stringValue(row, "root_label"),
    directory_path: pathParts.join("/") || styleGuideName,
    licensor_name: licensor,
    property_folder: property,
    style_guide_folder: styleGuideFolder,
    style_guide_name: styleGuideName,
    file_count: numberValue(row, "matched_file_count") ?? 0,
    latest_modified_at: stringValue(row, "modified_at"),
    total_size_bytes: null,
    sample_thumbnail_url: stringValue(row, "thumbnail_url"),
    member_directory_paths: [pathParts.join("/") || styleGuideName],
  };
}

function guideIdentityKey(row: {
  root_label: string | null;
  licensor_name: string | null;
  property_folder: string | null;
  style_guide_folder: string | null;
  style_guide_name: string | null;
}): string {
  return [
    row.root_label ?? "",
    row.licensor_name ?? "",
    row.property_folder ?? "",
    row.style_guide_folder ?? "",
    row.style_guide_name ?? "",
  ].join("\u001f");
}

export function enrichPopSGV2Guides(
  guides: PopSGV2GuideViewRow[],
  summaries: PopSGGuideSummaryRow[],
): PopSGV2GuideViewRow[] {
  const aggregates = new Map<string, { fileCount: number; totalSize: number; paths: string[] }>();
  for (const summary of summaries) {
    const key = guideIdentityKey(summary);
    const current = aggregates.get(key) ?? { fileCount: 0, totalSize: 0, paths: [] };
    current.fileCount += summary.file_count ?? 0;
    current.totalSize += summary.total_size_bytes ?? 0;
    if (summary.directory_path) current.paths.push(summary.directory_path);
    aggregates.set(key, current);
  }

  return guides.map((guide) => {
    const aggregate = aggregates.get(guideIdentityKey(guide));
    if (!aggregate) return guide;
    const memberDirectoryPaths = Array.from(new Set(aggregate.paths));
    return {
      ...guide,
      // The card and detail drawer describe the whole guide. v2's matched
      // child count is useful for ranking, but displaying it here would make
      // the count disagree with the complete member drawer.
      file_count: aggregate.fileCount,
      total_size_bytes: aggregate.totalSize,
      directory_path: memberDirectoryPaths.length === 1 ? memberDirectoryPaths[0] : guide.directory_path,
      member_directory_paths: memberDirectoryPaths,
    };
  });
}

export function getPopSGV2ContinuationOffsets(
  pageOffset: number,
  pageSize: number,
  total: number,
): number[] {
  const available = Math.max(0, Math.min(pageSize, total - pageOffset));
  const offsets: number[] = [];
  for (let consumed = POPSG_SEARCH_RPC_LIMIT; consumed < available; consumed += POPSG_SEARCH_RPC_LIMIT) {
    offsets.push(pageOffset + consumed);
  }
  return offsets;
}
