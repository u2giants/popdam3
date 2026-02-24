import type { StyleGroup } from "@/hooks/useStyleGroups";
import { Badge } from "@/components/ui/badge";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface StyleGroupGridProps {
  groups: StyleGroup[];
  selectedIds: Set<string>;
  onSelect: (id: string, event: React.MouseEvent) => void;
  isLoading: boolean;
}

function StyleGroupCard({
  group,
  selected,
  onSelect,
}: {
  group: StyleGroup;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const subtitle = group.is_licensed
    ? [group.licensor_name, group.property_name].filter(Boolean).join(" · ")
    : group.product_category || null;

  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-all hover:border-primary/50 text-left",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
      )}
    >
      {/* Thumbnail area — 4:3 */}
      <div className="relative aspect-[4/3] w-full bg-muted/30 overflow-hidden">
        {group.thumbnail_url ? (
          <img
            src={group.thumbnail_url}
            alt={group.sku}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageOff className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}

        {/* File count badge */}
        <Badge
          variant="secondary"
          className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0"
        >
          {group.asset_count} file{group.asset_count !== 1 ? "s" : ""}
        </Badge>

        {/* Licensed/Generic badge */}
        <Badge
          variant={group.is_licensed ? "default" : "secondary"}
          className="absolute top-2 left-2 text-[10px] px-1.5 py-0"
        >
          {group.is_licensed ? "Licensed" : "Generic"}
        </Badge>

        {/* Selection indicator */}
        {selected && <div className="absolute inset-0 bg-primary/10" />}
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1 p-2.5">
        <span className="truncate text-sm font-semibold leading-tight" title={group.sku}>
          {group.sku}
        </span>
        {subtitle && (
          <span className="truncate text-[11px] text-muted-foreground" title={subtitle}>
            {subtitle}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          {group.workflow_status && group.workflow_status !== "other" && (
            <span className="rounded bg-tag px-1.5 py-0.5 text-[10px] text-tag-foreground capitalize">
              {group.workflow_status.replace(/_/g, " ")}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function StyleGroupGrid({ groups, selectedIds, onSelect, isLoading }: StyleGroupGridProps) {
  if (isLoading && groups.length === 0) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 p-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex flex-col overflow-hidden rounded-lg border border-border bg-card animate-pulse">
            <div className="aspect-[4/3] bg-muted/30" />
            <div className="p-2.5 space-y-2">
              <div className="h-4 w-3/4 rounded bg-muted/30" />
              <div className="h-3 w-1/2 rounded bg-muted/20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ImageOff className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground">No style groups found</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Run "Rebuild Style Groups" in Diagnostics to generate groups from your assets
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 p-4">
      {groups.map((group) => (
        <StyleGroupCard
          key={group.id}
          group={group}
          selected={selectedIds.has(group.id)}
          onSelect={(e) => onSelect(group.id, e)}
        />
      ))}
    </div>
  );
}
