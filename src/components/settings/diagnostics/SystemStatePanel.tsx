import { useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

const STATE_KEYS = ["SCAN_REQUEST", "SCAN_PROGRESS", "BULK_OPERATIONS"] as const;
type StateKey = typeof STATE_KEYS[number];

async function fetchSystemState(): Promise<Record<StateKey, unknown>> {
  const { data, error } = await supabase
    .from("admin_config")
    .select("key, value")
    .in("key", STATE_KEYS as unknown as string[]);

  if (error) throw error;

  const result = {} as Record<StateKey, unknown>;
  for (const row of data ?? []) {
    result[row.key as StateKey] = row.value;
  }
  return result;
}

export default function SystemStatePanel() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [clearing, setClearing] = useState<string | null>(null);

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["system-state-raw"],
    queryFn: fetchSystemState,
    staleTime: Infinity,
  });

  useEffect(() => {
    const channel = supabase
      .channel("system-state-realtime")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "admin_config",
        filter: "key=eq.SCAN_REQUEST",
      }, () => queryClient.invalidateQueries({ queryKey: ["system-state-raw"] }))
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "admin_config",
        filter: "key=eq.SCAN_PROGRESS",
      }, () => queryClient.invalidateQueries({ queryKey: ["system-state-raw"] }))
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "admin_config",
        filter: "key=eq.BULK_OPERATIONS",
      }, () => queryClient.invalidateQueries({ queryKey: ["system-state-raw"] }))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const handleClear = useCallback(async (key: string, resetValue: unknown) => {
    setClearing(key);
    try {
      await call("set-config", { entries: { [key]: resetValue } });
      queryClient.invalidateQueries({ queryKey: ["system-state-raw"] });
      toast.success(`${key} cleared`);
    } catch (e) {
      toast.error(`Failed to clear ${key}`, { description: (e as Error).message });
    } finally {
      setClearing(null);
    }
  }, [call, queryClient]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4" /> Raw System State
          </CardTitle>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {dataUpdatedAt > 0 && (
              <span>Updated {new Date(dataUpdatedAt).toLocaleTimeString()}</span>
            )}
            {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {STATE_KEYS.map((key) => {
          const value = data?.[key];
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{key}</span>
                {(key === "SCAN_REQUEST" || key === "SCAN_PROGRESS") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-[10px] text-destructive hover:text-destructive"
                    onClick={() => handleClear(key, { status: "idle" })}
                    disabled={clearing === key} title={clearing === key ? "Clearing…" : undefined}
                  >
                    {clearing === key ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    Force Clear
                  </Button>
                )}
              </div>
              <pre className="text-[10px] font-mono bg-muted/50 rounded-md p-2 overflow-x-auto max-h-48 whitespace-pre-wrap break-all text-foreground/80">
                {value !== undefined ? JSON.stringify(value, null, 2) : "—"}
              </pre>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
