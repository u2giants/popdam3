import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, AlertTriangle, CheckCircle2, FileWarning, ImageOff, ExternalLink } from "lucide-react";

const SAMPLE_SIZE = 50;

/* ── Helpers ─────────────────────────────────────────────── */

function shuffleSample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

interface AuditAsset {
  id: string;
  filename: string;
  relative_path: string;
  thumbnail_url: string | null;
  thumbnail_error: string | null;
  file_type: string;
  file_size: number | null;
  width: number | null;
  height: number | null;
  sku: string | null;
  style_group_id: string | null;
}

/* Known Adobe "no PDF compat" placeholder dims: ~468×312 or ~540×360 */
const PLACEHOLDER_DIMS = [
  { w: 468, h: 312 },
  { w: 540, h: 360 },
  { w: 360, h: 468 },
  { w: 312, h: 468 },
];

function isPlaceholderDims(w: number, h: number): boolean {
  return PLACEHOLDER_DIMS.some(
    (p) => (Math.abs(w - p.w) <= 10 && Math.abs(h - p.h) <= 10)
  );
}

/* ── Image dimension checker (client-side) ───────────────── */

interface DimResult {
  assetId: string;
  naturalW: number;
  naturalH: number;
  isPlaceholder: boolean;
  loadError: boolean;
  thumbByteSize: number | null;
}

function useImageDimChecker(assets: AuditAsset[]) {
  const [results, setResults] = useState<Map<string, DimResult>>(new Map());
  const [checking, setChecking] = useState(false);
  const abortRef = useRef(false);

  const run = useCallback(async () => {
    abortRef.current = false;
    setChecking(true);
    setResults(new Map());

    for (const asset of assets) {
      if (abortRef.current) break;
      if (!asset.thumbnail_url) continue;

      try {
        const result = await new Promise<DimResult>((resolve) => {
          const img = new Image();
          img.onload = () => {
            resolve({
              assetId: asset.id,
              naturalW: img.naturalWidth,
              naturalH: img.naturalHeight,
              isPlaceholder: isPlaceholderDims(img.naturalWidth, img.naturalHeight),
              loadError: false,
              thumbByteSize: null,
            });
          };
          img.onerror = () => {
            resolve({
              assetId: asset.id,
              naturalW: 0,
              naturalH: 0,
              isPlaceholder: false,
              loadError: true,
              thumbByteSize: null,
            });
          };
          img.src = asset.thumbnail_url!;
        });

        setResults((prev) => new Map(prev).set(asset.id, result));
      } catch {
        /* skip */
      }
    }
    setChecking(false);
  }, [assets]);

  useEffect(() => {
    return () => { abortRef.current = true; };
  }, []);

  return { results, checking, run };
}

/* ── Audit Card for a single asset ───────────────────────── */

function AuditCard({
  asset,
  dimResult,
  method,
}: {
  asset: AuditAsset;
  dimResult?: DimResult;
  method: "header" | "heuristic";
}) {
  const flagged =
    method === "heuristic"
      ? dimResult?.isPlaceholder ?? false
      : true; // header-check candidates are all flagged by definition

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="aspect-square relative bg-muted/20">
        {asset.thumbnail_url ? (
          <img
            src={asset.thumbnail_url}
            alt={asset.filename}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageOff className="h-8 w-8 text-muted-foreground/20" />
          </div>
        )}
        {flagged && (
          <div className="absolute top-1 right-1">
            <Badge className="text-[9px] bg-destructive/80 text-white border-0">
              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Suspect
            </Badge>
          </div>
        )}
        {dimResult && !dimResult.isPlaceholder && !dimResult.loadError && method === "heuristic" && (
          <div className="absolute top-1 right-1">
            <Badge className="text-[9px] bg-[hsl(var(--success))]/80 text-white border-0">
              <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> OK
            </Badge>
          </div>
        )}
      </div>
      <div className="p-2 space-y-1">
        <p className="text-[10px] font-mono text-foreground truncate" title={asset.filename}>
          {asset.filename}
        </p>
        <p className="text-[9px] text-muted-foreground truncate" title={asset.relative_path}>
          {asset.relative_path.split("/").slice(-2).join("/")}
        </p>
        {asset.sku && (
          <Badge variant="secondary" className="text-[9px]">{asset.sku}</Badge>
        )}
        {dimResult && (
          <p className="text-[9px] text-muted-foreground">
            Thumb: {dimResult.naturalW}×{dimResult.naturalH}
            {dimResult.isPlaceholder && (
              <span className="text-destructive font-semibold ml-1">⚠ placeholder dims</span>
            )}
          </p>
        )}
        {asset.thumbnail_url && (
          <a
            href={asset.thumbnail_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[9px] text-primary hover:underline"
          >
            Open thumb <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Method 1: Header Check ──────────────────────────────── */

function HeaderCheckSection() {
  const [sample, setSample] = useState<AuditAsset[]>([]);

  const { data: pool, isLoading, refetch } = useQuery({
    queryKey: ["thumb-audit-header-pool"],
    queryFn: async () => {
      // AI files that have a thumbnail (rendered "something") but no error recorded
      // These are candidates where a non-PDF-compat file might have rendered a placeholder
      const { data, error } = await supabase
        .from("assets")
        .select("id, filename, relative_path, thumbnail_url, thumbnail_error, file_type, file_size, width, height, sku, style_group_id")
        .eq("file_type", "ai")
        .eq("is_deleted", false)
        .not("thumbnail_url", "is", null)
        .is("thumbnail_error", null)
        .limit(500);
      if (error) throw error;
      return (data ?? []) as AuditAsset[];
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (pool && pool.length > 0 && sample.length === 0) {
      setSample(shuffleSample(pool, SAMPLE_SIZE));
    }
  }, [pool]);

  const resample = () => {
    if (pool) setSample(shuffleSample(pool, SAMPLE_SIZE));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <FileWarning className="h-4 w-4" /> Method 1: PDF Header Check
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            AI files that rendered a thumbnail without error. If the original .ai file lacks <code>%PDF-</code> header,
            the rendered image is likely an Adobe placeholder — not actual artwork. Review visually.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            Pool: {pool?.length ?? 0} | Showing: {sample.length}
          </Badge>
          <Button variant="ghost" size="icon" onClick={resample} disabled={isLoading}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sample.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI files with thumbnails found.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {sample.map((asset) => (
              <AuditCard key={asset.id} asset={asset} method="header" />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Method 2: Placeholder Heuristic ─────────────────────── */

function PlaceholderHeuristicSection() {
  const [sample, setSample] = useState<AuditAsset[]>([]);

  const { data: pool, isLoading, refetch } = useQuery({
    queryKey: ["thumb-audit-heuristic-pool"],
    queryFn: async () => {
      // All files with thumbnails - we'll check dims client-side
      const { data, error } = await supabase
        .from("assets")
        .select("id, filename, relative_path, thumbnail_url, thumbnail_error, file_type, file_size, width, height, sku, style_group_id")
        .eq("is_deleted", false)
        .not("thumbnail_url", "is", null)
        .limit(500);
      if (error) throw error;
      return (data ?? []) as AuditAsset[];
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (pool && pool.length > 0 && sample.length === 0) {
      setSample(shuffleSample(pool, SAMPLE_SIZE));
    }
  }, [pool]);

  const resample = () => {
    if (pool) setSample(shuffleSample(pool, SAMPLE_SIZE));
  };

  const { results, checking, run } = useImageDimChecker(sample);

  // Auto-run dim check when sample changes
  useEffect(() => {
    if (sample.length > 0) run();
  }, [sample]);

  const flaggedCount = Array.from(results.values()).filter((r) => r.isPlaceholder).length;
  const checkedCount = results.size;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Method 2: Placeholder Heuristic (Dimension Check)
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Loads each thumbnail in the browser and checks if its dimensions match known Adobe placeholder sizes
            (~468×312 or ~540×360). Flagged images are likely "This file was not saved with PDF compatibility" error screens.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            Pool: {pool?.length ?? 0} | Checked: {checkedCount}/{sample.length}
          </Badge>
          {flaggedCount > 0 && (
            <Badge className="text-xs bg-destructive/80 text-white border-0">
              {flaggedCount} flagged
            </Badge>
          )}
          <Button variant="ghost" size="icon" onClick={resample} disabled={isLoading || checking}>
            <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sample.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assets with thumbnails found.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {sample.map((asset) => (
              <AuditCard
                key={asset.id}
                asset={asset}
                dimResult={results.get(asset.id)}
                method="heuristic"
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Main Tab ────────────────────────────────────────────── */

export default function ThumbnailAuditTab() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Thumbnail Placeholder Audit</h2>
        <p className="text-sm text-muted-foreground">
          Test two detection methods for identifying Adobe Illustrator placeholder thumbnails.
          Each method samples 50 random files from the pool — click the refresh button to re-sample.
        </p>
      </div>

      <HeaderCheckSection />

      <Separator />

      <PlaceholderHeuristicSection />
    </div>
  );
}
