import { useState, useCallback, useMemo, useRef, useEffect } from "react";
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
import { toast } from "@/hooks/use-toast";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { useScanProgress } from "@/hooks/useScanProgress";
import { Badge } from "@/components/ui/badge";

export default function LibraryPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<AssetFilters>(defaultFilters);
  const [sortField, setSortField] = useState<SortField>("modified_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("groups");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null);
  const lastSelectedIndex = useRef<number | null>(null);
  const [pageSize, setPageSize] = useState(200);
  const [scanTriggered, setScanTriggered] = useState(false);
  const agentStatus = useAgentStatus();
  const scanProgress = useScanProgress();

  const scanRunning = scanProgress.status === "running" || scanProgress.status === "stale";
  const scanQueued = scanProgress.status === "queued";

  // Reset selection & detail when switching modes
  const handleLibraryModeChange = useCallback((mode: LibraryMode) => {
    setLibraryMode(mode);
    setSelectedIds(new Set());
    setDetailGroupId(null);
    setDetailAssetId(null);
    setPage(0);
    lastSelectedIndex.current = null;
  }, []);

  useEffect(() => {
    if (scanTriggered && scanProgress.status !== "idle") {
      setScanTriggered(false);
    }
  }, [scanTriggered, scanProgress.status]);

  useEffect(() => {
    if (!scanTriggered) return;
    const timer = setTimeout(() => {
      setScanTriggered(false);
    }, 120_000);
    return () => clearTimeout(timer);
  }, [scanTriggered]);

  const prevScanStatus = useRef(scanProgress.status);
  useEffect(() => {
    const prev = prevScanStatus.current;
    prevScanStatus.current = scanProgress.status;

    if (prev === "running" && scanProgress.status === "completed") {
      queryClient.invalidateQueries({ queryKey: ["style-groups"] });
      queryClient.invalidateQueries({ queryKey: ["style-group-count"] });
      queryClient.invalidateQueries({ queryKey: ["filter-counts"] });
      queryClient.invalidateQueries({ queryKey: ["ungrouped-asset-count"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      toast({ title: "Scan completed", description: `${scanProgress.counters?.files_checked ?? 0} files checked, ${scanProgress.counters?.ingested_new ?? 0} new assets ingested.` });
    }

    if (prev === "running" && scanProgress.status === "failed") {
      const c = scanProgress.counters;
      const desc = [
        c ? `${c.files_checked} checked, ${c.errors} errors` : "No counters",
        scanProgress.current_path ? `Last path: ${scanProgress.current_path}` : "",
      ].filter(Boolean).join(". ");
      toast({ title: "Scan failed", description: desc, variant: "destructive" });
    }

    if (scanProgress.status === "stale" && prev !== "stale") {
      toast({ title: "Scan appears stuck", description: "No progress update for over 10 minutes.", variant: "destructive" });
    }
  }, [scanProgress.status, scanProgress.counters, scanProgress.current_path, queryClient]);

  // Debounced search
  const [searchInput, setSearchInput] = useState("");
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (searchTimer) clearTimeout(searchTimer);
    const timer = setTimeout(() => {
      setFilters((f) => ({ ...f, search: value }));
      setPage(0);
    }, 300);
    setSearchTimer(timer);
  }, [searchTimer]);

  const handleFiltersChange = useCallback((f: AssetFilters) => {
    setFilters(f);
    setPage(0);
  }, []);

  const { data: visibilityDate } = useVisibilityDate();

  // Style groups data (always fetch for counts in top bar)
  const { data: sgData, isLoading: sgLoading } = useStyleGroups(filters, sortField, sortDirection, page, pageSize, visibilityDate);
  const { data: totalGroupCount } = useStyleGroupCount(filters, visibilityDate);
  const { data: ungroupedCount } = useUngroupedCount();
  const { data: totalAssets } = useTotalAssetCount();

  // Individual assets data (only fetch when in assets mode)
  const { data: assetData, isLoading: assetLoading } = useAssets(
    filters, sortField, sortDirection, page, visibilityDate, pageSize,
  );

  const { licensors, properties } = useFilterOptions(filters.licensorId);
  const { data: facetCounts } = useFilterCounts(filters);

  // Determine active data based on library mode
  const isGroupsMode = libraryMode === "groups";
  const groups = sgData?.groups ?? [];
  const assets = assetData?.assets ?? [];
  const isLoading = isGroupsMode ? sgLoading : assetLoading;
  const count = isGroupsMode
    ? (totalGroupCount ?? sgData?.totalCount ?? 0)
    : (assetData?.totalCount ?? 0);

  const handleSelect = useCallback((id: string, event: React.MouseEvent) => {
    const items = isGroupsMode ? groups : assets;
    const clickedIndex = items.findIndex((item) => item.id === id);

    if (event.shiftKey && lastSelectedIndex.current !== null && clickedIndex >= 0) {
      const start = Math.min(lastSelectedIndex.current, clickedIndex);
      const end = Math.max(lastSelectedIndex.current, clickedIndex);
      const rangeIds = items.slice(start, end + 1).map((item) => item.id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        rangeIds.forEach((rid) => next.add(rid));
        return next;
      });
      return;
    }

    if (!event.metaKey && !event.ctrlKey) {
      if (isGroupsMode) {
        setDetailGroupId((prev) => (prev === id ? null : id));
        setDetailAssetId(null);
      } else {
        setDetailAssetId((prev) => (prev === id ? null : id));
        setDetailGroupId(null);
      }
      setSelectedIds(new Set([id]));
      lastSelectedIndex.current = clickedIndex;
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastSelectedIndex.current = clickedIndex;
  }, [isGroupsMode, groups, assets]);

  const { call } = useAdminApi();
  const handleSync = async () => {
    try {
      await call("trigger-scan");
      setScanTriggered(true);
      toast({ title: "Scan triggered", description: "The Bridge Agent will start scanning on its next poll (~30s)." });
    } catch (e) {
      toast({ title: "Failed to trigger scan", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleStopScan = async () => {
    try {
      await call("stop-scan");
      toast({ title: "Stop requested", description: "The agent will abort the current scan shortly." });
    } catch (e) {
      toast({ title: "Failed to stop scan", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["style-groups"] });
    queryClient.invalidateQueries({ queryKey: ["style-group-count"] });
    queryClient.invalidateQueries({ queryKey: ["filter-counts"] });
    queryClient.invalidateQueries({ queryKey: ["ungrouped-asset-count"] });
    queryClient.invalidateQueries({ queryKey: ["assets"] });
  }, [queryClient]);

  const activeFilterCount = countActiveFilters(filters);
  const selectedGroups = groups.filter(g => selectedIds.has(g.id));

  const detailGroup = useMemo(
    () => (detailGroupId ? groups.find((g) => g.id === detailGroupId) ?? null : null),
    [detailGroupId, groups]
  );

  const detailAsset = useMemo(
    () => (detailAssetId ? assets.find((a) => a.id === detailAssetId) ?? null : null),
    [detailAssetId, assets]
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
              />
            ) : (
              <StyleGroupListView
                groups={groups}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                isLoading={isLoading}
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
          <div className="max-[1399px]:absolute max-[1399px]:inset-y-0 max-[1399px]:right-0 max-[1399px]:z-20 max-[1399px]:shadow-xl">
            <StyleGroupDetailPanel
              group={detailGroup}
              onClose={() => setDetailGroupId(null)}
            />
          </div>
        )}

        {/* Detail panel: individual asset */}
        {!isGroupsMode && detailAsset && (
          <div className="max-[1399px]:absolute max-[1399px]:inset-y-0 max-[1399px]:right-0 max-[1399px]:z-20 max-[1399px]:shadow-xl">
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
