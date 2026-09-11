// Persists the result of a style-guide render job.
//
// The thumbnail write used to ignore its error result and mark the queue row
// "completed" first, so a failed write left a completed job with no thumbnail
// and nothing surfaced. Now: the file write happens first and is retried with
// bounded backoff; if it still fails, the queue row is marked failed with the
// reason and the caller is told, so the render agent reports the failure too.
//
// A file row carries either a thumbnail or a render error, never both: render
// errors are only recorded on files that have no thumbnail, and the queue row
// always keeps the reason.

export interface DbWriteError {
  message: string;
  code?: string;
}

export interface DbWriteResult {
  error: DbWriteError | null;
  /** Rows affected, when the write asked for a count. */
  count?: number | null;
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: DbWriteError, delayMs: number) => void;
}

export const SG_WRITE_RETRY_DEFAULTS = { attempts: 5, baseDelayMs: 250, maxDelayMs: 4_000 } as const;

/** An update that matched no row. Retrying cannot help. */
export const NO_ROWS_CODE = "NO_ROWS";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Postgres classes 22 (data exception), 23 (constraint violation) and 42
 * (syntax / permission / undefined object), PostgREST request errors and
 * updates that matched no row will fail the same way every time; everything
 * else (network, timeouts, connection loss, serialization failures, 5xx) is
 * worth retrying.
 */
export function isTransientDbError(error: DbWriteError): boolean {
  const code = error.code ?? "";
  if (code === NO_ROWS_CODE) return false;
  if (/^(22|23|42)/.test(code)) return false;
  if (/^PGRST[12]\d\d$/.test(code)) return false;
  return true;
}

export function backoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
}

/**
 * Runs a database write until it succeeds, a permanent error occurs, or attempts run out.
 * With `requireRow`, a write that reports a count of zero rows is a permanent failure.
 */
export async function writeWithRetry(
  write: () => PromiseLike<DbWriteResult>,
  options: RetryOptions & { requireRow?: boolean } = {},
): Promise<{ ok: true; attempts: number } | { ok: false; attempts: number; error: DbWriteError }> {
  const attempts = options.attempts ?? SG_WRITE_RETRY_DEFAULTS.attempts;
  const baseDelayMs = options.baseDelayMs ?? SG_WRITE_RETRY_DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? SG_WRITE_RETRY_DEFAULTS.maxDelayMs;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: DbWriteError = { message: "write not attempted" };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let result: DbWriteResult;
    try {
      result = await write();
    } catch (e) {
      result = { error: { message: (e as Error)?.message ?? String(e) } };
    }
    if (!result.error && options.requireRow && result.count === 0) {
      result = { error: { message: "no matching row was updated", code: NO_ROWS_CODE } };
    }
    if (!result.error) return { ok: true, attempts: attempt };
    lastError = result.error;
    if (!isTransientDbError(lastError) || attempt === attempts) {
      return { ok: false, attempts: attempt, error: lastError };
    }
    const delayMs = backoffDelayMs(attempt, baseDelayMs, maxDelayMs);
    options.onRetry?.(attempt, lastError, delayMs);
    await sleep(delayMs);
  }
  return { ok: false, attempts, error: lastError };
}

export interface SgRenderCompletionWriter {
  /** Updates the file row; should report the affected-row count. */
  updateFile(fileId: string, fields: Record<string, unknown>): PromiseLike<DbWriteResult>;
  /** Updates the queue row; should report the affected-row count. */
  updateJob(jobId: string, fields: Record<string, unknown>): PromiseLike<DbWriteResult>;
  /** Sets thumbnail_error only if the file has no thumbnail; matching no row is fine. */
  recordFileError(fileId: string, message: string): PromiseLike<DbWriteResult>;
}

export interface SgRenderCompletionInput {
  jobId: string;
  fileId: string | null;
  success: boolean;
  thumbnailUrl?: string;
  errorMsg?: string;
  now: string;
}

export type SgRenderCompletionOutcome =
  | { ok: true; status: "completed" | "failed" }
  | { ok: false; status: "failed"; error: string };

export async function persistSgRenderCompletion(
  writer: SgRenderCompletionWriter,
  input: SgRenderCompletionInput,
  options: RetryOptions = {},
): Promise<SgRenderCompletionOutcome> {
  const { jobId, fileId, success, thumbnailUrl, errorMsg, now } = input;

  if (success && thumbnailUrl && fileId) {
    const fileWrite = await writeWithRetry(
      () => writer.updateFile(fileId, { thumbnail_url: thumbnailUrl, thumbnail_error: null }),
      { ...options, requireRow: true },
    );
    if (!fileWrite.ok) {
      const reason = `Thumbnail save failed after ${fileWrite.attempts} attempt(s): ${fileWrite.error.message}`;
      await markJobFailedOrThrow(writer, jobId, reason, now, options);
      // Best effort: the queue row already carries the reason.
      await writeWithRetry(() => writer.recordFileError(fileId, reason), options);
      return { ok: false, status: "failed", error: reason };
    }
    await writeJobOrThrow(writer, jobId, { status: "completed", completed_at: now, error_message: null }, options);
    return { ok: true, status: "completed" };
  }

  const status = success ? "completed" : "failed";
  await writeJobOrThrow(writer, jobId, { status, completed_at: now, error_message: errorMsg || null }, options);
  if (!success && errorMsg && fileId) {
    const fileWrite = await writeWithRetry(() => writer.recordFileError(fileId, errorMsg), options);
    if (!fileWrite.ok) {
      return { ok: false, status: "failed", error: `Recording render error failed: ${fileWrite.error.message}` };
    }
  }
  return { ok: true, status };
}

async function markJobFailedOrThrow(
  writer: SgRenderCompletionWriter,
  jobId: string,
  reason: string,
  now: string,
  options: RetryOptions,
) {
  await writeJobOrThrow(writer, jobId, { status: "failed", completed_at: now, error_message: reason }, options);
}

async function writeJobOrThrow(
  writer: SgRenderCompletionWriter,
  jobId: string,
  fields: Record<string, unknown>,
  options: RetryOptions,
) {
  const jobWrite = await writeWithRetry(() => writer.updateJob(jobId, fields), { ...options, requireRow: true });
  if (!jobWrite.ok) {
    throw new Error(
      `style_guide_render_queue update for job ${jobId} failed after ${jobWrite.attempts} attempt(s): ${jobWrite.error.message}`,
    );
  }
}

// ── Exhausted jobs ──────────────────────────────────────────────────
//
// claim_sg_render_jobs only reclaims rows with attempts below the maximum, so a
// job whose final attempt was claimed by an agent that then died stayed
// "claimed" forever: never retried, never failed, and its file looked "not yet
// rendered". Before each claim, such jobs are now marked failed and the reason
// is recorded on the file, so they appear in the PopSG failures list and can be
// retried from there.

/** Must match the p_max_attempts the claim RPC is called with. */
export const SG_RENDER_MAX_ATTEMPTS = 3;
export const SG_EXHAUSTED_SWEEP_LIMIT = 50;

export interface ExhaustedSgRenderJob {
  id: string;
  style_guide_file_id: string | null;
  attempts: number;
}

export interface SgExhaustedJobWriter {
  /** Claimed jobs whose lease expired before `now` and that have no attempts left. */
  listExhausted(maxAttempts: number, now: string, limit: number): PromiseLike<{ data: ExhaustedSgRenderJob[] | null; error: DbWriteError | null }>;
  /**
   * Marks one job failed, only if it is still claimed with an expired lease, so a
   * late completion from the agent is never overwritten. Should report the row count.
   */
  failIfStillExpired(jobId: string, fields: Record<string, unknown>, now: string): PromiseLike<DbWriteResult>;
  /** Sets thumbnail_error only if the file has no thumbnail; matching no row is fine. */
  recordFileError(fileId: string, message: string): PromiseLike<DbWriteResult>;
}

export function exhaustedJobMessage(attempts: number): string {
  return `Render abandoned: the render agent stopped responding during attempt ${attempts} of ${SG_RENDER_MAX_ATTEMPTS} and no attempts remain`;
}

export async function failExhaustedSgRenderJobs(
  writer: SgExhaustedJobWriter,
  now: string,
  options: { maxAttempts?: number; limit?: number } = {},
): Promise<{ failed: string[]; error?: string }> {
  const maxAttempts = options.maxAttempts ?? SG_RENDER_MAX_ATTEMPTS;
  const { data, error } = await writer.listExhausted(maxAttempts, now, options.limit ?? SG_EXHAUSTED_SWEEP_LIMIT);
  if (error) return { failed: [], error: `listing exhausted jobs failed: ${error.message}` };

  const failed: string[] = [];
  const problems: string[] = [];
  for (const job of data ?? []) {
    const message = exhaustedJobMessage(job.attempts);
    const jobWrite = await writer.failIfStillExpired(job.id, { status: "failed", completed_at: now, error_message: message }, now);
    if (jobWrite.error) {
      problems.push(`job ${job.id}: ${jobWrite.error.message}`);
      continue;
    }
    if (jobWrite.count === 0) continue; // completed or reclaimed meanwhile
    failed.push(job.id);
    if (job.style_guide_file_id) {
      const fileWrite = await writer.recordFileError(job.style_guide_file_id, message);
      if (fileWrite.error) problems.push(`file ${job.style_guide_file_id}: ${fileWrite.error.message}`);
    }
  }
  return problems.length ? { failed, error: problems.join("; ") } : { failed };
}
