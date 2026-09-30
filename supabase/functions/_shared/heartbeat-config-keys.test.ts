import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A heartbeat command only fires if the config key it reads is in that agent type's key list.
// trigger_popsg_pdf_backfill reads POPSG_PDF_BACKFILL and only the Windows agent runs it.
describe("agent-api heartbeat config keys", () => {
  const src = readFileSync(new URL("../agent-api/index.ts", import.meta.url), "utf8");
  const windowsList = src.split("const HEARTBEAT_CONFIG_KEYS_WINDOWS = [")[1]?.split("];")[0] ?? "";

  it("delivers POPSG_PDF_BACKFILL to the Windows render agent", () => {
    expect(windowsList).toContain('"POPSG_PDF_BACKFILL"');
  });

  it("still delivers PDF_BACKFILL to the Windows render agent", () => {
    expect(windowsList).toContain('"PDF_BACKFILL"');
  });
});
