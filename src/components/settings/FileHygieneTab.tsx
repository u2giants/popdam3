import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  RefreshCw, Search, Loader2, ShieldAlert, Eye, EyeOff, FileWarning,
  ArrowUpDown, ArrowUp, ArrowDown, CheckCircle2, XCircle, AlertTriangle,
} from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScanProgressPanel } from "./ScanProgressPanel";

interface HygieneFinding {
  id: string;
  asset_id: string | null;
  relative_path: string;
  filename: string;
  check_type: string;
  severity: string;
  status: string;
  details: Record<string, unknown>;
  found_by_agent: string | null;
  found_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    critical: {
      label: "Critical",
      className: "bg-destructive/15 text-destructive",
      icon: <XCircle className="h-3 w-3" />,
    },
    warning: {
      label: "Warning",
      className: "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]",
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    info: {
      label: "Info",
      className: "bg-[hsl(var(--info)/0.15)] text-[hsl(var(--info))]",
      icon: <Eye className="h-3 w-3" />,
    },
  };
  const config = map[severity] || map.info;
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${config.className}`}>
      {config.icon} {config.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    open: { label: "Open", className: "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]" },
    dismissed: { label: "Dismissed", className: "bg-secondary text-secondary-foreground" },
    resolved: { label: "Resolved", className: "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]" },
  };
  const config = map[status] || { label: status, className: "bg-secondary text-secondary-foreground" };
  return <Badge variant="outline" className={`text-[10px] ${config.className}`}>{config.label}</Badge>;
}

function CheckTypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; className: string }> = {
    ai_embedded_raster: { label: "AI Embedded Raster", className: "bg-primary/15 text-primary" },
    tiff_uncompressed: { label: "TIFF Uncompressed", className: "bg-[hsl(var(--info)/0.15)] text-[hsl(var(--info))]" },
    psd_oversized_layer: { label: "PSD Oversized Layer", className: "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]" },
  };
  const config = map[type] || { label: type, className: "bg-secondary text-secondary-foreground" };
  return <Badge variant="outline" className={`text-[10px] ${config.className}`}>{config.label}</Badge>;
}

export default function FileHygieneTab() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "open" | "dismissed" | "resolved">("open");
  const [checkTypeFilter, setCheckTypeFilter] = useState<string>("all");
  const [scanPending, setScanPending] = useState(false);
  const [sortField, setSortField] = useState<"relative_path" | "found_at" | "severity">("found_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["hygiene-findings", filter, checkTypeFilter],
    queryFn: () => call("list-hygiene-findings", {
      status: filter === "all" ? undefined : filter,
      check_type: checkTypeFilter === "all" ? undefined : checkTypeFilter,
      limit: 500,
    }),
  });

  // Poll for scan completion
  const { data: scanReqData } = useQuery({
    queryKey: ["hygiene-scan-request"],
    queryFn: () => call("get-config", { keys: ["HYGIENE_SCAN_REQUEST"] }),
    refetchInterval: scanPending ? 5000 : false,
  });

  const scanReqValue = (
    scanReqData?.config?.HYGIENE_SCAN_REQUEST?.value ?? scanReqData?.config?.HYGIENE_SCAN_REQUEST
  ) as { status?: string } | undefined;

  const isAgentScanning = scanPending || scanReqValue?.status === "pending" || scanReqValue?.status === "claimed";

  useEffect(() => {
    if (isAgentScanning) {
      setScanPending(true);
      const interval = setInterval(() => {
        refetch();
        queryClient.invalidateQueries({ queryKey: ["hygiene-scan-request"] });
      }, 5000);
      return () => clearInterval(interval);
    } else if (scanPending) {
      setScanPending(false);
      refetch();
    }
  }, [isAgentScanning]); // eslint-disable-line react-hooks/exhaustive-deps

  const rawFindings: HygieneFinding[] = data?.findings || [];
  const summary = data?.summary || {};

  const findings = useMemo(() => {
    const sorted = [...rawFindings];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "found_at":
          cmp = new Date(a.found_at).getTime() - new Date(b.found_at).getTime();
          break;
        case "severity": {
          const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
          cmp = (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
          break;
        }
        default:
          cmp = a.relative_path.localeCompare(b.relative_path);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rawFindings, sortField, sortDir]);

  const toggleSort = useCallback((field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "found_at" ? "desc" : "asc");
    }
  }, [sortField]);

  const scanMutation = useMutation({
    mutationFn: () => call("trigger-hygiene-scan", { check_types: ["ai_embedded_raster"] }),
    onSuccess: () => {
      toast.success("Hygiene scan triggered — Windows Agent will pick it up on next heartbeat (~30s)");
      setScanPending(true);
      queryClient.invalidateQueries({ queryKey: ["hygiene-scan-request"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const stopMutation = useMutation({
    mutationFn: () => call("stop-hygiene-scan", {}),
    onSuccess: () => {
      toast.success("Stop signal sent — scan will halt on the next progress report");
      queryClient.invalidateQueries({ queryKey: ["hygiene-scan-request"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const dismissMutation = useMutation({
    mutationFn: (ids: string[]) => call("update-hygiene-findings", { ids, status: "dismissed" }),
    onSuccess: (_, ids) => {
      toast.success(`${ids.length} finding(s) dismissed`);
      queryClient.invalidateQueries({ queryKey: ["hygiene-findings"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const resolveMutation = useMutation({
    mutationFn: (ids: string[]) => call("update-hygiene-findings", { ids, status: "resolved" }),
    onSuccess: (_, ids) => {
      toast.success(`${ids.length} finding(s) marked resolved`);
      queryClient.invalidateQueries({ queryKey: ["hygiene-findings"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleRowClick = useCallback((id: string, e: React.MouseEvent) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selectedIds.size === findings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(findings.map(f => f.id)));
    }
  }, [findings, selectedIds]);

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> File Hygiene
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
              {(scanMutation.isPending || isAgentScanning)
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Search className="h-3.5 w-3.5" />}
              {isAgentScanning ? "Scanning..." : "Scan AI Files"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Scan Progress Panel */}
          <ScanProgressPanel
            scanRequest={scanReqValue as Record<string, unknown> | undefined}
            triggerPending={scanMutation.isPending}
            label="File Hygiene"
            staleThresholdMs={10 * 60 * 1000}
            onStop={() => stopMutation.mutate()}
            stopPending={stopMutation.isPending}
          />

          {/* Summary stats */}
          <div className="flex flex-wrap gap-4 text-xs font-mono mb-4 mt-3">
            <div>Total: <span className="font-semibold text-foreground">{summary.total ?? 0}</span></div>
            <div>Open: <span className="font-semibold text-[hsl(var(--warning))]">{summary.open ?? 0}</span></div>
            <div>Dismissed: <span className="font-semibold text-muted-foreground">{summary.dismissed ?? 0}</span></div>
            <div>Resolved: <span className="font-semibold text-[hsl(var(--success))]">{summary.resolved ?? 0}</span></div>
          </div>

          {/* Filters */}
          <div className="flex gap-1 mb-3 flex-wrap">
            <div className="flex gap-1">
              {(["all", "open", "dismissed", "resolved"] as const).map(f => (
                <Button
                  key={f} variant={filter === f ? "default" : "ghost"} size="sm"
                  className="text-xs h-7"
                  onClick={() => { setFilter(f); setSelectedIds(new Set()); }}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </Button>
              ))}
            </div>
            <div className="border-l border-border mx-2" />
            <div className="flex gap-1">
              {["all", "ai_embedded_raster"].map(ct => (
                <Button
                  key={ct} variant={checkTypeFilter === ct ? "default" : "ghost"} size="sm"
                  className="text-xs h-7"
                  onClick={() => { setCheckTypeFilter(ct); setSelectedIds(new Set()); }}
                >
                  {ct === "all" ? "All Types" : "AI Embedded Raster"}
                </Button>
              ))}
            </div>
          </div>

          {/* Selection action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 mb-3 p-2 rounded-md bg-primary/5 border border-primary/20">
              <span className="text-xs text-muted-foreground font-medium">
                {selectedIds.size} selected
              </span>
              <div className="flex-1" />
              <Button
                variant="outline" size="sm" className="gap-1.5 text-xs h-7"
                onClick={() => dismissMutation.mutate([...selectedIds])}
                disabled={dismissMutation.isPending}
              >
                <EyeOff className="h-3 w-3" /> Dismiss
              </Button>
              <Button
                variant="default" size="sm" className="gap-1.5 text-xs h-7"
                onClick={() => resolveMutation.mutate([...selectedIds])}
                disabled={resolveMutation.isPending}
              >
                <CheckCircle2 className="h-3 w-3" /> Resolve
              </Button>
            </div>
          )}

          {/* Table */}
          {isLoading ? (
            <div className="flex items-center justify-center p-6 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading findings…
            </div>
          ) : findings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <FileWarning className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>No hygiene findings found.</p>
              <p className="text-xs mt-1">Click "Scan AI Files" to check for embedded rasters.</p>
            </div>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === findings.length && findings.length > 0}
                        onChange={selectAll}
                        className="rounded"
                      />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("relative_path")}
                    >
                      <div className="flex items-center">File <SortIcon field="relative_path" /></div>
                    </TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("severity")}
                    >
                      <div className="flex items-center">Severity <SortIcon field="severity" /></div>
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("found_at")}
                    >
                      <div className="flex items-center">Found <SortIcon field="found_at" /></div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {findings.map(f => (
                    <TableRow
                      key={f.id}
                      className={`text-xs cursor-pointer ${selectedIds.has(f.id) ? "bg-primary/5" : ""}`}
                      onClick={(e) => handleRowClick(f.id, e)}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(f.id)}
                          onChange={() => {}}
                          className="rounded"
                        />
                      </TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="font-mono truncate max-w-[300px] block">
                                {f.filename}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[500px] font-mono text-[10px]">
                              {f.relative_path}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell><CheckTypeBadge type={f.check_type} /></TableCell>
                      <TableCell><SeverityBadge severity={f.severity} /></TableCell>
                      <TableCell><StatusBadge status={f.status} /></TableCell>
                      <TableCell>
                        {f.check_type === "ai_embedded_raster" && f.details && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-[10px] font-mono">
                                  {String(f.details.embedded_count ?? 0)} rasters •{" "}
                                  {formatBytes((f.details.total_embedded_bytes as number) ?? 0)} total
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[400px]">
                                <div className="text-[10px] space-y-1">
                                  <div>Embedded count: {String(f.details.embedded_count ?? 0)}</div>
                                  <div>Total size: {formatBytes((f.details.total_embedded_bytes as number) ?? 0)}</div>
                                  <div>Largest: {formatBytes((f.details.largest_raster_bytes as number) ?? 0)}</div>
                                  <div>Method: {String(f.details.inspection_method ?? "unknown")}</div>
                                  {Array.isArray(f.details.raster_items) && (f.details.raster_items as Array<Record<string, unknown>>).length > 0 && (
                                    <div className="mt-1 border-t border-border pt-1">
                                      {(f.details.raster_items as Array<Record<string, unknown>>).slice(0, 5).map((r: Record<string, unknown>, i: number) => (
                                        <div key={i}>
                                          #{i+1}: {String(r.width)}×{String(r.height)} {String(r.colorSpace)} = {formatBytes((r.estimatedBytes as number) ?? 0)}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(f.found_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
