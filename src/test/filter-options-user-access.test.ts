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
  // Contained in the user-accessible set, i.e. between its declaration and
  // the designer-or-admin set that follows it.
  const userSet = index.slice(
    index.indexOf("const USER_ACCESSIBLE_ACTIONS"),
    index.indexOf("const DESIGNER_OR_ADMIN_ACTIONS"),
  );
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
  expect(fn).toContain('from("assets")');
  expect(fn).not.toContain("admin_config");
  expect(fn).not.toContain("user_roles");
  expect(fn).not.toContain("auth.users");
});
