import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { partitionStyleGroupsByOccupancy } from "./style-group-occupancy.ts";

function fakeDb(live: Record<string, number>, failFor?: string) {
  return {
    from: () => {
      let gid = "";
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          if (col === "style_group_id") gid = v as string;
          return q;
        },
        limit: async (n: number) =>
          gid === failFor
            ? { data: null, error: { message: "timeout" } }
            : { data: Array.from({ length: Math.min(n, live[gid] ?? 0) }, (_, i) => ({ id: `${gid}-${i}` })), error: null },
      };
      return q;
    },
  };
}

describe("style group occupancy (popdam3#1078)", () => {
  it("keeps every occupied group even when one group has thousands of assets", async () => {
    const live: Record<string, number> = { big: 50_000 };
    const ids = ["big"];
    for (let i = 0; i < 60; i++) {
      ids.push(`g${i}`);
      live[`g${i}`] = i % 2;
    }
    const r = await partitionStyleGroupsByOccupancy(fakeDb(live), ids, 7);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.occupied).toContain("big");
    expect(r.empty).toEqual(ids.filter((id) => id !== "big" && live[id] === 0));
    expect(r.occupied.length + r.empty.length).toBe(ids.length);
  });

  it("fails closed when any lookup errors", async () => {
    const r = await partitionStyleGroupsByOccupancy(fakeDb({ a: 0, b: 0 }, "b"), ["a", "b"]);
    expect(r.ok).toBe(false);
  });

  it("both purge handlers use the occupancy check and stop on its failure", () => {
    const src = readFileSync(new URL("./admin-handlers/purge-handlers.ts", import.meta.url), "utf8");
    expect(src.match(/partitionStyleGroupsByOccupancy\(db, affectedGroupIds\)/g)?.length).toBe(2);
    expect(src.match(/if \(!occ\.ok\) return err\(/g)?.length).toBe(2);
    expect(src).not.toContain('.in("style_group_id", affectedGroupIds)');
  });
});
