import assert from "node:assert/strict";
import test from "node:test";
import { tick } from "./operation-loop.js";
import type { OpState } from "./types.js";

const checkpoint = "ai1:1:900529a4-0441-420c-aa2b-a59695eed750";
function fixture() {
  const now = new Date().toISOString();
  return {
    "ai-tag-parallel": {status:"running",run_id:"original-full-run",cursor:0,
      progress:{tagged:1397},state_revision:1,params:{asset_ids:["123e4567-e89b-42d3-a456-426614174000"]},updated_at:now},
    "rebuild-style-groups": {status:"interrupted",run_id:"original-nightly",cursor:0,state_revision:1,params:{},
      interruption_reason_code:"statement_timeout",next_auto_resume_at:new Date(Date.now()-1000).toISOString(),updated_at:now},
  } satisfies Record<string, OpState>;
}
async function mockWorker(ops: Record<string,OpState>, run: (context:{ rebuildCalls:()=>number; rejectYield:()=>void })=>Promise<void>, failFirstRebuild=false) {
  const original=globalThis.fetch;
  let state:unknown=null, rebuilds=0, reject=false;
  const settings:Record<string,unknown>={
    BULK_OPERATIONS:ops,
    AI_TAG_PARALLEL_RUN:{run_id:"original-full-run",models:["openai/fixture"],concurrency:8,max_cursor:0},
    AI_TASK_MODELS:{vision_tagging:"openai/fixture"},
  };
  globalThis.fetch=async(input,init)=>{
    const u=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
    const response=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{"Content-Type":"application/json","Content-Range":"0-0/0"}});
    if(u.hostname==="www.seafile.com")return response({});
    assert.equal(u.hostname,"localhost","no provider or external request");
    if(u.pathname.endsWith("/admin_config")){
      if(init?.method==="POST"){const b=JSON.parse(String(init.body));state=b.value;return response([]);}
      if(init?.method==="DELETE"){state=null;return response([]);}
      const filter=u.searchParams.get("key")??"";
      const keys=filter.startsWith("eq.")?[filter.slice(3)]:filter.slice(4,-1).split(",");
      const all={...settings,REBUILD_STYLE_GROUPS_STATE:state};
      return response(keys.filter(k=>k in all).map(k=>({key:k,value:all[k as keyof typeof all]})));
    }
    if(u.pathname.endsWith("/rpc/update_bulk_operation")){
      const b=JSON.parse(String(init?.body));const current=ops[b.p_op_key];
      if(reject&&b.p_op_key==="ai-tag-parallel"&&b.p_op_state.status==="queued")return response({ok:false,reason:"revision_conflict",operation:current,state_revision:current.state_revision,lease_receipt_issued:false});
      if(b.p_only_if_status&&current.status!==b.p_only_if_status)return response({ok:false,reason:"status_mismatch",operation:current});
      const next={...b.p_op_state,state_revision:(current.state_revision??0)+1};ops[b.p_op_key]=next;
      return b.p_expected_revision!==undefined?response({ok:true,reason:"saved",operation:next,state_revision:next.state_revision,lease_receipt_issued:false}):response(ops);
    }
    if(u.pathname.endsWith("/rpc/rebuild_style_groups_batch")){
      rebuilds++;
      if(failFirstRebuild&&rebuilds===1)return response({code:"57014",message:"canceling statement due to statement timeout"},500);
      return response([{done:true,next_cursor:null,groups_created:0,assets_assigned:0,assets_ungrouped:0,rows_examined:0}]);
    }
    if(u.pathname.endsWith("/rpc/reconcile_style_group_stats_batch"))return response([{done:true,sub:"complete",processed:0,next_cursor:null}]);
    return response([]);
  };
  try{await run({rebuildCalls:()=>rebuilds,rejectYield:()=>{reject=true;}});}finally{globalThis.fetch=original;}
}

test("real tick yields for a timed-out nightly run, retries it, then resumes the same full run",async()=>{
  const ops:Record<string,OpState>=fixture();const initial=structuredClone(ops["ai-tag-parallel"]);
  ops["ai-tag-parallel"].status="queued";ops["rebuild-style-groups"].status="running";
  await mockWorker(ops,async({rebuildCalls})=>{
    await tick();
    assert.equal(ops["rebuild-style-groups"].status,"interrupted");
    assert.equal(ops["rebuild-style-groups"].interruption_reason_code,"statement_timeout");
    await tick();
    assert.equal(ops["ai-tag-parallel"].status,"running");
    ops["rebuild-style-groups"].next_auto_resume_at=new Date(Date.now()-1000).toISOString();
    await tick();
    assert.equal(ops["ai-tag-parallel"].status,"queued");
    assert.equal(ops["rebuild-style-groups"].status,"interrupted");
    assert.equal(ops["ai-tag-parallel"].cursor,initial.cursor);
    assert.deepEqual(ops["ai-tag-parallel"].progress,initial.progress);
    await tick();
    assert.equal(rebuildCalls(),2);
    assert.equal(ops["rebuild-style-groups"].status,"completed");
    assert.equal(ops["rebuild-style-groups"].run_id,"original-nightly");
    assert.equal(ops["rebuild-style-groups"].auto_resume_attempts,1);
    await tick();
    assert.equal(ops["ai-tag-parallel"].status,"running");
    assert.equal(ops["ai-tag-parallel"].run_id,initial.run_id);
    assert.equal(ops["ai-tag-parallel"].cursor,initial.cursor);
    assert.deepEqual(ops["ai-tag-parallel"].progress,initial.progress);
  },true);
});
for(const [name,patch]of Object.entries({
  user_stop:{interruption_reason_code:"user_stop"},
  not_due:{next_auto_resume_at:new Date(Date.now()+3600000).toISOString()},
  invalid_cursor:{cursor:"invalid"},
  exhausted:{auto_resume_attempts:10},
  permanent:{interruption_reason_code:"invalid_cursor"},
}))test(`real tick retains tagging for ${name} grouping`,async()=>{
  const ops:Record<string,OpState>=fixture();Object.assign(ops["rebuild-style-groups"],patch);
  await mockWorker(ops,async({rebuildCalls})=>{await tick();assert.equal(ops["ai-tag-parallel"].status,"running");assert.equal(rebuildCalls(),0);});
});
test("another running conflict prevents retry-yield",async()=>{
  const ops:Record<string,OpState>=fixture();ops["rich-pdf-extract"]={status:"running",cursor:0,updated_at:new Date().toISOString()};
  await mockWorker(ops,async({rebuildCalls})=>{await tick();assert.equal(ops["ai-tag-parallel"].status,"running");assert.equal(rebuildCalls(),0);});
});
test("refused checkpoint yield does not retry grouping or overwrite either operation",async()=>{
  const ops:Record<string,OpState>=fixture();const before=structuredClone(ops);
  await mockWorker(ops,async({rejectYield,rebuildCalls})=>{rejectYield();await tick();assert.deepEqual(ops,before);assert.equal(rebuildCalls(),0);});
});

test("checkpoint yielding preserves discovered keysets, progress and provider receipt unchanged",async()=>{
 const ops:Record<string,OpState>=fixture();ops["ai-tag-parallel"].cursor=checkpoint;
 const receipt={provider:"openrouter",phase:"pending",provider_batch_id:"existing-receipt"} as OpState["external_job"];
 ops["ai-tag-parallel"].external_job=receipt;
 await mockWorker(ops,async()=>{await tick();assert.equal(ops["ai-tag-parallel"].status,"queued");assert.equal(ops["ai-tag-parallel"].cursor,checkpoint);assert.deepEqual(ops["ai-tag-parallel"].external_job,receipt);});
});
