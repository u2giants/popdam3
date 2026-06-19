import { useEffect, useRef, useState } from "react";
import {
  Search,
  LayoutGrid,
  List,
  SlidersHorizontal,
  RefreshCw,
  Layers,
  File,
  X,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Check,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { CardStyle, ViewMode, SortField, SortDirection, LibraryMode } from "@/types/assets";
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
  lastScanStatus?: "completed" | "completed_with_errors" | "failed" | null;
  lastScanTime?: string;
  lastScanSummary?: string;
  scanBlocked: boolean;
  scanBlockedReason: string | null;
  cardStyle: CardStyle;
  onCardStyleChange: (v: CardStyle) => void;
  groupCount: number;
  fileCount: number;
}

const GROUP_SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "modified_at", label: "Last modified" },
  { value: "file_created_at", label: "Date created" },
  { value: "sku", label: "SKU (A–Z)" },
  { value: "asset_count", label: "File count" },
];

const FILE_SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "modified_at", label: "Last modified" },
  { value: "file_created_at", label: "Date added" },
  { value: "filename", label: "Name (A–Z)" },
  { value: "file_size", label: "File size" },
];

const CARD_STYLE_OPTIONS: { value: CardStyle; label: string }[] = [
  { value: "gallery", label: "Gallery" },
  { value: "editorial", label: "Editorial" },
  { value: "compact", label: "Compact" },
];

function useOutsideClick(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [ref, handler]);
}

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
  scanRunning,
  scanStale,
  scanQueued,
  scanPending,
  onSync,
  scanBlocked,
  scanBlockedReason,
  cardStyle,
  onCardStyleChange,
  groupCount,
  fileCount,
}: LibraryTopBarProps) {
  const syncDisabled = scanPending || scanRunning || scanQueued || scanBlocked;
  const syncTitle = scanBlocked
    ? scanBlockedReason || "Scan blocked"
    : scanStale
    ? "Scan appears stuck — use Reset Scan State in Settings"
    : scanRunning
    ? "Scanning…"
    : scanQueued
    ? "Queued, waiting for agent…"
    : scanPending
    ? "Waiting for agent…"
    : "Trigger scan";

  const sortOptions = libraryMode === "groups" ? GROUP_SORT_OPTIONS : FILE_SORT_OPTIONS;
  const currentSortLabel = sortOptions.find((o) => o.value === sortField)?.label ?? sortOptions[0].label;

  const [sortOpen, setSortOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useOutsideClick(sortRef, () => setSortOpen(false));
  useOutsideClick(cardRef, () => setCardOpen(false));

  // When switching modes, reset sort to modified_at if current sort is invalid
  useEffect(() => {
    const valid = sortOptions.some((o) => o.value === sortField);
    if (!valid) {
      onSortFieldChange("modified_at");
    }
  }, [libraryMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const showCardStyleDropdown = libraryMode === "groups" && viewMode === "grid";
  const currentCardLabel = CARD_STYLE_OPTIONS.find((o) => o.value === cardStyle)?.label ?? "Gallery";

  return (
    <div
      style={{
        borderBottom: "1px solid var(--pd-border)",
        background: "var(--pd-surface)",
        padding: "12px 18px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px",
      }}
    >
      {/* 1. Filters button */}
      <button
        type="button"
        onClick={onToggleFilters}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          height: "34px",
          padding: "0 10px",
          borderRadius: "6px",
          border: "1px solid var(--pd-border)",
          background: filtersOpen ? "var(--pd-accent-soft)" : "transparent",
          color: filtersOpen ? "var(--pd-accent)" : "var(--pd-fg)",
          fontSize: "13px",
          fontWeight: 500,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <SlidersHorizontal style={{ width: 15, height: 15 }} />
        Filters
        {activeFilterCount > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: "18px",
              minWidth: "18px",
              padding: "0 5px",
              borderRadius: "9px",
              background: "var(--pd-accent)",
              color: "#fff",
              fontSize: "10px",
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            {activeFilterCount}
          </span>
        )}
      </button>

      {/* 2. Mode segmented control */}
      <div
        style={{
          display: "inline-flex",
          borderRadius: "6px",
          border: "1px solid var(--pd-border)",
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          onClick={() => onLibraryModeChange("groups")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            height: "34px",
            padding: "0 10px",
            border: "none",
            borderRight: "1px solid var(--pd-border)",
            background: libraryMode === "groups" ? "var(--pd-accent-soft)" : "transparent",
            color: libraryMode === "groups" ? "var(--pd-accent)" : "var(--pd-fg-muted)",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <Layers style={{ width: 14, height: 14 }} />
          Style groups
        </button>
        <button
          type="button"
          onClick={() => onLibraryModeChange("assets")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            height: "34px",
            padding: "0 10px",
            border: "none",
            background: libraryMode === "assets" ? "var(--pd-accent-soft)" : "transparent",
            color: libraryMode === "assets" ? "var(--pd-accent)" : "var(--pd-fg-muted)",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <File style={{ width: 14, height: 14 }} />
          All files
        </button>
      </div>

      {/* 3. Search input */}
      <div
        style={{
          position: "relative",
          flex: "1 1 220px",
          minWidth: "150px",
          maxWidth: "340px",
        }}
      >
        <Search
          style={{
            position: "absolute",
            left: "9px",
            top: "50%",
            transform: "translateY(-50%)",
            width: 15,
            height: 15,
            color: "var(--pd-fg-muted)",
            pointerEvents: "none",
          }}
        />
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{
            width: "100%",
            height: "34px",
            paddingLeft: "32px",
            paddingRight: search ? "30px" : "10px",
            borderRadius: "6px",
            border: "1px solid var(--pd-border)",
            background: "transparent",
            color: "var(--pd-fg)",
            fontSize: "13px",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            style={{
              position: "absolute",
              right: "8px",
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--pd-fg-muted)",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <X style={{ width: 14, height: 14 }} />
          </button>
        )}
      </div>

      {/* 4. Result count */}
      <span
        style={{
          fontSize: "13px",
          color: "var(--pd-fg-muted)",
          whiteSpace: "nowrap",
          flexShrink: 0,
          marginLeft: "auto",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {libraryMode === "groups" ? (
          <>
            <strong style={{ color: "var(--pd-fg)", fontWeight: 600 }}>
              {groupCount.toLocaleString()}
            </strong>
            {" groups · "}
            <strong style={{ color: "var(--pd-fg)", fontWeight: 600 }}>
              {fileCount.toLocaleString()}
            </strong>
            {" files"}
          </>
        ) : (
          <>
            <strong style={{ color: "var(--pd-fg)", fontWeight: 600 }}>
              {fileCount.toLocaleString()}
            </strong>
            {" files"}
          </>
        )}
      </span>

      {/* 5. Divider */}
      <div
        style={{
          width: "1px",
          height: "22px",
          background: "var(--pd-border)",
          flexShrink: 0,
        }}
      />

      {/* 6. Card-layout dropdown (groups + grid only) */}
      {showCardStyleDropdown && (
        <div ref={cardRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setCardOpen((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              height: "34px",
              padding: "0 10px",
              borderRadius: "6px",
              border: "1px solid var(--pd-border)",
              background: "transparent",
              color: "var(--pd-fg)",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <LayoutGrid style={{ width: 14, height: 14 }} />
            {currentCardLabel}
            <ChevronDown style={{ width: 13, height: 13, color: "var(--pd-fg-muted)", marginLeft: 2 }} />
          </button>
          {cardOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                zIndex: 50,
                minWidth: "140px",
                borderRadius: "8px",
                border: "1px solid var(--pd-border)",
                background: "var(--pd-surface)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                padding: "4px",
              }}
            >
              {CARD_STYLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onCardStyleChange(opt.value);
                    setCardOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: "5px",
                    border: "none",
                    background: cardStyle === opt.value ? "var(--pd-accent-soft)" : "transparent",
                    color: cardStyle === opt.value ? "var(--pd-accent)" : "var(--pd-fg)",
                    fontSize: "13px",
                    fontWeight: cardStyle === opt.value ? 500 : 400,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {cardStyle === opt.value ? (
                    <Check style={{ width: 13, height: 13, flexShrink: 0 }} />
                  ) : (
                    <span style={{ width: 13, height: 13, flexShrink: 0 }} />
                  )}
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 7. Sort dropdown + direction button (joined) */}
      <div
        ref={sortRef}
        style={{
          display: "inline-flex",
          borderRadius: "6px",
          border: "1px solid var(--pd-border)",
          overflow: "visible",
          position: "relative",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => setSortOpen((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            height: "34px",
            padding: "0 10px",
            borderRadius: "6px 0 0 6px",
            border: "none",
            borderRight: "1px solid var(--pd-border)",
            background: "transparent",
            color: "var(--pd-fg)",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {currentSortLabel}
          <ChevronDown style={{ width: 13, height: 13, color: "var(--pd-fg-muted)" }} />
        </button>
        <button
          type="button"
          onClick={() => onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc")}
          title={sortDirection === "asc" ? "Ascending" : "Descending"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "34px",
            height: "34px",
            borderRadius: "0 6px 6px 0",
            border: "none",
            background: "transparent",
            color: "var(--pd-fg-muted)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {sortDirection === "asc" ? (
            <ArrowUp style={{ width: 14, height: 14 }} />
          ) : (
            <ArrowDown style={{ width: 14, height: 14 }} />
          )}
        </button>

        {/* Sort dropdown panel */}
        {sortOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              zIndex: 50,
              minWidth: "170px",
              borderRadius: "8px",
              border: "1px solid var(--pd-border)",
              background: "var(--pd-surface)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
              padding: "4px",
            }}
          >
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onSortFieldChange(opt.value);
                  setSortOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: "5px",
                  border: "none",
                  background: sortField === opt.value ? "var(--pd-accent-soft)" : "transparent",
                  color: sortField === opt.value ? "var(--pd-accent)" : "var(--pd-fg)",
                  fontSize: "13px",
                  fontWeight: sortField === opt.value ? 500 : 400,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {sortField === opt.value ? (
                  <Check style={{ width: 13, height: 13, flexShrink: 0 }} />
                ) : (
                  <span style={{ width: 13, height: 13, flexShrink: 0 }} />
                )}
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sync icon button */}
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn("inline-flex", syncDisabled && "cursor-not-allowed")}>
              <button
                type="button"
                onClick={onSync}
                disabled={syncDisabled}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "34px",
                  height: "34px",
                  borderRadius: "6px",
                  border: "1px solid var(--pd-border)",
                  background: "transparent",
                  color: syncDisabled ? "var(--pd-fg-muted)" : "var(--pd-fg)",
                  cursor: syncDisabled ? "not-allowed" : "pointer",
                  opacity: syncDisabled ? 0.5 : 1,
                  flexShrink: 0,
                  pointerEvents: syncDisabled ? "none" : "auto",
                }}
              >
                <RefreshCw
                  style={{ width: 14, height: 14 }}
                  className={cn(scanRunning && !scanStale && "animate-spin")}
                />
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[280px]">
            {syncTitle}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* 8. View segmented control */}
      <div
        style={{
          display: "inline-flex",
          borderRadius: "6px",
          border: "1px solid var(--pd-border)",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => onViewModeChange("grid")}
          title="Grid view"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "34px",
            height: "34px",
            border: "none",
            borderRight: "1px solid var(--pd-border)",
            background: viewMode === "grid" ? "var(--pd-accent-soft)" : "transparent",
            color: viewMode === "grid" ? "var(--pd-accent)" : "var(--pd-fg-muted)",
            cursor: "pointer",
          }}
        >
          <LayoutGrid style={{ width: 15, height: 15 }} />
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange("list")}
          title="List view"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "34px",
            height: "34px",
            border: "none",
            background: viewMode === "list" ? "var(--pd-accent-soft)" : "transparent",
            color: viewMode === "list" ? "var(--pd-accent)" : "var(--pd-fg-muted)",
            cursor: "pointer",
          }}
        >
          <List style={{ width: 15, height: 15 }} />
        </button>
      </div>
    </div>
  );
}
