import { useState, useMemo, useRef, useEffect } from "react";
import { X, Search, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { AssetFilters, FacetCounts, FileStatusFilter } from "@/types/assets";
import { Constants } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

interface FilterSidebarProps {
  filters: AssetFilters;
  onFiltersChange: (f: AssetFilters) => void;
  onClose: () => void;
  licensors: { id: string; name: string; asset_count: number }[];
  properties: { id: string; name: string; licensor_id: string; asset_count: number }[];
  facetCounts: FacetCounts | null;
}

// ── Display name maps ───────────────────────────────────────────────

const ASSET_TYPE_LABELS: Record<string, string> = {
  art_piece: "Art Piece",
  product: "Product",
  packaging: "Packaging",
  tech_pack: "Tech Pack",
  photography: "Photography",
};

const ASSET_TYPE_OPTIONS = ["art_piece", "product", "packaging", "tech_pack", "photography"] as const;

const FILE_STATUS_OPTIONS: { value: FileStatusFilter; label: string }[] = [
  { value: "", label: "All files" },
  { value: "has_preview", label: "Has preview" },
  { value: "no_preview_renderable", label: "No preview — renderable" },
  { value: "no_pdf_compat", label: "No preview — AI not PDF compatible" },
  { value: "no_preview_unsupported", label: "No preview — unsupported format" },
];

// ── Reusable checkbox group ─────────────────────────────────────────

function CheckboxGroup({
  label,
  options,
  selected,
  onChange,
  counts,
  labelMap,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onChange: (v: string[]) => void;
  counts?: Record<string, number>;
  labelMap?: Record<string, string>;
}) {
  const toggle = (val: string) => {
    onChange(
      selected.includes(val)
        ? selected.filter((s) => s !== val)
        : [...selected, val]
    );
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</h4>
      <div className="space-y-1.5">
        {options.map((opt) => {
          const c = counts?.[opt];
          const displayLabel = labelMap?.[opt] ?? opt.replace(/_/g, " ");
          return (
            <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={selected.includes(opt)}
                onCheckedChange={() => toggle(opt)}
                className="h-3.5 w-3.5"
              />
              <span className="capitalize flex-1">{displayLabel}</span>
              {c !== undefined && (
                <span className="text-[10px] text-muted-foreground tabular-nums">{c}</span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── Searchable combobox for licensor/property ───────────────────────

interface ComboOption {
  id: string;
  name: string;
  count: number;
}

function SearchableCombo({
  label,
  options,
  value,
  onChange,
  placeholder = "Search…",
}: {
  label: string;
  options: ComboOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
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
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, search]);

  const selectedName = value ? options.find((o) => o.id === value)?.name : null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</h4>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => { setOpen(!open); setSearch(""); }}
          className={cn(
            "flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-2.5 text-sm",
            "hover:bg-accent/50 transition-colors",
            open && "ring-1 ring-ring"
          )}
        >
          <span className={cn("truncate", !selectedName && "text-muted-foreground")}>
            {selectedName ?? "All"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
            <div className="flex items-center border-b border-border px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground mr-1.5 shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={placeholder}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>

            <ScrollArea className="max-h-[200px]">
              <div className="p-1">
                <button
                  type="button"
                  onClick={() => { onChange(null); setOpen(false); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-accent",
                    !value && "bg-accent/60 font-medium"
                  )}
                >
                  <span>All</span>
                </button>

                {filtered.length === 0 && (
                  <p className="px-2 py-3 text-xs text-muted-foreground text-center">No results</p>
                )}

                {filtered.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { onChange(opt.id); setOpen(false); }}
                    className={cn(
                      "flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-accent",
                      value === opt.id && "bg-accent/60 font-medium"
                    )}
                  >
                    <span className="truncate">{opt.name}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums ml-2 shrink-0">{opt.count}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main sidebar ────────────────────────────────────────────────────

export default function FilterSidebar({
  filters,
  onFiltersChange,
  onClose,
  licensors,
  properties,
  facetCounts,
}: FilterSidebarProps) {
  const update = (partial: Partial<AssetFilters>) =>
    onFiltersChange({ ...filters, ...partial });

  const clearAll = () =>
    onFiltersChange({
      search: filters.search,
      fileType: [],
      status: [],
      workflowStatus: [],
      isLicensed: null,
      licensorId: null,
      propertyId: null,
      assetType: [],
      artSource: [],
      tagFilter: "",
      fileStatus: "",
    });

  const licensorOptions: ComboOption[] = licensors.map((l) => ({
    id: l.id,
    name: l.name,
    count: l.asset_count,
  }));

  const propertyOptions: ComboOption[] = properties.map((p) => ({
    id: p.id,
    name: p.name,
    count: p.asset_count,
  }));

  return (
    <div className="flex h-full w-[264px] flex-col border-r border-border bg-surface-overlay">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium">Filters</h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearAll}>
            Clear all
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        <div className="space-y-5">
          {/* Tag filter */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Tag</h4>
            <Input
              placeholder="Filter by tag…"
              value={filters.tagFilter}
              onChange={(e) => update({ tagFilter: e.target.value })}
              className="h-8 bg-background text-sm"
            />
          </div>

          <Separator />

          {/* File Status */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">File Status</h4>
            <div className="space-y-1.5">
              {FILE_STATUS_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
                  <Checkbox
                    checked={filters.fileStatus === opt.value}
                    onCheckedChange={(checked) =>
                      update({ fileStatus: checked ? opt.value : "" })
                    }
                    className="h-3.5 w-3.5"
                  />
                  <span className="flex-1">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <Separator />

          {/* File Type */}
          <CheckboxGroup
            label="File Type"
            options={Constants.public.Enums.file_type}
            selected={filters.fileType}
            onChange={(v) => update({ fileType: v })}
            counts={facetCounts?.fileType}
          />

          <Separator />

          {/* Status */}
          <CheckboxGroup
            label="Status"
            options={Constants.public.Enums.asset_status}
            selected={filters.status}
            onChange={(v) => update({ status: v })}
            counts={facetCounts?.status}
          />

          <Separator />

          {/* Workflow Status */}
          <CheckboxGroup
            label="Workflow"
            options={Constants.public.Enums.workflow_status}
            selected={filters.workflowStatus}
            onChange={(v) => update({ workflowStatus: v })}
            counts={facetCounts?.workflowStatus}
          />

          <Separator />

          {/* Licensed */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Licensed</h4>
            <div className="space-y-1.5">
              {[
                { label: "Yes", value: true },
                { label: "No", value: false },
              ].map((opt) => {
                const countVal = facetCounts?.isLicensed?.[String(opt.value) as "true" | "false"];
                return (
                  <label key={String(opt.value)} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={filters.isLicensed === opt.value}
                      onCheckedChange={(checked) =>
                        update({ isLicensed: checked ? opt.value : null })
                      }
                      className="h-3.5 w-3.5"
                    />
                    <span className="flex-1">{opt.label}</span>
                    {countVal !== undefined && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">{countVal}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Licensor - searchable */}
          <SearchableCombo
            label="Licensor"
            options={licensorOptions}
            value={filters.licensorId}
            onChange={(id) => update({ licensorId: id, propertyId: null })}
            placeholder="Search licensors…"
          />

          <Separator />

          {/* Property - searchable */}
          <SearchableCombo
            label="Property"
            options={propertyOptions}
            value={filters.propertyId}
            onChange={(id) => update({ propertyId: id })}
            placeholder="Search properties…"
          />

          <Separator />

          {/* Asset Type */}
          <CheckboxGroup
            label="Asset Type"
            options={ASSET_TYPE_OPTIONS}
            selected={filters.assetType}
            onChange={(v) => update({ assetType: v })}
            labelMap={ASSET_TYPE_LABELS}
          />

          <Separator />

          {/* Art Source */}
          <CheckboxGroup
            label="Art Source"
            options={Constants.public.Enums.art_source}
            selected={filters.artSource}
            onChange={(v) => update({ artSource: v })}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
