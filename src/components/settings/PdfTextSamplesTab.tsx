import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Loader2, FileText, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp, ScanLine, Sparkles, Save } from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AiModelDef {
  id: string;
  provider: string;
  apiModel: string;
  displayName: string;
  capabilities: string[];
}

interface PdfSample {
  id: string;
  asset_id: string | null;
  filename: string;
  relative_path: string;
  extraction_method: "pdf_text" | "likely_scanned" | "failed" | "ocr_text" | "ai_vision";
  extracted_text: string | null;
  page_count: number | null;
  char_count: number;
  extraction_error: string | null;
  sampled_at: string;
}

// ── Method badge ───────────────────────────────────────────────────────────────

function MethodBadge({ method }: { method: PdfSample["extraction_method"] }) {
  if (method === "pdf_text") {
    return (
      <Badge className="bg-green-100 text-green-800 gap-1 text-xs">
        <CheckCircle2 className="h-3 w-3" /> Native text
      </Badge>
    );
  }
  if (method === "ocr_text") {
    return (
      <Badge className="bg-blue-100 text-blue-800 gap-1 text-xs">
        <ScanLine className="h-3 w-3" /> OCR
      </Badge>
    );
  }
  if (method === "ai_vision") {
    return (
      <Badge className="bg-purple-100 text-purple-800 gap-1 text-xs">
        <Sparkles className="h-3 w-3" /> AI vision
      </Badge>
    );
  }
  if (method === "likely_scanned") {
    return (
      <Badge className="bg-amber-100 text-amber-800 gap-1 text-xs">
        <AlertTriangle className="h-3 w-3" /> Likely scanned
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 gap-1 text-xs">
      <XCircle className="h-3 w-3" /> Failed
    </Badge>
  );
}

// ── Sample row ────────────────────────────────────────────────────────────────

function SampleRow({ sample }: { sample: PdfSample }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => sample.extracted_text && setExpanded((v) => !v)}
      >
        <TableCell className="text-xs font-mono max-w-[220px] truncate" title={sample.relative_path}>
          {sample.filename}
        </TableCell>
        <TableCell>
          <MethodBadge method={sample.extraction_method} />
        </TableCell>
        <TableCell className="text-xs text-center text-muted-foreground">
          {sample.page_count ?? "—"}
        </TableCell>
        <TableCell className="text-xs text-center text-muted-foreground">
          {sample.char_count.toLocaleString()}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
          {sample.extraction_error
            ? <span className="text-red-600">{sample.extraction_error}</span>
            : sample.extracted_text
              ? sample.extracted_text.slice(0, 120).replace(/\s+/g, " ")
              : <span className="italic">no text</span>
          }
        </TableCell>
        <TableCell className="text-xs text-center">
          {sample.extracted_text ? (
            expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : null}
        </TableCell>
      </TableRow>
      {expanded && sample.extracted_text && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30 p-3">
            <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
              {sample.extracted_text}
            </pre>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ── AI vision model config card ───────────────────────────────────────────────

function AiVisionConfigCard() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data: configData } = useQuery({
    queryKey: ["admin-config", "AI_MODELS", "PDF_EXTRACTION_CONFIG"],
    queryFn: () => call("get-config", { keys: ["AI_MODELS", "PDF_EXTRACTION_CONFIG"] }),
  });

  const allModels: AiModelDef[] = (() => {
    const raw = configData?.config?.AI_MODELS?.value ?? configData?.config?.AI_MODELS;
    return Array.isArray(raw) ? (raw as AiModelDef[]) : [];
  })();

  const visionModels = allModels.filter((m) => m.capabilities.includes("vision"));

  const savedModelId: string = (() => {
    const raw = configData?.config?.PDF_EXTRACTION_CONFIG?.value ?? configData?.config?.PDF_EXTRACTION_CONFIG;
    return (raw as Record<string, string> | null)?.ai_vision_model_id ?? "";
  })();

  const [selectedModelId, setSelectedModelId] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (savedModelId && !loaded) {
      setSelectedModelId(savedModelId);
      setLoaded(true);
    }
  }, [savedModelId, loaded]);

  const saveMutation = useMutation({
    mutationFn: () =>
      call("set-config", { entries: { PDF_EXTRACTION_CONFIG: { ai_vision_model_id: selectedModelId } } }),
    onSuccess: () => {
      toast.success("AI vision model saved — takes effect on next PDF sample run");
      queryClient.invalidateQueries({ queryKey: ["admin-config", "AI_MODELS", "PDF_EXTRACTION_CONFIG"] });
      setLoaded(false);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save"),
  });

  const isDirty = selectedModelId !== savedModelId;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          AI Vision Model
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Used as the final fallback when mupdf text extraction and OCR both fail (e.g. scanned PDFs with no machine-readable text).
          Only models with <code className="text-xs">vision</code> capability are shown.
        </p>
        {visionModels.length === 0 ? (
          <p className="text-sm text-amber-600">
            No vision models found. Add models to <code className="text-xs">AI_MODELS</code> in admin_config (same format as Openclaw <code className="text-xs">config/models.json</code>).
          </p>
        ) : (
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Vision model</Label>
              <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select a vision model…" />
                </SelectTrigger>
                <SelectContent>
                  {visionModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.displayName || m.id}
                      <span className="ml-2 text-muted-foreground text-[10px]">({m.provider})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              disabled={!isDirty || !selectedModelId || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="h-8"
            >
              {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Save className="h-3.5 w-3.5 mr-1.5" />Save</>}
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          API keys: set <code>GOOGLE_AI_API_KEY</code> or <code>ANTHROPIC_API_KEY</code> in admin_config.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function PdfTextSamplesTab() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["pdf-text-samples"],
    queryFn: () => call("get-pdf-text-samples"),
    refetchInterval: (query) => {
      const req = query.state.data?.request as Record<string, unknown> | null;
      return req?.status === "pending" ? 5000 : false;
    },
  });

  const triggerMutation = useMutation({
    mutationFn: () => call("trigger-pdf-text-sample"),
    onSuccess: (res) => {
      toast.success(`Queued ${(res as Record<string, unknown>).queued} PDFs for text extraction`);
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
  const isPending = request?.status === "pending";

  // Detect stuck: pending for more than 10 minutes
  const isStuck = (() => {
    if (!isPending) return false;
    const requestedAt = (request as Record<string, unknown>)?.requested_at as string | undefined;
    if (!requestedAt) return true; // no timestamp = assume stuck
    return Date.now() - new Date(requestedAt).getTime() > 10 * 60 * 1000;
  })();

  const nativeText = samples.filter((s) => s.extraction_method === "pdf_text").length;
  const ocrText = samples.filter((s) => s.extraction_method === "ocr_text").length;
  const aiVision = samples.filter((s) => s.extraction_method === "ai_vision").length;
  const likelyScanned = samples.filter((s) => s.extraction_method === "likely_scanned").length;
  const failed = samples.filter((s) => s.extraction_method === "failed").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              PDF Text Extraction Sample
            </CardTitle>
            <div className="flex items-center gap-2">
              {isPending && (
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
                onClick={() => triggerMutation.mutate()}
                disabled={triggerMutation.isPending || isPending}
              >
                {triggerMutation.isPending || isPending ? (
                  <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Running…</>
                ) : (
                  "Run Sample (25 PDFs)"
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Picks 25 random tech pack / licensing sheet PDFs and attempts text extraction via mupdf → OCR → AI vision cascade.
            Results show how each PDF is classified.
          </p>
          {isPending && (
            <div className="mt-3 flex items-center gap-2 text-sm text-amber-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              {isStuck
                ? "Stuck — the Bridge Agent may not be running or doesn't support this operation. Click Force Reset to clear."
                : "Processing… (checks every 5s)"}
            </div>
          )}
        </CardContent>
      </Card>

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
