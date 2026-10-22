// Phase timing for reviewer-assignment holds (issue #4414 / plan_reviewer_assignment_hold_reduction).
// Local public-safe metadata only: no tokens, no child output, no issue bodies, no extra remote reads.
// Buffer phase records in memory during ownership; flush only after release or a recovery-required decision.

export const PHASE_TRACE_SCHEMA_VERSION = 1

/**
 * Create a phase tracer for one reviewer/coordination operation.
 * Inject clock and sink for tests. Default clock is performance.now (monotonic).
 */
export function createPhaseTrace({
  operation,
  sourceTuple: initialSourceTuple = null,
  invocation: initialInvocation = null,
  now = () => performance.now(),
  wallClock = () => new Date(),
  sink = null,
  maxPhases = 64,
} = {}) {
  let sourceTuple = initialSourceTuple && typeof initialSourceTuple === 'object' ? { ...initialSourceTuple } : null
  let invocation = initialInvocation == null ? null : String(initialInvocation)
  const phases = []
  const startedWall = wallClock()
  let open = null
  let flushed = false
  let releaseState = 'not_acquired'
  let foreignMutexOwner = null

  function startPhase(name, meta = null) {
    if (open) endPhase(open.name, { interrupted: true })
    open = { name, startMs: now(), meta: meta && typeof meta === 'object' ? { ...meta } : null }
    return open
  }

  function endPhase(name, extra = null) {
    if (!open || (name && open.name !== name)) {
      // End whatever is open if the caller named a different phase or none.
      if (!open) return null
    }
    const endMs = now()
    const durationMs = Math.max(0, endMs - open.startMs)
    const row = {
      phase: open.name,
      durationMs,
      startMs: open.startMs,
      endMs,
      meta: open.meta,
      ...(extra && typeof extra === 'object' ? extra : {}),
    }
    if (phases.length < maxPhases) phases.push(row)
    open = null
    return row
  }

  function mark(meta) {
    if (!open) return
    open.meta = { ...(open.meta ?? {}), ...(meta && typeof meta === 'object' ? meta : {}) }
  }

  function setReleaseState(state) {
    const allowed = new Set(['not_acquired', 'proved_released', 'unknown', 'successor_seen'])
    if (!allowed.has(state)) throw new Error(`invalid release state: ${state}`)
    releaseState = state
  }

  function noteForeignMutexOwner(observed) {
    if (!observed || typeof observed !== 'object') return
    foreignMutexOwner = {
      ...foreignMutexOwner,
      ...observed,
    }
  }

  function record() {
    if (open) endPhase(null)
    const endedWall = wallClock()
    return {
      schema: PHASE_TRACE_SCHEMA_VERSION,
      operation: String(operation ?? 'unknown'),
      sourceTuple: sourceTuple && typeof sourceTuple === 'object' ? { ...sourceTuple } : null,
      invocation: invocation == null ? null : String(invocation),
      startedAt: startedWall.toISOString(),
      endedAt: endedWall.toISOString(),
      phases: phases.slice(),
      releaseState,
      foreignMutexOwner,
      totalHeldMs: phases
        // Owned hold time starts after acquisition succeeds. `acquisition_wait`
        // is queue/wait-to-acquire and is deliberately NOT hold time (issue #4414).
        .filter((row) => row.phase === 'fresh_validation' || row.phase === 'ref_commit_readback' || row.phase === 'release')
        .reduce((sum, row) => sum + row.durationMs, 0),
      totalWaitMs: phases
        .filter((row) => row.phase === 'acquisition_wait')
        .reduce((sum, row) => sum + row.durationMs, 0),
    }
  }

  /**
   * Flush after ownership ends. Never throws into the critical path:
   * lost telemetry must not invent release or retry a mutation.
   */
  function flush() {
    if (flushed) return record()
    flushed = true
    const payload = record()
    if (typeof sink === 'function') {
      try { sink(payload) } catch { /* lost telemetry is not a mutation failure */ }
    }
    return payload
  }

  function setSourceTuple(tuple) {
    sourceTuple = tuple && typeof tuple === 'object' ? { ...tuple } : null
  }

  function setInvocation(value) {
    invocation = value == null ? null : String(value)
  }

  return {
    startPhase,
    endPhase,
    mark,
    setReleaseState,
    noteForeignMutexOwner,
    setSourceTuple,
    setInvocation,
    record,
    flush,
    get releaseState() { return releaseState },
    get phaseCount() { return phases.length },
  }
}

/**
 * Run `fn` inside a named phase on `trace`. If `trace` is null, just run `fn`.
 */
export function withPhase(trace, name, fn, meta = null) {
  if (!trace) return fn()
  trace.startPhase(name, meta)
  try {
    const result = fn()
    trace.endPhase(name)
    return result
  } catch (error) {
    trace.endPhase(name, { result: 'error' })
    throw error
  }
}

/**
 * Public-safe summary for stderr / private operation log after release.
 * Wall time in public reports uses EDT/EST labels at the call site.
 */
export function formatPhaseTraceSummary(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const parts = [
    `schema=${payload.schema}`,
    `op=${payload.operation}`,
    `release=${payload.releaseState}`,
    `phases=${Array.isArray(payload.phases) ? payload.phases.length : 0}`,
  ]
  if (payload.sourceTuple?.issue != null) parts.push(`issue=${payload.sourceTuple.issue}`)
  if (payload.sourceTuple?.pr != null) parts.push(`pr=${payload.sourceTuple.pr}`)
  if (payload.sourceTuple?.headSha) parts.push(`head=${String(payload.sourceTuple.headSha).slice(0, 12)}`)
  if (payload.foreignMutexOwner?.sha) parts.push(`foreign_mutex=${String(payload.foreignMutexOwner.sha).slice(0, 12)}`)
  const held = Number(payload.totalHeldMs)
  if (Number.isFinite(held)) parts.push(`held_ms=${Math.round(held)}`)
  for (const row of payload.phases ?? []) {
    if (row?.phase && Number.isFinite(row.durationMs)) parts.push(`${row.phase}=${Math.round(row.durationMs)}ms`)
  }
  return parts.join(' ')
}
