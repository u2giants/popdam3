import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectedChunkRows, manifestEntry } from "../../supabase/functions/_shared/export-pagination";

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
