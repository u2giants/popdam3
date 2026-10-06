// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { MERGE_SELF_CONTEXT } from '../../lib/merge-self-context.mjs'
import { currentRepository } from '../../lib/repository-identity.mjs'
import { LaneError } from './claims.mjs'

// `Migration guarded merge authorization` is posted by the guarded merge ITSELF,
// after this gate has already passed -- see SELF_CONTEXT in
// lib/merge-self-context.mjs (and the merge pre-flight). Every other consumer of the required list
// strips it; the preview gate did not, which made the gate self-referential:
// preview could never be prepared, because the only thing that sets that context
// is the merge that preview is a precondition of. Exported so the exclusion is
// covered by a test rather than only by the live gate.
// #3505: the advisory commit status uses its own context name, distinct from
// MERGE_SELF_CONTEXT and from the workflow check run name, so a green advisory
// can never satisfy or stand in for a real grant. This module is the producer
// (it posts the status) and owns the constant; the pre-flight consumer imports
// it, and a pin test asserts the two sides agree.
export const MERGE_ADVISORY_CONTEXT = 'Documents-only merge advisory'
export function pendingRequiredContexts(protectedContexts=[],observed=new Map()){
  if(!Array.isArray(protectedContexts)||!protectedContexts.length)throw new LaneError('required full CI policy has no checks; refusing preview proof')
  const byName=observed instanceof Map?observed:new Map(Object.entries(observed))
  return protectedContexts.filter((name)=>name!==MERGE_SELF_CONTEXT&&byName.get(name)!=='SUCCESS')
}
export function selectNewestCommitStatus(rows,context){
  if(!Array.isArray(rows))throw new LaneError('commit status history is unreadable')
  const matching=rows.filter((row)=>row?.context===context).map((row)=>{
    const createdAt=new Date(row.created_at).getTime(),id=Number(row.id)
    if(!Number.isFinite(createdAt)||!Number.isSafeInteger(id)||id<=0||!['success','failure','pending','error'].includes(row.state))throw new LaneError('commit status history has malformed ordering metadata')
    return {...row,createdAt,id}
  })
  if(new Set(matching.map((row)=>row.id)).size!==matching.length)throw new LaneError('commit status history has duplicate identities')
  return matching.sort((a,b)=>b.createdAt-a.createdAt||b.id-a.id)[0]??null
}

// Resolved from explicit/env/verified origin, never hard-coded (#2530).
export const REPO = currentRepository()
export const [REPO_OWNER, REPO_NAME] = REPO.split('/')
// NO AUTHOR LANE CAP. The cap was three (2026-08-14), five (2026-08-25), eight
// (2026-08-28) and twenty-four (2026-09-11, #2766). On 2026-09-11 Albert ruled
// there must be no limit on migration author lanes at all, ever (marker #2758,
// issue #2775), so the constant and every capacity refusal are gone. Do not
// reintroduce a number here.
//
// The cap was a throughput dial, never a safety dial. Collision safety comes from
// mechanisms that never read it and remain in force: exact per-object claims
// (`assertLaneAvailable`), the global acquisition mutex (`MUTEX_REF`), permanent
// per-version refs (`refs/db-claims/<version>`), and the exclusive single-holder
// stage refs in `EXCLUSIVE_REFS`. Preview, guarded merge and production stay
// strictly serial -- more authors never means more sessions touching a live
// database. Ref writes are ~6/hour per active lease; that caveat in
// plan_multi_agent_database_coordination_hardening.md now scales with real work.
export const AUTHOR_CAPACITY_STATES = Object.freeze(['active', 'relinquished', 'expired-unconfirmed'])
export const AUTHORABLE_CAPACITY_STATES = Object.freeze(AUTHOR_CAPACITY_STATES.filter((state) => state !== 'expired-unconfirmed'))
export const WORKTREE_STATES = Object.freeze(['clean', 'dirty', 'absent', 'remote'])
export const DEFAULT_LEASE_HOURS = 12
export const MUTEX_STALE_AFTER_MS = 2 * 60 * 1000
export const MUTEX_REF = 'refs/db-coordination/author-acquisition'
export const MUTEX_RECOVERY_ACTIVE_REF = 'refs/db-coordination/author-acquisition-recovery-active'
// TERMINAL RETIREMENT (issue #2301, Step 3). `refs/db-claims/<version>` is the
// PERMANENT reservation and says "this version is spent". It does not say why,
// and it cannot say that the author work behind it is over. A closed claim issue
// cannot carry that either: an issue can be REOPENED, and a reopened claim used
// to read as ordinary open work -- capacity, resume, renew, expand and merge all
// accepted it. That is the resurrection this namespace exists to stop.
//
// A tombstone is create-only and is NEVER deleted. There is deliberately no
// delete path in this file for this prefix: a retirement that can be withdrawn
// is not a terminal state, and "withdraw the tombstone" would be indistinguishable
// from the abandonment it records. A successor gets a FRESH version, branch,
// worktree and claim instead; the retired version stays spent forever.
export const RETIRED_CLAIM_REF_PREFIX = 'refs/db-claims-retired'
// Version 2 (#3675, owner ruling 2026-09-28 "never ask a human to approve"):
// a dirty/remote retirement carries `preservation` and `review_approval`.
// Version 1 records (which carried `owner_decision`) stay readable forever,
// because tombstones are create-only and an unreadable one would stop every
// lane acquisition; only version 2 is ever written.
export const RETIREMENT_SCHEMA_VERSION = 2
export const RETIREMENT_LEGACY_SCHEMA_VERSIONS = Object.freeze([1])
export const RETIREMENT_RECORD_PREFIX = 'db-claim-retirement '
// Typed decisions. Free-text would let "abandoned" and "superseded" be recorded
// as the same thing, and Step 4's reporting has to tell them apart.
export const RETIREMENT_DECISIONS = Object.freeze(['abandoned-worktree', 'superseded-by-successor', 'owner-terminated'])
// A worktree that is dirty or on another machine holds unmerged author work, so
// retiring it destroys something nobody in this process can see. Those two states
// require durable preservation evidence (a rescue branch or patch artifact) plus
// the allocator-assigned AI reviewer's APPROVE artifact; clean and absent do not.
// Owner ruling 2026-09-28 (#3675): never ask a human to approve, so this is no
// longer an owner decision.
export const RETIREMENT_PRESERVATION_STATES = Object.freeze(['dirty', 'remote'])
export const RETIREMENT_PRESERVATION_FIELDS = Object.freeze(['preservation', 'review_approval'])
// Sized like REVIEW_REF_ROW_LIMIT: one version per retirement, and this
// repository has spent a few hundred versions in its whole history. At this
// ceiling a silently truncated listing becomes plausible, and a truncated
// listing reads as "not retired" -- the fail-OPEN direction -- so it refuses
// loudly rather than guessing.
export const RETIREMENT_REF_ROW_LIMIT = 1000
export const REVIEW_CURSOR_REF = 'refs/db-coordination/reviewer-round-robin'
export const REVIEW_FAILURE_REF_PREFIX = 'refs/db-review-failures'
export const REVIEW_REPLACEMENT_REF_PREFIX = 'refs/db-review-replacements'
export const REVIEW_ASSIGNMENT_REF_PREFIX = 'refs/db-review-assignments'
export const REVIEW_ACTIVE_REF_PREFIX = 'refs/db-review-active'
// The original namespace has one ref per provider and is retained solely for
// assignments created before #2694.  New leases are keyed by the durable
// assignment tuple, so one reviewer can safely hold independent work without
// making a late verdict appear to belong to a different review.
export const REVIEW_ACTIVE_PARALLEL_REF_PREFIX = 'refs/db-review-active-v2'
export const REVIEW_SILENCE_PROBE_REF_PREFIX = 'refs/db-review-silence'
export const REVIEW_SILENCE_RELEASE_REF_PREFIX = 'refs/db-review-silences'
export const REVIEW_QUEUE_REF_PREFIX = 'refs/db-review-queue'
export const REVIEW_EXCLUSION_REF_PREFIX = 'refs/db-review-exclusions'
export const REVIEW_EXCLUSION_REASONS = new Set(['already-reviewed','independence-conflict','terminal-unavailable'])
// NO LIMIT ON REUSING A REVIEWER (owner ruling, orchestrator marker #2893,
// 2026-09-14). `already-reviewed` barred a provider from a pull request merely
// because it had reviewed an earlier head. That is a reuse cap, not a safety
// rule, and it is retired: it still PARSES so historical records stay readable,
// but no new exclusion may use it and an existing one no longer bars a draw.
// `independence-conflict` (the orchestrating/authoring engine never reviews its
// own work) and `terminal-unavailable` are unchanged.
export const RETIRED_EXCLUSION_REASONS = new Set(['already-reviewed'])
export const RECORDABLE_EXCLUSION_REASONS = new Set([...REVIEW_EXCLUSION_REASONS].filter((reason)=>!RETIRED_EXCLUSION_REASONS.has(reason)))
export const REVIEW_REINSTATEMENT_REF_PREFIX = 'refs/db-review-reinstatements'
// WHY ONLY ONE REASON IS REINSTATABLE.
//
// `already-reviewed` and `independence-conflict` are INDEPENDENCE guarantees:
// they say this provider must never judge these bytes, and no amount of fresh
// evidence changes that. `terminal-unavailable` is different in kind -- it is a
// claim about the WORLD ("this provider could not run"), and the world moves.
// It has also been wrong here: a wrapper invoked with an argument shape it does
// not take looks exactly like a provider that never answers, and that
// misreading was recorded as permanent (issue #2224). With three of five
// reviewers excluded for one PR and the other two leased to PRs that could not
// merge until it did, the queue deadlocked with no route back.
//
// The guard's purpose -- never re-draw a provider that genuinely cannot run --
// is untouched by this: reinstatement demands the wrapper's own `doctor` PASS
// lines, captured at run time and stored verbatim in the record. A provider
// that still cannot run still cannot be reinstated.
export const REINSTATABLE_EXCLUSION_REASONS = new Set(['terminal-unavailable'])
export const REVIEW_RETURN_REF_PREFIX = 'refs/db-review-returns'
export const REVIEW_RETIRED_VERDICT_REF_PREFIX = 'refs/db-review-retired-verdicts'
export const REVIEW_ACTIVE_CUTOVER_REF = 'refs/db-coordination/reviewer-index-cutover'
// SILENT-RECLAIM BUDGET, DERIVED NOT WIDENED (issue #2697). `--reclaim-silent-reviewer`
// was added after REVIEW_OPERATION_REQUEST_LIMIT was derived, and its request count was
// never measured against it, so every reclaim refused at request 24 and a dead lease could
// never be released. Measured on the wire-attempt fixture in
// Initial current-key measurement in scripts/manage-migration-author-lanes.test.mjs:
// 14 pre-mutex requests + a 14-request
// mutex-held section (mutex create, in-mutex lease re-resolution, fresh activity
// fingerprint, uncached durable-verdict re-listing, locked readback, atomic transition,
// post-transition readback, and the 3-request mutex release) = 28 complete.
// The one redundancy the measurement found was removed rather than paid for: the
// post-mutex check read the PR fresh twice for the same PR in the same statement
// (`__freshGetPr` plus `activityFingerprintForLease({freshPr:true})`). The PR state and
// head now come from the fingerprint's own facts, which is 29 -> 28.
// This path costs more than an assignment (23) because it proves the lease AND the
// silence a second time inside the mutex; that re-proof is the whole safety property and
// cannot be dropped. The ceiling is therefore this path's own measured total, not a
// widening of the shared one, and the shared 25 is untouched.
// Derivation: docs/verification/reviewer-silent-reclaim-api-budget-2026-09-10.md (#2697)
// Re-measured after #2694: current keys remain 28; legacy lookup under parallel mode
// proves the absent v2 key twice, so legacy costs 30 (15 pre-mutex + 15 held).
export const REVIEW_SILENT_RECLAIM_REQUEST_LIMIT = 30, REVIEW_SILENT_RECLAIM_MUTEX_SECTION_RESERVE = 15
export const REVIEW_QUEUE_ASSIGNMENT_REQUEST_LIMIT = 75
export const REVIEW_CAPACITY_REQUEST_LIMIT = 64
export const REVIEW_QUOTA_RESERVE = 100
export const REVIEW_LEASE_SUSPECT_HOURS = 24 // Advisory visibility only. Age never releases a lease.
export const SILENCE_MIN_AGE_HOURS = 2
export const SILENCE_CONFIRM_HOURS = 2
// ISSUE #3027 STEP 7 -- the reviewer START watcher. A lease whose review never
// started (no durable review-started marker written by run-governed-review.mjs and
// no PR activity after the draw) is returned through this same silence path after
// the 10-minute start SLO instead of the 2-hour silence window. A lease with ANY
// start marker newer than its draw is never eligible here: a healthy running review
// is only ever handled by the ordinary 2-hour silence path.
export const REVIEW_STARTED_REF_PREFIX = 'refs/db-review-started'
export const UNSTARTED_MIN_AGE_HOURS = 10/60
// One deterministic marker per exact lease (issue, PR, head, slot, draw sequence). The runner
// creates it create-only before launching a provider; the unstarted reclaim creates the SAME ref
// (pointing at its release commit) inside its atomic compare-and-swap. Exactly one of the two can
// win, so a review can never start on a slot that was returned, and a started review can never be
// reclaimed as unstarted. No listing, no timestamps, no extra reclaim requests.
export function reviewStartedMarkerRef(lease){
  const head=String(lease.headSha??'').toLowerCase(),seq=Number(lease.sequence),slot=Number(lease.slot??1)
  if(!Number.isInteger(Number(lease.issue))||!Number.isInteger(Number(lease.pr))||!/^[0-9a-f]{40}$/.test(head)||!Number.isInteger(seq)||!Number.isInteger(slot))throw new LaneError('review start marker requires exact issue, PR, head, slot, and sequence')
  return `${REVIEW_STARTED_REF_PREFIX}/${Number(lease.issue)}-${Number(lease.pr)}-${head}-slot${slot}-seq${seq}`
}
// readRef returns null only on a confirmed 404 and throws otherwise, so an unreadable marker
// never reads as a non-start.
export function reviewStartMarkerPresent(lease,io){return io.readRef(reviewStartedMarkerRef(lease))!==null}
export const REVIEW_QUEUE_TTL_HOURS = 2
export const REVIEW_QUEUE_ROW_LIMIT = 32
// Row ceiling for listReviewRefsPaged. It is a REFUSAL, not a truncation: past
// this the reviewer audit stops rather than reporting a partial view of the
// durable review history (issue #1798), and it REPLACES the old page ceiling
// REVIEW_REF_PAGE_LIMIT, which counted a unit `git/matching-refs` does not
// have (issue #2152).
//
// SIZED AGAINST TWO NUMBERS, AND NEITHER OF THEM IS THE WIRE BUDGET. The old
// page ceiling was accompanied by a warning that the request budget, not the
// page count, was the real ceiling, because each page cost one counted request.
// That is no longer true: `git/matching-refs` returns the complete matching set
// in ONE response, so this listing costs exactly one counted request whatever
// the namespace holds, and the budget cannot be the binding constraint on its
// size. What replaces it:
//   - FLOOR -- today's largest namespace. refs/db-review-assignments held 726
//     refs on 2026-09-02 (refs/db-review-failures 235, refs/db-review-replacements
//     229, refs/db-review-verdict 100). A ceiling at or under 726 would refuse
//     on day one.
//   - CEILING -- 1000, the smallest hard result cap GitHub imposes anywhere in
//     its REST API. `git/matching-refs` documents no cap and demonstrably
//     returned all 726 rows in a single response, but an undocumented
//     server-side cap is the ONE form of truncation the Link-header guard below
//     cannot see. Stopping at 1000 means this listing refuses BEFORE any
//     plausible silent cap could shorten it.
// That leaves 274 refs of headroom on today's largest namespace. When this does
// refuse, the answer is to RETIRE refs -- refs/db-review-retired-verdicts exists
// for exactly that -- and NOT to raise the number: raising it past 1000 trades a
// loud refusal for a possibly silent truncation, which is the fail-OPEN
// direction for reviewer release and replacement.
export const REVIEW_REF_ROW_LIMIT = 1000

// A listing refusal that no retry can clear. Carrying the fact on the error is
// what lets a fail-open catch re-raise instead of reporting "unreadable".
export function markReviewRefListingRefusal(error,detail){error.reviewRefListingRefusal=detail;return error}
export function isReviewRefListingRefusal(error){return Boolean(error?.reviewRefListingRefusal)}

// Issue #3349. A transient read failure in the lease probe carries its cause --
// which read, which ref, and the transport error -- so the caller names the real
// reason instead of the generic "active reviewer leases are unreadable".
export function markLeaseReadFailure(error,detail){error.leaseReadFailure=detail;return error}
export function isLeaseReadFailure(error){return Boolean(error?.leaseReadFailure)}

export function leaseReadFailureError(detail){
  const kind=detail.kind==='determinate'?'determinate':'transient'
  const guidance=kind==='determinate'
    ?'This is a determinate failure: no retry will clear it. The named remote reviewer lease ref needs governed recovery. Resolve the malformed lease before retiring abandoned leases with --reap-abandoned-review-leases --apply-recovery.'
    :'Retry the operation.'
  const where=detail.ref?` on ${detail.ref}`:''
  const cause=detail.cause??'unknown error'
  return markLeaseReadFailure(new LaneError(`active reviewer leases are unreadable (${kind} ${detail.read} failure${where}): ${cause}. ${guidance}`),detail)
}
// Issue #2711. A lease snapshot too large for one process argument fails at
// spawn (E2BIG / ENAMETOOLONG / "argument list too long"). No retry can clear
// that, so it is a determinate refusal naming the reap command, never the
// generic transient "active reviewer leases are unreadable".
export function isCommandSizeFailure(error){
  const text=[error?.code,error?.message,error?.stderr,error?.cause?.code,error?.cause?.message].filter(Boolean).map(String).join(' ')
  return /\bE2BIG\b|\bENAMETOOLONG\b|argument list too long|command line is too long|filename or extension is too long/i.test(text)
}
