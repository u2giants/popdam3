import { useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStyleGroups, useStyleGroupAssetCount, useStyleGroupCount, useUngroupedCount, useTotalAssetCount, type StyleGroup } from "@/hooks/useStyleGroups";
import { useAssets, useFilterOptions, useFilterCounts, useVisibilityDate, usePathFacets, useProductMaterials } from "@/hooks/useAssets";
import { useDamCustomerFacets } from "@/hooks/useDamCustomers";
import { defaultFilters, countActiveFilters, hasActiveFilters, type AssetFilters, type SortField, type SortDirection, type ViewMode, type LibraryMode } from "@/types/assets";
import type { Asset, CardStyle } from "@/types/assets";
import LibraryTopBar from "@/components/library/LibraryTopBar";
import FilterSidebar from "@/components/library/FilterSidebar";
import StyleGroupGrid from "@/components/library/StyleGroupGrid";
import StyleGroupListView from "@/components/library/StyleGroupListView";
import StyleGroupDetailPanel from "@/components/library/StyleGroupDetailPanel";
import AssetGrid from "@/components/library/AssetGrid";
import AssetListView from "@/components/library/AssetListView";
import AssetDetailPanel from "@/components/library/AssetDetailPanel";
import BulkActionBar from "@/components/library/BulkActionBar";
import PaginationBar from "@/components/library/PaginationBar";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { useScanProgress } from "@/hooks/useScanProgress";
import { useScanLifecycle } from "@/hooks/useScanLifecycle";
import { useSelectionManager } from "@/hooks/useSelectionManager";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useCompactChrome } from "@/hooks/use-compact-chrome";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { cn } from "@/lib/utils";
import { useRef } from "react";

/** Detail-panel resize bounds (desktop only). */
const DETAIL_MIN_WIDTH = 360;
const DETAIL_MAX_WIDTH = 960;
const DETAIL_DEFAULT_WIDTH = 408;

export default function LibraryPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<AssetFilters>(defaultFilters);
  const [sortField, setSortField] = useState<SortField>("modified_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("groups");
  const [cardStyle, setCardStyle] = useState<CardStyle>("gallery");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(200);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null);
  const { isAdmin } = useIsAdmin();

  // ── Detail panel resize (side-by-side layout only; below 1400px it overlays)
  const isDesktop = useMediaQuery("(min-width: 1400px)");
  const compactChrome = useCompactChrome();
  const { width: detailWidth, dragging: detailDragging, reset: resetDetailWidth, handleProps: detailHandleProps } =
    useResizablePanel({
      storageKey: "pd-detail-panel-width",
      defaultWidth: DETAIL_DEFAULT_WIDTH,
      min: DETAIL_MIN_WIDTH,
      max: DETAIL_MAX_WIDTH,
      side: "left",
    });
  // Panel width: dynamic when docked side-by-side, fixed default when overlaying.
  const panelWidth = isDesktop ? detailWidth : DETAIL_DEFAULT_WIDTH;

  // ── Agent & scan state ──────────────────────────────────────────
  const agentStatus = useAgentStatus(isAdmin);
  const scanProgress = useScanProgress();
  const {
    scanTriggered, scanRunning, scanQueued,
    lastScanStatus, lastScanTime, lastScanSummary,
    handleSync, handleStopScan,
  } = useScanLifecycle(scanProgress);

  // ── Data queries ────────────────────────────────────────────────
  const isGroupsMode = libraryMode === "groups";
  const { data: visibilityDate } = useVisibilityDate();
  const { data: sgData, isLoading: sgLoading } = useStyleGroups(filters, sortField, sortDirection, page, pageSize, visibilityDate);
  const { data: totalGroupCount } = useStyleGroupCount(filters, visibilityDate);
  const { data: ungroupedCount } = useUngroupedCount();
  const { data: totalAssets } = useTotalAssetCount();
  const { data: assetData, isLoading: assetLoading } = useAssets(filters, sortField, sortDirection, page, visibilityDate, pageSize, !isGroupsMode);
  const { licensors, properties } = useFilterOptions(filters.licensorId);
  const { data: facetCounts } = useFilterCounts(filters);
  const { data: pathFacets } = usePathFacets(filters.customer);
  const { data: materialOptions } = useProductMaterials();
  const { data: damCustomerFacets } = useDamCustomerFacets();

  const groups = sgData?.groups ?? [];
  const assets = assetData?.assets ?? [];
  const isLoading = isGroupsMode ? sgLoading : assetLoading;
  const activeFilterCount = countActiveFilters(filters);
  const hasLibraryFilters = hasActiveFilters(filters);
  const count = isGroupsMode
    ? (totalGroupCount ?? sgData?.totalCount ?? 0)
    : (assetData?.totalCount ?? 0);
  const showRebuildHint =
    isGroupsMode &&
    !hasLibraryFilters &&
    groups.length === 0 &&
    ((totalGroupCount ?? 0) > 0 || (ungroupedCount ?? 0) > 0);

  // ── Selection ───────────────────────────────────────────────────
  const currentItems = isGroupsMode ? groups : assets;
  const { selectedIds, setSelectedIds, handleSelect: rawHandleSelect, clearSelection } = useSelectionManager(currentItems);

  const handleSelect = useCallback((id: string, event: React.MouseEvent) => {
    rawHandleSelect(id, event, (clickedId) => {
      if (isGroupsMode) {
        setDetailGroupId((prev) => (prev === clickedId ? null : clickedId));
        setDetailAssetId(null);
      } else {
        setDetailAssetId((prev) => (prev === clickedId ? null : clickedId));
        setDetailGroupId(null);
      }
    });
  }, [rawHandleSelect, isGroupsMode]);

  // ── Mode switching ──────────────────────────────────────────────
  const handleLibraryModeChange = useCallback((mode: LibraryMode) => {
    setLibraryMode(mode);
    clearSelection();
    setDetailGroupId(null);
    setDetailAssetId(null);
    setPage(0);
  }, [clearSelection]);

  // ── Search ──────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setFilters((f) => ({ ...f, search: value }));
      setPage(0);
    }, 300);
  }, []);

  const handleFiltersChange = useCallback((f: AssetFilters) => {
    setFilters(f);
    setPage(0);
  }, []);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["style-groups"] });
    queryClient.invalidateQueries({ queryKey: ["style-group-count"] });
    queryClient.invalidateQueries({ queryKey: ["filter-counts"] });
    queryClient.invalidateQueries({ queryKey: ["ungrouped-asset-count"] });
    queryClient.invalidateQueries({ queryKey: ["assets"] });
  }, [queryClient]);

  const { data: filteredGroupAssetCount } = useStyleGroupAssetCount(filters, visibilityDate, isGroupsMode && hasLibraryFilters);
  const selectedGroups = groups.filter((g) => selectedIds.has(g.id));

  const detailGroup = useMemo(
    () => (detailGroupId ? groups.find((g) => g.id === detailGroupId) ?? null : null),
    [detailGroupId, groups],
  );

  const detailAsset = useMemo(
    () => (detailAssetId ? assets.find((a) => a.id === detailAssetId) ?? null : null),
    [detailAssetId, assets],
  );

  return (
    <div className="flex h-[calc(100vh-var(--pd-header-h))] flex-col">
      <LibraryTopBar
        search={searchInput}
        onSearchChange={handleSearchChange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        libraryMode={libraryMode}
        onLibraryModeChange={handleLibraryModeChange}
        sortField={sortField}
        onSortFieldChange={(f) => { setSortField(f); setPage(0); }}
        sortDirection={sortDirection}
        onSortDirectionChange={(d) => { setSortDirection(d); setPage(0); }}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen(!filtersOpen)}
        activeFilterCount={activeFilterCount}
        totalCount={isGroupsMode ? (totalGroupCount ?? 0) : (assetData?.totalCount ?? 0)}
        totalAssets={totalAssets ?? 0}
        scanRunning={scanRunning}
        scanStale={scanProgress.status === "stale"}
        scanQueued={scanQueued}
        scanPending={scanTriggered && !scanRunning && !scanQueued}
        onSync={handleSync}
        onStopScan={handleStopScan}
        onRefresh={handleRefresh}
        scanCurrentPath={scanProgress.current_path}
        lastScanStatus={lastScanStatus}
        lastScanTime={lastScanTime}
        lastScanSummary={lastScanSummary}
        scanBlocked={agentStatus.scanBlocked}
        scanBlockedReason={agentStatus.scanBlockedReason}
        cardStyle={cardStyle}
        onCardStyleChange={setCardStyle}
        groupCount={isGroupsMode ? (totalGroupCount ?? 0) : 0}
        fileCount={isGroupsMode ? (hasLibraryFilters ? (filteredGroupAssetCount ?? 0) : (totalAssets ?? 0)) : (assetData?.totalCount ?? 0)}
        scanProgress={scanProgress}
        ungroupedCount={isGroupsMode && !hasLibraryFilters ? ungroupedCount : null}
        canManageScan={isAdmin}
        selectionSlot={
          compactChrome && isGroupsMode && selectedIds.size > 0 ? (
            <BulkActionBar
              variant="inline"
              selectedGroups={selectedGroups}
              onClearSelection={() => setSelectedIds(new Set())}
            />
          ) : undefined
        }
      />

      {/* Roomy screens keep the selection controls on their own row. */}
      {!compactChrome && isGroupsMode && selectedIds.size > 0 && (
        <BulkActionBar
          selectedGroups={selectedGroups}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      )}

      <div className="relative flex flex-1 overflow-hidden">
        {filtersOpen && (
          <FilterSidebar
            filters={filters}
            onFiltersChange={handleFiltersChange}
            onClose={() => setFiltersOpen(false)}
            licensors={licensors}
            properties={properties}
            facetCounts={facetCounts ?? null}
            customerOptions={damCustomerFacets ?? []}
            programOptions={pathFacets?.programs ?? []}
            materialOptions={materialOptions ?? []}
            mode={libraryMode === "assets" ? "assets" : "groups"}
          />
        )}

        <div className="flex flex-1 flex-col overflow-auto min-w-[400px]">
          {isGroupsMode ? (
            viewMode === "grid" ? (
              <StyleGroupGrid
                groups={groups}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                isLoading={isLoading}
                rebuildHint={showRebuildHint}
                cardStyle={cardStyle}
              />
            ) : (
              <StyleGroupListView
                groups={groups}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                isLoading={isLoading}
                rebuildHint={showRebuildHint}
              />
            )
          ) : (
            viewMode === "grid" ? (
              <AssetGrid
                assets={assets}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onOpenDetail={setDetailAssetId}
                isLoading={isLoading}
              />
            ) : (
              <AssetListView
                assets={assets}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                isLoading={isLoading}
              />
            )
          )}

          <div className="mt-auto">
            <PaginationBar
              page={page}
              totalCount={count}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
            />
          </div>
        </div>

        {/* Drag handle — only when a panel is docked side-by-side (desktop). */}
        {isDesktop && (isGroupsMode ? !!detailGroup : !!detailAsset) && (
          <div
            {...detailHandleProps}
            onDoubleClick={resetDetailWidth}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize detail panel"
            title="Drag to resize · double-click to reset"
            className={cn(
              "group relative z-10 flex w-2 shrink-0 cursor-col-resize touch-none select-none items-stretch justify-center",
              detailDragging ? "" : "hover:bg-[var(--pd-surface-3,transparent)]",
            )}
          >
            {/* Center line: subtle by default, accent while hovering/dragging. */}
            <span
              className="my-auto h-full w-px transition-colors"
              style={{
                background: detailDragging ? "var(--pd-accent, #3b82f6)" : "var(--pd-border)",
              }}
            />
            {/* Grip pill on hover/drag. */}
            <span
              className={cn(
                "pointer-events-none absolute top-1/2 flex h-8 w-1.5 -translate-y-1/2 items-center justify-center rounded-full transition-opacity",
                detailDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
              style={{ background: "var(--pd-accent, #3b82f6)" }}
            />
          </div>
        )}

        {/* Detail panel: style group */}
        {isGroupsMode && detailGroup && (
          <div
            className="h-full shrink-0 max-[1399px]:absolute max-[1399px]:inset-y-0 max-[1399px]:right-0 max-[1399px]:z-20 max-[1399px]:shadow-xl"
            style={{ userSelect: detailDragging ? "none" : undefined }}
          >
            <StyleGroupDetailPanel
              key={detailGroup.id}
              group={detailGroup}
              width={panelWidth}
              onClose={() => setDetailGroupId(null)}
            />
          </div>
        )}

        {/* Detail panel: individual asset */}
        {!isGroupsMode && detailAsset && (
          <div
            className="h-full shrink-0 max-[1399px]:absolute max-[1399px]:inset-y-0 max-[1399px]:right-0 max-[1399px]:z-20 max-[1399px]:shadow-xl"
            style={{ userSelect: detailDragging ? "none" : undefined }}
          >
            <AssetDetailPanel
              asset={detailAsset}
              width={panelWidth}
              onClose={() => setDetailAssetId(null)}
              onOpenGroup={(groupId) => {
                handleLibraryModeChange("groups");
                setDetailGroupId(groupId);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
