import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planCharacterStats } from "./character-stats.ts";

const row = (id: string, usage_count: number, is_priority: boolean) => ({
  id, name: id, property_id: "p", usage_count, is_priority,
});

describe("planCharacterStats (#1095)", () => {
  it("computes counts, priorities and zeroes characters without links", () => {
    const { changed, priorityCount } = planCharacterStats(
      [row("a", 0, false), row("b", 9, true), row("c", 5, true)],
      new Map([["a", 4], ["c", 5]]),
      3,
    );
    expect(priorityCount).toBe(2);
    expect(changed).toEqual([row("a", 4, true), row("b", 0, false)]);
  });

  it("route writes once and never resets the catalog first", () => {
    const src = readFileSync(new URL("../admin-api/index.ts", import.meta.url), "utf8");
    const start = src.indexOf("async function handleRebuildCharacterStats");
    const fn = src.slice(start, src.indexOf("\n}\n", start));
    expect(fn).toContain(".upsert(changed");
    expect(fn).not.toMatch(/usage_count:\s*0/);
    expect(fn).not.toMatch(/\.eq\("id", characterId\)/);
  });
});
