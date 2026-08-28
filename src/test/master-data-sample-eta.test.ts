import { describe, expect, it } from "vitest";

describe("Master Data Sample ETA column", () => {
  it("is available in both grids as a factory ETA date", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve(__dirname, "../pages/StylesPage.tsx"), "utf8");

    expect(source.match(/header: "Sample ETA"/g)).toHaveLength(2);
    expect(source.match(/headerTooltip: "ETA From Factory"/g)).toHaveLength(2);
    expect(source).toContain('cellDataType: column.date ? "dateString"');
    expect(source).toContain('? "agDateStringCellEditor"');
    expect(source).toContain('filter: column.date ? "agDateColumnFilter"');
  });
});
