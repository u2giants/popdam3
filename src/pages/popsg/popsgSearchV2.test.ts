import { describe, expect, it } from "vitest";
import {
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
