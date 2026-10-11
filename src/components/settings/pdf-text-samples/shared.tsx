import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp, ScanLine, Sparkles, Monitor, Server } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PdfSample {
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

export interface FileProgressEntry {
  filename: string;
  status: "success" | "failed";
  method: string;
  chars: number;
  error?: string;
}

export interface ProgressInfo {
  processed: number;
  total: number;
  current_file: string | null;
  current_step: string | null;
  file_results: FileProgressEntry[];
  updated_at: string;
}

// ── Step label helper ─────────────────────────────────────────────────────────

export function stepLabel(step: string | null): string {
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

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
  return `${Math.floor(totalSec / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m`;
}

export function formatDateTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  return new Date(value).toLocaleString();
}

export function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ── Method badge ───────────────────────────────────────────────────────────────

export function MethodBadge({ method }: { method: PdfSample["extraction_method"] | string }) {
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

export function SampleRow({ sample }: { sample: PdfSample }) {
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

export interface AgentStatusInfo {
  id: string;
  name: string;
  type: string;
  online: boolean;
  last_heartbeat_seconds_ago: number | null;
  last_heartbeat: string | null;
  healthy: boolean | null;
  version: string | null;
}

export function AgentStatusBadges({ agents, targetType }: { agents: AgentStatusInfo[]; targetType: string }) {
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
