import { createHash } from 'node:crypto'
import { currentRepository } from '../lib/repository-identity.mjs'
import { CuratedSqlError, inspectCuratedSql, pgCronWrites } from './curated-admission.mjs'
import { canonicalIdentifier, dispatchObjectKeys, roleReadKeys, extractOperations, inventoryDdlVerbs } from '../check-pr-object-collisions.mjs'

export class AdmissionError extends Error {
  constructor(message, result = null) {
    super(message)
    this.result = result
  }
}

export const SERVICE_CLASSES = Object.freeze(['urgent-application', 'standard-application', 'maintenance'])
// The two ROUTES a structural change may be admitted under (issue #3199 Phase
// B2). `claim-first` is the full triage path; `self-service-additive`
// admits the same structural work WITHOUT coordinator triage when the merge-time
// boundary classifier (scripts/check-self-service-additive-lane.mjs) holds —
// additive objects confined to the app-owned {crm,pim,dam,plm} schemas. Every other
// gate (claim, object locks, version reservation, reviewers, serial lanes,
// guarded merge) is unchanged for both routes.
// `claim-first` is the canonical structural route since the coordinator role was
// retired (owner ruling 2026-10-02, AGENTS.md §0.0-D, issue #3874).
// `shared-db-orchestrator` stays accepted as a legacy alias for existing issues (retired role name kept only for parse compatibility).
export const STRUCTURAL_ROUTES = Object.freeze(['claim-first', 'shared-db-orchestrator', 'self-service-additive'])
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
    return_to: scope?.returnTo ?? scope?.applicationReturnTo ?? currentRepository(),
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

  // Curated Master Data fork that ships a migration (AGENTS.md §6.4 and
  // docs/agents/section-4-anti-collision-rules.md): it must claim a lane, so it
  // must also be admissible, but it is NOT structural work. It declares no
  // database objects (parseQueueScope forbids them) and its pull request must be
  // data-only; any schema DDL still requires work_type structural. Issue #4172.
  if (scope.workType === 'curated-master-data') return evaluateCuratedAdmission(issue, scope, impact)

  const actualStructural = STRUCTURAL_CHANGE_TYPES.includes(scope.changeType)
  if (!actualStructural) {
    const result = refusal(issue, scope, `actual change_type ${scope.changeType} does not change database structure`, [
      'a concrete structural change_type', 'at least one exact database object write',
    ])
    throw new AdmissionError(result.reason, result)
  }
  if (scope.workType !== 'structural' || !STRUCTURAL_ROUTES.includes(scope.route)) {
    const result = refusal(issue, scope, `actual structural change is misrouted as ${scope.workType}/${scope.route}`, [
      'work_type structural', `route one of ${STRUCTURAL_ROUTES.join(' or ')}`,
    ])
    throw new AdmissionError(result.reason, result)
  }
  // #3199 round-2 review (Medium): the self-service lane exists ONLY for the
  // app-owned schemas its boundary classifier enforces {crm, pim, dam, plm}. Without
  // this check a self-routed issue could take exclusive collision locks and a
  // version reservation on core/api/... without orchestrator triage; merge-time
  // classification would later refuse the SQL, but the locks would stand until
  // released. The write grammar is `kind schema.name`; a claim with no dotted
  // schema (e.g. `schema core`) is outside by construction — the lane never
  // creates schemas.
  if (scope.route === 'self-service-additive') {
    const outside = [...(scope.writes ?? [])].filter((value) => {
      const schema = /^(?:[a-z]+ )?(?:"([^"]+)"|([a-z_][a-z0-9_$]*))\./i.exec(String(value).trim())
      return !['crm', 'pim', 'dam', 'plm'].includes((schema?.[1] ?? schema?.[2] ?? '').toLowerCase())
    })
    if (outside.length) {
      throw new AdmissionError(`issue #${issue.number} routes self-service-additive but writes outside the {crm,pim,dam,plm} app-owned schemas: ${outside.join(', ')} — shared-schema objects need the claim-first route`)
    }
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

export const CURATED_ROUTE = 'curated-master-data-governance'
export const CURATED_EVIDENCE = Object.freeze([
  'work_type curated-master-data, route curated-master-data-governance, change_type migration, status ready, no claimed objects, a live_assertion and generated_types',
  'a newly added migration whose only effect is bounded row writes into curated Master Data (core.*, with plm.licensing_write_authorization)',
])

function curatedRefusal(issue, scope, reason) {
  const result = refusal(issue, scope, reason, [...CURATED_EVIDENCE])
  return new AdmissionError(result.reason, result)
}

function evaluateCuratedAdmission(issue, scope, impact) {
  const refuse = (reason) => { throw curatedRefusal(issue, scope, reason) }
  if (scope.route !== CURATED_ROUTE) refuse(`curated-master-data work must route ${CURATED_ROUTE}`)
  if (scope.changeType !== 'migration') refuse(`curated-master-data admission covers a fork that ships a data-only migration; change_type ${scope.changeType} is not admissible`)
  if (scope.status !== 'ready') refuse(`issue #${issue.number} is ${scope.status}, not ready`)
  if (scope.writes?.length || scope.reads?.length) refuse('curated-master-data admission must not claim database objects')
  if (typeof scope.liveAssertion !== 'string' || !scope.liveAssertion.trim()) refuse('curated-master-data admission requires a concrete live_assertion')
  if (!['required', 'not-applicable'].includes(scope.generatedTypes)) refuse('curated-master-data admission requires generated_types: required or not-applicable')
  if (scope.serviceClass !== 'maintenance') refuse('curated-master-data work is maintenance service class only')
  if (impact) refuse('db-impact is reserved for urgent-application work')
  return {
    admitted: true,
    curated: true,
    issue: Number(issue.number),
    service_class: scope.serviceClass,
    change_type: scope.changeType,
    application_return_to: null,
    live_assertion: scope.liveAssertion,
    generated_types: scope.generatedTypes,
    writes: [],
    reads: [],
    impact: null,
    digest: admissionDigest({ issue, scope, impact: null }),
  }
}

// The curated counterpart of inspectPrStructuralChange. Every migration must be
// newly added and readable, the shared structural detectors must find nothing,
// and the curated allowlist (scripts/db-flow/curated-admission.mjs)
// must prove the SQL is only bounded row writes into curated Master Data.
// `issue`/`scope` give refusals a durable curated coordination event.
export function inspectPrCuratedDataChange(prFiles = [], issue = null, scope = null) {
  const refuse = (reason) => { throw curatedRefusal(issue ?? { number: 0 }, scope, reason) }
  if (!Array.isArray(prFiles)) refuse('curated pull request files are unreadable')
  const migrations = prFiles.filter((file) => /^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(String(file?.filename ?? file?.path ?? '')) && file?.status !== 'removed')
  if (!migrations.length) refuse('the curated pull request contains no added or modified migration')
  const sql = migrations.map((file) => {
    const name = file.filename ?? file.path
    if (file.status !== 'added') refuse(`curated migration ${name} must be a newly added file`)
    if (typeof file.content !== 'string') refuse(`curated migration ${name} content is unreadable; curated admission refuses filename-only evidence`)
    return file.content
  })
  let ddl, rewrites, objects
  try {
    ddl = inventoryDdlVerbs(sql)
    rewrites = sql.flatMap((text) => catalogFunctionRewrites(text))
    objects = sql.flatMap((text) => dispatchObjectKeys(text))
  } catch (error) { refuse(`curated-master-data migration is not parseable by the structural detectors: ${error.message}`) }
  if (ddl.length || rewrites.length || objects.length) {
    refuse(`curated-master-data migration changes database structure (${[...new Set([...ddl.map((row) => row.verb), ...rewrites, ...objects])].join(', ')}); structural changes require work_type structural`)
  }
  const writes = new Set(), reads = new Set()
  for (const [index, text] of sql.entries()) {
    try { const found = inspectCuratedSql(text); for (const write of found.writes) writes.add(write); for (const read of found.reads) reads.add(read) } catch (error) {
      if (!(error instanceof CuratedSqlError)) refuse(`curated-master-data migration inspection failed: ${error.message}`)
      refuse(`curated-master-data migration ${migrations[index].filename ?? migrations[index].path} is not a bounded curated row load: ${error.message}; structural or opaque SQL requires work_type structural`)
    }
  }
  return { reads: [], row_reads: [...reads].sort(), migrations: migrations.map((file) => file.filename ?? file.path), objects: [], row_writes: [...writes].sort() }
}

const inspectedAliasProofs=new WeakMap()
const inspectedAddedColumns=new WeakMap()

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
  const actualWrites = proposedSql.flatMap((sql) => dispatchObjectKeys(sql))
  const ddl=inventoryDdlVerbs(proposedSql)
  const rewrites=[...proposedSql.flatMap((sql)=>catalogFunctionRewrites(sql)),...proposedSql.flatMap((sql)=>pgCronWrites(sql))]
  if(!ddl.length&&!rewrites.length&&!actualWrites.some((key) => key.startsWith('role ')))throw new AdmissionError('the pull request migration files contain no statement-leading schema DDL, so the actual change is not structural')
  const ambiguous=ddl.filter((row)=>!row.acknowledged)
  if(ambiguous.length)throw new AdmissionError(`the pull request contains unmodelled DDL (${ambiguous.map((row)=>row.verb).join(', ')}); structural admission fails closed`)
  const inspection={
    reads:[...new Set(proposedSql.flatMap((sql) => roleReadKeys(sql)))].sort(),
    migrations:migrations.map((file) => file.filename ?? file.path),
    objects:[...new Set([...actualWrites,...rewrites])].sort(),
  }
  inspectedAliasProofs.set(inspection,provenLegacyTableAliases(proposedSql))
  inspectedAddedColumns.set(inspection,provenAddedColumns(proposedSql))
  return inspection
}

// This proof supplements comparison only. Dispatch deliberately retains a
// table-wide lock for ALTER TABLE, including two edits to different columns.
// Keep literals opaque except the exact closed '{}' token used only by the
// strict JSONB default proof. Ignore bodies and nested comments before proving
// one complete statement-leading ADD COLUMN. Unknown forms prove
// nothing; in particular a comma-separated ALTER cannot grant partial proof.
function topLevelColumnStatements(sql) {
  const statements=[];let current=''
  for(let i=0;i<sql.length;){
    if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i+2);i=end<0?sql.length:end;current+=' ';continue}
    if(sql.startsWith('/*',i)){
      let depth=1;i+=2
      while(i<sql.length&&depth){if(sql.startsWith('/*',i)){depth++;i+=2}else if(sql.startsWith('*/',i)){depth--;i+=2}else i++}
      if(depth)return [];current+=' ';continue
    }
    const quote=sql[i]
    if(quote==='\''||quote==='"'){
      const start=i++;let closed=false
      while(i<sql.length){if(sql[i]===quote){if(sql[i+1]===quote){i+=2;continue}i++;closed=true;break}if(quote==='\''&&sql[i]==='\\'){i+=2;continue}i++}
      if(!closed)return []
      current+=quote==='"'||sql.slice(start,i)==="'{}'"?sql.slice(start,i):' ? ';continue
    }
    const dollar=/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
    if(dollar){const end=sql.indexOf(dollar[0],i+dollar[0].length);if(end<0)return [];i=end+dollar[0].length;current+=' ? ';continue}
    if(sql[i]===';'){statements.push(current);current='';i++;continue}
    current+=sql[i++]
  }
  // An unterminated statement does not prove executable DDL.
  return statements
}

function provenAddedColumns(sqlTexts) {
  const identifier=String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`
  const type=String.raw`(?:smallint|integer|bigint|boolean|text|uuid|date|timestamptz|timestamp(?:\s+(?:with|without)\s+time\s+zone)?)`
  const add=new RegExp(String.raw`^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${identifier}\s*\.\s*${identifier})\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(${identifier})\s+${type}(?:\s+(?:not\s+null|null))?(?:\s+default\s+(?:now\s*\(\s*\)|current_timestamp|true|false|-?\d+))?\s*$`,'i')
  const jsonb=new RegExp(String.raw`^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${identifier}\s*\.\s*${identifier})\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(${identifier})\s+jsonb(?:\s+(?:not\s+null|null))?(?:\s+default\s+'{}'\s*::\s*jsonb)?\s*$`,'i')
  const proof=new Map()
  for(const sql of sqlTexts)for(const statement of topLevelColumnStatements(sql)){
    const match=add.exec(statement)??jsonb.exec(statement);if(!match)continue
    const table=canonicalIdentifier(match[1]),column=canonicalIdentifier(match[2])
    proof.set(`column ${table}.${column}`,`table ${table}`)
  }
  return proof
}

function provenLegacyTableAliases(sqlTexts) {
  const operations=sqlTexts.map((sql)=>extractOperations(sql))
  const tableTargets=new Set(operations.flat().filter((op)=>op.kind==='table').map((op)=>op.target))
  // A same-migration CREATE VIEW and GRANT resolve an old relation guess.
  // Any real table operation anywhere in this PR prevents normalization.
  return [...new Set(operations.flatMap((ops)=>ops
    .filter((op)=>op.kind==='view'&&op.action==='create'&&!tableTargets.has(op.target)
      &&ops.some((grant)=>grant.kind==='view'&&grant.action==='grant'&&grant.target===op.target))
    .map((op)=>`table ${op.target}`)))].sort()
}

// Comparison only: never replace durable issue/claim/bundle writes with this
// derived list. Every permanent collision lock remains in place.
export function structuralWritesMatch(inspection, declared) {
  if(!Array.isArray(inspection?.objects)||!Array.isArray(declared))return false
  const actual=[...inspection.objects].sort(), held=[...declared].sort()
  if(new Set(actual).size!==actual.length||new Set(held).size!==held.length)return false
  const aliases=new Set(inspectedAliasProofs.get(inspection)??[])
  const columns=inspectedAddedColumns.get(inspection)??new Map()
  const compared=held.filter((key)=>{
    if(/^table /.test(key)&&aliases.has(key)&&held.includes(key.replace(/^table /,'view '))&&actual.includes(key.replace(/^table /,'view ')))return false
    const parent=columns.get(key)
    return !(parent&&held.includes(parent)&&actual.includes(parent)&&!actual.includes(key))
  })
  return actual.length===compared.length&&actual.every((value,index)=>value===compared[index])
}

// Preview preparation (issue #3418): a claim may OVER-declare. Its object locks were
// broader than the migration needed, which only ever excluded other writers, so a
// migration writing a non-empty SUBSET of the claim is safe to rehearse. Every object
// the SQL writes must still be claimed: an unclaimed write fails closed exactly as before.
export function structuralWritesCovered(inspection, declared) {
  if(!Array.isArray(inspection?.objects)||!Array.isArray(declared)||!inspection.objects.length)return false
  const actual=[...inspection.objects], held=new Set(declared)
  if(new Set(actual).size!==actual.length||held.size!==declared.length)return false
  if(structuralWritesMatch(inspection,declared))return true
  return actual.every((key)=>held.has(key))
}

// A do-block may rewrite an existing function from its own catalog definition:
// `select pg_get_functiondef('schema.name(args)'::regprocedure) into v; ... execute v;`.
// It carries no statement-leading DDL, yet its durable effect is CREATE OR REPLACE
// FUNCTION on that exact object. Recognised only when the SAME variable read from
// pg_get_functiondef is mutated and later EXECUTEd inside the same do-block.
function catalogFunctionRewrites(sql){
  const found=new Set()
  for(const block of String(sql).matchAll(/\bdo\s+\$([A-Za-z_][A-Za-z0-9_]*|)\$([\s\S]*?)\$\1\$\s*;/gi)){
    const text=stripSqlNestedDollarQuotedText(stripSqlComments(block[2]))
    const read=/pg_get_functiondef\(\s*'\s*("?[A-Za-z_][A-Za-z0-9_]*"?)\s*\.\s*("?[A-Za-z_][A-Za-z0-9_]*"?)\s*\([^')]*\)\s*'\s*::\s*regprocedure\s*\)\s*\)?\s*into\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gi
    for(const match of text.matchAll(read)){
      const variable=match[3].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
      const rest=stripSqlQuotedText(text.slice(match.index+match[0].length))
      const mutation=new RegExp(`\\b${variable}\\s*:=\\s*(?:replace|regexp_replace)\\s*\\(\\s*${variable}\\b`,'i').exec(rest)
      if(!mutation)continue
      const afterMutation=rest.slice(mutation.index+mutation[0].length)
      if(!new RegExp(`(^|;|\\n|\\bthen|\\bloop|\\bbegin)\\s*execute\\s+${variable}\\s*;`,'i').test(afterMutation))continue
      found.add(`function ${canonicalIdentifier(`${match[1]}.${match[2]}`)}`)
    }
  }
  return [...found]
}

function stripSqlComments(sql){
  let out='',state='code'
  for(let i=0;i<sql.length;i++){
    const c=sql[i],next=sql[i+1]
    if(state==='line'){if(c==='\n'){state='code';out+='\n'}continue}
    if(state==='block'){if(c==='*'&&next==='/'){state='code';i++}continue}
    if(state==='single'){out+=c;if(c==="'"&&next==="'"){out+=next;i++}else if(c==="'")state='code';continue}
    if(state==='double'){out+=c;if(c==='"'&&next==='"'){out+=next;i++}else if(c==='"')state='code';continue}
    if(c==='-'&&next==='-'){state='line';i++;continue}
    if(c==='/'&&next==='*'){state='block';i++;continue}
    if(c==="'")state='single'
    else if(c==='"')state='double'
    out+=c
  }
  return out
}

function stripSqlQuotedText(sql){
  return String(sql)
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*|)\$[\s\S]*?\$\1\$/g,' ')
    .replace(/'(?:[^']|'')*'/g,' ')
    .replace(/"(?:[^"]|"")*"/g,' ')
}

function stripSqlNestedDollarQuotedText(sql){
  return String(sql).replace(/\$([A-Za-z_][A-Za-z0-9_]*|)\$[\s\S]*?\$\1\$/g,' ')
}

export function assertPrCarriesStructuralChange(prFiles = []) { return inspectPrStructuralChange(prFiles).migrations }
