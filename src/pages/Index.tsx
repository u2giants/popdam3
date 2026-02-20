import { useState, useCallback, useMemo, useRef } from "react";
import { useAssets, useAssetCount, useFilterOptions, useFilterCounts, useVisibilityDate } from "@/hooks/useAssets";
import { defaultFilters, countActiveFilters, type AssetFilters, type SortField, type SortDirection, type ViewMode } from "@/types/assets";
import LibraryTopBar from "@/components/library/LibraryTopBar";
import FilterSidebar from "@/components/library/FilterSidebar";
import AssetGrid from "@/components/library/AssetGrid";
import AssetListView from "@/components/library/AssetListView";
import AssetDetailPanel from "@/components/library/AssetDetailPanel";
import BulkActionBar from "@/components/library/BulkActionBar";
import PaginationBar from "@/components/library/PaginationBar";
import { toast } from "@/hooks/use-toast";
import { useAdminApi } from "@/hooks/useAdminApi";

export default function LibraryPage() {
  const [filters, setFilters] = useState<AssetFilters>(defaultFilters);
  const [sortField, setSortField] = useState<SortField>("modified_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null);
  const lastSelectedIndex = useRef<number | null>(null);

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
  const { data, isLoading, isFetching } = useAssets(filters, sortField, sortDirection, page, visibilityDate);
  const { data: totalCount } = useAssetCount(filters, visibilityDate);
  const { licensors, properties } = useFilterOptions();
  const { data: facetCounts } = useFilterCounts(filters);

  const handleSelect = useCallback((id: string, event: React.MouseEvent) => {
    const assets = data?.assets ?? [];
    const clickedIndex = assets.findIndex((a) => a.id === id);

    // Shift+Click range select
    if (event.shiftKey && lastSelectedIndex.current !== null && clickedIndex >= 0) {
      const start = Math.min(lastSelectedIndex.current, clickedIndex);
      const end = Math.max(lastSelectedIndex.current, clickedIndex);
      const rangeIds = assets.slice(start, end + 1).map((a) => a.id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        rangeIds.forEach((rid) => next.add(rid));
        return next;
      });
      return;
    }

    // Single click opens detail panel
    if (!event.metaKey && !event.ctrlKey) {
      setDetailAssetId((prev) => (prev === id ? null : id));
      setSelectedIds(new Set([id]));
      lastSelectedIndex.current = clickedIndex;
      return;
    }

    // Ctrl/Cmd+Click multi-select
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastSelectedIndex.current = clickedIndex;
  }, [data?.assets]);

  const { call } = useAdminApi();
  const handleSync = async () => {
    try {
      await call("trigger-scan");
      toast({ title: "Scan triggered", description: "The Bridge Agent will start scanning on its next poll (~30s)." });
    } catch (e) {
      toast({ title: "Failed to trigger scan", description: (e as Error).message, variant: "destructive" });
    }
  };

  const assets = data?.assets ?? [];
  const pageSize = data?.pageSize ?? 40;
  const count = totalCount ?? data?.totalCount ?? 0;
  const activeFilterCount = countActiveFilters(filters);

  const detailAsset = useMemo(
    () => (detailAssetId ? assets.find((a) => a.id === detailAssetId) ?? null : null),
    [detailAssetId, assets]
  );

  const selectedAssets = useMemo(
    () => assets.filter((a) => selectedIds.has(a.id)),
    [selectedIds, assets]
  );

  const showBulkBar = selectedIds.size > 1;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <LibraryTopBar
        search={searchInput}
        onSearchChange={handleSearchChange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sortField={sortField}
        onSortFieldChange={(f) => { setSortField(f); setPage(0); }}
        sortDirection={sortDirection}
        onSortDirectionChange={(d) => { setSortDirection(d); setPage(0); }}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen(!filtersOpen)}
        activeFilterCount={activeFilterCount}
        totalCount={count}
        isLoading={isFetching}
        onSync={handleSync}
      />
      {showBulkBar && (
        <BulkActionBar
          selectedAssets={selectedAssets}
          onClearSelection={() => {
            setSelectedIds(new Set());
            setDetailAssetId(null);
          }}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        {filtersOpen && (
          <FilterSidebar
            filters={filters}
            onFiltersChange={handleFiltersChange}
            onClose={() => setFiltersOpen(false)}
            licensors={licensors}
            properties={properties}
            facetCounts={facetCounts ?? null}
          />
        )}

        <div className="flex flex-1 flex-col overflow-auto">
          {viewMode === "grid" ? (
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
          )}

          <div className="mt-auto">
            <PaginationBar
              page={page}
              totalCount={count}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </div>
        </div>

        {detailAsset && (
          <AssetDetailPanel
            asset={detailAsset}
            onClose={() => setDetailAssetId(null)}
          />
        )}
      </div>
    </div>
  );
}
