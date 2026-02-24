import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { StyleGroup } from "@/hooks/useStyleGroups";
import type { Asset } from "@/types/assets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import {
  X, ImageOff, Copy, Check, Star, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StyleGroupDetailPanelProps {
  group: StyleGroup;
  onClose: () => void;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={copy}>
      {copied ? <Check className="h-3 w-3 text-[hsl(var(--success))]" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value || value === "—") return null;
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs text-foreground text-right truncate">{value}</span>
    </div>
  );
}

export default function StyleGroupDetailPanel({ group, onClose }: StyleGroupDetailPanelProps) {
  const queryClient = useQueryClient();
  const [localPrimaryId, setLocalPrimaryId] = useState<string | null>(group.primary_asset_id);

  // Fetch all assets in this group
  const { data: groupAssets, isLoading: assetsLoading } = useQuery({
    queryKey: ["style-group-assets", group.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assets")
        .select("id, filename, file_type, workflow_status, thumbnail_url, relative_path, created_at")
        .eq("style_group_id", group.id)
        .eq("is_deleted", false)
        .order("filename");
      if (error) throw error;
      return (data ?? []) as Pick<Asset, "id" | "filename" | "file_type" | "workflow_status" | "thumbnail_url" | "relative_path" | "created_at">[];
    },
  });

  // Set cover mutation
  const setCover = useMutation({
    mutationFn: async (assetId: string) => {
      const { error } = await supabase
        .from("style_groups")
        .update({ primary_asset_id: assetId, updated_at: new Date().toISOString() })
        .eq("id", group.id);
      if (error) throw error;
    },
    onSuccess: (_data, assetId) => {
      setLocalPrimaryId(assetId);
      queryClient.invalidateQueries({ queryKey: ["style-groups"] });
      queryClient.invalidateQueries({ queryKey: ["style-group-assets", group.id] });
      toast({ title: "Cover image updated" });
    },
    onError: (e) => {
      toast({ title: "Failed to update cover", description: (e as Error).message, variant: "destructive" });
    },
  });

  // Derive thumbnail for display (optimistic from group assets if primary changes)
  const displayThumbnail = (() => {
    if (localPrimaryId && groupAssets) {
      const found = groupAssets.find((a) => a.id === localPrimaryId);
      if (found?.thumbnail_url) return found.thumbnail_url;
    }
    return group.thumbnail_url;
  })();

  return (
    <TooltipProvider>
      <div className="flex h-full w-[384px] flex-col border-l border-border bg-surface-overlay animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold truncate pr-2">{group.sku}</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            {/* Thumbnail */}
            <div className="aspect-[4/3] w-full rounded-lg bg-muted/30 overflow-hidden">
              {displayThumbnail ? (
                <img src={displayThumbnail} alt={group.sku} className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <ImageOff className="h-12 w-12 text-muted-foreground/20" />
                </div>
              )}
            </div>

            <Separator />

            {/* Metadata */}
            <section className="space-y-2">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Group Info</h4>
              <div className="space-y-1.5">
                <MetaRow label="SKU" value={group.sku} />
                <MetaRow label="Files" value={`${group.asset_count}`} />
                <MetaRow label="Licensed" value={group.is_licensed ? "Yes" : "No"} />
                <MetaRow label="Workflow" value={group.workflow_status !== "other" ? group.workflow_status?.replace(/_/g, " ") : null} />
                <MetaRow label="Licensor" value={group.licensor_name} />
                <MetaRow label="Property" value={group.property_name} />
                <MetaRow label="Division" value={group.division_name} />
                <MetaRow label="Category" value={group.product_category} />
                <MetaRow label="MG01" value={group.mg01_name ? `${group.mg01_code} — ${group.mg01_name}` : group.mg01_code} />
                <MetaRow label="MG02" value={group.mg02_name ? `${group.mg02_code} — ${group.mg02_name}` : group.mg02_code} />
                <MetaRow label="MG03" value={group.mg03_name ? `${group.mg03_code} — ${group.mg03_name}` : group.mg03_code} />
                <MetaRow label="Size" value={group.size_name ? `${group.size_code} — ${group.size_name}` : group.size_code} />
              </div>
            </section>

            <Separator />

            {/* Files in group */}
            <section className="space-y-2">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Files ({groupAssets?.length ?? "…"})
              </h4>

              {assetsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading files…
                </div>
              ) : (
                <div className="space-y-1">
                  {(groupAssets ?? []).map((asset) => {
                    const isCover = asset.id === localPrimaryId;
                    const hasThumb = !!asset.thumbnail_url;
                    return (
                      <div
                        key={asset.id}
                        className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
                      >
                        {/* Small thumbnail */}
                        <div className="h-10 w-10 shrink-0 rounded bg-muted/30 overflow-hidden">
                          {asset.thumbnail_url ? (
                            <img src={asset.thumbnail_url} alt={asset.filename} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <ImageOff className="h-4 w-4 text-muted-foreground/30" />
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <p className="text-xs font-medium truncate" title={asset.filename}>{asset.filename}</p>
                          <div className="flex items-center gap-1">
                            <Badge variant="secondary" className="text-[9px] uppercase px-1 py-0">{asset.file_type}</Badge>
                            {asset.workflow_status && asset.workflow_status !== "other" && (
                              <span className="rounded bg-tag px-1 py-0 text-[9px] text-tag-foreground capitalize">
                                {asset.workflow_status.replace(/_/g, " ")}
                              </span>
                            )}
                            {isCover && (
                              <Badge variant="default" className="text-[9px] px-1 py-0 gap-0.5">
                                <Star className="h-2.5 w-2.5 fill-current" /> Cover
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          {/* Copy path */}
                          <CopyButton value={asset.relative_path} />

                          {/* Set as cover */}
                          {!isCover && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => setCover.mutate(asset.id)}
                                  disabled={!hasThumb || setCover.isPending}
                                >
                                  <Star className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="text-xs">
                                {hasThumb ? "Set as cover" : "No thumbnail available"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <Separator />

            {/* Folder path */}
            <section className="space-y-1">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Folder</h4>
              <p className="text-[10px] font-mono text-muted-foreground break-all">{group.folder_path}</p>
            </section>
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}
