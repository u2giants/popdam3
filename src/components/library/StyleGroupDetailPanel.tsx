import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { StyleGroup } from "@/hooks/useStyleGroups";
import type { Asset } from "@/types/assets";
import { getPathDisplayModes, getUserSyncRoot, type NasConfig } from "@/lib/path-utils";
import { getOpenFolderUri, buildOpenFolderUri, getPreferredPathMode } from "@/lib/open-folder";
import { formatFilename } from "@/lib/format-filename";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useEffectiveAssetTags } from "@/hooks/useEffectiveAssetTags";
import { ScopedTagSections, type ScopedTagAction } from "@/components/library/ScopedTagSections";
import {
  X, ImageOff, Copy, Check, Star, Loader2,
  ChevronLeft, ChevronRight, Sparkles, Clock,
  HardDrive, Tag, FileText, FolderSearch, FolderOpen, Download,
  ClipboardList, Share2,
  Layers,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import CheckoutBar from "@/components/library/CheckoutBar";
import { cn } from "@/lib/utils";
import { useCompactChrome } from "@/hooks/use-compact-chrome";
import { Constants } from "@/integrations/supabase/types";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useIsAdmin } from "@/hooks/useIsAdmin";

interface StyleGroupDetailPanelProps {
  group: StyleGroup;
  onClose: () => void;
  /** Panel width in px (driven by the drag-to-resize handle). */
  width?: number;
}

/** Above this width the overview content reflows into two columns. */
const WIDE_THRESHOLD = 620;

/* ── Tiny helpers ─────────────────────────────────────────── */

function CopyInlineButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const btn = (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={copy}
    >
      {copied ? <Check className="h-3 w-3 text-[hsl(var(--success))]" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
  if (!label) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="top">{copied ? "Copied!" : `Copy ${label}`}</TooltipContent>
    </Tooltip>
  );
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, "MMM d, yyyy");
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
      <img
        src={url}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/* ── Section label ────────────────────────────────────────── */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-[700] uppercase tracking-widest text-[var(--pd-fg-subtle,hsl(var(--muted-foreground)/0.6))] mb-2">
      {children}
    </p>
  );
}

/* ── Rich product details (from tech-pack / licensing-sheet PDF extraction) ── */
function RichProductDetails({ rich }: { rich?: Record<string, unknown> | null }) {
  if (!rich || typeof rich !== "object") return null;
  const r = rich as Record<string, any>;
  const specs = (r.production_specs ?? {}) as Record<string, any>;
  const compliance = (r.compliance ?? {}) as Record<string, any>;

  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const colors = arr(
    (Array.isArray(r.colors) ? r.colors : []).map((c: any) => c?.pantone || c?.name).filter(Boolean),
  );

  const rows: Array<[string, React.ReactNode]> = [];
  const push = (label: string, value: React.ReactNode) => {
    if (value) rows.push([label, value]);
  };
  push("Dimensions", specs.dimensions);
  push("Materials", arr(specs.materials).join(", ") || null);
  push("Finish", arr(specs.finish).join(", ") || null);
  push("Hardware", arr(specs.hardware).join(", ") || null);
  push("Packaging", specs.packaging);
  push("Print process", specs.print_process);
  push("Colors", colors.join(", ") || null);
  push("Compliance", arr(compliance.regulatory).join(", ") || null);
  push("Age rating", compliance.age_rating);
  push("Origin", compliance.country_of_origin);
  push("Style guide ref", typeof r.style_guide_reference === "string" ? r.style_guide_reference : null);
  push("Approved", typeof r.approval_date === "string" ? r.approval_date : null);

  if (rows.length === 0) return null;

  return (
    <div>
      <SectionLabel>
        <span className="flex items-center gap-1.5"><FileText className="h-3 w-3" /> Product Details</span>
      </SectionLabel>
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[96px_1fr] gap-2 text-[12px]">
            <dt className="text-muted-foreground/70">{label}</dt>
            <dd className="text-foreground break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ── Details DL row ───────────────────────────────────────── */
function DlRow({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children || children === "—") return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <dt className="text-[12.5px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))] shrink-0">{label}</dt>
      <dd className="text-[13px] text-[var(--pd-fg,hsl(var(--foreground)))] text-right min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{children}</dd>
    </div>
  );
}

/* ── File type tile colors ─────────────────────────────────── */
function fileTypeTileClass(fileType: string): string {
  const t = (fileType ?? "").toLowerCase();
  if (t === "ai") return "bg-[#FF7900] text-white";
  if (t === "psd") return "bg-[#31A8FF] text-white";
  if (t === "pdf") return "bg-[#E13D34] text-white";
  if (t === "eps") return "bg-[#9B59B6] text-white";
  if (t === "png" || t === "jpg" || t === "jpeg" || t === "webp") return "bg-[#27AE60] text-white";
  if (t === "svg") return "bg-[#F39C12] text-white";
  return "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]";
}

/* ── Find Alternative Images component ────────────────────── */

interface SiblingImage {
  filename: string;
  relative_path: string;
  file_size: number;
  thumbnail_url?: string;
}

function FindAlternativeImages({ group, onIngested }: { group: StyleGroup; onIngested?: () => void }) {
  const { call } = useAdminApi();
  const [loading, setLoading] = useState(false);
  const [siblings, setSiblings] = useState<SiblingImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ingesting, setIngesting] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPolling(false);
    pollCountRef.current = 0;
  };

  const startPolling = (reqId: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollCountRef.current = 0;
    setPolling(true);
    setRequestId(reqId);

    pollTimerRef.current = setInterval(async () => {
      pollCountRef.current++;
      if (pollCountRef.current > 30) {
        stopPolling();
        setError("Scan timed out — the Bridge Agent may be offline. Try again later.");
        return;
      }
      try {
        const result = await call("get-sibling-scan-result", { request_id: reqId });
        if (result?.status === "completed") {
          stopPolling();
          const images = (result.images ?? []) as SiblingImage[];
          setSiblings(images);
          setSelected(new Set());
          if (images.length === 0) {
            toast("No alternative images found", { description: "No JPG, PNG, or eligible PDF files exist in this folder on the NAS." });
          } else {
            toast(`Found ${images.length} image${images.length !== 1 ? "s" : ""}`);
          }
        } else if (result?.status === "failed") {
          stopPolling();
          const msg = result.error_message || "Scan failed";
          setError(msg);
          toast.error("Folder scan failed", { description: msg });
        }
      } catch (e) {
        console.warn("Poll error:", (e as Error).message);
      }
    }, 5000);
  };

  useEffect(() => {
    if (initialLoaded || !group.folder_path) return;
    setInitialLoaded(true);
    (async () => {
      try {
        const result = await call("get-sibling-scan-by-folder", { folder_path: group.folder_path });
        if (!result?.found) return;
        if (result.status === "completed") {
          const images = (result.images ?? []) as SiblingImage[];
          setSiblings(images);
        } else if (result.status === "failed") {
          setError(result.error_message || "Previous scan failed");
        } else if (result.status === "pending") {
          startPolling(result.request_id as string);
        }
      } catch {
        // Non-fatal
      }
    })();
  }, [group.folder_path]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFind = async () => {
    setLoading(true);
    setError(null);
    setSiblings(null);
    setSelected(new Set());
    stopPolling();
    try {
      const result = await call("list-sibling-images", {
        folder_path: group.folder_path,
        style_group_id: group.id,
      });
      if (result?.status === "completed") {
        const images = (result.images ?? []) as SiblingImage[];
        setSiblings(images);
        if (images.length === 0) {
          toast("No alternative images found", { description: "No JPG, PNG, or eligible PDF files exist in this folder on the NAS." });
        }
      } else if (result?.status === "failed") {
        setError(result.error_message || "Scan failed");
      } else if (result?.status === "pending") {
        toast("Scan requested", { description: "The Bridge Agent will scan this folder shortly. Waiting for results…" });
        startPolling(result.request_id as string);
      }
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error("Failed to scan folder", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (!siblings) return;
    if (selected.size === siblings.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(siblings.map(s => s.relative_path)));
    }
  };

  const handleIngest = async () => {
    if (!siblings || selected.size === 0) return;
    setIngesting(true);
    try {
      const selectedImages = siblings.filter(s => selected.has(s.relative_path));
      const result = await call("ingest-sibling-images", {
        style_group_id: group.id,
        images: selectedImages,
      });
      const summary = result?.summary as { created: number; linked: number; errors: number } | undefined;
      if (summary) {
        const parts: string[] = [];
        if (summary.created > 0) parts.push(`${summary.created} added`);
        if (summary.linked > 0) parts.push(`${summary.linked} linked`);
        if (summary.errors > 0) parts.push(`${summary.errors} failed`);
        toast("Images ingested", { description: parts.join(", ") });
      } else {
        toast("Images ingested");
      }
      setSiblings(prev => prev?.filter(s => !selected.has(s.relative_path)) ?? null);
      setSelected(new Set());
      onIngested?.();
    } catch (e) {
      toast.error("Ingestion failed", { description: (e as Error).message });
    } finally {
      setIngesting(false);
    }
  };

  return (
    <section className="space-y-2.5 pt-4">
      <SectionLabel>
        <span className="flex items-center gap-1.5"><FolderSearch className="h-3 w-3" /> Alternative Images</span>
      </SectionLabel>
      <p className="text-[11px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))] leading-relaxed">
        Scan the NAS folder for sibling JPG, PNG, or eligible PDF files that could serve as product images.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs h-7"
        onClick={handleFind}
        disabled={loading || polling}
      >
        {loading || polling ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderSearch className="h-3 w-3" />}
        {loading ? "Scanning…" : polling ? "Waiting for results…" : siblings ? "Re-scan Folder" : "Find Sibling Files"}
      </Button>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {siblings && siblings.length > 0 && (
        <div className="space-y-2 rounded-lg border border-[var(--pd-border,hsl(var(--border)))] p-2 bg-[var(--pd-surface-2,hsl(var(--muted)/0.3))]">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))] font-medium">
              Found {siblings.length} image{siblings.length !== 1 ? "s" : ""}
            </p>
            <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={toggleAll}>
              {selected.size === siblings.length ? "Deselect All" : "Select All"}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {siblings.map((img) => {
              const isSelected = selected.has(img.relative_path);
              return (
                <div
                  key={img.relative_path}
                  className={cn(
                    "rounded-md border overflow-hidden bg-background cursor-pointer transition-colors",
                    isSelected ? "border-primary ring-1 ring-primary/30" : "border-border/50 hover:border-border"
                  )}
                  onClick={() => toggleSelect(img.relative_path)}
                >
                  {img.thumbnail_url ? (
                    <div className="aspect-square w-full bg-muted/30 overflow-hidden relative">
                      <img src={img.thumbnail_url} alt={img.filename} className="h-full w-full object-contain" loading="lazy" />
                      {isSelected && (
                        <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="aspect-square w-full bg-muted/30 flex items-center justify-center relative">
                      <ImageOff className="h-6 w-6 text-muted-foreground/20" />
                      {isSelected && (
                        <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  )}
                  <div className="p-1.5 space-y-0.5">
                    <p className="font-mono text-[10px] truncate" title={img.relative_path}>{img.filename}</p>
                    <p className="text-[9px] text-muted-foreground">
                      {img.file_size ? `${(img.file_size / 1024).toFixed(0)} KB` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          {selected.size > 0 && (
            <Button size="sm" className="w-full gap-1.5 text-xs h-7" onClick={handleIngest} disabled={ingesting}>
              {ingesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Add {selected.size} Image{selected.size !== 1 ? "s" : ""} to Group
            </Button>
          )}
        </div>
      )}

      {polling && (
        <div className="rounded-md border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.05)] p-2.5 space-y-1">
          <p className="text-[11px] text-[hsl(var(--warning))] font-medium flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Waiting for Bridge Agent…
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Scanning <span className="font-mono">{group.folder_path}</span> — typically 10–30 s.
          </p>
        </div>
      )}

      {siblings && siblings.length === 0 && !polling && (
        <p className="text-[11px] text-muted-foreground/60">No sibling files found in this folder.</p>
      )}
    </section>
  );
}

/* ── Tab type ─────────────────────────────────────────────── */
type Tab = "overview" | "files" | "activity";

/* ── Hue-based gradient for placeholder hero ─────────────── */
function skuToHue(sku: string): number {
  let h = 0;
  for (let i = 0; i < sku.length; i++) h = (h * 31 + sku.charCodeAt(i)) & 0xffffff;
  return h % 360;
}

/* ── Main component ───────────────────────────────────────── */

export default function StyleGroupDetailPanel({ group, onClose, width = 408 }: StyleGroupDetailPanelProps) {
  const wide = width >= WIDE_THRESHOLD;
  const compact = useCompactChrome();
  const queryClient = useQueryClient();
  const { call: adminApi } = useAdminApi();
  const { isAdmin } = useIsAdmin();
  const [localPrimaryId, setLocalPrimaryId] = useState<string | null>(group.primary_asset_id);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [aiTagging, setAiTagging] = useState(false);
  const [syncingTags, setSyncingTags] = useState(false);

  // Keep localPrimaryId in sync when the group prop changes
  useEffect(() => {
    setLocalPrimaryId(group.primary_asset_id);
  }, [group.primary_asset_id]);

  const ERP_MG_CUTOFF = "2025-05-14";

  const { data: erpItemData } = useQuery({
    queryKey: ["erp-item-data", group.sku],
    queryFn: async () => {
      const { data } = await supabase
        .from("erp_items_current")
        .select("erp_updated_at, item_description")
        .eq("style_number", group.sku)
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const isLegacyGroup = erpItemData?.erp_updated_at ? erpItemData.erp_updated_at < ERP_MG_CUTOFF : false;
  const erpDescription = erpItemData?.item_description ?? null;
  const itemDescription = group.item_description ?? erpDescription;

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

  const { data: styleGuideSources } = useQuery({
    queryKey: ["sku-files-used", group.sku],
    enabled: !!group.sku && group.is_licensed,
    queryFn: async () => {
      const { data } = await supabase
        .from("sku_files_used")
        .select("id, file_name, style_guide_file_id, style_guide_files(filename, licensor_name, property_folder)")
        .eq("sku", group.sku)
        .order("file_name");
      return (data ?? []) as unknown as Array<{
        id: string;
        file_name: string;
        style_guide_file_id: string | null;
        style_guide_files: { filename: string; licensor_name: string | null; property_folder: string | null } | null;
      }>;
    },
    staleTime: 2 * 60 * 1000,
  });

  const { data: productionOrders } = useQuery({
    queryKey: ["style-prod-orders", group.sku],
    enabled: !!group.sku,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("prod_order_headers_current")
        .select("id, prod_order_number, order_status, customer_name, quantity, due_date, order_date, erp_updated_at")
        .eq("style_number", group.sku)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("prod_order_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        prod_order_number: string;
        order_status: string | null;
        customer_name: string | null;
        quantity: number | null;
        due_date: string | null;
        order_date: string | null;
        erp_updated_at: string | null;
      }>;
    },
    staleTime: 2 * 60 * 1000,
  });

  // Thumbnailed assets for the carousel
  const thumbStrip = (groupAssets ?? []).filter((a) => !!a.thumbnail_url);

  useEffect(() => {
    if (thumbStrip.length > 0 && carouselIndex >= thumbStrip.length) {
      setCarouselIndex(thumbStrip.length - 1);
    }
  }, [thumbStrip.length, carouselIndex]);

  useEffect(() => {
    if (!selectedAssetId) return;
    const idx = thumbStrip.findIndex((a) => a.id === selectedAssetId);
    if (idx >= 0) setCarouselIndex(idx);
  }, [selectedAssetId, thumbStrip]);

  const currentThumbAsset = thumbStrip[carouselIndex] ?? null;
  const displayThumbnail = currentThumbAsset?.thumbnail_url ?? group.thumbnail_url;
  const detailAsset = currentThumbAsset ?? groupAssets?.[0] ?? null;

  const paths = nasConfig && detailAsset
    ? getPathDisplayModes(detailAsset.relative_path, nasConfig, getUserSyncRoot())
    : null;

  // Set cover mutation
  const setCover = useMutation({
    mutationFn: async (assetId: string) => {
      const { error } = await supabase.rpc("set_style_group_cover", {
        p_group_id: group.id,
        p_asset_id: assetId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, assetId) => {
      setLocalPrimaryId(assetId);
      queryClient.invalidateQueries({ queryKey: ["style-groups"] });
      queryClient.invalidateQueries({ queryKey: ["style-group-assets", group.id] });
      toast("Cover image updated");
    },
    onError: (e) => {
      toast.error("Failed to update cover", { description: (e as Error).message });
    },
  });

  // Update asset mutation
  const updateAsset = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      if (!detailAsset) return;
      const { data, error } = await supabase.from("assets").update(updates).eq("id", detailAsset.id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Update was blocked — you may not have permission to edit this asset");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["style-group-assets", group.id] });
      queryClient.invalidateQueries({ queryKey: ["style-groups"] });
      toast("Updated");
    },
    onError: (e) => {
      toast.error("Update failed", { description: (e as Error).message });
    },
  });

  // AI Tag
  const handleAiTag = async () => {
    if (!detailAsset) return;
    setAiTagging(true);
    try {
      const opKey = `ai-tag-single-${detailAsset.id}`;
      const now = new Date().toISOString();
      const { error } = await supabase.rpc("update_bulk_operation", {
        p_op_key: opKey,
        p_op_state: {
          status: "running",
          cursor: 0,
          params: { type: "bulk-ai-tag-all", asset_ids: [detailAsset.id], total: 1 },
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
          // Keep the completed operation record. Replacing it with {status:"idle"}
          // can erase a protected provider-job pointer and is refused by the
          // restart-safety database contract.
          queryClient.invalidateQueries({ queryKey: ["style-group-assets", group.id] });
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

  // ── Scoped metadata for the selected file ────────────────────────────
  // Both detail panels now write through the SAME normalized contract. This
  // panel used to mutate assets.tags directly, which bypassed provenance and
  // could silently overwrite a manual fact.
  const { data: effective, isLoading: effectiveLoading } = useEffectiveAssetTags(detailAsset?.id);
  const [tagBusy, setTagBusy] = useState(false);

  const handleTagAction: ScopedTagAction = async ({ scope, tag, action }) => {
    if (!detailAsset) return;
    setTagBusy(true);
    try {
      const payload: Record<string, unknown> = { scope, tag };
      if (scope === "asset") payload.asset_id = detailAsset.id;
      else payload.style_group_id = group.id;

      if (action === "add") await adminApi("add-scoped-tag", payload);
      else if (action === "remove") await adminApi("remove-scoped-tag", payload);
      else await adminApi("review-scoped-tag", { ...payload, decision: action });

      queryClient.invalidateQueries({ queryKey: ["effective-asset-tags", detailAsset.id] });
      queryClient.invalidateQueries({ queryKey: ["style-group-assets", group.id] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    } catch (e: unknown) {
      toast.error("Could not update tags", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setTagBusy(false);
    }
  };

  // Refreshes the group's own shared facts and its search entry. It deliberately
  // does NOT copy tags between files any more — that is what made a technical
  // drawing inherit a photograph's view and colours.
  const handleRefreshGroupMetadata = async () => {
    setSyncingTags(true);
    try {
      await adminApi("refresh-group-metadata", { group_id: group.id });
      queryClient.invalidateQueries({ queryKey: ["style-group-assets", group.id] });
      queryClient.invalidateQueries({ queryKey: ["style-groups"] });
      toast("Group metadata refreshed", {
        description: "Shared product facts and search were updated. Individual file tags were not changed.",
      });
    } catch (e: any) {
      toast.error("Refresh failed", { description: e.message });
    } finally {
      setSyncingTags(false);
    }
  };

  async function handleAssetCheckout(assetId: string) {
    try {
      const { data, error } = await supabase.functions.invoke("helper-api/tokens", {
        body: { action: "checkout", asset_id: assetId },
      });
      if (error || !data?.ok) {
        toast.error("Could not create checkout link", { description: error?.message ?? data?.error });
        return;
      }
      window.location.href = data.url;
    } catch (e: unknown) {
      toast.error("Checkout failed", { description: e instanceof Error ? e.message : String(e) });
    }
  }

  function handleOpenAssetFolder(a: Asset) {
    if (!nasConfig) return;
    const assetPaths = getPathDisplayModes(a.relative_path, nasConfig, null);
    const mode = getPreferredPathMode();
    const fullPath = mode === "unc_ip" ? assetPaths.uncIp : mode === "synology_drive" ? assetPaths.remote : assetPaths.uncHost;
    if (!fullPath) { toast.error("No path available for current path mode"); return; }
    const lastSep = Math.max(fullPath.lastIndexOf("\\"), fullPath.lastIndexOf("/"));
    const folder = fullPath.substring(0, lastSep);
    const el = document.createElement("a");
    el.href = buildOpenFolderUri(folder); el.rel = "noopener"; el.style.display = "none";
    document.body.appendChild(el); el.click(); setTimeout(() => el.remove(), 0);
  }

  async function handleCopyPath(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  }

  async function handleDownloadAll() {
    if (!groupAssets || groupAssets.length === 0) return;
    toast("Starting downloads…");
    for (const asset of groupAssets) {
      await handleAssetCheckout(asset.id);
    }
  }

  // Hero placeholder gradient hue
  const hue = skuToHue(group.sku);
  const heroInitials = group.sku.slice(0, 2).toUpperCase();

  // Category + stage label for hero
  const heroCategoryLabel = [group.product_category, group.stage].filter(Boolean).join(" · ");

  // WfTag label from detailAsset
  const wfStatus = detailAsset?.workflow_status;

  // Build "Category · Stage" for title block
  const titleSubline = [group.product_category, group.stage].filter(Boolean).join(" · ");

  return (
    <TooltipProvider>
      {/* Panel container */}
      <div
        className="flex flex-col overflow-hidden border-l border-[var(--pd-border,hsl(var(--border)))] bg-[var(--pd-surface,hsl(var(--background)))]"
        style={{
          width,
          height: "100%",
          // Slide-in animation via CSS custom property + inline style for compat
        }}
      >
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            .sgdp-panel {
              animation: sgdp-slide-in 0.26s cubic-bezier(.22,.61,.36,1) both;
            }
            @keyframes sgdp-slide-in {
              from { transform: translateX(100%); }
              to   { transform: translateX(0); }
            }
          }
        `}</style>
        <div className="sgdp-panel flex flex-col h-full overflow-hidden">

          {/* ── Hero (16:10) ──────────────────────────────────── */}
          <div
            className="relative flex-shrink-0 overflow-hidden cursor-pointer"
            style={{
              aspectRatio: "16/10",
              // On short screens a 16:10 hero eats the whole panel and the tab
              // content below never gets enough height to scroll. Cap it.
              maxHeight: compact ? "26vh" : undefined,
            }}
            onClick={() => { if (displayThumbnail) setLightboxUrl(displayThumbnail); }}
          >
            {displayThumbnail ? (
              <img src={displayThumbnail} alt={group.sku} className="h-full w-full object-contain bg-[var(--pd-surface-2,hsl(var(--muted)/0.5))]" />
            ) : (
              <div
                className="h-full w-full flex items-center justify-center text-white/60 text-3xl font-black select-none"
                style={{
                  background: `linear-gradient(135deg, hsl(${hue},55%,38%) 0%, hsl(${(hue + 40) % 360},45%,26%) 100%)`,
                }}
              >
                {heroInitials}
              </div>
            )}

            {/* Licensed / Generic badge — top-left */}
            <div className="absolute top-2 left-2">
              {group.is_licensed ? (
                <span className="rounded-md px-2 py-0.5 text-[10px] font-semibold bg-black/50 backdrop-blur-sm text-yellow-300 border border-yellow-400/30">
                  Licensed
                </span>
              ) : (
                <span className="rounded-md px-2 py-0.5 text-[10px] font-semibold bg-black/40 backdrop-blur-sm text-white/75 border border-white/15">
                  Generic
                </span>
              )}
            </div>

            {/* Close button — top-right */}
            <button
              className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/45 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white hover:bg-black/65 transition-colors"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            {/* Category label — bottom-left */}
            {heroCategoryLabel && (
              <div className="absolute bottom-2 left-2">
                <span className="rounded-md px-2 py-0.5 text-[10px] font-medium bg-black/45 backdrop-blur-sm text-white/90 border border-white/10">
                  {heroCategoryLabel}
                </span>
              </div>
            )}

            {/* Carousel arrows — only if multiple thumbnails */}
            {thumbStrip.length > 1 && (
              <>
                <button
                  className="absolute left-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedAssetId(null);
                    setCarouselIndex((i) => (i === 0 ? thumbStrip.length - 1 : i - 1));
                  }}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedAssetId(null);
                    setCarouselIndex((i) => (i === thumbStrip.length - 1 ? 0 : i + 1));
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <div className="absolute bottom-2 right-2 rounded-full bg-black/50 backdrop-blur-sm px-2 py-0.5 text-[10px] text-white">
                  {carouselIndex + 1}/{thumbStrip.length}
                </div>
              </>
            )}
          </div>

          {/* Thumbnail strip */}
          {thumbStrip.length > 1 && (
            <div className={cn(
              "flex gap-1 overflow-x-auto px-3 bg-[var(--pd-surface-2,hsl(var(--muted)/0.3))] border-b border-[var(--pd-border,hsl(var(--border)))]",
              compact ? "py-1" : "py-1.5",
            )}>
              {thumbStrip.map((a, idx) => (
                <button
                  key={a.id}
                  className={cn(
                    "shrink-0 rounded overflow-hidden border-2 transition-colors",
                    compact ? "h-7 w-7" : "h-9 w-9",
                    carouselIndex === idx ? "border-primary" : "border-transparent hover:border-muted-foreground/30"
                  )}
                  onClick={() => { setSelectedAssetId(null); setCarouselIndex(idx); }}
                >
                  <img src={a.thumbnail_url!} alt={a.filename} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* ── Title block ───────────────────────────────────── */}
          <div className={cn(
            "flex-shrink-0 px-4 border-b border-[var(--pd-border,hsl(var(--border)))]",
            compact ? "pt-1.5 pb-1.5" : "pt-3 pb-2",
          )}>
            <div className="flex items-start justify-between gap-2">
              <div className={cn("min-w-0 flex-1", compact ? "space-y-0" : "space-y-0.5")}>
                {/* Mono SKU */}
                <p className={cn(
                  "font-mono font-[600] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))] tracking-tight",
                  compact ? "text-[11px]" : "text-[13px]",
                )}>
                  {group.sku}
                </p>
                {/* Property name / ERP description */}
                <p className={cn(
                  "font-[800] text-[var(--pd-fg,hsl(var(--foreground)))] leading-tight truncate",
                  compact ? "text-[15px]" : "text-[19px]",
                )}>
                  {itemDescription ?? group.sku}
                </p>
                {/* WfTag + Category · Stage */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {wfStatus && wfStatus !== "other" && (
                    <span className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[11px] font-medium capitalize text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))]">
                      {wfStatus.replace(/_/g, " ")}
                    </span>
                  )}
                  {titleSubline && (
                    <span className="text-[12.5px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))]">
                      {titleSubline}
                    </span>
                  )}
                </div>
              </div>
              {/* AI tag + checkout bar */}
              <div className="flex items-center gap-1 shrink-0 mt-0.5">
                <CheckoutBar assetId={detailAsset?.id} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={handleAiTag}
                      disabled={aiTagging || !detailAsset?.thumbnail_url}
                    >
                      {aiTagging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {aiTagging ? "Re-tagging…" : !detailAsset?.thumbnail_url ? "No thumbnail — cannot re-tag" : "Re-tag with AI"}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* ── Sticky tabs ───────────────────────────────────── */}
          <div className="flex-shrink-0 sticky top-0 z-10 border-b border-[var(--pd-border,hsl(var(--border)))] bg-[var(--pd-surface,hsl(var(--background)))]/80 backdrop-blur-md">
            <div className="flex">
              {(["overview", "files", "activity"] as Tab[]).map((tab) => {
                const label =
                  tab === "overview" ? "Overview" :
                  tab === "files" ? `Files${groupAssets ? ` · ${groupAssets.length}` : ""}` :
                  "Activity";
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "text-[13px] transition-colors relative whitespace-nowrap",
                      compact ? "px-3 py-1.5" : "px-4 py-2.5",
                      isActive
                        ? "font-[600] text-[var(--pd-fg,hsl(var(--foreground)))]"
                        : "font-[400] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))] hover:text-[var(--pd-fg,hsl(var(--foreground)))]"
                    )}
                  >
                    {label}
                    {isActive && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--pd-accent,hsl(var(--primary)))] rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Scrollable tab content ───────────────────────── */}
          <div className="flex-1 overflow-y-auto">

            {/* ===== OVERVIEW TAB ===== */}
            {activeTab === "overview" && (
              <div
                className={cn(
                  "p-4",
                  wide
                    ? "[column-count:2] [column-gap:1.25rem] [&>*]:mb-5 [&>*]:break-inside-avoid"
                    : "space-y-5",
                )}
              >

                {/* DETAILS */}
                <div>
                  <SectionLabel>Details</SectionLabel>
                  <dl className="space-y-0.5">
                    <DlRow label="SKU">{group.sku}</DlRow>
                    <DlRow label="Licensor">{detailAsset?.licensor_name ?? (group.is_licensed ? "—" : null)}</DlRow>
                    <DlRow label="Property">{detailAsset?.property_name ?? null}</DlRow>
                    <DlRow label="Customer">{group.customer}</DlRow>
                    <DlRow label="Program">{group.program}</DlRow>
                    <DlRow label="Division">{group.division_name}</DlRow>
                    <DlRow label="Category">{group.product_category}</DlRow>
                    <DlRow label="Stage">{group.stage}</DlRow>
                    {!isLegacyGroup && (
                      <>
                        <DlRow label="MG01">{group.mg01_name ? `${group.mg01_code} — ${group.mg01_name}` : group.mg01_code}</DlRow>
                        <DlRow label="MG02">{group.mg02_name ? `${group.mg02_code} — ${group.mg02_name}` : group.mg02_code}</DlRow>
                        <DlRow label="MG03">{group.mg03_name ? `${group.mg03_code} — ${group.mg03_name}` : group.mg03_code}</DlRow>
                      </>
                    )}
                    <DlRow label="Size">{group.size_name ? `${group.size_code} — ${group.size_name}` : group.size_code}</DlRow>
                    {(group as any).designer_name && <DlRow label="Designer">{(group as any).designer_name}</DlRow>}
                    {(group as any).technical_designer_name && <DlRow label="Tech Designer">{(group as any).technical_designer_name}</DlRow>}
                    {(group as any).freelancer_name && <DlRow label="Freelancer">{(group as any).freelancer_name}</DlRow>}
                    {detailAsset && (
                      <>
                        <DlRow label="Modified">{formatDateValue(detailAsset.modified_at)}</DlRow>
                        <DlRow label="Created">{formatDateValue(detailAsset.file_created_at)}</DlRow>
                      </>
                    )}
                  </dl>
                </div>

                {/* Designer conflict warning */}
                {(group as any).designer_conflict && (
                  <div className="rounded-md border border-[hsl(var(--warning)/0.5)] bg-[hsl(var(--warning)/0.08)] px-3 py-2">
                    <p className="text-[11px] text-[hsl(var(--warning))] font-semibold">Designer Conflict</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                      Files in this group have different designer names. Review individual files to resolve.
                    </p>
                  </div>
                )}

                {/* Workflow status editable */}
                {detailAsset && (
                  <div>
                    <SectionLabel>Workflow</SectionLabel>
                    <Select
                      value={detailAsset.workflow_status ?? "other"}
                      onValueChange={(v) => updateAsset.mutate({ workflow_status: v })}
                    >
                      <SelectTrigger className="h-8 text-[13px] w-full">
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
                  </div>
                )}

                {/* LOCATION */}
                {detailAsset && (
                  <div>
                    <SectionLabel>Location</SectionLabel>
                    <div className="rounded-lg border border-[var(--pd-border,hsl(var(--border)))] bg-[var(--pd-surface-2,hsl(var(--muted)/0.3))] p-2.5">
                      <p
                        className="font-mono text-[11.5px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))]"
                        style={{ wordBreak: "break-all" }}
                      >
                        {detailAsset.relative_path}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {nasConfig && (
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7 w-full" asChild>
                          <a
                            href={getOpenFolderUri(detailAsset.relative_path, nasConfig) ?? "#"}
                            onClick={(e) => {
                              if (!getOpenFolderUri(detailAsset.relative_path, nasConfig)) {
                                e.preventDefault();
                                toast.error("Cannot open folder", { description: "Set your Synology Drive root in Settings → Path Tester if using remote mode." });
                              }
                            }}
                          >
                            <FolderOpen className="h-3 w-3" />
                            Open Containing Folder
                          </a>
                        </Button>
                      )}
                      {paths && (
                        <div className="space-y-1.5 mt-1">
                          <div className="group flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] uppercase text-muted-foreground tracking-wider">UNC (hostname)</p>
                              <p className="text-[11.5px] font-mono break-all text-foreground/80 mt-0.5">{paths.uncHost}</p>
                            </div>
                            <Button
                              variant="ghost" size="icon"
                              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-3"
                              onClick={() => handleCopyPath(paths.uncHost, "UNC path")}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="group flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] uppercase text-muted-foreground tracking-wider">UNC (IP)</p>
                              <p className="text-[11.5px] font-mono break-all text-foreground/80 mt-0.5">{paths.uncIp}</p>
                            </div>
                            <Button
                              variant="ghost" size="icon"
                              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-3"
                              onClick={() => handleCopyPath(paths.uncIp, "UNC IP path")}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          {paths.remote && (
                            <div className="group flex items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Synology Drive</p>
                                <p className="text-[11.5px] font-mono break-all text-foreground/80 mt-0.5">{paths.remote}</p>
                              </div>
                              <Button
                                variant="ghost" size="icon"
                                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-3"
                                onClick={() => handleCopyPath(paths.remote!, "Synology Drive path")}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAGS — Style Group facts and this file's own facts, kept apart */}
                {detailAsset && (
                  <div>
                    <SectionLabel><span className="flex items-center gap-1.5"><Tag className="h-3 w-3" /> Tags</span></SectionLabel>
                    {effectiveLoading && <span className="text-[12px] text-muted-foreground/50">Loading tags…</span>}
                    {effective && (
                      <ScopedTagSections
                        groupTags={effective.groupTags}
                        groupCandidates={effective.groupCandidates}
                        assetTags={effective.assetTags}
                        assetCandidates={effective.assetCandidates}
                        rejected={effective.rejected}
                        hasStyleGroup
                        editing
                        busy={tagBusy}
                        onAction={handleTagAction}
                        canReview={isAdmin}
                        canEditGroup={isAdmin}
                        visualAnalysisUnavailable={!detailAsset.thumbnail_url && effective.assetTags.length === 0}
                      />
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs w-full mt-2"
                      onClick={handleRefreshGroupMetadata}
                      disabled={syncingTags}
                      title="Updates this group's shared product facts and search entry. Individual file tags are left alone."
                    >
                      {syncingTags ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Tag className="h-3 w-3 mr-1" />}
                      Refresh Group Metadata
                    </Button>
                  </div>
                )}

                {/* GROUP ARTWORK SUMMARY — a product-level fact, distinct from
                    the per-file AI analysis directly below it. */}
                {(group as { group_ai_description?: string | null }).group_ai_description && (
                  <div>
                    <SectionLabel>
                      <span
                        className="flex items-center gap-1.5"
                        title={`Source: ${(group as { group_ai_description_source?: string | null }).group_ai_description_source ?? "unknown"}${
                          (group as { group_ai_description_model?: string | null }).group_ai_description_model
                            ? ` · Model: ${(group as { group_ai_description_model?: string | null }).group_ai_description_model}`
                            : ""
                        }`}
                      >
                        <Layers className="h-3 w-3" /> Group Artwork Summary
                      </span>
                    </SectionLabel>
                    <p className="text-[12px] text-foreground/80 leading-relaxed">
                      {(group as { group_ai_description?: string | null }).group_ai_description}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Describes the whole product, built from several representative files. It is not a
                      description of the file selected above.
                    </p>
                  </div>
                )}

                {/* AI ANALYSIS — this file only */}
                {detailAsset && (
                  <div>
                    <SectionLabel>
                      <span
                        className="flex items-center gap-1.5"
                        title={(detailAsset as any).ai_model ? `Model: ${(detailAsset as any).ai_model}${(detailAsset as any).ai_tagged_at ? ` · Tagged ${format(new Date((detailAsset as any).ai_tagged_at), "MMM d, yyyy HH:mm")}` : ""}` : undefined}
                      >
                        <Sparkles className="h-3 w-3" /> AI Analysis · This file
                        {(detailAsset as any).ai_model && (
                          <span className="normal-case font-normal tracking-normal text-[10px] truncate max-w-[120px]" title={(detailAsset as any).ai_model}>
                            {(detailAsset as any).ai_model.split("/").pop()}
                          </span>
                        )}
                      </span>
                    </SectionLabel>
                    {detailAsset.ai_description ? (
                      <div className="space-y-2">
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground tracking-wider mb-0.5">Description</p>
                          <p className="text-[12px] text-foreground/80 leading-relaxed">{detailAsset.ai_description}</p>
                        </div>
                        {detailAsset.scene_description && (
                          <div>
                            <p className="text-[10px] uppercase text-muted-foreground tracking-wider mb-0.5">Scene</p>
                            <p className="text-[12px] text-foreground/80 leading-relaxed">{detailAsset.scene_description}</p>
                          </div>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] gap-1"
                          onClick={handleAiTag}
                          disabled={aiTagging || !detailAsset.thumbnail_url}
                        >
                          {aiTagging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          {aiTagging ? "Re-tagging…" : "Re-tag"}
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border p-3 text-center space-y-2">
                        <p className="text-[12px] text-muted-foreground">No AI analysis yet</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={handleAiTag}
                          disabled={aiTagging || !detailAsset.thumbnail_url}
                        >
                          {aiTagging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          {aiTagging ? "Generating…" : "Generate AI Description"}
                        </Button>
                        {!detailAsset.thumbnail_url && (
                          <p className="text-[10px] text-muted-foreground/60">Requires a thumbnail first</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* FILE DATES */}
                {detailAsset && (
                  <div>
                    <SectionLabel><span className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> File Dates</span></SectionLabel>
                    <dl className="space-y-0.5">
                      <DlRow label="Modified">{format(new Date(detailAsset.modified_at), "MMM d, yyyy HH:mm")}</DlRow>
                      <DlRow label="Created">{detailAsset.file_created_at ? format(new Date(detailAsset.file_created_at), "MMM d, yyyy HH:mm") : null}</DlRow>
                    </dl>
                    <div className="mt-2 pt-2 border-t border-[var(--pd-border,hsl(var(--border)/0.5))]">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">DAM Internal</p>
                      <dl className="space-y-0.5">
                        <DlRow label="Ingested">{detailAsset.ingested_at ? format(new Date(detailAsset.ingested_at), "MMM d, yyyy HH:mm") : null}</DlRow>
                        <DlRow label="Last Scanned">{detailAsset.last_seen_at ? format(new Date(detailAsset.last_seen_at), "MMM d, yyyy HH:mm") : null}</DlRow>
                        <DlRow label="AI Tagged">{(detailAsset as any).ai_tagged_at ? format(new Date((detailAsset as any).ai_tagged_at), "MMM d, yyyy HH:mm") : "Not tagged"}</DlRow>
                      </dl>
                    </div>
                  </div>
                )}

                {/* PRODUCTION POs */}
                <div>
                  <SectionLabel>
                    <span className="flex items-center gap-1.5"><ClipboardList className="h-3 w-3" /> Production POs</span>
                  </SectionLabel>
                  {!productionOrders || productionOrders.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground/50">No production POs recorded for this SKU</p>
                  ) : (
                    <div className="space-y-2">
                      {productionOrders.map((order) => (
                        <div
                          key={order.id}
                          className="rounded-lg border border-[var(--pd-border,hsl(var(--border)))] px-3 py-2 text-[13px]"
                        >
                          <div className="group flex items-center gap-2">
                            <span className="font-mono font-semibold text-foreground">{order.prod_order_number}</span>
                            <CopyInlineButton value={order.prod_order_number} label="production PO" />
                            {order.order_status && (
                              <Badge variant="outline" className="ml-auto h-4 text-[10px]">
                                {order.order_status}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground/75">
                            {order.customer_name && <span>{order.customer_name}</span>}
                            {order.quantity !== null && <span>Qty {Number(order.quantity).toLocaleString()}</span>}
                            {formatDateValue(order.due_date) && <span>Due {formatDateValue(order.due_date)}</span>}
                            {formatDateValue(order.order_date) && <span>Ordered {formatDateValue(order.order_date)}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* STYLE GUIDE SOURCES */}
                {group.is_licensed && (
                  <div>
                    <SectionLabel>
                      <span className="flex items-center gap-1.5"><FileText className="h-3 w-3" /> Style Guide Sources</span>
                    </SectionLabel>
                    {!styleGuideSources || styleGuideSources.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground/50">No style guide files recorded for this SKU</p>
                    ) : (
                      <div className="space-y-2">
                        {styleGuideSources.map((row) => (
                          <div key={row.id} className="text-[12px]">
                            {row.style_guide_file_id && row.style_guide_files ? (
                              <div>
                                <p className="text-foreground font-medium break-all">{row.style_guide_files.filename}</p>
                                {(row.style_guide_files.licensor_name || row.style_guide_files.property_folder) && (
                                  <p className="text-muted-foreground/70 mt-0.5">
                                    {[row.style_guide_files.licensor_name, row.style_guide_files.property_folder].filter(Boolean).join(" / ")}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="text-muted-foreground/60 font-mono break-all">{row.file_name}</span>
                                <Badge variant="outline" className="text-[10px] h-4 shrink-0 text-muted-foreground/60">unresolved</Badge>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* PRODUCT DETAILS (rich-PDF extraction) */}
                <RichProductDetails rich={group.rich_metadata} />

                {/* FOLDER PATH */}
                <div>
                  <SectionLabel><span className="flex items-center gap-1.5"><HardDrive className="h-3 w-3" /> Folder</span></SectionLabel>
                  <div className="rounded-lg border border-[var(--pd-border,hsl(var(--border)))] bg-[var(--pd-surface-2,hsl(var(--muted)/0.3))] p-2.5">
                    <p
                      className="font-mono text-[11.5px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))]"
                      style={{ wordBreak: "break-all" }}
                    >
                      {group.folder_path}
                    </p>
                  </div>
                </div>

                {/* ALTERNATIVE IMAGES */}
                <FindAlternativeImages
                  group={group}
                  onIngested={() => {
                    queryClient.invalidateQueries({ queryKey: ["style-group-assets", group.id] });
                    queryClient.invalidateQueries({ queryKey: ["style-groups"], refetchType: "none" });
                  }}
                />
              </div>
            )}

            {/* ===== FILES TAB ===== */}
            {activeTab === "files" && (
              <div className="p-4 space-y-1">
                {assetsLoading ? (
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-6 justify-center">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading files…
                  </div>
                ) : (
                  (groupAssets ?? []).map((asset) => {
                    const isCover = asset.id === localPrimaryId;
                    const hasThumb = !!asset.thumbnail_url;
                    const thumbIdx = thumbStrip.findIndex((a) => a.id === asset.id);
                    const isViewing = thumbIdx >= 0 && thumbIdx === carouselIndex;
                    const uncPath = nasConfig ? getPathDisplayModes(asset.relative_path, nasConfig, null).uncHost : null;
                    const isSuperseded = (asset as any).is_superseded ?? false;

                    return (
                      <ContextMenu key={asset.id}>
                        <ContextMenuTrigger asChild>
                          <div
                            className={cn(
                              "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer transition-colors border",
                              isViewing
                                ? "bg-[var(--pd-accent,hsl(var(--primary)/0.08))] border-[var(--pd-accent,hsl(var(--primary)/0.3))]"
                                : "border-transparent hover:bg-[hsl(var(--muted)/0.5)] hover:border-[var(--pd-border,hsl(var(--border)))]"
                            )}
                            onClick={() => {
                              setSelectedAssetId(asset.id);
                              if (thumbIdx >= 0) setCarouselIndex(thumbIdx);
                            }}
                          >
                            {/* Thumbnail, falling back to a file type tile */}
                            {hasThumb ? (
                              <div className="h-9 w-9 shrink-0 rounded-md overflow-hidden border border-[var(--pd-border,hsl(var(--border)))] bg-[var(--pd-surface-2,hsl(var(--muted)/0.5))]">
                                <img
                                  src={asset.thumbnail_url!}
                                  alt={asset.filename}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              </div>
                            ) : (
                              <div
                                className={cn(
                                  "h-9 w-9 shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold uppercase",
                                  fileTypeTileClass(asset.file_type)
                                )}
                              >
                                {asset.file_type}
                              </div>
                            )}

                            {/* Info */}
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <p className="font-mono text-[13px] font-[600] truncate" title={asset.filename}>
                                {formatFilename(asset.filename, 26)}
                              </p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[11px] text-muted-foreground">{formatSize(asset.file_size)}</span>
                                {hasThumb ? (
                                  <span className="text-[10px] text-green-600 dark:text-green-400">preview ready</span>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground/50">no preview</span>
                                )}
                                {isSuperseded && (
                                  <Badge variant="outline" className="text-[9px] h-4 px-1 text-muted-foreground/60">superseded</Badge>
                                )}
                                {isCover && (
                                  <Badge variant="default" className="text-[9px] h-4 px-1 gap-0.5">
                                    <Star className="h-2.5 w-2.5 fill-current" /> Cover
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
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
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => handleAssetCheckout(asset.id)}
                                  >
                                    <Download className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="text-xs">Download</TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        </ContextMenuTrigger>

                        <ContextMenuContent className="w-52">
                          <ContextMenuItem onClick={() => handleAssetCheckout(asset.id)}>
                            <Download className="h-3.5 w-3.5 mr-2" />
                            Check Out &amp; Open
                          </ContextMenuItem>
                          {nasConfig && (
                            <ContextMenuItem onClick={() => handleOpenAssetFolder(asset)}>
                              <FolderOpen className="h-3.5 w-3.5 mr-2" />
                              Open Containing Folder
                            </ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => handleCopyPath(asset.relative_path, "relative path")}>
                            <Copy className="h-3.5 w-3.5 mr-2" />
                            Copy Relative Path
                          </ContextMenuItem>
                          {uncPath && (
                            <ContextMenuItem onClick={() => handleCopyPath(uncPath, "UNC path")}>
                              <Copy className="h-3.5 w-3.5 mr-2" />
                              Copy UNC Path
                            </ContextMenuItem>
                          )}
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })
                )}
              </div>
            )}

            {/* ===== ACTIVITY TAB ===== */}
            {activeTab === "activity" && (
              <div className="p-4">
                {/* Vertical timeline */}
                <ol className="relative border-l border-[var(--pd-border,hsl(var(--border)))] ml-3 space-y-5">

                  {/* Creation event */}
                  <li className="ml-4">
                    <div className="absolute -left-[9px] mt-0.5 h-4 w-4 rounded-full border-2 border-[var(--pd-border,hsl(var(--border)))] bg-[var(--pd-surface,hsl(var(--background)))] flex items-center justify-center">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--pd-accent,hsl(var(--primary)))]" />
                    </div>
                    <p className="text-[12px] font-semibold text-[var(--pd-fg,hsl(var(--foreground)))]">Group created</p>
                    {detailAsset?.ingested_at && (
                      <p className="text-[11px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))]">
                        {format(new Date(detailAsset.ingested_at), "MMM d, yyyy 'at' HH:mm")}
                      </p>
                    )}
                    <p className="text-[11px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))]">
                      {group.asset_count} file{group.asset_count !== 1 ? "s" : ""} ingested
                    </p>
                  </li>

                  {/* Last scanned */}
                  {detailAsset?.last_seen_at && (
                    <li className="ml-4">
                      <div className="absolute -left-[9px] mt-0.5 h-4 w-4 rounded-full border-2 border-[var(--pd-border,hsl(var(--border)))] bg-[var(--pd-surface,hsl(var(--background)))] flex items-center justify-center">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                      </div>
                      <p className="text-[12px] font-semibold text-[var(--pd-fg,hsl(var(--foreground)))]">Auto-sync</p>
                      <p className="text-[11px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))]">
                        Last seen {format(new Date(detailAsset.last_seen_at), "MMM d, yyyy 'at' HH:mm")}
                      </p>
                    </li>
                  )}

                  {/* Stage moves — shown if stage is set */}
                  {group.stage && (
                    <li className="ml-4">
                      <div className="absolute -left-[9px] mt-0.5 h-4 w-4 rounded-full border-2 border-[var(--pd-border,hsl(var(--border)))] bg-[var(--pd-surface,hsl(var(--background)))] flex items-center justify-center">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                      </div>
                      <p className="text-[12px] font-semibold text-[var(--pd-fg,hsl(var(--foreground)))]">Stage: {group.stage}</p>
                      <p className="text-[11px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))]">
                        Current workflow stage
                      </p>
                    </li>
                  )}

                  {/* AI tagged */}
                  {(detailAsset as any)?.ai_tagged_at && (
                    <li className="ml-4">
                      <div className="absolute -left-[9px] mt-0.5 h-4 w-4 rounded-full border-2 border-[var(--pd-border,hsl(var(--border)))] bg-[var(--pd-surface,hsl(var(--background)))] flex items-center justify-center">
                        <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                      </div>
                      <p className="text-[12px] font-semibold text-[var(--pd-fg,hsl(var(--foreground)))]">AI tagged</p>
                      <p className="text-[11px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))]">
                        {format(new Date((detailAsset as any).ai_tagged_at), "MMM d, yyyy 'at' HH:mm")}
                        {(detailAsset as any).ai_model ? ` · ${(detailAsset as any).ai_model.split("/").pop()}` : ""}
                      </p>
                    </li>
                  )}

                  {/* File modified */}
                  {detailAsset?.modified_at && (
                    <li className="ml-4">
                      <div className="absolute -left-[9px] mt-0.5 h-4 w-4 rounded-full border-2 border-[var(--pd-border,hsl(var(--border)))] bg-[var(--pd-surface,hsl(var(--background)))] flex items-center justify-center">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                      </div>
                      <p className="text-[12px] font-semibold text-[var(--pd-fg,hsl(var(--foreground)))]">File modified</p>
                      <p className="text-[11px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))]">
                        {format(new Date(detailAsset.modified_at), "MMM d, yyyy 'at' HH:mm")}
                      </p>
                    </li>
                  )}
                </ol>
              </div>
            )}
          </div>

          {/* ── Sticky footer ─────────────────────────────────── */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2.5 border-t border-[var(--pd-border,hsl(var(--border)))] bg-[var(--pd-surface,hsl(var(--background)))]">
            <Button
              className="flex-1 gap-1.5 text-[13px] h-8 bg-[var(--pd-accent,hsl(var(--primary)))] text-[var(--pd-accent-fg,hsl(var(--primary-foreground)))] hover:opacity-90"
              onClick={handleDownloadAll}
              disabled={!groupAssets || groupAssets.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              Download all
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={async () => {
                    await navigator.clipboard.writeText(window.location.href);
                    toast("Link copied");
                  }}
                >
                  <Share2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Share</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={!detailAsset || !nasConfig}
                  onClick={() => { if (detailAsset) handleOpenAssetFolder(detailAsset); }}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Open folder</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <Lightbox url={lightboxUrl} alt={group.sku} onClose={() => setLightboxUrl(null)} />
      )}
    </TooltipProvider>
  );
}
