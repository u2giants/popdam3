#!/usr/bin/env node
/**
 * Repeatable, redacted repository-transfer baseline (issue #2530, plan
 * `plan_shared_db_popcre_transfer_merge_queue.md` §9 Step 1).
 *
 * READ-ONLY. Every GitHub call is a GET through the governed transport. The
 * command never mutates GitHub, never touches a database, and writes a file
 * only when `--output` is given.
 *
 * USAGE
 *   node scripts/capture-repository-transfer-baseline.mjs \
 *     --repo u2giants/shared-db --target popcre/shared-db \
 *     [--output docs/verification/shared-db-popcre-transfer-preflight-<UTC>.json]
 *
 * EXIT CODES
 *   0  baseline captured (readyToTransfer may still be false -- read `blockers`)
 *   1  capture refused (redaction audit failure, unreadable required category)
 *   2  usage error
 *
 * WHAT IS DELIBERATELY NOT RECORDED
 *   - Secret values (GitHub cannot return them; the audit refuses them anyway).
 *   - Repository variable values: only a SHA-256 fingerprint is committed, plus
 *     the literal value when it is a bare boolean or integer flag. The repository
 *     is public; a fingerprint is enough to prove "unchanged" after transfer.
 *   - The full list of ~8,000 coordination refs. Branches and tags are listed
 *     in full; every other ref namespace is recorded as a count plus a SHA-256
 *     digest of its sorted `ref sha` lines, which is exactly as strong for a
 *     before/after comparison and keeps the public artifact reviewable.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGitHubCommand } from './lib/github-transport.mjs'

export const SCHEMA_VERSION = 1
export const PAGE_SIZE = 100
export const MAX_PAGES = 200

/** Exclusive stage leases; a present ref means a mutation lane is held. */
export const LANE_REFS = Object.freeze([
  'refs/db-coordination/merge',
  'refs/db-coordination/preview',
  'refs/db-coordination/production',
  'refs/db-coordination/author-acquisition',
])

export const ACTIVE_RUN_STATUSES = Object.freeze(['in_progress', 'queued', 'waiting', 'requested', 'pending'])

export class BaselineError extends Error {}

// ---------------------------------------------------------------------------
// Redaction audit
// ---------------------------------------------------------------------------

const FORBIDDEN_KEY = /^(value|encrypted_value|key|private_key|token|access_token|password|secret|authorization|client_secret)$/i
const FORBIDDEN_KEY_FRAGMENT = /(token|password|passwd|private[_-]?key|authorization|encrypted)/i
const SECRET_VALUE_PATTERNS = [
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['API key', /\bsk-[A-Za-z0-9_-]{16,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['PEM material', /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/],
  ['SSH public key', /\bssh-(rsa|ed25519|dss) AAAA/],
  ['1Password reference', /\bop:\/\//i],
  ['Authorization header', /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{16,}/],
  ['Supabase key', /\bsbp_[A-Za-z0-9]{20,}/],
  ['Postgres URL with password', /postgres(ql)?:\/\/[^:\s/]+:[^@\s]+@/i],
]

// Keys whose NAME contains a forbidden fragment but whose content is a
// structural GitHub setting, not credential material.
const ALLOWED_KEY_NAMES = new Set(['secretNames', 'environmentSecretNames', 'deployKeyTitles'])

/**
 * Walk a value and return every redaction finding. Empty array means clean.
 * Refuses forbidden field NAMES anywhere in the tree and secret-looking string
 * payloads in any value position.
 */
export function redactionAudit(value, trail = '$') {
  const findings = []
  if (typeof value === 'string') {
    for (const [label, pattern] of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) findings.push(`${trail}: ${label}-shaped payload`)
    }
    return findings
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findings.push(...redactionAudit(item, `${trail}[${index}]`)))
    return findings
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const here = `${trail}.${key}`
      if (!ALLOWED_KEY_NAMES.has(key) && (FORBIDDEN_KEY.test(key) || FORBIDDEN_KEY_FRAGMENT.test(key))) {
        findings.push(`${here}: forbidden field name`)
      }
      findings.push(...redactionAudit(child, here))
    }
  }
  return findings
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function parseSlug(slug, flag) {
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(String(slug ?? ''))
  if (!match) throw new BaselineError(`${flag} must be owner/name, got: ${slug ?? '<absent>'}`)
  return { owner: match[1], name: match[2], slug: `${match[1]}/${match[2]}` }
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const byKey = (key) => (a, b) => String(a[key]).localeCompare(String(b[key]))
const sortedStrings = (list) => [...list].map(String).sort((a, b) => a.localeCompare(b))

/** A variable value is committed literally only when it is a bare flag. */
export function describeVariable({ name, value }) {
  const literal = /^(true|false|\d{1,6})$/i.test(String(value)) ? String(value) : null
  return { name, fingerprintSha256: sha256(String(value)), literal }
}

/** Group refs: heads/tags in full, everything else as count + digest. */
export function summarizeRefs(refs) {
  const rows = refs.map((r) => ({ ref: r.ref, sha: r.object?.sha ?? r.sha })).sort(byKey('ref'))
  const namespaces = new Map()
  const branches = []
  const tags = []
  for (const row of rows) {
    if (row.ref.startsWith('refs/heads/')) branches.push({ name: row.ref.slice(11), sha: row.sha })
    else if (row.ref.startsWith('refs/tags/')) tags.push({ name: row.ref.slice(10), sha: row.sha })
    const ns = row.ref.split('/').slice(0, 2).join('/')
    if (!namespaces.has(ns)) namespaces.set(ns, [])
    namespaces.get(ns).push(`${row.ref} ${row.sha}`)
  }
  return {
    total: rows.length,
    allRefsDigestSha256: sha256(rows.map((r) => `${r.ref} ${r.sha}`).join('\n')),
    namespaces: [...namespaces.entries()]
      .map(([namespace, lines]) => ({ namespace, count: lines.length, digestSha256: sha256(lines.join('\n')) }))
      .sort(byKey('namespace')),
    branches,
    tags,
  }
}

/** Every `uses:` reference in the workflow sources, owner/repo only, sorted. */
export function actionsUsed(workflowTexts) {
  const found = new Set()
  for (const text of workflowTexts) {
    for (const match of text.matchAll(/^\s*-?\s*uses:\s*["']?([^\s"'#]+)/gm)) {
      const ref = match[1]
      if (ref.startsWith('./') || ref.startsWith('docker://')) found.add(ref)
      else found.add(ref.split('@')[0])
    }
  }
  return sortedStrings(found)
}

/**
 * Decide readiness. Every blocker is an exact, stable string so a later run
 * can be diffed against this one.
 */
export function classifyReadiness({ target, operational, ownerApprovalComment }) {
  const blockers = []
  if (!ownerApprovalComment) {
    blockers.push('owner-authorization-not-recorded: plan Step 0 authorization comment on #2530 was not supplied (--owner-approval-comment <comment-url>)')
  }
  if (target.destinationExists !== false) {
    blockers.push(`target-collision: ${target.destination} ${target.destinationExists === true ? 'already exists' : 'existence could not be proven absent'}`)
  }
  if (target.destinationOwnerType !== 'Organization') {
    blockers.push(`target-owner-not-organization: ${target.destinationOwner} type is ${target.destinationOwnerType ?? 'unreadable'}`)
  }
  if (target.sourceAdmin !== true) blockers.push('source-admin-absent: authenticated user lacks admin on the source repository')
  if (target.destinationCanCreateRepository !== true) {
    blockers.push(`destination-create-right-unproven: ${target.destinationCreateEvidence}`)
  }
  if (target.destinationActionsPolicy === null) {
    blockers.push(`destination-actions-policy-unverified: ${target.destinationActionsPolicyError}`)
  } else if (target.destinationActionsDisallowed.length > 0) {
    blockers.push(`destination-actions-policy-disallows: ${target.destinationActionsDisallowed.join(', ')}`)
  }
  if (operational.orchestrator.state !== 'none') {
    blockers.push(`orchestrator-not-quiescent: marker state ${operational.orchestrator.state}${operational.orchestrator.marker ? ` (#${operational.orchestrator.marker})` : ''}; the live orchestrator must confirm quiescence for the window`)
  }
  for (const lane of operational.heldLanes) blockers.push(`mutation-lane-held: ${lane}`)
  for (const run of operational.activeRuns) blockers.push(`actions-run-active: ${run.workflow} run ${run.id} (${run.status})`)
  return { readyToTransfer: blockers.length === 0, blockers }
}

// ---------------------------------------------------------------------------
// GitHub reads (injected for tests)
// ---------------------------------------------------------------------------

const NOT_FOUND = /HTTP 404|Not Found/

export function makeGitHub(runner = runGitHubCommand) {
  const get = (endpoint) => JSON.parse(runner(['api', endpoint], { expectedFailure: NOT_FOUND }))
  return {
    get,
    /** GET that answers `null` for HTTP 404 instead of throwing. */
    getOptional(endpoint) {
      try {
        return get(endpoint)
      } catch (error) {
        if (NOT_FOUND.test(String(error?.message ?? ''))) return null
        throw error
      }
    },
    /** Page with explicit page numbers so every page is observable in tests. */
    getAll(endpoint, pick = (body) => body) {
      const out = []
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const sep = endpoint.includes('?') ? '&' : '?'
        const items = pick(get(`${endpoint}${sep}per_page=${PAGE_SIZE}&page=${page}`))
        if (!Array.isArray(items)) throw new BaselineError(`GitHub returned a non-list page for ${endpoint}`)
        out.push(...items)
        if (items.length < PAGE_SIZE) return out
      }
      throw new BaselineError(`pagination exceeded ${MAX_PAGES} pages for ${endpoint}`)
    },
  }
}

function tryRead(fn) {
  try {
    return { ok: true, value: fn() }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).split('\n')[0] }
  }
}

export function captureInventory(gh, source) {
  const base = `repos/${source.slug}`
  const repo = gh.get(base)
  const mainSha = gh.get(`${base}/commits/${encodeURIComponent(repo.default_branch)}`).sha
  const protection = gh.getOptional(`${base}/branches/${encodeURIComponent(repo.default_branch)}/protection`)
  const environments = gh.getAll(`${base}/environments`, (b) => b.environments).map((env) => ({
    name: env.name,
    protectionRules: (env.protection_rules ?? []).map((r) => ({ type: r.type })).sort(byKey('type')),
    deploymentBranchPolicy: env.deployment_branch_policy ?? null,
    environmentSecretNames: sortedStrings(gh.getAll(`${base}/environments/${encodeURIComponent(env.name)}/secrets`, (b) => b.secrets).map((s) => s.name)),
    variables: gh.getAll(`${base}/environments/${encodeURIComponent(env.name)}/variables`, (b) => b.variables).map(describeVariable).sort(byKey('name')),
  })).sort(byKey('name'))

  return {
    repository: {
      id: repo.id,
      nodeId: repo.node_id,
      owner: repo.owner.login,
      ownerType: repo.owner.type,
      name: repo.name,
      visibility: repo.visibility,
      archived: repo.archived,
      defaultBranch: repo.default_branch,
      defaultBranchSha: mainSha,
      topics: sortedStrings(repo.topics ?? []),
      features: {
        hasIssues: repo.has_issues, hasProjects: repo.has_projects, hasWiki: repo.has_wiki,
        hasDiscussions: repo.has_discussions, hasPages: repo.has_pages,
      },
      mergeMethods: {
        allowMergeCommit: repo.allow_merge_commit, allowSquashMerge: repo.allow_squash_merge,
        allowRebaseMerge: repo.allow_rebase_merge, allowAutoMerge: repo.allow_auto_merge,
        deleteBranchOnMerge: repo.delete_branch_on_merge, allowUpdateBranch: repo.allow_update_branch,
      },
    },
    branchProtection: protection === null ? null : {
      strict: protection.required_status_checks?.strict ?? null,
      requiredContexts: sortedStrings(protection.required_status_checks?.contexts ?? []),
      enforceAdmins: protection.enforce_admins?.enabled ?? null,
      requiredPullRequestReviews: protection.required_pull_request_reviews ? {
        requiredApprovingReviewCount: protection.required_pull_request_reviews.required_approving_review_count ?? null,
      } : null,
      requiredLinearHistory: protection.required_linear_history?.enabled ?? null,
      allowForcePushes: protection.allow_force_pushes?.enabled ?? null,
      allowDeletions: protection.allow_deletions?.enabled ?? null,
    },
    rulesets: gh.getAll(`${base}/rulesets`).map((r) => ({ id: r.id, name: r.name, target: r.target, enforcement: r.enforcement })).sort(byKey('id')),
    actions: {
      permissions: gh.get(`${base}/actions/permissions`),
      workflowPermissions: gh.get(`${base}/actions/permissions/workflow`),
      workflows: gh.getAll(`${base}/actions/workflows`, (b) => b.workflows).map((w) => ({ name: w.name, path: w.path, state: w.state })).sort(byKey('path')),
    },
    variables: gh.getAll(`${base}/actions/variables`, (b) => b.variables).map(describeVariable).sort(byKey('name')),
    secretNames: sortedStrings(gh.getAll(`${base}/actions/secrets`, (b) => b.secrets).map((s) => s.name)),
    environments,
    collaborators: gh.getAll(`${base}/collaborators?affiliation=direct`).map((c) => ({ login: c.login, roleName: c.role_name })).sort(byKey('login')),
    teams: gh.getAll(`${base}/teams`).map((t) => ({ slug: t.slug, permission: t.permission })).sort(byKey('slug')),
    webhooks: gh.getAll(`${base}/hooks`).map((h) => ({
      id: h.id, name: h.name, active: h.active, events: sortedStrings(h.events ?? []),
      host: (() => { try { return new URL(h.config?.url).host } catch { return null } })(),
    })).sort(byKey('id')),
    deployKeyTitles: gh.getAll(`${base}/keys`).map((k) => ({ title: k.title, readOnly: k.read_only })).sort(byKey('title')),
    releases: gh.getAll(`${base}/releases`).map((r) => ({ tag: r.tag_name, draft: r.draft, prerelease: r.prerelease })).sort(byKey('tag')),
    openPullRequestCount: gh.get(`search/issues?q=${encodeURIComponent(`repo:${source.slug} is:pr is:open`)}&per_page=1`).total_count,
    openIssueCount: gh.get(`search/issues?q=${encodeURIComponent(`repo:${source.slug} is:issue is:open`)}&per_page=1`).total_count,
    refs: summarizeRefs(gh.get(`${base}/git/matching-refs/`)),
  }
}

export function captureTarget(gh, source, destination, usedActions, sourceRepo) {
  const exists = tryRead(() => gh.getOptional(`repos/${destination.slug}`))
  const org = tryRead(() => gh.get(`orgs/${destination.owner}`))
  const membership = tryRead(() => gh.get(`user/memberships/orgs/${destination.owner}`))
  const orgActions = tryRead(() => gh.get(`orgs/${destination.owner}/actions/permissions`))

  let canCreate = false
  let createEvidence = 'membership unreadable'
  if (membership.ok) {
    const { state, role } = membership.value
    const orgAllowsMembers = org.ok && org.value.members_can_create_public_repositories === true
    canCreate = state === 'active' && (role === 'admin' || orgAllowsMembers)
    createEvidence = `membership state=${state} role=${role}; members_can_create_public_repositories=${org.ok ? org.value.members_can_create_public_repositories : 'unreadable'}`
  } else {
    createEvidence = `membership unreadable: ${membership.error}`
  }

  let disallowed = []
  if (orgActions.ok) {
    const policy = orgActions.value
    if (policy.enabled_repositories === 'none') disallowed = ['actions disabled for organization repositories']
    else if (policy.enabled_repositories === 'selected') disallowed = ['selected-repositories policy does not enable a transferred repository automatically']
    else if (policy.allowed_actions === 'local_only') disallowed = usedActions.filter((a) => !a.startsWith('./'))
    else if (policy.allowed_actions === 'selected') disallowed = ['selected-actions policy requires manual allowlist comparison']
  }

  return {
    source: source.slug,
    destination: destination.slug,
    destinationOwner: destination.owner,
    destinationExists: exists.ok ? exists.value !== null : null,
    destinationExistsError: exists.ok ? null : exists.error,
    destinationOwnerType: org.ok ? org.value.type : null,
    destinationDefaultRepositoryPermission: org.ok ? org.value.default_repository_permission : null,
    sourceAdmin: sourceRepo.permissions?.admin === true,
    destinationCanCreateRepository: canCreate,
    destinationCreateEvidence: createEvidence,
    sourceActionsPolicy: null,
    destinationActionsPolicy: orgActions.ok ? { enabledRepositories: orgActions.value.enabled_repositories, allowedActions: orgActions.value.allowed_actions } : null,
    destinationActionsPolicyError: orgActions.ok ? null : orgActions.error,
    destinationActionsDisallowed: disallowed,
    actionsUsed: usedActions,
  }
}

export function captureOperational(gh, source, markerRunner) {
  const marker = markerRunner(source.slug)
  const heldLanes = LANE_REFS.filter((ref) => gh.getOptional(`repos/${source.slug}/git/ref/${ref.slice(5)}`) !== null)
  const activeRuns = []
  for (const status of ACTIVE_RUN_STATUSES) {
    for (const run of gh.getAll(`repos/${source.slug}/actions/runs?status=${status}`, (b) => b.workflow_runs)) {
      activeRuns.push({ id: run.id, workflow: run.name, status: run.status, event: run.event, headSha: run.head_sha })
    }
  }
  return {
    orchestrator: marker,
    heldLanes,
    activeRuns: activeRuns.sort(byKey('id')),
  }
}

/** Resolve the orchestrator marker through the sanctioned script. */
export function defaultMarkerRunner(repo) {
  const script = fileURLToPath(new URL('./check-orchestrator-marker.mjs', import.meta.url))
  let stdout
  let exitCode = 0
  try {
    stdout = execFileSync(process.execPath, [script, '--resolve', '--repo', repo, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    stdout = String(error.stdout ?? '')
    exitCode = error.status ?? 2
  }
  let parsed = null
  try { parsed = JSON.parse(stdout) } catch { parsed = null }
  if (exitCode === 3) return { state: 'none', marker: null, exitCode }
  if (!parsed) return { state: 'unknown', marker: null, exitCode }
  return { state: exitCode === 0 ? String(parsed.state ?? 'declared') : `refused-exit-${exitCode}`, marker: parsed.marker ?? null, exitCode }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (['--repo', '--target', '--output', '--owner-approval-comment', '--workflows-dir'].includes(flag)) {
      if (argv[i + 1] === undefined) throw new BaselineError(`${flag} needs a value`)
      out[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i]
    } else {
      throw new BaselineError(`unknown argument: ${flag}`)
    }
  }
  if (!out.repo) throw new BaselineError('--repo owner/name is required; the source repository is never defaulted')
  if (!out.target) throw new BaselineError('--target owner/name is required')
  return out
}

export function buildBaseline({ args, gh, markerRunner, workflowTexts, now = new Date(), command }) {
  const source = parseSlug(args.repo, '--repo')
  const destination = parseSlug(args.target, '--target')
  const inventory = captureInventory(gh, source)
  const sourceRepo = gh.get(`repos/${source.slug}`)
  const usedActions = actionsUsed(workflowTexts)
  const target = captureTarget(gh, source, destination, usedActions, sourceRepo)
  target.sourceActionsPolicy = inventory.actions.permissions
  const operational = captureOperational(gh, source, markerRunner)
  const readiness = classifyReadiness({ target, operational, ownerApprovalComment: args.ownerApprovalComment ?? null })
  const baseline = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'repository-transfer-baseline',
    capturedAt: now.toISOString(),
    generatingCommand: command,
    sourceSha: inventory.repository.defaultBranchSha,
    ownerApprovalComment: args.ownerApprovalComment ?? null,
    readyToTransfer: readiness.readyToTransfer,
    blockers: readiness.blockers,
    inventory,
    target,
    operational,
  }
  const findings = redactionAudit(baseline)
  if (findings.length > 0) throw new BaselineError(`redaction audit refused the baseline:\n  ${findings.join('\n  ')}`)
  return baseline
}

function readWorkflowTexts(dir) {
  return readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => readFileSync(path.join(dir, f), 'utf8'))
}

export function main(argv = process.argv.slice(2)) {
  let args
  try {
    args = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
  try {
    const repoRoot = fileURLToPath(new URL('..', import.meta.url))
    const baseline = buildBaseline({
      args,
      gh: makeGitHub(),
      markerRunner: defaultMarkerRunner,
      workflowTexts: readWorkflowTexts(args.workflowsDir ?? path.join(repoRoot, '.github', 'workflows')),
      command: ['node', 'scripts/capture-repository-transfer-baseline.mjs', ...argv.map((a) => a.replaceAll('\\', '/'))].join(' '),
    })
    const text = `${JSON.stringify(baseline, null, 2)}\n`
    if (args.output) {
      mkdirSync(path.dirname(args.output), { recursive: true })
      writeFileSync(args.output, text)
      process.stdout.write(`wrote ${args.output}\nreadyToTransfer=${baseline.readyToTransfer}\n${baseline.blockers.map((b) => `  - ${b}`).join('\n')}\n`)
    } else {
      process.stdout.write(text)
    }
    return 0
  } catch (error) {
    process.stderr.write(`capture refused: ${String(error?.message ?? error)}\n`)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
