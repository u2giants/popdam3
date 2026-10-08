#!/usr/bin/env node
// Fresh effective GitHub settings are the authority. The committed mirror is
// informational only: neither expiry nor checking every reported job detects a
// newly required check that has never reported. Unknown authority refuses.
import { readFileSync, openSync, closeSync, fstatSync, lstatSync, writeFileSync, appendFileSync, unlinkSync, constants } from 'node:fs'
import path from 'node:path'
import { validateContract } from './agent-work-contract.mjs'
import { parseQueueScope } from './lib/lanes/queue-routing.mjs'
import { pathToFileURL } from 'node:url'
import { runGitHubCommand } from './lib/github-transport.mjs'
import { resolveRepositoryIdentity } from './lib/repository-identity.mjs'
import { readEffectiveRequiredChecks, computeRevision, probeAuthorityReadPermissions } from './lib/required-check-authority.mjs'
import { aggregateVerdict, loadRegistry } from './orchestrator-flow/runner-lanes.mjs'
import { MERGE_SELF_CONTEXT as SELF_CONTEXT } from './lib/merge-self-context.mjs'
export { SELF_CONTEXT }
export class PreflightError extends Error {}
export const SELF_CHECK_RUN = 'merge'
export const REQUIRED_CHECKS_MIRROR = 'docs/verification/main-required-status-checks.json'
// The GitHub Actions app (github-actions[bot]) is the only producer of the self
// authorization status this workflow posts after every other gate passes. A
// different producer on that context means someone other than this workflow
// claimed the self-authorization identity (see check-required-checks-preflight
// self-authorization tests and issue #3361).
export const GITHUB_ACTIONS_APP_ID = 15368
const REQUIRED_SUCCESS = new Set(['success'])
const REPORTED_SUCCESS = new Set(['success', 'neutral', 'skipped'])

// Keep the producer partition until AFTER selecting the newest result. A newer
// success from a different app must never mask the required app's failure.
export function observedStates({ statuses = [], checkRuns = [], appId, sha }) {
  const seen = new Map()
  const put = (name, kind, id, timestamp, state) => {
    const key = `${kind}:${name}`
    const at = Date.parse(timestamp)
    const orderedId = Number.isSafeInteger(id) && id > 0 ? id : null
    const current = { name, at, id: orderedId, state }
    if (orderedId === null && !Number.isFinite(at)) current.state = 'ambiguous'
    const prior = seen.get(key)
    if (!prior) { seen.set(key, current); return }
    // IDs order attempts even when a queued run has no started_at yet. Compare
    // IDs only within one API channel; status and check IDs use different sets.
    const order = prior.id !== null && orderedId !== null ? orderedId - prior.id : at - prior.at
    if (!Number.isFinite(order) || (order === 0 && prior.state !== current.state)) seen.set(key, { ...current, state: 'ambiguous' })
    else if (order > 0) seen.set(key, current)
  }
  for (const s of statuses) {
    if (!s?.context) continue
    if (appId != null && s.app != null && s.app.id !== appId) continue
    // REST commit-status objects carry `creator`, not `app`. When the producer
    // is unverifiable and the requirement is app-bound, a success must not
    // satisfy it (fail-closed) but a non-success must remain visible so a
    // red status can never hide behind a green same-name check run.
    if (appId != null && s.app == null && REQUIRED_SUCCESS.has(String(s.state ?? ''))) continue
    put(s.context, 'status', s.id, s.updated_at ?? s.created_at, String(s.state ?? ''))
  }
  for (const r of checkRuns) {
    if (!r?.name || (appId != null && r.app?.id !== appId)) continue
    if (sha && r.head_sha !== sha) continue
    put(r.name, 'check', r.id, r.started_at ?? r.completed_at, r.status === 'completed' ? String(r.conclusion ?? '') : 'pending')
  }
  const states = new Map()
  for (const { name, state } of seen.values()) {
    // GitHub requires BOTH channels when a commit status and a check share a
    // required name. One channel's success must never overwrite the other's red.
    if (!states.has(name) || states.get(name) === 'success') states.set(name, state)
    else if (state !== 'success' && states.get(name) !== state) states.set(name, 'ambiguous')
  }
  return states
}
export function evaluatePreflight({ authority, statuses = [], checkRuns = [], sha, retirement = null }) {
  if (authority?.mode !== 'live-effective-settings' || !/^[a-f0-9]{64}$/.test(authority?.revision ?? '') || !Array.isArray(authority?.checks) || !authority.checks.length || !/^[a-f0-9]{40}$/.test(sha ?? '')) throw new PreflightError('fresh effective required-check authority and exact reviewed head are required')
  // Rebind the revision to the authority's own content. A shape-only hex string
  // is not proof; recomputing the digest from {repository_id, repository,
  // branch, sources, checks} refuses an authority whose recorded revision does not
  // match what it actually carries, including the enforced checks list.
  if (computeRevision(authority) !== authority.revision) throw new PreflightError('effective required-check authority revision does not match its own content; refusing a tampered or stale digest')
  if (retirement) validateRetirement(retirement, authority, statuses, checkRuns, sha)
  const required = (retirement ? RETAINED_QUEUE_CHECKS : authority.checks).filter((item) => item.context !== SELF_CONTEXT)
  if (!required.length) throw new PreflightError('effective settings name only the self authorization; no independent required checks')
  // The self authorization is produced later by this workflow's GitHub Actions
  // app. Exclusion is safe only for that producer (or an unrestricted context).
  if (authority.checks.some((item) => item.context === SELF_CONTEXT && item.app_id != null && item.app_id !== GITHUB_ACTIONS_APP_ID)) throw new PreflightError('self authorization requires a different producer')
  const missing = [], pending = [], failing = []
  for (const item of required) {
    const states = observedStates({ statuses, checkRuns, appId: item.app_id, sha })
    const state = states.get(item.context)
    const label = `${item.context}${item.app_id == null ? '' : ` [app ${item.app_id}]`}`
    if (state === undefined) missing.push(label)
    else if (REQUIRED_SUCCESS.has(state)) continue
    else if (state === 'pending' || state === '') pending.push(label)
    else failing.push(`${label} (${state})`)
  }
  if (missing.length || pending.length || failing.length) {
    const parts = []
    if (failing.length) parts.push(`failing: ${failing.join(', ')}`)
    if (pending.length) parts.push(`still running: ${pending.join(', ')}`)
    if (missing.length) parts.push(`never reported: ${missing.join(', ')}`)
    throw new PreflightError(`required status checks are not satisfied on the reviewed head — ${parts.join('; ')}. No retry can clear this, so the merge lane was not taken.`)
  }
  // The old runner aggregate was a separate waiting job. Keep the same exact-once
  // proof in this protected-main preflight, both before and under the merge lock.
  // Preserve the registry identity for dispatch/reroute consumers; never accept a
  // different app or head's lane result as evidence for this reviewed head.
  const registry = loadRegistry()
  if (registry.queue_sensitive_jobs.some((job) => required.some((item) => item.context === job.context))) {
    // filter=all includes queued reroutes; choose the newest attempt per name
    // only after exact-head and producer partitioning, as the old aggregate did.
    const laneStates = observedStates({ checkRuns, appId: GITHUB_ACTIONS_APP_ID, sha })
    const accounting = aggregateVerdict(registry, [...laneStates].map(([name, state]) => ({
      name, status: state === 'pending' ? 'in_progress' : 'completed', conclusion: state,
    })))
    if (accounting.verdict !== 'pass') {
      const absent = accounting.unreported ?? []
      const failed = (accounting.refusals ?? []).filter((reason) => !absent.includes(reason))
      const parts = []
      if (failed.length) parts.push(`failing: ${failed.join(', ')}`)
      if (accounting.pending?.length) parts.push(`still running: ${accounting.pending.join(', ')}`)
      if (absent.length) parts.push(`never reported: ${absent.join(', ')}`)
      throw new PreflightError(`runner lane accounting refused: ${parts.join('; ')}`)
    }
  }
  const requiredNames = new Set(authority.checks.map((item) => item.context))
  const advisory = [...observedStates({ statuses, checkRuns, sha })].filter(([name, state]) => !requiredNames.has(name) && name !== SELF_CHECK_RUN && !REPORTED_SUCCESS.has(state))
  return { required: retirement?.phase === '14' ? 14 : required.length, mode: authority.mode, revision: authority.revision, advisory, shadow: advisory.length ? 'old all-reported rule would refuse advisory results; effective required results pass' : 'no advisory disagreement' }
}
// Parent3536 owns this one-PR preservation route. Its closed target refuses;
// no subsequent PR inherits it. Reviewed original3998/gen5 retained capability,
// never a PR-controlled manifest or replacement for live settings authority.
export const RETAINED_QUEUE_CHECKS = Object.freeze([
  'SQL migration guards', 'supabase/tests against an ephemeral database',
  'Cross-PR object collision', 'Destructive SQL outside migrations', SELF_CONTEXT,
  'Merge queue gate', 'Cancelled work guard', 'Domain ownership', 'Handoff contract',
  'Intake pointer guard', 'Migration author lease', 'Promotion contract tests (offline)',
  'Tools offline tests', 'Queue-sensitive checks (aggregate)',
].map(context => Object.freeze({ context, app_id: GITHUB_ACTIONS_APP_ID })))
const RETIRED_QUEUE_CONTEXTS = new Set(['Merge queue gate', 'Queue-sensitive checks (aggregate)'])
const AUTHORIZED_DESCRIPTION = 'Exclusive merge lock held and exact head revalidated'
const GEN5_REF_SHA = '255db5769570f7c6aa648b31e42e69674fbb0a90'
export function authorityScratchPath(env) {
  if (!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '') || !path.isAbsolute(env.RUNNER_TEMP ?? '')) throw new PreflightError('authority scratch run/path identity refused')
  const parent = lstatSync(env.RUNNER_TEMP)
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid() || (parent.mode & 0o022) !== 0) throw new PreflightError('authority scratch parent owner refused')
  return path.join(env.RUNNER_TEMP, `guarded-authority-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}.json`)
}
const fileIdentity = s => `${s.dev}:${s.ino}:${s.uid}`
function verifiedAuthorityFile(env) {
  const filename = authorityScratchPath(env)
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const s = fstatSync(fd)
    if (!s.isFile() || s.uid !== process.getuid() || s.nlink !== 1 || (s.mode & 0o777) !== 0o600 || s.size < 1 || s.size > 65536 || fileIdentity(s) !== env.AUTHORITY_FILE_IDENTITY) throw new PreflightError('authority scratch file identity/permissions refused')
    const payload = JSON.parse(readFileSync(fd, 'utf8'))
    if (payload.run !== env.GITHUB_RUN_ID || payload.attempt !== env.GITHUB_RUN_ATTEMPT || payload.identity !== fileIdentity(s) || typeof payload.token !== 'string' || !payload.token.trim()) throw new PreflightError('authority scratch payload binding refused')
    if (fileIdentity(lstatSync(filename)) !== fileIdentity(s)) throw new PreflightError('authority scratch replaced during read')
    return {filename,identity:fileIdentity(s),token:payload.token}
  } catch (error) {
    if (error instanceof PreflightError) throw error
    throw new PreflightError('authority scratch content read refused')
  } finally { closeSync(fd) }
}
export function captureAuthorityFile(env) {
  const filename = authorityScratchPath(env)
  if (!String(env.AUTHORITY_TOKEN ?? '').trim() || !path.isAbsolute(env.GITHUB_OUTPUT ?? '')) throw new PreflightError('authority scratch capture inputs refused')
  let fd
  try { fd = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) } catch { throw new PreflightError('protected authority scratch creation refused') }
  const identity = fileIdentity(fstatSync(fd))
  try {
    writeFileSync(fd, JSON.stringify({run:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,identity,token:env.AUTHORITY_TOKEN}))
    closeSync(fd)
    appendFileSync(env.GITHUB_OUTPUT, `authority_file_identity=${identity}\n`)
    return identity
  } catch (error) {
    try { closeSync(fd) } catch {}
    if (fileIdentity(lstatSync(filename)) === identity) unlinkSync(filename)
    throw error
  }
}
export function readScratchAuthorityToken(env) { return verifiedAuthorityFile(env).token }
export function cleanupAuthorityFile(env) {
  if (!env.AUTHORITY_FILE_IDENTITY) return
  const file = verifiedAuthorityFile(env)
  const current = lstatSync(file.filename)
  if (current.isSymbolicLink() || current.nlink !== 1 || current.uid !== process.getuid() || fileIdentity(current) !== file.identity) throw new PreflightError('authority scratch cleanup ownership refused')
  unlinkSync(file.filename)
}
function authorityToken(env) {
  if (env.AUTHORITY_FILE_IDENTITY) {
    if (env.AUTHORITY_TOKEN) throw new PreflightError('authority scratch mode cannot inherit a secret environment')
    return readScratchAuthorityToken(env)
  }
  return String(env.AUTHORITY_TOKEN ?? '').trim()
}
const names = rows => rows.map(r => `${r.context}:${r.app_id}`).sort().join('\n')
export function validateRetirement(r, authority, statuses, checkRuns, sha) {
  const pr = r.pr
  if (!['13', '14'].includes(r.phase) || authority.repository !== 'popcre/shared-db' || authority.branch !== 'main' ||
      authority.sources?.classic?.requiresStrictStatusChecks !== false ||
      names(authority.checks) !== names(RETAINED_QUEUE_CHECKS.filter(c => !RETIRED_QUEUE_CONTEXTS.has(c.context))) ||
      pr?.number !== 3998 || pr.state !== 'open' || pr.head?.sha !== sha || pr.head?.repo?.full_name !== authority.repository ||
      pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== authority.repository ||
      r.issue?.number !== 3987 || r.issue.state !== 'open' || r.scope?.workType !== 'repo-maintenance' || r.scope?.route !== 'repo-maintenance' || r.scope?.status !== 'ready' ||
      r.links?.length !== 1 || r.links[0]?.number !== 3987 || r.contract?.work_issue !== 3987 || r.contract?.generation !== 5 || r.contract?.work_type !== 'repo-maintenance' || r.contract?.route !== 'repo-maintenance')
    throw new PreflightError('queue retirement scope or exact live12 authority refused')
  validateContract(r.contract)
  if (r.phase !== '14') return
  const receipt = r.receipt, run = r.run, workflow = r.workflow, suite = r.suite
  if (!Number.isSafeInteger(receipt?.id) || receipt.id <= 0 || receipt.context !== SELF_CONTEXT || receipt.state !== 'success' ||
      receipt.creator?.login !== 'github-actions[bot]' || receipt.description !== AUTHORIZED_DESCRIPTION ||
      receipt.url !== `https://api.github.com/repos/popcre/shared-db/statuses/${sha}` ||
      !Number.isSafeInteger(r.runId) || r.runId <= 0 || !Number.isSafeInteger(r.runAttempt) || r.runAttempt <= 0 ||
      run?.id !== r.runId || run.run_attempt !== r.runAttempt || run.event !== 'workflow_dispatch' ||
      run.head_sha !== authority.base_sha || r.sourceSha !== authority.base_sha || run.head_branch !== 'main' ||
      workflow?.id !== run.workflow_id || workflow.path !== '.github/workflows/guarded-migration-merge.yml' ||
      !Number.isSafeInteger(run.check_suite_id) || suite?.id !== run.check_suite_id || suite.app?.id !== GITHUB_ACTIONS_APP_ID || suite.head_sha !== run.head_sha)
    throw new PreflightError('self authorization current protected run/app/receipt binding refused')
  const self = statuses.filter(row => row.context === SELF_CONTEXT)
  if (self.some(row => !Number.isSafeInteger(row.id) || row.id <= 0) || new Set(self.map(row => row.id)).size !== self.length || !self.length) throw new PreflightError('self authorization newest status identity unreadable')
  const newest = self.reduce((a,b) => a.id > b.id ? a : b)
  if (newest.id !== receipt.id || newest.state !== 'success' || newest.creator?.login !== 'github-actions[bot]' || newest.description !== AUTHORIZED_DESCRIPTION ||
      (newest.app != null && newest.app.id !== GITHUB_ACTIONS_APP_ID)) throw new PreflightError('self authorization newest legitimate receipt refused')
  const selfChecks = checkRuns.filter(row => row.name === SELF_CONTEXT)
  if (selfChecks.some(row => row.app?.id !== GITHUB_ACTIONS_APP_ID || row.head_sha !== sha)) throw new PreflightError('self authorization check producer/head refused')
  if (selfChecks.length && observedStates({checkRuns:selfChecks,appId:GITHUB_ACTIONS_APP_ID,sha}).get(SELF_CONTEXT) !== 'success') throw new PreflightError('self authorization check channel is not SUCCESS')
}
function gatherRetirement(env, read, repo, authority) {
  const phase = String(env.QUEUE_RETIREMENT_PHASE ?? '')
  if (!phase) return null
  if (env.PR_NUMBER !== '3998' || repo !== 'popcre/shared-db') throw new PreflightError('queue retirement target refused')
  const pr = read(['api', `repos/${repo}/pulls/3998`])
  const issue = read(['api', `repos/${repo}/issues/3987`])
  const linked = read(['api', 'graphql', '-f', 'query=query { repository(owner:"popcre",name:"shared-db") { pullRequest(number:3998) { closingIssuesReferences(first:2) { nodes { number } pageInfo { hasNextPage } } } } }'])
  const connection = linked?.data?.repository?.pullRequest?.closingIssuesReferences
  if (linked.errors?.length || !Array.isArray(connection?.nodes) || connection.pageInfo?.hasNextPage !== false) throw new PreflightError('queue retirement closing issue identity unreadable')
  const ref = read(['api', `repos/${repo}/git/ref/db-contracts/3987/5`])
  if (!/^[a-f0-9]{40}$/.test(ref?.object?.sha ?? '')) throw new PreflightError('queue retirement contract ref unreadable')
  const commit = read(['api', `repos/${repo}/git/commits/${ref.object.sha}`])
  let contract
  try { contract = JSON.parse(String(commit.message ?? '').split('\n').slice(2).join('\n')) } catch { throw new PreflightError('retained contract unreadable') }
  // Immutable ref identity pinned independently; contract content is validated below.
  if (ref.object.sha !== GEN5_REF_SHA) throw new PreflightError('queue retirement original generation5 ref changed')
  const result = {phase,pr,issue,scope:parseQueueScope(issue.body ?? ''),links:connection.nodes,contract}
  if (phase === '14') {
    let receipt
    try { receipt = JSON.parse(readFileSync(env.SELF_AUTHORIZATION_RECEIPT, 'utf8')) } catch { throw new PreflightError('self authorization receipt unreadable') }
    const runId = Number(env.GITHUB_RUN_ID), runAttempt = Number(env.GITHUB_RUN_ATTEMPT)
    if (!Number.isSafeInteger(runId) || runId <= 0) throw new PreflightError('protected run identity unreadable')
    const run = read(['api', `repos/${repo}/actions/runs/${runId}`])
    if (!Number.isSafeInteger(run.workflow_id) || !Number.isSafeInteger(run.check_suite_id)) throw new PreflightError('protected run workflow/checksuite identity unreadable')
    Object.assign(result,{receipt,runId,runAttempt,run,sourceSha:env.TRUSTED_POLICY_SHA,
      workflow:read(['api', `repos/${repo}/actions/workflows/${run.workflow_id}`]),
      suite:read(['api', `repos/${repo}/check-suites/${run.check_suite_id}`])})
  }
  return result
}
function json(args) {
  const raw = runGitHubCommand(args, { wrapError: (detail) => new PreflightError(`GitHub read failed: ${detail}`) })
  try { return JSON.parse(raw) } catch { throw new PreflightError('GitHub returned malformed JSON') }
}
export function collectPages(payload, key) {
  const pages = Array.isArray(payload) ? payload : [payload]
  const out = []
  for (const page of pages) {
    if (!Array.isArray(page?.[key])) throw new PreflightError(`GitHub returned a page with no usable "${key}" list`)
    out.push(...page[key])
  }
  return out
}
export function sanitize(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return (flat.length > 200 ? `${flat.slice(0, 200)}...` : flat) || 'no reason was reported'
}
// Wrap a read function so authority calls use a different GH_TOKEN. The
// elevated token is used ONLY for branch-protection reads; every other read
// stays on the caller's default token. GH_TOKEN is swapped only for the
// duration of one read call and restored immediately after.
function tokenScopedRead(token, baseRead) {
  return (args) => {
    const prev = process.env.GH_TOKEN
    process.env.GH_TOKEN = token
    try { return baseRead(args) } finally {
      if (prev === undefined) delete process.env.GH_TOKEN
      else process.env.GH_TOKEN = prev
    }
  }
}
export function reportedTotal(payload) { return (Array.isArray(payload) ? payload[0] : payload)?.total_count }
export function requireWholePage(what, totalCount, page) {
  if (!Number.isInteger(totalCount) || totalCount < 0) throw new PreflightError(`GitHub did not report how many ${what} exist on the reviewed head`)
  if (!Array.isArray(page) || totalCount > page.length) throw new PreflightError(`GitHub reported ${totalCount} ${what} but pagination returned only ${page?.length ?? 'no list'}`)
}
export function gatherPreflightInput(env = process.env, deps = {}) {
  const read = deps.json ?? json
  const sha = String(env.REQUESTED_SHA ?? '').trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new PreflightError('REQUESTED_SHA must be a 40-character head SHA')
  const repo = deps.repo ?? resolveRepositoryIdentity()
  // The authority reads need admin-level access. When an elevated token is
  // provided (AUTHORITY_TOKEN), use it ONLY for those reads; everything else
  // stays on the default token. When no elevated token is available, the
  // default token is used and probeAuthorityReadPermissions must be called
  // first to name the denial before any merge lane is taken.
  const elevatedToken = authorityToken(env)
  const authorityReadFn = elevatedToken ? tokenScopedRead(elevatedToken, read) : read
  const authorityRead = () => {
    try { return readEffectiveRequiredChecks({ repo, read: authorityReadFn }) }
    catch (error) { throw new PreflightError(`effective required-check authority unreadable: ${sanitize(error.message)}; no snapshot fallback`) }
  }
  const before = authorityRead()
  const retirement = gatherRetirement(env, read, repo, before)
  const combined = read(['api', '--paginate', '--slurp', `repos/${repo}/commits/${sha}/status?per_page=100`])
  const runs = read(['api', '--paginate', '--slurp', `repos/${repo}/commits/${sha}/check-runs?per_page=100&filter=all`])
  const statuses = collectPages(combined, 'statuses'), checkRuns = collectPages(runs, 'check_runs')
  requireWholePage('commit statuses', reportedTotal(combined), statuses)
  requireWholePage('check runs', reportedTotal(runs), checkRuns)
  const checkPages = Array.isArray(runs) ? runs : [runs]
  const count = reportedTotal(runs), runIds = new Set()
  if (checkRuns.length !== count || checkPages.some((page) => page.total_count !== count)) throw new PreflightError('check-run listing changed during pagination; refusing an unstable read')
  for (const run of checkRuns) {
    if (!Number.isSafeInteger(run?.id) || run.id <= 0 || typeof run.name !== 'string' || !run.name || runIds.has(run.id)) throw new PreflightError('check-run listing has an invalid or repeated run identity; refusing an unstable read')
    runIds.add(run.id)
  }
  const authority = authorityRead()
  if (before.revision !== authority.revision || before.base_sha !== authority.base_sha) throw new PreflightError('effective settings or protected branch changed during the read; authorization must be recomputed')
  const final = authorityRead()
  if (authority.revision !== final.revision || authority.base_sha !== final.base_sha) throw new PreflightError('authority changed while binding protected retirement run')
  return { authority: final, statuses, checkRuns, sha, retirement }
}
export function isWaitableRefusal(message) { return /still running:|never reported:/.test(String(message ?? '')) && !/failing:/.test(String(message ?? '')) }
export async function waitForPreflight(env = process.env, deps = {}) {
  const gather = deps.gather ?? gatherPreflightInput, evaluate = deps.evaluate ?? evaluatePreflight
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), now = deps.now ?? Date.now
  const log = deps.log ?? ((line) => console.log(line))
  const budgetMs = Math.max(0, Number(env.PREFLIGHT_WAIT_SECONDS ?? 900)) * 1000
  const intervalMs = Math.max(1, Number(env.PREFLIGHT_POLL_SECONDS ?? 30)) * 1000
  const started = now()
  for (let attempt = 1; ; attempt++) {
    try { return evaluate(gather(env)) }
    catch (e) {
      if (!(e instanceof PreflightError) || !isWaitableRefusal(e.message)) throw e
      const waited = now() - started
      if (waited + intervalMs > budgetMs) throw new PreflightError(`${e.message} Waited ${Math.round(waited / 1000)}s for the checks to finish.`)
      log(`Waiting for checks to finish (attempt ${attempt}, ${Math.round(waited / 1000)}s so far): ${e.message.split(' No retry')[0]}`)
      await sleep(intervalMs)
    }
  }
}
export async function main(env = process.env, deps = {}) {
  if (process.argv.includes('--capture-authority-file') || process.argv.includes('--cleanup-authority-file')) {
    try {
      if (process.argv.includes('--capture-authority-file')) captureAuthorityFile(env)
      else cleanupAuthorityFile(env)
      return 0
    } catch { console.error('REFUSED: protected authority scratch operation failed'); return 2 }
  }
  // --probe-permissions: attempt exactly the two load-bearing authority reads
  // and fail closed with an actionable message if the token cannot complete
  // them. Kept for the dedicated workflow step; the default path below also
  // probes first so a denied permission is named even when the workflow YAML
  // comes from main and has no separate probe step.
  if (env.PROBE_AUTHORITY_PERMISSIONS === '1' || process.argv.includes('--probe-permissions')) {
    try {
      const repo = deps.repo ?? resolveRepositoryIdentity()
      const baseRead = deps.json ?? json
      const elevatedToken = authorityToken(env)
      const read = elevatedToken ? tokenScopedRead(elevatedToken, baseRead) : baseRead
      const result = probeAuthorityReadPermissions({ repo, read })
      console.log(`Authority-read permissions proven for ${result.repo} (branch ${result.branch}): ${result.proven.join(' + ')}.`)
      return 0
    } catch (e) {
      console.error(`REFUSED: ${e.message}`)
      return 2
    }
  }
  try {
    // PROBE-THEN-GATHER in one invocation (issue #3361). workflow_dispatch
    // runs the workflow YAML from main, which may lack a separate probe step.
    // Probing here names the denied permission before any merge lane is taken,
    // even with main's current step list.
    const repo = deps.repo ?? resolveRepositoryIdentity()
    const baseRead = deps.json ?? json
    const elevatedToken = authorityToken(env)
    const probeRead = elevatedToken ? tokenScopedRead(elevatedToken, baseRead) : baseRead
    probeAuthorityReadPermissions({ repo, read: probeRead })
    const result = await waitForPreflight(env, deps)
    console.log(`Fresh effective required status checks satisfied (${result.required} contexts; revision ${result.revision}).`)
    for (const [name, state] of result.advisory ?? []) console.log(`ADVISORY: ${name} (${state}); not required by effective GitHub policy.`)
    console.log(`SHADOW: ${result.shadow}`)
    return 0
  } catch (e) { console.error(`REFUSED: ${e.message}`); return 2 }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main()
