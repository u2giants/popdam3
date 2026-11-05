import { describe, expect, it } from "vitest";
import { type DamRenderCompletionWriter, persistDamRenderCompletion, THUMBNAIL_PERSISTENCE_FAILED } from "./dam-render-completion.ts";
import type { DbWriteResult } from "./sg-render-completion.ts";

const now = "2026-11-05T04:00:00.000Z";
const retryOptions = { sleep: async () => {} };
const input = { success: true, thumbnailUrl: "https://example.invalid/thumb.jpg", now };
function fakeDb(status = "claimed", saveResult: DbWriteResult = { error: null, count: 1 }) {
  const job = { status, error_message: null as string | null, completed_at: null as string | null };
  const asset = { thumbnail_url: null as string | null };
  const calls = { saves: 0, failureWrites: 0 };
  let beforeFailure: (() => void) | undefined;
  const writer: DamRenderCompletionWriter = {
    completeInFlight: async (fields) => {
      if (!["claimed", "processing"].includes(job.status)) return { error: null, count: 0 };
      Object.assign(job, fields);
      return { error: null, count: 1 };
    },
    readJob: async () => job,
    saveThumbnail: async () => {
      calls.saves++;
      beforeFailure?.();
      if (!saveResult.error && saveResult.count) asset.thumbnail_url = input.thumbnailUrl;
      return saveResult;
    },
    failOwnCompletion: async (reason, completedAt) => {
      calls.failureWrites++;
      if (job.status !== "completed" || job.completed_at !== completedAt) return { error: null, count: 0 };
      Object.assign(job, { status: "failed", error_message: reason });
      return { error: null, count: 1 };
    },
  };
  return {
    writer,
    job,
    asset,
    calls,
    beforeFailure: (fn: () => void) => {
      beforeFailure = fn;
    },
  };
}

describe("DAM thumbnail persistence", () => {
  it("fails the completed job and every success retry when the thumbnail save fails", async () => {
    const db = fakeDb("claimed", { error: { message: "statement timeout", code: "57014" } });
    const result = await persistDamRenderCompletion(db.writer, input, retryOptions);
    expect(result).toEqual({ ok: false, error: `${THUMBNAIL_PERSISTENCE_FAILED}: statement timeout` });
    expect(db.job.status).toBe("failed");
    expect(db.asset.thumbnail_url).toBeNull();
    expect(await persistDamRenderCompletion(db.writer, input, retryOptions)).toEqual(result);
    expect(db.calls.saves).toBe(5);
    // The agent's subsequent failure report must preserve the diagnostic marker.
    expect(await persistDamRenderCompletion(db.writer, { ...input, success: false }, retryOptions)).toEqual({ ok: true, noop: true });
    expect(db.job.error_message).toContain(THUMBNAIL_PERSISTENCE_FAILED);
  });

  it("retries a transient save error and completes after the thumbnail is saved", async () => {
    const db = fakeDb();
    let attempts = 0;
    db.writer.saveThumbnail = async () => {
      attempts++;
      if (attempts === 1) return { error: { message: "connection reset", code: "08006" } };
      db.asset.thumbnail_url = input.thumbnailUrl;
      return { error: null, count: 1 };
    };
    expect(await persistDamRenderCompletion(db.writer, input, retryOptions)).toEqual({ ok: true, noop: false });
    expect(attempts).toBe(2);
    expect(db.asset.thumbnail_url).toBe(input.thumbnailUrl);
    expect(db.job.status).toBe("completed");
    expect(db.calls.failureWrites).toBe(0);
  });

  it("does not retry a permanent save error", async () => {
    const db = fakeDb("claimed", { error: { message: "permission denied", code: "42501" } });
    expect(await persistDamRenderCompletion(db.writer, input, retryOptions)).toMatchObject({ ok: false });
    expect(db.calls.saves).toBe(1);
    expect(db.job.status).toBe("failed");
  });

  it("persists the thumbnail on normal completion", async () => {
    const db = fakeDb();
    expect(await persistDamRenderCompletion(db.writer, input, retryOptions)).toEqual({ ok: true, noop: false });
    expect(db.job.status).toBe("completed");
    expect(db.asset.thumbnail_url).toBe(input.thumbnailUrl);
    expect(db.calls.failureWrites).toBe(0);
  });

  it.each(["pending", "completed", "failed"])("does not touch metadata for a late %s job", async (status) => {
    const db = fakeDb(status);
    expect(await persistDamRenderCompletion(db.writer, input, retryOptions)).toEqual({ ok: true, noop: true });
    expect(db.job.status).toBe(status);
    expect(db.calls.saves).toBe(0);
    expect(db.calls.failureWrites).toBe(0);
  });

  it("treats a missing asset row as a failed thumbnail save", async () => {
    const db = fakeDb("processing", { error: null, count: 0 });
    expect(await persistDamRenderCompletion(db.writer, input, retryOptions)).toMatchObject({ ok: false });
    expect(db.job.error_message).toContain("no matching row was updated");
  });

  it("rejects a successful render without a thumbnail", async () => {
    const db = fakeDb();
    expect(await persistDamRenderCompletion(db.writer, { ...input, thumbnailUrl: undefined }, retryOptions)).toMatchObject({ ok: false });
    expect(db.job.status).toBe("failed");
    expect(db.calls.saves).toBe(0);
  });

  it("records a thrown thumbnail save failure", async () => {
    const db = fakeDb();
    db.writer.saveThumbnail = async () => {
      throw new Error("connection reset");
    };
    expect(await persistDamRenderCompletion(db.writer, input, retryOptions)).toEqual({
      ok: false,
      error: `${THUMBNAIL_PERSISTENCE_FAILED}: connection reset`,
    });
    expect(db.job.status).toBe("failed");
  });

  it("surfaces a failure to record the failed-job marker", async () => {
    const db = fakeDb("claimed", { error: { message: "save timeout" } });
    db.writer.failOwnCompletion = async () => ({ error: { message: "queue unavailable" } });
    expect(await persistDamRenderCompletion(db.writer, input, retryOptions)).toEqual({
      ok: false,
      error: `${THUMBNAIL_PERSISTENCE_FAILED}: save timeout; recording failure failed: queue unavailable`,
    });
  });

  it("does not overwrite a concurrently requeued job when recording persistence failure", async () => {
    const db = fakeDb("claimed", { error: { message: "timeout" } });
    db.beforeFailure(() => {
      db.job.status = "pending";
    });
    expect(await persistDamRenderCompletion(db.writer, input, retryOptions)).toMatchObject({ ok: false });
    expect(db.job.status).toBe("pending");
    expect(db.job.error_message).toBeNull();
  });

  it("does not overwrite a different completion timestamp", async () => {
    const db = fakeDb("claimed", { error: { message: "timeout" } });
    db.beforeFailure(() => {
      db.job.completed_at = "2026-11-05T04:00:01.000Z";
    });
    expect(await persistDamRenderCompletion(db.writer, input, retryOptions)).toMatchObject({ ok: false });
    expect(db.job.status).toBe("completed");
    expect(db.job.error_message).toBeNull();
  });
});
