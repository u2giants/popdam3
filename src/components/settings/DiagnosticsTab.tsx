import { useState, useCallback } from "react";
import DoctorDiagnostics from "@/components/settings/DoctorDiagnostics";
import { useQuery } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Stethoscope } from "lucide-react";
import type { DiagnosticData } from "./diagnostics/types";

// Sub-components
import { OverviewCards, ConnectedAgents, ScanStatusCard, RecentErrors, RenderJobStats, ConfigurationSection } from "./diagnostics/OverviewCards";
import { DatabaseInspector } from "./diagnostics/DatabaseInspector";
import SystemStatePanel from "./diagnostics/SystemStatePanel";

export default function DiagnosticsTab() {
  const { call } = useAdminApi();
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-doctor"],
    queryFn: async () => {
      const result = await call("doctor");
      setLastRefreshed(new Date());
      return result;
    },
    refetchInterval: 30_000,
  });

  const handleRefresh = useCallback(() => { refetch(); }, [refetch]);

  const diag: DiagnosticData | null = data?.diagnostic ?? null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Stethoscope className="h-5 w-5" /> System Health
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {lastRefreshed && <span>Last refreshed: {lastRefreshed.toLocaleTimeString()}</span>}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleRefresh}>
            <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {isLoading && !diag ? (
        <Card>
          <CardContent className="p-6 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading diagnostics…
          </CardContent>
        </Card>
      ) : diag ? (
        <>
          <SystemStatePanel />
          <DoctorDiagnostics />
          <OverviewCards counts={diag.counts} />
          <RenderJobStats />
          <ConnectedAgents agents={diag.agents} />
          <ScanStatusCard progress={diag.scan_progress} />
          <RecentErrors errors={diag.recent_errors} />
          <DatabaseInspector />
          <ConfigurationSection config={diag.config} />
        </>
      ) : (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              Failed to load diagnostics. Click refresh to try again.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
