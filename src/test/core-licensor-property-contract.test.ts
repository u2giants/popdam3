import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Normalize CRLF so source-shape assertions hold on Windows checkouts
// (core.autocrlf=true rewrites LF to CRLF in the working tree).
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

describe("canonical licensor/property contract", () => {
  it("reads filter taxonomy from core tables", () => {
    const handler = read("supabase/functions/_shared/admin-handlers/agent-handlers.ts");
    expect(handler).toContain('.schema("core")');
    expect(handler).toContain('.from("licensor")');
    expect(handler).toContain('.from("property")');
    expect(handler).not.toContain('.from("licensors")');
    expect(handler).not.toContain('.from("properties")');
  });

  it("reads spelling names from ordered canonical taxonomy with bounded minimal reads", () => {
    const search = read("supabase/functions/dam-search-ai/index.ts");
    expect(search).toContain('.schema("core").from(table).select("name").order("id")');
    for (const table of ["licensor", "property", "character"]) {
      expect(search).toContain(`loadNames("${table}", signal)`);
    }
    expect(search).toContain("AbortSignal.timeout(VOCABULARY_BUDGET_MS)");
    expect(search).toContain(".abortSignal(signal)");
    expect(search).not.toMatch(/loadNames\("(?:licensors|properties|characters)"/);
    expect(search).not.toContain("row.usage_count");
    expect(search).not.toContain('select("*")');
  });

  it("has no PopDAM-side taxonomy writer", () => {
    // Only the shared master-data feeder may write the canonical taxonomy.
    expect(existsSync("supabase/functions/sync-external")).toBe(false);
    expect(read("supabase/config.toml")).not.toContain("sync-external");
  });

  it("sources characters only from the licensor-scraped master list", () => {
    const tagging = read("apps/worker/src/handlers/ai-tagging-shared.ts");
    expect(tagging).toContain('schema("core").from("character")');
    expect(tagging).toContain('from("property_character_associations")');
    expect(tagging).toContain('schema("core").from("property")');
    expect(tagging).not.toContain('from("dam_character_catalog")');
  });

  it("never reads or writes the retired public.characters list (#1301)", () => {
    const files = [
      "apps/worker/src/handlers/ai-tagging.ts",
      "apps/worker/src/handlers/ai-tagging-shared.ts",
      "apps/worker/src/handlers/ai-tag-bakeoff.ts",
      "apps/worker/src/handlers/group-metadata-refresh.ts",
      "supabase/functions/admin-api/index.ts",
      "supabase/functions/agent-api/index.ts",
      "supabase/functions/export-table/index.ts",
      "supabase/functions/export-sql-dump/index.ts",
      "supabase/functions/_shared/export-tables.ts",
      "src/components/settings/ApisTab.tsx",
    ];
    for (const path of files) {
      const src = read(path);
      expect(src, path).not.toMatch(/\.from\(\s*["'](?:characters|dam_character_catalog)["']\s*\)/);
      expect(src, path).not.toContain("public.characters");
    }
    const tagging = read("apps/worker/src/handlers/ai-tagging.ts");
    expect(tagging).toContain('client.from("asset_characters").upsert(rows');
    const admin = read("supabase/functions/admin-api/index.ts");
    expect(admin).toContain('.schema("api").from("dam_character_usage")');
    expect(admin).toContain('.rpc("dam_publish_character_usage"');
    expect(admin).not.toContain('.schema("dam")');
    const apis = read("src/components/settings/ApisTab.tsx");
    expect(apis).toContain('.schema("core").from("character")');
    expect(apis).toContain('.schema("api").from("dam_character_usage")');
  });

  it("no app code references the retired shared lists (popcre/shared-db#6996)", () => {
    const root = process.cwd();
    const retired = [
      /\bpublic\.(?:characters|properties|licensors|dam_character_catalog)\b/,
      /\bcharacter_core_map\b/,
      /\bdam_character_catalog\b/,
      /\brequiredLegacyCharacterIds\b/,
      /\.from\(\s*["'`](?:characters|properties|licensors)["'`]\s*\)/,
    ];
    const skip = /(?:node_modules|dist|build|\.git|bin|obj)$/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (!skip.test(name)) walk(path);
          continue;
        }
        if (!/\.(?:ts|tsx|js|mjs|cjs|cs|py|sql)$/.test(name)) continue;
        if (/\.test\.|[\\/]test[\\/]/.test(path) || path.endsWith(join("integrations", "supabase", "types.ts"))) continue;
        const src = readFileSync(path, "utf8");
        for (const re of retired) if (re.test(src)) offenders.push(`${path.slice(root.length + 1)}: ${re}`);
      }
    };
    for (const dir of ["src", "supabase/functions", "apps", "scripts"]) {
      try { walk(join(root, dir)); } catch { /* directory absent */ }
    }
    expect(offenders).toEqual([]);
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

  it("reads ColdLion data from the database mirror, never the ColdLion API", () => {
    const coldlion = read("supabase/functions/_shared/coldlion.ts");
    const parser = read("supabase/functions/_shared/sku-parser.ts");
    const handlers = read("supabase/functions/_shared/admin-handlers/coldlion-handlers.ts");
    for (const src of [coldlion, parser, handlers]) {
      expect(src).not.toMatch(/coldlion\.com|EhpApi|COLDLION_API_KEY|fetch\(/);
    }
    expect(coldlion).toContain("coldlion.merch_group_detail");
    expect(coldlion).toContain("FROM plm.item WHERE source_system = 'coldlion'");
    expect(coldlion).toContain("class ColdLionConfigError");
    expect(coldlion).toContain("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
    expect(coldlion).not.toContain("return {};");
    // Config errors must propagate out of the non-fatal lookup fallbacks.
    expect(parser).toContain("if (e instanceof ColdLionConfigError) throw e;");
    expect(parser.match(/instanceof ColdLionConfigError/g)?.length).toBe(2);
    expect(handlers).toContain("getMgLookup");
  });

  it("keeps ColdLion MG codes scoped to their division", () => {
    const parser = read("supabase/functions/_shared/sku-parser.ts");
    const coldlion = read("supabase/functions/_shared/coldlion.ts");
    // Display-name lookups stay division-scoped; an outage leaves names null
    // (unresolved) instead of failing ingest — licensing comes from the mirror.
    expect(parser).toContain('getMgLookupOrEmpty("05", division_code)');
    expect(parser).toContain('getMgLookupOrEmpty("06", division_code)');
    expect(parser).toContain("getMgLookup(mgTypeCode, divisionCode)");
    expect(coldlion).not.toContain("getLicensorLookup");
    expect(coldlion).not.toContain("{ ...cw, ...sp }");
  });
});
