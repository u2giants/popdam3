import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPhaseTrace,
  withPhase,
  formatPhaseTraceSummary,
  PHASE_TRACE_SCHEMA_VERSION,
} from './phase-trace.mjs'

test('phase trace records monotonic durations and release state', () => {
  let t = 0
  const trace = createPhaseTrace({
    operation: 'assign-next-reviewer',
    sourceTuple: { issue: 4414, pr: 4419, headSha: 'a'.repeat(40) },
    invocation: 'test-1',
    now: () => t,
    wallClock: () => new Date('2026-10-18T16:00:00Z'),
    sink: null,
  })
  trace.startPhase('prepare')
  t += 12
  trace.endPhase('prepare')
  trace.startPhase('acquisition_wait')
  t += 3
  trace.endPhase('acquisition_wait')
  trace.startPhase('fresh_validation')
  t += 40
  trace.endPhase('fresh_validation')
  trace.startPhase('ref_commit_readback')
  t += 25
  trace.endPhase('ref_commit_readback')
  trace.startPhase('release')
  t += 8
  trace.endPhase('release')
  trace.setReleaseState('proved_released')
  const payload = trace.flush()
  assert.equal(payload.schema, PHASE_TRACE_SCHEMA_VERSION)
  assert.equal(payload.operation, 'assign-next-reviewer')
  assert.equal(payload.releaseState, 'proved_released')
  assert.equal(payload.phases.length, 5)
  assert.equal(payload.phases[0].durationMs, 12)
  assert.equal(payload.phases[1].durationMs, 3)
  // held = fresh_validation + ref_commit_readback + release (NOT acquisition_wait)
  assert.equal(payload.totalHeldMs, 40 + 25 + 8)
  assert.equal(payload.totalWaitMs, 3)
  assert.equal(payload.sourceTuple.issue, 4414)
})

test('unknown_release_is_not_zero_duration', () => {
  let t = 100
  const trace = createPhaseTrace({
    operation: 'assign-next-reviewer',
    now: () => t,
    wallClock: () => new Date('2026-10-18T16:00:00Z'),
  })
  trace.startPhase('acquisition_wait')
  t += 50
  // never endPhase, never prove release
  const payload = trace.flush()
  assert.equal(payload.releaseState, 'not_acquired')
  // open phase is closed on record; duration is the observed span, not zero
  assert.ok(payload.phases.some((row) => row.phase === 'acquisition_wait' && row.durationMs === 50))
  const summary = formatPhaseTraceSummary(payload)
  assert.match(summary, /release=not_acquired/)
  assert.match(summary, /acquisition_wait=50ms/)
})

test('trace_preserves_stdout_contract and secret-safe summary', () => {
  let t = 0
  const sinkPayloads = []
  const trace = createPhaseTrace({
    operation: 'assign-next-reviewer',
    now: () => (t += 1),
    wallClock: () => new Date('2026-10-18T16:00:00Z'),
    sink: (payload) => sinkPayloads.push(payload),
  })
  withPhase(trace, 'prepare', () => 'ok')
  trace.noteForeignMutexOwner({ sha: 'f'.repeat(40), ref: 'refs/db-coordination/author-acquisition' })
  trace.setReleaseState('successor_seen')
  const summary = formatPhaseTraceSummary(trace.flush())
  assert.equal(sinkPayloads.length, 1)
  assert.ok(!/token|password|secret|Bearer/i.test(summary))
  assert.match(summary, /foreign_mutex=ffffffffffff/)
  assert.match(summary, /release=successor_seen/)
  // summary is a single line, not JSON dumped to stdout
  assert.ok(!summary.includes('{'))
})

test('trace_output_never_blocks_owned_section — sink failure is swallowed', () => {
  const trace = createPhaseTrace({
    operation: 'assign-next-reviewer',
    now: () => 0,
    wallClock: () => new Date('2026-10-18T16:00:00Z'),
    sink: () => { throw new Error('stderr pipe blocked') },
  })
  trace.startPhase('release')
  trace.endPhase('release')
  assert.doesNotThrow(() => trace.flush())
})

test('withPhase marks error result and rethrows', () => {
  let t = 0
  const trace = createPhaseTrace({
    operation: 'x',
    now: () => t,
    wallClock: () => new Date('2026-10-18T16:00:00Z'),
  })
  assert.throws(() => withPhase(trace, 'fresh_validation', () => {
    t += 5
    throw new Error('boom')
  }), /boom/)
  const payload = trace.record()
  assert.equal(payload.phases.at(-1).result, 'error')
  assert.equal(payload.phases.at(-1).durationMs, 5)
})

test('phase_trace_has_no_extra_github_reads — tracer never calls io', () => {
  // Structural guarantee: createPhaseTrace closes over no io object.
  // A misuse that passed io would be a signature error; this asserts the API surface.
  const trace = createPhaseTrace({ operation: 'x', now: () => 0, wallClock: () => new Date() })
  assert.equal(typeof trace.startPhase, 'function')
  assert.equal(typeof trace.flush, 'function')
  assert.equal(trace.phaseCount, 0)
  // No method accepts or stores a GitHub reader
  assert.equal('io' in trace, false)
})
