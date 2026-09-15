import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson } from './evidence-bundle.mjs'
import {
  OrchestratorSnapshotError,
  buildOrchestratorSnapshot,
  transitionNotification,
  verifyOrchestratorSnapshot,
  publishSnapshotTransition,
  agentCheckInNotification,
  publishAgentCheckIn,
} from './orchestrator-snapshot.mjs'

const input = () => ({
  marker: { issue: 2758, status: 'active', route_id: 'local_owner' },
  claims: [{ issue: 20, writes: ['core.b'] }, { issue: 10, writes: ['core.a'] }],
  pull_requests: [{ number: 2, head: 'b'.repeat(40) }],
  reviewer_leases: [],
  stage_locks: [{ stage: 'merge', holder: null }],
  outcome_events: [{ event_id: 'event-1', work_issue: 10 }],
  eligible_queue: [{ issue: 30, priority: 5 }],
})

test('publishing is edge-triggered and unchanged state emits no check-in',()=>{
  const first=buildOrchestratorSnapshot(input()),published=[],stored=new Map()
  const writer=({key,record})=>{published.push(record);stored.set(key,record);return{status:'created',event_id:record.notification.event_id}}
  const same=publishSnapshotTransition(input(),{previousSnapshot:first,publish:writer,readPublished:(key)=>stored.get(key)})
  assert.equal(same.notification,null);assert.equal(published.length,0)
  const changed=input();changed.eligible_queue.push({issue:32,priority:1})
  publishSnapshotTransition(changed,{previousSnapshot:first,publish:writer,readPublished:(key)=>stored.get(key)})
  assert.equal(published.length,1);assert.equal(published[0].notification.event_type,'orchestrator_state_changed')
})

test('agents suppress progress chatter and report one terminal fact',()=>{
  for(const status of ['intermediate','unchanged','working','waiting'])assert.equal(agentCheckInNotification({status}),null)
  const completed=agentCheckInNotification({status:'completed',issue:7,evidence_id:'artifact:7'})
  assert.equal(completed.event_type,'agent_completed');assert.match(completed.event_id,/^[0-9a-f]{64}$/)
  assert.throws(()=>agentCheckInNotification({status:'blocked',issue:7,evidence_id:''}),/durable evidence/)
})

test('snapshot and terminal check-in retries converge to one immutable event',()=>{
  const stored=new Map(),compareCreate=({key,record,event})=>{const value=record??event,prior=stored.get(key);if(prior){if(!record&&canonicalJson(prior)!==canonicalJson(value))throw new Error('collision');return{status:'existing',event_id:(record?record.notification:event).event_id}}stored.set(key,value);return{status:'created',event_id:(record?record.notification:event).event_id}}
  const first=buildOrchestratorSnapshot(input()),changed=input();changed.claims.push({issue:99,writes:['core.z']})
  const readers={readPublished:(key)=>stored.get(key)},one=publishSnapshotTransition(changed,{previousSnapshot:first,capturedAt:'2026-09-11T17:00:00Z',publish:compareCreate,...readers}),two=publishSnapshotTransition(changed,{previousSnapshot:first,capturedAt:'2026-09-11T17:00:05Z',publish:compareCreate,...readers})
  assert.equal(one.notification.event_id,two.notification.event_id);assert.equal(stored.size,1)
  const check={status:'blocked',issue:99,evidence_id:'artifact:block-99'}
  const terminal={...readers,readTerminalOutcome:(issue)=>stored.get(`agent-terminal:${issue}`)};publishAgentCheckIn(check,{publish:compareCreate,...terminal});publishAgentCheckIn(check,{publish:compareCreate,...terminal})
  assert.equal(stored.size,2)
  assert.throws(()=>publishAgentCheckIn({...check,issue:100},{publish:()=>({status:'created',event_id:'wrong'}),readTerminalOutcome:()=>null,readPublished:()=>null}),/acknowledgement/)
})

test('snapshot is deterministic despite collection order and capture time', () => {
  const first = buildOrchestratorSnapshot(input(), { capturedAt: '2026-09-11T17:00:00Z' })
  const reordered = input()
  reordered.claims.reverse()
  const second = buildOrchestratorSnapshot(reordered, { capturedAt: '2026-09-11T17:01:00Z' })
  assert.equal(first.snapshot_id, second.snapshot_id)
  assert.notEqual(first.captured_at, second.captured_at)
})

test('successor accepts one exact fresh snapshot', () => {
  const snapshot = buildOrchestratorSnapshot(input(), { capturedAt: '2026-09-11T17:00:00Z' })
  assert.deepEqual(verifyOrchestratorSnapshot(snapshot, {readCurrent:input,now:'2026-09-11T17:01:00Z'}), {
    status: 'CURRENT', snapshot_id: snapshot.snapshot_id,
  })
})

test('changed live input refuses as stale', () => {
  const snapshot = buildOrchestratorSnapshot(input())
  const changed = input()
  changed.pull_requests[0].head = 'c'.repeat(40)
  assert.throws(() => verifyOrchestratorSnapshot(snapshot, {readCurrent:()=>changed,now:snapshot.captured_at}), /snapshot is stale/)
})

test('tampered snapshot refuses even when current input matches the original', () => {
  const snapshot = buildOrchestratorSnapshot(input())
  snapshot.state.claims[0].issue = 999
  assert.throws(() => verifyOrchestratorSnapshot(snapshot, {readCurrent:input,now:snapshot.captured_at}), /snapshot seal is invalid/)
})

test('unchanged state produces no notification and a transition wakes once', () => {
  const first = buildOrchestratorSnapshot(input())
  const same = buildOrchestratorSnapshot(input())
  assert.equal(transitionNotification(first, same), null)
  const changed = input()
  changed.eligible_queue.push({ issue: 31, priority: 4 })
  const next = buildOrchestratorSnapshot(changed)
  const notification=transitionNotification(first,next)
  assert.equal(notification.event_type,'orchestrator_state_changed')
  assert.equal(notification.previous_snapshot_id,first.snapshot_id)
  assert.equal(notification.snapshot_id,next.snapshot_id)
  assert.match(notification.event_id,/^[0-9a-f]{64}$/)
})

test('forged equal previous snapshot id cannot suppress a real transition', () => {
  const previous = buildOrchestratorSnapshot(input())
  const changed = input()
  changed.eligible_queue.push({ issue: 31, priority: 4 })
  const next = buildOrchestratorSnapshot(changed)
  previous.snapshot_id = next.snapshot_id
  previous.state_digest = next.snapshot_id
  assert.throws(() => transitionNotification(previous, next), /previous snapshot seal is invalid/)
  assert.throws(() => publishSnapshotTransition(changed, { previousSnapshot: previous, publish: () => assert.fail('must not publish') }), /previous snapshot seal is invalid/)
})

test('snapshot verification requires trusted current state and a bounded fresh capture',()=>{const snapshot=buildOrchestratorSnapshot(input(),{capturedAt:'2020-01-01T00:00:00Z'});assert.throws(()=>verifyOrchestratorSnapshot(snapshot),/trusted current-state reader/);assert.throws(()=>verifyOrchestratorSnapshot(snapshot,{readCurrent:input,now:'2026-09-11T00:00:00Z'}),/freshness window/)})

test('a rewritten capture time on an expired snapshot refuses as an invalid seal', () => {
  const snapshot = buildOrchestratorSnapshot(input(), { capturedAt: '2020-01-01T00:00:00Z' })
  snapshot.captured_at = '2026-09-11T17:00:00Z'
  assert.throws(() => verifyOrchestratorSnapshot(snapshot, { readCurrent: input, now: '2026-09-11T17:01:00Z' }), /snapshot seal is invalid/)
  delete snapshot.seal_digest
  assert.throws(() => verifyOrchestratorSnapshot(snapshot, { readCurrent: input, now: '2026-09-11T17:01:00Z' }), /snapshot seal is invalid/)
})

test('contradictory terminal outcomes contend on one issue key',()=>{const completed=agentCheckInNotification({status:'completed',issue:7,evidence_id:'artifact:done'});assert.throws(()=>publishAgentCheckIn({status:'blocked',issue:7,evidence_id:'artifact:block'},{publish:()=>assert.fail('must not publish'),readTerminalOutcome:()=>completed,readPublished:()=>completed}),/conflicting terminal outcome/)})

test('a conflicting terminal race is rejected after compare-and-create',()=>{const completed=agentCheckInNotification({status:'completed',issue:7,evidence_id:'artifact:done'});assert.throws(()=>publishAgentCheckIn({status:'blocked',issue:7,evidence_id:'artifact:block'},{readTerminalOutcome:()=>null,publish:({event})=>({status:'existing',event_id:event.event_id}),readPublished:()=>completed}),/durable readback/)})

test('created and existing events require exact durable readback',()=>{const changed=input();changed.claims.push({issue:99});const prior=buildOrchestratorSnapshot(input());for(const status of ['created','existing'])assert.throws(()=>publishSnapshotTransition(changed,{previousSnapshot:prior,publish:({record})=>({status,event_id:record.notification.event_id}),readPublished:()=>null}),/durable readback/);assert.throws(()=>publishAgentCheckIn({status:'completed',issue:7,evidence_id:'artifact:done'},{publish:({event})=>({status:'existing',event_id:event.event_id}),readTerminalOutcome:()=>null,readPublished:()=>null}),/durable readback/)})

test('corrupt previous snapshot state refuses before publication', () => {
  const previous = buildOrchestratorSnapshot(input())
  previous.state.claims = null
  const changed = input()
  changed.claims.push({ issue: 99, writes: ['core.z'] })
  let published = false
  assert.throws(() => publishSnapshotTransition(changed, { previousSnapshot: previous, publish: () => { published = true } }), /claims must be an array/)
  assert.equal(published, false)
})

test('capture-time-only differences are not a state transition', () => {
  const previous = buildOrchestratorSnapshot(input(), { capturedAt: '2026-09-11T17:00:00Z' })
  const next = buildOrchestratorSnapshot(input(), { capturedAt: '2026-09-11T18:00:00Z' })
  assert.equal(transitionNotification(previous, next), null)
})

test('unroutable marker and unreadable collections fail closed', () => {
  const missingRoute = input()
  missingRoute.marker.route_id = ''
  assert.throws(() => buildOrchestratorSnapshot(missingRoute), OrchestratorSnapshotError)
  const missingClaims = input()
  delete missingClaims.claims
  assert.throws(() => buildOrchestratorSnapshot(missingClaims), /claims must be an array/)
})
