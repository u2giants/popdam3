import { useMemo, Suspense, lazy } from "react";
import { BarChart3 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
const ThroughputChart = lazy(() => import("@/components/settings/ThroughputChart"));

export interface HistoryPoint {
  ts: string;
  ingested_new?: number;
  updated_existing?: number;
  moved_detected?: number;
  errors?: number;
  files_checked?: number;
}

export function AgentThroughputChart() {
  const { call } = useAdminApi();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-agents"],
    queryFn: () => call("list-agents"),
  });

  const chartData = useMemo(() => {
    const agents = data?.agents || [];
    const allPoints: { time: string; ingested: number; updated: number; moved: number; errors: number }[] = [];

    for (const agent of agents) {
      const metadata = (agent as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
      const history = (metadata?.heartbeat_history || (agent as Record<string, unknown>).heartbeat_history) as HistoryPoint[] | undefined;
      if (!Array.isArray(history)) continue;

      for (const point of history) {
        allPoints.push({
          time: new Date(point.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          ingested: point.ingested_new ?? 0,
          updated: point.updated_existing ?? 0,
          moved: point.moved_detected ?? 0,
          errors: point.errors ?? 0,
        });
      }
    }

    return allPoints.slice(-60);
  }, [data]);

  if (isLoading) return null;
  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Throughput
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No heartbeat history yet. Data appears after the Bridge Agent sends several heartbeats.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> Throughput (Recent Heartbeats)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[220px] w-full">
          <Suspense fallback={null}>
            <ThroughputChart chartData={chartData} />
          </Suspense>
        </div>
        <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" /> Ingested</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[hsl(var(--info))]" /> Updated</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[hsl(var(--success))]" /> Moved</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" /> Errors</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tooltip-wrapped tab trigger ─────────────────────────────────────
