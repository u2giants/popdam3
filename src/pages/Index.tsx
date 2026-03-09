import { useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStyleGroups, useStyleGroupCount, useUngroupedCount, useTotalAssetCount, type StyleGroup } from "@/hooks/useStyleGroups";
import { useAssets, useFilterOptions, useFilterCounts, useVisibilityDate } from "@/hooks/useAssets";
import { defaultFilters, countActiveFilters, type AssetFilters, type SortField, type SortDirection, type ViewMode, type LibraryMode } from "@/types/assets";
import type { Asset } from "@/types/assets";
import LibraryTopBar from "@/components/library/LibraryTopBar";
import ScanMonitorBanner from "@/components/library/ScanMonitorBanner";
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
import { Badge } from "@/components/ui/badge";
import { useRef } from "react";

export default function LibraryPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<AssetFilters>(defaultFilters);
  const [sortField, setSortField] = useState<SortField>("modified_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("groups");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(200);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null);

  // ── Agent & scan state ──────────────────────────────────────────
  const agentStatus = useAgentStatus();
  const scanProgress = useScanProgress();
  const {
    scanTriggered, scanRunning, scanQueued,
    lastScanStatus, lastScanTime, lastScanSummary,
    handleSync, handleStopScan,
  } = useScanLifecycle(scanProgress);

  // ── Data queries ────────────────────────────────────────────────
  const { data: visibilityDate } = useVisibilityDate();
  const { data: sgData, isLoading: sgLoading } = useStyleGroups(filters, sortField, sortDirection, page, pageSize, visibilityDate);
  const { data: totalGroupCount } = useStyleGroupCount(filters, visibilityDate);
  const { data: ungroupedCount } = useUngroupedCount();
  const { data: totalAssets } = useTotalAssetCount();
  const { data: assetData, isLoading: assetLoading } = useAssets(filters, sortField, sortDirection, page, visibilityDate, pageSize);
  const { licensors, properties } = useFilterOptions(filters.licensorId);
  const { data: facetCounts } = useFilterCounts(filters);

  const isGroupsMode = libraryMode === "groups";
  const groups = sgData?.groups ?? [];
  const assets = assetData?.assets ?? [];
  const isLoading = isGroupsMode ? sgLoading : assetLoading;
  const count = isGroupsMode
    ? (totalGroupCount ?? sgData?.totalCount ?? 0)
    : (assetData?.totalCount ?? 0);

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

  const activeFilterCount = countActiveFilters(filters);
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
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
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
        totalCount={isGroupsMode ? ((totalGroupCount ?? 0) + (ungroupedCount ?? 0)) : (assetData?.totalCount ?? 0)}
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
      />

      <ScanMonitorBanner scanProgress={scanProgress} onStopScan={handleStopScan} />

      {isGroupsMode && selectedIds.size > 0 && (
        <BulkActionBar
          selectedGroups={selectedGroups}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      )}

      {/* Ungrouped count indicator — groups mode only */}
      {isGroupsMode && ungroupedCount != null && ungroupedCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-muted/30 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">{ungroupedCount} ungrouped</Badge>
          <span>assets not in any style group</span>
        </div>
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
            mode={libraryMode === "assets" ? "assets" : "groups"}
          />
        )}

        <div className="flex flex-1 flex-col overflow-auto">
          {isGroupsMode ? (
            viewMode === "grid" ? (
              <StyleGroupGrid
                groups={groups}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                isLoading={isLoading}
                rebuildHint={groups.length === 0 && ((totalGroupCount ?? 0) > 0 || (ungroupedCount ?? 0) > 0)}
              />
            ) : (
              <StyleGroupListView
                groups={groups}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                isLoading={isLoading}
                rebuildHint={groups.length === 0 && ((totalGroupCount ?? 0) > 0 || (ungroupedCount ?? 0) > 0)}
              />
            )
          ) : (
            viewMode === "grid" ? (
              <AssetGrid
                assets={assets}
                selectedIds={selectedIds}
                onSelect={handleSelect}
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

        {/* Detail panel: style group */}
        {isGroupsMode && detailGroup && (
          <div className="h-full max-[1399px]:absolute max-[1399px]:inset-y-0 max-[1399px]:right-0 max-[1399px]:z-20 max-[1399px]:shadow-xl">
            <StyleGroupDetailPanel
              group={detailGroup}
              onClose={() => setDetailGroupId(null)}
            />
          </div>
        )}

        {/* Detail panel: individual asset */}
        {!isGroupsMode && detailAsset && (
          <div className="h-full max-[1399px]:absolute max-[1399px]:inset-y-0 max-[1399px]:right-0 max-[1399px]:z-20 max-[1399px]:shadow-xl">
            <AssetDetailPanel
              asset={detailAsset}
              onClose={() => setDetailAssetId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
