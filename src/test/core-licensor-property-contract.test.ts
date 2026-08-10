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

  it("never derives licensor or property identity from folder names", () => {
    const derivation = read("supabase/functions/_shared/metadata-derivation.ts");
    expect(derivation).not.toContain("licensor_name");
    expect(derivation).not.toContain("property_name");
    expect(derivation).not.toContain("licensor_id");
    expect(derivation).not.toContain("property_id");
    expect(derivation).not.toContain('.ilike("name"');
    expect(derivation).toContain("workflow_status");
    expect(derivation).toContain("is_licensed");
  });

  it("resolves exact ColdLion codes through the curated parent relationship", () => {
    const resolver = read("supabase/functions/_shared/licensing-resolution.ts");
    expect(resolver).toContain('from("taxonomy_source_ref")');
    expect(resolver).toContain("coldLionSourceId(erp.division_code");
    expect(resolver).toContain('.eq("licensor_id", licensor.id)');
    expect(resolver).toContain('["CW001", "SP001"]');
    expect(resolver).not.toContain("ilike");
  });

  it("writes honest nulls and reports unresolved licensing", () => {
    const agentApi = read("supabase/functions/agent-api/index.ts");
    const bridge = read("apps/bridge-agent/src/index.ts");
    expect(agentApi).toContain("licensor_id: licensing.licensor_id");
    expect(agentApi).toContain("property_id: licensing.property_id");
    expect(bridge).toContain("counters.unresolved_licensor++");
    expect(bridge).toContain("counters.unresolved_property++");
    expect(bridge).toContain("hasUnresolvedLicensing");
  });

  it("fails loudly when ColdLion is unavailable", () => {
    const coldlion = read("supabase/functions/_shared/coldlion.ts");
    expect(coldlion).toContain("COLDLION_API_KEY is missing");
    expect(coldlion).toContain("throw new Error");
    expect(coldlion).not.toContain("HARDCODED_KEY");
    expect(coldlion).not.toContain("return {};");
  });

  it("keeps ColdLion MG codes scoped to their division", () => {
    const parser = read("supabase/functions/_shared/sku-parser.ts");
    const coldlion = read("supabase/functions/_shared/coldlion.ts");
    expect(parser).toContain('getMgLookup("05", division_code)');
    expect(parser).toContain('getMgLookup("06", division_code)');
    expect(coldlion).not.toContain("getLicensorLookup");
    expect(coldlion).not.toContain("{ ...cw, ...sp }");
  });
});
