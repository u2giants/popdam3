import test from 'node:test'
import assert from 'node:assert/strict'
import { activationDate, conflictsWithMain, filePaths, gather, lastActivityAt, main, mergeGroupProblem, readMergeGroupFacts, latestChecksFailing, openProtectedCollisions, parseStalePlaceNudge, stalePlaceNudgeLine, stalePlaceSkips, stalePlaceYield } from './check-pr-source-collisions.mjs'

const NOW='2026-09-18T12:00:00Z'
const PROTECTED='scripts/manage-migration-author-lanes.mjs'
// A ready earlier pull request whose place the stale-place rule could forfeit:
// older activation, an overlapping protected file, and (in most tests) every
// stale-place signal present. Spread it and override ONE signal per case.
const stalePredecessor=(overrides={})=>({
  number:10,title:'stale',activatedAt:'2026-09-16T09:00:00Z',files:[PROTECTED],
  lastActivityAt:'2026-09-16T10:00:00Z', // 50h before NOW: condition (a) holds
  checksFailing:true,conflictsWithMain:false, // condition (b) holds
  nudges:[{forPr:20,date:'2026-09-18',states:['inactive-24h','checks-failing'],at:'2026-09-18T08:00:00Z'}], // condition (c) holds for PR #20
  ...overrides,
})
const newer={number:20,title:'newer',activatedAt:'2026-09-18T09:00:00Z',files:[PROTECTED]}
const blocks=[{file:PROTECTED,pr:10,title:'stale'}]

test('an earlier open PR editing the lane manager serializes a later PR',()=>{
  const current={number:20,files:['scripts/manage-migration-author-lanes.mjs']}
  assert.deepEqual(openProtectedCollisions(current,[{number:10,title:'first',files:['scripts/manage-migration-author-lanes.mjs']}]),[{file:'scripts/manage-migration-author-lanes.mjs',pr:10,title:'first'}])
})

test('the earliest active contender wins regardless of PR number',()=>{
  const current={number:20,activatedAt:'2026-08-30T12:00:00Z',files:['scripts/manage-migration-author-lanes.mjs','docs/x.md']}
  assert.deepEqual(openProtectedCollisions(current,[
    {number:21,activatedAt:'2026-08-30T11:00:00Z',files:['scripts/manage-migration-author-lanes.mjs']},
    {number:10,draft:true,files:['scripts/manage-migration-author-lanes.mjs']},
    {number:9,files:['docs/x.md']},
  ]),[{file:'scripts/manage-migration-author-lanes.mjs',pr:21,title:''}])
  assert.deepEqual(openProtectedCollisions({...current,activatedAt:'2026-08-30T10:00:00Z'},[
    {number:10,activatedAt:'2026-08-30T11:00:00Z',files:['scripts/manage-migration-author-lanes.mjs']},
  ]),[])
})

test('synchronizing a winner cannot reverse priority and deadlock both PRs',()=>{
  const winner={number:20,created_at:'2026-08-30T10:00:00Z',head:{sha:'new-head'}}
  const loser={number:21,created_at:'2026-08-30T11:00:00Z'}
  assert.equal(activationDate(winner,[]),'2026-08-30T10:00:00.000Z')
  assert.deepEqual(openProtectedCollisions({number:20,activatedAt:activationDate(winner,[]),files:['scripts/manage-migration-author-lanes.mjs']},[
    {number:21,activatedAt:activationDate(loser,[]),files:['scripts/manage-migration-author-lanes.mjs']},
  ]),[])
})

test('renaming the protected source participates through its previous path',()=>{
  assert.deepEqual(filePaths([{filename:'scripts/renamed.mjs',previous_filename:'scripts/manage-migration-author-lanes.mjs'}]),['scripts/renamed.mjs','scripts/manage-migration-author-lanes.mjs'])
})

test('a PR that does not edit a protected source never blocks on bystanders',()=>{
  assert.deepEqual(openProtectedCollisions({number:20,files:['docs/x.md']},[{number:10,files:['scripts/manage-migration-author-lanes.mjs']}]),[])
})

test('stale-place: a nudge-gated skip drops an inactive red predecessor from the queue (issue #3273)',()=>{
  assert.deepEqual(openProtectedCollisions(newer,[stalePredecessor()],{now:NOW}),[])
  assert.deepEqual(stalePlaceSkips(newer,[stalePredecessor()],{now:NOW}),blocks)
})

test('stale-place: the skip is gated on the dated nudge naming the newer PR',()=>{
  // No nudge at all: the stale PR keeps its place.
  assert.deepEqual(openProtectedCollisions(newer,[stalePredecessor({nudges:[]})],{now:NOW}),blocks)
  // A nudge naming a DIFFERENT newer PR yields the place to nobody else.
  assert.deepEqual(openProtectedCollisions(newer,[stalePredecessor({nudges:[{forPr:21,date:'2026-09-18',states:['inactive-24h','checks-failing'],at:'2026-09-18T08:00:00Z'}]})],{now:NOW}),blocks)
  // An undated nudge is not a dated nudge.
  assert.deepEqual(openProtectedCollisions(newer,[stalePredecessor({nudges:[{forPr:20,date:'2026-09-18',states:['checks-failing'],at:'not-a-date'}]})],{now:NOW}),blocks)
})

test('stale-place: the predecessor reclaims its place once refreshed and green',()=>{
  // Refreshed: activity inside 24h defeats condition (a) even while still red.
  assert.deepEqual(openProtectedCollisions(newer,[stalePredecessor({lastActivityAt:'2026-09-18T11:30:00Z'})],{now:NOW}),blocks)
  // Green: no failing check and no conflict defeats condition (b) even after 24h idle.
  assert.deepEqual(openProtectedCollisions(newer,[stalePredecessor({checksFailing:false})],{now:NOW}),blocks)
  // Refreshed AND green is the full reclaim: it precedes again with the nudge still on record.
  assert.deepEqual(openProtectedCollisions(newer,[stalePredecessor({lastActivityAt:'2026-09-18T11:30:00Z',checksFailing:false})],{now:NOW}),blocks)
  assert.deepEqual(stalePlaceSkips(newer,[stalePredecessor({lastActivityAt:'2026-09-18T11:30:00Z',checksFailing:false})],{now:NOW}),[])
})

test('stale-place: a green, recently-active PR is NEVER skipped, nudge or not',()=>{
  const healthy=stalePredecessor({lastActivityAt:'2026-09-18T11:00:00Z',checksFailing:false,conflictsWithMain:false})
  assert.deepEqual(openProtectedCollisions(newer,[healthy],{now:NOW}),blocks)
  assert.deepEqual(stalePlaceSkips(newer,[healthy],{now:NOW}),[])
})

test('stale-place: a main conflict satisfies condition (b) without a failing check',()=>{
  assert.deepEqual(openProtectedCollisions(newer,[stalePredecessor({checksFailing:false,conflictsWithMain:true})],{now:NOW}),[])
})

test('stale-place fails closed: any unreadable signal means no skip',()=>{
  assert.deepEqual(openProtectedCollisions(newer,[stalePredecessor({lastActivityAt:null})],{now:NOW}),blocks)
  assert.deepEqual(openProtectedCollisions(newer,[stalePredecessor({lastActivityAt:'garbage'})],{now:NOW}),blocks)
  assert.equal(stalePlaceYield(stalePredecessor(),20,{now:'garbage'}),false)
  // Missing signals on a bare row (the pre-#3273 shape) can never produce a skip.
  assert.deepEqual(openProtectedCollisions(newer,[{number:10,title:'stale',activatedAt:'2026-09-16T09:00:00Z',files:[PROTECTED]}],{now:NOW}),blocks)
})

test('stale-place: a nudge comment never refreshes the PR it was posted on',()=>{
  const activity=lastActivityAt({
    detail:{created_at:'2026-09-16T09:00:00Z'},
    commits:[{commit:{committer:{date:'2026-09-16T10:00:00Z'}}}],
    comments:[
      {body:`please move\n${stalePlaceNudgeLine(20,{date:'2026-09-18',states:['inactive-24h','checks-failing']})}`,created_at:'2026-09-18T11:59:00Z'},
      {body:'ordinary comment',created_at:'2026-09-16T11:00:00Z'},
    ],
  })
  assert.equal(activity,'2026-09-16T11:00:00.000Z')
})

test('stale-place nudge marker: parse what the builder writes, refuse the rest',()=>{
  const line=stalePlaceNudgeLine(20,{date:'2026-09-18',states:['inactive-24h','checks-failing']})
  assert.deepEqual(parseStalePlaceNudge(`some prose\n${line}`,{commentedAt:'2026-09-18T08:00:00Z'}),{forPr:20,date:'2026-09-18',states:['inactive-24h','checks-failing'],at:'2026-09-18T08:00:00Z'})
  // A comment whose posted time is unreadable is not a dated nudge.
  assert.equal(parseStalePlaceNudge(line,{commentedAt:'junk'}),null)
  assert.equal(parseStalePlaceNudge('stale-place-nudge: date=2026-09-18 state=inactive-24h',{commentedAt:'2026-09-18T08:00:00Z'}),null)
  assert.equal(parseStalePlaceNudge('stale-place-nudge: pr=#20 date=2026-09-18 state=unspecified',{commentedAt:'2026-09-18T08:00:00Z'}),null)
  assert.equal(parseStalePlaceNudge('no marker here',{commentedAt:'2026-09-18T08:00:00Z'}),null)
})

test('gather enriches an overlapping predecessor with the stale-place signals',()=>{
  const snapshot={
    current:{number:20,title:'newer',draft:false,created_at:'2026-09-18T09:00:00Z',files:[{filename:PROTECTED}]},
    others:[{number:10,listed:{title:'stale',draft:false,created_at:'2026-09-16T09:00:00Z'},files:[{filename:PROTECTED}]}],
  }
  const input=gather({GITHUB_REPOSITORY:'popcre/shared-db',PR_NUMBER:'20'},{
    load:()=>snapshot,
    timeline:()=>[{event:'ready_for_review',created_at:'2026-09-16T09:30:00Z'}],
    detail:()=>({created_at:'2026-09-16T09:00:00Z',mergeable:true,mergeable_state:'blocked',head:{sha:'a'.repeat(40)}}),
    commits:()=>[{commit:{committer:{date:'2026-09-16T10:00:00Z'}}}],
    comments:()=>[{body:stalePlaceNudgeLine(20,{date:'2026-09-18',states:['inactive-24h','checks-failing']}),created_at:'2026-09-18T08:00:00Z'}],
    checkRuns:()=>[{id:1,name:'guard',conclusion:'failure'}],
  })
  const [predecessor]=input.others
  assert.equal(predecessor.activatedAt,'2026-09-16T09:30:00.000Z')
  assert.equal(predecessor.lastActivityAt,'2026-09-16T10:00:00.000Z')
  assert.equal(predecessor.checksFailing,true)
  assert.equal(predecessor.conflictsWithMain,false)
  assert.deepEqual(predecessor.nudges,[{forPr:20,date:'2026-09-18',states:['inactive-24h','checks-failing'],at:'2026-09-18T08:00:00Z'}])
  assert.deepEqual(openProtectedCollisions(input.current,input.others,{now:NOW}),[])
  // The same gathered predecessor with a green check read keeps its place.
  assert.equal(input.others[0].checksFailing,true)
})

test('latestChecksFailing: only the latest run per check name decides',()=>{
  assert.equal(latestChecksFailing([
    {id:1,name:'guard',conclusion:'failure'},
    {id:2,name:'guard',conclusion:'success'},
  ]),false)
  assert.equal(latestChecksFailing([
    {id:1,name:'guard',conclusion:'success'},
    {id:2,name:'tests',conclusion:'timed_out'},
  ]),true)
  assert.equal(latestChecksFailing([{id:1,name:'guard',conclusion:null,status:'in_progress'}]),false)
  assert.equal(latestChecksFailing([]),false)
})

test('conflictsWithMain: a computed false or dirty state conflicts, computing does not',()=>{
  assert.equal(conflictsWithMain({mergeable:false}),true)
  assert.equal(conflictsWithMain({mergeable:null,mergeable_state:'dirty'}),true)
  assert.equal(conflictsWithMain({mergeable:null,mergeable_state:'unknown'}),false)
  assert.equal(conflictsWithMain({mergeable:true,mergeable_state:'clean'}),false)
})

// 2026-09-28 deadlock replay: nine ready pull requests all editing the lane
// manager. Before, every one but the head of the line exited 1 and stayed red
// forever. Now each passes and names its place; the merge queue serializes.
test('overlapping ready PRs queue instead of failing each other (2026-09-28 deadlock replay)',()=>{
  const prs=Array.from({length:9},(_,i)=>({number:3600+i,title:`pr${i}`,draft:false,activatedAt:`2026-09-28T0${i}:00:00Z`,files:[PROTECTED]}))
  const verdicts=prs.map((current)=>{
    const out=[];const err=[]
    const code=main({},{gatherInput:()=>({current,others:prs.filter((pr)=>pr!==current)}),now:'2026-09-28T12:00:00Z',log:(m)=>out.push(m),error:(m)=>err.push(m)})
    return {code,out,err}
  })
  assert.deepEqual(verdicts.map((v)=>v.code),Array(9).fill(0))
  assert.ok(verdicts.every((v)=>v.err.length===0))
  assert.match(verdicts[0].out.join('\n'),/No other ready open pull request/)
  for(let i=1;i<9;i++){
    const text=verdicts[i].out.join('\n')
    assert.match(text,/^QUEUED:/m)
    assert.equal((text.match(/earlier overlapping PR/g)??[]).length,i)
  }
})

test('an unreadable collision audit still refuses (fail closed)',()=>{
  const err=[]
  assert.equal(main({},{gatherInput:()=>{throw new Error('boom')},log:()=>{},error:(m)=>err.push(m)}),2)
  assert.match(err[0],/audit is unavailable: boom/)
})

const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40)
test('merge group: its base plus exactly one PR passes; everything else refuses',()=>{
  assert.equal(mergeGroupProblem({baseSha:A,headSha:B,headParents:[A,C]}),null)
  assert.match(mergeGroupProblem({baseSha:A,headSha:B,headParents:[D,C]}),/not exactly one pull request/)
  assert.match(mergeGroupProblem({baseSha:A,headSha:B,headParents:[A]}),/not exactly one pull request/)
  assert.match(mergeGroupProblem({baseSha:A,headSha:B,headParents:[A,C,D]}),/not exactly one pull request/)
  assert.match(mergeGroupProblem({baseSha:'x',headSha:B,headParents:[A,C]}),/base or head SHA is unreadable/)
  assert.match(mergeGroupProblem({baseSha:A,headSha:B,headParents:null}),/parents are unreadable/)
  assert.match(mergeGroupProblem(),/unreadable/)
})

test('merge-group mode exits 1 on a stacked group or unreadable facts, 0 only on the exact shape',()=>{
  const env={SOURCE_COLLISION_MODE:'merge-group'}
  const run=(groupFacts)=>{const err=[];const code=main(env,{groupFacts,gatherInput:()=>{throw new Error('PR scan must not run on merge_group')},log:()=>{},error:(m)=>err.push(m)});return {code,err}}
  assert.equal(run(()=>({baseSha:A,headSha:B,headParents:[A,C]})).code,0)
  assert.equal(run(()=>({baseSha:A,headSha:B,headParents:[D,C]})).code,1)
  const broken=run(()=>{throw new Error('no event file')})
  assert.equal(broken.code,1);assert.match(broken.err[0],/unreadable: no event file/)
})

test('merge-group mode end to end: real event file and real git history',async()=>{
  const {execFileSync}=await import('node:child_process')
  const {mkdtempSync,writeFileSync}=await import('node:fs')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const dir=mkdtempSync(join(tmpdir(),'mg-'))
  const g=(...args)=>execFileSync('git',['-C',dir,'-c','user.name=t','-c','user.email=t@t','-c','commit.gpgsign=false',...args],{encoding:'utf8'}).trim()
  g('init','-q','-b','main');writeFileSync(join(dir,'f'),'1');g('add','f');g('commit','-qm','base')
  const base=g('rev-parse','HEAD')
  g('checkout','-qb','pr1');writeFileSync(join(dir,'p1'),'1');g('add','p1');g('commit','-qm','pr1')
  g('checkout','-q','main');g('checkout','-qb','pr2');writeFileSync(join(dir,'p2'),'1');g('add','p2');g('commit','-qm','pr2')
  g('checkout','-q','main');g('merge','-q','--no-ff','-m','group1','pr1')
  const group1=g('rev-parse','HEAD')
  g('merge','-q','--no-ff','-m','group2 stacked','pr2')
  const stacked=g('rev-parse','HEAD')
  const run=(payload)=>{
    const path=join(dir,'event.json');writeFileSync(path,JSON.stringify(payload))
    const env={SOURCE_COLLISION_MODE:'merge-group',GITHUB_EVENT_PATH:path}
    const err=[];const code=main(env,{groupFacts:()=>readMergeGroupFacts(env,{cwd:dir}),log:()=>{},error:(m)=>err.push(m)})
    return {code,err}
  }
  assert.equal(run({merge_group:{base_sha:base,head_sha:group1}}).code,0)
  const s=run({merge_group:{base_sha:base,head_sha:stacked}});assert.equal(s.code,1);assert.match(s.err[0],/not exactly one pull request/)
  assert.equal(run({merge_group:{base_sha:base}}).code,1)
  const garbled=join(dir,'bad.json');writeFileSync(garbled,'{not json')
  const genv={SOURCE_COLLISION_MODE:'merge-group',GITHUB_EVENT_PATH:garbled}
  assert.equal(main(genv,{groupFacts:()=>readMergeGroupFacts(genv,{cwd:dir}),log:()=>{},error:()=>{}}),1)
})

test('workflow pins the merge-group step to merge_group with merge-group mode',async()=>{
  const {readFileSync}=await import('node:fs')
  const {jobBlockByName}=await import('./lib/workflow-jobs.mjs')
  const yml=jobBlockByName(readFileSync(new URL('../.github/workflows/pr-guards.yml',import.meta.url),'utf8'),'Cross-PR object collision')
  const step=yml.slice(yml.indexOf('- name: Merge group is its base plus exactly one PR'))
  assert.match(step.slice(0,400),/if: github\.event_name == 'merge_group'[\s\S]*SOURCE_COLLISION_MODE: merge-group[\s\S]*node scripts\/check-pr-source-collisions\.mjs/)
  assert.match(yml,/node --test [^\n]*scripts\/manage-migration-author-lanes\.test\.mjs/)
})
