import { useQuery } from "@tanstack/react-query";
import type { Asset } from "@/types/assets";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Download, FolderOpen, Copy, PanelRight, Loader2, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { buildOpenFolderUri, getPreferredPathMode } from "@/lib/open-folder";
import { getPathDisplayModes, type NasConfig } from "@/lib/path-utils";
import { toast } from "sonner";
import { useState } from "react";

interface AssetGridProps {
  assets: Asset[];
  selectedIds: Set<string>;
  onSelect: (id: string, event: React.MouseEvent) => void;
  onOpenDetail: (id: string) => void;
  isLoading: boolean;
}

// File type → color hue (oklch hue angle)
const FILE_TYPE_HUE: Record<string, number> = {
  psd: 260,
  ai: 42,
  png: 155,
  pdf: 20,
  jpg: 210,
  tif: 295,
};
const DEFAULT_HUE = 250;

// File type → dark badge/tile background color
const FILE_TYPE_COLOR: Record<string, string> = {
  psd: "oklch(0.42 0.18 260)",
  ai:  "oklch(0.62 0.18 42)",
  png: "oklch(0.5 0.15 155)",
  pdf: "oklch(0.55 0.2 20)",
  jpg: "oklch(0.5 0.13 210)",
  tif: "oklch(0.5 0.16 295)",
};
const DEFAULT_COLOR = "oklch(0.55 0.08 250)";

function getFileTypeColor(fileType: string): string {
  return FILE_TYPE_COLOR[fileType?.toLowerCase()] ?? DEFAULT_COLOR;
}

function getFileTypeHue(fileType: string): number {
  return FILE_TYPE_HUE[fileType?.toLowerCase()] ?? DEFAULT_HUE;
}

function formatFileSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Glass-style overlay badge
function GlassBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white", className)}
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
    >
      {children}
    </span>
  );
}

function useNasConfig(): NasConfig | null {
  const { data } = useQuery({
    queryKey: ["nas-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_config")
        .select("key, value")
        .in("key", ["NAS_HOST", "NAS_IP", "NAS_SHARE"]);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data ?? []) map[row.key] = row.value as string;
      if (!map.NAS_HOST || !map.NAS_IP || !map.NAS_SHARE) return null;
      return { NAS_HOST: map.NAS_HOST, NAS_IP: map.NAS_IP, NAS_SHARE: map.NAS_SHARE };
    },
    staleTime: 60_000,
  });
  return data ?? null;
}

function AssetCard({
  asset,
  selected,
  onSelect,
  onOpenDetail,
  nasConfig,
}: {
  asset: Asset;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onOpenDetail: () => void;
  nasConfig: NasConfig | null;
}) {
  const [checkingOut, setCheckingOut] = useState(false);

  const fileType = (asset.file_type ?? "").toLowerCase();
  const tileColor = getFileTypeColor(fileType);
  const hue = getFileTypeHue(fileType);
  const hasPreview = !!asset.thumbnail_url;
  const licensorPart = asset.licensor_name;
  const propertyPart = asset.property_name;
  const subtitle = licensorPart && propertyPart
    ? `${licensorPart} · ${propertyPart}`
    : propertyPart ?? licensorPart ?? null;

  async function handleCheckout() {
    setCheckingOut(true);
    try {
      const { data, error } = await supabase.functions.invoke("helper-api/tokens", {
        body: { asset_id: asset.id },
      });
      if (error || !data?.ok) {
        toast.error("Could not create checkout link", { description: error?.message ?? data?.error });
        return;
      }
      const uri = `popdam://checkout?token=${encodeURIComponent(data.token)}`;
      const a = document.createElement("a");
      a.href = uri; a.rel = "noopener"; a.style.display = "none";
      document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 0);
    } finally {
      setCheckingOut(false);
    }
  }

  function handleOpenFolder() {
    if (!nasConfig) return;
    const paths = getPathDisplayModes(asset.relative_path, nasConfig, null);
    const mode = getPreferredPathMode();
    const fullPath = mode === "unc_ip" ? paths.uncIp : mode === "synology_drive" ? paths.remote : paths.uncHost;
    if (!fullPath) { toast.error("No path available for current path mode"); return; }
    const folder = fullPath.substring(0, Math.max(fullPath.lastIndexOf("\\"), fullPath.lastIndexOf("/")));
    const a = document.createElement("a");
    a.href = buildOpenFolderUri(folder); a.rel = "noopener"; a.style.display = "none";
    document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 0);
  }

  async function handleCopy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  }

  const fileSizeStr = formatFileSize(asset.file_size);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onSelect}
          onDoubleClick={onOpenDetail}
          className={cn(
            "group relative flex flex-col overflow-hidden text-left transition-all",
            "rounded-lg border",
            "hover:-translate-y-0.5 hover:shadow-md",
            selected
              ? "border-[var(--pd-primary)] ring-1 ring-[var(--pd-primary)]"
              : "border-[var(--pd-border)] hover:border-[var(--pd-border-hover,var(--pd-border))]",
          )}
          style={{ background: "var(--pd-surface, hsl(var(--card)))" }}
        >
          {/* Thumbnail — 4:3 */}
          <div className="relative w-full overflow-hidden" style={{ aspectRatio: "4/3" }}>
            {hasPreview ? (
              <img
                src={asset.thumbnail_url!}
                alt={asset.filename}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              /* Type-tinted placeholder */
              <div
                className="flex h-full w-full items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, oklch(0.78 0.08 ${hue}), oklch(0.68 0.12 ${hue}))`,
                }}
              >
                <span
                  className="select-none font-bold uppercase tracking-widest"
                  style={{ fontSize: 32, color: `oklch(0.52 0.10 ${hue})`, opacity: 0.7 }}
                >
                  {fileType || "?"}
                </span>
              </div>
            )}

            {/* File-type badge — top-left */}
            <span
              className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-white"
              style={{ background: tileColor }}
            >
              {fileType || "—"}
            </span>

            {/* No-preview badge — bottom-right */}
            {!hasPreview && (
              <span className="absolute bottom-1.5 right-1.5">
                <GlassBadge>no preview</GlassBadge>
              </span>
            )}

            {/* Selection overlay */}
            {selected && (
              <div className="pointer-events-none absolute inset-0" style={{ background: "var(--pd-primary, hsl(var(--primary))) / 0.10", opacity: 0.12, backgroundColor: "currentColor" }} />
            )}
          </div>

          {/* Meta section */}
          <div className="flex flex-col gap-1 p-2.5">
            {/* Filename */}
            <span
              className="truncate font-mono font-semibold leading-snug"
              style={{ fontSize: 13, color: "var(--pd-fg, hsl(var(--foreground)))" }}
              title={asset.filename}
            >
              {asset.filename}
            </span>

            {/* Licensor · Property */}
            {subtitle && (
              <span
                className="truncate leading-snug"
                style={{ fontSize: 12.5, color: "var(--pd-fg-muted, hsl(var(--muted-foreground)))" }}
                title={subtitle}
              >
                {subtitle}
              </span>
            )}

            {/* SKU + file size row */}
            <div className="flex items-center">
              {asset.sku && (
                <span
                  className="truncate font-mono"
                  style={{ fontSize: 11, color: "var(--pd-fg-subtle, hsl(var(--muted-foreground) / 0.7))" }}
                  title={asset.sku}
                >
                  {asset.sku}
                </span>
              )}
              {fileSizeStr && (
                <span
                  className="ml-auto shrink-0 pl-2"
                  style={{ fontSize: 12, color: "var(--pd-fg-muted, hsl(var(--muted-foreground)))" }}
                >
                  {fileSizeStr}
                </span>
              )}
            </div>
          </div>
        </button>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={handleCheckout} disabled={checkingOut}>
          {checkingOut
            ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            : <Download className="mr-2 h-3.5 w-3.5" />}
          Check Out &amp; Open
        </ContextMenuItem>
        {nasConfig && (
          <ContextMenuItem onClick={handleOpenFolder}>
            <FolderOpen className="mr-2 h-3.5 w-3.5" />
            Open Containing Folder
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => handleCopy(asset.relative_path, "relative path")}>
          <Copy className="mr-2 h-3.5 w-3.5" />
          Copy Relative Path
        </ContextMenuItem>
        {nasConfig && (() => {
          const paths = getPathDisplayModes(asset.relative_path, nasConfig, null);
          return (
            <ContextMenuItem onClick={() => handleCopy(paths.uncHost, "UNC path")}>
              <Copy className="mr-2 h-3.5 w-3.5" />
              Copy UNC Path
            </ContextMenuItem>
          );
        })()}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onOpenDetail}>
          <PanelRight className="mr-2 h-3.5 w-3.5" />
          View Details
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-[var(--pd-border,hsl(var(--border)))] bg-[var(--pd-surface,hsl(var(--card)))] animate-pulse">
      <div className="w-full bg-[hsl(var(--muted)/0.3)]" style={{ aspectRatio: "4/3" }} />
      <div className="flex flex-col gap-2 p-2.5">
        <div className="h-3.5 w-3/4 rounded bg-[hsl(var(--muted)/0.35)]" />
        <div className="h-3 w-1/2 rounded bg-[hsl(var(--muted)/0.25)]" />
        <div className="h-2.5 w-1/3 rounded bg-[hsl(var(--muted)/0.2)]" />
      </div>
    </div>
  );
}

export default function AssetGrid({ assets, selectedIds, onSelect, onOpenDetail, isLoading }: AssetGridProps) {
  const nasConfig = useNasConfig();

  if (isLoading && assets.length === 0) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(208px,1fr))] gap-3 p-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ImageOff className="mb-4 h-12 w-12 text-muted-foreground/30" />
        <p className="text-muted-foreground">No assets found</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(208px,1fr))] gap-3 p-4">
      {assets.map((asset) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          selected={selectedIds.has(asset.id)}
          onSelect={(e) => onSelect(asset.id, e)}
          onOpenDetail={() => onOpenDetail(asset.id)}
          nasConfig={nasConfig}
        />
      ))}
    </div>
  );
}
