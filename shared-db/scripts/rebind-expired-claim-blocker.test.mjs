import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claimBody, parseAuthorLease, resetRetirementSnapshot } from './manage-migration-author-lanes.mjs'
import { rebindExpiredClaimBlocker, BLOCKER_REBIND_REF_PREFIX, parseArgs, validateRequest } from './rebind-expired-claim-blocker.mjs'
import { MUTEX_REF } from './lib/lanes/constants.mjs'
import { EXCLUSIVE_REFS } from './lib/lanes/queue-routing.mjs'
const NOW=new Date('2026-10-14T00:46:30.703Z'),EXPIRY=new Date('2026-10-14T00:46:30.702Z')
const HEAD='a'.repeat(40),MAIN='b'.repeat(40),BASE='c'.repeat(40),RESERVATION='d'.repeat(40),VERSION='20261013130102',ARTIFACT='artifact:'+HEAD
const args={issue:2336,claim:4152,pr:4206,headSha:HEAD,oldOwner:'old-author',branch:'codex/licensing',worktree:'/old-clean',expectedBlockedOn:ARTIFACT,abandonmentIssue:900,authorizationChatId:'root',authorizationQuote:'Keep recovery within this chat'}
function fixture(){
  resetRetirementSnapshot()
  const claim={number:4152,state:'open',title:'CLAIM: #2336 licensing',body:claimBody({version:VERSION,objects:['table plm.plan'],owner:args.oldOwner,branch:args.branch,worktree:args.worktree,expiresAt:EXPIRY,capacityState:'relinquished',blockedOn:ARTIFACT,worktreeState:'clean',recoveryArtifact:ARTIFACT})}
  const work={number:2336,state:'open',body:'```db-work-scope\nstatus: ready\nwork_type: structural\nroute: claim-first\npriority: 1\nwrites:\n  - table plm.plan\n```'}
  const audit={number:900,state:'open',body:`Original author explicitly stopped; verified terminal handoff, not an idle-only inference.\n\n\`\`\`db-work-scope\nstatus: ready\nwork_type: repo-maintenance\nroute: repo-maintenance\npriority: 1\nwrites:\nreads:\n\`\`\`\n\n\`\`\`abandonment-audit\nclaim: 4152\npr: 4206\nhead_sha: ${HEAD}\nowner: old-author\n\`\`\``}
  const issues=new Map([[4152,claim],[2336,work],[900,audit]]),refs=new Map([['refs/db-claims/'+VERSION,RESERVATION]]),commits=new Map([[RESERVATION,{message:'permanent version'}]])
  let serial=0,writes=0
  const io={issues,refs,commits,get writes(){return writes},getIssue:n=>structuredClone(issues.get(Number(n))),updateIssue:(n,{body})=>{writes++;issues.get(Number(n)).body=body},openClaims:()=>[structuredClone(issues.get(4152))],getPr:()=>({state:'open',head:{sha:HEAD,ref:args.branch},base:{sha:BASE}}),getPrFiles:()=>[{filename:`supabase/migrations/${VERSION}_licensing.sql`,status:'added'}],prSources:()=>[{label:'PR #4206',branch:args.branch,objects:['table plm.plan'],versions:[VERSION]}],branchPulls:()=>[{number:4206,head:{sha:HEAD}}],flowAdapter:()=>({resolveMarker:()=>({live:true,task:'root',calling_task:'root'})}),localWorktreeState:()=>({state:'clean'}),localClean:()=>true,localHead:()=>HEAD,localBranch:()=>args.branch,verifyArtifact:r=>r===ARTIFACT?{sha:HEAD}:null,mainSha:()=>MAIN,compareCommits:()=>({status:'ahead',behind_by:0}),makeOwnerCommit:message=>{const sha=String(++serial).padStart(40,'0');commits.set(sha,{message});return sha},getCommit:sha=>commits.get(sha),readCommitMessage:sha=>commits.get(sha)?.message,readRef:ref=>refs.get(ref)??null,createRef:(ref,sha)=>{if(refs.has(ref))return false;refs.set(ref,sha);return true},deleteRef:ref=>refs.delete(ref),listRefs:prefix=>[...refs].filter(([ref])=>ref.startsWith(prefix+'/')).map(([ref,sha])=>({ref,sha})),wait:()=>{}}
  return io
}
test('one millisecond before expiry refuses before any commit/ref/write; exact expiry passes without changing clock',()=>{
  const io=fixture(),before=io.getIssue(4152).body
  assert.throws(()=>rebindExpiredClaimBlocker(args,new Date(EXPIRY.valueOf()-1),io),/expired relinquished/)
  assert.equal(io.commits.size,1);assert.equal(io.refs.size,1);assert.equal(io.writes,0);assert.equal(io.getIssue(4152).body,before)
  assert.equal(rebindExpiredClaimBlocker(args,EXPIRY,io).idempotent,false)
})
const refusals=[
 ['dirty worktree',io=>{io.localClean=()=>false}],['wrong local head',io=>{io.localHead=()=>BASE}],['wrong branch',io=>{io.localBranch=()=> 'other'}],
 ['held stage',io=>{io.refs.set(EXCLUSIVE_REFS.preview,BASE)}],['missing reservation',io=>{io.refs.delete('refs/db-claims/'+VERSION)}],['source moves',io=>{io.getPr=()=>({state:'open',head:{sha:BASE,ref:args.branch},base:{sha:BASE}})}],
 ['main ancestry fails',io=>{io.compareCommits=()=>({status:'diverged',behind_by:1})}],['source outside claim',io=>{io.prSources=()=>[{label:'PR #4206',branch:args.branch,objects:['table plm.other'],versions:[VERSION]}]}],
 ['claim roster differs',io=>{io.openClaims=()=>[]}],['audit closed',io=>{io.issues.get(900).state='closed'}],['audit wrong head',io=>{io.issues.get(900).body=io.issues.get(900).body.replace(HEAD,BASE)}],
 ['audit blocked',io=>{io.issues.get(900).body=io.issues.get(900).body.replace('status: ready','status: blocked')}],['audit owner decision',io=>{io.issues.get(900).body=io.issues.get(900).body.replace('status: ready','status: owner-decision')}],['audit owner-only route',io=>{io.issues.get(900).body=io.issues.get(900).body.replace('route: repo-maintenance','route: owner-only')}],
 ['ambiguous audit',io=>{io.issues.get(900).body+='\n```abandonment-audit\nclaim: 999\npr: 999\nhead_sha: '+BASE+'\nowner: foreign\n```'}],
 ['audit claims objects',io=>{io.issues.get(900).body=io.issues.get(900).body.replace('writes:\n','writes:\n  - table plm.plan\n')}],['actor mismatch',io=>{io.flowAdapter=()=>({resolveMarker:()=>({live:true,task:'foreign',calling_task:'foreign'})})}],
 ['wrong blocker',io=>{io.issues.get(4152).body=io.issues.get(4152).body.replace(`blocked_on: ${ARTIFACT}`,'blocked_on: issue:#999')}],['already resumed',io=>{io.issues.get(4152).body=io.issues.get(4152).body.replace('capacity_state: relinquished','capacity_state: active')}],
 ['recovery missing',io=>{io.verifyArtifact=()=>null}],['competing claim',io=>{const other=structuredClone(io.issues.get(4152));other.number=999;other.body=other.body.replace(VERSION,'20261013130103');io.openClaims=()=>[structuredClone(io.issues.get(4152)),other]}]
]
for(const [name,mutate]of refusals)test(`refuses ${name} before durable effects`,()=>{const io=fixture();mutate(io);const before=io.getIssue(4152).body;assert.throws(()=>rebindExpiredClaimBlocker(args,NOW,io));assert.equal(io.writes,0);assert.equal(io.getIssue(4152).body,before);assert.equal([...io.refs.keys()].some(ref=>ref.startsWith(BLOCKER_REBIND_REF_PREFIX)),false)})
test('receipt revalidation refuses a source race and preserves recovery record',()=>{
  const io=fixture(),create=io.createRef,before=io.getIssue(4152).body
  io.createRef=(ref,sha)=>{const result=create(ref,sha);if(ref.startsWith(BLOCKER_REBIND_REF_PREFIX))io.getPr=()=>({state:'closed'});return result}
  assert.throws(()=>rebindExpiredClaimBlocker(args,NOW,io),/source changed/);assert.equal(io.writes,0);assert.equal(io.getIssue(4152).body,before);assert.equal([...io.refs.keys()].filter(ref=>ref.startsWith(BLOCKER_REBIND_REF_PREFIX)).length,1)
})
test('post-write reservation drift rolls back exact original body under owned mutex',()=>{
  const io=fixture(),update=io.updateIssue,before=io.getIssue(4152).body
  io.updateIssue=(n,patch)=>{update(n,patch);if(io.writes===1)io.refs.set('refs/db-claims/'+VERSION,BASE)}
  assert.throws(()=>rebindExpiredClaimBlocker(args,NOW,io),/reservation/);assert.equal(io.getIssue(4152).body,before);assert.equal(io.writes,2)
})
test('lock loss after write reports partial state and never rolls back a foreign mutex',()=>{
  const io=fixture(),update=io.updateIssue
  io.updateIssue=(n,patch)=>{update(n,patch);io.refs.set(MUTEX_REF,BASE)}
  assert.throws(()=>rebindExpiredClaimBlocker(args,NOW,io),/ROLLBACK NOT ATTEMPTED/);assert.equal(io.writes,1);assert.equal(io.readRef(MUTEX_REF),BASE)
})
test('receipt alteration and later claim mutation cannot authorize replay',()=>{
  for(const corrupt of [io=>{const ref=[...io.refs.keys()].find(ref=>ref.startsWith(BLOCKER_REBIND_REF_PREFIX));io.commits.set(io.refs.get(ref),{message:'corrupt'})},io=>{io.issues.get(4152).body+='\nforeign edit'}]){
    const io=fixture();rebindExpiredClaimBlocker(args,NOW,io);corrupt(io);assert.throws(()=>rebindExpiredClaimBlocker(args,NOW,io),/receipt/);assert.equal(io.writes,1)
  }
})
test('failed receipt creation/readback leaves original claim and a recoverable receipt untouched',()=>{
  for(const mode of ['create','readback']){
    const io=fixture(),before=io.getIssue(4152).body,create=io.createRef,read=io.readRef
    if(mode==='create')io.createRef=(ref,sha)=>ref.startsWith(BLOCKER_REBIND_REF_PREFIX)?false:create(ref,sha)
    else io.readRef=ref=>ref.startsWith(BLOCKER_REBIND_REF_PREFIX)?null:read(ref)
    assert.throws(()=>rebindExpiredClaimBlocker(args,NOW,io),/receipt/);assert.equal(io.getIssue(4152).body,before);assert.equal(io.writes,0);assert.equal(io.readRef(MUTEX_REF),null)
  }
})
test('old-owner renewal during receipt creation refuses without overwriting its change',()=>{
  const io=fixture(),create=io.createRef
  io.createRef=(ref,sha)=>{const result=create(ref,sha);if(ref.startsWith(BLOCKER_REBIND_REF_PREFIX))io.issues.get(4152).body=io.issues.get(4152).body.replace(EXPIRY.toISOString(),'2026-10-15T00:00:00.000Z');return result}
  assert.throws(()=>rebindExpiredClaimBlocker(args,NOW,io),/expired relinquished/);assert.equal(io.writes,0);assert.match(io.getIssue(4152).body,/2026-10-15/)
})
test('failed rollback is explicit and never called successful recovery',()=>{
  const io=fixture(),update=io.updateIssue
  io.updateIssue=(n,patch)=>{if(io.writes===1)throw Error('rollback transport refused');update(n,patch);io.refs.set('refs/db-claims/'+VERSION,BASE)}
  assert.throws(()=>rebindExpiredClaimBlocker(args,NOW,io),/ROLLBACK INCOMPLETE: rollback transport refused/);assert.equal(io.writes,1)
})
test('quota-free owner-verified cleanup preserves successful result when API cleanup fails',()=>{
  const io=fixture(),read=io.readRef;let afterWriteReads=0,fallback=0
  io.readRef=ref=>{if(ref===MUTEX_REF&&io.writes>0&&++afterWriteReads===2)throw Error('API rate limit');return read(ref)}
  io.releaseRefOverGit=(ref,sha)=>{fallback++;assert.equal(io.refs.get(ref),sha);io.refs.delete(ref);return true}
  const result=rebindExpiredClaimBlocker(args,NOW,io);assert.equal(result.idempotent,false);assert.equal(fallback,1);assert.equal(io.refs.has(MUTEX_REF),false);assert.equal(io.writes,1)
})
test('both cleanup channels failing exposes completed receipt and held lock without repeating mutation',()=>{
  const io=fixture(),read=io.readRef;let afterWriteReads=0
  io.readRef=ref=>{if(ref===MUTEX_REF&&io.writes>0&&++afterWriteReads===2)throw Error('API cleanup failed');return read(ref)}
  io.releaseRefOverGit=()=>{throw Error('git cleanup failed')}
  assert.throws(()=>rebindExpiredClaimBlocker(args,NOW,io),error=>{assert.match(error.message,/OPERATION_COMPLETED/);assert.match(error.message,/git cleanup failed/);assert.equal(error.completedResult.claim,4152);assert.equal(error.completedResult.idempotent,false);return true})
  assert.equal(io.writes,1);assert.ok(io.refs.get(MUTEX_REF));assert.equal(parseAuthorLease(io.getIssue(4152).body,NOW).blockedOn,'issue:#900')
})
test('unknown lock ownership after mutation reports exact partial receipt without unsafe rollback',()=>{
  const io=fixture(),update=io.updateIssue,read=io.readRef;let released=0
  io.updateIssue=(n,patch)=>{update(n,patch);io.getPr=()=>({state:'closed'})}
  io.readRef=ref=>{if(ref===MUTEX_REF&&io.writes)throw Error('ownership read failed');return read(ref)}
  io.releaseRefOverGit=(ref,sha)=>{released++;assert.equal(io.refs.get(ref),sha);io.refs.delete(ref);return true}
  assert.throws(()=>rebindExpiredClaimBlocker(args,NOW,io),error=>{assert.match(error.message,/source changed.*ROLLBACK NOT ATTEMPTED.*ownership is unknown/);assert.equal(error.mutationEvidence.mutation_attempted,true);assert.equal(error.mutationEvidence.observed_state,'rebound');assert.ok(error.mutationEvidence.receipt_sha);return true})
  assert.equal(io.writes,1);assert.equal(released,1);assert.equal(io.refs.has(MUTEX_REF),false)
})
test('unknown mutation and unreadable claim state remain explicit when update transport fails',()=>{
  const io=fixture(),update=io.updateIssue,read=io.readRef,get=io.getIssue
  io.updateIssue=(n,patch)=>{update(n,patch);throw Error('update response lost')}
  io.readRef=ref=>{if(ref===MUTEX_REF&&io.writes)throw Error('ownership read failed');return read(ref)}
  io.getIssue=n=>{if(io.writes&&Number(n)===4152)throw Error('claim read failed');return get(n)}
  io.releaseRefOverGit=(ref,sha)=>{assert.equal(io.refs.get(ref),sha);io.refs.delete(ref);return true}
  assert.throws(()=>rebindExpiredClaimBlocker(args,NOW,io),error=>{assert.match(error.message,/update response lost.*ROLLBACK NOT ATTEMPTED/);assert.equal(error.mutationEvidence.observed_state,'unreadable');assert.ok(error.mutationEvidence.receipt_sha);return true})
  assert.equal(io.writes,1)
})
test('CLI and API reject malformed, duplicate, unknown or incomplete requests',()=>{
  for(const argv of [['--unknown','x'],['--issue'],['--issue','1','--issue','2']])assert.throws(()=>parseArgs(argv))
  assert.throws(()=>validateRequest({...args,leaseHours:0.5}));assert.throws(()=>validateRequest({...args,expectedBlockedOn:'bad\nowner: foreign'}));assert.throws(()=>validateRequest({...args,authorizationQuote:'short'}))
  const dir=mkdtempSync(join(tmpdir(),'blocker-rebind-'))
  try{const file=join(dir,'quote');writeFileSync(file,args.authorizationQuote);const flags={'issue':'--issue','claim':'--claim-number','pr':'--pr','headSha':'--head-sha','oldOwner':'--old-owner','branch':'--branch','worktree':'--worktree','expectedBlockedOn':'--expected-blocked-on','abandonmentIssue':'--abandonment-issue','authorizationChatId':'--authorization-chat-id'};const argv=Object.entries(flags).flatMap(([key,flag])=>[flag,String(args[key])]);assert.deepEqual(parseArgs([...argv,'--authorization-quote-file',file]),args)}finally{rmSync(dir,{recursive:true})}
})

test('preserved dirty claim with work-issue blocker rebinds when published PR head is exact',()=>{
  const dirtyArgs={...args,expectedBlockedOn:'issue:#2336'}
  const io=fixture()
  io.issues.get(4152).body=claimBody({version:VERSION,objects:['table plm.plan'],owner:args.oldOwner,branch:args.branch,worktree:args.worktree,expiresAt:EXPIRY,capacityState:'relinquished',blockedOn:'issue:#2336',worktreeState:'dirty',recoveryArtifact:null})
  io.localClean=()=>false
  io.localHead=()=>BASE
  io.localBranch=()=>'other'
  const before=io.getIssue(4152).body
  const result=rebindExpiredClaimBlocker(dirtyArgs,NOW,io)
  assert.equal(result.idempotent,false)
  assert.equal(io.writes,1)
  assert.equal(io.getIssue(4152).body,before.replace('blocked_on: issue:#2336','blocked_on: issue:#900'))
  const after=parseAuthorLease(io.getIssue(4152).body,NOW)
  assert.equal(after.worktreeState,'dirty')
  assert.equal(after.blockedOn,'issue:#900')
  assert.equal(after.owner,args.oldOwner)
})

test('clean-declared claim still refuses when local custody is dirty',()=>{
  const io=fixture()
  io.localClean=()=>false
  assert.throws(()=>rebindExpiredClaimBlocker(args,NOW,io),/original clean source custody changed|expired relinquished/)
})

test('dirty-declared claim still refuses when the source PR head moves',()=>{
  const dirtyArgs={...args,expectedBlockedOn:'issue:#2336'}
  const io=fixture()
  io.issues.get(4152).body=claimBody({version:VERSION,objects:['table plm.plan'],owner:args.oldOwner,branch:args.branch,worktree:args.worktree,expiresAt:EXPIRY,capacityState:'relinquished',blockedOn:'issue:#2336',worktreeState:'dirty',recoveryArtifact:null})
  io.getPr=()=>({state:'open',head:{sha:BASE,ref:args.branch},base:{sha:BASE}})
  const before=io.getIssue(4152).body
  assert.throws(()=>rebindExpiredClaimBlocker(dirtyArgs,NOW,io))
  assert.equal(io.writes,0)
  assert.equal(io.getIssue(4152).body,before)
})
