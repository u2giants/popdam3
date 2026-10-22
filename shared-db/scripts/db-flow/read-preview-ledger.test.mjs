import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { APPLIED_VERSIONS_SQL, fetchAppliedVersions, PROJECT_REFS, readPreviewLedger, readRepoVariable, Unknown } from './read-preview-ledger.mjs'

test('abandonment audit receives the same repository variable through workflow context',async()=>{
  const forbidden=()=>{throw new Error('workflow token cannot read repository variables')}
  const value=readRepoVariable('PREVIEW_PROJECT_REF',{run:forbidden,workflowPreviewRef:` ${PROJECT_REFS.preview} `})
  assert.equal(value,PROJECT_REFS.preview)
  await assert.rejects(()=>readPreviewLedger({readRepoVariable:async()=>readRepoVariable('PREVIEW_PROJECT_REF',{run:forbidden,workflowPreviewRef:''}),fetchAppliedVersions:async()=>['20260828000001']}),/exactly 20 lowercase letters/)
  assert.throws(()=>readRepoVariable('PREVIEW_PROJECT_REF',{run:forbidden}),/workflow token cannot read/)
  assert.throws(()=>readRepoVariable('OTHER_VARIABLE',{run:forbidden,workflowPreviewRef:PROJECT_REFS.preview}),/workflow token cannot read/)
})

test('abandonment audit credential is unreachable on branch dispatch',()=>{
  const workflow=readFileSync(new URL('../../.github/workflows/author-lane-abandonment-audit.yml',import.meta.url),'utf8')
  const gate=workflow.split('  require-main:\n')[1]?.split('  audit:\n')[0]
  const audit=workflow.split('  audit:\n')[1]
  assert.match(gate??'',/AUDIT_REF: \$\{\{ github\.ref \}\}/)
  assert.match(gate??'',/\[ "\$AUDIT_REF" != 'refs\/heads\/main' \]/)
  assert.match(gate??'',/exit 1/)
  assert.doesNotMatch(gate??'',/SUPABASE_ACCESS_TOKEN/)
  assert.match(audit??'',/needs: require-main\n    if: github\.ref == 'refs\/heads\/main'/)
  assert.match(audit??'',/environment: preview/)
  assert.equal((workflow.match(/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/g)??[]).length,1)
  assert.match(audit??'',/name: Report expired author lanes[\s\S]*?env:[\s\S]*?SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/)
})

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
