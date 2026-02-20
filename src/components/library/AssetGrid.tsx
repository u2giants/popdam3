import type { Asset } from "@/types/assets";
import { Badge } from "@/components/ui/badge";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssetGridProps {
  assets: Asset[];
  selectedIds: Set<string>;
  onSelect: (id: string, event: React.MouseEvent) => void;
  isLoading: boolean;
}

function AssetCard({
  asset,
  selected,
  onSelect,
}: {
  asset: Asset;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const statusColor: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    processing: "bg-info/20 text-info",
    tagged: "bg-success/20 text-success",
    error: "bg-destructive/20 text-destructive",
  };

  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-all hover:border-primary/50 text-left",
        selected ? "border-primary ring-1 ring-primary" : "border-border"
      )}
    >
      {/* Thumbnail area — 4:3 */}
      <div className="relative aspect-[4/3] w-full bg-muted/30 overflow-hidden">
        {asset.thumbnail_url ? (
          <img
            src={asset.thumbnail_url}
            alt={asset.filename}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageOff className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}

        {/* File type badge */}
        <Badge
          variant="secondary"
          className="absolute top-2 left-2 text-[10px] uppercase px-1.5 py-0"
        >
          {asset.file_type}
        </Badge>

        {/* Selection indicator */}
        {selected && (
          <div className="absolute inset-0 bg-primary/10" />
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1 p-2.5">
        <span className="truncate text-sm font-medium leading-tight" title={asset.filename}>
          {asset.filename}
        </span>
        <div className="flex items-center gap-1.5">
          {asset.status && (
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", statusColor[asset.status] ?? statusColor.pending)}>
              {asset.status}
            </span>
          )}
          {asset.workflow_status && asset.workflow_status !== "other" && (
            <span className="rounded bg-tag px-1.5 py-0.5 text-[10px] text-tag-foreground capitalize">
              {asset.workflow_status.replace(/_/g, " ")}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function AssetGrid({ assets, selectedIds, onSelect, isLoading }: AssetGridProps) {
  if (isLoading && assets.length === 0) {
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

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ImageOff className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground">No assets found</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Try adjusting your filters or run a scan to ingest files
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 p-4">
      {assets.map((asset) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          selected={selectedIds.has(asset.id)}
          onSelect={(e) => onSelect(asset.id, e)}
        />
      ))}
    </div>
  );
}
