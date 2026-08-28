import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { qualifyChange } from './qualify-change.mjs'

const preview={issue:1,pr:2,head_sha:'a'.repeat(40),bundle_id:'b'.repeat(64),versions:['20260828030000'],main_versions:['20260828010000'],preview_versions:['20260828010000'],claims:[],dependency_closure_complete:true,merged:false}
const base={repo:process.cwd(),file_shape:{supersession_supported:true},dependency_closure:{complete:true,missing:[]},historical_evidence:{compatible:true},preview}
const diagnostics=()=>({risk:{status:'covered'},catalog:{status:'covered',target_count:1}})
test('supported change qualifies without duplicating Python policy',()=>assert.equal(qualifyChange(base,{diagnostics}).status,'QUALIFIED'))
test('#1684 unsupported supersession file shape blocks before review',()=>assert.match(qualifyChange({...base,file_shape:{supersession_supported:false}},{diagnostics}).reason,/file shape/))
test('#1646 missing dependency closure blocks before preview',()=>assert.match(qualifyChange({...base,dependency_closure:{complete:false,missing:['20260828029999']}},{diagnostics}).reason,/dependency closure/))
test('#1720 constraint-only change without a verifier contract blocks before apply',()=>assert.match(qualifyChange(base,{diagnostics:()=>({risk:{status:'covered'},catalog:{status:'missing',target_count:0}})}).reason,/catalog verifier/))
test('divergent historical evidence blocks before promotion',()=>assert.match(qualifyChange({...base,historical_evidence:{compatible:false}},{diagnostics}).reason,/historical/))
test('Python failure or malformed diagnostics stays UNVERIFIABLE',()=>{assert.equal(qualifyChange(base,{diagnostics:()=>{throw new Error('python failed')}}).status,'UNVERIFIABLE');assert.equal(qualifyChange(base,{diagnostics:()=>null}).status,'BLOCKED')})
test('Node does not copy Python risk or catalog rule tables',()=>{const source=readFileSync('scripts/orchestrator-flow/qualify-change.mjs','utf8');assert.doesNotMatch(source,/HARD_BLOCKED|ATOMIC_BATCHES|CO_PRESENCE_RULES|derive_targets\s*=/)})
