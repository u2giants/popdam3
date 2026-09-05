import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Master Data realtime refresh", () => {
  it("subscribes to row changes for the active sheet and cleans up the channel", async () => {
    const source = await readFile(path.resolve(__dirname, "../pages/StylesPage.tsx"), "utf8");

    expect(source).toContain('channel(`style-tracker-rows:${active.name}`)');
    expect(source).toContain('{ event: "*", schema: "public", table: "style_tracker_rows" }');
    expect(source).toContain('changedSourceSheet !== active.name');
    expect(source).toContain('queryKey: ["style-rows", active.name]');
    expect(source).toContain('queryKey: ["style-row-count", active.name]');
    expect(source).toContain("supabase.removeChannel(channel)");
  });
});
