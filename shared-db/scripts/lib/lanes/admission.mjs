// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { isTrustedOperatorComment } from '../../lib/repository-identity.mjs'
import { AdmissionError, STRUCTURAL_ROUTES, evaluateAdmission, parseImpactBlock, inspectPrStructuralChange, structuralWritesMatch, NON_STRUCTURAL_CHANGE_TYPES } from '../../orchestrator-flow/admission.mjs'
import { findCompletionRecord } from '../../lib/work-dependencies.mjs'
import { outcomeHistory, OutcomeError, OUTCOME_STATES, advanceOutcome } from '../../orchestrator-flow/outcome-lifecycle.mjs'
import { coordinationEvent, formatEventComment } from '../../db-coordination-events.mjs'
import { isEvidencePath, resolveEvidencePair } from '../../lib/agent-evidence-paths.mjs'
import { validateGenerationLineage, refuseCommittedMutation } from '../../lib/evidence-generation-lineage.mjs'
import { validateContract } from '../../agent-work-contract.mjs'
import path from 'node:path'
import { REPO } from './constants.mjs'
import { parseQueueScope } from './queue-routing.mjs'
import { LaneError } from './claims.mjs'
import { migrationVersions } from './claim-maintenance.mjs'
import { githubIo } from '../../manage-migration-author-lanes.mjs'

// Issues created at or after this instant must carry change_type and the other
// admission fields; only earlier in-flight work may use the legacy path.
export const ADMISSION_LEGACY_CUTOVER = '2026-09-11T18:00:00Z'

export function trustedCompletionComments(comments=[]){return comments.filter((comment)=>{
  return isTrustedOperatorComment(comment,REPO)
})}

export function admitIssue(number, io = githubIo, { pr = null, actor = 'manage-migration-author-lanes', allowLegacy = false, timestamp } = {}) {
  let issue = io.getIssue(Number(number))
  let livePr=null
  let scope=null
  let reopenAfterValidation=false
  let completedClosedOutcome=false
  try {
    if(pr!==null){
      livePr=io.getPr(Number(pr))
      const linked=io.closingIssuesForPr(Number(pr))
      if(!Array.isArray(linked)||linked.length!==1||Number(linked[0]?.number)!==Number(number))throw new AdmissionError(`pull request #${pr} must close exactly admitted issue #${number}`)
      if(String(issue?.state??'').toLowerCase()==='closed'){
        if(!livePr?.merged_at||typeof io.updateIssue!=='function')throw new AdmissionError(`issue #${number} is closed and cannot be admitted`)
        const completion=typeof io.issueComments==='function'
          ?findCompletionRecord(trustedCompletionComments(io.issueComments(Number(number))))
          :null
        if(completion?.outcome==='live_verified'){
          if(completion.work_issue!==Number(number)||completion.pr!==Number(pr)||completion.merge_sha!==livePr.merge_commit_sha)throw new AdmissionError(`issue #${number} completed outcome does not match merged pull request #${pr}`)
          completedClosedOutcome=true
        }else reopenAfterValidation=true
        issue={...issue,state:'open'}
      }
    }
    scope = parseQueueScope(issue?.body ?? '')
    let admitted
    if(allowLegacy&&scope?.changeType===null){
      const created=Date.parse(String(issue?.created_at??issue?.createdAt??''))
      if(!Number.isFinite(created)||created>=Date.parse(ADMISSION_LEGACY_CUTOVER))throw new AdmissionError(`legacy admission without change_type is limited to issues created before ${ADMISSION_LEGACY_CUTOVER}; issue #${number} must declare the admission fields`)
      if(issue?.state!=='open'||scope.workType!=='structural'||!STRUCTURAL_ROUTES.includes(scope.route)||scope.status!=='ready'||!scope.writes.length)throw new AdmissionError('legacy in-flight work is not an open ready structural issue with exact writes')
      admitted={admitted:true,issue:Number(number),legacy:true,service_class:'standard-application'}
    }else admitted = evaluateAdmission(issue, scope, parseImpactBlock(issue?.body ?? ''))
    if (pr !== null) {
      const head=livePr?.head?.sha
      if(!head)throw new AdmissionError('pull request exact head is unreadable')
      const files=io.getPrFiles(Number(pr)).map((file)=>/^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(String(file?.filename??file?.path??''))&&file?.status!=='removed'
        ?{...file,content:io.getFileAt(file.filename??file.path,head)}:file)
      const inspection=inspectPrStructuralChange(files)
      const declared=[...scope.writes].sort()
      if(!structuralWritesMatch(inspection,declared))throw new AdmissionError(`pull request #${pr} structural objects must exactly match admitted issue #${number} writes`)
      admitted={...admitted,actual_objects:inspection.objects,migrations:inspection.migrations}
    }
    if(reopenAfterValidation){
      io.updateIssue(Number(number),{state:'open'})
      issue=io.getIssue(Number(number))
      if(String(issue?.state??'').toLowerCase()!=='open')throw new AdmissionError(`issue #${number} did not reopen after its linked merge`)
    }
    if(!admitted.legacy&&!completedClosedOutcome&&io.issueComments&&io.commentIssue){
      let history=outcomeHistory(io.issueComments(Number(number)),number)
      if(!history.valid)throw new OutcomeError(`outcome history is invalid: ${history.problems.join('; ')}`)
      for(const state of ['entered','classified']){
        if((history.state?OUTCOME_STATES.indexOf(history.state):-1)>=OUTCOME_STATES.indexOf(state))continue
        advanceOutcome({issue:Number(number),state,actor,...(timestamp?{timestamp:new Date(timestamp).toISOString()}:{})},io)
        history=outcomeHistory(io.issueComments(Number(number)),number)
      }
    }
    return admitted
  } catch (error) {
    if(error instanceof AdmissionError&&!error.result&&/(contains no added or modified migration|(?:content|patch) is unreadable|contain no statement-leading schema DDL|contains unmodelled DDL)/.test(error.message)){
      error.result={reason:error.message,return_to:scope?.applicationReturnTo??REPO,evidence_required:['readable pull request content containing acknowledged statement-leading schema DDL for the proposed structural change']}
    }
    if (error instanceof AdmissionError && error.result && io.commentIssue) {
      const refusal={event_type:'rejected_non_structural',work_issue:Number(number),actor,result:'refused',detail:error.result.reason,return_to:error.result.return_to,evidence_required:error.result.evidence_required}
      const event = coordinationEvent({
        eventType:refusal.event_type, workIssue:refusal.work_issue, actor:refusal.actor,
        timestamp:new Date().toISOString(), result:refusal.result, detail:refusal.detail,
        return_to:refusal.return_to, evidence_required:refusal.evidence_required,
      })
      io.commentIssue(Number(number), formatEventComment(event))
    }
    throw error
  }
}

// A merged pull request whose body never produced a GitHub closing link cannot
// gain one after merge, so its post-merge preview/production routes refuse
// forever. An operator names the binding explicitly as "PR:ISSUE" (workflow
// input merged_pr_issue_binding). For the merged-PR review verdict gate
// (mergedPrReviewTarget), a real GitHub closing link that matches the bound
// issue is trusted without evidence-pair verification — the same trust
// closingIssuesForPr and readReviewerOperationRoute already extend. When no
// real link exists, or the link disagrees, the full verification path runs:
// the PR body's single "Work issue #N" line, any issue-N branch name,
// the merged head's .agent/completion.json (work_issue and pr), the PR's
// migration versions equal to that record, and a permanent refs/db-claims
// reservation for every version. Any mismatch, an unmerged PR, or a real
// closing link that disagrees refuses, and so does a closed work issue or a
// renamed, copied, or removed migration file. The reservation check proves each
// version was issued by the claim allocator; it does not by itself tie the
// version to this issue. That tie is the PR body, the completion record, and
// the unchanged downstream issue admission, which still checks the declared
// objects.
export function parseMergedPrIssueBinding(value) {
  const match=/^\s*([1-9]\d*):([1-9]\d*)\s*$/.exec(String(value??''))
  if(!match)throw new LaneError('merged PR issue binding must be exactly PR:ISSUE')
  return {pr:Number(match[1]),issue:Number(match[2])}
}

export function verifyMergedPrIssueBinding({pr,issue}, io = githubIo) {
  const livePr=io.getPr(pr)
  if(!livePr?.merged_at||!/^[0-9a-f]{40}$/i.test(String(livePr?.head?.sha??'')))throw new LaneError(`merged PR issue binding refused: pull request #${pr} is not merged with a readable head`)
  const workLines=[...String(livePr.body??'').matchAll(/\bWork issue #(\d+)\b/gi)].map((m)=>Number(m[1]))
  if(workLines.length!==1||workLines[0]!==issue)throw new LaneError(`merged PR issue binding refused: pull request #${pr} body must name exactly one "Work issue #${issue}"; found ${workLines.join(',')||'none'}`)
  const branchIssue=/(?:^|[/_-])issue-(\d+)(?:[/_-]|$)/i.exec(String(livePr.head?.ref??''))
  if(branchIssue&&Number(branchIssue[1])!==issue)throw new LaneError(`merged PR issue binding refused: branch ${livePr.head.ref} names issue #${branchIssue[1]}`)
  const work=io.getIssue(issue)
  if(!work||Number(work.number)!==issue)throw new LaneError(`merged PR issue binding refused: issue #${issue} is unreadable`)
  if(String(work.state??'').toLowerCase()!=='open')throw new LaneError(`merged PR issue binding refused: issue #${issue} is not open; a binding never reopens closed work`)
  const prFiles=io.getPrFiles(pr)
  if(!Array.isArray(prFiles)||!prFiles.length)throw new LaneError(`merged PR issue binding refused: pull request #${pr} file inventory is unreadable`)
  for(const file of prFiles){
    const migration=[file?.filename,file?.previous_filename].some((value)=>MIGRATION_PATH.test(String(value??'').replace(/\\/g,'/')))
    if(migration&&(file?.previous_filename!==undefined||!['added','modified'].includes(String(file?.status).toLowerCase())))throw new LaneError(`merged PR issue binding refused: migration file ${file?.filename} is ${file?.status}; only added or modified migrations can be bound`)
  }
  for(const file of prFiles){
    if(typeof file?.filename!=='string'||!file.filename||typeof file?.status!=='string')throw new LaneError(`merged PR issue binding refused: pull request #${pr} file inventory is unreadable`)
    if([file.filename,file.previous_filename].some(isEvidencePath)&&(file.previous_filename!==undefined||!['added','modified'].includes(file.status.toLowerCase())))throw new LaneError(`merged PR issue binding refused: evidence file ${file.filename} is ${file.status}; only added or modified evidence can be bound`)
  }
  if(!Number.isSafeInteger(livePr.changed_files)||livePr.changed_files!==prFiles.length||new Set(prFiles.map((file)=>file.filename)).size!==prFiles.length)throw new LaneError(`merged PR issue binding refused: pull request #${pr} file inventory is incomplete or duplicated`)
  const pair=resolveEvidencePair(prFiles.map((file)=>file.filename),{readFile:(path)=>io.getFileAt(path,livePr.head.sha)})
  if(pair.state!=='current')throw new LaneError(`merged PR issue binding refused: pull request #${pr} evidence is ${pair.state}; exactly one PR-owned complete pair is required`)
  if(pair.key!=='legacy'&&pair.key.split('/')[0]!==String(issue))throw new LaneError(`merged PR issue binding refused: evidence path names issue #${pair.key.split('/')[0]}`)
  let completion
  try{completion=JSON.parse(io.getFileAt(pair.completion,livePr.head.sha))}catch{throw new LaneError(`merged PR issue binding refused: ${pair.completion} at pull request #${pr} head is unreadable`)}
  if(Number(completion?.work_issue)!==issue||Number(completion?.pr)!==pr)throw new LaneError(`merged PR issue binding refused: completion record names issue #${completion?.work_issue} and PR #${completion?.pr}`)
  if(pair.key!=='legacy'&&completion.contract_ref!==`refs/db-contracts/${pair.key}`)throw new LaneError(`merged PR issue binding refused: completion contract_ref does not match evidence key ${pair.key}`)
  // #3380: the contract behind this binding is evidence, not just JSON. Validate
  // its generation lineage shape, and for a keyed pair hold it to the immutable
  // published contract so a forged or mutated record cannot bind a merged PR.
  let contractRecord
  try{contractRecord=JSON.parse(io.getFileAt(pair.contract,livePr.head.sha))}catch{throw new LaneError(`merged PR issue binding refused: ${pair.contract} at pull request #${pr} head is unreadable`)}
  try{validateGenerationLineage(contractRecord)}catch(error){throw new LaneError(`merged PR issue binding refused: contract lineage at ${pair.contract} is invalid (${error.message})`)}
  if(pair.key!=='legacy'){
    const contractRecordRef=`refs/db-contracts/${pair.key}`
    const publishedSha=io.readRef(contractRecordRef)
    if(!publishedSha)throw new LaneError(`merged PR issue binding refused: contract ref ${contractRecordRef} is not published`)
    const publishedCommit=io.getCommit(publishedSha)
    const publishedMessage=String(publishedCommit?.message??publishedCommit?.commit?.message??'')
    let publishedContract
    try{publishedContract=validateContract(JSON.parse(publishedMessage.split('\n').slice(2).join('\n').trim()))}catch{throw new LaneError(`merged PR issue binding refused: published contract ${contractRecordRef} is unreadable`)}
    try{refuseCommittedMutation(publishedContract,contractRecord)}catch(error){throw new LaneError(`merged PR issue binding refused: ${error.message}`)}
  }
  const versions=migrationVersions(prFiles).sort()
  const recorded=Array.isArray(completion.migration_versions)?completion.migration_versions.map(String).sort():[]
  if(!versions.length||versions.length!==recorded.length||versions.some((v,i)=>v!==recorded[i]))throw new LaneError(`merged PR issue binding refused: PR migrations ${versions.join(',')||'none'} do not equal completion record ${recorded.join(',')||'none'}`)
  for(const version of versions)if(!io.readRef(`refs/db-claims/${version}`))throw new LaneError(`merged PR issue binding refused: version ${version} has no permanent claim reservation`)
  return {pr,issue,versions,state:String(work.state??'').toLowerCase()}
}

export function withMergedPrIssueBinding(io, value, log = (line)=>console.error(line)) {
  const binding=parseMergedPrIssueBinding(value)
  const base=io.closingIssuesForPr.bind(io)
  let verified=null
  // Command-specific adapters spread this interface; retain its own methods as
  // well as inherited behavior so every completion proof remains callable.
  const bound=Object.assign(Object.create(io),io)
  const apply=(linked)=>{
    if(linked.length){
      if(linked.length!==1||Number(linked[0]?.number)!==binding.issue)throw new LaneError(`merged PR issue binding refused: pull request #${binding.pr} already closes ${linked.map((item)=>`#${item?.number}`).join(',')}`)
      return linked
    }
    if(!verified){
      verified=verifyMergedPrIssueBinding(binding,io)
      log(`MERGED PR ISSUE BINDING: PR #${binding.pr} -> issue #${binding.issue} (versions ${verified.versions.join(',')}; body, completion record, and claim reservations agree)`)
    }
    return [{number:binding.issue,state:verified.state,bound:true}]
  }
  bound.closingIssuesForPr=(number)=>{
    const linked=base(number)
    if(Number(number)!==binding.pr||!Array.isArray(linked))return linked
    return apply(linked)
  }
  // Reviewer assignment and verdict recording read one GraphQL snapshot instead of
  // closingIssuesForPr. The same verified binding, with the same refusals, fills that
  // snapshot's empty closing-link set; a real link that disagrees still refuses.
  if(typeof io.readReviewerOperationRoute==='function'){
    const baseRoute=io.readReviewerOperationRoute.bind(io)
    bound.readReviewerOperationRoute=(number)=>{
      const snapshot=baseRoute(number)
      if(Number(number)!==binding.pr||!Array.isArray(snapshot?.linkedIssues))return snapshot
      const linked=apply(snapshot.linkedIssues)
      return linked===snapshot.linkedIssues?snapshot:{...snapshot,linkedIssues:linked}
    }
  }
  // Verdict recording on a merged PR: only the bound PR and issue. A real GitHub
  // closing link that matches is accepted, but the linked issue must still be
  // open — checked both on the link-reported state (when present) and on the
  // live io.getIssue state, matching verifyMergedPrIssueBinding's open-issue
  // gate on the no-link path. When GitHub reports no closing link, the full
  // verification (merged, body, completion record, claims, open issue) runs.
  // This keeps mergedPrReviewTarget consistent with closingIssuesForPr and
  // readReviewerOperationRoute for the link-trust decision, while preserving
  // the open-issue gate the issue text promises.
  bound.mergedPrReviewTarget=(number,issue)=>{
    if(Number(number)!==binding.pr||Number(issue)!==binding.issue)return false
    const linked=base(number)
    if(Array.isArray(linked)&&linked.length===1&&Number(linked[0]?.number)===binding.issue){
      const linkedState=String(linked[0]?.state??'').toLowerCase()
      if(linkedState&&linkedState!=='open')return false
      const work=io.getIssue(binding.issue)
      if(String(work?.state??'').toLowerCase()!=='open')return false
      return true
    }
    return apply(Array.isArray(linked)?linked:[]).length===1
  }
  return bound
}

// An open PR at the exact head is recordable, as before. A merged PR at the exact head
// is recordable only through a verified merged-PR issue binding for that PR and issue.
export function reviewTargetIsRecordable(live,{pr,issue,headSha},io=githubIo){
  if(String(live?.head?.sha??'').toLowerCase()!==String(headSha).toLowerCase())return false
  const state=String(live?.state??'').toLowerCase()
  if(state==='open')return true
  // REST uses merged_at; the bounded GraphQL lease snapshot uses merged.
  // Both still require the independently verified full-PR issue binding.
  if(!(live?.merged_at||live?.merged===true)||typeof io?.mergedPrReviewTarget!=='function')return false
  return io.mergedPrReviewTarget(pr,issue)===true
}

export const MIGRATION_PATH = /^supabase\/migrations\/[^/]+\.sql$/
export const REPOSITORY_MAINTENANCE_CHANGE_TYPES = new Set(['documentation','ci','reviewer-tooling','workflow','repo-maintenance'])

// Merge and reviewer machinery serves both database migrations and ordinary
// repository code. Derive that boundary from the live PR while the operation's
// mutex is held: a caller-provided bypass would turn a routing choice into an
// authority grant. Any migration path, including the old side of a rename,
// stays structural; unreadable inventory stays unknown and refuses. This result
// answers only whether DDL/object admission applies to review and guarded merge.
// It is not NO_DATABASE_PREVIEW evidence: the separate Step 2A impact classifier
// still decides whether executable code can affect database behavior, data, or
// permissions and must enter preview. Repository maintenance keeps every natural
// code gate here; it receives no structural claim or database-stage exemption.
export function derivePrOperationRoute(pr, io = githubIo, { headSha = null, issue = null, allowMerged = false, snapshot = null } = {}) {
  if (!Number.isInteger(Number(pr)) || Number(pr) < 1) throw new LaneError('operation routing requires a pull request number')
  if(snapshot!==null&&(!snapshot||typeof snapshot!=='object'||!Array.isArray(snapshot.files)||!Array.isArray(snapshot.linkedIssues)))throw new LaneError('operation routing snapshot is unreadable')
  const livePr=snapshot?.pr??io.getPr(Number(pr))
  const prState=String(livePr?.state??'open').toLowerCase(),eligibleState=prState==='open'||(allowMerged&&['closed','merged'].includes(prState)&&Boolean(livePr?.merged_at))
  if(!livePr||!eligibleState||!/^[0-9a-f]{40}$/i.test(String(livePr?.head?.sha??'')))throw new LaneError(`pull request #${pr} live head is unreadable or not eligible`)
  if(headSha!==null&&String(livePr.head.sha).toLowerCase()!==String(headSha).toLowerCase())throw new LaneError(`pull request #${pr} exact head changed before operation routing`)
  const files=snapshot?.files??io.getPrFiles(Number(pr))
  if(!Array.isArray(files)||!files.length)throw new LaneError(`pull request #${pr} complete file inventory is empty or unreadable`)
  const paths=[]
  for(const file of files){
    if(!file||typeof file.filename!=='string'||!file.filename.trim()||typeof file.status!=='string'||!file.status.trim())throw new LaneError(`pull request #${pr} complete file inventory contains an unreadable entry`)
    paths.push(file.filename)
    if(file.previous_filename!==undefined){
      if(typeof file.previous_filename!=='string'||!file.previous_filename.trim())throw new LaneError(`pull request #${pr} prior filename is unreadable`)
      paths.push(file.previous_filename)
    }
  }
  // A verified rename supplies both paths. Copies, CHANGED/UNCHANGED, future
  // enum values, and renames without a readable prior path stay structural.
  // Either migration-side path also stays structural below.
  const completeCurrentPathStatuses=new Set(['added','modified','removed','deleted'])
  const structural=files.some((file)=>{
    const status=String(file.status).toLowerCase()
    if(status==='renamed')return typeof file.previous_filename!=='string'||!file.previous_filename.trim()
    return file.previous_filename!==undefined||!completeCurrentPathStatuses.has(status)
  })||paths.some((value)=>MIGRATION_PATH.test(String(value).replace(/\\/g,'/')))
  const linked=snapshot?.linkedIssues??io.closingIssuesForPr(Number(pr))
  if(!Array.isArray(linked)||linked.length>1)throw new LaneError(`pull request must close exactly one work issue; found ${Array.isArray(linked)?linked.length:'an unreadable set'}`)
  let nonclosing=null
  if(linked.length===0){
    if(structural||files.some(file=>file.status==='renamed'||file.previous_filename!==undefined)||typeof io.verifyNonclosingMaintenanceBinding!=='function')throw new LaneError('pull request must close exactly one work issue; found 0')
    nonclosing=io.verifyNonclosingMaintenanceBinding({pr:Number(pr),headSha:livePr.head.sha,files,issue})
    if(nonclosing?.headSha!==livePr.head.sha||!Number.isInteger(nonclosing?.issue)||nonclosing.issue<1)throw new LaneError('nonclosing maintenance binding is unreadable')
  }
  const linkedNumber=nonclosing?.issue??Number(linked[0]?.number)
  if(!Number.isInteger(linkedNumber)||linkedNumber<1)throw new LaneError('pull request linked work issue identity is unreadable')
  if(issue!==null&&Number(issue)!==linkedNumber)throw new LaneError(`operation issue #${issue} does not match pull request #${pr} linked issue #${linkedNumber}`)
  if(structural)return {route:'structural',issue:linkedNumber,pr:Number(pr),headSha:livePr.head.sha}

  const work=nonclosing?.work??snapshot?.linkedIssues?.[0]??io.getIssue(linkedNumber),scope=parseQueueScope(work?.body??'')
  if(String(work?.state??'open').toLowerCase()!=='open'||scope?.status!=='ready'||scope?.workType!=='repo-maintenance'||scope?.route!=='repo-maintenance'||scope?.writes?.length)throw new LaneError(`pull request #${pr} is not deterministic ready repository-maintenance work with no database objects`)
  let changeType=scope.changeType,legacy=false
  if(changeType===null){
    const created=Date.parse(String(work?.created_at??work?.createdAt??''))
    if(!Number.isFinite(created)||created>=Date.parse(ADMISSION_LEGACY_CUTOVER))throw new LaneError(`repository-maintenance issue #${linkedNumber} must declare a recognized non-structural change_type`)
    changeType='repo-maintenance';legacy=true
  }
  if(!NON_STRUCTURAL_CHANGE_TYPES.includes(changeType)||!REPOSITORY_MAINTENANCE_CHANGE_TYPES.has(changeType))throw new LaneError(`repository-maintenance issue #${linkedNumber} must declare a recognized repository-maintenance change_type`)
  return {route:'repo-maintenance',issue:linkedNumber,pr:Number(pr),headSha:livePr.head.sha,changeType,legacy}
}

export function requireAdmissionArguments(options,io,{pr=null}={}){
  if (io.enforceAdmission !== true) return null
  if (!Number.isInteger(Number(options.admitIssue)) || Number(options.admitIssue) <= 0) {
    throw new LaneError('--admit-issue <work issue> is required before claim, reviewer assignment, or shared-stage acquisition')
  }
  if (options.issue !== undefined && Number(options.issue) !== Number(options.admitIssue)) {
    throw new LaneError(`--admit-issue #${options.admitIssue} does not match --issue #${options.issue}`)
  }
  if(options.preparePreviewDispatch!==undefined&&Number(options.preparePreviewDispatch)!==Number(options.admitIssue))throw new LaneError(`--admit-issue #${options.admitIssue} does not match --prepare-preview-dispatch #${options.preparePreviewDispatch}`)
  if(pr===null&&(options.acquireExclusive||options.preparePreviewDispatch!==undefined))throw new LaneError('--pr <source pull request> is required so admission can inspect the actual shared-stage change')
}


// ISSUE #2448 (2) -- a second `#NNNN` anywhere in a claim title kills the claim.
// `claimTitleIssues` reads EVERY `#NNNN` in the title and `claimTitleWorkIssue`
// returns null unless there is exactly one, so a title that borrowed a work
// issue's own text -- `CLAIM: #2433 HANDOVER: preview rehearsal owed for merged
// PR #2423` -- was refused later, by a different command, against a claim that
// had already spent a permanent migration version. The refusal now arrives at
// claim time, before the mutex and before `reserveVersion`, and it NAMES the
// offending extra references so the operator can retitle instead of guess.
export function assertUnambiguousClaimTitle(task) {
  const title=`CLAIM: ${String(task??'')}`
  const refs=[...title.matchAll(/#(\d+)\b/g)].map((match)=>`#${match[1]}`)
  // A title with NO reference is left exactly as it was: such claims already
  // exist, `claimTitleWorkIssue` returns null for them and the surrounding code
  // handles that. #2448 is about the SECOND reference, and only that is refused.
  if(refs.length<=1)return refs[0]??null
  throw new LaneError(`--task must name exactly one work issue as #<number>; "${title}" also names ${refs.slice(1).join(', ')}. Retitle the claim so only the work issue remains -- a second reference makes the claim permanently unusable and spends its migration version for nothing`)
}
