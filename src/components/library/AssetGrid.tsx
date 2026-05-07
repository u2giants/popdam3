import { useQuery } from "@tanstack/react-query";
import type { Asset } from "@/types/assets";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ImageOff, Download, FolderOpen, Copy, PanelRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatFilename } from "@/lib/format-filename";
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
      return { host: map.NAS_HOST, ip: map.NAS_IP, share: map.NAS_SHARE } as NasConfig;
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onSelect}
          className={cn(
            "group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-all hover:border-primary/50 text-left",
            selected ? "border-primary ring-1 ring-primary" : "border-border",
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
              className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0 uppercase"
            >
              {asset.file_type}
            </Badge>

            {/* Licensed/Generic badge */}
            <Badge
              variant={asset.is_licensed ? "default" : "secondary"}
              className="absolute top-2 left-2 text-[10px] px-1.5 py-0"
            >
              {asset.is_licensed ? "Licensed" : "Generic"}
            </Badge>

            {selected && <div className="absolute inset-0 bg-primary/10" />}
          </div>

          {/* Info */}
          <div className="flex flex-col gap-1 p-2.5">
            <span className="truncate text-sm font-semibold leading-tight" title={asset.filename}>
              {formatFilename(asset.filename, 28)}
            </span>
            {asset.cover_description && (
              <span className="truncate text-[11px] text-muted-foreground italic" title={asset.cover_description}>
                {asset.cover_description}
              </span>
            )}
            {asset.sku && (
              <span className="truncate text-[11px] font-mono text-muted-foreground" title={asset.sku}>
                {asset.sku}
              </span>
            )}
            <div className="flex items-center gap-1.5">
              {asset.workflow_status && asset.workflow_status !== "other" && (
                <span className="rounded bg-tag px-1.5 py-0.5 text-[10px] text-tag-foreground capitalize">
                  {asset.workflow_status.replace(/_/g, " ")}
                </span>
              )}
            </div>
          </div>
        </button>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={handleCheckout} disabled={checkingOut}>
          {checkingOut
            ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            : <Download className="h-3.5 w-3.5 mr-2" />}
          Check Out &amp; Open
        </ContextMenuItem>
        {nasConfig && (
          <ContextMenuItem onClick={handleOpenFolder}>
            <FolderOpen className="h-3.5 w-3.5 mr-2" />
            Open Containing Folder
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => handleCopy(asset.relative_path, "relative path")}>
          <Copy className="h-3.5 w-3.5 mr-2" />
          Copy Relative Path
        </ContextMenuItem>
        {nasConfig && (() => {
          const paths = getPathDisplayModes(asset.relative_path, nasConfig, null);
          return (
            <ContextMenuItem onClick={() => handleCopy(paths.uncHost, "UNC path")}>
              <Copy className="h-3.5 w-3.5 mr-2" />
              Copy UNC Path
            </ContextMenuItem>
          );
        })()}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onOpenDetail}>
          <PanelRight className="h-3.5 w-3.5 mr-2" />
          View Details
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function AssetGrid({ assets, selectedIds, onSelect, onOpenDetail, isLoading }: AssetGridProps) {
  const nasConfig = useNasConfig();

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
          onOpenDetail={() => onOpenDetail(asset.id)}
          nasConfig={nasConfig}
        />
      ))}
    </div>
  );
}
