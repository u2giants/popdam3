import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export interface AiDuplicate {
  id: string;
  filename: string;
  relative_path: string;
  has_thumbnail: boolean;
}

export function AiDuplicatesCard() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<AiDuplicate[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  const findMutation = useMutation({
    mutationFn: () => call("find-ai-pdf-duplicates"),
    onSuccess: (res) => {
      const r = res as { count: number; duplicates: AiDuplicate[] };
      setPreview(r.duplicates);
      if (r.count === 0) toast.success("No .ai/.pdf duplicates found");
    },
    onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => call("delete-ai-pdf-duplicates"),
    onSuccess: (res) => {
      const r = res as { deleted: number; thumbnails_deleted: number; message: string };
      toast.success(r.message);
      setPreview(null);
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: ["pdf-text-samples"] });
    },
    onError: (e) => {
      toast.error(`Delete failed: ${(e as Error).message}`);
      setConfirming(false);
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Trash2 className="h-4 w-4" />
            .ai / .pdf Duplicate Cleanup
          </CardTitle>
          <div className="flex items-center gap-2">
            {preview && preview.length > 0 && !confirming && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setConfirming(true)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete {preview.length} .ai files
              </Button>
            )}
            {confirming && (
              <>
                <span className="text-sm text-destructive font-medium">Are you sure?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : "Yes, delete"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={deleteMutation.isPending}>
                  Cancel
                </Button>
              </>
            )}
            {!confirming && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => findMutation.mutate()}
                disabled={findMutation.isPending || deleteMutation.isPending}
              >
                {findMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : "Find Duplicates"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Finds .ai files that have a matching .pdf in the same folder (same base filename, different extension).
          The .ai is the source file; the .pdf is the distributable. Deletes the .ai asset record and its thumbnail from DO Spaces.
        </p>
        {preview !== null && preview.length === 0 && (
          <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2">No .ai/.pdf duplicates found.</p>
        )}
        {preview && preview.length > 0 && (
          <div className="border rounded-md overflow-hidden max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs py-1.5">Filename (.ai to delete)</TableHead>
                  <TableHead className="text-xs py-1.5">Path</TableHead>
                  <TableHead className="text-xs py-1.5 text-center">Has thumbnail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs font-mono py-1.5">{d.filename}</TableCell>
                    <TableCell className="text-xs text-muted-foreground py-1.5 max-w-[300px] truncate" title={d.relative_path}>
                      {d.relative_path}
                    </TableCell>
                    <TableCell className="text-xs text-center py-1.5">
                      {d.has_thumbnail ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 inline" /> : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── AI Sentinel Cleanup Card ──────────────────────────────────────────────────
// TEMPORARY — remove this card (and the ai_sentinel_cleanup_log table + stats fn
// migrations) once the reconciliation pass is complete. See CLAUDE.md.
