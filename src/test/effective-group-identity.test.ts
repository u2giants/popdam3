import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { liveFunctionBody } from "../../apps/worker/src/handlers/live-migration-contract.js";

/**
 * Legacy tag propagation "null-filled" every sibling in a Style Group: it copied
 * the primary asset's licensor_id, property_id, is_licensed, themes, and
 * descriptions onto any sibling whose own column happened to be empty. That is
 * what Step 6 removes.
 *
 * A grouped asset must instead READ its identity from its Style Group. The shared
 * read contract `public.get_effective_asset_metadata` is the single place that
 * decides this, so these tests pin its behavior and prove no application path
 * writes those columns from group data any more.
 */
// Resolved from the NEWEST migration that defines it. A hard-coded filename would
// silently pass forever once a later migration supersedes the contract.
function effectiveMetadataBody(): string {
  return liveFunctionBody("get_effective_asset_metadata").body;
}

describe("effective identity for grouped and ungrouped assets", () => {
  it("a grouped asset reads licensor and property from its Style Group", () => {
    const body = effectiveMetadataBody();
    // The style_group branch selects the group's own identity columns.
    expect(body).toMatch(/join public\.style_groups sg on sg\.id=a\.style_group_id/);
    expect(body).toMatch(/sg\.licensor_id,sg\.property_id/);
  });

  it("an ungrouped asset keeps its own identity", () => {
    const body = effectiveMetadataBody();
    expect(body).toMatch(/case when a\.style_group_id is null then a\.licensor_id else sg\.licensor_id end/);
    expect(body).toMatch(/case when a\.style_group_id is null then a\.property_id else sg\.property_id end/);
  });

  it("the contract reads both scopes and labels which one each row came from", () => {
    const body = effectiveMetadataBody();
    expect(body).toMatch(/'style_group'::text as scope/);
    expect(body).toMatch(/'asset'::text as scope/);
    expect(body).toMatch(/union all/);
    // It is a read: no write statement may appear anywhere in it.
    expect(body).not.toMatch(/\b(insert|update|delete)\s+(into\s+)?public\./i);
  });
});

describe("no application path null-fills group identity onto member assets", () => {
  const forbidden = [
    "licensor_id",
    "property_id",
    "is_licensed",
    "big_theme",
    "little_theme",
    "design_style",
    "cover_description",
    "ai_description",
  ];

  // Test files legitimately name the symbol they assert is gone, so they are
  // excluded. Everything else under these paths is production code.
  const EXCLUDE_TESTS = [":!*.test.ts", ":!*.test.tsx"];

  function grep(pattern: string, paths: string[]): string {
    try {
      return execFileSync("git", ["grep", "-n", "-e", pattern, "--", ...paths, ...EXCLUDE_TESTS], { encoding: "utf8" }).trim();
    } catch (error) {
      // git grep exits 1 with no match.
      expect((error as { status?: number }).status).toBe(1);
      return "";
    }
  }

  it("the legacy copy helper is gone from the repository", () => {
    expect(grep("propagateGroupTags", ["src", "apps", "supabase/functions"])).toBe("");
    expect(grep("_shared/tag-propagation", ["src", "apps", "supabase/functions"])).toBe("");
  });

  it("the group refresh handlers never mention an asset identity column", () => {
    const workerRefresh = readFileSync("apps/worker/src/handlers/group-metadata-refresh.ts", "utf8");
    const edgeRefresh = readFileSync("supabase/functions/_shared/admin-handlers/tag-propagation-handlers.ts", "utf8");
    for (const source of [workerRefresh, edgeRefresh]) {
      for (const column of forbidden) {
        // group_ai_description is a Style Group column and is allowed; the bare
        // asset columns are not.
        const bare = new RegExp(`(?<!group_)\\b${column}\\b`);
        expect(bare.test(source), `${column} must not appear in a group refresh path`).toBe(false);
      }
      expect(source).not.toMatch(/from\("assets"\)/);
      expect(source).not.toMatch(/from\("asset_tags"\)/);
      expect(source).not.toMatch(/from\("asset_characters"\)/);
    }
  });
});
