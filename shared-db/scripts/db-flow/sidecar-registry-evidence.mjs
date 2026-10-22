// Registry-bound evidence for the delivery preflight (#3028, popcre/ai-devops#401 Step 5).
//
// delivery-preflight.mjs refuses its `sidecars` and `producers` checks unless each
// is bound to an authoritative registration read back from a trusted root. This
// module is the producer of those registrations. It derives both checks from the
// single sidecar declaration registry at the EXACT head being delivered:
//   sidecars  - config/production-verification-sidecar-registry.json must declare
//               every scripts/production-verification-sidecars/*.json at that head,
//               and every declaration must have its file. A #2627-shaped sidecar
//               merged without its declaration is BLOCKED here, before review.
//   producers - PREVIEW_PRODUCER_PATHS as production_business_risk_gate.py computes
//               it from that registry; every pinned path must be tracked at the head.
// Each artifact digest covers the exact blob ids read, so a later head that moves
// any declared file produces a different registration. Nothing here falls open.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, sha256 } from './evidence-bundle.mjs'
import { DeliveryPreflightError } from './delivery-preflight.mjs'

export const SIDECAR_REGISTRY_PATH = 'config/production-verification-sidecar-registry.json'
export const SIDECAR_DIR = 'scripts/production-verification-sidecars'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHA = /^[0-9a-f]{40}$/i

export function gitTreeReader(repoRoot = REPO_ROOT) {
  const git = (args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return {
    // path -> blob id for every tracked file at the commit
    tree(head) {
      const entries = new Map()
      for (const line of git(['ls-tree', '-r', '--full-tree', head]).split('\n')) {
        const match = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line)
        if (match) entries.set(match[2], match[1])
      }
      return entries
    },
    show(head, file) { return git(['show', `${head}:${file}`]) },
    headOf() { return git(['rev-parse', 'HEAD']).trim() },
    isClean() { return git(['status', '--porcelain=v1']).trim() === '' },
  }
}

export function parseSidecarRegistry(text) {
  let data
  try { data = JSON.parse(text) } catch { throw new DeliveryPreflightError(`${SIDECAR_REGISTRY_PATH} is unreadable`) }
  const keys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).sort().join(',') : ''
  if (keys !== 'schema_version,sidecars' || data.schema_version !== 1 || !Array.isArray(data.sidecars)) throw new DeliveryPreflightError(`${SIDECAR_REGISTRY_PATH} must be schema_version 1 with exactly schema_version and sidecars`)
  const versions = data.sidecars.map((entry) => {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).sort().join(',') !== 'issue,version') throw new DeliveryPreflightError('sidecar registry entries must contain exactly version and issue')
    if (typeof entry.version !== 'string' || !/^\d{14}$/.test(entry.version)) throw new DeliveryPreflightError(`sidecar registry version ${JSON.stringify(entry.version)} is not a 14-digit migration version`)
    if (entry.issue !== null && !(Number.isInteger(entry.issue) && entry.issue > 0)) throw new DeliveryPreflightError(`sidecar registry issue for ${entry.version} must be a positive integer or null`)
    return entry.version
  })
  if (new Set(versions).size !== versions.length) throw new DeliveryPreflightError('sidecar registry declares a version more than once')
  return versions
}

function registration(kind, { issue, pr, head_sha }, producer_id, artifact) {
  const artifact_digest = sha256(canonicalJson(artifact))
  const record = { evidence_id: `${kind}:${issue}:${pr}:${head_sha}:${artifact_digest}`, kind, issue, pr, head_sha, producer_id, artifact_digest }
  return { record, check: { status: 'PASS', evidence_id: record.evidence_id, registry_digest: sha256(canonicalJson(record)), producer_id, artifact_digest } }
}

export function sidecarsEvidence(target, reader) {
  const tree = reader.tree(target.head_sha)
  const registryBlob = tree.get(SIDECAR_REGISTRY_PATH)
  if (!registryBlob) throw new DeliveryPreflightError(`delivery preflight blocked by sidecars: ${SIDECAR_REGISTRY_PATH} is absent at ${target.head_sha}`)
  const declared = parseSidecarRegistry(reader.show(target.head_sha, SIDECAR_REGISTRY_PATH))
  const present = [...tree.keys()].filter((file) => path.posix.dirname(file) === SIDECAR_DIR && file.endsWith('.json')).map((file) => path.posix.basename(file, '.json'))
  const undeclared = present.filter((version) => !declared.includes(version)).sort()
  if (undeclared.length) throw new DeliveryPreflightError(`delivery preflight blocked by sidecars: ${undeclared.join(', ')} not declared in ${SIDECAR_REGISTRY_PATH}`)
  const fileless = declared.filter((version) => !present.includes(version)).sort()
  if (fileless.length) throw new DeliveryPreflightError(`delivery preflight blocked by sidecars: ${SIDECAR_REGISTRY_PATH} declares ${fileless.join(', ')} without a sidecar file`)
  const sidecars = [...declared].sort().map((version) => ({ path: `${SIDECAR_DIR}/${version}.json`, blob: tree.get(`${SIDECAR_DIR}/${version}.json`) }))
  return registration('sidecars', target, `${SIDECAR_REGISTRY_PATH}@${registryBlob}`, { registry: { path: SIDECAR_REGISTRY_PATH, blob: registryBlob }, sidecars })
}

export function pythonProducerPaths({ repoRoot = REPO_ROOT, python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3') } = {}) {
  const code = 'import json,sys\nsys.path.insert(0,sys.argv[1])\nimport production_business_risk_gate as g\nprint(json.dumps(list(g.PREVIEW_PRODUCER_PATHS)))'
  const result = spawnSync(python, ['-c', code, path.join(repoRoot, 'scripts')], { encoding: 'utf8' })
  try { if (result.status === 0) return JSON.parse(result.stdout) } catch { /* refused below */ }
  throw new DeliveryPreflightError(`producer list is unreadable: ${(result.error?.message || result.stderr || `exit ${result.status}`).trim()}`)
}

export function producersEvidence(target, reader, producerPaths) {
  if (!Array.isArray(producerPaths) || !producerPaths.length) throw new DeliveryPreflightError('delivery preflight blocked by producers: the producer list is empty')
  const tree = reader.tree(target.head_sha)
  const unique = [...new Set(producerPaths)].sort()
  const untracked = unique.filter((file) => !tree.has(file))
  if (untracked.length) throw new DeliveryPreflightError(`delivery preflight blocked by producers: pinned paths untracked at ${target.head_sha}: ${untracked.join(', ')}`)
  const registryBlob = tree.get(SIDECAR_REGISTRY_PATH)
  if (!registryBlob || !unique.includes(SIDECAR_REGISTRY_PATH)) throw new DeliveryPreflightError('delivery preflight blocked by producers: the sidecar registry is not a pinned producer')
  return registration('producers', target, `scripts/production_business_risk_gate.py@${tree.get('scripts/production_business_risk_gate.py')}`, { producers: unique.map((file) => ({ path: file, blob: tree.get(file) })) })
}

export function writeRegistration(registryRoot, record) {
  if (typeof registryRoot !== 'string' || !path.isAbsolute(registryRoot)) throw new DeliveryPreflightError('trusted evidence registry root must be an absolute path')
  mkdirSync(registryRoot, { recursive: true })
  writeFileSync(path.join(registryRoot, `registration-${sha256(record.evidence_id)}.json`), `${JSON.stringify(record, null, 2)}\n`)
}

/**
 * Produce and register the `sidecars` and `producers` checks for an exact head.
 * The checkout at repoRoot must be clean and AT that head, because the producer
 * list is computed by importing the gate from the working tree.
 */
export function registerSidecarRegistryEvidence({ issue, pr, head_sha }, { registryRoot, repoRoot = REPO_ROOT, reader = gitTreeReader(repoRoot), producerPaths = null } = {}) {
  for (const [key, value] of Object.entries({ issue, pr })) if (!Number.isInteger(value) || value <= 0) throw new DeliveryPreflightError(`${key} must be a positive integer`)
  if (!SHA.test(String(head_sha ?? ''))) throw new DeliveryPreflightError('head_sha must be an exact commit SHA')
  const target = { issue, pr, head_sha: head_sha.toLowerCase() }
  if (!producerPaths) {
    if (reader.headOf().toLowerCase() !== target.head_sha || !reader.isClean()) throw new DeliveryPreflightError(`checkout ${repoRoot} must be clean and at ${target.head_sha} to compute the producer list`)
    producerPaths = pythonProducerPaths({ repoRoot })
  }
  const sidecars = sidecarsEvidence(target, reader), producers = producersEvidence(target, reader, producerPaths)
  writeRegistration(registryRoot, sidecars.record)
  writeRegistration(registryRoot, producers.record)
  return { sidecars: sidecars.check, producers: producers.check }
}

export function main(argv, env = process.env) {
  try {
    const arg = (name) => { const index = argv.indexOf(name); if (index < 0 || !argv[index + 1]) throw new DeliveryPreflightError(`${name} is required`); return argv[index + 1] }
    const checks = registerSidecarRegistryEvidence({ issue: Number(arg('--issue')), pr: Number(arg('--pr')), head_sha: arg('--head-sha') }, { registryRoot: env.DELIVERY_EVIDENCE_REGISTRY_ROOT })
    console.log(JSON.stringify(checks, null, 2)); return 0
  } catch (error) { console.error(`REFUSED: ${error.message}`); return 2 }
}
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2))
