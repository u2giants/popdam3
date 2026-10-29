import { ghJson } from './lib/github-transport.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { holdMergeQueue, requiredCheckProgress, readQueuePullRequest, readReportedRequiredChecks, HOLD_SECONDS, POLL_SECONDS } from './merge-queue-hold.mjs'
import { SELF_CONTEXT, GITHUB_ACTIONS_APP_ID as APP } from './check-required-checks-preflight.mjs'
const group='a'.repeat(40), head='b'.repeat(40)
const env={PR_NUMBER:'123',PR_HEAD_SHA:head,MERGE_GROUP_SHA:group,MERGE_GROUP_REF:'refs/heads/gh-readonly-queue/main/pr-123-test'}
const pr=(extra={})=>({number:123,state:'OPEN',baseRefName:'main',headRefOid:head,mergeQueueEntry:{id:'queue-id'},...extra})
const run=(name='required',extra={})=>({__typename:'CheckRun',name,databaseId:1,checkSuite:{app:{databaseId:APP}},status:'COMPLETED',conclusion:'SUCCESS',isRequired:true,startedAt:'2026-10-29T00:00:00Z',completedAt:'2026-10-29T00:00:01Z',...extra})
const status=(extra={})=>({__typename:'StatusContext',id:'status-id',context:'required',state:'SUCCESS',isRequired:true,createdAt:'2026-10-29T00:00:00Z',...extra})
const input=(contexts=[run()],extra={})=>({sha:group,contexts,...extra})
function harness(extra={}) {
  let time=0
  const deps={repo:'popcre/shared-db',pullRequest:()=>pr(),groupHead:()=>group,gather:()=>input(),now:()=>time,wait:async ms=>{time+=ms},log:()=>{},...extra}
  return {deps,time:()=>time}
}
test('healthy empty or pending reported checks consume full15minute hold, never fail early',async()=>{
  for (const contexts of [[],[run('required',{status:'IN_PROGRESS',conclusion:null})]]) {
    const h=harness({gather:()=>input(contexts)})
    await assert.rejects(holdMergeQueue(env,h.deps),/900-second/)
    assert.equal(h.time(),HOLD_SECONDS*1000);assert.equal(POLL_SECONDS,15)
  }
})
test('actual merge succeeds; explicitly required red aborts before sleep',async()=>{
  assert.equal((await holdMergeQueue(env,harness({pullRequest:()=>pr({state:'MERGED',mergeQueueEntry:null})}).deps)).merged,true)
  for (const contexts of [[run('required',{conclusion:'FAILURE'})],[status({state:'FAILURE'})]]) {
    const h=harness({gather:()=>input(contexts)})
    await assert.rejects(holdMergeQueue(env,h.deps),/required merge-group check failed/);assert.equal(h.time(),0)
  }
})
test('optionalEntire and selfobservations never veto actual healthy merge',async()=>{
  let calls=0
  const h=harness({pullRequest:()=>pr(++calls>2?{state:'MERGED',mergeQueueEntry:null}:{}),gather:()=>input([run(),run('Entire AI review',{databaseId:2,conclusion:'FAILURE',isRequired:false}),run(SELF_CONTEXT,{databaseId:3,conclusion:'FAILURE'}),run('Queue interlock',{databaseId:4,conclusion:'FAILURE'}),status({context:SELF_CONTEXT,state:'FAILURE'})])})
  assert.equal((await holdMergeQueue(env,h.deps)).merged,true);assert.equal(h.time(),15000)
})
test('ejection,closedPR,replacedPRhead or groupSHA abort immediately',async()=>{
  for (const current of [pr({mergeQueueEntry:null}),pr({state:'CLOSED'}),pr({headRefOid:'c'.repeat(40)}),null]) {
    const h=harness({pullRequest:()=>current});await assert.rejects(holdMergeQueue(env,h.deps));assert.equal(h.time(),0)
  }
  const h=harness({groupHead:()=>'d'.repeat(40)})
  await assert.rejects(holdMergeQueue(env,h.deps),/merge group/);assert.equal(h.time(),0)
})
test('ejection during checkreads is observed before nextsleep',async()=>{
  let reads=0
  const h=harness({pullRequest:()=>pr(++reads===1?{}:{mergeQueueEntry:null})})
  await assert.rejects(holdMergeQueue(env,h.deps),/left the merge queue/);assert.equal(h.time(),0)
})
test('requiredflags freshly read eachpoll; newrequiredred aborts on nextpoll',async()=>{
  let reads=0
  const h=harness({gather:()=>++reads===1?input():input([run('new required',{conclusion:'FAILURE'})])})
  await assert.rejects(holdMergeQueue(env,h.deps),/new required/);assert.equal(reads,2);assert.equal(h.time(),15000)
})
test('unreadable flags,unknown types,missingapp,wrongSHA and readerrors refuse',async()=>{
  for (const gather of [()=>{throw Error('403 read denied')},()=>input([run('required',{isRequired:null})]),()=>input([run('required',{isRequired:'true'})]),()=>input([run('required',{checkSuite:{app:null}})]),()=>input([{__typename:'Unknown',isRequired:false}]),()=>input([],{sha:head})]) {
    const h=harness({gather});await assert.rejects(holdMergeQueue(env,h.deps));assert.equal(h.time(),0)
  }
})
test('optionalfalse otherproducer cannot masktrue requiredfailure; latestsameproducer rerun succeeds',()=>{
  assert.throws(()=>requiredCheckProgress(input([run('required',{conclusion:'FAILURE'}),run('required',{databaseId:2,isRequired:false,checkSuite:{app:{databaseId:7}}})]),group),/failed/)
  assert.deepEqual(requiredCheckProgress(input([run('required',{conclusion:'FAILURE'}),run('required',{databaseId:2})]),group),{missing:[],pending:[]})
  assert.throws(()=>requiredCheckProgress(input([run(),run('required',{databaseId:2,conclusion:'FAILURE'})]),group),/failed/)
  assert.throws(()=>requiredCheckProgress(input([run(),status({state:'FAILURE'})]),group),/failed/)
  for(const conclusion of ['CANCELLED','TIMED_OUT','NEUTRAL','SKIPPED']) assert.throws(()=>requiredCheckProgress(input([run('required',{conclusion})]),group),/failed/)
})
const page=(nodes,hasNextPage=false,endCursor=null,oid=group)=>({data:{repository:{object:{oid,statusCheckRollup:{contexts:{nodes,pageInfo:{hasNextPage,endCursor}}}}}}})
test('readonly GraphQL adapter binds exactcommit,requiredPRflags and completepagination',()=>{
  const calls=[]
  const snapshot=readReportedRequiredChecks('popcre/shared-db',123,group,args=>{calls.push(args);return calls.length===1?page([run()],true,'cursor1'):page([status()],false,'cursor2')})
  assert.equal(snapshot.sha,group);assert.equal(snapshot.contexts.length,2)
  assert.match(calls[0].join(' '),/object\(oid:\$sha\)/);assert.match(calls[0].join(' '),/isRequired\(pullRequestNumber:\$number\)/)
  assert.ok(calls.every(args=>args.includes(`sha=${group}`)));assert.ok(calls[1].includes('after=cursor1'))
  assert.match(calls[0].find(arg=>arg.startsWith('query=')), /\$after:String\)/)
  assert.equal(calls[0].some(arg=>arg.startsWith('after=')), false)
  assert.doesNotMatch(calls[0].join(' '),/mutation|SYNC_TOKEN|protection|rules\/branches/)
})
test('exactcommit withnullrollup is legitimatelyempty; wrongcommit/nullobject/errorsrefuse',()=>{
  assert.deepEqual(readReportedRequiredChecks('popcre/shared-db',123,group,()=>({data:{repository:{object:{oid:group,statusCheckRollup:null}}}})),{sha:group,contexts:[]})
  for(const value of [page([],false,null,head),{data:{repository:{object:null}}},{errors:[{}],...page([])}]) assert.throws(()=>readReportedRequiredChecks('popcre/shared-db',123,group,()=>value),/read failed/)
})
test('pagination unknownflags,duplicateidentity,nonadvancingcursor orbudget refuse',()=>{
  for(const response of [page([],true,'cursor'),page([],null,null),{data:{repository:{object:{oid:group,statusCheckRollup:{contexts:{nodes:[],pageInfo:{hasNextPage:false}}}}}}}]) assert.throws(()=>readReportedRequiredChecks('popcre/shared-db',123,group,()=>response),/pagination/)
  let count=0
  assert.throws(()=>readReportedRequiredChecks('popcre/shared-db',123,group,()=>++count===1?page([run()],true,'cursor'):page([run()],false,'last')),/repeated an identity/)
  let counter=0
  assert.throws(()=>readReportedRequiredChecks('popcre/shared-db',123,group,()=>page([run('required',{databaseId:++counter})],true,'same')),/did not advance/)
  assert.throws(()=>readReportedRequiredChecks('popcre/shared-db',123,group,()=>{throw Error('mustnotread')},{now:()=>900000,deadline:900000}),/900-second/)
})
test('queue membership reader isreadonly and refuses GraphQL errors',()=>{
  const calls=[];const read=args=>{calls.push(args);return {data:{repository:{pullRequest:pr()}}}}
  assert.deepEqual(readQueuePullRequest('popcre/shared-db',123,read),pr());assert.match(calls[0].join(' '),/mergeQueueEntry\{id\}/);assert.doesNotMatch(calls[0].join(' '),/mutation/)
  assert.throws(()=>readQueuePullRequest('popcre/shared-db',123,()=>({errors:[{}]})),/GraphQL errors/)
})
test('malformedidentities and wrongselfproducer refuse',async()=>{
  for(const changed of [{PR_NUMBER:'bad'},{MERGE_GROUP_SHA:'main'},{PR_HEAD_SHA:''},{MERGE_GROUP_REF:'refs/heads/gh-readonly-queue/main/../other'}]) await assert.rejects(holdMergeQueue({...env,...changed},harness({pullRequest:()=>{throw Error('mustnotread')}}).deps),/identity|head/)
  assert.throws(()=>requiredCheckProgress(input([run('Queue interlock',{checkSuite:{app:{databaseId:7}}})]),group),/different producer/)
})

test('fixed GraphQL queries preserve shared transient retries without quota waits', () => {
  for (const contextRead of [true, false]) {
    let calls = 0
    const read = (args, opts) => {
      assert.deepEqual(opts, { attempts: 4, idempotentWrite: true, maxRateLimitWaitMs: 0 })
      assert.match(args.find(arg => arg.startsWith('query=')), /^query=query\(/)
      assert.doesNotMatch(args.find(arg => arg.startsWith('query=')), /\bmutation\b/)
      return ghJson(args, { ...opts, quotaLatch: null, repository: null, wait: () => {}, reportStderr: () => {}, executor: () => {
        calls++
        if (calls === 1) throw Object.assign(new Error('transient'), { status: 1, stderr: 'HTTP 502: Bad Gateway' })
        return JSON.stringify(contextRead ? page([]) : {data:{repository:{pullRequest:pr()}}})
      } })
    }
    if (contextRead) readReportedRequiredChecks('popcre/shared-db',123,group,read)
    else readQueuePullRequest('popcre/shared-db',123,read)
    assert.equal(calls, 2)
  }
})
