import assert from "node:assert/strict";
import test from "node:test";
import { findEmptyGroupIds, formatError, normalizeRebuildState } from "./style-groups.js";

test("database errors retain a timeout code when PostgREST supplies a blank message", () => {
  assert.equal(formatError({ message: "", code: "57014", details: "", hint: "" }), "code=57014");
});

test("completely blank database errors get a useful message", () => {
  assert.equal(formatError({ message: "", code: "", details: "", hint: "" }), "Database error supplied no message");
});

test("a blank HEAD-style error still names the HTTP status", () => {
  assert.equal(
    formatError({ message: "", code: "", details: "", hint: "" }, { status: 500, statusText: "Internal Server Error" }),
    "Database error supplied no message | http_status=500 | http_status_text=Internal Server Error",
  );
});

test("a populated error keeps its message and gains the HTTP status", () => {
  assert.equal(
    formatError({ message: "canceling statement due to statement timeout", code: "57014" }, { status: 500, statusText: "Internal Server Error" }),
    "canceling statement due to statement timeout | code=57014 | http_status=500 | http_status_text=Internal Server Error",
  );
});

test("rebuild state preserves the pre-delete group total across worker batches", () => {
  const normalized = normalizeRebuildState({
    stage: "delete_groups",
    total_groups_before_delete: 10_868,
  });

  assert.equal(normalized.total_groups_before_delete, 10_868);
});

test("a fresh rebuild starts at rebuild_assets and never clears or deletes every group first", () => {
  assert.equal(normalizeRebuildState(null).stage, "rebuild_assets");
});

function liveMemberClient(assets: Array<{ id: string; style_group_id: string }>) {
  const queries: string[] = [];
  return {
    queries,
    client: {
      from: () => {
        let ids: string[] = [];
        let after: string | null = null;
        let max = Infinity;
        const q: any = {
          select: () => q, eq: () => q, order: () => q,
          in: (_c: string, v: string[]) => { ids = v; return q; },
          gt: (_c: string, v: string) => { after = v; return q; },
          limit: (n: number) => { max = n; return q; },
          then: (resolve: (v: unknown) => unknown) => {
            queries.push(after ?? "start");
            const data = assets.filter((a) => ids.includes(a.style_group_id) && (after === null || a.id > after)).slice(0, max);
            return Promise.resolve({ data, error: null }).then(resolve);
          },
        };
        return q;
      },
    },
  };
}

test("findEmptyGroupIds checks a whole batch in one query", async () => {
  const { client, queries } = liveMemberClient([{ id: "a1", style_group_id: "g2" }]);
  const r = await findEmptyGroupIds(client, ["g1", "g2", "g3"]);
  assert.deepEqual(r.emptyIds, ["g1", "g3"]);
  assert.equal(queries.length, 1);
});

test("findEmptyGroupIds pages past the row cap so a live member is never missed", async () => {
  const assets = Array.from({ length: 1001 }, (_, i) => ({ id: `a${String(i).padStart(5, "0")}`, style_group_id: i === 1000 ? "g2" : "g1" }));
  const { client, queries } = liveMemberClient(assets);
  const r = await findEmptyGroupIds(client, ["g1", "g2", "g3"]);
  assert.deepEqual(r.emptyIds, ["g3"]);
  assert.equal(queries.length, 2);
});

test("findEmptyGroupIds with no candidates makes no query", async () => {
  const { client, queries } = liveMemberClient([]);
  assert.deepEqual((await findEmptyGroupIds(client, [])).emptyIds, []);
  assert.equal(queries.length, 0);
});
