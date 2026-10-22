import test from 'node:test';import assert from 'node:assert/strict';import {buildThroughputReport} from './throughput-report.mjs'
const rows=Array.from({length:20},(_,i)=>({estimate:false,completed:true,material_loops:i%2,reviewer_allocation_wait_minutes:1,claim_protected_minutes:10,active_author_minutes:5,external_blocked_minutes:5,review_execution_wait_minutes:3,preview_dependency_wait_minutes:0}))
test('success requires twenty observed comparable issues and prints n',()=>{assert.deepEqual(buildThroughputReport(rows).status,'SUCCESS');assert.equal(buildThroughputReport(rows).n,20);assert.equal(buildThroughputReport(rows.slice(0,19)).status,'INSUFFICIENT_SAMPLE')})
test('estimated and unknown data are excluded',()=>{const result=buildThroughputReport([...rows.slice(0,19),{...rows[0],estimate:true}]);assert.equal(result.n,19);assert.equal(result.wait_samples.claim_protected_minutes,19)})
test('one safety regression refuses a success verdict',()=>{const result=buildThroughputReport(rows.map((r,i)=>i? r:{...r,weakened_gate:true}));assert.equal(result.status,'REGRESSION');assert.equal(result.success,false)})

test('throughput_insufficient_sample_never_claims_improvement', async () => {
  const report = await strict(strictRows().slice(1))
  assert.equal(report.status, 'INSUFFICIENT_SAMPLE')
  assert.equal(report.aggregates[0].before.n, 19)
  assert.equal(report.aggregates[0].measured_latency_improvement, null)
})

const strictOptions = { before: {start:'2026-08-01T00:00:00Z',end:'2026-08-15T00:00:00Z',evidence:'before-census'}, after: {start:'2026-08-15T00:00:00Z',end:'2026-08-29T00:00:00Z',evidence:'after-census'}, now:'2026-09-20T00:00:00Z' }
const strictRows = () => ['before','after'].flatMap(period => Array.from({length:20}, (_,i) => ({ outcome_id:`${period}-${i}`,change_class:'additive',estimate:false,completed:true, stages:{ready_at: period === 'before' ? '2026-08-02T00:00:00Z':'2026-08-16T00:00:00Z',live_verified_at:period === 'before' ? '2026-08-02T02:00:00Z':'2026-08-16T01:00:00Z'},stage_evidence:{ready_at:'ready-source',live_verified_at:'live-source'},safety_regression:false,safety_evidence:'safety-audit' })))
const strict = async (rows = strictRows(), options = strictOptions) => (await import('./throughput-report.mjs')).buildWorkflowRefactorReport(rows,options)
test('strict per-class windows measure latency without causal claims', async () => {
  const report = await strict()
  assert.equal(report.status,'MEASURED')
  assert.equal(report.aggregates[0].measured_latency_improvement,true)
  assert.equal(report.aggregates[0].before.median_ready_to_live_minutes,120)
  assert.equal(report.aggregates[0].after.p90_ready_to_live_minutes,60)
  assert.equal(report.causal_improvement_claim,false)
  assert.equal(report.aggregates[0].before.waits.claim_protected_minutes.median_minutes,null)
})
test('strict missing timestamps and bot updates cannot create a live outcome', async () => {
  const rows = strictRows(); delete rows[0].stages.live_verified_at; rows[0].updatedAt='2026-08-02T02:00:00Z'
  const report = await strict(rows)
  assert.equal(report.status,'INSUFFICIENT_SAMPLE')
  assert.equal(report.aggregates[0].measured_latency_improvement,null)
  assert.equal(report.aggregates[0].before.median_ready_to_live_minutes,null)
  assert.ok(report.excluded[0].reasons.includes('missing_live_verified_at'))
})
test('strict duplicate outcomes exclude every copy including cross-period replay', async () => {
  const rows = strictRows(); rows[20].outcome_id=rows[0].outcome_id
  const report = await strict(rows)
  assert.equal(report.excluded.length,2)
  assert.equal(report.aggregates[0].before.n,19)
  assert.equal(report.aggregates[0].after.n,19)
  assert.equal(report.aggregates[0].measured_latency_improvement,null)
})
test('strict malformed and reversed stages refuse instead of normalizing', async () => {
  for (const bad of ['2026-02-30T00:00:00Z','yesterday','2026-08-01T00:00:00Z',42]) {
    const rows=strictRows(); rows[0].stages.live_verified_at=bad
    assert.equal((await strict(rows)).status,'INSUFFICIENT_SAMPLE')
  }
})
test('strict short overlapping future or unproven windows never imply improvement', async () => {
  for (const after of [ {...strictOptions.after,end:'2026-08-28T00:00:00Z'}, {...strictOptions.after,start:'2026-08-14T00:00:00Z'}, {...strictOptions.after,end:'2026-10-01T00:00:00Z'}, {...strictOptions.after,evidence:''} ]) {
    const report = await strict(strictRows(),{...strictOptions,after})
    assert.equal(report.status,'INSUFFICIENT_SAMPLE')
    assert.equal(report.aggregates[0].measured_latency_improvement,null)
  }
})
test('strict classes cannot borrow samples and missing safety stays unknown', async () => {
  const rows=strictRows(); rows[0].change_class='destructive'; delete rows[21].safety_regression
  const report=await strict(rows)
  assert.equal(report.status,'INSUFFICIENT_SAMPLE')
  assert.equal(report.aggregates[0].after.safety_regressions,null)
  assert.ok(report.aggregates.every(a=>a.measured_latency_improvement===null))
})
test('strict known regressions remain visible below sample threshold', async () => {
  const rows=strictRows().slice(0,1); rows[0].safety_regression=true
  const report=await strict(rows)
  assert.equal(report.status,'REGRESSION')
  assert.equal(report.aggregates[0].measured_latency_improvement,null)
})
test('strict optional stage evidence and wait values are validated', async () => {
  const rows=strictRows(); rows[0].stages.applied_at='2026-08-02T03:00:00Z'; rows[1].review_execution_wait_minutes=-1
  const report=await strict(rows)
  assert.equal(report.excluded.length,2)
  assert.equal(report.status,'INSUFFICIENT_SAMPLE')
})
test('strict unknown input and absent windows are insufficient', async () => {
  assert.equal((await strict(null,{})).status,'INSUFFICIENT_SAMPLE')
  assert.equal((await strict([],strictOptions)).status,'INSUFFICIENT_SAMPLE')
})

test('strict excluded observations do not hide known safety regressions', async () => {
  const rows = strictRows(); rows[0].safety_regression = true; delete rows[0].stages.ready_at
  const report = await strict(rows)
  assert.equal(report.status, 'REGRESSION')
  assert.equal(report.known_safety_regressions, 1)
})

test('strict optional stages obey transitive ordering across missing intermediates', async () => {
  for (const key of ['created_at','review_started_at','review_completed_at','rehearsal_at','merged_at','applied_at']) {
    const rows = strictRows()
    rows[0].stages[key] = '2026-09-01T00:00:00Z'
    rows[0].stage_evidence[key] = 'stage-source'
    const report = await strict(rows)
    assert.equal(report.status, 'INSUFFICIENT_SAMPLE', key)
    assert.equal(report.aggregates[0].measured_latency_improvement, null, key)
    assert.ok(report.excluded[0].reasons.some(reason => reason.startsWith('reversed_')), key)
  }
})

test('strict rehearsal may precede or follow merge while remaining before live verification', async () => {
  for (const rehearsal of ['2026-08-02T00:30:00Z','2026-08-02T01:30:00Z']) {
    const rows = strictRows()
    rows[0].stages.merged_at = '2026-08-02T01:00:00Z'
    rows[0].stages.rehearsal_at = rehearsal
    rows[0].stage_evidence.merged_at = rows[0].stage_evidence.rehearsal_at = 'stage-source'
    assert.equal((await strict(rows)).status, 'MEASURED')
  }
})
