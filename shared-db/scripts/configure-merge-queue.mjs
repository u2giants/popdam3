#!/usr/bin/env node
// Configure the native merge queue (issue #2530 Phase C Steps 7-8;
// plan_shared_db_popcre_transfer_merge_queue.md).
//
// DRY RUN BY DEFAULT. Nothing is written without --apply, and --apply runs only
// after every activation gate below passes against LIVE GitHub state:
//
//   * the repository owner is an Organization, the repository is public, and
//     its immutable ID equals the transfer baseline's (plan Step 3 artifact);
//   * the queue gate workflow is on main and every required context — the
//     pre-queue list plus the additive `Merge queue gate` — is present;
//   * no mutation lane is held (the four exclusive db-coordination refs);
//   * when the current main tip added migrations, that exact commit already
//     carries a successful `Post-merge preview rehearsal` status, so the first
//     queued group is not born held (plan Step 7 gate 8).
//
// The desired ruleset is EXACT and MINIMAL: one rule, one target ref, the
// approved one-PR parameters from scripts/merge-queue-contract.mjs. Branch
// protection and required checks are never touched here — the additive-only
// scripts/update-required-checks.mjs owns that list.
//
// ROLLBACK is queue-only: `--rollback` names exactly one ruleset — the recorded
// `main merge queue` one — and refuses anything wider. With --apply it deletes
// that ruleset by ID after printing its JSON as evidence. It never touches
// branch protection, required contexts, or any other ruleset.
//
// Exit codes: 0 dry run printed / apply verified; 1 refused by a gate or a
// read-back mismatch; 2 live state could not be read (never "nothing to do").
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createTreeReader } from './lib/github-tree.mjs'
import { runGitHubCommand } from './lib/github-transport.mjs'
import { resolveRepositoryIdentity, RepositoryIdentityError } from './lib/repository-identity.mjs'
import { PREVIEW_REHEARSAL_CONTEXT, QUEUE_RULE, RULESET_NAME, baseNeedsPreview, migrationVersions, readAuthorizationStatuses, rehearsalState } from './merge-queue-contract.mjs'

export class ConfigureQueueError extends Error {}

export const DEFAULT_BASELINE = 'docs/verification/shared-db-popcre-transfer-preflight-20260918T090454Z.json'
export const MERGE_QUEUE_WORKFLOW = 'merge-queue-gate.yml'
export const QUEUE_GATE_CONTEXT = 'Merge queue gate'
// The exclusive stage leases from the transfer baseline (Step 1): a present ref
// means a mutation lane is held and settings must not move underneath it.
export const LANE_REFS = Object.freeze([
  'refs/db-coordination/merge',
  'refs/db-coordination/preview',
  'refs/db-coordination/production',
  'refs/db-coordination/author-acquisition',
])

export function desiredRuleset() {
  return {
    name: RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
    rules: [QUEUE_RULE],
  }
}

// ---------------------------------------------------------------------------
// Activation gates — each takes plain data so it is testable offline
// ---------------------------------------------------------------------------

export function assertRepositoryIdentity({ live, baselineId }) {
  if (!Number.isInteger(live?.id)) throw new ConfigureQueueError('live repository ID is unreadable; refusing to compare')
  if (live.owner?.type !== 'Organization') throw new ConfigureQueueError(`owner type is ${live.owner?.type ?? 'unreadable'}; the native queue requires an organization-owned repository`)
  if (live.visibility !== 'public') throw new ConfigureQueueError(`visibility is ${live.visibility ?? 'unreadable'}; the queue plan covers a public repository only`)
  if (!Number.isInteger(baselineId)) throw new ConfigureQueueError('transfer baseline repository ID is unreadable; refusing to compare')
  if (live.id !== baselineId) throw new ConfigureQueueError(`live repository ID ${live.id} does not match the transfer baseline ${baselineId}; this is not the transferred repository object`)
  return true
}

export function readBaselineId(text) {
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new ConfigureQueueError('transfer baseline artifact is not readable JSON') }
  const id = parsed?.inventory?.repository?.id
  if (!Number.isInteger(id)) throw new ConfigureQueueError('transfer baseline artifact carries no inventory.repository.id')
  return id
}

export function assertContextsAndWorkflow({ contexts, workflows }) {
  if (!Array.isArray(contexts) || contexts.length === 0) throw new ConfigureQueueError('required contexts are unreadable; refusing (an empty list is never "nothing required")')
  if (!contexts.includes(QUEUE_GATE_CONTEXT)) {
    throw new ConfigureQueueError(`required contexts do not include ${QUEUE_GATE_CONTEXT}; add it first with scripts/update-required-checks.mjs --add "${QUEUE_GATE_CONTEXT}" --apply`)
  }
  if (!Array.isArray(workflows) || !workflows.includes(MERGE_QUEUE_WORKFLOW)) {
    throw new ConfigureQueueError(`${MERGE_QUEUE_WORKFLOW} is not on main; merge the Step 7 implementation first (never activate from a branch)`)
  }
  return true
}

// Plan Step 8: refuse unless every LIVE required context has merge-group coverage.
// Coverage is proven per context by scripts/check-merge-queue-workflows.test.mjs
// against the committed mirror, so a live context absent from that mirror is
// unproven and would hold every queued group forever.
export const COVERED_CONTEXTS_PATH = 'docs/verification/main-required-status-checks.json'
export function assertLiveContextsCovered({ contexts, coveredContexts }) {
  if (!Array.isArray(coveredContexts) || coveredContexts.length === 0) throw new ConfigureQueueError('the merge-group-covered context list is unreadable; refusing')
  const uncovered = (contexts ?? []).filter((c) => !coveredContexts.includes(c))
  if (uncovered.length) throw new ConfigureQueueError(`live required context(s) without proven merge-group coverage: ${uncovered.join(', ')}; mirror and map them first (scripts/update-required-checks.mjs, scripts/check-merge-queue-workflows.test.mjs)`)
  return true
}

export function assertNoMutationLane(heldLanes) {
  if (!Array.isArray(heldLanes)) throw new ConfigureQueueError('mutation lane state is unreadable; refusing')
  if (heldLanes.length) throw new ConfigureQueueError(`mutation lane(s) held: ${heldLanes.join(', ')}; activate the queue only in a quiescent window`)
  return true
}

// The first queued group is born building on the CURRENT main tip. If that tip
// added migrations, its exact rehearsal status must already be green — the
// status publisher only exists from Step 7 on, so an older migration tip means
// "dispatch the post-merge rehearsal first", not "activate anyway".
export function assertMainTipPreview({ tipSha, tipPaths, statuses }) {
  if (!/^[0-9a-f]{40}$/i.test(String(tipSha ?? ''))) throw new ConfigureQueueError('main tip SHA is unreadable; refusing')
  if (!Array.isArray(tipPaths)) throw new ConfigureQueueError('main tip file list is unreadable; refusing')
  if (!baseNeedsPreview(tipPaths)) return { held: false }
  const state = rehearsalState(statuses)
  if (state !== 'success') {
    throw new ConfigureQueueError(`main tip ${tipSha} added migration(s) ${migrationVersions(tipPaths).join(', ')} but its ${PREVIEW_REHEARSAL_CONTEXT} status is '${state ?? 'none'}'. Dispatch the bounded post-merge rehearsal for that exact commit first (it posts the status on success), then re-run.`)
  }
  return { held: true, state }
}

// ---------------------------------------------------------------------------
// Live reads (injected in tests)
// ---------------------------------------------------------------------------

const ghJson = (args, options = {}) => {
  const raw = runGitHubCommand(args, { ...options, wrapError: (detail) => new ConfigureQueueError(`GitHub command failed: ${detail}`) })
  // DELETE answers 204 with an empty body; that is a success, not malformed JSON.
  if (String(raw).trim() === '') return null
  try { return JSON.parse(raw) } catch { throw new ConfigureQueueError('GitHub returned malformed JSON; nothing was compared') }
}

// gh api exits 1 on the 404 a free lane ref returns; that 404 IS the answer.
// Everything else (401/403/5xx) means the lane state is unknown, which is a
// refusal — never read as "free".
export function readHeldLanes(repo, { read = ghJson } = {}) {
  const held = []
  for (const ref of LANE_REFS) {
    const name = ref.replace(/^refs\//, '')
    let result
    try {
      result = read(['api', `repos/${repo}/git/ref/${name}`])
    } catch (error) {
      if (/HTTP 404|Not Found/i.test(String(error?.message))) continue
      throw new ConfigureQueueError(`lane ref ${ref} could not be read (${error.message}); refusing rather than assuming the lane is free`)
    }
    if (result?.ref === ref) held.push(ref)
  }
  return held
}

export function readMainTip(repo, { read = ghJson } = {}) {
  const branch = read(['api', `repos/${repo}/branches/main`])
  const tipSha = branch?.commit?.sha
  if (!/^[0-9a-f]{40}$/i.test(String(tipSha ?? ''))) throw new ConfigureQueueError('main tip SHA is unreadable; refusing')
  const commit = read(['api', `repos/${repo}/commits/${tipSha}`])
  const files = commit?.files
  if (!Array.isArray(files)) throw new ConfigureQueueError('main tip commit file list is unreadable; refusing')
  if (commit.files_truncated === true || files.length >= 300) {
    throw new ConfigureQueueError(`main tip ${tipSha} changed ${files.length}+ files and GitHub truncated the list; refusing rather than judging a partial diff`)
  }
  // PAGINATED `/statuses`, not the combined `/status` page (a collapsed
  // listing can omit a freeze failure and let a stale success win).
  const statuses = readAuthorizationStatuses(tipSha, { repo, read })
  return { tipSha, tipPaths: files.map((f) => f?.filename).filter(Boolean), statuses }
}

// ---------------------------------------------------------------------------
// Plan / apply / rollback
// ---------------------------------------------------------------------------

export function planActivation({ repo, live, baselineId, rulesets, contexts, workflows, heldLanes, mainTip, coveredContexts }) {
  assertRepositoryIdentity({ live, baselineId })
  assertContextsAndWorkflow({ contexts, workflows })
  assertLiveContextsCovered({ contexts, coveredContexts })
  assertNoMutationLane(heldLanes)
  const tip = assertMainTipPreview(mainTip)
  if (!Array.isArray(rulesets)) throw new ConfigureQueueError('ruleset list is unreadable; refusing')
  const sameName = rulesets.filter((row) => row?.name === RULESET_NAME)
  if (sameName.length > 1) throw new ConfigureQueueError(`multiple rulesets named ${RULESET_NAME}; refusing to guess which one to update`)
  return { repo, existing: sameName[0] ?? null, desired: desiredRuleset(), mainTip: tip }
}

// Every field of the read-back must equal the desired document; a ruleset that
// differs in any parameter is not the approved queue.
export function verifyReadback(written, desired = desiredRuleset()) {
  if (!written || typeof written !== 'object' || !Number.isInteger(written.id)) throw new ConfigureQueueError('ruleset write did not read back with an ID')
  for (const key of ['name', 'target', 'enforcement']) {
    if (written[key] !== desired[key]) throw new ConfigureQueueError(`read-back mismatch: ${key} is ${written[key]}, expected ${desired[key]}`)
  }
  const include = written.conditions?.ref_name?.include
  const exclude = written.conditions?.ref_name?.exclude ?? []
  if (!Array.isArray(include) || include.length !== 1 || include[0] !== 'refs/heads/main' || exclude.length !== 0) {
    throw new ConfigureQueueError(`read-back mismatch: conditions ${JSON.stringify(written.conditions)} do not target exactly refs/heads/main`)
  }
  const rules = written.rules
  if (!Array.isArray(rules) || rules.length !== 1 || rules[0]?.type !== 'merge_queue') {
    throw new ConfigureQueueError('read-back mismatch: ruleset does not carry exactly one merge_queue rule')
  }
  if (JSON.stringify(rules[0].parameters) !== JSON.stringify(QUEUE_RULE.parameters)) {
    throw new ConfigureQueueError(`read-back mismatch: queue parameters ${JSON.stringify(rules[0]?.parameters)} != approved ${JSON.stringify(QUEUE_RULE.parameters)}`)
  }
  return written
}

// Rollback names ONE ruleset: the recorded `main merge queue` ID. Anything
// else — another name, another ruleset, branch protection — is out of scope.
export function planRollback({ rulesets, expectId }) {
  if (!Array.isArray(rulesets)) throw new ConfigureQueueError('ruleset list is unreadable; refusing to roll back blind')
  const named = rulesets.filter((row) => row?.name === RULESET_NAME)
  if (named.length === 0) throw new ConfigureQueueError(`no ruleset named ${RULESET_NAME} exists; nothing to roll back`)
  if (named.length > 1) throw new ConfigureQueueError(`multiple rulesets named ${RULESET_NAME}; refusing to pick one`)
  const target = named[0]
  if (expectId !== undefined && Number(expectId) !== target.id) {
    throw new ConfigureQueueError(`recorded ruleset ID ${expectId} does not match the live ${RULESET_NAME} ruleset ${target.id}; refusing`)
  }
  return target
}

export const USAGE = `Usage:
  node scripts/configure-merge-queue.mjs [--repo owner/name] [--baseline FILE]   Dry run (default): gates + exact payload
  node scripts/configure-merge-queue.mjs --apply [...]                           Create or idempotently update the ruleset
  node scripts/configure-merge-queue.mjs --rollback [--expect-id ID]             Queue-only rollback plan (dry run)
  node scripts/configure-merge-queue.mjs --rollback --apply [--expect-id ID]     Delete ONLY the main merge queue ruleset

Exit 0 success, 1 refused, 2 live state unreadable.
`

function flagValue(argv, flag) {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

export function main(argv, env = process.env, deps = {}) {
  const read = deps.read ?? ghJson
  const log = deps.log ?? console.log
  const apply = argv.includes('--apply')
  const rollback = argv.includes('--rollback')

  let repo
  try { repo = resolveRepositoryIdentity({ explicit: flagValue(argv, '--repo'), env, readOrigin: deps.readOrigin ?? undefined }) }
  catch (error) {
    if (error instanceof RepositoryIdentityError) throw new ConfigureQueueError(error.message)
    throw error
  }

  const rulesets = read(['api', `repos/${repo}/rulesets?includes_parents=false`])
  if (!Array.isArray(rulesets)) throw new ConfigureQueueError('ruleset list is unreadable; nothing was compared')

  if (rollback) {
    const target = planRollback({ rulesets, expectId: flagValue(argv, '--expect-id') })
    const detail = read(['api', `repos/${repo}/rulesets/${target.id}`])
    log(JSON.stringify({ mode: apply ? 'ROLLBACK APPLY' : 'ROLLBACK DRY RUN', target: detail }, null, 2))
    if (!apply) {
      log(`Dry run only. Would DELETE exactly one ruleset: ${RULESET_NAME} (ID ${target.id}). Nothing else is touched.`)
      return 0
    }
    read(['api', '--method', 'DELETE', `repos/${repo}/rulesets/${target.id}`])
    const after = read(['api', `repos/${repo}/rulesets?includes_parents=false`])
    if (after.some((row) => row?.id === target.id)) throw new ConfigureQueueError(`rollback read-back FAILED: ruleset ${target.id} still exists`)
    log(`ROLLED BACK: deleted only ruleset ${RULESET_NAME} (ID ${target.id}). merge_group trigger support and the additive context remain; the guarded lane detects inactive mode and merges directly.`)
    return 0
  }

  const live = read(['api', `repos/${repo}`])
  const baselinePath = flagValue(argv, '--baseline') ?? DEFAULT_BASELINE
  const baselineId = deps.baselineId ?? readBaselineId((deps.readFile ?? readFileSync)(baselinePath, 'utf8'))
  const protection = read(['api', `repos/${repo}/branches/main/protection/required_status_checks`])
  const contexts = protection?.contexts
  // One recursive tree read per ref, never a Contents call per file (#2342).
  const treeReader = deps.treeReader ?? createTreeReader()
  let workflows
  try {
    workflows = treeReader.pathsAtRef(repo, 'main')
      .filter((path) => path.startsWith('.github/workflows/'))
      .map((path) => path.slice('.github/workflows/'.length))
  } catch (error) {
    throw new ConfigureQueueError(`workflow listing on main is unreadable: ${error.message}; refusing`)
  }
  const heldLanes = readHeldLanes(repo, { read })
  const mainTip = readMainTip(repo, { read })

  let coveredContexts = deps.coveredContexts
  if (coveredContexts === undefined) {
    try { coveredContexts = JSON.parse((deps.readFile ?? readFileSync)(COVERED_CONTEXTS_PATH, 'utf8'))?.contexts } catch { coveredContexts = null }
  }
  const plan = planActivation({ repo, live, baselineId, rulesets, contexts, workflows, heldLanes, mainTip, coveredContexts })
  log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY RUN', repository: { id: live.id, ownerType: live.owner.type, visibility: live.visibility }, existingRulesetId: plan.existing?.id ?? null, mainTipHold: plan.mainTip, desired: plan.desired }, null, 2))
  if (!apply) {
    log('Dry run only. Nothing was written. Re-run with --apply to create the ruleset.')
    return 0
  }
  const body = JSON.stringify(plan.desired)
  const written = plan.existing
    ? read(['api', '--method', 'PUT', `repos/${repo}/rulesets/${plan.existing.id}`, '--input', '-'], { input: body })
    : read(['api', '--method', 'POST', `repos/${repo}/rulesets`, '--input', '-'], { input: body })
  const verified = verifyReadback(written)
  log(`ACTIVATED ruleset ${verified.id}: ${verified._links?.html?.href ?? '(no URL)'} — read-back matches the approved one-PR queue exactly.`)
  return 0
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`REFUSED: ${error.message}`)
    process.exitCode = /unreadable|malformed|could not be read/i.test(String(error?.message)) ? 2 : 1
  }
}
