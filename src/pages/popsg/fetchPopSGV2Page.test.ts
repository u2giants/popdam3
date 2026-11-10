import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcCalls: Array<Record<string, unknown>> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async () => ({
        data: { mode: "hybrid", embedding: Array(768).fill(0.1), fallback: "paw patrol", fallback_kind: "narrowed_name" },
        error: null,
      })),
    },
    rpc: vi.fn((_name: string, args: Record<string, unknown>) => {
      rpcCalls.push(args);
      // The typed words match nothing; the fallback name matches 250 files.
      const total = args.p_query === "paw patrol" ? 250 : 0;
      const offset = Number(args.p_offset ?? 0);
      const limit = Number(args.p_limit ?? 0);
      const count = Math.max(0, Math.min(limit, total - offset));
      const data = {
        result_mode: "files",
        total,
        results: Array.from({ length: count }, (_, i) => ({ style_guide_file_id: `f${offset + i}`, filename: `f${offset + i}.pdf`, relative_path: `a/f${offset + i}.pdf`, directory_path: "a" })),
      };
      return { abortSignal: () => Promise.resolve({ data, error: null }) };
    }),
  },
}));
vi.mock("@/lib/dam-search", () => ({ expandFallbackTerms: async (q: string) => [q.toLowerCase()] }));

if (!("timeout" in AbortSignal)) Object.assign(AbortSignal, { timeout: () => new AbortController().signal });
import { fetchPopSGV2Page } from "./PopSGLibraryPage";

const filters = { licensor: "all", property: "all", nameSearch: "chase paw patrol", fileTypes: [], thumbStatus: "all" } as never;

describe("fetchPopSGV2Page empty-result retry (#883)", () => {
  beforeEach(() => { rpcCalls.length = 0; });

  it("keeps the fallback on later pages so total and rows stay consistent", async () => {
    const page0 = await fetchPopSGV2Page("files", filters, "modified_at", "desc", 0, 100 as never);
    const page1 = await fetchPopSGV2Page("files", filters, "modified_at", "desc", 1, 100 as never);
    const page2 = await fetchPopSGV2Page("files", filters, "modified_at", "desc", 2, 100 as never);
    expect([page0.total, page1.total, page2.total]).toEqual([250, 250, 250]);
    expect([page0.rows.length, page1.rows.length, page2.rows.length]).toEqual([100, 100, 50]);
  });

  it("retries once per page after an empty search and never probes", async () => {
    await fetchPopSGV2Page("files", filters, "modified_at", "desc", 1, 100 as never);
    // Typed words empty → one fallback search; never a limit-1 probe.
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls.every((a) => a.p_limit !== 1)).toBe(true);
    expect(rpcCalls.map((a) => a.p_offset)).toEqual([100, 100]);
  });
});
