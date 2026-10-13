import test from "node:test";
import assert from "node:assert/strict";
import { handleMetaTagResponse, type MetaTagDependencies } from "./meta-tag-response-state.js";
import type { OpState } from "../types.js";
const id = "123e4567-e89b-42d3-a456-426614174000";
const model = "meta-direct/muse-spark-1.3-contributor";
const attempt = { asset_id: id, method_index: 0, same_model_retry: 0 };

test("an acknowledged response's initial storage lag polls the same ID without charging a tagging failure", async () => {
  const { MetaModelApiError } = await import("../meta-model-api.js");
  const s = state();
  s.external_job!.submitted_at = new Date(0).toISOString();
  const d = deps();
  d.now = () => 40_000;
  d.retrieve = async () => { throw new MetaModelApiError(404, "Stored response retrieval failed"); };
  const result = await handleMetaTagResponse(s, d);
  assert.equal(result.ok, true);
  assert.equal(result.failed, undefined);
  const job = result.external_job as { provider_batch_id: string; next_poll_at: string; transient_poll_failures?: number };
  assert.equal(job.provider_batch_id, "resp_test");
  assert.equal(Date.parse(job.next_poll_at), 50_000);
  assert.equal(job.transient_poll_failures, undefined);
});

test("all server errors retry retrieval of the same accepted response; billing stops with pointer intact", async () => {
  const { MetaModelApiError } = await import("../meta-model-api.js");
  for (const status of [429, 500, 501, 502, 503, 504, 505]) {
    const d = deps();
    d.retrieve = async () => { throw new MetaModelApiError(status, "Temporary retrieval failure"); };
    const result = await handleMetaTagResponse(state(), d);
    assert.equal(result.ok, true);
    assert.equal(result.failed, undefined);
    assert.equal((result.external_job as { provider_batch_id: string }).provider_batch_id, "resp_test");
  }
  const d = deps();
  d.retrieve = async () => { throw new MetaModelApiError(402, "Stored response retrieval failed"); };
  const result = await handleMetaTagResponse(state(), d);
  assert.equal(result.ok, false);
  assert.equal((result.external_job as { provider_batch_id: string }).provider_batch_id, "resp_test");
});
function state(phase = "pending"): OpState {
  return { status: "running", cursor: 0, meta_tag_attempt: attempt, external_job: { provider: "meta-responses", phase: phase as "pending", model, output_method: "json_schema", provider_batch_id: "resp_test", page_cursor: 0, next_cursor: 1, lease_token: "receipt", lease_expires_at: new Date(Date.now()+120_000).toISOString(), items: [{asset_id:id,custom_id:"fixture",status:"submitted"}] } };
}
function deps(): MetaTagDependencies {
  return { model, apiKey: "test", candidate: async () => ({ asset_id:id,next_cursor:1,done:true }), prepare: async () => ({model,messages:[]}), validate: value => {if(value.answer!=="ok") throw new Error("invalid");}, apply:async()=>{}, retrieve:async()=>({id:"resp_test",status:"completed",output:[{type:"message",content:[{type:"output_text",text:'{"answer":"ok"}'}]}]}), create:async()=>{throw new Error("Never submit saved response");} };
}
test("restart with saved response retrieves without POST, checkpoints apply then completed", async()=>{
 const d=deps();let applies=0;d.apply=async()=>{applies++;};
 const pending=await handleMetaTagResponse(state(),d);assert.equal((pending.external_job as {phase:string}).phase,"applying");assert.equal(applies,0);
 const applied=await handleMetaTagResponse(state("applying"),d);assert.equal(applied.tagged,1);assert.equal((applied.external_job as {phase:string}).phase,"completed");assert.equal(applies,1);
});
test("known-ID GET timeout preserves exact ID and retries only retrieval",async()=>{
 const d=deps();d.retrieve=async()=>{throw new DOMException("timed out","TimeoutError");};
 const result=await handleMetaTagResponse(state(),d);assert.equal(result.ok,true);assert.equal(result.failed,undefined);assert.equal((result.external_job as {provider_batch_id:string}).provider_batch_id,"resp_test");
});
test("invalid terminal output saves bounded next attempt on completed job before exact clear",async()=>{
 const d=deps();d.validate=()=>{throw new Error("invalid");};const result=await handleMetaTagResponse(state(),d);
 const job=result.external_job as {phase:string;meta_next_attempt:{method_index:number};provider_batch_id:string};assert.equal(job.phase,"completed");assert.equal(job.meta_next_attempt.method_index,1);assert.equal(job.provider_batch_id,"resp_test");assert.equal(result.failed,undefined);
});
test("wrong asset/method metadata fails closed",async()=>{
 const s=state();s.meta_tag_attempt={...attempt,asset_id:"different"};assert.equal((await handleMetaTagResponse(s,deps())).ok,false);
 s.meta_tag_attempt={...attempt,method_index:4};assert.equal((await handleMetaTagResponse(s,deps())).ok,false);
});
test("exhausted structured attempts record failure without another POST",async()=>{
 const s=state();s.meta_tag_attempt={...attempt,method_index:3,same_model_retry:1};s.external_job!.output_method="json_object";
 const d=deps();d.validate=()=>{throw new Error("invalid");};assert.equal((await handleMetaTagResponse(s,d)).failed,1);
});

test("missing preview is unavailable before creation and never fabricated",async()=>{
 const d=deps();d.prepare=async()=>{throw new Error("Asset has no thumbnail");};d.unavailable=()=>true;
 const result=await handleMetaTagResponse({status:"running",cursor:0},d);assert.equal(result.visual_analysis_unavailable,1);assert.equal(result.nextOffset,1);assert.equal(result.external_job,undefined);
});
test("completed clear after lost receipt retains exact job and finite next attempt",async()=>{
 const s=state("completed");delete s.external_job!.lease_token;s.external_job!.lease_expires_at=new Date(0).toISOString();s.params={asset_ids:[id]};s.external_job!.meta_asset_terminal=false;s.external_job!.meta_next_attempt={...attempt,method_index:1};
 const result=await handleMetaTagResponse(s,deps());assert.equal(result.meta_tag_attempt && (result.meta_tag_attempt as {method_index:number}).method_index,1);assert.equal(result.nextOffset,0);assert.equal((result.external_job as {provider_batch_id:string}).provider_batch_id,"resp_test");
});

test("unknown saved status never advances or clears the accepted ID",async()=>{
 const d=deps();d.retrieve=async()=>({id:"resp_test",status:"unknown"});const result=await handleMetaTagResponse(state(),d);
 assert.equal(result.ok,false);assert.equal(result.failed,undefined);assert.equal((result.external_job as {provider_batch_id:string}).provider_batch_id,"resp_test");
});
test("known response GET5xx and429 remain GET-only transient while wrongID fails closed",async()=>{
 const {MetaModelApiError}=await import("../meta-model-api.js");
 for(const status of [429,500,502,503,504]){const d=deps();d.retrieve=async()=>{throw new MetaModelApiError(status,"server");};const result=await handleMetaTagResponse(state(),d);assert.equal(result.ok,true);assert.equal(result.failed,undefined);}
 const d=deps();d.retrieve=async()=>({id:"other",status:"completed"});assert.equal((await handleMetaTagResponse(state(),d)).ok,false);
});
test("proven unsupported-format reset advances bounded method only after fresh CAS; failed reset cannot advance",async()=>{
 const {advanceMetaCapabilityRejection}=await import("./meta-tag-response-state.js");const {MetaCapabilityRejectionError}=await import("../meta-model-api.js");
 const s=state("submitting");delete s.external_job!.provider_batch_id;
 const rejection=new MetaCapabilityRejectionError("Meta",400,{code:400,category:"meta_output_contract"});const calls:string[]=[];
 const rpc=(async(name:string,params:Record<string,unknown>)=>{calls.push(name);if(name==="reset_bulk_operation_submission_lease")return {data:{ok:true,state_revision:9,lease_receipt_issued:false,operation:{...s,external_job:{...s.external_job!,phase:"prepared",last_definitive_rejection_at:"test"}}},error:null};assert.equal(params.p_expected_revision,9);return {data:{ok:true,state_revision:10},error:null};}) as import("../provider-submission-recovery.js").RpcCall;
 const next=await advanceMetaCapabilityRejection(rpc,{opKey:"op",expectedRevision:8,submissionOwner:"owner",leaseToken:"receipt"},s,rejection);assert.equal(next?.meta_tag_attempt?.method_index,1);assert.deepEqual(calls,["reset_bulk_operation_submission_lease","update_bulk_operation"]);
 let attempts=0;const refuse=(async()=>{attempts++;return {data:{ok:false},error:{message:"refused"}};}) as import("../provider-submission-recovery.js").RpcCall;
 await assert.rejects(advanceMetaCapabilityRejection(refuse,{opKey:"op",expectedRevision:8,submissionOwner:"owner",leaseToken:"receipt"},s,rejection));assert.equal(attempts,1);assert.equal(s.meta_tag_attempt?.method_index,0);
});

test("known capacity delay is checkpointed; retry requires existing-receipt renewal and seventh rejection stops",async()=>{
 const {MetaCapacityRejectionError}=await import("../meta-model-api.js");
 const s=state("submitting");delete s.external_job!.provider_batch_id;s.state_revision=8;
 const d=deps();let posts=0;d.create=async()=>{posts++;throw new MetaCapacityRejectionError(503);};d.now=()=>Date.now();
 const delayed=await handleMetaTagResponse(s,d);assert.equal(posts,1);const job=delayed.external_job as NonNullable<OpState["external_job"]>;assert.equal(job.meta_capacity_retries,1);assert.equal(job.meta_capacity_required_revision,9);
 const waiting={...s,state_revision:9,external_job:job};assert.equal((await handleMetaTagResponse(waiting,d)).state_transition,"yield_without_save");assert.equal(posts,1);
 d.now=()=>Date.parse(job.next_poll_at!)+1;
 assert.equal((await handleMetaTagResponse(waiting,d)).state_transition,"claim_submission");assert.equal(posts,1);
 const renewed={...waiting,state_revision:10};await handleMetaTagResponse(renewed,d);assert.equal(posts,2);
 renewed.external_job={...job,meta_capacity_retries:6};assert.equal((await handleMetaTagResponse(renewed,d)).error_code,"meta_capacity_exhausted");assert.equal(posts,3);
 const restarted={...renewed,external_job:{...renewed.external_job!}};delete restarted.external_job!.lease_token;assert.equal((await handleMetaTagResponse(restarted,d)).state_transition,"claim_submission");assert.equal(posts,3);
});

test("real unavailable and missing-asset predicates preserve per-item outcomes and transient DB reason",async()=>{
 const {isVisualAnalysisUnavailableError,AssetMissingError}=await import("./ai-tagging.js");
 const d=deps();d.unavailable=isVisualAnalysisUnavailableError;d.missing=error=>error instanceof AssetMissingError;
 d.prepare=async()=>{throw new Error(`Asset has no thumbnail: ${id}`);};
 const initial={status:"running" as const,cursor:0};const unavailable=await handleMetaTagResponse(initial,d);assert.equal(unavailable.visual_analysis_unavailable,1);assert.equal(unavailable.nextOffset,1);
 d.prepare=async()=>{throw new AssetMissingError(id);};const missing=await handleMetaTagResponse(initial,d);assert.equal(missing.skipped,1);assert.equal(missing.nextOffset,1);assert.equal((missing.skip_samples as Array<{reason:string}>)[0].reason,"Asset no longer exists");
 d.prepare=async()=>{throw new Error("Meta asset reload failed: canceling statement due to statement timeout (57014)");};const transient=await handleMetaTagResponse(initial,d);assert.equal(transient.error_code,"dependency_timeout");assert.match(String(transient.error),/57014/);assert.equal(transient.skipped,undefined);
 d.prepare=async()=>{throw new Error("Meta asset reload failed: permission denied");};await assert.rejects(handleMetaTagResponse(initial,d),/permission denied/);
});
test("candidate cursor error keeps the original invalid_cursor code",async()=>{
 const {AiTagCursorError}=await import("../ai-tag-cursor.js");const d=deps();d.candidate=async()=>{throw new AiTagCursorError("invalid_cursor","invalid fixture");};assert.equal((await handleMetaTagResponse({status:"running"},d)).error_code,"invalid_cursor");
});

test("actual reload classifier distinguishes empty and PGRST116 zero rows from nonmissing database errors",async()=>{
 const {requireMetaAssetRow,AssetMissingError}=await import("./ai-tagging.js");
 assert.throws(()=>requireMetaAssetRow(null,null,id),AssetMissingError);
 assert.throws(()=>requireMetaAssetRow(null,{code:"PGRST116",message:"Cannot coerce",details:"The result contains 0 rows"},id),AssetMissingError);
 assert.throws(()=>requireMetaAssetRow(null,{code:"PGRST116",message:"Cannot coerce",details:"The result contains 2 rows"},id),/Cannot coerce/);
 assert.throws(()=>requireMetaAssetRow(null,{code:"42501",message:"permission denied"},id),/permission denied/);
 assert.throws(()=>requireMetaAssetRow(null,{code:"57014",message:"statement timeout"},id),/statement timeout/);
 assert.equal(requireMetaAssetRow({id},null,id).id,id);
});

test("active inference bound pauses exact ID without generation or cursor advance, and explicit resume retrieves same completion",async()=>{
 const s=state();s.external_job!.submitted_at=new Date(1_000).toISOString();const d=deps();d.now=()=>1_000+30*60_000;let creates=0;d.create=async()=>{creates++;throw new Error("No new generation");};
 d.retrieve=async()=>({id:"resp_test",status:"queued"});const paused=await handleMetaTagResponse(s,d);assert.equal(paused.error_code,"meta_inference_deadline");assert.equal(paused.nextOffset,undefined);assert.equal((paused.external_job as {provider_batch_id:string}).provider_batch_id,"resp_test");assert.equal(creates,0);
 d.retrieve=deps().retrieve;const resumed=await handleMetaTagResponse({...s,status:"running"},d);assert.equal((resumed.external_job as {phase:string}).phase,"applying");assert.equal(creates,0);
 delete s.external_job!.submitted_at;d.retrieve=async()=>({id:"resp_test",status:"in_progress"});assert.equal((await handleMetaTagResponse(s,d)).error_code,"contract_error");assert.equal(creates,0);
});
