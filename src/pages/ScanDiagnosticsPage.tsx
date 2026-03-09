import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, ChevronLeft, RefreshCw, CheckCircle2,
  XCircle, FolderX, FileWarning, Shield, Clock, ServerCrash,
} from "lucide-react";
import { timeAgo } from "@/components/settings/diagnostics/types";

/**
 * Translates raw scan error strings + counters into plain-English explanations.
 */
function explainScanError(error: string | undefined): { headline: string; detail: string; suggestion: string } {
  if (!error) {
    return {
      headline: "Scan failed with no error message",
      detail: "The Bridge Agent reported a failure but did not include an error message.",
      suggestion: "Restart the Bridge Agent and try scanning again. If the problem persists, check that the agent container has enough memory and that Docker isn't restarting it due to OOM.",
    };
  }

  const lower = error.toLowerCase();

  if (lower.includes("enoent") || lower.includes("not a directory") || lower.includes("no such file") || lower.includes("roots_invalid")) {
    return {
      headline: "Scan root folder not found",
      detail: `The agent tried to scan a configured root folder but it doesn't exist on disk: "${error}"`,
      suggestion: "Check your SCAN_ROOTS configuration in Settings. Make sure the NAS volume is mounted and the folder paths match exactly. The Docker container must map the NAS share to the configured mount path.",
    };
  }

  if (lower.includes("eacces") || lower.includes("permission denied") || lower.includes("roots_unreadable")) {
    return {
      headline: "Permission denied reading scan root",
      detail: `The agent doesn't have read access to one or more configured folders: "${error}"`,
      suggestion: "Check file permissions on the NAS share. The Docker container user must have read access to all configured scan roots. On Synology, ensure the shared folder permissions include the Docker user.",
    };
  }

  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("statement timeout")) {
    return {
      headline: "Database timeout during scan",
      detail: `A database operation timed out while the agent was reporting scan results: "${error}"`,
      suggestion: "This usually means the database is under heavy load. Wait a few minutes and try again. If scans consistently time out, consider reducing the scan batch size in admin config.",
    };
  }

  if (lower.includes("connection") || lower.includes("network") || lower.includes("fetch failed") || lower.includes("sendrequest")) {
    return {
      headline: "Network error during scan",
      detail: `The agent lost connectivity to the cloud API: "${error}"`,
      suggestion: "Check the agent's internet connection. If using Tailscale, verify the connection is active. The agent auto-retries transient errors, so this likely means the connection was down for an extended period.",
    };
  }

  if (lower.includes("docker") || lower.includes("oom") || lower.includes("killed") || lower.includes("signal")) {
    return {
      headline: "Agent process was terminated",
      detail: `The agent process was killed, likely by Docker or the OS: "${error}"`,
      suggestion: "Check Docker container resource limits. The agent may need more memory. On Synology, check Container Manager for restart events.",
    };
  }

  if (lower.includes("files_checked") && lower.includes("0")) {
    return {
      headline: "Scan found zero files",
      detail: "The scan completed but checked zero files, which likely means the scan roots are empty or misconfigured.",
      suggestion: "Verify that SCAN_ROOTS points to directories that actually contain .psd, .ai, .jpg, or .png files. Also check that SCAN_MIN_DATE isn't filtering out all files.",
    };
  }

  // Generic fallback
  return {
    headline: "Scan encountered an error",
    detail: error,
    suggestion: "Try running the scan again. If the error persists, check the Bridge Agent container logs in Synology Container Manager for more context.",
  };
}

type ScanCounters = Record<string, number>;

function CounterRow({ label, value, icon: Icon, variant }: {
  label: string;
  value: number;
  icon: React.ElementType;
  variant?: "error" | "warning" | "success";
}) {
  if (value === 0 && !variant) return null;
  const colorClass = variant === "error" ? "text-destructive" :
    variant === "warning" ? "text-[hsl(var(--warning))]" :
    variant === "success" ? "text-[hsl(var(--success))]" : "text-foreground";

  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className={`h-4 w-4 shrink-0 ${colorClass}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ml-auto ${colorClass}`}>{value.toLocaleString()}</span>
    </div>
  );
}

export default function ScanDiagnosticsPage() {
  const { call } = useAdminApi();
  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["scan-diagnostics"],
    queryFn: async () => {
      const res = await call("get-config", { keys: ["SCAN_PROGRESS", "SCAN_REQUEST"] });
      const progress = (res?.config?.SCAN_PROGRESS?.value ?? res?.config?.SCAN_PROGRESS) as Record<string, unknown> | null;
      const request = (res?.config?.SCAN_REQUEST?.value ?? res?.config?.SCAN_REQUEST) as Record<string, unknown> | null;
      return { progress, request };
    },
    refetchInterval: 10_000,
    enabled: !isAdminLoading && isAdmin,
  });

  const progress = data?.progress;
  const request = data?.request;
  const status = (progress?.status as string) || "idle";
  const error = (progress?.error as string) || (request?.error as string) || undefined;
  const counters = (progress?.counters as ScanCounters) || {};
  const skippedDirs = Array.isArray(progress?.skipped_dirs) ? progress.skipped_dirs as string[] : [];
  const updatedAt = progress?.updated_at as string | undefined;
  const sessionId = progress?.session_id as string | undefined;

  const isFailed = status === "failed" || status === "error";
  const isCompletedWithErrors = status === "completed_with_errors";
  const explanation = isFailed ? explainScanError(error) : null;

  return (
    <div className="container max-w-4xl py-8 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <ServerCrash className="h-5 w-5 text-destructive" />
            <h1 className="text-2xl font-semibold">Scan Diagnostics</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Detailed breakdown of the last scan status, errors, and counters.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings" className="gap-1.5">
              <ChevronLeft className="h-4 w-4" /> Settings
            </Link>
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => refetch()}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {!isAdminLoading && !isAdmin && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Admin access required.</CardContent>
        </Card>
      )}

      {isAdmin && (
        <>
          {/* Status summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {isFailed ? <XCircle className="h-4 w-4 text-destructive" /> :
                 isCompletedWithErrors ? <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))]" /> :
                 status === "completed" || status === "done" ? <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" /> :
                 <Clock className="h-4 w-4" />}
                Scan Status
                <Badge variant={isFailed ? "destructive" : isCompletedWithErrors ? "outline" : status === "completed" || status === "done" ? "secondary" : "outline"}
                  className={isCompletedWithErrors ? "border-[hsl(var(--warning))] text-[hsl(var(--warning))]" : ""}>
                  {isCompletedWithErrors ? "completed with errors" : status}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Last Updated</div>
                  <div className="font-medium">
                    {updatedAt ? `${timeAgo(updatedAt)} · ${new Date(updatedAt).toLocaleString()}` : "—"}
                  </div>
                </div>
                {sessionId && (
                  <div>
                    <div className="text-xs text-muted-foreground">Session ID</div>
                    <div className="font-mono text-xs break-all">{sessionId}</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Error explanation — the main value of this page */}
          {isFailed && explanation && (
            <Card className="border-destructive/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  {explanation.headline}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">What happened</div>
                  <p className="text-sm">{explanation.detail}</p>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">What to do</div>
                  <p className="text-sm">{explanation.suggestion}</p>
                </div>
                {error && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Raw error</div>
                    <pre className="text-xs font-mono bg-muted/50 rounded-md p-2 whitespace-pre-wrap break-all text-destructive">
                      {error}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Counters */}
          {Object.keys(counters).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Scan Counters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <CounterRow label="Total files encountered" value={counters.files_total_encountered ?? counters.files_checked ?? 0} icon={FileWarning} />
                <CounterRow label="Files checked (design files)" value={counters.files_checked ?? 0} icon={FileWarning} />
                <CounterRow label="Candidates found" value={counters.candidates_found ?? 0} icon={CheckCircle2} />
                <CounterRow label="New assets ingested" value={counters.ingested_new ?? 0} icon={CheckCircle2} variant="success" />
                <CounterRow label="Existing assets updated" value={counters.updated_existing ?? 0} icon={RefreshCw} />
                <CounterRow label="Moves detected" value={counters.moved_detected ?? 0} icon={RefreshCw} />
                <CounterRow label="Unchanged (no-op)" value={counters.noop_unchanged ?? 0} icon={CheckCircle2} />

                {/* Error counters */}
                <div className="pt-2 border-t border-border mt-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Errors & Skips</p>
                  <div className="space-y-1.5">
                    <CounterRow label="Scan roots invalid (missing)" value={counters.roots_invalid ?? 0} icon={FolderX} variant={counters.roots_invalid > 0 ? "error" : undefined} />
                    <CounterRow label="Scan roots unreadable (permission)" value={counters.roots_unreadable ?? 0} icon={Shield} variant={counters.roots_unreadable > 0 ? "error" : undefined} />
                    <CounterRow label="Directories skipped (permission)" value={counters.dirs_skipped_permission ?? 0} icon={Shield} variant={counters.dirs_skipped_permission > 0 ? "warning" : undefined} />
                    <CounterRow label="Directories skipped (excluded)" value={counters.dirs_skipped_excluded ?? 0} icon={FolderX} />
                    <CounterRow label="Files stat() failed" value={counters.files_stat_failed ?? 0} icon={FileWarning} variant={counters.files_stat_failed > 0 ? "error" : undefined} />
                    <CounterRow label="Rejected: wrong type" value={counters.rejected_wrong_type ?? 0} icon={FileWarning} />
                    <CounterRow label="Rejected: junk file" value={counters.rejected_junk_file ?? 0} icon={FileWarning} />
                    <CounterRow label="Rejected: subfolder filter" value={counters.rejected_subfolder ?? 0} icon={FolderX} />
                    <CounterRow label="Total errors" value={counters.errors ?? 0} icon={XCircle} variant={counters.errors > 0 ? "error" : undefined} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Skipped directories */}
          {skippedDirs.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FolderX className="h-4 w-4 text-[hsl(var(--warning))]" />
                  Skipped Directories ({skippedDirs.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-60 overflow-auto rounded-md border border-border">
                  <div className="divide-y divide-border">
                    {skippedDirs.map((dir, i) => (
                      <div key={i} className="px-3 py-1.5 text-xs font-mono text-muted-foreground">
                        {dir}
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  These directories were skipped due to permissions, exclusion filters, or the agent couldn't read them.
                </p>
              </CardContent>
            </Card>
          )}

          {/* No data state */}
          {!isLoading && !progress && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground text-center">
                No scan data available yet. Run a scan from the Library page to see diagnostics here.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
