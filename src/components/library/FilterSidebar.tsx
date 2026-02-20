import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AssetFilters, FacetCounts } from "@/types/assets";
import { Constants } from "@/integrations/supabase/types";

interface FilterSidebarProps {
  filters: AssetFilters;
  onFiltersChange: (f: AssetFilters) => void;
  onClose: () => void;
  licensors: { id: string; name: string }[];
  properties: { id: string; name: string }[];
  facetCounts: FacetCounts | null;
}

function CheckboxGroup({
  label,
  options,
  selected,
  onChange,
  counts,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onChange: (v: string[]) => void;
  counts?: Record<string, number>;
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
          return (
            <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={selected.includes(opt)}
                onCheckedChange={() => toggle(opt)}
                className="h-3.5 w-3.5"
              />
              <span className="capitalize flex-1">{opt.replace(/_/g, " ")}</span>
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
    });

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

          {/* Licensor */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Licensor</h4>
            <Select
              value={filters.licensorId ?? "__all__"}
              onValueChange={(v) => update({ licensorId: v === "__all__" ? null : v })}
            >
              <SelectTrigger className="h-8 bg-background text-sm">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All</SelectItem>
                {licensors.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Property */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Property</h4>
            <Select
              value={filters.propertyId ?? "__all__"}
              onValueChange={(v) => update({ propertyId: v === "__all__" ? null : v })}
            >
              <SelectTrigger className="h-8 bg-background text-sm">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All</SelectItem>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Asset Type */}
          <CheckboxGroup
            label="Asset Type"
            options={Constants.public.Enums.asset_type}
            selected={filters.assetType}
            onChange={(v) => update({ assetType: v })}
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
