import { createHash } from 'node:crypto'
import { dispatchObjectKeys, inventoryDdlVerbs } from '../check-pr-object-collisions.mjs'

export class AdmissionError extends Error {
  constructor(message, result = null) {
    super(message)
    this.result = result
  }
}

export const SERVICE_CLASSES = Object.freeze(['urgent-application', 'standard-application', 'maintenance'])
export const STRUCTURAL_CHANGE_TYPES = Object.freeze([
  'schema', 'table', 'column', 'type', 'view', 'function', 'trigger',
  'rls-policy', 'grant', 'index', 'constraint', 'extension', 'publication',
  'storage-policy', 'migration', 'curated-master-data-structure',
])
export const NON_STRUCTURAL_CHANGE_TYPES = Object.freeze([
  'database-read', 'application-row', 'application-code', 'documentation',
  'ci', 'reviewer-tooling', 'workflow', 'repo-maintenance', 'source-data',
  'security-settings',
])
export const CHANGE_TYPES = Object.freeze([...STRUCTURAL_CHANGE_TYPES, ...NON_STRUCTURAL_CHANGE_TYPES])
export const URGENT_IMPACT_KINDS = Object.freeze([
  'live-outage', 'blocked-release', 'security-exposure', 'owner-deadline',
])
export const IMPACT_FENCE = 'db-impact'

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const EVIDENCE = /^(?:https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull|actions\/runs)\/\d+(?:#\S+)?|artifact:[A-Za-z0-9_.:/-]+|owner-current-chat:\S+)$/

export function parseImpactBlock(body = '') {
  const fences = [...String(body).matchAll(new RegExp('```' + IMPACT_FENCE + '\\s*\\n([\\s\\S]*?)```', 'g'))]
  if (!fences.length) return null
  if (fences.length !== 1) throw new AdmissionError('exactly one db-impact block is allowed')
  let value
  try { value = JSON.parse(fences[0][1]) } catch { throw new AdmissionError('db-impact block is not valid JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdmissionError('db-impact must be a JSON object')
  const known = new Set(['kind', 'environment', 'evidence'])
  for (const key of Object.keys(value)) if (!known.has(key)) throw new AdmissionError(`db-impact has unknown field ${key}`)
  if (!URGENT_IMPACT_KINDS.includes(value.kind)) throw new AdmissionError(`db-impact kind must be one of ${URGENT_IMPACT_KINDS.join(', ')}`)
  if (typeof value.environment !== 'string' || !value.environment.trim()) throw new AdmissionError('db-impact must name the affected environment')
  if (typeof value.evidence !== 'string' || !EVIDENCE.test(value.evidence)) throw new AdmissionError('db-impact must carry a durable GitHub, artifact, or current-chat evidence reference')
  return { kind: value.kind, environment: value.environment.trim(), evidence: value.evidence }
}

export function admissionDigest({ issue, scope, impact }) {
  const material = JSON.stringify({
    issue: Number(issue.number), status: scope.status, work_type: scope.workType,
    route: scope.route, change_type: scope.changeType, service_class: scope.serviceClass,
    writes: scope.writes, reads: scope.reads, application_return_to: scope.applicationReturnTo,
    live_assertion: scope.liveAssertion, generated_types: scope.generatedTypes, impact,
  })
  return createHash('sha256').update(material).digest('hex')
}

function refusal(issue, scope, reason, evidenceRequired) {
  return {
    admitted: false,
    issue: Number(issue.number),
    event_type: 'rejected_non_structural',
    return_to: scope?.returnTo ?? scope?.applicationReturnTo ?? 'u2giants/shared-db',
    evidence_required: evidenceRequired,
    reason,
  }
}

export function evaluateAdmission(issue, scope, impact = null) {
  if (!issue || !Number.isInteger(Number(issue.number))) throw new AdmissionError('admission requires a readable work issue')
  if (String(issue.state ?? 'open').toLowerCase() !== 'open') throw new AdmissionError(`issue #${issue.number} is not open`)
  if (!scope) throw new AdmissionError(`issue #${issue.number} has no db-work-scope block`)
  if (!CHANGE_TYPES.includes(scope.changeType)) {
    throw new AdmissionError(`issue #${issue.number} must declare change_type as one of ${CHANGE_TYPES.join(', ')}`)
  }
  if (!SERVICE_CLASSES.includes(scope.serviceClass)) {
    throw new AdmissionError(`issue #${issue.number} must declare service_class as one of ${SERVICE_CLASSES.join(', ')}`)
  }

  const actualStructural = STRUCTURAL_CHANGE_TYPES.includes(scope.changeType)
  if (!actualStructural) {
    const result = refusal(issue, scope, `actual change_type ${scope.changeType} does not change database structure`, [
      'a concrete structural change_type', 'at least one exact database object write',
    ])
    throw new AdmissionError(result.reason, result)
  }
  if (scope.workType !== 'structural' || scope.route !== 'shared-db-orchestrator') {
    const result = refusal(issue, scope, `actual structural change is misrouted as ${scope.workType}/${scope.route}`, [
      'work_type structural', 'route shared-db-orchestrator',
    ])
    throw new AdmissionError(result.reason, result)
  }
  if (scope.status !== 'ready') throw new AdmissionError(`issue #${issue.number} is ${scope.status}, not ready`)
  if (!scope.writes?.length) throw new AdmissionError(`issue #${issue.number} names no exact database object write`)
  if (!REPOSITORY.test(scope.applicationReturnTo ?? '')) throw new AdmissionError('structural admission requires application_return_to as an owner/repo slug')
  if (typeof scope.liveAssertion !== 'string' || !scope.liveAssertion.trim()) throw new AdmissionError('structural admission requires a concrete live_assertion')
  if (!['required', 'not-applicable'].includes(scope.generatedTypes)) throw new AdmissionError('structural admission requires generated_types: required or not-applicable')
  if (scope.serviceClass === 'urgent-application' && !impact) throw new AdmissionError('urgent-application admission requires a db-impact block')
  if (scope.serviceClass !== 'urgent-application' && impact) throw new AdmissionError('db-impact is reserved for urgent-application work')

  return {
    admitted: true,
    issue: Number(issue.number),
    service_class: scope.serviceClass,
    change_type: scope.changeType,
    application_return_to: scope.applicationReturnTo,
    live_assertion: scope.liveAssertion,
    generated_types: scope.generatedTypes,
    writes: [...scope.writes],
    reads: [...(scope.reads ?? [])],
    impact,
    digest: admissionDigest({ issue, scope, impact }),
  }
}

export function inspectPrStructuralChange(prFiles = []) {
  if (!Array.isArray(prFiles)) throw new AdmissionError('pull request files are unreadable')
  const migrations = prFiles.filter((file) => /^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(String(file?.filename ?? file?.path ?? '')) && file?.status !== 'removed')
  if (!migrations.length) {
    throw new AdmissionError('the pull request contains no added or modified migration, so its actual change is not structural')
  }
  const proposedSql=migrations.map((file)=>{
    const name=file.filename??file.path
    if(file.status==='added'){
      if(typeof file.content!=='string')throw new AdmissionError(`migration ${name} content is unreadable; structural admission refuses filename-only evidence`)
      return file.content
    }
    if(file.truncated===true)throw new AdmissionError(`migration ${name} patch is truncated; structural admission refuses an incomplete diff`)
    if(typeof file.patch!=='string')throw new AdmissionError(`migration ${name} patch is unreadable; structural admission refuses full-file evidence for a modified migration`)
    return file.patch.split(/\r?\n/).filter((line)=>line.startsWith('+')&&!line.startsWith('+++')).map((line)=>line.slice(1)).join('\n')
  })
  const ddl=inventoryDdlVerbs(proposedSql)
  if(!ddl.length)throw new AdmissionError('the pull request migration files contain no statement-leading schema DDL, so the actual change is not structural')
  const ambiguous=ddl.filter((row)=>!row.acknowledged)
  if(ambiguous.length)throw new AdmissionError(`the pull request contains unmodelled DDL (${ambiguous.map((row)=>row.verb).join(', ')}); structural admission fails closed`)
  return {
    migrations:migrations.map((file) => file.filename ?? file.path),
    objects:[...new Set(proposedSql.flatMap((sql)=>dispatchObjectKeys(sql)))].sort(),
  }
}

export function assertPrCarriesStructuralChange(prFiles = []) { return inspectPrStructuralChange(prFiles).migrations }
