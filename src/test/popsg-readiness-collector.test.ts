import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PopSG readiness collector", () => {
  it("uses deterministic database paging before comparing path sets", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/popsg-readiness-baseline.mjs"), "utf8");
    expect(source).toContain('.eq("is_active", true).order("id", { ascending: true }).range(');
  });

  it("writes every licensed-path artifact with mode 0600", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/popsg-readiness-baseline.mjs"), "utf8");
    expect(source).toContain('openSync(target, "w", 0o600)');
    expect(source).toContain("writePrivateFile(`${privateDir}/db-active-");
    expect(source).toContain("writePrivateFile(`${privateDir}/missing-in-db-");
    expect(source).toContain("writePrivateFile(`${privateDir}/extra-in-db-");
  });
});
