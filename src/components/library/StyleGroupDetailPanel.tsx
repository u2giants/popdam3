import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { StyleGroup } from "@/hooks/useStyleGroups";
import type { Asset } from "@/types/assets";
import { getPathDisplayModes, getUserSyncRoot, type NasConfig } from "@/lib/path-utils";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import {
  X, ImageOff, Copy, Check, Star, Loader2,
  ChevronLeft, ChevronRight, Sparkles, Clock,
  HardDrive, Tag, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Constants } from "@/integrations/supabase/types";

interface StyleGroupDetailPanelProps {
  group: StyleGroup;
  onClose: () => void;
}

/* ── Tiny helpers ─────────────────────────────────────────── */

function CopyInlineButton({ value }: { value: string }) {
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

function CopyPathRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="group flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <span className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</span>
        <p className="text-xs font-mono break-all text-foreground/80 mt-0.5">{value}</p>
      </div>
      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={copy}>
        {copied ? <Check className="h-3 w-3 text-[hsl(var(--success))]" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value || value === "—") return null;
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs text-foreground text-right truncate">{value ?? "—"}</span>
    </div>
  );
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Full-screen lightbox for viewing images */
function Lightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <img src={url} alt={alt} className="max-w-[90vw] max-h-[90vh] object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

/* ── Main component ───────────────────────────────────────── */

export default function StyleGroupDetailPanel({ group, onClose }: StyleGroupDetailPanelProps) {
  const queryClient = useQueryClient();
  const [localPrimaryId, setLocalPrimaryId] = useState<string | null>(group.primary_asset_id);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [aiTagging, setAiTagging] = useState(false);

  // Fetch all assets in this group
  const { data: groupAssets, isLoading: assetsLoading } = useQuery({
    queryKey: ["style-group-assets", group.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assets")
        .select("*")
        .eq("style_group_id", group.id)
        .eq("is_deleted", false)
        .order("filename");
      if (error) throw error;
      return (data ?? []) as Asset[];
    },
  });

  // NAS config for path display
  const { data: nasConfig } = useQuery({
    queryKey: ["nas-config"],
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_config")
        .select("key, value")
        .in("key", ["NAS_HOST", "NAS_IP", "NAS_SHARE"]);
      const map: Record<string, string> = {};
      for (const row of data ?? []) map[row.key] = typeof row.value === "string" ? row.value : String(row.value);
      return {
        NAS_HOST: map.NAS_HOST ?? "nas",
        NAS_IP: map.NAS_IP ?? "0.0.0.0",
        NAS_SHARE: map.NAS_SHARE ?? "share",
      } as NasConfig;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Thumbnailed assets for the carousel
  const thumbStrip = (groupAssets ?? []).filter((a) => !!a.thumbnail_url);

  // Keep carouselIndex in bounds
  useEffect(() => {
    if (thumbStrip.length > 0 && carouselIndex >= thumbStrip.length) {
      setCarouselIndex(thumbStrip.length - 1);
    }
  }, [thumbStrip.length, carouselIndex]);

  // When selectedAssetId changes, sync carouselIndex
  useEffect(() => {
    if (!selectedAssetId) return;
    const idx = thumbStrip.findIndex((a) => a.id === selectedAssetId);
    if (idx >= 0) setCarouselIndex(idx);
  }, [selectedAssetId, thumbStrip]);

  // Current asset from carousel
  const currentThumbAsset = thumbStrip[carouselIndex] ?? null;
  const displayThumbnail = currentThumbAsset?.thumbnail_url ?? group.thumbnail_url;

  // The asset to show detail for — prefer carousel asset, fallback to first asset
  const detailAsset = currentThumbAsset ?? groupAssets?.[0] ?? null;

  // Path display
  const paths = nasConfig && detailAsset
    ? getPathDisplayModes(detailAsset.relative_path, nasConfig, getUserSyncRoot())
    : null;

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

  // Update asset mutation
  const updateAsset = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      if (!detailAsset) return;
      const { error } = await supabase.from("assets").update(updates).eq("id", detailAsset.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["style-group-assets", group.id] });
      queryClient.invalidateQueries({ queryKey: ["style-groups"] });
      toast({ title: "Updated" });
    },
    onError: (e) => {
      toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" });
    },
  });

  // AI Tag
  const handleAiTag = async () => {
    if (!detailAsset) return;
    setAiTagging(true);
    try {
      const { error } = await supabase.functions.invoke("ai-tag", {
        body: { assetId: detailAsset.id },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["style-group-assets", group.id] });
      toast({ title: "AI tagging complete" });
    } catch (e: any) {
      toast({ title: "AI tagging failed", description: e.message, variant: "destructive" });
    } finally {
      setAiTagging(false);
    }
  };

  // Tags
  const addTag = () => {
    if (!detailAsset) return;
    const tag = tagInput.trim().toLowerCase();
    if (!tag || detailAsset.tags.includes(tag)) return;
    updateAsset.mutate({ tags: [...detailAsset.tags, tag] });
    setTagInput("");
  };
  const removeTag = (tag: string) => {
    if (!detailAsset) return;
    updateAsset.mutate({ tags: detailAsset.tags.filter((t) => t !== tag) });
  };

  // Reset tag editing when asset changes
  useEffect(() => {
    setEditingTags(false);
    setTagInput("");
  }, [detailAsset?.id]);

  return (
    <TooltipProvider>
      <div className="flex h-full w-[440px] flex-col border-l border-border bg-surface-overlay animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold truncate pr-2">{group.sku}</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            {/* ── Main preview image with carousel arrows ── */}
            <div
              className="relative aspect-[4/3] w-full rounded-lg bg-muted/30 overflow-hidden cursor-pointer"
              onClick={() => { if (displayThumbnail) setLightboxUrl(displayThumbnail); }}
            >
              {displayThumbnail ? (
                <img src={displayThumbnail} alt={group.sku} className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <ImageOff className="h-12 w-12 text-muted-foreground/20" />
                </div>
              )}

              {thumbStrip.length > 1 && (
                <>
                  <button
                    className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCarouselIndex((i) => (i === 0 ? thumbStrip.length - 1 : i - 1));
                    }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCarouselIndex((i) => (i === thumbStrip.length - 1 ? 0 : i + 1));
                    }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
                    {carouselIndex + 1} / {thumbStrip.length}
                  </div>
                </>
              )}
            </div>

            {/* Thumbnail strip */}
            {thumbStrip.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {thumbStrip.map((a, idx) => (
                  <button
                    key={a.id}
                    className={cn(
                      "h-10 w-10 shrink-0 rounded overflow-hidden border-2 transition-colors",
                      carouselIndex === idx
                        ? "border-primary"
                        : "border-transparent hover:border-muted-foreground/30",
                    )}
                    onClick={() => setCarouselIndex(idx)}
                  >
                    <img src={a.thumbnail_url!} alt={a.filename} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <Separator />

            {/* ── FILE INFO ── */}
            {detailAsset && (
              <>
                <section className="space-y-2">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" /> {detailAsset.filename}
                  </h4>
                  <div className="space-y-1.5">
                    <MetaRow label="Type" value={<Badge variant="secondary" className="text-[10px] uppercase">{detailAsset.file_type}</Badge>} />
                    <MetaRow label="Size" value={formatSize(detailAsset.file_size)} />
                    <MetaRow label="Dimensions" value={detailAsset.width && detailAsset.height ? `${detailAsset.width} × ${detailAsset.height}` : null} />
                    <MetaRow label="Artboards" value={detailAsset.artboards ?? 1} />
                    <MetaRow
                      label="Workflow"
                      value={
                        <Select
                          value={detailAsset.workflow_status ?? "other"}
                          onValueChange={(v) => updateAsset.mutate({ workflow_status: v })}
                        >
                          <SelectTrigger className="h-6 w-auto text-xs border-0 bg-transparent p-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Constants.public.Enums.workflow_status.map((ws) => (
                              <SelectItem key={ws} value={ws} className="capitalize text-xs">
                                {ws.replace(/_/g, " ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      }
                    />
                    <MetaRow label="Licensed" value={detailAsset.is_licensed ? "Yes" : "No"} />
                    <MetaRow label="Licensor" value={detailAsset.licensor_name} />
                    <MetaRow label="Property" value={detailAsset.property_name} />
                  </div>
                </section>

                <Separator />
              </>
            )}

            {/* ── GROUP INFO ── */}
            <section className="space-y-2">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Group Info</h4>
              <div className="space-y-1.5">
                <MetaRow label="SKU" value={group.sku} />
                <MetaRow label="Files" value={`${group.asset_count}`} />
                <MetaRow label="Division" value={group.division_name} />
                <MetaRow label="Category" value={group.product_category} />
                <MetaRow label="MG01" value={group.mg01_name ? `${group.mg01_code} — ${group.mg01_name}` : group.mg01_code} />
                <MetaRow label="MG02" value={group.mg02_name ? `${group.mg02_code} — ${group.mg02_name}` : group.mg02_code} />
                <MetaRow label="MG03" value={group.mg03_name ? `${group.mg03_code} — ${group.mg03_name}` : group.mg03_code} />
                <MetaRow label="Size" value={group.size_name ? `${group.size_code} — ${group.size_name}` : group.size_code} />
              </div>
            </section>

            {/* ── PATHS ── */}
            {detailAsset && (
              <>
                <Separator />
                <section className="space-y-2.5">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <HardDrive className="h-3.5 w-3.5" /> Paths
                  </h4>
                  <CopyPathRow label="Relative" value={detailAsset.relative_path} />
                  {paths && (
                    <>
                      <CopyPathRow label="Office UNC (hostname)" value={paths.uncHost} />
                      <CopyPathRow label="Office UNC (IP)" value={paths.uncIp} />
                      {paths.remote && <CopyPathRow label="Remote (Synology Drive)" value={paths.remote} />}
                    </>
                  )}
                </section>
              </>
            )}

            {/* ── TAGS ── */}
            {detailAsset && (
              <>
                <Separator />
                <section className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      <Tag className="h-3.5 w-3.5" /> Tags
                    </h4>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setEditingTags(!editingTags)}>
                      {editingTags ? "Done" : "Edit"}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {detailAsset.tags.length === 0 && (
                      <span className="text-xs text-muted-foreground/50">No tags</span>
                    )}
                    {detailAsset.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs bg-tag text-tag-foreground gap-1">
                        {tag}
                        {editingTags && (
                          <button onClick={() => removeTag(tag)} className="ml-0.5 hover:text-destructive">
                            <X className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </Badge>
                    ))}
                  </div>
                  {editingTags && (
                    <form onSubmit={(e) => { e.preventDefault(); addTag(); }} className="flex gap-1.5">
                      <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Add tag…" className="h-7 text-xs bg-background" />
                      <Button type="submit" size="sm" className="h-7 text-xs px-2">Add</Button>
                    </form>
                  )}
                </section>
              </>
            )}

            {/* ── AI ANALYSIS ── */}
            {detailAsset && (
              <>
                <Separator />
                <section className="space-y-2.5">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" /> AI Analysis
                  </h4>
                  {detailAsset.ai_description ? (
                    <div className="space-y-2">
                      <div>
                        <span className="text-[10px] uppercase text-muted-foreground tracking-wider">Description</span>
                        <p className="text-xs text-foreground/80 leading-relaxed mt-0.5">{detailAsset.ai_description}</p>
                      </div>
                      {detailAsset.scene_description && (
                        <div>
                          <span className="text-[10px] uppercase text-muted-foreground tracking-wider">Scene</span>
                          <p className="text-xs text-foreground/80 leading-relaxed mt-0.5">{detailAsset.scene_description}</p>
                        </div>
                      )}
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={handleAiTag} disabled={aiTagging || !detailAsset.thumbnail_url}>
                        {aiTagging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        {aiTagging ? "Re-tagging…" : "Re-tag"}
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-3 text-center space-y-2">
                      <p className="text-xs text-muted-foreground">No AI analysis yet</p>
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={handleAiTag} disabled={aiTagging || !detailAsset.thumbnail_url}>
                        {aiTagging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {aiTagging ? "Generating…" : "Generate AI Description"}
                      </Button>
                      {!detailAsset.thumbnail_url && (
                        <p className="text-[10px] text-muted-foreground/60">Requires a thumbnail first</p>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}

            {/* ── FILE DATES ── */}
            {detailAsset && (
              <>
                <Separator />
                <section className="space-y-2">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" /> File Dates
                  </h4>
                  <div className="space-y-1.5">
                    <MetaRow label="File Modified" value={format(new Date(detailAsset.modified_at), "MMM d, yyyy HH:mm")} />
                    <MetaRow label="File Created" value={detailAsset.file_created_at ? format(new Date(detailAsset.file_created_at), "MMM d, yyyy HH:mm") : null} />
                  </div>
                  <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">DAM Internal</p>
                    <MetaRow label="Ingested" value={detailAsset.ingested_at ? format(new Date(detailAsset.ingested_at), "MMM d, yyyy HH:mm") : null} />
                    <MetaRow label="Last Scanned" value={detailAsset.last_seen_at ? format(new Date(detailAsset.last_seen_at), "MMM d, yyyy HH:mm") : null} />
                  </div>
                </section>
              </>
            )}

            <Separator />

            {/* ── FILES IN GROUP ── */}
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
                    const thumbIdx = thumbStrip.findIndex((a) => a.id === asset.id);
                    const isViewing = thumbIdx >= 0 && thumbIdx === carouselIndex;
                    return (
                      <div
                        key={asset.id}
                        className={cn(
                          "group flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors",
                          isViewing
                            ? "bg-primary/10 border-l-2 border-primary"
                            : "hover:bg-muted/50",
                        )}
                        onClick={() => {
                          setSelectedAssetId(asset.id);
                          if (thumbIdx >= 0) setCarouselIndex(thumbIdx);
                        }}
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
                        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <CopyInlineButton value={asset.relative_path} />
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

      {/* Lightbox */}
      {lightboxUrl && (
        <Lightbox url={lightboxUrl} alt={group.sku} onClose={() => setLightboxUrl(null)} />
      )}
    </TooltipProvider>
  );
}
