import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, ScanLine, ImageIcon, Trash2, Check, X, Clock } from "lucide-react";
import { toast } from "sonner";

export interface AiSentinelStats {
  total_ai: number;
  sampled: number;
  sentinel_pending: number;
  cleaned_up: number;
  no_replacement_found: number;
}

export interface SentinelPendingFile {
  asset_id: string;
  filename: string;
  relative_path: string;
  thumbnail_url: string | null;
  replacement_thumbnail_url: string | null;
  replacement_filename: string | null;
}

export interface SentinelLogEntry {
  id: string;
  ai_filename: string;
  ai_relative_path: string;
  replacement_filename: string | null;
  replacement_queued_for_thumbnail: boolean;
  created_at: string;
}

export interface AiSentinelScanRequest {
  status: "scanning" | "claimed" | "completed" | "error";
  target: number;
  found: number;
  processed: number;
  total_ai: number;
  started_at?: string;
  completed_at?: string;
}

export function AiSentinelCleanupCard() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedIndexRef = useRef<number | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ["ai-sentinel-status"],
    queryFn: () => call<{ ok: boolean; stats: AiSentinelStats; pending_files: SentinelPendingFile[]; recent_log: SentinelLogEntry[]; scan_request: AiSentinelScanRequest | null }>("get-ai-sentinel-status"),
    refetchInterval: (q) => {
      const sr = q.state.data?.scan_request;
      return (sr?.status === "scanning" || sr?.status === "claimed") ? 4000 : 15000;
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: (assetIds: string[]) =>
      call<{ ok: boolean; processed: number }>("run-ai-sentinel-cleanup", { asset_ids: assetIds }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-sentinel-status"] });
      setSelectedIds(new Set());
      lastClickedIndexRef.current = null;
      if (data.processed === 0) {
        toast.info("No sentinel files pending cleanup right now.");
      } else {
        toast.success(`Cleaned up ${data.processed} .ai file${data.processed !== 1 ? "s" : ""} and queued sibling scans.`);
      }
      setConfirmOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dismissMutation = useMutation({
    mutationFn: (assetIds: string[]) =>
      call<{ ok: boolean; dismissed: number }>("dismiss-ai-sentinel", { asset_ids: assetIds }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-sentinel-status"] });
      setSelectedIds(new Set());
      lastClickedIndexRef.current = null;
      toast.success(`Dismissed ${data.dismissed} file${data.dismissed !== 1 ? "s" : ""} — removed from sentinel list.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const snoozeMutation = useMutation({
    mutationFn: (assetIds: string[]) =>
      call<{ ok: boolean; snoozed: number; until: string }>("snooze-ai-sentinel", { asset_ids: assetIds }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-sentinel-status"] });
      setSelectedIds(new Set());
      lastClickedIndexRef.current = null;
      const until = new Date(data.until).toLocaleDateString();
      toast.success(`Snoozed ${data.snoozed} file${data.snoozed !== 1 ? "s" : ""} until ${until}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleItemClick = (assetId: string, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIndexRef.current !== null) {
      const start = Math.min(lastClickedIndexRef.current, index);
      const end = Math.max(lastClickedIndexRef.current, index);
      const rangeIds = pendingFiles.slice(start, end + 1).map((f) => f.asset_id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        rangeIds.forEach((id) => next.add(id));
        return next;
      });
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(assetId)) next.delete(assetId);
        else next.add(assetId);
        return next;
      });
      lastClickedIndexRef.current = index;
    } else {
      setSelectedIds(new Set([assetId]));
      lastClickedIndexRef.current = index;
    }
  };

  const scanMutation = useMutation({
    mutationFn: () => call("trigger-ai-sentinel-scan", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-sentinel-status"] });
      toast.info("Scanning .ai files for sentinel content…");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = status?.stats;
  const log = status?.recent_log ?? [];
  const pendingFiles = status?.pending_files ?? [];
  const scanRequest = status?.scan_request ?? null;
  const isScanning = scanRequest?.status === "scanning" || scanRequest?.status === "claimed";
  const selectedCount = selectedIds.size;
  const sampledPct = stats ? Math.round((stats.sampled / Math.max(stats.total_ai, 1)) * 100) : 0;
  const scanPct = scanRequest && scanRequest.total_ai > 0
    ? Math.round((scanRequest.processed / scanRequest.total_ai) * 100)
    : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          .ai Sentinel Cleanup
          <Badge variant="outline" className="text-xs font-normal ml-1">Temporary</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Finds .ai files saved without "Create PDF Compatible File" (they contain only Adobe's boilerplate warning, not artwork),
          deletes them, and thumbnails the nearest PDF/PNG/JPG tech pack in the same folder instead.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : stats ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="rounded border p-2">
                <div className="text-muted-foreground text-xs">Total .ai files</div>
                <div className="font-semibold">{stats.total_ai.toLocaleString()}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground text-xs">Sampled</div>
                <div className="font-semibold">{stats.sampled.toLocaleString()} <span className="text-muted-foreground font-normal text-xs">({sampledPct}%)</span></div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground text-xs">Sentinel pending</div>
                <div className={`font-semibold ${stats.sentinel_pending > 0 ? "text-amber-600" : "text-green-600"}`}>
                  {stats.sentinel_pending.toLocaleString()}
                </div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground text-xs">Cleaned up</div>
                <div className="font-semibold">{stats.cleaned_up.toLocaleString()}</div>
                {stats.no_replacement_found > 0 && (
                  <div className="text-xs text-amber-600">{stats.no_replacement_found} without replacement</div>
                )}
              </div>
            </div>

            {/* Sentinel scan button + progress */}
            {!isScanning && (
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => scanMutation.mutate()}
                  disabled={scanMutation.isPending}
                >
                  {scanMutation.isPending
                    ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Starting…</>
                    : <><ScanLine className="mr-1.5 h-3.5 w-3.5" /> Scan for Sentinel Files</>}
                </Button>
                {scanRequest?.status === "completed" && (
                  <span className="text-xs text-muted-foreground">
                    Last scan: found {scanRequest.found} sentinel file{scanRequest.found !== 1 ? "s" : ""} in {scanRequest.processed.toLocaleString()} checked
                  </span>
                )}
              </div>
            )}
            {isScanning && scanRequest && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Scanning .ai files — found {scanRequest.found} sentinel so far
                  </span>
                  <span>{scanRequest.processed.toLocaleString()} / {scanRequest.total_ai.toLocaleString()} ({scanPct}%)</span>
                </div>
                <Progress value={scanPct} className="h-1.5" />
              </div>
            )}

            {pendingFiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-amber-700">
                    {pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""} without thumbnails — select to clean up
                  </span>
                  <div className="flex items-center gap-2">
                    {selectedCount > 0 && (
                      <button
                        className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        onClick={() => { setSelectedIds(new Set()); lastClickedIndexRef.current = null; }}
                      >
                        Deselect all
                      </button>
                    )}
                    <button
                      className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      onClick={() => setSelectedIds(new Set(pendingFiles.map((f) => f.asset_id)))}
                    >
                      Select all
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-96 overflow-y-auto p-1 rounded border bg-muted/30">
                  {pendingFiles.map((f, i) => {
                    const selected = selectedIds.has(f.asset_id);
                    return (
                      <div
                        key={f.asset_id}
                        title={f.relative_path}
                        className={`flex flex-col gap-1 cursor-pointer rounded p-0.5 select-none ${selected ? "ring-2 ring-amber-500 bg-amber-500/10" : "hover:bg-muted/60"}`}
                        onClick={(e) => handleItemClick(f.asset_id, i, e)}
                      >
                        <div className="aspect-square rounded overflow-hidden bg-muted flex items-center justify-center relative">
                          {f.thumbnail_url ? (
                            <img src={f.thumbnail_url} alt={f.filename} className="w-full h-full object-cover" />
                          ) : f.replacement_thumbnail_url ? (
                            <img src={f.replacement_thumbnail_url} alt={f.replacement_filename ?? f.filename} className="w-full h-full object-cover opacity-50" title={`No .ai thumbnail — showing sibling: ${f.replacement_filename}`} />
                          ) : (
                            <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                          )}
                          {selected && (
                            <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded bg-amber-500 flex items-center justify-center">
                              <Check className="h-2.5 w-2.5 text-white" />
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground truncate leading-tight">{f.filename}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">Click to select · Ctrl+click to toggle · Shift+click to range select</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {!confirmOpen ? (
                <>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={selectedCount === 0 || cleanupMutation.isPending || dismissMutation.isPending}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {selectedCount === 0 ? "Select files to clean up" : `Clean up ${selectedCount} selected`}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedCount === 0 || dismissMutation.isPending || cleanupMutation.isPending || snoozeMutation.isPending}
                    onClick={() => dismissMutation.mutate([...selectedIds])}
                    title="Remove from sentinel list without deleting the asset — use when a file was incorrectly flagged"
                  >
                    {dismissMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <X className="h-3.5 w-3.5 mr-1" />}
                    Not sentinel
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedCount === 0 || snoozeMutation.isPending || cleanupMutation.isPending || dismissMutation.isPending}
                    onClick={() => snoozeMutation.mutate([...selectedIds])}
                    title="Hide for 3 weeks — skips re-ingestion until then, when it will reappear for review"
                  >
                    {snoozeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Clock className="h-3.5 w-3.5 mr-1" />}
                    I don't know
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-sm text-destructive font-medium">Delete {selectedCount} .ai file{selectedCount !== 1 ? "s" : ""}?</span>
                  <Button size="sm" variant="destructive" disabled={cleanupMutation.isPending} onClick={() => cleanupMutation.mutate([...selectedIds])}>
                    {cleanupMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                    Confirm
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                </>
              )}
              {log.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setShowLog(!showLog)}>
                  {showLog ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                  {showLog ? "Hide" : "Show"} log ({log.length})
                </Button>
              )}
            </div>

            {showLog && log.length > 0 && (
              <div className="overflow-auto max-h-64 rounded border text-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deleted .ai</TableHead>
                      <TableHead>Replacement found</TableHead>
                      <TableHead>Thumbnail queued</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {log.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-mono max-w-[200px] truncate" title={entry.ai_relative_path}>{entry.ai_filename}</TableCell>
                        <TableCell className={entry.replacement_filename ? "" : "text-amber-600"}>
                          {entry.replacement_filename ?? "None found"}
                        </TableCell>
                        <TableCell>{entry.replacement_queued_for_thumbnail ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : "—"}</TableCell>
                        <TableCell>{new Date(entry.created_at).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Failed to load status.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

// ── PDF Backfill Card ─────────────────────────────────────────────────────────
