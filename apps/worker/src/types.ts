/**
 * Shared types — mirrors the OpState / OpStatus used by the frontend and edge functions.
 */

export type OpStatus =
  | "idle"
  | "running"
  | "queued"
  | "completed"
  | "interrupted"
  | "failed";

export type OperationStage =
  | "candidate_fetch"
  | "progress_count"
  | "asset_fetch"
  | "image_fetch"
  | "model_inference"
  | "tag_write"
  | "state_persist"
  | "clear_assets"
  | "delete_groups"
  | "rebuild_assets"
  | "finalize_stats"
  | "reconcile_stats";

export interface OpState {
  status: OpStatus;
  cursor?: number | string;
  params?: Record<string, unknown>;
  progress?: Record<string, unknown>;
  started_at?: string;
  updated_at?: string;
  run_id?: string;
  auto_resume_attempts?: number;
  last_auto_resume_at?: string;
  next_auto_resume_at?: string;
  interruption_reason_code?: string;
  error?: string;
  result_message?: string;
  queue_position?: number;
  last_stage?: string;
  last_stage_started_at?: string;
  last_successful_cursor?: number | string;
  retry_page_size?: number;
  last_substage?: string;
  state_revision?: number;
  external_job?: OpenRouterBatchJobState;
}

export type OpenRouterBatchPhase =
  | "prepared"
  | "submitting"
  | "pending"
  | "applying"
  | "completed"
  | "ambiguous_submission";

export interface OpenRouterBatchJobState {
  version?: 1;
  phase: OpenRouterBatchPhase;
  model?: string;
  output_method?: "json_schema" | "json_object" | "tool_named" | "tool_required" | "tool_auto";
  provider_batch_id?: string;
  prepared_at?: string;
  submitted_at?: string;
  next_poll_at?: string;
  last_checked_at?: string;
  submission_owner?: string;
  lease_expires_at?: string;
  /** One-time receipt returned by the lease claim. Never persisted by the database. */
  lease_token?: string;
  page_cursor?: number | string;
  next_cursor?: number | string;
  operation_done_after_clear?: boolean;
  clear_after_reconciliation?: boolean;
  items?: Array<{
    asset_id: string;
    custom_id: string;
    status: "prepared" | "submitted" | "applied" | "failed_terminal";
    filename?: string;
    relative_path?: string;
    error?: string;
  }>;
  [key: string]: unknown;
}

export interface BatchResult {
  ok: boolean;
  done: boolean;
  nextOffset?: number | string | null;
  error?: string;
  error_stage?: OperationStage;
  error_code?: string;
  postgres_code?: string;
  elapsed_ms?: number;
  retry_page_size?: number;
  last_stage?: OperationStage;
  last_stage_started_at?: string;
  [key: string]: unknown;
}
