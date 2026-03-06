/**
 * Shared types for edge functions.
 *
 * These mirror the frontend OperationState shape in usePersistentOperation.ts.
 * If you change the shape here, update the frontend hook to match.
 */

// ── Bulk operation status ───────────────────────────────────────────

export type OpStatus =
  | "idle"
  | "running"
  | "completed"
  | "completed_with_repair"
  | "failed"
  | "interrupted"
  | "queued";

export interface OpState {
  status: OpStatus;
  cursor?: number;
  params?: Record<string, unknown>;
  progress?: Record<string, unknown>;
  started_at?: string;
  updated_at?: string;
  result_message?: string;
  error?: string;
  interruption_reason_code?: string;
  auto_resume_attempts?: number;
  last_auto_resume_at?: string;
  run_id?: string;
  last_stage?: string;
  last_substage?: string;
  queue_position?: number;
}

// ── Bulk operation keys ─────────────────────────────────────────────

export type BulkOperationKey =
  | "reprocess-metadata"
  | "backfill-sku-names"
  | "rebuild-style-groups"
  | "ai-tag-untagged"
  | "ai-tag-all"
  | "ai-tag-groups"
  | "reconcile-style-group-stats"
  | "erp-enrichment"
  | "erp-classify";

export type BulkOperationsMap = Record<string, OpState>;

// ── Admin config value ──────────────────────────────────────────────

/**
 * Represents a row from admin_config table.
 * The `value` column is JSONB and can be any shape.
 */
export interface AdminConfigRow {
  key: string;
  value: unknown;
  updated_at?: string;
  updated_by?: string | null;
}

// ── Workflow status (mirrors the DB enum) ───────────────────────────

export type WorkflowStatus =
  | "product_ideas"
  | "concept_approved"
  | "in_development"
  | "freelancer_art"
  | "discontinued"
  | "in_process"
  | "customer_adopted"
  | "licensor_approved"
  | "other";

// ── RPC result types ────────────────────────────────────────────────

/** Result row from execute_readonly_query RPC */
export type ReadonlyQueryResult = Record<string, unknown>[];
