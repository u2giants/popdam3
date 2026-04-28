import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { timeAgo } from "./types";

type ErrorSource = "processing" | "render" | "crawl";

interface ErrorEntry {
  id: string;
  source: ErrorSource;
  label: string;
  error_message: string | null;
  ts: string;
}

const SOURCE_LABELS: Record<ErrorSource, string> = {
  processing: "AI/Metadata Job",
  render:     "Render Job",
  crawl:      "Style Guide Crawl",
};

const SOURCE_VARIANTS: Record<ErrorSource, "destructive" | "secondary" | "outline"> = {
  processing: "destructive",
  render:     "secondary",
  crawl:      "outline",
};

async function fetchErrorHistory(): Promise<ErrorEntry[]> {
  const [pq, rq, cr] = await Promise.all([
    supabase
      .from("processing_queue")
      .select("id, job_type, error_message, completed_at")
      .eq("status", "failed")
      .order("completed_at", { ascending: false })
      .limit(50),
    supabase
      .from("render_queue")
      .select("id, error_message, completed_at")
      .eq("status", "failed")
      .order("completed_at", { ascending: false })
      .limit(50),
    supabase
      .from("style_guide_crawl_runs")
      .select("id, error_message, completed_at, agent_id")
      .eq("status", "failed")
      .order("completed_at", { ascending: false })
      .limit(20),
  ]);

  const entries: ErrorEntry[] = [];

  for (const row of pq.data ?? []) {
    if (!row.completed_at) continue;
    entries.push({
      id: row.id,
      source: "processing",
      label: row.job_type ?? "job",
      error_message: row.error_message,
      ts: row.completed_at,
    });
  }

  for (const row of rq.data ?? []) {
    if (!row.completed_at) continue;
    entries.push({
      id: row.id,
      source: "render",
      label: "thumbnail",
      error_message: row.error_message,
      ts: row.completed_at,
    });
  }

  for (const row of cr.data ?? []) {
    if (!row.completed_at) continue;
    entries.push({
      id: row.id,
      source: "crawl",
      label: row.agent_id ? `agent ${String(row.agent_id).slice(0, 8)}` : "crawl",
      error_message: row.error_message,
      ts: row.completed_at,
    });
  }

  return entries.sort((a, b) => b.ts.localeCompare(a.ts));
}

export function ErrorHistoryPanel() {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["error-history"],
    queryFn: fetchErrorHistory,
    refetchInterval: 30_000,
  });

  if (isLoading) return null;
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Error History
          <Badge variant="destructive" className="ml-1 text-xs">{entries.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-2 font-medium text-muted-foreground w-36">Time</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground w-32">Source</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground w-28">Detail</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Error</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                    <span title={new Date(e.ts).toLocaleString()}>{timeAgo(e.ts)}</span>
                    <div className="text-[10px] text-muted-foreground/60">
                      {new Date(e.ts).toLocaleString()}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={SOURCE_VARIANTS[e.source]} className="text-[10px] px-1.5 py-0">
                      {SOURCE_LABELS[e.source]}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 font-mono text-muted-foreground">{e.label}</td>
                  <td className="px-4 py-2 text-destructive max-w-[400px]">
                    <span className="line-clamp-2" title={e.error_message ?? ""}>{e.error_message || "—"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-xs text-muted-foreground border-t border-border/50">
          Last 50 AI/metadata job failures · Last 50 render failures · Last 20 crawl failures. Auto-refreshes every 30s.
        </p>
      </CardContent>
    </Card>
  );
}
