import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Asset } from "@/types/assets";
import { getPathDisplayModes, getUserSyncRoot, type NasConfig } from "@/lib/path-utils";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  X,
  Copy,
  Check,
  ImageOff,
  Sparkles,
  Clock,
  HardDrive,
  Tag,
  FileText,
  History,
  Loader2,
} from "lucide-react";
import { Constants } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

interface AssetDetailPanelProps {
  asset: Asset;
  onClose: () => void;
}

function CopyButton({ value, label }: { value: string; label: string }) {
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
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={copy}
      >
        {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
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

export default function AssetDetailPanel({ asset, onClose }: AssetDetailPanelProps) {
  const queryClient = useQueryClient();
  const [editingTags, setEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [aiTagging, setAiTagging] = useState(false);

  // Fetch NAS config for path display
  const { data: nasConfig } = useQuery({
    queryKey: ["nas-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_config")
        .select("key, value")
        .in("key", ["NAS_HOST", "NAS_IP", "NAS_SHARE"]);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        map[row.key] = typeof row.value === "string" ? row.value : String(row.value);
      }
      return {
        NAS_HOST: map.NAS_HOST ?? "nas",
        NAS_IP: map.NAS_IP ?? "0.0.0.0",
        NAS_SHARE: map.NAS_SHARE ?? "share",
      } as NasConfig;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch path history
  const { data: pathHistory } = useQuery({
    queryKey: ["path-history", asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_path_history")
        .select("*")
        .eq("asset_id", asset.id)
        .order("detected_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch related licensor/property names
  const { data: licensorName } = useQuery({
    queryKey: ["licensor-name", asset.licensor_id],
    queryFn: async () => {
      if (!asset.licensor_id) return null;
      const { data } = await supabase.from("licensors").select("name").eq("id", asset.licensor_id).single();
      return data?.name ?? null;
    },
    enabled: !!asset.licensor_id,
  });

  const { data: propertyName } = useQuery({
    queryKey: ["property-name", asset.property_id],
    queryFn: async () => {
      if (!asset.property_id) return null;
      const { data } = await supabase.from("properties").select("name").eq("id", asset.property_id).single();
      return data?.name ?? null;
    },
    enabled: !!asset.property_id,
  });

  // Update mutation
  const updateAsset = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { error } = await supabase.from("assets").update(updates).eq("id", asset.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      toast({ title: "Asset updated" });
    },
    onError: (e) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  // AI Tag
  const handleAiTag = async () => {
    setAiTagging(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-tag", {
        body: { assetId: asset.id },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      toast({ title: "AI tagging complete" });
    } catch (e: any) {
      toast({ title: "AI tagging failed", description: e.message, variant: "destructive" });
    } finally {
      setAiTagging(false);
    }
  };

  // Tags
  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag || asset.tags.includes(tag)) return;
    updateAsset.mutate({ tags: [...asset.tags, tag] });
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    updateAsset.mutate({ tags: asset.tags.filter((t) => t !== tag) });
  };

  const paths = nasConfig ? getPathDisplayModes(asset.relative_path, nasConfig, getUserSyncRoot()) : null;

  return (
    <div className="flex h-full w-[384px] flex-col border-l border-border bg-surface-overlay animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium truncate pr-2">{asset.filename}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          {/* Thumbnail */}
          <div className="aspect-[4/3] w-full rounded-lg bg-muted/30 overflow-hidden">
            {asset.thumbnail_url ? (
              <img src={asset.thumbnail_url} alt={asset.filename} className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <ImageOff className="h-12 w-12 text-muted-foreground/20" />
              </div>
            )}
          </div>

          {/* AI Tag button */}
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={handleAiTag}
            disabled={aiTagging || !asset.thumbnail_url}
          >
            {aiTagging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {aiTagging ? "Tagging…" : "AI Tag"}
          </Button>

          <Separator />

          {/* File info */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <FileText className="h-3.5 w-3.5" /> File Info
            </h4>
            <div className="space-y-1.5">
              <MetaRow label="Type" value={<Badge variant="secondary" className="text-[10px] uppercase">{asset.file_type}</Badge>} />
              <MetaRow label="Size" value={formatSize(asset.file_size)} />
              <MetaRow label="Dimensions" value={asset.width && asset.height ? `${asset.width} × ${asset.height}` : "—"} />
              <MetaRow label="Artboards" value={asset.artboards ?? 1} />
              <MetaRow label="Status" value={<span className="capitalize">{asset.status}</span>} />
              <MetaRow
                label="Workflow"
                value={
                  <Select
                    value={asset.workflow_status ?? "other"}
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
              <MetaRow label="Licensed" value={asset.is_licensed ? "Yes" : "No"} />
              <MetaRow label="Licensor" value={licensorName ?? "—"} />
              <MetaRow label="Property" value={propertyName ?? "—"} />
            </div>
          </section>

          <Separator />

          {/* Paths */}
          <section className="space-y-2.5">
            <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <HardDrive className="h-3.5 w-3.5" /> Paths
            </h4>
            <CopyButton label="Relative" value={asset.relative_path} />
            {paths && (
              <>
                <CopyButton label="Office UNC (hostname)" value={paths.uncHost} />
                <CopyButton label="Office UNC (IP)" value={paths.uncIp} />
                {paths.remote && <CopyButton label="Remote (Synology Drive)" value={paths.remote} />}
              </>
            )}
          </section>

          <Separator />

          {/* Tags */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Tag className="h-3.5 w-3.5" /> Tags
              </h4>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px]"
                onClick={() => setEditingTags(!editingTags)}
              >
                {editingTags ? "Done" : "Edit"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {asset.tags.length === 0 && (
                <span className="text-xs text-muted-foreground/50">No tags</span>
              )}
              {asset.tags.map((tag) => (
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
              <form
                onSubmit={(e) => { e.preventDefault(); addTag(); }}
                className="flex gap-1.5"
              >
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Add tag…"
                  className="h-7 text-xs bg-background"
                />
                <Button type="submit" size="sm" className="h-7 text-xs px-2">Add</Button>
              </form>
            )}
          </section>

          <Separator />

          {/* AI description */}
          {asset.ai_description && (
            <>
              <section className="space-y-1.5">
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">AI Description</h4>
                <p className="text-xs text-foreground/80 leading-relaxed">{asset.ai_description}</p>
              </section>
              <Separator />
            </>
          )}

          {asset.scene_description && (
            <>
              <section className="space-y-1.5">
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Scene Description</h4>
                <p className="text-xs text-foreground/80 leading-relaxed">{asset.scene_description}</p>
              </section>
              <Separator />
            </>
          )}

          {/* Dates */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> File Dates (from server)
            </h4>
            <div className="space-y-1.5">
              <MetaRow label="File Modified" value={format(new Date(asset.modified_at), "MMM d, yyyy HH:mm")} />
              <MetaRow label="File Created" value={asset.file_created_at ? format(new Date(asset.file_created_at), "MMM d, yyyy HH:mm") : "—"} />
            </div>
            <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">DAM Internal</p>
              <MetaRow label="Ingested" value={asset.ingested_at ? format(new Date(asset.ingested_at), "MMM d, yyyy HH:mm") : "—"} />
              <MetaRow label="Last Scanned" value={asset.last_seen_at ? format(new Date(asset.last_seen_at), "MMM d, yyyy HH:mm") : "—"} />
            </div>
          </section>

          <Separator />

          {/* Quick hash */}
          <section className="space-y-1.5">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Quick Hash</h4>
            <p className="text-[10px] font-mono text-muted-foreground break-all">{asset.quick_hash}</p>
            <p className="text-[10px] text-muted-foreground/50">v{asset.quick_hash_version}</p>
          </section>

          {/* Path history */}
          {pathHistory && pathHistory.length > 0 && (
            <>
              <Separator />
              <section className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <History className="h-3.5 w-3.5" /> Path History
                </h4>
                <div className="space-y-2">
                  {pathHistory.map((h) => (
                    <div key={h.id} className="rounded bg-muted/30 p-2 space-y-0.5">
                      <p className="text-[10px] text-muted-foreground">
                        {format(new Date(h.detected_at), "MMM d, yyyy HH:mm")}
                      </p>
                      <p className="text-[10px] font-mono line-through text-muted-foreground/60">{h.old_relative_path}</p>
                      <p className="text-[10px] font-mono text-foreground/80">{h.new_relative_path}</p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
