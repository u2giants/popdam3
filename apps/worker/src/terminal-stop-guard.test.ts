import assert from "node:assert/strict";
import test from "node:test";
import { persistOpState, tick } from "./operation-loop.js";
import type { OpState } from "./types.js";

// All requests are intercepted; no running worker or database is involved.
test("conditional terminal saves cannot replace a concurrent user Stop", async () => {
  const original = globalThis.fetch;
  const key = "rebuild-style-groups";
  const stopped: OpState = { status: "interrupted", interruption_reason_code: "user_stop", run_id: "stop-race", cursor: 9 };
  const writes: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.hostname, "localhost");
    assert.ok(url.pathname.endsWith("/rpc/update_bulk_operation"));
    const params = JSON.parse(String(init?.body));
    writes.push(params);
    assert.equal(params.p_only_if_status, "running");
    return Response.json({ [key]: stopped });
  };
  try {
    for (const status of ["completed", "failed"] as const) {
      assert.equal(await persistOpState(key, { ...stopped, status }, { onlyIfRunning: true }), false);
    }
    assert.equal(writes.length, 2);
    assert.equal(stopped.status, "interrupted");
  } finally { globalThis.fetch = original; }
});

test("real tick does not record a terminal failure after a concurrent Stop refuses its save", async () => {
  const original = globalThis.fetch;
  const key = "rebuild-style-groups";
  const now = new Date().toISOString();
  // Missing legacy cursor drives a terminal failure without invoking a handler.
  const running: OpState = { status: "running", run_id: "legacy-stop-race", started_at: now, updated_at: now };
  const stopped: OpState = { ...running, status: "interrupted", interruption_reason_code: "user_stop" };
  let observed: OpState = running;
  let attempted = 0;
  const terminalCalls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "www.seafile.com" && url.pathname === "/en/download/") return new Response("");
    assert.equal(url.hostname, "localhost", `unexpected external request ${url.hostname}`);
    if (url.pathname.endsWith("/admin_config")) {
      const all: Record<string, unknown> = { BULK_OPERATIONS: { [key]: observed } };
      const filter = url.searchParams.get("key") ?? "";
      const keys = filter.startsWith("eq.") ? [filter.slice(3)] : filter.slice(4, -1).split(",");
      return Response.json(keys.filter(k => k in all).map(k => ({ key: k, value: all[k] })));
    }
    if (url.pathname.endsWith("/rpc/update_bulk_operation")) {
      const params = JSON.parse(String(init?.body));
      assert.equal(params.p_op_key, key);
      assert.equal(params.p_op_state.status, "failed");
      assert.equal(params.p_only_if_status, "running");
      attempted++;
      observed = stopped;
      return Response.json({ [key]: stopped });
    }
    // The independent deterministic style-guide lane performs this read-only RPC.
    if (url.pathname.endsWith("/rpc/get_style_guide_deterministic_tag_batch_v2")) return Response.json([]);
    if ((init?.method ?? "GET") !== "GET") terminalCalls.push(url.pathname);
    return Response.json([]);
  };
  try {
    await tick();
    await tick(); // A subsequent worker pass must not auto-resume a user Stop.
    assert.equal(attempted, 1);
    assert.deepEqual(terminalCalls, [], "refused save must not append a terminal history record or alert");
    assert.equal(stopped.status, "interrupted");
  } finally { globalThis.fetch = original; }
});

test("batch-error terminal failure save cannot replace a concurrent user Stop", async () => {
  const original = globalThis.fetch;
  const key = "no-such-operation"; // dispatch returns ok:false, driving the batch-error failure write
  const now = new Date().toISOString();
  const running: OpState = { status: "running", run_id: "batch-error-stop-race", cursor: 4, started_at: now, updated_at: now };
  const stopped: OpState = { ...running, status: "interrupted", interruption_reason_code: "user_stop" };
  let observed: OpState = running;
  let failureWrites = 0;
  const terminalCalls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "www.seafile.com" && url.pathname === "/en/download/") return new Response("");
    assert.equal(url.hostname, "localhost", `unexpected external request ${url.hostname}`);
    if (url.pathname.endsWith("/admin_config")) {
      const all: Record<string, unknown> = { BULK_OPERATIONS: { [key]: observed } };
      const filter = url.searchParams.get("key") ?? "";
      const keys = filter.startsWith("eq.") ? [filter.slice(3)] : filter.slice(4, -1).split(",");
      return Response.json(keys.filter(k => k in all).map(k => ({ key: k, value: all[k] })));
    }
    if (url.pathname.endsWith("/rpc/update_bulk_operation")) {
      const params = JSON.parse(String(init?.body));
      assert.equal(params.p_op_key, key);
      assert.equal(params.p_op_state.status, "failed");
      assert.equal(params.p_only_if_status, "running");
      failureWrites++;
      observed = stopped;
      return Response.json({ [key]: stopped });
    }
    // The independent deterministic style-guide lane performs this read-only RPC.
    if (url.pathname.endsWith("/rpc/get_style_guide_deterministic_tag_batch_v2")) return Response.json([]);
    if ((init?.method ?? "GET") !== "GET") terminalCalls.push(url.pathname);
    return Response.json([]);
  };
  try {
    await tick();
    await tick(); // A subsequent worker pass must not re-dispatch a user Stop.
    assert.equal(failureWrites, 1);
    assert.deepEqual(terminalCalls, [], "refused save must not append a terminal history record or alert");
    assert.equal(stopped.status, "interrupted");
  } finally { globalThis.fetch = original; }
});
