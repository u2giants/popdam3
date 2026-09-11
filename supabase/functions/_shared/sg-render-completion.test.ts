import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  type DbWriteResult,
  exhaustedJobMessage,
  failExhaustedSgRenderJobs,
  isTransientDbError,
  type SgExhaustedJobWriter,
  persistSgRenderCompletion,
  type SgRenderCompletionWriter,
  writeWithRetry,
} from "./sg-render-completion.ts";

const NOW = "2026-09-11T12:00:00.000Z";
const transient = { error: { message: "fetch failed: connection reset" } };
const ok: DbWriteResult = { error: null, count: 1 };
const noRows: DbWriteResult = { error: null, count: 0 };

function fakeWriter(
  fileResults: DbWriteResult[],
  jobResults: DbWriteResult[] = [],
  file: { thumbnail_url: string | null; thumbnail_error: string | null } = { thumbnail_url: null, thumbnail_error: null },
) {
  const calls = { file: [] as Record<string, unknown>[], job: [] as Record<string, unknown>[], fileError: [] as string[] };
  const writer: SgRenderCompletionWriter = {
    updateFile: (_id, fields) => {
      calls.file.push(fields);
      const result = fileResults.shift() ?? ok;
      if (!result.error && result.count !== 0) Object.assign(file, fields);
      return Promise.resolve(result);
    },
    updateJob: (_id, fields) => {
      calls.job.push(fields);
      return Promise.resolve(jobResults.shift() ?? ok);
    },
    // Mirrors the real write: only files without a thumbnail get the error.
    recordFileError: (_id, message) => {
      calls.fileError.push(message);
      if (file.thumbnail_url) return Promise.resolve(noRows);
      file.thumbnail_error = message;
      return Promise.resolve(ok);
    },
  };
  return { writer, calls, file };
}

function recordingSleep() {
  const delays: number[] = [];
  return { delays, sleep: (ms: number) => (delays.push(ms), Promise.resolve()) };
}

describe("writeWithRetry", () => {
  it("caps the backoff wait", () => {
    expect([1, 2, 3, 4, 5, 6].map((a) => backoffDelayMs(a, 250, 4_000))).toEqual([250, 500, 1_000, 2_000, 4_000, 4_000]);
  });

  it("does not retry permanent errors", async () => {
    const { sleep, delays } = recordingSleep();
    let calls = 0;
    const result = await writeWithRetry(() => {
      calls++;
      return Promise.resolve({ error: { message: "permission denied", code: "42501" } });
    }, { sleep });
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
    expect(isTransientDbError({ message: "timeout", code: "57014" })).toBe(true);
  });

  it("treats a thrown write as transient", async () => {
    const { sleep } = recordingSleep();
    let calls = 0;
    const result = await writeWithRetry(() => {
      calls++;
      if (calls === 1) throw new Error("network down");
      return Promise.resolve(ok);
    }, { sleep });
    expect(result).toEqual({ ok: true, attempts: 2 });
  });

  it("fails a required-row write that matched nothing, without retrying", async () => {
    const { sleep, delays } = recordingSleep();
    let calls = 0;
    const write = () => (calls++, Promise.resolve(noRows));
    const result = await writeWithRetry(write, { sleep, requireRow: true });
    expect(result).toMatchObject({ ok: false, attempts: 1, error: { code: "NO_ROWS" } });
    expect(delays).toEqual([]);
    // Without requireRow a zero count is not an error.
    expect(await writeWithRetry(write, { sleep })).toEqual({ ok: true, attempts: 1 });
  });
});

describe("persistSgRenderCompletion", () => {
  const input = { jobId: "job-1", fileId: "file-1", success: true, thumbnailUrl: "https://cdn/x.jpg", now: NOW };

  it("retries a transient thumbnail write failure and then completes the job", async () => {
    const { sleep, delays } = recordingSleep();
    const { writer, calls } = fakeWriter([transient, transient, ok]);
    const outcome = await persistSgRenderCompletion(writer, input, { sleep });
    expect(outcome).toEqual({ ok: true, status: "completed" });
    expect(calls.file).toHaveLength(3);
    expect(delays).toEqual([250, 500]);
    expect(calls.job).toEqual([{ status: "completed", completed_at: NOW, error_message: null }]);
  });

  it("surfaces a thumbnail write that fails every retry instead of reporting completed", async () => {
    const { sleep, delays } = recordingSleep();
    const { writer, calls, file } = fakeWriter([transient, transient, transient, transient, transient]);
    const outcome = await persistSgRenderCompletion(writer, input, { sleep });

    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe("failed");
    expect(calls.file).toHaveLength(5);
    expect(calls.file.every((f) => f.thumbnail_url === "https://cdn/x.jpg")).toBe(true);
    expect(delays).toEqual([250, 500, 1_000, 2_000]);
    expect(file.thumbnail_error).toContain("Thumbnail save failed after 5 attempt(s)");
    expect(calls.job).toHaveLength(1);
    expect(calls.job[0]).toMatchObject({ status: "failed", completed_at: NOW });
    expect(calls.job[0].error_message).toContain("connection reset");
    expect(calls.job.some((j) => j.status === "completed")).toBe(false);
  });

  it("surfaces a thumbnail save that matched no file row", async () => {
    const { sleep, delays } = recordingSleep();
    const { writer, calls } = fakeWriter([noRows]);
    const outcome = await persistSgRenderCompletion(writer, input, { sleep });
    expect(outcome).toMatchObject({ ok: false, status: "failed" });
    expect(calls.file).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(calls.job).toEqual([
      { status: "failed", completed_at: NOW, error_message: expect.stringContaining("no matching row") },
    ]);
  });

  it("throws when the job row matched nothing", async () => {
    const { writer } = fakeWriter([], [noRows]);
    await expect(
      persistSgRenderCompletion(writer, { ...input, success: false, errorMsg: "boom" }),
    ).rejects.toThrow(/no matching row/);
  });

  it("throws when even the job row cannot be marked failed, so the caller returns an error", async () => {
    const { sleep } = recordingSleep();
    const failing = Array(5).fill(transient);
    const { writer } = fakeWriter([...failing], [...failing]);
    await expect(persistSgRenderCompletion(writer, input, { sleep })).rejects.toThrow(/style_guide_render_queue update/);
  });

  it("never leaves a file with both a thumbnail and an error when completing the job fails", async () => {
    const { sleep } = recordingSleep();
    // Thumbnail saves, but marking the job completed fails every attempt.
    const { writer, file } = fakeWriter([ok], Array(5).fill(transient));
    await expect(persistSgRenderCompletion(writer, input, { sleep })).rejects.toThrow();
    expect(file.thumbnail_url).toBe("https://cdn/x.jpg");

    // The agent then reports the job as failed.
    const outcome = await persistSgRenderCompletion(
      writer,
      { jobId: "job-1", fileId: "file-1", success: false, errorMsg: "complete-sg-render returned 500", now: NOW },
      { sleep },
    );
    expect(outcome).toEqual({ ok: true, status: "failed" });
    expect(file).toEqual({ thumbnail_url: "https://cdn/x.jpg", thumbnail_error: null });
  });

  it("records an agent-reported failure on the job and a file with no thumbnail", async () => {
    const { writer, calls, file } = fakeWriter([]);
    const outcome = await persistSgRenderCompletion(writer, {
      jobId: "job-1",
      fileId: "file-1",
      success: false,
      errorMsg: "Illustrator crashed",
      now: NOW,
    });
    expect(outcome).toEqual({ ok: true, status: "failed" });
    expect(calls.job).toEqual([{ status: "failed", completed_at: NOW, error_message: "Illustrator crashed" }]);
    expect(calls.file).toEqual([]);
    expect(file.thumbnail_error).toBe("Illustrator crashed");
  });
});

describe("failExhaustedSgRenderJobs", () => {
  type Job = { id: string; style_guide_file_id: string | null; status: string; attempts: number; lease_expires_at: string; error_message: string | null };
  type File = { thumbnail_url: string | null; thumbnail_error: string | null };

  // Mirrors the queries agent-api runs against the two tables.
  function fakeDb(jobs: Job[], files: Record<string, File>, beforeFail?: (job: Job) => void) {
    const writer: SgExhaustedJobWriter = {
      listExhausted: (maxAttempts, now, limit) =>
        Promise.resolve({
          data: jobs
            .filter((j) => j.status === "claimed" && j.lease_expires_at < now && j.attempts >= maxAttempts)
            .slice(0, limit)
            .map(({ id, style_guide_file_id, attempts }) => ({ id, style_guide_file_id, attempts })),
          error: null,
        }),
      failIfStillExpired: (id, fields, now) => {
        const job = jobs.find((j) => j.id === id)!;
        beforeFail?.(job);
        if (job.status !== "claimed" || !(job.lease_expires_at < now)) return Promise.resolve(noRows);
        Object.assign(job, fields);
        return Promise.resolve(ok);
      },
      recordFileError: (id, message) => {
        const file = files[id];
        if (!file || file.thumbnail_url) return Promise.resolve(noRows);
        file.thumbnail_error = message;
        return Promise.resolve(ok);
      },
    };
    return writer;
  }

  const expired = "2026-07-29T22:43:00.000Z";
  const future = "2026-09-11T12:05:00.000Z";

  it("fails a claimed job whose final attempt's lease expired and records it on the file", async () => {
    const jobs: Job[] = [
      { id: "stuck", style_guide_file_id: "f1", status: "claimed", attempts: 3, lease_expires_at: expired, error_message: null },
    ];
    const files = { f1: { thumbnail_url: null, thumbnail_error: null } };
    const result = await failExhaustedSgRenderJobs(fakeDb(jobs, files), NOW);
    expect(result).toEqual({ failed: ["stuck"] });
    expect(jobs[0].status).toBe("failed");
    expect(jobs[0].error_message).toBe(exhaustedJobMessage(3));
    expect(files.f1.thumbnail_error).toBe(exhaustedJobMessage(3));
  });

  it("leaves reclaimable, still-leased and finished jobs alone", async () => {
    const jobs: Job[] = [
      { id: "retryable", style_guide_file_id: "f1", status: "claimed", attempts: 2, lease_expires_at: expired, error_message: null },
      { id: "rendering", style_guide_file_id: "f2", status: "claimed", attempts: 3, lease_expires_at: future, error_message: null },
      { id: "done", style_guide_file_id: "f3", status: "completed", attempts: 3, lease_expires_at: expired, error_message: null },
    ];
    const files = { f1: { thumbnail_url: null, thumbnail_error: null } };
    const result = await failExhaustedSgRenderJobs(fakeDb(jobs, files), NOW);
    expect(result).toEqual({ failed: [] });
    expect(jobs.map((j) => j.status)).toEqual(["claimed", "claimed", "completed"]);
    expect(files.f1.thumbnail_error).toBeNull();
  });

  it("does not overwrite a job the agent completed after it was listed, nor a file that has a thumbnail", async () => {
    const jobs: Job[] = [
      { id: "late", style_guide_file_id: "f1", status: "claimed", attempts: 3, lease_expires_at: expired, error_message: null },
      { id: "rendered", style_guide_file_id: "f2", status: "claimed", attempts: 3, lease_expires_at: expired, error_message: null },
    ];
    const files = { f1: { thumbnail_url: null, thumbnail_error: null }, f2: { thumbnail_url: "https://cdn/x.jpg", thumbnail_error: null } };
    const db = fakeDb(jobs, files, (job) => { if (job.id === "late") job.status = "completed"; });
    const result = await failExhaustedSgRenderJobs(db, NOW);
    expect(result).toEqual({ failed: ["rendered"] });
    expect(jobs[0].status).toBe("completed");
    expect(files.f1.thumbnail_error).toBeNull();
    expect(files.f2).toEqual({ thumbnail_url: "https://cdn/x.jpg", thumbnail_error: null });
  });

  it("reports a listing error without throwing, so claiming can continue", async () => {
    const writer: SgExhaustedJobWriter = {
      listExhausted: () => Promise.resolve({ data: null, error: { message: "timeout" } }),
      failIfStillExpired: () => Promise.resolve(ok),
      recordFileError: () => Promise.resolve(ok),
    };
    expect(await failExhaustedSgRenderJobs(writer, NOW)).toEqual({ failed: [], error: "listing exhausted jobs failed: timeout" });
  });
});
