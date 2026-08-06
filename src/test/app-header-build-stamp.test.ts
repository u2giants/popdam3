import { describe, expect, it } from "vitest";

describe("application header build stamp", () => {
  it("keeps the commit date and time visible and copyable in compact mode", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve(__dirname, "../components/AppHeader.tsx"), "utf8");
    const buildStamp = source.slice(source.indexOf("Keep the full build stamp"), source.indexOf("Sync status pill"));

    expect(buildStamp).toContain("select-all");
    expect(buildStamp).toContain("formatDateTime(__APP_DATE__)");
    expect(buildStamp).not.toContain("compact ? __APP_COMMIT__");
  });
});
