import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Loader2, FileText, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp, ScanLine, Sparkles, Save, Monitor, Server, ImageIcon, Play, Pause, RotateCcw, Trash2, Check, X, Clock } from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  thumbnail_url: string | null;
  replacement_thumbnail_url: string | null;
  replacement_filename: string | null;
}

interface FileProgressEntry {
  filename: string;
  status: "success" | "failed";
  method: string;
  chars: number;
  error?: string;
}

interface ProgressInfo {
  processed: number;
  total: number;
  current_file: string | null;
  current_step: string | null;
  file_results: FileProgressEntry[];
  updated_at: string;
}

// ── Step label helper ─────────────────────────────────────────────────────────

function stepLabel(step: string | null): string {
  switch (step) {
    case "starting": return "Starting…";
    case "reading": return "Reading file";
    case "mupdf": return "mupdf text extraction";
    case "rendering": return "Rendering page to PNG";
    case "ocr": return "OCR (tesseract.js)";
    case "ai_vision": return "AI vision";
    case "done": return "Done";
    default: return step ?? "";
  }
}

// ── Method badge ───────────────────────────────────────────────────────────────

function MethodBadge({ method }: { method: PdfSample["extraction_method"] | string }) {
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

// ── Agent status badge ───────────────────────────────────────────────────────

interface AgentStatusInfo {
  id: string;
  name: string;
  type: string;
  online: boolean;
  last_heartbeat_seconds_ago: number | null;
  last_heartbeat: string | null;
  healthy: boolean | null;
  version: string | null;
}

function AgentStatusBadges({ agents, targetType }: { agents: AgentStatusInfo[]; targetType: string }) {
  if (agents.length === 0) {
    return (
      <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">
        ⚠ No agents registered. Deploy a Bridge Agent or Windows Agent first.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {agents.map((a) => {
        const isTarget = a.type === targetType;
        const agoStr = a.last_heartbeat_seconds_ago !== null
          ? a.last_heartbeat_seconds_ago < 60
            ? `${a.last_heartbeat_seconds_ago}s ago`
            : `${Math.round(a.last_heartbeat_seconds_ago / 60)}m ago`
          : "never";

        return (
          <div
            key={a.id}
            className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 border ${
              a.online
                ? "border-green-300 bg-green-50 text-green-800"
                : "border-red-300 bg-red-50 text-red-800"
            }`}
          >
            {a.type === "windows-render" ? <Monitor className="h-3 w-3" /> : <Server className="h-3 w-3" />}
            <span className="font-medium">{a.name}</span>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${a.online ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-muted-foreground">({agoStr})</span>
            {isTarget && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">target</Badge>
            )}
            {a.version && <span className="text-muted-foreground text-[10px]">v{a.version}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Live progress panel ──────────────────────────────────────────────────────

function LiveProgressPanel({ request, agentStatuses, targetAgentType }: {
  request: Record<string, unknown>;
  agentStatuses: AgentStatusInfo[];
  targetAgentType: string;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const status = request.status as string;
  const agentName = (request.claimed_by_agent_name as string) ?? null;
  const progress = request.progress as ProgressInfo | undefined;
  const requestedAt = request.requested_at as string | undefined;
  const errorMsg = request.error as string | undefined;

  const isProcessing = status === "processing";
  const isPending = status === "pending";
  const isError = status === "error";

  const processed = progress?.processed ?? 0;
  const total = progress?.total ?? 0;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const currentFile = progress?.current_file ?? null;
  const currentStep = progress?.current_step ?? null;
  const fileResults = progress?.file_results ?? [];

  // Time since requested
  const elapsed = requestedAt
    ? Math.round((nowMs - new Date(requestedAt).getTime()) / 1000)
    : 0;
  const elapsedStr = elapsed > 60
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
    : `${elapsed}s`;

  // Check if target agents are online
  const targetAgents = agentStatuses.filter((a) => a.type === targetAgentType);
  const anyTargetOnline = targetAgents.some((a) => a.online);

  return (
    <div className="mt-3 space-y-3">
      {/* Agent connectivity status */}
      <AgentStatusBadges agents={agentStatuses} targetType={targetAgentType} />

      {/* Status line */}
      <div className="flex items-center gap-3 text-sm">
        {isPending && !agentName && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
            <div className="space-y-0.5">
              <span className="text-amber-600">
                Waiting for {targetAgentType === "windows-render" ? "Windows" : "Bridge"} agent to claim… ({elapsedStr})
              </span>
              {!anyTargetOnline && targetAgents.length > 0 && (
                <p className="text-xs text-destructive">
                  ⚠ Target agent{targetAgents.length > 1 ? "s" : ""} ({targetAgents.map((a) => a.name).join(", ")}) {targetAgents.length > 1 ? "are" : "is"} OFFLINE.
                  {" "}Request will auto-timeout at 3 minutes.
                </p>
              )}
              {targetAgents.length === 0 && (
                <p className="text-xs text-destructive">
                  ⚠ No {targetAgentType} agents registered. This request cannot be claimed. Will auto-timeout at 3 minutes.
                </p>
              )}
            </div>
          </>
        )}
        {(isProcessing || (isPending && agentName)) && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-foreground">
              Processing on{" "}
              <span className="font-medium inline-flex items-center gap-1">
                {agentName?.toLowerCase().includes("windows") ? (
                  <><Monitor className="h-3.5 w-3.5" /> {agentName}</>
                ) : (
                  <><Server className="h-3.5 w-3.5" /> {agentName ?? "agent"}</>
                )}
              </span>
              <span className="text-muted-foreground ml-2">({elapsedStr})</span>
            </span>
          </>
        )}
        {isError && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
              <span className="text-destructive font-medium">Failed</span>
            </div>
            <p className="text-xs text-destructive/90 bg-destructive/5 rounded p-2 font-mono whitespace-pre-wrap">
              {errorMsg ?? "Unknown error"}
            </p>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{processed} / {total} PDFs</span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>
      )}

      {/* Current file + step */}
      {currentFile && currentStep && currentStep !== "done" && (
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{currentFile}</span>
          {" — "}
          <span className="italic">{stepLabel(currentStep)}</span>
        </p>
      )}

      {/* Live file results */}
      {fileResults.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs py-1">File</TableHead>
                <TableHead className="text-xs py-1">Result</TableHead>
                <TableHead className="text-xs py-1 text-center">Chars</TableHead>
                <TableHead className="text-xs py-1">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fileResults.map((fr, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-mono py-1 max-w-[200px] truncate">
                    {fr.filename}
                  </TableCell>
                  <TableCell className="py-1">
                    <MethodBadge method={fr.method} />
                  </TableCell>
                  <TableCell className="text-xs text-center py-1 text-muted-foreground">
                    {fr.chars.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs py-1 text-red-600 max-w-[200px] truncate">
                    {fr.error ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number | null;
}

// ── AI vision model config card ───────────────────────────────────────────────

function AiVisionConfigCard() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  // Fetch vision models live from OpenRouter and saved selection in parallel
  const { data: modelsData, isLoading: modelsLoading, error: modelsError } = useQuery({
    queryKey: ["openrouter-vision-models"],
    queryFn: () => call("get-openrouter-vision-models"),
    staleTime: 5 * 60_000,
  });

  const { data: configData } = useQuery({
    queryKey: ["admin-config", "PDF_EXTRACTION_CONFIG"],
    queryFn: () => call("get-config", { keys: ["PDF_EXTRACTION_CONFIG"] }),
  });

  const visionModels: OpenRouterModel[] = (modelsData?.models ?? []) as OpenRouterModel[];

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
      queryClient.invalidateQueries({ queryKey: ["admin-config", "PDF_EXTRACTION_CONFIG"] });
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
          Sourced live from OpenRouter — all models that accept image input are shown.
        </p>
        {modelsLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading models from OpenRouter…
          </div>
        )}
        {modelsError && (
          <p className="text-sm text-destructive">
            Could not load models from OpenRouter: {(modelsError as Error).message}
          </p>
        )}
        {!modelsLoading && !modelsError && visionModels.length === 0 && (
          <p className="text-sm text-amber-600">
            No vision models returned. Check that <code className="text-xs">OPENROUTER_API_KEY</code> is set in admin_config.
          </p>
        )}
        {visionModels.length > 0 && (
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Vision model ({visionModels.length} available)</Label>
              <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select a vision model…" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {visionModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.name}
                      <span className="ml-2 text-muted-foreground text-[10px]">{m.id}</span>
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
      </CardContent>
    </Card>
  );
}

// ── .ai / .pdf Duplicates Card ────────────────────────────────────────────────

interface AiDuplicate {
  id: string;
  filename: string;
  relative_path: string;
  has_thumbnail: boolean;
}

function AiDuplicatesCard() {
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

interface AiSentinelStats {
  total_ai: number;
  sampled: number;
  sentinel_pending: number;
  cleaned_up: number;
  no_replacement_found: number;
}

interface SentinelPendingFile {
  asset_id: string;
  filename: string;
  relative_path: string;
  thumbnail_url: string | null;
  replacement_thumbnail_url: string | null;
  replacement_filename: string | null;
}

interface SentinelLogEntry {
  id: string;
  ai_filename: string;
  ai_relative_path: string;
  replacement_filename: string | null;
  replacement_queued_for_thumbnail: boolean;
  created_at: string;
}

interface AiSentinelScanRequest {
  status: "scanning" | "claimed" | "completed" | "error";
  target: number;
  found: number;
  processed: number;
  total_ai: number;
  started_at?: string;
  completed_at?: string;
}

function AiSentinelCleanupCard() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedIndexRef = useRef<number | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ["ai-sentinel-status"],
    queryFn: () => call<{ ok: boolean; stats: AiSentinelStats; pending_files: SentinelPendingFile[]; recent_log: SentinelLogEntry[]; scan_request: AiSentinelScanRequest | null }>("get-ai-sentinel-status"),
    refetchInterval: (q) => {
      const sr = q.state.data?.scan_request;
      return (sr?.status === "scanning" || sr?.status === "claimed") ? 4000 : 15000;
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: (assetIds: string[]) =>
      call<{ ok: boolean; processed: number }>("run-ai-sentinel-cleanup", { asset_ids: assetIds }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-sentinel-status"] });
      setSelectedIds(new Set());
      lastClickedIndexRef.current = null;
      if (data.processed === 0) {
        toast.info("No sentinel files pending cleanup right now.");
      } else {
        toast.success(`Cleaned up ${data.processed} .ai file${data.processed !== 1 ? "s" : ""} and queued sibling scans.`);
      }
      setConfirmOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dismissMutation = useMutation({
    mutationFn: (assetIds: string[]) =>
      call<{ ok: boolean; dismissed: number }>("dismiss-ai-sentinel", { asset_ids: assetIds }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-sentinel-status"] });
      setSelectedIds(new Set());
      lastClickedIndexRef.current = null;
      toast.success(`Dismissed ${data.dismissed} file${data.dismissed !== 1 ? "s" : ""} — removed from sentinel list.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const snoozeMutation = useMutation({
    mutationFn: (assetIds: string[]) =>
      call<{ ok: boolean; snoozed: number; until: string }>("snooze-ai-sentinel", { asset_ids: assetIds }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-sentinel-status"] });
      setSelectedIds(new Set());
      lastClickedIndexRef.current = null;
      const until = new Date(data.until).toLocaleDateString();
      toast.success(`Snoozed ${data.snoozed} file${data.snoozed !== 1 ? "s" : ""} until ${until}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleItemClick = (assetId: string, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIndexRef.current !== null) {
      const start = Math.min(lastClickedIndexRef.current, index);
      const end = Math.max(lastClickedIndexRef.current, index);
      const rangeIds = pendingFiles.slice(start, end + 1).map((f) => f.asset_id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        rangeIds.forEach((id) => next.add(id));
        return next;
      });
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(assetId)) next.delete(assetId);
        else next.add(assetId);
        return next;
      });
      lastClickedIndexRef.current = index;
    } else {
      setSelectedIds(new Set([assetId]));
      lastClickedIndexRef.current = index;
    }
  };

  const scanMutation = useMutation({
    mutationFn: () => call("trigger-ai-sentinel-scan", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-sentinel-status"] });
      toast.info("Scanning .ai files for sentinel content…");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = status?.stats;
  const log = status?.recent_log ?? [];
  const pendingFiles = status?.pending_files ?? [];
  const scanRequest = status?.scan_request ?? null;
  const isScanning = scanRequest?.status === "scanning" || scanRequest?.status === "claimed";
  const selectedCount = selectedIds.size;
  const sampledPct = stats ? Math.round((stats.sampled / Math.max(stats.total_ai, 1)) * 100) : 0;
  const scanPct = scanRequest && scanRequest.total_ai > 0
    ? Math.round((scanRequest.processed / scanRequest.total_ai) * 100)
    : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          .ai Sentinel Cleanup
          <Badge variant="outline" className="text-xs font-normal ml-1">Temporary</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Finds .ai files saved without "Create PDF Compatible File" (they contain only Adobe's boilerplate warning, not artwork),
          deletes them, and thumbnails the nearest PDF/PNG/JPG tech pack in the same folder instead.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : stats ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="rounded border p-2">
                <div className="text-muted-foreground text-xs">Total .ai files</div>
                <div className="font-semibold">{stats.total_ai.toLocaleString()}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground text-xs">Sampled</div>
                <div className="font-semibold">{stats.sampled.toLocaleString()} <span className="text-muted-foreground font-normal text-xs">({sampledPct}%)</span></div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground text-xs">Sentinel pending</div>
                <div className={`font-semibold ${stats.sentinel_pending > 0 ? "text-amber-600" : "text-green-600"}`}>
                  {stats.sentinel_pending.toLocaleString()}
                </div>
              </div>
              <div className="rounded border p-2">
                <div className="text-muted-foreground text-xs">Cleaned up</div>
                <div className="font-semibold">{stats.cleaned_up.toLocaleString()}</div>
                {stats.no_replacement_found > 0 && (
                  <div className="text-xs text-amber-600">{stats.no_replacement_found} without replacement</div>
                )}
              </div>
            </div>

            {/* Sentinel scan button + progress */}
            {!isScanning && (
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => scanMutation.mutate()}
                  disabled={scanMutation.isPending}
                >
                  {scanMutation.isPending
                    ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Starting…</>
                    : <><ScanLine className="mr-1.5 h-3.5 w-3.5" /> Scan for Sentinel Files</>}
                </Button>
                {scanRequest?.status === "completed" && (
                  <span className="text-xs text-muted-foreground">
                    Last scan: found {scanRequest.found} sentinel file{scanRequest.found !== 1 ? "s" : ""} in {scanRequest.processed.toLocaleString()} checked
                  </span>
                )}
              </div>
            )}
            {isScanning && scanRequest && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Scanning .ai files — found {scanRequest.found} sentinel so far
                  </span>
                  <span>{scanRequest.processed.toLocaleString()} / {scanRequest.total_ai.toLocaleString()} ({scanPct}%)</span>
                </div>
                <Progress value={scanPct} className="h-1.5" />
              </div>
            )}

            {pendingFiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-amber-700">
                    {pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""} without thumbnails — select to clean up
                  </span>
                  <div className="flex items-center gap-2">
                    {selectedCount > 0 && (
                      <button
                        className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        onClick={() => { setSelectedIds(new Set()); lastClickedIndexRef.current = null; }}
                      >
                        Deselect all
                      </button>
                    )}
                    <button
                      className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      onClick={() => setSelectedIds(new Set(pendingFiles.map((f) => f.asset_id)))}
                    >
                      Select all
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-96 overflow-y-auto p-1 rounded border bg-muted/30">
                  {pendingFiles.map((f, i) => {
                    const selected = selectedIds.has(f.asset_id);
                    return (
                      <div
                        key={f.asset_id}
                        title={f.relative_path}
                        className={`flex flex-col gap-1 cursor-pointer rounded p-0.5 select-none ${selected ? "ring-2 ring-amber-500 bg-amber-500/10" : "hover:bg-muted/60"}`}
                        onClick={(e) => handleItemClick(f.asset_id, i, e)}
                      >
                        <div className="aspect-square rounded overflow-hidden bg-muted flex items-center justify-center relative">
                          {f.thumbnail_url ? (
                            <img src={f.thumbnail_url} alt={f.filename} className="w-full h-full object-cover" />
                          ) : f.replacement_thumbnail_url ? (
                            <img src={f.replacement_thumbnail_url} alt={f.replacement_filename ?? f.filename} className="w-full h-full object-cover opacity-50" title={`No .ai thumbnail — showing sibling: ${f.replacement_filename}`} />
                          ) : (
                            <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                          )}
                          {selected && (
                            <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded bg-amber-500 flex items-center justify-center">
                              <Check className="h-2.5 w-2.5 text-white" />
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground truncate leading-tight">{f.filename}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">Click to select · Ctrl+click to toggle · Shift+click to range select</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {!confirmOpen ? (
                <>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={selectedCount === 0 || cleanupMutation.isPending || dismissMutation.isPending}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {selectedCount === 0 ? "Select files to clean up" : `Clean up ${selectedCount} selected`}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedCount === 0 || dismissMutation.isPending || cleanupMutation.isPending || snoozeMutation.isPending}
                    onClick={() => dismissMutation.mutate([...selectedIds])}
                    title="Remove from sentinel list without deleting the asset — use when a file was incorrectly flagged"
                  >
                    {dismissMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <X className="h-3.5 w-3.5 mr-1" />}
                    Not sentinel
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedCount === 0 || snoozeMutation.isPending || cleanupMutation.isPending || dismissMutation.isPending}
                    onClick={() => snoozeMutation.mutate([...selectedIds])}
                    title="Hide for 3 weeks — skips re-ingestion until then, when it will reappear for review"
                  >
                    {snoozeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Clock className="h-3.5 w-3.5 mr-1" />}
                    I don't know
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-sm text-destructive font-medium">Delete {selectedCount} .ai file{selectedCount !== 1 ? "s" : ""}?</span>
                  <Button size="sm" variant="destructive" disabled={cleanupMutation.isPending} onClick={() => cleanupMutation.mutate([...selectedIds])}>
                    {cleanupMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                    Confirm
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                </>
              )}
              {log.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setShowLog(!showLog)}>
                  {showLog ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                  {showLog ? "Hide" : "Show"} log ({log.length})
                </Button>
              )}
            </div>

            {showLog && log.length > 0 && (
              <div className="overflow-auto max-h-64 rounded border text-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deleted .ai</TableHead>
                      <TableHead>Replacement found</TableHead>
                      <TableHead>Thumbnail queued</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {log.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-mono max-w-[200px] truncate" title={entry.ai_relative_path}>{entry.ai_filename}</TableCell>
                        <TableCell className={entry.replacement_filename ? "" : "text-amber-600"}>
                          {entry.replacement_filename ?? "None found"}
                        </TableCell>
                        <TableCell>{entry.replacement_queued_for_thumbnail ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : "—"}</TableCell>
                        <TableCell>{new Date(entry.created_at).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Failed to load status.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

// ── PDF Backfill Card ─────────────────────────────────────────────────────────

function PdfBackfillCard() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const { data } = useQuery({
    queryKey: ["pdf-backfill-status"],
    queryFn: () => call("get-pdf-backfill-status"),
    refetchInterval: (query) => {
      const bf = query.state.data?.backfill as Record<string, unknown> | null;
      return bf?.status === "running" ? 3000 : 15000;
    },
  });

  const triggerMutation = useMutation({
    mutationFn: () => call("trigger-pdf-backfill"),
    onSuccess: (res) => {
      const r = res as Record<string, unknown>;
      toast.success(`Backfill started — ${(r.total as number).toLocaleString()} PDFs queued`);
      queryClient.invalidateQueries({ queryKey: ["pdf-backfill-status"] });
    },
    onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
  });

  const pauseMutation = useMutation({
    mutationFn: () => call("pause-pdf-backfill"),
    onSuccess: () => {
      toast.success("Backfill paused");
      queryClient.invalidateQueries({ queryKey: ["pdf-backfill-status"] });
    },
    onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
  });

  const resumeMutation = useMutation({
    mutationFn: () => call("resume-pdf-backfill"),
    onSuccess: () => {
      toast.success("Backfill resumed");
      queryClient.invalidateQueries({ queryKey: ["pdf-backfill-status"] });
    },
    onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
  });

  const bf = data?.backfill as Record<string, unknown> | null;
  const status = (bf?.status as string) ?? "idle";
  const total = (bf?.total as number) ?? 0;
  const processed = (bf?.live_processed as number) ?? (bf?.processed as number) ?? 0;
  const currentFile = bf?.live_current_file as string | null;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const startedAt = bf?.started_at ? new Date(bf.started_at as string).getTime() : null;
  const elapsedSec = startedAt ? Math.floor((nowMs - startedAt) / 1000) : 0;
  const elapsedStr = elapsedSec < 60
    ? `${elapsedSec}s`
    : elapsedSec < 3600
      ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`
      : `${Math.floor(elapsedSec / 3600)}h ${Math.floor((elapsedSec % 3600) / 60)}m`;

  // Estimated time remaining
  const etaStr = (() => {
    if (status !== "running" || processed === 0 || !startedAt) return null;
    const rate = processed / ((nowMs - startedAt) / 1000); // files/sec
    if (rate <= 0) return null;
    const remainSec = Math.round((total - processed) / rate);
    if (remainSec < 60) return `~${remainSec}s`;
    if (remainSec < 3600) return `~${Math.floor(remainSec / 60)}m`;
    return `~${Math.floor(remainSec / 3600)}h ${Math.floor((remainSec % 3600) / 60)}m`;
  })();

  const statusBadge = (() => {
    switch (status) {
      case "running": return <Badge className="bg-blue-100 text-blue-800 gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Running</Badge>;
      case "paused": return <Badge className="bg-amber-100 text-amber-800 gap-1"><Pause className="h-3 w-3" /> Paused</Badge>;
      case "completed": return <Badge className="bg-green-100 text-green-800 gap-1"><CheckCircle2 className="h-3 w-3" /> Completed</Badge>;
      case "error": return <Badge className="bg-red-100 text-red-800 gap-1"><XCircle className="h-3 w-3" /> Error</Badge>;
      default: return <Badge variant="outline" className="text-muted-foreground">Idle</Badge>;
    }
  })();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Full Library Backfill
            </CardTitle>
            {statusBadge}
          </div>
          <div className="flex items-center gap-2">
            {status === "running" && (
              <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
                {pauseMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}
                Pause
              </Button>
            )}
            {status === "paused" && (
              <Button size="sm" variant="outline" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
                {resumeMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                Resume
              </Button>
            )}
            {(status === "completed" || status === "error") && (
              <Button size="sm" variant="outline" onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
                {triggerMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                Re-run
              </Button>
            )}
            {(status === "idle" || !bf) && (
              <Button size="sm" onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
                {triggerMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                Start Backfill
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Processes every PDF in the library: extracts text, generates thumbnails for assets missing one, and populates the Files Used table. Runs on the Bridge Agent and can be paused and resumed at any time.
        </p>
        {bf && status !== "idle" && (
          <>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{processed.toLocaleString()} / {total.toLocaleString()} files</span>
                <span className="flex items-center gap-2">
                  {status === "running" && <span className="text-blue-600">{elapsedStr} elapsed{etaStr ? ` · ${etaStr} remaining` : ""}</span>}
                  <span>{percent}%</span>
                </span>
              </div>
              <Progress value={percent} className="h-2" />
            </div>
            {status === "running" && currentFile && (
              <p className="text-xs text-muted-foreground truncate" title={currentFile}>
                Processing: <span className="font-mono">{currentFile}</span>
              </p>
            )}
          </>
        )}
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
