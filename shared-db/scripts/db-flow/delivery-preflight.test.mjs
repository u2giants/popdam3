import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson, sha256, validateEvidenceBundle } from './evidence-bundle.mjs'
import {
  DELIVERY_CHECKS,
  DeliveryPreflightError,
  reuseDeliveryPreflight,
  runDeliveryPreflight,
  composeDeliveryPreflight,
  registerDeliveryPreflight,
  validateDeliveryPreflight,
} from './delivery-preflight.mjs'

const input = () => {const value={issue:2728,pr:2800,head_sha:'a'.repeat(40),checks:Object.fromEntries(DELIVERY_CHECKS.map((name)=>[name,{status:'PASS',evidence_id:`${name}-proof`}]))};for(const name of ['sidecars','producers']){const registration={evidence_id:value.checks[name].evidence_id,kind:name,issue:value.issue,pr:value.pr,head_sha:value.head_sha,producer_id:`${name}-producer`,artifact_digest:'b'.repeat(64)};Object.assign(value.checks[name],{producer_id:registration.producer_id,artifact_digest:registration.artifact_digest,registry_digest:sha256(canonicalJson(registration))})}return value}
const registry=(value)=>({readEvidenceRegistration:(id)=>{for(const name of ['sidecars','producers'])if(value.checks[name].evidence_id===id){const check=value.checks[name];return{evidence_id:id,kind:name,issue:value.issue,pr:value.pr,head_sha:value.head_sha,producer_id:check.producer_id,artifact_digest:check.artifact_digest}}return null}})
const run=(value)=>runDeliveryPreflight(value,registry(value))

test('composition invokes every existing gate once and registers exact-head evidence',()=>{
  const calls=[]
  const value=input(),adapters=Object.fromEntries(DELIVERY_CHECKS.map((name)=>[name,()=>{calls.push(name);return value.checks[name]}]));Object.assign(adapters,registry(value))
  const result=composeDeliveryPreflight({issue:2728,pr:2800,head_sha:'a'.repeat(40)},adapters)
  assert.deepEqual(calls,DELIVERY_CHECKS)
  const identity={policy_version:1,migrations:[],focused_files:[],verification_files:[],claims:{writes:[],reads:[]},global_invalidators:[],migration_order_digest:'0'.repeat(64)}
  const bundle={schema_version:1,bundle_id:sha256(canonicalJson(identity)),identity,metadata:{issue:2728,pr:2800,claim:1,base_main_sha:'b'.repeat(40),integration_sha:'a'.repeat(40),review:null,ci:null}}
  const registered=registerDeliveryPreflight(bundle,result,registry(value))
  assert.equal(registered.metadata.delivery_preflight.input_digest,result.input_digest)
  assert.equal(validateEvidenceBundle(registered),registered)
  bundle.metadata.integration_sha='b'.repeat(40)
  assert.throws(()=>registerDeliveryPreflight(bundle,result,registry(value)),/exact head/)
})

test('composition refuses before work when any gate adapter is absent',()=>{
  const adapters=Object.fromEntries(DELIVERY_CHECKS.slice(1).map((name)=>[name,()=>({status:'PASS',evidence_id:'proof'})]))
  assert.throws(()=>composeDeliveryPreflight({issue:1,pr:2,head_sha:'a'.repeat(40)},adapters),/adapter route is required/)
})

test('one composed preflight binds every early gate to the exact head', () => {
  const value=input(),result = run(value)
  assert.equal(result.status, 'PASS')
  assert.equal(result.preflight_id, result.input_digest)
  assert.equal(reuseDeliveryPreflight(result, value,registry(value)), result)
})

for (const name of DELIVERY_CHECKS) test(`missing or blocked ${name} refuses early`, () => {
  const blocked = input()
  blocked.checks[name].status = 'BLOCKED'
  assert.throws(() => run(blocked), new RegExp(`blocked by ${name}`))
  const missing = input()
  delete missing.checks[name]
  assert.throws(() => run(missing), DeliveryPreflightError)
})

test('a self-consistent outer PASS over a blocked inner check is refused and never reused', () => {
  const blocked = input()
  blocked.checks.runner_capacity.status = 'BLOCKED'
  const normalized = { issue: blocked.issue, pr: blocked.pr, head_sha: blocked.head_sha, checks: blocked.checks }
  const digest = sha256(canonicalJson(normalized))
  const forged = { schema_version: run(input()).schema_version, preflight_id: digest, input_digest: digest, status: 'PASS', input: normalized }
  assert.throws(() => validateDeliveryPreflight(forged, registry(blocked)), /blocked checks: runner_capacity/)
  assert.equal(reuseDeliveryPreflight(forged, blocked, registry(blocked)), null)
})

test('changed head, evidence, or status invalidates reuse', () => {
  const original = input()
  const result = run(original)
  const changedHead = input()
  changedHead.head_sha = 'b'.repeat(40)
  assert.equal(reuseDeliveryPreflight(result, changedHead,registry(changedHead)), null)
  const changedEvidence = input()
  changedEvidence.checks.producers.evidence_id = 'new-producer-proof'
  assert.equal(reuseDeliveryPreflight(result, changedEvidence,registry(changedEvidence)), null)
  const blocked = input()
  blocked.checks.runner_capacity.status = 'BLOCKED'
  assert.equal(reuseDeliveryPreflight(result, blocked,registry(blocked)), null)
})

test('matching outer ids cannot conceal tampered preflight input',()=>{
  const source=input(),result=run(source),tampered=structuredClone(result)
  tampered.input.pr=999
  assert.throws(()=>validateDeliveryPreflight(tampered,registry(source)),/canonical input/)
  assert.equal(reuseDeliveryPreflight(tampered,tampered.input,registry(source)),null)
  const identity={policy_version:1,migrations:[],focused_files:[],verification_files:[],claims:{writes:[],reads:[]},global_invalidators:[],migration_order_digest:'0'.repeat(64)}
  const bundle={schema_version:1,bundle_id:sha256(canonicalJson(identity)),identity,metadata:{issue:2728,pr:999,claim:1,base_main_sha:'b'.repeat(40),integration_sha:'a'.repeat(40),review:null,ci:null}}
  assert.throws(()=>registerDeliveryPreflight(bundle,tampered,registry(source)),/canonical input/)
})

test('unknown checks and evidence-free success fail closed', () => {
  const unknown = input()
  unknown.checks.extra = { status: 'PASS', evidence_id: 'x' }
  assert.throws(() => run(unknown), /must contain exactly/)
  const emptyEvidence = input()
  emptyEvidence.checks.sidecars.evidence_id = ''
  assert.throws(() => run(emptyEvidence), /lacks durable evidence/)
})

test('composition stops immediately after the first blocker',()=>{const value=input(),calls=[];const adapters=Object.fromEntries(DELIVERY_CHECKS.map((name,index)=>[name,()=>{calls.push(name);return index===0?{status:'BLOCKED',evidence_id:'blocked'}:value.checks[name]}]));Object.assign(adapters,registry(value));assert.throws(()=>composeDeliveryPreflight({issue:value.issue,pr:value.pr,head_sha:value.head_sha},adapters),/blocked by route/);assert.deepEqual(calls,['route'])})

test('fabricated sidecar or producer registrations fail authoritative readback',()=>{for(const name of ['sidecars','producers']){const value=input();value.checks[name].producer_id='fabricated';assert.throws(()=>runDeliveryPreflight(value,registry(input())),/authoritative registry readback/)}})

test('recomputed caller-controlled registry claims cannot validate or register',()=>{const value=input(),record=run(value),fabricated=structuredClone(record);for(const name of ['sidecars','producers']){const check=fabricated.input.checks[name],registration={evidence_id:check.evidence_id,kind:name,issue:fabricated.input.issue,pr:fabricated.input.pr,head_sha:fabricated.input.head_sha,producer_id:'fabricated-producer',artifact_digest:'f'.repeat(64)};check.producer_id=registration.producer_id;check.artifact_digest=registration.artifact_digest;check.registry_digest=sha256(canonicalJson(registration))}const digest=sha256(canonicalJson(fabricated.input));fabricated.preflight_id=digest;fabricated.input_digest=digest;const identity={policy_version:1,migrations:[],focused_files:[],verification_files:[],claims:{writes:[],reads:[]},global_invalidators:[],migration_order_digest:'0'.repeat(64)},bundle={schema_version:1,bundle_id:sha256(canonicalJson(identity)),identity,metadata:{issue:value.issue,pr:value.pr,claim:1,base_main_sha:'b'.repeat(40),integration_sha:value.head_sha,review:null,ci:null}};assert.throws(()=>validateDeliveryPreflight(fabricated),/trusted sidecar and producer registry reader/);assert.throws(()=>validateDeliveryPreflight(fabricated,registry(value)),/authoritative registry readback/);assert.throws(()=>registerDeliveryPreflight(bundle,fabricated,registry(value)),/authoritative registry readback/)})
