import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isLegacyErpItem } from "@/lib/canonical-erp-items";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const readers = [
  "src/components/library/StyleGroupDetailPanel.tsx",
  "supabase/functions/_shared/licensing-resolution.ts",
  "supabase/functions/_shared/admin-handlers/erp-handlers.ts",
  "supabase/functions/_shared/admin-handlers/erp-browse-handlers.ts",
  "apps/worker/src/handlers/erp.ts",
  "apps/worker/src/handlers/ai-tagging-shared.ts",
];

describe("canonical ERP cutover", () => {
  it("keeps the legacy badge cutoff and treats a missing canonical item as non-legacy", () => {
    expect(isLegacyErpItem("2025-05-13T23:59:59Z")).toBe(true);
    expect(isLegacyErpItem("2025-05-14T00:00:00Z")).toBe(false);
    expect(isLegacyErpItem(null)).toBe(false);
  });

  it("moves all six readers to api.plm_item_list", () => {
    for (const path of readers) {
      const source = read(path);
      expect(source, path).not.toMatch(/erp_items_(?:current|raw)/);
      expect(source, path).toMatch(/plm_item_list|canonicalItems/);
    }
  });

  it("removes retired tables from both export allow-lists", () => {
    for (const path of ["supabase/functions/export-table/index.ts", "supabase/functions/export-sql-dump/index.ts"]) {
      expect(read(path), path).not.toMatch(/erp_items_(?:current|raw)/);
    }
    expect(read("supabase/functions/export-table/index.ts")).toContain('schema("api").from("plm_item_list")');
  });

  it("keeps dismiss, show-dismissed, and restore behavior wired to canonical identities", () => {
    const ui = read("src/components/settings/ErpEnrichmentTab.tsx");
    const handler = read("supabase/functions/_shared/admin-handlers/erp-browse-handlers.ts");
    expect(ui).toContain("Show dismissed");
    expect(ui).toContain('dismiss: !item.dismissed');
    expect(handler).toContain("set_popdam_item_dismissed");
    expect(handler).toContain("item_identity");
  });
});
