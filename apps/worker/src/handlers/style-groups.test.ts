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

import { bindRebuildWatermark, rebuildRpcArgs, rebuildProcessedRows, rebuildWatermark } from "./style-groups.js";
import type { OpState } from "../types.js";
const incremental: OpState = { status: "running", run_id: "scheduled-run", params: {
  watermark_protocol: 1, rebuild_mode: "incremental", changed_since: "2026-10-10T06:00:00Z", changed_cutoff: "2026-10-11T06:00:00Z",
} };

test("scheduled differential bounds survive normalization and cursor resume", () => {
  const initial = bindRebuildWatermark(normalizeRebuildState(null), incremental, true);
  const saved = normalizeRebuildState({ ...initial, last_rebuild_asset_id: "cursor", total_processed: 7 });
  const resumed = bindRebuildWatermark(saved, { ...incremental, params: { ...incremental.params, resumed: true } }, false);
  assert.deepEqual(rebuildRpcArgs(resumed, 100), { p_last_asset_id: "cursor", p_batch_size: 100, p_changed_since: "2026-10-10T06:00:00Z" });
  assert.equal(resumed.total_processed, 7);
  assert.throws(() => bindRebuildWatermark(saved, { ...incremental, run_id: "another-run" }, false), /identity changed/);
  assert.throws(() => bindRebuildWatermark(saved, { ...incremental, params: { ...incremental.params, changed_cutoff: "2026-10-11T07:00:00Z" } }, false), /identity changed/);
  assert.equal(saved.last_rebuild_asset_id, "cursor");
  assert.equal(saved.watermark?.changed_cutoff, "2026-10-11T06:00:00Z");
  assert.throws(() => bindRebuildWatermark(saved, { ...incremental, params: { ...incremental.params, changed_since: "2026-10-09T06:00:00Z" } }, false), /identity changed/);
});

test("weekly full and legacy recovery keep distinct RPC signatures", () => {
  const full = bindRebuildWatermark(normalizeRebuildState(null), { ...incremental, params: { ...incremental.params, rebuild_mode: "full", changed_since: null } }, true);
  assert.equal(rebuildRpcArgs(full, 50).p_changed_since, null);
  const legacy = bindRebuildWatermark(normalizeRebuildState({ stage: "clear_assets" }), { status: "running" }, false);
  assert.equal(legacy.stage, "clear_assets");
  assert.deepEqual(rebuildRpcArgs(legacy, 50), { p_last_asset_id: null, p_batch_size: 50 });
});

test("invalid or changed scheduled inputs stop before any cursor advancement", () => {
  for (const params of [ { ...incremental.params, watermark_protocol: 2 }, { ...incremental.params, changed_since: null }, { ...incremental.params, changed_cutoff: "bad-date" }, { ...incremental.params, changed_since: "2026-10-12T06:00:00Z" }, { ...incremental.params, rebuild_mode: "unknown" } ]) {
    assert.throws(() => rebuildWatermark({ ...incremental, params }));
  }
  assert.throws(() => rebuildWatermark({ ...incremental, run_id: undefined }));
  assert.throws(() => bindRebuildWatermark(normalizeRebuildState({ stage: "rebuild_assets", last_rebuild_asset_id: "legacy-cursor" }), incremental, false), /restart explicitly/);
});

test("differential progress counts actual selected rows, including zero-row final batch", () => {
  const mark = rebuildWatermark(incremental);
  assert.equal(rebuildProcessedRows({ rows_examined: 3 }, mark, 100), 3);
  assert.equal(rebuildProcessedRows({ rows_examined: 0 }, mark, 100), 0);
  assert.throws(() => rebuildProcessedRows({}, mark, 100));
  assert.throws(() => rebuildProcessedRows({ rows_examined: -1 }, mark, 100));
  assert.throws(() => rebuildProcessedRows({ rows_examined: 1.5 }, mark, 100));
  assert.throws(() => rebuildProcessedRows({ rows_examined: "3" }, mark, 100));
  assert.equal(rebuildProcessedRows({}, undefined, 100), 100);
});
