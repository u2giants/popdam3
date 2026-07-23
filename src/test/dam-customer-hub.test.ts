import { describe, expect, it } from "vitest";

describe("DAM Library customer hub contract", () => {
  it("reads customer options from the curated hub facets RPC", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../hooks/useDamCustomers.ts"),
      "utf8",
    );

    expect(source).toContain('"get_dam_customer_facets"');
    expect(source).not.toContain('from("style_groups")');
  });

  it("filters assets and style groups by customer_id and scopes programs by UUID", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const [assetsSource, groupsSource] = await Promise.all([
      fs.readFile(path.resolve(__dirname, "../hooks/useAssets.ts"), "utf8"),
      fs.readFile(path.resolve(__dirname, "../hooks/useStyleGroups.ts"), "utf8"),
    ]);

    expect(assetsSource).toContain('query.eq("customer_id", filters.customer)');
    expect(groupsSource).toContain('query.eq("customer_id", filters.customer)');
    expect(assetsSource).toContain("p_customer_id: customerId ?? undefined");
    expect(assetsSource).not.toContain("p_customer: customer");
  });
});
