export const CLAIM_STATES = Object.freeze(['protected', 'released'])
export const AUTHOR_LEASE_STATES = Object.freeze(['active', 'relinquished', 'expired-unconfirmed'])
export const ISSUE_FLOW_STATES = Object.freeze([
  'ready', 'authoring', 'ci', 'review-wait', 'review', 'preview-wait', 'preview',
  'merge', 'production', 'external-blocked', 'owner-decision', 'complete',
])
export const EVIDENCE_STATES = Object.freeze([
  'missing', 'current', 'stale-by-content', 'integration-refresh-required', 'unavailable',
])

export class BaselineSchemaError extends Error {}

const ISSUE_REQUIRED = Object.freeze([
  'issue', 'observed_start', 'observed_end', 'observed_wall_minutes',
  'active_effort_minutes', 'outcome', 'material_loops', 'blockers',
])

function assertIso(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new BaselineSchemaError(`${label} must be an ISO instant`)
  }
}

function assertExactKeys(value, required, optional, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BaselineSchemaError(`${label} must be an object`)
  }
  for (const key of required) if (!(key in value)) throw new BaselineSchemaError(`${label} is missing ${key}`)
  const known = new Set([...required, ...optional])
  for (const key of Object.keys(value)) if (!known.has(key)) throw new BaselineSchemaError(`${label} has unknown field ${key}`)
}

export function validateBaseline(input) {
  assertExactKeys(input,
    ['schema_version', 'source_task_id', 'observation_window', 'measurement_kind', 'state_model', 'issues', 'timeline', 'durable_proof_commands'],
    [], 'baseline')
  if (input.schema_version !== 1) throw new BaselineSchemaError('schema_version must be 1')
  if (typeof input.source_task_id !== 'string' || !input.source_task_id.trim()) throw new BaselineSchemaError('source_task_id is required')
  if (input.measurement_kind !== 'observed-wall-time') throw new BaselineSchemaError('measurement_kind must be observed-wall-time')

  assertExactKeys(input.observation_window, ['start', 'end', 'later_audit'], [], 'observation_window')
  for (const [key, value] of Object.entries(input.observation_window)) assertIso(value, `observation_window.${key}`)
  if (Date.parse(input.observation_window.start) > Date.parse(input.observation_window.end)) {
    throw new BaselineSchemaError('observation window starts after it ends')
  }

  assertExactKeys(input.state_model, ['claim', 'author_lease', 'issue_flow', 'evidence'], [], 'state_model')
  const expectedStates = { claim: CLAIM_STATES, author_lease: AUTHOR_LEASE_STATES, issue_flow: ISSUE_FLOW_STATES, evidence: EVIDENCE_STATES }
  for (const [name, expected] of Object.entries(expectedStates)) {
    if (JSON.stringify(input.state_model[name]) !== JSON.stringify(expected)) {
      throw new BaselineSchemaError(`state_model.${name} must match the independent Phase 2 vocabulary`)
    }
  }

  if (!Array.isArray(input.issues) || input.issues.length === 0) throw new BaselineSchemaError('issues must be a non-empty array')
  const issueIds = new Set()
  for (const issue of input.issues) {
    assertExactKeys(issue, ISSUE_REQUIRED, ['pr', 'workflow_runs', 'worker_events'], `issue ${issue.issue ?? '?'}`)
    if (!Number.isInteger(issue.issue) || issue.issue <= 0 || issueIds.has(issue.issue)) throw new BaselineSchemaError('issue IDs must be unique positive integers')
    issueIds.add(issue.issue)
    assertIso(issue.observed_start, `issue ${issue.issue} observed_start`)
    assertIso(issue.observed_end, `issue ${issue.issue} observed_end`)
    if (!Number.isFinite(issue.observed_wall_minutes) || issue.observed_wall_minutes < 0) throw new BaselineSchemaError(`issue ${issue.issue} has invalid observed_wall_minutes`)
    if (issue.active_effort_minutes !== 'unknown') throw new BaselineSchemaError(`issue ${issue.issue} active effort must remain unknown`)
    if (!Number.isInteger(issue.material_loops) || issue.material_loops < 0) throw new BaselineSchemaError(`issue ${issue.issue} has invalid material_loops`)
    if (!Array.isArray(issue.blockers)) throw new BaselineSchemaError(`issue ${issue.issue} blockers must be an array`)
  }

  if (!Array.isArray(input.timeline) || input.timeline.length === 0) throw new BaselineSchemaError('timeline must be a non-empty array')
  let previous = -Infinity
  for (const event of input.timeline) {
    assertExactKeys(event, ['timestamp', 'issue', 'event', 'measurement_kind'], ['pr', 'workflow_run'], 'timeline event')
    assertIso(event.timestamp, 'timeline timestamp')
    const timestamp = Date.parse(event.timestamp)
    if (timestamp < previous) throw new BaselineSchemaError('timeline events must be chronological')
    previous = timestamp
    if (!issueIds.has(event.issue)) throw new BaselineSchemaError(`timeline references unknown issue ${event.issue}`)
    if (event.measurement_kind !== 'private-source-observation') throw new BaselineSchemaError('timeline events must identify private-source observations')
  }

  if (!Array.isArray(input.durable_proof_commands) || input.durable_proof_commands.length === 0 || input.durable_proof_commands.some((command) => typeof command !== 'string' || !command.trim())) {
    throw new BaselineSchemaError('durable_proof_commands must be a non-empty string array')
  }
  return input
}

export function summarizeBaseline(input) {
  const baseline = validateBaseline(input)
  const workersObserved = baseline.issues.filter((issue) => (issue.worker_events ?? 0) > 0).length
  return {
    issues: baseline.issues.length,
    workersObserved,
    materialLoops: baseline.issues.reduce((total, issue) => total + issue.material_loops, 0),
    activeEffortMinutes: 'unknown',
  }
}
