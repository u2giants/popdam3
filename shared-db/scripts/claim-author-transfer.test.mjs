import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
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
    resolveSessionAuthority:({claimOwner}={})=>{const task='root';if(claimOwner!==undefined&&claimOwner!==task)return {live:false,state:'claim-owner-mismatch',task:claimOwner,calling_task:task,reason:'mismatch'};return {live:true,state:'declared',task,calling_task:task,reason:null}},
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


function quarantine(io,overrides={}){
  io.issues.get(3378).body=claimBody({version:VERSION,objects:['table plm.art_piece_attachment'],owner:args.oldOwner,branch:args.branch,
    worktree:args.worktree,expiresAt:new Date('2026-09-26T00:00:00Z'),capacityState:'relinquished',blockedOn:'issue:#900',worktreeState:'remote',...overrides})
}


















function voluntaryFixture(){
  const io=fixture(),expiry=new Date('2026-09-28T16:46:30.702Z'),artifact='artifact:'+HEAD
  io.issues.get(3378).body=claimBody({version:VERSION,objects:['table plm.art_piece_attachment'],owner:args.oldOwner,branch:args.branch,worktree:args.worktree,expiresAt:expiry,capacityState:'relinquished',blockedOn:artifact,worktreeState:'clean',recoveryArtifact:artifact})
  io.localWorktreeState=()=>({state:'clean'});io.verifyArtifact=r=>r===artifact?{sha:HEAD}:null
  io.getPr=()=>({state:'open',head:{sha:HEAD,ref:args.branch},base:{sha:'b'.repeat(40)}})
  io.mainSha=()=> 'c'.repeat(40);io.compareCommits=()=>({status:'ahead',behind_by:0})
  io.resolveSessionAuthority=({claimOwner}={})=>{const task='old-author';if(claimOwner!==undefined&&claimOwner!==task)return {live:false,state:'claim-owner-mismatch',task:claimOwner,calling_task:task,reason:'mismatch'};return {live:true,state:'declared',task,calling_task:task,reason:null}};io.flowAdapter=()=>({resolveMarker:()=>({live:true,task:'old-author',calling_task:'old-author'})})
  const request={...args,authorizationChatId:'old-author',recipientChatId:'new-author',worktreeState:'clean',recoveryArtifact:artifact};delete request.abandonmentIssue;delete request.leaseHours
  return {io,request,expiry}
}



const unchanged=(io,claim,fn,pattern)=>{const before=io.getIssue(claim).body;assert.throws(fn,pattern);assert.equal(io.getIssue(claim).body,before);assert.equal([...io.refs.keys()].some(r=>r.startsWith(CLAIM_AUTHOR_HANDOFF_REF_PREFIX)),false)}



// Each receipt field is forged on its own while the receipt stays self-consistent
// (ref name, author session), so only the owner-consent binding can refuse it.
function forgeReady(io,stop,patch){
  const prefix='db-coordination author-handoff-ready ',rec={...JSON.parse(io.getCommit(io.refs.get(stop.handoffReadyRef)).message.slice(prefix.length)),...patch}
  const ref='refs/db-author-handoff-ready/'+rec.claim+'-'+rec.version+'-'+rec.body_sha256.slice(0,24)
  io.refs.set(ref,io.makeOwnerCommit(prefix+JSON.stringify(rec)));return ref
}

// #4365: the owner on record and the --owner supplied may be the two spellings
// of one exact Claude session; stop-author and check-in accept both end to end.
const CLAUDE_ID='250902fb-e85f-45d3-a62c-9c18cb217d1e'
