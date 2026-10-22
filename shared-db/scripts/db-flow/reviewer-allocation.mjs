import { canonicalJson, sha256 } from './evidence-bundle.mjs'

export class ReviewerAllocationError extends Error {}
export const REVIEW_RESERVATION_PREFIX='refs/db-reviewer-reservations'

// NO SAME-REVIEWER CONCURRENCY CEILING (owner ruling, 2026-09-16). One reviewer
// provider may run any number of independent reviews at the same time. A
// reservation is therefore keyed by the exact review (provider/wrapper plus
// issue, PR, head and bundle), never by the provider alone, and "every provider
// is busy" is not a state: there is no wait queue. The execution key still
// collapses display-name aliases of one wrapper so independence rules count
// one provider once.
export function executionKey(reviewer){
  if(!reviewer?.name||!reviewer?.wrapper)throw new ReviewerAllocationError('reviewer name and wrapper are required')
  const provider=String(reviewer.provider??reviewer.wrapper).toLowerCase().replace(/[^a-z0-9.-]+/g,'-').replace(/\.{2,}/g,'.')
  return `${provider}:${String(reviewer.wrapper).toLowerCase().replace(/[^a-z0-9.-]+/g,'-').replace(/\.{2,}/g,'.')}`
}

export function approvedExecutionCandidates({active,overflow=[],prohibited=[]}){
  const denied=new Set(prohibited),seen=new Set(),result=[]
  for(const candidate of [...active,...overflow.map((row)=>({...row,overflow:true}))]){
    if(denied.has(candidate.name))continue
    const key=executionKey(candidate);if(seen.has(key))continue;seen.add(key);result.push({...candidate,execution_key:key,overflow:Boolean(candidate.overflow)})
  }
  return result
}

function requestRecord(request,candidates){return {schema_version:1,issue:Number(request.issue),pr:Number(request.pr),head_sha:String(request.head_sha),bundle_id:String(request.bundle_id),eligible_execution_keys:candidates.map((row)=>row.execution_key)}}

export function reviewReservationRef(executionKeyValue,request){
  // A colon is not legal in a git refname, so provider and wrapper become path segments.
  return `${REVIEW_RESERVATION_PREFIX}/${String(executionKeyValue).replace(':','/')}/${Number(request.issue)}-${Number(request.pr)}-${String(request.head_sha).toLowerCase()}-${String(request.bundle_id).slice(0,16)}`
}

export function allocateReviewer(request,policy,io){
  if(!Number.isInteger(Number(request.issue))||!Number.isInteger(Number(request.pr))||!/^[0-9a-f]{40}$/i.test(String(request.head_sha??''))||!/^[0-9a-f]{64}$/.test(String(request.bundle_id??'')))throw new ReviewerAllocationError('exact issue, PR, head and bundle are required')
  let candidates=approvedExecutionCandidates(policy)
  const contextDenied=new Set(policy.context_denied??[]);candidates=candidates.filter((row)=>!contextDenied.has(row.name))
  if(!candidates.length)throw new ReviewerAllocationError('no approved reviewer execution context is eligible')
  // Active reviewers first; overflow only when no active reviewer exists. Another
  // live review by the same provider never removes it from the choice. Load is
  // spread without any ceiling: the starting provider is derived from the exact
  // review, so distinct reviews rotate across providers deterministically.
  const active=candidates.filter((row)=>!row.overflow)
  const pool=active.length?active:candidates
  const start=parseInt(sha256(`${Number(request.issue)}-${Number(request.pr)}-${String(request.head_sha).toLowerCase()}-${request.bundle_id}`).slice(0,8),16)%pool.length
  const choices=[...pool.slice(start),...pool.slice(0,start)]
  for(const candidate of choices){
    const record={...requestRecord(request,candidates),reviewer:candidate.name,wrapper:candidate.wrapper,execution_key:candidate.execution_key,overflow:candidate.overflow}
    const digest=sha256(canonicalJson(record)),ref=reviewReservationRef(candidate.execution_key,request)
    if(io.createReservation(ref,digest,record))return {status:'assigned',...record,reservation_ref:ref,reservation_digest:digest}
  }
  throw new ReviewerAllocationError('this exact review is already reserved by every eligible reviewer; reconcile the existing reservation instead of retrying')
}
