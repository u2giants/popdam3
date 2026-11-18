import { describe, expect, it } from "vitest";
import { type RenderRetryWriter, scheduleRenderRetries } from "./render-retry-scheduling.ts";

function fake(opts: { assetErr?: boolean; queueErr?: boolean; insertErr?: boolean; queued?: string[] } = {}) {
  const inserted: string[] = [];
  const writer: RenderRetryWriter = {
    findAssets: async (paths) => opts.assetErr
      ? { data: null, error: { message: "boom" } }
      : { data: paths.map((p) => ({ id: `id-${p}`, relative_path: p })), error: null },
    findQueued: async () => opts.queueErr
      ? { data: null, error: { message: "boom" } }
      : { data: (opts.queued ?? []).map((a) => ({ asset_id: a })), error: null },
    insertJobs: async (rows) => {
      if (opts.insertErr) return { error: { message: "boom" } };
      inserted.push(...rows.map((r) => r.asset_id));
      return { error: null };
    },
  };
  return { writer, inserted };
}

describe("scheduleRenderRetries", () => {
  it("queues only assets without pending/claimed jobs", async () => {
    const { writer, inserted } = fake({ queued: ["id-a"] });
    const r = await scheduleRenderRetries(["a", "b"], writer);
    expect(r).toEqual({ queued: 1, failedPaths: [], error: null });
    expect(inserted).toEqual(["id-b"]);
  });

  it("reports all paths when asset lookup fails", async () => {
    const r = await scheduleRenderRetries(["a", "b"], fake({ assetErr: true }).writer);
    expect(r.failedPaths).toEqual(["a", "b"]);
    expect(r.error).toMatch(/asset lookup/);
  });

  it("reports paths when queue lookup fails and inserts nothing", async () => {
    const f = fake({ queueErr: true });
    const r = await scheduleRenderRetries(["a"], f.writer);
    expect(r.failedPaths).toEqual(["a"]);
    expect(f.inserted).toEqual([]);
  });

  it("reports unqueued paths when insert fails", async () => {
    const r = await scheduleRenderRetries(["a", "b"], fake({ insertErr: true, queued: ["id-a"] }).writer);
    expect(r.failedPaths).toEqual(["b"]);
    expect(r.error).toMatch(/insert/);
  });

  it("retry after a failure does not duplicate queued work", async () => {
    const f = fake({ queued: ["id-a"] });
    const r = await scheduleRenderRetries(["a"], f.writer);
    expect(r).toEqual({ queued: 0, failedPaths: [], error: null });
    expect(f.inserted).toEqual([]);
  });
});
