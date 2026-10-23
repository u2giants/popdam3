import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateManifest, manifestDigest, verifyRequirementSource, LIMITS } from './designflow-db-release.mjs';
const content = '-- synthetic only\nSELECT 1;\n';
const hash = text => createHash('sha256').update(text).digest('hex');
function manifest() { return { schema_version:1,repository:'popcre/designflow-tracking',production_project_ref:'qsllyeztdwjgirsysgai',
 requirements:[{work_issue:4646,source_pr:4653,migrations:[{version:'20261022194647',path:'supabase/migrations/20261022194647_dflow_prod_tracking.sql',sha256:hash(content)}]}],
 contracts:[{schema:'dflow_prod',relation:'prod_order_milestone_schedule',columns:['id','stage_name'],privileges:[{role:'designflow_prod_tracking_grants',privileges:['SELECT','INSERT','UPDATE']}]}] }; }
function facts() { const m=manifest(); return {repository:'popcre/shared-db',base_branch:'main',merged:true,source_pr:4653,work_issue:4646,
 head_sha40:'a'.repeat(40),merge_sha40:'b'.repeat(40),merge_in_main:true,files:[{path:m.requirements[0].migrations[0].path,content},{path:'docs/synthetic.md',content:'ignored nonmigration'}]}; }
const bad = (change, pattern) => { const m=manifest();change(m);assert.throws(()=>validateManifest(m),pattern || TypeError); };
test('returns deep immutable copies and deterministic digest independent of object key order',()=>{
 const input=manifest(),m=validateManifest(input);assert.deepEqual(m,input);assert.notEqual(m,input);
 for(const v of [m,m.requirements,m.requirements[0],m.requirements[0].migrations[0],m.contracts[0].privileges[0].privileges])assert.ok(Object.isFrozen(v));
 assert.throws(()=>m.contracts[0].columns.push('x'),TypeError);input.contracts[0].columns.push('later');assert.equal(m.contracts[0].columns.length,2);
 const reordered=Object.fromEntries(Object.entries(manifest()).reverse());assert.equal(manifestDigest(manifest()),manifestDigest(reordered));
 const changed=manifest();changed.contracts[0].columns.push('other');assert.notEqual(manifestDigest(manifest()),manifestDigest(changed));
});
test('only six repository identities; no requirement is needed for an empty frontend manifest',()=>{
 for(const name of ['backend','bff','frontend','item-master','tracking','data-syncing']){const m=manifest();m.repository=`popcre/designflow-${name}`;validateManifest(m);}
 const m=manifest();m.repository='popcre/designflow-frontend';m.requirements=[];m.contracts=[];validateManifest(m);
});
for(const [name,change] of [
 ['wrong target',m=>m.production_project_ref='xupnyeifmpsacrqahwwm'],
 ['fork',m=>m.repository='attacker/designflow-tracking'],
 ['wrong repository',m=>m.repository='popcre/shared-db'],
 ['wrong version',m=>m.schema_version=2],
 ['unknown field',m=>m.command='echo no'],
 ['manifest source boolean',m=>m.merged=true],
 ['SQL field',m=>m.contracts[0].sql='DROP TABLE example'],
 ['nested command field',m=>m.requirements[0].migrations[0].command='anything'],
 ['wrong schema',m=>m.contracts[0].schema='pg_catalog'],
 ['SQL relation',m=>m.contracts[0].relation='x;SELECT 1'],
 ['SQL column',m=>m.contracts[0].columns=['id FROM other']],
 ['blank column',m=>m.contracts[0].columns=['']],
 ['unsupported privilege',m=>m.contracts[0].privileges[0].privileges=['TRUNCATE']],
 ['duplicate privilege',m=>m.contracts[0].privileges[0].privileges=['SELECT','SELECT']],
 ['duplicate role',m=>m.contracts[0].privileges.push({...m.contracts[0].privileges[0]})],
 ['duplicate column',m=>m.contracts[0].columns.push('id')],
 ['duplicate relation',m=>m.contracts.push(structuredClone(m.contracts[0]))],
 ['duplicate issue',m=>m.requirements.push({...structuredClone(m.requirements[0]),source_pr:4654})],
 ['duplicate PR',m=>m.requirements.push({...structuredClone(m.requirements[0]),work_issue:4647})],
 ['duplicate version across issues',m=>m.requirements.push({...structuredClone(m.requirements[0]),work_issue:4647,source_pr:4654})],
 ['duplicate path',m=>m.requirements[0].migrations.push({...m.requirements[0].migrations[0]})],
 ['noninteger issue',m=>m.requirements[0].work_issue=1.5],
 ['unsafe issue',m=>m.requirements[0].work_issue=Number.MAX_SAFE_INTEGER+1],
 ['zero PR',m=>m.requirements[0].source_pr=0],
 ['string PR',m=>m.requirements[0].source_pr='4653'],
 ['version not fourteen digits',m=>m.requirements[0].migrations[0].version='2026'],
 ['version path mismatch',m=>m.requirements[0].migrations[0].version='20261022194648'],
 ['uppercase digest',m=>m.requirements[0].migrations[0].sha256='A'.repeat(64)],
 ['short digest',m=>m.requirements[0].migrations[0].sha256='a'.repeat(63)],
 ['absolute migration path',m=>m.requirements[0].migrations[0].path='/supabase/migrations/20261022194647_a.sql'],
 ['traversal path',m=>m.requirements[0].migrations[0].path='supabase/migrations/20261022194647_../../a.sql'],
 ['command path',m=>m.requirements[0].migrations[0].path='supabase/migrations/20261022194647_a$(id).sql'],
 ['missing fields',m=>delete m.contracts],
 ['empty required migration set',m=>m.requirements[0].migrations=[]],
 ['nonplain object',m=>m.contracts[0]=new Date()],
 ['null prototype',m=>m.contracts[0]=Object.assign(Object.create(null),m.contracts[0])],
 ['sparse array',m=>delete m.contracts[0].columns[0]],
 ['decorated array',m=>m.contracts.extra=true],
 ['excess contracts',m=>m.contracts=Array.from({length:LIMITS.contracts+1},()=>m.contracts[0])],
 ['oversize bytes',m=>m.command='x'.repeat(LIMITS.manifestBytes)],
])test(`rejects ${name}`,()=>bad(change));
test('rejects dangerous parsed object keys, symbols, getters, cycles and nonfinite numbers without invoking methods',()=>{
 for(const key of ['__proto__','prototype','constructor']){
  const m=manifest();Object.defineProperty(m.requirements[0],key,{value:{polluted:true},enumerable:true});assert.throws(()=>validateManifest(m),/prototype/);
 }
 const m=manifest();let invoked=false;Object.defineProperty(m,'repository',{get(){invoked=true;return 'popcre/designflow-tracking';},enumerable:true});
 assert.throws(()=>validateManifest(m),/accessor/);assert.equal(invoked,false);
 bad(m=>m[Symbol('hidden')]=true);bad(m=>Object.defineProperty(m,'hidden',{value:true}));
 bad(m=>m.contracts[0].columns=m.contracts);bad(m=>m.schema_version=NaN);
 assert.equal({}.polluted,undefined);
});
test('verifies exact canonical PR source and ignores nonmigration files; result is frozen copy',()=>{
 const r=manifest().requirements[0],s=facts(),verified=verifyRequirementSource(r,s);
 assert.deepEqual(verified,r);assert.notEqual(verified,r);assert.ok(Object.isFrozen(verified.migrations[0]));
});
for(const [name,change] of [
 ['source fork',s=>s.repository='fork/shared-db'],
 ['wrong base',s=>s.base_branch='develop'],
 ['unmerged',s=>s.merged=false],
 ['string merged flag',s=>s.merged='true'],
 ['merge not in main',s=>s.merge_in_main=false],
 ['different source PR',s=>s.source_pr=999],
 ['different work issue',s=>s.work_issue=999],
 ['short head SHA',s=>s.head_sha40='a'.repeat(39)],
 ['uppercase merge SHA',s=>s.merge_sha40='A'.repeat(40)],
 ['hash drift',s=>s.files[0].content+='-- changed'],
 ['missing declared migration',s=>s.files.shift()],
 ['omitted authored migration',s=>s.files.push({path:'supabase/migrations/20261022194648_extra.sql',content:'SELECT 2;'} )],
 ['duplicate source path',s=>s.files.push({...s.files[0]})],
 ['duplicate source version',s=>s.files.push({path:'supabase/migrations/20261022194647_other.sql',content:'SELECT 2;'} )],
 ['malformed canonical SQL path',s=>s.files.push({path:'supabase/migrations/invalid.sql',content:'SELECT 2;'} )],
 ['source content wrong type',s=>s.files[0].content={sql:'SELECT 1;'}],
 ['source executable field',s=>s.command='anything'],
 ['file SQL field',s=>s.files[0].sql='SELECT 1;'],
 ['file traversal',s=>s.files[1].path='../README.md'],
 ['too many source files',s=>s.files=Array.from({length:LIMITS.files+1},(_,i)=>({path:`docs/${i}.md`,content:''}))],
 ['huge source content',s=>s.files[0].content='x'.repeat(LIMITS.contentBytes+1)],
])test(`source refuses ${name}`,()=>{
 const s=facts();change(s);assert.throws(()=>verifyRequirementSource(manifest().requirements[0],s),TypeError);
});
test('rejects declaration of extra migration not authored by PR even when count matches',()=>{
 const r=manifest().requirements[0];r.migrations[0].path='supabase/migrations/20261022194647_unrelated.sql';
 assert.throws(()=>verifyRequirementSource(r,facts()),/source\/hash mismatch/);
});
test('authored byte hash is exact including newline and Unicode; LF/CRLF drift fails',()=>{
 const r=manifest().requirements[0],s=facts();s.files[0].content='-- café\nSELECT 1;\n';r.migrations[0].sha256=hash(s.files[0].content);
 verifyRequirementSource(r,s);s.files[0].content=s.files[0].content.replaceAll('\n','\r\n');assert.throws(()=>verifyRequirementSource(r,s),/hash mismatch/);
});
