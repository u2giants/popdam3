import {createHash} from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { paidStart, assertPaidReviewCapacity, pauseActualReviewFailure, derivePaidContentProof } from './review-circuit-breaker.mjs'
const head='a'.repeat(40), next='b'.repeat(40), digest='c'.repeat(64)
const request={issue:3536,pr:4000,headSha:head,slot:1}
function row(seq=1,h=head,slot=1){return{ref:`refs/db-review-started/3536-4000-${h}-slot${slot}-seq${seq}`,sha:String(seq).padStart(40,'0')}}
function message(seq=1,h=head,slot=1){return`db-coordination review-started issue=3536 pr=4000 head=${h} slot=${slot} sequence=${seq} reviewer=glm-5.3 at=2026-10-06T18:00:00.000Z`}
function reviewerRow(seq,reviewer,h=head,slot=1){return{...row(seq,h,slot),commit:{message:message(seq,h,slot).replace('reviewer=glm-5.3',`reviewer=${reviewer}`)}}}
function issueRow(seq,issue){return{...row(seq),ref:row(seq).ref.replace('3536-',`${issue}-`),commit:{message:message(seq).replace('issue=3536',`issue=${issue}`)}}}
function io(rows){return{listRefs:()=>rows,getCommit:sha=>({message:message(Number(sha))}),reviewContentComparison:()=>({before:digest,after:digest,budgetProof:{schema:1,before:head,after:next,protectedMain:head,kind:'unchanged'}})}}
test('zero and one paid attempts retain capacity',()=>{assert.deepEqual(assertPaidReviewCapacity(request,io([])),{paidAttempts:0,remaining:null,uncapped:true});assert.equal(assertPaidReviewCapacity(request,io([row()])).paidAttempts,1)})
test('third paid draw is allowed (owner 2026-10-16 uncapped spend)',()=>assert.doesNotThrow(()=>assertPaidReviewCapacity(request,io([row(),row(2)]))))
test('evidence-only or empty-head refresh does not create a spend refusal',()=>assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,headSha:next},io([row(),row(2)]))))
test('substantive byte change starts another round',()=>{const x=io([row(),row(2)]);x.reviewContentComparison=()=>({before:digest,after:'d'.repeat(64),budgetProof:{schema:1,before:head,after:next,protectedMain:head,kind:'substantive',historyCount:1}});assert.equal(assertPaidReviewCapacity({...request,headSha:next},x).paidAttempts,0)})
test('unknown, malformed and failed comparison cannot reset',()=>{for(const proof of [null,{before:'unknown',after:digest}]){const x=io([row(),row(2)]);x.reviewContentComparison=()=>proof;assert.throws(()=>assertPaidReviewCapacity({...request,headSha:next},x),/proof unreadable/)}const x=io([row()]);x.reviewContentComparison=()=>{throw Error('fetch failed')};assert.throws(()=>assertPaidReviewCapacity({...request,headSha:next},x),/fetch failed/)})
test('independent slots have separate paid caps',()=>{const x=io([row(1,head,2),row(2,head,2)]);x.getCommit=sha=>({message:message(Number(sha),head,2)});assert.equal(assertPaidReviewCapacity(request,x).paidAttempts,0)})
// A carried slot 1 (assignment standing at a tree-identical ancestor) is not a
// paid draw. Drawing slot 2 at the new head must not be blocked by slot 1's
// exhausted unchanged-content cap: the caps are per slot, and the carry writes
// no start at all (#4206).
test('carried slot 1 plus a new slot 2 draw on tree-identical content is allowed',()=>{
  const x=io([row(1,head,1),row(2,head,1)])
  x.getCommit=sha=>({message:message(Number(sha),head,Number(sha)===1||Number(sha)===2?1:2)})
  x.reviewContentComparison=()=>({before:digest,after:digest,budgetProof:{schema:1,before:head,after:next,protectedMain:head,kind:'unchanged'}})
  // Slot 1 has two paid starts on unchanged content: a third slot-1 draw refuses.
  assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,slot:1,headSha:next},x))
  // Slot 2 is empty at both heads: the first slot-2 draw is allowed.
  assert.equal(assertPaidReviewCapacity({...request,slot:2,headSha:next},x).paidAttempts,0)
})
test('tampered scope, time or record refuses',()=>{for(const text of [message().replace('pr=4000','pr=4001'),message().replace('2026-10-06T18:00:00.000Z','unknown'),'PASS doctor repaired'])assert.throws(()=>paidStart(row(),{message:text}),/binding mismatch|unrecognized/)})
test('unstarted atomic reclaim is not a paid attempt',()=>{const text=`db-coordination reviewer-silence-release reviewer=glm-5.3 issue=3536 pr=4000 head=${head} sequence=1 code=silent_worker_observed probe=${'e'.repeat(40)} observed-at=2026-10-06T17:00:00Z confirmed-at=2026-10-06T18:00:00Z verdict=none artifact=none replacement=none`;assert.equal(paidStart(row(),{message:text}),null);assert.throws(()=>paidStart(row(),{message:text.replace('sequence=1','sequence=2')}),/unrecognized/)})
test('doctor PASS is irrelevant: spend is uncapped',()=>{const x=io([row(),row(2)]);x.reinstatement=()=>({output:'PASS',fresh:true});assert.doesNotThrow(()=>assertPaidReviewCapacity(request,x))})

test('pre-start independent-slot conflict is skipped only with exact scope',()=>{
 const text=`db-coordination reviewer-failure-replacement sequence=3 reviewer=stepfun-step-5-preview issue=3536 pr=4000 head=${head} slot=1 failed-sequence=1 prior-sequence=2 failure-ref=self failed-reviewer=glm-5.3 code=slot_independence_conflict verdict=none artifact=none`
 assert.equal(paidStart(row(),{message:text}),null)
 assert.throws(()=>paidStart(row(),{message:text.replace('slot=1','slot=2')}),/unrecognized/)
 assert.throws(()=>paidStart(row(),{message:text.replace('slot_independence_conflict','provider_unavailable')}),/unrecognized/)
})

test('changing work issue cannot reset the same PR paid cap and issue must be exact',()=>{
 const x=io([row(),row(2)])
 assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,issue:3537},x))
 for(const issue of [NaN,'3536',0,-1])assert.throws(()=>assertPaidReviewCapacity({...request,issue},x),/exact positive issue/)
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
 assert.equal(assertPaidReviewCapacity({...request,headSha:next},x).paidAttempts,0);assert.equal(calls,2)
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
 for(const pr of [NaN,'4000',0,-1])assert.throws(()=>assertPaidReviewCapacity({...request,pr},io([])),/exact positive issue, PR and slot/)
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
 assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,headSha:after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}))
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

function forwardCheckpointFixture(t,{foreign=false,earlierFix=false}={}){
 const f=realGitFixture(t)
 const anchor=earlierFix?f.commit('earlier-fix.txt','valid earlier author fix\n'):f.before
 f.git(['switch','main']);const main=f.commit('main-only.txt','protected main\n')
 let incoming='main'
 if(foreign){f.git(['switch','-qc','foreign']);f.commit('foreign.txt','untrusted ancestry\n');incoming='foreign'}
 f.git(['switch','feature']);f.git(['merge','--no-commit',incoming])
 writeFileSync(path.join(f.dir,'mixed.txt'),'unreviewed edit inside merge\n');f.git(['add','mixed.txt']);f.git(['commit','-qm','mixed upstream merge'])
 const mixed=f.git(['rev-parse','HEAD']).trim()
 const restore=({partial=false,mode=null,unverified=false}={})=>{
  f.git(['rm','mixed.txt']);if(foreign)f.git(['rm','foreign.txt'])
  if(partial){writeFileSync(path.join(f.dir,'leftover.txt'),'not restored\n');f.git(['add','leftover.txt'])}
  if(mode){const blob=f.git(['rev-parse','HEAD:app.txt']).trim();f.git(['update-index','--cacheinfo',`${mode},${blob},app.txt`])}
  if(unverified){mkdirSync(path.join(f.dir,'.agent'),{recursive:true});writeFileSync(path.join(f.dir,'.agent/unverified.txt'),'not a contract\n');f.git(['add','.agent/unverified.txt'])}
  f.git(['commit','-qm','restore canonical source without rewriting history']);return f.git(['rev-parse','HEAD']).trim()
 }
 return {...f,anchor,main,mixed,restore}
}
test('forward canonical checkpoint permits a later standalone repair without accepting the mixed merge',t=>{
 const f=forwardCheckpointFixture(t)
 assert.throws(()=>derivePaidContentProof(f.before,f.mixed,f.main,f.git),/noncanonical/)
 const checkpoint=f.restore(),after=f.commit('mixed.txt','unreviewed edit inside merge\n')
 const proof=derivePaidContentProof(f.before,after,f.main,f.git)
 assert.equal(proof.kind,'substantive');assert.equal(proof.canonicalRecovery.anchor,f.anchor)
 assert.equal(proof.canonicalRecovery.mixedMerge,f.mixed);assert.equal(proof.canonicalRecovery.checkpoint,checkpoint)
 assert.equal(proof.witness.commit,after);assert.notEqual(proof.witness.commit,f.mixed)
 // Even if a historical review already saw the mixed source, restoring and
 // replaying those same bytes cannot manufacture a fresh content group.
 const alreadySeen=derivePaidContentProof(f.mixed,after,f.main,f.git)
 assert.equal(alreadySeen.kind,'unchanged')
 const starts=[1,2].map(n=>({...row(n,f.mixed),commit:{message:message(n,f.mixed)}}))
 assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,headSha:after},{...io(starts),reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:alreadySeen})}))
})
test('forward restoration alone, empty commits and evidence-only followups retain both charged rounds',t=>{
 const f=forwardCheckpointFixture(t);f.restore()
 const starts=[1,2].map(n=>({...row(n,f.before),commit:{message:message(n,f.before)}}))
 const check=()=>{
  const after=f.git(['rev-parse','HEAD']).trim(),proof=derivePaidContentProof(f.before,after,f.main,f.git,['evidence.txt'])
  assert.equal(proof.kind,'unchanged')
  const api={...io(starts),reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}
  assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,headSha:after},api))
  assert.equal(starts.length,2)
 }
 check();f.git(['commit','--allow-empty','-qm','empty followup']);check();f.commit('evidence.txt','evidence only\n');check()
})
test('forward recovery also proves historical paid heads before valid earlier authored fixes',t=>{
 const f=forwardCheckpointFixture(t,{earlierFix:true}),checkpoint=f.restore(),after=f.commit('later-fix.txt','standalone fix\n')
 const proof=derivePaidContentProof(f.before,after,f.main,f.git)
 assert.equal(proof.kind,'substantive');assert.equal(proof.canonicalRecovery.anchor,f.anchor)
 assert.notEqual(f.before,f.anchor);assert.equal(proof.canonicalRecovery.checkpoint,checkpoint)
 for(const before of [f.before,f.anchor])assert.equal(derivePaidContentProof(before,after,f.main,f.git).kind,'substantive')
})
test('partial forward restoration cannot hide a mixed merge behind a genuine later edit',t=>{
 const f=forwardCheckpointFixture(t);f.restore({partial:true});const after=f.commit('later-fix.txt','genuine later edit\n')
 assert.throws(()=>derivePaidContentProof(f.before,after,f.main,f.git),/noncanonical/)
})
for(const mode of ['100755','120000'])test(`forward checkpoint refuses source mode drift ${mode}`,t=>{
 const f=forwardCheckpointFixture(t);f.restore({mode});const after=f.commit('later-fix.txt','genuine later edit\n')
 assert.throws(()=>derivePaidContentProof(f.before,after,f.main,f.git),/noncanonical/)
})
test('foreign merge remains refused even after exact source restoration and a standalone repair',t=>{
 const f=forwardCheckpointFixture(t,{foreign:true});f.restore();const after=f.commit('later-fix.txt','genuine later edit\n')
 assert.throws(()=>derivePaidContentProof(f.before,after,f.main,f.git),/foreign merge/)
})
test('unverified agent bytes cannot be excluded to create a forward checkpoint',t=>{
 const f=forwardCheckpointFixture(t);f.restore({unverified:true});const after=f.commit('later-fix.txt','genuine later edit\n')
 assert.throws(()=>derivePaidContentProof(f.before,after,f.main,f.git),/unverified|historical|evidence|noncanonical/)
})
test('two mixed merges remain refused after complete forward restoration',t=>{
 const f=forwardCheckpointFixture(t)
 f.git(['switch','main']);const main=f.commit('main-next.txt','protected next change\n')
 f.git(['switch','feature']);f.git(['merge','--no-commit','main']);writeFileSync(path.join(f.dir,'mixed-next.txt'),'second mixed edit\n');f.git(['add','mixed-next.txt']);f.git(['commit','-qm','second mixed merge'])
 f.git(['rm','mixed.txt','mixed-next.txt']);f.git(['commit','-qm','restore both mixed merges']);const after=f.commit('later-fix.txt','standalone repair\n')
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
 assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,headSha:f.after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}))
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

import {contractHash,validateCompletionReport} from '../../agent-work-contract.mjs'
import {validateCompletionRecord} from '../work-dependencies.mjs'
import {verifiedEvidencePaths,prContentDigest} from '../pr-content-equivalence.mjs'
function generationsFixture(t,{repair=true,revert=false,bad=null,publishedOnly=false,ordinaryRetirement=false,checkPrefix=false,prefixFailure=null,startAdvance=false}={}){
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
 // #4797: the paid-start head may itself be a same-issue generation-advance
 // commit (delete the prior pair, add the new pair in one commit). 'foreign'
 // plants a foreign-issue deletion in that same tail, which must keep refusing.
 const startImplementation=sha()
 if(startAdvance){
  const priorIssue=startAdvance==='foreign'?9999:3536,priorGeneration=startAdvance==='foreign'?1:311
  const priorDir=path.join(f.dir,`.agent/work/${priorIssue}/${priorGeneration}`);mkdirSync(priorDir,{recursive:true})
  writeFileSync(path.join(priorDir,'contract.json'),'retired placeholder');writeFileSync(path.join(priorDir,'completion.json'),'retired placeholder')
  f.git(['add',`.agent/work/${priorIssue}/${priorGeneration}`]);f.git(['commit','-qm','fixture prior generation'])
  f.git(['rm','-r',`.agent/work/${priorIssue}/${priorGeneration}`])
 }
 const before=writePair(root,startImplementation)
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
test('#4797 same-issue generation advance at the paid start keeps the trusted start pair',t=>{
 const standard=generationsFixture(t).proof(),advanced=generationsFixture(t,{startAdvance:true}).proof()
 assert.equal(advanced.kind,standard.kind);assert.equal(advanced.kind,'substantive')
 assert.equal(advanced.canonicalRegistryUnions.length,0)
})
test('#4797 foreign-issue deletion inside the paid start tail still refuses the trusted start pair',t=>{
 assert.throws(()=>generationsFixture(t,{startAdvance:'foreign'}).proof(),/trusted start pair unavailable/)
})

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
 assert.deepEqual(assertPaidReviewCapacity({...request,pr:3999,headSha:f.after},{readPaidReviewStarts:()=>starts.map(x=>({...x,ref:x.ref.replace('-4000-','-3999-'),commit:{message:x.commit.message.replace('pr=4000','pr=3999')}})),reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}),{paidAttempts:0,remaining:null,uncapped:true})
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
 assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,headSha:f.after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}))
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
function failureMsg(seq,{code='wrapper_terminal_failure',reviewer='glm-5.3',h=head,issue=3536,pr=4000,slot=1}={}){return`db-coordination reviewer-failure-replacement sequence=${seq+100} reviewer=kimi-k3 issue=${issue} pr=${pr} head=${h} slot=${slot} failed-sequence=${seq} prior-sequence=${seq} failure-ref=self failed-reviewer=${reviewer} code=${code} verdict=none artifact=none`}
function reinstateIo(rows,failures){const x=io(rows);x.readRef=ref=>{const m=/^refs\/db-review-failures\/(\d+)-(\d+)-[0-9a-f]{40}-(\d+)$/.exec(ref);return m&&failures[m[3]]?'f'.repeat(39)+m[3].slice(-1):null};const base=x.getCommit;x.getCommit=sha=>sha.startsWith('f'.repeat(39))?{message:Object.entries(failures).find(([k])=>k.slice(-1)===sha.slice(-1))[1]}:base(sha);return x}
test('reinstated verdict-less reviewer crash is not counted',()=>{const r=assertPaidReviewCapacity(request,reinstateIo([row(1),row(2)],{1:failureMsg(1),2:`db-coordination reviewer-failure-release reviewer=glm-5.3 issue=3536 pr=4000 head=${head} failed-sequence=2 code=provider_unavailable verdict=none artifact=none replacement=none`}));assert.equal(r.paidAttempts,0);assert.equal(r.reinstated,2)})
test('native historical 6531 preparation failure is removed while earlier 6526 verdict remains charged',()=>{
 const issue=4297,pr=4308,reviewed='d'.repeat(40),current='e'.repeat(40),startSha=String(6531).padStart(40,'0'),failureSha='2'.repeat(40)
 const starts=[6526,6531].map((sequence)=>({ref:`refs/db-review-started/${issue}-${pr}-${reviewed}-slot1-seq${sequence}`,sha:String(sequence).padStart(40,'0'),commit:{message:`db-coordination review-started issue=${issue} pr=${pr} head=${reviewed} slot=1 sequence=${sequence} reviewer=deepseek-v4.1-flash at=2026-10-15T03:32:${sequence===6526?'20':'32'}.171Z session=historical receipt-path=sha256:${'a'.repeat(64)} source=sha256:${'b'.repeat(64)}`}}))
 const proof={schema_version:1,binding_kind:'unique-temporal',slot:1,start_ref:`refs/db-review-started/${issue}-${pr}-${reviewed}-slot1-seq6531`,start_sha:startSha,started_at:'2026-10-15T03:32:32.171Z',current_head_sha:current,receipt_path_sha256:'a'.repeat(64),source_receipt_sha256:'c'.repeat(64),source_digest:'b'.repeat(64),diagnostic_path_sha256:'d'.repeat(64),diagnostic_sha256:'e'.repeat(64),diagnostic_at:'2026-10-15T03:32:56.625Z',diagnostic_wrapper:'ai-deepseek-agent',exit_status:1,signal:'none',spawn_error:'none',phase:'packet-build',error:'source-receipt-conflict',provider_activity:'none',verdict:'none',artifact:'none'}
 const failureMessage=`db-coordination reviewer-failure-release reviewer=deepseek-v4.1-flash issue=${issue} pr=${pr} head=${reviewed} slot=1 failed-sequence=6531 code=wrapper_terminal_failure proof=historical-terminal-v1 verdict=none artifact=none replacement=none\nhistorical-terminal-failure-proof=${JSON.stringify(proof)}`
 const x={listRefs:()=>starts,readRef:ref=>ref.endsWith('-6531')?failureSha:null,getCommit:sha=>sha===failureSha?{message:failureMessage}:starts.find(start=>start.sha===sha)?.commit,reviewContentComparison:()=>({before:digest,after:digest,budgetProof:{schema:1,before:reviewed,after:current,protectedMain:reviewed,kind:'unchanged'}})}
 const actualRequest={issue,pr,headSha:current,slot:1},result=assertPaidReviewCapacity(actualRequest,x)
 assert.deepEqual({paidAttempts:result.paidAttempts,remaining:result.remaining,uncapped:result.uncapped,reinstated:result.reinstated},{paidAttempts:1,remaining:null,uncapped:true,reinstated:1})
})
test('cause-bound failures exceed the former global cap and count separately per reviewer',()=>{
 const failed={1:failureMsg(1),2:failureMsg(2,{code:'provider_unavailable'}),3:failureMsg(3,{code:'insufficient_quota',reviewer:'stepfun-step-5-preview'}),4:failureMsg(4,{code:'turn_limit_cancelled',reviewer:'muse-spark-1.3-contributor'})}
 const starts=[reviewerRow(1,'glm-5.3'),reviewerRow(2,'glm-5.3'),reviewerRow(3,'stepfun-step-5-preview'),reviewerRow(4,'muse-spark-1.3-contributor')]
 const result=assertPaidReviewCapacity(request,reinstateIo(starts,failed))
 assert.deepEqual(result,{paidAttempts:0,remaining:null,uncapped:true,reinstated:4,failedReviewers:['glm-5.3','muse-spark-1.3-contributor','stepfun-step-5-preview'],exhaustedReviewers:[]})
})
test('exact-bound repository-read failures refund starts and never exhaust the reviewer',()=>{
 const reviewer='qwen-code'
 const failed={
  1:failureMsg(1,{code:'reviewer_cannot_read_repository',reviewer}),
  2:failureMsg(2,{code:'reviewer_cannot_read_repository',reviewer})
 }
 const starts=[reviewerRow(1,reviewer),reviewerRow(2,reviewer)]
 assert.deepEqual(assertPaidReviewCapacity(request,reinstateIo(starts,failed)),{
  paidAttempts:0,remaining:null,uncapped:true,reinstated:2,failedReviewers:[reviewer],exhaustedReviewers:[]
 })
})
test('repository-read failure with verdict or mismatched reviewer binding is refused',()=>{
 const reviewer='qwen-code',starts=[reviewerRow(1,reviewer)]
 const verdict=reinstateIo(starts,{1:failureMsg(1,{code:'reviewer_cannot_read_repository',reviewer}).replace('verdict=none','verdict=APPROVE')})
 assert.throws(()=>assertPaidReviewCapacity(request,verdict),/reinstatement failure (binding mismatch|evidence unreadable)/)
 const mismatch=reinstateIo(starts,{1:failureMsg(1,{code:'reviewer_cannot_read_repository',reviewer:'other-reviewer'})})
 assert.throws(()=>assertPaidReviewCapacity(request,mismatch),/reinstatement failure binding mismatch/)
})
test('unrecognized failure stays counted and adds no new failure fields',()=>{
 const x=reinstateIo([row(1)],{1:failureMsg(1,{code:'local_dependency_unavailable'})})
 assert.deepEqual(assertPaidReviewCapacity(request,x),{paidAttempts:1,remaining:null,uncapped:true})
})
test('verified failures on an unchanged refreshed head stay bound; no pool exhaustion',()=>{
 const starts=[reviewerRow(1,'glm-5.3'),reviewerRow(2,'glm-5.3')]
 const result=assertPaidReviewCapacity({...request,headSha:next},reinstateIo(starts,{1:failureMsg(1),2:failureMsg(2)}))
 assert.deepEqual(result,{paidAttempts:0,remaining:null,uncapped:true,reinstated:2,failedReviewers:['glm-5.3'],exhaustedReviewers:[]})
})
test('provider failure counts carry across issue switches with original start binding',()=>{
 const starts=[issueRow(1,3536),issueRow(2,3536)]
 const result=assertPaidReviewCapacity({...request,issue:3537},reinstateIo(starts,{1:failureMsg(1),2:failureMsg(2)}))
 assert.deepEqual(result,{paidAttempts:0,remaining:null,uncapped:true,reinstated:2,failedReviewers:['glm-5.3'],exhaustedReviewers:[]})
})
test('substantive content change drops old failure counts without adding failure fields',()=>{
 const x=reinstateIo([reviewerRow(1,'glm-5.3')],{1:failureMsg(1)})
 x.reviewContentComparison=()=>({before:digest,after:'d'.repeat(64),budgetProof:{schema:1,before:head,after:next,protectedMain:head,kind:'substantive',historyCount:1}})
 assert.deepEqual(assertPaidReviewCapacity({...request,headSha:next},x),{paidAttempts:0,remaining:null,uncapped:true})
})
test('start without reinstatable failure still counts toward paidAttempts but never refuses (uncapped)',()=>{assert.equal(assertPaidReviewCapacity(request,reinstateIo([row(1),row(2)],{})).paidAttempts,2);assert.equal(assertPaidReviewCapacity(request,reinstateIo([row(1),row(2)],{1:failureMsg(1,{code:'local_dependency_unavailable'})})).paidAttempts,2)})
test('mismatched or unreadable reinstatement binding refuses',()=>{for(const text of [failureMsg(1,{reviewer:'kimi-k3'}),failureMsg(1,{slot:2}),failureMsg(1,{h:next}),failureMsg(1).replace('verdict=none','verdict=APPROVE'),'garbage'])assert.throws(()=>assertPaidReviewCapacity(request,reinstateIo([row(1)],{1:text})),/reinstatement failure (binding mismatch|evidence unreadable)/)})
function namedImportFixture(t,{variant='',repair=false,revert=false}={}){
 const dir=mkdtempSync(path.join(tmpdir(),'review-budget-import-real-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']})
 git(['init','-q','-b','main']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test']);git(['config','core.autocrlf','false']);git(['config','core.fileMode','false'])
 const file='scripts/db-flow/admission-outcome.test.mjs';mkdirSync(path.join(dir,'scripts/db-flow'),{recursive:true})
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
 assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,headSha:f.after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}))
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

function sidecarRegistryFixture(t,{variant=null,repair=false,metadata=null}={}){
 const f=realGitFixture(t),file='config/production-verification-sidecar-registry.json'
 mkdirSync(path.join(f.dir,'config'),{recursive:true})
 const original=[{version:'20261010000000',issue:null}],author={version:'20261011220717',issue:4210},upstream={version:'20261011201710',issue:4172}
 const encode=items=>JSON.stringify({schema_version:1,sidecars:items},null,2)+'\n'
 const metadataFile='config/detector-baseline.json',sourceFile='detector.txt'
 const pin=(source,extra='stable')=>JSON.stringify({hash:createHash('sha256').update(source).digest('hex'),extra},null,2)+'\n'
 const originalSource='original\nseparator1\nseparator2\nend\n',authorSource='author\nseparator1\nseparator2\nend\n',mainSource='original\nseparator1\nseparator2\nprotected\n'
 if(metadata){
   f.commit(sourceFile,originalSource);f.commit(metadataFile,pin(originalSource))
   f.commit('config/review-carry-forward-stored-hashes-v1.json',JSON.stringify({schema_version:1,entries:[{file:metadataFile,field:'hash',source:sourceFile}]})+'\n')
 }
 const base=f.commit(file,encode(original))
 f.git(['switch','-qc','registry-author',base])
 if(metadata){f.commit(sourceFile,authorSource);writeFileSync(path.join(f.dir,metadataFile),metadata==='stale'?pin(originalSource):pin(authorSource,metadata==='other-bytes'?'changed':'stable'));f.git(['add',metadataFile]);f.git(['commit','--allow-empty','-qm','author pin'])}

 const shared={version:'20261011110000',issue:555}
 if(variant==='author-missing-issue')author.issue=null
 const authorAdditions=variant==='union-size'?Array.from({length:500},(_,i)=>({version:String(20261011230000+i),issue:600+i})):[...(variant==='same-overlap'?[shared]:[]),author]
 const before=f.commit(file,encode([...original,...authorAdditions]))
 if(repair)f.commit('app.txt','context\nreal repaired source\nend\n')
 if(variant==='extra-conflict')f.commit('app.txt','author conflict\n')
 if(variant==='custom')f.commit('.gitattributes',file+' merge=union\n')
 f.git(['switch','-qc','registry-main',base])
 if(metadata){f.commit(sourceFile,mainSource);f.commit(metadataFile,pin(mainSource))}
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
 if(metadata){const mergedSource=readFileSync(path.join(f.dir,sourceFile),'utf8');writeFileSync(path.join(f.dir,metadataFile),pin(mergedSource));f.git(['add',metadataFile])}
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
 assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,headSha:f.after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}))
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

test('registered authenticated hash conflict plus exact registry union preserves paid caps',t=>{
 const f=sidecarRegistryFixture(t,{metadata:'valid'}),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
 assert.equal(proof.kind,'unchanged');assert.equal(proof.canonicalRegistryUnions.length,1)
 assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,headSha:f.after},{...io([row(),row(2)]),reviewContentComparison:()=>({before:digest,after:digest,budgetProof:{...proof,before:head}})}))
})
test('registered hash conflict cannot conceal substantive authored repair',t=>{
 const f=sidecarRegistryFixture(t,{metadata:'valid',repair:true}),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
 assert.equal(proof.kind,'substantive');assert.equal(proof.witness.path,'app.txt')
})
for(const metadata of ['stale','other-bytes'])test(`stored hash conflict refuses ${metadata}`,t=>{
 const f=sidecarRegistryFixture(t,{metadata});assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/provenance refused/)
})
test('authenticated stored hash does not admit an additional source conflict',t=>{
 const f=sidecarRegistryFixture(t,{metadata:'valid',variant:'extra-conflict'})
 assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/conflict is outside/)
})
test('stored hash reconstruction authenticates original stages',t=>{
 const f=sidecarRegistryFixture(t,{metadata:'valid'})
 const forged=args=>{try{return f.git(args)}catch(error){if(args[0]==='merge-tree'&&error.status===1)error.stdout=error.stdout.replace(/100644 [0-9a-f]{40} 2\tconfig\/detector-baseline.json/,'100644 '+'f'.repeat(40)+' 2\tconfig/detector-baseline.json');throw error}}
 assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,forged),/stored hash conflict stages/)
})
test('resolved metadata requires a valid source hash and all other bytes',t=>{
 for(const wrong of ['stale','other-bytes','mode']){
  const f=sidecarRegistryFixture(t,{metadata:'valid'})
  const file='config/detector-baseline.json',record=JSON.parse(readFileSync(path.join(f.dir,file),'utf8'))
  if(wrong==='stale')record.hash='f'.repeat(64)
  if(wrong==='other-bytes')record.extra='changed'
  if(wrong==='mode'){f.git(['update-index','--chmod=+x',file]);f.git(['commit','-qm','metadata mode'])}
  else f.commit(file,JSON.stringify(record,null,2)+'\n')
  assert.throws(()=>derivePaidContentProof(f.before,f.git(['rev-parse','HEAD']).trim(),f.main,f.git),/provenance refused/)
 }
})

// #4797: after a paid start, main itself evolves a registered stored-hash file
// (sidecar counts plus its own re-pin), or the author side re-pins while a
// byte-level rewrite dropped a trailing newline. The branch must still absorb
// main by an ordinary merge. Exactly one side may drift beyond its verified
// pin; a rebase that orphans the paid start, or a pull request that edits the
// same non-pin bytes as main, keeps refusing.
function storedHashEvolutionFixture(t,{variant='main-drift',orphan=false}={}){
 const f=realGitFixture(t),file='docs/baseline.json',source='scripts/detector.py'
 mkdirSync(path.join(f.dir,'docs'),{recursive:true});mkdirSync(path.join(f.dir,'scripts'),{recursive:true});mkdirSync(path.join(f.dir,'config'),{recursive:true})
 const sha=text=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex')
 const detector=({pr=false,main=false})=>`# detector\n${pr?'pr edit':'base line B'}\nbase line 1\nbase line 2\nbase line 3\nbase line 4\nbase line 5\nbase line 6\nbase line 7\n${main?'main edit':'base line C'}\n`
 const registryText='config/review-carry-forward-stored-hashes-v1.json',registry=JSON.stringify({schema_version:1,entries:[{file,field:'detector_source_sha256',source}]})+'\n'
 const baseline=({pin,total=771,matched=106,newline=true})=>JSON.stringify({detector_schema_version:1,detector_source_sha256:pin,command:'node scripts/check-production-verification-sidecars.mjs',total_migration_files:total,matched_count:matched},null,2)+(newline?'\n':'')
 const commitAll=entries=>{for(const [p,text] of entries)writeFileSync(path.join(f.dir,p),text);f.git(['add','.']);f.git(['commit','-qm','fixture']);return f.git(['rev-parse','HEAD']).trim()}
 f.git(['switch','main'])
 const base=commitAll([[source,detector({})],[file,baseline({pin:sha(detector({}))})],[registryText,registry],['app.txt','context\nseparator1\nseparator2\nauthor\nend\n']])
 f.git(['switch','-qc','evolution-author',base])
 const authorBaseline={pin:sha(detector({pr:true})),newline:variant!=='author-newline'}
 if(variant==='both-drift')authorBaseline.matched=107
 const before=commitAll([[source,detector({pr:true})],[file,baseline(authorBaseline)],['app.txt','context\nseparator1\nseparator2\nfixed\nend\n']])
 f.git(['switch','main'])
 const mainBaseline={pin:sha(detector({main:true}))}
 if(variant==='main-drift'||variant==='both-drift')mainBaseline.total=772
 const main=commitAll([[source,detector({main:true})],[file,baseline(mainBaseline)]])
 const mergedDetector=detector({pr:true,main:true}),resolved={pin:sha(mergedDetector),newline:variant!=='author-newline'}
 if(variant==='main-drift')resolved.total=772
 if(variant==='both-drift')resolved.matched=107
 if(orphan){
  f.git(['switch','-qc','evolution-orphan',main])
  const after=commitAll([['app.txt','context\nseparator1\nseparator2\nfixed\nend\n'],[source,mergedDetector],[registryText,registry],[file,baseline(resolved)]])
  return {...f,file,before,main,after}
 }
 f.git(['switch','evolution-author']);assert.throws(()=>f.git(['merge','--no-commit','main']),/./)
 writeFileSync(path.join(f.dir,file),baseline(resolved))
 f.git(['add',file]);f.git(['commit','-qm','absorb main'])
 const after=f.git(['rev-parse','HEAD']).trim()
 return {...f,file,before,main,after}
}
test('#4797 main-side stored-hash evolution merge preserves the paid budget walk',t=>{
 const f=storedHashEvolutionFixture(t),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
 assert.equal(proof.kind,'unchanged')
 const rows=[1,2].map(n=>({...row(n,f.before),commit:{message:message(n,f.before)}}))
 assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,headSha:f.after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}))
})
test('#4797 author-side trailing-newline re-pin merge (PR #4772 topology) preserves the budget walk',t=>{
 const f=storedHashEvolutionFixture(t,{variant:'author-newline'}),proof=derivePaidContentProof(f.before,f.after,f.main,f.git)
 assert.equal(proof.kind,'unchanged')
 const rows=[1,2].map(n=>({...row(n,f.before),commit:{message:message(n,f.before)}}))
 assert.doesNotThrow(()=>assertPaidReviewCapacity({...request,headSha:f.after},{listRefs:()=>rows,reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}))
})
test('#4797 an orphaning rebase still refuses through the single-side stored-hash bridge',t=>{
 const f=storedHashEvolutionFixture(t,{variant:'main-drift',orphan:true})
 assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/complete first-parent ancestry/)
})
test('#4797 both sides changing stored-hash non-pin bytes still refuses',t=>{
 const f=storedHashEvolutionFixture(t,{variant:'both-drift'})
 assert.throws(()=>derivePaidContentProof(f.before,f.after,f.main,f.git),/stored hash conflict changes other bytes/)
})

// #4290 / PR #4206: after a branch refresh from main, an older reviewed head cannot be
// re-merged against the moved main (merge gap), so its direct proof throws. It is
// classified through newer direct proofs when those establish a result; otherwise a
// narrow unresolved merge gap spends the ordinary allowance conservatively.
const GAP='review budget Git provenance refused: review budget conflict is outside the one canonical test append'
function chainIo({heads,proofs,fail={}}){
  const rows=heads.map((h,i)=>row(i+1,h)),bases=new Set()
  return {listRefs:()=>rows,getCommit:sha=>({message:message(Number(sha),heads[Number(sha)-1])}),bases,
    reviewContentComparison:(before,after,pr,ctx)=>{ctx.base??=head;bases.add(ctx.base);const key=`${before[0]}>${after[0]}`
      if(fail[key])throw new Error(fail[key]);const kind=proofs[key];if(!kind)throw new Error(GAP)
      return {before:digest,after:digest,budgetProof:{schema:1,before,after,protectedMain:ctx.base,kind,historyCount:1}}}}
}
const old='e'.repeat(40),reviewed='f'.repeat(40),fresh='9'.repeat(40),mid='8'.repeat(40)
const capacity=(x)=>assertPaidReviewCapacity({...request,headSha:fresh},x)
test('an older head behind the merge gap composes through a newer direct proof (substantive older edit)',()=>{
  const x=chainIo({heads:[old,reviewed],proofs:{'f>9':'unchanged','e>f':'substantive'}})
  assert.equal(capacity(x).paidAttempts,1);assert.deepEqual([...x.bases],[head],'one base for every comparison')
})
test('unchanged composition is still counted; extra draws are allowed (uncapped)',()=>{
  assert.doesNotThrow(()=>capacity(chainIo({heads:[old,reviewed],proofs:{'f>9':'unchanged','e>f':'unchanged'}})))
})
test('a substantive newer head makes the composed older head substantive',()=>{
  assert.equal(capacity(chainIo({heads:[old,reviewed],proofs:{'f>9':'substantive','e>f':'unchanged'}})).paidAttempts,0)
})
test('two substantive links do not compose and the older unresolved start spends one attempt',()=>{
  const x=chainIo({heads:[old,reviewed],proofs:{'f>9':'substantive','e>f':'substantive'}})
  assert.deepEqual(capacity(x),{paidAttempts:1,remaining:null,uncapped:true,conservativeHeads:[old]})
})
test('one unresolved merge-gap start consumes one existing attempt conservatively',()=>{
  assert.deepEqual(capacity(chainIo({heads:[old],proofs:{}})),{paidAttempts:1,remaining:null,uncapped:true,conservativeHeads:[old]})
})
test('#4397 a conflicted replay across a protected-main rename is bridged as the conservative merge gap',()=>{
  const RENAME_GAP='review budget Git provenance refused: review budget protected rename merge gap'
  const x=chainIo({heads:[old],proofs:{},fail:{'e>9':RENAME_GAP}})
  assert.deepEqual(capacity(x),{paidAttempts:1,remaining:null,uncapped:true,conservativeHeads:[old]})
  const pr=chainIo({heads:[old],proofs:{},fail:{'e>9':'review budget Git provenance refused: review budget renamed merge source refused'}})
  assert.throws(()=>capacity(pr),/renamed merge source refused/,'a pull-request-side rename is never a gap')
})
test('exact-bound reviewer failure refunds an unresolved merge-gap start without conservative charging',()=>{
  const x=chainIo({heads:[old,reviewed],proofs:{'f>9':'unchanged','e>f':'unchanged'}})
  const failureSha='f'.repeat(39)+'1'
  x.readRef=ref=>ref===`refs/db-review-failures/3536-4000-${old}-1`?failureSha:null
  const getCommit=x.getCommit
  x.getCommit=sha=>sha===failureSha?{message:failureMsg(1,{reviewer:'glm-5.3',h:old})}:getCommit(sha)
  const result=capacity(x)
  assert.equal(result.reinstated,1)
  assert.deepEqual(result.failedReviewers,['glm-5.3'])
  assert.equal('conservativeHeads' in result,false)
})
test('two unresolved merge-gap starts are counted; further draws are allowed (uncapped)',()=>{
  assert.doesNotThrow(()=>capacity(chainIo({heads:[old,reviewed],proofs:{}})))
})
test('disagreeing chains are counted conservatively, independent of draw order',()=>{
  for(const heads of [[old,mid,reviewed],[old,reviewed,mid]])
    assert.doesNotThrow(()=>capacity(chainIo({heads,proofs:{'f>9':'unchanged','8>9':'unchanged','e>f':'substantive','e>8':'unchanged'}})))
})
test('a chained result is never an intermediate (no multi-hop)',()=>{
  const o1='3'.repeat(40)
  const x=chainIo({heads:[o1,mid,reviewed],proofs:{'f>9':'unchanged','8>f':'substantive','3>8':'unchanged'}})
  assert.doesNotThrow(()=>capacity(x))
})
for(const message of ['git fetch failed','review budget Git provenance refused: review budget historical evidence mutated generation','review budget Git provenance refused: review budget canonical blob bytes unreadable or oversized','review budget Git provenance refused: review budget foreign intermediate evidence pair refused','review budget Git provenance refused: review budget noncanonical or foreign merge refused']){
  test(`a non-gap direct refusal is never bridged: ${message.slice(37)}`,()=>{
    assert.throws(()=>capacity(chainIo({heads:[old,reviewed],proofs:{'f>9':'unchanged','e>f':'substantive'},fail:{'e>9':message}})),new RegExp(message.slice(37)))
  })
  test(`a non-gap link refusal refuses instead of trying the next chain: ${message.slice(37)}`,()=>{
    assert.throws(()=>capacity(chainIo({heads:[old,mid,reviewed],proofs:{'f>9':'unchanged','8>9':'unchanged','e>8':'substantive'},fail:{'e>f':message}})),new RegExp(message.slice(37)))
  })
}
test('a malformed returned proof is never bridged',()=>{
  const x=chainIo({heads:[old,reviewed],proofs:{'f>9':'unchanged','e>f':'substantive'}}),compare=x.reviewContentComparison
  x.reviewContentComparison=(b,a,pr,ctx)=>b[0]==='e'&&a[0]==='9'?{before:digest,after:digest,budgetProof:{schema:1,before:reviewed,after:a,protectedMain:head,kind:'unchanged'}}:compare(b,a,pr,ctx)
  assert.throws(()=>capacity(x),/author-owned Git provenance proof unreadable/)
})
test('a proof naming a base other than the operation base refuses',()=>{
  const x=chainIo({heads:[old,reviewed],proofs:{'f>9':'unchanged','e>f':'substantive'}}),compare=x.reviewContentComparison
  x.reviewContentComparison=(b,a,pr,ctx)=>{const r=compare(b,a,pr,ctx);if(b[0]==='e')r.budgetProof.protectedMain='4'.repeat(40);return r}
  assert.throws(()=>capacity(x),/author-owned Git provenance proof unreadable/)
})
test('duplicate-head starts are each counted',()=>{
  assert.equal(capacity(chainIo({heads:[old,old,reviewed],proofs:{'f>9':'substantive','e>f':'substantive','e>9':'unchanged'}})).paidAttempts,2)
})

test('#4397 a clean refresh across a rename made on protected main keeps the paid budget proof',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'review-budget-rename-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']})
 git(['init','-q','-b','main']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test']);git(['config','core.autocrlf','false'])
 const commit=(file,text)=>{writeFileSync(path.join(dir,file),text);git(['add',file]);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']).trim()}
 commit('lib.txt','library\nshared\nbody\n');commit('app.txt','context\nauthor\nend\n');git(['switch','-qc','feature'])
 const before=commit('app.txt','context\nfixed\nend\n')
 git(['switch','main']);git(['mv','lib.txt','moved.txt']);git(['commit','-qm','protected rename']);const main=git(['rev-parse','HEAD']).trim()
 git(['switch','feature']);git(['merge','-qm','main refresh','main']);const after=git(['rev-parse','HEAD']).trim()
 assert.equal(derivePaidContentProof(before,after,main,git).kind,'unchanged')
})

test('#4397 a rename inside the pull request still refuses the budget replay',t=>{
 const f=realGitFixture(t);f.git(['switch','main']);const main=f.commit('other.txt','other\n')
 f.git(['switch','feature']);f.git(['mv','app.txt','renamed.txt']);f.git(['commit','-qm','pr rename']);const renamed=f.git(['rev-parse','HEAD']).trim()
 f.git(['merge','-qm','main refresh','main']);const after=f.git(['rev-parse','HEAD']).trim()
 assert.throws(()=>derivePaidContentProof(renamed,after,main,f.git),/renamed merge source refused/)
})

test('#4397 a conflicted protected-rename replay reports the merge gap, not a hard refusal',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'review-budget-rename-gap-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']})
 git(['init','-q','-b','main']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test']);git(['config','core.autocrlf','false'])
 const commit=(file,text)=>{writeFileSync(path.join(dir,file),text);git(['add',file]);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']).trim()}
 commit('lib.txt','library\nshared\nbody\n');commit('app.txt','context\nauthor\nend\n');git(['switch','-qc','feature'])
 const before=commit('app.txt','context\nfeature edit\nend\n')
 git(['switch','main']);git(['mv','lib.txt','moved.txt']);git(['commit','-qm','protected rename']);const main=commit('app.txt','context\nmain edit\nend\n')
 git(['switch','feature']);try{git(['merge','-q','main'])}catch{}
 writeFileSync(path.join(dir,'app.txt'),'context\nfeature edit\nmain edit\nend\n');git(['add','app.txt']);git(['commit','-qm','resolved main refresh']);const after=git(['rev-parse','HEAD']).trim()
 assert.throws(()=>derivePaidContentProof(before,after,main,git),/protected rename merge gap/)
})

// #4889: legacy paid starts preceded any contract files. Transient records
// authenticate identity only; their results/tails never become approval evidence.
function preEvidenceRetirementFixture(t,{bad=null}={}){
 const f=realGitFixture(t),sha=()=>f.git(['rev-parse','HEAD']).trim()
 const issue=3536,pr=3999,dir=g=>path.join(f.dir,`.agent/work/${issue}/${g}`)
 const root={schema_version:1,work_issue:issue,work_type:'repo-maintenance',route:'repo-maintenance',goal:'Pre-evidence recovery fixture',base_sha:f.base,dispatcher:'fixture',worker:'fixture',branch:'feature',worktree:f.dir,allowed_paths:['app.txt',`.agent/work/${issue}/**`],file_writes:['app.txt',`.agent/work/${issue}/**`],db_reads:[],db_writes:[],prohibited_actions:[],required_checks:['fixture'],assumptions:[],stop_conditions:['Stop on unknown']}
 const current={...root,schema_version:2,generation:2,evidence_parent:{work_issue:issue,generation:1,contract_sha256:contractHash(root)}}
 const published=new Map([[1,structuredClone(root)],[2,structuredClone(current)]])
 const pair=(c,implementation,variant)=>{
  const g=c.generation??1,d=dir(g);mkdirSync(d,{recursive:true})
  const r={schema_version:1,work_issue:issue,outcome:'ready-for-merge',pr,migration_versions:[],contract_ref:`refs/db-contracts/${issue}/${g}`,contract_sha256:contractHash(c),head_sha:implementation,base_sha:f.base,files_changed:f.git(['diff','--name-only',f.base,implementation]).trim().split('\n').filter(Boolean),db_reads:[],db_writes:[],checks:[{command:'fixture',exit_code:0,evidence:'Controlled fixture; not review approval'}],assumptions_resolved:[],stop_conditions_hit:[]}
  if(g===2&&bad?.startsWith('outcome-')){r.outcome=bad.slice('outcome-'.length);r.reason='Controlled unsuccessful endpoint outcome'}
  if(g===2&&bad?.startsWith('outcome-'))assert.doesNotThrow(()=>validateCompletionReport(r,{validateCompletionRecord}))
  if(variant==='foreign-pr')r.pr++
  if(variant==='foreign-issue')r.work_issue++
  if(variant==='hash')r.contract_sha256='f'.repeat(64)
  if(variant==='contract')c={...c,goal:'forged retained contract'}
  writeFileSync(path.join(d,'contract.json'),JSON.stringify(c))
  if(variant!=='partial')writeFileSync(path.join(d,'completion.json'),variant==='json'?'unreadable JSON':JSON.stringify(r))
  f.git(['add','.agent']);if(variant==='mode')f.git(['update-index','--chmod=+x',`.agent/work/${issue}/${g}/completion.json`])
  f.git(['commit','-qm','retained paired metadata'])
 }
 pair(root,f.before,bad)
 f.git(['rm','-r',`.agent/work/${issue}/1`]);f.git(['commit','-qm','retire ordinary transient metadata'])
 if(bad==='present')pair(root,f.before,null)
 if(bad==='foreign-merge'){
  f.git(['switch','-qc','foreign',f.base]);f.commit('foreign.txt','unapproved branch\n');f.git(['switch','feature']);f.git(['merge','-qm','foreign merge','foreign'])
 }
 const implementation=f.commit('app.txt','a genuine surviving product repair\n')
 pair(current,implementation,null)
 const after=sha()
 const read=ref=>{const m=/^refs\/db-contracts\/3536\/(\d+)$/.exec(ref);if(!m)throw Error('foreign published ref');if(bad==='unreadable-published')throw Error('published contract transport failed');return structuredClone(published.get(Number(m[1])))}
 const git=args=>{if(bad==='unreadable-source'&&args[0]==='ls-tree'&&args.includes(f.before)&&args.includes(`.agent/work/${issue}`))throw Error('source tree unreadable');return f.git(args)}
 return {...f,after,implementation,proof:()=>derivePaidContentProof(f.before,after,f.base,git,verifiedEvidencePaths(f.before,after,{gitRunner:git}),pr,read)}
}
test('#4889 pre-evidence transient retirement recovers conservatively without approval equivalence',t=>{
 const f=preEvidenceRetirementFixture(t),proof=f.proof()
 assert.equal(proof.kind,'unchanged');assert.equal(proof.witness,undefined)
 assert.deepEqual(proof.preEvidenceRetirements[0].generations,[1])
 // A real product edit remains in the strict content digest. Budget recovery
 // cannot carry an old review, and both original unknown starts stay charged.
 assert.notEqual(prContentDigest(f.before,f.base,{gitRunner:f.git}),prContentDigest(f.after,f.base,{gitRunner:f.git}))
 const starts=[1,2].map(n=>({...row(n,f.before),commit:{message:message(n,f.before)}}))
 const result=assertPaidReviewCapacity({...request,headSha:f.after},{...io(starts),reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})})
 assert.equal(result.paidAttempts,2);assert.equal(result.reinstated??0,0)
})
for(const bad of ['foreign-pr','foreign-issue','hash','contract','partial','json','mode','present','unreadable-published','unreadable-source','foreign-merge','outcome-failed','outcome-cancelled','outcome-returned'])test(`#4889 pre-evidence transient retirement refuses ${bad}`,t=>{
 const f=preEvidenceRetirementFixture(t,{bad})
 assert.throws(()=>f.proof())
})

function correctedTransientChecksFixture(t,{bad=null}={}){
 const f=realGitFixture(t),issue=3536,pr=3999,published=new Map(),sha=()=>f.git(['rev-parse','HEAD']).trim()
 const write=(generation,c,r)=>{
  const dir=path.join(f.dir,`.agent/work/${issue}/${generation}`);mkdirSync(dir,{recursive:true})
  writeFileSync(path.join(dir,'contract.json'),JSON.stringify(c));writeFileSync(path.join(dir,'completion.json'),JSON.stringify(r))
  f.git(['add','.agent']);f.git(['commit','-qm','paired transient evidence'])
 }
 const retire=g=>{f.git(['rm','-r',`.agent/work/${issue}/${g}`]);f.git(['commit','-qm','ordinary same-issue retirement'])}
 for(let generation=1;generation<=4;generation++){
  const c={schema_version:generation===1?1:2,...(generation===1?{}:{generation,evidence_parent:{work_issue:issue,generation:generation-1,contract_sha256:contractHash(published.get(generation-1))}}),work_issue:issue,work_type:'repo-maintenance',route:'repo-maintenance',goal:'Controlled corrected transient report',base_sha:f.base,dispatcher:'fixture',worker:'fixture',branch:'feature',worktree:f.dir,allowed_paths:['app.txt',`.agent/work/${issue}/**`],file_writes:['app.txt',`.agent/work/${issue}/**`],db_reads:[],db_writes:[],prohibited_actions:[],required_checks:['fixture'],assumptions:[],stop_conditions:['Stop on unknown']}
  published.set(generation,structuredClone(c))
  const implementation=f.commit('app.txt',`controlled implementation generation ${generation}\n`)
  const r={schema_version:1,work_issue:issue,outcome:'ready-for-merge',pr,migration_versions:[],contract_ref:`refs/db-contracts/${issue}/${generation}`,contract_sha256:contractHash(c),head_sha:implementation,base_sha:f.base,files_changed:['app.txt'],db_reads:[],db_writes:[],checks:[{command:'fixture',exit_code:0,evidence:'Controlled unchanged-source check'}],assumptions_resolved:[],stop_conditions_hit:[]}
  if(generation===3){
   const provisional=structuredClone(r);provisional.checks[0].command='bash fixture'
   if(bad==='old-failed')provisional.checks[0].exit_code=1
   if(bad==='old-empty')provisional.checks=[]
   if(bad==='extra-failed'){provisional.checks[0].command='fixture';provisional.checks.push({command:'extra',exit_code:1,evidence:'Actual failed extra check'})}
   if(bad==='files')provisional.files_changed=[]
   if(bad==='contract')c.goal='forged transient contract'
   if(bad==='pr')provisional.pr++
   if(bad==='issue')provisional.work_issue++
   if(bad==='hash')provisional.contract_sha256='f'.repeat(64)
   if(bad==='files')r.files_changed=[]
   if(bad==='not-later')write(generation,c,r)
   write(generation,c,provisional)
   if(bad==='partial'){
    f.git(['rm',`.agent/work/${issue}/3/completion.json`]);f.git(['commit','-qm','partial historical pair'])
   }
   if(bad==='json'){
    const file=path.join(f.dir,`.agent/work/${issue}/3/completion.json`);writeFileSync(file,'unreadable JSON');f.git(['add',file]);f.git(['commit','-qm','unreadable historical record'])
   }
   if(bad==='tail')f.commit('app.txt','unbound source edit between reports\n')
   if(bad==='head')r.head_sha=f.commit('app.txt','changed corrected implementation\n')
   if(bad==='field')r.assumptions_resolved=['changed non-check report field']
   if(bad==='new-failed')r.checks[0].exit_code=1
   if(!['uncorrected','not-later'].includes(bad))write(generation,c,r)
  }else write(generation,c,r)
  if(generation<4)retire(generation)
 }
 const after=sha(),read=ref=>{const match=/^refs\/db-contracts\/3536\/(\d+)$/.exec(ref);if(!match||bad==='published')throw Error('published contract unavailable');return structuredClone(published.get(Number(match[1])))}
 return {...f,after,proof:()=>derivePaidContentProof(f.before,after,f.base,f.git,verifiedEvidencePaths(f.before,after,{gitRunner:f.git}),pr,read)}
}
test('#4889 corrected transient check label authenticates later same-source report without refund or approval carry',t=>{
 const f=correctedTransientChecksFixture(t),proof=f.proof()
 assert.equal(proof.kind,'unchanged');assert.equal(proof.witness,undefined)
 assert.deepEqual(proof.preEvidenceRetirements[0].generations,[1,2,3])
 assert.equal(proof.supersededTransientCheckRecords.length,1)
 assert.equal(proof.supersededTransientCheckRecords[0].generation,3)
 assert.notEqual(proof.supersededTransientCheckRecords[0].provisionalReportJsonSha256,proof.supersededTransientCheckRecords[0].correctedReportJsonSha256)
 assert.notEqual(prContentDigest(f.before,f.base,{gitRunner:f.git}),prContentDigest(f.after,f.base,{gitRunner:f.git}))
 const starts=[1,2].map(n=>({...row(n,f.before),commit:{message:message(n,f.before)}}))
 assert.equal(assertPaidReviewCapacity({...request,headSha:f.after},{...io(starts),reviewContentComparison:()=>({before:digest,after:'d'.repeat(64),budgetProof:proof})}).paidAttempts,2)
})
for(const bad of ['uncorrected','old-failed','old-empty','extra-failed','new-failed','head','field','files','tail','not-later','partial','json','pr','issue','hash','contract','published'])test(`#4889 corrected transient check label refuses ${bad}`,t=>{
 assert.throws(()=>correctedTransientChecksFixture(t,{bad}).proof())
})
