import { describe, expect, it } from "vitest";
import {
  addCorrectedTerm,
  hasInlineGuideSummary,
  buildPopSGV2Args,
  buildPopSGSummaryIdentityFilters,
  buildPopSGV2WebsearchQuery,
  canUsePopSGV2,
  enrichPopSGV2Guides,
  getPopSGV2ContinuationOffsets,
  getPopSGSummaryContinuationOffsets,
  getPopSGV2Sort,
  mapPopSGV2File,
  mapPopSGV2Guide,
  parsePopSGQueryEmbedding,
  parsePopSGV2Payload,
} from "./popsgSearchV2";

describe("PopSG search v2 adapter", () => {
  it("maps filters before server-side paging", () => {
    expect(buildPopSGV2Args({
      mode: "files",
      filters: {
        licensor: "Disney",
        property: "Marvel",
        query: "Spider-Man",
        extensions: ["pdf", "ai"],
        preview: "missing",
      },
      sortField: "modified_at",
      sortDirection: "desc",
      limit: 500,
      offset: 1_000,
    })).toEqual({
      p_result_mode: "files",
      p_query: "Spider-Man",
      p_licensors: ["Disney"],
      p_properties: ["Marvel"],
      p_extensions: ["pdf", "ai"],
      p_preview_states: ["missing"],
      p_sort: "relevance",
      p_limit: 200,
      p_offset: 1_000,
      p_include_facets: false,
    });
  });

  it("does not apply file extensions to guide mode", () => {
    const args = buildPopSGV2Args({
      mode: "guides",
      filters: { licensor: "all", property: "all", query: "", extensions: ["pdf"], preview: "has" },
      sortField: "name",
      sortDirection: "asc",
      limit: 60,
      offset: 0,
    });

    expect(args.p_extensions).toBeUndefined();
    expect(args.p_preview_states).toEqual(["available"]);
    expect(args.p_sort).toBe("name_asc");
  });

  it("keeps unsupported sorts on the compatibility path", () => {
    expect(getPopSGV2Sort("size", "asc")).toBeNull();
    expect(getPopSGV2Sort("size", "desc")).toBeNull();
    expect(getPopSGV2Sort("name", "desc")).toBeNull();
    expect(getPopSGV2Sort("size", "desc", "search words")).toBe("relevance");
  });

  it("keeps expanded synonym and separator variants in one websearch query", () => {
    expect(buildPopSGV2WebsearchQuery(["spiderman", "spider man", "spider-man"]))
      .toBe('spiderman OR "spider man" OR "spider-man"');
    expect(buildPopSGV2WebsearchQuery(["winter scene", "winter-scene"]))
      .toBe('winter scene OR "winter-scene"');
  });

  it("keeps guide-level preview choices on the truthful compatibility path", () => {
    expect(canUsePopSGV2("guides", "has", "modified_at", "desc")).toBe(false);
    expect(canUsePopSGV2("guides", "missing", "modified_at", "desc")).toBe(false);
    expect(canUsePopSGV2("guides", "any", "modified_at", "desc")).toBe(true);
    expect(canUsePopSGV2("files", "missing", "modified_at", "desc")).toBe(true);
    expect(canUsePopSGV2("guides", "missing", "size", "desc", "search words")).toBe(true);
  });

  it("splits large visible pages into stable RPC offsets", () => {
    expect(getPopSGV2ContinuationOffsets(1_000, 1_000, 2_500)).toEqual([1_200, 1_400, 1_600, 1_800]);
    expect(getPopSGV2ContinuationOffsets(2_000, 1_000, 2_125)).toEqual([]);
  });

  it("pages the guide summary within the API row cap", () => {
    expect(getPopSGSummaryContinuationOffsets(1_712)).toEqual([1_000]);
    expect(getPopSGSummaryContinuationOffsets(5_000)).toEqual([1_000, 2_000, 3_000, 4_000]);
    expect(() => getPopSGSummaryContinuationOffsets(5_001)).toThrow("bounded enrichment limit");
  });

  it("queries summary enrichment by exact visible guide identities in bounded batches", () => {
    const guide = mapPopSGV2Guide({
      guide_key: "guide-1",
      root_label: "root",
      licensor_name: "Licensor, Inc.",
      property_folder: null,
      style_guide_folder: "Folder",
      style_guide_name: 'Guide "A"',
      matched_file_count: 2,
    });
    expect(buildPopSGSummaryIdentityFilters([guide])).toEqual([
      'and(root_label.eq."root",licensor_name.eq."Licensor, Inc.",property_folder.is.null,style_guide_folder.eq."Folder",style_guide_name.eq."Guide \\"A\\"")',
    ]);
    expect(buildPopSGSummaryIdentityFilters(Array.from({ length: 21 }, () => guide))).toHaveLength(2);
  });

  it("validates the JSON response before rendering", () => {
    expect(parsePopSGV2Payload({
      result_mode: "files",
      total: 1,
      limit: 50,
      offset: 0,
      sort: "modified_desc",
      query: null,
      results: [{ style_guide_file_id: "file-1" }],
      facets: { licensors: [] },
    }).results).toEqual([{ style_guide_file_id: "file-1" }]);

    expect(() => parsePopSGV2Payload({ total: "1", results: [] })).toThrow(
      "PopSG search returned an invalid response.",
    );
  });

  it("maps file and guide rows into the existing cards", () => {
    expect(mapPopSGV2File({
      style_guide_file_id: "file-1",
      filename: "art.pdf",
      relative_path: "Licensor/Property/Guide/art.pdf",
      directory_path: "Licensor/Property/Guide",
      file_extension: "pdf",
      render_exception_state: "terminal_exception",
    })).toMatchObject({ id: "file-1", filename: "art.pdf", thumbnail_error: "terminal_exception" });

    expect(mapPopSGV2Guide({
      guide_key: "guide-1",
      root_label: "styleguides",
      licensor_name: "Licensor",
      property_folder: "Property",
      style_guide_folder: "Guide",
      style_guide_name: "Guide",
      matched_file_count: 12,
      modified_at: "2026-09-20T12:00:00Z",
    })).toMatchObject({
      group_key: "guide-1",
      directory_path: "Licensor/Property/Guide",
      file_count: 12,
      total_size_bytes: null,
      member_directory_paths: ["Licensor/Property/Guide"],
    });
  });

  it("enriches v2 guide cards from the bounded summary view", () => {
    const guide = mapPopSGV2Guide({
      guide_key: "root\u001fLicensor\u001fProperty\u001fGuide\u001fGuide",
      root_label: "root",
      licensor_name: "Licensor",
      property_folder: "Property",
      style_guide_folder: "Guide",
      style_guide_name: "Guide",
      matched_file_count: 2,
    });
    expect(enrichPopSGV2Guides([guide], [{
      root_label: "root",
      directory_path: "Licensor/Property/Guide",
      licensor_name: "Licensor",
      property_folder: "Property",
      style_guide_folder: "Guide",
      style_guide_name: "Guide",
      file_count: 12,
      total_size_bytes: 4096,
    }])[0]).toMatchObject({
      directory_path: "Licensor/Property/Guide",
      file_count: 12,
      total_size_bytes: 4096,
      member_directory_paths: ["Licensor/Property/Guide"],
    });
  });
});

describe("PopSG meaning-based search args", () => {
  const base = {
    mode: "files" as const,
    filters: { licensor: "all", property: "all", query: "cute", extensions: [], preview: "any" as const },
    sortField: "modified_at" as const,
    sortDirection: "desc" as const,
    limit: 50,
    offset: 0,
  };

  it("uses a valid vector only while the switch is hybrid", () => {
    const embedding = new Array(768).fill(0.5);
    expect(parsePopSGQueryEmbedding({ mode: "hybrid", embedding, min_semantic_score: 0.3 }).queryEmbedding).toMatch(/^\[0\.5,/);
    expect(parsePopSGQueryEmbedding({ mode: "keyword", embedding }).queryEmbedding).toBeNull();
    expect(() => parsePopSGQueryEmbedding({ mode: "hybrid", embedding: [1, 2] })).toThrow("Search unavailable");
    expect(() => parsePopSGQueryEmbedding(null)).toThrow("Search unavailable");
    expect(parsePopSGQueryEmbedding({ mode: "hybrid", skipped: "product_code" }).queryEmbedding).toBeNull();
    expect(parsePopSGQueryEmbedding({ mode: "hybrid", skipped: "not_meaningful" }).queryEmbedding).toBeNull();
    expect(parsePopSGQueryEmbedding({ mode: "hybrid", skipped: "names_only", expansion: " Harry Potter " }).expansion).toBe("Harry Potter");
    expect(parsePopSGQueryEmbedding({ mode: "keyword", expansion: "Harry Potter" }).expansion).toBeNull();
    expect(parsePopSGQueryEmbedding({ mode: "hybrid", skipped: "names_only", fallback: " paw patrol " }).fallback).toBe("paw patrol");
    expect(parsePopSGQueryEmbedding({ mode: "keyword", fallback: "paw patrol" }).fallback).toBeNull();
    expect(parsePopSGQueryEmbedding({ mode: "hybrid", skipped: "names_only", fallback: "paw patrol", fallback_kind: "name" }).fallbackAfterMatches).toBe(true);
    expect(parsePopSGQueryEmbedding({ mode: "hybrid", skipped: "names_only", fallback: "paw patrol", fallback_kind: "narrowed_name" }).fallbackAfterMatches).toBe(false);
    expect(parsePopSGQueryEmbedding({ mode: "hybrid", skipped: "names_only", fallback: "paw patrol", fallback_kind: "spelling" }).fallbackAfterMatches).toBe(false);
    expect(parsePopSGQueryEmbedding({ mode: "hybrid", skipped: "names_only", fallback: "paw patrol" }).fallbackAfterMatches).toBe(false);
    expect(parsePopSGQueryEmbedding({ mode: "keyword", fallback: "paw patrol", fallback_kind: "name" }).fallbackAfterMatches).toBe(false);
  });

  it.each([null, {}, { mode: "hybrid", embedding: null }, { mode: "hybrid", embedding: Array(768).fill(NaN) }])(
    "rejects failed or malformed hybrid responses instead of running keyword search: %j", (value) => {
      expect(() => parsePopSGQueryEmbedding(value)).toThrow("Search unavailable. Please try again.");
    },
  );

  it("sends the fallback query only alongside a query", () => {
    expect(buildPopSGV2Args({ ...base }).p_fallback_query).toBeUndefined();
    expect(buildPopSGV2Args({ ...base, filters: { ...base.filters, query: "amazing hero" }, fallbackQuery: "hero" }).p_fallback_query).toBe("hero");
    expect(buildPopSGV2Args({ ...base, filters: { ...base.filters, query: "" }, fallbackQuery: "hero" }).p_fallback_query).toBeUndefined();
  });

  it("sends the floor only with a vector, so keyword search stays unchanged", () => {
    const keyword = buildPopSGV2Args({ ...base, queryEmbedding: null, minSemanticScore: 0.3 });
    expect(keyword.p_query_embedding).toBeUndefined();
    expect(keyword.p_min_semantic_score).toBeUndefined();
    const hybrid = buildPopSGV2Args({ ...base, queryEmbedding: "[1]", minSemanticScore: 0.3 });
    expect(hybrid.p_query_embedding).toBe("[1]");
    expect(hybrid.p_min_semantic_score).toBe(0.3);
  });
});

describe("PopSG single-call spelling (#1430 Step 8)", () => {
  const vector = Array.from({ length: 768 }, () => 0.1);
  it("reads the spelling fix from the embedding response", () => {
    expect(parsePopSGQueryEmbedding({ mode: "hybrid", skipped: "names_only", corrected: " spider man " }).corrected).toBe("spider man");
    expect(parsePopSGQueryEmbedding({ mode: "hybrid", embedding: vector, corrected: null }).corrected).toBeNull();
    expect(parsePopSGQueryEmbedding({ mode: "keyword", corrected: "x" }).corrected).toBeNull();
  });
  it("still shows the error state when the vector is missing", () => {
    expect(() => parsePopSGQueryEmbedding({ mode: "hybrid", corrected: "x" })).toThrow("Search unavailable");
  });
  it("adds the fix and its separator forms without duplicates", () => {
    expect(addCorrectedTerm(["spidermen"], "Spider Man")).toEqual(["spidermen", "spider man", "spider-man"]);
    expect(addCorrectedTerm(["batman"], "batman")).toEqual(["batman"]);
    expect(addCorrectedTerm(["batman"], null)).toEqual(["batman"]);
  });
});

describe("PopSG inline whole-guide summary (#1430 Step 9)", () => {
  const base = { guide_key: "g", root_label: "R", licensor_name: "L", property_folder: "P", style_guide_folder: null, style_guide_name: "P", matched_file_count: 1 };
  it("uses inline totals; single member path becomes the directory", () => {
    const row = { ...base, whole_guide_file_count: 4, total_size_bytes: 9, member_directory_paths: ["L/P/x"] };
    expect(hasInlineGuideSummary(row)).toBe(true);
    expect(mapPopSGV2Guide(row)).toMatchObject({ file_count: 4, total_size_bytes: 9, directory_path: "L/P/x", member_directory_paths: ["L/P/x"] });
  });
  it("falls back to matched count when the RPC has no summary", () => {
    expect(hasInlineGuideSummary(base)).toBe(false);
    expect(mapPopSGV2Guide(base)).toMatchObject({ file_count: 1, total_size_bytes: null, member_directory_paths: ["L/P"] });
  });
});
