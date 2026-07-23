import { describe, expect, it } from "vitest";

/**
 * Contract mirror for Styles Vendor pickers: options must come from
 * api.dam_factory_list, not a direct core.factory read. Labels prefer
 * display_name (same shape as api.dam_customer_list).
 */
function mapDamFactoryListRows(
  rows: Array<{ id: string; name: string | null; display_name: string | null }>,
): string[] {
  return rows
    .map((row) => (row.display_name?.trim() || row.name?.trim() || "").trim())
    .filter(Boolean);
}

describe("DAM vendor picker (api.dam_factory_list)", () => {
  it("prefers display_name for labels", () => {
    const labels = mapDamFactoryListRows([
      { id: "a", name: "Legal Factory Name", display_name: "Ningbo Co" },
      { id: "b", name: "Only Name", display_name: null },
      { id: "c", name: null, display_name: "   " },
    ]);
    expect(labels).toEqual(["Ningbo Co", "Only Name"]);
  });

  it("uses the sanctioned relation name in source (grep gate companion)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../pages/StylesPage.tsx"),
      "utf8",
    );
    expect(source).toContain('from("dam_factory_list")');
    expect(source).toContain('.schema("api")');
    // Direct core.factory read must not remain in the vendor picker function.
    const factoryFn = source.slice(source.indexOf("async function fetchFactoryOptions"));
    const body = factoryFn.slice(0, factoryFn.indexOf("async function fetchPackagingTypeOptions"));
    expect(body).not.toMatch(/\.schema\(["']core["']\)\s*\.from\(["']factory["']\)/);
  });
});
