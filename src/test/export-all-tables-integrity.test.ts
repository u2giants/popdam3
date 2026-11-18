import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The CSV exporter is PowerShell, so these tests check its source the same way
// export-sql-dump-integrity.test.ts does (#1097).
const ps = readFileSync("migration/export-all-tables.ps1", "utf8");
const edge = readFileSync("supabase/functions/export-table/index.ts", "utf8");

function quotedNames(block: string): string[] {
  return [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

const psTables = quotedNames(ps.match(/\$Tables = @\(([\s\S]*?)\n\)/)?.[1] ?? "");
const allowedTables = quotedNames(edge.match(/const ALLOWED_TABLES = \[([\s\S]*?)\];/)?.[1] ?? "");

describe("CSV export table list (#1097)", () => {
  it("does not request admin_config, which the edge function excludes", () => {
    expect(psTables.length).toBeGreaterThan(0);
    expect(psTables).not.toContain("admin_config");
  });
  it("lists only tables the edge function allows", () => {
    expect(allowedTables.length).toBeGreaterThan(0);
    for (const table of psTables) expect(allowedTables).toContain(table);
  });
});

describe("CSV export failure handling (#1097)", () => {
  it("fails a table on any error instead of breaking out with partial data", () => {
    expect(ps).not.toMatch(/catch \{[^}]*\bbreak\b/);
    expect(ps).toMatch(/throw "page \$page returned \$pageRows rows, expected \$expectedRows"/);
  });
  it("never labels a failed or unverified table as empty", () => {
    expect(ps).not.toMatch(/skipped/i);
    expect(ps).toMatch(/if \(\$totalRows -eq 0\) \{/);
  });
  it("validates each page and the final total against server headers", () => {
    expect(ps).toMatch(/Get-RequiredHeader \$response "X-Rows-In-Page"/);
    expect(ps).toMatch(/Get-RequiredHeader \$response "X-Total-Count"/);
    expect(ps).toMatch(/if \(\$totalRows -ne \$totalCount\) \{ throw/);
  });
  it("stops with a non-zero exit and names every failed table", () => {
    expect(ps).toMatch(/\$FailedTables \+= \$table/);
    expect(ps).toMatch(/EXPORT INCOMPLETE/);
    expect(ps).toMatch(/exit 1/);
  });
  it("turns every error into a terminating error", () => {
    expect(ps).toMatch(/\$ErrorActionPreference = "Stop"/);
  });
});

describe("CSV export atomic publish (#1097)", () => {
  it("writes to a temp file and replaces the export only after validation", () => {
    const tmpWrite = ps.indexOf("StreamWriter($tmpPath");
    const validated = ps.indexOf('if ($totalRows -ne $totalCount) { throw');
    const publish = ps.indexOf("Publish-File $tmpPath $filePath");
    expect(tmpWrite).toBeGreaterThan(-1);
    expect(validated).toBeGreaterThan(tmpWrite);
    expect(publish).toBeGreaterThan(validated);
  });
  it("never writes the final file directly", () => {
    expect(ps).not.toMatch(/Out-File -FilePath \$filePath/);
    expect(ps).not.toMatch(/StreamWriter\(\$filePath/);
    expect(ps).toMatch(/\[System\.IO\.File\]::Replace\(/);
  });
  it("removes the temp file in a finally block on success or failure", () => {
    expect(ps).toMatch(/finally \{[\s\S]*Remove-Item -LiteralPath \$tmpPath -Force/);
  });
});

describe("export-table edge function reports errors and row counts (#1097)", () => {
  it("fails the request when the row count fails", () => {
    expect(edge).not.toMatch(/count: totalCount \} = /);
    expect(edge).toMatch(/countErr \|\| typeof totalCount !== "number"/);
  });
  it("reports the rows actually in each CSV page", () => {
    expect(edge).toMatch(/"X-Rows-In-Page": String\(rows\.length\)/);
  });
  it("does not treat a short PostgREST chunk as the end of the table", () => {
    expect(edge).not.toMatch(/chunk\.length < requested/);
    expect(edge).toMatch(/offset \+= chunk\.length/);
  });
});

describe("CSV export page sizes fit the edge function (#1143)", () => {
  const ladder = (ps.match(/\$PageSizeLadder = @\(([^)]*)\)/)?.[1] ?? "").split(",").map((n) => parseInt(n, 10));
  const perTable = ps.match(/\$TablePageSize = @\{([^}]*)\}/)?.[1] ?? "";
  const edgeCap = parseInt(edge.match(/"50000", 10\), (\d+)\)/)?.[1] ?? "0", 10);

  it("uses a small page for the wide assets table", () => {
    const assets = parseInt(perTable.match(/"assets" = (\d+)/)?.[1] ?? "0", 10);
    expect(assets).toBeGreaterThan(0);
    expect(assets).toBeLessThanOrEqual(5000);
    expect(ladder).toContain(assets);
  });
  it("has a descending page-size ladder where each size divides the one before", () => {
    expect(ladder.length).toBeGreaterThan(3);
    expect(ladder[0]).toBeLessThanOrEqual(edgeCap);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]).toBeLessThan(ladder[i - 1]);
      expect(ladder[i - 1] % ladder[i]).toBe(0);
    }
  });
  it("retries a WORKER_RESOURCE_LIMIT page with a smaller page instead of failing", () => {
    expect(ps).toMatch(/WORKER_RESOURCE_LIMIT/);
    expect(ps).toMatch(/IDLE_TIMEOUT/);
    expect(ps).toMatch(/\$smaller = Get-SmallerPageSize \$size \$totalRows/);
    expect(ps).toMatch(/\(\$Offset % \$candidate\) -eq 0/);
  });
  it("derives each page from rows received and checks it against the current size", () => {
    expect(ps).toMatch(/\$page = \[int64\]\(\$totalRows \/ \$size\)/);
    expect(ps).toMatch(/\[Math\]::Min\(\[int64\]\$size, \$totalCount - \$totalRows\)/);
  });
  it("streams pages to disk instead of holding the whole table in memory", () => {
    expect(ps).not.toMatch(/StringBuilder/);
    expect(ps).toMatch(/\$writer\.Write\(\$response\.Content\)/);
  });
});
