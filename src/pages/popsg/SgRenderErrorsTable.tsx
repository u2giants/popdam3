import { MAX_BATCH_LOOPS } from "./render-settings";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RotateCcw, RefreshCw } from "lucide-react";
import { toast } from "sonner";

function formatSgThumbnailError(raw: string): string {
  if (!raw) return "Unknown error";
  if (raw === "no_pdf_compat") return "AI file saved without PDF compatibility";
  if (raw === "no_preview_or_render_failed") return "All render methods failed";
  if (raw.startsWith("Skipped:")) return raw;
  const match = raw.match(/^render_failed:\s*(.+)$/i);
  if (match) {
    const methods = match[1].split("|").map((p) => p.split(":")[0]?.trim()).filter(Boolean);
    return `Render failed (tried: ${methods.join(" → ")})`;
  }
  return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
}

// ── SG Render Errors Table ──────────────────────────────────────────

type SgErroredFile = {
  id: string;
  relative_path: string | null;
  file_extension: string | null;
  thumbnail_error: string | null;
};

export function SgRenderErrorsTable({ totalErrored }: { totalErrored?: number }) {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const COLLAPSED_LIMIT = 20;

  const { data: erroredFiles = [], isLoading, refetch } = useQuery({
    queryKey: ["popsg", "sg_errored_files"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("style_guide_files")
        .select("id, relative_path, file_extension, thumbnail_error")
        .eq("is_active", true)
        .is("thumbnail_url", null)
        .not("thumbnail_error", "is", null)
        .order("thumbnail_error")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as SgErroredFile[];
    },
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["popsg", "sg_errored_files"] });
    queryClient.invalidateQueries({ queryKey: ["popsg", "preview_stats"] });
    queryClient.invalidateQueries({ queryKey: ["popsg", "render_queue_stats"] });
  };

  const retryOneMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const { error } = await supabase.rpc("retry_sg_render_errors", { p_file_ids: [fileId] });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("File requeued for rendering"); invalidate(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const retryAllMutation = useMutation({
    mutationFn: async () => {
      let total = 0;
      // Loop in batches of 500 — each call is bounded so it completes within
      // the DB proxy's statement timeout. Stops when the function returns 0.
      for (let batch = 0; ; batch++) {
        if (batch >= MAX_BATCH_LOOPS) throw new Error("Stopped after too many batches; run it again to continue.");
        const { data, error } = await supabase.rpc("retry_sg_render_errors", { p_limit: 500 });
        if (error) throw error;
        const queued = data as number;
        total += queued;
        if (queued === 0) break;
      }
      return total;
    },
    onSuccess: (count) => { toast.success(`${count} files requeued`); invalidate(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const visibleFiles = showAll ? erroredFiles : erroredFiles.slice(0, COLLAPSED_LIMIT);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">Files with Render Errors</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Queried from the files table — persists even after failed jobs are cleared from the queue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {erroredFiles.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => retryAllMutation.mutate()}
              disabled={retryAllMutation.isPending}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {retryAllMutation.isPending ? "Requeueing…" : `Retry All (${(totalErrored ?? erroredFiles.length).toLocaleString()})`}
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : erroredFiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No render errors.</p>
        ) : (
          <>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">File</th>
                    <th className="px-3 py-1.5 text-left font-medium">Type</th>
                    <th className="px-3 py-1.5 text-left font-medium">Error</th>
                    <th className="px-3 py-1.5 text-left font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {visibleFiles.map((f) => (
                    <tr key={f.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-1.5 font-mono max-w-[260px] truncate" title={f.relative_path ?? ""}>
                        {f.relative_path?.split("/").pop() ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground uppercase">
                        {f.file_extension ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-destructive max-w-[300px] truncate" title={f.thumbnail_error ?? ""}>
                        {formatSgThumbnailError(f.thumbnail_error ?? "")}
                      </td>
                      <td className="px-3 py-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Retry this file"
                          onClick={() => retryOneMutation.mutate(f.id)}
                          disabled={retryOneMutation.isPending}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {erroredFiles.length > COLLAPSED_LIMIT && (
              <div className="flex justify-center pt-2">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground"
                  onClick={() => setShowAll(!showAll)}>
                  {showAll ? `Collapse to ${COLLAPSED_LIMIT} rows` : `Show all ${erroredFiles.length.toLocaleString()} files`}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
