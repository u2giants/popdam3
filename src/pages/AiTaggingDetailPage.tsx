import { forwardRef, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { LinkProps } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TruncatedCell } from "@/components/ui/truncated-cell";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AlertTriangle, ChevronLeft, RefreshCw, CheckCircle2, SkipForward, ImageOff,
} from "lucide-react";
import { timeAgo } from "@/components/settings/diagnostics/types";

const CONFIG_KEY = "BULK_OPERATIONS";

const LinkWithRef = forwardRef<HTMLAnchorElement, LinkProps & React.AnchorHTMLAttributes<HTMLAnchorElement>>(
  (props, ref) => <Link {...props} ref={ref} />
);

type FailureSample = {
  at?: string;
  asset_id: string;
  filename?: string;
  relative_path?: string;
  thumbnail_url?: string;
  http_status?: number;
  error: string;
};

type SkipSample = {
  at?: string;
  asset_id: string;
  filename?: string;
  relative_path?: string;
  thumbnail_url?: string;
  reason?: string;
};

type ViewMode = "tagged" | "skipped" | "failed";

const VIEW_CONFIG: Record<ViewMode, { label: string; icon: typeof CheckCircle2; color: string }> = {
  tagged: { label: "Tagged Assets", icon: CheckCircle2, color: "text-[hsl(var(--success))]" },
  skipped: { label: "Skipped Assets", icon: SkipForward, color: "text-[hsl(var(--warning))]" },
  failed: { label: "Failed Assets", icon: AlertTriangle, color: "text-destructive" },
};

export default function AiTaggingDetailPage() {
  const { call } = useAdminApi();
  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin();
  const [searchParams] = useSearchParams();

  const opKey = searchParams.get("op") || "ai-tag-untagged";
  const view = (searchParams.get("view") || "failed") as ViewMode;
  const config = VIEW_CONFIG[view] || VIEW_CONFIG.failed;
  const Icon = config.icon;

  // Fetch operation state for skipped/failed samples
  const { data: opData, isLoading: opLoading, refetch: refetchOp } = useQuery({
    queryKey: ["ai-tag-op-detail", opKey],
    queryFn: async () => {
      const res = await call("get-config", { keys: [CONFIG_KEY] });
      const ops = (res?.config?.[CONFIG_KEY]?.value ?? res?.config?.[CONFIG_KEY]) as Record<string, any> | undefined;
      const op = ops?.[opKey] ?? null;
      return {
        op,
        failureSamples: (op?.progress?.failure_samples ?? []) as FailureSample[],
        skipSamples: (op?.progress?.skip_samples ?? []) as SkipSample[],
      };
    },
    refetchInterval: 5000,
    enabled: !isAdminLoading && isAdmin && (view === "failed" || view === "skipped"),
  });

  // Fetch recently tagged assets from DB
  const { data: taggedAssets, isLoading: taggedLoading, refetch: refetchTagged } = useQuery({
    queryKey: ["ai-tag-recent-tagged", opKey],
    queryFn: async () => {
      // Get the run's started_at to scope the query
      const configRes = await call("get-config", { keys: [CONFIG_KEY] });
      const ops = (configRes?.config?.[CONFIG_KEY]?.value ?? configRes?.config?.[CONFIG_KEY]) as Record<string, any> | undefined;
      const op = ops?.[opKey] ?? null;
      const startedAt = op?.started_at;

      if (!startedAt) return [];

      const { data } = await supabase
        .from("assets")
        .select("id, filename, relative_path, thumbnail_url, ai_tagged_at, ai_description")
        .gte("ai_tagged_at", startedAt)
        .eq("is_deleted", false)
        .order("ai_tagged_at", { ascending: false })
        .limit(200);

      return data || [];
    },
    refetchInterval: 5000,
    enabled: !isAdminLoading && isAdmin && view === "tagged",
  });

  const op = opData?.op ?? null;
  const isLoading = opLoading || taggedLoading;

  const sortedFailed = useMemo(() => {
    return [...(opData?.failureSamples ?? [])].sort((a, b) => {
      const atA = a.at ? new Date(a.at).getTime() : 0;
      const atB = b.at ? new Date(b.at).getTime() : 0;
      return atB - atA;
    });
  }, [opData?.failureSamples]);

  const sortedSkipped = useMemo(() => {
    return [...(opData?.skipSamples ?? [])].sort((a, b) => {
      const atA = a.at ? new Date(a.at).getTime() : 0;
      const atB = b.at ? new Date(b.at).getTime() : 0;
      return atB - atA;
    });
  }, [opData?.skipSamples]);

  const refetch = () => {
    refetchOp();
    if (view === "tagged") refetchTagged();
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="container max-w-6xl py-8 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Icon className={`h-5 w-5 ${config.color}`} />
              <h1 className="text-2xl font-semibold">{config.label}</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Showing {view} assets from <code className="font-mono text-xs">{opKey}</code> run.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <LinkWithRef to="/settings?tab=diagnostics" className="gap-1.5">
                <ChevronLeft className="h-4 w-4" /> Back to Settings
              </LinkWithRef>
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={refetch}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {!isAdminLoading && !isAdmin && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Admins only</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">You don't have permission to view this.</CardContent>
          </Card>
        )}

        {isAdmin && (
          <>
            {/* Run summary */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Run summary</CardTitle></CardHeader>
              <CardContent className="text-sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Status</div>
                    <div className="font-medium">{op?.status ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Last update</div>
                    <div className="font-medium">
                      {op?.updated_at ? `${timeAgo(op.updated_at)} (${new Date(op.updated_at).toLocaleString()})` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {view === "tagged" ? "Tagged assets (from DB)" :
                       view === "skipped" ? "Skip samples stored" :
                       "Failure samples stored"}
                    </div>
                    <div className="font-medium">
                      {view === "tagged"
                        ? (taggedAssets?.length ?? 0).toLocaleString()
                        : view === "skipped"
                          ? sortedSkipped.length.toLocaleString()
                          : sortedFailed.length.toLocaleString()
                      }
                    </div>
                  </div>
                </div>
                {view !== "tagged" && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Note: for safety, the system caps stored samples (latest ~200) to avoid bloating persistent state.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* View tabs */}
            <div className="flex gap-1">
              {(["tagged", "skipped", "failed"] as ViewMode[]).map((v) => {
                const c = VIEW_CONFIG[v];
                const VIcon = c.icon;
                const count = v === "tagged"
                  ? (op?.progress?.tagged as number ?? 0)
                  : v === "skipped"
                    ? (op?.progress?.skipped as number ?? 0)
                    : (op?.progress?.failed as number ?? 0);
                return (
                  <Link
                    key={v}
                    to={`/settings/ai-tagging-detail?op=${encodeURIComponent(opKey)}&view=${v}`}
                    replace
                  >
                    <Button
                      variant={view === v ? "default" : "outline"}
                      size="sm"
                      className="gap-1.5 text-xs"
                    >
                      <VIcon className={`h-3.5 w-3.5 ${view === v ? "" : c.color}`} />
                      {c.label} ({count.toLocaleString()})
                    </Button>
                  </Link>
                );
              })}
            </div>

            {/* Content */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{config.label}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : view === "tagged" ? (
                  <TaggedTable assets={taggedAssets ?? []} />
                ) : view === "skipped" ? (
                  <SkippedTable samples={sortedSkipped} />
                ) : (
                  <FailedTable samples={sortedFailed} />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

function AssetThumb({ url, alt }: { url?: string | null; alt?: string }) {
  if (!url) {
    return (
      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0">
        <ImageOff className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt || "thumbnail"}
      className="h-10 w-10 rounded object-cover shrink-0 bg-muted"
      loading="lazy"
    />
  );
}

function TaggedTable({ assets }: { assets: any[] }) {
  if (assets.length === 0) {
    return <p className="text-sm text-muted-foreground">No tagged assets found for this run.</p>;
  }
  return (
    <div className="overflow-auto border border-border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">Thumb</TableHead>
            <TableHead>File</TableHead>
            <TableHead>AI Description</TableHead>
            <TableHead className="text-right">Tagged</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.map((a) => (
            <TableRow key={a.id}>
              <TableCell><AssetThumb url={a.thumbnail_url} alt={a.filename} /></TableCell>
              <TableCell className="text-xs font-mono max-w-[360px]">
                <TruncatedCell>{a.relative_path || a.filename || "—"}</TruncatedCell>
              </TableCell>
              <TableCell className="text-xs max-w-[400px]">
                <TruncatedCell className="text-muted-foreground">{a.ai_description || "—"}</TruncatedCell>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground text-right whitespace-nowrap">
                {a.ai_tagged_at ? timeAgo(a.ai_tagged_at) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SkippedTable({ samples }: { samples: SkipSample[] }) {
  if (samples.length === 0) {
    return <p className="text-sm text-muted-foreground">No skip samples recorded for this run.</p>;
  }
  return (
    <div className="overflow-auto border border-border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">Thumb</TableHead>
            <TableHead>File</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead className="text-right">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {samples.map((s, idx) => (
            <TableRow key={`${s.asset_id}-${idx}`}>
              <TableCell><AssetThumb url={s.thumbnail_url} alt={s.filename} /></TableCell>
              <TableCell className="text-xs font-mono max-w-[360px]">
                <TruncatedCell>{s.relative_path || s.filename || "—"}</TruncatedCell>
              </TableCell>
              <TableCell className="text-xs max-w-[400px]">
                <TruncatedCell className="text-[hsl(var(--warning))]">{s.reason || "Already tagged"}</TruncatedCell>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground text-right whitespace-nowrap">
                {s.at ? timeAgo(s.at) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function FailedTable({ samples }: { samples: FailureSample[] }) {
  if (samples.length === 0) {
    return <p className="text-sm text-muted-foreground">No failure samples recorded for this run.</p>;
  }
  return (
    <div className="overflow-auto border border-border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">Thumb</TableHead>
            <TableHead>File</TableHead>
            <TableHead>Error</TableHead>
            <TableHead className="text-right">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {samples.map((f, idx) => (
            <TableRow key={`${f.asset_id}-${idx}`}>
              <TableCell><AssetThumb url={f.thumbnail_url} alt={f.filename} /></TableCell>
              <TableCell className="text-xs font-mono max-w-[360px]">
                <TruncatedCell>{f.relative_path || f.filename || "—"}</TruncatedCell>
              </TableCell>
              <TableCell className="text-xs max-w-[520px]">
                <div className="space-y-1">
                  <TruncatedCell className="text-destructive">{f.error || "Unknown error"}</TruncatedCell>
                  {typeof f.http_status === "number" && (
                    <div className="text-[10px] text-muted-foreground">HTTP {f.http_status}</div>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground text-right whitespace-nowrap">
                {f.at ? timeAgo(f.at) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
