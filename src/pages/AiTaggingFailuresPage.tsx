import { forwardRef, useMemo } from "react";
import { formatDateTime } from "@/lib/format-date";
import { Link, useSearchParams } from "react-router-dom";
import type { LinkProps } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ChevronLeft, RefreshCw } from "lucide-react";
import { timeAgo } from "@/components/settings/diagnostics/types";

const CONFIG_KEY = "BULK_OPERATIONS";

// ForwardRef wrapper for Link to work with Radix asChild pattern
const LinkWithRef = forwardRef<HTMLAnchorElement, LinkProps & React.AnchorHTMLAttributes<HTMLAnchorElement>>(
  (props, ref) => <Link {...props} ref={ref} />
);

type FailureSample = {
  at?: string;
  asset_id: string;
  filename?: string;
  relative_path?: string;
  http_status?: number;
  error: string;
};

export default function AiTaggingFailuresPage() {
  const { call } = useAdminApi();
  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin();
  const [searchParams] = useSearchParams();

  const opKey = searchParams.get("op") || "ai-tag-untagged";

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ai-tag-failures", opKey],
    queryFn: async () => {
      const res = await call("get-config", { keys: [CONFIG_KEY] });
      const ops = (res?.config?.[CONFIG_KEY]?.value ?? res?.config?.[CONFIG_KEY]) as Record<string, any> | undefined;
      const op = ops?.[opKey] ?? null;
      const samples = (op?.progress?.failure_samples ?? []) as FailureSample[];
      return { op, samples };
    },
    refetchInterval: 5000,
    enabled: !isAdminLoading && isAdmin,
  });

  const samples = data?.samples ?? [];
  const op = data?.op ?? null;

  const sorted = useMemo(() => {
    return [...samples].sort((a, b) => {
      const atA = a.at ? new Date(a.at).getTime() : 0;
      const atB = b.at ? new Date(b.at).getTime() : 0;
      return atB - atA;
    });
  }, [samples]);

  return (
    <div className="container max-w-5xl py-8 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h1 className="text-2xl font-semibold">AI Tagging Failures</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Showing per-asset failures captured during the current/most recent <code className="font-mono text-xs">{opKey}</code> run.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <LinkWithRef to="/settings" className="gap-1.5">
              <ChevronLeft className="h-4 w-4" /> Back to Settings
            </LinkWithRef>
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => refetch()}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {!isAdminLoading && !isAdmin && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Admins only</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You don’t have permission to view bulk-operation failure details.
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Run summary</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <div className="font-medium">{op?.status ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Run ID</div>
                  <div className="font-mono text-xs break-all">{op?.run_id ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Last update</div>
                  <div className="font-medium">
                    {op?.updated_at ? `${timeAgo(op.updated_at)} (${formatDateTime(op.updated_at)})` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Failure samples stored</div>
                  <div className="font-medium">{sorted.length.toLocaleString()}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Note: for safety, the system caps stored failure samples (latest ~200) to avoid bloating persistent state.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Failures</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : sorted.length === 0 ? (
                <p className="text-sm text-muted-foreground">No failure samples recorded for this run.</p>
              ) : (
                <div className="overflow-auto border border-border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File</TableHead>
                        <TableHead>Asset ID</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead className="text-right">When</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sorted.map((f, idx) => (
                        <TableRow key={`${f.asset_id}-${idx}`}>
                          <TableCell className="text-xs font-mono max-w-[360px] truncate">
                            {f.relative_path || f.filename || "—"}
                          </TableCell>
                          <TableCell className="text-xs font-mono">{f.asset_id}</TableCell>
                          <TableCell className="text-xs text-destructive max-w-[520px]">
                            <div className="space-y-1">
                              <div className="break-words">{f.error || "Unknown error"}</div>
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
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
