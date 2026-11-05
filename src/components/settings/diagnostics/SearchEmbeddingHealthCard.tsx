import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { parseSearchEmbeddingHealth } from "@/lib/search-embedding-health";

export function SearchEmbeddingHealthCard() {
  const health = useQuery({
    queryKey: ["search-embedding-health"],
    queryFn: async () => {
      // New RPC types arrive through the generated shared-db mirror.
      const { data, error } = await supabase.rpc("get_search_embedding_health" as never);
      if (error) throw error;
      return parseSearchEmbeddingHealth(data);
    },
    refetchInterval: 60_000,
  });
  return <Card>
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between gap-3">
        <CardTitle className="text-base">Search indexing health</CardTitle>
        <Button variant="ghost" size="icon" aria-label="Refresh search health" onClick={() => health.refetch()}>
          <RefreshCw className={`h-4 w-4 ${health.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <CardDescription>Alerts when available pictures wait two hours without indexing progress.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {health.isLoading ? <p className="text-sm text-muted-foreground">Checking search health…</p> :
        health.isError ? <div role="alert" className="text-sm text-destructive">
          Search health is unavailable. <Button variant="outline" size="sm" onClick={() => health.refetch()}>Retry</Button>
        </div> : health.data?.map(row => <div key={row.corpus} className="space-y-1 text-sm">
          <p className={row.stale ? "text-destructive" : "font-medium"}>
            {row.corpus === "dam" ? "Artwork library" : "Style guides"}: {row.stale ? "Indexing stalled" : row.pending === 0 ? "Up to date" : "Indexing in progress"}
          </p>
          <p className="text-xs text-muted-foreground">{row.pending.toLocaleString()} waiting · {row.errored.toLocaleString()} errors · Last picture indexed: {row.last_write ? new Date(row.last_write).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" }) : "none yet"}</p>
        </div>)}
    </CardContent>
  </Card>;
}
