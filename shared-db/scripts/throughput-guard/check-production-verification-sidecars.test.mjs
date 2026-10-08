import test from 'node:test';import assert from 'node:assert/strict';import path from'node:path';import{fileURLToPath}from'node:url';import{resolveBase,changedMigrationVersions,MANDATORY_VERSIONS,verifyBaseline,verifyHistoricalInventory,run}from'../check-production-verification-sidecars.mjs';
test('base resolution fails closed',()=>{assert.equal(resolveBase({candidateRefs:['origin/main'],git:()=>true}),'origin/main');assert.throws(()=>resolveBase({candidateRefs:['bad'],git:()=>false}),/UNVERIFIABLE/)});
test('changed migrations and deleted sidecars are version keyed',()=>{const git=args=>args[0]==='merge-base'?'abc\n':args.includes('--diff-filter=D')?'scripts/production-verification-sidecars/20260102000000.json\n':'supabase/migrations/20260101000000_x.sql\n';assert.deepEqual(changedMigrationVersions('origin/main',git),['20260101000000','20260102000000']);assert.ok(MANDATORY_VERSIONS.includes('20260825082910'))});
test('reviewed baseline recomputes the detector migration inventory',()=>assert.doesNotThrow(()=>verifyBaseline(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'))));
test('historical baseline allows additions but rejects changed historical markers',()=>{const baseline={total_migration_files:2,matched_count:1,matched_paths:[{version:'1',path:'supabase/migrations/1_x.sql',marker_count:1}]};assert.doesNotThrow(()=>verifyHistoricalInventory(baseline,{total_migration_files:3,matched_paths:[...baseline.matched_paths,{version:'2',path:'supabase/migrations/2_y.sql',marker_count:1}]}));assert.throws(()=>verifyHistoricalInventory(baseline,{total_migration_files:3,matched_paths:[{...baseline.matched_paths[0],marker_count:2}]}),/historical baseline/)});
test('merge_group base resolution fetches the branch when no remote tracking ref exists (#3280)',()=>{const seen=[];const git=args=>args[0]==='rev-parse'&&args.includes('FETCH_HEAD');assert.equal(resolveBase({candidateRefs:['origin/main'],git,fetchRef:args=>{seen.push(args.join(' '));return true}}),'FETCH_HEAD');assert.deepEqual(seen,['fetch --no-tags origin main']);assert.throws(()=>resolveBase({candidateRefs:['origin/main'],git:()=>false,fetchRef:()=>false}),/UNVERIFIABLE/)});
test('run() with an explicit --base resolves it through the merge_group fetch fallback, and still fails closed (#3280 round 2)',()=>{const calls=[];const gitText=args=>{calls.push(args.join(' '));if(args[0]==='rev-parse'&&args.includes('origin/main'))throw new Error('no such ref');if(args[0]==='fetch')return '';if(args[0]==='rev-parse')return 'FETCH_HEAD';if(args[0]==='merge-base')return 'abc';return ''};let invoked=null;run(['--base','origin/main'],{gitText,invoke:(cmd,values)=>{invoked=values}});assert.ok(calls.includes('fetch --no-tags origin main'),'an explicit --base never reached the fetch fallback: '+JSON.stringify(calls));assert.ok(invoked,'the sidecar scanner was never invoked');const dead=args=>{if(args[0]==='rev-parse')throw new Error('no such ref');if(args[0]==='fetch')throw new Error('offline');return ''};assert.throws(()=>run(['--base','origin/main'],{gitText:dead,invoke:()=>{}}),/UNVERIFIABLE/)});

import {execFileSync,spawnSync} from 'node:child_process'
import {cpSync,mkdirSync,mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
test('protected sidecar executable rejects malformed PR sidecar data without importing PR Python',()=>{
 const actualRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
 const directory=mkdtempSync(path.join(tmpdir(),'protected-sidecar-data-')),source=path.join(directory,'source'),data=path.join(directory,'data'),marker=path.join(directory,'executed')
 const git=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
 const init=root=>{mkdirSync(root,{recursive:true});git(root,['init','-q']);git(root,['config','user.name','Test']);git(root,['config','user.email','test@example.invalid'])}
 try {
  init(source);for(const name of ['scripts','config'])cpSync(path.join(actualRoot,name),path.join(source,name),{recursive:true})
  mkdirSync(path.join(source,'docs/verification'),{recursive:true});cpSync(path.join(actualRoot,'docs/verification/throughput-guard-truth-baseline-20260828.json'),path.join(source,'docs/verification/throughput-guard-truth-baseline-20260828.json'))
  git(source,['add','.']);git(source,['commit','-qm','protected source']);const sourceSha=git(source,['rev-parse','HEAD'])
  init(data);for(const name of ['supabase','config'])cpSync(path.join(actualRoot,name),path.join(data,name),{recursive:true})
  mkdirSync(path.join(data,'scripts'),{recursive:true});cpSync(path.join(actualRoot,'scripts/production-verification-sidecars'),path.join(data,'scripts/production-verification-sidecars'),{recursive:true})
  git(data,['add','.']);git(data,['commit','-qm','actual data']);git(data,['update-ref','refs/remotes/origin/main','HEAD'])
  for(const name of ['production_catalog_verification.py','check_production_verification_sidecars.py'])writeFileSync(path.join(data,'scripts',name),`from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('executed')\n`)
  git(data,['add','.']);git(data,['commit','-qm','untrusted executable files as data'])
  const valid=spawnSync(process.execPath,[path.join(source,'scripts/check-production-verification-sidecars.mjs'),'--base','origin/main','--data-root',data,'--head-sha',git(data,['rev-parse','HEAD']),'--source-sha',sourceSha],{cwd:data,encoding:'utf8',env:{...process.env,GITHUB_REPOSITORY:'popcre/shared-db'}})
  assert.equal(valid.status,0,valid.stdout+valid.stderr)
  assert.equal(existsSync(marker),false,'PR Python code executed for valid data')
  writeFileSync(path.join(data,'scripts/production-verification-sidecars/20260621151155.json'),'{malformed')
  git(data,['add','.']);git(data,['commit','-qm','bad sidecar data'])
  const result=spawnSync(process.execPath,[path.join(source,'scripts/check-production-verification-sidecars.mjs'),'--base','origin/main','--data-root',data,'--head-sha',git(data,['rev-parse','HEAD']),'--source-sha',sourceSha],{cwd:data,encoding:'utf8',env:{...process.env,GITHUB_REPOSITORY:'popcre/shared-db'}})
  assert.notEqual(result.status,0,result.stdout+result.stderr)
  assert.match(result.stdout+result.stderr,/sidecar|JSON|property name|malformed/i)
  assert.doesNotMatch(result.stdout+result.stderr,/PR data boundary|No such file|ModuleNotFoundError/)
  assert.equal(existsSync(marker),false,'PR Python code executed')
  assert.equal(git(source,['status','--porcelain']),'','protected source was mutated')
  assert.equal(git(source,['rev-parse','HEAD']),sourceSha)
 } finally {rmSync(directory,{recursive:true,force:true})}
})
