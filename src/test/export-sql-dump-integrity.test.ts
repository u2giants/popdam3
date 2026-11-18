import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clearTableSQL,
  afterCursorFilter,
  clampChunkSize,
  decodeCursor,
  encodeCursor,
  expectedChunkRows,
  insertRowSQL,
  MAX_CHUNK,
  deletesDuringExport,
  manifestEntry,
  parseCutoff,
  snapshotColumn,
} from "../../supabase/functions/_shared/export-pagination";

describe("SQL dump manifest (#1082)", () => {
  it("refuses to report a failed count as an empty table", () => {
    expect(() => manifestEntry("assets", null, { message: "timeout" }, 5000)).toThrow(/assets.*timeout/);
    expect(() => manifestEntry("assets", null, null, 5000)).toThrow(/missing/);
  });
  it("reports a genuinely empty table and counts chunks", () => {
    expect(manifestEntry("invitations", 0, null, 5000)).toEqual({ table: "invitations", rows: 0, chunks: 0, volatile: false });
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
    expect(ps).toMatch(/rowsInChunk -ne \$expectedRows\) \{ \$problem =/);
    expect(ps).toMatch(/EndsWith\("COMMIT;"\)\) \{ \$problem =/);
    expect(ps).toMatch(/\$problem = "download failed/);
    expect(ps).toMatch(/if \(\$problem\) \{ Write-Host " FAILED" -ForegroundColor Red; Fail-Run "\$fileName \$problem" \}/);
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

describe("SQL dump under live ingestion (#1132) and large chunks (#1096)", () => {
  const src = readFileSync("supabase/functions/export-sql-dump/index.ts", "utf8");
  const ps = readFileSync("migration/download-sql-dump.ps1", "utf8");

  it("clamps chunk size the same way in manifest and chunk modes", () => {
    expect(clampChunkSize(20000)).toBe(MAX_CHUNK);
    expect(clampChunkSize(5000)).toBe(5000);
    expect(() => clampChunkSize(0)).toThrow();
    expect(src.match(/clampChunkSize\(/g)?.length).toBe(2);
  });

  it("freezes ingestion tables at the manifest cutoff", () => {
    for (const t of ["assets", "render_queue", "asset_tags"]) expect(snapshotColumn(t)).toBe("created_at");
    expect(snapshotColumn("asset_characters")).toBeNull();
    expect(src).toMatch(/countQuery\.lte\(col, cutoff\)/);
    expect(src).toMatch(/query\.lte\(col, cutoff\)/);
    expect(src).toMatch(/chunkSize, cutoff, tables, complete: true/);
    expect(parseCutoff("2026-11-18T12:00:00Z")).toBe("2026-11-18T12:00:00.000Z");
    expect(() => parseCutoff("nope")).toThrow();
  });

  it("round-trips keyset cursors including composite keys", () => {
    const c = encodeCursor("asset_characters", { asset_id: "a", character_id: "b", x: 1 });
    expect(decodeCursor("asset_characters", c)).toEqual(["a", "b"]);
    expect(afterCursorFilter("asset_characters", ["a", "b"])).toBe(
      'asset_id.gt."a",and(asset_id.eq."a",character_id.gt."b")',
    );
    expect(afterCursorFilter("assets", ['x"y'])).toBe('id.gt."x\\"y"');
    expect(() => decodeCursor("assets", c)).toThrow(/Invalid cursor/);
  });

  it("every frozen row exported exactly once while ingestion inserts mid-run", () => {
    const rand = () => String(Math.floor(Math.random() * 1e12)).padStart(12, "0");
    const table: { id: string; created_at: string }[] = [];
    for (let i = 0; i < 2500; i++) table.push({ id: `${rand()}-${i}`, created_at: "2026-01-01T00:00:00.000Z" });
    const cutoff = "2026-06-01T00:00:00.000Z";
    const frozen = table.map((r) => r.id).sort();
    const size = 1000;
    const got: string[] = [];
    let cursor: string | null = null;
    for (let n = 0; n < Math.ceil(frozen.length / size); n++) {
      for (let k = 0; k < 50; k++) table.push({ id: `${rand()}-n${n}-${k}`, created_at: "2026-11-18T00:00:00.000Z" });
      const key = cursor ? decodeCursor("assets", cursor)[0] : null;
      const rows = table
        .filter((r) => r.created_at <= cutoff && (key === null || r.id > key))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, size);
      expect(rows.length).toBe(expectedChunkRows(frozen.length, n, size));
      got.push(...rows.map((r) => r.id));
      cursor = encodeCursor("assets", rows[rows.length - 1]);
    }
    expect(got).toEqual(frozen);
  });

  it("downloader pins the cutoff and follows the server cursor", () => {
    expect(ps).toMatch(/if \(-not \$cutoffMatch\.Success\) \{ Fail-Run/);
    // ConvertFrom-Json would turn the ISO cutoff into a DateTime and drop milliseconds (#1132)
    expect(ps).not.toMatch(/\$manifest\.cutoff/);
    expect(ps).toMatch(/&cutoff=\$Cutoff\$afterParam/);
    expect(ps).toMatch(/\$cursor = "\$\(\$resp\.Headers\['X-Next-Cursor'\]\)"/);
    expect(src).toMatch(/"X-Next-Cursor": nextCursor/);
    expect(src).not.toMatch(/\.range\(/);
  });

  it("cutoff regex keeps the exact manifest instant, milliseconds included", () => {
    const m = /"cutoff"\s*:\s*"([^"]+)"/.exec(JSON.stringify({ chunkSize: 5000, cutoff: "2026-11-18T20:52:52.481Z" }));
    expect(m?.[1]).toBe("2026-11-18T20:52:52.481Z");
    expect(ps).toContain(String.raw`'"cutoff"\s*:\s*"([^"]+)"'`);
  });

  it("chunk bodies carry a SHA-256 and the downloader retries cut transfers (#1132)", () => {
    expect(src).toMatch(/crypto\.subtle\.digest\("SHA-256", body\)/);
    expect(src).toMatch(/"X-Content-SHA256": sha256/);
    expect(src).toMatch(/"Content-Length": String\(body\.byteLength\)/);
    expect(ps).toMatch(/\$actualSha -ne \$expectedSha\) \{ \$problem =/);
    expect(ps).toMatch(/for \(\$attempt = 1; \$attempt -le \$MaxAttempts/);
    expect(ps).toMatch(/\$MaxAttempts\s+= 4/);
  });
});

describe("SQL dump restore never cascades into shared tables (#1134)", () => {
  it("deletes PopDAM tables, upserts core master data, no TRUNCATE CASCADE", () => {
    const src = readFileSync("supabase/functions/export-sql-dump/index.ts", "utf8");
    expect(src).not.toMatch(/TRUNCATE/);
    expect(clearTableSQL("public.assets")).toBe("DELETE FROM public.assets;");
    expect(clearTableSQL("core.licensor")).toBeNull();
    expect(insertRowSQL("core.licensor", { id: "x", name: "n" })).toMatch(/ON CONFLICT \("id"\) DO UPDATE SET "name" = EXCLUDED\."name";$/);
    expect(insertRowSQL("public.assets", { id: "x" })).toMatch(/jsonb\);$/);
  });

  it("queue tables may lose finished rows mid-export, never gain them (#1132)", () => {
    const ps = readFileSync("migration/download-sql-dump.ps1", "utf8");
    expect(manifestEntry("render_queue", 1776, null, 5000).volatile).toBe(true);
    for (const t of ["assets", "asset_tags", "invitations", "licensors"]) expect(deletesDuringExport(t)).toBe(false);
    expect(ps).toMatch(/if \(\$rowsInChunk -gt \$expectedRows\) \{ \$problem =/);
    expect(ps).toMatch(/elseif \(\$rowsInChunk -ne \$expectedRows\) \{ \$problem =/);
    expect(ps).toMatch(/\$expectedFiles -= \(\$t\.chunks - 1 - \$chunk\)/);
    expect(ps).toMatch(/downloadedFiles\.Count -ne \$expectedFiles\) \{ Fail-Run/);
  });
});
