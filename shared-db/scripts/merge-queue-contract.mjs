#!/usr/bin/env node
// Merge queue contract (issue #2530 Phase C Step 7;
// plan_shared_db_popcre_transfer_merge_queue.md).
//
// WHY THIS EXISTS. GitHub's native merge queue tests a SYNTHETIC commit — the
// queued pull request's head merged onto current main — not the head the
// reviewer approved. Every safety property this repository pins to the exact
// reviewed head (exact-head approval, migration lease, object collision, SQL
// and ordering guards, production sidecars, live-proof probe) must therefore be
// re-bound to the queue's synthetic commit, or the queue would merge bytes no
// gate ever judged. This module is the single source of truth for:
//
//   1. resolving the ONE pull request a `merge_group` ref names, verified
//      against the live API (open, base `main`, head readable) — zero,
//      multiple, malformed, closed or wrong-base identities are refused;
//   2. ascending earliest-migration-version ordering among open non-draft
//      migration pull requests, so a later reservation cannot jump the queue;
//   3. GitHub's 3,000-file pull-request coverage ceiling, refused rather than
//      treated as a complete file list;
//   4. the shared-preview hold: a main commit that added migrations blocks the
//      next migration merge group until that EXACT commit carries a successful
//      `Post-merge preview rehearsal` status;
//   5. queue-mode detection for the guarded merge lane: the exact approved
//      one-PR ruleset, and nothing else, counts as "queue active".
//
// Concepts were studied from closed PR #1950 and rebuilt against current main;
// no diff was ported without re-derivation (plan §7: that branch predates the
// shared transport, repository identity, freshness and live-proof repairs).
//
// READS ONLY. This script never writes to GitHub. Repository identity is never
// hard-coded: it resolves through scripts/lib/repository-identity.mjs.
import { runGitHubCommand } from './lib/github-transport.mjs'
import { resolveRepositoryIdentity, RepositoryIdentityError } from './lib/repository-identity.mjs'
import { resolveEvidencePair } from './lib/agent-evidence-paths.mjs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export class MergeQueueError extends Error {}
// Queue mode could not be determined from live GitHub state. This is never
// "inactive": the guarded merge lane treats it as fail-closed uncertainty.
export class MergeQueueModeUnknown extends Error {}

export const PREVIEW_REHEARSAL_CONTEXT = 'Post-merge preview rehearsal'
export const GUARDED_AUTHORIZATION_CONTEXT = 'Migration guarded merge authorization'

// The exact approved one-PR queue (plan §8 locked decisions). Detection and
// activation both compare against THIS object, so a queue with different
// parameters is never silently treated as the approved one.
export const RULESET_NAME = 'main merge queue'
export const QUEUE_RULE = Object.freeze({
  type: 'merge_queue',
  parameters: Object.freeze({
    check_response_timeout_minutes: 30,
    grouping_strategy: 'ALLGREEN',
    max_entries_to_build: 1,
    max_entries_to_merge: 1,
    merge_method: 'MERGE',
    min_entries_to_merge: 1,
    min_entries_to_merge_wait_minutes: 0,
  }),
})

// The 14 live required contexts (classic branch protection read-back
// 2026-10-14, app_id 15368 = GitHub Actions). The merge-queue ruleset must
// carry these as required_status_checks so the queue knows which checks to
// wait for; a ruleset that omits them is not the approved shape (#2530).
// Retired mirror contexts (Orchestrator marker guard, Agent work contract)
// are deliberately absent.
export const REQUIRED_STATUS_CHECK_CONTEXTS = Object.freeze([
  'Cancelled work guard',
  'Cross-PR object collision',
  'Destructive SQL outside migrations',
  'Domain ownership',
  'Handoff contract',
  'Intake pointer guard',
  'Merge queue gate',
  'Migration author lease',
  'Migration guarded merge authorization',
  'Promotion contract tests (offline)',
  'Queue-sensitive checks (aggregate)',
  'SQL migration guards',
  'Tools offline tests',
  'supabase/tests against an ephemeral database',
])

// GitHub Actions integration id, matching classic protection's app binding.
export const GITHUB_ACTIONS_INTEGRATION_ID = 15368

export const REQUIRED_STATUS_CHECKS_RULE = Object.freeze({
  type: 'required_status_checks',
  parameters: Object.freeze({
    do_not_enforce_on_create: false,
    strict_required_status_checks_policy: false,
    required_status_checks: Object.freeze(
      REQUIRED_STATUS_CHECK_CONTEXTS.map((context) => Object.freeze({ context, integration_id: GITHUB_ACTIONS_INTEGRATION_ID })),
    ),
  }),
})

// ---------------------------------------------------------------------------
// Queue ref parsing and PR identity
// ---------------------------------------------------------------------------

// A merge group's head ref names its pull request(s), shaped like
// `gh-readonly-queue/main/pr-3267-<base-sha>` (with or without the
// `refs/heads/` prefix). Exactly one PR is admissible: grouping was rejected
// by the plan (§7), so a ref naming zero or several PRs is a refusal, never a
// guess.
export function pullRequestFromQueueRef(ref) {
  const matches = [...String(ref ?? '').matchAll(/(?:^|\/)pr-(\d+)-/g)].map((match) => Number(match[1]))
  if (matches.length !== 1 || !Number.isInteger(matches[0])) {
    throw new MergeQueueError(`expected exactly one pull request in the merge-group ref, got ${ref || '(empty)'}`)
  }
  return matches[0]
}

// The ref is only a claim. The live API must agree the PR exists, is open, and
// targets main, with a readable head SHA — anything else is refused.
export function verifyQueuePullRequest(number, row) {
  if (Number(row?.number) !== Number(number)) throw new MergeQueueError(`queue ref names PR #${number}, but GitHub returned a different pull request`)
  if (row.state !== 'OPEN') throw new MergeQueueError(`queue ref names PR #${number}, but it is not open`)
  if (row.baseRefName !== 'main') throw new MergeQueueError(`queue ref names PR #${number}, but its base is not main`)
  if (!/^[0-9a-f]{40}$/i.test(String(row.headRefOid ?? ''))) throw new MergeQueueError(`queue ref names PR #${number}, but its head SHA is unreadable`)
  return Number(number)
}

// ---------------------------------------------------------------------------
// Migration ordering
// ---------------------------------------------------------------------------

export function migrationVersions(files) {
  return [...new Set((files ?? []).map((file) => /^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(file)?.[1]).filter(Boolean))].sort()
}

// A migration pull request may enter the queue only when no OTHER open
// non-draft migration pull request starts at an earlier version. Drafts do not
// hold a reservation, and the candidate never blocks itself.
export function assertOldestMigration(candidateNumber, candidateFiles, openPullRequests) {
  const candidate = migrationVersions(candidateFiles)
  if (candidate.length === 0) return { relevant: false, versions: [] }
  const blockers = []
  for (const pr of openPullRequests ?? []) {
    if (Number(pr.number) === Number(candidateNumber) || pr.isDraft) continue
    const versions = migrationVersions(pr.files ?? [])
    if (versions.length && versions[0] < candidate[0]) blockers.push({ number: Number(pr.number), version: versions[0] })
  }
  if (blockers.length) {
    blockers.sort((a, b) => a.version.localeCompare(b.version) || a.number - b.number)
    throw new MergeQueueError(`migration queue order refused: PR #${candidateNumber} starts at ${candidate[0]}, behind open PR #${blockers[0].number} at ${blockers[0].version}`)
  }
  return { relevant: true, versions: candidate }
}

// Does a commit's changed-path list add a migration? The shared-preview hold
// keys off migration paths; maintenance groups do not mutate shared preview.
export function baseNeedsPreview(paths) {
  return migrationVersions(paths).length > 0
}

// Maintenance may repair evidence needed by the pending rehearsal. A later
// migration still selects the latest migration-bearing first-parent commit,
// even when maintenance commits have since advanced main. No successful status
// is fabricated for the maintenance group or the pending migration.
export function previewRehearsalTarget({ baseSha, groupSha }, readGit = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()) {
  if (![baseSha, groupSha].every((sha) => /^[a-f0-9]{40}$/.test(sha ?? ''))) throw new MergeQueueError('preview hold requires exact base and group SHAs')
  readGit(['merge-base', '--is-ancestor', baseSha, groupSha])
  const paths = readGit(['diff', '--name-only', baseSha, groupSha]).split(/\r?\n/).filter(Boolean)
  if (!baseNeedsPreview(paths)) return null
  const target = readGit(['log', '--first-parent', '-1', '--format=%H', baseSha, '--', 'supabase/migrations/']).trim()
  if (!/^[a-f0-9]{40}$/.test(target)) throw new MergeQueueError('latest preceding migration commit is unavailable')
  readGit(['merge-base', '--is-ancestor', target, baseSha])
  return target
}

// ---------------------------------------------------------------------------
// Live reads (transport injected in tests)
// ---------------------------------------------------------------------------

const ghJson = (args) => {
  const raw = runGitHubCommand(args, { wrapError: (detail) => new MergeQueueError(`GitHub read failed: ${detail}`) })
  try { return JSON.parse(raw) } catch { throw new MergeQueueError('GitHub returned malformed JSON; refusing to judge a partial read') }
}

// GitHub's pull-request files endpoint covers at most 3,000 files. Beyond it
// the list is silently TRUNCATED, which would let a migration hide outside the
// window, so reaching the ceiling is a refusal, not a complete list.
export const PR_FILE_COVERAGE_CEILING = 3000

export function readPullRequestFiles(number, { repo, read = ghJson } = {}) {
  if (!repo) throw new MergeQueueError('repository identity is required for a file-list read')
  const pages = read(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${number}/files?per_page=100`])
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new MergeQueueError(`PR #${number} file pagination is unreadable`)
  const rows = pages.flat()
  if (rows.length >= PR_FILE_COVERAGE_CEILING) throw new MergeQueueError(`PR #${number} reaches GitHub's ${PR_FILE_COVERAGE_CEILING}-file coverage limit; refusing rather than judging a truncated list`)
  return rows.map((row) => row.filename)
}

export function readOpenPullRequests({ repo, read = ghJson } = {}) {
  if (!repo) throw new MergeQueueError('repository identity is required for an open-PR read')
  const pages = read(['api', '--paginate', '--slurp', `repos/${repo}/pulls?state=open&per_page=100`])
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new MergeQueueError('open pull request pagination is unreadable')
  return pages.flat().map((row) => ({ number: row.number, isDraft: Boolean(row.draft), files: readPullRequestFiles(row.number, { repo, read }) }))
}

export function checkQueueOrder(number, { repo, read = ghJson } = {}) {
  return assertOldestMigration(number, readPullRequestFiles(number, { repo, read }), readOpenPullRequests({ repo, read }))
}

export function readQueuePullRequest(number, { repo, read = ghJson } = {}) {
  if (!repo) throw new MergeQueueError('repository identity is required for a PR read')
  return read(['pr', 'view', String(number), '--repo', repo, '--json', 'number,state,baseRefName,headRefOid'])
}

// ---------------------------------------------------------------------------
// Queue-mode detection (guarded merge lane)
// ---------------------------------------------------------------------------

// Exact match against the approved one-PR rule. A same-named ruleset with
// different parameters is NOT the approved queue and must never be treated as
// it. `listRow` comes from the collection endpoint (no rules attached);
// `detail` comes from the by-id endpoint (rules attached).
export function queueRulesetMatches(detail) {
  if (!detail || typeof detail !== 'object') return false
  if (detail.name !== RULESET_NAME || detail.target !== 'branch' || detail.enforcement !== 'active') return false
  const include = detail.conditions?.ref_name?.include
  if (!Array.isArray(include) || !include.includes('refs/heads/main')) return false
  const rules = detail.rules
  if (!Array.isArray(rules)) return false
  const queue = rules.filter((rule) => rule?.type === 'merge_queue')
  if (queue.length !== 1) return false
  if (!queueParametersEqual(queue[0].parameters)) return false
  const required = rules.filter((rule) => rule?.type === 'required_status_checks')
  if (required.length !== 1) return false
  return requiredStatusChecksEqual(required[0].parameters)
}

// Key-order-independent equality of queue parameters (#3566). GitHub returns the
// approved values in its own key order, so string comparison of JSON falsely
// refused the live approved queue. Still exact: same key set, every value ===.
export function queueParametersEqual(actual, expected = QUEUE_RULE.parameters) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
  const a = Object.keys(actual).sort(), e = Object.keys(expected).sort()
  if (a.length !== e.length || a.some((key, i) => key !== e[i])) return false
  return e.every((key) => actual[key] === expected[key])
}

// required_status_checks comparison: the two policy flags must equal exactly,
// and the check list must name the same contexts. integration_id is compared
// when present (GitHub echoes it back on read) and tolerated when absent.
export function requiredStatusChecksEqual(actual, expected = REQUIRED_STATUS_CHECKS_RULE.parameters) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
  if (actual.do_not_enforce_on_create !== expected.do_not_enforce_on_create) return false
  if (actual.strict_required_status_checks_policy !== expected.strict_required_status_checks_policy) return false
  const a = actual.required_status_checks, e = expected.required_status_checks
  if (!Array.isArray(a) || !Array.isArray(e) || a.length !== e.length) return false
  const names = (rows) => rows.map((row) => row?.context).filter(Boolean).sort()
  const an = names(a), en = names(e)
  if (an.length !== en.length || an.some((name, i) => name !== en[i])) return false
  // When GitHub echoes integration_id, it must match the approved binding.
  return a.every((row, i) => {
    const match = e.find((item) => item.context === row?.context)
    if (row.integration_id !== undefined && row.integration_id !== match.integration_id) return false
    return true
  })
}

// queueMode() returns 'active' only for the exact approved rule, 'inactive'
// when no active merge-queue rule targets main at all, and throws
// MergeQueueModeUnknown for anything unreadable or for a DIFFERENT active
// merge-queue rule — a foreign queue is a human decision, not a mode this lane
// may infer.
export function queueMode({ repo, read = ghJson } = {}) {
  if (!repo) throw new MergeQueueModeUnknown('repository identity is required for ruleset reads')
  const list = read(['api', `repos/${repo}/rulesets?includes_parents=false`])
  if (!Array.isArray(list)) throw new MergeQueueModeUnknown('ruleset list is unreadable')
  const named = list.filter((row) => row?.name === RULESET_NAME)
  if (named.length > 1) throw new MergeQueueModeUnknown(`multiple rulesets named ${RULESET_NAME}`)
  // Every ACTIVE ruleset's rules must be read before "inactive" is provable:
  // the collection endpoint does not expand rules, so an unread ruleset could
  // carry a merge_queue rule this check would otherwise miss.
  const activeIds = list.filter((row) => row?.enforcement === 'active').map((row) => row.id)
  const details = new Map()
  for (const id of activeIds) {
    details.set(id, read(['api', `repos/${repo}/rulesets/${id}`]))
  }
  const foreignQueue = [...details.values()].filter((row) => row?.name !== RULESET_NAME && row?.enforcement === 'active'
    && Array.isArray(row?.rules) && row.rules.some((rule) => rule?.type === 'merge_queue')
    && (row?.conditions?.ref_name?.include ?? []).some((ref) => ref === 'refs/heads/main' || ref === '~DEFAULT_BRANCH' || ref === '~ALL'))
  if (foreignQueue.length) throw new MergeQueueModeUnknown(`a DIFFERENT active ruleset (${foreignQueue.map((r) => r.name).join(', ')}) carries a merge queue on main; refusing to guess the mode`)
  if (named.length === 0) return 'inactive'
  const detail = details.get(named[0].id)
  if (!detail) {
    if (named[0].enforcement !== 'active') return 'inactive'
    throw new MergeQueueModeUnknown(`ruleset ${RULESET_NAME} (${named[0].id}) detail was not read`)
  }
  if (queueRulesetMatches(detail)) return 'active'
  if (detail.enforcement === 'active') {
    throw new MergeQueueModeUnknown(`ruleset ${RULESET_NAME} is active but is not the exact approved one-PR queue; refusing to guess the mode`)
  }
  return 'inactive'
}

// ---------------------------------------------------------------------------
// Queue authorization interlock (issue #2530; workflow-refactor closeout §5)
// ---------------------------------------------------------------------------

// WHY THIS EXISTS. Queue admission releases the merge lock, then GitHub builds
// a synthetic group commit and the merge-group gate may wait up to 25 minutes
// for preview rehearsal. Authorization read once at the start of that wait is
// a stale claim: a production freeze can revoke the PR-head status, and the
// production lane lock can start, while the gate is still waiting. Posting
// group-SHA success from that stale read would let GitHub merge under a freeze.
//
// Asynchronous merge therefore requires ownership through the actual mutation.
// The authorize path re-reads the PR-head authorization and asserts the
// production interlock IMMEDIATELY before posting group-SHA success, while
// holding the exclusive merge lane (which production acquisition already
// refuses to overlap). The merge-lane hold is kept until GitHub lands the
// merge, so a freeze cannot slip between status posting and the mutation.

// A live production lane freezes every merge. This is the same mutual
// exclusion `--acquire-merge` enforces, restated as a readable assertion so
// the queue authorize step can name the freeze instead of only failing to
// acquire.
export function assertProductionInterlock({ productionHeld = false } = {}) {
  if (productionHeld) {
    throw new MergeQueueError('production promotion is active; queue authorization is frozen until the production lane is released')
  }
  return true
}

// The PR-head `Migration guarded merge authorization` status is the durable
// admission evidence the guarded merge lane posted under its lock. Production
// freeze revokes it on every open PR head. A queue group may only carry that
// authorization forward when the live read is STILL success — never a cached
// value from before a wait.
export function assertQueueAuthorizationCurrent(headState) {
  if (headState !== 'success') {
    throw new MergeQueueError(
      `exact PR head carries no live successful guarded merge authorization (state: ${headState ?? 'none'}); ` +
      'a production freeze or prior refusal revoked it — re-run guarded-migration-merge.yml after the freeze lifts',
    )
  }
  return true
}

// Combined re-check under the merge lock at the actual mutation point.
// `headState` is a FRESH read of the PR-head authorization status;
// `productionHeld` is a FRESH read of the production exclusive lane.
export function recheckQueueInterlock({ headState, productionHeld } = {}) {
  assertProductionInterlock({ productionHeld })
  assertQueueAuthorizationCurrent(headState)
  return { authorized: true, headState, productionHeld: Boolean(productionHeld) }
}

// PAGINATED status collection, not the combined `/status` page. Combined
// `/status` collapses and can omit older rows (issue #2274); a freeze failure
// missing from that page would lose to a stale success. Flatten `--slurp`
// pages exactly like readPullRequestFiles.
export function readAuthorizationStatuses(headSha, { repo, read = ghJson } = {}) {
  if (!repo) throw new MergeQueueError('repository identity is required for a status read')
  if (!/^[0-9a-f]{40}$/i.test(String(headSha ?? ''))) throw new MergeQueueError('a 40-character commit SHA is required for a status read')
  const pages = read(['api', '--paginate', '--slurp', `repos/${repo}/commits/${headSha}/statuses?per_page=100`])
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new MergeQueueError('commit status pagination is unreadable')
  return pages.flat()
}

export function readAuthorizationRow(headSha, { repo, read = ghJson } = {}) {
  return latestContextRow(readAuthorizationStatuses(headSha, { repo, read }), GUARDED_AUTHORIZATION_CONTEXT)
}

export function readAuthorizationState(headSha, { repo, read = ghJson } = {}) {
  return readAuthorizationRow(headSha, { repo, read })?.state ?? null
}

// Resolve the AUTHORIZED PR head from the live tip using the ancestor +
// evidence-tail shape `verifyGitEvidence` accepts (scripts/
// agent-work-contract-git-evidence.mjs). The guarded merge lane posts
// `Migration guarded merge authorization` on the implementation commit
// (`report.head_sha`). The live tip may then carry only an evidence pair after
// it. The merge-queue gate must bind containment and authorization to that
// implementation head — never blindly to the live tip — or a legitimate
// evidence tail makes the group look unlike the reviewed head
// (canary #4321: live tip `e844a091`, authorized implementation `944ff07f`,
// group parent `944ff07f`).
//
// Pair IDENTITY (this pull request's own pair, matched to the contract via
// acceptableEvidencePairs) is enforced by verifyGitEvidence and the Agent work
// contract at admission — not re-derived here. This walk only admits a tail
// whose files are exactly one complete evidence pair (keyed or legacy) and
// nothing else. When `workIssue` is provided, a keyed pair must belong to that
// issue.
//
// Returns `{ authorizedHead, evidenceTail, mode }` where mode is `exact` only
// when the tip itself is the authorized head, or `evidence-tail` when the
// authorized head is an ancestor and only the pair follows.
export function resolveAuthorizedHead(prHeadSha, { isAncestor, changedFiles, firstParent, readAuthorizationState, workIssue = null, maxWalk = 6 } = {}) {
  if (!/^[0-9a-f]{40}$/i.test(String(prHeadSha ?? ''))) {
    throw new MergeQueueError('resolving the authorized PR head requires a 40-character live tip SHA')
  }
  if (typeof isAncestor !== 'function' || typeof changedFiles !== 'function' || typeof firstParent !== 'function' || typeof readAuthorizationState !== 'function') {
    throw new MergeQueueError('resolveAuthorizedHead requires isAncestor, changedFiles, firstParent, and readAuthorizationState')
  }
  const tip = String(prHeadSha).toLowerCase()
  const tipState = readAuthorizationState(tip)
  if (tipState === 'success') {
    return { authorizedHead: tip, evidenceTail: [], mode: 'exact' }
  }

  // A lawful tail is EXACTLY one complete evidence pair — the same set-equality
  // rule verifyGitEvidence enforces (acceptableEvidencePairs). resolveEvidencePair
  // classifies by evidence paths only and would otherwise admit
  // [pair + any non-evidence file] as "current", which would let the gate accept
  // a merge group carrying unreviewed bytes beside the pair.
  const tailShapeAllowed = (files) => {
    if (files.length === 0) return true
    const pair = resolveEvidencePair(files)
    if (pair.state !== 'current') return false
    const expected = [pair.contract, pair.completion].map(String).sort()
    const actual = [...files].map(String).sort()
    if (actual.length !== expected.length) return false
    if (actual.some((file, index) => file !== expected[index])) return false
    if (workIssue == null) return true
    // Keyed pairs must belong to the named work issue when the caller binds one;
    // the legacy pair is the shared gen-1 path and is admitted without an issue key.
    if (pair.key == null || pair.key === 'legacy') return true
    return String(pair.key).startsWith(`${Number(workIssue)}/`)
  }

  let current = tip
  for (let step = 0; step < maxWalk; step++) {
    const parent = firstParent(current)
    if (!/^[0-9a-f]{40}$/i.test(String(parent ?? ''))) break
    const candidate = String(parent).toLowerCase()
    if (!isAncestor(candidate, tip)) break
    const cumulativeTail = [...changedFiles(candidate, tip)].map(String).sort()
    const pair = cumulativeTail.length === 0 ? null : resolveEvidencePair(cumulativeTail)
    const tailAllowed = tailShapeAllowed(cumulativeTail)
    if (tailAllowed && readAuthorizationState(candidate) === 'success') {
      return {
        authorizedHead: candidate,
        evidenceTail: cumulativeTail,
        // `exact` is only the early return above (tip itself authorized).
        // A walk always lands on an ancestor: empty tree span is `ancestor`,
        // a pure evidence-pair tail is `evidence-tail`.
        mode: cumulativeTail.length === 0 ? 'ancestor' : 'evidence-tail',
      }
    }
    // A complete or conflicted evidence pair already spans candidate→tip, so
    // do not walk further. A step that is only half a pair (plus non-evidence
    // files) may still be walked through; the cumulative set-equality check at
    // the acceptance boundary is what refuses an unlawful tail.
    if (pair?.state === 'current' || pair?.state === 'conflicted') break
    const stepFiles = [...changedFiles(candidate, current)].map(String)
    const stepPair = resolveEvidencePair(stepFiles)
    if (stepFiles.length > 0 && stepPair.state !== 'partial' && stepPair.state !== 'current') break
    current = candidate
  }

  throw new MergeQueueError(
    `no authorized PR head found at or under live tip ${tip}: the tip carries no successful guarded merge authorization, ` +
    'and the commits below it are not a pure evidence-pair tail over an authorized implementation head',
  )
}

// Live git IO for the authorized-head walk. First-parent only: an evidence
// tail is a linear addition on the implementation, never a merge.
export function gitAuthorizedHeadIo() {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  return {
    isAncestor(ancestor, descendant) {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' })
        return true
      } catch {
        return false
      }
    },
    changedFiles(from, to) {
      const out = git(['diff', '--name-only', from, to])
      return out ? out.split(/\r?\n/).filter(Boolean) : []
    },
    firstParent(sha) {
      try {
        return git(['rev-parse', `${sha}^1`])
      } catch {
        return null
      }
    },
  }
}
export function latestContextState(rows, context) {
  return latestContextRow(rows, context)?.state ?? null
}

// Newest row for one context (state and description). Contract is the same as
// `selectNewestCommitStatus` in the lane manager: created_at and a positive
// safe-integer id are REQUIRED, duplicate identities refuse, unrecognized
// states refuse, and ordering is timestamp then id — never response array
// order. The caller must feed the PAGINATED `/statuses` collection
// (`.../commits/:sha/statuses?per_page=100`), not the combined `/status`
// page: a freeze failure missing from a collapsed listing would lose to a
// stale success on that page.
export function latestContextRow(rows, context) {
  if (!Array.isArray(rows)) throw new MergeQueueError('commit status history is unreadable')
  const matching = rows.filter((row) => row?.context === context).map((row) => {
    const createdAt = new Date(row.created_at).getTime()
    const id = Number(row.id)
    if (!Number.isFinite(createdAt) || !Number.isSafeInteger(id) || id <= 0 || !['success', 'failure', 'pending', 'error'].includes(row.state)) {
      throw new MergeQueueError('commit status history has malformed ordering metadata')
    }
    return { at: createdAt, id, state: String(row.state), description: String(row.description ?? '') }
  })
  if (new Set(matching.map((row) => row.id)).size !== matching.length) {
    throw new MergeQueueError('commit status history has duplicate identities')
  }
  matching.sort((a, b) => b.at - a.at || b.id - a.id)
  return matching[0] ?? null
}

// ---------------------------------------------------------------------------
// Shared-preview hold
// ---------------------------------------------------------------------------

// Latest state of the rehearsal context on a commit, from its combined-status
// rows. Null means the status never reported; that is a hold, not a pass.
// Shares latestContextState's contract: newest by timestamp/id, never array
// order, malformed or duplicate identities refuse.
export function rehearsalState(statuses, context = PREVIEW_REHEARSAL_CONTEXT) {
  return latestContextState(statuses, context)
}

// Bounded wait for the exact-SHA rehearsal status. Every dependency is
// injected in tests; the workflow calls the CLI, which uses live reads.
export async function awaitPreviewRehearsal({ sha, readStatuses, sleep, now = Date.now, budgetMs, intervalMs = 15000, log = console.log }) {
  if (!/^[0-9a-f]{40}$/i.test(String(sha ?? ''))) throw new MergeQueueError('a 40-character main commit SHA is required for the preview hold')
  if (typeof readStatuses !== 'function') throw new MergeQueueError('a status reader is required')
  const started = now()
  const deadline = started + budgetMs
  for (let attempt = 1; ; attempt++) {
    const state = rehearsalState(await readStatuses(sha))
    if (state === 'success') return { waitedMs: now() - started, state }
    if (state === 'failure' || state === 'error') {
      throw new MergeQueueError(`${PREVIEW_REHEARSAL_CONTEXT} on ${sha} is ${state}; recover preview through the governed procedures, never by marking the status manually`)
    }
    if (now() + intervalMs > deadline) {
      throw new MergeQueueError(`main ${sha} added a migration and did not complete a successful post-merge preview rehearsal within ${Math.round(budgetMs / 60000)} minutes (last state: ${state ?? 'none'})`)
    }
    log(`main ${sha} is waiting for its post-merge preview rehearsal (attempt ${attempt}, state='${state ?? 'none'}')`)
    await sleep(intervalMs)
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const USAGE = `Usage:
  node scripts/merge-queue-contract.mjs                       Ascending-version order check for PR_NUMBER
  node scripts/merge-queue-contract.mjs --resolve-queue-pr    Print the one queued PR as JSON (MERGE_GROUP_REF env)
  node scripts/merge-queue-contract.mjs --queue-mode          Print active|inactive; exit 3 when undecidable
  node scripts/merge-queue-contract.mjs --require-preview-rehearsal --sha <main-sha>
                                                              Wait (bounded) for the exact-SHA rehearsal status
  node scripts/merge-queue-contract.mjs --authorization-state --head-sha <pr-head>
                                                              Print the NEWEST PR-head authorization state
  node scripts/merge-queue-contract.mjs --authorization-row --head-sha <pr-head>
                                                              Print the NEWEST state|description pair
  node scripts/merge-queue-contract.mjs --resolve-authorized-head --head-sha <live-tip>
                                                              Resolve the authorized head under an evidence tail
  node scripts/merge-queue-contract.mjs --recheck-interlock --head-sha <pr-head>
                                                              Re-read PR-head authorization and production
                                                              interlock under the merge lock at the mutation

Options:
  --repo <owner/name>   Default: GITHUB_REPOSITORY, else this checkout's verified GitHub origin
`

function flagValue(argv, flag) {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

export async function main(argv, env = process.env, deps = {}) {
  const read = deps.read ?? ghJson
  let repo
  try { repo = resolveRepositoryIdentity({ explicit: flagValue(argv, '--repo'), env, readOrigin: deps.readOrigin ?? undefined }) }
  catch (error) {
    if (error instanceof RepositoryIdentityError) throw new MergeQueueError(error.message)
    throw error
  }

  if (argv.includes('--resolve-queue-pr')) {
    const number = pullRequestFromQueueRef(env.MERGE_GROUP_REF)
    const row = readQueuePullRequest(number, { repo, read })
    verifyQueuePullRequest(number, row)
    console.log(JSON.stringify({ number: row.number, baseRefName: row.baseRefName, headRefOid: row.headRefOid }))
    return 0
  }

  if (argv.includes('--resolve-authorized-head')) {
    const tip = flagValue(argv, '--head-sha')
    const workIssueRaw = flagValue(argv, '--work-issue')
    const resolved = resolveAuthorizedHead(tip, {
      ...gitAuthorizedHeadIo(),
      workIssue: workIssueRaw == null ? null : Number(workIssueRaw),
      readAuthorizationState: (sha) => readAuthorizationState(sha, { repo, read }),
    })
    console.log(JSON.stringify(resolved))
    return 0
  }

  if (argv.includes('--queue-mode')) {
    const mode = queueMode({ repo, read })
    console.log(mode)
    return 0
  }

  if (argv.includes('--preview-rehearsal-target')) {
    console.log(previewRehearsalTarget({ baseSha: flagValue(argv, '--base-sha'), groupSha: flagValue(argv, '--group-sha') }, deps.readGit) ?? 'none')
    return 0
  }

  if (argv.includes('--require-preview-rehearsal')) {
    const sha = flagValue(argv, '--sha')
    // Issue #3280 governed review round 2: Math.max(1, NaN) is NaN, and a NaN
    // budget waits forever. A non-numeric override falls back to the default
    // rather than removing the ceiling.
    const seconds = (value, fallback) => {
      const parsed = Number(value ?? fallback)
      return Math.max(1, Number.isFinite(parsed) ? parsed : fallback)
    }
    const budgetMs = seconds(env.PREVIEW_HOLD_MAX_SECONDS, 1500) * 1000
    const intervalMs = seconds(env.PREVIEW_HOLD_POLL_SECONDS, 15) * 1000
    await awaitPreviewRehearsal({
      sha,
      budgetMs,
      intervalMs,
      readStatuses: deps.readStatuses ?? (async (commit) => readAuthorizationStatuses(commit, { repo, read })),
      sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      now: deps.now ?? Date.now,
    })
    console.log(`${PREVIEW_REHEARSAL_CONTEXT}: success on ${sha}`)
    return 0
  }

  if (argv.includes('--authorization-state') || argv.includes('--authorization-row') || argv.includes('--recheck-interlock')) {
    const headSha = flagValue(argv, '--head-sha')
    if (!/^[0-9a-f]{40}$/i.test(String(headSha ?? ''))) throw new MergeQueueError('--authorization-state/--recheck-interlock requires a 40-character PR head SHA')
    // FRESH reads at the mutation point. The production lane is a create-only
    // coordination ref: presence means a freeze is active. The PR-head status
    // is re-read here so a revocation during a preview wait cannot be carried
    // forward as a cached success.
    // PAGINATED `/statuses` collection, not the combined `/status` page.
    const headRow = readAuthorizationRow(headSha, { repo, read })
    const headState = headRow?.state ?? null
    if (argv.includes('--authorization-state')) {
      console.log(headState ?? 'none')
      return 0
    }
    if (argv.includes('--authorization-row')) {
      console.log(headRow ? `${headRow.state}|${headRow.description}` : 'none|')
      return 0
    }
    // Production lane presence: 404 is the normal free-lane answer. ANY other
    // read failure is fail-closed uncertainty — never "free".
    let productionHeld = false
    try {
      const refRow = read(['api', `repos/${repo}/git/ref/heads/db-coordination/production`])
      productionHeld = Boolean(refRow?.object?.sha)
    } catch (error) {
      const detail = String(error?.message ?? error)
      // Same classifier as configure-merge-queue.mjs readHeldLanes: only a
      // genuine "not found" answer means the lane is free. Anything else is
      // unreadable state and must refuse.
      if (!/HTTP 404|Not Found/i.test(detail)) {
        throw new MergeQueueError(`production interlock is unreadable (${detail}); refusing to judge the lane free`)
      }
      productionHeld = false
    }
    // Re-check under the (already held) merge lock.
    const result = recheckQueueInterlock({ headState, productionHeld })
    console.log(JSON.stringify(result))
    return 0
  }

  const number = Number(env.PR_NUMBER)
  if (!Number.isInteger(number) || number < 1) throw new MergeQueueError('PR_NUMBER must be a positive integer')
  const result = checkQueueOrder(number, { repo, read })
  console.log(result.relevant
    ? `Migration queue order is valid: ${result.versions.join(', ')}`
    : 'No migration files changed; migration queue ordering is not applicable.')
  return 0
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error) => {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = error instanceof MergeQueueModeUnknown ? 3 : 1
    },
  )
}
