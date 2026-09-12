import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateAdmission, parseImpactBlock, STRUCTURAL_CHANGE_TYPES, NON_STRUCTURAL_CHANGE_TYPES, assertPrCarriesStructuralChange, inspectPrStructuralChange } from './admission.mjs'
import { advanceOutcome, completeOutcome, outcomeEvent, outcomeHistory, OUTCOME_STATES } from './outcome-lifecycle.mjs'
import { coordinationEvent, formatEventComment, parseEventComment } from '../db-coordination-events.mjs'
import { admitIssue, buildDynamicQueues, claimBody, derivePrOperationRoute, EXCLUSIVE_REFS, main as managerMain, matchesGeneratedTypesProof, matchesLiveProof, MUTEX_REF, parseQueueScope, resolveAdmittedIssueForPr } from '../manage-migration-author-lanes.mjs'
import { findCompletionRecord } from '../lib/work-dependencies.mjs'

const issue = (body, number = 41) => ({ number, state: 'open', title: 'structural outcome', body, createdAt: '2026-09-11T00:00:00Z' })
const ownerComment = (body) => ({body,author_association:'OWNER'})
const serializedIo = (io = {}) => {
  const refs=new Map();let sequence=0
  return {...io,
    makeOwnerCommit:()=>`admission-${++sequence}`,
    readRef:(ref)=>refs.get(ref)??io.readRef?.(ref)??null,
    createRef:(ref,sha)=>{if(refs.has(ref))return false;refs.set(ref,sha);return true},
    deleteRef:(ref)=>{refs.delete(ref)},
  }
}
const scopeBody = ({ service='standard-application', change='migration', stage='entered', object='table core.example', returnTo='u2giants/example-app', live='authenticated create-and-read succeeds', generated='not-applicable', extra='' } = {}) => [
  '```db-work-scope', 'status: ready', 'work_type: structural', 'route: shared-db-orchestrator',
  `service_class: ${service}`, `change_type: ${change}`, `application_return_to: ${returnTo}`,
  `live_assertion: ${live}`, `generated_types: ${generated}`, `outcome_stage: ${stage}`,
  'priority: 5', 'depends_on:', 'writes:', `  - ${object}`, '```', extra,
].join('\n')
const impact = (kind) => ['```db-impact', JSON.stringify({ kind, environment:'production', evidence:'https://github.com/u2giants/example-app/issues/1' }), '```'].join('\n')
const repoScopeBody = ({change='repo-maintenance',objects='',createdAt='2026-09-11T17:00:00Z'}={}) => ({
  number:41,state:'open',createdAt,
  body:['```db-work-scope','status: ready','work_type: repo-maintenance','route: repo-maintenance','service_class: maintenance',...(change===null?[]:[`change_type: ${change}`]),'priority: 5','depends_on:','objects:',objects,'```'].join('\n'),
})

test('every structural actual-change type is independently admissible', () => {
  for (const change of STRUCTURAL_CHANGE_TYPES) {
    const row=issue(scopeBody({change}));const parsed=parseQueueScope(row.body)
    assert.equal(evaluateAdmission(row,parsed,null).admitted,true,change)
  }
})

test('sender structural labels cannot disguise any named non-structural actual change', () => {
  for (const change of NON_STRUCTURAL_CHANGE_TYPES) {
    const row=issue(scopeBody({change}));const parsed=parseQueueScope(row.body)
    assert.throws(()=>evaluateAdmission(row,parsed,null),/does not change database structure/,change)
  }
})

test('all four urgent impacts qualify only with environment, evidence, and application return address', () => {
  for (const kind of ['live-outage','blocked-release','security-exposure','owner-deadline']) {
    const row=issue(scopeBody({service:'urgent-application',extra:impact(kind)}));const parsed=parseQueueScope(row.body)
    assert.equal(evaluateAdmission(row,parsed,parseImpactBlock(row.body)).impact.kind,kind)
  }
  let row=issue(scopeBody({service:'urgent-application'}));assert.throws(()=>evaluateAdmission(row,parseQueueScope(row.body),null),/requires a db-impact/)
  row=issue(scopeBody({returnTo:''}));assert.throws(()=>evaluateAdmission(row,parseQueueScope(row.body),null),/application_return_to/)
  assert.throws(()=>parseQueueScope(scopeBody({object:''}).replace('  - \n','').replace('work_type: structural','work_type: repo-maintenance').replace('route: shared-db-orchestrator','route: repo-maintenance').replace('service_class: standard-application','service_class: urgent-application').replace('application_return_to: u2giants/example-app\n','')),/cannot self-promote/)
})

test('actual pull request files must contain a migration before reviewer or shared-stage admission', () => {
  assert.throws(()=>assertPrCarriesStructuralChange([{filename:'scripts/tool.mjs',status:'modified'}]),/no added or modified migration/)
  assert.deepEqual(assertPrCarriesStructuralChange([{filename:'supabase/migrations/20260911120000_example.sql',status:'added',content:'create table core.example(id bigint);'}]),['supabase/migrations/20260911120000_example.sql'])
  assert.throws(()=>assertPrCarriesStructuralChange([{filename:'supabase/migrations/20260911120000_example.sql',status:'added',content:'insert into core.example values (1);'}]),/actual change is not structural/)
  assert.throws(()=>assertPrCarriesStructuralChange([{filename:'supabase/migrations/20260911120000_example.sql',status:'added',content:'alter widget core.example frobnicate;'}]),/unmodelled DDL/)
  assert.throws(()=>assertPrCarriesStructuralChange([{filename:'supabase/migrations/20260911120000_example.sql',status:'modified',content:'create table core.example(id bigint);',patch:'@@ -2 +2 @@\n-old note\n+new note'}]),/actual change is not structural/)
  assert.deepEqual(assertPrCarriesStructuralChange([{filename:'supabase/migrations/20260911120000_example.sql',status:'modified',content:'create table core.example(id bigint);',patch:'@@ -2 +2 @@\n-old index\n+create index example_id_idx on core.example(id);'}]),['supabase/migrations/20260911120000_example.sql'])
})

test('shared reviewer and merge routing admits deterministic repository maintenance without fabricated DDL',()=>{
  const head='a'.repeat(40),work=repoScopeBody()
  const io={
    getPr:()=>({state:'open',head:{sha:head}}),getPrFiles:()=>[
      {filename:'scripts/tool.mjs',status:'modified'},
      {filename:'scripts/tool.test.mjs',status:'added'},
      {filename:'docs/note.md',status:'modified'},
    ],closingIssuesForPr:()=>[{number:41}],getIssue:()=>work,
  }
  assert.deepEqual(derivePrOperationRoute(7,io,{headSha:head,issue:41}),{route:'repo-maintenance',issue:41,pr:7,headSha:head,changeType:'repo-maintenance',legacy:false})
})

test('shared operation routing fails closed for structural, mixed, and unknown inputs',()=>{
  const head='a'.repeat(40),work=repoScopeBody()
  const base={getPr:()=>({state:'open',head:{sha:head}}),closingIssuesForPr:()=>[{number:41}],getIssue:()=>work}
  assert.equal(derivePrOperationRoute(7,{...base,getPrFiles:()=>[{filename:'supabase/migrations/20260911120000_x.sql',status:'added'}]},{headSha:head,issue:41}).route,'structural')
  assert.equal(derivePrOperationRoute(7,{...base,getPrFiles:()=>[{filename:'scripts/x.mjs',previous_filename:'supabase/migrations/20260911120000_x.sql',status:'renamed'}]},{headSha:head,issue:41}).route,'structural')
  for(const status of ['copied','changed','unchanged','future-status'])assert.equal(derivePrOperationRoute(7,{...base,getPrFiles:()=>[{filename:'scripts/x.mjs',status}]},{headSha:head,issue:41}).route,'structural',status)
  assert.throws(()=>derivePrOperationRoute(7,{...base,getPrFiles:()=>[]},{headSha:head,issue:41}),/empty or unreadable/)
  assert.throws(()=>derivePrOperationRoute(7,{...base,getPrFiles:()=>[{filename:'scripts/x.mjs'}]},{headSha:head,issue:41}),/unreadable entry/)
  assert.throws(()=>derivePrOperationRoute(7,{...base,getPrFiles:()=>[{filename:'scripts/x.mjs',status:'modified'}],closingIssuesForPr:()=>[{number:41},{number:42}]},{headSha:head,issue:41}),/exactly one work issue/)
  assert.throws(()=>derivePrOperationRoute(7,{...base,getPrFiles:()=>[{filename:'scripts/x.mjs',status:'modified'}]},{headSha:'b'.repeat(40),issue:41}),/exact head changed/)
  assert.throws(()=>derivePrOperationRoute(7,{...base,getPrFiles:()=>[{filename:'scripts/x.mjs',status:'modified'}],getIssue:()=>issue(scopeBody())},{headSha:head,issue:41}),/not deterministic ready repository-maintenance/)
  for(const change of ['migration','application-row','source-data','security-settings'])assert.throws(()=>derivePrOperationRoute(7,{...base,getPrFiles:()=>[{filename:'scripts/x.mjs',status:'modified'}],getIssue:()=>repoScopeBody({change})},{headSha:head,issue:41}),/recognized repository-maintenance/,change)
})

test('review routing accepts GitHub GraphQL MERGED only with merged evidence',()=>{
  const head='a'.repeat(40),work=repoScopeBody(),files=[{filename:'scripts/x.mjs',status:'modified'}],linkedIssues=[work]
  assert.equal(derivePrOperationRoute(7,{}, {headSha:head,issue:41,allowMerged:true,snapshot:{pr:{state:'merged',merged_at:'2026-09-11T18:00:00Z',head:{sha:head}},files,linkedIssues}}).route,'repo-maintenance')
  assert.throws(()=>derivePrOperationRoute(7,{}, {headSha:head,issue:41,allowMerged:true,snapshot:{pr:{state:'merged',merged_at:null,head:{sha:head}},files,linkedIssues}}),/not eligible/)
})

test('only bounded pre-cutover repository-maintenance may omit change_type',()=>{
  const head='a'.repeat(40),files=[{filename:'scripts/x.mjs',status:'modified'}]
  const make=(work)=>({getPr:()=>({state:'open',head:{sha:head}}),getPrFiles:()=>files,closingIssuesForPr:()=>[{number:41}],getIssue:()=>work})
  assert.equal(derivePrOperationRoute(7,make(repoScopeBody({change:null})),{headSha:head,issue:41}).legacy,true)
  assert.throws(()=>derivePrOperationRoute(7,make(repoScopeBody({change:null,createdAt:'2026-09-11T18:00:00Z'})),{headSha:head,issue:41}),/must declare/)
})

test('finish-first queue order is service class, nearest-live stage, transitive impact, creation time, then issue', () => {
  const same=(number,service,stage,createdAt='2026-09-11T00:00:00Z')=>({...issue(scopeBody({service,stage,extra:service==='urgent-application'?impact('blocked-release'):''}),number),createdAt})
  const rows=[same(40,'maintenance','entered','2026-08-01T00:00:00Z'),same(30,'standard-application','entered','2026-09-01T00:00:00Z'),same(20,'urgent-application','entered'),same(10,'urgent-application','preview_verified')]
  const result=buildDynamicQueues(rows,[],new Date(),rows.map((row)=>row.number),null,new Map(),new Set(),new Map([[10,'preview_verified'],[20,'entered'],[30,'entered'],[40,'entered']]))
  assert.deepEqual(result.queues.find((q)=>q.queued.includes(10)).queued,[10,20,30,40])
})

test('transitive blocker impact wins, then created time and issue number break ties', () => {
  const body=(object,deps='')=>scopeBody({object}).replace('depends_on:',`depends_on:${deps}`)
  const rows=[
    {...issue(body('table core.same'),11),createdAt:'2026-09-01T00:00:00Z'},
    {...issue(body('table core.same'),10),createdAt:'2026-09-02T00:00:00Z'},
    {...issue(body('table core.same',' 10'),12),createdAt:'2026-09-03T00:00:00Z'},
    {...issue(body('table core.same',' 12'),13),createdAt:'2026-09-04T00:00:00Z'},
  ]
  const result=buildDynamicQueues(rows,[],new Date(),rows.map((row)=>row.number))
  assert.equal(result.dispatchable[0],10)
  const older=buildDynamicQueues(rows.slice(0,2).map((row,index)=>({...row,createdAt:`2026-09-0${index+1}T00:00:00Z`})),[])
  assert.equal(older.dispatchable[0],11)
})

test('unrelated structural authors can dispatch concurrently while object conflicts stay serial', () => {
  const unrelated=[issue(scopeBody({object:'table core.a'}),1),issue(scopeBody({object:'table core.b'}),2)]
  assert.deepEqual(buildDynamicQueues(unrelated,[]).dispatchable.sort((a,b)=>a-b),[1,2])
  const conflicting=[issue(scopeBody({object:'table core.a'}),1),issue(scopeBody({object:'table core.a'}),2)]
  assert.equal(buildDynamicQueues(conflicting,[]).dispatchable.length,1)
})

test('manager requires explicit admission before claim and database-only shared stages', () => {
  const io={enforceAdmission:true}
  const calls=[
    ['--claim','--task','x','--owner','o','--branch','b','--worktree','w','--objects','table core.x'],
    ['--acquire-preview','--owner','o','--pr','1','--head-sha','a'.repeat(40)],
  ]
  const old=console.error;const messages=[];console.error=(m)=>messages.push(String(m))
  try { for (const args of calls) assert.equal(managerMain(args,new Date('2026-09-11T00:00:00Z'),io),2) } finally { console.error=old }
  assert.equal(messages.filter((m)=>m.includes('--admit-issue')).length,2,messages.join(' | '))
})

test('production admission requires the source PR so actual SQL is rechecked',()=>{
  const io={enforceAdmission:true}
  const old=console.error;let message='';console.error=(value)=>{message=String(value)}
  try{assert.equal(managerMain(['--acquire-production','--admit-issue','41','--owner','test'],new Date(),io),2)}finally{console.error=old}
  assert.match(message,/--pr <source pull request>/)
})

test('legacy in-flight structural PRs remain executable but cannot enter as new claims',()=>{
  const legacy=issue(['```db-work-scope','status: ready','work_type: structural','route: shared-db-orchestrator','priority: 5','depends_on:','writes:','  - table core.example','```'].join('\n'))
  const io={getIssue:()=>legacy,closingIssuesForPr:()=>[{number:41,state:'open'}],getPr:()=>({head:{sha:'a'.repeat(40)}}),getPrFiles:()=>[{filename:'supabase/migrations/20260911120000_example.sql',status:'added'}],getFileAt:()=>'create table core.example(id bigint);'}
  assert.equal(admitIssue(41,io,{pr:7,allowLegacy:true}).legacy,true)
  assert.throws(()=>admitIssue(41,io),/change_type/)
})

test('workflow resolver and PR-backed acquire preserve the same bounded legacy admission',()=>{
  const legacy=issue(['```db-work-scope','status: ready','work_type: structural','route: shared-db-orchestrator','priority: 5','depends_on:','writes:','  - table core.example','```'].join('\n'))
  const base={getIssue:()=>legacy,closingIssuesForPr:()=>[{number:41,state:'open'}],getPr:()=>({head:{sha:'a'.repeat(40)}}),getPrFiles:()=>[{filename:'supabase/migrations/20260911120000_example.sql',status:'added'}],getFileAt:()=>'create table core.example(id bigint);'}
  assert.equal(admitIssue(41,base,{pr:7,allowLegacy:true}).legacy,true)
  assert.equal(resolveAdmittedIssueForPr(7,serializedIo(base)).admission,'admitted')
  for(const mutate of [
    io=>io.getIssue=()=>({...legacy,createdAt:'2026-09-11T18:00:00Z'}),
    io=>io.closingIssuesForPr=()=>[{number:41},{number:42}],
    io=>io.getFileAt=()=>'create table core.other(id bigint);',
  ]){const io={...base};mutate(io);assert.throws(()=>resolveAdmittedIssueForPr(7,serializedIo(io)),/legacy admission|exactly one structural|exactly match/)}
})

test('standalone PR-backed admission preserves bounded legacy parity',()=>{
  const body=['```db-work-scope','status: ready','work_type: structural','route: shared-db-orchestrator','priority: 5','depends_on:','writes:','  - table core.example','```'].join('\n')
  const make=(createdAt)=>serializedIo({getIssue:()=>issue(body),closingIssuesForPr:()=>[{number:41,state:'open'}],getPr:()=>({head:{sha:'a'.repeat(40)}}),getPrFiles:()=>[{filename:'supabase/migrations/20260911120000_example.sql',status:'added'}],getFileAt:()=>'create table core.example(id bigint);',...(createdAt?{getIssue:()=>({...issue(body),createdAt})}:{})})
  const oldLog=console.log,oldError=console.error;console.log=()=>{};console.error=()=>{}
  try{assert.equal(managerMain(['--admit-issue','41','--pr','7'],new Date(),make()),0);assert.equal(managerMain(['--admit-issue','41','--pr','7'],new Date(),make('2026-09-11T18:00:00Z')),2)}finally{console.log=oldLog;console.error=oldError}
})

test('an issue created after the legacy cutover cannot skip the admission fields by naming a PR',()=>{
  const body=['```db-work-scope','status: ready','work_type: structural','route: shared-db-orchestrator','priority: 5','depends_on:','writes:','  - table core.example','```'].join('\n')
  const base={closingIssuesForPr:()=>[{number:41,state:'open'}],getPr:()=>({head:{sha:'a'.repeat(40)}}),getPrFiles:()=>[{filename:'supabase/migrations/20260911120000_example.sql',status:'added'}],getFileAt:()=>'create table core.example(id bigint);'}
  for(const stamp of [{created_at:'2026-09-11T18:00:00Z'},{createdAt:'2026-09-12T00:00:00Z'},{}]){
    const row={number:41,state:'open',title:'structural outcome',body,...stamp}
    assert.throws(()=>admitIssue(41,{...base,getIssue:()=>row},{pr:7,allowLegacy:true}),/legacy admission without change_type is limited/,JSON.stringify(stamp))
  }
  const older={number:41,state:'open',title:'structural outcome',body,created_at:'2026-09-10T00:00:00Z'}
  assert.equal(admitIssue(41,{...base,getIssue:()=>older},{pr:7,allowLegacy:true}).legacy,true)
})

test('a truncated modified-migration patch is refused instead of hiding objects past the cutoff',()=>{
  assert.throws(()=>inspectPrStructuralChange([{filename:'supabase/migrations/20260911120000_example.sql',status:'modified',truncated:true,patch:'@@ -2 +2 @@\n-old index\n+create index example_id_idx on core.example(id);'}]),/patch is truncated/)
})

test('preview preparation must name the admitted issue and its source PR',()=>{
  const io={enforceAdmission:true,orchestratorFlowAdapter:()=>{throw new Error('adapter must not be reached')}}
  const old=console.error;const messages=[];console.error=(m)=>messages.push(String(m))
  try{
    assert.equal(managerMain(['--prepare-preview-dispatch','41','--admit-issue','42','--pr','7'],new Date('2026-09-11T00:00:00Z'),io),2)
    assert.equal(managerMain(['--prepare-preview-dispatch','41','--admit-issue','41'],new Date('2026-09-11T00:00:00Z'),io),2)
  }finally{console.error=old}
  assert.match(messages[0],/does not match --prepare-preview-dispatch/)
  assert.match(messages[1],/--pr <source pull request>/)
})

test('a refused actual change publishes one typed refusal with return and reopening evidence', () => {
  const body=scopeBody({change:'application-code'}),comments=[]
  const io=serializedIo({enforceAdmission:true,getIssue:()=>issue(body),issueComments:()=>comments,commentIssue:(_n,value)=>comments.push(ownerComment(value))})
  const old=console.error;console.error=()=>{}
  try { assert.equal(managerMain(['--admit-issue','41'],new Date('2026-09-11T00:00:00Z'),io),2) } finally { console.error=old }
  const event=parseEventComment(comments[0].body)[0]
  assert.equal(event.event_type,'rejected_non_structural');assert.equal(event.result,'refused')
  assert.equal(event.return_to,'u2giants/example-app');assert.ok(event.evidence_required.length)
})

test('a data-only migration PR publishes a typed refusal instead of trusting its filename', () => {
  const comments=[]
  const io=serializedIo({
    enforceAdmission:true,getIssue:()=>issue(scopeBody()),issueComments:()=>comments,commentIssue:(_n,value)=>comments.push(ownerComment(value)),
    closingIssuesForPr:()=>[{number:41,state:'open'}],
    getPr:()=>({head:{sha:'a'.repeat(40)}}),getPrFiles:()=>[{filename:'supabase/migrations/20260911120000_data.sql',status:'added'}],
    getFileAt:()=>'insert into core.example values (1);',
  })
  const old=console.error;console.error=()=>{}
  try { assert.equal(managerMain(['--admit-issue','41','--pr','7'],new Date('2026-09-11T00:00:00Z'),io),2) } finally { console.error=old }
  const event=parseEventComment(comments[0].body)[0]
  assert.equal(event.event_type,'rejected_non_structural');assert.match(event.detail,/actual change is not structural/)
  assert.deepEqual(event.evidence_required,['readable pull request content containing acknowledged statement-leading schema DDL for the proposed structural change'])
})

test('repository-maintenance admission refusal cannot consume a lane or shared stage', () => {
  const body=scopeBody({change:'repository-maintenance'}),calls={claim:0,stage:0}
  const io=serializedIo({enforceAdmission:true,getIssue:()=>issue(body),issueComments:()=>[],commentIssue:()=>{},createIssue:()=>calls.claim++,createRef:()=>calls.stage++})
  const old=console.error;console.error=()=>{}
  try { assert.equal(managerMain(['--admit-issue','41'],new Date('2026-09-11T00:00:00Z'),io),2) } finally { console.error=old }
  assert.deepEqual(calls,{claim:0,stage:0})
})

test('legacy issues remain protected if already claimed but are never offered as new dispatches',()=>{
  const legacy=issue(['```db-work-scope','status: ready','work_type: structural','route: shared-db-orchestrator','priority: 5','depends_on:','writes:','  - table core.example','```'].join('\n'))
  const result=buildDynamicQueues([legacy],[])
  assert.deepEqual(result.dispatchable,[])
  assert.equal(result.skipped.find((row)=>row.issue===41)?.reason,'missing-required-admission-fields')
})

test('an admitted issue cannot authorize a claim for different objects',()=>{
  const comments=[];let claims=0
  const io=serializedIo({enforceAdmission:true,getIssue:()=>issue(scopeBody({object:'table core.authorized'})),issueComments:()=>comments,commentIssue:(_n,body)=>comments.push(ownerComment(body)),createClaim:()=>{claims++}})
  const old=console.error;let message='';console.error=(value)=>{message=String(value)}
  try{
    assert.equal(managerMain(['--claim','--admit-issue','41','--task','x','--owner','o','--branch','b','--worktree','w','--objects','table core.unrelated'],new Date('2026-09-11T00:00:00Z'),io),2)
  }finally{console.error=old}
  assert.match(message,/must exactly match admitted issue/);assert.equal(claims,0)
})

test('source PR resolves exactly one linked open issue and independently admits its files', () => {
  const comments=[]
  const io=serializedIo({
    closingIssuesForPr:()=>[{number:41,state:'open'}],getIssue:()=>issue(scopeBody()),issueComments:()=>comments,commentIssue:(_n,body)=>comments.push(ownerComment(body)),
    getPr:()=>({head:{sha:'a'.repeat(40)}}),getFileAt:()=> 'create table core.example(id bigint);',getPrFiles:()=>[{filename:'supabase/migrations/20260911120000_example.sql',status:'added'}],
  })
  assert.deepEqual(resolveAdmittedIssueForPr(7,io),{issue:41,pr:7,admission:'admitted'})
  io.closingIssuesForPr=()=>[{number:41,state:'open'},{number:42,state:'open'}]
  assert.throws(()=>resolveAdmittedIssueForPr(7,io),/exactly one structural work issue/)
  io.closingIssuesForPr=()=>[{number:41,state:'open'}]
  io.getFileAt=()=>'create table core.example(id bigint); create table core.undeclared(id bigint);'
  assert.throws(()=>admitIssue(41,io,{pr:7}),/structural objects must exactly match/)
  io.getFileAt=()=> 'create table core.example(id bigint);'
  io.closingIssuesForPr=()=>[{number:99,state:'open'}]
  assert.throws(()=>admitIssue(41,io,{pr:7}),/must close exactly admitted issue #41/)
})

test('a merge-closed admitted issue reopens only for a merged linked PR', () => {
  let state='closed'
  const io={
    closingIssuesForPr:()=>[{number:41,state}],getIssue:()=>({...issue(scopeBody()),state}),updateIssue:(_n,fields)=>{state=fields.state},
    getPr:()=>({head:{sha:'a'.repeat(40)},merged_at:null}),getFileAt:()=> 'create table core.example(id bigint);',getPrFiles:()=>[{filename:'supabase/migrations/20260911120000_example.sql',status:'added'}],
  }
  assert.throws(()=>admitIssue(41,io,{pr:7}),/is closed and cannot be admitted/)
  assert.equal(state,'closed')
  io.getPr=()=>({head:{sha:'a'.repeat(40)},merged_at:'2026-09-11T00:00:00Z'})
  assert.equal(admitIssue(41,io,{pr:7}).admitted,true)
  assert.equal(state,'open')
})

test('a completed live outcome is re-admitted without reopening its closed issue', () => {
  let state='closed',updates=0
  const merge='b'.repeat(40)
  const completion={schema_version:1,work_issue:41,outcome:'live_verified',pr:7,merge_sha:merge,application_repository:'u2giants/example-app',application_commit_sha:'c'.repeat(40),live_evidence:'artifact:live-proof'}
  const comments=[{author_association:'OWNER',author:'u2giants',body:`\`\`\`db-work-completion\n${JSON.stringify(completion)}\n\`\`\``}]
  const io={
    closingIssuesForPr:()=>[{number:41,state}],getIssue:()=>({...issue(scopeBody()),state}),updateIssue:(_n,fields)=>{updates++;state=fields.state},
    issueComments:()=>comments,getPr:()=>({head:{sha:'a'.repeat(40)},merged_at:'2026-09-11T00:00:00Z',merge_commit_sha:merge}),
    getFileAt:()=> 'create table core.example(id bigint);',getPrFiles:()=>[{filename:'supabase/migrations/20260911120000_example.sql',status:'added'}],
  }
  assert.equal(admitIssue(41,io,{pr:7}).admitted,true)
  assert.equal(state,'closed');assert.equal(updates,0)
  io.getPr=()=>({head:{sha:'a'.repeat(40)},merged_at:'2026-09-11T00:00:00Z',merge_commit_sha:'d'.repeat(40)})
  assert.throws(()=>admitIssue(41,io,{pr:7}),/completed outcome does not match/)
  assert.equal(state,'closed');assert.equal(updates,0)
})

test('untrusted completion noise cannot block or establish a closed issue completion',()=>{
  const forged={schema_version:1,work_issue:41,outcome:'live_verified',pr:7,merge_sha:'b'.repeat(40),application_repository:'u2giants/example-app',application_commit_sha:'c'.repeat(40),live_evidence:'artifact:forged'}
  for(const bodies of [
    [`\`\`\`db-work-completion\n${JSON.stringify(forged)}\n\`\`\``],
    ['```db-work-completion\nnot-json\n```'],
    ['```db-work-completion\n{}\n```','```db-work-completion\n{}\n```'],
    ['```db-work-completion\n{}\n```\n```db-work-completion\n{}\n```'],
  ]){
    let state='closed',updates=0
    const comments=bodies.map((body)=>({author_association:'NONE',author:'attacker',body}))
    const io={closingIssuesForPr:()=>[{number:41,state}],getIssue:()=>({...issue(scopeBody()),state}),updateIssue:(_n,fields)=>{updates++;state=fields.state},issueComments:()=>comments,getPr:()=>({head:{sha:'a'.repeat(40)},merged_at:'2026-09-11T00:00:00Z'}),getFileAt:()=>'create table core.example(id bigint);',getPrFiles:()=>[{filename:'supabase/migrations/20260911120000_example.sql',status:'added'}]}
    assert.equal(admitIssue(41,io,{pr:7}).admitted,true);assert.equal(state,'open');assert.equal(updates,1)
  }
})

test('trusted malformed duplicate or mismatched completion refuses without reopening',()=>{
  const valid={schema_version:1,work_issue:41,outcome:'live_verified',pr:7,merge_sha:'b'.repeat(40),application_repository:'u2giants/example-app',application_commit_sha:'c'.repeat(40),live_evidence:'artifact:live-proof'}
  for(const bodies of [
    ['```db-work-completion\nnot-json\n```'],
    [`\`\`\`db-work-completion\n${JSON.stringify(valid)}\n\`\`\`\n\`\`\`db-work-completion\n${JSON.stringify(valid)}\n\`\`\``],
    [valid,valid].map((row)=>`\`\`\`db-work-completion\n${JSON.stringify(row)}\n\`\`\``),
    [`\`\`\`db-work-completion\n${JSON.stringify({...valid,pr:99})}\n\`\`\``],
  ]){
    let state='closed',updates=0
    const comments=bodies.map((body)=>({author_association:'OWNER',author:'u2giants',body:typeof body==='string'?body:`\`\`\`db-work-completion\n${JSON.stringify(body)}\n\`\`\``}))
    const io={closingIssuesForPr:()=>[{number:41,state}],getIssue:()=>({...issue(scopeBody()),state}),updateIssue:()=>{updates++},issueComments:()=>comments,getPr:()=>({head:{sha:'a'.repeat(40)},merged_at:'2026-09-11T00:00:00Z',merge_commit_sha:'b'.repeat(40)}),getFileAt:()=>'create table core.example(id bigint);',getPrFiles:()=>[{filename:'supabase/migrations/20260911120000_example.sql',status:'added'}]}
    assert.throws(()=>admitIssue(41,io,{pr:7}));assert.equal(state,'closed');assert.equal(updates,0)
  }
})

test('shared-stage capacity revalidates admission after taking the author mutex',()=>{
  for(const operation of ['preview']){
    let state='open';const refs=new Map(),created=[]
    const io={
      enforceAdmission:true,makeOwnerCommit:()=>`${operation}-owner`,readRef:(ref)=>refs.get(ref)??null,
      createRef:(ref,sha)=>{created.push(ref);if(refs.has(ref))return false;refs.set(ref,sha);if(ref===MUTEX_REF)state='closed';return true},
      deleteRef:(ref)=>refs.delete(ref),getIssue:()=>({...issue(scopeBody()),state}),
      closingIssuesForPr:()=>[{number:41,state}],getPr:()=>({head:{sha:'a'.repeat(40)},merged_at:null}),
    }
    const old=console.error;console.error=()=>{}
    try{
      const args=['--acquire-preview','--admit-issue','41','--owner','test','--pr','7','--head-sha','a'.repeat(40)]
      assert.equal(managerMain(args,new Date(),io),2)
    }finally{console.error=old}
    assert.deepEqual(created,[MUTEX_REF]);assert.equal(refs.has(EXCLUSIVE_REFS.preview),false)
  }
})

test('forged or stale refusal comments cannot suppress current owner refusal proof',()=>{
  const body=scopeBody({change:'application-code'});let result
  try{evaluateAdmission(issue(body),parseQueueScope(body),null)}catch(error){result=error.result}
  const make=(overrides,association)=>({author_association:association,body:formatEventComment(coordinationEvent({
    eventType:'rejected_non_structural',workIssue:41,actor:'manage-migration-author-lanes',timestamp:'2026-09-11T00:00:00Z',result:'refused',detail:result.reason,return_to:result.return_to,evidence_required:result.evidence_required,...overrides,
  }))})
  const comments=[make({},'NONE'),make({return_to:'u2giants/stale-app'},'OWNER'),make({},'OWNER')]
  const io=serializedIo({enforceAdmission:true,getIssue:()=>issue(body),issueComments:()=>comments,commentIssue:(_n,value)=>comments.push(ownerComment(value))})
  const old=console.error;console.error=()=>{}
  try{assert.equal(managerMain(['--admit-issue','41'],new Date(),io),2)}finally{console.error=old}
  assert.equal(comments.length,4)
  const current=parseEventComment(comments[3].body)[0]
  assert.equal(current.return_to,result.return_to);assert.deepEqual(current.evidence_required,result.evidence_required)
})

test('a refused merged PR leaves its closed issue closed',()=>{
  let state='closed',updates=0
  const io={getIssue:()=>({...issue(scopeBody()),state}),updateIssue:(_n,fields)=>{updates++;state=fields.state},closingIssuesForPr:()=>[{number:41,state:'closed'}],getPr:()=>({merged_at:'2026-09-11T00:00:00Z',head:{sha:'a'.repeat(40)}}),getPrFiles:()=>[{filename:'supabase/migrations/20260911120000_example.sql',status:'added'}],getFileAt:()=>'drop table core.example, core.other;'}
  assert.throws(()=>admitIssue(41,io,{pr:7}),/structural objects must exactly match/)
  assert.equal(state,'closed');assert.equal(updates,0)
})

test('multi-target DDL binds every structural object',()=>{
  for(const [ddl,kind,targets,expected] of [['table','table','core.example, core.other',['table core.example','table core.other']],['view','view','core.example, core.other',['view core.example','view core.other']],['materialized view','materialized view','core.example, core.other',['materialized view core.example','materialized view core.other']],['function','function','core.example, core.other',['function core.example','function core.other']],['procedure','procedure','core.example, core.other',['procedure core.example','procedure core.other']],['index','index','core.example, core.other',['index core.example','index core.other']],['type','type','core.example, core.other',['type core.example','type core.other']],['schema','schema','core, other',['schema core','schema other']],['sequence','sequence','core.example, core.other',['sequence core.example','sequence core.other']]]){
    const result=inspectPrStructuralChange([{filename:'supabase/migrations/20260911120000_example.sql',status:'added',content:`drop ${ddl} ${targets};`}])
    assert.deepEqual(result.objects,expected,ddl)
  }
})

test('downloaded proof contents bind live assertion and generated types to exact issue, app head, and instant',()=>{
  const evidence={work_issue:41,application_commit_sha:'a'.repeat(40),live_assertion:'create works',environment:'production',verified_at:'2026-09-11T01:00:00Z',generated_types_output_digest:`sha256:${'b'.repeat(64)}`}
  const live={schema_version:1,work_issue:41,application_commit_sha:'a'.repeat(40),live_assertion:'create works',environment:'production',result:'passed',observed_at:'2026-09-11T01:00:00Z'}
  const types={schema_version:1,work_issue:41,application_commit_sha:'a'.repeat(40),result:'passed',generated_types_sha256:`sha256:${'b'.repeat(64)}`}
  assert.equal(matchesLiveProof(live,evidence),true);assert.equal(matchesGeneratedTypesProof(types,evidence),true)
  assert.equal(matchesLiveProof({...live,live_assertion:'something else'},evidence),false)
  assert.equal(matchesLiveProof({...live,observed_at:'2026-09-11T01:01:00Z'},evidence),false)
  assert.equal(matchesGeneratedTypesProof({...types,application_commit_sha:'c'.repeat(40)},evidence),false)
})

test('full capacity records urgent waiting without revoking active work', () => {
  const claims=Array.from({length:8},(_,index)=>({number:100+index,body:claimBody({version:`20260911${String(index).padStart(6,'0')}`,objects:[`table core.active_${index}`],owner:`owner-${index}`,branch:`branch-${index}`,worktree:`C:/work/${index}`,expiresAt:new Date('2026-09-12T00:00:00Z')})}))
  const urgent=issue(scopeBody({service:'urgent-application',object:'table core.active_0',extra:impact('live-outage')}),41)
  const result=buildDynamicQueues([urgent],claims,new Date('2026-09-11T01:00:00Z'))
  assert.deepEqual(result.dispatchable,[]);assert.deepEqual(result.urgentWaitingCapacity,[41])
  assert.equal(result.queues.filter((row)=>row.active).length,8)
})

const linear=OUTCOME_STATES.filter((state)=>!['blocked','yielded'].includes(state))
const eventComments=(through='production_applied',issue=41)=>linear.slice(0,linear.indexOf(through)+1).map((state,index)=>ownerComment(formatEventComment(outcomeEvent({issue,state,actor:'test',timestamp:new Date(Date.UTC(2026,8,11,0,index)).toISOString()}))))

test('outcome lifecycle refuses every skip and merge is not live completion', () => {
  const skipped=[eventComments('entered')[0],eventComments('review_ready').at(-1)]
  assert.equal(outcomeHistory(skipped).valid,false)
  assert.equal(outcomeHistory(eventComments('merged')).complete,false)
  assert.equal(outcomeHistory(eventComments('live_verified')).complete,true)
})

test('untrusted forged and malformed event comments cannot alter lifecycle history',()=>{
  const trusted=eventComments('classified').map((row)=>({...row,author_association:'OWNER'}))
  const forged={...eventComments('live_verified').at(-1),author_association:'NONE'}
  const malformed={body:'```db-coordination-event\n{bad json}\n```',author_association:'NONE'}
  const missingAssociation={body:eventComments('live_verified').at(-1).body}
  const history=outcomeHistory([...trusted,forged,malformed,missingAssociation],41)
  assert.equal(history.valid,true);assert.equal(history.state,'classified')
})

test('admission and dispatch can share the command clock without invalidating claim history',()=>{
  const comments=[],timestamp='2026-09-11T00:00:00.000Z'
  const io={getIssue:()=>issue(scopeBody()),issueComments:()=>comments,commentIssue:(_n,body)=>comments.push(ownerComment(body))}
  admitIssue(41,io,{timestamp})
  comments.push(ownerComment(formatEventComment(outcomeEvent({issue:41,state:'dispatched',actor:'test',timestamp}))))
  const history=outcomeHistory(comments,41)
  assert.equal(history.valid,true);assert.equal(history.state,'dispatched')
})

test('initial admission events are serialized under the author mutex',()=>{
  const comments=[],refs=new Map(),labels=[]
  const io={
    enforceAdmission:true,getIssue:()=>issue(scopeBody()),issueComments:()=>comments,
    makeOwnerCommit:()=> 'mutex-owner',
    readRef:(ref)=>refs.get(ref)??null,
    createRef:(ref,sha)=>{labels.push(`lock:${ref}`);if(refs.has(ref))return false;refs.set(ref,sha);return true},
    deleteRef:(ref)=>{labels.push(`unlock:${ref}`);refs.delete(ref)},
    commentIssue:(_n,body)=>{assert.equal(refs.size,1,'admission comment must be written only while the mutex is held');labels.push('comment');comments.push(ownerComment(body))},
  }
  const old=console.log;console.log=()=>{}
  try{assert.equal(managerMain(['--admit-issue','41'],new Date('2026-09-11T00:00:00Z'),io),0)}finally{console.log=old}
  assert.deepEqual(labels.map((row)=>row.split(':')[0]),['lock','comment','comment','unlock'])
  assert.equal(outcomeHistory(comments,41).state,'classified')
})

test('claim admission and dispatched event share one author-mutex ownership interval',()=>{
  const comments=[],refs=new Map(),labels=[]
  const io={
    enforceAdmission:true,getIssue:()=>issue(scopeBody()),issueComments:()=>comments,
    makeOwnerCommit:()=> 'claim-owner',readRef:(ref)=>refs.get(ref)??null,
    createRef:(ref,sha)=>{labels.push('lock');if(refs.has(ref))return false;refs.set(ref,sha);return true},
    deleteRef:(ref)=>{labels.push('unlock');refs.delete(ref)},openClaims:()=>[],prSources:()=>[],
    reserveVersion:()=>({version:'20260911133700'}),
    createClaim:()=>{assert.equal(refs.size,1);labels.push('claim');return 'https://github.com/u2giants/shared-db/issues/99'},closeClaim:()=>{},
    commentIssue:(_n,body)=>{assert.equal(refs.size,1);labels.push('event');comments.push(ownerComment(body))},
  }
  const old=console.log;console.log=()=>{}
  try{assert.equal(managerMain(['--claim','--admit-issue','41','--task','x','--owner','o','--branch','b','--worktree','w','--objects','table core.example'],new Date('2026-09-11T00:00:00Z'),io),0)}finally{console.log=old}
  assert.deepEqual(labels,['lock','event','event','claim','event','unlock'])
  assert.equal(outcomeHistory(comments,41).state,'dispatched')
})

test('lost dispatched-comment response tolerates delayed exact-event visibility and preserves the claim',()=>{
  const comments=[],refs=new Map();let closed=0,hiddenReads=0,waits=0
  const io={
    enforceAdmission:true,getIssue:()=>issue(scopeBody()),issueComments:()=>hiddenReads-->0?comments.filter((comment)=>parseEventComment(comment.body)[0]?.event_type!=='dispatched'):comments,
    makeOwnerCommit:()=> 'claim-owner',readRef:(ref)=>refs.get(ref)??null,
    createRef:(ref,sha)=>{if(refs.has(ref))return false;refs.set(ref,sha);return true},deleteRef:(ref)=>refs.delete(ref),
    openClaims:()=>[],prSources:()=>[],reserveVersion:()=>({version:'20260911133800'}),
    createClaim:()=> 'https://github.com/u2giants/shared-db/issues/99',closeClaim:()=>{closed++},wait:()=>{waits++},
    commentIssue:(_n,body)=>{comments.push(ownerComment(body));if(parseEventComment(body)[0]?.event_type==='dispatched'){hiddenReads=2;throw new Error('response lost')}},
  }
  const old=console.log;console.log=()=>{}
  try{assert.equal(managerMain(['--claim','--admit-issue','41','--task','x','--owner','o','--branch','b','--worktree','w','--objects','table core.example'],new Date('2026-09-11T00:00:00Z'),io),0)}finally{console.log=old}
  assert.equal(closed,0);assert.equal(waits,2);assert.equal(outcomeHistory(comments,41).state,'dispatched')
})

test('exhausted dispatch visibility remains ambiguous and never closes the claim',()=>{
  const comments=[],refs=new Map();let closed=0,hiddenReads=100,message=''
  const io={
    enforceAdmission:true,getIssue:()=>issue(scopeBody()),issueComments:()=>hiddenReads>0?comments.filter((comment)=>parseEventComment(comment.body)[0]?.event_type!=='dispatched'):comments,
    makeOwnerCommit:()=> 'claim-owner',readRef:(ref)=>refs.get(ref)??null,
    createRef:(ref,sha)=>{if(refs.has(ref))return false;refs.set(ref,sha);return true},deleteRef:(ref)=>refs.delete(ref),
    openClaims:()=>[],prSources:()=>[],reserveVersion:()=>({version:'20260911133801'}),wait:()=>{},
    createClaim:()=> 'https://github.com/u2giants/shared-db/issues/99',closeClaim:()=>{closed++},
    commentIssue:(_n,body)=>{comments.push(ownerComment(body));if(parseEventComment(body)[0]?.event_type==='dispatched')throw new Error('response lost')},
  }
  const old=console.error;console.error=(value)=>{message=String(value)}
  try{assert.equal(managerMain(['--claim','--admit-issue','41','--task','x','--owner','o','--branch','b','--worktree','w','--objects','table core.example'],new Date('2026-09-11T00:00:00Z'),io),2)}finally{console.error=old}
  assert.match(message,/readback remained ambiguous.*remains protected/);assert.equal(closed,0)
  hiddenReads=0;assert.equal(outcomeHistory(comments,41).state,'dispatched')
})

test('lost mutex ownership never closes the newly created claim',()=>{
  const comments=[],refs=new Map();let closed=0,message=''
  const io={
    enforceAdmission:true,getIssue:()=>issue(scopeBody()),issueComments:()=>comments,
    makeOwnerCommit:()=> 'claim-owner',readRef:(ref)=>refs.get(ref)??null,
    createRef:(ref,sha)=>{if(refs.has(ref))return false;refs.set(ref,sha);return true},deleteRef:(ref)=>refs.delete(ref),
    openClaims:()=>[],prSources:()=>[],reserveVersion:()=>({version:'20260911133900'}),
    createClaim:()=> 'https://github.com/u2giants/shared-db/issues/99',closeClaim:()=>{closed++},
    commentIssue:(_n,body)=>{comments.push(ownerComment(body));if(parseEventComment(body)[0]?.event_type==='dispatched'){for(const ref of refs.keys())refs.set(ref,'successor-owner');throw new Error('response lost after ownership changed')}},
  }
  const old=console.error;console.error=(value)=>{message=String(value)}
  try{assert.equal(managerMain(['--claim','--admit-issue','41','--task','x','--owner','o','--branch','b','--worktree','w','--objects','table core.example'],new Date('2026-09-11T00:00:00Z'),io),2)}finally{console.error=old}
  assert.match(message,/claim .* remains protected for explicit recovery/);assert.equal(closed,0);assert.deepEqual([...refs.values()],['successor-owner'])
})

test('advance validation and lifecycle mutation share one author-mutex interval',()=>{
  const comments=eventComments('classified',41),refs=new Map();let writes=0
  const io={
    enforceAdmission:true,getIssue:()=>issue(scopeBody()),issueComments:()=>comments,
    makeOwnerCommit:()=> 'advance-owner',readRef:(ref)=>refs.get(ref)??null,
    createRef:(ref,sha)=>{if(refs.has(ref))return false;refs.set(ref,sha);return true},deleteRef:(ref)=>refs.delete(ref),
    commentIssue:(_n,body)=>{assert.equal(refs.size,1);writes++;comments.push(ownerComment(body))},
  }
  const old=console.log;console.log=()=>{}
  try{assert.equal(managerMain(['--advance-outcome','dispatched','--admit-issue','41','--issue','41','--owner','o','--evidence','https://github.com/u2giants/shared-db/issues/99'],new Date('2026-09-11T00:03:00Z'),io),0)}finally{console.log=old}
  assert.equal(writes,1);assert.equal(outcomeHistory(comments,41).state,'dispatched');assert.equal(refs.size,0)
})

test('outcome status ignores trusted lifecycle events for a different issue',()=>{
  const comments=[...eventComments('classified',41),...eventComments('live_verified',42)]
  let printed='';const old=console.log;console.log=(value)=>{printed=String(value)}
  try{assert.equal(managerMain(['--outcome-status','41'],new Date(),{issueComments:()=>comments}),0)}finally{console.log=old}
  assert.equal(JSON.parse(printed).state,'classified')
})

test('completion refuses lifecycle events belonging to another issue',()=>{
  const {io}=completionFixture()
  io.issueComments=()=>eventComments('production_applied',42)
  assert.throws(()=>completeOutcome({issue:41,evidenceRef:'x',actor:'test'},io),/not production_applied/)
})

test('blocked outcomes must yield before advancing and malformed block events invalidate history',()=>{
  const comments=eventComments('classified')
  comments.push(ownerComment(formatEventComment(outcomeEvent({issue:41,state:'blocked',actor:'test',timestamp:'2026-09-11T00:03:00Z'}))))
  assert.throws(()=>advanceOutcome({issue:41,state:'dispatched',actor:'test',timestamp:'2026-09-11T00:04:00Z'}, {issueComments:()=>comments,commentIssue:()=>{}}),/record yielded/)
  comments.push(ownerComment(formatEventComment(outcomeEvent({issue:41,state:'yielded',actor:'test',timestamp:'2026-09-11T00:04:00Z'}))))
  assert.equal(outcomeHistory(comments).valid,true)
  const stray=[...eventComments('classified'),ownerComment(formatEventComment(outcomeEvent({issue:41,state:'yielded',actor:'test',timestamp:'2026-09-11T00:03:00Z'})))]
  assert.deepEqual(outcomeHistory(stray).problems,['yielded without an active blocked state'])
})

test('every linear outcome transition records exactly once and every skip refuses',()=>{
  const comments=[],io={issueComments:()=>comments,commentIssue:(_n,body)=>comments.push(ownerComment(body))}
  linear.forEach((state,index)=>{
    assert.equal(advanceOutcome({issue:41,state,actor:'test',timestamp:new Date(Date.UTC(2026,8,11,0,index)).toISOString(),evidenceUrls:['https://github.com/u2giants/shared-db/issues/41']},io).state,state)
  })
  assert.equal(outcomeHistory(comments).complete,true)
  assert.throws(()=>advanceOutcome({issue:42,state:'review_ready',actor:'test'}, {issueComments:()=>[],commentIssue:()=>{}}),/next state is entered/)
})

function completionFixture({through='production_applied',generated='not-applicable'}={}) {
  const comments=eventComments(through), merge='a'.repeat(40), app='b'.repeat(40)
  let issueState='open'
  const evidence={schema_version:1,work_issue:41,merge_pr:7,merge_sha:merge,production_evidence:'https://github.com/u2giants/shared-db/actions/runs/97',production_commit_sha:merge,production_artifact_id:121,production_artifact_digest:`sha256:${'f'.repeat(64)}`,application_repository:'u2giants/example-app',application_commit_sha:app,live_assertion:'authenticated create-and-read succeeds',live_evidence:'https://github.com/u2giants/example-app/actions/runs/99',live_artifact_id:123,live_artifact_digest:`sha256:${'c'.repeat(64)}`,environment:'production',verified_at:'2026-09-11T01:00:00Z',...(generated==='required'?{generated_types_evidence:'https://github.com/u2giants/example-app/actions/runs/98',generated_types_artifact_id:122,generated_types_artifact_digest:`sha256:${'d'.repeat(64)}`,generated_types_output_digest:`sha256:${'e'.repeat(64)}`}:{})}
  const io={
    getIssue:()=>({...issue(scopeBody({generated})),state:issueState}),updateIssue:(_n,fields)=>{issueState=fields.state},parseScope:parseQueueScope,issueComments:()=>comments,
    readOutcomeEvidence:()=>['```db-outcome-evidence',JSON.stringify(evidence),'```'].join('\n'),
    closingIssuesForPr:()=>[{number:41,state:'closed'}],prStructuralObjects:()=>['table core.example'],
    getPr:()=>({merged_at:'2026-09-11T00:00:00Z',merge_commit_sha:merge}),mergeCommitInMain:()=>true,
    applicationCommitInDefaultBranch:()=>true,verifyProductionApply:()=>true,verifyLiveAssertion:()=>true,verifyGeneratedTypes:()=>true,
    commentIssue:(_n,body)=>comments.push(ownerComment(body)),
  }
  return {io,comments}
}

test('completion re-derives merge, application, generated types, and live assertion before one authoritative completion', () => {
  const {io,comments}=completionFixture({generated:'required'})
  const result=completeOutcome({issue:41,evidenceRef:'https://github.com/u2giants/shared-db/issues/41#issuecomment-9',actor:'test',timestamp:'2026-09-11T02:00:00Z'},io)
  assert.equal(result.completed,true)
  assert.equal(outcomeHistory(comments).state,'live_verified')
  assert.equal(findCompletionRecord(comments).outcome,'live_verified')
})

test('completion resumes after the live event when a later write lost its response',()=>{
  const {io,comments}=completionFixture()
  const normal=io.commentIssue;let failed=false
  io.commentIssue=(number,body)=>{
    if(body.includes('Authoritative outcome completion')&&!failed){failed=true;throw new Error('response lost')}
    normal(number,body)
  }
  assert.throws(()=>completeOutcome({issue:41,evidenceRef:'https://github.com/u2giants/shared-db/issues/41#issuecomment-9',actor:'test',timestamp:'2026-09-11T02:00:00Z'},io),/response lost/)
  assert.equal(outcomeHistory(comments).state,'live_verified')
  assert.equal(completeOutcome({issue:41,evidenceRef:'https://github.com/u2giants/shared-db/issues/41#issuecomment-9',actor:'test',timestamp:'2026-09-11T02:01:00Z'},io).completed,true)
  assert.equal(comments.filter((row)=>row.body.includes('Authoritative outcome completion')).length,1)
})

test('completion retries safely after completion-comment or close response loss',()=>{
  for(const boundary of ['completion-comment','close']){
    const {io,comments}=completionFixture();const normalComment=io.commentIssue,normalUpdate=io.updateIssue;let failed=false
    if(boundary==='completion-comment')io.commentIssue=(number,body)=>{normalComment(number,body);if(body.includes('Authoritative outcome completion')&&!failed){failed=true;throw new Error('completion response lost')}}
    else io.updateIssue=(number,fields)=>{normalUpdate(number,fields);if(!failed){failed=true;throw new Error('close response lost')}}
    assert.throws(()=>completeOutcome({issue:41,evidenceRef:'https://github.com/u2giants/shared-db/issues/41#issuecomment-9',actor:'test'},io),/response lost/)
    assert.equal(completeOutcome({issue:41,evidenceRef:'https://github.com/u2giants/shared-db/issues/41#issuecomment-9',actor:'test'},io).completed,true,boundary)
    assert.equal(comments.filter((row)=>row.body.includes('Authoritative outcome completion')).length,1,boundary)
  }
})

test('manual lifecycle advancement refuses missing or non-durable evidence',()=>{
  const comments=eventComments('dispatched'),io={issueComments:()=>comments,commentIssue:(_n,body)=>comments.push(ownerComment(body))}
  for(const evidenceUrls of [[],['x'],['http://github.com/u2giants/shared-db/issues/41'],['https://github.com/'],['artifact:'],[null]])assert.throws(()=>advanceOutcome({issue:41,state:'implementation_complete',actor:'test',evidenceUrls},io),/durable GitHub or artifact evidence/)
  assert.equal(comments.length,3)
})

test('admission never silently replaces another requested primary operation',()=>{
  let touched=false;const io={enforceAdmission:true,getIssue:()=>{touched=true;throw new Error('must not run')}}
  const old=console.error;console.error=()=>{}
  try{assert.equal(managerMain(['--admit-issue','41','--complete-work','7'],new Date(),io),2)}finally{console.error=old}
  assert.equal(touched,false)
})

test('zero-valued primary operations cannot disappear from command cardinality',()=>{
  const old=console.error;console.error=()=>{}
  try{
    assert.equal(managerMain(['--prepare-preview-dispatch','0'],new Date(),{}),2)
    assert.equal(managerMain(['--prepare-preview-dispatch','0','--assign-reviewer'],new Date(),{}),2)
    assert.equal(managerMain(['--admit-issue','0'],new Date(),{}),2)
    assert.equal(managerMain(['--admit-issue','0','--complete-work','--issue','7','--report-file','x'],new Date(),{}),2)
  }finally{console.error=old}
})

test('two concurrent completion commands serialize to one authoritative completion',()=>{
  const fixture=completionFixture();let owner=null,sequence=0,second=null,attempted=false
  const io={...fixture.io,
    makeOwnerCommit:()=>`completion-owner-${++sequence}`,
    readRef:()=>owner,
    createRef:(_ref,sha)=>{if(owner)throw new Error('concurrent completion refused');owner=sha;return true},
    deleteRef:()=>{owner=null},
  }
  const args=['--complete-outcome','41','--owner','test','--evidence','https://github.com/u2giants/shared-db/issues/41#issuecomment-9']
  const normal=io.commentIssue
  io.commentIssue=(number,body)=>{
    if(!attempted&&parseEventComment(body)[0]?.event_type==='live_verified'){
      attempted=true
      const oldError=console.error;console.error=()=>{}
      try{second=managerMain(args,new Date('2026-09-11T02:00:01Z'),io)}finally{console.error=oldError}
    }
    normal(number,body)
  }
  const oldLog=console.log;console.log=()=>{}
  try{assert.equal(managerMain(args,new Date('2026-09-11T02:00:00Z'),io),0)}finally{console.log=oldLog}
  assert.equal(second,2);assert.equal(outcomeHistory(fixture.comments,41).state,'live_verified')
  assert.equal(fixture.comments.filter((row)=>row.body.includes('Authoritative outcome completion')).length,1)
})

test('existing incompatible completion refuses before publishing live_verified',()=>{
  const {io,comments}=completionFixture()
  comments.push(ownerComment(['```db-work-completion',JSON.stringify({schema_version:1,work_issue:41,outcome:'merged',pr:7,merge_sha:'a'.repeat(40),migration_versions:[]}), '```'].join('\n')))
  const before=comments.length
  assert.throws(()=>completeOutcome({issue:41,evidenceRef:'x',actor:'test'},io),/existing immutable completion record disagrees/)
  assert.equal(comments.length,before);assert.equal(outcomeHistory(comments,41).state,'production_applied')
})

test('completion refuses preview-only, merge-only, missing generated types, missing return address, and mismatched live assertion', () => {
  for(const through of ['preview_verified','merged']){const {io}=completionFixture({through});assert.throws(()=>completeOutcome({issue:41,evidenceRef:'x',actor:'test'},io),/not production_applied/)}
  {const {io}=completionFixture({generated:'required'});const base=io.readOutcomeEvidence;io.readOutcomeEvidence=()=>base().replace(/,"generated_types_evidence":"[^"]+"/,'');assert.throws(()=>completeOutcome({issue:41,evidenceRef:'x',actor:'test'},io),/generated types/)}
  {const {io}=completionFixture();io.getIssue=()=>issue(scopeBody({returnTo:''}));assert.throws(()=>completeOutcome({issue:41,evidenceRef:'x',actor:'test'},io),/application_return_to|return address/)}
  {const {io}=completionFixture();const base=io.readOutcomeEvidence;io.readOutcomeEvidence=()=>base().replace('authenticated create-and-read succeeds','different assertion');assert.throws(()=>completeOutcome({issue:41,evidenceRef:'x',actor:'test'},io),/live_assertion/)}
  {const {io}=completionFixture();io.closingIssuesForPr=()=>[{number:41},{number:42}];assert.throws(()=>completeOutcome({issue:41,evidenceRef:'x',actor:'test'},io),/not linked exclusively/)}
  {const {io}=completionFixture();io.prStructuralObjects=()=>['table core.other'];assert.throws(()=>completeOutcome({issue:41,evidenceRef:'x',actor:'test'},io),/structural objects do not match/)}
  {const {io}=completionFixture();io.verifyProductionApply=()=>false;assert.throws(()=>completeOutcome({issue:41,evidenceRef:'x',actor:'test'},io),/production application/)}
})
