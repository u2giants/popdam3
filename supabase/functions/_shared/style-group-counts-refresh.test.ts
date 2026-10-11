import { describe, expect, it } from "vitest";
import { createStyleGroupCountsRefresher, type RpcClient } from "./style-group-counts-refresh.ts";

function fakeDb(failures: Record<string, number> = {}) {
  const calls: { fn: string; ids: string[] }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const counts = new Map<string, number>();
  const db: RpcClient = {
    async rpc(fn, args) {
      const ids = args.p_group_ids as string[];
      calls.push({ fn, ids });
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if ((failures[fn] ?? 0) > 0) {
        failures[fn]--;
        return { error: { message: "canceling statement due to statement timeout" } };
      }
      if (fn === "refresh_style_group_counts_serialized") { for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1); }
      return { error: null };
    },
  };
  return { db, calls, counts, maxInFlight: () => maxInFlight };
}

const noSleep = async () => {};

describe("style-group counts refresher", () => {
  it("coalesces duplicate delivery into one call", async () => {
    const f = fakeDb();
    const refresh = createStyleGroupCountsRefresher({ sleep: noSleep, includePrimaries: false });
    const rs = await Promise.all([refresh(f.db, ["a", "b"]), refresh(f.db, ["b", "a"]), refresh(f.db, ["a"])]);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(f.calls).toEqual([{ fn: "refresh_style_group_counts_serialized", ids: ["a", "b"] }]);
  });

  it("never runs overlapping batches concurrently and merges late arrivals", async () => {
    const f = fakeDb();
    const refresh = createStyleGroupCountsRefresher({ sleep: noSleep, includePrimaries: false });
    const first = refresh(f.db, ["c", "a"]);
    await new Promise((r) => setTimeout(r, 1));
    const late = [refresh(f.db, ["a", "d"]), refresh(f.db, ["d", "e"])];
    await Promise.all([first, ...late]);
    expect(f.maxInFlight()).toBe(1);
    expect(f.calls.map((c) => c.ids)).toEqual([["a", "c"], ["a", "d", "e"]]);
  });

  it("handles concurrent different-key work with preserved final counts", async () => {
    const f = fakeDb();
    const refresh = createStyleGroupCountsRefresher({ sleep: noSleep });
    await Promise.all(["x", "y", "z"].map((id) => refresh(f.db, [id])));
    expect([...f.counts.keys()].sort()).toEqual(["x", "y", "z"]);
    expect(f.calls.map((c) => c.fn)).toEqual(["refresh_style_group_counts_serialized", "refresh_style_group_primaries"]);
  });

  it("retries after a transient failure", async () => {
    const f = fakeDb({ refresh_style_group_counts_serialized: 1 });
    const refresh = createStyleGroupCountsRefresher({ sleep: noSleep, includePrimaries: false });
    const r = await refresh(f.db, ["a"]);
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(f.counts.get("a")).toBe(1);
  });

  it("surfaces persistent failure and still serves later requests", async () => {
    const f = fakeDb({ refresh_style_group_counts_serialized: 3 });
    const refresh = createStyleGroupCountsRefresher({ sleep: noSleep, includePrimaries: false, maxAttempts: 3 });
    const r = await refresh(f.db, ["a"]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("statement timeout");
    expect((await refresh(f.db, ["a"])).ok).toBe(true);
  });

  it("reports partial chunk failure only to affected callers", async () => {
    const f = fakeDb({ refresh_style_group_counts_serialized: 1 });
    const refresh = createStyleGroupCountsRefresher({ sleep: noSleep, includePrimaries: false, maxAttempts: 1, chunkSize: 1 });
    const [ra, rb] = await Promise.all([refresh(f.db, ["a"]), refresh(f.db, ["b"])]);
    expect(ra.ok).toBe(false);
    expect(rb.ok).toBe(true);
  });

  it("ignores empty input", async () => {
    const f = fakeDb();
    const refresh = createStyleGroupCountsRefresher();
    expect(await refresh(f.db, [null, undefined])).toMatchObject({ ok: true, groups: 0 });
    expect(f.calls).toHaveLength(0);
  });
});
