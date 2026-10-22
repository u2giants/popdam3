import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DELIVERY_CHECKS, runDeliveryPreflight, trustedEvidenceRegistryReader } from './delivery-preflight.mjs'
import { SIDECAR_DIR, SIDECAR_REGISTRY_PATH, parseSidecarRegistry, registerSidecarRegistryEvidence } from './sidecar-registry-evidence.mjs'

const HEAD = 'c'.repeat(40)
const registry = (versions) => JSON.stringify({ schema_version: 1, sidecars: versions.map((version) => ({ version, issue: 3028 })) })
const fakeReader = (files) => ({
  tree: () => new Map(Object.keys(files).map((file, index) => [file, String(index).padStart(40, '0')])),
  show: (_head, file) => files[file],
  headOf: () => HEAD,
  isClean: () => true,
})
const repo = (declared, present) => ({ [SIDECAR_REGISTRY_PATH]: registry(declared), 'scripts/production_business_risk_gate.py': 'x', ...Object.fromEntries(present.map((v) => [`${SIDECAR_DIR}/${v}.json`, '{}'])) })
const withRoot = (fn) => { const root = mkdtempSync(path.join(tmpdir(), 'sidecar-reg-')); try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) } }
const producersFor = (files) => Object.keys(files)

test('one declaration registers a new sidecar and the preflight reads it back', () => withRoot((root) => {
  const files = repo(['20260101000000'], ['20260101000000'])
  const checks = registerSidecarRegistryEvidence({ issue: 3028, pr: 1, head_sha: HEAD }, { registryRoot: root, reader: fakeReader(files), producerPaths: producersFor(files) })
  const input = { issue: 3028, pr: 1, head_sha: HEAD, checks: Object.fromEntries(DELIVERY_CHECKS.map((name) => [name, checks[name] ?? { status: 'PASS', evidence_id: `${name}-proof` }])) }
  const record = runDeliveryPreflight(input, { readEvidenceRegistration: trustedEvidenceRegistryReader(root) })
  assert.equal(record.status, 'PASS')
  assert.match(checks.sidecars.producer_id, /^config\/production-verification-sidecar-registry\.json@/)
}))

test('a #2627-shaped undeclared sidecar is blocked before review', () => withRoot((root) => {
  const files = repo([], ['20260101000000'])
  assert.throws(() => registerSidecarRegistryEvidence({ issue: 3028, pr: 1, head_sha: HEAD }, { registryRoot: root, reader: fakeReader(files), producerPaths: producersFor(files) }), /blocked by sidecars: 20260101000000 not declared/)
}))

test('a declaration without its file, a missing registry, or an unpinned registry refuses', () => withRoot((root) => {
  const target = { issue: 3028, pr: 1, head_sha: HEAD }
  const orphan = repo(['20260101000000'], [])
  assert.throws(() => registerSidecarRegistryEvidence(target, { registryRoot: root, reader: fakeReader(orphan), producerPaths: producersFor(orphan) }), /without a sidecar file/)
  const absent = { 'scripts/production_business_risk_gate.py': 'x' }
  assert.throws(() => registerSidecarRegistryEvidence(target, { registryRoot: root, reader: fakeReader(absent), producerPaths: ['scripts/production_business_risk_gate.py'] }), /is absent/)
  const ok = repo(['20260101000000'], ['20260101000000'])
  assert.throws(() => registerSidecarRegistryEvidence(target, { registryRoot: root, reader: fakeReader(ok), producerPaths: ['scripts/production_business_risk_gate.py'] }), /not a pinned producer/)
  assert.throws(() => registerSidecarRegistryEvidence(target, { registryRoot: root, reader: fakeReader(ok), producerPaths: [...producersFor(ok), 'scripts/ghost.py'] }), /untracked/)
}))

test('a moved sidecar blob changes the registration so stale evidence cannot be reused', () => withRoot((root) => {
  const files = repo(['20260101000000'], ['20260101000000'])
  const target = { issue: 3028, pr: 1, head_sha: HEAD }
  const first = registerSidecarRegistryEvidence(target, { registryRoot: root, reader: fakeReader(files), producerPaths: producersFor(files) })
  const moved = { ...fakeReader(files), tree: () => new Map([...fakeReader(files).tree()].map(([file, blob]) => [file, file.startsWith(SIDECAR_DIR) ? 'f'.repeat(40) : blob])) }
  const second = registerSidecarRegistryEvidence(target, { registryRoot: root, reader: moved, producerPaths: producersFor(files) })
  assert.notEqual(first.sidecars.artifact_digest, second.sidecars.artifact_digest)
}))

test('malformed registries fail closed', () => {
  for (const bad of ['{', '{"schema_version":2,"sidecars":[]}', '{"schema_version":1,"sidecars":[{"version":"1"}]}', registry(['20260101000000', '20260101000000'])]) assert.throws(() => parseSidecarRegistry(bad))
})

test('the live repository registry agrees with the sidecar files on disk', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..')
  const declared = parseSidecarRegistry(readFileSync(path.join(root, SIDECAR_REGISTRY_PATH), 'utf8')).sort()
  const present = readdirSync(path.join(root, SIDECAR_DIR)).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5)).sort()
  assert.deepEqual(declared, present)
})
