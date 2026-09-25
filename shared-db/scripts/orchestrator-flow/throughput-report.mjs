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

// This reporting-only API deliberately does not reinterpret the legacy report's
// SUCCESS as acceptance of the workflow-refactor programme or as proof of causality.
const DAY = 86_400_000
const STAGES = ['created_at', 'ready_at', 'review_started_at', 'review_completed_at', 'rehearsal_at', 'merged_at', 'applied_at', 'live_verified_at', 'completed_at', 'closed_at']
// Compare every available pair along each causal chain, even if an intermediate
// stage is absent. Rehearsal can precede or follow merge (the supported routes
// differ), but cannot occur after the live result it qualifies.
const CHAINS = [
  ['created_at','ready_at','review_started_at','review_completed_at','merged_at','applied_at','live_verified_at','completed_at','closed_at'],
  ['created_at','ready_at','rehearsal_at','live_verified_at','completed_at','closed_at'],
]
const ORDER = CHAINS.flatMap(chain => chain.flatMap((a,i) => chain.slice(i+1).map(b => [a,b])))
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z') ? Date.parse(value) : null
const reference = value => typeof value === 'string' && value.trim().length > 0
const quantile = (values, percentile) => {
  if (!values.length) return null
  const sorted = [...values].sort((a,b) => a-b)
  if (percentile === .5 && sorted.length % 2 === 0) return (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2
  return sorted[Math.ceil(sorted.length*percentile)-1]
}

/**
 * Strict Step 14 coverage. Windows need observed start/end and a source reference.
 * Outcomes need unique outcome_id, change_class, estimate:false, completed:true,
 * stages.ready_at/live_verified_at and matching stage_evidence references. Other
 * stage timestamps remain optional and are never inferred from GitHub updatedAt.
 * Source references locate evidence; this pure report does not authenticate it.
 */
export function buildWorkflowRefactorReport(records, { before, after, now = new Date().toISOString() } = {}) {
  const nowMs = timestamp(now)
  const window = value => {
    const start = timestamp(value?.start), end = timestamp(value?.end)
    const valid = start !== null && end !== null && start < end && nowMs !== null && end <= nowMs && reference(value?.evidence)
    return { valid, start, end, observed_days: valid ? (end-start)/DAY : null }
  }
  const windows = { before: window(before), after: window(after) }
  const validWindows = windows.before.valid && windows.after.valid && windows.before.end <= windows.after.start
  const sufficientWindows = validWindows && Object.values(windows).every(w => w.observed_days >= 14)
  const input = Array.isArray(records) ? records : []
  // Safety observations survive exclusion from latency calculations. This count
  // is of reports, not a deduplicated defect rate or proof of zero regressions.
  const knownSafetyRegressions = input.filter(row => row?.estimate === false && row?.safety_regression === true).length
  const ids = new Map()
  for (const row of input) if (reference(row?.outcome_id)) ids.set(row.outcome_id.trim(), (ids.get(row.outcome_id.trim()) ?? 0)+1)
  const excluded = [], accepted = [], classes = new Set()
  for (const row of input) {
    const reasons = []
    const id = reference(row?.outcome_id) ? row.outcome_id.trim() : null
    const cls = reference(row?.change_class) ? row.change_class.trim() : null
    if (cls) classes.add(cls)
    if (!id || !cls) reasons.push('missing_outcome_identity_or_class')
    if (id && ids.get(id) !== 1) reasons.push('duplicate_outcome')
    if (row?.estimate !== false || row?.completed !== true) reasons.push('not_observed_completed_outcome')
    const stages = {}, stage = row?.stages ?? {}
    for (const key of STAGES) {
      stages[key] = timestamp(stage[key])
      if (stage[key] != null && stages[key] === null) reasons.push(`malformed_${key}`)
      if (stages[key] !== null && (!reference(row?.stage_evidence?.[key]) || nowMs === null || stages[key] > nowMs)) reasons.push(`unproven_${key}`)
    }
    for (const key of ['ready_at','live_verified_at']) if (stages[key] === null) reasons.push(`missing_${key}`)
    for (const [a,b] of ORDER) if (stages[a] !== null && stages[b] !== null && stages[a] > stages[b]) reasons.push(`reversed_${a}_${b}`)
    for (const key of WAIT_CLASSES) if (row?.[key] != null && (!Number.isFinite(row[key]) || row[key] < 0)) reasons.push(`malformed_${key}`)
    if (row?.safety_regression != null && typeof row.safety_regression !== 'boolean') reasons.push('malformed_safety_regression')
    const period = validWindows ? Object.keys(windows).find(key => stages.ready_at >= windows[key].start && stages.live_verified_at < windows[key].end && stages.ready_at !== null && stages.live_verified_at !== null) : null
    if (!period) reasons.push('outside_valid_observation_windows')
    if (reasons.length) excluded.push({ outcome_id: id, reasons })
    else accepted.push({ ...row, change_class: cls, stages, period })
  }
  const aggregates = [...classes].sort().map(change_class => {
    const periods = Object.fromEntries(['before','after'].map(period => {
      const rows = accepted.filter(row => row.change_class === change_class && row.period === period)
      const latencies = rows.map(row => (row.stages.live_verified_at-row.stages.ready_at)/60_000)
      const stage_samples = Object.fromEntries(STAGES.map(key => [key, rows.filter(row => row.stages[key] !== null).length]))
      const waits = Object.fromEntries(WAIT_CLASSES.map(key => {
        const values = rows.map(row => row[key]).filter(Number.isFinite)
        return [key, { n: values.length, median_minutes: values.length >= 20 ? quantile(values,.5) : null, p90_minutes: values.length >= 20 ? quantile(values,.9) : null }]
      }))
      const regressions = rows.filter(row => row.safety_regression === true).length
      const safetySamples = rows.filter(row => typeof row.safety_regression === 'boolean' && reference(row.safety_evidence)).length
      return [period, { n: rows.length, median_ready_to_live_minutes: rows.length >= 20 ? quantile(latencies,.5) : null, p90_ready_to_live_minutes: rows.length >= 20 ? quantile(latencies,.9) : null, stage_samples, waits, safety_samples: safetySamples, safety_regressions: regressions || (safetySamples === rows.length && rows.length ? 0 : null) }]
    }))
    const eligible = sufficientWindows && Object.values(periods).every(p => p.n >= 20 && p.safety_samples === p.n)
    const regression = Object.values(periods).some(p => p.safety_regressions > 0)
    const improved = eligible && !regression && !knownSafetyRegressions ? periods.after.median_ready_to_live_minutes < periods.before.median_ready_to_live_minutes && periods.after.p90_ready_to_live_minutes <= periods.before.p90_ready_to_live_minutes : null
    return { change_class, status: regression ? 'REGRESSION' : eligible ? 'MEASURED' : 'INSUFFICIENT_SAMPLE', ...periods, measured_latency_improvement: improved }
  })
  return { status: knownSafetyRegressions || aggregates.some(a => a.status === 'REGRESSION') ? 'REGRESSION' : aggregates.length && aggregates.every(a => a.status === 'MEASURED') ? 'MEASURED' : 'INSUFFICIENT_SAMPLE', minimum_sample: 20, minimum_window_days: 14, windows, excluded, aggregates, known_safety_regressions: knownSafetyRegressions || null, causal_improvement_claim: false }
}
