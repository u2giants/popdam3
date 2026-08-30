import { canonicalJson, sha256 } from './evidence-bundle.mjs'
import { previewReadyEvent } from '../db-coordination-events.mjs'

export class ReconcileError extends Error {}
export const READY_PREFIX='refs/db-preview-ready'
export const OUTCOME_PREFIX='refs/db-preview-ready-outcomes'
export const ROUTES=new Set(['ordinary_preview_apply','merged_rehearsal','historical_rebind'])

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
  return {...record,ready_id}
}

function assertMarker(io){const marker=io.resolveMarker();if(!marker?.live||marker.calling_task!==marker.task)throw new ReconcileError('matching live sole-orchestrator marker is required')}
function outcomeRef(id){return `${OUTCOME_PREFIX}/${id}`}
function readyRef(id){return `${READY_PREFIX}/${id}`}

export function persistInitialReady(input,io){
  assertMarker(io);const record=readyRecord(input),ref=readyRef(record.ready_id),digest=sha256(canonicalJson(record))
  const event=previewReadyEvent({workIssue:record.issue,actor:io.actor(),timestamp:io.now(),pr:record.pr,head_sha:record.head_sha,ready_id:record.ready_id,bundle_id:record.bundle_id,route:record.route,route_context:record.route_context,manifest_digest:record.manifest_digest})
  io.appendEvent(event)
  if(!io.createRef(ref,digest,record)&&io.readRef(ref)?.digest!==digest)throw new ReconcileError('preview-ready ref is occupied by inconsistent data')
  return {status:'PREVIEW_READY',ref,record}
}

export function preparePreviewDispatch(issue,io){
  assertMarker(io)
  return io.withMutex(()=>{
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

export function reconcileFlow(input,io){
  const marker=io.resolveMarker(),mutating=Boolean(marker?.live&&marker.calling_task===marker.task),actions=[]
  for(const issue of input.issues??[]){
    if(issue.preview_error)actions.push({issue:issue.issue,action:'preview-unverifiable',reason:issue.preview_error})
    if(issue.blocker?.durable&&!issue.blocker.resolved&&issue.capacity_state==='active')actions.push({issue:issue.issue,action:'relinquish-capacity',result:mutating?io.relinquishCapacity(issue):null})
    if(issue.blocker?.resolved&&issue.capacity_state==='relinquished')actions.push({issue:issue.issue,action:'resume-capacity',result:mutating?io.resumeCapacity(issue):null})
    if(issue.preview_edge_satisfied)actions.push({issue:issue.issue,action:mutating?'persist-preview-ready':'report-preview-ready',result:mutating?io.persistReady(issue):null})
  }
  const unavailable=actions.some((action)=>action.action==='preview-unverifiable')
  return {status:unavailable?'UNVERIFIABLE':mutating?'RECONCILED':'REPORT_ONLY',mutating,actions}
}
