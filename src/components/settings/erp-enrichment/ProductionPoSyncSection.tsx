import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, Database, CheckCircle2, Loader2, List } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StatCard } from "./QualityDashboard";

// ── Quality Dashboard ────────────────────────────────────────────────

export function ProductionPoSyncSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data: syncRuns, refetch: refetchRuns } = useQuery({
    queryKey: ["prod-order-sync-runs"],
    queryFn: () => call("prod-order-sync-runs"),
  });

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["prod-order-stats"],
    queryFn: () => call("prod-order-stats"),
  });

  const runs = syncRuns?.runs || [];
  const lastRun = runs[0];

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await call("trigger-prod-order-sync", {});
      toast.success(`Production PO sync complete: ${result.total_fetched} fetched, ${result.total_upserted} upserted`);
      refetchRuns();
      refetchStats();
      queryClient.invalidateQueries({ queryKey: ["style-prod-orders"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <CardTitle className="text-base flex items-center gap-2 cursor-help">
                <List className="h-4 w-4" /> Production POs
              </CardTitle>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">Pulls production PO headers from PLM and links them to styles by SKU/style number.</TooltipContent>
          </Tooltip>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => { refetchRuns(); refetchStats(); }}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh production PO status</TooltipContent>
            </Tooltip>
            <Button size="sm" onClick={handleSync} disabled={syncing} className="gap-1.5">
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
              {syncing ? "Syncing..." : "Sync POs"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="POs Synced" value={stats?.total_prod_orders ?? 0} icon={<Database className="h-4 w-4" />} tooltip="Production PO rows currently stored from PLM" />
            <StatCard label="Styles With POs" value={stats?.styles_with_prod_orders ?? 0} icon={<List className="h-4 w-4" />} tooltip="Distinct style numbers that have at least one production PO" />
            <StatCard label="Matched Groups" value={stats?.matched_style_groups ?? 0} icon={<CheckCircle2 className="h-4 w-4" />} tooltip="Stored PO styles that currently match PopDAM style groups" />
          </div>

          {lastRun ? (
            <div className="border border-border rounded-md p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Last PO Sync</span>
                <Badge variant={lastRun.status === "completed" ? "default" : lastRun.status === "running" ? "secondary" : "destructive"}>
                  {lastRun.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5 font-mono">
                <div>Started: {new Date(lastRun.started_at).toLocaleString()}</div>
                {lastRun.ended_at && <div>Duration: {Math.round((new Date(lastRun.ended_at).getTime() - new Date(lastRun.started_at).getTime()) / 1000)}s</div>}
                <div>Fetched: {lastRun.total_fetched} | Upserted: {lastRun.total_upserted} | Errors: {lastRun.total_errors}</div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No production PO sync has run yet.</p>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

// ── Quality Dashboard ────────────────────────────────────────────────
