export const WAIT_CLASSES=Object.freeze(['claim_protected_minutes','active_author_minutes','external_blocked_minutes','reviewer_allocation_wait_minutes','review_execution_wait_minutes','preview_dependency_wait_minutes'])
export function buildThroughputReport(records,{minimumSample=20}={}){
  const observed=(records??[]).filter((row)=>row.estimate===false)
  const comparable=observed.filter((row)=>row.completed===true&&Number.isFinite(row.material_loops))
  const safety=observed.filter((row)=>row.object_claim_collision||row.weakened_gate)
  const values=(key)=>comparable.map((row)=>row[key]).filter(Number.isFinite)
  const median=(rows)=>{if(!rows.length)return null;const sorted=[...rows].sort((a,b)=>a-b),m=Math.floor(sorted.length/2);return sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2}
  const allocation=values('reviewer_allocation_wait_minutes').sort((a,b)=>a-b)
  const p90=allocation.length?allocation[Math.ceil(allocation.length*.9)-1]:null
  const metrics={n:comparable.length,median_material_loops:median(values('material_loops')),p90_reviewer_allocation_minutes:p90,safety_regressions:safety.length,wait_samples:Object.fromEntries(WAIT_CLASSES.map((key)=>[key,values(key).length]))}
  const eligible=comparable.length>=minimumSample
  const success=eligible&&safety.length===0&&comparable.every((row)=>!row.known_preview_dependency_red_run&&!row.integration_only_review_replay&&row.blocked_capacity_consumed!==true)
  return {status:!eligible?'INSUFFICIENT_SAMPLE':success?'SUCCESS':'REGRESSION',...metrics,success}
}
