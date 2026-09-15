import { canonicalJson, sha256 } from './evidence-bundle.mjs'

export class StartRerouteError extends Error {}
export const START_SLO_MS=10*60*1000
export const REROUTE_REF_PREFIX='refs/db-start-reroutes'
const SHA=/^[0-9a-f]{40}$/i, DIGEST=/^[0-9a-f]{64}$/i, TOKEN=/^[A-Za-z0-9._-]+$/
function ms(value){const n=Date.parse(value);if(Number.isNaN(n))throw new StartRerouteError('timestamp is unreadable');return n}
function token(value,label){if(!TOKEN.test(String(value??'')))throw new StartRerouteError(`${label} is unsafe`);return String(value)}
function assertions(value,label='required assertions'){
  if(!Array.isArray(value)||!value.length)throw new StartRerouteError(`${label} must be nonempty`)
  const normalized=value.map((x)=>token(x,'assertion')).sort()
  if(new Set(normalized).size!==normalized.length)throw new StartRerouteError(`${label} must be unique`)
  return normalized
}

function exactPair(pair,{digest,record}){
  return pair?.digest===digest&&canonicalJson(pair.record)===canonicalJson(record)&&pair.queue?.reroute_id===digest&&pair.queue?.replacement_id===record.replacement_id&&pair.queue?.status==='queued'
}

export function createDurableStartRerouteAdapter(durable){
  for(const name of ['withMutex','readPair','compareCreatePair','readLive','createAccepted','readAccepted'])if(typeof durable?.[name]!=='function')throw new StartRerouteError(`durable reroute adapter requires ${name}`)
  return {
    compareCreateRerouteAndReplacement(request){
      return durable.withMutex(()=>{
        const existing=durable.readPair(request.ref)
        if(existing){
          if(!exactPair(existing,request))throw new StartRerouteError(`a different ${request.record.kind} replacement already owns this original attempt`)
          return {...existing.queue,status:'existing'}
        }
        request.validateLive(durable.readLive(request.record.kind,request.record.original_id))
        const pair={digest:request.digest,record:request.record,queue:{status:'queued',reroute_id:request.digest,replacement_id:request.record.replacement_id}}
        if(durable.compareCreatePair(request.ref,null,pair))return pair.queue
        const winner=durable.readPair(request.ref)
        if(!exactPair(winner,request))throw new StartRerouteError(`a different ${request.record.kind} replacement won the atomic reservation`)
        return {...winner.queue,status:'existing'}
      })
    },
    readReroute(ref){const pair=durable.readPair(ref);return pair?{digest:pair.digest,record:pair.record}:null},
    createAccepted:(...args)=>durable.createAccepted?.(...args),
    readAccepted:(...args)=>durable.readAccepted?.(...args),
  }
}

export function dispatchQueuedReroute(ref,durable){
  for(const name of ['withMutex','readPair','readDispatchAck','compareCreateDispatchClaim','dispatchReplacement','compareCreateDispatchAck'])if(typeof durable?.[name]!=='function')throw new StartRerouteError(`durable reroute worker requires ${name}`)
  return durable.withMutex(()=>{
    const pair=durable.readPair(ref)
    if(!pair?.record||!exactPair(pair,{digest:pair.digest,record:pair.record}))throw new StartRerouteError('queued reroute is missing or corrupt')
    const existing=durable.readDispatchAck(ref)
    if(existing){if(existing.reroute_id!==pair.digest||existing.replacement_id!==pair.record.replacement_id||!['created','existing'].includes(existing.dispatch_status))throw new StartRerouteError('durable dispatch acknowledgement is corrupt');return{...existing,status:'existing'}}
    const claim={reroute_id:pair.digest,replacement_id:pair.record.replacement_id}
    if(!durable.compareCreateDispatchClaim(ref,claim)){const prior=durable.readDispatchClaim?.(ref);if(canonicalJson(prior)!==canonicalJson(claim))throw new StartRerouteError('another worker owns a different replacement dispatch')}
    const dispatched=durable.dispatchReplacement(pair.digest,pair.record)
    if(!dispatched||dispatched.reroute_id!==pair.digest||dispatched.replacement_id!==pair.record.replacement_id||!['created','existing'].includes(dispatched.status))throw new StartRerouteError('replacement dispatcher did not return an exact idempotent acknowledgement')
    const ack={reroute_id:pair.digest,replacement_id:pair.record.replacement_id,dispatch_status:dispatched.status}
    if(!durable.compareCreateDispatchAck(ref,ack)){const winner=durable.readDispatchAck(ref);if(canonicalJson(winner)!==canonicalJson(ack))throw new StartRerouteError('conflicting durable dispatch acknowledgement')}
    return {...ack,status:'acknowledged'}
  })
}

// Issue #2729 Step 7. A provider that ends a turn WITHOUT a verdict is finished,
// not running: it may be replaced at the SAME head. Only reasons named here count;
// an unknown terminal state stays uncertain and never frees the slot on its own.
export const NON_VERDICT_TERMINAL_REASONS=Object.freeze(['turn_limit_cancelled'])
// A local doctor/preflight timeout is retried on the same reviewer exactly once.
export const PREFLIGHT_TIMEOUT_RETRIES=1
// Liveness comes ONLY from the durable lifecycle stream. Session metadata is
// written when a session ENDS, so it cannot say that a review is still running,
// and a stale metadata row must never keep a dead assignment "active".
export const NON_LIFECYCLE_SOURCES=Object.freeze(['session-metadata','terminal-session-metadata'])
export function reviewerLifecycleEvents(assignment,lifecycle=[]){
  return (Array.isArray(lifecycle)?lifecycle:[]).filter((e)=>e?.assignment_id===assignment.id&&!NON_LIFECYCLE_SOURCES.includes(e.source))
}

export function reviewerStartDecision(assignment,{now,provider_state,lifecycle=[]}){
  if(!assignment?.id||!SHA.test(String(assignment.head_sha??'')))throw new StartRerouteError('exact assignment and head are required')
  const head=String(assignment.head_sha).toLowerCase()
  const events=reviewerLifecycleEvents(assignment,lifecycle)
  // A verdict recorded by THIS assignment ends it; nothing is replaced. Another
  // slot's verdict is not in this stream (events are scoped to assignment_id).
  if(events.some((e)=>e.type==='verdict_recorded'))throw new StartRerouteError('this assignment already recorded a verdict; it is not eligible for replacement')
  const terminal=events.filter((e)=>e.type==='terminal_non_verdict')
  if(terminal.length){
    const last=terminal.at(-1)
    if(!NON_VERDICT_TERMINAL_REASONS.includes(last.reason))throw new StartRerouteError('terminal reason is not a recognised non-verdict; preserve the lease and refuse replacement')
    if(String(last.head_sha??'').toLowerCase()!==head)throw new StartRerouteError('terminal non-verdict does not bind the assigned head')
    return {action:'governed-return-and-reroute',reason:last.reason,head_sha:head,same_head:true,source:'durable-lifecycle'}
  }
  const started=events.find((e)=>['provider_launched','provider_contacted','review_started'].includes(e.type))
  if(started)return {action:'keep-active',started_at:started.at,source:'durable-lifecycle'}
  const timeouts=events.filter((e)=>e.type==='preflight_timeout').length
  if(timeouts>0&&timeouts<=PREFLIGHT_TIMEOUT_RETRIES)return {action:'retry-same-reviewer',reason:'local_preflight_timeout',attempt:timeouts+1,source:'durable-lifecycle'}
  if(timeouts>PREFLIGHT_TIMEOUT_RETRIES)return {action:'governed-return-and-reroute',reason:'local_preflight_timeout',head_sha:head,same_head:true,source:'durable-lifecycle'}
  if(events.some((e)=>e.type==='terminal_format_invalid'))return {action:'same-session-clarification'}
  const overdue=ms(now)-ms(assignment.assigned_at)>=START_SLO_MS
  if(!overdue&&provider_state==='usable')return {action:'wait'}
  if(provider_state==='remote-unknown')throw new StartRerouteError('paid review start is uncertain; preserve the lease and refuse replacement')
  if(!['unusable','quarantined','confirmed-not-started'].includes(provider_state))throw new StartRerouteError('reviewer start state is not authoritative')
  return {action:'governed-return-and-reroute',reason:provider_state}
}

export function runnerStartDecision(attempt,{now,lifecycle=[],qualified_lanes=[]}){
  if(!attempt?.id||!attempt.workflow||!attempt.lane||!SHA.test(String(attempt.head_sha??'')))throw new StartRerouteError('runner attempt requires exact workflow, lane, head, and assertions')
  const required=assertions(attempt.required_assertions)
  const events=lifecycle.filter((e)=>e.attempt_id===attempt.id),started=events.find((e)=>e.type==='runner_started')
  if(started)return {action:'keep-active',started_at:started.at}
  if(ms(now)-ms(attempt.queued_at)<START_SLO_MS)return {action:'wait'}
  const lane=qualified_lanes.find((x)=>x.name!==attempt.lane&&x.qualified===true&&(()=>{try{return canonicalJson(assertions(x.assertions,'lane assertions'))===canonicalJson(required)}catch{return false}})())
  if(!lane)throw new StartRerouteError('no independent qualified runner lane preserves every assertion')
  return {action:'dispatch-new-run',lane:lane.name,supersedes:attempt.id,workflow:attempt.workflow,head_sha:attempt.head_sha.toLowerCase(),required_assertions:required}
}

function reserveAndDispatch(kind,original,decision,replacement,io){
  const expectedAction=kind==='reviewer'?'governed-return-and-reroute':'dispatch-new-run'
  if(decision?.action!==expectedAction)throw new StartRerouteError(`cannot reserve a ${kind} reroute from this decision`)
  const originalId=token(original.id,`${kind} original id`),replacementId=token(replacement.id,`${kind} replacement id`)
  const record={schema_version:1,kind,original_id:originalId,replacement_id:replacementId,head_sha:String(original.head_sha).toLowerCase(),...(kind==='runner'?{workflow:token(original.workflow,'workflow'),lane:token(decision.lane,'lane'),required_assertions:assertions(original.required_assertions)}:{provider:token(replacement.provider,'replacement provider')})}
  const rerouteId=sha256(canonicalJson(record)),sealed={...record,reroute_id:rerouteId},ref=`${REROUTE_REF_PREFIX}/${kind}/${originalId}`
  if(typeof io?.compareCreateRerouteAndReplacement!=='function')throw new StartRerouteError('atomic lifecycle-fenced reroute store and dispatcher are required')
  const validateLive=(live)=>{
    if(!live||typeof live!=='object')throw new StartRerouteError(`${kind} lifecycle could not be re-read inside the reservation fence`)
    const fresh=kind==='reviewer'
      ? reviewerStartDecision(original,{now:live.now,provider_state:live.provider_state,lifecycle:live.lifecycle??[]})
      : runnerStartDecision(original,{now:live.now,lifecycle:live.lifecycle??[],qualified_lanes:live.qualified_lanes??[]})
    if(fresh.action!==expectedAction||(kind==='runner'&&fresh.lane!==decision.lane))throw new StartRerouteError(`${kind} started or changed while its replacement was being reserved`)
    return true
  }
  const acknowledgement=io.compareCreateRerouteAndReplacement({ref,digest:rerouteId,record:sealed,validateLive})
  if(!acknowledgement||acknowledgement.reroute_id!==rerouteId||acknowledgement.replacement_id!==replacementId||!['queued','existing'].includes(acknowledgement.status))throw new StartRerouteError(`${kind} replacement lacks exact durable queue acknowledgement`)
  return {ref,reroute_id:rerouteId,replacement_id:replacementId,status:acknowledgement.status}
}

export const reserveReviewerReroute=(assignment,decision,replacement,io)=>reserveAndDispatch('reviewer',assignment,decision,replacement,io)
export const reserveRunnerReroute=(attempt,decision,replacement,io)=>reserveAndDispatch('runner',attempt,decision,replacement,io)

export function acceptRunnerResult(result,originalAttempt,io){
  if(!result?.attempt_id||!result?.supersedes_attempt_id||!result?.reroute_id||!result?.workflow||!result?.lane||!SHA.test(String(result.head_sha??''))||!Array.isArray(result.assertions)||!result.assertions.length)throw new StartRerouteError('accepted runner result must contain an exact supersession identity')
  if(!originalAttempt?.id||result.supersedes_attempt_id!==originalAttempt.id||result.workflow!==originalAttempt.workflow||String(result.head_sha).toLowerCase()!==String(originalAttempt.head_sha).toLowerCase())throw new StartRerouteError('runner result does not bind the original workflow, head, and supersession')
  const required=assertions(originalAttempt.required_assertions),reported=result.assertions.map((x)=>({name:token(x?.name,'assertion name'),result:x?.result})).sort((a,b)=>a.name.localeCompare(b.name))
  if(reported.some((x)=>x.result!=='passed')||canonicalJson(reported.map((x)=>x.name))!==canonicalJson(required))throw new StartRerouteError('runner result does not pass the exact original assertion set')
  const rerouteRef=`${REROUTE_REF_PREFIX}/runner/${token(originalAttempt.id,'runner original id')}`,reserved=io.readReroute(rerouteRef)
  const reservationRecord=reserved?.record??{},reservationIdentity={...reservationRecord};delete reservationIdentity.reroute_id
  if(!reserved||reserved.digest!==result.reroute_id||reservationRecord.reroute_id!==result.reroute_id||sha256(canonicalJson(reservationIdentity))!==result.reroute_id||reservationRecord.replacement_id!==result.attempt_id||reservationRecord.original_id!==originalAttempt.id||reservationRecord.workflow!==originalAttempt.workflow||reservationRecord.lane!==result.lane||reservationRecord.head_sha!==String(originalAttempt.head_sha).toLowerCase()||canonicalJson(reservationRecord.required_assertions)!==canonicalJson(required))throw new StartRerouteError('runner result is not bound to the immutable reroute reservation')
  const resultIdentity={attempt_id:result.attempt_id,supersedes_attempt_id:result.supersedes_attempt_id,reroute_id:result.reroute_id,workflow:result.workflow,lane:result.lane,head_sha:String(result.head_sha).toLowerCase(),assertions:reported}
  if(!DIGEST.test(String(result.result_digest??''))||result.result_digest!==sha256(canonicalJson(resultIdentity)))throw new StartRerouteError('runner result requires its exact canonical digest')
  const ref=`refs/db-runner-accepted/${token(result.workflow,'workflow')}/${String(result.head_sha).toLowerCase()}`,digest=result.result_digest
  if(!io.createAccepted(ref,digest,result)){const prior=io.readAccepted(ref);if(prior?.digest!==digest)throw new StartRerouteError('another runner result was already accepted for this workflow and head')}
  return {accepted:true,ref,digest}
}
