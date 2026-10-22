import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyInvalidation } from './classify-invalidation.mjs'

const id='a'.repeat(64),sha='b'.repeat(40)
const base={reviewed_bundle_id:id,current_bundle_id:id,changed_files:[],global_invalidators:['scripts/manage-migration-author-lanes.mjs'],claims:{writes:['table core.a'],reads:['table core.b']},intervening_changes:[],history_available:true,full_ci_success:true,merge_base_is_current_main:true,integration_sha:sha,evidence_integration_sha:sha}

test('real #1713 unrelated documentation movement preserves review only after integration gates',()=>{
  const result=classifyInvalidation({...base,changed_files:['HANDOFF.md','plan_author_lane_capacity_five_to_eight.md']})
  assert.equal(result.class,'INTEGRATION_REFRESH_ONLY');assert.equal(result.preserve_review,true)
})
test('changed bundle content requires a complete replay',()=>assert.equal(classifyInvalidation({...base,current_bundle_id:'c'.repeat(64)}).class,'CONTENT_INVALIDATED'))
test('a discovered guard or policy change is global invalidation',()=>assert.equal(classifyInvalidation({...base,changed_files:['scripts/manage-migration-author-lanes.mjs']}).class,'GLOBAL_INVALIDATOR'))
test('read/write interaction requires focused review',()=>assert.equal(classifyInvalidation({...base,intervening_changes:[{id:'other',writes:['table core.b']}]}).class,'OBJECT_INTERACTION'))
test('missing CI, current merge base, history or SHA binding fails closed',()=>{
  for(const override of [{full_ci_success:false},{merge_base_is_current_main:false},{history_available:false},{evidence_integration_sha:'c'.repeat(40)}])assert.equal(classifyInvalidation({...base,...override}).class,'UNVERIFIABLE')
})
test('path names alone never prove disjointness when history is unavailable',()=>assert.equal(classifyInvalidation({...base,changed_files:['README.md'],history_available:false}).class,'UNVERIFIABLE'))
