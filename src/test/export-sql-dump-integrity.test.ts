import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clearTableSQL,
  decodeCursor,
  encodeCursor,
  expectedChunkRows,
  exportCutoffColumn,
  insertRowSQL,
  keysetFilter,
  manifestEntry,
} from "../../supabase/functions/_shared/export-pagination";

describe("SQL dump manifest (#1082)", () => {
  it("refuses to report a failed count as an empty table", () => {
    expect(() => manifestEntry("assets", null, { message: "timeout" }, 5000)).toThrow(/assets.*timeout/);
    expect(() => manifestEntry("assets", null, null, 5000)).toThrow(/missing/);
  });
  it("reports a genuinely empty table and counts chunks", () => {
    expect(manifestEntry("invitations", 0, null, 5000)).toEqual({ table: "invitations", rows: 0, chunks: 0 });
    expect(manifestEntry("assets", 10001, null, 5000).chunks).toBe(3);
  });
  it("edge function fails the manifest instead of defaulting count to zero", () => {
    const src = readFileSync("supabase/functions/export-sql-dump/index.ts", "utf8");
    expect(src).not.toMatch(/count \?\? 0/);
    expect(src).toMatch(/manifestEntry\(table, count, error/);
    expect(src).toMatch(/complete: true/);
  });
});

describe("SQL dump download validation (#1083-#1085)", () => {
  const ps = readFileSync("migration/download-sql-dump.ps1", "utf8");
  it("computes expected rows per chunk", () => {
    expect(expectedChunkRows(10001, 0, 5000)).toBe(5000);
    expect(expectedChunkRows(10001, 2, 5000)).toBe(1);
    expect(expectedChunkRows(10001, 3, 5000)).toBe(0);
  });
  it("aborts on any failed, short, or truncated chunk", () => {
    expect(ps).toMatch(/manifest\.complete -ne \$true\) \{ Fail-Run/);
    expect(ps).toMatch(/rowsInChunk -ne \$expectedRows\) \{ Fail-Run/);
    expect(ps).toMatch(/EndsWith\("COMMIT;"\)\) \{ Fail-Run/);
    expect(ps).toMatch(/Fail-Run "\$fileName download failed/);
  });
  it("uses a fresh run folder and restores only the validated list", () => {
    expect(ps).toMatch(/\$RunDir\s+= Join-Path \$OutputDir \$RunStamp/);
    expect(ps).toMatch(/restore-order\.txt/);
    expect(ps).not.toMatch(/Get-ChildItem .*\*\.sql/);
    expect(ps).toMatch(/ON_ERROR_STOP=1/);
  });
});

describe("SQL dump row encoding (#1085 restore proof)", () => {
  it("decodes JSON through the target's column types and escapes quotes", () => {
    const sql = insertRowSQL("public.erp_sync_runs", { id: "x", error_samples: [{ m: "it's" }] });
    expect(sql).toBe(
      `INSERT INTO public.erp_sync_runs ("id", "error_samples") SELECT "id", "error_samples" FROM jsonb_populate_record(NULL::public.erp_sync_runs, '{"id":"x","error_samples":[{"m":"it''s"}]}'::jsonb);`,
    );
  });
});

describe("SQL dump consistent snapshot and key paging (#1132, #1133)", () => {
  const src = readFileSync("supabase/functions/export-sql-dump/index.ts", "utf8");
  const ps = readFileSync("migration/download-sql-dump.ps1", "utf8");
  it("fixes every count and chunk at the manifest cutoff", () => {
    expect(exportCutoffColumn("assets")).toBe("created_at");
    expect(exportCutoffColumn("asset_path_history")).toBe("detected_at");
    expect(src).toMatch(/cutoff, tables, complete: true/);
    expect(src.match(/applyCutoff\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(ps).toMatch(/cutoff=\$CutoffParam/);
  });
  it("pages by key, never by OFFSET", () => {
    expect(src).not.toMatch(/\.range\(/);
    expect(keysetFilter("assets", ["a"])).toBe("id.gt.a");
    expect(keysetFilter("asset_characters", ["a", "c"])).toBe("asset_id.gt.a,and(asset_id.eq.a,character_id.gt.c)");
    const id = "0b9d7c1e-1111-4222-8333-444455556666";
    expect(decodeCursor("assets", encodeCursor([id]))).toEqual([id]);
    expect(() => decodeCursor("assets", encodeCursor(["x),or(id.gt.0"]))).toThrow();
    expect(ps).toMatch(/X-Next-After/);
  });
});

describe("SQL dump restore never cascades into shared tables (#1134)", () => {
  it("deletes PopDAM tables, upserts core master data, no TRUNCATE CASCADE", () => {
    const src = readFileSync("supabase/functions/export-sql-dump/index.ts", "utf8");
    expect(src).not.toMatch(/TRUNCATE/);
    expect(clearTableSQL("public.assets")).toBe("DELETE FROM public.assets;");
    expect(clearTableSQL("core.licensor")).toBeNull();
    expect(insertRowSQL("core.licensor", { id: "x", name: "n" })).toMatch(/ON CONFLICT \("id"\) DO UPDATE SET "name" = EXCLUDED\."name";$/);
  });
});
