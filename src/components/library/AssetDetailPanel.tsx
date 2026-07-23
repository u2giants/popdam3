import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Asset } from "@/types/assets";
import { getPathDisplayModes, getUserSyncRoot, setUserSyncRoot, type NasConfig } from "@/lib/path-utils";
import { getOpenFolderUri, buildOpenFolderUri, getPreferredPathMode, setPreferredPathMode, type PathMode } from "@/lib/open-folder";
import { formatFilename } from "@/lib/format-filename";
import { format } from "date-fns";
import { toast } from "sonner";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  X,
  Copy,
  Check,
  Sparkles,
  Clock,
  HardDrive,
  Tag,
  FileText,
  History,
  Loader2,
  FolderOpen,
  Settings2,
  ChevronRight,
  Download,
} from "lucide-react";
import { Constants } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import CheckoutBar from "@/components/library/CheckoutBar";

// ── File type colours (same palette as AssetGrid) ─────────────
const FILE_TYPE_COLOR: Record<string, string> = {
  psd: "oklch(0.42 0.18 260)",
  ai:  "oklch(0.62 0.18 42)",
  png: "oklch(0.5 0.15 155)",
  pdf: "oklch(0.55 0.2 20)",
  jpg: "oklch(0.5 0.13 210)",
  tif: "oklch(0.5 0.16 295)",
};
const FILE_TYPE_HUE: Record<string, number> = {
  psd: 260,
  ai: 42,
  png: 155,
  pdf: 20,
  jpg: 210,
  tif: 295,
};
const DEFAULT_COLOR = "oklch(0.55 0.08 250)";
const DEFAULT_HUE = 250;

function getTypeColor(ft: string): string {
  return FILE_TYPE_COLOR[ft.toLowerCase()] ?? DEFAULT_COLOR;
}
function getTypeHue(ft: string): number {
  return FILE_TYPE_HUE[ft.toLowerCase()] ?? DEFAULT_HUE;
}

// ── Helpers ────────────────────────────────────────────────────

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-xs shrink-0 w-24" style={{ color: "var(--pd-fg-muted)" }}>{label}</dt>
      <dd className="text-xs overflow-x-auto whitespace-nowrap scrollbar-thin" style={{ color: "var(--pd-fg)" }}>{children ?? "—"}</dd>
    </div>
  );
}

function CopyIconButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

function CopyPathRow({ label, value, folderUri }: { label: string; value: string; folderUri?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="group flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pd-fg-subtle)" }}>{label}</span>
        {folderUri ? (
          <a
            href={folderUri}
            className="block text-xs font-mono break-all mt-0.5 hover:underline cursor-pointer"
            style={{ color: "var(--pd-fg-muted)" }}
            title="Click to open containing folder"
          >
            {value}
          </a>
        ) : (
          <p className="text-xs font-mono break-all mt-0.5" style={{ color: "var(--pd-fg-muted)" }}>{value}</p>
        )}
      </div>
      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={copy}>
        {copied ? <Check className="h-3 w-3 text-[hsl(var(--success))]" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}

// Monogram thumbnail (tinted, same style as StyleGroupDetailPanel group badge)
function MonogramThumb({ text, size = 46, hue = 250 }: { text: string; size?: number; hue?: number }) {
  const initials = text
    .replace(/[^A-Za-z0-9\s-]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className="shrink-0 flex items-center justify-center rounded-[9px] font-bold text-white select-none"
      style={{
        width: size,
        height: size,
        background: `oklch(0.46 0.13 ${hue})`,
        fontSize: size * 0.32,
      }}
    >
      {initials || "?"}
    </div>
  );
}

interface AssetDetailPanelProps {
  asset: Asset;
  onClose: () => void;
  onOpenGroup?: (groupId: string) => void;
  /** Panel width in px (driven by the drag-to-resize handle). */
  width?: number;
}

/** Above this width the content reflows into two columns to use the space. */
const WIDE_THRESHOLD = 620;

export default function AssetDetailPanel({ asset, onClose, onOpenGroup, width = 408 }: AssetDetailPanelProps) {
  const wide = width >= WIDE_THRESHOLD;
  const queryClient = useQueryClient();
  const [editingTags, setEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [aiTagging, setAiTagging] = useState(false);
  const [pathMode, setPathModeState] = useState<PathMode>(getPreferredPathMode);
  const [syncRoot, setSyncRootState] = useState<string>(getUserSyncRoot() ?? "");
  const [copyingPath, setCopyingPath] = useState(false);

  const fileType = (asset.file_type ?? "").toLowerCase();
  const typeColor = getTypeColor(fileType);
  const typeHue = getTypeHue(fileType);

  // ── NAS config ──────────────────────────────────────────────
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

  // ── Path history ─────────────────────────────────────────────
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

  // ── Licensor / property names ─────────────────────────────────
  const { data: licensorName } = useQuery({
    queryKey: ["licensor-name", asset.licensor_id],
    queryFn: async () => {
      if (!asset.licensor_id) return null;
      const { data } = await (supabase as any).schema("core").from("licensor").select("name").eq("id", asset.licensor_id).single();
      return data?.name ?? null;
    },
    enabled: !!asset.licensor_id,
  });

  const { data: propertyName } = useQuery({
    queryKey: ["property-name", asset.property_id],
    queryFn: async () => {
      if (!asset.property_id) return null;
      const { data } = await (supabase as any).schema("core").from("property").select("name").eq("id", asset.property_id).single();
      return data?.name ?? null;
    },
    enabled: !!asset.property_id,
  });

  // ── Style group data (for "Belongs to" card) ─────────────────
  const styleGroupId = (asset as any).style_group_id as string | null | undefined;
  const { data: styleGroup } = useQuery({
    queryKey: ["style-group-brief", styleGroupId],
    queryFn: async () => {
      if (!styleGroupId) return null;
      const { data } = await (supabase as any)
        .from("style_groups")
        .select("id, sku, licensor_id, property_id, item_description")
        .eq("id", styleGroupId)
        .single();
      return data ?? null;
    },
    enabled: !!styleGroupId,
  });

  const { data: sgLicensorName } = useQuery({
    queryKey: ["licensor-name", styleGroup?.licensor_id],
    queryFn: async () => {
      if (!styleGroup?.licensor_id) return null;
      const { data } = await (supabase as any).schema("core").from("licensor").select("name").eq("id", styleGroup.licensor_id).single();
      return data?.name ?? null;
    },
    enabled: !!styleGroup?.licensor_id,
  });

  const { data: sgPropertyName } = useQuery({
    queryKey: ["property-name", styleGroup?.property_id],
    queryFn: async () => {
      if (!styleGroup?.property_id) return null;
      const { data } = await (supabase as any).schema("core").from("property").select("name").eq("id", styleGroup.property_id).single();
      return data?.name ?? null;
    },
    enabled: !!styleGroup?.property_id,
  });

  // ── Update mutation ───────────────────────────────────────────
  const updateAsset = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { data, error } = await supabase.from("assets").update(updates).eq("id", asset.id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Update was blocked — you may not have permission to edit this asset");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      toast("Asset updated");
    },
    onError: (e) => {
      toast.error("Update failed", { description: e.message });
    },
  });

  // ── AI tag ────────────────────────────────────────────────────
  const handleAiTag = async () => {
    setAiTagging(true);
    try {
      const opKey = `ai-tag-single-${asset.id}`;
      const now = new Date().toISOString();
      const { error } = await supabase.rpc("update_bulk_operation", {
        p_op_key: opKey,
        p_op_state: {
          status: "running",
          cursor: 0,
          params: { type: "bulk-ai-tag-all", asset_ids: [asset.id], total: 1 },
          started_at: now,
          updated_at: now,
          progress: { tagged: 0, skipped: 0, failed: 0, total: 1 },
        },
      });
      if (error) throw error;

      const maxWaitMs = 90_000;
      const pollMs = 2_000;
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        await new Promise((r) => setTimeout(r, pollMs));
        const { data: configRow } = await supabase
          .from("admin_config")
          .select("value")
          .eq("key", "BULK_OPERATIONS")
          .maybeSingle();
        const ops = configRow?.value as Record<string, any> | undefined;
        const op = ops?.[opKey];
        if (!op || op.status === "completed") {
          try {
            await supabase.rpc("update_bulk_operation", {
              p_op_key: opKey,
              p_op_state: { status: "idle" },
            });
          } catch { /* best-effort cleanup */ }
          queryClient.invalidateQueries({ queryKey: ["assets"] });
          queryClient.invalidateQueries({ queryKey: ["asset-tags", asset.id] });
          toast("AI tagging complete");
          return;
        }
        if (op.status === "failed" || op.status === "interrupted") {
          throw new Error(op.error || "AI tagging failed");
        }
      }
      toast("AI tagging is still running — check back shortly");
    } catch (e: any) {
      toast.error("AI tagging failed", { description: e.message });
    } finally {
      setAiTagging(false);
    }
  };

  // ── Tag provenance ────────────────────────────────────────────
  const { data: assetTags } = useQuery({
    queryKey: ["asset-tags", asset.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_tags")
        .select("id, tag, source, created_by")
        .eq("asset_id", asset.id)
        .order("tag");
      if (error) throw error;
      return data ?? [];
    },
  });

  const tagSourceMap = new Map<string, string>();
  for (const t of assetTags ?? []) {
    tagSourceMap.set(t.tag, t.source);
  }

  // ── Tag CRUD ──────────────────────────────────────────────────
  const addTag = async () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag || asset.tags.includes(tag)) return;
    const { data, error } = await supabase.from("asset_tags").upsert(
      { asset_id: asset.id, tag, source: "manual" },
      { onConflict: "asset_id,tag" }
    ).select("id");
    if (error) { toast.error("Failed to add tag", { description: error.message }); return; }
    if (!data || data.length === 0) { toast.error("Failed to add tag", { description: "Write was blocked — you may not have permission" }); return; }
    queryClient.invalidateQueries({ queryKey: ["assets"] });
    queryClient.invalidateQueries({ queryKey: ["asset-tags", asset.id] });
    setTagInput("");
  };

  const removeTag = async (tag: string) => {
    const { data, error } = await supabase.from("asset_tags").delete().eq("asset_id", asset.id).eq("tag", tag).select("id");
    if (error) { toast.error("Failed to remove tag", { description: error.message }); return; }
    if (!data || data.length === 0) { toast.error("Failed to remove tag", { description: "Write was blocked — you may not have permission" }); return; }
    queryClient.invalidateQueries({ queryKey: ["assets"] });
    queryClient.invalidateQueries({ queryKey: ["asset-tags", asset.id] });
  };

  // ── Paths ─────────────────────────────────────────────────────
  const paths = nasConfig ? getPathDisplayModes(asset.relative_path, nasConfig, getUserSyncRoot()) : null;
  const openFolderUri = nasConfig ? getOpenFolderUri(asset.relative_path, nasConfig, pathMode) : null;

  // ── Download (checkout) ───────────────────────────────────────
  const handleDownload = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("helper-api/tokens", {
        body: { action: "checkout", asset_id: asset.id },
      });
      if (error || !data?.ok) {
        toast.error("Could not create checkout link", { description: error?.message ?? data?.error });
        return;
      }
      window.location.href = data.url;
    } catch (e: unknown) {
      toast.error("Checkout failed", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  // ── Copy relative path ────────────────────────────────────────
  const handleCopyPath = async () => {
    setCopyingPath(true);
    await navigator.clipboard.writeText(asset.relative_path);
    setTimeout(() => setCopyingPath(false), 1500);
  };

  // ── Open containing folder ────────────────────────────────────
  const handleOpenFolder = () => {
    if (!openFolderUri) {
      toast.error("Cannot open folder", {
        description: pathMode === "synology_drive"
          ? "Set your Synology Drive sync root below (the gear icon)."
          : "NAS config missing.",
      });
      return;
    }
    const el = document.createElement("a");
    el.href = openFolderUri;
    el.rel = "noopener";
    el.style.display = "none";
    document.body.appendChild(el);
    el.click();
    setTimeout(() => el.remove(), 0);
  };

  // ── Version status ────────────────────────────────────────────
  const isCurrent = (asset as any).is_current_version !== false;

  // ── Render ────────────────────────────────────────────────────
  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-hidden border-l animate-in slide-in-from-right duration-200"
        style={{ width, borderColor: "var(--pd-border)", background: "var(--pd-surface)" }}>

        {/* ── Hero 16:10 ────────────────────────────────────────── */}
        <div className="relative w-full shrink-0" style={{ aspectRatio: "8/5", maxHeight: wide ? 300 : undefined }}>
          {asset.thumbnail_url ? (
            <img
              src={asset.thumbnail_url}
              alt={asset.filename}
              className="absolute inset-0 h-full w-full object-contain"
              style={{ background: "var(--pd-surface-2)" }}
            />
          ) : (
            /* Type-tinted placeholder */
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, oklch(0.22 0.07 ${typeHue}) 0%, oklch(0.16 0.05 ${typeHue}) 100%)`,
              }}
            >
              <span
                className="font-black uppercase tracking-widest select-none"
                style={{
                  fontSize: "clamp(28px, 8vw, 52px)",
                  color: `oklch(0.55 0.12 ${typeHue})`,
                  letterSpacing: "0.12em",
                }}
              >
                {fileType || "?"}
              </span>
            </div>
          )}

          {/* File type badge — top-left */}
          <div
            className="absolute top-3 left-3 flex items-center justify-center rounded-[9px] font-bold text-white text-[13px] leading-none uppercase tracking-wide select-none shadow-sm"
            style={{
              width: 38,
              height: 38,
              background: typeColor,
            }}
          >
            {fileType || "?"}
          </div>

          {/* Glass close button — top-right */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 flex items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{
              width: 32,
              height: 32,
              background: "rgba(0,0,0,0.45)",
              backdropFilter: "blur(6px)",
              color: "white",
              border: "none",
            }}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Title block ───────────────────────────────────────── */}
        <div className="shrink-0 px-4 py-3 border-b" style={{ borderColor: "var(--pd-border)" }}>
          <p
            className="font-mono font-bold leading-snug"
            style={{ fontSize: 16, wordBreak: "break-all", color: "var(--pd-fg)" }}
          >
            {asset.filename}
          </p>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {/* Version pill */}
            {isCurrent ? (
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: "var(--pd-success-soft)", color: "var(--pd-success, oklch(0.55 0.17 150))" }}
              >
                Current version
              </span>
            ) : (
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: "var(--pd-surface-3)", color: "var(--pd-fg-muted)" }}
              >
                Superseded
              </span>
            )}
            {/* Type · size */}
            <span
              className="uppercase tracking-wide"
              style={{ fontSize: 12.5, color: "var(--pd-fg-muted)" }}
            >
              {(asset.file_type ?? "").toUpperCase()}{asset.file_size ? ` · ${formatSize(asset.file_size)}` : ""}
            </span>

            {/* AI re-tag + checkout inline */}
            <div className="ml-auto flex items-center gap-1">
              <CheckoutBar assetId={asset.id} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={handleAiTag}
                    disabled={aiTagging || !asset.thumbnail_url}
                  >
                    {aiTagging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {aiTagging ? "Re-tagging…" : !asset.thumbnail_url ? "No thumbnail — cannot re-tag" : "Re-tag with AI"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* ── Scrollable content ────────────────────────────────── */}
        <div className="relative flex-1">
          <div className="absolute inset-0 overflow-y-auto">
            <div
              className={cn(
                "p-4",
                wide
                  ? "[column-count:2] [column-gap:1.25rem] [&>*]:mb-5 [&>*]:break-inside-avoid"
                  : "space-y-5",
              )}
            >

              {/* ── Belongs to style group card ─────────────────── */}
              {styleGroupId && styleGroup && (
                <button
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
                    onOpenGroup ? "cursor-pointer hover:translate-y-[-1px] hover:shadow-md" : "cursor-default"
                  )}
                  style={{
                    background: "var(--pd-surface-2)",
                    border: "1px solid var(--pd-border)",
                  }}
                  onClick={() => onOpenGroup && styleGroup && onOpenGroup(styleGroup.id)}
                  disabled={!onOpenGroup}
                >
                  <MonogramThumb text={styleGroup.sku ?? ""} size={46} hue={typeHue} />
                  <div className="flex-1 min-w-0">
                    <p
                      className="uppercase font-bold tracking-wider"
                      style={{ fontSize: 10.5, color: "var(--pd-fg-subtle)" }}
                    >
                      Belongs to style group
                    </p>
                    <p
                      className="font-mono font-bold mt-0.5 truncate"
                      style={{ fontSize: 13, color: "var(--pd-fg)" }}
                    >
                      {styleGroup.sku ?? "—"}
                    </p>
                    {(sgLicensorName || sgPropertyName) && (
                      <p
                        className="truncate mt-0.5"
                        style={{ fontSize: 12, color: "var(--pd-fg-muted)" }}
                      >
                        {[sgLicensorName, sgPropertyName].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  {onOpenGroup && <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--pd-fg-subtle)" }} />}
                </button>
              )}

              {/* ── File details ────────────────────────────────── */}
              <section className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--pd-fg-muted)" }}>
                  <FileText className="h-3.5 w-3.5" /> File Details
                </h4>
                <dl className="space-y-1.5">
                  <DlRow label="Type">
                    <Badge variant="secondary" className="text-[10px] uppercase">{asset.file_type ?? "—"}</Badge>
                  </DlRow>
                  <DlRow label="Size">{formatSize(asset.file_size)}</DlRow>
                  {asset.width && asset.height && (
                    <DlRow label="Dimensions">{asset.width} × {asset.height}</DlRow>
                  )}
                  {(asset as any).resolution && (
                    <DlRow label="Resolution">{(asset as any).resolution} dpi</DlRow>
                  )}
                  <DlRow label="Workflow">
                    <Select
                      value={asset.workflow_status ?? "other"}
                      onValueChange={(v) => updateAsset.mutate({ workflow_status: v })}
                    >
                      <SelectTrigger className="h-6 w-auto text-xs border-0 bg-transparent p-0 shadow-none focus:ring-0">
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
                  </DlRow>
                  {(asset as any).stage && <DlRow label="Stage">{(asset as any).stage}</DlRow>}
                  {(asset as any).customer && <DlRow label="Customer">{(asset as any).customer}</DlRow>}
                  {(asset as any).program && <DlRow label="Program">{(asset as any).program}</DlRow>}
                  {licensorName && <DlRow label="Licensor">{licensorName}</DlRow>}
                  {propertyName && <DlRow label="Property">{propertyName}</DlRow>}
                  <DlRow label="Modified">{format(new Date(asset.modified_at), "MMM d, yyyy")}</DlRow>
                  <DlRow label="Added">{asset.ingested_at ? format(new Date(asset.ingested_at), "MMM d, yyyy") : "—"}</DlRow>
                </dl>
              </section>

              {!wide && <Separator />}

              {/* ── Location / path block ────────────────────────── */}
              <section className="space-y-2.5">
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--pd-fg-muted)" }}>
                  <HardDrive className="h-3.5 w-3.5" /> Location
                </h4>

                {/* Path mode selector row */}
                {nasConfig && (
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7 flex-1" onClick={handleOpenFolder}>
                      <FolderOpen className="h-3 w-3" />
                      Open Containing Folder
                    </Button>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="icon" className="h-7 w-7 shrink-0">
                          <Settings2 className="h-3 w-3" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-3 space-y-3" align="end">
                        <p className="text-xs font-medium">Open Folder Settings</p>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">Path mode</Label>
                          <Select
                            value={pathMode}
                            onValueChange={(v) => {
                              setPathModeState(v as PathMode);
                              setPreferredPathMode(v as PathMode);
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unc_host" className="text-xs">Office — UNC hostname</SelectItem>
                              <SelectItem value="unc_ip" className="text-xs">Office — UNC IP address</SelectItem>
                              <SelectItem value="synology_drive" className="text-xs">Remote — Synology Drive (Mac/PC)</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[10px] text-muted-foreground">
                            {pathMode === "synology_drive"
                              ? "For designers working remotely via Synology Drive."
                              : "For designers on the office network."}
                          </p>
                        </div>
                        {pathMode === "synology_drive" && (
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">Your Synology Drive sync root</Label>
                            <Input
                              className="h-7 text-xs font-mono"
                              value={syncRoot}
                              onChange={(e) => setSyncRootState(e.target.value)}
                              onBlur={() => setUserSyncRoot(syncRoot)}
                              placeholder="/Users/you/Synology Drive"
                            />
                            <p className="text-[10px] text-muted-foreground">
                              The local folder where Synology Drive syncs files. Mac example: <span className="font-mono">/Users/you/Synology Drive</span>
                            </p>
                          </div>
                        )}
                        <p className="text-[10px] text-muted-foreground border-t pt-2">
                          Requires the <strong>PopDAM Helper</strong> app installed on this computer. Download it from Settings → Install Bundles.
                        </p>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}

                <CopyPathRow label="Relative" value={asset.relative_path} />
                {paths && (
                  <>
                    <CopyPathRow
                      label="Office UNC (hostname)"
                      value={paths.uncHost}
                      folderUri={buildOpenFolderUri(paths.uncHost.substring(0, Math.max(paths.uncHost.lastIndexOf("\\"), paths.uncHost.lastIndexOf("/"))))}
                    />
                    <CopyPathRow
                      label="Office UNC (IP)"
                      value={paths.uncIp}
                      folderUri={buildOpenFolderUri(paths.uncIp.substring(0, Math.max(paths.uncIp.lastIndexOf("\\"), paths.uncIp.lastIndexOf("/"))))}
                    />
                    {paths.remote && (
                      <CopyPathRow
                        label="Remote (Synology Drive)"
                        value={paths.remote}
                        folderUri={buildOpenFolderUri(paths.remote.substring(0, paths.remote.lastIndexOf("/")))}
                      />
                    )}
                  </>
                )}
              </section>

              {!wide && <Separator />}

              {/* ── Tags ─────────────────────────────────────────── */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--pd-fg-muted)" }}>
                    <Tag className="h-3.5 w-3.5" /> Tags
                  </h4>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setEditingTags(!editingTags)}>
                    {editingTags ? "Done" : "Edit"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {asset.tags.length === 0 && (
                    <span className="text-xs" style={{ color: "var(--pd-fg-subtle)" }}>No tags</span>
                  )}
                  {asset.tags.map((tag) => {
                    const source = tagSourceMap.get(tag);
                    const isAi = source === "ai";
                    return (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className={cn("text-xs gap-1", isAi ? "bg-tag text-tag-foreground" : "bg-accent text-accent-foreground")}
                        title={isAi ? `Added by AI${asset.ai_model ? ` (${asset.ai_model})` : ""}` : "Added manually"}
                      >
                        {isAi && <Sparkles className="h-2.5 w-2.5 opacity-60" />}
                        {tag}
                        {editingTags && (
                          <button onClick={() => removeTag(tag)} className="ml-0.5 hover:text-destructive">
                            <X className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </Badge>
                    );
                  })}
                </div>
                {editingTags && (
                  <form onSubmit={(e) => { e.preventDefault(); addTag(); }} className="flex gap-1.5">
                    <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Add tag…" className="h-7 text-xs bg-background" />
                    <Button type="submit" size="sm" className="h-7 text-xs px-2">Add</Button>
                  </form>
                )}
              </section>

              {!wide && <Separator />}

              {/* ── AI Analysis ──────────────────────────────────── */}
              <section className="space-y-2.5">
                <h4
                  className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider"
                  style={{ color: "var(--pd-fg-muted)" }}
                  title={asset.ai_model ? `Model: ${asset.ai_model}${asset.ai_tagged_at ? ` · Tagged ${format(new Date(asset.ai_tagged_at), "MMM d, yyyy HH:mm")}` : ""}` : undefined}
                >
                  <Sparkles className="h-3.5 w-3.5" /> AI Analysis
                  {asset.ai_model && (
                    <span className="normal-case font-normal tracking-normal text-[10px] truncate max-w-[120px]" title={asset.ai_model}>
                      {asset.ai_model.split("/").pop()}
                    </span>
                  )}
                </h4>
                {styleGroup?.item_description && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pd-fg-subtle)" }}>Product</span>
                    <p className="text-xs leading-relaxed mt-0.5" style={{ color: "var(--pd-fg-muted)" }}>{styleGroup.item_description}</p>
                  </div>
                )}
                {asset.ai_description ? (
                  <div className="space-y-2">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pd-fg-subtle)" }}>Description</span>
                      <p className="text-xs leading-relaxed mt-0.5" style={{ color: "var(--pd-fg-muted)" }}>{asset.ai_description}</p>
                    </div>
                    {asset.scene_description && (
                      <div>
                        <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pd-fg-subtle)" }}>Scene</span>
                        <p className="text-xs leading-relaxed mt-0.5" style={{ color: "var(--pd-fg-muted)" }}>{asset.scene_description}</p>
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] gap-1"
                      onClick={handleAiTag}
                      disabled={aiTagging || !asset.thumbnail_url}
                      title={aiTagging ? "Re-tagging in progress…" : !asset.thumbnail_url ? "Requires a thumbnail to run AI analysis" : undefined}
                    >
                      {aiTagging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      {aiTagging ? "Re-tagging…" : "Re-tag"}
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-3 text-center space-y-2" style={{ borderColor: "var(--pd-border)" }}>
                    <p className="text-xs" style={{ color: "var(--pd-fg-muted)" }}>No AI analysis yet</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={handleAiTag}
                      disabled={aiTagging || !asset.thumbnail_url}
                      title={aiTagging ? "Generating AI description…" : !asset.thumbnail_url ? "Requires a thumbnail to run AI analysis" : undefined}
                    >
                      {aiTagging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {aiTagging ? "Generating…" : "Generate AI Description"}
                    </Button>
                    {!asset.thumbnail_url && (
                      <p className="text-[10px]" style={{ color: "var(--pd-fg-subtle)" }}>Requires a thumbnail first</p>
                    )}
                  </div>
                )}
              </section>

              {!wide && <Separator />}

              {/* ── File dates ───────────────────────────────────── */}
              <section className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--pd-fg-muted)" }}>
                  <Clock className="h-3.5 w-3.5" /> File Dates (from server)
                </h4>
                <dl className="space-y-1.5">
                  <DlRow label="File Modified">{format(new Date(asset.modified_at), "MMM d, yyyy HH:mm")}</DlRow>
                  <DlRow label="File Created">{asset.file_created_at ? format(new Date(asset.file_created_at), "MMM d, yyyy HH:mm") : "—"}</DlRow>
                </dl>
                <div className="mt-2 pt-2 border-t space-y-1.5" style={{ borderColor: "var(--pd-border)" }}>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pd-fg-subtle)" }}>DAM Internal</p>
                  <dl className="space-y-1.5">
                    <DlRow label="Ingested">{asset.ingested_at ? format(new Date(asset.ingested_at), "MMM d, yyyy HH:mm") : "—"}</DlRow>
                    <DlRow label="Last Scanned">{asset.last_seen_at ? format(new Date(asset.last_seen_at), "MMM d, yyyy HH:mm") : "—"}</DlRow>
                  </dl>
                </div>
              </section>

              {!wide && <Separator />}

              {/* ── Quick hash ───────────────────────────────────── */}
              <section className="space-y-1.5">
                <h4 className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--pd-fg-muted)" }}>Quick Hash</h4>
                <p className="text-[10px] font-mono break-all" style={{ color: "var(--pd-fg-subtle)" }}>{asset.quick_hash}</p>
                <p className="text-[10px]" style={{ color: "var(--pd-fg-subtle)" }}>v{asset.quick_hash_version}</p>
              </section>

              {/* ── Path history ─────────────────────────────────── */}
              {pathHistory && pathHistory.length > 0 && (
                <>
                  {!wide && <Separator />}
                  <section className="space-y-2">
                    <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--pd-fg-muted)" }}>
                      <History className="h-3.5 w-3.5" /> Path History
                    </h4>
                    <div className="space-y-2">
                      {pathHistory.map((h) => (
                        <div key={h.id} className="rounded p-2 space-y-0.5" style={{ background: "var(--pd-surface-2)" }}>
                          <p className="text-[10px]" style={{ color: "var(--pd-fg-subtle)" }}>
                            {format(new Date(h.detected_at), "MMM d, yyyy HH:mm")}
                          </p>
                          <p className="text-[10px] font-mono line-through" style={{ color: "var(--pd-fg-subtle)" }}>{h.old_relative_path}</p>
                          <p className="text-[10px] font-mono" style={{ color: "var(--pd-fg-muted)" }}>{h.new_relative_path}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {/* bottom padding so content clears the sticky footer */}
              <div className="h-2" />
            </div>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────── */}
        <div
          className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-t"
          style={{ borderColor: "var(--pd-border)", background: "var(--pd-surface-2)" }}
        >
          {/* Download / checkout */}
          <Button
            className="flex-1 gap-2 font-semibold"
            onClick={handleDownload}
          >
            <Download className="h-4 w-4" />
            Download
          </Button>

          {/* Copy path */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={handleCopyPath}>
                {copyingPath ? <Check className="h-4 w-4 text-[hsl(var(--success))]" /> : <Copy className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{copyingPath ? "Copied!" : "Copy relative path"}</TooltipContent>
          </Tooltip>

          {/* Open folder */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={handleOpenFolder}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Open containing folder</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
