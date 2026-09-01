import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildEvidenceBundle, discoverModuleImports, validateEvidenceBundle, EvidenceBundleError, sha256 } from './evidence-bundle.mjs'

const files=new Map([
  ['supabase/migrations/20260828000000_x.sql','select 1;\r\n'],['tests/focused.sql','ok\n'],['scripts/verify.json','{}\n'],
  ['config/orchestrator-global-invalidators-v1.json',JSON.stringify({schema_version:1,files:['scripts/guard.mjs']})],
  ['scripts/guard.mjs',"import './helper.mjs'\n"],['scripts/helper.mjs','export const safe=true\n'],
])
const adapters=(overrides={})=>({readFile:(file)=>files.get(file),fileExists:(file)=>files.has(file),isClean:()=>true,...overrides})
const input={migrations:['supabase/migrations/20260828000000_x.sql'],focusedFiles:['tests/focused.sql'],verificationFiles:['scripts/verify.json'],writes:['table test.a'],reads:['table test.b'],migrationOrderDigest:sha256('order'),issue:1,pr:2,claim:3,baseMainSha:'a'.repeat(40),integrationSha:'b'.repeat(40)}

test('bundle is canonical and metadata movement does not change content identity',()=>{
  const first=buildEvidenceBundle(input,adapters()),second=buildEvidenceBundle({...input,baseMainSha:'c'.repeat(40),integrationSha:'d'.repeat(40)},adapters())
  assert.equal(first.bundle_id,second.bundle_id);assert.equal(validateEvidenceBundle(first),first)
})
test('LF normalization preserves identity',()=>{const first=buildEvidenceBundle(input,adapters());files.set('supabase/migrations/20260828000000_x.sql','select 1;\n');const second=buildEvidenceBundle(input,adapters());assert.equal(first.bundle_id,second.bundle_id)})
test('changing any content, claim or order changes identity',()=>{
  const first=buildEvidenceBundle(input,adapters())
  files.set('tests/focused.sql','changed\n');assert.notEqual(first.bundle_id,buildEvidenceBundle(input,adapters()).bundle_id);files.set('tests/focused.sql','ok\n')
  assert.notEqual(first.bundle_id,buildEvidenceBundle({...input,writes:['table test.c']},adapters()).bundle_id)
  assert.notEqual(first.bundle_id,buildEvidenceBundle({...input,migrationOrderDigest:sha256('other')},adapters()).bundle_id)
})
test('dirty, missing, unknown and mismatched evidence fails closed',()=>{
  assert.throws(()=>buildEvidenceBundle(input,adapters({isClean:()=>false})),/clean/)
  assert.throws(()=>buildEvidenceBundle({...input,focusedFiles:['missing']},adapters()),/missing/)
  const bundle=buildEvidenceBundle(input,adapters());bundle.extra=true;assert.throws(()=>validateEvidenceBundle(bundle),/unknown/)
  delete bundle.extra;bundle.bundle_id='0'.repeat(64);assert.throws(()=>validateEvidenceBundle(bundle),EvidenceBundleError)
})
test('import discovery finds executable helpers and fails when inventory omits them',()=>{
  const discovered=discoverModuleImports(['scripts/guard.mjs'],adapters());assert.deepEqual(discovered,['scripts/guard.mjs','scripts/helper.mjs'])
  const inventory=new Set(JSON.parse(files.get('config/orchestrator-global-invalidators-v1.json')).files)
  assert.deepEqual(discovered.filter((file)=>!inventory.has(file)),['scripts/helper.mjs'])
})
test('real invalidator inventory names only existing files and covers manager import closure',()=>{
  const inventory=JSON.parse(readFileSync('config/orchestrator-global-invalidators-v1.json','utf8'))
  for(const file of inventory.files)assert.doesNotThrow(()=>readFileSync(file))
  const realAdapters={readFile:(file)=>readFileSync(file,'utf8'),fileExists:(file)=>{try{readFileSync(file);return true}catch{return false}}}
  const closure=discoverModuleImports(['scripts/manage-migration-author-lanes.mjs'],realAdapters)
  assert.ok(closure.includes('scripts/lib/review-verdict-artifact.mjs'),'verdict artifact policy must stay inside manager import closure')
  assert.ok(inventory.files.includes('scripts/lib/review-verdict-artifact.mjs'),'verdict artifact policy must invalidate reviewed evidence globally')
  const uncovered=closure.filter((file)=>!inventory.files.includes(file)&&!file.startsWith('scripts/orchestrator-flow/'))
  assert.deepEqual(uncovered,[])
})
