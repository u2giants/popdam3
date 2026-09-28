#!/usr/bin/env node
// One-time repository repair owned by #3574. Retire this utility in a separate
// maintenance PR after the reservation, renewed lease, and audit are complete.
import { pathToFileURL } from 'node:url'
import { acquireMutex, assertClaimNotRetired, assertLaneAvailable, githubIo, LaneError, MUTEX_REF, normalizeWorktreePath, parseAuthorLease, readRefAfterWrite, releaseOwnedRef, renewalIssueScope, requireOwnedRef, resetRetirementSnapshot, validateClaimObjects } from './manage-migration-author-lanes.mjs'

export const TARGET=Object.freeze({issue:3539,claim:3546,pr:3557,owner:'mimo:author-3539',branch:'mimo/3539-dcp-licensor-groups',worktree:'C:\\repos\\shared-db\\.claude\\worktrees\\3539-dcp-licensor',oldVersion:'20260925174850',newVersion:'20260925223300'})
const oldRef=`refs/db-claims/${TARGET.oldVersion}`,newRef=`refs/db-claims/${TARGET.newVersion}`,evidenceRef=`refs/db-claim-supersessions/${TARGET.claim}-${TARGET.oldVersion}`
const oneVersion=(files)=>{
  if(!Array.isArray(files)||files.some((row)=>row.status==='removed'&&String(row.filename??row.path??'').startsWith('supabase/migrations/')))throw new LaneError('pull request migration file list is unreadable or removes a migration')
  return files.map((row)=>/^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(String(row.filename??row.path??''))?.[1]).filter(Boolean)
}
const evidence=(commit)=>{
  const match=/^db-coordination claim-version-superseded issue=(\d+) claim=(\d+) pr=(\d+) old=(\d{14}) new=(\d{14}) old-ref=([0-9a-f]{7,40}) head=([0-9a-f]{40})$/i.exec(String(commit?.message??commit?.commit?.message??''))
  if(!match)throw new LaneError('existing reservation evidence is unreadable')
  return {issue:Number(match[1]),claim:Number(match[2]),pr:Number(match[3]),oldVersion:match[4],newVersion:match[5],oldSha:match[6],head:match[7]}
}

export function recover3539Reservation({headSha,targetWorktree},now=new Date(),io=githubIo){
  if(!/^[0-9a-f]{40}$/i.test(String(headSha??''))||!targetWorktree)throw new LaneError('recovery requires --head-sha and --target-worktree')
  if(/[\r\n`]/.test(targetWorktree)||targetWorktree!==targetWorktree.trim()||normalizeWorktreePath(targetWorktree)===normalizeWorktreePath(TARGET.worktree))throw new LaneError('target worktree path is unsafe or matches the recorded claim worktree')
  const ownerSha=io.makeOwnerCommit(`db-coordination claim-version-supersession recovery issue=${TARGET.issue} claim=${TARGET.claim} pr=${TARGET.pr} head=${headSha}`)
  acquireMutex(ownerSha,io)
  try{
    const claim=io.getIssue(TARGET.claim),lease=parseAuthorLease(claim?.body??'',now)
    if(claim?.state!=='open'||Number(claim.number)!==TARGET.claim||!/^CLAIM:\s+(?:issue\s+)?#?3539(?:\s|$)/i.test(claim.title??''))throw new LaneError('claim is not open for exact issue #3539')
    resetRetirementSnapshot()
    if(lease.legacy||lease.version!==TARGET.newVersion||lease.owner!==TARGET.owner||lease.branch!==TARGET.branch||lease.worktree!==TARGET.worktree||lease.objects.length!==1||lease.objects[0]!=='function api.db_data_admin_scraped_source_inventory')throw new LaneError('claim version, object, owner, branch, or recorded worktree differs')
    assertClaimNotRetired(TARGET.newVersion,'recovered',io)
    const oldSha=io.readRef(oldRef)
    if(!/^[0-9a-f]{40}$/i.test(String(oldSha??'')))throw new LaneError('old permanent reservation is missing or unreadable')
    const workIssue=io.getIssue(TARGET.issue)
    renewalIssueScope(workIssue,lease,[TARGET.issue],{allowClaimSuperset:true})
    const pr=io.getPr(TARGET.pr)
    if(pr?.state!=='open'||pr.head?.sha!==headSha||pr.head?.ref!==TARGET.branch)throw new LaneError('open PR exact head or branch changed')
    const files=io.getPrFiles(TARGET.pr)
    if(!Array.isArray(files)||Number(pr.changed_files)!==files.length)throw new LaneError('incomplete PR pagination for exact migration proof')
    const versions=oneVersion(files)
    if(versions.length!==1||versions[0]!==TARGET.newVersion)throw new LaneError('PR must change exactly one migration at the claimed version')
    if(!io.localClean(targetWorktree)||io.localHead(targetWorktree)!==headSha||typeof io.localBranch!=='function'||io.localBranch(targetWorktree)!==TARGET.branch)throw new LaneError('target worktree is dirty, not at the exact PR head, or not on the claim branch')
    const mainFiles=io.treeFiles(io.mainSha())
    if(!Array.isArray(mainFiles))throw new LaneError('current main migration tree is unreadable')
    const mainVersions=mainFiles.map((file)=>/^supabase\/migrations\/(\d{14})_/.exec(typeof file==='string'?file:file.path??file.filename??'')?.[1]).filter(Boolean).sort()
    if(!mainVersions.length||TARGET.newVersion<=mainVersions.at(-1))throw new LaneError('recovered version must be later than the current main migration maximum')
    const claims=io.openClaims(),matching=claims.filter((row)=>Number(row.number)===TARGET.claim)
    if(matching.length!==1||matching[0].body!==claim.body||matching[0].title!==claim.title)throw new LaneError('claim listing is ambiguous or changed')
    if(claims.some((row)=>Number(row.number)!==TARGET.claim&&parseAuthorLease(row.body,now).version===TARGET.newVersion))throw new LaneError('new version is held by another claim')
    const sources=io.prSources(),targets=sources.filter((source)=>new RegExp(`^PR #${TARGET.pr}(?:\\s|$)`).test(source.label))
    if(targets.length!==1||targets[0].versions?.length!==1||String(targets[0].versions[0])!==TARGET.newVersion)throw new LaneError('target PR parser source is missing or ambiguous')
    if(validateClaimObjects(targets[0].objects??[]).some((object)=>!lease.objects.includes(object)))throw new LaneError('target PR writes an object outside the exact claim')
    if(sources.some((source)=>source!==targets[0]&&(source.versions??[]).some((version)=>String(version)===TARGET.newVersion)))throw new LaneError('new version is used by another PR')
    assertLaneAvailable(claims.filter((row)=>Number(row.number)!==TARGET.claim),lease.objects,now,{prSources:sources.filter((source)=>source!==targets[0])})
    const existing=io.readRef(newRef),recorded=io.readRef(evidenceRef)
    if(existing||recorded){
      if(!existing||recorded&&recorded!==existing)throw new LaneError('partial or foreign reservation evidence needs engineer review')
      const prior=evidence(io.getCommit(existing))
      if(prior.issue!==TARGET.issue||prior.claim!==TARGET.claim||prior.pr!==TARGET.pr||prior.oldVersion!==TARGET.oldVersion||prior.newVersion!==TARGET.newVersion||prior.oldSha!==oldSha||prior.head!==headSha)throw new LaneError('existing supersession evidence names different identities')
      if(!recorded){
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        if(!io.createRef(evidenceRef,existing)||readRefAfterWrite(evidenceRef,existing,io)!==existing)throw new LaneError('stranded reservation is exact, but supersession evidence could not be completed')
      }
      return {reservation:newRef,evidence:evidenceRef,sha:existing,idempotent:Boolean(recorded),resumed:!recorded}
    }
    const freshClaim=io.getIssue(TARGET.claim),freshPr=io.getPr(TARGET.pr),freshWorkIssue=io.getIssue(TARGET.issue)
    if(freshClaim?.body!==claim.body||freshClaim?.title!==claim.title||freshPr?.head?.sha!==headSha||freshPr?.head?.ref!==TARGET.branch||freshWorkIssue?.body!==workIssue.body||io.readRef(oldRef)!==oldSha||io.readRef(newRef)||io.readRef(evidenceRef))throw new LaneError('recovery inputs changed under the mutex')
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const sha=io.makeOwnerCommit(`db-coordination claim-version-superseded issue=${TARGET.issue} claim=${TARGET.claim} pr=${TARGET.pr} old=${TARGET.oldVersion} new=${TARGET.newVersion} old-ref=${oldSha} head=${headSha}`)
    if(!io.createRef(newRef,sha)||readRefAfterWrite(newRef,sha,io)!==sha)throw new LaneError('new permanent reservation could not be created and read back')
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    if(!io.createRef(evidenceRef,sha)||readRefAfterWrite(evidenceRef,sha,io)!==sha)throw new LaneError('immutable supersession evidence could not be created; permanent reservation retained for retry')
    if(io.readRef(oldRef)!==oldSha)throw new LaneError('old permanent reservation changed during recovery; new permanent reservation and supersession evidence remain for engineer review')
    return {reservation:newRef,evidence:evidenceRef,sha,idempotent:false,resumed:false}
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2)
  if(args.length!==4||args[0]!=='--head-sha'||args[2]!=='--target-worktree')throw new LaneError('usage: --head-sha <exact PR SHA> --target-worktree <clean local checkout>')
  console.log(JSON.stringify(recover3539Reservation({headSha:args[1],targetWorktree:args[3]}),null,2))
}
