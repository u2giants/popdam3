import { describe, expect, it, vi } from "vitest";
import { emitIndexedWriteReceipt } from "./indexed-write-receipt.ts";

describe("indexed-write aggregate hook", () => {
  it("is silent when disabled", () => {
    const log = vi.fn();
    emitIndexedWriteReceipt(false, "public.assets", "ingest-update", 1, 1, log);
    expect(log).not.toHaveBeenCalled();
  });

  it("records counts and time without accepting row identifiers or values", () => {
    const log = vi.fn();
    emitIndexedWriteReceipt(true, "public.style_guide_files", "crawl-reconcile", 2, 2, log, () => new Date("2026-09-28T01:00:00Z"));
    expect(log).toHaveBeenCalledWith("[indexed-write-measurement]", {
      observed_at: "2026-09-28T01:00:00.000Z",
      table: "public.style_guide_files",
      path: "crawl-reconcile",
      attempted_rows: 2,
      succeeded_rows: 2,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("row_id");
  });

  it("keeps unknown result counts visibly unknown", () => {
    const log = vi.fn();
    emitIndexedWriteReceipt(true, "public.assets", "style-group-assignment", null, null, log);
    expect(log.mock.calls[0][1]).toMatchObject({ attempted_rows: null, succeeded_rows: null });
  });
});
