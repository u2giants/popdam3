import test from 'node:test'
import assert from 'node:assert/strict'
import { activationDate, conflictsWithMain, filePaths, gather, lastActivityAt, latestChecksFailing, openProtectedCollisions, parseStalePlaceNudge, stalePlaceNudgeLine, stalePlaceSkips, stalePlaceYield } from './check-pr-source-collisions.mjs'

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
