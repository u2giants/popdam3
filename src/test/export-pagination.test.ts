import { describe, expect, it } from "vitest";
import { exportRange } from "../../supabase/functions/_shared/export-pagination";

describe("export page boundaries", () => {
  it("keeps a non-multiple page separate from the next page", () => {
    const first = exportRange(0, 1501);
    const last = exportRange(1000, 501);
    const next = exportRange(1501, 1501);
    expect(first).toEqual([0, 999]);
    expect(last).toEqual([1000, 1500]);
    expect(next).toEqual([1501, 2500]);
    expect(first[1] - first[0] + last[1] - last[0] + 2).toBe(1501);
  });
  it("bounds tiny pages and the final single row", () => {
    expect(exportRange(50, 7)).toEqual([50, 56]);
    expect(exportRange(9999, 1)).toEqual([9999, 9999]);
  });
});

import { orderedTableSource } from "../../supabase/functions/_shared/export-tables";
it("orders junction exports by both identity columns instead of a nonexistent id", () => {
  const columns: string[] = [];
  const query = { select: () => query, order: (column: string) => { columns.push(column); return query; } };
  const db = { from: () => query };
  orderedTableSource(db as never, "asset_characters");
  expect(columns).toEqual(["asset_id", "character_id"]);
});
