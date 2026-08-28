import { canonicalJson, sha256 } from './evidence-bundle.mjs'

export class ReviewerAllocationError extends Error {}
export const REVIEW_WAIT_PREFIX='refs/db-reviewer-waits'
export const REVIEW_RESERVATION_PREFIX='refs/db-reviewer-reservations'

export function executionKey(reviewer){
  if(!reviewer?.name||!reviewer?.wrapper)throw new ReviewerAllocationError('reviewer name and wrapper are required')
  const provider=String(reviewer.provider??reviewer.wrapper).toLowerCase().replace(/[^a-z0-9.-]+/g,'-')
  return `${provider}:${String(reviewer.wrapper).toLowerCase()}`
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

export function allocateReviewer(request,policy,io){
  if(!Number.isInteger(Number(request.issue))||!Number.isInteger(Number(request.pr))||!/^[0-9a-f]{40}$/i.test(String(request.head_sha??''))||!/^[0-9a-f]{64}$/.test(String(request.bundle_id??'')))throw new ReviewerAllocationError('exact issue, PR, head and bundle are required')
  let candidates=approvedExecutionCandidates(policy)
  const contextDenied=new Set(policy.context_denied??[]);candidates=candidates.filter((row)=>!contextDenied.has(row.name))
  if(!candidates.length)throw new ReviewerAllocationError('no approved reviewer execution context is eligible')
  const activeCandidates=candidates.filter((row)=>!row.overflow),activeAvailable=activeCandidates.filter((row)=>!io.readReservation(row.execution_key))
  let choices=activeAvailable
  if(!choices.length&&activeCandidates.length===0)choices=[]
  if(!choices.length&&activeCandidates.every((row)=>io.readReservation(row.execution_key)))choices=candidates.filter((row)=>row.overflow&&!io.readReservation(row.execution_key))
  for(const candidate of choices){
    const record={...requestRecord(request,candidates),reviewer:candidate.name,wrapper:candidate.wrapper,execution_key:candidate.execution_key,overflow:candidate.overflow}
    const digest=sha256(canonicalJson(record)),ref=`${REVIEW_RESERVATION_PREFIX}/${candidate.execution_key}`
    if(io.createReservation(ref,digest,record))return {status:'assigned',...record,reservation_ref:ref,reservation_digest:digest}
  }
  return io.withMutex(()=>{
    const sequence=io.nextWaitSequence(),generation=1,record={...requestRecord(request,candidates),sequence,generation}
    const waitId=`${String(sequence).padStart(12,'0')}-${generation}-${request.issue}`,digest=sha256(canonicalJson(record)),ref=`${REVIEW_WAIT_PREFIX}/${waitId}`
    if(!io.createWait(ref,digest,record))throw new ReviewerAllocationError('review wait was created concurrently; reconcile before retry')
    return {status:'review-wait',wait_id:waitId,wait_ref:ref,wait_digest:digest,...record}
  })
}

export function wakeOldestCompatibleWait(freeExecutionKey,io){
  const waits=io.listWaits().filter((wait)=>!wait.terminal&&wait.record.eligible_execution_keys.includes(freeExecutionKey)).sort((a,b)=>a.record.sequence-b.record.sequence||a.record.generation-b.record.generation)
  for(const wait of waits){
    const live=io.liveReviewIdentity(wait.record.issue,wait.record.pr)
    if(!live||live.head_sha!==wait.record.head_sha||live.bundle_id!==wait.record.bundle_id){io.supersedeWait(wait,live);continue}
    if(!io.claimWait(wait))continue
    return io.assignClaimedWait(wait,freeExecutionKey)
  }
  return null
}
