import { useState, useMemo, useRef, useEffect } from "react";
import { X, Search, ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AssetFilters, FacetCounts, FileStatusFilter } from "@/types/assets";
import { CONTENT_TYPE_LABELS, CONTENT_TYPE_OPTIONS } from "@/lib/asset-content-types";
import { STAGE_OPTIONS } from "@/types/assets";
import { Constants } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

interface FilterSidebarProps {
  filters: AssetFilters;
  onFiltersChange: (f: AssetFilters) => void;
  onClose: () => void;
  licensors: { id: string; name: string; asset_count: number }[];
  properties: { id: string; name: string; licensor_id: string; asset_count: number }[];
  facetCounts: FacetCounts | null;
  customerOptions?: { id: string; label: string; count: number }[];
  programOptions?: { name: string; count: number }[];
  /** Distinct product-material values for the Material facet (rich-PDF extraction). */
  materialOptions?: string[];
  mode?: "groups" | "assets";
}

// ── Display name maps ───────────────────────────────────────────────

const ASSET_TYPE_LABELS: Record<string, string> = {
  art_piece: "Design Art",
  product: "Product",
  packaging: "Packaging",
  tech_pack: "Tech Pack",
  photography: "Photography",
};

const ASSET_TYPE_OPTIONS = ["art_piece", "product", "packaging", "tech_pack", "photography"] as const;

const FILE_STATUS_OPTIONS: { value: FileStatusFilter; label: string }[] = [
  { value: "has_preview", label: "Has preview" },
  { value: "no_preview_renderable", label: "No preview — renderable" },
  { value: "no_pdf_compat", label: "No preview — AI not PDF compatible" },
  { value: "no_preview_unsupported", label: "No preview — unsupported format" },
];

// ── Checkbox row ────────────────────────────────────────────────────

function FacetRow({
  label,
  checked,
  onToggle,
  count,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  count?: number;
}) {
  return (
    <label
      className="flex items-center gap-2 cursor-pointer"
      style={{ minHeight: 24, userSelect: "none" }}
    >
      <span
        onClick={onToggle}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: 4,
          border: checked ? "1.5px solid var(--pd-accent)" : "1.5px solid var(--pd-border)",
          background: checked ? "var(--pd-accent)" : "transparent",
          flexShrink: 0,
          transition: "background 0.12s, border-color 0.12s",
          cursor: "pointer",
        }}
      >
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 13,
          color: "var(--pd-fg)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textTransform: "capitalize",
        }}
      >
        {label}
      </span>
      {count !== undefined && (
        <span style={{ color: "var(--pd-fg-subtle)", fontSize: 11, tabularNums: true } as React.CSSProperties}>
          {count}
        </span>
      )}
    </label>
  );
}

// ── Collapsible section ─────────────────────────────────────────────

function Section({
  title,
  selectedCount,
  children,
  defaultOpen = true,
}: {
  title: string;
  selectedCount?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: "1px solid var(--pd-border)" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          padding: "8px 12px",
          gap: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            flex: 1,
            textAlign: "left",
            color: "var(--pd-fg)",
            fontWeight: 600,
            fontSize: 13.5,
          }}
        >
          {title}
        </span>
        {selectedCount != null && selectedCount > 0 && (
          <span
            style={{
              background: "var(--pd-accent-soft)",
              color: "var(--pd-accent-soft-fg)",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 8,
              padding: "1px 6px",
              lineHeight: "16px",
            }}
          >
            {selectedCount}
          </span>
        )}
        <ChevronDown
          style={{
            width: 14,
            height: 14,
            color: "var(--pd-fg-muted)",
            transition: "transform 0.15s",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            flexShrink: 0,
          }}
        />
      </button>
      {open && (
        <div style={{ padding: "0 12px 10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          {children}
        </div>
      )}
    </div>
  );
}

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
    <Section title={label} selectedCount={selected.length}>
      {options.map((opt) => {
        const c = counts?.[opt];
        const displayLabel = labelMap?.[opt] ?? opt.replace(/_/g, " ");
        return (
          <FacetRow
            key={opt}
            label={displayLabel}
            checked={selected.includes(opt)}
            onToggle={() => toggle(opt)}
            count={c}
          />
        );
      })}
    </Section>
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
  const isActive = value !== null;

  return (
    <Section title={label} selectedCount={isActive ? 1 : 0}>
      <div ref={containerRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => { setOpen(!open); setSearch(""); }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            height: 30,
            borderRadius: 6,
            border: "1px solid var(--pd-border)",
            background: "var(--pd-surface)",
            padding: "0 8px",
            fontSize: 13,
            color: selectedName ? "var(--pd-fg)" : "var(--pd-fg-muted)",
            cursor: "pointer",
            gap: 4,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>
            {selectedName ?? "All"}
          </span>
          <ChevronDown style={{ width: 13, height: 13, flexShrink: 0, color: "var(--pd-fg-muted)" }} />
        </button>

        {open && (
          <div
            style={{
              position: "absolute",
              zIndex: 50,
              marginTop: 2,
              width: "100%",
              borderRadius: 6,
              border: "1px solid var(--pd-border)",
              background: "var(--pd-surface)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid var(--pd-border)",
                padding: "6px 8px",
                gap: 6,
              }}
            >
              <Search style={{ width: 13, height: 13, color: "var(--pd-fg-muted)", flexShrink: 0 }} />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={placeholder}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: 13,
                  color: "var(--pd-fg)",
                }}
              />
            </div>

            <ScrollArea className="max-h-[200px]">
              <div style={{ padding: 4 }}>
                <button
                  type="button"
                  onClick={() => { onChange(null); setOpen(false); }}
                  style={{
                    display: "flex",
                    width: "100%",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderRadius: 4,
                    padding: "5px 8px",
                    fontSize: 13,
                    background: !value ? "var(--pd-accent-soft)" : "transparent",
                    color: "var(--pd-fg)",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: !value ? 600 : 400,
                  }}
                >
                  <span>All</span>
                </button>

                {filtered.length === 0 && (
                  <p style={{ padding: "8px 8px", fontSize: 12, color: "var(--pd-fg-muted)", textAlign: "center" }}>
                    No results
                  </p>
                )}

                {filtered.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { onChange(opt.id); setOpen(false); }}
                    style={{
                      display: "flex",
                      width: "100%",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderRadius: 4,
                      padding: "5px 8px",
                      fontSize: 13,
                      background: value === opt.id ? "var(--pd-accent-soft)" : "transparent",
                      color: "var(--pd-fg)",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: value === opt.id ? 600 : 400,
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.name}</span>
                    <span style={{ fontSize: 11, color: "var(--pd-fg-subtle)", marginLeft: 6, flexShrink: 0 }}>{opt.count}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </Section>
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
  customerOptions = [],
  programOptions = [],
  materialOptions = [],
  mode = "groups",
}: FilterSidebarProps) {
  const update = (partial: Partial<AssetFilters>) =>
    onFiltersChange({ ...filters, ...partial });

  const clearAll = () =>
    onFiltersChange({
      search: filters.search,
      fileType: [],
      contentType: [],
      productMaterial: [],
      status: [],
      workflowStatus: [],
      isLicensed: null,
      licensorId: null,
      propertyId: null,
      assetType: [],
      artSource: [],
      tagFilter: "",
      fileStatus: [],
      productCategory: [],
      stage: [],
      customer: null,
      program: null,
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

  const customerComboOptions: ComboOption[] = customerOptions.map((c) => ({
    id: c.id,
    name: c.label,
    count: c.count,
  }));

  const programComboOptions: ComboOption[] = programOptions.map((p) => ({
    id: p.name,
    name: p.name,
    count: p.count,
  }));

  // Count active filters for the header badge
  const activeCount = [
    filters.fileType.length,
    filters.contentType.length,
    filters.productMaterial.length,
    filters.status.length,
    filters.workflowStatus.length,
    filters.fileStatus.length,
    filters.stage.length,
    filters.assetType.length,
    filters.artSource.length,
    filters.productCategory.length,
    filters.isLicensed !== null ? 1 : 0,
    filters.licensorId ? 1 : 0,
    filters.propertyId ? 1 : 0,
    filters.customer ? 1 : 0,
    filters.program ? 1 : 0,
    filters.tagFilter ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <div
      style={{
        width: 214,
        borderRight: "1px solid var(--pd-border)",
        background: "var(--pd-surface)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 12px 10px 12px",
          borderBottom: "1px solid var(--pd-border)",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <SlidersHorizontal
          style={{ width: 15, height: 15, color: "var(--pd-accent)", flexShrink: 0 }}
        />
        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--pd-fg)", flex: 1 }}>
          Filters
        </span>
        {activeCount > 0 && (
          <span
            style={{
              background: "var(--pd-accent-soft)",
              color: "var(--pd-accent-soft-fg)",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 8,
              padding: "1px 6px",
              lineHeight: "16px",
            }}
          >
            {activeCount}
          </span>
        )}
        <button
          type="button"
          onClick={clearAll}
          title="Remove all active filters. Does not delete any data."
          style={{
            fontSize: 11,
            color: "var(--pd-fg-muted)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 4px",
            borderRadius: 4,
          }}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 4,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--pd-fg-muted)",
          }}
        >
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>

      <ScrollArea className="flex-1">
        {/* Tag filter — assets only */}
        {mode === "assets" && (
          <Section title="Tag" selectedCount={filters.tagFilter ? 1 : 0}>
            <Input
              placeholder="Filter by tag…"
              value={filters.tagFilter}
              onChange={(e) => update({ tagFilter: e.target.value })}
              style={{
                height: 30,
                background: "var(--pd-surface)",
                fontSize: 13,
                border: "1px solid var(--pd-border)",
                color: "var(--pd-fg)",
              }}
            />
          </Section>
        )}

        {/* File Status */}
        <Section title="File Status" selectedCount={filters.fileStatus.length}>
          {FILE_STATUS_OPTIONS.map((opt) => {
            const isChecked = filters.fileStatus.includes(opt.value);
            return (
              <FacetRow
                key={opt.value}
                label={opt.label}
                checked={isChecked}
                onToggle={() => {
                  const next = isChecked
                    ? filters.fileStatus.filter((v) => v !== opt.value)
                    : [...filters.fileStatus, opt.value];
                  update({ fileStatus: next });
                }}
              />
            );
          })}
        </Section>

        {/* Stage (pipeline folder) */}
        <CheckboxGroup
          label="Stage"
          options={STAGE_OPTIONS}
          selected={filters.stage}
          onChange={(v) => update({ stage: v })}
          counts={facetCounts?.stage}
        />

        {/* Customer — searchable */}
        <SearchableCombo
          label="Customer"
          options={customerComboOptions}
          value={filters.customer}
          onChange={(id) => update({ customer: id, program: null })}
          placeholder="Search customers…"
        />

        {/* Program — searchable (scoped to selected customer) */}
        <SearchableCombo
          label="Program"
          options={programComboOptions}
          value={filters.program}
          onChange={(id) => update({ program: id })}
          placeholder="Search programs…"
        />

        {/* File Type — assets only */}
        {mode === "assets" && (
          <CheckboxGroup
            label="File Type"
            options={Constants.public.Enums.file_type}
            selected={filters.fileType}
            onChange={(v) => update({ fileType: v })}
            counts={facetCounts?.fileType}
          />
        )}

        {/* Content Type — AI-classified file kind, assets only */}
        {mode === "assets" && (
          <CheckboxGroup
            label="Content Type"
            options={[...CONTENT_TYPE_OPTIONS]}
            selected={filters.contentType}
            onChange={(v) => update({ contentType: v })}
            labelMap={CONTENT_TYPE_LABELS}
          />
        )}

        {/* Material — from rich-PDF extraction; only shown once options exist */}
        {mode === "assets" && materialOptions.length > 0 && (
          <CheckboxGroup
            label="Material"
            options={materialOptions}
            selected={filters.productMaterial}
            onChange={(v) => update({ productMaterial: v })}
          />
        )}

        {/* Status — assets only */}
        {mode === "assets" && (
          <CheckboxGroup
            label="Status"
            options={Constants.public.Enums.asset_status}
            selected={filters.status}
            onChange={(v) => update({ status: v })}
            counts={facetCounts?.status}
          />
        )}

        {/* Workflow Status */}
        <CheckboxGroup
          label="Workflow"
          options={Constants.public.Enums.workflow_status}
          selected={filters.workflowStatus}
          onChange={(v) => update({ workflowStatus: v })}
          counts={facetCounts?.workflowStatus}
        />

        {/* Licensing */}
        <Section
          title="Licensing"
          selectedCount={filters.isLicensed !== null ? 1 : 0}
        >
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { label: "Licensed", value: true },
              { label: "Generic", value: false },
            ].map((opt) => {
              const isActive = filters.isLicensed === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() =>
                    update({ isLicensed: isActive ? null : opt.value })
                  }
                  style={{
                    flex: 1,
                    height: 28,
                    borderRadius: 5,
                    border: isActive
                      ? "1.5px solid var(--pd-accent)"
                      : "1px solid var(--pd-border)",
                    background: isActive ? "var(--pd-accent-soft)" : "transparent",
                    color: isActive ? "var(--pd-accent-soft-fg)" : "var(--pd-fg-muted)",
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 400,
                    cursor: "pointer",
                    transition: "background 0.12s, border-color 0.12s",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {/* Per-value counts */}
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { label: "Yes", key: "true" as const },
              { label: "No", key: "false" as const },
            ].map(({ label, key }) => {
              const c = facetCounts?.isLicensed?.[key];
              return (
                <span
                  key={key}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    fontSize: 11,
                    color: "var(--pd-fg-subtle)",
                  }}
                >
                  {c !== undefined ? c : ""}
                </span>
              );
            })}
          </div>
        </Section>

        {/* Licensor - searchable */}
        <SearchableCombo
          label="Licensor"
          options={licensorOptions}
          value={filters.licensorId}
          onChange={(id) => update({ licensorId: id, propertyId: null })}
          placeholder="Search licensors…"
        />

        {/* Property - searchable */}
        <SearchableCombo
          label="Property"
          options={propertyOptions}
          value={filters.propertyId}
          onChange={(id) => update({ propertyId: id })}
          placeholder="Search properties…"
        />

        {/* Product Category */}
        <CheckboxGroup
          label="Product Category"
          options={["Wall", "Tabletop", "Clock", "Storage", "Workspace", "Floor", "Garden"]}
          selected={filters.productCategory}
          onChange={(v) => update({ productCategory: v })}
        />

        {/* Image Type */}
        <CheckboxGroup
          label="Image Type"
          options={ASSET_TYPE_OPTIONS}
          selected={filters.assetType}
          onChange={(v) => update({ assetType: v })}
          labelMap={ASSET_TYPE_LABELS}
        />

        {/* Art Source — assets only */}
        {mode === "assets" && (
          <CheckboxGroup
            label="Art Source"
            options={Constants.public.Enums.art_source}
            selected={filters.artSource}
            onChange={(v) => update({ artSource: v })}
          />
        )}
      </ScrollArea>
    </div>
  );
}
