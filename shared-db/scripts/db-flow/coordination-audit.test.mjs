import assert from 'node:assert/strict'
import test from 'node:test'
import { coordinationEvent, formatEventComment } from '../db-coordination-events.mjs'
import { auditCoordinationComments } from './coordination-audit.mjs'

test('capacity relinquish, block, unblock and resume replay without double acquisition',()=>{
  const types=['author_capacity_relinquished','issue_blocked','issue_unblocked','author_capacity_resumed']
  const comments=types.map((eventType,index)=>formatEventComment(coordinationEvent({eventType,workIssue:42,claimIssue:77,actor:'fixture',timestamp:`2026-08-28T12:0${index}:00Z`})))
  const audit=auditCoordinationComments(comments)
  assert.equal(audit.valid,true)
  assert.deepEqual(audit.events.map((event)=>event.event_type),types)
})
