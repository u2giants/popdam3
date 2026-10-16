import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claimBody, formatRetirementRecord, main, parseAuthorLease, rebindClaimWorktree, renewExpiredClaim, resetRetirementSnapshot, resumeAuthorLease, transferClaimAuthor, handoffClaimAuthor, CLAIM_AUTHOR_HANDOFF_REF_PREFIX, prepareAuthorHandoff, checkInAuthor } from './manage-migration-author-lanes.mjs'

const NOW=new Date('2026-09-28T12:00:00Z')
const HEAD='a'.repeat(40),VERSION='20260923181754',RESERVATION='d'.repeat(40)
const QUOTE='I authorize the exact guarded operator adoption for the expired claim.'
const ARTIFACT='artifact:'+'f'.repeat(40)
const args={issue:2110,claim:3378,pr:3391,headSha:HEAD,oldOwner:'old-author',newOwner:'new-author',
  branch:'codex/2110-old',worktree:'C:/old-remote',targetWorktree:'/tmp/new-author',
  abandonmentIssue:900,worktreeState:'remote',authorizationChatId:'root',authorizationQuote:QUOTE,recoveryArtifact:ARTIFACT,leaseHours:0.5}

function fixture(overrides={}){
  resetRetirementSnapshot()
  const claim={number:3378,state:'open',title:'CLAIM: #2110 frozen schema',body:claimBody({
    version:VERSION,objects:['table plm.art_piece_attachment'],owner:args.oldOwner,branch:args.branch,
    worktree:args.worktree,expiresAt:new Date('2026-09-26T00:00:00Z'),
  })}
  const work={number:2110,state:'open',body:['```db-work-scope','status: ready','work_type: structural','route: shared-db-orchestrator','priority: 1','writes:','  - table plm.art_piece_attachment','```'].join('\n')}
  const audit={number:900,state:'open',body:['```db-work-scope','status: ready','work_type: repo-maintenance','route: repo-maintenance','priority: 1','objects:','```','','```abandonment-audit','claim: 3378','pr: 3391','head_sha: '+HEAD,'owner: old-author','```'].join('\n')}
  const issues=new Map([[3378,claim],[2110,work],[900,audit]]),refs=new Map([['refs/db-claims/'+VERSION,RESERVATION]]),commits=new Map([[RESERVATION,{message:'db-coordination permanent version reservation'}]])
  let serial=0
  const io={
    issues,refs,commits,
    getIssue:(n)=>structuredClone(issues.get(Number(n))),
    updateIssue:(n,{body})=>{issues.get(Number(n)).body=body},
    openClaims:()=>[structuredClone(issues.get(3378))],
    getPr:()=>({state:'open',head:{sha:HEAD,ref:args.branch}}),
    getPrFiles:()=>[{filename:'supabase/migrations/'+VERSION+'_retire.sql',status:'added'}],
    prSources:()=>[{label:'PR #3391',branch:args.branch,objects:['table plm.art_piece_attachment'],versions:[VERSION]}],
    branchPulls:()=>[{number:3391,head:{sha:HEAD}}],
    orchestratorFlowAdapter:()=>({resolveMarker:()=>({live:true,calling_task:'root',task:'root'})}),
    verifyArtifact:(reference)=>reference===ARTIFACT?{sha:'f'.repeat(40)}:null,
    readCommitMessage:(sha)=>commits.get(sha)?.message??null,
    localWorktreeState:()=>({state:'absent'}),
    localClean:()=>true,localHead:()=>HEAD,localBranch:()=>args.branch,
    makeOwnerCommit:(message)=>{const sha=String(++serial).padStart(40,'0');commits.set(sha,{message});return sha},
    getCommit:(sha)=>commits.get(sha),
    createRef:(ref,sha)=>{if(refs.has(ref))return false;refs.set(ref,sha);return true},
    readRef:(ref)=>refs.get(ref)??null,
    deleteRef:(ref)=>{refs.delete(ref)},
    listRefs:(prefix)=>[...refs].filter(([ref])=>ref.startsWith(prefix+'/')).map(([ref,sha])=>({ref,sha})),
    wait:()=>{},
  }
  return Object.assign(io,overrides)
}

test('guarded adoption retains claim, version, objects and PR, records operator provenance before mutation, and replays idempotently',()=>{
  const io=fixture(),before=parseAuthorLease(io.issues.get(3378).body,NOW)
  const result=transferClaimAuthor(args,NOW,io),after=parseAuthorLease(io.issues.get(3378).body,NOW)
  assert.equal(result.idempotent,false)
  assert.equal(after.owner,'new-author')
  assert.equal(after.worktree,args.targetWorktree)
  assert.equal(after.version,before.version)
  assert.deepEqual(after.objects,before.objects)
  assert.equal(io.refs.get('refs/db-claims/'+VERSION),RESERVATION)
  const record=JSON.parse(io.commits.get(result.sha).message.split('claim-author-operator-adoption ')[1])
  assert.equal(record.human_identity_authenticated,false)
  assert.equal(record.authorization_quote,QUOTE)
  assert.equal(record.reservation_sha,RESERVATION)
  assert.equal(transferClaimAuthor(args,NOW,io).idempotent,true)
})

function quarantine(io,overrides={}){
  io.issues.get(3378).body=claimBody({version:VERSION,objects:['table plm.art_piece_attachment'],owner:args.oldOwner,branch:args.branch,
    worktree:args.worktree,expiresAt:new Date('2026-09-26T00:00:00Z'),capacityState:'relinquished',blockedOn:'issue:#900',worktreeState:'remote',...overrides})
}

test('exact quarantined successor adoption restores active capacity and removes quarantine metadata',()=>{
  const io=fixture();quarantine(io,{recoveryArtifact:ARTIFACT})
  const result=transferClaimAuthor(args,NOW,io),after=parseAuthorLease(io.issues.get(3378).body,NOW)
  assert.equal(after.capacityState,'active');assert.equal(after.active,true);assert.equal(after.capacityActive,true)
  assert.equal(after.blockedOn,null);assert.equal(after.worktreeState,null);assert.equal(after.recoveryArtifact,null)
  assert.equal(after.owner,args.newOwner);assert.equal(after.worktree,args.targetWorktree)
  assert.equal(after.version,VERSION);assert.deepEqual(after.objects,['table plm.art_piece_attachment'])
  assert.equal(io.refs.get('refs/db-claims/'+VERSION),RESERVATION)
  assert.equal(transferClaimAuthor(args,NOW,io).sha,result.sha)
})

test('quarantined adoption refuses mismatched metadata and unexpired or legacy leases without changing the claim',()=>{
  for(const [overrides,pattern] of [
    [{blockedOn:'issue:#901'},/exact abandonment blocker/],
    [{worktreeState:'absent'},/exact abandonment blocker/],
    [{recoveryArtifact:'artifact:'+'e'.repeat(40)},/exact abandonment blocker/],
    [{expiresAt:new Date('2026-09-29T00:00:00Z')},/exact expired old-author lease/],
  ]){
    const io=fixture();quarantine(io,overrides);const before=io.issues.get(3378).body
    assert.throws(()=>transferClaimAuthor(args,NOW,io),pattern);assert.equal(io.issues.get(3378).body,before)
    assert.equal([...io.refs.keys()].some(ref=>ref.startsWith('refs/db-claim-author-transfers/')),false)
  }
  const io=fixture();quarantine(io);io.issues.get(3378).body=io.issues.get(3378).body.replace('worktree_state: remote\n','')
  const before=io.issues.get(3378).body
  assert.throws(()=>transferClaimAuthor(args,NOW,io),/exact expired old-author lease/);assert.equal(io.issues.get(3378).body,before)
})

test('quarantined adoption retains exact evidence and collision checks',()=>{
  for(const [change,pattern] of [
    [io=>{io.issues.get(900).body=io.issues.get(900).body.replace('head_sha: '+HEAD,'head_sha: '+'b'.repeat(40))},/names head/],
    [io=>{io.verifyArtifact=()=>null},/cannot be dereferenced/],
    [io=>{io.localClean=()=>false},/successor worktree/],
    [io=>{io.prSources=()=>[{label:'PR #3391',branch:args.branch,objects:['table other.x'],versions:[VERSION]}]},/outside the claim/],
  ]){
    const io=fixture();quarantine(io);change(io);const before=io.issues.get(3378).body
    assert.throws(()=>transferClaimAuthor(args,NOW,io),pattern);assert.equal(io.issues.get(3378).body,before)
  }
})

test('takeover refuses stale evidence, missing authorization, collisions, and unclean successor before changing claim',()=>{
  const cases=[
    [(io)=>{io.getPr=()=>({state:'open',head:{sha:'b'.repeat(40),ref:args.branch}})},/head or branch changed/],
    [(io)=>{io.prSources=()=>[{label:'PR #3391',branch:args.branch,objects:['table other.x'],versions:[VERSION]}]},/outside the claim/],
    [(io)=>{io.localClean=()=>false},/successor worktree/],
    [(io)=>{io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:false})})},/acting on abandonment evidence: claim-first session authority is required/],
    [(io)=>{io.openClaims=()=>[io.getIssue(3378),{number:1,body:claimBody({version:'20260923181755',objects:['table plm.art_piece_attachment'],owner:'other',branch:'other',worktree:'/tmp/other',expiresAt:new Date('2026-09-30T00:00:00Z')})}]},/object collision/],
    [(io)=>{io.refs.delete('refs/db-claims/'+VERSION)},/permanent version reservation/],
    [(io)=>{io.refs.set('refs/db-claims/'+VERSION,'not-a-commit')},/permanent version reservation/],
    [(io)=>{io.refs.set('refs/db-coordination/merge','other')},/stage is held/],
    [(io)=>{io.issues.get(900).body=io.issues.get(900).body.replace('head_sha: '+HEAD,'head_sha: '+'b'.repeat(40))},/names head/],
    [(io)=>{io.verifyArtifact=()=>null},/cannot be dereferenced/],
    [(io)=>{io.openClaims=()=>[io.getIssue(3378),{number:2,body:claimBody({version:'20260923181755',objects:['table other.x'],owner:'other',branch:'other',worktree:args.targetWorktree,expiresAt:new Date('2026-09-30T00:00:00Z')})}]},/successor worktree belongs/],
  ]
  for(const [change,pattern] of cases){
    const io=fixture();change(io);const before=io.issues.get(3378).body
    assert.throws(()=>transferClaimAuthor(args,NOW,io),pattern)
    assert.equal(io.issues.get(3378).body,before)
  }
})

test('takeover refuses a wrong declared old-worktree state and an altered decision tuple',()=>{
  const io=fixture(),before=io.issues.get(3378).body
  assert.throws(()=>transferClaimAuthor({...args,worktreeState:'clean'},NOW,io),/worktree state differs/)
  assert.throws(()=>transferClaimAuthor({...args,authorizationChatId:'wrong'},NOW,io),/chat ID does not match/)
  assert.throws(()=>transferClaimAuthor({...args,authorizationQuote:''},NOW,io),/verbatim user authorization/)
  assert.throws(()=>transferClaimAuthor({...args,recoveryArtifact:''},NOW,io),/recovery-artifact/)
  assert.equal(io.issues.get(3378).body,before)
})

test('takeover never changes claim when evidence-ref creation fails',()=>{
  const io=fixture(),before=io.issues.get(3378).body,create=io.createRef
  io.createRef=(ref,sha)=>ref.startsWith('refs/db-claim-author-transfers/')?false:create(ref,sha)
  assert.throws(()=>transferClaimAuthor(args,NOW,io),/could not be created/)
  assert.equal(io.issues.get(3378).body,before)
  assert.equal(io.refs.get('refs/db-claims/'+VERSION),RESERVATION)
})

test('an evidence record that cannot be read back is deleted and leaves no claim change',()=>{
  const io=fixture(),before=io.issues.get(3378).body,read=io.readRef
  let reads=0
  io.readRef=(ref)=>{
    if(ref.startsWith('refs/db-claim-author-transfers/')&&++reads<=13)return null
    return read(ref)
  }
  assert.throws(()=>transferClaimAuthor(args,NOW,io),/could not be read back/)
  assert.equal(io.issues.get(3378).body,before)
  assert.equal([...io.refs.keys()].some((key)=>key.startsWith('refs/db-claim-author-transfers/')),false)
})

test('branch injection characters are refused before any claim change',()=>{
  for(const branch of ['codex/2110 old','codex/2110`old','codex/2110\nold']){
    const io=fixture(),before=io.issues.get(3378).body
    assert.throws(()=>transferClaimAuthor({...args,branch},NOW,io),/forbidden character/)
    assert.equal(io.issues.get(3378).body,before)
  }
})

test('created evidence can finish an interrupted claim write without a second record',()=>{
  const io=fixture(),original=io.updateIssue
  io.updateIssue=()=>{throw new Error('interrupted')}
  assert.throws(()=>transferClaimAuthor(args,NOW,io),/interrupted/)
  const ref=[...io.refs.keys()].find((key)=>key.startsWith('refs/db-claim-author-transfers/'))
  assert.ok(ref)
  assert.equal(parseAuthorLease(io.issues.get(3378).body,NOW).owner,args.oldOwner)
  io.updateIssue=original
  const result=transferClaimAuthor(args,NOW,io)
  assert.equal(result.ref,ref)
  assert.equal(parseAuthorLease(io.issues.get(3378).body,NOW).owner,args.newOwner)
})

test('a failed post-write readback rolls the claim back and retries with the same record',()=>{
  const io=fixture(),original=io.getIssue
  let wrote=false
  const update=io.updateIssue
  io.updateIssue=(number,change)=>{update(number,change);wrote=true}
  io.getIssue=(number)=>{if(wrote){wrote=false;throw new Error('readback interrupted')}return original(number)}
  assert.throws(()=>transferClaimAuthor(args,NOW,io),/readback interrupted/)
  assert.equal(parseAuthorLease(io.issues.get(3378).body,NOW).owner,args.oldOwner)
  io.getIssue=original
  const ref=[...io.refs.keys()].find((key)=>key.startsWith('refs/db-claim-author-transfers/'))
  const result=transferClaimAuthor(args,NOW,io)
  assert.equal(result.idempotent,false)
  assert.equal(result.ref,ref)
  assert.equal(parseAuthorLease(io.issues.get(3378).body,NOW).owner,args.newOwner)
})

test('malformed adoption records cannot authorize a partial retry',()=>{
  for(const mutate of [
    (record)=>{record.human_identity_authenticated=true},
    (record)=>{delete record.authorization_quote},
    (record)=>{record.reservation_sha='not-a-commit'},
    (record)=>{record.old_owner=record.new_owner},
    (record)=>{record.branch=''},
    (record)=>{record.abandonment_issue=0},
    (record)=>{record.authorization_quote=' padded quote that is long enough '},
    (record)=>{record.old_worktree_state='not-a-state'},
    (record)=>{record.recovery_artifact=null},
  ]){
    const io=fixture();io.updateIssue=()=>{throw new Error('interrupted')}
    assert.throws(()=>transferClaimAuthor(args,NOW,io),/interrupted/)
    const ref=[...io.refs.keys()].find((key)=>key.startsWith('refs/db-claim-author-transfers/'))
    const sha=io.refs.get(ref),prefix='db-coordination claim-author-operator-adoption '
    const record=JSON.parse(io.commits.get(sha).message.slice(prefix.length));mutate(record)
    io.commits.get(sha).message=prefix+JSON.stringify(record)
    assert.throws(()=>transferClaimAuthor(args,NOW,io),/invalid exact fields/)
    assert.equal(parseAuthorLease(io.issues.get(3378).body,NOW).owner,args.oldOwner)
  }
})

test('an old author cannot resume, renew, or rebind after adoption',()=>{
  const io=fixture();transferClaimAuthor(args,NOW,io)
  const body=io.issues.get(3378).body
  assert.throws(()=>resumeAuthorLease({claim:3378,owner:args.oldOwner,leaseHours:0.5},NOW,io),/different owner/)
  assert.throws(()=>renewExpiredClaim({claim:3378,issue:2110,owner:args.oldOwner,branch:args.branch,worktree:args.worktree,pr:3391,headSha:HEAD,leaseHours:0.5},NOW,io),/owner, branch, or worktree mismatch/)
  assert.throws(()=>rebindClaimWorktree({claim:3378,issue:2110,owner:args.oldOwner,branch:args.branch,worktree:args.worktree,targetWorktree:'/tmp/another',pr:3391,headSha:HEAD},NOW,io),/claim owner changed/)
  assert.equal(io.issues.get(3378).body,body)
})

test('a changed permanent reservation after claim mutation rolls the claim back',()=>{
  const io=fixture(),original=io.updateIssue
  io.updateIssue=(number,change)=>{original(number,change);io.refs.set('refs/db-claims/'+VERSION,'e'.repeat(40))}
  assert.throws(()=>transferClaimAuthor(args,NOW,io),/reservation changed after adoption/)
  assert.equal(parseAuthorLease(io.issues.get(3378).body,NOW).owner,args.oldOwner)
})

test('retired successor worktree identity is refused',()=>{
  const io=fixture(),retiredVersion='20260901000000',retiredSha='e'.repeat(40)
  io.refs.set('refs/db-claims-retired/'+retiredVersion,retiredSha)
  io.commits.set(retiredSha,{message:formatRetirementRecord({schema_version:2,claim:12,pr:13,head_sha:'b'.repeat(40),branch:'old-branch',version:retiredVersion,worktree:'/TMP/NEW-AUTHOR/',worktree_state:'clean',decision:'owner-terminated',evidence:'artifact:'+'f'.repeat(40),successor_issue:null,created_at:'2026-09-20T00:00:00Z'})})
  assert.throws(()=>transferClaimAuthor(args,NOW,io),/terminally retired claim/)
})

test('a later expired successor can be adopted through a distinct immutable record',()=>{
  const io=fixture(),first=transferClaimAuthor(args,NOW,io)
  const later=new Date(NOW.valueOf()+13*3600000)
  io.issues.get(900).body=io.issues.get(900).body.replace('owner: old-author','owner: new-author')
  const secondArgs={...args,oldOwner:'new-author',newOwner:'third-author',worktree:args.targetWorktree,
    targetWorktree:'/tmp/third-author',authorizationQuote:'I authorize the third author to adopt the exact expired claim.'}
  const second=transferClaimAuthor(secondArgs,later,io)
  assert.notEqual(second.ref,first.ref)
  assert.equal(io.refs.get(first.ref),first.sha)
  assert.equal(io.refs.get(second.ref),second.sha)
  assert.equal(parseAuthorLease(io.issues.get(3378).body,later).owner,'third-author')
})

test('CLI transfer route parses the exact guarded inputs',()=>{
  const io=fixture(),log=console.log,dir=mkdtempSync(join(tmpdir(),'transfer-quote-'))
  const quoteFile=join(dir,'quote.txt');writeFileSync(quoteFile,QUOTE+'\r\n')
  console.log=()=>{}
  try{
    const argv=['--transfer-claim-author','--issue','2110','--claim-number','3378','--pr','3391',
      '--head-sha',HEAD,'--old-owner',args.oldOwner,'--new-owner',args.newOwner,'--branch',args.branch,
      '--worktree',args.worktree,'--target-worktree',args.targetWorktree,'--abandonment-issue','900',
      '--worktree-state','remote','--authorization-chat-id','root','--authorization-quote-file',quoteFile,'--recovery-artifact',ARTIFACT,'--lease-hours','0.5']
    assert.equal(main(argv,NOW,io),0)
    assert.equal(parseAuthorLease(io.issues.get(3378).body,NOW).owner,args.newOwner)
  }finally{console.log=log;rmSync(dir,{recursive:true,force:true})}
})


function voluntaryFixture(){
  const io=fixture(),expiry=new Date('2026-09-28T16:46:30.702Z'),artifact='artifact:'+HEAD
  io.issues.get(3378).body=claimBody({version:VERSION,objects:['table plm.art_piece_attachment'],owner:args.oldOwner,branch:args.branch,worktree:args.worktree,expiresAt:expiry,capacityState:'relinquished',blockedOn:artifact,worktreeState:'clean',recoveryArtifact:artifact})
  io.localWorktreeState=()=>({state:'clean'});io.verifyArtifact=r=>r===artifact?{sha:HEAD}:null
  io.getPr=()=>({state:'open',head:{sha:HEAD,ref:args.branch},base:{sha:'b'.repeat(40)}})
  io.mainSha=()=> 'c'.repeat(40);io.compareCommits=()=>({status:'ahead',behind_by:0})
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'old-author',calling_task:'old-author'})})
  const request={...args,authorizationChatId:'old-author',recipientChatId:'new-author',worktreeState:'clean',recoveryArtifact:artifact};delete request.abandonmentIssue;delete request.leaseHours
  return {io,request,expiry}
}

test('native CLI refuses malformed request IDs and retries an expired handoff receipt only under a fresh ID',()=>{
  const {io,request}=voluntaryFixture(),dir=mkdtempSync(join(tmpdir(),'handoff-request-'))
  const quoteFile=join(dir,'quote.txt');writeFileSync(quoteFile,QUOTE+'\n')
  const stop=prepareAuthorHandoff({issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:request.oldOwner,branch:request.branch,worktree:request.worktree},NOW,io)
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'new-author',calling_task:'new-author'})})
  const argv=(requestId)=>['--handoff-claim-author','--issue',String(request.issue),'--claim-number',String(request.claim),'--pr',String(request.pr),
    '--head-sha',HEAD,'--old-owner',request.oldOwner,'--new-owner',request.newOwner,'--branch',request.branch,
    '--worktree',request.worktree,'--target-worktree',request.targetWorktree,'--worktree-state','clean',
    '--authorization-chat-id','new-author','--authorization-quote-file',quoteFile,'--recovery-artifact',request.recoveryArtifact,
    '--recipient-chat-id',request.recipientChatId,'--handoff-ready-ref',stop.handoffReadyRef,'--request-id',requestId]
  const log=console.log,error=console.error,originalUpdate=io.updateIssue
  let errors=[];console.log=()=>{};console.error=(message)=>errors.push(String(message))
  try{
    const stoppedBody=io.getIssue(request.claim).body
    assert.equal(main(argv('bad request id'),NOW,io),2)
    assert.match(errors.at(-1),/request ID has invalid shape/)
    assert.equal(io.getIssue(request.claim).body,stoppedBody)
    assert.equal([...io.refs.keys()].filter(ref=>ref.startsWith(CLAIM_AUTHOR_HANDOFF_REF_PREFIX)).length,0)

    io.updateIssue=()=>{throw new Error('simulated interrupted acceptance')}
    assert.equal(main(argv('first-attempt'),NOW,io),2)
    io.updateIssue=originalUpdate
    assert.match(errors.at(-1),/simulated interrupted acceptance/)
    assert.equal(io.getIssue(request.claim).body,stoppedBody)
    const firstRef=[...io.refs.keys()].find(ref=>ref.startsWith(CLAIM_AUTHOR_HANDOFF_REF_PREFIX))
    assert.ok(firstRef)
    const firstSha=io.refs.get(firstRef),firstRecord=JSON.parse(io.getCommit(firstSha).message.split('claim-author-voluntary-handoff ')[1])
    assert.equal(firstRecord.request_id,'first-attempt')
    assert.equal(firstRecord.expires_at,new Date(NOW.valueOf()+30*60000).toISOString())

    const later=new Date(NOW.valueOf()+31*60000)
    assert.equal(main(argv('first-attempt'),later,io),2)
    assert.equal(io.getIssue(request.claim).body,stoppedBody)
    assert.equal(io.refs.get(firstRef),firstSha)
    assert.equal(main(argv('retry-after-expiry'),later,io),0)
    const records=[...io.refs].filter(([ref])=>ref.startsWith(CLAIM_AUTHOR_HANDOFF_REF_PREFIX))
    assert.equal(records.length,2)
    assert.equal(io.refs.get(firstRef),firstSha)
    const second=[...records].find(([ref])=>ref!==firstRef)
    const secondRecord=JSON.parse(io.getCommit(second[1]).message.split('claim-author-voluntary-handoff ')[1])
    assert.equal(secondRecord.request_id,'retry-after-expiry')
    assert.equal(secondRecord.expires_at,new Date(later.valueOf()+30*60000).toISOString())
    const lease=parseAuthorLease(io.getIssue(request.claim).body,later)
    assert.equal(lease.owner,request.newOwner);assert.equal(lease.worktree,request.targetWorktree);assert.equal(lease.capacityState,'active')
    assert.equal(lease.expiresAt.toISOString(),secondRecord.expires_at)
    assert.equal(lease.version,VERSION);assert.deepEqual(lease.objects,['table plm.art_piece_attachment'])
    assert.equal(io.readRef('refs/db-claims/'+VERSION),RESERVATION)
  }finally{io.updateIssue=originalUpdate;console.log=log;console.error=error;rmSync(dir,{recursive:true,force:true})}
})

test('legacy 24-hour operator receipts remain readable but new grants stay capped at thirty minutes',()=>{
  const io=fixture(),first=transferClaimAuthor(args,NOW,io),claim=io.issues.get(3378)
  const legacyExpiry=new Date(NOW.valueOf()+24*3600000).toISOString()
  claim.body=claim.body.replace(/^expires_at: .*$/m,`expires_at: ${legacyExpiry}`)
  const prefix='db-coordination claim-author-operator-adoption ',commit=io.commits.get(first.sha)
  const record=JSON.parse(commit.message.slice(prefix.length));record.lease_hours=24;commit.message=prefix+JSON.stringify(record)

  // The public replay reaches the exact-record comparison only if transferRecord
  // still accepts the historical <=24-hour shape; it must not misclassify it as
  // malformed merely because new grants have a tighter bound.
  assert.throws(()=>transferClaimAuthor(args,NOW,io),/existing operator adoption record differs from exact request/)
  const before=claim.body,refs=[...io.refs]
  assert.throws(()=>transferClaimAuthor({...args,leaseHours:12},NOW,io),/author transfer requires exact issue, claim, PR, head, old\/new owner, branch, old\/new worktree, old worktree state, abandonment issue, and lease hours/)
  assert.equal(claim.body,before);assert.deepEqual([...io.refs],refs)
  assert.equal(io.refs.get(first.ref),first.sha)
  assert.equal(parseAuthorLease(claim.body,NOW).expiresAt.toISOString(),legacyExpiry)
})

test('voluntary original-owner handoff works hours before expiry without audit, preserves exact expiry and source protections, replays once',()=>{
  const {io,request,expiry}=voluntaryFixture(),before=parseAuthorLease(io.getIssue(3378).body,NOW),get=io.getIssue
  io.getIssue=n=>{assert.notEqual(Number(n),900,'voluntary transfer must not read an abandonment audit');return get(n)}
  const result=handoffClaimAuthor(request,NOW,io),after=parseAuthorLease(io.getIssue(3378).body,NOW)
  assert.equal(after.owner,args.newOwner);assert.equal(after.worktree,args.targetWorktree);assert.equal(after.capacityActive,true)
  assert.equal(after.expiresAt.toISOString(),new Date(NOW.valueOf()+30*60000).toISOString());assert.deepEqual(after.objects,before.objects);assert.equal(after.version,before.version);assert.equal(io.readRef('refs/db-claims/'+VERSION),RESERVATION)
  assert.ok(result.ref.startsWith(CLAIM_AUTHOR_HANDOFF_REF_PREFIX))
  const receipt=JSON.parse(io.getCommit(result.sha).message.split('claim-author-voluntary-handoff ')[1]);assert.equal(receipt.kind,'voluntary-owner-handoff');assert.equal(receipt.original_expires_at,expiry.toISOString());assert.equal(receipt.expires_at,new Date(NOW.valueOf()+30*60000).toISOString());assert.equal(receipt.human_identity_authenticated,false);assert.equal('abandonment_issue' in receipt,false);assert.equal('lease_hours' in receipt,false)
  const body=io.getIssue(3378).body;assert.equal(handoffClaimAuthor(request,NOW,io).sha,result.sha);assert.equal(io.getIssue(3378).body,body)
})
for(const [name,change,pattern] of [
 ['foreign caller',(io,r)=>{io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'root',calling_task:'root'})});r.authorizationChatId='root'},/original owner session/],
 ['recipient mismatch',(io,r)=>{r.recipientChatId='foreign'},/exact recipient/],
 ['still active',(io)=>{io.issues.get(3378).body=io.issues.get(3378).body.replace('capacity_state: relinquished','capacity_state: active').replace(/^(blocked_on|worktree_state|recovery):.*\n/gm,'')},/old-author lease/],
 ['dirty original',(io)=>{io.localClean=p=>p!==args.worktree},/original source custody/],
 ['wrong original head',(io)=>{io.localHead=p=>p===args.worktree?'e'.repeat(40):HEAD},/original source custody/],
 ['wrong successor head',(io)=>{io.localHead=p=>p===args.targetWorktree?'e'.repeat(40):HEAD},/successor worktree/],
 ['wrong checkpoint',(io)=>{io.issues.get(3378).body=io.issues.get(3378).body.replace('blocked_on: artifact:'+HEAD,'blocked_on: issue:#900')},/exact abandonment blocker/],
 ['source race',(io)=>{io.getPr=()=>({state:'closed'})},/open PR/],
 ['ancestry divergence',(io)=>{io.compareCommits=()=>({status:'diverged',behind_by:1})},/current main/],
 ['held stage',(io)=>{io.refs.set('refs/db-coordination/preview','e'.repeat(40))},/stage/],
])test('voluntary handoff refuses '+name+' before durable effects',()=>{
  const {io,request}=voluntaryFixture();change(io,request);const before=io.getIssue(3378).body,commits=io.commits.size
  assert.throws(()=>handoffClaimAuthor(request,NOW,io),pattern);assert.equal(io.getIssue(3378).body,before);assert.equal(io.commits.size,commits);assert.equal([...io.refs].some(([r])=>r.startsWith(CLAIM_AUTHOR_HANDOFF_REF_PREFIX)),false)
})
test('voluntary receipt-time resume refuses without overwriting owner change',()=>{
  const {io,request}=voluntaryFixture(),create=io.createRef
  io.createRef=(ref,sha)=>{const result=create(ref,sha);if(ref.startsWith(CLAIM_AUTHOR_HANDOFF_REF_PREFIX))io.issues.get(3378).body=io.issues.get(3378).body.replace('capacity_state: relinquished','capacity_state: active').replace(/^(blocked_on|worktree_state|recovery):.*\n/gm,'');return result}
  assert.throws(()=>handoffClaimAuthor(request,NOW,io),/old-author lease/);assert.equal(parseAuthorLease(io.getIssue(3378).body,NOW).owner,args.oldOwner);assert.equal(parseAuthorLease(io.getIssue(3378).body,NOW).capacityState,'active')
})
test('voluntary receipt replay refuses any changed claim body',()=>{
  const {io,request}=voluntaryFixture();handoffClaimAuthor(request,NOW,io);io.issues.get(3378).body+='\nforeign change'
  assert.throws(()=>handoffClaimAuthor(request,NOW,io),/body differs/)
})

test('failed voluntary receipt retries only against the exact original body and adopted replay remains idempotent',()=>{
  const {io,request}=voluntaryFixture();request.requestId='same-owner-request'
  const original=io.getIssue(request.claim).body,originalHash=createHash('sha256').update(original).digest('hex'),update=io.updateIssue
  io.updateIssue=()=>{throw new Error('simulated interrupted acceptance')}
  assert.throws(()=>handoffClaimAuthor(request,NOW,io),/simulated interrupted acceptance/)
  io.updateIssue=update
  const ref=[...io.refs.keys()].find(value=>value.startsWith(CLAIM_AUTHOR_HANDOFF_REF_PREFIX)),sha=io.readRef(ref)
  assert.ok(ref);assert.ok(sha);assert.equal(io.getIssue(request.claim).body,original)
  const first=JSON.parse(io.getCommit(sha).message.split('db-coordination claim-author-voluntary-handoff ')[1])
  assert.equal(first.request_id,request.requestId);assert.equal(first.original_body_sha256,originalHash)
  const reservation=io.readRef('refs/db-claims/'+VERSION),rejectEdited=()=>{
    const edited=io.getIssue(request.claim).body,refs=[...io.refs]
    assert.throws(()=>handoffClaimAuthor(request,NOW,io),/original body differs from recorded receipt/)
    assert.equal(io.getIssue(request.claim).body,edited);assert.deepEqual([...io.refs],refs)
    assert.equal(io.readRef(ref),sha);assert.equal(io.readRef('refs/db-claims/'+VERSION),reservation)
  }

  io.issues.get(request.claim).body=original+'\nreviewer trailing prose'
  rejectEdited()
  io.issues.get(request.claim).body=original.replace(/^expires_at: .*$/m,'expires_at: 2026-09-28T17:00:00.000Z')
  assert.notEqual(io.getIssue(request.claim).body,original)
  rejectEdited()

  io.issues.get(request.claim).body=original
  const adopted=handoffClaimAuthor(request,NOW,io),adoptedBody=io.getIssue(request.claim).body
  assert.equal(adopted.idempotent,false);assert.equal(adopted.sha,sha)
  const replay=handoffClaimAuthor(request,NOW,io)
  assert.equal(replay.idempotent,true);assert.equal(replay.sha,sha);assert.equal(io.getIssue(request.claim).body,adoptedBody)
  assert.equal(io.readRef('refs/db-claims/'+VERSION),reservation)
})

test('stop-author reports its durable completion when both owned mutex release paths fail',()=>{
  const {io,request,expiry}=voluntaryFixture(),originalDelete=io.deleteRef
  io.deleteRef=(ref)=>{
    const owner=io.commits.get(io.readRef(ref))?.message??''
    if(owner.includes('operation=handoff-ready'))throw new Error('simulated API release failure')
    return originalDelete(ref)
  }
  io.releaseRefOverGit=(ref,sha)=>{
    if((io.commits.get(sha)?.message??'').includes('operation=handoff-ready'))throw new Error('simulated Git release failure')
    return false
  }
  const stop={issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:request.oldOwner,branch:request.branch,worktree:request.worktree}
  let caught
  try{prepareAuthorHandoff(stop,NOW,io)}catch(error){caught=error}
  assert.ok(caught);assert.match(caught.message,/OPERATION_COMPLETED/);assert.match(caught.message,/API release failed.*git release failed/i)
  assert.deepEqual(caught.completedResult,{claim:request.claim,version:VERSION,capacityState:'relinquished',handoffReadyRef:caught.completedResult.handoffReadyRef,sha:caught.completedResult.sha,idempotent:false})
  assert.ok(io.readRef(caught.completedResult.handoffReadyRef));assert.equal(io.getCommit(caught.completedResult.sha).message.startsWith('db-coordination author-handoff-ready '),true)
  const lease=parseAuthorLease(io.getIssue(request.claim).body,NOW)
  assert.equal(lease.owner,request.oldOwner);assert.equal(lease.capacityActive,false);assert.equal(lease.expiresAt.toISOString(),expiry.toISOString())
  assert.equal(io.readRef('refs/db-claims/'+VERSION),RESERVATION)
  const heldLock=io.readRef('refs/db-coordination/author-acquisition')
  assert.match(io.getCommit(heldLock).message,/operation=handoff-ready/,'failed cleanup leaves the exact operation lock for named recovery')
})

test('check-in reports its durable completion when both owned mutex release paths fail',()=>{
  const {io,request}=voluntaryFixture();handoffClaimAuthor(request,NOW,io)
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'new-author',calling_task:'new-author'})})
  const originalDelete=io.deleteRef
  const messageFor=(sha)=>io.commits.get(sha)?.message??''
  io.deleteRef=(ref)=>{
    const owner=messageFor(io.readRef(ref))
    if(owner.includes('operation=author-checkin'))throw new Error('simulated check-in API release failure')
    return originalDelete(ref)
  }
  io.releaseRefOverGit=(ref,sha)=>{
    if(messageFor(sha).includes('operation=author-checkin'))throw new Error('simulated check-in Git release failure')
    return false
  }
  const at=new Date(NOW.valueOf()+10*60000),options={issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:request.newOwner,branch:request.branch,worktree:request.targetWorktree}
  let caught
  try{checkInAuthor(options,at,io)}catch(error){caught=error}
  assert.ok(caught);assert.match(caught.message,/OPERATION_COMPLETED/);assert.match(caught.message,/API release failed.*git release failed/i)
  const completed=caught.completedResult
  assert.ok(completed);assert.equal(completed.claim,request.claim);assert.equal(completed.checkedInAt,at.toISOString());assert.equal(completed.nextCheckinMinutes,10)
  assert.ok(io.readRef(completed.checkinRef));assert.ok(io.getCommit(completed.sha).message.startsWith('db-coordination author-checkin '))
  const heldLock=io.readRef('refs/db-coordination/author-acquisition')
  assert.match(io.getCommit(heldLock).message,/operation=author-checkin/,'failed cleanup leaves the exact operation lock for named recovery')
  const lease=parseAuthorLease(io.getIssue(request.claim).body,at)
  assert.equal(lease.owner,request.newOwner);assert.equal(lease.worktree,request.targetWorktree);assert.equal(lease.expiresAt.valueOf()-at.valueOf(),30*60000)
  assert.equal(io.readRef('refs/db-claims/'+VERSION),RESERVATION)
})

test('voluntary handoff reports mutation evidence without rollback when post-write mutex ownership is unreadable',()=>{
  const {io,request}=voluntaryFixture(),original=io.getIssue(request.claim).body,originalHash=createHash('sha256').update(original).digest('hex')
  const update=io.updateIssue,read=io.readRef;let claimMutated=false
  io.updateIssue=(n,change)=>{update(n,change);if(Number(n)===request.claim)claimMutated=true}
  io.readRef=(ref)=>{if(ref==='refs/db-coordination/author-acquisition'&&claimMutated)throw new Error('simulated unknown mutex ownership');return read(ref)}
  let caught
  try{handoffClaimAuthor(request,NOW,io)}catch(error){caught=error}
  assert.ok(caught);assert.match(caught.message,/ROLLBACK NOT ATTEMPTED because mutex ownership is unknown/)
  const evidenceText=/MUTATION_EVIDENCE (\{[^\n]+\})/.exec(caught.message)?.[1]
  assert.ok(evidenceText,'error includes structured mutation evidence')
  const evidence=JSON.parse(evidenceText),claim=io.getIssue(request.claim),receiptSha=io.readRef(evidence.ref)
  assert.equal(evidence.claim,request.claim);assert.equal(evidence.mutation_attempted,true);assert.ok(evidence.sha)
  assert.equal(evidence.original_body_sha256,originalHash)
  assert.equal(evidence.expected_body_sha256,createHash('sha256').update(claim.body).digest('hex'))
  assert.equal(parseAuthorLease(claim.body,NOW).owner,request.newOwner);assert.equal(parseAuthorLease(claim.body,NOW).worktree,request.targetWorktree)
  assert.equal(receiptSha,evidence.sha);assert.equal(io.readRef('refs/db-claims/'+VERSION),RESERVATION)
})


test('normal stop publishes owner-ready consent with no successor and actual recipient accepts immediately',()=>{
  const {io,request,expiry}=voluntaryFixture(),before=io.getIssue(3378).body
  const stop={issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:request.oldOwner,branch:request.branch,worktree:request.worktree}
  const ready=prepareAuthorHandoff(stop,NOW,io);assert.equal(io.getIssue(3378).body,before);assert.equal(parseAuthorLease(before,NOW).capacityActive,false)
  assert.equal(prepareAuthorHandoff(stop,NOW,io).sha,ready.sha)
  const record=JSON.parse(io.getCommit(ready.sha).message.split('author-handoff-ready ')[1]);assert.equal(record.execution_stopped,true);assert.equal(record.author_session,'old-author');assert.equal(record.expires_at,expiry.toISOString())
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'new-author',calling_task:'new-author'})})
  const accepted=handoffClaimAuthor({...request,authorizationChatId:'new-author',handoffReadyRef:ready.handoffReadyRef},NOW,io)
  assert.equal(accepted.owner,'new-author');const lease=parseAuthorLease(io.getIssue(3378).body,NOW);assert.equal(lease.expiresAt.valueOf()-NOW.valueOf(),30*60000);assert.equal(io.readRef('refs/db-claims/'+VERSION),RESERVATION)
})
test('wrap-up fallback stops active capacity and publishes ready proof before returning',()=>{
  const {io,request}=voluntaryFixture();io.issues.get(3378).body=io.issues.get(3378).body.replace('capacity_state: relinquished','capacity_state: active').replace(/^(blocked_on|worktree_state|recovery):.*\n/gm,'')
  io.issueComments=()=>[];io.commentIssue=()=>({id:1})
  const result=prepareAuthorHandoff({issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:request.oldOwner,branch:request.branch,worktree:request.worktree},NOW,io)
  assert.equal(parseAuthorLease(io.getIssue(3378).body,NOW).capacityActive,false);assert.ok(io.readRef(result.handoffReadyRef));assert.equal(parseAuthorLease(io.getIssue(3378).body,NOW).owner,request.oldOwner)
})
test('ready consent cannot authorize a resumed or edited owner claim',()=>{
  const {io,request}=voluntaryFixture(),ready=prepareAuthorHandoff({issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:request.oldOwner,branch:request.branch,worktree:request.worktree},NOW,io)
  io.issues.get(3378).body+='\nchanged original claim';const body=io.getIssue(3378).body
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'new-author',calling_task:'new-author'})})
  assert.throws(()=>handoffClaimAuthor({...request,authorizationChatId:'new-author',handoffReadyRef:ready.handoffReadyRef},NOW,io),/ready consent differs/);assert.equal(io.getIssue(3378).body,body)
})
test('check-in confirms actual owner continued need and renews only a bounded permission',()=>{
  const {io,request}=voluntaryFixture();handoffClaimAuthor(request,NOW,io)
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'new-author',calling_task:'new-author'})})
  const options={issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:request.newOwner,branch:request.branch,worktree:request.targetWorktree}
  const at=new Date(NOW.valueOf()+10*60000),result=checkInAuthor(options,at,io),lease=parseAuthorLease(io.getIssue(3378).body,at)
  assert.equal(result.checkedInAt,at.toISOString());assert.equal(result.nextCheckinMinutes,10);assert.ok(io.readRef(result.checkinRef));assert.equal(JSON.parse(io.getCommit(result.sha).message.split('author-checkin ')[1]).checked_in_at,at.toISOString());assert.equal(lease.expiresAt.valueOf()-at.valueOf(),30*60000);assert.deepEqual(lease.objects,['table plm.art_piece_attachment']);assert.equal(io.readRef('refs/db-claims/'+VERSION),RESERVATION)
  assert.throws(()=>checkInAuthor(options,new Date(at.valueOf()+31*60000),io),/expired/)
})
test('check-in refuses a foreign session and a stopped owner without extending either reservation',()=>{
  const {io,request}=voluntaryFixture(),options={issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:request.oldOwner,branch:request.branch,worktree:request.worktree},body=io.getIssue(3378).body
  assert.throws(()=>checkInAuthor(options,NOW,io),/stopped/);assert.equal(io.getIssue(3378).body,body)
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'foreign',calling_task:'foreign'})})
  assert.throws(()=>checkInAuthor(options,NOW,io),/actual current owner/);assert.equal(io.getIssue(3378).body,body)
})
test('failed confirmation publication preserves renewed protection and reports an incomplete check-in',()=>{
  const {io,request}=voluntaryFixture();handoffClaimAuthor(request,NOW,io)
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'new-author',calling_task:'new-author'})})
  const create=io.createRef;io.createRef=(ref,sha)=>ref.startsWith('refs/db-author-checkins/')?false:create(ref,sha)
  const at=new Date(NOW.valueOf()+10*60000),options={issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:request.newOwner,branch:request.branch,worktree:request.targetWorktree}
  assert.throws(()=>checkInAuthor(options,at,io),/PERMISSION_RENEWED_BUT_CONFIRMATION_UNVERIFIED/)
  assert.equal(parseAuthorLease(io.getIssue(3378).body,at).expiresAt.valueOf()-at.valueOf(),30*60000)
  assert.equal(io.readRef('refs/db-claims/'+VERSION),RESERVATION);assert.doesNotMatch(io.getIssue(3378).body,/last_checkin/)
})
test('merged-source check-in uses real main ancestry and structural parser without reviving a closed unmerged PR',()=>{
  const {io,request}=voluntaryFixture();handoffClaimAuthor(request,NOW,io)
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'new-author',calling_task:'new-author'})})
  const get=io.getPr;io.getPr=()=>({...get(),state:'closed',merged:true,merge_commit_sha:HEAD})
  io.mainSha=()=>HEAD;io.prStructuralObjects=()=>['table plm.art_piece_attachment'];io.prSources=()=>[]
  io.compareCommits=()=>({status:'identical',ahead_by:0,behind_by:0})
  const options={issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:request.newOwner,branch:request.branch,worktree:request.targetWorktree}
  assert.ok(checkInAuthor(options,NOW,io).checkinRef)
  io.getPr=()=>({...get(),state:'closed',merged:false});assert.throws(()=>checkInAuthor(options,NOW,io),/open pull request/)
})
test('check-in refuses an unreadable permanent reservation or a reservation moved during receipt publication',()=>{
  for(const mode of ['malformed','undereferenceable','moved']){
    const {io,request}=voluntaryFixture();handoffClaimAuthor(request,NOW,io)
    io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'new-author',calling_task:'new-author'})})
    if(mode==='malformed')io.refs.set('refs/db-claims/'+VERSION,'bad')
    if(mode==='undereferenceable')io.commits.delete(RESERVATION)
    if(mode==='moved'){const create=io.createRef;io.createRef=(ref,sha)=>{const result=create(ref,sha);if(ref.startsWith('refs/db-author-checkins/'))io.refs.set('refs/db-claims/'+VERSION,'e'.repeat(40));return result}}
    const options={issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:request.newOwner,branch:request.branch,worktree:request.targetWorktree}
    assert.throws(()=>checkInAuthor(options,NOW,io),/PERMISSION_RENEWED_BUT_CONFIRMATION_UNVERIFIED/)
    assert.equal(parseAuthorLease(io.getIssue(3378).body,NOW).capacityActive,true)
  }
})

// Cross-machine acceptance of an owner-signed voluntary handoff (claim #4152 / PR #4206):
// the original working copy lives on the owner's machine, so custody is RECORDED as
// remote, never recreated. Every refusal leaves the claim untouched.
function remoteHandoff({oldWorktreeHere='absent'}={}){
  const {io,request}=voluntaryFixture()
  const stop=prepareAuthorHandoff({issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:request.oldOwner,branch:request.branch,worktree:request.worktree},NOW,io)
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'new-author',calling_task:'new-author'})})
  io.localWorktreeState=(path)=>({state:path===request.worktree?oldWorktreeHere:'clean'})
  io.localClean=(path)=>path!==request.worktree||oldWorktreeHere==='clean'
  const accept={...request,authorizationChatId:'new-author',authorizationQuote:QUOTE,handoffReadyRef:stop.handoffReadyRef,remoteCustody:true}
  return {io,request,accept,stop}
}
const unchanged=(io,claim,fn,pattern)=>{const before=io.getIssue(claim).body;assert.throws(fn,pattern);assert.equal(io.getIssue(claim).body,before);assert.equal([...io.refs.keys()].some(r=>r.startsWith(CLAIM_AUTHOR_HANDOFF_REF_PREFIX)),false)}

test('remote custody: an owner-signed handoff is accepted from another machine and recorded as remote',()=>{
  const {io,request,accept}=remoteHandoff()
  const result=handoffClaimAuthor(accept,NOW,io),lease=parseAuthorLease(io.getIssue(request.claim).body,NOW)
  assert.equal(lease.owner,request.newOwner);assert.equal(lease.worktree,request.targetWorktree);assert.equal(lease.version,VERSION)
  const ref=[...io.refs.keys()].find(r=>r.startsWith(CLAIM_AUTHOR_HANDOFF_REF_PREFIX)),record=JSON.parse(io.getCommit(io.refs.get(ref)).message.split('claim-author-voluntary-handoff ')[1])
  assert.equal(record.original_worktree_custody,'remote');assert.equal(record.recovery_artifact,'artifact:'+HEAD);assert.ok(result.sha)
})
test('remote custody refuses when the original worktree is actually present here',()=>{
  const {io,request,accept}=remoteHandoff({oldWorktreeHere:'clean'})
  unchanged(io,request.claim,()=>handoffClaimAuthor(accept,NOW,io),/original worktree is clean on this machine/)
})
test('remote custody refuses without the owner-signed ready receipt',()=>{
  const {io,request,accept}=remoteHandoff()
  unchanged(io,request.claim,()=>handoffClaimAuthor({...accept,handoffReadyRef:null},NOW,io),/requires a voluntary handoff with the original owner-signed ready receipt/)
})
test('remote custody refuses a recovery point that is not the exact pushed PR head',()=>{
  const {io,request,accept}=remoteHandoff()
  unchanged(io,request.claim,()=>handoffClaimAuthor({...accept,recoveryArtifact:'artifact:'+'e'.repeat(40)},NOW,io),/clean checkpoint custody/)
})
test('remote custody refuses when the PR head moved after the handoff',()=>{
  const {io,request,accept}=remoteHandoff()
  io.getPr=()=>({state:'open',head:{sha:'f'.repeat(40),ref:request.branch},base:{sha:'b'.repeat(40)}})
  unchanged(io,request.claim,()=>handoffClaimAuthor(accept,NOW,io),/head or branch changed/)
})
test('remote custody refuses a ready receipt not signed by the original owner session',()=>{
  const {io,request,accept,stop}=remoteHandoff()
  const sha=io.refs.get(stop.handoffReadyRef),message=io.getCommit(sha).message,prefix='db-coordination author-handoff-ready '
  const forged={...JSON.parse(message.slice(prefix.length)),author_session:'someone-else'}
  io.refs.set(stop.handoffReadyRef,io.makeOwnerCommit(prefix+JSON.stringify(forged)))
  unchanged(io,request.claim,()=>handoffClaimAuthor(accept,NOW,io),/differ from their immutable identity/)
})
test('without --remote-custody an absent original worktree still refuses (custody is never assumed)',()=>{
  const {io,request,accept}=remoteHandoff()
  unchanged(io,request.claim,()=>handoffClaimAuthor({...accept,remoteCustody:false},NOW,io),/original source custody changed|old worktree state differs/)
})
test('remote custody is refused on the operator-adoption (non-voluntary) path',()=>{
  const {io,request,accept}=remoteHandoff()
  unchanged(io,request.claim,()=>transferClaimAuthor({...accept,abandonmentIssue:4287,leaseHours:0.5},NOW,io),/requires a voluntary handoff/)
})

test('remote custody: the receipt replays idempotently and an interrupted acceptance resumes from it (#4288 review)',()=>{
  const {io,request,accept}=remoteHandoff()
  const original=io.updateIssue;io.updateIssue=()=>{throw new Error('simulated interrupted acceptance')}
  assert.throws(()=>handoffClaimAuthor(accept,NOW,io),/simulated interrupted acceptance/)
  io.updateIssue=original
  const first=handoffClaimAuthor(accept,NOW,io),again=handoffClaimAuthor(accept,NOW,io)
  assert.equal(again.sha,first.sha);assert.equal(parseAuthorLease(io.getIssue(request.claim).body,NOW).owner,request.newOwner)
})
test('remote custody still refuses a dirty or off-head successor worktree (#4288 review)',()=>{
  for(const mutate of [(io,request)=>{io.localClean=(p)=>p!==request.targetWorktree&&p!==request.worktree},(io,request)=>{const head=io.localHead;io.localHead=(p)=>p===request.targetWorktree?'d'.repeat(40):head(p)}]){
    const {io,request,accept}=remoteHandoff();mutate(io,request)
    unchanged(io,request.claim,()=>handoffClaimAuthor(accept,NOW,io),/successor worktree must be clean on the claim branch at exact PR head/)
  }
})
test('CLI binds --remote-custody to --handoff-claim-author only (#4288 review)',()=>{
  const {io}=remoteHandoff(),error=console.error;let errors=[];console.error=(m)=>errors.push(String(m))
  try{assert.equal(main(['--renew-claim','--remote-custody','--issue','2110','--claim-number','3378'],NOW,io),2)}finally{console.error=error}
  assert.match(errors.at(-1),/--remote-custody is valid only with --handoff-claim-author/)
})

// Each receipt field is forged on its own while the receipt stays self-consistent
// (ref name, author session), so only the owner-consent binding can refuse it.
function forgeReady(io,stop,patch){
  const prefix='db-coordination author-handoff-ready ',rec={...JSON.parse(io.getCommit(io.refs.get(stop.handoffReadyRef)).message.slice(prefix.length)),...patch}
  const ref='refs/db-author-handoff-ready/'+rec.claim+'-'+rec.version+'-'+rec.body_sha256.slice(0,24)
  io.refs.set(ref,io.makeOwnerCommit(prefix+JSON.stringify(rec)));return ref
}
test('remote custody rides on the full receipt binding: each forged field refuses at the consent check (#4288 review round 3)',()=>{
  const cases=[['issue',{issue:4242}],['pr',{pr:4243}],['head_sha',{head_sha:'f'.repeat(40)}],['branch',{branch:'codex/other'}],['worktree',{worktree:'C:/elsewhere'}],
    ['owner',{owner:'other-owner',author_session:'other-owner'}],['reservation_sha',{reservation_sha:'e'.repeat(40)}],['version',{version:'20990101000000'}]]
  for(const [name,patch] of cases){
    const {io,request,accept,stop}=remoteHandoff(),ref=forgeReady(io,stop,patch)
    unchanged(io,request.claim,()=>handoffClaimAuthor({...accept,handoffReadyRef:ref},NOW,io),/owner-issued ready consent differs from exact source, claim or actual recipient/)
  }
})
test('remote custody refuses a receipt whose execution was not stopped (#4288 review round 3)',()=>{
  const {io,request,accept,stop}=remoteHandoff(),ref=forgeReady(io,stop,{execution_stopped:false})
  unchanged(io,request.claim,()=>handoffClaimAuthor({...accept,handoffReadyRef:ref},NOW,io),/differ from their immutable identity/)
})
test('a stored handoff receipt with custody other than remote is refused on replay (#4288 review round 2)',()=>{
  const {io,request,accept}=remoteHandoff()
  handoffClaimAuthor(accept,NOW,io)
  const ref=[...io.refs.keys()].find(r=>r.startsWith(CLAIM_AUTHOR_HANDOFF_REF_PREFIX)),prefix='db-coordination claim-author-voluntary-handoff '
  const rec=JSON.parse(io.getCommit(io.refs.get(ref)).message.slice(prefix.length))
  io.refs.set(ref,io.makeOwnerCommit(prefix+JSON.stringify({...rec,original_worktree_custody:'local'})))
  assert.throws(()=>handoffClaimAuthor(accept,NOW,io),/invalid original worktree custody/)
})
test('a non-boolean remote custody flag is refused (#4288 review round 2)',()=>{
  const {io,request,accept}=remoteHandoff()
  unchanged(io,request.claim,()=>handoffClaimAuthor({...accept,remoteCustody:'true'},NOW,io),/must be a boolean/)
})
test('CLI --handoff-claim-author --remote-custody accepts end to end (#4288 review round 2)',()=>{
  const {io,request,stop}=remoteHandoff(),dir=mkdtempSync(join(tmpdir(),'remote-handoff-'))
  const quoteFile=join(dir,'quote.txt');writeFileSync(quoteFile,QUOTE+'\n')
  const argv=['--handoff-claim-author','--remote-custody','--issue',String(request.issue),'--claim-number',String(request.claim),'--pr',String(request.pr),
    '--head-sha',HEAD,'--old-owner',request.oldOwner,'--new-owner',request.newOwner,'--branch',request.branch,
    '--worktree',request.worktree,'--target-worktree',request.targetWorktree,'--worktree-state','clean',
    '--authorization-chat-id','new-author','--authorization-quote-file',quoteFile,'--recovery-artifact',request.recoveryArtifact,
    '--recipient-chat-id',request.recipientChatId,'--handoff-ready-ref',stop.handoffReadyRef,'--request-id','cli-remote']
  const log=console.log,error=console.error;console.log=()=>{};console.error=()=>{}
  try{assert.equal(main(argv,NOW,io),0)}finally{console.log=log;console.error=error;rmSync(dir,{recursive:true,force:true})}
  const lease=parseAuthorLease(io.getIssue(request.claim).body,NOW);assert.equal(lease.owner,request.newOwner)
  const ref=[...io.refs.keys()].find(r=>r.startsWith(CLAIM_AUTHOR_HANDOFF_REF_PREFIX))
  assert.equal(JSON.parse(io.getCommit(io.refs.get(ref)).message.split('claim-author-voluntary-handoff ')[1]).original_worktree_custody,'remote')
})
test('remote custody refuses a receipt stored under a ref name that does not match its identity (#4288 review round 4)',()=>{
  const {io,request,accept,stop}=remoteHandoff(),prefix='db-coordination author-handoff-ready '
  const rec=JSON.parse(io.getCommit(io.refs.get(stop.handoffReadyRef)).message.slice(prefix.length))
  io.refs.set(stop.handoffReadyRef,io.makeOwnerCommit(prefix+JSON.stringify({...rec,body_sha256:'0'.repeat(64)})))
  unchanged(io,request.claim,()=>handoffClaimAuthor(accept,NOW,io),/differ from their immutable identity/)
})
test('remote custody binds the accepting session to the recipient and the new owner (#4288 review round 4)',()=>{
  {const {io,request,accept}=remoteHandoff()
    io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'third-party',calling_task:'third-party'})})
    unchanged(io,request.claim,()=>handoffClaimAuthor({...accept,authorizationChatId:'third-party'},NOW,io),/owner-issued ready consent differs from exact source, claim or actual recipient/)}
  {const {io,request,accept}=remoteHandoff()
    unchanged(io,request.claim,()=>handoffClaimAuthor({...accept,newOwner:'impostor'},NOW,io),/./)}
})

// #4365: the owner on record and the --owner supplied may be the two spellings
// of one exact Claude session; stop-author and check-in accept both end to end.
const CLAUDE_ID='250902fb-e85f-45d3-a62c-9c18cb217d1e'
test('stop-author accepts the other Claude owner spelling for the same exact session',()=>{
  const {io,request}=voluntaryFixture(),recorded=`claude-chat-${CLAUDE_ID}@hetz`
  io.issues.get(3378).body=io.issues.get(3378).body.replace('capacity_state: relinquished','capacity_state: active').replace(/^(blocked_on|worktree_state|recovery):.*\n/gm,'').replace(new RegExp(`^owner: ${request.oldOwner}$`,'m'),`owner: ${recorded}`)
  io.issueComments=()=>[];io.commentIssue=()=>({id:1})
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:CLAUDE_ID,calling_task:CLAUDE_ID})})
  const stop={issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,branch:request.branch,worktree:request.worktree}
  assert.throws(()=>prepareAuthorHandoff({...stop,owner:`Claude chat ${CLAUDE_ID} on edge-dev3`},NOW,io),/different owner|custody differs/)
  const result=prepareAuthorHandoff({...stop,owner:`Claude chat ${CLAUDE_ID} on hetz`},NOW,io)
  assert.ok(io.readRef(result.handoffReadyRef));assert.equal(parseAuthorLease(io.getIssue(3378).body,NOW).capacityActive,false)
  // the receipt names the on-record owner, so voluntary handoff can consume it
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:'new-author',calling_task:'new-author'})})
  const accepted=handoffClaimAuthor({...request,oldOwner:recorded,authorizationChatId:'new-author',handoffReadyRef:result.handoffReadyRef},NOW,io)
  assert.equal(accepted.owner,'new-author')
})
test('check-in accepts the other Claude owner spelling for the same exact session',()=>{
  const {io,request}=voluntaryFixture(),recorded=`claude-chat-${CLAUDE_ID}@hetz`
  handoffClaimAuthor(request,NOW,io)
  io.issues.get(3378).body=io.issues.get(3378).body.replace(new RegExp(`^owner: ${request.newOwner}$`,'m'),`owner: ${recorded}`)
  io.orchestratorFlowAdapter=()=>({resolveMarker:()=>({live:true,task:CLAUDE_ID,calling_task:CLAUDE_ID})})
  const at=new Date(NOW.valueOf()+10*60000)
  const options={issue:request.issue,claim:request.claim,pr:request.pr,headSha:HEAD,owner:`Claude chat ${CLAUDE_ID} on hetz`,branch:request.branch,worktree:request.targetWorktree}
  const result=checkInAuthor(options,at,io)
  assert.equal(result.checkedInAt,at.toISOString());assert.equal(parseAuthorLease(io.getIssue(3378).body,at).owner,recorded)
})
