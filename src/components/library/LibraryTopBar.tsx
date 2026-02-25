import { Search, LayoutGrid, List, SlidersHorizontal, RefreshCw, Square, RotateCcw } from "lucide-react";
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
import type { ViewMode, SortField, SortDirection } from "@/types/assets";
import { cn } from "@/lib/utils";

interface LibraryTopBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  sortField: SortField;
  onSortFieldChange: (v: SortField) => void;
  sortDirection: SortDirection;
  onSortDirectionChange: (v: SortDirection) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
  totalCount: number;
  scanRunning: boolean;
  scanStale?: boolean;
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
  sortField,
  onSortFieldChange,
  sortDirection,
  onSortDirectionChange,
  filtersOpen,
  onToggleFilters,
  activeFilterCount,
  totalCount,
  scanRunning,
  scanStale,
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

      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search filenames…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-9 bg-background"
        />
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
        disabled={scanPending || scanRunning}
        title={scanStale ? "Scan appears stuck — use Reset Scan State in Settings" : scanRunning ? "Scanning…" : scanPending ? "Waiting for agent…" : "Trigger scan"}
      >
        <RefreshCw className={cn("h-4 w-4", scanRunning && !scanStale && "animate-spin")} />
        {scanStale ? "Scan stuck" : scanRunning ? truncatePath(scanCurrentPath) : "Sync"}
      </Button>
      {scanPending && !scanRunning && (
        <Badge variant="outline" className="gap-1 text-[10px] border-orange-500/50 text-orange-400 animate-pulse">
          <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
          Sync queued
        </Badge>
      )}
      {scanRunning && (
        <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={onStopScan} title="Stop scan">
          <Square className="h-4 w-4" />
        </Button>
      )}

      {/* Count */}
      <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
        {totalCount.toLocaleString()} asset{totalCount !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
