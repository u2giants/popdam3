import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Search, RefreshCw, Trash2, TestTube, Play, Loader2, FileImage, CheckCircle2, XCircle, Clock, X,
} from "lucide-react";

interface TiffFile {
  id: string;
  relative_path: string;
  filename: string;
  file_size: number;
  file_modified_at: string;
  file_created_at: string | null;
  compression_type: string;
  status: string;
  mode: string | null;
  new_file_size: number | null;
  new_filename: string | null;
  new_file_modified_at: string | null;
  new_file_created_at: string | null;
  original_backed_up: boolean;
  original_deleted: boolean;
  error_message: string | null;
  processed_at: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    scanned: { label: "Scanned", className: "bg-secondary text-secondary-foreground" },
    queued_test: { label: "Queued (Test)", className: "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]" },
    queued_process: { label: "Queued (Process)", className: "bg-[hsl(var(--info)/0.15)] text-[hsl(var(--info))]" },
    processing: { label: "Processing", className: "bg-primary/15 text-primary" },
    completed: { label: "Completed", className: "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]" },
    failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
    queued_delete: { label: "Deleting", className: "bg-destructive/15 text-destructive" },
  };
  const config = map[status] || { label: status, className: "bg-secondary text-secondary-foreground" };
  return <Badge variant="outline" className={`text-[10px] ${config.className}`}>{config.label}</Badge>;
}

function CompressionBadge({ type }: { type: string }) {
  if (type === "none") return <Badge variant="destructive" className="text-[10px]">None</Badge>;
  if (type === "zip" || type === "deflate") return <Badge className="text-[10px] bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]">ZIP</Badge>;
  if (type === "lzw") return <Badge className="text-[10px] bg-[hsl(var(--info)/0.15)] text-[hsl(var(--info))]">LZW</Badge>;
  return <Badge variant="secondary" className="text-[10px]">{type}</Badge>;
}

export default function TiffHygieneTab() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "uncompressed" | "compressed">("all");
  const [scanPending, setScanPending] = useState(false);
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["tiff-files", filter],
    queryFn: () => call("list-tiff-files", {
      limit: 2000,
      compression: filter === "all" ? undefined : filter === "uncompressed" ? "none" : "compressed",
    }),
  });

  const files: TiffFile[] = data?.files || [];
  const summary = data?.summary || {};

  // Check TIFF_SCAN_REQUEST status to show pending state
  const { data: scanReqData } = useQuery({
    queryKey: ["tiff-scan-request"],
    queryFn: () => call("get-config", { keys: ["TIFF_SCAN_REQUEST"] }),
    refetchInterval: scanPending ? 5000 : false,
  });

  // Derive scan state from cloud config
  const scanReqValue = scanReqData?.config?.TIFF_SCAN_REQUEST as { status?: string; error?: string; total_files?: number } | undefined;
  const scanReqStatus = scanReqValue?.status;
  const scanReqError = scanReqValue?.error;
  const isAgentScanning = scanPending || scanReqStatus === "pending" || scanReqStatus === "claimed";

  // Auto-poll for results while scan is pending/claimed
  useEffect(() => {
    if (isAgentScanning) {
      setScanPending(true);
      scanPollRef.current = setInterval(() => {
        refetch();
        queryClient.invalidateQueries({ queryKey: ["tiff-scan-request"] });
      }, 5000);
    } else if (scanPending) {
      // Scan finished — stop polling and do a final refresh
      setScanPending(false);
      refetch();
    }
    return () => {
      if (scanPollRef.current) clearInterval(scanPollRef.current);
    };
  }, [isAgentScanning]); // eslint-disable-line react-hooks/exhaustive-deps

  const scanMutation = useMutation({
    mutationFn: () => call("trigger-tiff-scan"),
    onSuccess: () => {
      toast.success("TIFF scan triggered — Windows Agent will pick it up on next heartbeat (~30s)");
      setScanPending(true);
      queryClient.invalidateQueries({ queryKey: ["tiff-scan-request"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const queueMutation = useMutation({
    mutationFn: ({ ids, mode }: { ids: string[]; mode: string }) =>
      call("queue-tiff-jobs", { ids, mode }),
    onSuccess: (_, vars) => {
      toast.success(`${vars.ids.length} file(s) queued for ${vars.mode}`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["tiff-files"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => call("delete-tiff-originals", { ids }),
    onSuccess: (_, ids) => {
      toast.success(`${ids.length} original(s) queued for deletion`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["tiff-files"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const clearMutation = useMutation({
    mutationFn: () => call("clear-tiff-scan"),
    onSuccess: () => {
      toast.success("TIFF scan results cleared");
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["tiff-files"] });
    },
    onError: (e) => toast.error(e.message),
  });

  // Selection logic with Ctrl+Click and Shift+Click
  const handleRowClick = useCallback((id: string, idx: number, e: React.MouseEvent) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedIdx !== null) {
        const start = Math.min(lastClickedIdx, idx);
        const end = Math.max(lastClickedIdx, idx);
        for (let i = start; i <= end; i++) {
          next.add(files[i].id);
        }
      } else if (e.ctrlKey || e.metaKey) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        if (next.size === 1 && next.has(id)) {
          next.clear();
        } else {
          next.clear();
          next.add(id);
        }
      }
      return next;
    });
    setLastClickedIdx(idx);
  }, [files, lastClickedIdx]);

  const selectAll = useCallback(() => {
    if (selectedIds.size === files.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(files.map((f) => f.id)));
    }
  }, [files, selectedIds]);

  // Derived selection info
  const selectedFiles = useMemo(() =>
    files.filter((f) => selectedIds.has(f.id)), [files, selectedIds]);

  const hasTestedSelected = selectedFiles.some(
    (f) => f.status === "completed" && f.original_backed_up && !f.original_deleted
  );
  const hasQueueableSelected = selectedFiles.some(
    (f) => f.status === "scanned" || f.status === "failed"
  );

  // Auto-refresh while there are processing jobs
  const hasProcessing = files.some((f) =>
    ["queued_test", "queued_process", "processing", "queued_delete"].includes(f.status)
  );
  useEffect(() => {
    if (!hasProcessing) return;
    const interval = setInterval(() => refetch(), 5000);
    return () => clearInterval(interval);
  }, [hasProcessing, refetch]);

  return (
    <div className="space-y-4">
      {/* Summary + Actions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileImage className="h-4 w-4" /> TIFF Compression Hygiene
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="default" size="sm"
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending || isAgentScanning}
              className="gap-1.5"
            >
              {(scanMutation.isPending || isAgentScanning) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {isAgentScanning ? "Scanning..." : "Scan for TIFFs"}
            </Button>
            {files.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => {
                if (confirm("Clear all TIFF scan results?")) clearMutation.mutate();
              }} disabled={clearMutation.isPending} className="text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Summary stats */}
          <div className="flex flex-wrap gap-4 text-xs font-mono mb-4">
            <div>Total: <span className="font-semibold text-foreground">{summary.total ?? 0}</span></div>
            <div>Uncompressed: <span className="font-semibold text-destructive">{summary.uncompressed ?? 0}</span></div>
            <div>Compressed: <span className="font-semibold text-[hsl(var(--success))]">{summary.compressed ?? 0}</span></div>
            <div>Processed: <span className="font-semibold text-[hsl(var(--info))]">{summary.processed ?? 0}</span></div>
            <div>Pending: <span className="font-semibold text-primary">{summary.pending ?? 0}</span></div>
            <div>Failed: <span className="font-semibold text-destructive">{summary.failed ?? 0}</span></div>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 mb-3">
            {(["all", "uncompressed", "compressed"] as const).map((f) => (
              <Button
                key={f} variant={filter === f ? "default" : "ghost"} size="sm"
                className="text-xs h-7"
                onClick={() => { setFilter(f); setSelectedIds(new Set()); }}
              >
                {f === "all" ? "All" : f === "uncompressed" ? "Uncompressed" : "Compressed"}
              </Button>
            ))}
          </div>

          {/* Selection action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 mb-3 p-2 rounded-md bg-primary/5 border border-primary/20">
              <span className="text-xs text-muted-foreground font-medium">
                {selectedIds.size} selected
              </span>
              <div className="flex-1" />
              {hasQueueableSelected && (
                <>
                  <Button
                    variant="outline" size="sm" className="gap-1.5 text-xs h-7"
                    onClick={() => {
                      const ids = selectedFiles
                        .filter((f) => f.status === "scanned" || f.status === "failed")
                        .map((f) => f.id);
                      if (ids.length > 0) queueMutation.mutate({ ids, mode: "test" });
                    }}
                    disabled={queueMutation.isPending}
                  >
                    <TestTube className="h-3 w-3" /> Test
                  </Button>
                  <Button
                    variant="default" size="sm" className="gap-1.5 text-xs h-7"
                    onClick={() => {
                      const ids = selectedFiles
                        .filter((f) => f.status === "scanned" || f.status === "failed")
                        .map((f) => f.id);
                      if (ids.length > 0 && confirm(`Process ${ids.length} file(s)? Originals will be replaced in-place.`))
                        queueMutation.mutate({ ids, mode: "process" });
                    }}
                    disabled={queueMutation.isPending}
                  >
                    <Play className="h-3 w-3" /> Process
                  </Button>
                </>
              )}
              {hasTestedSelected && (
                <Button
                  variant="destructive" size="sm" className="gap-1.5 text-xs h-7"
                  onClick={() => {
                    const ids = selectedFiles
                      .filter((f) => f.status === "completed" && f.original_backed_up && !f.original_deleted)
                      .map((f) => f.id);
                    if (ids.length > 0 && confirm(`Delete ${ids.length} original (_big) backup(s)?`))
                      deleteMutation.mutate(ids);
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3 w-3" /> Delete Originals
                </Button>
              )}
              <Button variant="ghost" size="sm" className="text-xs h-7"
                onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </div>
          )}

          {/* File table */}
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : files.length === 0 ? (
            isAgentScanning ? (
              <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p>Waiting for Windows Agent to scan the filesystem...</p>
                <p className="text-[10px]">The agent will pick up the request on its next heartbeat (~30s). Results will appear automatically.</p>
                <Button
                  variant="ghost" size="sm" className="text-xs text-destructive mt-2"
                  onClick={async () => {
                    try {
                      await call("set-config", { entries: { TIFF_SCAN_REQUEST: { status: "cancelled" } } });
                      setScanPending(false);
                      queryClient.invalidateQueries({ queryKey: ["tiff-scan-request"] });
                      toast.info("Scan request cancelled");
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  <X className="h-3 w-3 mr-1" /> Cancel Scan
                </Button>
              </div>
            ) : scanReqStatus === "error" && scanReqError ? (
              <div className="flex flex-col items-center gap-2 py-8 text-sm">
                <p className="text-destructive font-medium">TIFF scan failed</p>
                <p className="text-muted-foreground text-xs max-w-md text-center">{scanReqError}</p>
                <p className="text-[10px] text-muted-foreground">Fix the issue above and try again.</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No TIFF files found. Click "Scan for TIFFs" to crawl the filesystem.
              </p>
            )
          ) : (
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={selectedIds.size === files.length && files.length > 0}
                        onCheckedChange={selectAll}
                      />
                    </TableHead>
                    <TableHead className="text-xs">File</TableHead>
                    <TableHead className="text-xs w-20">Size</TableHead>
                    <TableHead className="text-xs w-24">Modified</TableHead>
                    <TableHead className="text-xs w-24">Created</TableHead>
                    <TableHead className="text-xs w-20">Compress.</TableHead>
                    <TableHead className="text-xs w-20">Status</TableHead>
                    {/* Result columns */}
                    <TableHead className="text-xs w-20">New Size</TableHead>
                    <TableHead className="text-xs w-24">New Modified</TableHead>
                    <TableHead className="text-xs w-24">New Created</TableHead>
                    <TableHead className="text-xs w-16">Savings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((file, idx) => {
                    const isSelected = selectedIds.has(file.id);
                    const savings = file.new_file_size && file.file_size > 0
                      ? Math.round((1 - file.new_file_size / file.file_size) * 100)
                      : null;

                    return (
                      <TableRow
                        key={file.id}
                        className={`cursor-pointer select-none ${isSelected ? "bg-primary/10" : ""}`}
                        onClick={(e) => handleRowClick(file.id, idx, e)}
                        data-state={isSelected ? "selected" : undefined}
                      >
                        <TableCell className="py-1.5">
                          <Checkbox checked={isSelected} tabIndex={-1} />
                        </TableCell>
                        <TableCell className="py-1.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium truncate max-w-[300px]" title={file.relative_path}>
                              {file.filename}
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate max-w-[300px]" title={file.relative_path}>
                              {file.relative_path.replace(`/${file.filename}`, "").replace(file.filename, "")}
                            </span>
                          </div>
                          {file.error_message && (
                            <span className="text-[10px] text-destructive block">{file.error_message}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs py-1.5 font-mono">{formatBytes(file.file_size)}</TableCell>
                        <TableCell className="text-xs py-1.5">{formatDate(file.file_modified_at)}</TableCell>
                        <TableCell className="text-xs py-1.5">{formatDate(file.file_created_at)}</TableCell>
                        <TableCell className="py-1.5"><CompressionBadge type={file.compression_type} /></TableCell>
                        <TableCell className="py-1.5"><StatusBadge status={file.status} /></TableCell>
                        <TableCell className="text-xs py-1.5 font-mono">
                          {file.new_file_size ? formatBytes(file.new_file_size) : "—"}
                        </TableCell>
                        <TableCell className="text-xs py-1.5">
                          {file.new_file_modified_at ? formatDate(file.new_file_modified_at) : "—"}
                        </TableCell>
                        <TableCell className="text-xs py-1.5">
                          {file.new_file_created_at ? formatDate(file.new_file_created_at) : "—"}
                        </TableCell>
                        <TableCell className="text-xs py-1.5 font-mono">
                          {savings !== null ? (
                            <span className={savings > 0 ? "text-[hsl(var(--success))]" : "text-muted-foreground"}>
                              {savings > 0 ? `-${savings}%` : `${savings}%`}
                            </span>
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground mt-2">
            Ctrl+Click to select multiple • Shift+Click to select range • Test saves backup as <code>*_big.tif</code> • Process replaces in-place after verification
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
