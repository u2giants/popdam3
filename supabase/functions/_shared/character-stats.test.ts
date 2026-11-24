import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planCharacterStats } from "./character-stats.ts";

const row = (core_character_id: string, usage_count: number, is_priority: boolean) => ({
  core_character_id,
  usage_count,
  is_priority,
});

describe("planCharacterStats (#1095, #1301)", () => {
  it("computes counts, priorities, zeroes stale rows and adds new characters", () => {
    const { changed, priorityCount } = planCharacterStats(
      [row("a", 0, false), row("b", 9, true), row("c", 5, true)],
      new Map([["a", 4], ["c", 5], ["d", 1]]),
      3,
    );
    expect(priorityCount).toBe(2);
    expect(changed).toEqual([row("a", 4, true), row("b", 0, false), row("d", 1, false)]);
  });

  it("route writes dam.character_usage once and never the retired character list", () => {
    const src = readFileSync(new URL("../admin-api/index.ts", import.meta.url), "utf8");
    const start = src.indexOf("async function handleRebuildCharacterStats");
    const fn = src.slice(start, src.indexOf("\n}\n", start));
    expect(fn).toContain('.schema("dam").from("character_usage")');
    expect(fn).toContain(".upsert(changed");
    expect(fn).not.toContain('from("characters")');
    expect(fn).not.toMatch(/usage_count:\s*0/);
  });
});
