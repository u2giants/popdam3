import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { qualifyChange } from './qualify-change.mjs'
import { canonicalJson, sha256 } from './evidence-bundle.mjs'

const target={repository:'u2giants/shared-db',issue:1,pr:2,base_sha:'9'.repeat(40),head_sha:'a'.repeat(40)}
const classified=(impact)=>{const files=[{path:'change',status:'modified',mode:'100644',blob_sha:'d'.repeat(40),sha256:'c'.repeat(64),impact,reason:'exact impact evidence'}],applicable_checks=['unit-tests'],required=impact!=='application-only';return{schema_version:1,...target,decision:required?'DATABASE_PREVIEW_REQUIRED':'NO_DATABASE_PREVIEW',reason_code:required?`impact_${impact.replaceAll('-','_')}`:'proven_non_database_change',inspected_digest:sha256(canonicalJson({classifier_version:1,...target,files,applicable_checks})),files,applicable_checks,invalidated_by:['file-content-change','file-set-change','impact-evidence-change','applicable-check-change','classifier-version-change']}}
const databasePreview=classified('database-structure')
const preview={...target,bundle_id:'b'.repeat(64),database_preview:databasePreview,inspected_files:databasePreview.files,versions:['20260828030000'],main_versions:['20260828010000'],preview_versions:['20260828010000'],claims:[],dependency_closure_complete:true,merged:false}
const base={repo:process.cwd(),file_shape:{supersession_supported:true},dependency_closure:{complete:true,missing:[]},historical_evidence:{compatible:true},preview}
const diagnostics=()=>({risk:{status:'covered'},catalog:{status:'covered',target_count:1}})
test('supported change qualifies without duplicating Python policy',()=>assert.equal(qualifyChange(base,{diagnostics}).status,'QUALIFIED'))
test('#1684 unsupported supersession file shape blocks before review',()=>assert.match(qualifyChange({...base,file_shape:{supersession_supported:false}},{diagnostics}).reason,/file shape/))
test('#1646 missing dependency closure blocks before preview',()=>assert.match(qualifyChange({...base,dependency_closure:{complete:false,missing:['20260828029999']}},{diagnostics}).reason,/dependency closure/))
test('#1720 constraint-only change without a verifier contract blocks before apply',()=>assert.match(qualifyChange(base,{diagnostics:()=>({risk:{status:'covered'},catalog:{status:'missing',target_count:0}})}).reason,/catalog verifier/))
test('divergent historical evidence blocks before promotion',()=>assert.match(qualifyChange({...base,historical_evidence:{compatible:false}},{diagnostics}).reason,/historical/))
test('Python failure or malformed diagnostics stays UNVERIFIABLE',()=>{assert.equal(qualifyChange(base,{diagnostics:()=>{throw new Error('python failed')}}).status,'UNVERIFIABLE');assert.equal(qualifyChange(base,{diagnostics:()=>null}).status,'BLOCKED')})
test('Node does not copy Python risk or catalog rule tables',()=>{const source=readFileSync('scripts/orchestrator-flow/qualify-change.mjs','utf8');assert.doesNotMatch(source,/HARD_BLOCKED|ATOMIC_BATCHES|CO_PRESENCE_RULES|derive_targets\s*=/)})
test('no-database-preview returns to the natural owner and never runs database diagnostics',()=>{let called=false;const database_preview=classified('application-only'),result=qualifyChange({preview:{...target,bundle_id:'b'.repeat(64),database_preview,inspected_files:database_preview.files}},{diagnostics:()=>{called=true;throw new Error('must not run')}});assert.equal(result.status,'QUALIFIED');assert.equal(result.decision,'NO_DATABASE_PREVIEW');assert.equal(result.next_action,'return-to-natural-owner');assert.equal(called,false)})
test('missing or forged no-preview evidence is unverifiable, never a fast lane',()=>{for(const database_preview of [null,{...classified('application-only'),inspected_digest:'0'.repeat(64)},{...classified('database-structure'),decision:'NO_DATABASE_PREVIEW'}])assert.equal(qualifyChange({preview:{...preview,database_preview}},{diagnostics}).status,'UNVERIFIABLE')})
