import { canonicalJson, sha256 } from './evidence-bundle.mjs'

// A digest is an identity, not authentication. Only the trusted producer adapter
// may mint this in-process capability after authenticating the artifact and
// deriving the expected closure and existing classifier verdicts independently.
const verified = new WeakMap()
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const fail = message => { throw new Error(`isolated rehearsal: ${message}`) }
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...names].sort().join('|')

export function verifyIsolatedRehearsal(manifest, expected, { authenticateProducer, verifyProbe, classifyBoundary, previewRequiredReasons } = {}) {
  const copy = freeze(JSON.parse(JSON.stringify(manifest)))
  const independentlyExpected = freeze(JSON.parse(JSON.stringify(expected)))
  if (!keys(copy, ['schema_version','kind','identity','replay','tests','manifest_sha256']) || copy.schema_version !== 1 || copy.kind !== 'isolated-rehearsal') fail('unknown evidence contract')
  const { manifest_sha256, ...unsigned } = copy
  if (!digest(manifest_sha256) || sha256(canonicalJson(unsigned)) !== manifest_sha256) fail('manifest digest changed')
  if (canonicalJson(copy.identity) !== canonicalJson(independentlyExpected)) fail('independently derived identity differs')
  const id = copy.identity
  if (!keys(id, ['repository','issue','pr','base_sha','head_sha','bundle_id','baseline_sha256','permission_setup_sha256','catalog_sha256','closure','selected_versions','contract_tests','producer','probe_manifest_sha256'])) fail('incomplete identity')
  if (!/^[\w.-]+\/[\w.-]+$/.test(id.repository) || !Number.isSafeInteger(id.issue) || id.issue < 1 || !Number.isSafeInteger(id.pr) || id.pr < 1 || !/^[0-9a-f]{40}$/.test(id.base_sha) || !/^[0-9a-f]{40}$/.test(id.head_sha)) fail('invalid source identity')
  for (const name of ['bundle_id','baseline_sha256','permission_setup_sha256','catalog_sha256','probe_manifest_sha256']) if (!digest(id[name])) fail(`missing ${name}`)
  if (!keys(id.producer,['repository','run_id','run_attempt','workflow_sha']) || id.producer.repository !== id.repository || !Number.isSafeInteger(id.producer.run_id) || id.producer.run_id < 1 || !Number.isSafeInteger(id.producer.run_attempt) || id.producer.run_attempt < 1 || !/^[0-9a-f]{40}$/.test(id.producer.workflow_sha)) fail('invalid producer identity')
  if (!Array.isArray(id.closure) || !id.closure.length || id.closure.some(row => !keys(row,['version','sha256']) || !/^\d{14}$/.test(row.version) || !digest(row.sha256)) || new Set(id.closure.map(row => row.version)).size !== id.closure.length) fail('invalid ordered dependency closure')
  if (!Array.isArray(id.selected_versions) || !id.selected_versions.length || new Set(id.selected_versions).size !== id.selected_versions.length || id.selected_versions.some(version => !id.closure.some(row => row.version === version))) fail('selected migrations are outside closure')
  if (!Array.isArray(id.contract_tests) || !id.contract_tests.length || id.contract_tests.some(name => typeof name !== 'string' || !name.trim()) || new Set(id.contract_tests).size !== id.contract_tests.length) fail('contract coverage is missing')
  if (!Array.isArray(copy.replay) || canonicalJson(copy.replay) !== canonicalJson(id.closure.map(row => ({...row,result:'passed'})))) fail('a prerequisite failed, was omitted, reordered or retried')
  if (!Array.isArray(copy.tests) || canonicalJson(copy.tests) !== canonicalJson(id.contract_tests.map(name => ({name,result:'passed',quarantined:false})))) fail('relevant contract failed or is quarantined')
  // Never accept caller-supplied booleans or serialized classifier verdicts.
  if (typeof authenticateProducer !== 'function' || authenticateProducer(copy, independentlyExpected) !== true) fail('trusted producer authentication required')
  if (typeof verifyProbe !== 'function' || verifyProbe(copy, independentlyExpected) !== true) fail('exact bounded probe qualification required')
  if (typeof classifyBoundary !== 'function' || classifyBoundary(copy, independentlyExpected)?.verdict !== 'pass') fail('existing app-owned additive classifier refused')
  const risks = typeof previewRequiredReasons === 'function' ? previewRequiredReasons(copy, independentlyExpected) : null
  if (!Array.isArray(risks) || risks.length) fail('existing conservative SQL classifier requires shared preview')
  const capability = Object.freeze({ manifest_sha256 })
  verified.set(capability, copy)
  return capability
}

export function isolatedRehearsalForTarget(capability, target) {
  const evidence = verified.get(capability)
  if (!evidence) fail('in-process authenticated evidence required')
  for (const name of ['repository','issue','pr','base_sha','head_sha','bundle_id']) if (evidence.identity[name] !== target[name]) fail(`stale ${name}`)
  if (canonicalJson([...evidence.identity.selected_versions].sort()) !== canonicalJson([...target.versions].sort())) fail('selected versions changed')
  return evidence
}
