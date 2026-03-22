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
  interruption_reason_code?: string;
  error?: string;
  result_message?: string;
  queue_position?: number;
  last_stage?: string;
  last_substage?: string;
}

export interface BatchResult {
  ok: boolean;
  done: boolean;
  nextOffset?: number | string | null;
  error?: string;
  [key: string]: unknown;
}
