import { describe, expect, it } from "vitest";
import { type RetireChunkDb, retireMissingInChunks } from "./retire-missing-chunks.ts";

function fakeDb(failOnCall?: number) {
  const history = new Map<string, string>();
  const deleted: string[] = [];
  let calls = 0;
  let seq = 0;
  const db: RetireChunkDb = {
    insertHistory: async (rows) => {
      const ids = rows.map((r) => {
        const id = `h${seq++}`;
        history.set(id, r.asset_id);
        return id;
      });
      return { ids };
    },
    softDelete: async (ids) => {
      calls++;
      if (calls === failOnCall) return { ids: [], error: "canceling statement due to statement timeout" };
      deleted.push(...ids);
      return { ids };
    },
    deleteHistory: async (ids) => {
      for (const id of ids) history.delete(id);
      return {};
    },
  };
  return { db, history, deleted, calls: () => calls };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, relative_path: `Decor/f${i}.psd` }));

describe("retireMissingInChunks (#1117)", () => {
  it("retires in small statements", async () => {
    const f = fakeDb();
    const r = await retireMissingInChunks(rows(25), f.db, 10);
    expect(r).toEqual({ retired: 25 });
    expect(f.calls()).toBe(3);
    expect(f.history.size).toBe(25);
  });

  it("a timed-out chunk keeps earlier work and leaves no orphan markers", async () => {
    const f = fakeDb(2);
    const r = await retireMissingInChunks(rows(25), f.db, 10);
    expect(r.retired).toBe(10);
    expect(r.error).toMatch(/statement timeout/);
    expect(f.deleted).toHaveLength(10);
    expect([...f.history.values()].sort()).toEqual(f.deleted.slice().sort());
  });
});
