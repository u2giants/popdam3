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
  | "state_persist";

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
  | "ambiguous_submission";

export interface OpenRouterBatchJobState {
  phase: OpenRouterBatchPhase;
  provider_batch_id?: string;
  submission_owner?: string;
  lease_expires_at?: string;
  /** One-time receipt returned by the lease claim. Never persisted by the database. */
  lease_token?: string;
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
