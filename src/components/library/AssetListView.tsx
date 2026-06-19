import type { Asset } from "@/types/assets";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssetListViewProps {
  assets: Asset[];
  selectedIds: Set<string>;
  onSelect: (id: string, event: React.MouseEvent) => void;
  isLoading: boolean;
}

// Colors keyed by file_type enum value
const FILE_TYPE_META: Record<string, { label: string; bg: string; color: string }> = {
  psd: { label: "PSD", bg: "#7c3aed", color: "#fff" },
  ai:  { label: "AI",  bg: "#ea580c", color: "#fff" },
  png: { label: "PNG", bg: "#0d9488", color: "#fff" },
  pdf: { label: "PDF", bg: "#dc2626", color: "#fff" },
  jpg: { label: "JPG", bg: "#2563eb", color: "#fff" },
  tif: { label: "TIF", bg: "#7c3aed", color: "#fff" }, // violet (same hue as PSD)
};

function FileTypeBadge({ fileType }: { fileType: string }) {
  const meta = FILE_TYPE_META[fileType?.toLowerCase()] ?? {
    label: (fileType ?? "?").toUpperCase(),
    bg: "#64748b",
    color: "#fff",
  };
  return (
    <div
      style={{
        width: 36,
        height: 28,
        borderRadius: 6,
        background: meta.bg,
        color: meta.color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.04em",
        flexShrink: 0,
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      {meta.label}
    </div>
  );
}

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function isSuperseded(asset: Asset): boolean {
  return asset.workflow_status === "discontinued";
}

export default function AssetListView({ assets, selectedIds, onSelect, isLoading }: AssetListViewProps) {
  if (isLoading && assets.length === 0) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 rounded bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ImageOff className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground">No assets found</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div
        className="grid items-center border-b border-border px-3 py-1.5"
        style={{ gridTemplateColumns: "40px 1.8fr 1.2fr .7fr .7fr" }}
      >
        <div />
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Filename</div>
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Style group</div>
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Size</div>
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide text-right">Modified</div>
      </div>

      {/* Rows */}
      <div>
        {assets.map((asset) => {
          const selected = selectedIds.has(asset.id);
          const superseded = isSuperseded(asset);
          const skuLine = asset.sku ?? null;
          const subtitleParts = [asset.property_name, asset.licensor_name].filter(Boolean);
          const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : null;

          return (
            <div
              key={asset.id}
              onClick={(e) => onSelect(asset.id, e)}
              className={cn(
                "grid items-center px-3 cursor-pointer border-b border-border/50 transition-colors",
                "hover:bg-muted/40",
                selected && "bg-primary/10 hover:bg-primary/15"
              )}
              style={{ gridTemplateColumns: "40px 1.8fr 1.2fr .7fr .7fr", minHeight: 48 }}
            >
              {/* Type badge */}
              <div className="flex items-center">
                <FileTypeBadge fileType={asset.file_type} />
              </div>

              {/* Filename */}
              <div className="min-w-0 pr-3">
                <div
                  className="truncate font-mono text-[12.5px] font-semibold leading-tight"
                  title={asset.filename}
                >
                  {asset.filename}
                </div>
                <div
                  className="text-[11px] leading-tight mt-0.5"
                  style={{ color: "var(--pd-fg-subtle)" }}
                >
                  {superseded ? "superseded" : "current version"}
                </div>
              </div>

              {/* Style group */}
              <div className="min-w-0 pr-3">
                {skuLine && (
                  <div
                    className="truncate font-mono text-[11.5px] font-medium leading-tight"
                    title={skuLine}
                  >
                    {skuLine}
                  </div>
                )}
                {subtitle && (
                  <div
                    className="truncate text-[11px] leading-tight mt-0.5"
                    style={{ color: "var(--pd-fg-muted)" }}
                    title={subtitle}
                  >
                    {subtitle}
                  </div>
                )}
                {!skuLine && !subtitle && (
                  <span className="text-[11.5px] font-mono" style={{ color: "var(--pd-fg-muted)" }}>—</span>
                )}
              </div>

              {/* Size */}
              <div
                className="font-mono text-[12px] tabular-nums"
                style={{ color: "var(--pd-fg-muted)" }}
              >
                {formatSize(asset.file_size)}
              </div>

              {/* Modified */}
              <div
                className="text-[12px] tabular-nums text-right"
                style={{ color: "var(--pd-fg-muted)" }}
                title={new Date(asset.modified_at).toLocaleString()}
              >
                {relativeTime(asset.modified_at)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
