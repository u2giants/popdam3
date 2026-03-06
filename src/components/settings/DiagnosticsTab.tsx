import { useState, useCallback, useEffect } from "react";
import DoctorDiagnostics from "@/components/settings/DoctorDiagnostics";
import { useQuery } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Stethoscope, ListOrdered } from "lucide-react";
import type { OperationState } from "@/hooks/usePersistentOperation";
import type { DiagnosticData, RequestOpFn } from "./diagnostics/types";
import { OP_NAMES } from "./diagnostics/types";

// Sub-components
import { OverviewCards, ConnectedAgents, ScanStatusCard, RecentErrors, RenderJobStats, ConfigurationSection } from "./diagnostics/OverviewCards";
import { ActionsSection } from "./diagnostics/ActionsSection";
import { AiTaggingSection } from "./diagnostics/AiTaggingSection";
import { StyleGroupsSection } from "./diagnostics/StyleGroupsSection";
import { DatabaseInspector } from "./diagnostics/DatabaseInspector";
import { ConflictDialog, type ConflictState } from "./diagnostics/ConflictDialog";
import { QueueManagerDialog } from "./diagnostics/QueueManagerDialog";

export default function DiagnosticsTab() {
  const { call } = useAdminApi();
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [conflictState, setConflictState] = useState<ConflictState | null>(null);
  const [showQueue, setShowQueue] = useState(false);

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

  // ── requestOp: intercept operation starts to check for conflicts ──
  const requestOp: RequestOpFn = useCallback(async (opKey, opName, startFn, queueFn) => {
    try {
      const res = await call("get-config", { keys: ["BULK_OPERATIONS"] });
      const ops = (res?.config?.BULK_OPERATIONS?.value ?? res?.config?.BULK_OPERATIONS) as Record<string, OperationState> | undefined;
      const activeEntry = ops
        ? Object.entries(ops).find(([k, op]) => (op.status === "running") && k !== opKey)
        : null;

      if (activeEntry) {
        setConflictState({
          isOpen: true,
          newOpKey: opKey,
          newOpName: opName,
          activeOpKey: activeEntry[0],
          activeOpName: OP_NAMES[activeEntry[0]] || activeEntry[0],
          onStart: startFn,
          onQueue: queueFn,
        });
      } else {
        startFn();
      }
    } catch {
      startFn();
    }
  }, [call]);

  // ── Queue data from polled config ──
  const [queuedItems, setQueuedItems] = useState<[string, OperationState][]>([]);

  useEffect(() => {
    let mounted = true;
    const pollQueue = async () => {
      try {
        const res = await call("get-config", { keys: ["BULK_OPERATIONS"] });
        if (!mounted) return;
        const ops = (res?.config?.BULK_OPERATIONS?.value ?? res?.config?.BULK_OPERATIONS) as Record<string, OperationState> | undefined;
        if (ops) {
          const items = Object.entries(ops)
            .filter(([_, op]) => op.status === "queued")
            .sort((a, b) => (a[1].queue_position || 0) - (b[1].queue_position || 0));
          setQueuedItems(items);
        } else {
          setQueuedItems([]);
        }
      } catch { /* ignore */ }
    };
    pollQueue();
    const timer = setInterval(pollQueue, 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Stethoscope className="h-5 w-5" /> System Health
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {queuedItems.length > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5 h-7" onClick={() => setShowQueue(true)}>
              <ListOrdered className="h-3.5 w-3.5" /> Queue ({queuedItems.length})
            </Button>
          )}
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
          <DoctorDiagnostics />
          <OverviewCards counts={diag.counts} />
          <RenderJobStats />
          <ConnectedAgents agents={diag.agents} />
          <ScanStatusCard progress={diag.scan_progress} />
          <RecentErrors errors={diag.recent_errors} />
          <ActionsSection onRefresh={handleRefresh} requestOp={requestOp} />
          <AiTaggingSection requestOp={requestOp} />
          <DatabaseInspector />
          <StyleGroupsSection requestOp={requestOp} />
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

      <ConflictDialog state={conflictState} onClose={() => setConflictState(null)} />
      <QueueManagerDialog
        open={showQueue}
        onOpenChange={setShowQueue}
        queuedItems={queuedItems}
        onQueueChange={setQueuedItems}
      />
    </div>
  );
}
