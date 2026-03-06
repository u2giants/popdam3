import type { OperationState } from "@/hooks/usePersistentOperation";

// ── Shared types for DiagnosticsTab sub-components ──

export interface AgentInfo {
  id: string;
  name: string;
  type: string;
  status: string;
  last_heartbeat: string | null;
  last_counters: Record<string, number> | null;
  last_error: string | null;
  scan_roots: string[];
  created_at: string;
}

export interface ScanProgress {
  status: string;
  counters?: Record<string, number>;
  current_path?: string;
  updated_at?: string;
  error?: string;
}

export interface ProcessingError {
  id: string;
  asset_id: string;
  job_type: string;
  error_message: string | null;
  completed_at: string | null;
}

export interface Counts {
  total_assets: number;
  pending_assets: number;
  error_assets: number;
  pending_jobs: number;
  pending_renders: number;
}

export interface DiagnosticData {
  timestamp: string;
  config: Record<string, unknown>;
  agents: AgentInfo[];
  scan_progress: ScanProgress | null;
  recent_errors: ProcessingError[];
  counts: Counts;
}

export type RequestOpFn = (
  opKey: string,
  opName: string,
  startFn: () => void,
  queueFn: () => void,
) => void;

export const OP_NAMES: Record<string, string> = {
  "reprocess-metadata": "Reprocess Metadata",
  "backfill-sku-names": "Backfill SKU Names",
  "rebuild-style-groups": "Rebuild Style Groups",
  "ai-tag-untagged": "AI Tag Untagged",
  "ai-tag-all": "Re-tag Everything",
  "reconcile-style-group-stats": "Reconcile Stats",
  "erp-enrichment": "ERP Enrichment",
  "erp-classify": "ERP Classify",
};

export const REASON_LABELS: Record<string, string> = {
  gateway_timeout: "Gateway timeout (502/503/504)",
  statement_timeout: "Database statement timeout",
  user_stop: "Stopped by user",
  stale_run: "No progress detected (stale lock)",
  connection_error: "Connection error",
  legacy_format: "Legacy operation format",
  unknown: "Unknown reason",
};

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const AGENT_TYPE_LABELS: Record<string, string> = {
  bridge: "NAS Bridge Agent",
  "windows-render": "Windows Render Agent",
};

export const SENSITIVE_PATTERNS = /secret|key|password|token|_pass|nas_user/i;

export const SCAN_CONFIG_KEYS = new Set([
  "SCAN_ROOTS", "NAS_CONTAINER_MOUNT_ROOT", "SCAN_REQUEST",
  "SCAN_PROGRESS", "SCAN_CHECKPOINT", "SCANNING_CONFIG",
]);
export const STORAGE_KEYS = new Set(["SPACES_CONFIG"]);
export const AGENT_KEYS = new Set(["AGENT_KEY", "AUTO_SCAN_CONFIG"]);
export const WINDOWS_AGENT_KEYS = new Set([
  "WINDOWS_AGENT_NAS_HOST", "WINDOWS_AGENT_NAS_SHARE",
  "WINDOWS_AGENT_NAS_USER", "WINDOWS_AGENT_NAS_PASS",
  "WINDOWS_AGENT_KEY", "WINDOWS_BOOTSTRAP_TOKEN",
]);

export function categorizeKey(key: string): string {
  if (SCAN_CONFIG_KEYS.has(key)) return "Scan Config";
  if (STORAGE_KEYS.has(key)) return "Storage";
  if (AGENT_KEYS.has(key)) return "Agent";
  if (WINDOWS_AGENT_KEYS.has(key)) return "Windows Agent";
  return "Other";
}
