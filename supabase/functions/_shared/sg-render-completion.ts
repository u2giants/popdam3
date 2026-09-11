// Persists the result of a style-guide render job.
//
// The thumbnail write used to ignore its error result and mark the queue row
// "completed" first, so a failed write left a completed job with no thumbnail
// and nothing surfaced. Now: the file write happens first and is retried with
// bounded backoff; if it still fails, the queue row is marked failed with the
// reason and the caller is told, so the render agent reports the failure too.

export interface DbWriteError {
  message: string;
  code?: string;
}

export interface DbWriteResult {
  error: DbWriteError | null;
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

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Postgres classes 22 (data exception), 23 (constraint violation) and 42
 * (syntax / permission / undefined object) and PostgREST request errors will
 * fail the same way every time; everything else (network, timeouts,
 * connection loss, serialization failures, 5xx) is worth retrying.
 */
export function isTransientDbError(error: DbWriteError): boolean {
  const code = error.code ?? "";
  if (/^(22|23|42)/.test(code)) return false;
  if (/^PGRST[12]\d\d$/.test(code)) return false;
  return true;
}

export function backoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
}

/** Runs a database write until it succeeds, a permanent error occurs, or attempts run out. */
export async function writeWithRetry(
  write: () => PromiseLike<DbWriteResult>,
  options: RetryOptions = {},
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
  updateFile(fileId: string, fields: Record<string, unknown>): PromiseLike<DbWriteResult>;
  updateJob(jobId: string, fields: Record<string, unknown>): PromiseLike<DbWriteResult>;
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
      options,
    );
    if (!fileWrite.ok) {
      const reason = `Thumbnail save failed after ${fileWrite.attempts} attempt(s): ${fileWrite.error.message}`;
      await markJobFailedOrThrow(writer, jobId, reason, now, options);
      // Best effort: the queue row already carries the reason.
      await writeWithRetry(() => writer.updateFile(fileId, { thumbnail_error: reason }), options);
      return { ok: false, status: "failed", error: reason };
    }
    await writeJobOrThrow(writer, jobId, { status: "completed", completed_at: now, error_message: null }, options);
    return { ok: true, status: "completed" };
  }

  const status = success ? "completed" : "failed";
  await writeJobOrThrow(writer, jobId, { status, completed_at: now, error_message: errorMsg || null }, options);
  if (!success && errorMsg && fileId) {
    const fileWrite = await writeWithRetry(() => writer.updateFile(fileId, { thumbnail_error: errorMsg }), options);
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
  const jobWrite = await writeWithRetry(() => writer.updateJob(jobId, fields), options);
  if (!jobWrite.ok) {
    throw new Error(
      `style_guide_render_queue update for job ${jobId} failed after ${jobWrite.attempts} attempt(s): ${jobWrite.error.message}`,
    );
  }
}
