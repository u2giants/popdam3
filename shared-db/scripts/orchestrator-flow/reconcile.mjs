import { canonicalJson, sha256 } from './evidence-bundle.mjs'
import { previewReadyEvent } from '../db-coordination-events.mjs'

export class ReconcileError extends Error {}
export const READY_PREFIX='refs/db-preview-ready'
export const OUTCOME_PREFIX='refs/db-preview-ready-outcomes'
export const ROUTES=new Set(['ordinary_preview_apply','merged_rehearsal','historical_rebind'])
// THE MODE A STORED INSTRUCTION MUST BE DISPATCHED WITH (#2796). The workflow's
// `mode` input defaults to dry-run, so an instruction silent about mode gets
// dispatched verbatim, DRY-RUNS, uploads only `preview-migration-dry-run-<sha>`,
// applies nothing, and still reports SUCCESS -- which downstream lanes then read
// as preview proof (run 34633793571). Naming the phases is what makes the two
// runs distinguishable before the fact instead of after.
//
// Route-specific, matching the existing workflow exactly: ordinary and merged
// "run `mode=dry-run` then `mode=apply`"; historical rebind "runs the existing
// recovery `mode=apply` only and must never dispatch a historical-input dry-run".
// Derived from the route here rather than taken from the caller, so a candidate
// cannot name a mode sequence its route does not permit.
export const MODE_SEQUENCE=Object.freeze({ordinary_preview_apply:Object.freeze(['dry-run','apply']),merged_rehearsal:Object.freeze(['dry-run','apply']),historical_rebind:Object.freeze(['apply'])})

export function readyRecord(input){
  const record={schema_version:1,issue:Number(input.issue),pr:Number(input.pr),head_sha:String(input.head_sha),bundle_id:String(input.bundle_id),route:String(input.route),route_context:String(input.route_context??''),manifest:input.manifest}
  if(!Number.isInteger(record.issue)||!Number.isInteger(record.pr)||!/^[0-9a-f]{40}$/i.test(record.head_sha)||!/^[0-9a-f]{64}$/.test(record.bundle_id)||!ROUTES.has(record.route)||!record.manifest||typeof record.manifest!=='object')throw new ReconcileError('complete preview-ready identity is required')
  if(record.route==='ordinary_preview_apply'&&record.route_context)throw new ReconcileError('ordinary preview route context must be empty')
  if(record.route!=='ordinary_preview_apply'&&!/^[0-9a-f]{40}$/i.test(record.route_context))throw new ReconcileError('recovery route context must be the current main SHA')
  const forbidden=['production_allowlist','confirmation','review_artifact_digest','owner_decision','source_pr','preview_run_id','preview_artifact_digest']
  for(const key of forbidden)if(key in record.manifest)throw new ReconcileError(`preview manifest contains forbidden field ${key}`)
  if(record.manifest.target!=='preview'||!record.manifest.preview_allowlist)throw new ReconcileError('preview manifest is incomplete')
  // A merged rehearsal names no claim: the claim PR is already merged, and
  // shared-supabase-migrations REFUSES a manifest that carries claim_pr alongside
  // merged_preview_source_pr. Requiring claim_pr here made the merged_rehearsal route
  // undispatchable one layer below the workflow -- the route existed, emitted a valid
  // manifest, and then failed at persistence. Each route states its own identity fields.
  const required=record.route==='merged_rehearsal'?['commit_sha','merged_preview_source_pr']:record.route==='historical_rebind'?['claim_pr','claim_head_sha','commit_sha','historical_preview_source_pr','historical_preview_original_run_map']:['claim_pr','claim_head_sha']
  for(const key of required)if(!record.manifest[key])throw new ReconcileError('preview manifest is incomplete')
  if(record.route==='merged_rehearsal'&&(record.manifest.claim_pr||record.manifest.claim_head_sha))throw new ReconcileError('a merged rehearsal manifest must not name a live author claim')
  if(record.route==='historical_rebind'){
    const versions=String(record.manifest.preview_allowlist).split(',').filter(Boolean).sort(),pairs=String(record.manifest.historical_preview_original_run_map).split(',').map((pair)=>pair.split(':'))
    if(!/^\d+$/.test(String(record.manifest.historical_preview_source_pr))||pairs.some(([version,runId,...extra])=>extra.length||!/^\d{14}$/.test(version)||!/^\d+$/.test(runId))||JSON.stringify(pairs.map(([version])=>version).sort())!==JSON.stringify(versions))throw new ReconcileError('historical recovery manifest is not dispatchable')
  }
  record.manifest_digest=sha256(canonicalJson(record.manifest))
  const ready_id=sha256(canonicalJson(record))
  // mode_sequence is attached AFTER both digests are taken, deliberately. Phase 2:
  // "`mode` is a per-run phase, not part of ready identity or frozen-manifest
  // equality." Folding it into the manifest would change manifest_digest and
  // ready_id and freeze a per-run phase into immutable identity; leaving it off the
  // record entirely would drop it before the operator ever sees the instruction.
  return {...record,ready_id,mode_sequence:MODE_SEQUENCE[record.route]}
}

function assertMarker(io){const marker=io.resolveMarker();if(!marker?.live||marker.calling_task!==marker.task)throw new ReconcileError('matching live sole-orchestrator marker is required')}
// Ready IDENTITY, with the per-run phase removed. Refs written before mode_sequence
// existed hash a record without it, so identity is the only comparison under which a
// pre-change ref and a freshly prepared one for the SAME ready_id agree.
function readyIdentityDigest(record){const {mode_sequence:_modeSequence,...identity}=record??{};return sha256(canonicalJson(identity))}
function outcomeRef(id){return `${OUTCOME_PREFIX}/${id}`}
function readyRef(id){return `${READY_PREFIX}/${id}`}

export function persistInitialReady(input,io){
  assertMarker(io);const record=readyRecord(input),ref=readyRef(record.ready_id)
  // The STORED digest must stay sha256(canonicalJson(<whole stored record>)): readers
  // recompute it from the record they read back, so any narrower convention here makes
  // every newly written ref unreadable to them (manage-migration-author-lanes.mjs:2094).
  const digest=sha256(canonicalJson(record))
  const event=previewReadyEvent({workIssue:record.issue,actor:io.actor(),timestamp:io.now(),pr:record.pr,head_sha:record.head_sha,ready_id:record.ready_id,bundle_id:record.bundle_id,route:record.route,route_context:record.route_context,manifest_digest:record.manifest_digest})
  io.appendEvent(event)
  // Occupancy is judged on IDENTITY, not on the stored bytes. A ref written before
  // mode_sequence existed holds the same identity under a different digest, and
  // re-preparing that identity must converge rather than fail closed.
  if(!io.createRef(ref,digest,record)&&readyIdentityDigest(io.readRef(ref)?.record)!==readyIdentityDigest(record))throw new ReconcileError('preview-ready ref is occupied by inconsistent data')
  return {status:'PREVIEW_READY',ref,record}
}

export function preparePreviewDispatch(issue,io){
  assertMarker(io)
  return io.withMutex(()=>{
    assertMarker(io)
    const snapshot=readyRecord(io.selectCurrent(Number(issue)))
    const current=persistInitialReady(snapshot,io)
    for(const old of io.listReady(Number(issue))){
      if(old.record.ready_id===snapshot.ready_id||io.readRef(outcomeRef(old.record.ready_id)))continue
      if(!io.createRef(outcomeRef(old.record.ready_id),'superseded',{outcome:'superseded',successor:snapshot.ready_id})){
        const existing=io.readRef(outcomeRef(old.record.ready_id));if(existing?.record?.outcome!=='superseded')throw new ReconcileError('conflicting terminal preview-ready outcome')
      }
    }
    const unresolved=io.listReady(Number(issue)).filter((row)=>!io.readRef(outcomeRef(row.record.ready_id)))
    if(unresolved.length!==1||unresolved[0].record.ready_id!==snapshot.ready_id)throw new ReconcileError('preparation did not converge on exactly one current ready record')
    return current
  })
}

export function terminalizeReady(readyId,outcome,proof,io){
  if(!['dispatched','cancelled'].includes(outcome))throw new ReconcileError('terminal outcome must be dispatched or cancelled')
  if(!proof?.positive||outcome==='dispatched'&&proof.mode!=='apply')throw new ReconcileError('positive completing evidence is required')
  const ref=outcomeRef(readyId)
  if(!io.createRef(ref,outcome,{outcome,proof})){
    const existing=io.readRef(ref);if(existing?.record?.outcome!==outcome)throw new ReconcileError('another terminal writer won')
  }
  return {ready_id:readyId,outcome}
}

export function repairPreviewReady(readyId,issue,io){
  assertMarker(io)
  const bindings=io.events(Number(issue)).filter((event)=>event.schema_version===2&&event.event_type==='preview_ready'&&event.ready_id===readyId)
  if(bindings.length!==1)throw new ReconcileError('repair requires one readable v2 full-tuple event binding')
  const current=readyRecord(io.selectCurrent(Number(issue)))
  if(current.ready_id===readyId)throw new ReconcileError('current ready identity is corrupt; owner decision required without mutation')
  return preparePreviewDispatch(issue,io)
}

// CAPACITY AND PREVIEW ARE SEPARATE TRUTHS (issue #2301 Step 4). Before this, a
// single issue whose preview readiness could not be derived turned the WHOLE
// reconciliation `UNVERIFIABLE`, which reads as "capacity truth is unavailable"
// for every other lane in the run -- including lanes whose capacity state was
// perfectly readable. One undeciphered preview edge was enough to hide every
// capacity report in the repository behind a single word.
//
// The two domains now carry their own status and their own counts, and every
// action declares which domain it belongs to. The top-level `status` is
// unchanged in meaning for existing consumers: it is still `UNVERIFIABLE`
// whenever preview evidence is unreadable, and the only NEW way to reach it is a
// capacity error, an input field that did not exist before this change and so
// cannot silently reclassify any run that a consumer has already seen.
export const RECONCILE_SCHEMA_VERSION=2
export const CAPACITY_DOMAIN='capacity'
export const PREVIEW_DOMAIN='preview'
export const RELINQUISH_WORKTREE_STATES=Object.freeze(['clean','dirty','absent','remote'])

// THE ABANDONMENT-AUDIT FENCE. Parsed here rather than in the caller so that the
// reconciler that SUGGESTS the guarded command and the guarded command that
// REVALIDATES the evidence read the same definition. A fence that omits any
// identity field, or carries one in the wrong shape, is not evidence: it returns
// null rather than a partially-trusted record.
export function parseAbandonmentAudit(body){
  const fence=/^```abandonment-audit[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/m.exec(String(body??''))
  if(!fence)return null
  const fields=new Map()
  for(const line of fence[1].split(/\r?\n/)){
    const match=/^([a-z_]+):[ \t]*(\S.*?)[ \t]*$/.exec(line)
    if(match&&!fields.has(match[1]))fields.set(match[1],match[2])
  }
  const record={
    claim:Number(String(fields.get('claim')??'').replace(/^#/,'')),
    pr:Number(String(fields.get('pr')??'').replace(/^#/,'')),
    head_sha:String(fields.get('head_sha')??'').toLowerCase(),
    owner:String(fields.get('owner')??''),
  }
  if(!Number.isInteger(record.claim)||record.claim<1)return null
  if(!Number.isInteger(record.pr)||record.pr<1)return null
  if(!/^[0-9a-f]{40}$/.test(record.head_sha)||!record.owner)return null
  return record
}

// ABANDONMENT EVIDENCE IS DELIBERATELY NARROW. An ordinary durable work
// dependency -- "this task waits on issue #123" -- says the work is BLOCKED, not
// that its author walked away, and it must never produce a capacity-relinquish
// suggestion. Evidence is only a live `repo-maintenance` abandonment-audit issue
// that names this exact claim, pull request, head and owner. Anything absent,
// closed, differently typed, or naming a different tuple returns null, and a null
// here means the report stays a report.
export function abandonmentEvidenceFor(issue){
  const blocker=issue?.blocker
  if(!blocker?.durable||blocker.resolved)return null
  if(blocker.state!=='open'||blocker.work_type!=='repo-maintenance')return null
  const audit=blocker.audit,claim=issue.expired_claim
  if(!audit||!claim)return null
  if(Number(audit.claim)!==Number(claim.claim))return null
  if(Number(audit.pr)!==Number(claim.pr))return null
  if(String(audit.head_sha).toLowerCase()!==String(claim.head_sha??'').toLowerCase())return null
  if(String(audit.owner)!==String(claim.owner??''))return null
  return {...audit,reference:blocker.reference}
}

// EXPIRY ALONE NEVER MUTATES. An expired lease is a claim whose clock ran out,
// which is not the same fact as an author who abandoned it, and the difference is
// only knowable from evidence somebody wrote down. So this emits a REPORT: who
// holds it, how long it has been expired, what its pull request is doing, what it
// is blocked on, and how many tasks are queued behind it -- and it carries the
// suggested guarded command ONLY when real abandonment evidence is present. The
// suggestion is text for an operator to run deliberately; nothing here relinquishes.
function expiredUnconfirmedReport(issue){
  const claim=issue.expired_claim??{},evidence=abandonmentEvidenceFor(issue),blocker=issue.blocker
  const action={
    issue:issue.issue,domain:CAPACITY_DOMAIN,action:'expired-unconfirmed-report',mutates:false,
    claim:claim.claim??issue.claim??null,
    owner:claim.owner??issue.owner??null,
    expires_at:claim.expires_at??null,
    expired_for_seconds:claim.expired_for_seconds??null,
    pr:claim.pr??null,
    pr_state:claim.pr_state??'unknown',
    head_sha:claim.head_sha??null,
    // null means UNKNOWN, never zero. "Nothing is waiting behind this expired
    // lane" is a reason not to act; an unreadable queue is not.
    queued_behind:claim.queued_behind===null||claim.queued_behind===undefined?null:Number(claim.queued_behind),
    blocker:blocker?{reference:blocker.reference??null,state:blocker.state??null,work_type:blocker.work_type??null,resolved:Boolean(blocker.resolved),abandonment_audit:Boolean(blocker.audit)}:null,
    abandonment_evidence:evidence?{reference:evidence.reference,claim:evidence.claim,pr:evidence.pr,head_sha:evidence.head_sha,owner:evidence.owner}:null,
    suggested_command:null,
  }
  if(evidence)action.suggested_command=[
    'node scripts/manage-migration-author-lanes.mjs --relinquish-author-lease',
    // --claim-number, NOT --claim. The lane CLI parses `--claim` as a BOOLEAN
    // (it is the flag that claims a lane), so `--claim 41` dies on the bare 41
    // as an unknown argument. The value flag is --claim-number, and the test
    // below runs this exact string through the real CLI rather than matching it.
    `--claim-number ${evidence.claim}`,
    `--owner "${evidence.owner}"`,
    `--blocked-on ${evidence.reference}`,
    `--worktree-state <${RELINQUISH_WORKTREE_STATES.join('|')}>`,
  ].join(' ')
  return action
}

function domainStatus(unverifiable,mutating){return unverifiable?'UNVERIFIABLE':mutating?'RECONCILED':'REPORT_ONLY'}

// #2301 Step 5. A SCHEDULED audit must be read-only BY CONSTRUCTION, not by
// luck of its environment. `reconcileFlow` decides whether to mutate from the
// live sole-orchestrator marker, and a hosted runner happens not to hold one --
// but "happens not to" is exactly the guarantee that stops holding the day
// somebody grants the workflow a token or a marker leaks into CI. This wrapper
// removes the capability instead of relying on its absence: the marker reads as
// gone, and every mutation hook throws if it is ever reached at all. A run that
// tried to write fails loudly rather than writing.
export const AUDIT_EXIT_CLEAN=0
export const AUDIT_EXIT_EXPIRED=2
export const AUDIT_EXIT_UNVERIFIABLE=3
export function reportOnlyFlowIo(io){
  const refuse=(name)=>()=>{throw new ReconcileError(`read-only abandonment audit must never call ${name}`)}
  return {
    ...io,
    resolveMarker:()=>null,
    relinquishCapacity:refuse('relinquishCapacity'),
    resumeCapacity:refuse('resumeCapacity'),
    persistReady:refuse('persistReady'),
  }
}

// THREE OUTCOMES, NOT TWO. Expiry and unreadability are different facts and an
// operator must be able to tell them apart from the exit code alone: an expired
// claim is a queue that needs a decision, while an unreadable or malformed audit
// state is a broken instrument and must fail closed. Anything that is not a
// report-only result of the current schema is treated as unreadable, so a future
// schema or a mutating result can never be mistaken for a clean run.
export function abandonmentAuditExit(result){
  if(result?.schema_version!==RECONCILE_SCHEMA_VERSION||result?.mutating!==false)return AUDIT_EXIT_UNVERIFIABLE
  if([result.capacity?.status,result.preview?.status].includes('UNVERIFIABLE'))return AUDIT_EXIT_UNVERIFIABLE
  if((result.actions??[]).some((action)=>action.action==='expired-unconfirmed-report'))return AUDIT_EXIT_EXPIRED
  return AUDIT_EXIT_CLEAN
}

export function reconcileFlow(input,io){
  const marker=io.resolveMarker(),mutating=Boolean(marker?.live&&marker.calling_task===marker.task),actions=[]
  const seen={[CAPACITY_DOMAIN]:new Set(),[PREVIEW_DOMAIN]:new Set()}
  let capacityUnverifiable=false,previewUnverifiable=false
  for(const issue of input.issues??[]){
    // The capacity leg runs to completion whatever the preview leg reports, and
    // the preview leg runs whatever capacity reports. Neither reads the other's
    // error, which is the whole point of the separation.
    seen[CAPACITY_DOMAIN].add(issue.issue)
    if(issue.capacity_error){
      capacityUnverifiable=true
      actions.push({issue:issue.issue,domain:CAPACITY_DOMAIN,action:'capacity-unverifiable',mutates:false,reason:issue.capacity_error})
    }else{
      if(issue.capacity_state==='expired-unconfirmed')actions.push(expiredUnconfirmedReport(issue))
      if(issue.blocker?.durable&&!issue.blocker.resolved&&issue.capacity_state==='active')actions.push({issue:issue.issue,domain:CAPACITY_DOMAIN,action:'relinquish-capacity',mutates:mutating,result:mutating?io.relinquishCapacity(issue):null})
      if(issue.blocker?.resolved&&issue.capacity_state==='relinquished')actions.push({issue:issue.issue,domain:CAPACITY_DOMAIN,action:'resume-capacity',mutates:mutating,result:mutating?io.resumeCapacity(issue):null})
    }
    seen[PREVIEW_DOMAIN].add(issue.issue)
    if(issue.preview_error){
      previewUnverifiable=true
      actions.push({issue:issue.issue,domain:PREVIEW_DOMAIN,action:'preview-unverifiable',mutates:false,reason:issue.preview_error})
    }else if(issue.preview_edge_satisfied){
      actions.push({issue:issue.issue,domain:PREVIEW_DOMAIN,action:mutating?'persist-preview-ready':'report-preview-ready',mutates:mutating,result:mutating?io.persistReady(issue):null})
    }
  }
  const counts=(domain,unverifiable)=>({
    issues:seen[domain].size,
    actions:actions.filter((action)=>action.domain===domain).length,
    unverifiable:actions.filter((action)=>action.domain===domain&&action.action.endsWith('-unverifiable')).length,
    status:domainStatus(unverifiable,mutating),
  })
  const capacity=counts(CAPACITY_DOMAIN,capacityUnverifiable),preview=counts(PREVIEW_DOMAIN,previewUnverifiable)
  return {
    schema_version:RECONCILE_SCHEMA_VERSION,
    // Unchanged for every consumer that existed before this change.
    status:capacityUnverifiable||previewUnverifiable?'UNVERIFIABLE':mutating?'RECONCILED':'REPORT_ONLY',
    mutating,capacity,preview,actions,
  }
}
