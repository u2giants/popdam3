// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { describeLeaseHolder, assertNamedHold, HoldReasonError, formatHoldReason } from '../../lib/hold-reason.mjs'
import { normalizeObject } from '../../check-dispatch-collision.mjs'
import { EXCLUSIVE_REFS, parseQueueScope } from './queue-routing.mjs'
import { LaneError, parseAuthorLease } from './claims.mjs'
import { migrationVersions } from './claim-maintenance.mjs'
import { MUTEX_RECOVERY_ACTIVE_REF, MUTEX_REF, MUTEX_STALE_AFTER_MS } from './constants.mjs'
import { githubIo } from '../../manage-migration-author-lanes.mjs'
import { gitRemoteRefs } from '../../manage-migration-author-lanes.mjs'
import { GIT_COMMAND_TIMEOUT_MS } from './github-wire.mjs'
import { execFileSync } from 'node:child_process'

// NAMED HOLDS (Step 2, locked decision 15, issue #3027). Every stage-lease refusal
// names the exact lease holder, so a waiting item can record a hold on THAT lease
// rather than on another item's pipeline stage. Reading the holder is best effort:
// an unreadable lease commit still names the ref and SHA, never a guess.
export function leaseHoldText(stage, io = githubIo) {
  const ownerSha=io.readRef(EXCLUSIVE_REFS[stage])
  if(!ownerSha)return `hold_reason lease:${stage} (holder released during the check; retry)`
  let message=null
  try{message=io.readCommitMessage?.(ownerSha)??null}catch{message=null}
  return `hold_reason lease:${stage} held by ${describeLeaseHolder(stage,ownerSha,message)}`
}

export function holdFacts(io = githubIo, now = new Date()) {
  let claims=null
  const openClaims=()=>claims??=(io.openClaims()??[])
  return {
    leaseHolder(stage){
      const ownerSha=io.readRef(EXCLUSIVE_REFS[stage])
      if(!ownerSha)return null
      let message=null
      try{message=io.readCommitMessage?.(ownerSha)??null}catch{message=null}
      return {ownerSha,message}
    },
    claim(number){
      const claim=openClaims().find((row)=>Number(row.number)===Number(number))
      if(!claim)return null
      const lease=parseAuthorLease(claim.body,now)
      return {open:!lease.legacy,objects:(lease.objects??[]).map(normalizeObject),reads:(lease.reads??[]).map(normalizeObject)}
    },
    issue(number){
      const issue=io.getIssue(Number(number))
      if(!issue)return null
      let scope=null
      try{scope=parseQueueScope(issue.body??'')}catch{scope=null}
      return {state:issue.state,dependencies:scope?.dependencies??[],objects:(scope?.writes??[]).map(normalizeObject),reads:(scope?.reads??[]).map(normalizeObject)}
    },
  }
}

export function namedHold(heldIssue, reason, io = githubIo, now = new Date()) {
  try{return assertNamedHold({heldIssue,reason},holdFacts(io,now))}
  catch(error){if(error instanceof HoldReasonError)throw new LaneError(error.message);throw error}
}

// Names the exact claims (and their shared objects) an urgent item waits behind,
// instead of a generic "capacity is occupied" line (#3027 named holds).
export function urgentHoldReason(result, issue) {
  const lane=(result?.queues??[]).find((row)=>(row.queued??[]).includes(issue))
  const holders=[lane?.active,...(lane?.protected??[])].filter(Boolean).map((claim)=>`claim #${claim}`)
  const objects=[...new Set(lane?.objects??[])].sort()
  return holders.length&&objects.length?{kind:'claim',holder:holders.join(', '),objects}:null
}

export function urgentHoldDetail(result, issue) {
  const record=urgentHoldReason(result,issue)
  return `${record?formatHoldReason(record):'hold_reason unavailable: lane holder not found'}; no active work was preempted`
}

export function acquireRef(ref, ownerSha, io = githubIo) {
  if (!io.createRef(ref, ownerSha)) {
    const stage=Object.entries(EXCLUSIVE_REFS).find(([kind,value])=>value===ref&&['preview','merge','production'].includes(kind))?.[0]
    throw new LaneError(`${ref} is occupied${stage?`; ${leaseHoldText(stage,io)}`:''}`)
  }
  if (readRefAfterWrite(ref, ownerSha, io) !== ownerSha) throw new LaneError(`${ref} ownership could not be proved after acquisition`)
}

// GitHub's create-ref response can arrive before the new custom ref is visible
// to a following GET. Treat only a short sequence of 404/not-found reads as
// eventual consistency; a different owner is returned immediately and fails
// closed. This keeps the atomic create-if-absent lock while avoiding stranded
// mutexes caused by a successful create followed by a transient 404.
export function readRefAfterWrite(ref, expectedSha, io = githubIo, attempts = 12) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const actual = io.readRef(ref)
    if (actual !== null || attempt === attempts) return actual
    ;(io.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)))(Math.min(50 * attempt, 500))
  }
  return null
}

// GitHub's pull-request head and file list are eventually consistent in the same
// way a custom ref is: a push that HAS landed can still be read back as the
// pre-push state for several seconds. Asked once, that stale answer is
// indistinguishable from a push that never happened. On 2026-08-18 three
// consecutive version supersessions rolled themselves back for exactly that
// reason, and each rollback permanently burned a migration version reservation
// that can never be reused (issue #1165).
//
// Retry ONLY an exactly-stale answer: the head we pushed from, and/or the single
// migration version we renamed from. Every other answer — a third head somebody
// else pushed, zero migrations, two migrations, an unrelated version — is a real
// conflict and fails closed on the FIRST read with no retry at all. The last
// attempt still asserts exactly, so an API that never catches up refuses rather
// than proceeding on an unproven readback.
export function readPrAfterPush(pr, expected, io = githubIo, attempts = 12) {
  const {head, version, branch, staleHead, staleVersion} = expected
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const live = io.getPr(pr), versions = migrationVersions(io.getPrFiles(pr))
    const headSha = live?.head?.sha
    if (live?.state === 'open' && headSha === head && live?.head?.ref === branch && versions.length === 1 && versions[0] === version) return live
    const staleReadback = live?.state === 'open' && live?.head?.ref === branch && (headSha === staleHead || headSha === head) && versions.length === 1 && (versions[0] === staleVersion || versions[0] === version)
    if (!staleReadback || attempt === attempts) return null
    ;(io.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)))(Math.min(250 * attempt, 2000))
  }
  return null
}

export function acquireMutex(ownerSha, io = githubIo, attempts = 100) {
  for (let attempt=1; attempt<=attempts; attempt++) {
    if(io.readRef(MUTEX_RECOVERY_ACTIVE_REF))throw new LaneError('author mutex recovery is active; retry after it finishes')
    try { acquireRef(MUTEX_REF,ownerSha,io);return }
    catch(error) {
      if(!/occupied/.test(error.message))throw error
      if(attempt===attempts){
        const held=io.readRef(MUTEX_REF)
        throw new LaneError(`${MUTEX_REF} remained occupied${held ? ` at ${held}` : ''}; inspect it and use --recover-author-mutex with that exact SHA only if it is stale`)
      }
      // A mutex is held only for GitHub reads plus one issue creation. Waiting
      // here lets simultaneous unrelated authors serialize acquisition and then
      // continue authoring concurrently.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50)
    }
  }
}

export function requireOwnedRef(ref, ownerSha, io = githubIo) {
  if (io.readRef(ref) !== ownerSha) throw new LaneError(`lost ownership of ${ref}; refusing the next GitHub mutation`)
}

export function recoverStaleAuthorMutex({ expectedSha, confirmStale, serializedRecovery, now = new Date(), minAgeMs = MUTEX_STALE_AFTER_MS, quietMs = 6000 }, io = githubIo) {
  if (!confirmStale || !serializedRecovery || !/^[0-9a-f]{7,40}$/i.test(String(expectedSha ?? ''))) throw new LaneError('recovery requires the serialized recovery workflow, --expected-sha, and --confirm-stale')
    if(!io.createRef(MUTEX_RECOVERY_ACTIVE_REF,expectedSha) && readRefAfterWrite(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io)!==expectedSha)throw new LaneError('another author mutex recovery target is active')
    if(readRefAfterWrite(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io)!==expectedSha)throw new LaneError('recovery marker ownership could not be proved after acquisition')
    requireOwnedRef(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io)
    try {
    // An acquisition that read the marker just before it was created can wait
    // at most five seconds. Let it finish before inspecting/deleting the ref.
    if (quietMs > 0) (io.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)))(quietMs)
    requireOwnedRef(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io)
    const actual=io.readRef(MUTEX_REF)
    if(actual===null)return {released:null,ageSeconds:null}
    if(actual!==expectedSha)throw new LaneError(`refusing recovery: mutex is ${actual}, not expected ${expectedSha}`)
    const commit=io.getCommit?.(actual)
    const message=commit?.message ?? commit?.commit?.message ?? ''
    const dateText=commit?.committer?.date ?? commit?.commit?.committer?.date
    const acquiredAt=new Date(dateText)
    if(!/^db-coordination (?:admission(?:-operation)?|outcome-(?:advance|complete|repair)|author-acquisition|author-capacity-relinquish|author-capacity-resume|preview|preview-recovery|preview-rehearsal|preview-ready-preparation|merge|production|repository-maintenance-authorization|queue-scope-status|claim-release|duplicate-claim-release|claim-split-recovery|claim-object-expansion|claim-reversion|claim-version-supersession|claim-worktree-rebind|claim-author-transfer-mutex|claim-lease-renewal|expired-claim-recovery|reviewer-assignment-lock|reviewer-replacement-lock|reviewer-queue-lock|reviewer-silence-release-lock|reviewer-replacement|reviewer-failure-replacement|reviewer-index-cutover-activation-audit|reviewer-exclusion-lock|reviewer-reinstatement-lock|reviewer-release-lock|reviewer-abandoned-lease-reap-lock|reviewer-verdict-archive-lock|merged-claim-reissue-lock|promotion-freeze)(?: |$)/.test(message.split('\n')[0]))throw new LaneError('refusing recovery: mutex owner commit is not a recognized coordination lock')
    if(Number.isNaN(acquiredAt.valueOf()))throw new LaneError('refusing recovery: mutex owner time is unreadable')
    const age=now-acquiredAt
    if(age<minAgeMs)throw new LaneError(`refusing recovery: mutex is only ${Math.max(0,Math.floor(age/1000))} seconds old`)
    releaseOwnedRef(MUTEX_REF,expectedSha,io)
    return { released:expectedSha, ageSeconds:Math.floor(age/1000) }
    } finally { releaseRefOnExit(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io) }
}

// Issue #3791 (Shared Supabase Migrations run 36506351098): a rate-limit refusal
// inside the mutex reached the finally, whose owner-check READ was refused by the
// same exhausted API quota, so the release threw and refs/db-coordination/
// author-acquisition stayed held and blocked every reviewer draw until manual
// recovery. The release now falls back to the git protocol, which spends no API
// quota: an owner-verified ls-remote read and a --force-with-lease delete that
// removes the ref only while it still points at THIS owner. If both fail, the
// error names the held SHA and the recovery command instead of failing silently.
export function releaseMutexOnExit(ownerSha, io = githubIo, options = {}) {
  return releaseRefOnExit(MUTEX_REF, ownerSha, io, options)
}

// strict: a ref held by ANOTHER owner is an error (the caller must know it lost the
// lock), exactly as a direct releaseOwnedRef call reports it; it never falls back.
export function releaseRefOnExit(ref, ownerSha, io = githubIo, { strict = false } = {}) {
  try {
    if (strict) releaseOwnedRef(ref, ownerSha, io)
    else if (io.readRef(ref) === ownerSha) releaseOwnedRef(ref, ownerSha, io)
    return
  } catch (apiError) {
    if (/belongs to another owner/.test(String(apiError?.message))) throw apiError
    if (typeof io.releaseRefOverGit !== 'function') throw apiError
    const first = (error) => String(error?.message ?? error).split('\n')[0]
    try {
      const released = io.releaseRefOverGit(ref, ownerSha)
      if (released) process.stderr.write(`released ${ref} (${ownerSha}) over git after the API release failed: ${first(apiError)}\n`)
      return
    } catch (gitError) {
      throw new LaneError(`${ref} may still be held by ${ownerSha}: the API release failed (${first(apiError)}) and the git release failed (${first(gitError)}); if it is still held, recover it with --recover-author-mutex naming exactly ${ownerSha}`)
    }
  }
}

// Owner-verified delete over the git protocol (no API quota). Returns true when
// this call removed our ref, false when the ref is absent or owned by someone else.
export function releaseRefOverGit(ref, ownerSha, { run = execFileSync, listRefs = (patterns) => gitRemoteRefs(patterns, { run }) } = {}) {
  if (!/^[0-9a-f]{40}$/.test(String(ownerSha))) throw new LaneError('refusing git release: owner SHA is malformed')
  if (listRefs([ref]).get(ref) !== ownerSha) return false
  run('git', ['push', '--porcelain', `--force-with-lease=${ref}:${ownerSha}`, 'origin', `:${ref}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_COMMAND_TIMEOUT_MS, killSignal: 'SIGKILL' })
  const after = listRefs([ref]).get(ref) ?? null
  if (after === ownerSha) throw new LaneError(`git release of ${ref} did not take effect`)
  return true
}

export function releaseOwnedRef(ref, ownerSha, io = githubIo) {
  const actual = io.readRef(ref)
  if (actual === null) return false
  if (actual !== ownerSha) throw new LaneError(`refusing to release ${ref}: it belongs to another owner`)
  io.deleteRef(ref)
  const delays=[0,250,500,1000,1500,2000]
  for(const delay of delays){
    if(delay)(io.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)))(delay)
    const after=io.readRef(ref)
    if(after===null)return true
    // A different SHA means another contender acquired the static ref after
    // our successful owner-verified delete. Never delete the successor.
    if(after!==ownerSha)return true
  }
  throw new LaneError(`release of ${ref} could not be proved after bounded readback; do not retry blindly`)
}
