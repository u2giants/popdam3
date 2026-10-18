import assert from "node:assert/strict";
import test from "node:test";
import { runningTagConflict, tick } from "./operation-loop.js";
test("parallel tag conflict covers manual single retags in both directions", () => {
  assert.equal(runningTagConflict("ai-tag-parallel", ["ai-tag-single-123e4567-e89b-42d3-a456-426614174000"]), true);
  assert.equal(runningTagConflict("ai-tag-single-123e4567-e89b-42d3-a456-426614174000", ["ai-tag-parallel"]), true);
  assert.equal(runningTagConflict("ai-tag-parallel", ["ai-tag-all"]), true);
  assert.equal(runningTagConflict("ai-tag-parallel", ["rebuild-style-groups"]), true);
  assert.equal(runningTagConflict("ai-tag-parallel", ["ai-tag-bakeoff"]), false);
});

test("real tick queues a direct-RPC running manual retag before any provider dispatch", async () => {
  const original = globalThis.fetch;
  const key = "ai-tag-single-123e4567-e89b-42d3-a456-426614174000";
  const ops: Record<string, import("./types.js").OpState> = {
    [key]: {status:"running",run_id:"single",cursor:0,state_revision:1,updated_at:new Date(Date.now()-1000).toISOString()},
    "ai-tag-parallel": {status:"running",run_id:"parallel",cursor:0,state_revision:1,updated_at:new Date().toISOString()},
  };
  let queued = 0, providerCalls = 0; const remoteCalls: string[] = [];
  globalThis.fetch = async(input, init) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const response = (x: unknown) => new Response(JSON.stringify(x), {headers:{"Content-Type":"application/json"}});
    if (u.hostname === "www.seafile.com" && u.pathname === "/en/download/") return new Response("");
    if (u.hostname !== "localhost") { providerCalls++; remoteCalls.push(u.hostname+u.pathname); return response({}); }
    if (u.pathname.endsWith("/admin_config")) {
      const filter=u.searchParams.get("key")??"";const all: Record<string, unknown>={BULK_OPERATIONS:ops};
      const keys=filter.startsWith("eq.")?[filter.slice(3)]:filter.slice(4,-1).split(",");
      return response(keys.filter(k=>k in all).map(k=>({key:k,value:all[k]})));
    }
    if (u.pathname.endsWith("/rpc/update_bulk_operation")) {
      const b=JSON.parse(String(init?.body));assert.equal(b.p_op_key,key);assert.equal(b.p_expected_revision,1);assert.equal(b.p_only_if_status,"running");assert.equal(b.p_op_state.status,"queued");
      const next={...b.p_op_state,state_revision:2};ops[key]=next;queued++;
      return response({ok:true,reason:"saved",operation:next,state_revision:2});
    }
    return response([]);
  };
  try {await tick();assert.equal(queued,1);assert.equal(providerCalls,0,JSON.stringify(remoteCalls));assert.equal(ops[key].cursor,0);assert.equal(ops[key].run_id,"single");}
  finally {globalThis.fetch=original;}
});
