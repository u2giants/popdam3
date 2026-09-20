import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectPrStructuralChange, structuralWritesMatch } from './admission.mjs'
import { completeOutcome, OUTCOME_STATES, outcomeEvent } from './outcome-lifecycle.mjs'
import { formatEventComment } from '../db-coordination-events.mjs'
import { expectedOperatorAssociation } from '../lib/repository-identity.mjs'

const inspect=(...sql)=>inspectPrStructuralChange(sql.map((content,index)=>({filename:`supabase/migrations/2026092017000${index}_test.sql`,status:'added',content})))
const view='create view api.a as select 1 as id;'
const grant='grant select on api.a to authenticated;'
const held=['table api.a','view api.a']

test('same-migration view and grant resolves only the redundant table alias without mutation',()=>{
  const actual=inspect(view+grant), before=structuredClone(actual), declared=[...held]
  assert.equal(structuralWritesMatch(actual,declared),true)
  assert.deepEqual(actual,before)
  assert.deepEqual(declared,held)
  assert.equal(structuralWritesMatch(actual,['view api.a']),true)
  assert.equal(structuralWritesMatch(actual,['table api.a']),false)
})
test('different names, real extra writes, duplicate entries and missing actual writes refuse',()=>{
  const actual=inspect(view+grant)
  for(const declared of [['view api.a','table api.b'],[...held,'function api.f'],[...held,'view api.a'],[...held,'table api.a'],[]])
    assert.equal(structuralWritesMatch(actual,declared),false)
})
test('CREATE without grant and split-migration proof cannot erase aliases',()=>{
  assert.equal(structuralWritesMatch(inspect(view),held),false)
  const split=inspect(view,grant)
  assert.equal(structuralWritesMatch(split,['view api.a']),false)
})
test('inverted table creation never erases a view key',()=>{
  const actual=inspect('create table api.a(id integer);'+grant)
  assert.equal(structuralWritesMatch(actual,held),false)
})
test('real table operations anywhere in the PR retain all objects',()=>{
  const actual=inspect(view+grant,'alter table api.a add column other integer;')
  assert.equal(structuralWritesMatch(actual,['view api.a']),false)
  assert.equal(structuralWritesMatch(actual,held),true)
})
test('comments, strings and function bodies cannot supply CREATE proof',()=>{
  for(const fake of ['-- '+view+'\n',`select '${view}';`,`create function api.f() returns void language plpgsql as $$ begin ${view} end $$;`]){
    const actual=inspect(fake+grant)
    assert.equal(structuralWritesMatch(actual,['view api.a']),false)
  }
})
test('modified migration must prove create and grant in its added lines',()=>{
  const actual=inspectPrStructuralChange([{filename:'supabase/migrations/20260920170000_test.sql',status:'modified',content:view+grant,patch:' '+view+'\n+'+grant}])
  assert.equal(structuralWritesMatch(actual,['view api.a']),false)
})
test('missing contents and truncated patches remain refused',()=>{
  assert.throws(()=>inspectPrStructuralChange([{filename:'supabase/migrations/20260920170000_test.sql',status:'added'}]),/unreadable/)
  assert.throws(()=>inspectPrStructuralChange([{filename:'supabase/migrations/20260920170000_test.sql',status:'modified',truncated:true,patch:'+'+view+grant}]),/truncated/)
})
test('opaque or copied alias claims cannot substitute for inspector proof',()=>{
  const actual=inspect(view+grant)
  assert.equal(structuralWritesMatch({...actual,legacyTableAliases:['table api.a']},held),false)
  assert.equal(structuralWritesMatch(structuredClone(actual),held),false)
})
test('outcome gate uses inspector proof, retains exact legacy fallback, and refuses extra writes',()=>{
  const sha='a'.repeat(40), digest=`sha256:${'b'.repeat(64)}`
  const evidence={schema_version:1,work_issue:41,merge_pr:7,merge_sha:sha,production_evidence:'https://github.com/popcre/shared-db/actions/runs/97',production_commit_sha:sha,production_artifact_id:121,production_artifact_digest:digest,application_repository:'popcre/shared-db',application_commit_sha:sha,live_assertion:'view access verified',live_evidence:'https://github.com/popcre/shared-db/actions/runs/99',live_artifact_id:123,live_artifact_digest:digest,environment:'production',verified_at:'2026-09-11T01:00:00Z'}
  const comments=OUTCOME_STATES.slice(0,9).map((state,index)=>({author_association:expectedOperatorAssociation(),author:'u2giants',body:formatEventComment(outcomeEvent({issue:41,state,actor:'test',timestamp:new Date(Date.UTC(2026,8,11,0,index)).toISOString()}))}))
  const io={getIssue:()=>({state:'open'}),parseScope:()=>({workType:'structural',route:'shared-db-orchestrator',applicationReturnTo:'popcre/shared-db',liveAssertion:'view access verified',generatedTypes:'not-applicable',writes:held}),issueComments:()=>comments,readOutcomeEvidence:()=>['```db-outcome-evidence',JSON.stringify(evidence),'```'].join('\n'),closingIssuesForPr:()=>[{number:41}],prStructuralObjects:()=>['view api.a'],getPr:()=>{throw new Error('passed object gate')}}
  const run=(adapter)=>completeOutcome({issue:41,evidenceRef:'x',actor:'test'},adapter)
  assert.throws(()=>run(io),/structural objects do not match/)
  assert.throws(()=>run({...io,prStructuralInspection:()=>inspect(view+grant)}),/passed object gate/)
  assert.throws(()=>run({...io,prStructuralInspection:()=>({...inspect(view+grant),legacyTableAliases:['table api.a']})}),/structural objects do not match/)
  assert.throws(()=>run({...io,prStructuralInspection:()=>inspect(view+grant+' create table api.other(id int);')}),/structural objects do not match/)
})
