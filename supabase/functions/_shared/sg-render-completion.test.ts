import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  type DbWriteResult,
  isTransientDbError,
  persistSgRenderCompletion,
  type SgRenderCompletionWriter,
  writeWithRetry,
} from "./sg-render-completion.ts";

const NOW = "2026-09-11T12:00:00.000Z";
const transient = { error: { message: "fetch failed: connection reset" } };
const ok: DbWriteResult = { error: null };

function fakeWriter(fileResults: DbWriteResult[], jobResults: DbWriteResult[] = []) {
  const calls = { file: [] as Record<string, unknown>[], job: [] as Record<string, unknown>[] };
  const writer: SgRenderCompletionWriter = {
    updateFile: (_id, fields) => {
      calls.file.push(fields);
      return Promise.resolve(fileResults.shift() ?? ok);
    },
    updateJob: (_id, fields) => {
      calls.job.push(fields);
      return Promise.resolve(jobResults.shift() ?? ok);
    },
  };
  return { writer, calls };
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
    const { writer, calls } = fakeWriter([transient, transient, transient, transient, transient, ok]);
    const outcome = await persistSgRenderCompletion(writer, input, { sleep });

    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe("failed");
    // 5 attempts at the thumbnail, then the reason recorded on the file row.
    expect(calls.file.slice(0, 5).every((f) => f.thumbnail_url === "https://cdn/x.jpg")).toBe(true);
    expect(calls.file[5]).toEqual({ thumbnail_error: expect.stringContaining("Thumbnail save failed after 5 attempt(s)") });
    expect(delays).toEqual([250, 500, 1_000, 2_000]);
    expect(calls.job).toHaveLength(1);
    expect(calls.job[0]).toMatchObject({ status: "failed", completed_at: NOW });
    expect(calls.job[0].error_message).toContain("connection reset");
    expect(calls.job.some((j) => j.status === "completed")).toBe(false);
  });

  it("throws when even the job row cannot be marked failed, so the caller returns an error", async () => {
    const { sleep } = recordingSleep();
    const failing = Array(5).fill(transient);
    const { writer } = fakeWriter([...failing], [...failing]);
    await expect(persistSgRenderCompletion(writer, input, { sleep })).rejects.toThrow(/style_guide_render_queue update/);
  });

  it("records an agent-reported failure on the job and file", async () => {
    const { writer, calls } = fakeWriter([]);
    const outcome = await persistSgRenderCompletion(writer, {
      jobId: "job-1",
      fileId: "file-1",
      success: false,
      errorMsg: "Illustrator crashed",
      now: NOW,
    });
    expect(outcome).toEqual({ ok: true, status: "failed" });
    expect(calls.job).toEqual([{ status: "failed", completed_at: NOW, error_message: "Illustrator crashed" }]);
    expect(calls.file).toEqual([{ thumbnail_error: "Illustrator crashed" }]);
  });
});
