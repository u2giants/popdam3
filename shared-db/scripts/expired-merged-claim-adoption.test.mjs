import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claimBody, formatRetirementRecord, main, parseAuthorLease, resetRetirementSnapshot } from './manage-migration-author-lanes.mjs'

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
  const work={number:2110,state:'open',body:['```db-work-scope','status: ready','work_type: structural','route: claim-first','priority: 1','writes:','  - table plm.art_piece_attachment','```'].join('\n')}
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
    flowAdapter:()=>({resolveMarker:()=>({live:true,calling_task:'root',task:'root'})}),
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

import { transferExpiredMergedClaimAuthor } from './lib/lanes/expired-merged-claim-adoption.mjs'
import { main as adoptionMain, parseArgs as adoptionArgs } from './transfer-expired-merged-claim-author.mjs'
const MERGE='b'.repeat(40),MAIN='c'.repeat(40)
function mergedFixture(overrides={}){
  return fixture({getPr:()=>({state:'closed',merged:true,merge_commit_sha:MERGE,head:{sha:HEAD,ref:args.branch}}),
    mainSha:()=>MAIN,compareCommits:()=>({status:'ahead',behind_by:0}),
    prStructuralObjects:(pr,head)=>{assert.equal(pr,3391);assert.equal(head,HEAD);return ['table plm.art_piece_attachment']},
    prSources:()=>[],...overrides})
}
test('merged adoption refuses active and relinquished leases even with exact source',()=>{
  for(const mutate of [body=>body.replace('2026-09-26T00:00:00.000Z','2026-09-29T00:00:00.000Z'),
    body=>claimBody({version:VERSION,objects:['table plm.art_piece_attachment'],owner:args.oldOwner,branch:args.branch,worktree:args.worktree,expiresAt:new Date('2026-09-26T00:00:00Z'),capacityState:'relinquished',blockedOn:'issue:#900',worktreeState:'remote',recoveryArtifact:ARTIFACT})]){
    const io=mergedFixture();io.issues.get(3378).body=mutate(io.issues.get(3378).body);const before=io.issues.get(3378).body
    assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io),/expired/);assert.equal(io.issues.get(3378).body,before)
  }
})
test('merged adoption refuses wrong source, missing ancestry, uncovered objects, stages and stale audit',()=>{
  for(const [override,pattern] of [
    [{getPr:()=>({state:'open',head:{sha:HEAD,ref:args.branch}})},/exact merged/],
    [{getPr:()=>({state:'closed',merged:true,merge_commit_sha:MERGE,head:{sha:'e'.repeat(40),ref:args.branch}})},/head, branch/],
    [{compareCommits:()=>({status:'diverged',behind_by:1})},/not contained/],
    [{mainSha:()=>null},/current main/],
    [{prStructuralObjects:()=>['table plm.unclaimed']},/outside claimed/],
    [{prStructuralObjects:()=>[]},/absent/],
  ]){const io=mergedFixture(override),before=io.issues.get(3378).body;assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io),pattern);assert.equal(io.issues.get(3378).body,before)}
  const io=mergedFixture();io.issues.get(900).body=io.issues.get(900).body.replace(HEAD,'e'.repeat(40));assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io),/now at/)
})
test('merged adoption readback failure rolls claim back and retries immutable record',()=>{
  const io=mergedFixture(),before=io.issues.get(3378).body,update=io.updateIssue;let writes=0
  io.updateIssue=(n,change)=>{update(n,change);if(++writes===1)throw new Error('interrupted merged write')}
  assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io),/interrupted merged write/);assert.equal(io.issues.get(3378).body,before)
  const ref=[...io.refs.keys()].find(k=>k.includes('db-merged-claim-author-adoptions/')),sha=io.refs.get(ref)
  io.updateIssue=update;assert.equal(transferExpiredMergedClaimAuthor(args,NOW,io).sha,sha)
})

test('merged adoption keeps reservations, rescue, collisions and every stage guarded',()=>{
  const cases=[
    [io=>io.refs.delete('refs/db-claims/'+VERSION),/permanent version reservation/],
    [io=>{io.verifyArtifact=()=>null},/cannot be dereferenced/],
    [io=>{io.localClean=()=>false},/successor worktree/],
    [io=>{io.flowAdapter=()=>({resolveMarker:()=>({live:false})})},/session and authorization/],
    [io=>{io.openClaims=()=>[io.getIssue(3378),{number:9,body:claimBody({version:'20260923181755',objects:['table plm.art_piece_attachment'],owner:'other',branch:'other',worktree:'/tmp/other',expiresAt:new Date('2026-09-30T00:00:00Z')})}]},/object collision/],
    ...['preview','merge','production'].map(stage=>[io=>io.refs.set('refs/db-coordination/'+stage,'other'),/stage is held/]),
  ]
  for(const [change,pattern]of cases){const io=mergedFixture();change(io);const before=io.issues.get(3378).body;assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io),pattern);assert.equal(io.issues.get(3378).body,before)}
})
test('merged adoption never accepts a rewritten merge identity on an immutable retry',()=>{
  const io=mergedFixture();const result=transferExpiredMergedClaimAuthor(args,NOW,io)
  const commit=io.commits.get(result.sha),prefix='db-coordination expired-merged-claim-author-adoption ',record=JSON.parse(commit.message.slice(prefix.length));record.source_merge_sha='e'.repeat(40);commit.message=prefix+JSON.stringify(record)
  assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io),/immutable source merge changed/)
})

test('merged CLI operation is explicit and keeps ordinary transfer separate',()=>{
  const dir=mkdtempSync(join(tmpdir(),'merged-author-cli-')),quoteFile=join(dir,'quote.txt');writeFileSync(quoteFile,QUOTE)
  const io=mergedFixture(),log=console.log;console.log=()=>{}
  try{
    const argv=['--issue','2110','--claim-number','3378','--pr','3391','--head-sha',HEAD,'--old-owner',args.oldOwner,'--new-owner',args.newOwner,'--branch',args.branch,'--worktree',args.worktree,'--target-worktree',args.targetWorktree,'--abandonment-issue','900','--worktree-state','remote','--authorization-chat-id','root','--authorization-quote-file',quoteFile,'--recovery-artifact',ARTIFACT,'--lease-hours','0.5']
    assert.equal(adoptionMain(argv,NOW,io),0);assert.equal(parseAuthorLease(io.issues.get(3378).body,NOW).owner,args.newOwner)
  }finally{console.log=log;rmSync(dir,{recursive:true,force:true})}
})

test('missing abandonment audit refuses before receipt or claim mutation',()=>{const io=mergedFixture();io.issues.get(900).body='';const before=io.issues.get(3378).body;assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io),/exact abandonment audit proof is absent/);assert.equal(io.issues.get(3378).body,before);assert.equal([...io.refs.keys()].some(r=>r.includes('merged-claim-author-adoptions')),false)})

test('audit authority is exact and open, never implied by expiry',()=>{
 for(const change of [io=>io.issues.get(900).state='closed',io=>io.issues.get(900).body=io.issues.get(900).body.replace('repo-maintenance','structural'),io=>io.issues.get(900).body=io.issues.get(900).body.replace('claim: 3378','claim: 1'),io=>io.issues.get(900).body=io.issues.get(900).body.replace('owner: old-author','owner: stranger'),io=>io.issues.get(900).body=io.issues.get(900).body.replace('pr: 3391','pr: 1')]){
 const io=mergedFixture();change(io);const before=io.issues.get(3378).body;assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io));assert.equal(io.issues.get(3378).body,before)
 }
})
test('receipt I/O cannot hide moving main or dirty successor before mutation',()=>{
 for(const mutate of [io=>io.mainSha=()=> 'e'.repeat(40),io=>io.localClean=()=>false,io=>io.refs.set('refs/db-coordination/production','e'.repeat(40))]){
 const io=mergedFixture(),create=io.createRef,before=io.issues.get(3378).body;io.createRef=(ref,sha)=>{const ok=create(ref,sha);if(ref.includes('merged-claim-author-adoptions'))mutate(io);return ok};assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io));assert.equal(io.issues.get(3378).body,before);assert.equal(io.refs.get('refs/db-claims/'+VERSION),RESERVATION)
 }
})
test('CLI refuses unknown, duplicate and missing guarded arguments',()=>{for(const a of [['--unknown','x'],['--issue'],['--issue','1','--issue','2']])assert.throws(()=>adoptionArgs(a))})
test('successor source, preserved custody and reservation cannot be substituted',()=>{
 const cases=[
  io=>io.localHead=()=> 'e'.repeat(40),io=>io.localBranch=()=> 'foreign',
  io=>io.localWorktreeState=()=>({state:'dirty'}),io=>io.verifyArtifact=()=>null,
  io=>io.getPr=()=>({state:'merged',merged:true,merge_commit_sha:MERGE,head:{sha:HEAD,ref:'foreign'}}),
  io=>io.getPrFiles=()=>[{filename:'supabase/migrations/20260923181755_wrong.sql',status:'added'}],
  io=>io.flowAdapter=()=>({resolveMarker:()=>({live:true,calling_task:'other',task:'root'})}),
  io=>io.openClaims=()=>[],
  io=>io.openClaims=()=>[io.getIssue(3378),{number:12,body:claimBody({version:'20260923181755',objects:['table other.z'],owner:'other',branch:'other',worktree:args.targetWorktree,expiresAt:new Date('2026-09-30T00:00:00Z')})}],
 ]
 for(const change of cases){const io=mergedFixture();change(io);const before=io.issues.get(3378).body;assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io));assert.equal(io.issues.get(3378).body,before);assert.equal(io.refs.get('refs/db-claims/'+VERSION),RESERVATION)}
})
test('unreadable receipt and changed request refuse without claimant changes',()=>{
 const io=mergedFixture(),r=transferExpiredMergedClaimAuthor(args,NOW,io),before=io.issues.get(3378).body;
 io.commits.get(r.sha).message='invalid';assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io),/unreadable/);assert.equal(io.issues.get(3378).body,before)
})
test('mutex loss preserves evidence and refuses unsafe rollback',()=>{
 const io=mergedFixture(),create=io.createRef,before=io.issues.get(3378).body;
 io.createRef=(ref,sha)=>{const ok=create(ref,sha);if(ref.includes('merged-claim-author-adoptions'))io.refs.set('refs/db-coordination/author-acquisition','e'.repeat(40));return ok};
 assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io),/mutex|ownership|owned/);assert.equal(io.issues.get(3378).body,before)
})
test('invalid guarded request refuses before acquiring ownership',()=>{for(const patch of [{issue:0},{headSha:'not-a-sha'},{oldOwner:args.newOwner},{authorizationQuote:'short'},{leaseHours:25},{targetWorktree:args.worktree},{branch:'unsafe branch'}]){const io=mergedFixture();assert.throws(()=>transferExpiredMergedClaimAuthor({...args,...patch},NOW,io));assert.equal(io.refs.size,1)}})
test('changed reservation after claim update restores original claim',()=>{
 const io=mergedFixture(),update=io.updateIssue,before=io.issues.get(3378).body;let writes=0;
 io.updateIssue=(n,v)=>{update(n,v);if(++writes===1)io.refs.set('refs/db-claims/'+VERSION,'e'.repeat(40))};
 assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io),/permanent reservation changed/);assert.equal(io.issues.get(3378).body,before)
})
test('receipt creation refusal cannot mutate original claim',()=>{
 const io=mergedFixture(),create=io.createRef,before=io.issues.get(3378).body;io.createRef=(ref,sha)=>ref.includes('merged-claim-author-adoptions')?false:create(ref,sha);
 assert.throws(()=>transferExpiredMergedClaimAuthor(args,NOW,io),/receipt creation failed/);assert.equal(io.issues.get(3378).body,before)
})
