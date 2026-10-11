import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FileText, CheckCircle2, XCircle, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import RichPdfExtractCard from "./RichPdfExtractCard";
import { AiDuplicatesCard } from "./pdf-text-samples/AiDuplicatesCard";
import { AiSentinelCleanupCard } from "./pdf-text-samples/AiSentinelCleanupCard";
import { AiVisionConfigCard } from "./pdf-text-samples/AiVisionConfigCard";
import { BlankThumbCleanupCard } from "./pdf-text-samples/BlankThumbCleanupCard";
import { LiveProgressPanel } from "./pdf-text-samples/LiveProgressPanel";
import { PdfBackfillCard } from "./pdf-text-samples/PdfBackfillCard";
import { AgentStatusBadges, AgentStatusInfo, PdfSample, SampleRow } from "./pdf-text-samples/shared";

export default function PdfTextSamplesTab() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["pdf-text-samples"],
    queryFn: () => call("get-pdf-text-samples"),
    refetchInterval: (query) => {
      const req = query.state.data?.request as Record<string, unknown> | null;
      if (!req) return false;
      const status = req.status as string;
      return (status === "pending" || status === "processing") ? 3000 : false;
    },
  });

  const triggerMutation = useMutation({
    mutationFn: (mode: "sample" | "full") => call("trigger-pdf-text-sample", { mode }),
    onSuccess: (res) => {
      const r = res as Record<string, unknown>;
      const label = r.mode === "full" ? "Full scan" : "Sample";
      toast.success(`${label} queued — ${r.queued} PDFs`);
      queryClient.invalidateQueries({ queryKey: ["pdf-text-samples"] });
    },
    onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
  });

  const resetMutation = useMutation({
    mutationFn: () => call("reset-pdf-text-sample"),
    onSuccess: () => {
      toast.success("PDF sample request reset");
      queryClient.invalidateQueries({ queryKey: ["pdf-text-samples"] });
    },
    onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
  });

  const request = data?.request as Record<string, unknown> | null;
  const samples = (data?.samples ?? []) as PdfSample[];
  const agentStatuses = (data?.agent_status ?? []) as AgentStatusInfo[];
  const targetAgentType = (data?.target_agent_type ?? "bridge") as string;
  const isActive = request?.status === "pending" || request?.status === "processing" || request?.status === "error";

  const nativeText = samples.filter((s) => s.extraction_method === "pdf_text").length;
  const ocrText = samples.filter((s) => s.extraction_method === "ocr_text").length;
  const aiVision = samples.filter((s) => s.extraction_method === "ai_vision").length;
  const likelyScanned = samples.filter((s) => s.extraction_method === "likely_scanned").length;
  const failed = samples.filter((s) => s.extraction_method === "failed").length;

  // Only files confirmed to contain the exact Adobe sentinel boilerplate.
  const placeholderCandidates = samples.filter((s) =>
    s.extracted_text?.includes("saved without PDF Content"),
  );

  const requestMode = (request?.mode as string) ?? "sample";

  return (
    <div className="space-y-4">
      <RichPdfExtractCard />
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              PDF Text Extraction
            </CardTitle>
            <div className="flex items-center gap-2">
              {isActive && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => resetMutation.mutate()}
                  disabled={resetMutation.isPending}
                >
                  {resetMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                  Force Reset
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => triggerMutation.mutate("sample")}
                disabled={triggerMutation.isPending || isActive}
              >
                {triggerMutation.isPending && requestMode === "sample" ? (
                  <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Running…</>
                ) : (
                  "Run Sample (25 PDFs)"
                )}
              </Button>
              <Button
                size="sm"
                onClick={() => triggerMutation.mutate("full")}
                disabled={triggerMutation.isPending || isActive}
              >
                {isActive && requestMode === "full" ? (
                  <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Running…</>
                ) : (
                  "Run Full Scan"
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Attempts text extraction on PDFs via mupdf → OCR → AI vision cascade.
            Sample picks 25 random PDFs; Full Scan processes all PDFs in the library.
          </p>

          {/* Agent status (always visible when idle) */}
          {!isActive && agentStatuses.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-1.5">Agent connectivity (target: {targetAgentType === "windows-render" ? "Windows" : "Bridge"})</p>
              <AgentStatusBadges agents={agentStatuses} targetType={targetAgentType} />
            </div>
          )}

          {/* Live progress panel when active */}
          {isActive && request && (
            <LiveProgressPanel
              request={request}
              agentStatuses={agentStatuses}
              targetAgentType={targetAgentType}
            />
          )}

          {/* Last-run summary when completed */}
          {!isActive && request?.status === "completed" && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Last run completed{" "}
                {request.completed_at
                  ? new Date(request.completed_at as string).toLocaleString()
                  : ""}{" "}
                — {request.count ?? 0} file{(request.count as number) !== 1 ? "s" : ""} processed
                {request.mode ? ` (${request.mode})` : ""}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Placeholder / Compat Preview ── */}
      {placeholderCandidates.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-amber-500" />
              Possible Placeholder PDFs
              <Badge className="bg-amber-100 text-amber-800 ml-1">{placeholderCandidates.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              These files contain the exact text "saved without PDF Content" — confirmed Illustrator files saved without PDF compatibility.
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-72 overflow-y-auto p-1 rounded border bg-muted/30">
              {placeholderCandidates.map((s) => (
                <div key={s.id} className="flex flex-col gap-1" title={s.relative_path}>
                  <div className="aspect-square rounded overflow-hidden bg-muted flex items-center justify-center">
                    {s.thumbnail_url ? (
                      <img src={s.thumbnail_url} alt={s.filename} className="w-full h-full object-cover" />
                    ) : (
                      <FileText className="h-6 w-6 text-amber-400/60" />
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground truncate leading-tight" title={s.relative_path}>{s.filename}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <PdfBackfillCard />

      <BlankThumbCleanupCard />

      <AiSentinelCleanupCard />

      <AiDuplicatesCard />

      <AiVisionConfigCard />

      {samples.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{samples.length} PDFs sampled</span>
              {nativeText > 0 && <Badge className="bg-green-100 text-green-800">{nativeText} native text</Badge>}
              {ocrText > 0 && <Badge className="bg-blue-100 text-blue-800">{ocrText} OCR</Badge>}
              {aiVision > 0 && <Badge className="bg-purple-100 text-purple-800">{aiVision} AI vision</Badge>}
              {likelyScanned > 0 && <Badge className="bg-amber-100 text-amber-800">{likelyScanned} likely scanned</Badge>}
              {failed > 0 && <Badge className="bg-red-100 text-red-800">{failed} failed</Badge>}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Filename</TableHead>
                      <TableHead className="text-xs">Result</TableHead>
                      <TableHead className="text-xs text-center">Pages</TableHead>
                      <TableHead className="text-xs text-center">Chars</TableHead>
                      <TableHead className="text-xs">Text Preview</TableHead>
                      <TableHead className="text-xs w-6" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {samples.map((s) => (
                      <SampleRow key={s.id} sample={s} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
