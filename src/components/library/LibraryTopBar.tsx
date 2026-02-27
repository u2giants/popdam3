import { Search, LayoutGrid, List, SlidersHorizontal, RefreshCw, Square, RotateCcw, Layers, File, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ViewMode, SortField, SortDirection, LibraryMode } from "@/types/assets";
import { cn } from "@/lib/utils";

interface LibraryTopBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  libraryMode: LibraryMode;
  onLibraryModeChange: (v: LibraryMode) => void;
  sortField: SortField;
  onSortFieldChange: (v: SortField) => void;
  sortDirection: SortDirection;
  onSortDirectionChange: (v: SortDirection) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
  totalCount: number;
  totalAssets: number;
  scanRunning: boolean;
  scanStale?: boolean;
  scanQueued?: boolean;
  scanPending: boolean;
  onSync: () => void;
  onStopScan: () => void;
  onRefresh: () => void;
  scanCurrentPath?: string;
}

function truncatePath(p: string | undefined): string {
  if (!p) return "Scanning…";
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return "…/" + parts.slice(-2).join("/");
}

const sortOptions: { value: SortField; label: string }[] = [
  { value: "modified_at", label: "Modified" },
  { value: "file_created_at", label: "Created" },
  { value: "filename", label: "Filename" },
  { value: "file_size", label: "Size" },
];

export default function LibraryTopBar({
  search,
  onSearchChange,
  viewMode,
  onViewModeChange,
  libraryMode,
  onLibraryModeChange,
  sortField,
  onSortFieldChange,
  sortDirection,
  onSortDirectionChange,
  filtersOpen,
  onToggleFilters,
  activeFilterCount,
  totalCount,
  totalAssets,
  scanRunning,
  scanStale,
  scanQueued,
  scanPending,
  onSync,
  onStopScan,
  onRefresh,
  scanCurrentPath,
}: LibraryTopBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-overlay px-4 py-3">
      {/* Filters toggle — far left so it sits above the sidebar */}
      <Button
        variant={filtersOpen ? "secondary" : "ghost"}
        size="sm"
        className="h-9 gap-1.5"
        onClick={onToggleFilters}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Filters
        {activeFilterCount > 0 && (
          <Badge variant="default" className="ml-1 h-5 min-w-5 px-1.5 text-[10px]">
            {activeFilterCount}
          </Badge>
        )}
      </Button>

      {/* Library mode toggle — Groups / Assets */}
      <div className="flex rounded-md border border-border">
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-9 rounded-r-none gap-1.5 text-xs px-2.5", libraryMode === "groups" && "bg-accent")}
          onClick={() => onLibraryModeChange("groups")}
        >
          <Layers className="h-3.5 w-3.5" />
          Groups
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-9 rounded-l-none border-l border-border gap-1.5 text-xs px-2.5", libraryMode === "assets" && "bg-accent")}
          onClick={() => onLibraryModeChange("assets")}
        >
          <File className="h-3.5 w-3.5" />
          Assets
        </Button>
      </div>

      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search filenames…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 pr-8 h-9 bg-background"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* View toggle */}
      <div className="flex rounded-md border border-border">
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-9 w-9 rounded-r-none", viewMode === "grid" && "bg-accent")}
          onClick={() => onViewModeChange("grid")}
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-9 w-9 rounded-l-none border-l border-border", viewMode === "list" && "bg-accent")}
          onClick={() => onViewModeChange("list")}
        >
          <List className="h-4 w-4" />
        </Button>
      </div>

      {/* Sort */}
      <Select value={sortField} onValueChange={(v) => onSortFieldChange(v as SortField)}>
        <SelectTrigger className="w-[130px] h-9 bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={() => onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc")}
        title={sortDirection === "asc" ? "Ascending" : "Descending"}
      >
        <span className="text-xs font-mono">{sortDirection === "asc" ? "A↑" : "Z↓"}</span>
      </Button>

      {/* Refresh / Sync / Stop */}
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onRefresh} title="Refresh library">
        <RotateCcw className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 gap-1.5 relative"
        onClick={onSync}
        disabled={scanPending || scanRunning || scanQueued}
        title={scanStale ? "Scan appears stuck — use Reset Scan State in Settings" : scanRunning ? "Scanning…" : scanQueued ? "Queued, waiting for agent…" : scanPending ? "Waiting for agent…" : "Trigger scan"}
      >
        <RefreshCw className={cn("h-4 w-4", scanRunning && !scanStale && "animate-spin")} />
        {scanStale ? "Scan stuck" : scanRunning ? truncatePath(scanCurrentPath) : scanQueued ? "Queued…" : "Sync"}
      </Button>
      {scanQueued && (
        <Badge variant="outline" className="gap-1 text-[10px] border-[hsl(var(--warning))]/50 text-[hsl(var(--warning))] animate-pulse">
          <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--warning))]" />
          Waiting for agent
        </Badge>
      )}
      {scanPending && !scanRunning && !scanQueued && (
        <Badge variant="outline" className="gap-1 text-[10px] border-[hsl(var(--warning))]/50 text-[hsl(var(--warning))] animate-pulse">
          <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--warning))]" />
          Sync queued
        </Badge>
      )}
      {scanRunning && (
        <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={onStopScan} title="Stop scan">
          <Square className="h-4 w-4" />
        </Button>
      )}

      {/* Counts */}
      <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
        {libraryMode === "groups" ? (
          <>
            <span className="font-semibold tabular-nums">{totalCount.toLocaleString()}</span>
            {" "}SKUs
            <span className="mx-1">·</span>
            <span className="font-semibold tabular-nums">{totalAssets.toLocaleString()}</span>
            {" "}files
          </>
        ) : (
          <>
            <span className="font-semibold tabular-nums">{totalCount.toLocaleString()}</span>
            {" "}files
          </>
        )}
      </span>
    </div>
  );
}
