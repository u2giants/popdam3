import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVE_RUN_STATUSES,
  BaselineError,
  PAGE_SIZE,
  actionsUsed,
  buildBaseline,
  classifyReadiness,
  describeVariable,
  makeGitHub,
  parseArgs,
  redactionAudit,
  summarizeRefs,
} from './capture-repository-transfer-baseline.mjs'

const SOURCE = 'u2giants/shared-db'
const TARGET = 'popcre/shared-db'

function notFound() {
  const error = new Error('GitHub command failed: gh: Not Found (HTTP 404)')
  return error
}

/** A fake GitHub keyed by endpoint (query string included). */
function fakeWorld(overrides = {}) {
  const routes = {
    [`repos/${SOURCE}`]: {
      id: 1275568548, node_id: 'R_x', owner: { login: 'u2giants', type: 'User' }, name: 'shared-db',
      visibility: 'public', archived: false, default_branch: 'main', topics: ['b', 'a'],
      has_issues: true, has_projects: true, has_wiki: false, has_discussions: false, has_pages: false,
      allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: false, allow_auto_merge: false,
      delete_branch_on_merge: false, allow_update_branch: false, permissions: { admin: true },
    },
    [`repos/${SOURCE}/commits/main`]: { sha: 'a'.repeat(40) },
    [`repos/${SOURCE}/branches/main/protection`]: {
      required_status_checks: { strict: false, contexts: ['Z check', 'A check'] },
      enforce_admins: { enabled: true },
    },
    [`repos/${SOURCE}/rulesets?per_page=${PAGE_SIZE}&page=1`]: [],
    [`repos/${SOURCE}/actions/permissions`]: { enabled: true, allowed_actions: 'all' },
    [`repos/${SOURCE}/actions/permissions/workflow`]: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false },
    [`repos/${SOURCE}/actions/workflows?per_page=${PAGE_SIZE}&page=1`]: { workflows: [{ name: 'W', path: '.github/workflows/w.yml', state: 'active' }] },
    [`repos/${SOURCE}/actions/variables?per_page=${PAGE_SIZE}&page=1`]: { variables: [{ name: 'FLAG', value: 'true' }, { name: 'APP_ID', value: 'v6z1sveur7e32dub1dp3ao4v' }] },
    [`repos/${SOURCE}/actions/secrets?per_page=${PAGE_SIZE}&page=1`]: { secrets: [{ name: 'SYNC_TOKEN' }, { name: 'ANTHROPIC_API_KEY' }] },
    [`repos/${SOURCE}/environments?per_page=${PAGE_SIZE}&page=1`]: { environments: [{ name: 'production', protection_rules: [] }, { name: 'preview', protection_rules: [] }] },
    [`repos/${SOURCE}/environments/preview/secrets?per_page=${PAGE_SIZE}&page=1`]: { secrets: [] },
    [`repos/${SOURCE}/environments/preview/variables?per_page=${PAGE_SIZE}&page=1`]: { variables: [] },
    [`repos/${SOURCE}/environments/production/secrets?per_page=${PAGE_SIZE}&page=1`]: { secrets: [] },
    [`repos/${SOURCE}/environments/production/variables?per_page=${PAGE_SIZE}&page=1`]: { variables: [] },
    [`repos/${SOURCE}/collaborators?affiliation=direct&per_page=${PAGE_SIZE}&page=1`]: [{ login: 'u2giants', role_name: 'admin' }, { login: 'devopswithkube', role_name: 'write' }],
    [`repos/${SOURCE}/teams?per_page=${PAGE_SIZE}&page=1`]: [],
    [`repos/${SOURCE}/hooks?per_page=${PAGE_SIZE}&page=1`]: [],
    [`repos/${SOURCE}/keys?per_page=${PAGE_SIZE}&page=1`]: [],
    [`repos/${SOURCE}/releases?per_page=${PAGE_SIZE}&page=1`]: [],
    [`search/issues?q=${encodeURIComponent(`repo:${SOURCE} is:pr is:open`)}&per_page=1`]: { total_count: 12 },
    [`search/issues?q=${encodeURIComponent(`repo:${SOURCE} is:issue is:open`)}&per_page=1`]: { total_count: 150 },
    [`repos/${SOURCE}/git/matching-refs/`]: [
      { ref: 'refs/heads/main', object: { sha: 'a'.repeat(40) } },
      { ref: 'refs/db-claims/1', object: { sha: 'b'.repeat(40) } },
      { ref: 'refs/tags/v1', object: { sha: 'c'.repeat(40) } },
    ],
    [`repos/${TARGET}`]: notFound,
    'orgs/popcre': { type: 'Organization', default_repository_permission: 'read', members_can_create_public_repositories: true },
    'user/memberships/orgs/popcre': { state: 'active', role: 'admin' },
    'orgs/popcre/actions/permissions': { enabled_repositories: 'all', allowed_actions: 'all' },
  }
  for (const ref of ['merge', 'preview', 'production', 'author-acquisition']) {
    routes[`repos/${SOURCE}/git/ref/db-coordination/${ref}`] = notFound
  }
  for (const status of ACTIVE_RUN_STATUSES) {
    routes[`repos/${SOURCE}/actions/runs?status=${status}&per_page=${PAGE_SIZE}&page=1`] = { workflow_runs: [] }
  }
  Object.assign(routes, overrides)
  const calls = []
  const runner = (args) => {
    assert.equal(args[0], 'api')
    assert.equal(args.length, 2, 'every call is a bare GET with no method or body')
    const endpoint = args[1]
    calls.push(endpoint)
    if (!(endpoint in routes)) throw new Error(`GitHub command failed: unrouted ${endpoint} (HTTP 500)`)
    const answer = routes[endpoint]
    if (typeof answer === 'function') throw answer()
    return JSON.stringify(answer)
  }
  return { gh: makeGitHub(runner), calls }
}

const quietMarker = () => ({ state: 'none', marker: null, exitCode: 3 })
const WORKFLOWS = ['jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: "supabase/setup-cli@v1"\n']

function build(world, { marker = quietMarker, approval = 'https://github.com/u2giants/shared-db/issues/2530#issuecomment-1' } = {}) {
  const args = { repo: SOURCE, target: TARGET }
  if (approval) args.ownerApprovalComment = approval
  return buildBaseline({ args, gh: world.gh, markerRunner: marker, workflowTexts: WORKFLOWS, now: new Date('2026-09-16T00:00:00Z'), command: 'node x' })
}

test('complete inventory schema, immutable id and SHA, and readiness when everything is clear', () => {
  const baseline = build(fakeWorld())
  assert.equal(baseline.schemaVersion, 1)
  assert.equal(baseline.sourceSha, 'a'.repeat(40))
  assert.equal(baseline.generatingCommand, 'node x')
  const inv = baseline.inventory
  for (const key of ['repository', 'branchProtection', 'rulesets', 'actions', 'variables', 'secretNames', 'environments', 'collaborators', 'teams', 'webhooks', 'deployKeyTitles', 'releases', 'openPullRequestCount', 'openIssueCount', 'refs']) {
    assert.ok(key in inv, `inventory has ${key}`)
  }
  assert.equal(inv.repository.id, 1275568548)
  assert.equal(inv.repository.ownerType, 'User')
  assert.equal(baseline.target.destinationExists, false)
  assert.equal(baseline.readyToTransfer, true)
  assert.deepEqual(baseline.blockers, [])
})

test('ordering is deterministic regardless of API order', () => {
  const inv = build(fakeWorld()).inventory
  assert.deepEqual(inv.secretNames, ['ANTHROPIC_API_KEY', 'SYNC_TOKEN'])
  assert.deepEqual(inv.collaborators.map((c) => c.login), ['devopswithkube', 'u2giants'])
  assert.deepEqual(inv.environments.map((e) => e.name), ['preview', 'production'])
  assert.deepEqual(inv.branchProtection.requiredContexts, ['A check', 'Z check'])
  assert.deepEqual(inv.repository.topics, ['a', 'b'])
  assert.equal(JSON.stringify(build(fakeWorld())), JSON.stringify(build(fakeWorld())))
})

test('pagination follows full pages and stops on a short page', () => {
  const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({ name: `S${String(i).padStart(3, '0')}` }))
  const world = fakeWorld({
    [`repos/${SOURCE}/actions/secrets?per_page=${PAGE_SIZE}&page=1`]: { secrets: full },
    [`repos/${SOURCE}/actions/secrets?per_page=${PAGE_SIZE}&page=2`]: { secrets: [{ name: 'LAST' }] },
  })
  const names = build(world).inventory.secretNames
  assert.equal(names.length, PAGE_SIZE + 1)
  assert.ok(world.calls.includes(`repos/${SOURCE}/actions/secrets?per_page=${PAGE_SIZE}&page=2`))
  assert.ok(!world.calls.includes(`repos/${SOURCE}/actions/secrets?per_page=${PAGE_SIZE}&page=3`))
})

test('an API refusal on a required category refuses the capture instead of recording absence', () => {
  const world = fakeWorld({ [`repos/${SOURCE}/actions/secrets?per_page=${PAGE_SIZE}&page=1`]: () => new Error('GitHub command failed: HTTP 403') })
  assert.throws(() => build(world), /HTTP 403/)
})

test('target collision and wrong destination owner type are exact blockers', () => {
  const world = fakeWorld({
    [`repos/${TARGET}`]: { id: 9 },
    'orgs/popcre': { type: 'User', members_can_create_public_repositories: false },
  })
  const baseline = build(world)
  assert.equal(baseline.readyToTransfer, false)
  assert.ok(baseline.blockers.includes('target-collision: popcre/shared-db already exists'))
  assert.ok(baseline.blockers.includes('target-owner-not-organization: popcre type is User'))
})

test('unreadable destination existence is never treated as absent', () => {
  const world = fakeWorld({ [`repos/${TARGET}`]: () => new Error('GitHub command failed: HTTP 502') })
  const baseline = build(world)
  assert.ok(baseline.blockers.includes('target-collision: popcre/shared-db existence could not be proven absent'))
})

test('missing source admin, destination create right and unreadable Actions policy block', () => {
  const world = fakeWorld({
    [`repos/${SOURCE}`]: { ...fakeWorld().gh.get(`repos/${SOURCE}`), permissions: { admin: false } },
    'user/memberships/orgs/popcre': { state: 'pending', role: 'member' },
    'orgs/popcre/actions/permissions': () => new Error('GitHub command failed: gh: must be an org admin (HTTP 403)'),
  })
  const { blockers } = build(world)
  assert.ok(blockers.includes('source-admin-absent: authenticated user lacks admin on the source repository'))
  assert.ok(blockers.some((b) => b.startsWith('destination-create-right-unproven: membership state=pending role=member')))
  assert.ok(blockers.includes('destination-actions-policy-unverified: GitHub command failed: gh: must be an org admin (HTTP 403)'))
})

test('a local-only destination Actions policy names every third-party action it would block', () => {
  const world = fakeWorld({ 'orgs/popcre/actions/permissions': { enabled_repositories: 'all', allowed_actions: 'local_only' } })
  assert.ok(build(world).blockers.includes('destination-actions-policy-disallows: actions/checkout, supabase/setup-cli'))
})

test('a selected-repositories destination Actions policy blocks readiness even when all actions are allowed', () => {
  const world = fakeWorld({ 'orgs/popcre/actions/permissions': { enabled_repositories: 'selected', allowed_actions: 'all' } })
  const { blockers, readyToTransfer } = build(world)
  assert.ok(blockers.includes('destination-actions-policy-disallows: selected-repositories policy does not enable a transferred repository automatically'))
  assert.equal(readyToTransfer, false)
})

test('active lanes, active runs, an open marker and missing owner approval each block readiness', () => {
  const world = fakeWorld({
    [`repos/${SOURCE}/git/ref/db-coordination/merge`]: { ref: 'refs/db-coordination/merge' },
    [`repos/${SOURCE}/actions/runs?status=in_progress&per_page=${PAGE_SIZE}&page=1`]: { workflow_runs: [{ id: 7, name: 'Guarded Merge', status: 'in_progress', event: 'workflow_dispatch', head_sha: 'd'.repeat(40) }] },
  })
  const baseline = build(world, { marker: () => ({ state: 'declared', marker: 3106, exitCode: 0 }), approval: null })
  assert.equal(baseline.readyToTransfer, false)
  assert.deepEqual(baseline.blockers, [
    'owner-authorization-not-recorded: plan Step 0 authorization comment on #2530 was not supplied (--owner-approval-comment <comment-url>)',
    'orchestrator-not-quiescent: marker state declared (#3106); the live orchestrator must confirm quiescence for the window',
    'mutation-lane-held: refs/db-coordination/merge',
    'actions-run-active: Guarded Merge run 7 (in_progress)',
  ])
})

test('an unknown orchestrator answer is not quiescence', () => {
  const r = classifyReadiness({
    target: { destinationExists: false, destinationOwnerType: 'Organization', sourceAdmin: true, destinationCanCreateRepository: true, destinationActionsPolicy: {}, destinationActionsDisallowed: [] },
    operational: { orchestrator: { state: 'unknown', marker: null }, heldLanes: [], activeRuns: [] },
    ownerApprovalComment: 'x',
  })
  assert.deepEqual(r.blockers, ['orchestrator-not-quiescent: marker state unknown; the live orchestrator must confirm quiescence for the window'])
})

test('variables commit fingerprints, and literals only for bare flags', () => {
  assert.deepEqual(describeVariable({ name: 'F', value: 'false' }).literal, 'false')
  const opaque = describeVariable({ name: 'APP', value: 'v6z1sveur7e32dub1dp3ao4v' })
  assert.equal(opaque.literal, null)
  assert.match(opaque.fingerprintSha256, /^[0-9a-f]{64}$/)
  assert.ok(!JSON.stringify(build(fakeWorld())).includes('v6z1sveur7e32dub1dp3ao4v'))
})

test('refs keep branches and tags in full and digest every namespace', () => {
  const s = summarizeRefs([
    { ref: 'refs/heads/main', object: { sha: '1' } },
    { ref: 'refs/db-claims/2', object: { sha: '2' } },
    { ref: 'refs/db-claims/1', object: { sha: '3' } },
    { ref: 'refs/tags/v1', object: { sha: '4' } },
  ])
  assert.equal(s.total, 4)
  assert.deepEqual(s.branches, [{ name: 'main', sha: '1' }])
  assert.deepEqual(s.tags, [{ name: 'v1', sha: '4' }])
  assert.deepEqual(s.namespaces.map((n) => [n.namespace, n.count]), [['refs/db-claims', 2], ['refs/heads', 1], ['refs/tags', 1]])
  const reordered = summarizeRefs([{ ref: 'refs/db-claims/1', object: { sha: '3' } }, { ref: 'refs/tags/v1', object: { sha: '4' } }, { ref: 'refs/heads/main', object: { sha: '1' } }, { ref: 'refs/db-claims/2', object: { sha: '2' } }])
  assert.equal(reordered.allRefsDigestSha256, s.allRefsDigestSha256)
})

test('actionsUsed strips versions and keeps local actions', () => {
  assert.deepEqual(actionsUsed(['- uses: actions/checkout@v4\n  - uses: ./.github/actions/x\n uses: actions/checkout@v5 # c']), ['./.github/actions/x', 'actions/checkout'])
})

test('redactionAudit positive controls: forbidden field names are refused', () => {
  for (const key of ['value', 'encrypted_value', 'key', 'token', 'password', 'authorization', 'Authorization', 'private_key', 'accessToken', 'dbPassword']) {
    assert.ok(redactionAudit({ nested: [{ [key]: 'x' }] }).length > 0, `${key} refused`)
  }
})

test('redactionAudit positive controls: secret-looking payloads are refused anywhere', () => {
  const payloads = [
    'ghp_' + 'A'.repeat(36),
    'github_pat_' + 'B'.repeat(30),
    'sk-ant-' + 'c'.repeat(30),
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA',
    'op://vibe_coding/item/field',
    'Bearer abcdefghijklmnopqrstuvwxyz0123',
    'sbp_' + 'd'.repeat(40),
    'postgresql://postgres:hunter2@db.example.com:5432/postgres',
  ]
  for (const payload of payloads) {
    assert.ok(redactionAudit({ harmless: { list: [payload] } }).length > 0, `${payload.slice(0, 12)} refused`)
  }
})

test('redactionAudit accepts secret NAMES and ordinary settings', () => {
  assert.deepEqual(redactionAudit({ secretNames: ['SUPABASE_ACCESS_TOKEN', 'SYNC_TOKEN'], deployKeyTitles: [], name: 'shared-db', sha: 'a'.repeat(40) }), [])
})

test('buildBaseline refuses to return an artifact that fails the redaction audit', () => {
  const world = fakeWorld({ [`repos/${SOURCE}/actions/variables?per_page=${PAGE_SIZE}&page=1`]: { variables: [{ name: 'op://vault/item', value: 'x' }] } })
  assert.throws(() => build(world), (error) => error instanceof BaselineError && /redaction audit refused/.test(error.message))
})

test('the CLI requires an explicit source and target and rejects unknown flags', () => {
  assert.throws(() => parseArgs(['--target', TARGET]), /--repo owner\/name is required/)
  assert.throws(() => parseArgs(['--repo', SOURCE]), /--target owner\/name is required/)
  assert.throws(() => parseArgs(['--repo', SOURCE, '--target', TARGET, '--write']), /unknown argument/)
  assert.deepEqual(parseArgs(['--repo', SOURCE, '--target', TARGET, '--output', 'o.json']), { repo: SOURCE, target: TARGET, output: 'o.json' })
})
