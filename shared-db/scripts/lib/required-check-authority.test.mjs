import test from 'node:test'
import assert from 'node:assert/strict'
import { readEffectiveRequiredChecks, computeRevision, stableStringify, probeAuthorityReadPermissions } from './required-check-authority.mjs'
const sha = 'a'.repeat(40)
const rule = { id: 'BPR_1', requiresStatusChecks: true, requiresStrictStatusChecks: false, requiredStatusCheckContexts: ['required'], requiredStatusChecks: [{ context: 'required', app: { databaseId: 15368 } }] }
export function fixture(rules = [], mutate = () => {}) {
  const response = { data: { repository: { databaseId: 1, nameWithOwner: 'popcre/shared-db', ref: { name: 'main', target: { oid: sha }, branchProtectionRule: structuredClone(rule) } } } }
  mutate(response)
  return {
    repo: 'popcre/shared-db',
    read: (args) => {
      if (args.includes('graphql')) return response
      // Default: REST /protection is absent (404). Override when testing other paths.
      if (/(\/branches\/[^/]+\/protection)$/.test(String(args.at(-1) ?? ''))) {
        const err = Error('gh: Not Found (HTTP 404)'); err.stderr = 'gh: Not Found (HTTP 404)'; throw err
      }
      return [rules]
    },
  }
}
test('resolves classic protection and allowed producer from a fresh identified branch', () => {
  const result = readEffectiveRequiredChecks(fixture())
  assert.deepEqual(result.checks, [{ context: 'required', app_id: 15368 }])
  assert.equal(result.base_sha, sha)
  assert.match(result.revision, /^[a-f0-9]{64}$/)
})
test('new inherited ruleset changes effective revision even with a still-unexpired old snapshot', () => {
  const old = readEffectiveRequiredChecks(fixture())
  old.expires = '2099-01-01'
  const added = { type: 'required_status_checks', ruleset_id: 12, ruleset_source_type: 'Organization', ruleset_source: 'popcre', parameters: { required_status_checks: [{ context: 'new required', integration_id: 7 }] } }
  const current = readEffectiveRequiredChecks(fixture([added]))
  assert.notEqual(current.revision, old.revision)
  assert.equal(current.checks.length, 2)
})
test('refuses transport denial, partial GraphQL, malformed pagination, wrong repository and invalid producer', () => {
  assert.throws(() => readEffectiveRequiredChecks({ repo: 'popcre/shared-db', read() { throw Error('403') } }), /403/)
  for (const mutation of [
    (r) => { r.errors = [{ message: 'denied' }] },
    (r) => { r.data.repository.databaseId = null },
    (r) => { r.data.repository.nameWithOwner = 'other/repo' },
    (r) => { r.data.repository.ref.branchProtectionRule.requiredStatusChecks[0].app = { databaseId: 'invalid' } },
    (r) => { r.data.repository.ref.branchProtectionRule.requiredStatusCheckContexts.push('lost') },
  ]) assert.throws(() => readEffectiveRequiredChecks(fixture([], mutation)))
  const input = fixture(); const read = input.read
  input.read = (args) => args.includes('graphql') ? read(args) : []
  assert.throws(() => readEffectiveRequiredChecks(input), /incomplete/)
})
test('null classic protection requires a known effective ruleset and empty policy refuses', () => {
  assert.throws(() => readEffectiveRequiredChecks(fixture([], (r) => { r.data.repository.ref.branchProtectionRule = null })), /no checks/)
})
test('ruleset any-source check with omitted integration_id is treated as classic app: null', () => {
  const anySource = { type: 'required_status_checks', ruleset_id: 11, ruleset_source_type: 'Repository', ruleset_source: 'popcre/shared-db', parameters: { required_status_checks: [{ context: 'any-source' }] } }
  const result = readEffectiveRequiredChecks(fixture([anySource]))
  assert.deepEqual(result.checks.find((item) => item.context === 'any-source'), { context: 'any-source', app_id: null })
})
test('classic omitted app is unrestricted and traversal-like repository names refuse', () => {
  const input = fixture([], (r) => { delete r.data.repository.ref.branchProtectionRule.requiredStatusChecks[0].app })
  assert.deepEqual(readEffectiveRequiredChecks(input).checks, [{ context: 'required', app_id: null }])
  assert.throws(() => readEffectiveRequiredChecks({ ...input, repo: '../..' }), /repository or branch identity/)
  assert.throws(() => probeAuthorityReadPermissions({ repo: '../..', read: input.read }), /repository or branch identity/)
})
test('null classic protection probes REST /protection to distinguish 404 from 403', () => {
  // 404 on /protection: genuine absence. With a ruleset providing checks, accept.
  const ok404 = { type: 'required_status_checks', ruleset_id: 9, ruleset_source_type: 'Organization', ruleset_source: 'popcre', parameters: { required_status_checks: [{ context: 'from ruleset', integration_id: 7 }] } }
  const input = fixture([ok404], (r) => { r.data.repository.ref.branchProtectionRule = null })
  const originalRead = input.read
  input.read = (args) => {
    if (args.includes('graphql')) return originalRead(args)
    if (/(\/branches\/[^/]+\/protection)$/.test(String(args.at(-1) ?? ''))) {
      const err = Error('gh: Not Found (HTTP 404)'); err.stderr = 'gh: Not Found (HTTP 404)'; throw err
    }
    return originalRead(args)
  }
  const result = readEffectiveRequiredChecks(input)
  assert.deepEqual(result.checks, [{ context: 'from ruleset', app_id: 7 }])
  // 403 on /protection: unauthorized null, must refuse even with ruleset checks.
  const input403 = fixture([ok404], (r) => { r.data.repository.ref.branchProtectionRule = null })
  const read403 = input403.read
  input403.read = (args) => {
    if (args.includes('graphql')) return read403(args)
    if (/(\/branches\/[^/]+\/protection)$/.test(String(args.at(-1) ?? ''))) {
      const err = Error('gh: Resource not accessible by integration (HTTP 403)'); err.stderr = 'gh: Resource not accessible by integration (HTTP 403)'; throw err
    }
    return read403(args)
  }
  assert.throws(() => readEffectiveRequiredChecks(input403), /permission denied|null cannot be trusted/)
  // 200 on /protection: protection exists but GraphQL said null, refuse.
  const input200 = fixture([ok404], (r) => { r.data.repository.ref.branchProtectionRule = null })
  const read200 = input200.read
  input200.read = (args) => {
    if (args.includes('graphql')) return read200(args)
    if (/(\/branches\/[^/]+\/protection)$/.test(String(args.at(-1) ?? ''))) return { required_status_checks: { contexts: ['hidden'], strict: false } }
    return read200(args)
  }
  assert.throws(() => readEffectiveRequiredChecks(input200), /unauthorized-null|unauthorized or inconsistent/)
})
test('revision digest is canonical: key-order jitter does not change it', () => {
  const a = computeRevision({ repository_id: 1, repository: 'popcre/shared-db', branch: 'main', sources: { classic: { z: 1, a: 2 }, rulesets: [] } })
  const b = computeRevision({ repository_id: 1, repository: 'popcre/shared-db', branch: 'main', sources: { classic: { a: 2, z: 1 }, rulesets: [] } })
  assert.equal(a, b)
  assert.match(a, /^[a-f0-9]{64}$/)
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}')
  assert.notEqual(computeRevision({ repository_id: 1, repository: 'popcre/shared-db', branch: 'main', sources: {}, checks: [{ context: 'a', app_id: null }] }), computeRevision({ repository_id: 1, repository: 'popcre/shared-db', branch: 'main', sources: {}, checks: [{ context: 'b', app_id: null }] }))
  assert.throws(() => stableStringify({ missing: undefined }), /non-JSON value/)
})
test('probe proves both authority reads; a denial names the missing permission and fails closed', () => {
  const okRead = (args) => {
    if (args.includes('graphql')) return { data: { repository: { databaseId: 1, nameWithOwner: 'popcre/shared-db', ref: { name: 'main', target: { oid: sha }, branchProtectionRule: { id: 'BPR_1' } } } } }
    return [[]]
  }
  const result = probeAuthorityReadPermissions({ repo: 'popcre/shared-db', read: okRead })
  assert.equal(result.ok, true)
  assert.deepEqual(result.proven, ['GraphQL branchProtectionRule', 'REST /rules/branches'])
  assert.throws(() => probeAuthorityReadPermissions({ repo: 'popcre/shared-db', read: (args) => {
    if (args.includes('graphql')) return { data: { repository: { databaseId: 1, nameWithOwner: 'popcre/shared-db', ref: { name: 'main', target: { oid: sha }, branchProtectionRule: null } } } }
    if (String(args.at(-1)).endsWith('/protection')) throw Error('gh: Forbidden (HTTP 403)')
    return [[]]
  } }), /permission denied/)
  const noClassic = (args) => {
    if (args.includes('graphql')) return { data: { repository: { databaseId: 1, nameWithOwner: 'popcre/shared-db', ref: { name: 'main', target: { oid: sha }, branchProtectionRule: null } } } }
    if (String(args.at(-1)).endsWith('/protection')) throw Error('gh: Not Found (HTTP 404)')
    return [[]]
  }
  assert.equal(probeAuthorityReadPermissions({ repo: 'popcre/shared-db', read: noClassic }).ok, true)
  assert.throws(() => probeAuthorityReadPermissions({ repo: 'popcre/shared-db', read: (args) => args.includes('graphql') ? okRead(args) : [] }), /usable rule list/)
  const deny = (args) => {
    const err = Error('gh: Resource not accessible by integration (HTTP 403)')
    err.stderr = 'gh: Resource not accessible by integration (HTTP 403)'
    throw err
  }
  assert.throws(() => probeAuthorityReadPermissions({ repo: 'popcre/shared-db', read: deny }), /cannot complete the required-check authority reads/)
  // The actionable message must name the REAL requirement (admin / Administration:read),
  // not the false claim that contents:read suffices.
  try {
    probeAuthorityReadPermissions({ repo: 'popcre/shared-db', read: deny })
    assert.fail('should have thrown')
  } catch (e) {
    assert.match(e.message, /admin-level access|Administration:read|GitHub App/i)
    assert.match(e.message, /contents:read is NOT enough/i)
    assert.doesNotMatch(e.message, /administration:read is NOT required/i)
  }
  const denyRules = (args) => {
    if (args.includes('graphql')) return { data: { repository: { databaseId: 1, nameWithOwner: 'popcre/shared-db', ref: { name: 'main', target: { oid: sha }, branchProtectionRule: { id: 'BPR_1' } } } } }
    const err = Error('gh: Resource not accessible by integration (HTTP 403)')
    err.stderr = 'gh: Resource not accessible by integration (HTTP 403)'
    throw err
  }
  assert.throws(() => probeAuthorityReadPermissions({ repo: 'popcre/shared-db', read: denyRules }), /REST \/rules\/branches read denied/)
})
