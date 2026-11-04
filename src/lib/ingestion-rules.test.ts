import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXCLUDED_FOLDERS, explainIngestion, IngestionRule, normalizeIngestionRules, validateIngestionRuleValue,
} from "./ingestion-rules";

const rule = (kind: IngestionRule["kind"], value: string, enabled = true): IngestionRule => ({ id: value, kind, value, enabled });

describe("ingestion rules", () => {
  it("keeps the edge copy identical to the agent copy", () => {
    expect(readFileSync("supabase/functions/_shared/ingestion-rules.ts", "utf8").replace(/\r\n/g, "\n"))
      .toBe(readFileSync("packages/agent-common/src/ingestion-rules.ts", "utf8").replace(/\r\n/g, "\n"));
  });

  it("keeps the displayed folder list identical to the path filter", () => {
    const src = readFileSync("packages/path-filters/index.ts", "utf8").replace(/\r\n/g, "\n");
    const block = src.match(/const BLOCKLIST = new Set\(\[([\s\S]*?)\]\)/)![1];
    expect([...block.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...EXCLUDED_FOLDERS]);
  });

  it("applies the built-in rules", () => {
    expect(explainIngestion("Decor/a/art.psd", []).ingested).toBe(true);
    expect(explainIngestion("Decor/a/art.AI", []).ingested).toBe(true);
    expect(explainIngestion("Decor/a/notes.txt", []).ingested).toBe(false);
    expect(explainIngestion("Decor/a/invoice.pdf", []).ingested).toBe(false);
    expect(explainIngestion("Decor/a/Tech Pack v2.pdf", []).ingested).toBe(true);
    expect(explainIngestion("Decor/a/photo.jpg", []).ingested).toBe(false);
    expect(explainIngestion("Decor/a/x_compview.png", []).ingested).toBe(true);
    expect(explainIngestion("Decor/_old/art.psd", []).ingested).toBe(false);
    expect(explainIngestion("Decor/@eaDir/art.psd", []).ingested).toBe(false);
  });

  it("applies added rules only while enabled", () => {
    expect(explainIngestion("a/spec sheet.pdf", [rule("pdf_include", "spec sheet")]).ingested).toBe(true);
    expect(explainIngestion("a/spec sheet.pdf", [rule("pdf_include", "spec sheet", false)]).ingested).toBe(false);
    expect(explainIngestion("a/photo.jpg", [rule("image_include", "photo")]).ingested).toBe(true);
    expect(explainIngestion("a/draft-art.psd", [rule("filename_exclude", "draft")]).ingested).toBe(false);
    expect(explainIngestion("Temp/art.psd", [rule("folder_exclude", "temp")]).ingested).toBe(false);
    expect(explainIngestion("Temporary/art.psd", [rule("folder_exclude", "temp")]).ingested).toBe(true);
  });

  it("lets an exclusion beat an inclusion", () => {
    expect(explainIngestion("a/tech pack draft.pdf", [rule("filename_exclude", "draft")]).ingested).toBe(false);
  });

  it("drops damaged rules and refuses over-broad text", () => {
    expect(normalizeIngestionRules("nope")).toEqual([]);
    expect(normalizeIngestionRules([{ id: "1", kind: "bad", value: "abc" }, { id: "2", kind: "pdf_include", value: "a" }, null])).toEqual([]);
    const twice = [{ id: "1", kind: "pdf_include", value: "Spec" }, { id: "2", kind: "pdf_include", value: "spec " }];
    expect(normalizeIngestionRules(twice)).toHaveLength(1);
    expect(validateIngestionRuleValue("pdf_include", "ab")).toBeTruthy();
    expect(validateIngestionRuleValue("folder_exclude", "a/b")).toBeTruthy();
    expect(validateIngestionRuleValue("folder_exclude", "tmp")).toBeNull();
  });
});
