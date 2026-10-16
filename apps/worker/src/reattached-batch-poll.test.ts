import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {tick, holdsAcceptedAcknowledgement, forgetSubmissionState} from './operation-loop.js';
import type {OpState} from './types.js';

test('reattached failed batch persists terminal poll at claimed revision and clears without a new POST', async () => {
  const originalFetch = globalThis.fetch;
  const key = 'ai-tag-all';
  const token = 'test-poll-receipt';
  let state: OpState = {status:'running',run_id:'reattached-poll-test',cursor:0,state_revision:5,
    started_at:new Date().toISOString(),updated_at:new Date().toISOString(),progress:{total:1},params:{asset_ids:['test-asset']},
    external_job:{version:1,phase:'pending',model:'google/gemini-3.7-flash:batch',provider_batch_id:'existing-batch',
      prepared_at:'prepared',page_cursor:0,next_cursor:1,operation_done_after_clear:true,
      items:[{asset_id:'test-asset',custom_id:'test-custom',status:'submitted'}]}};
  let polls=0, providerPosts=0, claims=0, terminalSaves=0, clears=0;
  globalThis.fetch=async(input,init)=>{
    const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    const response=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
    if(u.hostname==='openrouter.ai'){
      if(init?.method==='POST')providerPosts++;
      else polls++;
      return response({id:'existing-batch',status:'failed'});
    }
    if(u.pathname.endsWith('/admin_config')){
      const values:Record<string,unknown>={BULK_OPERATIONS:{[key]:state},OPENROUTER_API_KEY:'test',AI_TASK_MODELS:{vision_tagging:'meta-direct/muse-spark-1.3-contributor'}};
      const filter=u.searchParams.get('key')||'';
      const names=filter.startsWith('eq.')?[filter.slice(3)]:filter.startsWith('in.(')?filter.slice(4,-1).split(','):[];
      return response(names.filter(n=>n in values).map(n=>({key:n,value:values[n]})));
    }
    if(u.pathname.endsWith('/rpc/update_bulk_operation')){
      const body=JSON.parse(String(init?.body));
      assert.equal(body.p_expected_revision,state.state_revision);
      const next=structuredClone(body.p_op_state) as OpState;
      let issued=false;
      if(body.p_submission_owner){
        claims++;issued=true;
        next.external_job={...next.external_job!,submission_owner:body.p_submission_owner,
          lease_expires_at:new Date(Date.now()+120000).toISOString(),lease_proof:createHash('md5').update(token).digest('hex')};
      }else if(next.external_job?.clear_after_reconciliation){
        clears++;assert.equal(next.external_job.lease_token,token);assert.equal(state.external_job?.phase,'completed');
        assert.equal(next.status,'completed');delete next.external_job;
      }else{
        terminalSaves++;assert.equal(next.external_job?.phase,'completed');assert.equal(next.external_job?.lease_token,token);
        assert.equal(next.external_job?.items?.[0].status,'failed_terminal');assert.equal(next.progress?.failed,1);
      }
      next.state_revision=(state.state_revision??0)+1;
      state=structuredClone(next);
      if(state.external_job)delete state.external_job.lease_token;
      return response({ok:true,reason:'saved',operation:state,state_revision:state.state_revision,
        lease_receipt_issued:issued,lease_token:issued?token:null,submission_owner:state.external_job?.submission_owner??null,
        lease_expires_at:state.external_job?.lease_expires_at??null,provider_batch_id:state.external_job?.provider_batch_id??null});
    }
    return response([]);
  };
  try{
    await tick();
    assert.equal(claims,1);assert.equal(polls,1);assert.equal(providerPosts,0);
    assert.equal(terminalSaves,1);assert.equal(clears,1);assert.equal(state.status,'completed');
    assert.equal(state.external_job,undefined);assert.equal(holdsAcceptedAcknowledgement(key),false);
  }finally{globalThis.fetch=originalFetch;forgetSubmissionState(key);}
});
