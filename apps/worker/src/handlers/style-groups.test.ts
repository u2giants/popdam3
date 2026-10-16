import assert from "node:assert/strict";
import test from "node:test";
import { findEmptyGroupIds, formatError, normalizeRebuildState, handleRebuildStyleGroups, hashCursorCheckpoint } from "./style-groups.js";
import type { DB } from "../supabase.js";

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

// PostgreSQL jsonb returns object fields in its own order, not insertion order.
test("persisted JSONB watermark resumes when field order changes", () => {
  const initial = bindRebuildWatermark(normalizeRebuildState(null), incremental, true);
  const persisted = JSON.parse(JSON.stringify({ ...initial, last_rebuild_asset_id: "asset-after-restart",
    total_processed: 7, watermark: { run_id: initial.watermark!.run_id,
      rebuild_mode: initial.watermark!.rebuild_mode, changed_since: initial.watermark!.changed_since,
      changed_cutoff: initial.watermark!.changed_cutoff } }));
  assert.notEqual(JSON.stringify(persisted.watermark), JSON.stringify(initial.watermark));
  const resumed = bindRebuildWatermark(normalizeRebuildState(persisted), incremental, false);
  assert.equal(resumed.total_processed, 7);
  assert.equal(rebuildRpcArgs(resumed, 100).p_last_asset_id, "asset-after-restart");
  assert.equal(rebuildRpcArgs(resumed, 100).p_changed_since, incremental.params!.changed_since);
});


test("legacy persisted null watermark preserves the existing cursor and progress", () => {
  const saved = JSON.parse('{"stage":"rebuild_assets","watermark":null,"last_rebuild_asset_id":"legacy-cursor","total_processed":9}');
  const resumed = bindRebuildWatermark(normalizeRebuildState(saved), { status: "running" }, false);
  assert.equal(resumed.total_processed, 9);
  assert.deepEqual(rebuildRpcArgs(resumed, 50), { p_last_asset_id: "legacy-cursor", p_batch_size: 50 });
});
test("scheduled persisted null watermark rejects changed identity without a TypeError", () => {
  const saved = JSON.parse('{"stage":"rebuild_assets","watermark":null,"last_rebuild_asset_id":"saved-cursor"}');
  assert.throws(() => bindRebuildWatermark(normalizeRebuildState(saved), incremental, false), /Rebuild resume bounds\/run identity changed; restart explicitly/);
  assert.equal(saved.last_rebuild_asset_id, "saved-cursor");
});
test("nonobject persisted watermark rejects safely without losing saved progress", () => {
  const saved = JSON.parse('{"stage":"rebuild_assets","watermark":27,"total_processed":9}');
  assert.throws(() => bindRebuildWatermark(normalizeRebuildState(saved), incremental, false), /Rebuild resume bounds\/run identity changed; restart explicitly/);
  assert.equal(saved.total_processed, 9);
});

function fakeRebuildClient(options: {
  state?: Record<string, unknown> | null;
  loadError?: unknown;
  saveError?: unknown;
  deleteError?: unknown;
  rpc: () => Promise<{ data?: unknown; error?: unknown }>;
}) {
  let state = options.state ?? null;
  let rpcCalls = 0;
  const client = {
    from(table: string) {
      let key: string | undefined;
      let isDelete = false;
      const query: any = {
        select: () => query,
        in: () => query,
        eq: (_column: string, value: string) => {
          key = value;
          return isDelete ? Promise.resolve({ error: options.deleteError ?? null }) : query;
        },
        maybeSingle: async () => ({ data: key === "REBUILD_STYLE_GROUPS_STATE" && state ? { value: state } : null, error: options.loadError ?? null }),
        upsert: async (row: { key: string; value: Record<string, unknown> }) => {
          if (!options.saveError) state = row.value;
          return { error: options.saveError ?? null };
        },
        delete: () => { isDelete = true; return query; },
        order: () => query,
        limit: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "admin_config" ? [] : [], error: null }).then(resolve),
      };
      return query;
    },
    async rpc() {
      rpcCalls += 1;
      return options.rpc();
    },
  };
  return { client: client as unknown as DB, getState: () => state, getRpcCalls: () => rpcCalls };
}

function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: Array<Record<string, unknown>> }> {
  const previousLog = console.log;
  const previousError = console.error;
  const logs: Array<Record<string, unknown>> = [];
  console.log = (line?: unknown) => { try { logs.push(JSON.parse(String(line))); } catch { /* retain only structured worker entries */ } };
  console.error = (line?: unknown) => { try { logs.push(JSON.parse(String(line))); } catch { /* retain only structured worker entries */ } };
  return fn().then(result => ({ result, logs })).finally(() => {
    console.log = previousLog;
    console.error = previousError;
  });
}

const scheduledRun: OpState = {
  status: "running",
  run_id: "rebuild-run-fixture",
  cursor: 2,
  started_at: "2026-10-15T12:00:00.000Z",
  params: { watermark_protocol: 1, rebuild_mode: "incremental", changed_since: "2026-10-14T06:00:00.000Z", changed_cutoff: "2026-10-15T06:00:00.000Z" },
};

function savedRebuildState(cursor: string, stage: "rebuild_assets" | "delete_groups" = "rebuild_assets") {
  return {
    stage,
    last_group_id: null,
    last_rebuild_asset_id: cursor,
    total_assets: 1,
    total_processed: 4,
    watermark: {
      run_id: scheduledRun.run_id,
      rebuild_mode: "incremental",
      changed_since: scheduledRun.params!.changed_since,
      changed_cutoff: scheduledRun.params!.changed_cutoff,
    },
  };
}

test("checkpoint load, save, and clear errors never report a successful rebuild batch", async () => {
  const loadFailure = fakeRebuildClient({
    loadError: { message: "read refused", code: "42501" },
    rpc: async () => ({ data: { done: false } }),
  });
  const loadResult = await handleRebuildStyleGroups(scheduledRun, loadFailure.client);
  assert.equal(loadResult.ok, false);
  assert.equal(loadResult.error_code, "checkpoint_read_failed");
  assert.equal(loadFailure.getRpcCalls(), 0);

  const cursor = "sentinel-asset-uuid-8f4740f4-0a8c-4e1f-9d6d-97b728c934dd";
  const saveFailure = fakeRebuildClient({
    state: savedRebuildState(cursor),
    saveError: { message: "write refused", code: "42501" },
    rpc: async () => ({ data: { done: false, next_cursor: "sentinel-next-asset-uuid", rows_examined: 1 } }),
  });
  const { result: saveResult, logs: saveLogs } = await captureLogs(() => handleRebuildStyleGroups(scheduledRun, saveFailure.client));
  assert.equal(saveResult.ok, false);
  assert.equal(saveResult.error_code, "checkpoint_save_failed");
  assert.equal((saveFailure.getState() as any).last_rebuild_asset_id, cursor);
  assert.equal(saveLogs.some(log => (log as any).event === "checkpoint_saved"), false);

  const deleteFailure = fakeRebuildClient({
    state: savedRebuildState(cursor, "delete_groups"),
    deleteError: { message: "delete refused", code: "42501" },
    rpc: async () => ({ data: null }),
  });
  const deleteResult = await handleRebuildStyleGroups(scheduledRun, deleteFailure.client);
  assert.equal(deleteResult.ok, false);
  assert.equal(deleteResult.done, false);
  assert.equal(deleteResult.error_code, "checkpoint_delete_failed");
});

test("interruption then resumed handler success logs the same safe checkpoint and a new cursor hash", async () => {
  const previousCursor = "sentinel-asset-uuid-8f4740f4-0a8c-4e1f-9d6d-97b728c934dd";
  const nextCursor = "sentinel-next-asset-uuid-73dc499c-c369-47c7-b0aa-ae6cdb3c38db";
  let calls = 0;
  const fake = fakeRebuildClient({
    state: savedRebuildState(previousCursor),
    rpc: async () => {
      calls += 1;
      return calls === 1
        ? { data: null, error: { message: "statement timeout", code: "57014" } }
        : { data: { done: false, next_cursor: nextCursor, rows_examined: 1, assets_assigned: 1 } };
    },
  });
  const { result: failed, logs: firstLogs } = await captureLogs(() => handleRebuildStyleGroups(scheduledRun, fake.client));
  assert.equal(failed.ok, false);
  const resumedRun = { ...scheduledRun, auto_resume_attempts: 1 };
  const { result: resumed, logs: resumeLogs } = await captureLogs(() => handleRebuildStyleGroups(resumedRun, fake.client));
  assert.equal(resumed.ok, true);

  const firstReceipts = firstLogs.filter(log => typeof log.event === "string");
  const resumedReceipts = resumeLogs.filter(log => typeof log.event === "string");
  const failure = firstReceipts.find(log => log.event === "rpc_failed")!;
  const resumeStart = resumedReceipts.find(log => log.event === "batch_started")!;
  const saved = resumedReceipts.find(log => log.event === "checkpoint_saved")!;
  assert.equal(failure.run_id, scheduledRun.run_id);
  assert.equal(failure.changed_since, scheduledRun.params!.changed_since);
  assert.equal(failure.changed_cutoff, scheduledRun.params!.changed_cutoff);
  assert.equal(failure.rebuild_mode, "incremental");
  assert.equal(failure.auto_resume_attempts, 0);
  assert.equal(resumeStart.run_id, failure.run_id);
  assert.equal(resumeStart.changed_since, failure.changed_since);
  assert.equal(resumeStart.auto_resume_attempts, 1);
  assert.equal(resumeStart.cursor_sha256, failure.cursor_sha256);
  assert.equal(saved.cursor_sha256, failure.cursor_sha256);
  assert.notEqual(saved.next_cursor_sha256, failure.cursor_sha256);
  assert.doesNotMatch(JSON.stringify([...firstReceipts, ...resumedReceipts]), /sentinel-asset-uuid|sentinel-next-asset-uuid/);
  assert.equal(hashCursorCheckpoint("stage", "rebuild_assets", "last_rebuild_asset_id", previousCursor), failure.cursor_sha256);
});
