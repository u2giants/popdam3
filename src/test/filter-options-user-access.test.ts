import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Issue #709: the library page calls get-filter-options for every signed-in
// user, so the action must not require the admin role. It only reads
// licensor/property names and non-deleted asset counts (data the library
// already shows), so it belongs in USER_ACCESSIBLE_ACTIONS.
const read = (path: string) => readFileSync(path, "utf8");

it("get-filter-options is open to any authenticated user, not admin-only", () => {
  const index = read("supabase/functions/admin-api/index.ts");
  expect(index).toContain('"get-filter-options"');
  const start = index.indexOf("const USER_ACCESSIBLE_ACTIONS");
  const userSet = index.slice(start, index.indexOf("]);", start));
  expect(userSet).toContain('"get-filter-options"');
  // The action must never fall through to the admin-only route set.
  expect(userSet).not.toContain("authenticateAdmin");
});

it("get-filter-options handler reads only public facet data", () => {
  const handler = read("supabase/functions/_shared/admin-handlers/agent-handlers.ts");
  const fn = handler.slice(
    handler.indexOf("export async function handleGetFilterOptions"),
    handler.indexOf("export async function", handler.indexOf("export async function handleGetFilterOptions") + 10),
  );
  expect(fn).toContain('rpc("get_dam_asset_taxonomy_counts")');
  expect(fn).not.toContain("admin_config");
  expect(fn).not.toContain("user_roles");
  expect(fn).not.toContain("auth.users");
});

it("find sibling files is open to any authenticated user", () => {
  const index = read("supabase/functions/admin-api/index.ts");
  const start = index.indexOf("const USER_ACCESSIBLE_ACTIONS");
  const userSet = index.slice(start, index.indexOf("]);", start));
  for (const a of ["list-sibling-images", "get-sibling-scan-result", "get-sibling-scan-by-folder", "ingest-sibling-images"]) {
    expect(userSet).toContain(`"${a}"`);
  }
  expect(index).not.toContain("DESIGNER_OR_ADMIN_ACTIONS");
});
