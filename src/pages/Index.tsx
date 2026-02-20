import { useState, useCallback, useMemo } from "react";
import { useAssets, useAssetCount, useFilterOptions } from "@/hooks/useAssets";
import { defaultFilters, countActiveFilters, type AssetFilters, type SortField, type SortDirection, type ViewMode } from "@/types/assets";
import LibraryTopBar from "@/components/library/LibraryTopBar";
import FilterSidebar from "@/components/library/FilterSidebar";
import AssetGrid from "@/components/library/AssetGrid";
import AssetListView from "@/components/library/AssetListView";
import AssetDetailPanel from "@/components/library/AssetDetailPanel";
import PaginationBar from "@/components/library/PaginationBar";
import { toast } from "@/hooks/use-toast";

export default function LibraryPage() {
  const [filters, setFilters] = useState<AssetFilters>(defaultFilters);
  const [sortField, setSortField] = useState<SortField>("modified_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null);

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

  const { data, isLoading, isFetching } = useAssets(filters, sortField, sortDirection, page);
  const { data: totalCount } = useAssetCount(filters);
  const { licensors, properties } = useFilterOptions();

  const handleSelect = useCallback((id: string, event: React.MouseEvent) => {
    // Single click opens detail panel
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
      setDetailAssetId((prev) => (prev === id ? null : id));
      setSelectedIds(new Set([id]));
      return;
    }

    // Multi-select with modifier keys
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (event.metaKey || event.ctrlKey) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSync = () => {
    toast({ title: "Scan requested", description: "The Bridge Agent will pick this up on next heartbeat." });
  };

  const assets = data?.assets ?? [];
  const pageSize = data?.pageSize ?? 40;
  const count = totalCount ?? data?.totalCount ?? 0;
  const activeFilterCount = countActiveFilters(filters);

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

      <div className="flex flex-1 overflow-hidden">
        {/* Filter sidebar */}
        {filtersOpen && (
          <FilterSidebar
            filters={filters}
            onFiltersChange={handleFiltersChange}
            onClose={() => setFiltersOpen(false)}
            licensors={licensors}
            properties={properties}
          />
        )}

        {/* Content area */}
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

        {/* Detail panel */}
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
