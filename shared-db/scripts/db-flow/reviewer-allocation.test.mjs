import assert from 'node:assert/strict'
import test from 'node:test'
import { allocateReviewer, approvedExecutionCandidates, executionKey, reviewReservationRef } from './reviewer-allocation.mjs'

const active=[{name:'grok',wrapper:'ai-grok-review',provider:'grok'},{name:'glm-a',wrapper:'ai-glm',provider:'glm'},{name:'glm-alias',wrapper:'ai-glm',provider:'glm'}],overflow=[{name:'codex',wrapper:'ai-codex',provider:'codex'}]
const request=(issue=1)=>({issue,pr:issue+10,head_sha:issue.toString(16).padStart(40,'a'),bundle_id:'b'.repeat(64)})
function ioFixture(){const reservations=new Map();return {reservations,createReservation:(ref,digest,record)=>{if(reservations.has(ref))return false;reservations.set(ref,{digest,record});return true}}}

test('aliases sharing one provider/wrapper have one canonical execution key',()=>{assert.equal(executionKey(active[1]),executionKey(active[2]));assert.equal(approvedExecutionCandidates({active}).length,2)})
test('active reviewers precede overflow and arbitrary inactive names are absent',()=>{const candidates=approvedExecutionCandidates({active,overflow,prohibited:['glm-a']});assert.equal(candidates[0].name,'grok');assert.equal(candidates.at(-1).name,'codex');assert.ok(!candidates.some((row)=>row.name==='unknown'))})
test('exact execution-context denial is process-local and not persisted',()=>{const io=ioFixture();const selected=allocateReviewer(request(),{active,overflow,context_denied:['grok']},io);assert.notEqual(selected.reviewer,'grok');assert.equal(approvedExecutionCandidates({active,overflow})[0].name,'grok')})

test('one provider takes more than eight simultaneous independent reviews with no busy wait',()=>{
  const io=ioFixture(),only=[active[0]],assigned=[]
  for(let n=1;n<=20;n++)assigned.push(allocateReviewer(request(n),{active:only,overflow},io))
  assert.ok(assigned.every((row)=>row.status==='assigned'&&row.reviewer==='grok'),'a live review never makes its provider busy')
  assert.equal(new Set(assigned.map((row)=>row.reservation_ref)).size,20,'each review owns its own reservation; none share state')
  assert.equal(io.reservations.size,20)
})

test('the same exact review is never reserved twice by one provider',()=>{
  const io=ioFixture(),only=[active[0]]
  allocateReviewer(request(1),{active:only},io)
  assert.throws(()=>allocateReviewer(request(1),{active:only},io),/already reserved/)
})

test('distinct reviews spread across providers with no global execution lock',()=>{
  const io=ioFixture(),assigned=[]
  for(let n=1;n<=20;n++)assigned.push(allocateReviewer(request(n),{active,overflow},io))
  const providers=new Set(assigned.map((row)=>row.execution_key))
  assert.equal(providers.size,2,'both active execution keys hold reservations at the same time')
  assert.ok(!providers.has(executionKey(overflow[0])),'overflow is not used while an active reviewer exists')
})

test('reservation refs are legal git refnames',()=>{
  const ref=reviewReservationRef(executionKey(active[0]),request(3))
  assert.ok(!ref.includes(':'),ref)
  const hostile=reviewReservationRef(executionKey({name:'x',wrapper:'ai:odd ..wrap~^?*[',provider:'p:q..r'}),request(4))
  assert.ok(!/:|\/\/|\.\.|[ ~^?*[\\]/.test(hostile),hostile)
  assert.ok(!/\/\/|\.\.|[ ~^?*[\\]/.test(ref),ref)
})
