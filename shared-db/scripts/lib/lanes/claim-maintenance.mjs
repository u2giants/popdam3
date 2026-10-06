// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { normalizeObject } from '../../check-dispatch-collision.mjs'
import { coordinationEvent, formatEventComment } from '../../db-coordination-events.mjs'
import { STRUCTURAL_ROUTES } from '../../orchestrator-flow/admission.mjs'
import { validateCompletionRecord, DependencyError, findCompletionRecord, COMPLETION_FENCE } from '../../lib/work-dependencies.mjs'
import { LaneError, parseAuthorLease } from './claims.mjs'
import { COORDINATION_LABELS, QUEUE_STATUSES, parseQueueScope } from './queue-routing.mjs'
import { AUTHOR_CAPACITY_STATES, WORKTREE_STATES } from './constants.mjs'
import { githubIo } from '../../manage-migration-author-lanes.mjs'
import { REPO } from './constants.mjs'

export const SPLIT_REMAINDER = 'index plm.item_upper_trim_item_number_idx'
export function workstreamKey(title) {
  const match = /^CLAIM:\s+(?:issue\s+)?#?([0-9]+(?:\/#?[0-9]+)*)\b/i.exec(String(title ?? ''))
  if (!match) throw new LaneError('claim title does not identify one exact issue workstream')
  return match[1].split('/').map((issue) => `#${issue.replace(/^#/, '')}`).join('/')
}
export function migrationVersions(files) {
  const namedFiles=files.map((file)=>({file,name:file.filename ?? file.path ?? ''}))
  if(namedFiles.some(({file,name})=>file.status==='removed'&&name.startsWith('supabase/migrations/')))throw new LaneError('pull request removes a migration file; split recovery refuses it')
  return namedFiles.map(({name})=>/^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(name)?.[1]).filter(Boolean)
}

export function workIssuesFromRows(rows) {
  return rows.filter((x)=>!x.pull_request)
    .map((x)=>({ number:x.number, title:x.title, body:x.body, createdAt:x.created_at, labels:(x.labels??[]).map((l)=>l.name) }))
    .filter((x)=>!x.labels.some((name)=>COORDINATION_LABELS.has(name)))
}
export function openIssueNumbersFromRows(rows) { return rows.filter((x)=>!x.pull_request).map((x)=>x.number) }
// #2787: one audit run reads each pull request's file list at most once. Only merged
// pull requests whose branch holds a claim whose version is already on main reach it.
export function memoizePrFiles(io) {
  const cache=new Map()
  return {branchPulls:(branch)=>io.branchPulls(branch),mergeCommitInMain:(sha)=>io.mergeCommitInMain(sha),getPrFiles(number){const key=Number(number);if(!Number.isSafeInteger(key))return io.getPrFiles(number);if(!cache.has(key))cache.set(key,io.getPrFiles(key));return cache.get(key)}}
}
// A closed claim is authored only when its own reserved version was added by a
// merged pull request from that claim's branch and the resulting merge remains
// in current main. Object overlap is deliberately irrelevant: another lane may
// later touch the same object without spending this claim's reserved version.
export function closedClaimAuthoredOnMain(claim, now, mainVersions, io) {
  let lease
  try { lease = parseAuthorLease(claim.body, now) } catch { return false }
  if (!mainVersions.has(lease.version)) return false
  return (io.branchPulls(lease.branch) ?? []).some((pull) =>
    pull.merged_at &&
    pull.merge_commit_sha &&
    io.mergeCommitInMain(pull.merge_commit_sha) &&
    addedMigrationVersions(io.getPrFiles(pull.number)).includes(lease.version)
  )
}
export function replaceLeaseLocation(body, branch, worktree) {
  const fence=/```db-author-lease\s*\n([\s\S]*?)```/.exec(body)
  if(!fence)throw new LaneError('active claim has no manager-owned author lease block')
  let block=fence[1]
  if((block.match(/^branch:/gm)??[]).length!==1||(block.match(/^worktree:/gm)??[]).length!==1)throw new LaneError('active claim lease location is ambiguous')
  block=block.replace(/^branch:.*$/m,`branch: ${branch}`).replace(/^worktree:.*$/m,`worktree: ${worktree}`)
  return body.slice(0,fence.index)+fence[0].replace(fence[1],()=>block)+body.slice(fence.index+fence[0].length)
}
export function replaceClaimObjects(body, version, objects) {
  const fences=[...body.matchAll(/```db-claim\s*\n[\s\S]*?```/g)]
  if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-claim block')
  const replacement=['```db-claim',`version: ${version}`,'objects:',...objects.map((object)=>`  - ${normalizeObject(object)}`),'```'].join('\n')
  return body.slice(0,fences[0].index)+replacement+body.slice(fences[0].index+fences[0][0].length)
}

export function replaceLeaseExpiry(body, expiresAt) {
  const fences=[...body.matchAll(/```db-author-lease\s*\n([\s\S]*?)```/g)]
  if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-author-lease block')
  const block=fences[0][1], matches=block.match(/^expires_at:\s*.+$/gm)??[]
  if(matches.length!==1)throw new LaneError('claim lease expiry is ambiguous')
  const replacement=block.replace(/^expires_at:\s*.+$/m,`expires_at: ${expiresAt.toISOString()}`)
  return body.slice(0,fences[0].index)+fences[0][0].replace(block,()=>replacement)+body.slice(fences[0].index+fences[0][0].length)
}

export function replaceCapacityState(body, capacityState, blockedOn = null, worktreeState = null, recoveryArtifact = null) {
  if (!AUTHOR_CAPACITY_STATES.includes(capacityState)) throw new LaneError('invalid author capacity state')
  if (capacityState === 'relinquished' && !blockedOn) throw new LaneError('relinquished author capacity requires blocked_on')
  if (capacityState !== 'relinquished' && blockedOn) throw new LaneError('blocked_on is only valid for relinquished capacity')
  if (capacityState === 'relinquished' && !WORKTREE_STATES.includes(worktreeState)) throw new LaneError(`relinquished author capacity requires worktree_state to be one of ${WORKTREE_STATES.join(', ')}`)
  if (capacityState !== 'relinquished' && worktreeState) throw new LaneError('worktree_state is only valid for relinquished capacity')
  if (capacityState !== 'relinquished' && recoveryArtifact) throw new LaneError('recovery is only valid for relinquished capacity')
  if (recoveryArtifact) validateImmutableArtifactReference(recoveryArtifact, 'recovery')
  const fences=[...body.matchAll(/```db-author-lease\s*\n([\s\S]*?)```/g)]
  if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-author-lease block')
  let block=fences[0][1]
  const capacityMatches=block.match(/^capacity_state:\s*.+$/gm)??[]
  if(capacityMatches.length>1)throw new LaneError('claim capacity state is ambiguous')
  block=capacityMatches.length
    ? block.replace(/^capacity_state:\s*.+$/m,`capacity_state: ${capacityState}`)
    : `${block.replace(/\s*$/,'')}\ncapacity_state: ${capacityState}\n`
  // #3170. The parser trims each lease line, so a relinquish-only field is
  // recognized even when indented or spaced before the colon. Removal must match
  // exactly what the parser reads, or resume leaves `worktree_state` behind next to
  // `capacity_state: active` and every lane command refuses the claim.
  block=stripRelinquishOnlyFields(block)
  if(blockedOn) block=`${block.replace(/\s*$/,'')}\nblocked_on: ${blockedOn}\n`
  if(worktreeState) block=`${block.replace(/\s*$/,'')}\nworktree_state: ${worktreeState}\n`
  if(recoveryArtifact) block=`${block.replace(/\s*$/,'')}\nrecovery: ${recoveryArtifact}\n`
  if(capacityState!=='relinquished'&&relinquishOnlyFieldsIn(block).length)throw new LaneError('capacity write would leave relinquish-only fields on a non-relinquished claim')
  return body.slice(0,fences[0].index)+fences[0][0].replace(fences[0][1],()=>block)+body.slice(fences[0].index+fences[0][0].length)
}

export const RELINQUISH_ONLY_LEASE_FIELDS = Object.freeze(['blocked_on', 'worktree_state', 'recovery'])

export function leaseLineField(line) {
  return /^\s*([a-z_]+)\s*:/.exec(line)?.[1] ?? null
}

export function relinquishOnlyFieldsIn(block) {
  return block.split('\n').map(leaseLineField).filter((field)=>RELINQUISH_ONLY_LEASE_FIELDS.includes(field))
}

export function stripRelinquishOnlyFields(block) {
  for(const field of RELINQUISH_ONLY_LEASE_FIELDS){
    if(relinquishOnlyFieldsIn(block).filter((name)=>name===field).length>1)throw new LaneError(`claim ${field} is ambiguous`)
  }
  return block.split('\n').filter((line)=>!RELINQUISH_ONLY_LEASE_FIELDS.includes(leaseLineField(line))).join('\n')
}

export function claimTitleIssues(claim) {
  return [...String(claim.title??'').matchAll(/#(\d+)\b/g)].map((match)=>Number(match[1]))
}

export function claimTitleWorkIssue(claim) {
  const matches=claimTitleIssues(claim)
  return matches.length===1?matches[0]:null
}

export function claimWorkIssue(claim) {
  const issue=claimTitleWorkIssue(claim)
  if(issue===null)throw new LaneError('claim title must identify exactly one work issue for capacity transition events')
  return issue
}

export function validateCapacityBlocker(blockedOn, io) {
  const issue=/^issue:#?(\d+)$/.exec(String(blockedOn??''))
  if(issue){
    const blocker=io.getIssue(Number(issue[1]))
    if(!blocker||blocker.state!=='open')throw new LaneError(`blocked_on issue #${issue[1]} is not durably open`)
    return `issue:#${issue[1]}`
  }
  try{return validateImmutableArtifactReference(blockedOn, '--blocked-on')}
  catch{throw new LaneError('--blocked-on must be issue:#<number> or artifact:<immutable-url-or-hash>')}
}

export function validateImmutableArtifactReference(reference, label) {
  const artifact=/^artifact:(https:\/\/\S+|[0-9a-f]{40,64})$/i.exec(String(reference??''))
  if(!artifact)throw new LaneError(`${label} must be artifact:<immutable-url-or-hash>`)
  return `artifact:${artifact[1]}`
}

// HIGH: a recovery artifact that is merely well-formed is not a control. The
// reference must be dereferenceable RIGHT NOW, or the resume gate is a spelling
// check. https references are refused for recovery precisely because this tool
// cannot dereference them; they remain acceptable for --blocked-on, which is an
// informational blocker, not a recovery gate.
export function requireDereferenceableRecoveryArtifact(reference, io) {
  const normalized=validateImmutableArtifactReference(reference,'--recovery-artifact')
  if(!/^artifact:[0-9a-f]{40,64}$/i.test(normalized))throw new LaneError('--recovery-artifact must be an immutable object hash this repository can dereference')
  if(typeof io.verifyArtifact!=='function')throw new LaneError('recovery artifact verification is unavailable; refusing to trust an unverifiable recovery artifact')
  let resolved
  try{resolved=io.verifyArtifact(normalized)}catch(error){throw new LaneError(`recovery artifact verification is ambiguous: ${error.message}`)}
  if(!resolved)throw new LaneError(`recovery artifact ${normalized} cannot be dereferenced`)
  return normalized
}

export function requestedWorktreeState(value) {
  if(value===undefined||value===null||value==='')return null
  if(!WORKTREE_STATES.includes(value))throw new LaneError(`--worktree-state must be one of ${WORKTREE_STATES.join(', ')}`)
  return value
}

export function observedWorktreeState(worktree, io) {
  let observed
  try{observed=io.localWorktreeState?io.localWorktreeState(worktree):io.localClean?.(worktree)}catch(error){throw new LaneError(`claim worktree inspection is ambiguous: ${error.message}`)}
  const state=typeof observed==='boolean'?(observed?'clean':'dirty'):typeof observed==='string'?observed:observed?.state
  if(!WORKTREE_STATES.includes(state))throw new LaneError('claim worktree inspection is ambiguous')
  return state
}

export function resolveRelinquishmentWorktreeState(worktree, explicitState, io) {
  const requested=requestedWorktreeState(explicitState),observed=observedWorktreeState(worktree,io)
  if(observed==='clean'){
    if(requested&&requested!=='clean')throw new LaneError(`claim worktree is clean; refusing contradictory --worktree-state ${requested}`)
    return 'clean'
  }
  // A path absent on this machine may be either truly absent or known to live
  // on another machine. The explicit declaration distinguishes those cases;
  // a locally present clean/dirty tree can never be called remote.
  if(observed==='absent'&&requested==='remote')return 'remote'
  if(requested!==observed)throw new LaneError(`claim worktree is ${observed}; explicit --worktree-state ${observed} is required`)
  return observed
}

export function publishCapacityEvents({ workIssue, claim, eventTypes, actor, detail }, now, io) {
  if(!io.commentIssue)return
  for(const eventType of eventTypes){
    const event=coordinationEvent({eventType,workIssue,claimIssue:Number(claim),actor,timestamp:now.toISOString(),detail})
    io.commentIssue(workIssue,formatEventComment(event))
  }
}

// popcre/ai-devops#498 item 12 (issue #3050). A wrong-owner refusal used to say
// only "claim belongs to a different owner", which tells the caller nothing they
// did not already know and leaves them guessing the spelling on record. The
// refusal is UNCHANGED in force -- it still throws, and it still refuses -- but it
// now names the owner GitHub actually holds, the owner that was supplied, and the
// exact command to re-run. Never echo the recorded owner into a command the caller
// can run to act AS that owner without knowing it: that is fine here because the
// claim's owner string is already public in the issue body this command just read.
export function wrongOwnerMessage({ claim, onRecord, supplied, command }) {
  const recorded = onRecord === undefined || onRecord === null || onRecord === '' ? '(none recorded)' : `"${onRecord}"`
  const given = supplied === undefined || supplied === null || supplied === '' ? '(none supplied)' : `"${supplied}"`
  return `claim #${claim} belongs to a different owner: the owner on record is ${recorded}, and --owner supplied ${given}. This claim is not yours to change. If ${recorded} is you, re-run with the owner on record: ${command}`
}

// Builds the corrected command line for a wrong-owner refusal. Quoting the owner
// keeps a name containing spaces from being split into separate argv entries --
// the exact failure that wasted a session on #2212's hand edit.
export function laneCommand(flags) {
  return `node scripts/manage-migration-author-lanes.mjs ${flags.join(' ')}`
}

export function renewalIssueScope(issue, lease, claimIssues=[],{ allowClaimSuperset=false, allowIssueExpansion=false }={}) {
  const scope=issue?.state==='open'?parseQueueScope(issue.body):null
  const structural=scope?.status==='ready'&&scope.workType==='structural'&&STRUCTURAL_ROUTES.includes(scope.route)
  const curated=scope?.status==='ready'&&scope.workType==='curated-master-data'&&scope.route==='curated-master-data-governance'
  if(!structural&&!curated)throw new LaneError('renewal issue must be one open ready structural or curated Master Data work item')
  const issueObjects=scope.objects.map(normalizeObject),claimObjects=lease.objects.map(normalizeObject)
  if(curated&&issueObjects.length===0){
    if(claimIssues.length!==1||claimIssues[0]!==Number(issue.number))throw new LaneError('blank curated renewal scope requires a claim title identifying exactly one work issue')
    return claimObjects
  }
  const uncovered=issueObjects.filter((object)=>!claimCoversObject(claimObjects,object))
  if(allowIssueExpansion&&allowClaimSuperset)return Object.assign([...claimObjects],{uncovered})
  if(uncovered.length||(!allowClaimSuperset&&issueObjects.length!==claimObjects.length))throw new LaneError('renewal issue objects do not exactly match the permanent claim objects')
  return claimObjects
}

// #2898. A held `table S.T` claim covers a scope write on `column S.T.C` for renewal and
// recovery comparison only. Collision checks still compare exact objects.
export function claimCoversObject(claimObjects, object) {
  const normalized=normalizeObject(object),held=claimObjects.map(normalizeObject)
  if(held.includes(normalized))return true
  const column=/^column (.+)\.[^.]+$/.exec(normalized)
  return Boolean(column&&held.includes(`table ${column[1]}`))
}

export function appendClaimObjects(body, version, objects) {
  const fences=[...body.matchAll(/```db-claim\s*\n([\s\S]*?)```/g)]
  if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-claim block')
  const block=fences[0][1],newline=block.includes('\r\n')?'\r\n':'\n'
  const versionMatches=block.match(/^version:\s*.+$/gm)??[],writeHeaders=block.match(/^(?:writes|objects):\s*$/gm)??[],readHeaders=block.match(/^reads:\s*$/gm)??[]
  if(versionMatches.length!==1||versionMatches[0]!==`version: ${version}`||writeHeaders.length!==1||readHeaders.length>1)throw new LaneError('claim object block is ambiguous')
  const insertion=readHeaders.length?block.search(/^reads:\s*$/m):block.length
  const added=objects.map((object)=>`  - ${normalizeObject(object)}${newline}`).join('')
  const replacement=block.slice(0,insertion)+added+block.slice(insertion)
  return body.slice(0,fences[0].index)+fences[0][0].replace(block,()=>replacement)+body.slice(fences[0].index+fences[0][0].length)
}

// Every migration version a pull request ADDED. `added` only, deliberately: a
// rehearsal is allowed to apply versions this PR authored, never one it merely
// touched, renamed or inherited from another claim.
export function addedMigrationVersions(files) {
  if (!Array.isArray(files)) throw new LaneError('pull request files are unreadable; a post-merge preview rehearsal never assumes them')
  return files
    .filter((file) => file?.status === 'added')
    .map((file) => /^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(file.filename ?? file.path ?? '')?.[1])
    .filter(Boolean)
}

// A post-merge rehearsal batch that AGENTS.md 6.5 requires to move as one event
// can span several authoring pull requests. This parses `version:pr,version:pr`
// -- the same shape `historical_preview_source_pr_map` already uses -- and is
// deliberately EXACT in both directions. A version with no entry would otherwise
// be applied having proved nothing about it, and an entry for a version outside
// the allowlist would drag an unrelated pull request into the evidence. Neither
// is silently tolerated; both name the offending version in the refusal.
export function parseVersionPrMap(raw, versions) {
  const entries = (typeof raw === 'string' ? raw : '').split(',').map((e) => e.trim()).filter(Boolean)
  if (!entries.length) throw new LaneError('post-merge preview rehearsal version-to-PR map is empty')
  const map = new Map()
  for (const entry of entries) {
    if (!/^\d{14}:\d+$/.test(entry)) throw new LaneError(`post-merge preview rehearsal version-to-PR map entries must be version:pull-request, not ${entry}`)
    const [version, pr] = entry.split(':')
    if (map.has(version)) throw new LaneError(`post-merge preview rehearsal version-to-PR map names ${version} more than once`)
    if (Number(pr) <= 0) throw new LaneError(`post-merge preview rehearsal version-to-PR map has a non-positive pull request for ${version}`)
    map.set(version, Number(pr))
  }
  const missing = versions.filter((v) => !map.has(v))
  if (missing.length) throw new LaneError(`post-merge preview rehearsal version-to-PR map does not name every allowlisted version: ${missing.join(', ')}`)
  const stray = [...map.keys()].filter((v) => !versions.includes(v))
  if (stray.length) throw new LaneError(`post-merge preview rehearsal version-to-PR map names version(s) that are not in the allowlist: ${stray.join(', ')}`)
  return map
}

// THE AUTHORISATION for a post-merge rehearsal, in place of a live branch claim.
// Stated as what it enforces rather than as a strength ranking: a branch claim
// proves someone intends to merge; this proves the work IS merged and IS carried
// by the main tip being rehearsed. It does not prove anything a branch claim
// proves about WHO is rehearsing -- the preview lock, not this function, is what
// keeps two rehearsals apart.
export function assertMergeCommitInMainHistory(mergeSha, mainSha, io = githubIo) {
  let comparison
  try {
    // base = the merge commit, head = the main tip. NEVER the other way round.
    comparison = io.compareCommits?.(mergeSha, mainSha)
  } catch (error) {
    throw new LaneError(`merge-commit ancestry is unreadable (${error.message}); a post-merge preview rehearsal never assumes it`)
  }
  if (!comparison || typeof comparison.status !== 'string' || !Number.isInteger(comparison.behind_by)) {
    throw new LaneError('merge-commit ancestry is unreadable; a post-merge preview rehearsal never assumes it')
  }
  // `identical` is the ordinary case: the merge just happened and its commit IS
  // the tip. `ahead` means later commits landed on top. `behind_by` must be zero
  // in both, which is what refuses a diverged or rewritten history.
  if (comparison.behind_by !== 0 || !['identical', 'ahead'].includes(comparison.status)) {
    throw new LaneError(`merge commit ${mergeSha} is not contained in the history of main tip ${mainSha} (compare status ${comparison.status}, behind_by ${comparison.behind_by})`)
  }
  return comparison
}

// COMPLETING WORK (Step 3, issue #1366). The ONLY way a db-work-completion record
// is published. There is deliberately no second publishing path: two commands that
// both post completion records is how a divergent history gets created.
//
// The record is re-derived, not trusted. A caller can write anything into the
// report file; this command proves the claims against GitHub before publishing,
// and reads the comment back before letting anyone close the issue.
// --- SANCTIONED SCOPE-STATUS WRITER (issue #2824, hole 1) ------------------
//
// Until this existed, the single most consequential edit in the queue -- moving a
// db-work issue from `blocked` to `ready`, which is what makes it dispatchable --
// was an unaudited hand edit via `gh issue edit --body-file`. It took no mutex,
// got no read-back, and left no machine-readable trail. It was also demonstrably
// error-prone: the recorded #2212 attempt lost its multiline body to PowerShell
// argument splitting and a follow-up `gh api` attempt sent an array instead of a
// string, so the remote never changed and nothing said so.
//
// WHAT THIS IS NOT. It is NOT a way to declare work finished. It writes exactly
// one field -- `status:` -- on the scope block, and nothing else. It cannot
// publish a db-work-completion record, cannot close an issue, cannot touch a
// lease, and cannot release a dependent. Only `--complete-work` does that, and
// only a `merged` or `owner-ruling-recorded` outcome there releases anything.
//
// THE READY GATE USES THE SAME EVIDENCE THE QUEUE GATE USES. `ready` is refused
// unless every `depends_on` entry satisfies `classifyDependencies` -- the exact
// function `buildDynamicQueues` uses to decide dispatchability. A closed issue
// with no typed completion record does NOT satisfy it; closure alone is not
// success. An unreadable dependency does not satisfy it either: "I could not
// check" is never "nothing to check", so the write fails closed.
export function replaceScopeStatus(body, status) {
  if (!QUEUE_STATUSES.has(status)) throw new LaneError(`db-work-scope status must be one of ${[...QUEUE_STATUSES].join(', ')}`)
  const fences = [...String(body ?? '').matchAll(/```db-work-scope\s*\n([\s\S]*?)```/g)]
  if (fences.length !== 1) throw new LaneError('exactly one db-work-scope block is required')
  const block = fences[0][1]
  const matches = block.match(/^\s*status\s*:\s*.+$/gm) ?? []
  if (matches.length !== 1) throw new LaneError(`db-work-scope declares ${matches.length} status fields; exactly one is required`)
  const rewritten = block.replace(/^(\s*)status\s*:\s*.+$/m, (_, indent) => `${indent}status: ${status}`)
  // EXACTLY ONE FIELD. Anything else that moved means the rewrite was not a
  // single-field edit, and a body write that changes more than it says it does is
  // precisely the unaudited hand edit this command exists to replace.
  const before = block.split('\n'), after = rewritten.split('\n')
  if (before.length !== after.length) throw new LaneError('scope status rewrite changed the block line count; refusing to write')
  const moved = before.map((line, index) => index).filter((index) => before[index] !== after[index])
  if (moved.length !== 1) throw new LaneError(`scope status rewrite changed ${moved.length} lines; exactly one status line may change`)
  return String(body).slice(0, fences[0].index) + fences[0][0].replace(block, () => rewritten) + String(body).slice(fences[0].index + fences[0][0].length)
}

export function completeWork({ issue, report }, io = githubIo) {
  const record = validateCompletionRecord(report)
  if (record.work_issue !== Number(issue)) {
    throw new DependencyError(`report is for issue #${record.work_issue} but --issue said #${issue}`)
  }
  const workIssue=io.getIssue?.(Number(issue))
  const scope=workIssue?parseQueueScope(workIssue.body??''):null
  if(record.outcome==='merged'&&scope?.workType==='structural'&&scope.changeType!==null){
    throw new DependencyError(`issue #${issue} uses the authoritative outcome lifecycle; merge is a stage, not completion. Keep it open through --complete-outcome and live application proof.`)
  }

  const existing = findCompletionRecord(io.issueComments(issue))
  if (existing) {
    // IMMUTABLE. Never edit or replace; a second record would make the history
    // ambiguous exactly where it must not be.
    throw new DependencyError(`issue #${issue} already has a ${existing.outcome} completion record; completion is immutable`)
  }

  // RE-DERIVE THE EVIDENCE. A merged record claims a pull request and a merge
  // commit; both are checkable, so neither is taken on trust.
  if (record.outcome === 'merged') verifyMergedWorkRecord(record, io)

  const body = [
    'Completion record for this work. Published by `--complete-work`; immutable.',
    '',
    '```' + COMPLETION_FENCE,
    JSON.stringify(record, null, 2),
    '```',
    '',
    'A dependent task is released only by a `merged` or `owner-ruling-recorded` outcome.',
  ].join('\n')
  io.commentIssue(issue, body)

  // READ BACK. An unverified write is not evidence, and the caller is about to
  // close the issue on the strength of this.
  const readBack = findCompletionRecord(io.issueComments(issue))
  if (!readBack) throw new DependencyError(`completion comment was posted to #${issue} but could not be read back; do NOT close the issue`)
  if (readBack.outcome !== record.outcome) throw new DependencyError(`completion read back as ${readBack.outcome}, expected ${record.outcome}`)
  return readBack
}

export function verifyMergedWorkRecord(record, io, { verifyLinkage = false } = {}) {
    const pr = io.getPr(record.pr)
    if (!pr?.merged_at) throw new DependencyError(`pull request #${record.pr} is not merged`)
    // GitHub's own merge_commit_sha, which is the squash commit when the repo
    // squashes. The source branch head is NOT what lands on main.
    const actual = pr.merge_commit_sha
    if (!actual || String(actual).toLowerCase() !== String(record.merge_sha).toLowerCase()) {
      throw new DependencyError(`report merge_sha ${record.merge_sha} does not match GitHub's merge_commit_sha ${actual ?? 'none'} for PR #${record.pr}`)
    }
    assertMergeCommitInMainHistory(actual, io.readRef('refs/heads/main'), io)
    const files = io.getPrFiles(record.pr) ?? []
    const actualVersions = [...new Set(files
      .map((file)=>/supabase\/migrations\/(\d{14})_/.exec(file.filename ?? ''))
      .filter(Boolean).map((match)=>match[1]))].sort()
    const declared = [...record.migration_versions].sort()
    if (actualVersions.join(',') !== declared.join(',')) {
      throw new DependencyError(`report migration_versions [${declared.join(', ')}] do not match the versions PR #${record.pr} actually added [${actualVersions.join(', ')}]`)
    }
  if (verifyLinkage) {
    if (record.merge_sha !== pr.merge_commit_sha) throw new DependencyError('completion must bind the exact merge SHA')
    if (pr.base?.repo?.full_name !== REPO || pr.base?.ref !== 'main') throw new DependencyError('completion PR belongs to another repository or branch')
    const linked = io.closingIssuesForPr(record.pr)
    if (!Array.isArray(linked) || linked.length !== 1 || Number(linked[0]?.number) !== record.work_issue) throw new DependencyError('completion PR must link exclusively to its work issue')
  }
}
