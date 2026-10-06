import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claimBody, formatRetirementRecord, main, parseAuthorLease, rebindClaimWorktree, renewExpiredClaim, resetRetirementSnapshot, resumeAuthorLease, transferClaimAuthor } from './manage-migration-author-lanes.mjs'

const NOW=new Date('2026-09-28T12:00:00Z')
const HEAD='a'.repeat(40),VERSION='20260923181754',RESERVATION='d'.repeat(40)
const QUOTE='I authorize the exact guarded operator adoption for the expired claim.'
const ARTIFACT='artifact:'+'f'.repeat(40)
const args={issue:2110,claim:3378,pr:3391,headSha:HEAD,oldOwner:'old-author',newOwner:'new-author',
  branch:'codex/2110-old',worktree:'C:/old-remote',targetWorktree:'/tmp/new-author',
  abandonmentIssue:900,worktreeState:'remote',authorizationChatId:'root',authorizationQuote:QUOTE,recoveryArtifact:ARTIFACT,leaseHours:12}

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
  assert.throws(()=>resumeAuthorLease({claim:3378,owner:args.oldOwner,leaseHours:12},NOW,io),/different owner/)
  assert.throws(()=>renewExpiredClaim({claim:3378,issue:2110,owner:args.oldOwner,branch:args.branch,worktree:args.worktree,pr:3391,headSha:HEAD,leaseHours:12},NOW,io),/owner, branch, or worktree mismatch/)
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
      '--worktree-state','remote','--authorization-chat-id','root','--authorization-quote-file',quoteFile,'--recovery-artifact',ARTIFACT,'--lease-hours','12']
    assert.equal(main(argv,NOW,io),0)
    assert.equal(parseAuthorLease(io.issues.get(3378).body,NOW).owner,args.newOwner)
  }finally{console.log=log;rmSync(dir,{recursive:true,force:true})}
})
