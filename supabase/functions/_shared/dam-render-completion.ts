import { writeWithRetry, type DbWriteResult, type RetryOptions } from "./sg-render-completion.ts";

export const THUMBNAIL_PERSISTENCE_FAILED = "thumbnail_persistence_failed";

export interface DamRenderCompletionWriter {
  completeInFlight(fields: Record<string, unknown>): PromiseLike<DbWriteResult>;
  readJob(): PromiseLike<{ status: string; error_message: string | null } | null>;
  saveThumbnail(): PromiseLike<DbWriteResult>;
  // Must match the exact completion timestamp as well as completed status.
  failOwnCompletion(reason: string, completedAt: string): PromiseLike<DbWriteResult>;
}

type Outcome = { ok: true; noop: boolean } | { ok: false; error: string };

/** Keep the in-flight guard ahead of metadata writes, including late retries. */
export async function persistDamRenderCompletion(
  writer: DamRenderCompletionWriter,
  input: { success: boolean; thumbnailUrl?: string; errorMsg?: string; now: string },
  retryOptions: RetryOptions = {},
): Promise<Outcome> {
  const completed = await writer.completeInFlight({
    status: input.success ? "completed" : "failed",
    completed_at: input.now,
    error_message: input.errorMsg ?? null,
    lease_expires_at: null,
  });
  if (completed.error) return { ok: false, error: completed.error.message };
  if (!completed.count) {
    // callApi retries failed HTTP calls. Do not turn a failed thumbnail save
    // into an acknowledged success just because its queue row is now failed.
    const job = input.success ? await writer.readJob() : null;
    if (job?.status === "failed" && job.error_message?.startsWith(THUMBNAIL_PERSISTENCE_FAILED)) {
      return { ok: false, error: job.error_message };
    }
    return { ok: true, noop: true };
  }
  if (!input.success) return { ok: true, noop: false };

  let failure: string | undefined;
  if (!input.thumbnailUrl) {
    failure = "successful render did not provide a thumbnail";
  } else {
    const saved = await writeWithRetry(() => writer.saveThumbnail(), { ...retryOptions, requireRow: true });
    if (!saved.ok) failure = saved.error.message;
  }
  if (!failure) return { ok: true, noop: false };

  const reason = `${THUMBNAIL_PERSISTENCE_FAILED}: ${failure}`;
  const failed = await writer.failOwnCompletion(reason, input.now);
  if (failed.error) return { ok: false, error: `${reason}; recording failure failed: ${failed.error.message}` };
  return { ok: false, error: reason };
}
