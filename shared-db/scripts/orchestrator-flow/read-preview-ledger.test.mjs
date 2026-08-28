import assert from 'node:assert/strict'
import test from 'node:test'
import { APPLIED_VERSIONS_SQL, fetchAppliedVersions, PROJECT_REFS, readPreviewLedger, Unknown } from './read-preview-ledger.mjs'

test('preview ledger uses injected repository variable and read-only fetch',async()=>{
  const calls=[]
  const result=await readPreviewLedger({readRepoVariable:async(name)=>{calls.push(name);return PROJECT_REFS.preview},fetchAppliedVersions:async(ref)=>{calls.push(ref);return ['20260828000002','20260828000001']}})
  assert.deepEqual(calls,['PREVIEW_PROJECT_REF',PROJECT_REFS.preview]);assert.deepEqual(result.versions,['20260828000001','20260828000002'])
})
test('unset, malformed, production, stale cross-check and empty evidence fail closed',async()=>{
  for(const ref of ['', 'ABC',PROJECT_REFS.production,'abcdefghijklmnopqrst'])await assert.rejects(()=>readPreviewLedger({readRepoVariable:async()=>ref,fetchAppliedVersions:async()=>['20260828000001']}),Unknown)
  await assert.rejects(()=>readPreviewLedger({readRepoVariable:async()=>PROJECT_REFS.preview,fetchAppliedVersions:async()=>[]}),/empty/)
})
test('management API helper sends only the constant SELECT and validates rows',async()=>{
  let request
  const versions=await fetchAppliedVersions(PROJECT_REFS.preview,'token',{fetchImpl:async(_url,options)=>{request=options;return{ok:true,text:async()=>JSON.stringify([{version:'20260828000001'}])}}})
  assert.deepEqual(versions,['20260828000001']);assert.deepEqual(JSON.parse(request.body),{query:APPLIED_VERSIONS_SQL});assert.match(APPLIED_VERSIONS_SQL,/^select /);assert.doesNotMatch(APPLIED_VERSIONS_SQL,/insert|update|delete/i)
})
test('transport, capability and malformed responses are Unknown',async()=>{
  await assert.rejects(()=>fetchAppliedVersions(PROJECT_REFS.preview,'token',{fetchImpl:async()=>{throw new Error('offline')}}),Unknown)
  await assert.rejects(()=>fetchAppliedVersions(PROJECT_REFS.preview,'token',{fetchImpl:async()=>({ok:false,status:403,text:async()=>''})}),Unknown)
  await assert.rejects(()=>fetchAppliedVersions(PROJECT_REFS.preview,'token',{fetchImpl:async()=>({ok:true,text:async()=>'{bad'})}),Unknown)
})
