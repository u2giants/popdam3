import test from 'node:test'
import assert from 'node:assert/strict'
import { paidStart, assertPaidReviewCapacity, pauseActualReviewFailure, derivePaidContentProof } from './review-circuit-breaker.mjs'
const head='a'.repeat(40), next='b'.repeat(40), digest='c'.repeat(64)
const request={issue:3536,pr:4000,headSha:head,slot:1}
function row(seq=1,h=head,slot=1){return{ref:`refs/db-review-started/3536-4000-${h}-slot${slot}-seq${seq}`,sha:String(seq).padStart(40,'0')}}
function message(seq=1,h=head,slot=1){return`db-coordination review-started issue=3536 pr=4000 head=${h} slot=${slot} sequence=${seq} reviewer=glm-5.3 at=2026-10-06T18:00:00.000Z`}
function io(rows){return{listRefs:()=>rows,getCommit:sha=>({message:message(Number(sha))}),reviewContentComparison:()=>({before:digest,after:digest,budgetProof:{schema:1,before:head,after:next,protectedMain:head,kind:'unchanged'}})}}
test('zero and one paid attempts retain capacity',()=>{assert.equal(assertPaidReviewCapacity(request,io([])).remaining,2);assert.equal(assertPaidReviewCapacity(request,io([row()])).remaining,1)})
test('third paid draw refuses unchanged exact head',()=>assert.throws(()=>assertPaidReviewCapacity(request,io([row(),row(2)])),/third draw refused/))
test('evidence-only or empty-head refresh cannot reset cap',()=>assert.throws(()=>assertPaidReviewCapacity({...request,headSha:next},io([row(),row(2)])),/third draw refused/))
test('substantive byte change starts another round',()=>{const x=io([row(),row(2)]);x.reviewContentComparison=()=>({before:digest,after:'d'.repeat(64),budgetProof:{schema:1,before:head,after:next,protectedMain:head,kind:'substantive',historyCount:1}});assert.equal(assertPaidReviewCapacity({...request,headSha:next},x).remaining,2)})
test('unknown, malformed and failed comparison cannot reset',()=>{for(const proof of [null,{before:'unknown',after:digest}]){const x=io([row(),row(2)]);x.reviewContentComparison=()=>proof;assert.throws(()=>assertPaidReviewCapacity({...request,headSha:next},x),/proof unreadable/)}const x=io([row()]);x.reviewContentComparison=()=>{throw Error('fetch failed')};assert.throws(()=>assertPaidReviewCapacity({...request,headSha:next},x),/fetch failed/)})
test('independent slots have separate paid caps',()=>{const x=io([row(1,head,2),row(2,head,2)]);x.getCommit=sha=>({message:message(Number(sha),head,2)});assert.equal(assertPaidReviewCapacity(request,x).remaining,2)})
test('tampered scope, time or record refuses',()=>{for(const text of [message().replace('pr=4000','pr=4001'),message().replace('2026-10-06T18:00:00.000Z','unknown'),'PASS doctor repaired'])assert.throws(()=>paidStart(row(),{message:text}),/binding mismatch|unrecognized/)})
test('unstarted atomic reclaim is not a paid attempt',()=>{const text=`db-coordination reviewer-silence-release reviewer=glm-5.3 issue=3536 pr=4000 head=${head} sequence=1 code=silent_worker_observed probe=${'e'.repeat(40)} observed-at=2026-10-06T17:00:00Z confirmed-at=2026-10-06T18:00:00Z verdict=none artifact=none replacement=none`;assert.equal(paidStart(row(),{message:text}),null);assert.throws(()=>paidStart(row(),{message:text.replace('sequence=1','sequence=2')}),/unrecognized/)})
test('quoted or repeated doctor PASS never provides a reset',()=>{const x=io([row(),row(2)]);x.reinstatement=()=>({output:'PASS',fresh:true});assert.throws(()=>assertPaidReviewCapacity(request,x),/third draw refused/)})

test('pre-start independent-slot conflict is skipped only with exact scope',()=>{
 const text=`db-coordination reviewer-failure-replacement sequence=3 reviewer=stepfun-step-5-preview issue=3536 pr=4000 head=${head} slot=1 failed-sequence=1 prior-sequence=2 failure-ref=self failed-reviewer=glm-5.3 code=slot_independence_conflict verdict=none artifact=none`
 assert.equal(paidStart(row(),{message:text}),null)
 assert.throws(()=>paidStart(row(),{message:text.replace('slot=1','slot=2')}),/unrecognized/)
 assert.throws(()=>paidStart(row(),{message:text.replace('slot_independence_conflict','provider_unavailable')}),/unrecognized/)
})

test('changing work issue cannot reset the same PR paid cap',()=>{
 const x=io([row(),row(2)])
 assert.throws(()=>assertPaidReviewCapacity({...request,issue:3537},x),/third draw refused/)
})

test('actual quota/outage release pauses only exact paid provider failure',()=>{
 const record={...request,failedSequence:1,reviewer:'glm-5.3',failureCode:'insufficient_quota',failureSha:'f'.repeat(40)}
 const release=`db-coordination reviewer-failure-release reviewer=glm-5.3 issue=3536 pr=4000 head=${head} failed-sequence=1 code=insufficient_quota verdict=none artifact=none replacement=none`
 let paused=0
 const x={readPaidReviewStarts:()=>[{...row(),commit:{message:message()}}],getCommit:()=>({message:release,committedDate:'2026-10-06T18:00:00Z'}),pauseReviewerFailure:r=>{assert.deepEqual(r,{...record,observedEpoch:1791309600});paused++}}
 assert.equal(pauseActualReviewFailure(record,x).paused,true);assert.equal(paused,1)
 assert.equal(pauseActualReviewFailure({...record,failureCode:'local_dependency_unavailable'},x).paused,false)
 assert.equal(pauseActualReviewFailure({...record,failureCode:'wrapper_terminal_failure'},x).paused,false)
 assert.equal(pauseActualReviewFailure({...record,failedSequence:2},x).paused,false)
 assert.throws(()=>pauseActualReviewFailure(record,{...x,getCommit:()=>({message:release.replace('head='+head,'head='+next)})}),/binding mismatch/)
})

test('inline replacement pauses actual failed provider using immutable self failure',()=>{
 const record={...request,failedSequence:1,failureCode:'provider_unavailable',failureSha:'f'.repeat(40)}
 const failure=`db-coordination reviewer-failure-replacement sequence=2 reviewer=muse-spark-1.3-contributor issue=3536 pr=4000 head=${head} slot=1 failed-sequence=1 prior-sequence=1 failure-ref=self failed-reviewer=glm-5.3 code=provider_unavailable verdict=none artifact=none`
 let paused=0
 const x={readPaidReviewStarts:()=>[{...row(),commit:{message:message()}}],readReviewFailureCommit:()=>({message:failure,committedDate:'2026-10-06T18:00:00Z'}),getCommit:()=>{throw Error('wire read forbidden')},pauseReviewerFailure:r=>{assert.equal(r.reviewer,'glm-5.3');paused++}}
 assert.equal(pauseActualReviewFailure(record,x).paused,true);assert.equal(paused,1)
})

test('all historical substantive comparisons share one operation base context',()=>{
 const x=io([row(),row(2)]);let shared,calls=0
 x.reviewContentComparison=(before,after,pr,context)=>{calls++;if(shared)assert.equal(context,shared);else shared=context;return{before:digest,after:'d'.repeat(64),budgetProof:{schema:1,before:head,after:next,protectedMain:head,kind:'substantive',historyCount:1}}}
 assert.equal(assertPaidReviewCapacity({...request,headSha:next},x).remaining,2);assert.equal(calls,2)
})

test('provider pause refuses unknown immutable timestamp and reports expired original window honestly',()=>{
 const record={...request,failedSequence:1,failureCode:'provider_unavailable',failureSha:'f'.repeat(40)}
 const messageFailure=`db-coordination reviewer-failure-release reviewer=glm-5.3 issue=3536 pr=4000 head=${head} failed-sequence=1 code=provider_unavailable verdict=none artifact=none replacement=none`
 const x={readPaidReviewStarts:()=>[{...row(),commit:{message:message()}}],readReviewFailureCommit:()=>({message:messageFailure}),pauseReviewerFailure:()=>assert.fail('unknown timestamp must never invoke public pause')}
 assert.throws(()=>pauseActualReviewFailure(record,x),/timestamp unreadable/)
 x.readReviewFailureCommit=()=>({message:messageFailure,committedDate:'2026-10-06T18:00:00Z'})
 x.pauseReviewerFailure=r=>{assert.equal(r.observedEpoch,1791309600);return{status:'expired',provider:'glm',observed_epoch:r.observedEpoch,expires_epoch:r.observedEpoch+3600}}
 const result=pauseActualReviewFailure(record,x);assert.equal(result.paused,false);assert.equal(result.reason,'original failure window expired')
})

test('exact row ceiling and malformed PR cannot be accepted as complete paid history',()=>{
 assert.throws(()=>assertPaidReviewCapacity(request,io(Array.from({length:1000},()=>row()))),/may be truncated/)
 for(const pr of [NaN,'4000',0,-1])assert.throws(()=>assertPaidReviewCapacity({...request,pr},io([])),/exact positive PR/)
})

import {execFileSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,chmodSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
function realGitFixture(t) {
 const dir=mkdtempSync(path.join(tmpdir(),'review-budget-git-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']})
 git(['init','-q','-b','main']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test']);git(['config','core.fileMode','false']);git(['config','core.autocrlf','false']);git(['config','core.eol','lf'])
 const commit=(file,text)=>{writeFileSync(path.join(dir,file),text);git(['add',file]);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']).trim()}
 const base=commit('app.txt','context\nseparator1\nseparator2\nauthor\nend\n');git(['switch','-qc','feature'])
 const before=commit('app.txt','context\nseparator1\nseparator2\nfixed\nend\n')
 return {git,commit,base,before,dir}
}
test('real Git main-context merge retains two spent attempts despite changed review context',t=>{
 const f=realGitFixture(t);f.git(['switch','main']);const main=f.commit('app.txt','new context\nseparator1\nseparator2\nauthor\nend\n')
 f.git(['switch','feature']);f.git(['merge','-qm','main refresh','main']);const after=f.git(['rev-parse','HEAD']).trim()
 const proof=derivePaidContentProof(f.before,after,main,f.git)
 assert.equal(proof.kind,'unchanged')
 const rows=[1,2].map(n=>({...row(n,f.before),commit:{message:message(n,f.before)}}))
 assert.throws(()=>assertPaidReviewCapacity({...request,headSha:after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}),/third draw refused/)
})
test('real Git genuine author fix resets while net revert and empty commits retain budget',t=>{
 const f=realGitFixture(t);const changed=f.commit('app.txt','context\nrepaired\nend\n')
 assert.equal(derivePaidContentProof(f.before,changed,f.base,f.git).kind,'substantive')
 const reverted=f.commit('app.txt','context\nseparator1\nseparator2\nfixed\nend\n')
 assert.equal(derivePaidContentProof(f.before,reverted,f.base,f.git).kind,'unchanged')
 f.git(['commit','--allow-empty','-qm','empty']);assert.equal(derivePaidContentProof(f.before,f.git(['rev-parse','HEAD']).trim(),f.base,f.git).kind,'unchanged')
})
test('real Git foreign feature merge and rewritten differing history refuse reset',t=>{
 const f=realGitFixture(t);f.git(['switch','-qc','foreign',f.base]);f.commit('foreign.txt','foreign source')
 f.git(['switch','feature']);f.git(['merge','-qm','foreign merge','foreign']);const after=f.git(['rev-parse','HEAD']).trim()
 assert.throws(()=>derivePaidContentProof(f.before,after,f.base,f.git),/foreign merge/)
 f.git(['switch','-qc','rewritten',f.base]);const rewritten=f.commit('app.txt','context\nother fix\nend\n')
 assert.throws(()=>derivePaidContentProof(f.before,rewritten,f.base,f.git),/provenance refused/)
})

test('real Git evidence-only changes retain count and missing proof cannot reset',t=>{
 const f=realGitFixture(t);const evidence=f.commit('evidence.json','evidence')
 assert.equal(derivePaidContentProof(f.before,evidence,f.base,f.git,['evidence.json']).kind,'unchanged')
 const x=io([row(),row(2)]);x.reviewContentComparison=()=>({before:digest,after:'d'.repeat(64),doctor:'PASS'})
 assert.throws(()=>assertPaidReviewCapacity({...request,headSha:next},x),/provenance proof unreadable/)
})
test('complete bounded history refuses the 1000 boundary',t=>{
 const f=realGitFixture(t);const changed=f.commit('app.txt','substantive')
 const git=args=>args[0]==='rev-list'&&args.includes('--max-count=1001')?Array.from({length:1001},(_,i)=>i===1000?f.before:changed).join('\n'):f.git(args)
 assert.throws(()=>derivePaidContentProof(f.before,changed,f.base,git),/complete first-parent ancestry/)
})

test('production public Git IO derives budget proof from a real clean main-only merge',t=>{
 const f=realGitFixture(t);f.git(['switch','main']);const main=f.commit('app.txt','new context\nseparator1\nseparator2\nauthor\nend\n')
 f.git(['switch','feature']);f.git(['merge','-qm','refresh','main']);const after=f.git(['rev-parse','HEAD']).trim()
 f.git(['remote','add','origin',f.dir])
 const moduleUrl=new URL('../../manage-migration-author-lanes.mjs',import.meta.url).href
 const script=`import {githubIo} from ${JSON.stringify(moduleUrl)};const p=githubIo.reviewContentComparison(${JSON.stringify(f.before)},${JSON.stringify(after)},4000,{base:${JSON.stringify(main)}});console.log(JSON.stringify(p))`
 const proof=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:f.dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}))
 assert.notEqual(proof.before,proof.after);assert.equal(proof.budgetProof.kind,'unchanged');assert.equal(proof.budgetProof.before,f.before);assert.equal(proof.budgetProof.after,after)
})

test('real Git source-equivalent rewrite preserves count while a custom merge refuses',t=>{
 const f=realGitFixture(t)
 f.git(['switch','-qc','equivalent',f.base]);const equivalent=f.commit('app.txt','context\nseparator1\nseparator2\nfixed\nend\n')
 assert.equal(derivePaidContentProof(f.before,equivalent,f.base,f.git).kind,'unchanged')
 f.git(['switch','main']);const main=f.commit('main-only.txt','main offset')
 f.git(['switch','feature']);f.git(['merge','--no-commit','main']);writeFileSync(path.join(f.dir,'custom.txt'),'custom merge source');f.git(['add','custom.txt']);f.git(['commit','-qm','custom merge'])
 const after=f.git(['rev-parse','HEAD']).trim()
 assert.throws(()=>derivePaidContentProof(f.before,after,main,f.git),/noncanonical/)
})
test('real Git offset-only main merge preserves count, but conflicting main ancestry refuses',t=>{
 const f=realGitFixture(t);f.git(['switch','main']);const main=f.commit('app.txt','inserted\ncontext\nseparator1\nseparator2\nauthor\nend\n')
 f.git(['switch','feature']);f.git(['merge','-qm','offset refresh','main']);const after=f.git(['rev-parse','HEAD']).trim()
 assert.equal(derivePaidContentProof(f.before,after,main,f.git).kind,'unchanged')
 f.git(['switch','main']);const conflict=f.commit('app.txt','inserted\ncontext\nseparator1\nseparator2\nmain conflicting edit\nend\n')
 f.git(['switch','feature']);assert.throws(()=>f.git(['merge','--no-commit','main']))
 writeFileSync(path.join(f.dir,'app.txt'),'manual conflicting resolution');f.git(['add','app.txt']);f.git(['commit','-qm','resolved conflict']);const resolved=f.git(['rev-parse','HEAD']).trim()
 assert.throws(()=>derivePaidContentProof(f.before,resolved,conflict,f.git),/provenance refused/)
})

function appendFixture(t,{repair=false,revert=false,reordered=false,omit=false,mode=false,oldLine=false}={}) {
 const dir=mkdtempSync(path.join(tmpdir(),'review-budget-append-real-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']})
 git(['init','-q','-b','main']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test'])
 git(['config','core.fileMode','false']);git(['config','core.autocrlf','false']);git(['config','core.eol','lf'])
 const file='scripts/manage-migration-author-lanes.test.mjs';mkdirSync(path.join(dir,'scripts'))
 const base='// protected baseline\n',ours="test('author append',()=>{});\n",theirs="test('main append',()=>{});\n"
 let modePending=false
 const commit=()=>{git(['add','.']);if(modePending){git(['update-index','--chmod=+x',file]);modePending=false}git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']).trim()}
 writeFileSync(path.join(dir,file),base);writeFileSync(path.join(dir,'app.txt'),'base source');commit()
 git(['switch','-qc','feature']);writeFileSync(path.join(dir,file),(oldLine?'// author old-line edit\n':base)+ours);writeFileSync(path.join(dir,'app.txt'),'implementation');const before=commit()
 if(repair){writeFileSync(path.join(dir,'app.txt'),'repaired source');commit()}
 if(revert){writeFileSync(path.join(dir,'app.txt'),'implementation');commit()}
 git(['switch','main']);writeFileSync(path.join(dir,file),(oldLine?'// main old-line edit\n':base)+theirs);modePending=mode;const main=commit()
 git(['switch','feature']);assert.throws(()=>git(['merge','--no-commit','main']))
 writeFileSync(path.join(dir,file),base+(reordered?theirs+ours:omit?ours:ours+theirs));const after=commit()
 return {git,before,after,main,file,dir}
}
test('canonical independent EOF test appends cannot reset two spent attempts',t=>{
 const f=appendFixture(t),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
 assert.equal(proof.kind,'unchanged');assert.equal(proof.canonicalAppends.length,1)
 const rows=[1,2].map(n=>({...row(n,f.before),commit:{message:message(n,f.before)}}))
 assert.throws(()=>assertPaidReviewCapacity({...request,headSha:f.after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}),/third draw refused/)
})
test('canonical test reconciliation permits only a surviving conflict-free author source fix',t=>{
 const f=appendFixture(t,{repair:true}),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
 assert.equal(proof.kind,'substantive');assert.equal(proof.witness.path,'app.txt');assert.equal(proof.canonicalAppends.length,2)
})
test('canonical appends plus net reverted author fix preserve count',t=>{
 const f=appendFixture(t,{repair:true,revert:true});assert.equal(derivePaidContentProof(f.before,f.after,f.main,f.git).kind,'unchanged')
})
test('reordered, omitted, old-line and mode-changing test conflict resolutions refuse',t=>{
 for(const option of ['reordered','omit','oldLine','mode']) {
  const f=appendFixture(t,{repair:true,[option]:true})
  assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/provenance refused/,option)
 }
})

test('production public Git IO reconciles exact test appends with surviving source witness',t=>{
 const f=appendFixture(t,{repair:true});f.git(['remote','add','origin',f.dir])
 const moduleUrl=new URL('../../manage-migration-author-lanes.mjs',import.meta.url).href
 const script=`import {githubIo} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(githubIo.reviewContentComparison(${JSON.stringify(f.before)},${JSON.stringify(f.after)},4000,{base:${JSON.stringify(f.main)}})))`
 const proof=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:f.dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}))
 assert.equal(proof.budgetProof.kind,'substantive');assert.equal(proof.budgetProof.witness.path,'app.txt')
 for(const r of proof.budgetProof.canonicalAppends){assert.equal(r.path,f.file);assert.match(r.base,/^[0-9a-f]{40}$/);assert.equal(r.parents.length,2);assert.equal(r.parentBlobs.length,3);assert.match(r.canonicalBlob,/^[0-9a-f]{40}$/)}
})
test('custom attributes and ambiguous marker bytes cannot reconcile a test conflict',t=>{
 const f=appendFixture(t,{repair:true})
 for(const attribute of ['merge=custom','filter=custom','working-tree-encoding=UTF-16']) {
  writeFileSync(path.join(f.dir,'.gitattributes'),`${f.file} ${attribute}\n`)
  assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/custom merge/)
 }
 rmSync(path.join(f.dir,'.gitattributes'))
 const bad=args=>args[0]==='show'&&String(args[1]).endsWith(':'+f.file)?f.git(args)+'<<<<<<< forged marker\n':f.git(args)
 assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,bad),/blob bytes unreadable/)
})

test('octopus and wrong protected-main provenance cannot authorize append repair',t=>{
 const f=appendFixture(t,{repair:true});const tree=f.git(['rev-parse',`${f.after}^{tree}`]).trim()
 f.git(['switch','-qc','foreign',f.before]);writeFileSync(path.join(f.dir,'foreign.txt'),'foreign');f.git(['add','foreign.txt']);f.git(['commit','-qm','foreign']);const foreign=f.git(['rev-parse','HEAD']).trim()
 const octopus=f.git(['commit-tree',tree,'-p',f.before,'-p',f.main,'-p',foreign,'-m','octopus']).trim()
 assert.throws(()=>derivePaidContentProof(f.before,octopus,f.main,f.git),/ambiguous merge/)
 assert.throws(()=>derivePaidContentProof(f.before,f.after,f.before,f.git),/foreign merge/)
})

test('ordinary conflict-free test-only author fixes retain mandatory fresh review capability',t=>{
 const f=realGitFixture(t);mkdirSync(path.join(f.dir,'scripts'));const file='scripts/manage-migration-author-lanes.test.mjs'
 const after=f.commit(file,"test('new authored regression',()=>{});\n")
 const proof=derivePaidContentProof(f.before,after,f.base,f.git)
 assert.equal(proof.kind,'substantive');assert.equal(proof.witness.path,file);assert.equal(proof.canonicalAppends.length,0)
})

test('actual Git link metadata and renamed test conflict ancestry refuse reconciliation',t=>{
 for(const kind of ['link','rename']) {
  const f=appendFixture(t,{repair:true});f.git(['read-tree',f.main])
  if(kind==='link') {
   const target=path.join(f.dir,'target-bytes');writeFileSync(target,'app.txt');const blob=f.git(['hash-object','-w',target]).trim()
   f.git(['update-index','--add','--cacheinfo',`120000,${blob},${f.file}`])
  } else {
   const blob=f.git(['rev-parse',`${f.main}:${f.file}`]).trim();f.git(['update-index','--force-remove',f.file]);f.git(['update-index','--add','--cacheinfo',`100644,${blob},scripts/renamed.test.mjs`])
  }
  const changedTree=f.git(['write-tree']).trim(),changedMain=f.git(['commit-tree',changedTree,'-p',f.main,'-m',kind]).trim()
  const actualTree=f.git(['rev-parse',`${f.after}^{tree}`]).trim(),after=f.git(['commit-tree',actualTree,'-p',f.after,'-p',changedMain,'-m','unexplained resolution']).trim()
  assert.throws(()=>derivePaidContentProof(f.before,after,changedMain,f.git),/provenance refused/,kind)
 }
})

test('actual Git executable-mode-only change cannot reset paid budget',t=>{
 const f=realGitFixture(t);f.git(['config','core.fileMode','false']);f.git(['update-index','--chmod=+x','app.txt']);f.git(['commit','-qm','mode only']);const after=f.git(['rev-parse','HEAD']).trim()
 assert.throws(()=>derivePaidContentProof(f.before,after,f.base,f.git),/surviving author source edit unavailable/)
})
test('actual surviving nonempty authored deletion remains eligible for fresh mandatory review',t=>{
 const f=realGitFixture(t);f.git(['rm','app.txt']);f.git(['commit','-qm','authored removal']);const after=f.git(['rev-parse','HEAD']).trim()
 const proof=derivePaidContentProof(f.before,after,f.base,f.git);assert.equal(proof.kind,'substantive');assert.equal(proof.witness.path,'app.txt');assert.equal(proof.witness.blob,'absent');assert.match(proof.witness.baselineBlob,/^[0-9a-f]{40}$/)
})
test('zero-byte added file supplies no surviving source byte witness',t=>{
 const f=realGitFixture(t);const after=f.commit('empty.txt','')
 assert.throws(()=>derivePaidContentProof(f.before,after,f.base,f.git),/surviving author source edit unavailable/)
})

import {contractHash} from '../../agent-work-contract.mjs'
import {verifiedEvidencePaths} from '../pr-content-equivalence.mjs'
function generationsFixture(t,{repair=true,revert=false,bad=null,publishedOnly=false,ordinaryRetirement=false,checkPrefix=false,prefixFailure=null}={}){
 const f=realGitFixture(t),sha=()=>f.git(['rev-parse','HEAD']).trim()
 const contract=(generation,parent)=>({schema_version:2,generation,work_issue:3536,work_type:'repo-maintenance',route:'repo-maintenance',goal:'Fixture source proof',base_sha:f.base,dispatcher:'fixture',worker:'fixture',branch:'feature',worktree:f.dir,allowed_paths:['app.txt','.agent/work/3536/**'],file_writes:['app.txt','.agent/work/3536/**'],db_reads:[],db_writes:[],prohibited_actions:[],required_checks:['fixture'],assumptions:[],stop_conditions:['Stop on unknown'],evidence_parent:parent})
 const root=contract(312,{work_issue:3536,generation:311,contract_sha256:'a'.repeat(64)})
 if(prefixFailure==='baseline')root.required_checks.push('fixture-second')
 const writePair=(c,implementation)=>{
  const dir=path.join(f.dir,`.agent/work/3536/${c.generation}`);mkdirSync(dir,{recursive:true})
  const report={schema_version:1,work_issue:3536,outcome:'ready-for-merge',pr:3999,migration_versions:[],contract_ref:`refs/db-contracts/3536/${c.generation}`,contract_sha256:contractHash(c),head_sha:implementation,base_sha:f.base,files_changed:['app.txt'],db_reads:[],db_writes:[],checks:[{command:'fixture',exit_code:0,evidence:'Controlled fixture'}],assumptions_resolved:[],stop_conditions_hit:[]}
  if(c.generation===317){if(bad==='hash')report.contract_sha256='b'.repeat(64);if(bad==='pr')report.pr=4000;if(bad==='issue')report.work_issue=3537;if(bad==='parent')c.evidence_parent.contract_sha256='b'.repeat(64)}
  writeFileSync(path.join(dir,'contract.json'),JSON.stringify(c));writeFileSync(path.join(dir,'completion.json'),JSON.stringify(report))
  if(c.generation===317 && bad==='missing')rmSync(path.join(dir,'completion.json'));if(c.generation===317 && bad==='tail'){writeFileSync(path.join(f.dir,'unrelated-tail.txt'),'not canonical evidence\n');f.git(['add','unrelated-tail.txt'])};f.git(['add',`.agent/work/3536/${c.generation}`]);if(c.generation===317 && bad==='mode'){f.git(['update-index','--chmod=+x','.agent/work/3536/317/completion.json']);chmodSync(path.join(dir,'completion.json'),0o755)};f.git(['commit','-qm','fixture exact pair']);return sha()
 }
 const finishPrefix=c=>{
  const file=path.join(f.dir,`.agent/work/3536/${c.generation}/completion.json`)
  const original=readFileSync(file,'utf8'),r=JSON.parse(original)
  if(prefixFailure==='no-complete')return
  if(prefixFailure==='changed-source')f.commit('app.txt','context\nseparator1\nseparator2\nintervening unbound source\nend\n')
  if(prefixFailure==='source-head')r.head_sha=f.commit('app.txt','context\nseparator1\nseparator2\ndifferent implementation\nend\n')
  r.checks=[{command:'fixture',exit_code:0,evidence:'Controlled fixture'},{command:'fixture-second',exit_code:0,evidence:'Completed unchanged-source check'}]
  if(prefixFailure==='evidence-drift')r.checks[0].evidence='Rewritten earlier evidence'
  if(prefixFailure==='reordered-checks')r.checks.reverse()
  if(prefixFailure==='report-field')r.assumptions_resolved=['New unrelated report fact']
  writeFileSync(file,JSON.stringify(r));f.git(['add',file]);f.git(['commit','-qm','complete only the same-source canonical check list'])
  if(prefixFailure==='revert-prefix'){writeFileSync(file,original);f.git(['add',file]);f.git(['commit','-qm','revert to incomplete prefix after completion'])}
 }
 const before=writePair(root,sha())
 if(prefixFailure==='baseline')finishPrefix(root)
 const published=contract(315,{work_issue:3536,generation:312,contract_sha256:contractHash(root)})
 const middle=contract(317,{work_issue:3536,generation:publishedOnly?315:312,contract_sha256:contractHash(publishedOnly?published:root)})
 if(checkPrefix)middle.required_checks.push('fixture-second')
 f.git(['rm','-r','.agent/work/3536/312']);f.git(['commit','-qm','retire baseline metadata']);writePair(middle,sha())
 if(checkPrefix){
  if(['failed-check','implementation-file'].includes(prefixFailure)){
   const file=path.join(f.dir,'.agent/work/3536/317/completion.json'),r=JSON.parse(readFileSync(file,'utf8'))
   if(prefixFailure==='failed-check')r.checks[0].exit_code=1
   else r.files_changed=[]
   writeFileSync(file,JSON.stringify(r));f.git(['add',file]);f.git(['commit','-qm','retain invalid preliminary record'])
  }
  finishPrefix(middle)
 }
 f.git(['switch','main']);const main=f.commit('app.txt','main context\nseparator1\nseparator2\nauthor\nend\n')
 f.git(['switch','feature']);if(ordinaryRetirement && ['unknownDeletion','foreignDeletion'].includes(bad)){
 const file=bad==='unknownDeletion'?'.agent/unknown-retired.txt':'.agent/work/3537/317/contract.json';mkdirSync(path.dirname(path.join(f.dir,file)),{recursive:true});f.commit(file,'unowned metadata\n');f.git(['rm',file]);f.git(['commit','-qm','ordinary unknown or foreign retirement'])
 };if(ordinaryRetirement && bad==='mutation'){
 const file='.agent/work/3536/317/contract.json';const mutated=JSON.parse(readFileSync(path.join(f.dir,file),'utf8'));mutated.goal='mutated generation';writeFileSync(path.join(f.dir,file),JSON.stringify(mutated));f.git(['add',file]);f.git(['commit','-qm','mutated historical generation'])
 };if(ordinaryRetirement){f.git(['rm','-r','.agent/work/3536/317']);f.git(['commit','-qm','ordinary owned intermediate retirement'])};f.git(['merge','--no-commit','main']);if(!ordinaryRetirement)f.git(['rm','-r','.agent/work/3536/317'])
 if(bad==='custom'){writeFileSync(path.join(f.dir,'app.txt'),'custom conflict content\n');f.git(['add','app.txt'])}
 f.git(['commit','-qm','main refresh and retire exact intermediate metadata'])
 const expected='main context\nseparator1\nseparator2\nfixed\nend\n'
 if(repair)f.commit('app.txt','main context\nseparator1\nseparator2\ngenuine safety repair\nend\n')
 if(revert)f.commit('app.txt',expected)
 const last=contract(319,{work_issue:3536,generation:317,contract_sha256:contractHash(middle)})
 if(prefixFailure==='endpoint')last.required_checks.push('fixture-second')
 const after=writePair(last,sha())
 return {...f,before,after,main,published,proof:()=>derivePaidContentProof(before,after,main,f.git,verifiedEvidencePaths(before,after,{gitRunner:f.git}),3999)}
}
test('actual repaired endpoint ignores preserved incomplete tail without authenticating removed bad pairs',t=>{
 const f=generationsFixture(t),dir=path.join(f.dir,'.agent/work/3536/319')
 const report=JSON.parse(readFileSync(path.join(dir,'completion.json'),'utf8'))
 const implementation=f.commit('app.txt','main context\nseparator1\nseparator2\nactual later authored repair\nend\n')
 report.head_sha=implementation
 writeFileSync(path.join(dir,'completion.json'),JSON.stringify(report));f.git(['add','.agent/work/3536/319/completion.json']);f.git(['commit','-qm','preserve incomplete completion-only tail'])
 const incomplete=f.git(['rev-parse','HEAD']).trim()
 writeFileSync(path.join(dir,'contract.json'),JSON.stringify(JSON.parse(readFileSync(path.join(dir,'contract.json'),'utf8')),null,4))
 report.files_changed=f.git(['diff','--name-only',f.base,implementation]).trim().split('\n').sort()
 writeFileSync(path.join(dir,'completion.json'),JSON.stringify(report,null,2));f.git(['add','.agent/work/3536/319']);f.git(['commit','-qm','exact canonical repaired endpoint tail'])
 const after=f.git(['rev-parse','HEAD']).trim()
 assert.equal(f.git(['diff','--name-only',implementation,incomplete]).trim(),'.agent/work/3536/319/completion.json')
 assert.equal(derivePaidContentProof(f.before,after,f.main,f.git,verifiedEvidencePaths(f.before,after,{gitRunner:f.git}),3999).kind,'substantive')
 assert.throws(()=>generationsFixture(t,{bad:'hash'}).proof(),/hash|completion/,'invalid removed317 remains refused')
})
test('ordinary owned pair retirement with canonical merge authenticates surviving repair',t=>{
 const f=generationsFixture(t,{ordinaryRetirement:true});assert.equal(f.proof().kind,'substantive')
})
test('removed intermediate successful check prefix needs a later complete identical-source tail',t=>{
 const f=generationsFixture(t,{checkPrefix:true,ordinaryRetirement:true}),proof=f.proof()
 assert.equal(proof.kind,'substantive');assert.equal(proof.witness.path,'app.txt')
 assert.equal(proof.supersededCheckPrefixes.length,1)
 const receipt=proof.supersededCheckPrefixes[0]
 assert.equal(receipt.generation,317);assert.match(receipt.provisionalReportJsonSha256,/^[0-9a-f]{64}$/)
 assert.notEqual(receipt.provisionalReportJsonSha256,receipt.completeReportJsonSha256)
})
for(const input of [{repair:false},{repair:true,revert:true}])test(`superseded check prefix cannot witness ${input.repair?'net-reverted':'unchanged'} source`,t=>{
 const proof=generationsFixture(t,{...input,checkPrefix:true,ordinaryRetirement:true}).proof()
 assert.equal(proof.kind,'unchanged');assert.equal(proof.witness,undefined)
})
for(const prefixFailure of ['failed-check','no-complete','changed-source','source-head','evidence-drift','reordered-checks','report-field','revert-prefix','implementation-file','baseline','endpoint'])test(`successful check-prefix supersession refuses ${prefixFailure}`,t=>{
 assert.throws(()=>generationsFixture(t,{checkPrefix:true,prefixFailure,ordinaryRetirement:true}).proof(),/historical|completion|hash|ancestor|tail|source|scope|identity|file proof/)
})
for(const [name,input] of [['metadata only',{repair:false}],['net reverted',{repair:true,revert:true}]])test(`ordinary canonical retirement keeps ${name} unchanged`,t=>{
 assert.equal(generationsFixture(t,{...input,ordinaryRetirement:true}).proof().kind,'unchanged')
})
for(const bad of ['hash','pr','issue','mode','custom','parent','missing','tail','mutation','unknownDeletion','foreignDeletion'])test(`ordinary canonical retirement refuses ${bad}`,t=>{
 assert.throws(()=>generationsFixture(t,{bad,ordinaryRetirement:true}).proof(),/historical|foreign|noncanonical|unverified|scope|ancestor|tail|hash|identity/)
})
test('ordinary canonical retirement refuses unrelated unknown agent metadata',t=>{
 const f=generationsFixture(t,{ordinaryRetirement:true});f.commit('.agent/unknown.txt','unowned metadata\n');const after=f.git(['rev-parse','HEAD']).trim()
 assert.throws(()=>derivePaidContentProof(f.before,after,f.main,f.git,verifiedEvidencePaths(f.before,after,{gitRunner:f.git}),3999),/unknown|unverified/)
})
test('actual Git312 to317 to319 authentic intermediate pair permits surviving source repair',t=>{
 const f=generationsFixture(t),proof=f.proof();assert.equal(proof.kind,'substantive');assert.equal(proof.witness.path,'app.txt')
 const starts=[1,2].map(n=>({...row(n,f.before),commit:{message:message(n,f.before)}}))
 assert.deepEqual(assertPaidReviewCapacity({...request,pr:3999,headSha:f.after},{readPaidReviewStarts:()=>starts.map(x=>({...x,ref:x.ref.replace('-4000-','-3999-'),commit:{message:x.commit.message.replace('pr=4000','pr=3999')}})),reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}),{paidAttempts:0,remaining:2})
})
for(const [name,input] of [['evidence/main only',{repair:false}],['net reverted repair',{repair:true,revert:true}]])test(`actual Git historical pairs never reset ${name}`,t=>{assert.equal(generationsFixture(t,input).proof().kind,'unchanged')})
for(const bad of ['hash','pr','issue','mode','custom'])test(`actual Git historical ${bad} forgery refuses fresh capacity`,t=>{assert.throws(()=>generationsFixture(t,{bad}).proof(),/historical|foreign|noncanonical|unverified|scope|ancestor|tail|hash|identity/)} )

import childProcess from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
import {githubIo,withReviewRequestBudget} from '../../manage-migration-author-lanes.mjs'
test('public Git budget authority reader is counted, cached, and cannot exceed its ceiling',t=>{
 const f=generationsFixture(t,{publishedOnly:true}),original=childProcess.execFileSync,oldCwd=process.cwd(),calls=[]
 const ref='refs/db-contracts/3536/315',message='fixture immutable contract\n\n'+JSON.stringify(f.published)
 childProcess.execFileSync=(command,args,opts)=>{
  if(command==='git' && args[0]==='fetch'){
   if(args.includes(ref)){calls.push('fetch');return ''}
   if(args.includes(f.before) && args.includes(f.after) && args.includes(f.main))return ''
   assert.fail('unexpected remote fetch')
  }
  if(command==='git' && args[0]==='ls-remote'){assert.equal(args.at(-1),ref);calls.push('ls-remote');return 'f'.repeat(40)+'\t'+ref+'\n'}
  if(command==='git' && args[0]==='show' && args.at(-1)==='FETCH_HEAD')return message
  return original(command,args,opts)
 }
 syncBuiltinESMExports();process.chdir(f.dir)
 try{
  assert.throws(()=>withReviewRequestBudget(()=>githubIo.reviewContentComparison(f.before,f.after,3999,{base:f.main}),1,'fixture-bound-reader'),/exhausted its derived 1-request budget before request 2/)
  assert.deepEqual(calls,['ls-remote'],'ref fetch refuses before exceeding ceiling')
  calls.length=0
  withReviewRequestBudget(budget=>{
   const context={base:f.main},first=githubIo.reviewContentComparison(f.before,f.after,3999,context),second=githubIo.reviewContentComparison(f.before,f.after,3999,context)
   assert.equal(first.budgetProof.kind,'substantive');assert.deepEqual(second.budgetProof,first.budgetProof)
   assert.equal(budget.count,2);assert.deepEqual(calls,['ls-remote','fetch'],'same immutable missing315 fetched once per comparison context')
  },25)
 }finally{process.chdir(oldCwd);childProcess.execFileSync=original;syncBuiltinESMExports()}
})
for(const failure of ['missing','hash','identity'])test(`immutable missing315 ${failure} refuses author budget`,t=>{
 const f=generationsFixture(t,{publishedOnly:true}),paths=verifiedEvidencePaths(f.before,f.after,{gitRunner:f.git})
 const read=ref=>{assert.equal(ref,'refs/db-contracts/3536/315');if(failure==='missing')throw Error('missing canonical contract ref');return {...f.published,...(failure==='hash'?{goal:'tampered contract'}:{work_issue:3537})}}
 assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git,paths,3999,read),/missing canonical|hash|identity|crosses issues/)
})

const producerPinFile='scripts/production_business_risk_gate.py'
const producerPinAnchor='    "scripts/manage-migration-author-lanes.mjs",\n'
const producerPinNames=['agent-work-contract-git-evidence.mjs','agent-work-contract.mjs','refresh-code-pr-branch.mjs','run-governed-review.mjs']
const producerPinComments=['    # Existing modules newly reachable through exact budget/contract imports.\n','    # Existing normal canonical validators now used by authenticated nonclosing routing.\n']
function producerPinFixture(t,{repair=false,alter=null,mode=false,extraConflict=false,mainEvolve=false,laterMain=false,mainAlter=null}={}){
 const f=realGitFixture(t);mkdirSync(path.join(f.dir,'scripts'),{recursive:true})
 const baseText='PREVIEW_PRODUCER_PATHS = (\n'+producerPinAnchor+'    "scripts/unchanged.py",\n)\n'
 const block=i=>producerPinComments[i]+producerPinNames.map(name=>`    "scripts/${name}",\n`).join('')
 f.git(['switch','main']);const base=f.commit(producerPinFile,baseText)
 f.git(['switch','-qc','pins',base]);let ours=baseText.replace(producerPinAnchor,producerPinAnchor+block(0));if(alter)ours=alter(ours)
 let before=f.commit(producerPinFile,ours)
 if(mode){f.git(['add',producerPinFile]);f.git(['update-index','--chmod=+x',producerPinFile]);chmodSync(path.join(f.dir,producerPinFile),0o755);f.git(['commit','-qm','different mode']);before=f.git(['rev-parse','HEAD']).trim()}
 if(extraConflict)before=f.commit('app.txt','feature overlapping source\n')
 if(repair)f.commit('app.txt','original genuine runtime repair\n')
 f.git(['switch','main']);if(extraConflict)f.commit('app.txt','protected overlapping source\n');let mainText=baseText.replace(producerPinAnchor,producerPinAnchor+block(1));if(mainAlter)mainText=mainAlter(mainText);let main=f.commit(producerPinFile,mainText);if(mainEvolve)main=f.commit(producerPinFile,readFileSync(path.join(f.dir,producerPinFile),'utf8').replace(producerPinAnchor,'    "scripts/protected-later.py",\n'+producerPinAnchor))
 f.git(['switch','pins']);try{f.git(['merge','--no-ff','-m','exact pin overlap','main'])}catch(error){if(error.status!==1)throw error;writeFileSync(path.join(f.dir,producerPinFile),readFileSync(path.join(f.dir,producerPinFile),'utf8').replace(/<<<<<<< HEAD[\s\S]*?>>>>>>> main\n/,block(1)));f.git(['checkout','--theirs','--',producerPinFile]);f.git(['add',producerPinFile]);if(extraConflict){f.git(['checkout','--theirs','--','app.txt']);f.git(['add','app.txt'])}f.git(['commit','-qm','exact protected pin resolution'])}
 const after=f.git(['rev-parse','HEAD']).trim()
 if(laterMain){f.git(['switch','main']);main=f.commit(producerPinFile,readFileSync(path.join(f.dir,producerPinFile),'utf8').replace(')\n','    "scripts/protected-after-merge.py",\n)\n'));f.git(['switch','pins'])}
 return {...f,base,before,main,after}
}
test('exact producer closure pin comments retain two spent starts and never witness an authored round',t=>{
 const f=producerPinFixture(t),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
 assert.equal(proof.kind,'unchanged');assert.equal(proof.canonicalPinOverlaps.length,1)
 assert.equal(proof.canonicalPinOverlaps[0].canonicalBlob,f.git(['rev-parse',`${f.main}:${producerPinFile}`]).trim())
 const rows=[1,2].map(n=>({...row(n,f.before),commit:{message:message(n,f.before)}}))
 assert.throws(()=>assertPaidReviewCapacity({...request,headSha:f.after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}),/third draw refused/)
})
test('exact producer closure overlap preserves a separate genuine surviving runtime repair witness',t=>{
 const f=producerPinFixture(t,{repair:true}),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
 assert.equal(proof.kind,'substantive');assert.equal(proof.witness.path,'app.txt');assert.ok(proof.canonicalPinOverlaps.length>=1)
})
test('producer closure overlap refuses changed keys, order, duplicate pins and all unrelated source bytes',t=>{
 const cases=[s=>s.replace('agent-work-contract.mjs','unreviewed.mjs'),s=>s.replace('    "scripts/agent-work-contract.mjs",\n',''),s=>s.replace('    "scripts/agent-work-contract.mjs",\n','    "scripts/agent-work-contract.mjs",\n    "scripts/agent-work-contract.mjs",\n'),s=>s.replace('agent-work-contract-git-evidence.mjs','temporary.mjs').replace('agent-work-contract.mjs','agent-work-contract-git-evidence.mjs').replace('temporary.mjs','agent-work-contract.mjs'),s=>s+'# unrelated comment\n',s=>s+'unsafe_action()\n',s=>s.replace('Existing modules newly reachable through exact budget/contract imports.','Unknown inventory claim.')]
 for(const alter of cases){const f=producerPinFixture(t,{alter});assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/provenance refused/)}
})
function symmetricImportFixture(t,{repair=true,bad=null,protectedImport=null,noRegression=false}={}){
 const f=realGitFixture(t);mkdirSync(path.join(f.dir,'scripts'),{recursive:true})
 const standalone="import { readPublishedContractFromGit } from './agent-work-contract-git-evidence.mjs'\n"
 const combined="import { verifyGitEvidence, gitIo, readPublishedContractFromGit } from './agent-work-contract-git-evidence.mjs'\n"
 const padding=Array.from({length:20},(_,i)=>`// separator ${i}\n`).join('')
 const manager='// beginning\n'+padding+'export const repair = false\n'
 const tests='// beginning\n'+padding+'// existing regression\n'
 const inventory='PREVIEW_PRODUCER_PATHS = (\n'+producerPinAnchor+'    "scripts/unchanged.py",\n)\n'
 f.git(['switch','main']);f.commit('scripts/manage-migration-author-lanes.mjs',manager);f.commit('scripts/manage-migration-author-lanes.test.mjs',tests);const base=f.commit(producerPinFile,inventory)
 f.git(['switch','-qc','symmetry',base]);f.commit('scripts/manage-migration-author-lanes.mjs',manager+standalone)
 const pins=producerPinNames.map(name=>`    "scripts/${name}",\n`).join('');const before=f.commit(producerPinFile,inventory.replace(producerPinAnchor,producerPinAnchor+producerPinComments[0]+pins))
 let authored=null
 if(repair){writeFileSync(path.join(f.dir,'scripts/manage-migration-author-lanes.mjs'),(manager+standalone).replace('repair = false','repair = true'));writeFileSync(path.join(f.dir,'scripts/manage-migration-author-lanes.test.mjs'),tests+(noRegression?'':'// original genuine regression\n'));f.git(['add','scripts/manage-migration-author-lanes.mjs','scripts/manage-migration-author-lanes.test.mjs']);f.git(['commit','-qm','genuine original runtime and regression repair']);authored=f.git(['rev-parse','HEAD']).trim()}
 f.git(['switch','main']);f.commit('scripts/manage-migration-author-lanes.mjs',(protectedImport?protectedImport(combined):combined)+manager);f.commit('scripts/manage-migration-author-lanes.test.mjs','// new upstream regression\n'+tests);const main=f.commit(producerPinFile,inventory.replace(producerPinAnchor,producerPinAnchor+producerPinComments[1]+pins))
 f.git(['switch','symmetry']);try{f.git(['merge','--no-ff','-m','protected main','main'])}catch(error){if(error.status!==1)throw error;f.git(['checkout','--theirs','--',producerPinFile]);f.git(['add',producerPinFile]);f.git(['commit','-qm','protected canonical pins'])}
 const merged=readFileSync(path.join(f.dir,'scripts/manage-migration-author-lanes.mjs'),'utf8');let normalized=merged.replace(standalone,'');if(bad)normalized=bad(normalized)
 f.commit('scripts/manage-migration-author-lanes.mjs',normalized)
 return {...f,base,before,main,authored,after:f.git(['rev-parse','HEAD']).trim()}
}
test('symmetric protected binding projection proves original runtime author and full regression blob, not integration',t=>{
 const f=symmetricImportFixture(t),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
 assert.equal(proof.kind,'substantive');assert.equal(proof.witness.path,'scripts/manage-migration-author-lanes.mjs')
 assert.ok(proof.witness.symmetricProjection);assert.equal(proof.witness.symmetricProjection.actualTestBlob,f.git(['rev-parse',`${f.after}:scripts/manage-migration-author-lanes.test.mjs`]).trim())
 assert.equal(proof.witness.commit,f.authored);assert.notEqual(proof.witness.commit,f.after)
})
test('duplicate imported binding consolidation with no real source repair cannot renew two exhausted starts',t=>{
 const f=symmetricImportFixture(t,{repair:false})
 assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/surviving author source edit unavailable/)
 const rows=[1,2].map(n=>({...row(n,f.before),commit:{message:message(n,f.before)}}))
 assert.throws(()=>assertPaidReviewCapacity({...request,headSha:f.after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:derivePaidContentProof(f.before,f.after,f.main,f.git)})}),/surviving author source edit unavailable/)
})

test('producer pin normalization refuses executable modes and every additional source conflict',t=>{
 for(const options of [{mode:true},{extraConflict:true}]){const f=producerPinFixture(t,options);assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/provenance refused/)}
})

test('symmetric binding witness refuses unknown modules, symbols, duplicate bindings and missing regression',t=>{
 const variants=[{protectedImport:s=>s.replace('agent-work-contract-git-evidence.mjs','unknown-module.mjs')},{protectedImport:s=>s.replace('verifyGitEvidence','unknownSymbol')},{protectedImport:s=>s+s},{noRegression:true}]
 for(const options of variants){const f=symmetricImportFixture(t,options);assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/provenance refused/)}
})

test('producer pin overlap accepts protected main that also evolved the gate before and after the merge',t=>{
 for(const options of [{mainEvolve:true},{laterMain:true},{mainEvolve:true,laterMain:true}]){
  const f=producerPinFixture(t,options),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
  assert.equal(proof.kind,'unchanged');assert.equal(proof.canonicalPinOverlaps.length,1)
  assert.notEqual(proof.canonicalPinOverlaps[0].protectedParent,f.before,'the author side is never the protected parent')
 }
})
test('producer pin overlap still refuses author-side extra bytes when protected main evolved',t=>{
 const f=producerPinFixture(t,{mainEvolve:true,alter:s=>s.replace('    "scripts/unchanged.py",\n','    "scripts/unchanged.py",\n    "scripts/smuggled.py",\n')})
 assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/provenance refused/)
})
test('producer pin overlap refuses an ambiguous protected parent when both or neither parent is protected',t=>{
 const f=producerPinFixture(t)
 // Both: protected main has absorbed the author side too.
 f.git(['switch','-qc','both',f.main]);f.git(['merge','-q','--no-ff','-s','ours','-m','absorb author side',f.before]);const both=f.git(['rev-parse','HEAD']).trim();f.git(['switch','pins'])
 assert.throws(()=>derivePaidContentProof(f.before,f.after,both,f.git),/protected parent is ambiguous/)
 // Neither: protected main predates both pin commits.
 assert.throws(()=>derivePaidContentProof(f.before,f.after,f.base,f.git),/provenance refused/)
})

test('producer pin overlap accepts protected lines interleaved inside the pin block but refuses a protected side missing an author pin',t=>{
 const inside=producerPinFixture(t,{mainAlter:s=>s.replace('    "scripts/agent-work-contract.mjs",\n','    "scripts/agent-work-contract.mjs",\n    # protected interleave\n    "scripts/lib/protected-inside.mjs",\n')})
 assert.equal(derivePaidContentProof(inside.before,inside.after,inside.main,inside.git).kind,'unchanged')
 for(const mainAlter of [s=>s.replace('    "scripts/run-governed-review.mjs",\n',''),s=>s.replace('    "scripts/run-governed-review.mjs",\n','    "scripts/run-governed-review.mjs",\n    "scripts/run-governed-review.mjs",\n')]){
  const f=producerPinFixture(t,{mainAlter});assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/provenance refused/)
 }
})

// Cause-bound reinstatement (#3536/#3999).
function failureMsg(seq,{code='wrapper_terminal_failure',reviewer='glm-5.3',h=head,pr=4000,slot=1}={}){return`db-coordination reviewer-failure-replacement sequence=${seq+100} reviewer=kimi-k3 issue=3536 pr=${pr} head=${h} slot=${slot} failed-sequence=${seq} prior-sequence=${seq} failure-ref=self failed-reviewer=${reviewer} code=${code} verdict=none artifact=none`}
function reinstateIo(rows,failures){const x=io(rows);x.readRef=ref=>{const m=/^refs\/db-review-failures\/3536-4000-[0-9a-f]{40}-(\d+)$/.exec(ref);return m&&failures[m[1]]?'f'.repeat(39)+m[1].slice(-1):null};const base=x.getCommit;x.getCommit=sha=>sha.startsWith('f'.repeat(39))?{message:Object.entries(failures).find(([k])=>k.slice(-1)===sha.slice(-1))[1]}:base(sha);return x}
test('reinstated verdict-less reviewer crash is not counted',()=>{const r=assertPaidReviewCapacity(request,reinstateIo([row(1),row(2)],{1:failureMsg(1),2:`db-coordination reviewer-failure-release reviewer=glm-5.3 issue=3536 pr=4000 head=${head} failed-sequence=2 code=provider_unavailable verdict=none artifact=none replacement=none`}));assert.equal(r.remaining,2);assert.equal(r.reinstated,2)})
test('start without reinstatable failure (verdict-bearing or non-reviewer cause) still counts',()=>{assert.throws(()=>assertPaidReviewCapacity(request,reinstateIo([row(1),row(2)],{})),/third draw refused/);assert.throws(()=>assertPaidReviewCapacity(request,reinstateIo([row(1),row(2)],{1:failureMsg(1,{code:'local_dependency_unavailable'})})),/third draw refused/)})
test('mismatched or unreadable reinstatement binding refuses',()=>{for(const text of [failureMsg(1,{reviewer:'kimi-k3'}),failureMsg(1,{slot:2}),failureMsg(1,{h:next}),failureMsg(1).replace('verdict=none','verdict=APPROVE'),'garbage'])assert.throws(()=>assertPaidReviewCapacity(request,reinstateIo([row(1)],{1:text})),/reinstatement failure (binding mismatch|evidence unreadable)/)})
test('reinstatement ceiling bounds crash loops',()=>{const f={1:failureMsg(1),2:failureMsg(2),3:failureMsg(3)};assert.equal(assertPaidReviewCapacity(request,reinstateIo([row(1),row(2),row(3)],f)).remaining,1);assert.throws(()=>assertPaidReviewCapacity(request,reinstateIo([row(1),row(2),row(3),row(4)],{...f,4:failureMsg(4)})),/third draw refused/)})

function namedImportFixture(t,{variant='',repair=false,revert=false}={}){
 const dir=mkdtempSync(path.join(tmpdir(),'review-budget-import-real-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']})
 git(['init','-q','-b','main']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test']);git(['config','core.autocrlf','false']);git(['config','core.fileMode','false'])
 const file='scripts/orchestrator-flow/admission-outcome.test.mjs';mkdirSync(path.join(dir,'scripts/orchestrator-flow'),{recursive:true})
 const bindings='evaluateAdmission, parseImpactBlock, STRUCTURAL_CHANGE_TYPES, NON_STRUCTURAL_CHANGE_TYPES, assertPrCarriesStructuralChange, inspectPrStructuralChange'
 const line=extra=>`import { ${bindings}${extra} } from './admission.mjs'\n`
 const body='\n// stable protected body\n'
 const write=text=>writeFileSync(path.join(dir,file),text)
 const commit=()=>{git(['add','.']);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']).trim()}
 write(line('')+body);writeFileSync(path.join(dir,'app.txt'),'base');writeFileSync(path.join(dir,'other.txt'),'base');commit()
 git(['switch','-qc','feature']);let author=line(', structuralWritesMatch')
 if(variant==='alias')author=author.replace('structuralWritesMatch','structuralWritesMatch as renamed')
 if(variant==='unknown')author=line(', unknownCapability')
 if(variant==='default')author=author.replace('import {','import defaultValue, {')
 if(variant==='multiline')author=author.replace(', structuralWritesMatch',',\n structuralWritesMatch')
 if(variant==='comment')author=author.replace('structuralWritesMatch','/* inserted */ structuralWritesMatch')
 if(variant==='baseOrder')author=author.replace('evaluateAdmission, parseImpactBlock','parseImpactBlock, evaluateAdmission')
 if(variant==='dynamic')author="const module = await import('./admission.mjs')\n"
 if(variant==='attributes')writeFileSync(path.join(dir,'.gitattributes'),file+' merge=union\n')
 if(variant==='module')author=author.replace('./admission.mjs','./other.mjs')
 if(variant==='duplicate')author+=line(', structuralWritesMatch')
 write(author+(variant==='bodyConflict'?'\n// author body\n':body));writeFileSync(path.join(dir,'app.txt'),'implementation');if(variant==='extraConflict')writeFileSync(path.join(dir,'other.txt'),'author');const before=commit()
 if(repair){writeFileSync(path.join(dir,'app.txt'),'repair');commit()}
 if(revert){writeFileSync(path.join(dir,'app.txt'),'implementation');commit()}
 git(['switch','main']);write(line(', inspectPrCuratedDataChange')+(variant==='bodyConflict'?'\n// protected body\n':body));if(variant==='extraConflict')writeFileSync(path.join(dir,'other.txt'),'protected');const main=commit()
 git(['switch','feature']);assert.throws(()=>git(['merge','--no-commit','main']))
 let merged=line(', structuralWritesMatch, inspectPrCuratedDataChange')+body
 if(variant==='omitted')merged=line(', structuralWritesMatch')+body
 if(variant==='reordered')merged=line(', inspectPrCuratedDataChange, structuralWritesMatch')+body
 if(variant==='bodyEdit')merged+='// unreviewed resolution edit\n'
 write(merged);if(variant==='extraConflict')writeFileSync(path.join(dir,'other.txt'),'manual resolution')
 if(variant==='mode'){git(['add',file]);git(['update-index','--chmod=+x',file]);git(['commit','-qm','fixture']);return {git,before,after:git(['rev-parse','HEAD']).trim(),main}}
 return {git,before,after:commit(),main,dir,file}
}
test('exact protected and author named imports preserve unchanged paid starts',t=>{
 const f=namedImportFixture(t),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
 assert.equal(proof.kind,'unchanged');assert.equal(proof.canonicalImportUnions.length,1)
 const rows=[1,2].map(n=>({...row(n,f.before),commit:{message:message(n,f.before)}}))
 assert.throws(()=>assertPaidReviewCapacity({...request,headSha:f.after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}),/third draw refused/)
})
test('named import union retains genuine surviving repair and refuses a reverted reset',t=>{
 for(const revert of [false,true]){const f=namedImportFixture(t,{repair:true,revert});const proof=derivePaidContentProof(f.before,f.after,f.main,f.git);assert.equal(proof.kind,revert?'unchanged':'substantive');if(!revert)assert.equal(proof.witness.path,'app.txt')}
})
for(const variant of ['alias','unknown','module','duplicate','default','multiline','comment','baseOrder','dynamic','bodyConflict','extraConflict','omitted','reordered','bodyEdit','mode'])test(`named import union refuses ${variant}`,t=>{
 const f=namedImportFixture(t,{variant});assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/provenance refused/)
})
test('named import union refuses missing Git objects and false protected ancestry',t=>{
 const f=namedImportFixture(t)
 assert.throws(()=>derivePaidContentProof(f.before,f.after,'f'.repeat(40),f.git),/provenance refused/)
 assert.throws(()=>derivePaidContentProof(f.before,f.after,f.before,f.git),/provenance refused/)
})
test('named import union authenticates returned conflict stage blobs',t=>{
 const f=namedImportFixture(t),forged=args=>{try{return f.git(args)}catch(error){if(args[0]==='merge-tree'&&error.status===1)error.stdout=error.stdout.replace(/100644 [0-9a-f]{40} 2\t/,'100644 '+ 'f'.repeat(40)+' 2\t');throw error}}
 assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,forged),/provenance refused/)
})
test('named import union refuses custom merge attributes and symlink resolution',t=>{
 const attributes=namedImportFixture(t);writeFileSync(path.join(attributes.dir,'.gitattributes'),attributes.file+' merge=union\n');assert.throws(()=>derivePaidContentProof(attributes.before,attributes.after,attributes.main,attributes.git),/provenance refused/)
 const link=namedImportFixture(t),blob=link.git(['rev-parse',`${link.after}:${link.file}`]).trim();link.git(['update-index','--cacheinfo',`120000,${blob},${link.file}`]);link.git(['commit','-qm','symlink resolution']);const after=link.git(['rev-parse','HEAD']).trim();assert.throws(()=>derivePaidContentProof(link.before,after,link.main,link.git),/provenance refused/)
})

function sidecarRegistryFixture(t,{variant=null,repair=false}={}){
 const f=realGitFixture(t),file='config/production-verification-sidecar-registry.json'
 mkdirSync(path.join(f.dir,'config'),{recursive:true})
 const original=[{version:'20261010000000',issue:null}],author={version:'20261011220717',issue:4210},upstream={version:'20261011201710',issue:4172}
 const encode=items=>JSON.stringify({schema_version:1,sidecars:items},null,2)+'\n'
 const base=f.commit(file,encode(original))
 f.git(['switch','-qc','registry-author',base])
 const shared={version:'20261011110000',issue:555}
 if(variant==='author-missing-issue')author.issue=null
 const authorAdditions=variant==='union-size'?Array.from({length:500},(_,i)=>({version:String(20261011230000+i),issue:600+i})):[...(variant==='same-overlap'?[shared]:[]),author]
 const before=f.commit(file,encode([...original,...authorAdditions]))
 if(repair)f.commit('app.txt','context\nreal repaired source\nend\n')
 if(variant==='extra-conflict')f.commit('app.txt','author conflict\n')
 if(variant==='custom')f.commit('.gitattributes',file+' merge=union\n')
 f.git(['switch','-qc','registry-main',base])
 let entries=[...original,upstream],text
 if(variant==='base-remove')entries=[upstream]
 if(variant==='union-size')entries=[...original,...Array.from({length:500},(_,i)=>({version:String(20261011120000+i),issue:1200+i}))]
 if(variant==='unsorted')entries=[...original,upstream,{version:'20261011120000',issue:556}]
 if(variant==='base-edit')entries=[{...original[0],issue:900},upstream]
 if(variant==='overlap')entries=[...original,{...author,issue:900}]
 if(variant==='same-overlap')entries=[...original,shared,upstream]
 if(variant==='duplicate')entries=[...original,upstream,upstream]
 if(variant==='numeric-version')entries=[...original,{...upstream,version:Number(upstream.version)}]
 if(variant==='missing-issue')entries=[...original,{...upstream,issue:null}]
 if(variant==='bad-issue')entries=[...original,{...upstream,issue:-1}]
 if(variant==='unknown-field')entries=[...original,{...upstream,extra:true}]
 text=encode(entries)
 if(variant==='noncanonical')text=JSON.stringify(JSON.parse(text))+'\n'
 if(variant==='header')text=JSON.stringify({schema_version:2,sidecars:entries},null,2)+'\n'
 let main=f.commit(file,text)
 if(variant==='extra-conflict')main=f.commit('app.txt','protected conflict\n')
 if(variant==='mode'){f.git(['update-index','--chmod=+x',file]);f.git(['commit','-qm','registry mode']);main=f.git(['rev-parse','HEAD']).trim()}
 f.git(['switch','registry-author'])
 if(variant==='custom')f.git(['merge','--no-commit','registry-main']);else assert.throws(()=>f.git(['merge','--no-commit','registry-main']),/./)
 if(variant==='extra-conflict'){writeFileSync(path.join(f.dir,'app.txt'),'resolved conflict\n');f.git(['add','app.txt'])}
 let union=encode([...original,upstream,author])
 if(variant==='bad-resolution')union=encode([...original,author])
 if(variant==='drop-author')union=encode([...original,upstream])
 if(variant==='union-size')union=encode([...entries,...authorAdditions])
 f.commit(file,union)
 const after=f.git(['rev-parse','HEAD']).trim()
 return {...f,file,before,main,after}
}
test('canonical sidecar append union preserves spent attempts',t=>{
 const f=sidecarRegistryFixture(t),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
 assert.equal(proof.kind,'unchanged');assert.equal(proof.canonicalRegistryUnions.length,1)
 const rows=[1,2].map(n=>({...row(n,f.before),commit:{message:message(n,f.before)}}))
 assert.throws(()=>assertPaidReviewCapacity({...request,headSha:f.after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}),/third draw refused/)
})
test('sidecar union authenticates genuine surviving source repair',t=>{
 const f=sidecarRegistryFixture(t,{repair:true}),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
 assert.equal(proof.kind,'substantive');assert.equal(proof.witness.path,'app.txt');assert.ok(proof.canonicalRegistryUnions.length>0)
})
for(const variant of ['author-missing-issue','union-size','drop-author','extra-conflict','custom','base-edit','base-remove','unsorted','mode','overlap','same-overlap','duplicate','numeric-version','missing-issue','bad-issue','unknown-field','noncanonical','header','bad-resolution'])test(`sidecar union refuses ${variant}`,t=>{
 const f=sidecarRegistryFixture(t,{variant});assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/provenance refused/)
})

test('authenticated evidence retirement retains registry proof shape',t=>{
 const proof=generationsFixture(t,{repair:false,ordinaryRetirement:true}).proof();assert.equal(proof.kind,'unchanged');assert.deepEqual(proof.canonicalRegistryUnions,[])
})

for(const [kind,fixture] of [['registry',sidecarRegistryFixture],['import',namedImportFixture]])for(const change of ['rewrite','revert','delete'])test(`${kind} canonical merge followed by ${change} cannot mint paid attempts`,t=>{
 const f=fixture(t)
 if(change==='delete')f.git(['rm',f.file])
 else {const text=change==='revert'?f.git(['show',`${f.before}:${f.file}`]):'regular post-merge rewrite\n';writeFileSync(path.join(f.dir,f.file),text);f.git(['add',f.file])}
 f.git(['commit','-qm','post-merge canonical file change']);const after=f.git(['rev-parse','HEAD']).trim()
 assert.throws(()=>derivePaidContentProof(f.before,after,f.main,f.git),change==='delete'?/canonical blob missing/:/surviving author source edit unavailable/)
})

// Real generated source blobs are larger than the JSON evidence bound.
test('large ordinary source preserves exact surviving authored witness', t=>{
 const f=realGitFixture(t), source='generated source line\n'.repeat(60000)
 const before=f.commit('types.txt',source+'original\n')
 const after=f.commit('types.txt',source+'genuine repair\n')
 const git=args=>execFileSync('git',args,{cwd:f.dir,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024})
 const proof=derivePaidContentProof(before,after,f.base,git)
 assert.equal(proof.kind,'substantive');assert.equal(proof.witness.path,'types.txt')
 assert.equal(proof.witness.blob,git(['rev-parse',after+':types.txt']).trim())
})
test('ordinary source above explicit4MiB bound still refuses',t=>{
 const f=realGitFixture(t), source='x'.repeat(4*1024*1024+1)
 const before=f.commit('types.txt',source)
 const after=f.commit('types.txt',source+'genuine repair')
 const git=args=>execFileSync('git',args,{cwd:f.dir,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024})
 assert.throws(()=>derivePaidContentProof(before,after,f.base,git),/canonical blob bytes unreadable or oversized/)
})

test('shipped reader refuses oversized provenance without returning partial witness',async t=>{
 const {paidReviewGitReader}=await import('../../manage-migration-author-lanes.mjs')
 const f=realGitFixture(t), source='x'.repeat(4*1024*1024+65536)
 const before=f.commit('types.txt',source),after=f.commit('types.txt',source+'repair')
 assert.throws(()=>derivePaidContentProof(before,after,f.base,args=>paidReviewGitReader(['-C',f.dir,...args])),/Git provenance refused:.*ENOBUFS/)
})
