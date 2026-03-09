import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────

export type SortDir = "asc" | "desc" | null;

export interface ColumnFilter {
  key: string;
  value: string;
}

export interface ColumnDef {
  key: string;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  className?: string;
  /** Override width style */
  width?: number | string;
}

// ── Hook: useTableFilterSort ─────────────────────────────────────────

export function useTableFilterSort<T>(
  rows: T[],
  columns: ColumnDef[],
  getCell: (row: T, key: string) => string,
  defaultSort?: { key: string; dir: "asc" | "desc" },
) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSort?.key ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSort?.dir ?? null);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const toggleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"));
      if (sortDir === "desc") setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }, [sortKey, sortDir]);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearFilter = useCallback((key: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const clearAllFilters = useCallback(() => setFilters({}), []);

  // Unique values for autocomplete per filterable column
  const suggestions = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const col of columns) {
      if (!col.filterable) continue;
      const vals = new Set<string>();
      for (const row of rows) {
        const v = getCell(row, col.key);
        if (v && v !== "—") vals.add(v);
      }
      result[col.key] = Array.from(vals).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    }
    return result;
  }, [rows, columns, getCell]);

  // Filtered + sorted rows
  const processed = useMemo(() => {
    let result = rows;

    // Apply filters
    const activeFilters = Object.entries(filters).filter(([, v]) => v.length > 0);
    if (activeFilters.length > 0) {
      result = result.filter((row) =>
        activeFilters.every(([key, val]) => {
          const cell = getCell(row, key).toLowerCase();
          return cell.includes(val.toLowerCase());
        }),
      );
    }

    // Apply sort
    if (sortKey && sortDir) {
      result = [...result].sort((a, b) => {
        const va = getCell(a, sortKey);
        const vb = getCell(b, sortKey);
        // Try numeric comparison
        const na = Number(va);
        const nb = Number(vb);
        let cmp: number;
        if (!isNaN(na) && !isNaN(nb)) {
          cmp = na - nb;
        } else {
          cmp = va.localeCompare(vb, undefined, { sensitivity: "base", numeric: true });
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [rows, filters, sortKey, sortDir, getCell]);

  const hasActiveFilters = Object.values(filters).some((v) => v.length > 0);

  return {
    processed,
    sortKey,
    sortDir,
    filters,
    suggestions,
    toggleSort,
    setFilter,
    clearFilter,
    clearAllFilters,
    hasActiveFilters,
  };
}

// ── Component: SortableHeader ────────────────────────────────────────

export function SortableHeader({
  label,
  sortable,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  sortable?: boolean;
  active?: boolean;
  dir?: SortDir;
  onClick?: () => void;
  className?: string;
}) {
  if (!sortable) {
    return <span className={cn("text-xs", className)}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 text-xs select-none hover:text-foreground transition-colors whitespace-nowrap",
        active ? "text-foreground font-semibold" : "text-muted-foreground font-medium",
        className,
      )}
    >
      {label}
      {active && dir === "asc" && <ArrowUp className="h-3 w-3" />}
      {active && dir === "desc" && <ArrowDown className="h-3 w-3" />}
      {!active && <ArrowUpDown className="h-3 w-3 opacity-30" />}
    </button>
  );
}

// ── Component: ColumnFilterInput ─────────────────────────────────────

export function ColumnFilterInput({
  value,
  onChange,
  onClear,
  suggestions,
  placeholder = "Filter…",
}: {
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  suggestions: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    if (!value) return suggestions.slice(0, 20);
    const q = value.toLowerCase();
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 20);
  }, [suggestions, value]);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="h-6 w-full min-w-[60px] rounded border border-border bg-background px-1.5 text-[10px] outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-ring"
        />
        {value && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-0.5 w-full max-h-[160px] overflow-auto rounded border border-border bg-popover shadow-md">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className="block w-full text-left px-1.5 py-1 text-[10px] hover:bg-accent truncate"
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Component: FilterableHeaderRow ───────────────────────────────────

/** Renders two <tr> elements: one for sortable headers, one for filter inputs.
 *  Place inside a <thead>.
 */
export function FilterableHeaderRow({
  columns,
  sortKey,
  sortDir,
  filters,
  suggestions,
  onSort,
  onFilter,
  onClearFilter,
  prefixCells,
  suffixCells,
}: {
  columns: ColumnDef[];
  sortKey: string | null;
  sortDir: SortDir;
  filters: Record<string, string>;
  suggestions: Record<string, string[]>;
  onSort: (key: string) => void;
  onFilter: (key: string, value: string) => void;
  onClearFilter: (key: string) => void;
  /** Extra <th> / <td> before columns (e.g. checkbox column) */
  prefixCells?: { header: React.ReactNode; filter: React.ReactNode }[];
  /** Extra <th> / <td> after columns (e.g. actions column) */
  suffixCells?: { header: React.ReactNode; filter: React.ReactNode }[];
}) {
  const hasAnyFilterable = columns.some((c) => c.filterable);

  return (
    <>
      <tr className="border-b transition-colors">
        {prefixCells?.map((cell, i) => (
          <th key={`prefix-h-${i}`} className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">
            {cell.header}
          </th>
        ))}
        {columns.map((col) => (
          <th
            key={col.key}
            className={cn(
              "h-10 px-2 text-left align-middle font-medium text-muted-foreground",
              col.className,
            )}
            style={col.width ? { width: col.width, minWidth: typeof col.width === "number" ? col.width : undefined } : undefined}
          >
            <SortableHeader
              label={col.label}
              sortable={col.sortable}
              active={sortKey === col.key}
              dir={sortKey === col.key ? sortDir : null}
              onClick={() => col.sortable && onSort(col.key)}
            />
          </th>
        ))}
        {suffixCells?.map((cell, i) => (
          <th key={`suffix-h-${i}`} className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">
            {cell.header}
          </th>
        ))}
      </tr>
      {hasAnyFilterable && (
        <tr className="border-b bg-muted/30">
          {prefixCells?.map((cell, i) => (
            <td key={`prefix-f-${i}`} className="px-2 py-1">
              {cell.filter}
            </td>
          ))}
          {columns.map((col) => (
            <td key={col.key} className="px-2 py-1">
              {col.filterable ? (
                <ColumnFilterInput
                  value={filters[col.key] || ""}
                  onChange={(v) => onFilter(col.key, v)}
                  onClear={() => onClearFilter(col.key)}
                  suggestions={suggestions[col.key] || []}
                />
              ) : null}
            </td>
          ))}
          {suffixCells?.map((cell, i) => (
            <td key={`suffix-f-${i}`} className="px-2 py-1">
              {cell.filter}
            </td>
          ))}
        </tr>
      )}
    </>
  );
}
