import { useQuery } from "@tanstack/react-query";
import { Database, Loader2, Play, RefreshCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { toast } from "sonner";

interface Coverage {
  total_documents: number;
  embedded_documents: number;
  pending_documents: number;
  leased_documents: number;
  errored_documents: number;
  exhausted_documents: number;
}

export function SearchIndexCard() {
  const op = usePersistentOperation("embed-dam-search");
  const coverage = useQuery({
    queryKey: ["dam-search-embedding-status"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("dam-search-ai", { body: { action: "embedding-status" } });
      if (error) throw error;
      return data.status as Coverage;
    },
    refetchInterval: op.state.status === "running" ? 3_000 : 30_000,
  });
  const status = coverage.data;
  const percent = status?.total_documents ? Math.round(status.embedded_documents / status.total_documents * 100) : 0;
  const running = op.state.status === "running" || op.state.status === "queued";
  const resetErrors = async () => {
    const { data, error } = await supabase.functions.invoke("dam-search-ai", { body: { action: "reset-embedding-errors" } });
    if (error || data?.ok !== true) return toast.error("Could not requeue terminal search documents");
    toast.success(`Requeued ${Number(data.reset) || 0} search documents`);
    coverage.refetch();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4" /> Smart Search Index</CardTitle>
            <CardDescription>Semantic coverage stays dark until security, quality, and rollback checks pass.</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={() => coverage.refetch()} aria-label="Refresh search coverage">
            <RefreshCw className={`h-4 w-4 ${coverage.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {coverage.isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading coverage…</div> : status ? (
          <>
            <div className="flex justify-between text-sm"><span>{status.embedded_documents.toLocaleString()} of {status.total_documents.toLocaleString()} ready</span><span>{percent}%</span></div>
            <Progress value={percent} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{status.pending_documents.toLocaleString()} pending</span>
              <span>{status.leased_documents.toLocaleString()} in progress</span>
              <span>{status.exhausted_documents.toLocaleString()} terminal</span>
              <span>{status.errored_documents.toLocaleString()} errors</span>
            </div>
          </>
        ) : <p className="text-sm text-destructive">Coverage is unavailable.</p>}
        {op.state.error && <p className="text-xs text-destructive">{op.state.error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={running ? "destructive" : "default"} onClick={() => running ? op.stop() : op.start({ initialProgress: {} })}>
            {running ? <Square className="mr-2 h-3.5 w-3.5" /> : <Play className="mr-2 h-3.5 w-3.5" />}
            {running ? "Stop indexing" : op.state.status === "interrupted" ? "Resume indexing" : "Start indexing"}
          </Button>
          {Boolean(status?.exhausted_documents) && <Button size="sm" variant="outline" onClick={resetErrors}>Requeue terminal errors</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
