import test from 'node:test'
import assert from 'node:assert/strict'
import { activationDate, filePaths, openProtectedCollisions } from './check-pr-source-collisions.mjs'

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
