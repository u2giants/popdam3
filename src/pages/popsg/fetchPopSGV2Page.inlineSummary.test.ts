import { describe, expect, it, vi } from "vitest";

const fromCalls: string[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: { mode: "keyword" }, error: null })) },
    from: vi.fn((table: string) => { fromCalls.push(table); throw new Error("no summary fetch expected"); }),
    rpc: vi.fn(() => ({
      abortSignal: () => Promise.resolve({
        data: {
          result_mode: "guides",
          total: 1,
          results: [{
            guide_key: "g1", root_label: "R", licensor_name: "L", property_folder: "P", style_guide_folder: "G",
            style_guide_name: "G", matched_file_count: 1, whole_guide_file_count: 3, total_size_bytes: 350,
            member_directory_paths: ["L/G", "L/G/Extra"],
          }],
        },
        error: null,
      }),
    })),
  },
}));
vi.mock("@/lib/dam-search", () => ({ expandFallbackTerms: async (q: string) => [q.toLowerCase()] }));

if (!("timeout" in AbortSignal)) Object.assign(AbortSignal, { timeout: () => new AbortController().signal });
import { fetchPopSGV2Page } from "./PopSGLibraryPage";

describe("PopSG guide search with inline whole-guide summary (#1430 Step 9)", () => {
  it("shows whole-guide totals with no style_guide_file_groups requests", async () => {
    const filters = { licensor: "all", property: "all", nameSearch: "guide", fileTypes: [], thumbStatus: "all" } as never;
    const page = await fetchPopSGV2Page("guides", filters, "modified_at", "desc", 0, 60 as never);
    expect(fromCalls).toEqual([]);
    expect(page.rows[0]).toMatchObject({ file_count: 3, total_size_bytes: 350, member_directory_paths: ["L/G", "L/G/Extra"] });
  });
});
