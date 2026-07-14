import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));

import { fetchHybridSearchIds, fetchSearchIds, parseSearchMode, sortByRank } from "@/lib/dam-search";

describe("DAM hybrid search", () => {
  beforeEach(() => invoke.mockReset());

  it("maps only matching edge results to ranked entity IDs", async () => {
    invoke.mockResolvedValue({
      data: { results: [
        { document_type: "asset", entity_id: "second" },
        { document_type: "style_group", entity_id: "ignored" },
        { document_type: "asset", entity_id: "first" },
      ] },
      error: null,
    });

    await expect(fetchHybridSearchIds("snowman", "asset", 500)).resolves.toEqual(["second", "first"]);
    expect(invoke).toHaveBeenCalledWith("dam-search-ai", {
      body: { action: "search", query: "snowman", limit: 500, document_types: ["asset"] },
    });
  });

  it("preserves relevance order independently of database row order", () => {
    const rows = [{ id: "third" }, { id: "first" }, { id: "second" }];
    expect(sortByRank(rows, ["second", "third", "first"], (row) => row.id))
      .toEqual([{ id: "second" }, { id: "third" }, { id: "first" }]);
  });

  it("keeps keyword mode as the default for absent or invalid config", () => {
    expect(parseSearchMode(undefined)).toBe("keyword");
    expect(parseSearchMode("anything-else")).toBe("keyword");
    expect(parseSearchMode("hybrid")).toBe("hybrid");
  });

  it("keeps keyword mode on the existing keyword callback", async () => {
    const keywordSearch = vi.fn().mockResolvedValue(["keyword-first", "keyword-second"]);
    await expect(fetchSearchIds("keyword", "snowman", "asset", 500, keywordSearch))
      .resolves.toEqual(["keyword-first", "keyword-second"]);
    expect(keywordSearch).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  });
});
