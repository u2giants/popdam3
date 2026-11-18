import { describe, expect, it } from "vitest";
import { countCsvRows } from "@/lib/csv-row-count";

describe("countCsvRows", () => {
  it("excludes the header", () => expect(countCsvRows("h\na\nb\n")).toBe(2));
  it("ignores newlines inside quotes", () => expect(countCsvRows('h\n"x\ny",1\nz\n')).toBe(2));
  it("handles a missing trailing newline", () => expect(countCsvRows("h\na")).toBe(1));
  it("handles header only and empty", () => {
    expect(countCsvRows("h\n")).toBe(0);
    expect(countCsvRows("")).toBe(0);
  });
});
