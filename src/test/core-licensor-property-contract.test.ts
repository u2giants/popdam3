import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("canonical licensor/property contract", () => {
  it("reads filter taxonomy from core tables", () => {
    const handler = read("supabase/functions/_shared/admin-handlers/agent-handlers.ts");
    expect(handler).toContain('.schema("core")');
    expect(handler).toContain('.from("licensor")');
    expect(handler).toContain('.from("property")');
    expect(handler).not.toContain('.from("licensors")');
    expect(handler).not.toContain('.from("properties")');
  });

  it("retires the legacy PopDAM taxonomy writer loudly", () => {
    const syncFunction = read("supabase/functions/sync-external/index.ts");
    expect(syncFunction).toContain("core.licensor and core.property");
    expect(syncFunction).toContain("410");
    expect(syncFunction).not.toContain('.upsert(');
  });

  it("uses the explicit character compatibility catalog", () => {
    const tagging = read("apps/worker/src/handlers/ai-tagging-shared.ts");
    expect(tagging).toContain('from("dam_character_catalog")');
    expect(tagging).toContain('schema("core").from("property")');
  });
});
