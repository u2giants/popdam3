#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { runGitHubCommand as sharedRunGitHubCommand, isTransientGitHubTransport } from './lib/github-transport.mjs'
import { createTreeReader } from './lib/github-tree.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gatherOpenPrObjects, normalizeObject, parseClaimBlock } from './check-dispatch-collision.mjs'
import { classifyDependencies, findCompletionRecord, findDependencyCycles, validateCompletionRecord, validateDependencyDeclaration, COMPLETION_FENCE, DependencyError } from './lib/work-dependencies.mjs'
import { assertLease, evaluateRecovery, formatLeaseMessage, parseLeaseMessage, recoveredLeaseMetadata, LeaseError } from './lib/exclusive-lease.mjs'
import { coordinationEvent, formatEventComment, parseEventComment, auditTimeline, renderTimeline } from './db-coordination-events.mjs'
import { reconcileFlow, persistInitialReady, preparePreviewDispatch, repairPreviewReady, terminalizeReady, readyRecord, MODE_SEQUENCE } from './orchestrator-flow/reconcile.mjs'
import { MERGE_SELF_CONTEXT } from './lib/merge-self-context.mjs'

// `Migration guarded merge authorization` is posted by the guarded merge ITSELF,
// after this gate has already passed -- see SELF_CONTEXT in
// lib/merge-self-context.mjs (and the merge pre-flight). Every other consumer of the required list
// strips it; the preview gate did not, which made the gate self-referential:
// preview could never be prepared, because the only thing that sets that context
// is the merge that preview is a precondition of. Exported so the exclusion is
// covered by a test rather than only by the live gate.
export function pendingRequiredContexts(protectedContexts=[],observed=new Map()){
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
import { buildEvidenceBundle, canonicalJson, sha256 } from './orchestrator-flow/evidence-bundle.mjs'
import { selectPreviewRoute } from './orchestrator-flow/select-preview-route.mjs'
import { PROJECT_REFS } from './orchestrator-flow/read-preview-ledger.mjs'; import { verdictOpensLine as sharedVerdictOpensLine, evidenceTiedToHead as sharedEvidenceTiedToHead, isApprovalFor as sharedIsApprovalFor, isVerdictFor as sharedIsVerdictFor, anyVerdictFor as sharedAnyVerdictFor } from './lib/review-verdict.mjs'
import { REVIEW_VERDICT_REF_PREFIX, REVIEW_VERDICT_REPLACEMENT_REF_PREFIX, REVIEW_VERDICTS, assertFindingsRefForPr, findingsDigest, formatVerdictMessage, parseVerdictCommit, parseVerdictRef, validateVerdictArtifact, verdictRef } from './lib/review-verdict-artifact.mjs'
import { changedPathsFromPullRequestFiles, classifyChangedPaths, classifyLightweightMergePullRequestFiles } from './lib/documents-only-change.mjs'
import { HISTORICAL_RESTORATIONS, validateHistoricalRestorationFile } from './historical-migration-restorations.mjs'
import { AdmissionError, SERVICE_CLASSES, CHANGE_TYPES, NON_STRUCTURAL_CHANGE_TYPES, parseImpactBlock, evaluateAdmission, inspectPrStructuralChange } from './orchestrator-flow/admission.mjs'
import { OUTCOME_STATES, OutcomeError, advanceOutcome, completeOutcome, outcomeEvent, outcomeHistory } from './orchestrator-flow/outcome-lifecycle.mjs'
import { isContentPreservingRefresh } from './lib/pr-content-equivalence.mjs'

export const REPO = 'u2giants/shared-db'
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
export const DEFAULT_LEASE_HOURS = 12
export const MUTEX_STALE_AFTER_MS = 2 * 60 * 1000
export const MUTEX_REF = 'refs/db-coordination/author-acquisition'
export const MUTEX_RECOVERY_ACTIVE_REF = 'refs/db-coordination/author-acquisition-recovery-active'
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
export const REVIEW_OPERATION_REQUEST_LIMIT = 25, REVIEW_MUTEX_SECTION_RESERVE = 15 // slot 2 = 10 pre-mutex + this reserve; slot 1 = 7 + reserve. RE-DERIVED, NOT WIDENED (issue #2075): every reviewer operation now proves 'a verdict exists for this head' from the create-only durable verdict refs instead of from comment prose. That costs exactly ONE listing of refs/db-review-verdict pre-mutex (cached for the rest of the operation by reviewOperationIo) and ONE uncached re-listing inside the mutex section, so each half grew by exactly one request. Measured totals moved 21->23 (slot-2 assignment), 18->20 (slot-2 replacement), and 8->9 pre-mutex for the first replacement, with the post-mutex replacement section going 10->11. Issue #2550 keeps this ceiling fixed by carrying predecessor failure refs in the replacement batch and treating absence in the complete active-lease snapshot as proved absence. The bounded per-PR exclusion read is inside the mutex so it cannot race assignment. This entry gate refuses to acquire the mutex unless the whole mutex-held section still fits. Release is guaranteed separately by cleanupReserve. Derivation: docs/verification/reviewer-assignment-api-budget-2026-08-28.md (#1812, #1833, #2550)
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
//
// `readsRepository` RECORDS A FACT ABOUT THE WRAPPER, NOT A PREFERENCE (#2078).
// `true` means the wrapper hands its model a real, self-contained checkout of the
// code under review and the model can open files in it. `false` means the wrapper
// is a conversational API client: it sees only the text of the brief it is given,
// so it can only review the change as DESCRIBED, never as WRITTEN. Verified per
// wrapper in ai-devops/bin before this field was written, not assumed:
//   ai-grok-review    -- `--cwd` on a real checkout, read-only permission set.
//   ai-glm            -- OpenCode session pinned to the review directory, read-only agent.
//   ai-kimi           -- read-only agent profile over the checkout/worktree.
//   ai-muse           -- `ai-review-sandbox ensure-copy` clone plus an evidence packet;
//                        its live doctor probe reads a file inside that directory.
//   ai-codex-review   -- `codex exec --sandbox read-only` over the sandbox copy.
//   ai-deepseek-agent -- HTTP conversation only. No filesystem, no diff, no tools.
//                        The `--worktree` argument sets a spawn cwd it never uses.
// A `false` entry can never record a code-review verdict; see recordReviewVerdict.
//
// THIS IS A HAND-MAINTAINED CROSS-REPOSITORY CLAIM, AND IT CAN ROT (#2079).
// The wrappers live in `u2giants/ai-devops`, not here. No check in THIS
// repository can open them, so nothing mechanical re-verifies these values: if
// `ai-muse`'s sandbox copy or `ai-kimi`'s read-only profile changes upstream,
// the roster keeps saying `true` and the gate keeps recording confabulations
// with full ceremony. Rather than pretend that is solved, every entry records
// WHEN the claim was checked and AGAINST WHAT, so staleness is visible instead
// of implied. `date` is the day a human read the wrapper; `evidence` is the
// exact wrapper behaviour that was read. Treat an old date as UNVERIFIED and
// re-read the wrapper before trusting its `true`.
export const REVIEWERS = Object.freeze([
  { name:'grok-4.6', provider:'grok', wrapper:'ai-grok-review', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'ai-devops/bin/ai-grok-review: grok --cwd <checkout> with a read-only permission set' } },
  { name:'glm-5.3', provider:'glm', wrapper:'ai-glm', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'ai-devops/bin/ai-glm: OpenCode session pinned to the review directory, read-only agent' } },
  { name:'kimi-k3', provider:'kimi', wrapper:'ai-kimi', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'ai-devops/bin/ai-kimi: read-only agent profile over the checkout/worktree' } },
  { name:'qwen-3.8-max', provider:'qwen', wrapper:'ai-qwen', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-07', evidence:'ai-devops/bin/ai-qwen: read-only review over a sealed evidence packet copy of the checkout; the live qualification review of merged commit 795902d8 cited specific file lines from it and returned a well-formed verdict' } },
  { name:'glm-5.2', provider:'glm', wrapper:'ai-glm', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'historical label for the ai-glm wrapper above; same checkout' } },
  { name:'muse-spark-1.2-contributor', provider:'muse', wrapper:'ai-muse', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'historical label for the ai-muse wrapper; durable assignments and verdicts recorded before issue #2285 still resolve through this row' } },
  { name:'muse-spark-1.3-contributor', provider:'muse', wrapper:'ai-muse', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-08', evidence:'ai-devops/bin/ai-muse: sealed evidence-packet checkout; live issue #2285 qualification identified meta-model-api/muse-spark-1.3-contributor and cited the reviewed files' } },
  { name:'codex-gpt-5.6-sol', provider:'codex', wrapper:'ai-codex-review', orchestratorEngine:'codex', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'ai-devops/bin/ai-codex-review: codex exec --sandbox read-only over the sandbox copy' } },
  { name:'deepseek-chat', provider:'deepseek', wrapper:'ai-deepseek-agent', readsRepository:false,
    readsRepositoryVerified:{ date:'2026-09-01', evidence:'ai-devops/bin/ai-deepseek-agent: HTTP chat completions only; --worktree sets a spawn cwd it never uses' } },
  { name:'gemini-3.8-flash-high', provider:'gemini', wrapper:'ai-gemini', readsRepository:true,
    readsRepositoryVerified:{ date:'2026-09-06', evidence:'ai-devops/bin/ai-gemini: disposable sandbox copy of the checkout under --sandbox with a byte inventory; the live re-qualification review of merged commit 99fbefcb cited specific file lines from it' } },
])
// Keep REVIEWERS as the historical evidence registry. Paused providers remain
// readable forever, but only ACTIVE_REVIEWERS can receive new work.
//
// WHY 'glm-5.2' IS STILL LISTED BUT NOT ACTIVE
// -------------------------------------------
// The `ai-glm` wrapper has pinned MODEL=glm-5.3 (ai-devops/bin/ai-glm), so every
// review routed through it was ALREADY running on 5.3 while this registry
// recorded it as 'glm-5.2'. The model was right; the label was wrong, and the
// label is what lands in durable review evidence. Corrected here at the source.
//
// 'glm-5.2' is deliberately NOT deleted. Reviewer names are read back out of
// permanent coordination refs (`parseReviewCursor` -> `REVIEWERS.find(...)`), so
// every historical GLM review recorded before this change still has to resolve to
// a wrapper. One of those lookups is not null-guarded, so a missing name is a
// crash, not a graceful miss. Retired names stay readable forever; only
// ACTIVE_REVIEWERS receives new work -- the same pattern used to pause Qwen.
//
// 'glm-5.3' occupies the SAME rotation slot 'glm-5.2' held, so no in-flight
// sequence is reassigned out of order. It no longer keeps ACTIVE_REVIEWERS at the
// same LENGTH -- issue #1290 changed the length from two to three. See the
// ROTATION SLOTS block below, which is the accurate statement.
//
// RESTORED 2026-08-20 (owner instruction, issue #1290): 'glm-5.3'.
// ITS PAUSE ON 2026-08-18 WAS A FALSE DIAGNOSIS, and the diagnosis is the lesson.
// The three `provider_unavailable` failures -- sequences 161, 164 and 167 -- were not
// the remote provider being down. `ai-glm doctor` showed every check passing EXCEPT
// `health endpoint answers`, because the LOCAL `opencode` server was not running.
// `opencode-glm-launch` fixed it in about thirty seconds, and glm-5.3 then produced a
// full 10 KB review with a coverage statement on the first attempt. One stopped local
// process cost a two-day reviewer outage.
//
// WHY THAT COULD HAPPEN, and what was done about it (#1287, CLOSED by the three
// changes below; ai-devops#45 fixed the wrapper half upstream):
//
//   1. `provider_unavailable` conflated "the remote provider is down" (wait) with
//      "a local dependency of the wrapper is not running" (thirty-second fix).
//      `local_dependency_unavailable` is now a separate terminal code -- see
//      TERMINAL_FAILURE_CODES -- and `replaceFailedReviewer` REFUSES to spend a
//      rotation slot on one until the operator states the local fault cannot be
//      fixed on this machine. A working provider no longer collects permanent
//      failure evidence because a background process stopped.
//   2. Recording a local fault now REQUIRES naming the failing check, and the name
//      is written into the immutable failure evidence. A failure record that
//      cannot say what broke is a guess, and the last guess cost two days.
//   3. `reviewerExecutionPreflight` runs the wrapper's own `doctor` and quotes the
//      failing check, so the operator is told "your local server is down, start
//      it" instead of a wrong verdict about a model. It refuses outright rather
//      than report ready on a probe it never ran.
//
// A pause entry below must still NAME the failing health check, or state explicitly
// that the health check passed and the failure was elsewhere. That rule is now
// enforced in code for the local-fault path, not left to the writer's memory.
//
// PAUSED 2026-08-20 (owner instruction, issue #1290): 'kimi-k3'. ELEVEN terminal
// failures against FIVE successes in a single session, in three distinct modes:
// findings discarded above the verdict heading (1), usage-limit exhaustion (1), and
// nine consecutive 6-second `exit 127` deaths. Health check: NOT the cause in the
// glm-5.3 sense -- the `exit 127` deaths are the wrapper's own launch failing, which
// is a local fault, but it is kimi's wrapper and it was not repairable in session.
// Reviewer issue `20260820T004602Z-edge-dev-kimi-k3-385556` carries the raw evidence.
// This is a PAUSE, not a retirement.
//
// UPGRADED 2026-09-08 (owner instruction, issue #2285): 'muse-spark-1.3-contributor'.
// The active slot moved from 1.2 to the live-qualified 1.3 model. The historical
// 1.2 name remains in REVIEWERS and RETIRED_REVIEWERS because immutable assignments
// and verdicts still name it; deleting or renaming it would orphan that evidence.
// On the head-to-head trial 1.3 produced a complete review ending in APPROVE.
// KNOWN DEFECT, and the caller must handle it: the wrapper's verdict DETECTION fails
// and writes "This is not a review result" over correct work. It SAVES the output, so
// every such result is fully recoverable -- READ THE SAVED ARTIFACT before recording
// any Muse failure, and never record a bare "incomplete" from this wrapper without
// having read the raw provider stream.
//
// ADDED 2026-09-06 (ai-devops issue #285): 'gemini-3.8-flash-high'. It was held out
// because `ai-gemini doctor` passed while two live attempts produced `no usable
// Gemini verdict` and then a bare `PASS` with an EMPTY report -- the worst failure
// mode for a review gate, because a decision token with no analysis behind it is
// indistinguishable from a real approval. The hold is lifted on evidence, not on
// hope: `ai-review-preflight qualify gemini` now records a live safety
// qualification bound to wrapper sha256, agy 1.1.27 and model gemini-3.8-flash-high,
// and a live review of merged commit 99fbefcb returned a well-formed
// `VERDICT APPROVE 99fbefcb4cf3388a3d46e77a2fdddb1f06bd25a1` line above 3,137
// characters of real analysis citing specific lines. The empty-report mode is also
// now caught rather than trusted: ai-devops `bin/ai-review-lifecycle` converts any
// APPROVE or REJECT whose report carries no substantive analysis into BLOCKED
// (`empty-report`), for every provider. Evidence:
// ai-devops tests/verification/reviewer-usable-reconciliation/.
//
// ROTATION SLOTS. 'glm-5.3' still occupies the slot 'glm-5.2' held. Muse was
// APPENDED, so it took the slot kimi-k3's pause vacated rather than displacing
// anyone.
// 'gemini-3.8-flash-high' was likewise APPENDED to the end of REVIEWERS, so no
// existing name changes position and no in-flight sequence is reassigned out of
// order. It only adds capacity.
//
// KIMI-K3 UNPAUSED, 2026-08-25 (owner instruction, with the lane cap raise to
// five). It returns to its ORIGINAL position in REVIEWERS, so the rotation is
// ['grok-4.6','glm-5.3','kimi-k3','muse-spark-1.3-contributor'] -- FOUR names.
// Verified before unpausing, not assumed: `AI_KIMI_CALLER=claude ai-kimi doctor`
// on edge-dev reports kimi 0.36.1, model pin kimi-code/k3, read-only profile
// PASS and `auth : OK`. Its one FAIL, `preflight (execution-context-denied)`,
// is an execution-context rule -- credentialed Kimi jobs must run from the Full
// Access main task -- not a broken install.
//
// THAT FAIL WAS INVISIBLE UNTIL THIS CHANGE, and fixing it was part of the
// unpause. `ai-kimi` and `ai-grok-review` report `<name> : PASS|FAIL|OK`, not
// the `PASS  <check>` form ai-glm, ai-muse and ai-codex-review use, so
// summarizeDoctorOutput scored kimi's output as an unrecognized format and
// therefore healthy-by-exit-status. Un-retiring a wrapper whose FAIL lines
// nothing parses would have re-armed exactly the false local-fault diagnosis
// this machinery exists to end, so parseDoctorFailures now reads both forms.
// See the note above summarizeDoctorOutput for the doctor output all five
// wrappers actually produce.
//
// WHAT THREE NAMES DOES AND DOES NOT FIX. An earlier draft of this block claimed an
// odd-length rotation removes the `replaceFailedReviewer` same-provider trap. THAT
// CLAIM WAS FALSE and a review caught it (#1290 review, High). The old refuse --
// `next durable reviewer is the same failed provider` -- fired whenever there had
// been N-1 assignments since the failure, for ANY N, so three names only moved the
// collision from ONE intervening assignment to TWO. Do not re-add an odd-length
// safety claim here; roster length was never the fix.
//
// The actual fix landed in #1297: `replaceFailedReviewer` now SKIPS every provider
// that already failed on the exact head and advances the cursor past it, refusing
// only when no other active reviewer is left. Roster length therefore buys CAPACITY
// -- three reviews in flight, and for most of 2026-08-19 the rotation was
// effectively Grok alone because ai-grok-review holds a per-REPOSITORY in-flight
// lock -- and nothing else.
//
// Capacity is worth having on its own terms: twice on 2026-08-19 a second reviewer
// overturned the first's conclusion, once by refuting an author's design rationale
// using the author's own test fixture. A rotation of one is not a rotation.
// Gemini remains outside the registry while ai-devops reviewer reliability is
// being repaired (owner instruction, 2026-08-28). Historical names are never
// deleted because durable refs use them.
//
// QWEN IS NOT RETIRED (owner instruction, 2026-09-04). Every statement that
// 'qwen-3.8-max' is retired, paused or historical-only has been removed from
// this repository, and the name is no longer carried in RETIRED_REVIEWERS.
// It is QUARANTINED instead, which is a different and narrower fact: as of
// 2026-09-04 `ai-review-preflight status qwen` reports `status: quarantined`
// with `failure_class: live-qualification-required`, live re-qualification was
// attempted that day and FAILED (`terminal-result-error`; two hand runs died
// after 900s and 240s returning no answer), and that quarantine has NOT been
// cleared. Clearing it without a passing qualification would be symptom
// suppression, so the roster keeps Qwen undrawable until ai-devops qualifies it.
// Un-quarantining is a one-line deletion from QUARANTINED_REVIEWERS below, to be
// made only after `ai-review-preflight qualify qwen` passes for real.
//
// RETIRED 2026-09-01 (issue #2078): 'deepseek-chat'. NOT a provider-quality pause
// and not a health-check failure -- `ai-deepseek-agent` is structurally incapable
// of reading the code it is asked to review. On issue #1987 / PR #1989 it produced
// a complete, confidently formatted, well-ranked review of a file name, five
// functions, two tables and two columns that DO NOT EXIST anywhere in the branch,
// and the pipeline recorded it as a durable verdict artifact bound to the exact
// head. The same run could have said APPROVE and produced a green merge gate over
// SQL no reviewer ever saw. Retirement is the correct disposition, not a pause:
// no future wrapper version fixes a conversational API client having no checkout.
// Its historical name stays readable in REVIEWERS forever because durable refs
// (`refs/db-review-assignments/1987-1989-2108fcd1...`) still name it.
//
// PAUSED 2026-09-03T16:55Z (owner instruction, chat directive, no issue): 'kimi-k3'.
// Account-wide weekly usage cap, confirmed genuine (403, not retryable this week) via
// raw evidence across multiple PRs (#2145, #2200, #2199). This is a PAUSE, not a
// retirement -- same pattern as the 2026-08-20 pause in issue #1290 above. Owner
// stated the cap clears in 24 hours from the timestamp above, i.e. on or after
// 2026-09-04T16:55Z. Whoever is orchestrating then should verify the cap has
// actually lifted (do not assume the clock alone; confirm with a real doctor/attempt)
// before removing 'kimi-k3' from this list and restoring its original rotation slot.
// UNPAUSED 2026-09-07 (owner instruction, this session): 'kimi-k3' is back in the
// rotation. Its 2026-08-20 pause was a credit exhaustion plus wrapper launch
// failure, both of which are gone: `AI_KIMI_CALLER=claude ai-kimi doctor` on this
// machine reports kimi 0.36.1, model pin kimi-code/k3, read-only PASS, preflight
// PASS and auth OK. Verified by running the doctor, not by reading the wrapper.
//
// RETIRED 2026-09-06 (owner instruction, issue #2485):
// 'codex-gpt-5.6-sol'. Its account usage limit was exhausted for the whole of a
// working session: every draw on PRs #2468 and #2479 came back
// `ERROR: You've hit your usage limit`, each one costing a failed run plus a
// replacement round while the rest of the queue waited. The owner directed
// permanent removal from the pool. This is a disposition on the ACCOUNT, not on
// the wrapper: `ai-codex-review` reads the repository correctly and its row in
// REVIEWERS keeps `readsRepository:true`, so every durable artifact this
// reviewer already recorded still authorizes exactly as before. Restoring it is
// a one-line deletion from this list once the account has quota again.
export const RETIRED_REVIEWERS = Object.freeze(['glm-5.2', 'muse-spark-1.2-contributor', 'deepseek-chat', 'codex-gpt-5.6-sol'])

// Not retired -- quarantined pending a passing live qualification. Kept separate
// from RETIRED_REVIEWERS on purpose: retirement is a permanent disposition,
// quarantine is a reversible one, and conflating them is what put a false 'Qwen
// is retired' claim into the roster in the first place. Both lists are excluded
// from ACTIVE_REVIEWERS. Names here stay readable in REVIEWERS forever because
// durable refs name them.
//
// UNQUARANTINED 2026-09-07 (owner instruction, ai-devops PR #316, merge commit
// 795902d8): 'qwen-3.8-max' is drawable again, so this list is now empty. The
// quarantine was real and its cause is fixed, not waived. Qwen never
// authenticated because its credential preloader assumed a single-process
// runtime while Qwen Code re-execs itself twice during startup, and because the
// Alibaba Coding Plan subscription key had died (401). The wrapper now hands the
// key over in a form that survives the re-exec while remaining strippable from
// tool children, and runs on the Model Studio pay-per-token lane. Verified by
// running it, not by reading it: `ai-qwen doctor --live` reports `live probe :
// OK` on the installed command, and two live review sessions on that commit each
// returned a single well-formed verdict on model qwen3.8-max above a substantive
// report. Restoring the quarantine is a one-name addition back to this list.
export const QUARANTINED_REVIEWERS = Object.freeze([])

// The single fact the gate was missing (#2078). A verdict is evidence only if the
// reviewer could open the file. Unknown names fail closed.
export function reviewerReadsRepository(name, reviewers=REVIEWERS){
  return reviewers.find((row)=>row.name===name)?.readsRepository===true
}

// #2079 ROUND 3. The two directions need OPPOSITE defaults for an unknown name.
// The merge gate asks "may this verdict authorize?" and an unknown name must
// answer no -- that is `reviewerReadsRepository` above. Replacement asks "may this
// verdict be stripped off the head?" and an unknown name must answer NO THERE TOO,
// which is the opposite boolean. Only a roster row that positively says
// `readsRepository:false` (today: deepseek-chat) may be discarded. A name that is
// absent, misspelled, case-shifted (`parseReviewCursor` matches case-insensitively
// while the roster lookup does not) or dropped from REVIEWERS is UNCLASSIFIABLE,
// and un-reviewing a head on an unclassifiable artifact is the hole #2078 was.
export function reviewerKnownNonReading(name, reviewers=REVIEWERS){
  const row=reviewers.find((entry)=>entry.name===name)
  return Boolean(row)&&row.readsRepository===false
}

// ACTIVE ROTATION EXPANSION (owner approval, 2026-08-28). Codex GPT-5.6 Sol and
// DeepSeek were added as active rotation providers then. NEITHER IS ACTIVE NOW:
// DeepSeek was retired for fabricated reviews, and Codex on 2026-09-06 for an
// exhausted account (see RETIRED_REVIEWERS above, which is the only roster that
// decides this). No overflow provider remains; when all execution keys are
// occupied, assignment fails closed and the Phase 2 allocator records an ordered
// durable wait.
//
// It is listed in REVIEWERS like every other name, so a cursor commit naming it
// still resolves to a wrapper forever (`REVIEWERS.find(...)` at parse time is
// not null-guarded on every path -- see the retired-name note above).
//
// `ai-codex-review` pins `codex exec -m gpt-5.6-sol --sandbox read-only
// -c model_reasoning_effort=medium`. That satisfies the standing rule that
// GPT-5.6 runs at low or medium reasoning only, and the pin lives in the
// wrapper, so no caller here can raise it. `ai-codex-review doctor` was run on
// edge-dev before activation and returns
// `PASS provider=codex sandbox=read-only reasoning=explicit command=codex`.
export const OVERFLOW_REVIEWERS = Object.freeze([])
export const ACTIVE_REVIEWERS = Object.freeze(REVIEWERS.filter((row)=>!RETIRED_REVIEWERS.includes(row.name)&&!QUARANTINED_REVIEWERS.includes(row.name)))

// `engine === null` is a POSITIVE answer, not an absent one: the marker resolver
// said `state: none`, so no orchestrator is running and there is no same-engine
// conflict to guard against. The exclusion list is empty and the whole rotation
// stays eligible (issue #2127 decision (a)).
//
// `undefined` and `''` remain unreadable and still refuse. That distinction is
// load-bearing: every call site reaches this through `io.resolveOrchestratorEngine?.()`,
// which yields `undefined` when the io object has no resolver at all, and that
// must never be mistaken for "no orchestrator is running".
export function reviewersForOrchestrator(engine, reviewers=ACTIVE_REVIEWERS){
  if(engine===null)return reviewers.filter(()=>true)
  const normalized=String(engine??'').trim().toLowerCase()
  if(!normalized)throw new LaneError('live orchestrator engine is unreadable; reviewer assignment refused')
  return reviewers.filter((row)=>String(row.orchestratorEngine??'').toLowerCase()!==normalized)
}

export function allocatableReviewers(io){
  const independent=reviewersForOrchestrator(io.resolveOrchestratorEngine?.())
  if(!independent.length)throw new LaneError('no reviewer is independent from the live orchestrator engine')
  if(typeof io.reviewerUsability!=='function')throw new LaneError('reviewer allocation cannot read the reconciled ai-review-preflight state; no sequence or lease was consumed')
  const usability=io.reviewerUsability(independent)
  if(!(usability instanceof Map))throw new LaneError('reviewer allocation received malformed reconciled ai-review-preflight state; no sequence or lease was consumed')
  const usable=(row)=>usability.get(row.provider)?.usable===true
  return {
    eligible:independent.filter(usable),
    unusable:new Map(independent.filter((row)=>!usable(row)).map((row)=>[row.name,usability.get(row.provider)??{status:'unreadable',usable:false}]))
  }
}

// ---------------------------------------------------------------------------
// Reading the orchestrator marker resolver (issue #2127)
//
// `check-orchestrator-marker.mjs --resolve --json` EXITS NON-ZERO FOR ANSWERS IT
// IS CERTAIN OF: 3 for `state: none`, 1 for `ambiguous` / `invalid` / `unsafe`.
// Only exit 2 (Unknown) and a crash mean "the question could not be answered",
// and those print nothing parseable on stdout.
//
// This used to be one `execFileSync` inside a `try`, so ANY non-zero exit was
// reported as `live orchestrator engine could not be resolved (Command failed:
// ...)`. With zero open markers that froze reviewer assignment repository-wide
// AND blamed a broken resolver for a resolver that had answered correctly.
// Read stdout on the failure path FIRST; decide from `state`, never from status.
export function readOrchestratorResolution(run){
  let raw
  try{raw=run()}
  catch(error){
    raw=error?.stdout??''
    if(!String(raw).trim())throw new LaneError(`live orchestrator marker resolver could not be run (${error?.message??'no output'})`)
  }
  let parsed
  try{parsed=JSON.parse(raw)}
  catch(error){throw new LaneError(`live orchestrator marker resolver produced unreadable output (${error.message}); reviewer assignment refused`)}
  if(!parsed||typeof parsed.state!=='string')throw new LaneError('live orchestrator marker resolver returned no state; reviewer assignment refused')
  return parsed
}

// declared -> the engine to exclude. none -> null, exclude nothing.
// ambiguous / invalid / unsafe -> refuse, and say which one it is.
export function orchestratorEngineFromResolution(resolved){
  if(resolved.state==='declared'){
    const engine=resolved.routing?.engine
    if(!engine)throw new LaneError('live orchestrator marker declares no engine; reviewer assignment refused')
    return String(engine).toLowerCase()
  }
  if(resolved.state==='none')return null
  throw new LaneError(`live orchestrator marker is ${resolved.state}; reviewer assignment refused until the marker state is resolved`)
}

function runOrchestratorResolver(){
  return execFileSync(process.execPath,['scripts/check-orchestrator-marker.mjs','--resolve','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})
}
export const EXCLUSIVE_REFS = Object.freeze({
  preview: 'refs/db-coordination/preview',
  'preview-recovery': 'refs/db-coordination/preview',
  // POST-MERGE REHEARSAL. Deliberately the SAME ref as the ordinary preview
  // lane, so a rehearsal and an ordinary preview run can never both hold
  // preview -- no new interaction and no new hatch. NOTE WHAT THIS REF DOES NOT
  // DO: it is not cross-checked against `merge` or `production` in either
  // direction (the only cross-checks are the two `EXCLUSIVE_REFS` reads below,
  // promotion-waits-for-merge and merge-waits-for-production). A rehearsal is
  // therefore NOT excluded from a guarded merge or a promotion. That is
  // pre-existing behaviour of the preview lane which this kind inherits
  // unchanged; an earlier comment here claimed the exclusion existed (#1213
  // round 7 audit).
  'preview-rehearsal': 'refs/db-coordination/preview',
  merge: 'refs/db-coordination/merge',
  production: 'refs/db-coordination/production',
})

// Terminal reviewer failure codes. `local_dependency_unavailable` is separate
// from `provider_unavailable` on purpose: the first is a fault on THIS machine
// and is usually a thirty-second fix, the second is the provider being down and
// means waiting. Collapsing them is what produced a two-day pause of a working
// reviewer (#1287). Keep them distinct.
// `reviewer_cannot_read_repository` (#2079) is the code for a reviewer that is
// structurally incapable of reading the code under review. It is terminal in the
// strongest sense -- no retry, no wrapper version and no better prompt gives an
// HTTP client a checkout -- and it exists so the recovery route this tool NAMES
// is one an operator can actually run, instead of forcing a misdescription as
// `wrapper_terminal_failure`.
export const TERMINAL_FAILURE_CODES = Object.freeze(['insufficient_quota','provider_unavailable','local_dependency_unavailable','wrapper_terminal_failure','turn_limit_cancelled','reviewer_cannot_read_repository'])

export const QUEUE_STATUSES = new Set(['ready','blocked','owner-decision'])
export const QUEUE_WORK_TYPES = new Set(['structural','curated-master-data','application-data','source-data','repo-maintenance','documentation','security-settings'])
export const QUEUE_ROUTES = new Set(['shared-db-orchestrator','curated-master-data-governance','application-session','source-data-session','owner-only','repo-maintenance'])
const ROUTES_BY_WORK_TYPE = Object.freeze({
  structural: new Set(['shared-db-orchestrator']),
  'curated-master-data': new Set(['curated-master-data-governance']),
  'application-data': new Set(['application-session']),
  'source-data': new Set(['source-data-session']),
  'repo-maintenance': new Set(['repo-maintenance','owner-only']),
  documentation: new Set(['repo-maintenance','owner-only']),
  'security-settings': new Set(['owner-only','repo-maintenance']),
})

// ORCHESTRATOR ADMISSION TEST (AGENTS.md 0.0-C). A parsed scope block that is
// not `structural` never exits by `accept`. Each non-structural work type names
// WHERE it goes instead, because the old single `fork` value did not say who
// picks the work up, and an ambiguous exit is what let repository-maintenance
// work be read as an orchestrator worklist.
//
// OWNER RULING 2026-08-21 (issue #1366). The shared-db orchestrator does
// database STRUCTURE and SCHEMA only. Repository maintenance, documentation and
// security-settings work is performed by a SEPARATELY STARTED session and is
// never an orchestrator assignment - not even to dispatch. The orchestrator's
// own context is reserved for triage, dispatch, review and merge of structural
// work, so it must never work one of these itself no matter how small it looks.
export const NON_STRUCTURAL_EXITS = Object.freeze({
  'application-data': 'reject',
  'source-data': 'reject',
  // FORK, not REJECT, and DELIBERATELY UNCHANGED by issue #1366. Curated Master
  // Data is governed INSIDE this repo by 6.4: it binds the AI session doing the
  // typing and never leaves for an application repo. It exits by fork because it
  // must not be worked in the orchestrator's own context - not because it belongs
  // to somebody else. A curated fork that ships supabase/migrations/* must still
  // claim a lane before authoring: version reservation and object collision locks
  // are safety controls. Curated work that ships no migration does not use a lane.
  //
  // The 2026-08-21 ruling was about repository-maintenance work. It did NOT
  // change how curated Master Data is routed. Do not move this to another exit
  // without a separate explicit owner ruling.
  'curated-master-data': 'fork',
  // REPO-SESSION, not FORK. These are owned by a separately started repository
  // session. The orchestrator records them so an audit can see them, and then
  // takes no action at all: it does not work them and it does not dispatch them.
  'repo-maintenance': 'repo-session',
  documentation: 'repo-session',
  // RETURN-TO-OWNER. A security-settings change needs authority the orchestrator
  // does not have, so it goes to Albert rather than to any session.
  'security-settings': 'return-to-owner',
})

// Exits that mean "this is not the orchestrator's work AND the orchestrator has
// nothing to do about it" - visible to an audit, never a worklist.
export const OUTSIDE_ORCHESTRATOR_EXITS = Object.freeze(['repo-session', 'return-to-owner'])

// A REJECT exit must MOVE the task, never merely decline it. `return_to` is the
// forwarding address: the repository whose session owns the work. Rejecting
// without one closes the issue into silence, because the session that filed it
// has usually already ended and nobody reads the notification.
export const RETURN_ADDRESS_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
export const RETURNED_MARKER = 'RETURNED TO'

export function requiresReturnAddress(workType) {
  return NON_STRUCTURAL_EXITS[workType] === 'reject'
}

export function queueExit(workType) {
  if (workType === 'structural') return 'accept'
  const exit = NON_STRUCTURAL_EXITS[workType]
  if (!exit) throw new LaneError(`no orchestrator exit is defined for work_type ${workType}`)
  return exit
}

export function parseQueueScope(body = '') {
  const fences=[...body.matchAll(/```db-work-scope\s*\n([\s\S]*?)```/g)]
  if (!fences.length) return null
  if (fences.length !== 1) throw new LaneError('exactly one db-work-scope block is required')
  const fence=fences[0]
  const lines = fence[1].split(/\r?\n/), fields = new Map()
  // THREE list keys, one parser. `objects:` is the legacy spelling and means
  // `writes:` - see LEGACY_OBJECTS_MEANS_WRITES below. seenListHeaders makes a
  // repeated list header an error rather than a silent append.
  const lists = { objects: [], writes: [], reads: [] }
  const seenListHeaders = new Set()
  let currentList = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const listHeader = /^(objects|writes|reads):$/.exec(line)
    if (listHeader) {
      if (seenListHeaders.has(listHeader[1])) throw new LaneError(`db-work-scope repeats the ${listHeader[1]}: list`)
      seenListHeaders.add(listHeader[1])
      currentList = listHeader[1]
      continue
    }
    if (currentList && line.startsWith('- ')) { lists[currentList].push(line.slice(2).trim()); continue }
    currentList = null
    const match = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (!match || fields.has(match[1])) throw new LaneError('unreadable db-work-scope block')
    fields.set(match[1], match[2].trim())
  }
  if (fields.has('state')) throw new LaneError('db-work-scope state is retired; use separate status, work_type, and route fields')
  const status = fields.get('status')
  const workType = fields.get('work_type')
  const route = fields.get('route')
  if (!QUEUE_STATUSES.has(status)) throw new LaneError(`db-work-scope status must be one of ${[...QUEUE_STATUSES].join(', ')}`)
  if (!QUEUE_WORK_TYPES.has(workType)) throw new LaneError(`db-work-scope work_type must be one of ${[...QUEUE_WORK_TYPES].join(', ')}`)
  if (!QUEUE_ROUTES.has(route)) throw new LaneError(`db-work-scope route must be one of ${[...QUEUE_ROUTES].join(', ')}`)
  if (!ROUTES_BY_WORK_TYPE[workType].has(route)) throw new LaneError(`route ${route} is not valid for work_type ${workType}`)
  const priority = Number(fields.get('priority'))
  if (!Number.isInteger(priority) || priority < 0) throw new LaneError('db-work-scope priority must be a non-negative integer')
  const dependencies = (fields.get('depends_on') ?? '').split(',').map((v)=>v.trim()).filter(Boolean).map((v)=>Number(String(v).replace(/^#/,'')))
  if (dependencies.some((v)=>!Number.isInteger(v) || v <= 0)) throw new LaneError('db-work-scope depends_on must contain issue numbers')
  // LEGACY_OBJECTS_MEANS_WRITES. A flat `objects:` list never distinguished a
  // reader from a writer, so the only safe reading of an existing claim is the
  // conservative one: every declared object is a WRITE. Reading a legacy claim as
  // a read would let a new writer run against work already in flight.
  if (lists.objects.length && (lists.writes.length || lists.reads.length)) {
    throw new LaneError('db-work-scope must not mix the legacy objects: list with writes:/reads:; objects: means writes:')
  }
  const legacyObjects = lists.objects.length ? validateClaimObjects(lists.objects) : []
  // VISIBLE DEPRECATION. The alias stays until Step 8A's gate is met (zero open
  // legacy claims/issues, plus 14 days of examples using writes:). A silent alias
  // never gets migrated, because nothing ever reminds anyone it exists.
  if (legacyObjects.length && !process.env.SHARED_DB_SUPPRESS_LEGACY_OBJECTS_WARNING) {
    process.stderr.write('WARNING: db-work-scope uses the deprecated `objects:` list, which is read as `writes:`. Use `writes:` and `reads:` so readers of the same table can run in parallel. See the anti-collision rules in AGENTS.md for the conflict matrix.\n')
  }
  const writes = lists.objects.length ? legacyObjects : (lists.writes.length ? validateClaimObjects(lists.writes) : [])
  const reads = lists.reads.length ? validateClaimObjects(lists.reads) : []
  const declaredBothWays = writes.filter((object)=>reads.includes(object))
  if (declaredBothWays.length) throw new LaneError(`db-work-scope declares ${declaredBothWays.join(', ')} as both a read and a write; a write already implies exclusive access`)
  if (workType === 'structural' && !writes.length) throw new LaneError('structural db-work-scope must list at least one write (use writes:, or the legacy objects:)')
  if (workType !== 'structural' && (writes.length || reads.length)) throw new LaneError(`${workType} db-work-scope must not claim database objects`)
  if (route === 'owner-only' && status !== 'owner-decision') throw new LaneError('owner-only route requires status owner-decision')
  // Present-but-malformed is a hard error; absent is reported by the audit as a
  // missing return address rather than thrown, so one unaddressed issue cannot
  // make every other open issue unauditable.
  const returnTo = fields.get('return_to') ?? null
  if (returnTo !== null && !RETURN_ADDRESS_PATTERN.test(returnTo)) throw new LaneError('db-work-scope return_to must be an owner/repo slug')
  if (returnTo !== null && workType === 'structural') throw new LaneError('structural db-work-scope must not carry a return_to address; use application_return_to')
  const serviceClass = fields.get('service_class') ?? (workType === 'structural' ? 'standard-application' : 'maintenance')
  if (!SERVICE_CLASSES.includes(serviceClass)) throw new LaneError(`db-work-scope service_class must be one of ${SERVICE_CLASSES.join(', ')}`)
  if (workType !== 'structural' && serviceClass !== 'maintenance') throw new LaneError(`${workType} work cannot self-promote to application service class`)
  const changeType = fields.get('change_type') ?? null
  if (changeType !== null && !CHANGE_TYPES.includes(changeType)) throw new LaneError(`db-work-scope change_type must be one of ${CHANGE_TYPES.join(', ')}`)
  const applicationReturnTo = fields.get('application_return_to') ?? null
  if (applicationReturnTo !== null && !RETURN_ADDRESS_PATTERN.test(applicationReturnTo)) throw new LaneError('db-work-scope application_return_to must be an owner/repo slug')
  if (applicationReturnTo !== null && workType !== 'structural') throw new LaneError('application_return_to is only valid for structural outcomes')
  const liveAssertion = fields.get('live_assertion') ?? null
  const generatedTypes = fields.get('generated_types') ?? null
  const outcomeStage = fields.get('outcome_stage') ?? 'entered'
  if (!OUTCOME_STATES.includes(outcomeStage)) throw new LaneError(`db-work-scope outcome_stage must be one of ${OUTCOME_STATES.join(', ')}`)
  // `objects` stays as an alias for `writes` so every existing caller keeps working
  // during the compatibility window. Step 8A removes it once the queue audit finds
  // zero open legacy claims.
  return { status, workType, route, priority, dependencies, returnTo, writes, reads, legacyObjects, objects: writes, serviceClass, changeType, applicationReturnTo, liveAssertion, generatedTypes, outcomeStage }
}

export const COORDINATION_LABELS = new Set(['db-claim','orchestrator-marker'])
export const WORK_LABEL = 'db-work'

// THE CONFLICT MATRIX (Step 2, issue #1366).
//
//              B reads   B writes
//   A reads      no        YES
//   A writes     YES       YES
//
// Read/read running in parallel is the entire point: two sessions may inspect the
// same table at once. Anything involving a write serialises, in BOTH directions,
// because a writer changing an object underneath a reader is exactly the silent
// corruption these lanes exist to prevent.
export function conflicts(a, b) {
  const aWrites = new Set(a?.writes ?? []), bWrites = new Set(b?.writes ?? [])
  for (const object of aWrites) if (bWrites.has(object)) return true
  for (const object of (b?.reads ?? [])) if (aWrites.has(object)) return true
  for (const object of (a?.reads ?? [])) if (bWrites.has(object)) return true
  return false
}

// Two flat lists, compared as writes. Conservative on purpose: a caller that has
// lost the read/write distinction must not be handed a weaker answer.
function overlaps(a, b) { return conflicts({ writes: a, reads: [] }, { writes: b, reads: [] }) }

function downstreamBlockerCounts(dependencyEdges) {
  const dependents = new Map()
  for (const [issue, dependencies] of Object.entries(dependencyEdges)) {
    for (const dependency of dependencies) {
      if (!dependents.has(dependency)) dependents.set(dependency, new Set())
      dependents.get(dependency).add(Number(issue))
    }
  }
  const count = (issue) => {
    const seen = new Set(), pending = [...(dependents.get(issue) ?? [])]
    while (pending.length) {
      const dependent = pending.pop()
      if (seen.has(dependent)) continue
      seen.add(dependent)
      pending.push(...(dependents.get(dependent) ?? []))
    }
    return seen.size
  }
  return new Map(Object.keys(dependencyEdges).map(Number).map((issue)=>[issue,count(issue)]))
}

function queueOrder(a,b) {
  const serviceRank = { 'urgent-application': 0, 'standard-application': 1, maintenance: 2 }
  const stageRank = Object.fromEntries(OUTCOME_STATES.map((state,index)=>[state,index]))
  return serviceRank[a.serviceClass]-serviceRank[b.serviceClass]
    || (stageRank[b.outcomeStage]??0)-(stageRank[a.outcomeStage]??0)
    || b.blockedIssueCount-a.blockedIssueCount
    || a.createdAt-b.createdAt
    || a.issue-b.issue
}

export function buildDynamicQueues(issues, claims, now = new Date(), allOpenIssueNumbers = issues.map((issue)=>issue.number), dependencyStates = null, claimPullStates = new Map(), authoredOnMain = new Set(), outcomeStates = new Map()) {
  const openNumbers = new Set(allOpenIssueNumbers.map(Number))
  const skipped = [], unclassified = [], malformed = [], unlabelled = [], candidates = [], notOrchestratorWork = []
  const dependencyEdges = {}
  const grandfatheredDependencies = []
  for (const issue of issues) {
    // githubIo always supplies a labels array, so real audits always run this
    // check; callers that pass no labels at all are asserting they carry no
    // label information rather than asserting the label is absent.
    if (Array.isArray(issue.labels) && !issue.labels.includes(WORK_LABEL)) unlabelled.push(issue.number)
    let scope
    try { scope = parseQueueScope(issue.body) } catch (error) { malformed.push({ issue:issue.number, reason:error.message }); continue }
    if (!scope) { unclassified.push(issue.number); continue }
    // Recorded before the status check so a non-structural issue parked at
    // `blocked` or `owner-decision` is still reported with its exit. Silently
    // parked items are how non-shape work accumulated in the queue until an
    // orchestrator eventually read one and did it in its own context.
    if (scope.workType !== 'structural') {
      notOrchestratorWork.push({
        issue: issue.number,
        title: issue.title,
        workType: scope.workType,
        route: scope.route,
        exit: queueExit(scope.workType),
        blockedOnOwner: scope.route === 'owner-only',
        returnTo: scope.returnTo,
        needsReturnAddress: requiresReturnAddress(scope.workType) && !scope.returnTo,
      })
    }
    if (scope.status !== 'ready') { skipped.push({ issue:issue.number, reason:`status:${scope.status}`, workType:scope.workType, route:scope.route }); continue }
    if (scope.workType !== 'structural' || scope.route !== 'shared-db-orchestrator') {
      skipped.push({ issue:issue.number, reason:'not-migration-author-work', workType:scope.workType, route:scope.route }); continue
    }
    // A closed author claim is the normal result of a merge. If its permanently
    // reserved version is on main, the issue may remain open for promotion, but
    // it must never be offered as fresh authoring again.
    if (authoredOnMain.has(issue.number)) {
      skipped.push({ issue:issue.number, reason:'authored-on-main', detail:'a closed claim has a merged migration version on current main' })
      continue
    }
    // DEPENDENCY PROOF (Step 3, issue #1366). `dependencyStates` is gathered by the
    // caller so this function stays pure and exhaustively testable. When it is
    // absent the old open-set test is used, which keeps every existing caller and
    // fixture working; the CLI always supplies it.
    dependencyEdges[issue.number] = scope.dependencies
    try {
      validateDependencyDeclaration(issue.number, scope.dependencies)
    } catch (error) {
      malformed.push({ issue: issue.number, reason: error.message })
      continue
    }
    if (dependencyStates) {
      const verdict = classifyDependencies(issue.number, scope.dependencies, dependencyStates)
      for (const row of verdict.results.filter((r)=>r.status === 'grandfathered')) {
        grandfatheredDependencies.push({ issue: issue.number, dependency: row.number, detail: row.reason })
      }
      if (!verdict.satisfied) {
        for (const blocked of verdict.blocked) {
          skipped.push({ issue: issue.number, reason: `${blocked.status}:${blocked.number}`, detail: blocked.reason })
        }
        continue
      }
    } else {
      const waiting = scope.dependencies.filter((number)=>openNumbers.has(number))
      if (waiting.length) { skipped.push({ issue:issue.number, reason:`depends-on-open:${waiting.join(',')}` }); continue }
    }
    const createdAt = Date.parse(issue.createdAt ?? issue.created_at ?? '')
    if(scope.changeType===null){skipped.push({issue:issue.number,reason:'missing-required-admission-fields'});continue}
    try { evaluateAdmission(issue, scope, parseImpactBlock(issue.body)) }
    catch (error) { malformed.push({ issue: issue.number, reason: error.message }); continue }
    const authoritativeOutcome=outcomeStates.get(Number(issue.number)) ?? 'entered'
    candidates.push({ issue:issue.number, title:issue.title, createdAt:Number.isFinite(createdAt)?createdAt:Number(issue.number), ...scope, outcomeStage:authoritativeOutcome })
  }
  const blockerCounts = downstreamBlockerCounts(dependencyEdges)
  for (const candidate of candidates) candidate.blockedIssueCount = blockerCounts.get(candidate.issue) ?? 0
  const protectedClaims = claims.map((claim)=>{
    const lease = parseAuthorLease(claim.body,now)
    return { claim:claim.number, issue:null, priority:Number.MAX_SAFE_INTEGER, writes:lease.writes, reads:lease.reads ?? [], objects:lease.writes, capacityActive:lease.capacityActive, leaseState:lease.capacityState, expiresAt:lease.expiresAt?.toISOString?.() ?? null, prState:claimPullStates.get(claim.number) ?? 'unknown' }
  })
  const components = [...protectedClaims, ...candidates].map((item)=>[item])
  for (let i=0;i<components.length;i++) for (let j=i+1;j<components.length;) {
    if (components[i].some((a)=>components[j].some((b)=>conflicts(a,b)))) components[i].push(...components.splice(j,1)[0]); else j++
  }
  // Uncapped: every collision component gets its own lane, numbered in order.
  const queues = []
  const componentRank = (component) => component.filter((item)=>item.issue).sort(queueOrder)[0]
  const ordered = components.sort((a,b)=>Number(Boolean(b.some(x=>x.claim)))-Number(Boolean(a.some(x=>x.claim))) || (componentRank(a)&&componentRank(b)?queueOrder(componentRank(a),componentRank(b)):0))
  for (const component of ordered) {
    const protectedItems = component.filter((x)=>x.claim)
    const activeItem = protectedItems.find((x)=>x.capacityActive)
    const lane = { lane:queues.length+1, active:null, activeLeaseState:null, activeExpiresAt:null, activePrState:null, protected:[], queued:[], objects:[], reads:[] }
    queues.push(lane)
    if (activeItem) {
      lane.active = activeItem.claim
      lane.activeLeaseState = activeItem.leaseState
      lane.activeExpiresAt = activeItem.expiresAt
      lane.activePrState = activeItem.prState
    }
    lane.protected.push(...protectedItems.map((item)=>item.claim))
    lane.queued.push(...component.filter((x)=>x.issue).sort(queueOrder).map((x)=>x.issue))
    lane.objects.push(...new Set(component.flatMap((x)=>x.writes ?? x.objects ?? [])))
    lane.reads.push(...new Set(component.flatMap((x)=>x.reads ?? [])))
  }
  const authorQueues = queues
  const emptyLanes = authorQueues.filter((q)=>!q.active).length
  const dispatchable = authorQueues.filter((q)=>!q.active && !q.protected.length && q.queued.length).map((q)=>q.queued[0])
  const urgentWaitingCapacity = candidates.filter((candidate)=>candidate.serviceClass==='urgent-application'&&!dispatchable.includes(candidate.issue)).filter((candidate)=>{
    const queue=authorQueues.find((row)=>row.queued.includes(candidate.issue));return Boolean(queue?.active)||Boolean(queue?.protected?.length)
  }).map((candidate)=>candidate.issue)
  const expiredClaims = authorQueues.filter((q)=>q.active && q.activeLeaseState === 'expired-unconfirmed').map((q)=>({ claim:q.active, lane:q.lane, expires_at:q.activeExpiresAt, pr_state:q.activePrState, queued:[...q.queued] }))
  // A CYCLE IS NEVER STARTABLE and is invisible to an open/closed test, so it is
  // reported as its own finding rather than as N tasks that merely look blocked.
  const dependencyCycles = findDependencyCycles(dependencyEdges)
  return { queues, expiredClaims, skipped, unclassified, malformed, unlabelled, notOrchestratorWork, dependencyCycles, grandfatheredDependencies, blockerCounts:Object.fromEntries(blockerCounts), dispatchable, urgentWaitingCapacity, emptyLanes, fullyAudited:!unclassified.length&&!malformed.length&&!unlabelled.length&&!dependencyCycles.length }
}

// RETURN PATH (AGENTS.md 0.0-C). A rejected task is forwarded to the repository
// that owns it and only then closed here, so the closing comment always carries
// a live link to where the work actually went. Order is the whole safety
// property: the mirror issue is created FIRST, and any failure leaves this issue
// open and untouched. Never reorder these three steps.
export function returnIssueToOwner(number, io, { alreadyReturned } = {}) {
  const issue = io.getIssue(number)
  if (!issue) throw new LaneError(`issue #${number} could not be read`)
  if (issue.state && String(issue.state).toLowerCase() === 'closed') throw new LaneError(`issue #${number} is already closed`)
  const scope = parseQueueScope(issue.body)
  if (!scope) throw new LaneError(`issue #${number} carries no db-work-scope block, so its owner is unknown`)
  if (queueExit(scope.workType) !== 'reject') throw new LaneError(`issue #${number} is ${scope.workType} work, whose exit is ${queueExit(scope.workType)}, not return`)
  if (!scope.returnTo) throw new LaneError(`issue #${number} has no return_to address; add one before returning it`)
  const priorComments = alreadyReturned ?? io.getIssueComments(number).map((comment)=>comment.body ?? '')
  const prior = priorComments.find((body)=>body.includes(RETURNED_MARKER))
  if (prior) throw new LaneError(`issue #${number} was already returned: ${prior.trim()}`)

  const body = [
    `Returned from ${REPO}#${number} by the shared-db orchestrator.`,
    '',
    `This is **${scope.workType}** work. Under the shared-db admission test (AGENTS.md 0.0-C) it changes the CONTENTS of the shared database, not its SHAPE, so the session working in this repository owns it outright — no shared-db issue, no dispatch, no migration.`,
    '',
    `Original issue: https://github.com/${REPO}/issues/${number}`,
    '',
    '---',
    '',
    issue.body ?? '',
  ].join('\n')
  const url = io.createIssueIn(scope.returnTo, issue.title, body)
  if (!url) throw new LaneError('the owning repository did not return an issue URL; nothing was closed here')

  io.commentIssue(number, `${RETURNED_MARKER} ${url}

This is ${scope.workType} work and belongs to ${scope.returnTo} (AGENTS.md 0.0-C). It has been filed there and is closed here. It is not abandoned — follow the link.`)
  io.closeIssue(number)
  return { issue: number, returnedTo: scope.returnTo, url, workType: scope.workType }
}

export class LaneError extends Error {}

const CLAIM_KINDS = new Set(['schema','table','column','view','materialized view','function','procedure','trigger','policy','type','domain','sequence','index','publication','storage bucket'])
export function validateClaimObjects(objects) {
  const normalized = objects.map(normalizeObject)
  if (new Set(normalized).size !== normalized.length) throw new LaneError('duplicate object claims are not allowed')
  for (const object of [...normalized]) {
    const ident = '(?:[a-z_][a-z0-9_$]*|"(?:[^"]|"")+")'
    const match = new RegExp(`^column (${ident}\\.${ident})\\.${ident}$`).exec(object)
    if (match && !normalized.includes(`table ${match[1]}`)) normalized.push(`table ${match[1]}`)
  }
  if (!normalized.length) throw new LaneError('at least one exact object is required')
  for (const object of normalized) {
    const kind = [...CLAIM_KINDS].sort((a,b)=>b.length-a.length).find((k)=>object.startsWith(`${k} `))
    if (!kind) throw new LaneError(`unknown object kind in claim: ${object}`)
    const target = object.slice(kind.length + 1)
    const ident = '(?:[a-z_][a-z0-9_$]*|"(?:[^"]|"")+")'
    const qualified = new RegExp(`^${ident}\\.${ident}$`)
    const namedOn = new RegExp(`^${ident} on ${ident}\\.${ident}$`)
    if (kind === 'schema' || kind === 'publication' || kind === 'storage bucket') {
      if (!new RegExp(`^${ident}$`).test(target)) throw new LaneError(`claim must name one exact ${kind}: ${object}`)
    } else if (kind === 'trigger' || kind === 'policy') {
      if (!namedOn.test(target)) throw new LaneError(`claim must use "${kind} name on schema.table": ${object}`)
    } else if (kind === 'column') {
      if (!new RegExp(`^${ident}\\.${ident}\\.${ident}$`).test(target)) throw new LaneError(`claim must use "column schema.table.column": ${object}`)
    } else if (!qualified.test(target)) throw new LaneError(`claim must use a schema-qualified exact name: ${object}`)
  }
  return normalized
}

export function parseAuthorLease(body, now = new Date()) {
  if (!/```db-claim\s*\n/.test(body)) throw new LaneError('missing fenced db-claim block')
  const claim = parseClaimBlock(body)
  if (!claim) throw new LaneError('unreadable fenced db-claim block')
  const fence = /```db-author-lease\s*\n([\s\S]*?)```/.exec(body)
  if (!fence) return { ...claim, legacy: true, active: true, capacityState:'active', capacityActive:true, blockedOn:null, owner: null, branch: null, worktree: null, expiresAt: null }
  if (!/^\d{14}$/.test(String(claim.version ?? ''))) throw new LaneError('db-claim version must be exactly 14 digits')
  if (!claim.writes.length) throw new LaneError('db-claim must list at least one exact object to write')
  const fields = new Map()
  for (const raw of fence[1].split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const match = /^([a-z_]+):\s*(.+)$/.exec(line)
    if (!match || fields.has(match[1])) throw new LaneError('unreadable db-author-lease block')
    fields.set(match[1], match[2].trim())
  }
  for (const required of ['owner', 'branch', 'worktree', 'expires_at']) {
    if (!fields.get(required)) throw new LaneError(`db-author-lease is missing ${required}`)
  }
  const expiresAt = new Date(fields.get('expires_at'))
  if (Number.isNaN(expiresAt.valueOf())) throw new LaneError('db-author-lease expires_at is not a valid ISO timestamp')
  const declaredCapacityState = fields.get('capacity_state') ?? 'active'
  if (!AUTHOR_CAPACITY_STATES.includes(declaredCapacityState)) throw new LaneError(`db-author-lease capacity_state must be one of ${AUTHOR_CAPACITY_STATES.join(', ')}`)
  const blockedOn = fields.get('blocked_on') ?? null
  if (declaredCapacityState === 'relinquished' && !blockedOn) throw new LaneError('relinquished author capacity must name blocked_on')
  if (declaredCapacityState !== 'relinquished' && blockedOn) throw new LaneError('blocked_on is allowed only for relinquished author capacity')
  const active = expiresAt > now
  const capacityState = !active && declaredCapacityState === 'active' ? 'expired-unconfirmed' : declaredCapacityState
  // Clock expiry never frees capacity. Only an explicit relinquished fence does.
  const capacityActive = declaredCapacityState !== 'relinquished'
  return { ...claim, legacy: false, owner: fields.get('owner'), branch: fields.get('branch'), worktree: fields.get('worktree'), expiresAt, active, capacityState, declaredCapacityState, capacityActive, blockedOn }
}

export function assertLaneAvailable(claims, proposedObjects, now = new Date(), { prSources = [] } = {}) {
  const parsed = claims.map((claim) => {
    try { return { ...claim, lease: parseAuthorLease(claim.body, now) } }
    catch (error) { throw new LaneError(`claim #${claim.number} is unreadable: ${error.message}`) }
  })
  // No capacity refusal: author lanes are unlimited (issue #2775). An expiry never
  // releases object protection; cleanup must close the issue explicitly before
  // another author can touch its objects.
  const occupied = parsed.filter((claim)=>claim.lease.capacityActive)
  const wanted = new Set(proposedObjects.map(normalizeObject))
  for (const holder of [...parsed.map((c) => ({ label: `claim #${c.number}`, objects: c.lease.objects })), ...prSources]) {
    const overlap = (holder.objects ?? []).map(normalizeObject).filter((object) => wanted.has(object))
    if (overlap.length) throw new LaneError(`object collision with ${holder.label}: ${[...new Set(overlap)].join(', ')}`)
  }
  return { active: occupied, protected:parsed, relinquished:parsed.filter((claim)=>!claim.lease.capacityActive), stale: parsed.filter((claim) => !claim.lease.legacy && !claim.lease.active) }
}

export function claimBody({ version, objects, writes, reads = [], owner, branch, worktree, expiresAt, capacityState = 'active', blockedOn = null }) {
  // `objects` is the deprecated parameter name for `writes`. Accepting both keeps
  // every existing caller working through the compatibility window; Step 8A drops
  // the alias once no open claim uses it.
  const written = (writes ?? objects ?? []).map((o) => normalizeObject(o))
  const read = (reads ?? []).map((o) => normalizeObject(o)).filter((o) => !written.includes(o))
  const lines = ['```db-claim', `version: ${version}`, 'writes:', ...written.map((o) => `  - ${o}`)]
  // Emit `reads:` only when there is one. An always-present empty header would
  // make every legacy claim look edited in a diff.
  if (read.length) lines.push('reads:', ...read.map((o) => `  - ${o}`))
  if (!AUTHOR_CAPACITY_STATES.includes(capacityState)) throw new LaneError(`capacityState must be one of ${AUTHOR_CAPACITY_STATES.join(', ')}`)
  if (capacityState === 'relinquished' && !blockedOn) throw new LaneError('relinquished capacity requires blockedOn')
  if (capacityState !== 'relinquished' && blockedOn) throw new LaneError('blockedOn is allowed only for relinquished capacity')
  lines.push('```', '', '```db-author-lease', `owner: ${owner}`, `branch: ${branch}`, `worktree: ${worktree}`, `expires_at: ${expiresAt.toISOString()}`, `capacity_state: ${capacityState}`)
  if (blockedOn) lines.push(`blocked_on: ${blockedOn}`)
  lines.push('```', '',
    'This claim remains authoritative until explicitly released. Only an active author-capacity lease occupies an author slot.',
    'Expiry is an audit warning, not an automatic release. The migration version is permanent and is never reused.',
    'WRITES are exclusive. READS may run in parallel with other reads, and block only against a writer.')
  return lines.join('\n')
}

// Re-exported from the one shared transport (issue #2342) so this repository has
// exactly ONE definition of "transient". Widening it -- notably to 404, which the
// observed production failures were -- is a governed decision documented there.
const laneTreeReader=createTreeReader({wrapError:(detail)=>new LaneError(detail)})

export { isTransientGitHubTransport }
// An EXPECTED failure is one this code asks a question with: "does this ref
// exist yet?" answers with HTTP 404, and "create this ref" answers with
// "reference already exists". Both are answers, not faults, but the GitHub CLI
// prints them to the terminal anyway, so a completely healthy run looked
// alarming and trained everyone to ignore 404s -- which is exactly how a REAL
// error on issue #1351 was read as more of the same noise.
//
// The cure must not be "swallow stderr". stderr is CAPTURED here (never
// inherited), attached to the thrown error so the message keeps every detail,
// and re-printed to this process's stderr for every failure that is NOT the
// expected answer. Quieter for the answers, LOUDER for the faults: an
// unexpected gh failure now prints gh's own stderr even when a caller catches
// the exception.
// Exactly the message that PROVES absence (see isConfirmedRefAbsence). A bare
// "not found" without a 404 is ambiguous, stays a hard failure, and must stay
// noisy.
export const EXPECTED_REF_ABSENCE=/HTTP 404/i
export const EXPECTED_REF_PRESENCE=/reference already exists/i
let reviewWireBudget=null,reviewCommitBase=null,freshDurableVerdictRefs=null
function consumeReviewWireRequest(){
  if(!reviewWireBudget)return
  const limit=reviewWireBudget.limit??REVIEW_OPERATION_REQUEST_LIMIT
  const usable=reviewWireBudget.locked&&!reviewWireBudget.cleanup?limit-(reviewWireBudget.cleanupReserve??0):limit
  if(reviewWireBudget.count>=usable)throw new LaneError(`reviewer operation '${reviewWireBudget.operation??'reviewer-operation'}' exhausted its derived ${limit}-request budget before request ${reviewWireBudget.count+1}${usable!==limit?` (${limit-usable} held back as the mutex-release reserve)`:''}. This ceiling is DERIVED for this operation, not a global default: see the derivation cited beside its constant in scripts/manage-migration-author-lanes.mjs. Re-derive it from a written measurement rather than widening it (issue #2075)`)
  reviewWireBudget.count+=1
}
export function withReviewRequestBudget(fn,limit=REVIEW_OPERATION_REQUEST_LIMIT,operation='reviewer-operation'){
  if(reviewWireBudget)return fn(reviewWireBudget)
  reviewWireBudget={count:0,limit,operation}
  try{return fn(reviewWireBudget)}finally{reviewWireBudget=null;reviewCommitBase=null;freshDurableVerdictRefs=null}
}
// Issue #2802: the structural-admission gate (scripts/orchestrator-flow/admission.mjs,
// landed in e7bec2fe on 2026-09-11) is NOT reviewer work, but its GitHub reads -- the
// pull request, the linked work issue, the complete file list, file contents at the
// exact head, the closing-issue link, the outcome history -- were charged to the
// reviewer operation's request ceiling. That ceiling is DERIVED in
// docs/verification/reviewer-assignment-api-budget-2026-08-28.md for a draw that had NO
// admission step: it predates this gate entirely. Charged against it, a structural draw
// exhausted the budget at request 24 (2 held back as the mutex-release reserve). That
// refusal came out of consumeReviewWireRequest from INSIDE the held mutex section, not
// as a cheap fail-fast before the mutex was taken: the mutex-release reserve is only
// subtracted once acquireReviewMutex has set `locked` (see the cleanupReserve assignment
// there), and requirePrOperationRoute -> requireAdmission runs after acquireReviewMutex
// in assignNextReviewerOperation. So the lane had already taken the reviewer mutex and
// made admission's reads under it, and then had to unwind and release it. Every
// migration author lane in the fleet was blocked.
//
// The ceiling is NOT widened and the mutex-release reserve is NOT touched -- issue #2075
// exists precisely to stop that shortcut. Admission still runs, still refuses exactly as
// it did, and still runs under the SAME held mutex before the draw proceeds:
// requireAdmission and requirePrOperationRoute prove continued mutex ownership while
// they run, and that proof is what stops the route or the admission answer changing
// between the check and the draw. Only the ACCOUNTING moves. Admission is charged to a
// reviewer budget nowhere else it is called from either -- acquireAuthorLane, the
// guarded merge gate and preview preparation all call it with no reviewer budget
// installed at all -- so this makes the reviewer path consistent with every other
// admission call site rather than inventing a new exemption for it.
//
// A budget object is still installed rather than `null`, so ghPaginated keeps its
// reviewer-operation refusal of possible pagination, and `locked` is carried through so
// the single-attempt policy for requests made while a mutex is held is unchanged. The
// reviewer operation's own count, caches and reserve are restored untouched.
function withoutReviewRequestBudget(fn){
  if(!reviewWireBudget)return fn()
  const suspended=reviewWireBudget
  reviewWireBudget={count:0,limit:Number.MAX_SAFE_INTEGER,operation:`${suspended.operation??'reviewer-operation'}-admission-gate`,locked:suspended.locked,cleanup:suspended.cleanup}
  try{return fn()}finally{reviewWireBudget=suspended}
}
// Issue #2342: the retry loop, the classifier and the stderr policy now live in
// scripts/lib/github-transport.mjs, which is the ONE transport every governed
// gate uses. What stays here is the part that is specific to this file: the
// reviewer-operation request BUDGET, which must be charged once per attempt —
// so it is charged inside the executor the shared transport calls, not around
// it. Writes default to one attempt. Only the ref helpers below opt into replay,
// because they prove the requested end state with an owner-bound readback.
export function runGitHubCommand(args,{executor=execFileSync,wait=(ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms),attempts=4,expectedFailure=null,reportStderr=(text)=>process.stderr.write(text),idempotentWrite=false,maxBuffer,encoding,input}={}) {
  return sharedRunGitHubCommand(args,{
    executor:(bin,cmdArgs,options)=>{consumeReviewWireRequest();return executor(bin,cmdArgs,options)},
    wait,
    attempts:reviewWireBudget?.locked?1:attempts,
    idempotentWrite,
    expectedFailure,
    reportStderr,
    maxBuffer,
    encoding,
    input,
    wrapError:(detail)=>new LaneError(`GitHub command failed: ${detail}`),
  })
}
function gh(args,options) { return runGitHubCommand(args,options) }

export function createRefWithReadback(ref,sha,{run=gh,readRef}={}) {
  try{run(['api','-X','POST',`repos/${REPO}/git/refs`,'-f',`ref=${ref}`,'-f',`sha=${sha}`],{expectedFailure:EXPECTED_REF_PRESENCE,idempotentWrite:true});return true}
  catch(error){
    if(/reference already exists/i.test(error.message)){
      if(!readRef)return false
      return readRef(ref)===sha
    }
    if(!error.transientTransport||!readRef)throw error
    const actual=readRef(ref)
    if(actual===sha)return true
    if(actual!==null)return false
    throw error
  }
}
export function deleteRefWithReadback(ref,{run=gh,readRef}={}) {
  try{run(['api','-X','DELETE',`repos/${REPO}/git/refs/${ref.replace(/^refs\//,'')}`],{expectedFailure:EXPECTED_REF_ABSENCE,idempotentWrite:true});return}
  catch(error){
    if(isConfirmedRefAbsence(error))return
    if(/reference does not exist/i.test(error.message)&&readRef&&readRef(ref)===null)return
    if(!error.transientTransport||!readRef)throw error
    if(readRef(ref)===null)return
    throw error
  }
}
function ghJson(args,options) {
  const raw = gh(args,options)
  try { return JSON.parse(raw) } catch { throw new LaneError(`GitHub returned unreadable JSON for gh ${args.join(' ')}`) }
}
function ghPaginated(endpoint) {
  if(reviewWireBudget){
    const page=ghJson(['api',endpoint])
    if(!Array.isArray(page))throw new LaneError(`GitHub page for ${endpoint} was incomplete or malformed`)
    if(page.length>=100)throw new LaneError(`GitHub page for ${endpoint} reached 100 rows; reviewer operation refuses possible pagination`)
    return page
  }
  const pages = ghJson(['api', '--paginate', '--slurp', endpoint])
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new LaneError(`GitHub pagination for ${endpoint} was incomplete or malformed`)
  return pages.flat()
}
// Split `gh api -i` output into its response headers and its parsed JSON body.
// The header block is separated from the body by the first blank line; GitHub's
// JSON body never contains one, so the FIRST boundary is always the right one.
// Header names are lowercased because HTTP header names are case-insensitive and
// gh prints them in GitHub's own casing.
// ONE counted request, headers included, for listReviewRefsPaged. Deliberately
// not `--paginate`: that is one gh invocation making an unknown number of HTTP
// requests, which the reviewer wire budget could neither see nor charge.
function ghRefListing(endpoint) { return parseGhIncludeResponse(gh(['api','-i',endpoint])) }
export function parseGhIncludeResponse(raw) {
  const text=String(raw??'')
  const boundary=/\r?\n\r?\n/.exec(text)
  if(!boundary)throw new LaneError('GitHub response had no header/body boundary; refusing to read it as a ref listing')
  const headerBlock=text.slice(0,boundary.index),body=text.slice(boundary.index+boundary[0].length)
  // A REPEATED HEADER IS JOINED, NEVER OVERWRITTEN (#2152 review, glm-5.3).
  // HTTP allows one field to be sent on several lines, and RFC 9110 says the
  // combined value is those lines joined by ", ". Building this map with
  // `Object.fromEntries` kept only the LAST line, so a `Link` line carrying
  // rel="next" sent ahead of a second `Link` line would have vanished -- a
  // silently missed truncation signal, which is the fail-OPEN direction this
  // whole listing exists to prevent.
  const headers={}
  for(const line of headerBlock.split(/\r?\n/).slice(1)){
    const colon=line.indexOf(':')
    if(colon<0)continue
    const name=line.slice(0,colon).trim().toLowerCase(),value=line.slice(colon+1).trim()
    headers[name]=name in headers?`${headers[name]}, ${value}`:value
  }
  let rows
  try{rows=JSON.parse(body)}catch{throw new LaneError('GitHub returned unreadable JSON for a ref listing')}
  return {rows,headers}
}
// Parse an RFC 8288 `Link` field value into `{uri,params}` entries.
//
// PARSED STRUCTURALLY, NOT BY REGULAR EXPRESSION, AND IT FAILS CLOSED (#2152
// review, glm-5.3). The one-line regex this replaces could be fooled from both
// directions: `[^,]*rel="?next"?` matched the text `rel=next` wherever it
// appeared, INCLUDING inside a quoted parameter value such as
// `; title="rel=next"`, and it silently answered "no next page" for any value
// it simply did not recognise. Both are wrong for a truncation guard whose only
// two honest answers are "this is the complete set" and "refuse".
//
// This walks the value once. A quoted string is consumed as a single unit --
// only its closing quote ends it, and a backslash escapes the next character --
// so text inside `title="rel=next"` is a VALUE and can never be mistaken for a
// parameter name. Anything that does not fit the grammar THROWS: a missing `<`,
// an unterminated `<...>` or quoted string, a parameter not introduced by `;`,
// an empty parameter name, a link value carrying no `rel` relation at all, a
// parameter carrying NO `=` at all, or an unquoted
// value that is empty or holds a character outside the token grammar (a stray
// quote above all). Callers let that refusal propagate, because an
// unparseable Link header must never read as "no further pages".
export function parseLinkHeader(value) {
  const text=String(value??'')
  const refuse=(why)=>{throw new LaneError(`unparseable Link header (${why}); refusing to read it as "no further pages" (#2152)`)}
  const space=/[ \t]/
  const tokenChar=/[A-Za-z0-9!#$%&'*+.^_`|~-]/
  // AN ABSENT OR EMPTY FIELD IS THE ONLY "NO FURTHER PAGES" ANSWER. Everything
  // else must be PROVEN well formed before this returns anything at all.
  if(!text.trim())return []
  // PHASE 1 -- PROVE THE OVERALL SHAPE, THEN SPLIT.
  // Four review rounds found four different fail-OPEN holes in a single-pass
  // scanner that accepted whatever it had not specifically objected to (#2152
  // reviews 1-4: a valueless parameter, an unquoted value swallowing a quote, a
  // value with no relation, and an unterminated `<` whose `>` search ran past
  // the end of its own link value and ate the next one). The shape is now
  // inverted: split ONLY on commas that sit outside <URI> and outside a quoted
  // string, and refuse anything this walk cannot fully account for. A `,` or a
  // `;` inside a URI or inside a quoted parameter value is ordinary text and
  // must survive; a second `<` before a `>` proves an earlier <URI> was never
  // closed, which is exactly the hole that let one value swallow another.
  const values=[]
  let current=''
  let state='outside'
  for(let i=0;i<text.length;i++){
    const ch=text[i]
    if(state==='uri'){
      if(ch==='<')refuse('a second < inside <URI>, so an earlier <URI> was never closed')
      if(ch==='>')state='outside'
      current+=ch
      continue
    }
    if(state==='quoted'){
      if(text.charCodeAt(i)===92){if(i+1>=text.length)refuse('trailing escape inside a quoted parameter value');current+=ch+text[i+1];i++;continue} // 92 is a backslash: it escapes the next character, including a quote
      if(ch==='"')state='outside'
      current+=ch
      continue
    }
    if(ch==='<'){state='uri';current+=ch;continue}
    if(ch==='"'){state='quoted';current+=ch;continue}
    if(ch===','){values.push(current);current='';continue}
    current+=ch
  }
  if(state==='uri')refuse('unterminated <URI>')
  if(state==='quoted')refuse('unterminated quoted parameter value')
  values.push(current)
  // PHASE 2 -- EVERY VALUE MUST BE EXACTLY `<URI>` FOLLOWED BY `; name=value`.
  const links=[]
  for(const rawValue of values){
    const v=rawValue.trim()
    if(!v)refuse('an empty link value (a leading, doubled or trailing comma)')
    if(v[0]!=='<')refuse('a link value must begin with <URI>')
    const close=v.indexOf('>')
    if(close<0)refuse('unterminated <URI>')
    const uri=v.slice(1,close)
    const params={}
    let i=close+1
    const skipSpace=()=>{while(i<v.length&&space.test(v[i]))i++}
    skipSpace()
    while(i<v.length){
      // Anything between the closing `>` (or the end of a parameter) and the
      // next `;` is leftover text this parser cannot account for: refuse.
      if(v[i]!==';')refuse(`leftover text in a link value at ${JSON.stringify(v.slice(i))}`)
      i++
      skipSpace()
      const nameStart=i
      while(i<v.length&&tokenChar.test(v[i]))i++
      const name=v.slice(nameStart,i).toLowerCase()
      if(!name)refuse('empty link parameter name')
      skipSpace()
      // RFC 8288 defines link-param as `token BWS "=" BWS ( token / quoted-string )`;
      // there is no valueless form (#2152 review 2).
      if(v[i]!=='=')refuse(`link parameter "${name}" has no value`)
      i++
      skipSpace()
      let parameterValue=''
      if(v[i]==='"'){
        i++
        let closed=false
        while(i<v.length){
          if(v.charCodeAt(i)===92){if(i+1>=v.length)refuse('trailing escape inside a quoted parameter value');parameterValue+=v[i+1];i+=2;continue} // 92 is a backslash
          if(v[i]==='"'){i++;closed=true;break}
          parameterValue+=v[i];i++
        }
        if(!closed)refuse('unterminated quoted parameter value')
      }else{
        // An unquoted value is a token, and a token holds no quote (#2152 review 2).
        const valueStart=i
        while(i<v.length&&tokenChar.test(v[i]))i++
        parameterValue=v.slice(valueStart,i)
        if(!parameterValue)refuse(`empty unquoted value for link parameter "${name}"`)
      }
      // RFC 8288: the FIRST occurrence of a parameter wins. A later repeat of
      // the same name is ignored rather than overwriting it.
      if(!(name in params))params[name]=parameterValue
      skipSpace()
    }
    // RFC 8288 requires every link value to carry a `rel` (#2152 review 3).
    if(!String(params.rel??'').trim())refuse('a link value carries no rel relation')
    links.push({uri,params})
  }
  return links
}
// True when the response advertises a further page. A `Link` field with
// rel="next" is the ONLY signal GitHub gives that a listing is partial, so this
// is the truncation detector -- not a pagination driver. See listReviewRefsPaged.
//
// The field can arrive as several header lines. `parseGhIncludeResponse` joins
// repeats with ", " per RFC 9110, and an array is accepted here too, so a
// rel="next" on ANY of them is seen rather than only the last. `rel` is itself
// a space-separated list of relation types, so it is compared token by token
// and never by substring: `rel="nextish"` is not a next page. An unparseable
// value throws rather than answering false.
export function hasNextPageLink(headers) {
  const raw=headers?.link
  const value=(Array.isArray(raw)?raw:[raw]).filter((line)=>line!=null&&String(line).trim()!=='').map((line)=>String(line).trim()).join(', ')
  if(!value)return false
  return parseLinkHeader(value).some((link)=>String(link.params.rel??'').trim().toLowerCase().split(/\s+/).includes('next'))
}
export function isConfirmedRefAbsence(error) { return /HTTP 404/i.test(String(error?.message??'')) }

export function currentMainMaxVersion(worktree, run = execFileSync) {
  run('git',['-C',worktree,'fetch','--quiet','--no-tags','origin','+refs/heads/main:refs/remotes/origin/main'],{stdio:'ignore'})
  return String(run('git',['-C',worktree,'ls-tree','-r','--name-only','refs/remotes/origin/main'],{encoding:'utf8'})).split(/\r?\n/).map((f)=>/^supabase\/migrations\/(\d{14})_/.exec(f)?.[1]).filter(Boolean).sort().at(-1)
}

export function reviewRecordRefs(refs,matches=[]){
  const replacementVerdicts=matches
    .map((row)=>String(row?.ref??''))
    .filter((ref)=>ref.startsWith(`${REVIEW_REPLACEMENT_REF_PREFIX}/`))
    .map((ref)=>ref.replace(REVIEW_REPLACEMENT_REF_PREFIX,REVIEW_VERDICT_REPLACEMENT_REF_PREFIX))
  return [...new Set([...refs,...matches.map((row)=>row.ref),...replacementVerdicts])]
}

// THE REVIEWER POOL IS NOT DRAWN FOR A DOCUMENTS-ONLY PULL REQUEST (#2102).
//
// The merge gate stops REQUIRING a reviewer for a documents-only change; this
// stops one being DRAWN, which is what actually protects pool capacity. PR #2034
// -- two documentation files -- spent two draws, two dead-reviewer replacements
// and three review runs, and PR #2070 repeated it.
//
// Rulebook files are excluded from the exemption, and the classifier fails closed:
// if the changed-file list cannot be read, the draw proceeds exactly as before.
// A refusal here is never silent -- it names the rule and the classification.
export function assertReviewerDrawIsWarranted(pr,io=githubIo){
  if(typeof io?.pullRequestFiles!=='function')return null
  let rows
  try{rows=io.pullRequestFiles(pr)}catch{return null}
  const verdict=classifyChangedPaths(changedPathsFromPullRequestFiles(rows))
  if(!verdict.documentsOnly)return verdict
  throw new LaneError(`PR #${pr} is a documents-only change (${verdict.reason}), so it does not draw from the database reviewer pool (#2102). Every automated check still runs and it still merges through the guarded merge lane; the merge gate does not require a reviewer verdict for it. Rulebook files -- AGENTS.md, skills, plan_*.md -- are never documents for this purpose and would have been drawn for.`)
}

// ISSUE #2448 — a close comment must state the cause that actually ran.
// Every path that closes a claim names its own mechanism; nothing claims an
// expiry sweep, because no expiry sweep exists (`--cleanup-stale` closes
// nothing). The legacy string is retained ONLY so historical recovery can still
// read claims that were closed before this repair.
export const LEGACY_GUARDED_CLEANUP_CLOSE_REASON = 'Expired migration-author lease closed by guarded cleanup. Its migration version remains unavailable.'
export const CLAIM_CLOSE_REASONS = {
  acquisitionRollback: 'Migration-author claim closed by acquisition rollback: the coordination mutex was lost before this newly created claim could be confirmed. No lease expired and no cleanup sweep ran. Its migration version remains unavailable.',
  explicitRelease: 'Migration-author claim closed by an explicit owner-confirmed release (--release-claim). No lease expired and no cleanup sweep ran. Its migration version remains unavailable.',
  duplicateRelease: 'Duplicate migration-author claim closed by an explicit owner-confirmed duplicate release (--release-duplicate-claim), proved against live GitHub state: another open claim on the same branch holds the migration version that the single open pull request on that branch actually uses. No lease expired and no cleanup sweep ran. Its migration version remains unavailable.',
}
// A closed claim may be recovered only when its close comment records a
// deliberate, owner-confirmed release (or the pre-repair legacy string that
// such releases used to post). A rollback close is not recoverable.
export const RECOVERABLE_CLAIM_CLOSE_REASONS = new Set([LEGACY_GUARDED_CLEANUP_CLOSE_REASON, CLAIM_CLOSE_REASONS.explicitRelease])
function requireClaimCloseReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) throw new LaneError('closing a claim requires an exact stated reason')
  return reason
}

export function matchesLiveProof(proof,evidence){
  return proof?.schema_version===1&&proof.work_issue===evidence.work_issue&&proof.application_commit_sha===evidence.application_commit_sha&&proof.live_assertion===evidence.live_assertion&&proof.environment===evidence.environment&&proof.result==='passed'&&proof.observed_at===evidence.verified_at&&!Number.isNaN(Date.parse(proof.observed_at))
}
export function matchesGeneratedTypesProof(proof,evidence){
  return proof?.schema_version===1&&proof.work_issue===evidence.work_issue&&proof.application_commit_sha===evidence.application_commit_sha&&proof.result==='passed'&&proof.generated_types_sha256===evidence.generated_types_output_digest
}

export const githubIo = {
  enforceAdmission:true,
  // Owner ruling 2026-09-11 (marker #2758): no global FIFO for reviewer draws. Any PR
  // draws any free usable provider immediately; the per-provider lease, engine
  // exclusions, and exact-head binding in assignNextReviewerOperation still apply.
  enableReviewerQueue:false,
  enableReviewerSilence:true,
  requiresExactReviewHeadSha: true,
  // The changed-file list a documents-only classification is made from (#2102).
  // Fetched through `ghPaginated` so this side and the merge gate
  // (`check-exact-head-approval.mjs`) build the list the SAME way: paginate,
  // slurp, verify every page is an array, flatten. One classifier with two
  // fetchers is how the two enforcement points come to disagree, and a
  // disagreement here is a permanently stuck pull request -- the draw refusing
  // while the gate still demands a verdict. A malformed or unreadable response
  // raises, and `assertReviewerDrawIsWarranted` catches it and draws as before:
  // "we could not tell" costs a review, it never grants an exemption.
  pullRequestFiles(pr){return ghPaginated(`repos/${REPO}/pulls/${Number(pr)}/files?per_page=100`)},
  readReviewerOperationRoute(pr){
    const query=`query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){state merged mergedAt headRefOid files(first:100){pageInfo{hasNextPage} nodes{path changeType}} closingIssuesReferences(first:2){pageInfo{hasNextPage} nodes{... on Issue{number state body createdAt}}}}}}`
    const data=ghJson(['api','graphql','-f',`query=${query}`,'-F','owner=u2giants','-F','name=shared-db','-F',`pr=${Number(pr)}`])
    return projectReviewerOperationRouteSnapshot(data)
  },
  countLogicalReviewRequests:true,
  getRateLimit(){
    const rest=ghJson(['api','rate_limit'])?.resources?.core
    const graphRaw=gh(['api','-i','graphql','-f','query=query{rateLimit{limit remaining resetAt}}'])
    const graphText=/\{[\s\S]*$/.exec(graphRaw)?.[0]
    let graph
    try{graph=JSON.parse(graphText)?.data?.rateLimit}catch{return null}
    return rest&&graph?{remaining:Number(rest.remaining),limit:Number(rest.limit),reset:Number(rest.reset),graphRemaining:Number(graph.remaining),graphLimit:Number(graph.limit),graphReset:Math.floor(new Date(graph.resetAt).getTime()/1000)}:null
  },previewApplyRun(runId){return{run:ghJson(['api',`repos/${REPO}/actions/runs/${runId}`]),artifacts:ghJson(['api',`repos/${REPO}/actions/runs/${runId}/artifacts`]),logs:runGitHubCommand(['run','view',String(runId),'--repo',REPO,'--log'])}},
  verifyPreviewApplyArtifact(request){
    return JSON.parse(execFileSync('python',[path.join(path.dirname(fileURLToPath(import.meta.url)),'verify_preview_apply_artifact.py')],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']}))
  },
  readActiveReviewLeases(){
    // Read every reviewer name the immutable catalog still understands, not
    // only today's drawable roster. Replacement can legitimately be finishing
    // a failure recorded while a now-retired reviewer was active. Keeping that
    // exact historical lease in this same fail-closed GraphQL snapshot avoids
    // a later REST ref read plus commit read without making the reviewer
    // drawable again or widening the lease namespace beyond the static catalog.
    const names=[...new Set([...REVIEWERS,...OVERFLOW_REVIEWERS].map((row)=>row.name))]
    const allowed=new Set(names)
    // A matching-ref list is complete-or-refused (see listReviewRefsPaged), so
    // every concurrent lease is examined rather than silently treating a
    // provider as free because only its old one-slot ref was queried.
    const parallel=this.listReviewRefsPaged(`${REVIEW_ACTIVE_PARALLEL_REF_PREFIX}/`)
    const refs=[...names.map((name)=>`${REVIEW_ACTIVE_REF_PREFIX}/${name}`),...parallel.map((row)=>row.ref)]
    const fields=refs.map((ref,index)=>`r${index}:object(expression:${JSON.stringify(ref)}){oid ... on Commit{message committedDate}}`).join(' ')
    const query=`query($owner:String!,$name:String!){repository(owner:$owner,name:$name){defaultBranchRef{target{oid ... on Commit{tree{oid}}}} ${fields}}}`
    const data=ghJson(['api','graphql','-f',`query=${query}`,'-F','owner=u2giants','-F','name=shared-db'])
    if(data?.errors?.length)throw new LaneError('active reviewer lease snapshot returned GraphQL errors')
    const repo=data?.data?.repository
    if(!repo)throw new LaneError('active reviewer lease snapshot is unreadable')
    const base=repo?.defaultBranchRef?.target
    if(!base?.oid||!base?.tree?.oid)throw new LaneError('review commit base is unreadable')
    reviewCommitBase={head:base.oid,tree:base.tree.oid}
    const entries=[]
    refs.forEach((ref,index)=>{
      const target=repo[`r${index}`]
      if(target===undefined)throw new LaneError('active reviewer lease snapshot is unreadable')
      if(target===null)return
      if(!target?.oid||!target?.message)throw new LaneError('active reviewer lease snapshot is unreadable')
      let lease
      try{lease=parseReviewLease({message:target.message})}catch{throw new LaneError('active reviewer lease snapshot is unreadable')}
      if(!allowed.has(lease.reviewer))throw new LaneError('active reviewer lease snapshot is unreadable')
      const legacy=reviewActiveRef(lease.reviewer),parallelRef=/^[0-9a-f]{40}$/i.test(lease.headSha)?reviewLeaseRefForAssignment(lease,true):null
      if(ref!==legacy&&ref!==parallelRef)throw new LaneError('active reviewer lease ref does not match its durable assignment identity')
      entries.push([ref,{sha:target.oid,commit:{message:target.message,committedDate:target.committedDate??null}}])
    })
    return new Map(entries)
  },
  readReviewStates(leases){
    const unique=[...new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,lease])).values()]
    if(!unique.length)return new Map()
    const fields=unique.map(reviewStateGraphqlFields).join(' ')
    const data=ghJson(['api','graphql','-f',`query=query{repository(owner:"u2giants",name:"shared-db"){${fields}}}`])
    if(data?.errors?.length||!data?.data?.repository)throw new LaneError('batched reviewer PR/verdict evidence returned GraphQL errors')
    const result=new Map()
    unique.forEach((lease,index)=>{
      const pr=data.data.repository[`p${index}`],issue=data.data.repository[`i${index}`]
      if(!pr||!issue||!Array.isArray(pr.comments?.nodes)||!Array.isArray(pr.reviews?.nodes)||!Array.isArray(issue.comments?.nodes)||pr.comments?.pageInfo?.hasNextPage!==false||pr.reviews?.pageInfo?.hasNextPage!==false||issue.comments?.pageInfo?.hasNextPage!==false)throw new LaneError('batched reviewer PR/verdict evidence is incomplete or paginated')
      result.set(`${lease.issue}:${lease.pr}`,{issue:{state:String(issue.state).toLowerCase()},pr:projectReviewPr(pr),evidence:[...issue.comments.nodes,...pr.comments.nodes,...pr.reviews.nodes.map((row)=>({...row,commit_id:row.commit?.oid}))]})
    })
    return result
  },
  // GraphQL `ref(qualifiedName:...)` silently resolves to null for refs
  // outside refs/heads/ and refs/tags/, even when the ref genuinely exists
  // (confirmed empirically 2026-08-28 against a live refs/db-review-active/*
  // ref while investigating issue #1810 -- REST proved the ref present while
  // this query answered null). `object(expression:...)` is the form that
  // actually resolves an arbitrary ref path, same as #1808 already found for
  // readActiveReviewLeases.
  readReviewRefs(refs){
    const fields=refs.map((ref,index)=>`r${index}:object(expression:${JSON.stringify(ref)}){oid}`).join(' ')
    const data=ghJson(['api','graphql','-f',`query=query{repository(owner:"u2giants",name:"shared-db"){${fields}}}`])
    if(data?.errors?.length||!data?.data?.repository)throw new LaneError('review ref readback returned GraphQL errors')
    return new Map(refs.map((ref,index)=>[ref,data.data.repository[`r${index}`]?.oid??null]))
  },
  // GitHub's GraphQL `refs(refPrefix:...)` connection only supports the
  // refs/heads/ and refs/tags/ namespaces, and (confirmed 2026-08-28, issue
  // #1810) rejects any prefix without a trailing slash outright with
  // "refPrefix must end with a /". This ref family lives under the custom
  // `refs/db-review-replacements/<issue>-<pr>-<headSha>` namespace and shares
  // a dash-joined prefix across an open-ended number of failure-sequence
  // suffixes, not a directory -- so refPrefix can never list it, whether by
  // silently returning nothing (#1803) or by erroring outright (#1810).
  // `listRefs` already lists this same family correctly via the REST
  // `git/matching-refs` endpoint (plain string-prefix match, no trailing-slash
  // requirement), and is already used elsewhere in this file as a fallback
  // for exactly this ref family -- so it is used here instead of GraphQL's
  // prefix listing. List first, then include every matched immutable ref in
  // the SAME GraphQL record read as the fixed refs. Falling back to one
  // getCommit request per prior replacement makes pre-mutex spend grow with
  // every terminal provider; after two replacements the third cannot reserve
  // the fixed mutex section even though the fixed 25-request ceiling is sufficient.
  readReviewRecords(refs,prefix,dependentFailurePrefix=null){
    // Same `object(expression:...)` fix as readReviewRefs above, applied here
    // too: `ref(qualifiedName:...)` silently answered null for every one of
    // these custom-namespace refs (replacementRef, assignmentRef,
    // REVIEW_CURSOR_REF), which would have made every caller of this method
    // treat a real record as absent.
    const matches=prefix?this.listRefs(prefix):[]
    // A suffixed replacement ref tells us which immutable failure ref its
    // commit must name. Include those dependent refs in this SAME GraphQL
    // snapshot instead of paying one later REST read per predecessor. The
    // legacy unsuffixed replacement has no sequence in its ref name and keeps
    // the strict fallback read after its commit is parsed.
    const dependentFailures=dependentFailurePrefix?matches.flatMap((row)=>{
      const suffix=String(row.ref??'').startsWith(`${prefix}-`)?String(row.ref).slice(String(prefix).length+1):''
      return /^\d+$/.test(suffix)?[`${dependentFailurePrefix}-${suffix}`]:[]
    }):[]
    const allRefs=reviewRecordRefs([...refs,...dependentFailures],matches)
    const fields=allRefs.map((ref,index)=>`r${index}:object(expression:${JSON.stringify(ref)}){oid ... on Commit{message}}`).join(' ')
    const data=ghJson(['api','graphql','-f',`query=query{repository(owner:"u2giants",name:"shared-db"){base:defaultBranchRef{target{... on Commit{oid tree{oid}}}} ${fields}}}`])
    if(data?.errors?.length||!data?.data?.repository)throw new LaneError('review record preflight returned GraphQL errors')
    const base=data.data.repository.base?.target
    if(reviewWireBudget&&base?.oid&&base?.tree?.oid)reviewCommitBase={head:base.oid,tree:base.tree.oid}
    const result=new Map(allRefs.map((ref,index)=>{const target=data.data.repository[`r${index}`];return [ref,target?.oid?{sha:target.oid,commit:{message:target.message}}:null]}))
    Object.defineProperty(result,'matching',{value:matches.map((row)=>{const record=result.get(row.ref);return{ref:row.ref,sha:row.sha,commit:record?.sha===row.sha&&record?.commit?.message?record.commit:undefined}}),enumerable:false})
    return result
  },
  atomicReviewRefs(changes){
    for(const sha of [...new Set(changes.map((change)=>change.sha).filter(Boolean))]){
      try{execFileSync('git',['cat-file','-e',`${sha}^{commit}`],{stdio:'ignore'})}
      catch{try{execFileSync('git',['fetch','--no-tags','origin',sha],{encoding:'utf8',stdio:['ignore','pipe','pipe']})}catch(error){throw new LaneError(`atomic reviewer ref transition could not hydrate commit ${sha}: ${String(error.stderr??error.message??error).trim()}`)}}
    }
    const args=['push','--atomic','origin']
    for(const change of changes)args.push(`--force-with-lease=${change.ref}:${change.expected??''}`)
    for(const change of changes)args.push(change.sha?`${change.sha}:${change.ref}`:`:${change.ref}`)
    try{execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})}catch(error){throw new LaneError(`atomic reviewer ref transition failed: ${String(error.stderr??error.message??error).trim()}`)}
  },
  atomicReviewMutexRelease(ownerSha){
    return this.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:null}])
  },
  openClaims() {
    const rows = ghPaginated(`repos/${REPO}/issues?state=open&labels=db-claim&per_page=100`)
    return rows.filter((x) => !x.pull_request).map((x) => ({ number: x.number, title: x.title, body: x.body, url: x.html_url }))
  },closedClaimsForWork(issue,pager=ghPaginated){return pager(`repos/${REPO}/issues?state=closed&labels=db-claim&per_page=100`).filter((x)=>!x.pull_request&&[...String(x.title??'').matchAll(/#(\d+)\b/g)].map((match)=>Number(match[1])).filter((number)=>number===Number(issue)).length===1&&[...String(x.title??'').matchAll(/#(\d+)\b/g)].length===1).map((x)=>({number:x.number,title:x.title,body:x.body,url:x.html_url,state:x.state}))},
  // EVERY open issue is audited, not just the ones somebody remembered to
  // label. Filtering on `labels=db-work` here is what let issues #1188, #1238,
  // #1242, #1266 and #1268 sit unlabelled and therefore invisible to the queue
  // audit while carrying a valid db-work-scope block. Coordination issues
  // (db-claim, orchestrator-marker) are the only exclusions; a missing db-work
  // label on anything else is now a reported defect, never a silent skip.
  openWorkIssues(pager = ghPaginated) {
    const rows = pager(`repos/${REPO}/issues?state=open&per_page=100`)
    return rows.filter((x)=>!x.pull_request)
      .map((x)=>({ number:x.number, title:x.title, body:x.body, createdAt:x.created_at, labels:(x.labels??[]).map((l)=>l.name) }))
      .filter((x)=>!x.labels.some((name)=>COORDINATION_LABELS.has(name)))
  },
  openIssueNumbers() { return ghPaginated(`repos/${REPO}/issues?state=open&per_page=100`).filter((x)=>!x.pull_request).map((x)=>x.number) },
  // DEPENDENCY STATE (Step 3, issue #1366). Fetch every REFERENCED dependency, not
  // just the ones that happen to be open, because a nonexistent number and an
  // unreadable issue must both BLOCK rather than release. Any failure is recorded
  // as `unreadable` and never collapsed into "fine".
  dependencyStates(numbers) {
    const states = {}
    for (const number of [...new Set((numbers ?? []).map(Number))]) {
      let issue
      try {
        issue = ghJson(['api', `repos/${REPO}/issues/${number}`])
      } catch (error) {
        const detail = String(error?.stderr ?? error?.message ?? error)
        // A 404 is an ANSWER: the issue does not exist. Anything else is "I could
        // not find out", which is a different and equally blocking condition.
        states[number] = /HTTP 404|Not Found/i.test(detail) ? { exists: false } : { exists: true, unreadable: detail }
        continue
      }
      if (issue.pull_request) { states[number] = { exists: true, unreadable: `#${number} is a pull request, not a work issue` }; continue }
      const state = { exists: true, open: issue.state === 'open', closedAt: issue.closed_at ?? null, comments: [] }
      if (!state.open) {
        try {
          state.comments = ghPaginated(`repos/${REPO}/issues/${number}/comments?per_page=100`).map((c)=>({ body:c.body, author_association:c.author_association, author:c.user?.login }))
        } catch (error) {
          states[number] = { exists: true, unreadable: `comments unreadable: ${String(error?.message ?? error)}` }
          continue
        }
      }
      states[number] = state
    }
    return states
  },
  mergeCommitInMain(sha) {
    try { assertMergeCommitInMainHistory(sha, this.readRef('refs/heads/main'), this); return true }
    catch { return false }
  },
  prSources() { return gatherOpenPrObjects(REPO) },
  openPulls() { return ghPaginated(`repos/${REPO}/pulls?state=open&per_page=100`) },
  // AGENTS.md section 4 rule 2 is merge-first: the rehearsal happens AFTER the PR
  // merges, so the lane must still be able to find that PR once it is closed.
  // `openPulls()` cannot see it; this looks the branch up across every state.
  branchPulls(branch) { return ghPaginated(`repos/${REPO}/pulls?state=all&head=${REPO.split('/')[0]}:${encodeURIComponent(branch)}&per_page=100`) },
  getPr(number) { return ghJson(['api', `repos/${REPO}/pulls/${number}`]) },
  getPrFiles(number) { return ghPaginated(`repos/${REPO}/pulls/${number}/files?per_page=100`) },
  comparePullRequestFiles(baseSha,headSha) {
    const comparison=ghJson(['api',`repos/${REPO}/compare/${baseSha}...${headSha}`])
    if(comparison?.base_commit?.sha!==baseSha||!Array.isArray(comparison?.files))throw new LaneError('exact base-to-head comparison is unreadable')
    if(comparison.files.length>=300)throw new LaneError('exact base-to-head comparison reached GitHub\'s 300-file response ceiling')
    return comparison.files
  },
  postCommitStatus(headSha,{state,context,description,targetUrl}) {
    return ghJson(['api',`repos/${REPO}/statuses/${headSha}`,'-f',`state=${state}`,'-f',`context=${context}`,'-f',`description=${description}`,'-f',`target_url=${targetUrl}`])
  },
  getCommitStatus(headSha,context) {
    return selectNewestCommitStatus(ghPaginated(`repos/${REPO}/commits/${headSha}/statuses?per_page=100`),context)
  },
  closingIssuesForPr(number) {
    const query=`query{repository(owner:"u2giants",name:"shared-db"){pullRequest(number:${Number(number)}){closingIssuesReferences(first:10){nodes{number state} pageInfo{hasNextPage}}}}}`
    const data=ghJson(['api','graphql','-f',`query=${query}`])
    const connection=data?.data?.repository?.pullRequest?.closingIssuesReferences
    if(!connection||!Array.isArray(connection.nodes)||connection.pageInfo?.hasNextPage!==false)throw new LaneError('pull request closing-issue linkage is unreadable or paginated')
    return connection.nodes
  },
  prStructuralObjects(number,headSha){
    const files=this.getPrFiles(Number(number)).map((file)=>/^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(String(file?.filename??file?.path??''))&&file?.status!=='removed'
      ?{...file,content:this.getFileAt(file.filename??file.path,headSha)}:file)
    return inspectPrStructuralChange(files).objects
  },
  // Issue #2342: the caller reads a whole SET of files at one ref, which used to
  // be a Contents call each. One recursive tree read now answers every path, and
  // blobs are cached by SHA, so a file unchanged across refs is fetched once.
  getFileAt(file,ref){const text=laneTreeReader.readFileAtRef(REPO,file,ref);if(text===null)throw new LaneError(`could not read ${file} at ${ref}`);return text},
  treeFiles(ref){return laneTreeReader.pathsAtRef(REPO,ref)},
  previewGateProof(issue,pr,head,bundleId,dependencies=[]){
    const protectedContexts=ghJson(['api',`repos/${REPO}/branches/main/protection/required_status_checks`])?.contexts??[]
    const checks=JSON.parse(gh(['pr','checks',String(pr),'--repo',REPO,'--json','name,state']))
    const byName=new Map(checks.map((row)=>[row.name,String(row.state).toUpperCase()]))
    const failed=pendingRequiredContexts(protectedContexts,byName)
    if(failed.length)throw new LaneError(`required full CI is not successful on the current head: ${failed.join(', ')}`)
    assertDurableReviewApproval(issue,pr,head,this)
    const states=dependencies.length?this.dependencyStates(dependencies):{},closure=classifyDependencies(issue,dependencies,states)
    if(!closure.satisfied)throw new LaneError(`migration dependency closure is incomplete: ${closure.blocked.map((row)=>`#${row.number}`).join(', ')}`)
    return {full_ci_success:true,review_approved:true,dependency_closure_complete:true}
  },
  getIssue(number) { return ghJson(['api', `repos/${REPO}/issues/${number}`]) },
  getIssueComments(number) { return ghPaginated(`repos/${REPO}/issues/${number}/comments?per_page=100`) },
  getPrReviews(number) { return ghPaginated(`repos/${REPO}/pulls/${number}/reviews?per_page=100`) },
  readLeaseActivity(lease) {
    const query=`query{repository(owner:"u2giants",name:"shared-db"){pullRequest(number:${Number(lease.pr)}){comments(first:100){totalCount nodes{updatedAt}} reviews(first:100){totalCount nodes{submittedAt updatedAt}} reviewThreads(first:100){totalCount nodes{comments(first:100){totalCount nodes{updatedAt}}}}} object(oid:${JSON.stringify(String(lease.headSha))}){... on Commit{statusCheckRollup{contexts(first:100){totalCount nodes{... on CheckRun{startedAt completedAt}}}}}}}}`
    const data=ghJson(['api','graphql','-f',`query=${query}`])?.data?.repository,pr=data?.pullRequest,contexts=data?.object?.statusCheckRollup?.contexts
    const workflows=ghJson(['api',`repos/${REPO}/actions/runs?head_sha=${lease.headSha}&per_page=100`])
    if(!pr||!Array.isArray(pr.comments?.nodes)||Number(pr.comments.totalCount)!==pr.comments.nodes.length||!Array.isArray(pr.reviews?.nodes)||Number(pr.reviews.totalCount)!==pr.reviews.nodes.length||!Array.isArray(pr.reviewThreads?.nodes)||Number(pr.reviewThreads.totalCount)!==pr.reviewThreads.nodes.length)throw new LaneError('reviewer comment or review activity is unreadable or paginated')
    const reviewComments=[]
    for(const thread of pr.reviewThreads.nodes){if(!Array.isArray(thread.comments?.nodes)||Number(thread.comments.totalCount)!==thread.comments.nodes.length)throw new LaneError('reviewer review-comment activity is unreadable or paginated');reviewComments.push(...thread.comments.nodes)}
    if(contexts&&!Array.isArray(contexts.nodes)||contexts&&Number(contexts.totalCount)!==contexts.nodes.length)throw new LaneError('reviewer activity check runs are unreadable or paginated')
    if(!Array.isArray(workflows?.workflow_runs)||Number(workflows.total_count)!==workflows.workflow_runs.length)throw new LaneError('reviewer activity workflow runs are unreadable or paginated')
    return {issueComments:pr.comments.nodes,reviewComments,reviews:pr.reviews.nodes,checkRuns:contexts?.nodes??[],workflowRuns:workflows.workflow_runs}
  },
  readReviewerQueue(){
    const rows=this.listReviewRefsPaged(REVIEW_QUEUE_REF_PREFIX)
    if(rows.length>REVIEW_QUEUE_ROW_LIMIT)throw new LaneError(`reviewer queue exceeds its ${REVIEW_QUEUE_ROW_LIMIT}-ticket bounded read`)
    const records=this.readReviewRecords(rows.map((row)=>row.ref)),tickets=rows.map((row)=>({ref:row.ref,sha:row.sha,commit:records.get(row.ref)?.commit}))
    const parsed=tickets.map((row)=>({...row,ticket:parseReviewerQueueTicket(row.commit)}))
    if(!parsed.length)return []
    const fields=parsed.map((row,index)=>`p${index}:pullRequest(number:${row.ticket.pr}){state headRefOid}`).join(' ')
    const repo=ghJson(['api','graphql','-f',`query=query{repository(owner:"u2giants",name:"shared-db"){${fields}}}`])?.data?.repository
    if(!repo)throw new LaneError('reviewer queue PR states are unreadable')
    return parsed.map((row,index)=>({...row,pr:{state:String(repo[`p${index}`]?.state??'').toLowerCase(),head:{sha:repo[`p${index}`]?.headRefOid??null}}}))
  },
  updateIssue(number, fields) {
    const args=['api','-X','PATCH',`repos/${REPO}/issues/${number}`]
    for(const [key,value] of Object.entries(fields))args.push('-f',`${key}=${value}`)
    return ghJson(args)
  },
  mainSha() { return ghJson(['api', `repos/${REPO}/git/ref/heads/main`])?.object?.sha ?? null },
  // Fetches the exact commits it compares, so a stale local checkout cannot answer.
  // Any failure answers "not equivalent" and the exact-head rule stands.
  contentPreservingRefresh(approvedHead,head){
    try{
      const main=this.mainSha();if(!/^[0-9a-f]{40}$/.test(String(main)))return{ok:false,reason:'main tip unreadable'}
      execFileSync('git',['fetch','--no-tags','-q','origin',String(head),main],{stdio:['ignore','pipe','pipe']})
      return isContentPreservingRefresh({approvedHead,head,mainRef:main})
    }catch(error){return{ok:false,reason:`could not fetch the heads to compare: ${String(error?.message??error).split('\n')[0]}`}}
  },
  getCommit(sha) { return ghJson(['api', `repos/${REPO}/git/commits/${sha}`]) },
  // ARGUMENT ORDER IS THE WHOLE CHECK. GitHub's compare endpoint is
  // `compare/{base}...{head}` and reports how HEAD relates to BASE. Passing the
  // merge commit as BASE and the main tip as HEAD is what makes `ahead` mean
  // "main contains the merge commit". Inverted, `ahead` would mean the exact
  // opposite and would accept unmerged code. See compareCommits tests.
  compareCommits(baseSha, headSha) { return ghJson(['api', `repos/${REPO}/compare/${baseSha}...${headSha}`]) },
  makeOwnerCommit(message) {
    let {head,tree}=reviewWireBudget&&reviewCommitBase?reviewCommitBase:{}
    if(!head)head=ghJson(['api', `repos/${REPO}/git/ref/heads/main`])?.object?.sha
    if (!head) throw new LaneError('GitHub main ref has no commit SHA')
    if(!tree)tree=ghJson(['api', `repos/${REPO}/git/commits/${head}`])?.tree?.sha
    if (!tree) throw new LaneError('GitHub main commit has no tree SHA')
    if(reviewWireBudget)reviewCommitBase={head,tree}
    const commit = ghJson(['api', '-X', 'POST', `repos/${REPO}/git/commits`, '-f', `message=${message}`, '-f', `tree=${tree}`, '-f', `parents[]=${head}`])
    if (!commit?.sha) throw new LaneError('GitHub did not create an ownership commit')
    return commit.sha
  },
  makeReviewVerdictCommit(message,parentSha){
    const parent=ghJson(['api',`repos/${REPO}/git/commits/${parentSha}`])
    if(!parent?.tree?.sha)throw new LaneError('review assignment parent commit is unreadable')
    const commit=ghJson(['api','-X','POST',`repos/${REPO}/git/commits`,'-f',`message=${message}`,'-f',`tree=${parent.tree.sha}`,'-f',`parents[]=${parentSha}`])
    if(!commit?.sha)throw new LaneError('GitHub did not create the verdict commit')
    return commit.sha
  },
  readFindings(url){
    const match=/^https:\/\/github\.com\/u2giants\/shared-db\/(?:issues|pull)\/\d+#issuecomment-(\d+)$/.exec(String(url??''))
    if(!match)throw new LaneError('findings-ref must be a durable shared-db issue or PR comment URL')
    return ghJson(['api',`repos/${REPO}/issues/comments/${match[1]}`])?.body??null
  },
  createRef(ref, sha) {
    return createRefWithReadback(ref,sha,{readRef:(target)=>this.readRef(target)})
  },
  readRef(ref) {
    const short = ref.replace(/^refs\//, '')
    // Absence is an expected answer here, so gh's 404 line is not printed --
    // see runGitHubCommand. Any OTHER failure still prints and still throws.
    try { return ghJson(['api', `repos/${REPO}/git/ref/${short}`],{expectedFailure:EXPECTED_REF_ABSENCE})?.object?.sha ?? null }
    // Only GitHub CLI's explicit HTTP 404 proves that this exact ref is absent.
    // A transport message that merely says "not found" is ambiguous and must
    // remain a hard failure rather than being mistaken for successful cleanup.
    catch (error) { if (isConfirmedRefAbsence(error)) return null; throw error }
  },
  listRefs(prefix) {
    const short=prefix.replace(/^refs\//,'')
    return ghPaginated(`repos/${REPO}/git/matching-refs/${short}?per_page=100`).map((row)=>({ref:row.ref,sha:row.object?.sha})).filter((row)=>row.sha)
  },
  // Paginated sibling of listRefs for the DURABLE review ref namespaces
  // (issue #1798). `listRefs` routes through ghPaginated, which -- inside a
  // reviewer wire budget -- refuses outright at 100 rows rather than risk a
  // silently truncated page. That is the right default for a namespace that
  // is supposed to be small, but the assignment and replacement namespaces
  // are append-only across the repository's whole review history (370
  // assignment refs as of 2026-08-29), so the cutover audit could never list
  // them at all: it died on the 100-row refusal before reading anything.
  //
  // `git/matching-refs` IS NOT A PAGINATED ENDPOINT (measured 2026-09-02,
  // issue #2152). It ignores BOTH `per_page` and `page` and sends no Link
  // header: one request returns the complete matching set. Against this
  // repository, `?per_page=5`, `?per_page=100` and no query at all each
  // returned the same 726 refs for refs/db-review-assignments, and
  // `?per_page=100&page=3` on refs/db-review-verdict returned the same 100 rows
  // as page 1 for a namespace holding exactly 100 refs in total.
  //
  // The previous implementation walked `&page=N`, so EVERY request was page 1.
  // The `chunk.length<100` early return could therefore only fire for a
  // namespace holding fewer than 100 refs; at 100 or more the loop ran to the
  // page ceiling and refused, and had it not refused it would have returned the
  // first 100 rows repeated once per page. refs/db-review-verdict crossed 100
  // refs and took the whole governed reviewer system down with it: no reviewer
  // could be assigned or replaced for any pull request.
  //
  // WIRE COST: exactly ONE counted request per call, for any namespace size --
  // down from up to six. That is precisely what the REVIEW_OPERATION_REQUEST_LIMIT
  // derivation already assumed each verdict listing costs ("ONE listing of
  // refs/db-review-verdict pre-mutex ... and ONE uncached re-listing inside the
  // mutex section"), so the measured 23-of-25 slot-2 totals stand, and unlike
  // the page walk this cost can no longer drift upward as refs accumulate.
  // `gh api -i` is used rather than `--paginate` deliberately: `--paginate` is a
  // single gh invocation that may make many HTTP requests the wire budget cannot
  // see or charge for, whereas `-i` is one request, charged once, whose headers
  // are readable.
  //
  // TRUNCATION IS DETECTED, NOT ASSUMED. A silently short list reads as "no
  // verdict", which is the fail-OPEN direction for reviewer release and
  // replacement, so both guards below are LOUD refusals and neither ever
  // returns a partial list:
  //   1. A `Link` header advertising rel="next" means GitHub has begun
  //      paginating this endpoint. We do not guess at how; we refuse, and the
  //      fix is to teach this function to follow the Link chain (charging one
  //      counted request per hop) rather than to ignore the header.
  //   2. REVIEW_REF_ROW_LIMIT rows or more, which is where an undocumented
  //      server-side cap -- the one truncation a Link header cannot reveal --
  //      would start being plausible. See that constant for the derivation.
  // Duplicates are impossible by construction now that there is one response.
  listReviewRefsPaged(prefix, fetch = ghRefListing) {
    const short=prefix.replace(/^refs\//,'')
    const {rows,headers}=fetch(`repos/${REPO}/git/matching-refs/${short}`)
    if(!Array.isArray(rows))throw new LaneError(`GitHub listing for ${prefix} was incomplete or malformed`)
    // #2694 review (slot 2, high finding 5). BOTH refusals below are
    // DETERMINATE: nothing about them is transient, and re-running changes
    // nothing until refs are retired. They are marked so `findBusyReviewers`
    // can tell them apart from the transient unreadability its `return null`
    // fail-open exists for, and so the operator is told the real cause instead
    // of the generic "active reviewer leases are unreadable".
    if(hasNextPageLink(headers))throw markReviewRefListingRefusal(new LaneError(`${prefix} now returns a paginated Link header, so this single listing is no longer the complete set; refusing a possibly truncated reviewer audit (#2152)`),{prefix,rows:rows.length,limit:REVIEW_REF_ROW_LIMIT,reason:'paginated'})
    if(rows.length>=REVIEW_REF_ROW_LIMIT)throw markReviewRefListingRefusal(new LaneError(`${prefix} returned ${rows.length} refs, at or past the ${REVIEW_REF_ROW_LIMIT}-ref ceiling; refusing a possibly truncated reviewer audit. Retire refs rather than raising the ceiling (#2152)`),{prefix,rows:rows.length,limit:REVIEW_REF_ROW_LIMIT,reason:'ceiling'})
    return rows.map((row)=>({ref:row.ref,sha:row.object?.sha})).filter((row)=>row.sha)
  },
  // A DELETE is never replayed after a transport failure. The first request may
  // have succeeded and a new owner may acquire the fixed coordination ref
  // during backoff; replaying the DELETE could then remove that new owner.
  deleteRef(ref) {
    deleteRefWithReadback(ref,{
      run:(args,options)=>runGitHubCommand(args,{...options,attempts:1}),
      readRef:(target)=>this.readRef(target),
    })
  },
  updateRef(ref, sha) { gh(['api','-X','PATCH',`repos/${REPO}/git/refs/${ref.replace(/^refs\//,'')}`,'-f',`sha=${sha}`,'-F','force=true'],{idempotentWrite:true}) },
  readCommitMessage(sha) { try { return ghJson(['api',`repos/${REPO}/git/commits/${sha}`]).message } catch { return null } },
  // LIVE run state for lease recovery. `latestAttemptActive` re-reads the CURRENT
  // attempt rather than trusting the one recorded in the lease: a re-run reuses
  // GITHUB_RUN_ID, so a stored attempt can make a live run look finished.
  runState(runId) {
    try {
      const run = ghJson(['api',`repos/${REPO}/actions/runs/${runId}`])
      let latestAttemptActive = false
      try {
        const attempts = ghPaginated(`repos/${REPO}/actions/runs/${runId}/attempts?per_page=100`)
        latestAttemptActive = attempts.some?.((attempt)=>attempt.status && attempt.status !== 'completed') ?? false
      } catch { /* the attempts endpoint is optional; the run's own status still governs */ }
      return { status: run.status, conclusion: run.conclusion, completedAt: run.updated_at, latestAttemptActive }
    } catch (error) {
      return { unreadable: String(error?.message ?? error) }
    }
  },
  reserveVersion() { return JSON.parse(execFileSync(process.execPath, ['scripts/check-dispatch-collision.mjs', '--reserve-version', '--json'], { encoding: 'utf8' })) },
  createClaim(title, body) { return gh(['issue', 'create', '--repo', REPO, '--label', 'db-claim', '--title', `CLAIM: ${title}`, '--body', body]).trim() },
  createIssueIn(repo, title, body) { return gh(['issue','create','--repo',repo,'--title',title,'--body',body]).trim() },
  commentIssue(number, body) { gh(['issue','comment',String(number),'--repo',REPO,'--body',body]) },
  issueComments(number) { return ghPaginated(`repos/${REPO}/issues/${number}/comments?per_page=100`).map((c)=>({ body:c.body, author_association:c.author_association, author:c.user?.login })) },
  readOutcomeEvidence(ref) {
    const match=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/\d+#issuecomment-(\d+)$/.exec(String(ref??''))
    if(!match)throw new LaneError('outcome evidence must be an exact GitHub issue or pull-request comment URL')
    return ghJson(['api',`repos/${match[1]}/issues/comments/${match[2]}`])?.body??''
  },
  applicationCommitInDefaultBranch(repository,sha) {
    const repo=ghJson(['api',`repos/${repository}`]),branch=repo?.default_branch
    if(!branch)return false
    const comparison=ghJson(['api',`repos/${repository}/compare/${sha}...${encodeURIComponent(branch)}`])
    return comparison?.behind_by===0&&['identical','ahead'].includes(comparison?.status)
  },
  verifyProductionApply(evidence){
    const match=/^https:\/\/github\.com\/(u2giants\/shared-db)\/actions\/runs\/(\d+)$/.exec(String(evidence?.production_evidence??''))
    if(!match)return false
    const run=ghJson(['api',`repos/${match[1]}/actions/runs/${match[2]}`])
    if(run?.conclusion!=='success'||run?.event!=='workflow_dispatch'||run?.path!=='.github/workflows/shared-supabase-migrations.yml'||String(run?.head_sha??'').toLowerCase()!==String(evidence.production_commit_sha).toLowerCase())return false
    const ancestry=ghJson(['api',`repos/${REPO}/compare/${evidence.merge_sha}...${evidence.production_commit_sha}`])
    if(!['identical','ahead'].includes(ancestry?.status)||Number(ancestry?.behind_by)!==0)return false
    const artifacts=ghJson(['api',`repos/${match[1]}/actions/runs/${match[2]}/artifacts`])?.artifacts
    const artifact=Array.isArray(artifacts)?artifacts.find((row)=>Number(row.id)===Number(evidence.production_artifact_id)):null
    if(!(artifact?.name===`production-migration-apply-${String(evidence.production_commit_sha).toLowerCase()}`&&artifact.expired===false&&String(artifact.digest??'').toLowerCase()===String(evidence.production_artifact_digest).toLowerCase()))return false
    const files=this.readArtifactFiles(match[1],artifact.id,['production-apply.txt','production-ledger-after.txt','migration-content-manifest.json','production-catalog-verification.json'])
    if(!files.get('production-apply.txt')?.trim())return false
    try{JSON.parse(files.get('production-catalog-verification.json'));JSON.parse(files.get('migration-content-manifest.json'))}catch{return false}
    const versions=this.getPrFiles(Number(evidence.merge_pr)).map((file)=>/^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(String(file?.filename??''))?.[1]).filter(Boolean)
    return versions.length>0&&versions.every((version)=>files.get('production-ledger-after.txt').includes(version)&&files.get('migration-content-manifest.json').includes(version))
  },
  verifyLiveAssertion(evidence) {
    const match=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/.exec(String(evidence?.live_evidence??''))
    if(!match||match[1].toLowerCase()!==String(evidence.application_repository).toLowerCase())return false
    const run=ghJson(['api',`repos/${match[1]}/actions/runs/${match[2]}`])
    if(run?.conclusion!=='success'||String(run?.head_sha??'').toLowerCase()!==String(evidence.application_commit_sha).toLowerCase())return false
    const artifacts=ghJson(['api',`repos/${match[1]}/actions/runs/${match[2]}/artifacts`])?.artifacts
    if(!Array.isArray(artifacts))return false
    const artifact=artifacts.find((row)=>Number(row.id)===Number(evidence.live_artifact_id))
    const expectedName=`shared-db-live-proof-${evidence.work_issue}-${String(evidence.application_commit_sha).toLowerCase()}`
    if(!(artifact?.name===expectedName&&artifact.expired===false&&String(artifact.digest??'').toLowerCase()===String(evidence.live_artifact_digest).toLowerCase()))return false
    const proof=this.readArtifactJson(match[1],artifact.id,'db-live-proof.json')
    return matchesLiveProof(proof,evidence)
  },
  verifyGeneratedTypes(evidence){
    const match=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/.exec(String(evidence?.generated_types_evidence??''))
    if(!match||match[1].toLowerCase()!==String(evidence.application_repository).toLowerCase())return false
    const run=ghJson(['api',`repos/${match[1]}/actions/runs/${match[2]}`])
    if(run?.conclusion!=='success'||String(run?.head_sha??'').toLowerCase()!==String(evidence.application_commit_sha).toLowerCase())return false
    const artifacts=ghJson(['api',`repos/${match[1]}/actions/runs/${match[2]}/artifacts`])?.artifacts
    const artifact=Array.isArray(artifacts)?artifacts.find((row)=>Number(row.id)===Number(evidence.generated_types_artifact_id)):null
    const expectedName=`shared-db-generated-types-${evidence.work_issue}-${String(evidence.application_commit_sha).toLowerCase()}`
    if(!(artifact?.name===expectedName&&artifact.expired===false&&String(artifact.digest??'').toLowerCase()===String(evidence.generated_types_artifact_digest).toLowerCase()))return false
    const proof=this.readArtifactJson(match[1],artifact.id,'db-generated-types-proof.json')
    return matchesGeneratedTypesProof(proof,evidence)
  },
  readArtifactJson(repository,id,expectedFile){
    const directory=mkdtempSync(path.join(tmpdir(),'shared-db-proof-')),archive=path.join(directory,'proof.zip')
    try{
      const bytes=gh(['api',`repos/${repository}/actions/artifacts/${Number(id)}/zip`],{encoding:null,maxBuffer:20*1024*1024})
      writeFileSync(archive,bytes)
      const entries=execFileSync('tar',['-tf',archive],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).split(/\r?\n/).filter(Boolean)
      if(entries.length!==1||entries[0]!==expectedFile)throw new LaneError(`proof artifact must contain exactly ${expectedFile}`)
      execFileSync('tar',['-xf',archive,'-C',directory],{stdio:'ignore'})
      return JSON.parse(readFileSync(path.join(directory,expectedFile),'utf8'))
    }finally{rmSync(directory,{recursive:true,force:true})}
  },
  readArtifactFiles(repository,id,expectedFiles){
    const directory=mkdtempSync(path.join(tmpdir(),'shared-db-production-proof-')),archive=path.join(directory,'proof.zip')
    try{
      const bytes=gh(['api',`repos/${repository}/actions/artifacts/${Number(id)}/zip`],{encoding:null,maxBuffer:20*1024*1024})
      writeFileSync(archive,bytes)
      const entries=execFileSync('tar',['-tf',archive],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).split(/\r?\n/).filter(Boolean)
      const result=new Map()
      for(const expected of expectedFiles){
        const entry=entries.find((value)=>value===expected||value.endsWith(`/${expected}`))
        if(!entry)throw new LaneError(`production proof artifact is missing ${expected}`)
        result.set(expected,execFileSync('tar',['-xOf',archive,entry],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))
      }
      return result
    }finally{rmSync(directory,{recursive:true,force:true})}
  },
  closeIssue(number) { gh(['issue','close',String(number),'--repo',REPO]) },
  closeClaim(number, reason) { gh(['issue', 'close', String(number), '--repo', REPO, '--comment', requireClaimCloseReason(reason)]) },
  reversionFiles(worktree,oldVersion) {
    let referenced=[];const riskGatePath=['scripts','production_business_risk_gate.py'].join('/')
    try{referenced=execFileSync('git',['-C',worktree,'grep','-l',oldVersion,'--','supabase/migrations','supabase/tests',riskGatePath,'docs'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean)}
    catch(error){if(error.status!==1)throw error}
    const migrations=execFileSync('git',['-C',worktree,'ls-files','--cached','--others','--exclude-standard','--',`supabase/migrations/${oldVersion}_*.sql`],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean)
    const sidecar=`scripts/production-verification-sidecars/${oldVersion}.json`
    if(existsSync(path.resolve(worktree,sidecar)))referenced.push(sidecar)
    return [...new Set([...referenced,...migrations].map((file)=>path.normalize(file)))].map((file)=>path.resolve(worktree,file))
  },
  rewriteVersion(worktree,oldVersion,newVersion) {
    const files=this.reversionFiles(worktree,oldVersion),migration=files.filter((file)=>new RegExp(`^${oldVersion}_[^\\/]+\\.sql$`).test(path.basename(file)))
    if(migration.length!==1)throw new LaneError('local worktree must contain exactly one old-version migration file')
    const exactVersion=new RegExp(`(?<!\\d)${oldVersion}(?!\\d)`,'g')
    const renamed=path.join(path.dirname(migration[0]),path.basename(migration[0]).replace(new RegExp(`^${oldVersion}_`),`${newVersion}_`))
    const sidecar=files.find((file)=>path.basename(file)===`${oldVersion}.json`&&path.basename(path.dirname(file))==='production-verification-sidecars')
    const renamedSidecar=sidecar?path.join(path.dirname(sidecar),`${newVersion}.json`):null
    if(existsSync(renamed))throw new LaneError('refusing migration version rewrite because the target filename already exists')
    if(renamedSidecar&&existsSync(renamedSidecar))throw new LaneError('refusing sidecar version rewrite because the target filename already exists')
    const originals=new Map(files.map((file)=>[file,readFileSync(file,'utf8')]))
    let renamedApplied=false,sidecarRenamed=false
    try{
      for(const [file,contents] of originals)writeFileSync(file,contents.replace(exactVersion,newVersion))
      ;(this.renameVersionFile??renameSync)(migration[0],renamed);renamedApplied=true
      if(sidecar){const item=JSON.parse(readFileSync(sidecar,'utf8'));item.migration_version=newVersion;item.migration_sha256=createHash('sha256').update(readFileSync(renamed).toString().replace(/\r\n/g,'\n')).digest('hex');writeFileSync(sidecar,`${JSON.stringify(item,null,2)}\n`);(this.renameSidecarVersion??renameSync)(sidecar,renamedSidecar);sidecarRenamed=true}
      return {files,migration:migration[0],renamed,sidecar,renamedSidecar}
    }catch(error){
      const failures=[]
      if(sidecarRenamed||sidecar&&(!existsSync(sidecar)&&existsSync(renamedSidecar)))try{renameSync(renamedSidecar,sidecar)}catch(rollbackError){failures.push(rollbackError.message)}
      if(renamedApplied||(!existsSync(migration[0])&&existsSync(renamed)))try{renameSync(renamed,migration[0])}catch(rollbackError){failures.push(rollbackError.message)}
      for(const [file,contents] of originals)try{writeFileSync(file,contents)}catch(rollbackError){failures.push(rollbackError.message)}
      if(failures.length)throw new LaneError(`${error.message}; LOCAL ROLLBACK INCOMPLETE: ${failures.join('; ')}`)
      throw error
    }
  },
  commitAndPushReversion(worktree,oldVersion,newVersion) {
    const riskGatePath=['scripts','production_business_risk_gate.py'].join('/')
    execFileSync('git',['-C',worktree,'add','--all','--','supabase/migrations','supabase/tests','scripts/production-verification-sidecars',riskGatePath,'docs'])
    execFileSync('git',['-C',worktree,'commit','-m',`migration: re-reserve ${oldVersion} as ${newVersion}`],{stdio:'pipe'})
    execFileSync('git',['-C',worktree,'push','origin','HEAD'],{stdio:'pipe'})
    return execFileSync('git',['-C',worktree,'rev-parse','HEAD'],{encoding:'utf8'}).trim()
  },
  localHead(worktree){return execFileSync('git',['-C',worktree,'rev-parse','HEAD'],{encoding:'utf8'}).trim()},
  localClean(worktree){return execFileSync('git',['-C',worktree,'status','--porcelain'],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean).every((line)=>line.slice(3).replaceAll('\\','/').startsWith('.ai/')) },
  currentMaxVersion:currentMainMaxVersion,
  commandAvailable(command){return Boolean(resolveCommandPath(command))},
  // Ask the wrapper's own `doctor` whether it can actually work RIGHT NOW.
  // Every wrapper prints one `PASS <check>` / `FAIL <check>` line per check, so
  // the failing check can be quoted verbatim instead of guessed at. Exit status
  // alone is not enough: the operator needs to be told WHICH check failed.
  //
  // WINDOWS. Every reviewer wrapper on Albert's machines is a `.cmd` shim, and
  // `execFileSync` CANNOT spawn a `.cmd` directly -- it fails ENOENT even though
  // `where.exe` finds the file. Caught by an independent review before this
  // shipped: the probe would have failed on every review on Windows and reported
  // a LOCAL FAULT for a provider that was fine, which is the exact misdiagnosis
  // this whole change exists to end. Resolve the real path and route a batch
  // shim through `cmd.exe /c`. No shell string is built, so nothing here is
  // interpolated into a command line.
  reviewerDoctor(wrapper){
    const resolved=resolveCommandPath(wrapper)
    if(!resolved)return {ok:false,failingChecks:[`${wrapper} is not on PATH`]}
    const {file,args}=doctorSpawnPlan(resolved)
    let output=''
    try{output=execFileSync(file,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:REVIEWER_DOCTOR_TIMEOUT_MS})}
    catch(error){
      if(error?.code==='ETIMEDOUT')return {ok:false,failingChecks:[`doctor did not answer within ${REVIEWER_DOCTOR_TIMEOUT_MS/1000}s`]}
      output=`${error?.stdout??''}${error?.stderr??''}`
      const failed=parseDoctorFailures(output)
      if(failed.length)return {ok:false,failingChecks:failed}
      return {ok:false,failingChecks:[`doctor could not be run (${error?.code??`exit ${error?.status}`}) and named no check`],output}
    }
    // The raw output rides alongside the summary so the one caller that must
    // RECORD the proof (reinstateReviewerExclusion) quotes the wrapper verbatim
    // instead of paraphrasing it. Nothing else reads it.
    return {...summarizeDoctorOutput(output),output}
  },
  reviewerUsability(reviewers){
    const command='ai-review-preflight',resolved=resolveCommandPath(command)
    if(!resolved)throw new LaneError(`${command} is not on PATH; reviewer assignment cannot prove the reconciled provider state`)
    const args=['usable'], spawn=process.platform==='win32'&&/\.(cmd|bat)$/i.test(resolved)
      ?{file:process.env.ComSpec||'cmd.exe',args:['/d','/s','/c',resolved,...args]}
      :{file:resolved,args}
    let output=''
    try{output=execFileSync(spawn.file,spawn.args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:REVIEWER_DOCTOR_TIMEOUT_MS})}
    catch(error){output=String(error?.stdout??'')}
    const rows=[]
    for(const line of output.split(/\r?\n/).filter(Boolean)){
      try{const row=JSON.parse(line);if(typeof row?.provider==='string'&&typeof row?.usable==='boolean')rows.push(row)}catch{/* explanatory output is not provider state */}
    }
    const byProvider=new Map(rows.map((row)=>[row.provider,row]))
    for(const reviewer of reviewers){
      if(!reviewer?.provider)throw new LaneError(`reviewer ${reviewer?.name??'unknown'} has no ai-review-preflight provider identity`)
      if(!byProvider.has(reviewer.provider))throw new LaneError(`ai-review-preflight returned no reconciled state for ${reviewer.provider}; reviewer assignment refused`)
    }
    return byProvider
  },
  resolveOrchestratorEngine(){
    return orchestratorEngineFromResolution(readOrchestratorResolution(()=>runOrchestratorResolver()))
  },
  orchestratorFlowAdapter(claimNumber,admissionOptions=null){ return githubFlowAdapter(this,claimNumber,admissionOptions) },
  flowSnapshot(){
    return {issues:this.openClaims().map((claim)=>{const lease=parseAuthorLease(claim.body),issue=claimWorkIssue(claim),work=this.getIssue(issue),declared=/^blocked_on:\s*(issue:#\d+|artifact:[^\s]+)\s*$/m.exec(work?.body??'')?.[1]??null,reference=declared??lease.blockedOn,resolved=reference?.startsWith('issue:#')?this.getIssue(Number(reference.slice(7)))?.state==='closed':false;let preview_edge_satisfied=false,preview_error=null;try{deriveLivePreviewCandidate(issue,this);preview_edge_satisfied=true}catch(error){preview_error=error.message}return{issue,claim:claim.number,owner:lease.owner,capacity_state:lease.capacityState,blocker:reference?{durable:true,resolved,reference}:null,preview_edge_satisfied,preview_error}})}
  },
}

function githubFlowAdapter(io,claimNumber=null,admissionOptions=null){
  const payload=(sha)=>{const message=io.getCommit(sha)?.message??'';const match=/^db-preview-(?:ready|outcome) ([\s\S]+)$/.exec(message);if(!match)throw new LaneError('preview coordination ref does not point to a recognized immutable payload');return JSON.parse(match[1])}
  return {
    // Same defect as `resolveOrchestratorEngine` (issue #2127): every non-zero
    // exit was reported as "could not be resolved", so a correct `state: none`
    // answer was misreported as a broken resolver. A parseable answer of ANY
    // state is an answer -- `live` is false for all of them except `declared`,
    // which is what the mutation guards already require -- and only a resolver
    // that produced nothing readable still throws.
    resolveMarker(){
      const resolved=readOrchestratorResolution(()=>runOrchestratorResolver())
      const calling=process.env.ORCHESTRATOR_ROUTE_ID??''
      return {live:resolved.state==='declared',task:resolved.routing?.routeId??null,calling_task:calling,state:resolved.state}
    },
    actor:()=>process.env.ORCHESTRATOR_ROUTE_ID??'unknown-orchestrator',now:()=>new Date().toISOString(),
    appendEvent(event){io.commentIssue(event.work_issue,formatEventComment(event))},
    createRef(ref,digest,record){const kind=ref.startsWith('refs/db-preview-ready-outcomes/')?'outcome':'ready',sha=io.makeOwnerCommit(`db-preview-${kind} ${JSON.stringify({digest,record})}`);return io.createRef(ref,sha)},
    readRef(ref){const sha=io.refreshRef?.(ref)??io.readRef(ref);return sha?payload(sha):null},
    listReady(issue){return io.listRefs('refs/db-preview-ready/').map((row)=>payload(row.sha)).filter((row)=>Number(row.record?.issue)===Number(issue))},
    selectCurrent(issue){const candidate=deriveLivePreviewCandidate(Number(issue),io,{claimNumber});if(admissionOptions&&(Number(candidate.issue)!==Number(admissionOptions.admitIssue)||Number(candidate.pr)!==Number(admissionOptions.pr)))throw new LaneError(`preview candidate issue #${candidate.issue} pull request #${candidate.pr} is not the admitted issue #${admissionOptions.admitIssue} pull request #${admissionOptions.pr}`);return candidate},
    relinquishCapacity(row){return relinquishAuthorLease({claim:row.claim,owner:row.owner,blockedOn:row.blocker.reference},new Date(),io)},
    resumeCapacity(row){return resumeAuthorLease({claim:row.claim,owner:row.owner,leaseHours:DEFAULT_LEASE_HOURS},new Date(),io)},
    persistReady(row){return persistInitialReady(deriveLivePreviewCandidate(Number(row.issue),io),this)},
    withMutex(fn){const ownerSha=io.makeOwnerCommit(`db-coordination preview-ready-preparation issue=0`);acquireMutex(ownerSha,io);try{if(admissionOptions)requireAdmission(admissionOptions,io,{pr:admissionOptions.pr??null,mutexOwner:ownerSha});return fn()}finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}},
    events(issue){return (io.issueComments(issue)??[]).flatMap((comment)=>parseEventComment(comment.body??comment))},
  }
}

function livePreviewLedger(){
  const code=`import {readPreviewLedger} from './scripts/orchestrator-flow/read-preview-ledger.mjs';try{console.log(JSON.stringify(await readPreviewLedger()))}catch(e){console.error(e.message);process.exit(2)}`
  try{return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:process.env}))}catch(error){throw new LaneError(`fresh preview ledger is unavailable (${String(error.stderr??error.message).trim()})`)}
}
export function deriveLivePreviewCandidate(issue,io,{claimNumber=null}={}){
  const claims=io.openClaims().map((claim)=>({claim,lease:parseAuthorLease(claim.body)}));for(const row of claims){const titleIssues=claimTitleIssues(row.claim);if(titleIssues.includes(issue)&&titleIssues.length!==1)throw new LaneError(`open claim #${row.claim.number} ambiguously identifies work issue #${issue}`)}const owned=claims.filter((row)=>claimTitleWorkIssue(row.claim)===issue),allClosed=owned.length===0?(io.closedClaimsForWork?.(issue)??[]).map((claim)=>({claim,lease:parseAuthorLease(claim.body)})):[],closed=claimNumber===null?allClosed:allClosed.filter((row)=>Number(row.claim.number)===Number(claimNumber));if(owned.length>1)throw new LaneError(`work issue #${issue} must have exactly one live protected claim`);if(claimNumber!==null&&owned.length===0&&closed.length!==1)throw new LaneError(`closed claim #${claimNumber} is not a unique historical claim for work issue #${issue}`);for(const row of closed)if(claimWorkIssue(row.claim)!==issue)throw new LaneError(`closed claim #${row.claim.number} title does not identify work issue #${issue}`);for(const row of closed)if(io.openPulls().some((pr)=>pr.head?.ref===row.lease.branch))throw new LaneError(`closed claim #${row.claim.number} cannot recover while its pull request is still open`)
  const recoverable=closed.filter((row)=>{const merged=(io.branchPulls?.(row.lease.branch)??[]).filter((pr)=>pr.head?.ref===row.lease.branch&&pr.merged_at&&pr.merge_commit_sha);if(merged.length>1)throw new LaneError(`closed claim #${row.claim.number} has multiple merged pull requests`);if(merged.length===1&&!io.mergeCommitInMain(merged[0].merge_commit_sha))throw new LaneError(`merged claim #${row.claim.number} merge commit ${merged[0].merge_commit_sha} is not in main history`);return merged.length===1});if(owned.length===0&&recoverable.length!==1)throw new LaneError(`work issue #${issue} has ${recoverable.length} recoverable closed claims; historical recovery requires exactly one${recoverable.length>1?' or an explicit --claim-number <claim> selector':''}`);const recoveredClosed=owned.length===0,{claim,lease}=recoveredClosed?recoverable[0]:owned[0],pulls=io.openPulls().filter((pr)=>pr.head?.ref===lease.branch)
  // Merge-first (AGENTS.md section 4 rule 2): once the claim PR merges there is no open
  // pull request left, and the rehearsal still owes proof. Fall back to the merged pull
  // request on the same branch and drive the POST_MERGE_REHEARSAL route from it.
  let merged=false,mergeCommit=null,pr
  if(pulls.length===1){pr=pulls[0]}
  else if(pulls.length===0){
    const closed=(io.branchPulls?.(lease.branch)??[]).filter((row)=>row.head?.ref===lease.branch&&row.merged_at&&row.merge_commit_sha)
    if(closed.length!==1)throw new LaneError(`claim #${claim.number} must have exactly one live pull request`)
    pr=closed[0];merged=true;mergeCommit=pr.merge_commit_sha
    // The merge commit is NOT where the rehearsal is anchored -- commit_sha below is the
    // current main tip. It is checked here only as proof that this claim really merged
    // into main, which is what makes the post-merge route legitimate at all.
    if(!io.mergeCommitInMain(mergeCommit))throw new LaneError(`merged claim #${claim.number} merge commit ${mergeCommit} is not in main history`)
  }
  else throw new LaneError(`claim #${claim.number} must have exactly one live pull request`)
  const head=pr.head.sha,prFiles=io.getPrFiles(pr.number),changed=prFiles.filter((file)=>file.status!=='removed').map((file)=>file.filename)
  const migrations=changed.filter((file)=>/^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(file)),versions=migrations.map((file)=>path.basename(file).slice(0,14))
  if(!migrations.length)throw new LaneError('pull request has no added migration to prepare')
  for(const row of claims)if(claimTitleWorkIssue(row.claim)===null&&versions.includes(row.lease.version))throw new LaneError(`open claim #${row.claim.number} with an invalid title protects recovery version ${row.lease.version}`)
  const inventory=JSON.parse(io.getFileAt('config/orchestrator-global-invalidators-v1.json',head)),allFiles=new Set([...migrations,...changed.filter((file)=>/^(?:supabase\/tests\/|scripts\/production-verification-sidecars\/)/.test(file)),...inventory.files,'config/orchestrator-global-invalidators-v1.json'])
  const contents=new Map([...allFiles].map((file)=>[file,io.getFileAt(file,head)])),headTree=io.treeFiles(head),order=headTree.filter((file)=>/^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(file)).sort()
  // Preview readiness is structural evidence: classify the migration SQL itself, never its filename, and bind it to the claim's writes.
  const structural=inspectPrStructuralChange(prFiles.filter((file)=>migrations.includes(file.filename)).map((file)=>({...file,content:contents.get(file.filename)}))),leaseWrites=[...(lease.writes??[])].sort()
  if(structural.objects.length!==leaseWrites.length||structural.objects.some((value,index)=>value!==leaseWrites[index]))throw new LaneError(`pull request #${pr.number} structural objects do not exactly match claim #${claim.number} writes; preview preparation refused`)
  const bundle=buildEvidenceBundle({migrations,focusedFiles:changed.filter((file)=>file.startsWith('supabase/tests/')),verificationFiles:changed.filter((file)=>file.startsWith('scripts/production-verification-sidecars/')),writes:lease.writes,reads:lease.reads,migrationOrderDigest:sha256(canonicalJson(order)),issue,pr:pr.number,claim:claim.number,baseMainSha:pr.base.sha,integrationSha:head},{isClean:()=>true,fileExists:(file)=>contents.has(file),readFile:(file)=>contents.get(file)})
  const work=io.getIssue(issue),scope=parseQueueScope(work?.body??''),gate=io.previewGateProof(issue,pr.number,head,bundle.bundle_id,scope.dependencies)
  const main=io.mainSha(),mainVersions=io.treeFiles(main).filter((file)=>/^supabase\/migrations\/\d{14}_/.test(file)).map((file)=>path.basename(file).slice(0,14)),preview=io.previewLedger?.()??livePreviewLedger(),originalApplyEvidence=versions.every((version)=>preview.versions.includes(version))?validateOriginalPreviewApplyEvidence({issue,pr:pr.number,versions,mergeCommitSha:merged?pr.merge_commit_sha:null},io):null
  const claimRows=claims.map((row)=>{const linked=io.openPulls().find((p)=>p.head?.ref===row.lease.branch);return{issue:claimTitleWorkIssue(row.claim),pr:linked?.number??0,versions:[row.lease.version],merged:false}}).filter((row)=>row.pr&&row.issue!==null)
  const route=selectPreviewRoute({issue,pr:pr.number,head_sha:head,bundle_id:bundle.bundle_id,versions,dependency_closure_complete:gate.dependency_closure_complete,claims:claimRows,main_versions:mainVersions,preview_versions:preview.versions,original_apply_evidence:originalApplyEvidence,merged})
  if(route.status!=='READY')throw new LaneError(`preview route is ${route.status}: ${route.reason}`)
  const routeName=route.route==='NORMAL_PREVIEW'?'ordinary_preview_apply':route.route==='POST_MERGE_REHEARSAL'?'merged_rehearsal':'historical_rebind'
  const routeContext=routeName==='ordinary_preview_apply'?'':main
  // commit_sha is the CURRENT MAIN TIP the rehearsal runs at -- shared-supabase-migrations
  // asserts `git rev-parse origin/main` equals it. That is a different thing from the
  // historical-recovery lane's producer-file pin at the authoring merge commit; conflating
  // the two emits a manifest the workflow refuses.
  //
  // A merged rehearsal must NOT name claim_pr: "merged_preview_source_pr replaces claim_pr.
  // A merged pull request has no live author claim; do not name both."
  const claimFields=routeName==='merged_rehearsal'?{}:{claim_pr:String(pr.number),claim_head_sha:head}
  const manifest={target:'preview',preview_allowlist:versions.join(','),...claimFields,...(routeName==='merged_rehearsal'?{commit_sha:main,merged_preview_source_pr:String(pr.number)}:{}),...(routeName==='historical_rebind'?{commit_sha:main,historical_preview_source_pr:String(pr.number),historical_preview_original_run_map:versions.map((version)=>`${version}:${originalApplyEvidence.run_id}`).join(',')}:{})}
  // THE STORED INSTRUCTION MUST NAME ITS OWN MODES (#2796). The workflow's `mode`
  // input defaults to dry-run, so an instruction that says nothing about mode gets
  // dispatched verbatim and DRY-RUNS: it succeeds, uploads only
  // `preview-migration-dry-run-<sha>`, applies nothing, and every downstream lane
  // then reads that green run as preview proof. Run 34633793571 is exactly that.
  //
  // The mode is emitted BESIDE the manifest, never inside it. Phase 2 is explicit
  // that "`mode` is a per-run phase, not part of ready identity or frozen-manifest
  // equality", so folding it into the manifest would change manifest_digest and
  // ready_id and freeze a phase into immutable identity.
  //
  // The sequence is route-specific, matching the existing workflow: ordinary and
  // merged rehearsals "run `mode=dry-run` then `mode=apply`", while historical
  // rebind "runs the existing recovery `mode=apply` only and must never dispatch a
  // historical-input dry-run". A historical dry-run is refused outright by the
  // workflow; the ordinary/merged dry-run is a REQUIRED first phase and stays legal.
  // One source of truth, shared with the reconciler that re-derives it from the
  // route when the record is read back, so the two layers cannot drift.
  const modeSequence=MODE_SEQUENCE[routeName]
  return {issue,pr:pr.number,head_sha:head,bundle_id:bundle.bundle_id,route:routeName,route_context:routeContext,mode_sequence:modeSequence,manifest}
}

export function terminalizeHistoricalPreviewReady({readyId,issue,runId,artifactId,artifactDigest,manifestDigest},io=githubIo){
  if(!/^[0-9a-f]{64}$/i.test(String(readyId??''))||!/^\d+$/.test(String(issue??''))||!/^\d+$/.test(String(runId??''))||!/^\d+$/.test(String(artifactId??''))||!/^sha256:[0-9a-f]{64}$/i.test(String(artifactDigest??''))||!/^[0-9a-f]{64}$/i.test(String(manifestDigest??'')))throw new LaneError('historical preview terminalization requires exact ready id, issue, run id, artifact id, artifact digest, and manifest digest')
  if(typeof io.orchestratorFlowAdapter!=='function'||typeof io.previewApplyRun!=='function')throw new LaneError('historical preview terminalization runtime adapter is unavailable')
  const flow=io.orchestratorFlowAdapter(),marker=flow.resolveMarker?.()
  if(!marker?.live||marker.calling_task!==marker.task)throw new LaneError('matching live sole-orchestrator marker is required')
  const readyRef=`refs/db-preview-ready/${readyId}`,outcomeRef=`refs/db-preview-ready-outcomes/${readyId}`,stored=flow.readRef(readyRef),record=stored?.record
  let normalized;try{normalized=readyRecord(record??{})}catch{throw new LaneError('live historical preview-ready record does not exactly match the requested immutable identity')}
  if(stored?.digest!==sha256(canonicalJson(record??{}))||normalized.ready_id!==readyId||record?.ready_id!==readyId||Number(record?.issue)!==Number(issue)||record?.route!=='historical_rebind'||record?.manifest_digest!==manifestDigest||sha256(canonicalJson(record?.manifest??{}))!==manifestDigest)throw new LaneError('live historical preview-ready record does not exactly match the requested immutable identity')
  if(record.route_context!==record.manifest.commit_sha||!/^[0-9a-f]{40}$/i.test(String(record.route_context??'')))throw new LaneError('historical preview-ready main binding is invalid')
  const evidence=io.previewApplyRun(String(runId)),run=evidence?.run,artifacts=evidence?.artifacts,logs=String(evidence?.logs??'')
  if(String(run?.id)!==String(runId)||run?.path!=='.github/workflows/shared-supabase-migrations.yml'||run?.event!=='workflow_dispatch'||run?.status!=='completed'||run?.conclusion!=='success'||run?.run_attempt!==1||run?.head_sha!==record.route_context)throw new LaneError('historical recovery run does not exactly match the successful immutable preview-ready dispatch')
  const rows=Array.isArray(artifacts?.artifacts)?artifacts.artifacts:[],artifact=rows.find((row)=>String(row.id)===String(artifactId))
  if(Number(artifacts?.total_count)!==1||rows.length!==1||!artifact||artifact.expired!==false||artifact.digest!==artifactDigest||artifact.name!==`preview-migration-apply-${record.route_context}`||String(artifact.workflow_run?.id)!==String(runId)||artifact.workflow_run?.head_sha!==run.head_sha)throw new LaneError('historical recovery artifact does not exactly match the requested immutable evidence')
  const exactLogValue=(label,value)=>new RegExp(`(?:^|\\n)[^\\n]*${label}:\\s*${String(value).replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}(?:\\s|$)`).test(logs)
  if(!exactLogValue('ORIGINAL_RUN_MAP',record.manifest.historical_preview_original_run_map)||!exactLogValue('SOURCE_PR',record.manifest.historical_preview_source_pr)||!exactLogValue('MAIN_SHA',record.manifest.commit_sha)||!exactLogValue('PREVIEW_ALLOWLIST',record.manifest.preview_allowlist))throw new LaneError('historical recovery logs do not match the stored preview-ready manifest')
  const ledgerLines=logs.split(/\r?\n/).flatMap((line)=>{const fields=line.replace(/^\ufeff/,'').split('\t');if(fields.length<3||fields[1]!=='Report the preview ledger delta')return[];return[fields.slice(2).join('\t').replace(/^\d{4}-\d{2}-\d{2}T\S+Z\s*/,'')]})
  const one=(pattern)=>{const matches=ledgerLines.map((line)=>pattern.exec(line)).filter(Boolean);return matches.length===1?matches[0]:null},before=one(/^- rows before:\s*(\d+)\s*$/),after=one(/^- rows after:\s*(\d+)\s*$/)
  if(!before||!after||before[1]!==after[1]||ledgerLines.filter((line)=>/^- added:\s*\(none\)\s*$/.test(line)).length!==1||ledgerLines.filter((line)=>/^- removed:\s*\(none\)\s*$/.test(line)).length!==1)throw new LaneError('historical recovery did not prove an unchanged preview ledger')
  const proof={positive:true,mode:'apply',run_id:String(runId),artifact_id:String(artifactId),artifact_digest:artifactDigest,manifest_digest:manifestDigest,ledger_rows:Number(before[1])}
  const existing=flow.readRef(outcomeRef)
  if(existing&&(existing.digest!=='dispatched'||existing.record?.outcome!=='dispatched'||canonicalJson(existing.record?.proof)!==canonicalJson(proof)))throw new LaneError('historical preview-ready outcome is occupied by different immutable evidence')
  const result=terminalizeReady(readyId,'dispatched',proof,flow),readBack=flow.readRef(outcomeRef)
  if(readBack?.digest!=='dispatched'||readBack.record?.outcome!=='dispatched'||canonicalJson(readBack.record?.proof)!==canonicalJson(proof))throw new LaneError('historical preview-ready outcome readback did not match the exact immutable evidence')
  return {...result,ref:outcomeRef,proof}
}

// A wrapper's doctor is a local probe; it must never hang a governed lane.
// An empty or unparseable override must NOT silently become 0 or NaN: Node treats
// both as "no timeout", so a hung doctor would hang the lane instead of being
// refused -- a silent failure produced by the very setting meant to prevent one.
export const REVIEWER_DOCTOR_TIMEOUT_MS = (()=>{
  const raw=process.env.REVIEWER_DOCTOR_TIMEOUT_MS
  if(raw===undefined||String(raw).trim()==='')return 60000
  const value=Number(raw)
  if(!Number.isFinite(value)||value<=0)throw new LaneError(`REVIEWER_DOCTOR_TIMEOUT_MS must be a positive number of milliseconds; got "${raw}". Left unchecked this disables the timeout and a hung doctor hangs a governed lane.`)
  return value
})()

// Reviewer wrappers report checks in ONE OF TWO shapes, both real and both in
// use on edge-dev today:
//
//   leading   `PASS  <check>` / `FAIL  <check>`      ai-glm, ai-muse, ai-codex-review
//   trailing  `<check> : PASS|FAIL|OK (<detail>)`    ai-grok-review, ai-kimi
//
// Only the leading form was read until 2026-08-25, which meant a trailing-form
// FAIL scored as an unrecognized format and therefore as healthy. Return the
// names of the failing checks, in order, from either shape.
export function parseDoctorFailures(output=''){
  return String(output).split(/\r?\n/).map((line)=>{
    const leading=/^\s*FAIL\s+(.*\S)\s*$/.exec(line)
    if(leading)return leading[1]
    const trailing=/^\s*(\S(?:.*\S)?)\s+:\s*FAIL\b\s*(.*\S)?\s*$/.exec(line)
    return trailing?(trailing[2]?`${trailing[1]} ${trailing[2]}`:trailing[1]):null
  }).filter(Boolean)
}

// SILENCE IS NOT A PASS -- but an unfamiliar format is not a failure either.
//
// This runs only on a ZERO exit; a non-zero exit is refused by the caller before
// it gets here. Three cases, measured against the real wrappers on edge-dev:
//
//   ai-glm / ai-muse   print `PASS  <check>` / `FAIL  <check>` lines. A FAIL wins
//                      over any number of PASSes.
//   ai-codex-review    prints exactly one `PASS provider=codex ...` line. Same
//                      leading form, one check.
//   ai-grok-review     prints key/value lines and an `auth : OK` footer.
//   ai-kimi            prints the same trailing form, including real FAILs such
//                      as `preflight : FAIL (execution-context-denied)`.
//
//                      UNTIL 2026-08-25 BOTH OF THOSE SCORED AS "unrecognized",
//                      i.e. healthy-by-exit-status. That was tolerable while the
//                      trailing form belonged only to a wrapper that never
//                      printed FAIL; un-retiring ai-kimi, which does, made it a
//                      hole. parseDoctorFailures now reads the trailing form, and
//                      `<check> : PASS|OK` counts as a recognized pass here.
//                      Grok is still healthy on exit status when it prints
//                      neither -- refusing that would have blocked a healthy Grok
//                      on every review, the false local-fault diagnosis this whole
//                      mechanism exists to end.
//   unfamiliar output  when a wrapper answers with output in a format we do not
//                      recognise AND exits 0, its own exit status is its verdict;
//                      `format` records that we could not read the detail.
//   nothing at all     proves nothing. A wrapper that quietly stops reporting must
//                      never be read as healthy forever. Refused.
//
// Do not "tidy" the third case into a pass, and do not tighten the second one
// without first running `doctor` on every ACTIVE_REVIEWERS wrapper and pasting the
// output into the change. Both halves were established that way.
export function summarizeDoctorOutput(output=''){
  const failed=parseDoctorFailures(output)
  if(failed.length)return {ok:false,failingChecks:failed,format:'checks'}
  const passed=String(output).split(/\r?\n/).filter((line)=>/^\s*PASS\s+\S/.test(line)||/^\s*\S(?:.*\S)?\s+:\s*(?:PASS|OK)\b/.test(line)).length
  if(passed)return {ok:true,failingChecks:[],format:'checks'}
  if(String(output).trim())return {ok:true,failingChecks:[],format:'unrecognized'}
  return {ok:false,failingChecks:['doctor reported nothing at all; nothing was proved'],format:'silent'}
}

// How a resolved wrapper path is actually spawned. A Windows `.cmd`/`.bat` shim
// must go through the command interpreter; everything else is executed directly.
// Kept separate from the spawn so the rule can be tested for both platforms on
// either platform.
export function doctorSpawnPlan(resolved,platform=process.platform){
  if(platform==='win32'&&/\.(cmd|bat)$/i.test(resolved))return {file:process.env.ComSpec||'cmd.exe',args:['/d','/s','/c',resolved,'doctor']}
  return {file:resolved,args:['doctor']}
}

// The single place a wrapper name becomes a real path.
//
// ON WINDOWS THE FIRST LINE IS OFTEN THE WRONG ONE. `where.exe ai-grok-review`
// prints BOTH `...\\ai-grok-review` (an extension-less bash script Windows cannot
// execute at all) and `...\\ai-grok-review.cmd` (the shim the shell actually runs,
// via PATHEXT). Taking the first line made the probe fail ENOENT for two of the
// three active reviewers and report them as local faults while they were healthy.
// Caught by spot-checking every wrapper after an independent review asked for it,
// having already been burned once by the same class of bug.
//
// So mirror what the shell does: prefer the first candidate whose extension is in
// PATHEXT, and fall back to the first line when none qualifies.
export function pickExecutableCandidate(candidates,platform=process.platform,pathext=process.env.PATHEXT){
  const list=candidates.filter(Boolean)
  if(platform!=='win32')return list[0]??null
  const exts=String(pathext||'.COM;.EXE;.BAT;.CMD').split(';').map((e)=>e.trim().toLowerCase()).filter(Boolean)
  const runnable=list.find((p)=>exts.some((e)=>p.toLowerCase().endsWith(e)))
  return runnable??list[0]??null
}

export function resolveCommandPath(command,platform=process.platform){
  try{
    const out=execFileSync(platform==='win32'?'where.exe':'which',[command],{encoding:'utf8',stdio:['ignore','pipe','ignore']})
    return pickExecutableCandidate(out.split(/\r?\n/).map((line)=>line.trim()),platform)
  }catch{return null}
}

export function acquireRef(ref, ownerSha, io = githubIo) {
  if (!io.createRef(ref, ownerSha)) throw new LaneError(`${ref} is occupied`)
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
    if(!/^db-coordination (?:admission(?:-operation)?|outcome-(?:advance|complete)|author-acquisition|author-capacity-relinquish|author-capacity-resume|preview|merge|production|repository-maintenance-authorization|claim-release|duplicate-claim-release|claim-split-recovery|claim-object-expansion|claim-reversion|claim-version-supersession|claim-lease-renewal|expired-claim-recovery|reviewer-assignment-lock|reviewer-replacement-lock|reviewer-queue-lock|reviewer-silence-release-lock|reviewer-failure(?:-replacement)?|reviewer-index-cutover-activation-audit)\b/.test(message))throw new LaneError('refusing recovery: mutex owner commit is not a recognized coordination lock')
    if(Number.isNaN(acquiredAt.valueOf()))throw new LaneError('refusing recovery: mutex owner time is unreadable')
    const age=now-acquiredAt
    if(age<minAgeMs)throw new LaneError(`refusing recovery: mutex is only ${Math.max(0,Math.floor(age/1000))} seconds old`)
    releaseOwnedRef(MUTEX_REF,expectedSha,io)
    return { released:expectedSha, ageSeconds:Math.floor(age/1000) }
    } finally { if(io.readRef(MUTEX_RECOVERY_ACTIVE_REF)===expectedSha)releaseOwnedRef(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io) }
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

export function parseReviewCursor(commit) {
  if (!commit) return null
  const message=commit.message ?? commit.commit?.message ?? ''
  const match=/^db-coordination reviewer-cursor sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=(\d+))?$/i.exec(message)??/^db-coordination reviewer-(?:failure-)?replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=(\d+))? /i.exec(message)
  if (!match) throw new LaneError('reviewer cursor does not point to a recognized assignment')
  // `slot` is NULL when the message does not state one, never a guessed 1.
  // Replacement messages written before PR #2077 carry no `slot=` token at all,
  // and reading their silence as "slot 1" is exactly how a slot-2 replacement
  // was returned as slot 1 (grok-4.6 REVISE, high finding 1). The REF NAME is
  // the authority on which slot a record belongs to -- see parseAssignmentRef --
  // and this parser now says "not stated" so a caller cannot mistake a default
  // for evidence.
  return {sequence:Number(match[1]),reviewer:match[2],issue:Number(match[3]),pr:Number(match[4]),headSha:match[5],slot:match[6]?Number(match[6]):null}
}

// #2430. KEY ORDER IS NOT IDENTITY. Two verdict payloads carrying the same fields
// with the same values are the same record whichever order JSON.stringify emitted
// them in, so records are compared over sorted key/value pairs, never over the
// message text.
export function sameVerdictRecord(left,right){
  if(!left||!right)return false
  const keys=[...new Set([...Object.keys(left),...Object.keys(right)])].sort()
  return keys.every((key)=>JSON.stringify(left[key])===JSON.stringify(right[key]))
}
// THE LEASE A RECORDED VERDICT MUST HAND BACK (#2694 review, slot 2, critical
// finding 2).
//
// Before the assignment-keyed cutover the lease ref was named for the PROVIDER
// alone, so nothing had to release it: the reviewer's NEXT draw computed the
// same ref, found it stale (PR head moved, or a verdict recorded), and cleared
// it as `selectedStale`. A v2 ref is named for the TUPLE, and that tuple is
// never drawn again -- so no later draw ever computes that name, nothing
// reclaims it, and `refs/db-review-active-v2/*` grows by one ref per completed
// review forever until `listReviewRefsPaged` refuses the whole namespace and
// every draw, release, replacement, exclusion and capacity report in the
// repository stops.
//
// So the verdict releases its OWN lease, which is the only moment at which the
// work that lease protects is provably finished.
//
// IT NEVER THROWS. `recordReviewVerdict` does not hold the review mutex and the
// artifact is already durable by the time this runs; turning a failed cleanup
// into a thrown error would send the runner down its void path and destroy the
// findings comment a valid verdict's digest is computed over. A lease that
// could not be released is reported on the return value instead, and the next
// identical re-run releases it (the standing-artifact path calls this too).
function releaseRecordedVerdictLease(ref,expectedSha,io){
  try{
    if(typeof io?.deleteRef!=='function')return false
    if(io.readRef(ref)!==expectedSha)return false
    if(typeof io.atomicReviewRefs==='function'&&typeof io.readReviewRefs==='function'){
      io.atomicReviewRefs([{ref,expected:expectedSha,sha:null}])
      return io.readReviewRefs([ref]).get(ref)===null
    }
    io.deleteRef(ref)
    return io.readRef(ref)===null
  }catch{return false}
}
export function recordReviewVerdict(options,io=githubIo){
  const issue=Number(options.issue),pr=Number(options.pr),slot=Number(options.slot??1),headSha=String(options.headSha??'').toLowerCase()
  const verdict=String(options.verdict??'').toUpperCase(),findingsRef=String(options.findingsRef??'')
  const replacementSequence=options.replacementSequence==null?null:Number(options.replacementSequence)
  if(!Number.isInteger(issue)||issue<1||!Number.isInteger(pr)||pr<1||!Number.isInteger(slot)||slot<1||!/^[0-9a-f]{40}$/.test(headSha)||!REVIEW_VERDICTS.has(verdict))throw new LaneError('review verdict requires exact issue, PR, slot, 40-character head SHA, and APPROVE, REVISE, or REJECT')
  if(replacementSequence!==null&&(!Number.isInteger(replacementSequence)||replacementSequence<1))throw new LaneError('replacement verdict requires a positive replacement sequence')
  const assignmentRef=replacementSequence===null
    ?`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}${reviewSlotSuffix(slot)}`
    :`${REVIEW_REPLACEMENT_REF_PREFIX}/${issue}-${pr}-${headSha}${reviewSlotSuffix(slot)}-${replacementSequence}`
  const assignmentSha=io.readRef(assignmentRef)
  if(!assignmentSha)throw new LaneError('the exact durable reviewer assignment does not exist')
  const assignment=parseReviewCursor(io.getCommit(assignmentSha))
  if(assignment.issue!==issue||assignment.pr!==pr||assignment.headSha.toLowerCase()!==headSha||(assignment.slot!==null&&assignment.slot!==slot))throw new LaneError('the assignment record disagrees with the requested verdict tuple')
  // #2078. Refuse BEFORE any commit or ref is created, and before the lease and
  // PR reads, so a reviewer that cannot open the code leaves no artifact at all.
  // This is a property of the wrapper, so no retry, no re-run and no better
  // formatted output can satisfy it.
  if(!reviewerReadsRepository(assignment.reviewer))throw new LaneError(`reviewer ${assignment.reviewer} runs through a wrapper that has no access to the repository under review -- it never reads the diff, only the text of the brief, so its verdict describes the change as DESCRIBED rather than as WRITTEN. Refusing to record a code-review verdict from it. This is a property of the wrapper: no retry and no re-run can satisfy it. Draw a reviewer that reads the code with the exact command: ${nonReadingReviewerReplacementCommand({issue,pr,headSha,slot},assignment.sequence)}`)
  // Prefer the assignment-keyed lease introduced by #2694.  The legacy
  // one-provider ref remains valid only for reviews created before this
  // cutover, so an in-flight old review can still finish without being moved.
  const parallelActiveRef=reviewLeaseRefForAssignment({...assignment,slot},Boolean(io.requiresExactReviewHeadSha))
  const parallelLeaseSha=io.readRef(parallelActiveRef)
  const legacyActiveRef=reviewActiveRef(assignment.reviewer)
  const holdsParallel=parallelLeaseSha===assignmentSha
  const legacyLeaseSha=holdsParallel?null:io.readRef(legacyActiveRef)
  const holdsLegacy=!holdsParallel&&legacyLeaseSha===assignmentSha
  const activeLeaseSha=holdsParallel?parallelLeaseSha:legacyLeaseSha
  // The ref this verdict hands its lease back through. When NEITHER name holds
  // the lease any more -- the idempotent re-run below, whose first run already
  // released it -- the v2 name is the one this assignment's lease occupies, so
  // that is what is reported and what the (no-op) release is attempted against.
  // Falling back to the LEGACY provider-keyed name here would aim a release at a
  // ref a live SIBLING job for the same provider may be holding.
  const activeRef=holdsParallel||!holdsLegacy?parallelActiveRef:legacyActiveRef
  // Every successful exit goes through here, so a recorded verdict ALWAYS hands
  // its lease back -- including the idempotent re-run over a standing artifact,
  // which is what repairs a release that failed on an earlier attempt.
  // `releaseRecordedVerdictLease` is compare-and-delete: a ref that does not
  // hold THIS assignment SHA is left exactly as it is.
  const finish=(validated)=>({...validated,lease_ref:activeRef,lease_released:releaseRecordedVerdictLease(activeRef,assignmentSha,io)})
  const live=io.getPr(pr)
  if(String(live?.state??'').toLowerCase()!=='open'||String(live?.head?.sha??'').toLowerCase()!==headSha)throw new LaneError('review target is no longer the exact open PR head')
  const ref=verdictRef({issue,pr,headSha,slot,replacementSequence})
  const existing=io.readRef(ref)
  // #2710. IDEMPOTENCY OUTLIVES THE LEASE, SO THE STANDING ARTIFACT IS READ
  // FIRST. A verdict releases its own lease on the way out (see
  // `releaseRecordedVerdictLease`), and `run-governed-review.mjs` re-runs the
  // whole recording with no existing-verdict pre-check. With the lease gate
  // ahead of this read, the SECOND identical run of a review that had already
  // succeeded was refused as a "late or conflicting verdict" for a verdict whose
  // durable artifact was sitting right there -- the release made the operation
  // non-idempotent. The artifact is the durable record; the lease is only the
  // concurrency token that produced it, so an existing artifact answers first.
  //
  // This does NOT weaken the late-or-conflicting refusal. The artifact carries
  // its own `assignment_sha`, and `validateVerdictArtifact` below refuses it
  // unless that SHA is exactly the assignment this request resolved (and the
  // reviewer, ref tuple, parentage and findings digest all agree). A verdict
  // from a different or superseded assignment is still refused here, and a
  // request with NO standing artifact still falls through to the lease gate.
  if(existing){
    // #2464. An artifact that ALREADY EXISTS is validated against ITS OWN
    // findings comment, never against the comment this round just posted. The
    // artifact is immutable and records the `findings_ref` it was bound to; a
    // re-run posts a NEW comment, so digesting this round's body against a
    // previous round's artifact reported "findings digest does not match the
    // durable findings" for a perfectly valid artifact and burned the tuple.
    // The create-race path below already read the winner's own findings; this
    // path now does the same.
    const existingCommit=io.getCommit(existing)
    const existingRecord=parseVerdictCommit(existingCommit)
    const existingBody=io.readFindings(existingRecord.findings_ref)
    const validated=validateVerdictArtifact({ref,sha:existing,commit:existingCommit,findingsBody:existingBody,activeLeaseSha:assignmentSha,assignment:{sha:assignmentSha,reviewer:assignment.reviewer}})
    if(validated.verdict!==verdict)throw new LaneError('a different create-only verdict already exists')
    return finish(validated)
  }
  if(activeLeaseSha!==assignmentSha){
    // #2694 review (slot 2, medium finding 8). The cause used to be built from
    // the LEGACY ref's contents unconditionally. Post-cutover the lease that
    // actually stands for this reviewer lives under the v2 name, so when the v2
    // ref held a different assignment and no legacy ref existed at all, the
    // refusal said "holds no active lease at all" -- the exact wrong-cause
    // report issue #2311 was opened to end. Report whichever ref actually holds
    // something, and name that ref.
    const causeRef=parallelLeaseSha?parallelActiveRef:legacyActiveRef
    const causeSha=parallelLeaseSha??legacyLeaseSha
    throw new LaneError(`reviewer does not hold the exact active lease; late or conflicting verdict refused${reviewActiveLeaseCause(assignment.reviewer,causeSha,{issue,pr,headSha},io,causeRef)}`)
  }
  try{assertFindingsRefForPr(findingsRef,pr)}catch(error){throw new LaneError(error.message)}
  const findingsBody=io.readFindings(findingsRef)
  if(!String(findingsBody??'').trim())throw new LaneError('durable reviewer findings are unreadable or empty')
  const record={verdict,head_sha:headSha,issue,pr,slot,reviewer:assignment.reviewer,assignment_sha:assignmentSha,findings_digest:findingsDigest(findingsBody),findings_ref:findingsRef}
  const sha=io.makeReviewVerdictCommit(formatVerdictMessage(record),assignmentSha)
  try{if(!io.createRef(ref,sha))throw new Error('create returned false')}catch(error){
    // #2464 (muse-spark, PR #2468). A FAILED create does not mean nothing was
    // created. The create can land and still report an error -- a dropped
    // response, a proxy timeout -- in which case the winner of this "race" is
    // THIS round's own commit, bound to THIS round's findings comment. Every
    // read below (getCommit, readFindings, validation) can then fail
    // transiently, and an unmarked throw sends the runner down its void path,
    // editing the very comment the artifact's findings_digest was computed
    // over. So the winner is read with the same absence-retry as the success
    // path, and once the winner is known to be our own SHA, EVERY error out of
    // this branch carries the marker.
    // The winner READ can itself throw -- readRef returns null only on a
    // confirmed 404 and rethrows every other transport error (muse-spark,
    // PR #2468, round 2). A thrown read leaves us unable to prove the ref is
    // absent, and the create may well have landed, so the failure is marked
    // UNCONFIRMED rather than left bare: refusing to void is safe when we do not
    // know, while voiding is irreversible. Round 4 extended the same reasoning
    // to a repeated null: see the block below -- after a FAILED create, no exit
    // in this branch is treated as proof of absence.
    let winner=null
    try{winner=readRefAfterWrite(ref,sha,io)}
    catch(readError){readError.verdictArtifactCreated={ref,sha,confirmed:false};throw readError}
    // A repeated null after an ERRORED create is not proof of absence either
    // (muse-spark, PR #2468 round 3). The create reported a failure, so landing
    // is unknown, and the same eventual consistency that hides a fresh ref for
    // one read can hide it for all twelve. This exit is therefore marked
    // unconfirmed as well: after a failed create, NOTHING in this branch is
    // proven absent, and the only unmarked outcome left is a winner that is
    // demonstrably another round's object, which is not ours to protect.
    if(!winner){const absent=new LaneError('create-only verdict ref failed and no winner could be read; the ref may still hold the commit this round created, so nothing may be voided and this must not be retried blindly');absent.verdictArtifactCreated={ref,sha,confirmed:false};throw absent}
    const markIfOurs=(failure)=>{if(winner===sha)failure.verdictArtifactCreated={ref,sha,confirmed:true};return failure}
    try{
      const winnerRecord=parseVerdictCommit(io.getCommit(winner))
      const winnerBody=io.readFindings(winnerRecord.findings_ref)
      const validated=validateVerdictArtifact({ref,sha:winner,commit:io.getCommit(winner),findingsBody:winnerBody,activeLeaseSha:assignmentSha,assignment:{sha:assignmentSha,reviewer:assignment.reviewer}})
      if(validated.verdict!==verdict)throw new LaneError('a contradictory create-only verdict won the race; this tuple is permanently refused')
      return finish(validated)
    }catch(failure){throw markIfOurs(failure)}
  }
  // #2464. THE CREATE SUCCEEDED. Everything from here on is confirmation of an
  // object that already exists durably, so two rules apply.
  //
  // FIRST, the readback is retried. GitHub's create-ref response can arrive
  // before the new custom ref is visible to a following GET -- the eventual
  // consistency `readRefAfterWrite` was written for. Asked exactly once, a
  // successful create followed by a transient 404 was indistinguishable from a
  // create that never landed, and it refused a real APPROVE four rounds running
  // on PR #2409 while `refs/db-review-verdicts/2334-2409-2835169...-slot2` sat
  // there holding the APPROVE payload. A DIFFERENT sha still fails closed on the
  // first read, exactly as before: this is not a weaker check, it is the same
  // check asked until the API can answer it.
  //
  // SECOND, any failure past this point is marked `verdictArtifactCreated`. The
  // runner's failure path voids the findings comment, which permanently breaks
  // the `findings_digest` recorded INSIDE the artifact that was just written --
  // destroying the evidence for a verdict that exists and is valid. A caller
  // that sees this marker must report loudly and STOP, touching nothing.
  try{
    const seen=readRefAfterWrite(ref,sha,io)
    // #2430. A DIFFERENT SHA IS NOT AUTOMATICALLY CORRUPTION. The create is
    // confirmed, so something written by THIS call stands at the ref -- and a
    // retried create can produce a second commit object with a different SHA
    // and an identical payload (the commit carries a timestamp; the record does
    // not). Refusing on the SHA alone threw away a completed, paid-for review on
    // PR #2415 at head 0fab4ace. So the CONTENT standing at the ref is compared
    // against the record this call intended to write: an equivalent record that
    // still validates as a full artifact is this verdict, and is a success.
    // Anything else -- an unreadable commit, a genuinely different record, an
    // absent ref after a confirmed create -- is still a permanent refusal, and
    // still marked created so the runner never voids the findings comment.
    if(seen!==sha){
      if(!seen)throw new LaneError(`create-only verdict readback could not confirm the created object at ${ref} (read absent, expected ${sha}); the artifact WAS created and must not be voided`)
      let standing=null
      try{standing=parseVerdictCommit(io.getCommit(seen))}catch{standing=null}
      if(!sameVerdictRecord(standing,record))throw new LaneError(`create-only verdict readback could not confirm the created object at ${ref} (read ${seen}, expected ${sha}); the artifact WAS created and must not be voided`)
      return finish(validateVerdictArtifact({ref,sha:seen,commit:io.getCommit(seen),findingsBody,activeLeaseSha:assignmentSha,assignment:{sha:assignmentSha,reviewer:assignment.reviewer}}))
    }
    return finish(validateVerdictArtifact({ref,sha,commit:io.getCommit(sha),findingsBody,activeLeaseSha:assignmentSha,assignment:{sha:assignmentSha,reviewer:assignment.reviewer}}))
  }catch(error){
    error.verdictArtifactCreated={ref,sha,confirmed:true}
    throw error
  }
}

// THE EXACT RECOVERY ROUTE FOR A NON-READING REVIEWER (#2079).
// The refusal above used to end with a bare "use --replace-failed-reviewer",
// which an operator could follow straight into a second refusal: replacement
// requires a recognized terminal failure code and both no-verdict confirmations,
// and (before this change) any durable verdict at the head blocked it outright.
// This builds the command that actually runs, so the message names a route
// rather than a direction.
export function nonReadingReviewerReplacementCommand({issue,pr,headSha,slot=1},failedSequence){
  return `node scripts/manage-migration-author-lanes.mjs --replace-failed-reviewer --issue ${issue} --pr ${pr} --head-sha ${headSha} --review-slot ${slot} --failed-sequence ${failedSequence} --failure-code reviewer_cannot_read_repository --confirm-no-verdict --confirm-no-artifact`
}

// THE READ SIDE OF THE SAME FACT (#2079).
// The write-side guard in recordReviewVerdict only binds FUTURE verdicts. It
// cannot retract `refs/db-review-verdicts/1987-1989-fe810d47...`, the artifact
// deepseek-chat already produced for a migration it could not open, and that
// artifact was still merge-gate-valid.
//
// A verdict from a reviewer that cannot read the repository is treated as
// ABSENT, not as a refusal. That choice is deliberate. A refusal would be
// permanent -- the artifact is immutable and create-only, so the slot could
// never be satisfied and the pull request would be stuck forever, trading one
// deadlock for another. Treated as absent, the slot simply has no verdict: the
// gate refuses for the ordinary "no durable APPROVE" reason, and
// --replace-failed-reviewer can draw a reviewer that reads the code and finish
// the review. Absence is recoverable; a permanent refusal is not.
//
// THAT IS ONLY TRUE BECAUSE THE MERGE GATE APPLIES THE SAME RULE. This function
// is read by the PREVIEW gate, which under merge-first runs AFTER the merge. An
// earlier version of this comment claimed the merge gate refuses for the ordinary
// "no durable APPROVE" reason; it did not, because it applied no such filter at
// all -- a disregarded APPROVE still authorized there, and a disregarded REVISE
// still blocked the head permanently, which is exactly the deadlock this
// treat-as-absent choice exists to avoid. `evaluateExactHeadApproval` in
// `check-exact-head-approval.mjs` now disregards both directions the same way,
// so the two gates agree. Do not remove it there on the assumption that this
// function covers it.
//
// It is not silently dropped: `includeDisregarded` returns the rows with
// `disregarded:true` so callers can SAY that an artifact exists and why it does
// not count.
export function readReviewVerdicts(issue,pr,headSha,io=githubIo,{includeDisregarded=false}={}){
  const prefixes=[REVIEW_VERDICT_REF_PREFIX,REVIEW_VERDICT_REPLACEMENT_REF_PREFIX]
  const rows=prefixes.flatMap((prefix)=>io.listRefs(`${prefix}/${Number(issue)}-${Number(pr)}-${String(headSha).toLowerCase()}`))
  return rows.map(({ref,sha})=>{
    const named=parseVerdictRef(ref)
    if(!named||named.issue!==Number(issue)||named.pr!==Number(pr)||named.headSha!==String(headSha).toLowerCase())throw new LaneError(`verdict ref ${ref} escaped its exact tuple prefix`)
    const commit=io.getCommit(sha),record=parseVerdictCommit(commit)
    const assignmentRef=named.replacementSequence===null
      ?`${REVIEW_ASSIGNMENT_REF_PREFIX}/${named.issue}-${named.pr}-${named.headSha}${reviewSlotSuffix(named.slot)}`
      :`${REVIEW_REPLACEMENT_REF_PREFIX}/${named.issue}-${named.pr}-${named.headSha}${reviewSlotSuffix(named.slot)}-${named.replacementSequence}`
    const assignmentSha=io.readRef(assignmentRef)
    // A RETURNED ASSIGNMENT STILL ANSWERS FOR ITS VERDICT.
    //
    // `recordReviewVerdict` does not hold the review mutex, so a verdict can
    // land in the narrow window between the exclusion's fresh verdict scan and
    // its atomic push. The assignment ref is then gone and this read is null.
    // Throwing there would make the audit chain the return exists to protect
    // break the pull request permanently: the exclusion is already recorded, so
    // re-running it is idempotent and restores nothing. The return record is the
    // durable proof of that assignment -- it names the same SHA and reviewer,
    // and its commit is parented on the assignment commit, so the object is
    // still reachable. Resolve through it. This does NOT let the verdict
    // authorize anything: `assertDurableReviewApproval` treats the returned slot
    // as unapproved regardless of what this verdict says.
    let assignmentIdentity=assignmentSha?{sha:assignmentSha,reviewer:parseReviewCursor(io.getCommit(assignmentSha)).reviewer}:null
    if(!assignmentIdentity){
      const retired=readReviewReturns(named.issue,named.pr,named.headSha,io).find((row)=>row.slot===named.slot&&row.replacementSequence===named.replacementSequence&&row.assignmentSha===String(record.assignment_sha??'').toLowerCase())
      if(!retired)throw new LaneError(`verdict ${ref} has no live assignment record`)
      assignmentIdentity={sha:retired.assignmentSha,reviewer:retired.reviewer}
    }
    const assignment={reviewer:assignmentIdentity.reviewer}
    const findingsBody=io.readFindings(record.findings_ref)
    let validated
    try{validated=validateVerdictArtifact({ref,sha,commit,findingsBody,assignment:{sha:assignmentIdentity.sha,reviewer:assignment.reviewer}})}
    catch(error){throw new LaneError(`verdict ${ref} is invalid: ${error.message}`)}
    return {...validated,ref,reviewer:assignment.reviewer,disregarded:!reviewerReadsRepository(assignment.reviewer)}
  }).filter((row)=>includeDisregarded||!row.disregarded)
}

export function reviewActiveRef(reviewer,assignment=null){
  if(!REVIEWERS.some((row)=>row.name===reviewer))throw new LaneError(`unknown reviewer ${reviewer}`)
  if(assignment!==null){
    const issue=Number(assignment.issue),pr=Number(assignment.pr),headSha=String(assignment.headSha??'').toLowerCase(),slot=Number(assignment.slot??1)
    if(!Number.isInteger(issue)||issue<1||!Number.isInteger(pr)||pr<1||!/^[0-9a-f]{40}$/.test(headSha)||!Number.isInteger(slot)||slot<1)throw new LaneError('parallel reviewer lease requires exact issue, PR, head, and slot identity')
    return `${REVIEW_ACTIVE_PARALLEL_REF_PREFIX}/${reviewer}/${issue}-${pr}-${headSha}${reviewSlotSuffix(slot)}`
  }
  return `${REVIEW_ACTIVE_REF_PREFIX}/${reviewer}`
}

function reviewLeaseRefForAssignment(assignment,parallel=false){return parallel&&/^[0-9a-f]{40}$/i.test(String(assignment?.headSha??''))?reviewActiveRef(assignment.reviewer,assignment):reviewActiveRef(assignment.reviewer)}
function reviewLeaseIdentity(assignment){return `${assignment.reviewer}:${assignment.issue}:${assignment.pr}:${String(assignment.headSha).toLowerCase()}:${assignment.slot??1}:${assignment.sequence}`}
function activeLeaseRecordForAssignment(busy,assignment){return busy?.byAssignment?.get(reviewLeaseIdentity(assignment))??null}
// Every live lease that matches one assignment TUPLE, read out of the
// assignment-keyed index rather than the reviewer-keyed `leases` compatibility
// view. `leases` is Map(reviewer -> LAST record), so the moment one provider may
// hold two independent jobs it can hide the very job a repair path is fixing
// (#2694 review, high finding 4). Repair paths ask by tuple, never by identity.
function activeLeaseRecordsForJob(busy,{issue,pr,headSha,sequence}){
  const head=String(headSha??'').toLowerCase()
  return [...(busy?.byAssignment?.values()??[])].filter((row)=>row.lease.issue===issue&&row.lease.pr===pr&&String(row.lease.headSha).toLowerCase()===head&&row.lease.sequence===sequence)
}
function activeLeaseRecordForJob(busy,job){return activeLeaseRecordsForJob(busy,job)[0]??null}
// The names a lease for this assignment can legitimately live under: the new
// per-assignment v2 ref, and the pre-cutover one-provider ref an in-flight
// review is still holding. The caller picks whichever one actually HOLDS it.
function reviewLeaseRefCandidates(assignment,parallel){
  const refs=[reviewLeaseRefForAssignment(assignment,parallel)]
  const legacy=reviewActiveRef(assignment.reviewer)
  if(!refs.includes(legacy))refs.push(legacy)
  return refs
}
// Does `ref` hold the lease for exactly THIS assignment? Returns its SHA, or
// null. Fail-closed: an unreadable commit, an unparseable lease, or a lease that
// names any other tuple answers null rather than "close enough".
function leaseMatchesAssignment(lease,assignment){
  if(!lease)return false
  if(lease.reviewer!==assignment.reviewer||lease.issue!==Number(assignment.issue)||lease.pr!==Number(assignment.pr)||String(lease.headSha).toLowerCase()!==String(assignment.headSha??'').toLowerCase())return false
  if(assignment.sequence!==undefined&&assignment.sequence!==null&&lease.sequence!==Number(assignment.sequence))return false
  if(lease.slot!==null&&assignment.slot!==undefined&&assignment.slot!==null&&lease.slot!==Number(assignment.slot))return false
  return true
}
function leaseRefHoldsAssignment(ref,assignment,io){
  let sha
  try{sha=io.readRef(ref)}catch{return null}
  if(!sha)return null
  let lease
  try{lease=parseReviewLease(io.getCommit(sha))}catch{return null}
  return leaseMatchesAssignment(lease,assignment)?sha:null
}
// The ref that ACTUALLY holds this assignment's lease. `reviewLeaseRefForAssignment`
// alone always computes the v2 name on production, so every mutation path that
// used it aimed its compare-and-swap at a ref a legacy in-flight lease does not
// live in (#2694 review, high finding 2). The looked-up snapshot record's own
// `.ref` wins; otherwise each candidate is PROVED to hold this exact assignment
// before it is chosen. When nothing holds it the canonical v2 name is returned,
// so the caller's existing "lease does not match" refusal still fires.
function resolveAssignmentLeaseRef(assignment,parallel,io,busy=null){
  const cached=busy?activeLeaseRecordForAssignment(busy,assignment):null
  if(cached?.ref)return cached.ref
  const candidates=reviewLeaseRefCandidates(assignment,parallel)
  // `leaseSnapshot` is the complete-or-refused listing findBusyReviewers already
  // paid for. When it is present it ANSWERS this question with no extra wire
  // read: a candidate it does not carry does not exist.
  const snapshot=busy?.leaseSnapshot
  if(snapshot instanceof Map){
    for(const ref of candidates){
      const row=snapshot.get(ref)
      if(!row?.sha)continue
      let lease=null
      try{lease=parseReviewLease(row.commit??io.getCommit(row.sha))}catch{lease=null}
      if(leaseMatchesAssignment(lease,assignment))return ref
    }
    return reviewLeaseRefForAssignment(assignment,parallel)
  }
  for(const ref of candidates)if(leaseRefHoldsAssignment(ref,assignment,io))return ref
  return reviewLeaseRefForAssignment(assignment,parallel)
}

export function parseReviewLease(commit){
  if(!commit)return null
  const message=commit.message??commit.commit?.message??''
  // #2208 FOLLOW-UP (codex-gpt-5.6-sol REJECT, high finding). The lease's SLOT is
  // now carried out of the message, because `findBusyReviewers` has to ask
  // "does MY slot have a verdict", not "has some sibling slot finished". It is
  // read per message FORM, never guessed:
  //   * cursor form  -- current `--assign-reviewer` writes ` slot=N` for every
  //     slot but 1, and omits it for slot 1. Absent therefore MEANS slot 1 here.
  //   * replacement form -- replacement messages written before PR #2077 carry
  //     no `slot=` token at all, so absent is genuinely UNKNOWN, not slot 1.
  //     Same reasoning as parseReviewCursor: reading that silence as slot 1 is
  //     how a slot-2 replacement was once returned as slot 1.
  //   * legacy `generation=` leases are SLOT 1 (round 3). Nothing writes that
  //     form any anymore -- it is read-only history from before review slots
  //     existed at all, so slot 1 is the only slot such a lease could ever have
  //     belonged to. Saying so keeps those leases freed by their own verdict, as
  //     they always have been; leaving them UNKNOWN under the round-3 fail-closed
  //     liveness sentinel would have pinned them busy forever.
  // `slot === null` means "not stated". Liveness callers map that ambiguity to
  // the slot-0 sentinel so no sibling verdict can reclaim the lease; the lease
  // remains busy until its slot identity is repaired or otherwise resolved.
  const leaseMatch=/^db-coordination reviewer-lease generation=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40}) sequence=(\d+)$/i.exec(message)
  const cursorMatch=leaseMatch?null:/^db-coordination reviewer-cursor sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=(\d+))?$/i.exec(message)
  const replacementMatch=(leaseMatch||cursorMatch)?null:/^db-coordination reviewer-(?:failure-)?replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=(\d+))? /i.exec(message)
  const match=leaseMatch??cursorMatch??replacementMatch
  if(!match)throw new LaneError('active reviewer lease is malformed')
  const cursorForm=!leaseMatch
  const slot=leaseMatch?1:(match[6]?Number(match[6]):(cursorMatch?1:null))
  const lease={generation:Number(match[1]),reviewer:match[2],issue:Number(match[3]),pr:Number(match[4]),headSha:match[5],sequence:Number(cursorForm?match[1]:match[6]),slot}
  if(!Number.isSafeInteger(lease.generation)||lease.generation<1||!Number.isSafeInteger(lease.sequence)||lease.sequence<1||!REVIEWERS.some((row)=>row.name===lease.reviewer))throw new LaneError('active reviewer lease is malformed')
  if(lease.slot!==null&&(!Number.isSafeInteger(lease.slot)||lease.slot<1))throw new LaneError('active reviewer lease is malformed')
  return lease
}

export function parseReviewExclusion(commit){
  if(!commit)return null
  const message=commit.message??commit.commit?.message??''
  const match=/^db-coordination reviewer-exclusion reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) reason=([a-z-]+) evidence=([0-9a-f]{7,40})$/i.exec(message)
  if(!match||!REVIEWERS.some((row)=>row.name===match[1])||!REVIEW_EXCLUSION_REASONS.has(match[4]))throw new LaneError('reviewer exclusion is malformed')
  return {reviewer:match[1],issue:Number(match[2]),pr:Number(match[3]),reason:match[4],evidenceSha:match[5]}
}

// EXCLUSION GENERATIONS -- WHY A LIFTED EXCLUSION MUST NOT KEEP THE SLOT.
//
// The exclusion ref is create-only, so before generations a reinstatement
// permanently spent the ONLY exclusion slot for that reviewer+PR: a later
// `already-reviewed` or `independence-conflict` exclusion hit the lifted
// record and was refused, and draw-time selection reads only the live
// exclusion set. The independence rule "a provider that already judged these
// bytes is never re-drawn" therefore could not be enforced for any reinstated
// reviewer on that pull request (#2224 review 2, High).
//
// The repair keeps EVERY record append-only. Nothing is ever deleted or
// rewritten: a later exclusion is written to the NEXT generation ref, and a
// generation only stops barring the reviewer when its OWN reinstatement ref
// lifts it. So gen1 lifted + gen2 `already-reviewed` bars the reviewer again,
// and the whole history -- exclusion, lift, re-exclusion -- stays readable.
export const REVIEW_EXCLUSION_GENERATION_LIMIT = 4
function reviewGenerationSuffix(generation){
  const value=Number(generation)
  if(!Number.isInteger(value)||value<1||value>REVIEW_EXCLUSION_GENERATION_LIMIT)throw new LaneError(`reviewer exclusion generation must be an integer 1..${REVIEW_EXCLUSION_GENERATION_LIMIT}`)
  return value===1?'':`-gen${value}`
}
// Generation 1 keeps the historical ref name EXACTLY, so every exclusion and
// reinstatement recorded before this change reads unchanged.
export function reviewExclusionRef({issue,pr,reviewer,generation=1}){
  return `${REVIEW_EXCLUSION_REF_PREFIX}/${Number(issue)}-${Number(pr)}-${requireGenerationSafeReviewer(reviewer)}${reviewGenerationSuffix(generation)}`
}
export function reviewReinstatementRef({issue,pr,reviewer,generation=1}){
  return `${REVIEW_REINSTATEMENT_REF_PREFIX}/${Number(issue)}-${Number(pr)}-${requireGenerationSafeReviewer(reviewer)}${reviewGenerationSuffix(generation)}`
}
// A reviewer literally named `x-gen2` would make gen1 of `x-gen2` and gen2 of
// `x` the SAME ref, which would silently merge two providers' records. No such
// name is in the registry and this refuses one ever being added quietly.
function requireGenerationSafeReviewer(reviewer){
  const name=String(reviewer??'')
  if(/-gen\d+$/i.test(name))throw new LaneError(`reviewer name ${name} collides with the exclusion generation ref suffix`)
  return name
}
export const REVIEW_EXCLUSION_GENERATIONS = Object.freeze(Array.from({length:REVIEW_EXCLUSION_GENERATION_LIMIT},(_,index)=>index+1))

function reviewerExclusions(issue,pr,io,{fresh=false}={}){
  const prefix=`${REVIEW_EXCLUSION_REF_PREFIX}/${Number(issue)}-${Number(pr)}-`
  const result=new Map()
  // Read the complete, finite reviewer registry in one GraphQL request.  A
  // prefix listing returns only ref/SHA pairs and therefore costs one extra
  // getCommit request per exclusion while the global reviewer mutex is held.
  // That variable cost defeated the mutex-section request reserve (#1833).
  // Exact reads also make absence explicit and cannot be truncated.
  const refs=REVIEWERS.flatMap(({name})=>REVIEW_EXCLUSION_GENERATIONS.map((generation)=>reviewExclusionRef({issue,pr,reviewer:name,generation})))
  // The reinstatement refs ride in the SAME batched record read as the
  // exclusions, so lifting a reinstated exclusion costs ZERO extra requests on
  // the production io and the mutex-section reserve is unchanged (#1833). Only
  // test doubles without `readReviewRecords` pay a second prefix listing.
  const reinstatePrefix=`${REVIEW_REINSTATEMENT_REF_PREFIX}/${Number(issue)}-${Number(pr)}-`
  const reinstateRefs=REVIEWERS.flatMap(({name})=>REVIEW_EXCLUSION_GENERATIONS.map((generation)=>reviewReinstatementRef({issue,pr,reviewer:name,generation})))
  const exact=io.readReviewRecords?.([...refs,...reinstateRefs],null)
  const rows=exact
    ? refs.map((ref)=>{const row=exact.get(ref);return row?{ref,...row}:null}).filter(Boolean)
    : (fresh?io.__freshListRefs(prefix):io.listRefs(prefix))??[]
  // On the fallback path the second listing is only paid when there is an
  // exclusion that could be lifted. No exclusions, no reinstatement read, and
  // the measured request budget of the ordinary assignment path is unchanged
  // (scripts/manage-migration-author-lanes.test.mjs pins it at 23).
  const reinstateRows=exact
    ? reinstateRefs.map((ref)=>{const row=exact.get(ref);return row?{ref,...row}:null}).filter(Boolean)
    : rows.length?((fresh?io.__freshListRefs(reinstatePrefix):io.listRefs(reinstatePrefix))??[]):[]
  const reinstated=new Map()
  for(const row of reinstateRows){
    const record=parseReviewReinstatement(row.commit??io.getCommit(row.sha))
    const generation=REVIEW_EXCLUSION_GENERATIONS.find((each)=>row.ref===reviewReinstatementRef({issue,pr,reviewer:record.reviewer,generation:each}))
    if(record.issue!==Number(issue)||record.pr!==Number(pr)||!generation)throw new LaneError('durable reviewer reinstatement does not match its ref identity')
    reinstated.set(`${record.reviewer}#${generation}`,record)
  }
  for(const row of rows){
    const exclusion=parseReviewExclusion(row.commit??io.getCommit(row.sha))
    const generation=REVIEW_EXCLUSION_GENERATIONS.find((each)=>row.ref===reviewExclusionRef({issue,pr,reviewer:exclusion.reviewer,generation:each}))
    if(exclusion.issue!==Number(issue)||exclusion.pr!==Number(pr)||!generation)throw new LaneError('durable reviewer exclusion does not match its ref identity')
    // A lift only ever answers for its OWN generation. A later generation's
    // exclusion is untouched by an earlier generation's reinstatement, which is
    // what lets an independence exclusion be recorded after a lift.
    const lift=reinstated.get(`${exclusion.reviewer}#${generation}`)
    if(lift){
      // An exclusion ref is create-only and its commit never moves, so a
      // reinstatement naming a DIFFERENT exclusion SHA cannot be produced by any
      // correct path. That is corruption, not a stale record, and it is refused
      // rather than resolved in either direction.
      if(lift.exclusionSha!==String(row.sha).toLowerCase())throw new LaneError(`reviewer reinstatement for ${exclusion.reviewer} names exclusion ${lift.exclusionSha} but the durable exclusion is ${row.sha}; reviewer exclusion read stopped for audit`)
      // Belt and braces: the reason is proved from the EXCLUSION itself, not
      // from the reinstatement's copy of it. An independence guarantee can never
      // be lifted even if some record claims it was.
      if(!REINSTATABLE_EXCLUSION_REASONS.has(exclusion.reason))throw new LaneError(`reviewer reinstatement exists for a ${exclusion.reason} exclusion of ${exclusion.reviewer}; that reason is an independence guarantee and is never lifted`)
      continue
    }
    result.set(exclusion.reviewer,exclusion)
  }
  return result
}

// THE RECORD THAT UNDOES A FALSE "TERMINAL" CALL -- WITHOUT ERASING IT.
//
// Append-only by construction: the original exclusion ref is never deleted,
// rewritten or moved, so the audit trail of the failure that was reported
// survives whatever happens next. The reinstatement is a SECOND, create-only
// ref whose commit is parented on the exclusion commit, and it carries the
// wrapper's own `doctor` output verbatim in its commit body. The header line
// carries a digest of that body, so a record whose evidence was edited or
// truncated stops matching its own header.
// The SAME count the writer records and the reader re-derives. A header may
// not claim more passing checks than the stored body actually contains
// (#2224 review 2, Low): `checks=` is re-counted from the proof, not trusted.
export function countDoctorPassLines(proof){
  return String(proof??'').split(/\r?\n/).filter((line)=>/^\s*PASS\s+\S/.test(line)||/^\s*\S(?:.*\S)?\s+:\s*(?:PASS|OK)\b/.test(line)).length
}
export function parseReviewReinstatement(commit){
  if(!commit)return null
  const message=String(commit.message??commit.commit?.message??'')
  const newline=message.indexOf('\n')
  const header=newline===-1?message:message.slice(0,newline)
  const proof=newline===-1?'':message.slice(newline).replace(/^\n\n?/,'')
  const match=/^db-coordination reviewer-reinstatement reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) exclusion=([0-9a-f]{7,40}) reason=([a-z-]+) wrapper=(\S+) proof=sha256:([0-9a-f]{64}) checks=(\d+)$/i.exec(header)
  if(!match||!REVIEWERS.some((row)=>row.name===match[1])||!REINSTATABLE_EXCLUSION_REASONS.has(match[5])||Number(match[8])<1)throw new LaneError('reviewer reinstatement is malformed')
  if(createHash('sha256').update(proof,'utf8').digest('hex')!==match[7].toLowerCase())throw new LaneError('reviewer reinstatement proof does not match its recorded digest')
  // Digest self-consistency is not proof CONTENT. A record whose header claims
  // passing checks its own body does not contain is refused outright.
  if(countDoctorPassLines(proof)!==Number(match[8]))throw new LaneError(`reviewer reinstatement claims ${Number(match[8])} passing checks but its recorded proof contains ${countDoctorPassLines(proof)}`)
  return {reviewer:match[1],issue:Number(match[2]),pr:Number(match[3]),exclusionSha:match[4].toLowerCase(),reason:match[5],wrapper:match[6],proofDigest:match[7].toLowerCase(),passedChecks:Number(match[8]),proof}
}

// Reinstate a reviewer whose per-PR `terminal-unavailable` exclusion is
// demonstrably no longer true. Refuses on every other reason, refuses without
// fresh positive proof, and is a clean idempotent no-op on a re-run.
export function reinstateReviewerExclusion({issue,pr,reviewer},io=githubIo){
  return withReviewRequestBudget(()=>{
    io=reviewOperationIo(io);issue=Number(issue);pr=Number(pr);reviewer=String(reviewer??'')
    const approved=REVIEWERS.find((row)=>row.name===reviewer)
    if(!Number.isInteger(issue)||!Number.isInteger(pr)||!approved)throw new LaneError('reviewer reinstatement requires issue, PR, and a known reviewer')
    // The NEWEST generation is the one that is actually barring the reviewer;
    // lifting an older, already-lifted one would prove nothing.
    const generations=reviewExclusionGenerationRows({issue,pr,reviewer},io)
    const newest=[...generations].reverse().find((row)=>row.sha)
    if(!newest)throw new LaneError(`reviewer ${reviewer} has no durable exclusion for issue #${issue} PR #${pr}; there is nothing to reinstate`)
    const exclusionRef=newest.ref,exclusionSha=newest.sha,generation=newest.generation
    const exclusion=parseReviewExclusion(newest.commit??io.getCommit(exclusionSha))
    if(exclusion.issue!==issue||exclusion.pr!==pr||exclusion.reviewer!==reviewer)throw new LaneError('durable reviewer exclusion does not match its ref identity')
    // THE WHOLE POINT OF THE NARROW REASON SET. `already-reviewed` and
    // `independence-conflict` say this provider must never judge these bytes;
    // no doctor output makes that untrue. Refused before any probe is run.
    if(!REINSTATABLE_EXCLUSION_REASONS.has(exclusion.reason))throw new LaneError(`reviewer ${reviewer} is excluded for issue #${issue} PR #${pr} with reason ${exclusion.reason}; only ${[...REINSTATABLE_EXCLUSION_REASONS].join(', ')} may be reinstated because the others are independence guarantees, not claims about whether the provider can run`)
    const ref=newest.reinstatementRef
    const existing=newest.reinstatementSha??io.readRef(ref)
    if(existing){
      const prior=parseReviewReinstatement(io.getCommit(existing))
      if(prior.issue!==issue||prior.pr!==pr||prior.reviewer!==reviewer||prior.exclusionSha!==String(exclusionSha).toLowerCase())throw new LaneError(`reviewer ${reviewer} already has a different durable reinstatement for issue #${issue} PR #${pr}`)
      return {...prior,ref,sha:existing,exclusionRef,repeat:true}
    }
    // FRESH POSITIVE PROOF, CAPTURED NOW.
    //
    // Not "a previous run said it was fine", and not the operator's word: the
    // wrapper's own `doctor`, run inside this command, printing named PASS
    // checks. `format:'unrecognized'` is explicitly NOT enough here -- it means
    // the output could not be read, and "could not be read" is the state that
    // produced the false terminal call in the first place.
    if(typeof io.reviewerDoctor!=='function')throw new LaneError(`reviewer reinstatement cannot probe ${approved.wrapper}: this io has no reviewerDoctor. Nothing was proved, and an exclusion is never lifted on unproved evidence.`)
    const doctor=io.reviewerDoctor(approved.wrapper)
    if(!doctor?.ok){
      const checks=(doctor?.failingChecks??[]).map((c)=>`"${c}"`).join(', ')||'an unnamed check'
      throw new LaneError(`reviewer reinstatement refused: ${approved.wrapper} doctor reports ${checks}. The terminal-unavailable exclusion stands.`)
    }
    if(doctor.format!=='checks')throw new LaneError(`reviewer reinstatement refused: ${approved.wrapper} doctor produced no readable PASS check (format ${doctor.format??'unknown'}). Unreadable output is not proof that the provider works.`)
    const proof=String(doctor.output??'').trim()
    const passedChecks=countDoctorPassLines(proof)
    if(!proof||!passedChecks)throw new LaneError(`reviewer reinstatement refused: ${approved.wrapper} doctor returned no quotable PASS line to record as evidence`)
    const digest=createHash('sha256').update(proof,'utf8').digest('hex')
    const message=`db-coordination reviewer-reinstatement reviewer=${reviewer} issue=${issue} pr=${pr} exclusion=${String(exclusionSha).toLowerCase()} reason=${exclusion.reason} wrapper=${approved.wrapper} proof=sha256:${digest} checks=${passedChecks}\n\n${proof}`
    const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-reinstatement-lock issue=${issue} pr=${pr} reviewer=${reviewer}`)
    requireReviewWireCapacity(REVIEW_MUTEX_SECTION_RESERVE);acquireReviewMutex(ownerSha,io)
    try{
      if(io.readRef(ref))throw new LaneError(`reviewer ${reviewer} was reinstated concurrently; retry to inspect the durable record`)
      // Parented on the exclusion commit so the record it answers stays
      // reachable and the pair reads as one chain. Test doubles without the
      // parented-commit maker fall back to the ordinary owner commit.
      const sha=(io.makeReviewVerdictCommit??io.makeOwnerCommit).call(io,message,exclusionSha)
      if(io.atomicReviewRefs){
        io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},{ref,expected:null,sha}])
        const after=io.readReviewRefs([MUTEX_REF,ref,exclusionRef])
        if(after.get(MUTEX_REF)!==ownerSha||after.get(ref)!==sha)throw new LaneError('atomic reviewer reinstatement readback mismatch')
        // The original exclusion MUST still be exactly where it was. This
        // command adds a record; it never removes one.
        if(after.get(exclusionRef)!==exclusionSha)throw new LaneError('reviewer reinstatement must leave the original exclusion record untouched')
      }
      else{
        if(!io.createRef(ref,sha)&&readRefAfterWrite(ref,sha,io)!==sha)throw new LaneError('reviewer reinstatement record could not be proved')
        // The non-atomic path gets the SAME proof the atomic one gets: the
        // original exclusion is read back and must still be exactly where it
        // was (#2224 review 2, Low). Create-only is not by itself evidence
        // that nothing else moved.
        if(io.readRef(exclusionRef)!==exclusionSha)throw new LaneError('reviewer reinstatement must leave the original exclusion record untouched')
      }
      return {issue,pr,reviewer,reason:exclusion.reason,wrapper:approved.wrapper,exclusionRef,exclusionSha,generation,ref,sha,proofDigest:digest,passedChecks,proof,repeat:false}
    }
    finally{finalizeReviewMutex(ownerSha,io)}
  })
}

// A RETURN IS THE AUDIT TRAIL FOR AN ASSIGNMENT THAT WAS NEVER REVIEWED.
//
// Excluding a reviewer that already held this head's assignment used to strand
// the pull request permanently. The exclusion released the provider's lease but
// left the per-head assignment ref naming the now-excluded reviewer, so every
// later --assign-reviewer refused with "it was not returned or re-leased" while
// assertDurableReviewApproval kept demanding an APPROVE for a slot no eligible
// reviewer could ever be drawn into. --replace-failed-reviewer is not the way
// out: it requires a TERMINAL_FAILURE_CODES value, and a reviewer excluded for
// independence did not fail. Nothing else could return the slot.
//
// The return record is the missing half of the exclusion, not a relaxation of
// it. The excluded reviewer stays excluded forever; only the SLOT comes back.
// The record is create-only, named for the exact assignment it retires, and its
// commit is parented on that assignment commit so the retired assignment object
// stays reachable after its ref is compare-and-cleared. The assignment is never
// silently dropped: the record keeps who was assigned, to which head and slot,
// which assignment SHA it retires, and why it came back.
export function parseReviewReturn(commit){
  if(!commit)return null
  const message=commit.message??commit.commit?.message??''
  // `replacement=` is OPTIONAL and carries the replacement sequence of the
  // assignment being retired, or is absent for an original (sequence-less)
  // assignment. It is recorded because a slot's history is ORDERED: without it,
  // `assertDurableReviewApproval` cannot tell "the returned record is older than
  // the live one" from "the live record is the stale original the returned
  // replacement had already superseded", and the second case must fail closed.
  // `sequence=` is the retired assignment's GLOBALLY MONOTONE cursor sequence,
  // and it is what makes a returned slot answerable again. The replacement
  // sequence alone could not: an original assignment has none, so a re-drawn
  // original always compared as 0 and a slot whose replacement had been returned
  // stayed red forever, even after a fresh reviewer approved the new assignment
  // (grok-4.6 REVISE, high finding 2). It is optional only so that a record
  // written before this change still parses; such a record is ordered by reading
  // the retired assignment commit instead.
  const match=/^db-coordination reviewer-return reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{40}) slot=(\d+) assignment=([0-9a-f]{40})(?: sequence=(\d+))?(?: replacement=(\d+))? reason=([a-z-]+)$/i.exec(message)
  if(!match||!REVIEWERS.some((row)=>row.name===match[1])||!REVIEW_EXCLUSION_REASONS.has(match[9])||Number(match[5])<1||(match[7]!==undefined&&Number(match[7])<1)||(match[8]!==undefined&&Number(match[8])<1))throw new LaneError('reviewer return is malformed')
  return {reviewer:match[1],issue:Number(match[2]),pr:Number(match[3]),headSha:match[4].toLowerCase(),slot:Number(match[5]),assignmentSha:match[6].toLowerCase(),sequence:match[7]===undefined?null:Number(match[7]),replacementSequence:match[8]===undefined?null:Number(match[8]),reason:match[9]}
}

// THE REF NAME IS THE AUTHORITY ON SLOT AND SEQUENCE.
//
// A commit message is written by whichever command created it, and the
// replacement writer did not state a slot at all before PR #2077. The REF, by
// contrast, is constructed from the request in every writer and is what the
// merge gate, the verdict namespace, and the return namespace are all keyed on.
// So slot, head and replacement sequence are read from the ref here, once, and
// every caller shares this one parser rather than repeating the pattern.
export function parseAssignmentRef(ref){
  const match=/^refs\/db-review-(assignments|replacements)\/(\d+)-(\d+)-([0-9a-f]{40})(?:-slot(\d+))?(?:-(\d+))?$/.exec(String(ref??''))
  if(!match||(match[1]==='replacements')!==Boolean(match[6]))return null
  const slot=Number(match[5]??1)
  if(!Number.isInteger(slot)||slot<1)return null
  return {replacement:match[1]==='replacements',issue:Number(match[2]),pr:Number(match[3]),headSha:match[4],slot,replacementSequence:match[6]?Number(match[6]):null}
}

export function reviewReturnRef({issue,pr,headSha,slot,assignmentSha}){
  return `${REVIEW_RETURN_REF_PREFIX}/${Number(issue)}-${Number(pr)}-${String(headSha).toLowerCase()}${reviewSlotSuffix(slot)}-${String(assignmentSha).toLowerCase()}`
}

// Every assignment SHA durably returned for this exact head. The ref name
// carries the retired assignment SHA, but the COMMIT is what is trusted here: a
// ref name is only a label, and this answer decides whether a review slot is
// live work or superseded history. Absence of the namespace is absence of any
// return -- this reader never invents one.
export function readReviewReturns(issue,pr,headSha,io=githubIo){
  const head=String(headSha).toLowerCase()
  const rows=io.listRefs?.(`${REVIEW_RETURN_REF_PREFIX}/${Number(issue)}-${Number(pr)}-${head}`)??[]
  return rows.map((row)=>{
    const parsed=parseReviewReturn(row.commit??io.getCommit(row.sha))
    if(parsed.issue!==Number(issue)||parsed.pr!==Number(pr)||parsed.headSha!==head||row.ref!==reviewReturnRef(parsed))throw new LaneError('durable reviewer return does not match its ref identity')
    return {...parsed,ref:row.ref,sha:row.sha}
  })
}

// THE VERDICT RACE LEAVES A PIN, AND THE PIN IS CLEARED HERE.
//
// `recordReviewVerdict` does not take the review mutex. The return's verdict
// scan is re-read inside the mutex at the last possible moment, so a verdict
// that lands after THAT read still slips through. It authorizes nothing -- its
// `assignment_sha` names the retired object, and the merge gate treats the
// returned slot as unapproved regardless. But the create-only verdict ref is
// keyed per {issue, pr, head, slot, replacement sequence}, not per assignment
// SHA, so the raced verdict OCCUPIES the tuple. The re-drawn reviewer then
// cannot record any verdict for this head, and the only escape was a new push
// (grok-4.6 REVISE, medium finding).
//
// So the orphan is retired, not deleted and not ignored: the verdict object is
// moved under its own durable namespace, named for the tuple AND the verdict
// SHA, in one atomic push that compare-and-clears the tuple ref. The audit
// survives -- the object stays reachable under a ref that says exactly which
// retired assignment it answered -- and the head stays reviewable. Anything
// that is not plainly this orphan (a verdict naming some other assignment)
// stops the command for audit rather than being moved.
export function retiredVerdictRef({issue,pr,headSha,slot,replacementSequence,verdictSha}){
  return `${REVIEW_RETIRED_VERDICT_REF_PREFIX}/${Number(issue)}-${Number(pr)}-${String(headSha).toLowerCase()}${reviewSlotSuffix(slot)}${replacementSequence==null?'':`-${Number(replacementSequence)}`}-${String(verdictSha).toLowerCase()}`
}

function retireVerdictsOrphanedByReturn({issue,pr,returns,ownerSha},io){
  if(!returns.length||typeof io.readReviewRefs!=='function')return []
  const refs=returns.map((row)=>verdictRef({issue,pr,headSha:row.headSha,slot:row.slot,replacementSequence:row.replacementSequence}))
  const raced=io.readReviewRefs(refs)
  const orphans=refs.map((ref,index)=>({ref,sha:raced.get(ref)??null,row:returns[index]})).filter((row)=>row.sha)
  if(!orphans.length)return []
  const changes=[{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha}]
  for(const orphan of orphans){
    const record=parseVerdictCommit(io.getCommit(orphan.sha))
    if(String(record.assignment_sha??'').toLowerCase()!==String(orphan.row.sha).toLowerCase())throw new LaneError(`verdict ${orphan.ref} does not answer the assignment this exclusion returned; reviewer exclusion stopped for audit`)
    orphan.retiredRef=retiredVerdictRef({issue,pr,headSha:orphan.row.headSha,slot:orphan.row.slot,replacementSequence:orphan.row.replacementSequence,verdictSha:orphan.sha})
    changes.push({ref:orphan.retiredRef,expected:null,sha:orphan.sha},{ref:orphan.ref,expected:orphan.sha,sha:null})
  }
  io.atomicReviewRefs(changes)
  const after=io.readReviewRefs([MUTEX_REF,...orphans.flatMap((orphan)=>[orphan.retiredRef,orphan.ref])])
  if(after.get(MUTEX_REF)!==ownerSha)throw new LaneError('atomic retired-verdict readback mismatch')
  for(const orphan of orphans)if(after.get(orphan.retiredRef)!==orphan.sha||after.get(orphan.ref)!==null)throw new LaneError('atomic retired-verdict readback mismatch')
  return orphans.map((orphan)=>({ref:orphan.ref,retiredRef:orphan.retiredRef,sha:orphan.sha}))
}

// The rows a reviewer's own durable return records say were handed back, shaped
// exactly like the live rows `excludeReviewerForPr` builds from assignment refs,
// so the retirement below cannot tell -- and does not need to tell -- a first run
// from a repair run. Identity is proved from the commit and then checked against
// the ref name, the same way `readReviewReturns` does it; a ref name is a label,
// never the authority on what was returned.
export function reviewReturnsHeldBy({issue,pr,reviewer,rows},io){
  return (rows??io.listRefs(`${REVIEW_RETURN_REF_PREFIX}/${Number(issue)}-${Number(pr)}-`)??[]).flatMap((row)=>{
    const record=parseReviewReturn(row.commit??io.getCommit(row.sha))
    if(record.issue!==Number(issue)||record.pr!==Number(pr)||row.ref!==reviewReturnRef(record))throw new LaneError('durable reviewer return does not match its ref identity')
    if(record.reviewer!==reviewer)return []
    return [{ref:row.ref,sha:record.assignmentSha,headSha:record.headSha,slot:record.slot,replacementSequence:record.replacementSequence}]
  })
}

// Which of those returned rows still has a verdict sitting on its per-tuple ref.
// This is a READ, taken before the mutex, so a repair run that has nothing to
// retire costs one batched request and never takes the global lock.
function outstandingRetirements(rows,{issue,pr},io){
  if(!rows.length||typeof io.readReviewRefs!=='function')return []
  const refs=rows.map((row)=>verdictRef({issue,pr,headSha:row.headSha,slot:row.slot,replacementSequence:row.replacementSequence}))
  const raced=io.readReviewRefs(refs)
  return rows.filter((row,index)=>Boolean(raced.get(refs[index])))
}

// Which generation does a NEW exclusion belong in, and which one does a
// reinstatement answer? Both questions are read from the durable records only.
// A generation whose own reinstatement ref exists has been lifted, so it no
// longer bars anyone and no longer holds the slot: the walk moves on to the
// next generation. The first generation that is NOT lifted is the live one --
// absent (create it), identical (idempotent no-op), or different (the existing
// refusal). Nothing here deletes or rewrites a record.
function reviewExclusionGenerationRows({issue,pr,reviewer},io,{fresh=false}={}){
  const exclusionRefs=REVIEW_EXCLUSION_GENERATIONS.map((generation)=>reviewExclusionRef({issue,pr,reviewer,generation}))
  const reinstateRefs=REVIEW_EXCLUSION_GENERATIONS.map((generation)=>reviewReinstatementRef({issue,pr,reviewer,generation}))
  // One batched GraphQL read on the production io. Test doubles without it pay
  // two prefix listings, which reviewOperationIo caches, rather than one read
  // per generation.
  const exact=io.readReviewRecords?.([...exclusionRefs,...reinstateRefs],null)
  const listed=exact?null:new Map([...((fresh?io.__freshListRefs(`${REVIEW_EXCLUSION_REF_PREFIX}/${issue}-${pr}-`):io.listRefs(`${REVIEW_EXCLUSION_REF_PREFIX}/${issue}-${pr}-`))??[]),
    ...((fresh?io.__freshListRefs(`${REVIEW_REINSTATEMENT_REF_PREFIX}/${issue}-${pr}-`):io.listRefs(`${REVIEW_REINSTATEMENT_REF_PREFIX}/${issue}-${pr}-`))??[])].map((row)=>[row.ref,row]))
  const shaOf=(ref)=>(exact?exact.get(ref)?.sha:listed.get(ref)?.sha)??null
  const commitOf=(ref,sha)=>(exact?exact.get(ref)?.commit:listed.get(ref)?.commit)??io.getCommit(sha)
  return REVIEW_EXCLUSION_GENERATIONS.map((generation)=>{
    const ref=exclusionRefs[generation-1],sha=shaOf(ref)
    return {generation,ref,sha,commit:sha?commitOf(ref,sha):null,reinstatementRef:reinstateRefs[generation-1],reinstatementSha:shaOf(reinstateRefs[generation-1])}
  })
}

function liveExclusionGeneration({issue,pr,reviewer,reason,evidenceSha},io){
  for(const row of reviewExclusionGenerationRows({issue,pr,reviewer},io)){
    if(!row.sha)return row
    // Lifted: it bars nobody, so it does not hold the slot either.
    if(row.reinstatementSha)continue
    const parsed=parseReviewExclusion(row.commit)
    if(parsed.issue!==issue||parsed.pr!==pr||parsed.reviewer!==reviewer)throw new LaneError('durable reviewer exclusion does not match its ref identity')
    return row
  }
  // Reaching here means every generation exists AND every one was lifted: a live
  // generation returns above, so the loop can only run out on lifted rows. The
  // reviewer is therefore NOT currently excluded -- there is simply no generation
  // left to record a new exclusion in. Saying "every one is live" here would send
  // the caller to fix an exclusion that is not barring anything.
  throw new LaneError(`reviewer ${reviewer} has used all ${REVIEW_EXCLUSION_GENERATION_LIMIT} durable exclusion generations for issue #${issue} PR #${pr} and every one of them has been lifted, so the reviewer is NOT currently excluded and no generation remains in which to record a new exclusion`)
}

export function excludeReviewerForPr({issue,pr,reviewer,reason,evidenceSha},io=githubIo){
  return withReviewRequestBudget(()=>{
    io=reviewOperationIo(io);issue=Number(issue);pr=Number(pr);reviewer=String(reviewer??'');reason=String(reason??'');evidenceSha=String(evidenceSha??'')
    if(!Number.isInteger(issue)||!Number.isInteger(pr)||!REVIEWERS.some((row)=>row.name===reviewer)||!REVIEW_EXCLUSION_REASONS.has(reason)||!/^[0-9a-f]{7,40}$/i.test(evidenceSha))throw new LaneError('reviewer exclusion requires issue, PR, known reviewer, allowed reason, and durable evidence SHA')
    const evidence=parseReviewCursor(io.getCommit(evidenceSha))
    if(evidence.issue!==issue||evidence.pr!==pr||evidence.reviewer!==reviewer)throw new LaneError('reviewer exclusion evidence does not match the issue, PR, and reviewer')
    const assignmentRows=io.listRefs(`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-`)??[]
    const replacementRows=io.listRefs(`${REVIEW_REPLACEMENT_REF_PREFIX}/${issue}-${pr}-`)??[]
    const durable=[...assignmentRows,...replacementRows].some((row)=>row.sha===evidenceSha)
    // A RETURNED assignment is still durable evidence. Its ref was
    // compare-and-cleared when the exclusion returned it, so a second, identical
    // --exclude-reviewer would otherwise stop seeing its own evidence and refuse
    // -- an idempotent command that fails the second time is not idempotent. The
    // return record, matched by ref name and then PROVED by its commit, is what
    // keeps the evidence readable after the assignment ref is gone.
    let returnRowCache=null
    const listReturnRows=()=>returnRowCache??(returnRowCache=io.listRefs(`${REVIEW_RETURN_REF_PREFIX}/${issue}-${pr}-`)??[])
    const returnedEvidence=durable?null:listReturnRows().find((row)=>row.ref.endsWith(`-${evidenceSha.toLowerCase()}`))
    if(returnedEvidence){
      const record=parseReviewReturn(returnedEvidence.commit??io.getCommit(returnedEvidence.sha))
      if(record.issue!==issue||record.pr!==pr||record.reviewer!==reviewer||record.assignmentSha!==evidenceSha.toLowerCase()||returnedEvidence.ref!==reviewReturnRef(record))throw new LaneError('durable reviewer return does not match its ref identity')
    }
    if(!durable&&!returnedEvidence)throw new LaneError('reviewer exclusion evidence is not a durable assignment or replacement record for this pull request')
    // WHAT THE EXCLUDED REVIEWER STILL HOLDS.
    //
    // Releasing the provider's lease frees the PROVIDER; it does not free the
    // SLOT. Any per-head assignment ref of this pull request that still names
    // this reviewer has to come back in the same mutex section as the exclusion,
    // or that slot can never be filled again (see parseReviewReturn above).
    //
    // The scan is bounded by the heads of ONE pull request, and both reads are
    // batched into a single request each where the io supports it, so the
    // pre-mutex spend this adds is +2 and does not grow with head count. Test
    // doubles without the batched readers fall back to per-ref reads.
    // BOTH namespaces are scanned. A replacement ref names its reviewer exactly
    // the way an original assignment ref does, and `--assign-reviewer` reads the
    // replacement namespace FIRST, so a replacement left naming an excluded
    // reviewer strands the pull request in precisely the same way the original
    // assignment did (issue #1999). Returning only originals would have fixed
    // half of one defect.
    // Every row is named by parseAssignmentRef, so slot and replacement sequence
    // come from the REF. Reading them from the commit is what charged a slot-2
    // replacement return to slot 1 (grok-4.6 REVISE, high finding 1): a
    // replacement message has no slot token, so the parse silently answered 1,
    // which then named the return ref, chose which verdict ref was consulted,
    // and told the merge gate which slot had been handed back.
    // A ref this parser cannot name is KEPT here, not filtered away. Dropping it
    // silently was the wrong direction: a reviewer whose only outstanding record
    // was a legacy link with no namespace tail was excluded with no return
    // written for it, which re-creates the stranded slot this whole path exists
    // to repair. The row is carried into the loop instead, and stops the command
    // as soon as its commit turns out to name the reviewer being excluded.
    const scanRows=[...assignmentRows,...replacementRows].map((row)=>({row,named:parseAssignmentRef(row.ref)})).filter(({named})=>named===null||(named.issue===issue&&named.pr===pr))
    const scanRefs=scanRows.map(({row})=>row.ref)
    const scanRecords=scanRefs.length?io.readReviewRecords?.(scanRefs,null):null
    // ONE BATCHED READ FOR EVERY CANDIDATE LEASE NAME (#2694 review, slot 2,
    // medium finding 7). Probing each row's two candidate names with
    // `io.readRef` cost one uncached, budget-charged request PER ROW inside the
    // 25-request reviewer budget, so a pull request with a handful of heads
    // could exhaust the budget before the mutex. `readReviewRefs` answers for
    // the whole set in one request; ios without it fall back to per-ref reads.
    const candidateLeaseRefs=[...new Set(scanRows.flatMap(({row,named})=>{
      if(!named)return []
      let parsed
      try{parsed=parseReviewCursor(scanRecords?.get(row.ref)?.sha===row.sha?scanRecords.get(row.ref).commit:(row.commit??io.getCommit(row.sha)))}catch{return []}
      if(parsed.reviewer!==reviewer)return []
      return reviewLeaseRefCandidates({...parsed,slot:named.slot},Boolean(io.requiresExactReviewHeadSha))
    }))]
    const candidateLeaseShas=candidateLeaseRefs.length&&typeof io.readReviewRefs==='function'?io.readReviewRefs(candidateLeaseRefs):null
    const readLeaseRef=(ref)=>candidateLeaseShas?(candidateLeaseShas.get(ref)??null):io.readRef(ref)
    const held=[]
    for(const {row,named} of scanRows){
      const record=scanRecords?.get(row.ref)
      const parsed=parseReviewCursor(record?.sha===row.sha?record.commit:(row.commit??io.getCommit(row.sha)))
      if(parsed.reviewer!==reviewer||parsed.issue!==issue||parsed.pr!==pr)continue
      if(!named)throw new LaneError(`assignment ${row.ref} cannot be named by the shared ref parser and still holds reviewer ${reviewer}; reviewer exclusion refused rather than excluding a reviewer without returning the slot`)
      // The commit must AGREE with its ref wherever it says anything at all. A
      // disagreement is corruption, not a preference between two answers.
      if(!named.headSha.startsWith(parsed.headSha.toLowerCase()))throw new LaneError(`assignment ${row.ref} names a head its commit does not`)
      if(parsed.slot!==null&&parsed.slot!==named.slot)throw new LaneError(`assignment ${row.ref} names slot ${named.slot} but its commit says slot ${parsed.slot}`)
      // A completed review on an older PR head remains durable evidence, but it
      // is not an outstanding assignment and must not prevent returning this
      // reviewer's separate live exact-head lease.  The old global lease model
      // made these indistinguishable by reviewer name; assignment-keyed leases
      // make the distinction explicit.  Retaining an old approved assignment is
      // mandatory; only the row that still owns its matching active lease may
      // be returned by this exclusion.
      // READ KEY AND WRITE KEY ARE THE SAME OBJECT. The scan used to name only
      // the v2 ref while the release below deleted the one-provider ref, so for
      // an in-flight legacy lease the two never described the same thing: the
      // assignment was skipped as "not outstanding" (no return recorded) and the
      // live legacy lease was dropped anyway, leaving a slot no re-run could
      // return (#2694 review, critical finding 1). Both candidate names are
      // probed here, and whichever one actually holds this assignment SHA is
      // carried on the row and is the one the release deletes.
      const leaseRef=reviewLeaseRefCandidates({...parsed,slot:named.slot},Boolean(io.requiresExactReviewHeadSha)).find((candidate)=>readLeaseRef(candidate)===row.sha)??null
      if(!leaseRef)continue
      held.push({ref:row.ref,sha:row.sha,headSha:named.headSha,slot:named.slot,replacementSequence:named.replacementSequence,sequence:parsed.sequence,leaseRef})
    }
    // A reviewer that already recorded a durable verdict for an assignment
    // FINISHED that work. Returning it would strip the assignment record the
    // verdict artifact is validated against, so refuse outright rather than
    // break the audit chain -- an exclusion is not a way to erase a verdict.
    //
    // The scan is a FUNCTION because it is run twice: once here, so an obviously
    // reviewed assignment is refused before the global mutex is taken, and again
    // INSIDE the mutex immediately before the write. `recordReviewVerdict` does
    // not take the review mutex, so the pre-mutex answer alone is a stale read a
    // concurrent verdict can invalidate; `readReviewRefs` is never memoized, so
    // the second call is a genuinely fresh read at the last possible moment.
    // The verdict ref of a REPLACEMENT assignment lives in its own namespace, so
    // each held record is asked about its own sequence rather than assuming an
    // original.
    const scanOutstanding=()=>{
      const verdictRefs=held.map((row)=>verdictRef({issue,pr,headSha:row.headSha,slot:row.slot,replacementSequence:row.replacementSequence}))
      const verdictShas=verdictRefs.length?(io.readReviewRefs?.(verdictRefs)??new Map(verdictRefs.map((each)=>[each,io.readRef(each)]))):new Map()
      return held.filter((row,index)=>{
        if(!verdictShas.get(verdictRefs[index]))return true
        throw new LaneError(`reviewer ${reviewer} already recorded a durable verdict for issue #${issue} PR #${pr} head ${row.headSha} slot ${row.slot}; a reviewed assignment is never returned`)
      })
    }
    // Returning a slot compare-and-clears a durable assignment ref. On the
    // production io that is one `git push --atomic` with `--force-with-lease` on
    // every expected SHA -- a true compare-and-swap. The non-atomic fallback has
    // no such primitive: its release is compare-THEN-delete, which can retire a
    // ref another writer moved in between, and a partial fallback run leaves the
    // assignment ref naming the excluded reviewer with the return record already
    // created, a state the documented re-run cannot repair. So the return path
    // REFUSES rather than falling back. The exclusion record itself, which
    // creates but never clears, still has a safe fallback below.
    if(held.length&&typeof io.atomicReviewRefs!=='function')throw new LaneError('returning a review slot requires atomic compare-and-swap ref support; reviewer exclusion refused before mutex acquisition')
    // GENERATIONS (#2224 review 2, High): a reinstated exclusion no longer
    // occupies this reviewer's only slot, so a LATER independence exclusion is
    // recorded in the next generation instead of being refused.
    const live=liveExclusionGeneration({issue,pr,reviewer,reason,evidenceSha},io)
    const ref=live.ref,existing=live.sha
    let repeat=null
    if(existing){
      const parsed=parseReviewExclusion(live.commit??io.getCommit(existing))
      if(parsed.issue!==issue||parsed.pr!==pr||parsed.reviewer!==reviewer||parsed.reason!==reason||parsed.evidenceSha!==evidenceSha)throw new LaneError(`reviewer ${reviewer} already has a different durable exclusion for issue #${issue} PR #${pr}`)
      // Idempotent when nothing is left to hand back. When an assignment IS
      // still outstanding this is the repair route for a pull request excluded
      // before returns existed: re-running the IDENTICAL exclusion completes it,
      // with no new exclusion record and no second reason.
      // A RE-RUN MUST BE ABLE TO REACH THE RETIREMENT.
      //
      // The raced-verdict retirement is a SECOND atomic push, made after the one
      // that records the exclusion and its returns. If that second push fails,
      // or the process dies between the two, the exclusion and every return are
      // already durable and every returned assignment ref is already cleared --
      // so a re-run finds nothing held and used to stop on this line, before the
      // retirement could run a second time. The orphaned verdict then held the
      // per-tuple ref for that head with no repair short of a new push, which is
      // the very escape this feature was written to close.
      //
      // So the re-run reconstructs the returned rows from the DURABLE return
      // records this reviewer's own exclusion wrote -- the assignment refs are
      // gone, the records that retired them are not -- and hands them to the same
      // retirement. Nothing new is recorded: if no verdict is still sitting on a
      // returned tuple, the command stays the plain idempotent no-op it was.
      const retryReturns=held.length?[]:outstandingRetirements(reviewReturnsHeldBy({issue,pr,reviewer,rows:listReturnRows()},io),{issue,pr},io)
      if(!held.length&&!retryReturns.length)return {...parsed,ref,sha:existing,returned:[]}
      if(retryReturns.length&&typeof io.atomicReviewRefs!=='function')throw new LaneError('retiring a raced verdict requires atomic compare-and-swap ref support; reviewer exclusion refused before mutex acquisition')
      repeat={...parsed,ref,sha:existing,retryReturns}
    }
    const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-exclusion-lock issue=${issue} pr=${pr} reviewer=${reviewer}`)
    requireReviewWireCapacity(REVIEW_MUTEX_SECTION_RESERVE);acquireReviewMutex(ownerSha,io)
    try{
      if(!repeat&&io.readRef(ref))throw new LaneError(`reviewer ${reviewer} was excluded concurrently; retry to inspect the durable record`)
      const sha=repeat?repeat.sha:io.makeOwnerCommit(`db-coordination reviewer-exclusion reviewer=${reviewer} issue=${issue} pr=${pr} reason=${reason} evidence=${evidenceSha}`)
      // One create-only return record per outstanding assignment, each parented
      // on the assignment commit it retires so that commit stays reachable once
      // its ref is compare-and-cleared. `makeReviewVerdictCommit` is the
      // existing parented-commit maker; test doubles without it fall back to the
      // ordinary owner commit, which keeps the message but not the parent.
      // FRESH, inside the mutex, at the last moment before the write: this is
      // the authoritative answer to "did this reviewer already deliver a
      // verdict", and the only one the return is allowed to act on.
      const returns=scanOutstanding().map((row)=>({...row,
        returnRef:reviewReturnRef({issue,pr,headSha:row.headSha,slot:row.slot,assignmentSha:row.sha}),
        returnSha:(io.makeReviewVerdictCommit??io.makeOwnerCommit).call(io,`db-coordination reviewer-return reviewer=${reviewer} issue=${issue} pr=${pr} head=${row.headSha} slot=${row.slot} assignment=${row.sha} sequence=${row.sequence}${row.replacementSequence===null?'':` replacement=${row.replacementSequence}`} reason=${reason}`,row.sha)}))
      // Each returned assignment releases ITS OWN lease ref -- the one the scan
      // proved holds that assignment SHA, legacy or v2. Deleting only the
      // one-provider name left a post-cutover v2 lease alive after its
      // assignment was returned, so the slot was both taken and un-redrawable
      // (#2694 review, high finding 3).
      const leaseReleases=new Map()
      // One batched read for every lease ref this exclusion might release,
      // rather than one charged request each (#2694 review, slot 2, medium 7).
      const legacyLeaseRef=reviewActiveRef(reviewer)
      const releaseCandidateRefs=[...new Set([...returns.map((row)=>row.leaseRef).filter(Boolean),legacyLeaseRef])]
      const releaseCandidateShas=typeof io.readReviewRefs==='function'?io.readReviewRefs(releaseCandidateRefs):new Map(releaseCandidateRefs.map((each)=>[each,io.readRef(each)]))
      const readReleaseCandidate=(each)=>releaseCandidateShas.get(each)??null
      for(const row of returns)if(row.leaseRef&&readReleaseCandidate(row.leaseRef)===row.sha)leaseReleases.set(row.leaseRef,row.sha)
      // An orphan one-provider lease sitting at the exclusion evidence SHA with
      // no outstanding assignment behind it is still released, exactly as before.
      const legacyLeaseSha=readReleaseCandidate(legacyLeaseRef)
      if(legacyLeaseSha&&legacyLeaseSha===evidenceSha&&!leaseReleases.has(legacyLeaseRef))leaseReleases.set(legacyLeaseRef,legacyLeaseSha)
      const leaseReleaseRows=[...leaseReleases].map(([ref,sha])=>({ref,sha}))
      const releaseLease=leaseReleaseRows.length>0
      if(io.atomicReviewRefs){
        io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},...(repeat?[]:[{ref,expected:null,sha}]),
          // Create the return BEFORE clearing the assignment, in the same atomic
          // push: either the audit record and the retirement both land, or
          // neither does. There is no window where the assignment ref is gone
          // and nothing records why.
          ...returns.flatMap((row)=>[{ref:row.returnRef,expected:null,sha:row.returnSha},{ref:row.ref,expected:row.sha,sha:null}]),
          ...leaseReleaseRows.map((row)=>({ref:row.ref,expected:row.sha,sha:null}))])
        const after=io.readReviewRefs([MUTEX_REF,ref,...returns.flatMap((row)=>[row.returnRef,row.ref]),...leaseReleaseRows.map((row)=>row.ref)])
        if(after.get(MUTEX_REF)!==ownerSha||after.get(ref)!==sha||leaseReleaseRows.some((row)=>after.get(row.ref)!==null))throw new LaneError('atomic reviewer exclusion readback mismatch')
        for(const row of returns)if(after.get(row.returnRef)!==row.returnSha||after.get(row.ref)!==null)throw new LaneError('atomic reviewer return readback mismatch')
        retireVerdictsOrphanedByReturn({issue,pr,returns:[...returns,...(repeat?.retryReturns??[])],ownerSha},io)
      }
      else{
        // Unreachable for a return: the pre-mutex guard above already refused
        // this io when anything was held. Kept as a hard stop so no later edit
        // can quietly reintroduce a non-compare-and-swap retirement.
        if(returns.length)throw new LaneError('returning a review slot requires atomic compare-and-swap ref support')
        if(!repeat&&!io.createRef(ref,sha)&&readRefAfterWrite(ref,sha,io)!==sha)throw new LaneError('reviewer exclusion record could not be proved')
        for(const row of leaseReleaseRows)releaseOwnedRef(row.ref,row.sha,io)
      }
      return {issue,pr,reviewer,reason,evidenceSha,ref,sha,releasedLease:releaseLease,
        returned:returns.map((row)=>({assignmentRef:row.ref,assignmentSha:row.sha,headSha:row.headSha,slot:row.slot,replacementSequence:row.replacementSequence,ref:row.returnRef,sha:row.returnSha}))}
    }
    finally{finalizeReviewMutex(ownerSha,io)}
  })
}

function reviewOperationIo(io){
  if(io?.__reviewOperation)return io
  const quota=typeof io.getRateLimit==='function'?io.getRateLimit():{remaining:5000,graphRemaining:5000,reset:0,graphReset:0}
  if(!quota||!Number.isFinite(Number(quota.remaining)))throw new LaneError('GitHub quota is unreadable; reviewer assignment refused before mutex acquisition')
  if(!Number.isFinite(Number(quota.graphRemaining)))throw new LaneError('GitHub GraphQL quota is unreadable; reviewer assignment refused before mutex acquisition')
  const operationLimit=reviewWireBudget?.limit??REVIEW_OPERATION_REQUEST_LIMIT
  if(Number(quota.remaining)<REVIEW_QUOTA_RESERVE+operationLimit){
    const reset=new Date(Number(quota.reset)*1000).toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'})
    throw new LaneError(`GitHub quota is too low (${quota.remaining} remaining); reviewer assignment refused before mutex acquisition. Reset: ${reset}`)
  }
  if(Number(quota.graphRemaining)<REVIEW_QUOTA_RESERVE+operationLimit){
    const reset=new Date(Number(quota.graphReset)*1000).toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'})
    throw new LaneError(`GitHub GraphQL quota is too low (${quota.graphRemaining} remaining); reviewer assignment refused before mutex acquisition. Reset: ${reset}`)
  }
  const cache=new Map()
  const proxy=new Proxy(io,{get(target,key){
    if(key==='__reviewOperation')return true
    if(key==='__cacheRef')return (ref,sha)=>cache.set(`readRef:${JSON.stringify([ref])}`,sha)
    if(key==='__freshListRefs')return (...args)=>target.listRefs(...args)
    if(key==='__freshGetPr')return (...args)=>target.getPr(...args)
    // Uncached durable-verdict listing for the post-mutex re-check. It must not
    // answer from the pre-mutex snapshot: the point of the recheck is that a
    // verdict may have landed while the mutex was being acquired.
    if(key==='__freshDurableVerdictRefs')return ()=>readDurableVerdictRefs(target)
    const value=target[key]
    if(typeof value!=='function')return value
    return (...args)=>{
      const cacheable=['listRefs','listReviewRefsPaged','getCommit','getPr','getIssue','getIssueComments','getPrReviews'].includes(key)
      const cacheKey=cacheable?`${String(key)}:${JSON.stringify(args)}`:null
      if(cacheable&&cache.has(cacheKey))return cache.get(cacheKey)
      const result=value.apply(target,args)
      if(cacheable)cache.set(cacheKey,result)
      if(['createRef','updateRef','deleteRef'].includes(key))cache.delete(`readRef:${JSON.stringify([args[0]])}`)
      return result
    }
  }})
  return proxy
}

function finalizeReviewMutex(ownerSha,io){
  const previous=reviewWireBudget?.cleanup
  if(reviewWireBudget)reviewWireBudget.cleanup=true
  try{
    if(io.atomicReviewMutexRelease){
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      io.atomicReviewMutexRelease(ownerSha)
      if(io.readReviewRefs([MUTEX_REF]).get(MUTEX_REF)!==null)throw new LaneError(`release of ${MUTEX_REF} could not be proved after atomic deletion`)
      return true
    }
    return releaseOwnedRef(MUTEX_REF,ownerSha,io)
  }catch(error){throw new LaneError(`${error.message}; RECOVERY REQUIRED: ${MUTEX_REF} expected SHA ${ownerSha}. Use the guarded recover-author-mutex.yml procedure and do not retry blindly`)}
  finally{if(reviewWireBudget)reviewWireBudget.cleanup=previous}
}
function requireReviewWireCapacity(required,when='refused before mutex acquisition'){const limit=reviewWireBudget?.limit??REVIEW_OPERATION_REQUEST_LIMIT;if(reviewWireBudget&&reviewWireBudget.count+required>limit)throw new LaneError(`reviewer operation cannot fit ${required} remaining requests inside the ${limit}-request budget; ${when}`)}
function acquireReviewMutex(ownerSha,io){
  if(reviewWireBudget){reviewWireBudget.cleanupReserve=io.atomicReviewMutexRelease?2:8;reviewWireBudget.locked=true}
  let acquired
  try{acquired=io.createRef(MUTEX_REF,ownerSha)}
  catch(error){
    const previous=reviewWireBudget?.cleanup
    if(reviewWireBudget)reviewWireBudget.cleanup=true
    try{
      const actual=io.readRef(MUTEX_REF)
      if(actual===ownerSha)finalizeReviewMutex(ownerSha,io)
    }catch(cleanup){throw new LaneError(`${error.message}; ${cleanup.message}; RECOVERY REQUIRED: ${MUTEX_REF} expected SHA ${ownerSha}. Use the guarded recover-author-mutex.yml procedure`)}
    finally{if(reviewWireBudget)reviewWireBudget.cleanup=previous}
    throw error
  }
  if(!acquired)throw new LaneError(`${MUTEX_REF} is occupied`)
  try{
    const proof=io.readReviewRefs?.([MUTEX_RECOVERY_ACTIVE_REF,MUTEX_REF])
    const recovery=proof?proof.get(MUTEX_RECOVERY_ACTIVE_REF):io.readRef(MUTEX_RECOVERY_ACTIVE_REF)
    let owner=proof?proof.get(MUTEX_REF):null
    if(owner===null)owner=readRefAfterWrite(MUTEX_REF,ownerSha,io)
    if(recovery||owner!==ownerSha)throw new LaneError(recovery?'author mutex recovery is active; retry after it finishes':'author mutex ownership could not be proved after acquisition')
  }catch(error){
    const previous=reviewWireBudget?.cleanup
    if(reviewWireBudget)reviewWireBudget.cleanup=true
    try{finalizeReviewMutex(ownerSha,io)}
    catch(cleanup){throw new LaneError(`${error.message}; ${cleanup.message}; RECOVERY REQUIRED: ${MUTEX_REF} expected SHA ${ownerSha}. Use the guarded recover-author-mutex.yml procedure`)}
    finally{if(reviewWireBudget)reviewWireBudget.cleanup=previous}
    throw error
  }
}

// A reviewer assignment is filed under issue + PR + THE EXACT HEAD IT REVIEWS.
// That head is not decoration: a verdict is only ever valid for the commit the
// reviewer actually read, so collapsing the key to issue + PR would let one
// reviewer's verdict silently cover code they never saw. The key stays.
//
// What was broken is FINDABILITY. Nothing indexed the assignments of a pull
// request, so once a push moved the head, a perfectly good record became
// invisible and the tool reported it "missing" -- sending people to hunt a
// data-loss bug that did not exist (issue #1351, sequence 243 on PR #1347).
// This lookup makes every assignment for a PR findable under any head, so the
// tool can say what IS recorded instead of claiming nothing is.
export function findPrReviewAssignments(issue,pr,io){
  if(typeof io.listRefs!=='function')return null
  const prefix=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${Number(issue)}-${Number(pr)}-`
  return (io.listRefs(prefix)??[])
    .map((row)=>({...parseReviewCursor(io.getCommit(row.sha)),ref:row.ref,assignmentSha:row.sha}))
    .filter((row)=>row.issue===Number(issue)&&row.pr===Number(pr))
    .sort((a,b)=>b.sequence-a.sequence)
}

// WHAT COUNTS AS A RECORDED VERDICT (issue #1822).
//
// This predicate was never a function. "Tied to the head AND contains a verdict
// word anywhere in the body" was written out longhand at EIGHT separate sites in
// this file, so there was no single place where it could be wrong and no single
// place where it could be fixed.
//
// A NINTH site, `previewGateProof`, is a VARIANT of the same defect rather than
// a ninth copy: it tests `\bAPPROVE\b` only, and adds a bundle/assignment
// clause. It is called out explicitly because a mechanical find-and-replace
// across "nine identical sites" would silently mangle it -- and it is the one
// that fails open.
//
// The old reading matched a verdict word ANYWHERE in the body. Ordinary prose
// that discusses reviewing, in a comment that also quotes the head, therefore
// read as a recorded verdict. That is not hypothetical: PR #1818 -- the change
// that enforces exact-head approval at the merge gate -- locked itself out of
// its own governed reviewer assignment with two of its own progress notes, one
// containing "approve something else entirely" and one containing "ride along
// with any REVISE findings". Its own patch for this behaviour lived in a file
// the assignment gate does not read. Those two bodies are in the test suite
// verbatim, because a test on a synthetic string would be a test of a different
// program.
//
// THE RULE: a verdict word must OPEN its line, after leading markdown emphasis
// and blockquote markers are stripped, optionally behind the `VERDICT:` label
// the reviewer wrappers actually emit. That is how a wrapper states a verdict
// and is not how anyone writes a status update.
//
// IT IS SYMMETRIC, AND THE SYMMETRY IS THE POINT. Eight of the nine sites fail
// CLOSED -- a phantom verdict blocks an assignment, which is safe and merely
// baffling. The ninth, `previewGateProof`, fails OPEN: it treats a matching body
// as an independent APPROVE and lets a migration through. Under the old reading
// a comment that quoted the head and merely mentioned approval satisfied it --
// including a sentence stating that an approval was ABSENT. Fixing only the
// refusal direction would leave the repository strict about blocking and loose
// about authorizing, which is the worst available asymmetry and would look like
// an improvement.
// The label strip removes ONLY the `VERDICT:` label itself. It must never be
// widened to skip arbitrary leading words: a strip that swallowed them would
// read `VERDICT: DO NOT APPROVE` as an approval, turning the plainest possible
// refusal into the strongest possible authorization. Pinned by test.
// REJECT is a real verdict word in this repository's reviewer wrappers alongside
// REVISE, and REQUEST_CHANGES is GitHub's own.
//
// `APPROVE WITH CONDITIONS` is a REFUSAL WITH A REMEDY, not an approval. Accepting
// it would merge before the conditions are met AND leave a durable record saying
// the reviewer approved -- the damage and the evidence of no damage in one act.
//
// The lookahead sits on the APPROVAL pattern ONLY, deliberately. Adding it to the
// refusal pattern too would make the conditional verdict count as a recorded
// refusal, which LOCKS the head: the reviewer could then never clear their own
// conditions, because a later unconditional APPROVE at that same head would be
// refused as "a verdict already exists". So it must be neither an approval nor a
// refusal -- it withholds the decision rather than recording one. Both halves are
// asserted in the same test, because "does not approve" and "does not lock" are
// two separate claims and only the first is obvious.
export function verdictOpensLine(body,pattern){
  return sharedVerdictOpensLine(body,pattern)
}
// Structured GitHub review states are data, not prose, so they are trusted as
// they always were -- the opening-line rule governs free text only.
const reviewState=(row)=>String(row?.state??'').toUpperCase()
export function evidenceTiedToHead(row,headSha){
  return sharedEvidenceTiedToHead(row,headSha)
}
// An APPROVE for this head. Used by the fail-OPEN preview gate.
export function isApprovalFor(row,headSha){
  return sharedIsApprovalFor(row,headSha)
}
// Any decision for this head -- approval or refusal. Used by the fail-CLOSED
// assignment, replacement and lease guards.
export function isVerdictFor(row,headSha){
  return sharedIsVerdictFor(row,headSha)
}
export const anyVerdictFor=sharedAnyVerdictFor
// The executable predicate lives in lib/review-verdict.mjs and is shared with
// the exact-head merge gate. These compatibility exports keep existing callers
// stable while preventing another local regex implementation from drifting.
// Free-text evidence is unauthorized by default; only repository-authorized
// GitHub associations retain the reviewer-verdict capability.

// The fail-OPEN preview gate's authorization decision, extracted so it can be
// executed by a test. `previewGateProof` itself shells out to `gh` on its first
// two lines, so every test in this repo replaces the whole method with a stub
// that returns success -- which left the one decision here that can AUTHORIZE A
// MIGRATION completely uncovered.
//
// `readAssignments` is a THUNK on purpose. At the call site it performs network
// reads, and it sits inside the `some()` short-circuit so it only runs for
// evidence that already carries an approval and lacks the bundle id. Hoisting it
// to a plain argument would call it on every gate evaluation and raise the wire
// budget this repo treats as significant.
export function gateAuthorizes(evidence,headSha,bundleId,readAssignments){
  return (evidence??[]).some((row)=>isApprovalFor(row,headSha)&&(
    String(row?.body??'').includes(bundleId)||
    (readAssignments?.()??[]).some((assignment)=>assignment?.headSha===headSha)))
}

// A VERDICT IS AN ARTIFACT, NEVER A SENTENCE (issue #2075).
//
// This predicate used to be "an issue comment, a PR comment, or a PR review tied
// to this head contains a decision word". That made every lane decision -- lease
// liveness, the busy probe, the capacity report, assignment, replacement and
// release -- answerable by PROSE, and in particular by the governed-review
// runner's own findings comment in the window before its create-only artifact
// was recorded. Issue #2075 is exactly that: a findings comment whose verdict
// line was posted, whose artifact was never written, and whose pull request then
// deadlocked in BOTH directions -- the lease looked finished, so replacement and
// release were refused, while no artifact existed to authorize anything.
//
// The only thing that records a verdict is `recordReviewVerdict`, and the only
// thing it produces is a create-only ref under refs/db-review-verdicts/ or
// refs/db-review-verdict-replacements/. So that is what is read here. Comment
// text remains evidence for a human; it is no longer an input to any decision.
//
// ONE REQUEST, NOT ONE PER LEASE. `git/matching-refs` is a plain string-prefix
// match (measured 2026-08-30, see check-exact-head-approval.mjs), and both
// namespaces share the prefix `refs/db-review-verdict`, so a single listing
// answers for every (issue, pr, head) tuple an operation asks about and
// `reviewOperationIo` caches it for the rest of that operation.
export const DURABLE_VERDICT_REF_NAMESPACE = 'refs/db-review-verdict'
function readDurableVerdictRefs(io){
  // `listReviewRefsPaged` reads the whole namespace in one request and REFUSES
  // past REVIEW_REF_ROW_LIMIT rather than returning a partial list; plain `listRefs`
  // refuses at 100 rows inside a wire budget. Either refusal is loud, and loud is
  // the only safe failure here: a silently short list reads as "no verdict",
  // which is the fail-OPEN direction for release and replacement.
  const reader=typeof io?.listReviewRefsPaged==='function'?io.listReviewRefsPaged.bind(io):(typeof io?.listRefs==='function'?io.listRefs.bind(io):null)
  if(!reader)throw new LaneError('durable reviewer verdict refs are unreadable; a verdict can only be proved by its create-only artifact, never by comment text')
  const rows=reader(DURABLE_VERDICT_REF_NAMESPACE)
  if(!Array.isArray(rows))throw new LaneError('durable reviewer verdict refs are unreadable; a verdict can only be proved by its create-only artifact, never by comment text')
  return rows
}
export function listDurableVerdictRefs(io,{fresh=false}={}){
  if(!fresh)return readDurableVerdictRefs(io)
  if(freshDurableVerdictRefs)return freshDurableVerdictRefs
  const rows=typeof io?.__freshDurableVerdictRefs==='function'?io.__freshDurableVerdictRefs():readDurableVerdictRefs(io)
  if(!Array.isArray(rows))throw new LaneError('durable reviewer verdict refs are unreadable; a verdict can only be proved by its create-only artifact, never by comment text')
  if(reviewWireBudget)freshDurableVerdictRefs=rows
  return rows
}
export function hasVerdictForHead(issue,pr,headSha,io,options={}){
  const head=String(headSha??'').toLowerCase()
  // #2208. `options.slot` is OPTIONAL and narrows the match to one slot's own
  // verdict ref. Omitted (every pre-#2208 caller), this answers "does ANY slot
  // have a durable verdict for this head" -- unchanged from before #2208, and
  // still what a caller that only knows the head (not a specific slot) needs.
  // A caller that IS asking on behalf of one specific slot -- "did MY slot's
  // verdict change", not "did some sibling slot finish" -- must pass its own
  // slot so a sibling slot's unrelated, already-existing verdict cannot be
  // mistaken for this slot's own state changing.
  const slot=options.slot==null?null:Number(options.slot)
  return listDurableVerdictRefs(io,options).some((row)=>{
    const named=parseVerdictRef(row.ref)
    return Boolean(named)&&named.issue===Number(issue)&&named.pr===Number(pr)&&named.headSha===head&&(slot===null||named.slot===slot)
  })
}

// #2079 READ SIDE, REPLACEMENT PATH. `hasVerdictForHead` answers from durable ref
// NAMES only -- deliberately, because that is one listing and no attribution. But
// the replacement path needs attribution: a verdict artifact left by a reviewer
// that cannot open the repository must NOT forbid the replacement that exists to
// re-review that exact slot. So resolve each durable verdict ref at this head back
// to the assignment (or replacement) ref it names, read that record's reviewer,
// and ask `reviewerReadsRepository`.
//
// FAIL CLOSED. Anything unresolvable -- a malformed verdict ref, a missing or
// unreadable assignment record, a name outside the roster -- blocks. Replacement
// is the "un-review this head" direction, so ambiguity must never open it. Comment
// text is not consulted anywhere in here.
function durableVerdictBlocksReplacement(ref,io){
  const named=parseVerdictRef(ref)
  if(!named)return true
  const owningRef=named.replacementSequence===null
    ?`${REVIEW_ASSIGNMENT_REF_PREFIX}/${named.issue}-${named.pr}-${named.headSha}${reviewSlotSuffix(named.slot)}`
    :`${REVIEW_REPLACEMENT_REF_PREFIX}/${named.issue}-${named.pr}-${named.headSha}${reviewSlotSuffix(named.slot)}-${named.replacementSequence}`
  let reviewer=null
  try{
    const sha=io.readRef(owningRef)
    if(sha)reviewer=parseReviewCursor(io.getCommit(sha))?.reviewer??null
  }catch{return true}
  if(!reviewer)return true
  // NOT `reviewerReadsRepository(reviewer)`: that returns false for an unknown
  // name, which would PERMIT replacement on an artifact nobody can attribute.
  // Only a roster row explicitly marked non-reading may be discarded.
  return !reviewerKnownNonReading(reviewer)
}
export function headVerdictBlocksReplacement(issue,pr,headSha,io,options={}){
  const head=String(headSha??'').toLowerCase()
  return listDurableVerdictRefs(io,options).some((row)=>{
    const named=parseVerdictRef(row.ref)
    if(!named||named.issue!==Number(issue)||named.pr!==Number(pr)||named.headSha!==head)return false
    if(options.slot!=null&&named.slot!==Number(options.slot))return false
    return durableVerdictBlocksReplacement(row.ref,io)
  })
}

// A MERGE FROM MAIN DOES NOT VOID AN APPROVAL (orchestrator marker #2758). The
// same rule `evaluateApprovalWithRefresh` applies at the merge gate: an APPROVE
// that fully satisfies an earlier head A stands for head B when A is an ancestor
// of B and the pull request's own diff is identical at both (`.agent/` aside).
// A refusal at B, or at any content-identical earlier head, still blocks. With no
// `io.contentPreservingRefresh` nothing is carried.
export function assertDurableReviewApproval(issue,pr,headSha,io=githubIo){
  const head=String(headSha).toLowerCase()
  try{return assertExactDurableReviewApproval(issue,pr,head,io)}catch(exactError){
    if(!(exactError instanceof LaneError)||typeof io.contentPreservingRefresh!=='function')throw exactError
    if(/durable reviewer refusal/.test(exactError.message))throw exactError
    // A head with reviewer records of its own (assignment, replacement, return or
    // verdict) is judged on those alone: carrying a prior head's sign-off past
    // them would bypass a slot returned or newly drawn here (muse review, #2780).
    const own=[REVIEW_ASSIGNMENT_REF_PREFIX,REVIEW_REPLACEMENT_REF_PREFIX,REVIEW_RETURN_REF_PREFIX,REVIEW_VERDICT_REF_PREFIX,REVIEW_VERDICT_REPLACEMENT_REF_PREFIX].flatMap((p)=>io.listRefs(`${p}/${Number(issue)}-${Number(pr)}-${head}`)??[])
    if(own.length)throw new LaneError(`${exactError.message}; an APPROVE cannot be carried forward because this head has reviewer records of its own (assignment, return or verdict), so it is judged on those alone`)
    const prefix=(p)=>`${p}/${Number(issue)}-${Number(pr)}-`
    // Prior heads come from verdicts and returns too, not only live assignments:
    // an exclusion clears a refused head's assignment and leaves its verdict,
    // and that refusal must still block (grok review of PR #2780).
    const priors=[...new Set([REVIEW_ASSIGNMENT_REF_PREFIX,REVIEW_REPLACEMENT_REF_PREFIX,REVIEW_RETURN_REF_PREFIX,REVIEW_VERDICT_REF_PREFIX,REVIEW_VERDICT_REPLACEMENT_REF_PREFIX].flatMap((p)=>(io.listRefs(prefix(p))??[]).map(({ref})=>new RegExp(`^${Number(issue)}-${Number(pr)}-([0-9a-f]{40})`).exec(String(ref).slice(p.length+1))?.[1])).filter(Boolean))].filter((sha)=>sha!==head)
    const equivalent=priors.filter((sha)=>io.contentPreservingRefresh(sha,head)?.ok===true)
    for(const sha of equivalent){
      let rows
      try{rows=readReviewVerdicts(issue,pr,sha,io)}catch(error){throw new LaneError(`${exactError.message}; an APPROVE cannot be carried forward because the reviewer records at head ${sha}, whose pull request diff is identical to this head, could not be read: ${error?.message??error}`)}
      if(rows.some((row)=>row.verdict!=='APPROVE'))throw new LaneError(`${exactError.message}; an APPROVE cannot be carried forward because head ${sha}, whose pull request diff is identical to this head, carries a durable reviewer refusal`)
    }
    for(const sha of equivalent){try{return assertExactDurableReviewApproval(issue,pr,sha,io)}catch(error){if(!(error instanceof LaneError))throw error}}
    throw exactError
  }
}

function assertExactDurableReviewApproval(issue,pr,headSha,io){
  const head=String(headSha).toLowerCase(),allVerdicts=readReviewVerdicts(issue,pr,head,io,{includeDisregarded:true})
  const disregarded=allVerdicts.filter((row)=>row.disregarded),verdicts=allVerdicts.filter((row)=>!row.disregarded)
  // #2079. A verdict recorded before the write-side guard existed, by a reviewer
  // that cannot open the code, is not evidence in either direction: it neither
  // approves nor refuses this head. It is reported, then ignored.
  const disregardedNote=disregarded.length?` (${disregarded.length} durable verdict artifact(s) at this head are DISREGARDED because their reviewer cannot read the repository: ${disregarded.map((row)=>`${row.ref} by ${row.reviewer}`).join(', ')}. Re-review the slot with --replace-failed-reviewer --failure-code reviewer_cannot_read_repository)`:''
  if(verdicts.some((row)=>row.verdict!=='APPROVE'))throw new LaneError('the exact head carries a durable reviewer refusal')
  const assignments=[REVIEW_ASSIGNMENT_REF_PREFIX,REVIEW_REPLACEMENT_REF_PREFIX].flatMap((prefix)=>io.listRefs(`${prefix}/${Number(issue)}-${Number(pr)}-${head}`)).map(({ref,sha})=>{
    const named=parseAssignmentRef(ref)
    if(!named)throw new LaneError(`assignment ref ${ref} is malformed`)
    return{ref,sha,slot:named.slot,replacementSequence:named.replacementSequence}
  })
  // A durably RETURNED assignment is superseded history, not a live slot. The
  // exclusion that returned it also compare-and-cleared its ref, so this filter
  // normally has nothing to do; it is here so a return that raced a re-created
  // ref still cannot resurrect a slot no reviewer holds. It never lets a slot
  // pass without an APPROVE -- it removes the retired assignment entirely, and
  // if every assignment for this head was returned the refusal below fires.
  const returnRecords=readReviewReturns(issue,pr,head,io)
  const returned=new Set(returnRecords.map((row)=>row.assignmentSha))
  const latest=new Map()
  for(const assignment of assignments){if(returned.has(assignment.sha))continue;const prior=latest.get(assignment.slot);if(!prior||Number(assignment.replacementSequence??0)>Number(prior.replacementSequence??0))latest.set(assignment.slot,assignment)}
  if(!latest.size)throw new LaneError('the exact head has no durable reviewer assignment')
  // A RETURNED SLOT IS AN UNAPPROVED SLOT, NEVER A DISAPPEARED ONE.
  //
  // Dropping the retired assignment above is only half the answer. Removing it
  // also removes the SLOT from `latest` whenever nothing has refilled it, and
  // the loop below only demands an APPROVE for slots that are still in the map.
  // With one slot that fails closed at the emptiness refusal above; with two, a
  // returned slot 1 beside an already-approved slot 2 left the gate green while
  // NOBODY had approved slot 1's assignment of this head -- a merge authorized
  // over an unreviewed slot, which is exactly the failure the return was written
  // to prevent. So every slot that was ever returned for this head must still be
  // answered for: it needs a live assignment at least as new as the newest thing
  // returned for it, and that assignment needs its own APPROVE below. A slot
  // whose returned record was a replacement is not satisfied by falling back to
  // the older original the replacement had already superseded.
  //
  // "NEWER" IS THE GLOBAL CURSOR SEQUENCE, NOT THE REPLACEMENT NAMESPACE.
  //
  // The first version of this rule compared `replacementSequence`, treating an
  // original assignment as 0. That closed the hole and opened a worse one: after
  // any replacement for a slot was returned, `--assign-reviewer` recreates the
  // ORIGINAL ref, whose namespace sequence is 0, so `0 < returnedSequence`
  // stayed true forever and the slot could never be answered -- not even by a
  // freshly drawn reviewer who had recorded their own APPROVE (grok-4.6 REVISE,
  // high finding 2). A namespace tail is not a clock. The reviewer cursor IS:
  // every assignment and every replacement spends one strictly increasing
  // sequence from the same durable counter, across both namespaces. So a slot
  // that was returned is answerable by exactly one thing -- a live assignment
  // for the same slot drawn AFTER the returned record was drawn -- which still
  // excludes another slot's APPROVE and still excludes the superseded original
  // the returned replacement had already replaced.
  const cursorSequence=(sha)=>{const parsed=parseReviewCursor(io.getCommit(sha));const value=Number(parsed?.sequence);if(!Number.isInteger(value)||value<1)throw new LaneError(`assignment ${sha} has no readable reviewer sequence`);return value}
  const newestReturned=new Map()
  for(const row of returnRecords){const sequence=row.sequence==null?cursorSequence(row.assignmentSha):Number(row.sequence);if(!(newestReturned.get(row.slot)>=sequence))newestReturned.set(row.slot,sequence)}
  for(const [slot,sequence] of newestReturned){
    const live=latest.get(slot)
    if(!live||cursorSequence(live.sha)<=sequence)throw new LaneError(`review slot ${slot} was durably returned and has no live exact-head assignment newer than the returned one to approve; it cannot be satisfied by another slot, nor by a record the returned one had already superseded. Draw a new reviewer for this exact head and slot (--assign-reviewer when the returned record was the original assignment, --replace-failed-reviewer with the same --failed-sequence when it was a replacement), and that new assignment must record its own APPROVE.`)
  }
  for(const assignment of latest.values())if(!verdicts.some((row)=>row.verdict==='APPROVE'&&row.assignment_sha===assignment.sha))throw new LaneError(`review slot ${assignment.slot} has no durable APPROVE for its latest exact-head assignment${disregardedNote}`)
  return verdicts
}

// #2208 FOLLOW-UP. A lease belongs to ONE review slot. Ask the verdict question
// on behalf of that slot when the lease states which one it is. An old record
// that genuinely does not state a slot stays BUSY: a sibling verdict must never
// reclaim an ambiguous live lease. Slot 0 cannot be written and matches no
// verdict, so it is the fail-closed liveness sentinel.
function leaseVerdictOptions(record,extra={}){
  const slot=record?.slot
  return {...extra,slot:slot==null?0:Number(slot)}
}

function assertReviewLeaseStillStale(row,states,io){
  if(!row)return
  const state=states?.get(`${row.assignment.issue}:${row.assignment.pr}`)
  const verdict=hasVerdictForHead(row.assignment.issue,row.assignment.pr,row.assignment.headSha,io,leaseVerdictOptions(row.assignment,{fresh:true}))
  if(state?.pr?.state==='open'&&state?.pr?.head?.sha===row.assignment.headSha&&!verdict)throw new LaneError(`reviewer ${row.assignment.reviewer} lease became live after mutex acquisition`)
}

function isReviewAssignmentLive(assignment,states,io){
  const state=states?.get(`${assignment.issue}:${assignment.pr}`),pr=state?.pr??io.getPr(assignment.pr)
  const verdict=hasVerdictForHead(assignment.issue,assignment.pr,assignment.headSha,io,leaseVerdictOptions(assignment))
  return pr?.state==='open'&&pr?.head?.sha===assignment.headSha&&!verdict
}

// WHICH REVIEWERS ARE BUSY IN THIS REPOSITORY RIGHT NOW.
//
// The constraint being modelled is real and provider-side: `ai-grok-review`
// holds an in-flight lock PER REPOSITORY, so shared-db can have one live Grok
// review at a time. That is not a global limit -- five repositories with work
// can run five Grok reviews at once, and nothing here tries to coordinate across
// repositories. This function answers only the local question.
//
// A reviewer is busy when it holds a durable assignment whose work is still
// live: the PR is open, its head is still the head that reviewer was given, and
// no verdict has landed for that head. Anything else -- a merged or closed PR, a
// head that moved on, a recorded verdict -- frees the provider.
//
// FAIL OPEN, DELIBERATELY. If the refs cannot be listed, this returns null and
// the caller keeps the ordinary rotation. A busy probe that cannot read GitHub
// must never invent availability.
export function findBusyReviewers(io,requested=[],{keepUnreadableLeases=false}={}){
  if(typeof io.readRef!=='function')return null
  let cutover
  try{cutover=io.readRef(REVIEW_ACTIVE_CUTOVER_REF)}catch{return null}
  if(!cutover)throw new LaneError('active reviewer lease cutover is incomplete; assignment refused')
  const busy=new Set()
  const stale=[]
  let snapshot=null
  // #2694 review (slot 2, high finding 5). A DETERMINATE listing refusal --
  // the reviewer-lease namespace at or past its row ceiling, or newly
  // paginated -- is NOT the transient unreadability this fail-open exists for.
  // Swallowed, it surfaced everywhere as "active reviewer leases are
  // unreadable", which names neither the namespace, the row count, nor the
  // retirement that fixes it, and it stopped every draw, release, replacement,
  // exclusion and capacity report in the repository with no stated cause.
  try{snapshot=typeof io.readActiveReviewLeases==='function'?io.readActiveReviewLeases():null}
  catch(error){
    if(isReviewRefListingRefusal(error))throw new LaneError(`active reviewer lease namespace cannot be listed: ${error.message}`)
    return null
  }
  const records=[]
  const refs=snapshot?[...snapshot.keys()]:[...ACTIVE_REVIEWERS,...OVERFLOW_REVIEWERS].map((reviewer)=>reviewActiveRef(reviewer.name))
  for(const ref of refs){
    let sha
    try{sha=snapshot?snapshot.get(ref)?.sha??null:io.readRef(ref)}catch{return null}
    if(!sha)continue
    let assignment,commit
    try{commit=snapshot?.get(ref)?.commit??io.getCommit(sha);assignment=parseReviewLease(commit)}catch{return null}
    const reviewer=REVIEWERS.find((row)=>row.name===assignment?.reviewer)
    const legacy=reviewer?reviewActiveRef(reviewer.name):null
    const parallel=reviewer&&/^[0-9a-f]{40}$/i.test(assignment.headSha)?reviewLeaseRefForAssignment(assignment,true):null
    if(!reviewer||ref!==legacy&&ref!==parallel||(io.requiresExactReviewHeadSha&&!/^[0-9a-f]{40}$/i.test(assignment.headSha)))return null
    const heldSince=commit?.committedDate??commit?.committer?.date??commit?.commit?.committer?.date??null
    records.push({reviewer,ref,sha,assignment,heldSince})
  }
  let states=null
    try{states=typeof io.readReviewStates==='function'?io.readReviewStates([...records.map((row)=>row.assignment),...requested]):null}catch{return null}
  for(const {reviewer,ref,sha,assignment} of records){
    let prRow
    try{
      const state=states?.get(`${assignment.issue}:${assignment.pr}`)
      prRow=state?.pr??io.getPr(assignment.pr)
    }catch{return null}
    if(prRow?.state!=='open'||prRow?.head?.sha!==assignment.headSha){stale.push({ref,sha,assignment});continue}
    let verdict
    try{verdict=hasVerdictForHead(assignment.issue,assignment.pr,assignment.headSha,io,leaseVerdictOptions(assignment))}catch{
      // Capacity reporting must retain the readable lease row so it can expose
      // the verdict read error on that row. Mutation callers keep the existing
      // fail-closed whole-probe behavior.
      if(!keepUnreadableLeases)return null
      busy.add(assignment.reviewer)
      continue
    }
    if(verdict){stale.push({ref,sha,assignment});continue}
    busy.add(assignment.reviewer)
  }
  Object.defineProperty(busy,'stale',{value:stale,enumerable:false})
  Object.defineProperty(busy,'states',{value:states,enumerable:false})
  const leaseRecords=records.map((row)=>({...row,lease:row.assignment}))
  // `leases` keeps its historical reviewer-keyed compatibility view.  New
  // concurrent-aware paths use `byAssignment`; older release history can keep
  // resolving its legacy one-provider lease unchanged during the cutover.
  Object.defineProperty(busy,'leases',{value:new Map(leaseRecords.map((row)=>[row.lease.reviewer,{sha:row.sha,lease:row.lease,heldSince:row.heldSince,ref:row.ref}])),enumerable:false})
  Object.defineProperty(busy,'byAssignment',{value:new Map(leaseRecords.map((row)=>[reviewLeaseIdentity(row.lease),{sha:row.sha,lease:row.lease,heldSince:row.heldSince,ref:row.ref}])),enumerable:false})
  Object.defineProperty(busy,'byReviewer',{value:new Map([...new Set(leaseRecords.map((row)=>row.lease.reviewer))].map((name)=>[name,leaseRecords.filter((row)=>row.lease.reviewer===name).map((row)=>({sha:row.sha,lease:row.lease,heldSince:row.heldSince,ref:row.ref}))])),enumerable:false})
  Object.defineProperty(busy,'leaseSnapshot',{value:snapshot,enumerable:false})
  return busy
}

export function reviewLeaseAgeHours(heldSince,now=new Date()){
  const start=new Date(heldSince).getTime(),end=new Date(now).getTime()
  if(!heldSince||!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null
  return (end-start)/3_600_000
}

function newestActivityTimestamp(rows,fields){
  let newest=null
  for(const row of rows??[])for(const field of fields){
    const value=row?.[field],time=Date.parse(value??'')
    if(Number.isFinite(time)&&(newest===null||time>newest.time))newest={time,value:new Date(time).toISOString()}
  }
  return newest
}

export function activityFingerprintForLease(lease,io,{freshPr=false}={}){
  if(typeof io?.readLeaseActivity!=='function')throw new LaneError('reviewer activity is unreadable; silence cannot be observed')
  const pr=freshPr&&typeof io.__freshGetPr==='function'?io.__freshGetPr(lease.pr):io.getPr(lease.pr)
  if(!pr?.state||!pr?.head?.sha)throw new LaneError('reviewer PR activity is unreadable; silence cannot be observed')
  const activity=io.readLeaseActivity(lease)
  for(const key of ['issueComments','reviewComments','reviews','checkRuns','workflowRuns'])if(!Array.isArray(activity?.[key]))throw new LaneError(`reviewer ${key} activity is unreadable; silence cannot be observed`)
  const groups=[
    ['issueComments',activity.issueComments,['updated_at','updatedAt','created_at','createdAt']],
    ['reviewComments',activity.reviewComments,['updated_at','updatedAt','created_at','createdAt']],
    ['reviews',activity.reviews,['submitted_at','submittedAt','updated_at','updatedAt','created_at','createdAt']],
    ['checkRuns',activity.checkRuns,['completed_at','completedAt','started_at','startedAt','created_at','createdAt']],
    ['workflowRuns',activity.workflowRuns,['updated_at','updatedAt','created_at','createdAt']],
  ]
  const maxima=groups.map(([name,rows,fields])=>[name,newestActivityTimestamp(rows,fields)])
  const last=maxima.map(([,value])=>value).filter(Boolean).sort((a,b)=>b.time-a.time)[0]??null
  const facts={issue:Number(lease.issue),pr:Number(lease.pr),headSha:String(lease.headSha).toLowerCase(),slot:Number(lease.slot??1),sequence:Number(lease.sequence),prState:String(pr.state).toLowerCase(),currentHead:String(pr.head.sha).toLowerCase(),draft:pr.draft===true,verdictPresent:hasVerdictForHead(lease.issue,lease.pr,lease.headSha,io,leaseVerdictOptions(lease)),activity:Object.fromEntries(maxima.map(([name,value])=>[name,{count:activity[name].length,max:value?.value??null}]))}
  return {fingerprint:createHash('sha256').update(canonicalJson(facts)).digest('hex'),lastActivityIso:last?.value??'none',facts}
}

function silenceProbeRef(request){return `${REVIEW_SILENCE_PROBE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${request.sequence}`}
function silenceReleaseRef(request){return `${REVIEW_SILENCE_RELEASE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${request.sequence}`}
function parseSilenceProbe(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination reviewer-silence-probe reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{40}) sequence=(\d+) slot=(\d+) observed-at=([^ ]+) lease-held-since=([^ ]+) last-activity=([^ ]+) fingerprint=([0-9a-f]{64})$/i.exec(message)
  if(!match)throw new LaneError('reviewer silence probe evidence is unreadable')
  return {reviewer:match[1],issue:Number(match[2]),pr:Number(match[3]),headSha:match[4],sequence:Number(match[5]),slot:Number(match[6]),observedAt:match[7],leaseHeldSince:match[8],lastActivityIso:match[9],fingerprint:match[10].toLowerCase()}
}

function resolveSilentLease(options,io){
  const request={issue:Number(options.issue),pr:Number(options.pr),headSha:String(options.headSha??'').toLowerCase(),sequence:Number(options.failedSequence??options.sequence),slot:Number(options.slot??1)}
  if(!Number.isInteger(request.issue)||!Number.isInteger(request.pr)||!/^[0-9a-f]{40}$/.test(request.headSha)||!Number.isInteger(request.sequence)||!Number.isInteger(request.slot)||request.slot<1)throw new LaneError('silent reviewer operation requires exact issue, PR, 40-character head SHA, sequence, and review slot')
  // Keep the chosen ref and its SHA from the same resolution snapshot. A second
  // read paid twice and could change the chosen lease between identity and contents.
  // This cache is local to this call; the in-mutex call always proves it afresh.
  const refSnapshot=new Map(),resolutionIo={...io,readRef(ref){if(!refSnapshot.has(ref))refSnapshot.set(ref,io.readRef(ref));return refSnapshot.get(ref)}}
  const original=resolveFailedReviewRecord({...request,failedSequence:request.sequence},io),leaseRef=resolveAssignmentLeaseRef({...original,slot:request.slot},Boolean(io.requiresExactReviewHeadSha),resolutionIo),leaseSha=resolutionIo.readRef(leaseRef),leaseCommit=leaseSha?io.getCommit(leaseSha):null,lease=leaseCommit?parseReviewLease(leaseCommit):null
  if(!lease||lease.issue!==request.issue||lease.pr!==request.pr||lease.headSha!==request.headSha||lease.sequence!==request.sequence||lease.slot!==request.slot||lease.reviewer!==original.reviewer)throw new LaneError('silent reviewer active lease does not match the exact durable assignment')
  return {request,original,leaseRef,leaseSha,lease:{...lease,heldSince:leaseCommit?.committedDate??leaseCommit?.committer?.date??leaseCommit?.commit?.committer?.date??null}}
}

function probeSilentReviewerOperation(options,now,io){
  io=reviewOperationIo(io)
  const {request,original,lease}=resolveSilentLease(options,io),probeRef=silenceProbeRef(request)
  if(io.readRef(probeRef))throw new LaneError('reviewer silence probe already exists and is immutable')
  const pr=io.getPr(request.pr)
  if(pr?.state!=='open'||pr?.head?.sha!==request.headSha||hasVerdictForHead(request.issue,request.pr,request.headSha,io,{slot:request.slot}))throw new LaneError('silence probe requires a live lease at the exact open PR head')
  const age=reviewLeaseAgeHours(lease.heldSince,now)
  if(age===null||age<SILENCE_MIN_AGE_HOURS)throw new LaneError(`silence probe requires a lease at least ${SILENCE_MIN_AGE_HOURS} hours old`)
  const heldSince=lease.heldSince
  const observed=activityFingerprintForLease(lease,io)
  if(observed.lastActivityIso!=='none'&&Date.parse(observed.lastActivityIso)>Date.parse(heldSince))throw new LaneError('silence probe refused because reviewer activity occurred after the lease was drawn')
  const message=`db-coordination reviewer-silence-probe reviewer=${original.reviewer} issue=${request.issue} pr=${request.pr} head=${request.headSha} sequence=${request.sequence} slot=${request.slot} observed-at=${new Date(now).toISOString()} lease-held-since=${new Date(heldSince).toISOString()} last-activity=${observed.lastActivityIso} fingerprint=${observed.fingerprint}`
  const sha=io.makeOwnerCommit(message)
  if(!io.createRef(probeRef,sha)||io.readRef(probeRef)!==sha)throw new LaneError('reviewer silence probe create-only write could not be proved')
  return {...request,reviewer:original.reviewer,probeRef,probeSha:sha,...observed}
}

export function probeSilentReviewer(options,now=new Date(),io=githubIo){return withReviewRequestBudget(()=>probeSilentReviewerOperation(options,now,io))}

function reclaimSilentReviewerOperation(options,now,io){
  if(!options.confirmNoVerdict||!options.confirmNoArtifact)throw new LaneError('silent reviewer reclaim requires explicit confirmation that the session produced no verdict and no artifact')
  io=reviewOperationIo(io)
  const {request,original,leaseRef,leaseSha}=resolveSilentLease(options,io),probeRef=silenceProbeRef(request),releaseRef=silenceReleaseRef(request),probeSha=io.readRef(probeRef)
  if(!probeSha)throw new LaneError('silent reviewer reclaim requires an immutable prior silence probe')
  if(io.readRef(releaseRef))throw new LaneError('silent reviewer lease was already reclaimed with immutable evidence')
  const probe=parseSilenceProbe(io.getCommit(probeSha))
  if(probe.issue!==request.issue||probe.pr!==request.pr||probe.headSha!==request.headSha||probe.sequence!==request.sequence||probe.slot!==request.slot||probe.reviewer!==original.reviewer)throw new LaneError('silence probe does not match the exact active lease')
  const probeAge=reviewLeaseAgeHours(probe.observedAt,now)
  if(probeAge===null||probeAge<SILENCE_CONFIRM_HOURS)throw new LaneError(`silent reviewer reclaim requires an unchanged readable probe for at least ${SILENCE_CONFIRM_HOURS} hours`)
  const observed=activityFingerprintForLease({...original,slot:request.slot},io)
  if(observed.fingerprint!==probe.fingerprint)throw new LaneError('silent reviewer reclaim refused because the activity fingerprint changed after the probe')
  if(typeof io.atomicReviewRefs!=='function'||typeof io.readReviewRefs!=='function')throw new LaneError('silent reviewer reclaim requires atomic compare-and-swap ref support')
  const releaseSha=io.makeOwnerCommit(`db-coordination reviewer-silence-release reviewer=${original.reviewer} issue=${request.issue} pr=${request.pr} head=${request.headSha} sequence=${request.sequence} code=silent_worker_observed probe=${probeSha} observed-at=${probe.observedAt} confirmed-at=${new Date(now).toISOString()} verdict=none artifact=none replacement=none`)
  const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-silence-release-lock issue=${request.issue} pr=${request.pr} head=${request.headSha} sequence=${request.sequence}`)
  let acquired=false
  try{
    requireReviewWireCapacity(REVIEW_SILENT_RECLAIM_MUTEX_SECTION_RESERVE)
    acquireReviewMutex(ownerSha,io);acquired=true;requireOwnedRef(MUTEX_REF,ownerSha,io)
    // The fingerprint already reads the PR fresh (`freshPr`) and records its state and
    // head in `facts`. Reading it fresh a second time here cost one request and could
    // never disagree; issue #2697 removed it and the check now uses those facts.
    const current=resolveSilentLease(options,io),fresh=activityFingerprintForLease({...original,slot:request.slot},io,{freshPr:true}),pr={state:fresh.facts.prState,head:{sha:fresh.facts.currentHead}}
    if(current.leaseSha!==leaseSha||pr?.state!=='open'||pr?.head?.sha!==request.headSha||hasVerdictForHead(request.issue,request.pr,request.headSha,io,{fresh:true,slot:request.slot})||fresh.fingerprint!==probe.fingerprint)throw new LaneError('silent reviewer lease or activity changed after mutex acquisition')
    const locked=io.readReviewRefs([MUTEX_REF,releaseRef,leaseRef])
    if(locked.get(MUTEX_REF)!==ownerSha||locked.get(releaseRef)!==null||locked.get(leaseRef)!==leaseSha)throw new LaneError('silent reviewer reclaim ownership changed after preflight')
    io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},{ref:releaseRef,expected:null,sha:releaseSha},{ref:leaseRef,expected:leaseSha,sha:null}])
    const after=io.readReviewRefs([MUTEX_REF,releaseRef,leaseRef])
    if(after.get(MUTEX_REF)!==ownerSha||after.get(releaseRef)!==releaseSha||after.get(leaseRef)!==null)throw new LaneError('atomic silent reviewer reclaim readback mismatch')
    return {...request,reviewer:original.reviewer,probeSha,releaseSha,releasedLeaseSha:leaseSha}
  }finally{if(acquired)finalizeReviewMutex(ownerSha,io)}
}


export function reclaimSilentReviewer(options,now=new Date(),io=githubIo){return withReviewRequestBudget(()=>reclaimSilentReviewerOperation(options,now,io),REVIEW_SILENT_RECLAIM_REQUEST_LIMIT,'reclaim-silent-reviewer')}

function reviewerCapacityReportOperation(io,now){
  const busy=findBusyReviewers(io,[],{keepUnreadableLeases:true})
  if(!busy)throw new LaneError('active reviewer leases are unreadable; reviewer capacity is unknown')
  // #2694 review (slot 2, medium-high finding 6). `busy.leases` is
  // Map(reviewer -> LAST record), so two live jobs for one provider collapsed
  // to one row and the capacity report simply did not show the second. Under
  // assignment-keyed leases a provider legitimately holds several, so the rows
  // are built from the assignment-keyed index: one row per LEASE, and one
  // "free" row for a provider holding none. Stale is likewise keyed by REF, not
  // by provider name.
  const staleByRef=new Map(busy.stale.map((row)=>[row.ref,row]))
  const leasesByReviewer=new Map()
  for(const record of (busy.byAssignment?.values()??[]))leasesByReviewer.set(record.lease.reviewer,[...(leasesByReviewer.get(record.lease.reviewer)??[]),record])
  const rows=ACTIVE_REVIEWERS.flatMap((reviewer)=>{
    const records=leasesByReviewer.get(reviewer.name)??[]
    if(!records.length)return [{reviewer:reviewer.name,held:false,issue:null,pr:null,headSha:null,sequence:null,heldSinceIso:null,ageHours:null,prState:null,headMatches:null,verdictPresent:false,verdictReadError:null,lastActivityIso:null,silenceProbe:null,classification:'free'}]
    return records.map((record)=>{
    const state=busy.states?.get(`${record.lease.issue}:${record.lease.pr}`),pr=state?.pr
    let verdictPresent=false,verdictReadError=null
    try{verdictPresent=hasVerdictForHead(record.lease.issue,record.lease.pr,record.lease.headSha,io,leaseVerdictOptions(record.lease))}catch(error){verdictPresent=null;verdictReadError=String(error?.message??error)}
    const ageHours=reviewLeaseAgeHours(record.heldSince,now)
    let lastActivityIso=null,silenceProbe=null,silenceState=null
    if(typeof io.readLeaseActivity==='function'&&!staleByRef.has(record.ref)){
      try{
        const observed=activityFingerprintForLease(record.lease,io);lastActivityIso=observed.lastActivityIso
        const ref=silenceProbeRef({...record.lease,sequence:record.lease.sequence}),sha=io.readRef(ref)
        if(sha){const probe=parseSilenceProbe(io.getCommit(sha));silenceProbe={observedAt:probe.observedAt,fingerprint:probe.fingerprint,sha};if(observed.fingerprint===probe.fingerprint)silenceState=reviewLeaseAgeHours(probe.observedAt,now)>=SILENCE_CONFIRM_HOURS?'silence-reclaimable':'silence-probed'}
      }catch{silenceState='unknown'}
    }
    let classification
    if(verdictReadError!==null||!state||!pr)classification='unknown'
    else if(staleByRef.has(record.ref))classification='stale-reclaimable'
    else if(silenceState)classification=silenceState
    else if(ageHours===null)classification='unknown'
    else if(ageHours>=REVIEW_LEASE_SUSPECT_HOURS)classification='suspect-aged'
    else classification='live'
    return {reviewer:reviewer.name,held:true,leaseRef:record.ref,issue:record.lease.issue,pr:record.lease.pr,headSha:record.lease.headSha,sequence:record.lease.sequence,heldSinceIso:record.heldSince??null,ageHours:ageHours===null?null:Number(ageHours.toFixed(2)),prState:pr?.state??null,headMatches:pr?pr.head?.sha===record.lease.headSha:null,verdictPresent,verdictReadError,lastActivityIso,silenceProbe,classification}
    })
  })
  let queue=[]
  if(io.enableReviewerQueue)try{queue=liveReviewerQueue(io)}catch{queue=null}
  return {generatedAt:new Date(now).toISOString(),advisorySuspectHours:REVIEW_LEASE_SUSPECT_HOURS,silenceMinAgeHours:SILENCE_MIN_AGE_HOURS,silenceConfirmHours:SILENCE_CONFIRM_HOURS,summary:{total:rows.length,free:rows.filter((row)=>row.classification==='free').length,live:rows.filter((row)=>['live','suspect-aged','silence-probed'].includes(row.classification)).length,reclaimable:rows.filter((row)=>['stale-reclaimable','silence-reclaimable'].includes(row.classification)).length,silenceProbed:rows.filter((row)=>row.classification==='silence-probed').length,silenceReclaimable:rows.filter((row)=>row.classification==='silence-reclaimable').length,unknown:rows.filter((row)=>row.classification==='unknown').length},queue,reviewers:rows}
}

export function reviewerCapacityReport(io=githubIo,now=new Date()){return withReviewRequestBudget(()=>reviewerCapacityReportOperation(reviewOperationIo(io),now),REVIEW_CAPACITY_REQUEST_LIMIT)}

export function describeMovedAssignmentHead(request,recorded){
  return `the durable reviewer assignment is NOT missing: sequence=${recorded.sequence} reviewer=${recorded.reviewer} for issue #${request.issue} PR #${request.pr} is recorded under head ${recorded.headSha}, and this request names head ${request.headSha}. The PR head moved after that reviewer was assigned, so the exact code that reviewer was given is no longer this PR's head. A replacement would bind a new reviewer -- and later a verdict -- to a commit the failed reviewer never saw, so it is refused. Assign a reviewer to the current code instead: --assign-reviewer --issue ${request.issue} --pr ${request.pr} --head-sha <the PR's current head>. Nothing was lost and nothing needs reconstructing.`
}

// PRE-CONCURRENCY SERIAL HELPER -- it has NO production caller in this tree (tests
// only). It treats ANY busy provider as taken, which is the serial-lease rule. The
// live draw path has a concurrent-mode branch (`concurrentLeases`) plus failed-name,
// exclusion and excluded-provider filtering that this helper does not have, so it
// must NOT be reused for a draw without that branch and those filters.
export function pickReviewer(sequence,io){
  const busy=findBusyReviewers(io)
  const {eligible}=allocatableReviewers(io)
  if(!eligible.length)throw new LaneError('no reviewer is independent from the live orchestrator engine')
  const eligibleNames=new Set(eligible.map((row)=>row.name)),start=(sequence-1)%ACTIVE_REVIEWERS.length
  const ordered=Array.from({length:ACTIVE_REVIEWERS.length},(_,offset)=>ACTIVE_REVIEWERS[(start+offset)%ACTIVE_REVIEWERS.length]).filter((row)=>eligibleNames.has(row.name))
  if(!busy)return ordered[0]
  return ordered.find((row)=>!busy.has(row.name))??OVERFLOW_REVIEWERS.find((row)=>!busy.has(row.name))??ordered[0]
}

// Slot 1 keeps the original, unsuffixed ref namespace so every already-recorded
// assignment and replacement stays exactly where it is. Slot 2+ gets a parallel
// namespace under the same tuple.
export function reviewSlotSuffix(slot){return Number(slot)===1?'':`-slot${Number(slot)}`}

// `listRefs` is a PREFIX scan, and slot 1's replacement base is a prefix of
// every higher slot's base (".../9-109-abc" also matches ".../9-109-abc-slot2-516").
// Every replacement listing must therefore be narrowed to the exact namespace it
// asked for, or slot 2's records leak into slot 1's answers -- silently, and with
// the highest sequence winning, which is exactly the cross-slot mutation the
// replacement matcher fails closed to prevent. Links are named `<base>-<failedSequence>`,
// so the remainder after the base is digits and nothing else.
export function inReviewReplacementNamespace(ref,base){
  const rest=String(ref).slice(base.length)
  return String(ref).startsWith(base)&&/^-\d+$/.test(rest)
}

// Resolve the CURRENT reviewer bound to slot 1 for this exact (issue, pr,
// headSha), read-only. Slot 1 may have been replaced after a genuine failure
// (--replace-failed-reviewer --review-slot 1, which touches only slot 1's own
// ref namespace), so a live replacement takes priority over the original
// assignment record -- same precedence assignNextReviewerOperation itself gives
// replacements over a plain assignment. Throws if slot 1 was never assigned:
// slot 2 must never silently invent a first reviewer.
function resolveSlotOneReviewer(issue,pr,headSha,io){
  const slotOneBase=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`
  const slotOneReplacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${issue}-${pr}-${headSha}`
  const missing=()=>new LaneError(`slot 2 requires slot 1 to already be assigned for issue #${issue} PR #${pr} head ${headSha}. Run --assign-reviewer --issue ${issue} --pr ${pr} --head-sha ${headSha} (default --review-slot 1) first, then request --review-slot 2.`)
  // BATCHED (issue #1798 fix). This used to be up to three separate wire
  // requests (listRefs, readRef, getCommit) run BEFORE the mutex is even
  // acquired, on every slot-2 assignment -- which is exactly the preflight
  // cost that pushed slot-2 over its own 19-request budget on real GitHub
  // every time. `readReviewRecords` reads the explicit slot-1 assignment ref
  // AND every slot-1 replacement ref, commit messages included, in one
  // GraphQL round trip. Only test doubles without readReviewRecords fall
  // back to the old three-call path.
  //
  // The `.matching` rows carry NO commit message in production -- that read is
  // a separate REST listing and its own comment says every caller falls back to
  // `io.getCommit(row.sha)`. Omitting that fallback made a real slot-2 request
  // after `--replace-failed-reviewer` throw outright (issue #1798 round 2).
  if(typeof io.readReviewRecords==='function'){
    const records=io.readReviewRecords([slotOneBase],slotOneReplacementBase)
    // `.matching` is a PREFIX listing, and slot 1's replacement base is a prefix
    // of every higher slot's base, so slot 2's records would otherwise leak into
    // slot 1's answer with the highest sequence winning (#1838). Narrow it to the
    // exact namespace, the same way the listRefs fallback below does.
    const replacementRows=(records.matching??[]).filter((row)=>inReviewReplacementNamespace(row.ref,slotOneReplacementBase))
    if(replacementRows.length){
      const replacements=replacementRows.map((row)=>parseReviewReplacement(row.commit??io.getCommit(row.sha)))
      return replacements.sort((a,b)=>b.sequence-a.sequence)[0].reviewer
    }
    const record=records.get(slotOneBase)
    if(!record)throw missing()
    return parseReviewCursor(record.commit??io.getCommit(record.sha)).reviewer
  }
  const replacementRows=(io.listRefs?.(slotOneReplacementBase)??[]).filter((row)=>inReviewReplacementNamespace(row.ref,slotOneReplacementBase))
  if(replacementRows.length){
    const replacements=replacementRows.map((row)=>parseReviewReplacement(row.commit??io.getCommit(row.sha)))
    return replacements.sort((a,b)=>b.sequence-a.sequence)[0].reviewer
  }
  const sha=io.readRef(slotOneBase)
  if(!sha)throw missing()
  return parseReviewCursor(io.getCommit(sha)).reviewer
}

// AGENTS.md section 4 rule 2 is merge-first, so a migration reaching main and only
// THEN owing an exact-head approval is an expected state, not an anomaly (#1817:
// plm.wwe_* merged at 8d3c31a with no approval at that head, and assignment refused
// outright because the pull request was closed). A MERGED pull request whose merge
// commit is really in main is therefore an eligible assignment target.
//
// A closed-but-UNMERGED pull request stays refused: an abandoned branch has no claim
// on a reviewer's time, and nothing downstream will ever consume the verdict. Every
// other guard is unchanged -- the issue must still be open, the exact head SHA must
// still match, and an existing verdict for that head still refuses.
// The GraphQL projection readReviewStates hands to every post-mutex gate. Exported and
// kept separate from the query so it can be tested directly: it previously carried no
// merge SHA at all, which silently rejected every merged pull request after the mutex,
// and a hand-written fixture in the tests could not catch that.
export function projectReviewPr(pr){
  return {state:String(pr?.state??'').toLowerCase(),merged:pr?.merged===true,merge_commit_sha:pr?.mergeCommit?.oid??'',head:{sha:pr?.headRefOid}}
}

export function projectReviewerOperationRouteSnapshot(data){
  if(data?.errors?.length||!data?.data?.repository?.pullRequest)throw new LaneError('reviewer operation routing snapshot returned GraphQL errors or no pull request')
  const row=data.data.repository.pullRequest,files=row.files,linked=row.closingIssuesReferences
  if(!Array.isArray(files?.nodes)||files.pageInfo?.hasNextPage!==false||!Array.isArray(linked?.nodes)||linked.pageInfo?.hasNextPage!==false)throw new LaneError('reviewer operation routing snapshot is incomplete or paginated')
  return {
    pr:{state:String(row.state??'').toLowerCase(),merged_at:row.merged===true?row.mergedAt:null,head:{sha:row.headRefOid}},
    files:files.nodes.map((file)=>({filename:file?.path,status:String(file?.changeType??'').toLowerCase()})),
    linkedIssues:linked.nodes.map((item)=>({number:item?.number,state:String(item?.state??'').toLowerCase(),body:item?.body,createdAt:item?.createdAt})),
  }
}

// GitHub does not include repository association unless it is requested. The
// verdict predicate refuses association-less prose, so omitting this field here
// makes a genuine OWNER verdict invisible to normal reviewer-lease cleanup.
export function reviewStateGraphqlFields(lease,index){
  return `p${index}:pullRequest(number:${lease.pr}){state merged mergeCommit{oid} headRefOid comments(first:100){pageInfo{hasNextPage} nodes{body authorAssociation}} reviews(first:100){pageInfo{hasNextPage} nodes{body state authorAssociation commit{oid}}}} i${index}:issue(number:${lease.issue}){state comments(first:100){pageInfo{hasNextPage} nodes{body authorAssociation}}}`
}

const MERGE_ANCESTRY_MEMO=new WeakMap()

function reviewTargetEligible(pr,io){
  if(!pr)return false
  if(pr.state==='open')return true
  const merged=pr.merged===true||Boolean(pr.merged_at),mergeSha=pr.merge_commit_sha??pr.mergeCommit?.oid??''
  if(!merged||!/^[0-9a-f]{40}$/i.test(String(mergeSha)))return false
  // Ancestry, not the merged flag alone: a merge commit absent from main means the
  // bytes under review are not what main actually carries.
  //
  // WIRE BUDGET: `mergeCommitInMain` costs two requests (readRef + compareCommits),
  // and this predicate is reached from several alternative return paths in one
  // operation. Memoised per (io, sha) so a merged target costs those two requests
  // ONCE, never once per call site. The open-PR path short-circuits above and is
  // unchanged at zero added requests -- see REVIEW_OPERATION_REQUEST_LIMIT.
  let cache=MERGE_ANCESTRY_MEMO.get(io)
  if(!cache){cache=new Map();MERGE_ANCESTRY_MEMO.set(io,cache)}
  const key=String(mergeSha).toLowerCase()
  // The 2 requests are checked HERE rather than folded into the operations' pre-mutex
  // reservations, because raising those by 2 unconditionally would shrink the ordinary
  // open-PR path -- which spends nothing extra -- and can push a legitimate assignment
  // over the limit. Charging the merged path for its own cost keeps the open path at
  // exactly its previous headroom, and turns an opaque mid-flight exhaustion into a
  // refusal that names the reason.
  if(!cache.has(key)){
    requireReviewWireCapacity(2,'the merged-pull-request ancestry check needs two more requests than remain')
    cache.set(key,io.mergeCommitInMain?.(mergeSha)===true)
  }
  return cache.get(key)
}

function reviewIssueEligible(issue,pr,io){
  return issue?.state==='open'||(issue?.state==='closed'&&pr?.state!=='open'&&reviewTargetEligible(pr,io))
}

// #2311. These refusals used to name three possible causes at once and leave the
// caller to guess which one fired; a closed work issue with an open PR read as a
// head change that had not happened. Report only what the already-fetched issue,
// PR and requested head prove. Never issue a fresh wire read from an error path:
// the request budget is fixed and a failing call would replace the real cause.
function reviewEligibilityCause(request,issue,pr){
  const parts=[]
  const issueState=String(issue?.state??'unreadable'),prState=String(pr?.state??'unreadable')
  if(issueState!=='open'&&prState==='open')parts.push(`work issue #${request.issue} is ${issueState} while PR #${request.pr} is still open -- a reviewer needs an open work issue, or a pull request already merged into main. Reopen issue #${request.issue}, or merge the pull request first. If #${request.issue} is an orchestrator marker rather than the work issue, re-run with the work issue number`)
  else if(issueState!=='open')parts.push(`work issue #${request.issue} is ${issueState} and PR #${request.pr} (${prState}) is not proven merged into main`)
  const head=String(pr?.head?.sha??'')
  if(!head)parts.push(`PR #${request.pr} head could not be read`)
  else if(request.headSha&&head!==request.headSha)parts.push(`PR #${request.pr} head is now ${head}, not the requested ${request.headSha}`)
  if(!parts.length)parts.push(`the work issue is open and the head matches, so PR #${request.pr} (${prState}) failed the merge-eligibility check itself`)
  return ` -- ${parts.join('; ')}`
}

// #2311. A verdict refused because the reviewer's active lease points elsewhere
// used to name neither the lease it found nor the fix. Say what the lease holds.
function reviewActiveLeaseCause(reviewer,activeSha,expected,io,activeRef=null){
  if(!activeSha)return ` -- reviewer ${reviewer} holds no active lease at all, so this verdict has nothing to record against; draw or replace the reviewer before recording a verdict`
  let held=`a different assignment (${activeSha})`
  try{
    const cursor=parseReviewCursor(io.getCommit(activeSha))
    held=`the assignment for issue #${cursor.issue}, PR #${cursor.pr}, head ${cursor.headSha}`
  }catch{/* an unreadable lease commit still names the SHA above */}
  return ` -- reviewer ${reviewer}'s active lease${activeRef?` (${activeRef})`:''} holds ${held}, but this verdict is for issue #${expected.issue}, PR #${expected.pr}, head ${expected.headSha}. Where the issue numbers differ you passed the wrong one: an orchestrator marker is not the work issue. Re-run against the issue the reviewer was actually assigned`
}

function assertReviewRequestEligible(request,states,io){
  if(!states)return null
  const state=states?.get(`${request.issue}:${request.pr}`),issue=state?.issue??io.getIssue(request.issue),pr=state?.pr??io.getPr(request.pr)
  if(!reviewIssueEligible(issue,pr,io)||!reviewTargetEligible(pr,io)||pr?.head?.sha!==request.headSha)throw new LaneError(`review assignment issue, PR head, or merge eligibility changed after mutex acquisition${reviewEligibilityCause(request,issue,pr)}`)
  return state
}

function reviewerQueueRef(request){return `${REVIEW_QUEUE_REF_PREFIX}/${request.issue}-${request.pr}-${request.slot}`}
function parseReviewerQueueTicket(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination reviewer-queue-ticket issue=(\d+) pr=(\d+) slot=(\d+) head=([0-9a-f]{7,40}) requested-at=([^ ]+)$/i.exec(message)
  if(!match)throw new LaneError('reviewer queue ticket is unreadable')
  return {issue:Number(match[1]),pr:Number(match[2]),slot:Number(match[3]),headSha:match[4],requestedAt:match[5]}
}

function reviewerQueueTicketExpired(ticket,now){const age=reviewLeaseAgeHours(ticket?.requestedAt,now);return age!==null&&age>=REVIEW_QUEUE_TTL_HOURS}
function liveReviewerQueue(io,now=new Date(),mutexOwnerSha=null){
  const reader=typeof io.listReviewRefsPaged==='function'?io.listReviewRefsPaged.bind(io):io.listRefs?.bind(io)
  const rows=typeof io.readReviewerQueue==='function'?io.readReviewerQueue():reader?.(REVIEW_QUEUE_REF_PREFIX)
  if(!rows)throw new LaneError('reviewer queue refs are unreadable')
  const live=[],expired=[]
  for(const row of rows){
    const ticket=row.ticket??parseReviewerQueueTicket(row.commit??io.getCommit(row.sha)),pr=row.pr??io.getPr(ticket.pr)
    if(reviewerQueueTicketExpired(ticket,now))expired.push({ref:row.ref,sha:row.sha})
    else if(pr?.state==='open'&&pr?.head?.sha===ticket.headSha)live.push({...ticket,ref:row.ref,sha:row.sha})
  }
  if(expired.length&&mutexOwnerSha&&typeof io.atomicReviewRefs==='function'&&typeof io.readReviewRefs==='function'){
    requireOwnedRef(MUTEX_REF,mutexOwnerSha,io)
    io.atomicReviewRefs([{ref:MUTEX_REF,expected:mutexOwnerSha,sha:mutexOwnerSha},...expired.map((row)=>({ref:row.ref,expected:row.sha,sha:null}))])
    const after=io.readReviewRefs([MUTEX_REF,...expired.map((row)=>row.ref)])
    if(after.get(MUTEX_REF)!==mutexOwnerSha||expired.some((row)=>after.get(row.ref)!==null))throw new LaneError('expired reviewer queue ticket evacuation readback mismatch')
  }else if(expired.length&&mutexOwnerSha){for(const row of expired)if(io.readRef(row.ref)===row.sha)releaseOwnedRef(row.ref,row.sha,io)}
  return live.sort((a,b)=>Date.parse(a.requestedAt)-Date.parse(b.requestedAt)||a.issue-b.issue||a.pr-b.pr||a.slot-b.slot)
}

function ensureReviewerQueueTurn(request,io,now=new Date()){
  if(!io.enableReviewerQueue)return null
  const ref=reviewerQueueRef(request),pr=io.getPr(request.pr)
  if(pr?.state!=='open'||pr?.head?.sha!==request.headSha)throw new LaneError('reviewer queue requires the exact open PR head')
  const ticketSha=io.makeOwnerCommit(`db-coordination reviewer-queue-ticket issue=${request.issue} pr=${request.pr} slot=${request.slot} head=${request.headSha} requested-at=${new Date(now).toISOString()}`)
  const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-queue-lock issue=${request.issue} pr=${request.pr} slot=${request.slot}`)
  let acquired=false
  try{
    acquireReviewMutex(ownerSha,io);acquired=true;requireOwnedRef(MUTEX_REF,ownerSha,io)
    const priorSha=io.readRef(ref);let sha=priorSha
    if(priorSha){const prior=parseReviewerQueueTicket(io.getCommit(priorSha)),fresh=io.getPr(prior.pr)
      if(prior.issue!==request.issue||prior.pr!==request.pr||prior.slot!==request.slot)throw new LaneError('reviewer queue ticket identity is corrupt')
      if(prior.headSha!==request.headSha||fresh?.state!=='open'||fresh?.head?.sha!==prior.headSha||reviewerQueueTicketExpired(prior,now)){releaseOwnedRef(ref,priorSha,io);sha=null}}
    if(!sha){sha=ticketSha;if(!io.createRef(ref,sha)&&readRefAfterWrite(ref,sha,io)!==sha)throw new LaneError('reviewer queue ticket could not be recorded')}
    let queue
    try{queue=liveReviewerQueue(io,now,ownerSha)}catch{return {ref,sha,queue:null}}
    const first=queue[0]
    if(first?.ref!==ref)throw new LaneError(`reviewer queue is FIFO; older ticket #${first.issue}/PR #${first.pr} slot ${first.slot} requested ${first.requestedAt} must be served first`)
    return {ref,sha,queue}
  }finally{if(acquired)finalizeReviewMutex(ownerSha,io)}
}

function finishReviewerQueueTurn(ticket,io){
  if(!ticket)return
  if(io.readRef(ticket.ref)===ticket.sha)releaseOwnedRef(ticket.ref,ticket.sha,io)
  if(io.readRef(ticket.ref)!==null)throw new LaneError('reviewer assignment succeeded but its queue ticket could not be cleared')
}

function assignNextReviewerOperation({issue,pr,headSha,slot=1,admissionOptions=null},io){
  const headPattern=io?.requiresExactReviewHeadSha?/^[0-9a-f]{40}$/i:/^[0-9a-f]{7,40}$/i
  if(!Number.isInteger(Number(issue))||!Number.isInteger(Number(pr))||!headPattern.test(String(headSha??'')))throw new LaneError('review assignment requires issue, PR, and exact 40-character head SHA')
  if(!Number.isInteger(Number(slot))||Number(slot)<1)throw new LaneError('review assignment slot must be a positive integer (1 = first reviewer, 2 = second independent reviewer)')
  io=reviewOperationIo(io)
  const request={issue:Number(issue),pr:Number(pr),headSha:String(headSha),slot:Number(slot)}
  const concurrentLeases=Boolean(io.requiresExactReviewHeadSha)
  const {eligible,unusable}=allocatableReviewers(io)
  const eligibleNames=new Set(eligible.map((row)=>row.name))
  // Slot >=2 needs a name to exclude BEFORE the mutex is taken: cheap, and it
  // lets an ungoverned "assign slot 2 with no slot 1" request fail fast.
  //
  // This branch reached the same slot-2 defect from the other side and moved
  // this resolve INSIDE the lock. #1813 fixed it by raising the ceiling instead,
  // and its REVIEW_MUTEX_SECTION_RESERVE is derived assuming the resolve is paid
  // here, pre-mutex. Two fixes for one defect is worse than either, so this
  // branch defers to the merged one: the resolve stays here, and the reserve is
  // #1813's (issue #1798 round 3 / issue #1812).
  const excludedProvider=request.slot===1?null:resolveSlotOneReviewer(request.issue,request.pr,request.headSha,io)
  const preflightBusy=findBusyReviewers(io)
  if(!preflightBusy)throw new LaneError('active reviewer leases are unreadable; reviewer assignment refused before mutex acquisition')
  const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-assignment-lock issue=${request.issue} pr=${request.pr} head=${request.headSha}${request.slot!==1?` slot=${request.slot}`:''}`)
  requireReviewWireCapacity(REVIEW_MUTEX_SECTION_RESERVE)
  acquireReviewMutex(ownerSha,io)
  try{
    if(admissionOptions)requirePrOperationRoute(admissionOptions,io,{pr,headSha,issue,mutexOwner:ownerSha,allowMerged:true,reviewSnapshot:true})
    const exclusions=reviewerExclusions(request.issue,request.pr,io,{fresh:true})
    // Slot 1 keeps the original, unsuffixed ref namespace so every existing
    // caller and every already-recorded assignment/replacement is untouched.
    // Slot 2+ gets its own parallel namespace under the same tuple so it can
    // never collide with, or be confused for, slot 1's records.
    const slotSuffix=reviewSlotSuffix(request.slot)
    const assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${slotSuffix}`
    const replacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${slotSuffix}`
    const replacementRows=(io.listRefs?.(replacementBase)??[]).filter((row)=>inReviewReplacementNamespace(row.ref,replacementBase))
    if(replacementRows.length){
      const replacements=replacementRows.map((row)=>{const parsed=parseReviewReplacement(row.commit??io.getCommit(row.sha));return {...parsed,failureSha:parsed.failureSha==='self'?row.sha:parsed.failureSha,replacementSha:row.sha}})
      for(const replacement of replacements){
        if(replacement.issue!==request.issue||replacement.pr!==request.pr||replacement.headSha!==request.headSha||!REVIEWERS.some((r)=>r.name===replacement.reviewer))throw new LaneError('durable reviewer replacement does not match the assignment request')
        requireReplacementEvidence(replacement,io)
      }
      const replacement=replacements.sort((a,b)=>b.sequence-a.sequence)[0], reviewer=REVIEWERS.find((r)=>r.name===replacement.reviewer)
      // DELIBERATE: this refusal does NOT re-draw, and does not return the slot
      // itself. Retiring a durable assignment or replacement is a recorded,
      // audited act -- it clears a ref under compare-and-swap and writes the
      // return record that says who held it and why it came back. Only
      // `--exclude-reviewer` does that, and it now returns BOTH namespaces in
      // the same atomic push as the exclusion, so the state this refusal names
      // can no longer be produced by a correct exclusion. What remains is a
      // pull request excluded before returns existed, or a torn state: for those
      // the honest answer is a fail-closed stop pointing at the repair command
      // (re-run the identical `--exclude-reviewer`), not an assignment path
      // silently discarding another command's durable record with no audit
      // trail. The exclusion of the REVIEWER is absolute either way -- they can
      // never be drawn again for this pull request.
      if(exclusions.has(replacement.reviewer))throw new LaneError(`durable replacement reviewer ${replacement.reviewer} is excluded for this PR (${exclusions.get(replacement.reviewer).reason}); re-run the identical --exclude-reviewer to return this slot. The returned record is a REPLACEMENT, so --assign-reviewer will not refill it: draw the new reviewer with --replace-failed-reviewer for the same --failed-sequence.`)
      if(!eligibleNames.has(replacement.reviewer))throw new LaneError(`durable replacement sequence ${replacement.sequence} belongs to a retired, quarantined or orchestrator-conflicting reviewer ${replacement.reviewer}; its active lease was not recreated. Record a new governed replacement for this exact head`)
      const liveReplacement=concurrentLeases?activeLeaseRecordForAssignment(preflightBusy,{...replacement,slot:request.slot}):preflightBusy.leases.get(reviewer.name)
      const replacementLeaseRef=liveReplacement?.ref??resolveAssignmentLeaseRef({...replacement,slot:request.slot},concurrentLeases,io,preflightBusy),staleReplacement=preflightBusy.stale.find((row)=>row.ref===replacementLeaseRef)
      if(liveReplacement&&liveReplacement.sha!==replacement.replacementSha&&!staleReplacement)throw new LaneError(`reviewer ${reviewer.name} has an unrelated live lease; assignment retry repair refused`)
      const failed=activeLeaseRecordForJob(preflightBusy,{issue:request.issue,pr:request.pr,headSha:request.headSha,sequence:replacement.failedSequence})
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      const freshStates=io.readReviewStates?.([replacement,...(staleReplacement?[staleReplacement.assignment]:[])])
      assertReviewRequestEligible(request,freshStates,io)
      const replacementLive=isReviewAssignmentLive({...replacement,slot:request.slot},freshStates,io),replacementTarget=replacementLive?replacement.replacementSha:null
      if(replacementLive&&!liveReplacement)assertAssignmentWasNotTerminallyReleased(request,replacement,io)
      if(io.atomicReviewRefs){
        if(staleReplacement)assertReviewLeaseStillStale(staleReplacement,freshStates,io)
        const changes=[{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha}]
        if(failed)changes.push({ref:failed.ref,expected:failed.sha,sha:null})
        changes.push({ref:replacementLeaseRef,expected:staleReplacement?.sha??(liveReplacement?.sha??null),sha:replacementTarget})
        io.atomicReviewRefs(changes)
        const after=io.readReviewRefs([MUTEX_REF,...(failed?[failed.ref]:[]),replacementLeaseRef])
        if(after.get(MUTEX_REF)!==ownerSha||(failed&&after.get(failed.ref)!==null)||after.get(replacementLeaseRef)!==replacementTarget)throw new LaneError('assignment retry replacement lease readback mismatch')
      }else{
        if(failed&&io.readRef(failed.ref)===failed.sha)releaseOwnedRef(failed.ref,failed.sha,io)
        if(staleReplacement&&io.readRef(replacementLeaseRef)===staleReplacement.sha)releaseOwnedRef(replacementLeaseRef,staleReplacement.sha,io)
        if(replacementLive&&!io.createRef(replacementLeaseRef,replacement.replacementSha)&&readRefAfterWrite(replacementLeaseRef,replacement.replacementSha,io)!==replacement.replacementSha)throw new LaneError('assignment retry replacement lease could not be restored')
      }
      return {...replacement,slot:request.slot,wrapper:reviewer.wrapper,replacementSequence:replacement.failedSequence,assignmentRef:`${replacementBase}-${replacement.failedSequence}`}
    }
    const priorSha=io.readRef(assignmentRef)
    if(priorSha){
      const prior=parseReviewCursor(io.getCommit(priorSha)),preflightLease=activeLeaseRecordForAssignment(preflightBusy,{...prior,slot:request.slot}),leaseRef=preflightLease?.ref??resolveAssignmentLeaseRef({...prior,slot:request.slot},concurrentLeases,io,preflightBusy),stalePrior=preflightBusy.stale.find((row)=>row.ref===leaseRef&&row.sha===priorSha)
      // Same deliberate refusal as the replacement branch above: the assignment
      // path never retires a slot itself. See the comment there.
      if(exclusions.has(prior.reviewer))throw new LaneError(`durable assignment reviewer ${prior.reviewer} is excluded for this PR (${exclusions.get(prior.reviewer).reason}); re-run the identical --exclude-reviewer to return this slot, then re-run this --assign-reviewer to draw a fresh reviewer for it.`)
      const retryStates=io.readReviewStates?.([prior,...(stalePrior?[stalePrior.assignment]:[])])
      assertReviewRequestEligible(request,retryStates,io)
      // Eligibility is re-checked on EVERY retry return below, not only the
      // first one reached: the orchestrator engine backing a retry can differ
      // from the one that made the original assignment (a concurrent
      // orchestrator, or the same one switching engines), so a provider that
      // was independent when assigned can become a same-provider conflict by
      // the time a retry lands here. Every return path below must fail the
      // same way a fresh assignment would, never hand back a stale answer.
      if(!eligibleNames.has(prior.reviewer))throw new LaneError(`durable assignment sequence ${prior.sequence} belongs to a retired, quarantined or orchestrator-conflicting reviewer ${prior.reviewer}; its active lease was not recreated. Record a governed replacement for this exact head`)
      if(preflightLease?.sha===priorSha&&preflightLease.lease.issue===prior.issue&&preflightLease.lease.pr===prior.pr&&preflightLease.lease.headSha===prior.headSha&&preflightLease.lease.sequence===prior.sequence&&!stalePrior){
        assertAssignmentWasNotTerminallyReleased(request,prior,io)
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        if(io.atomicReviewRefs){
          io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},{ref:leaseRef,expected:priorSha,sha:priorSha}])
          const after=io.readReviewRefs([MUTEX_REF,leaseRef])
          if(after.get(MUTEX_REF)!==ownerSha||after.get(leaseRef)!==priorSha)throw new LaneError('assignment retry lease changed after mutex acquisition')
        }else if(io.readRef(leaseRef)!==priorSha)throw new LaneError('assignment retry lease changed after mutex acquisition')
        return {...prior,slot:request.slot,wrapper:REVIEWERS.find((r)=>r.name===prior.reviewer)?.wrapper}
      }
      if(stalePrior){
        if(io.atomicReviewRefs){assertReviewLeaseStillStale(stalePrior,io.readReviewStates([stalePrior.assignment]),io);io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},{ref:leaseRef,expected:priorSha,sha:null}]);const after=io.readReviewRefs([MUTEX_REF,leaseRef]);if(after.get(MUTEX_REF)!==ownerSha||after.get(leaseRef)!==null)throw new LaneError('stale assignment lease release readback mismatch')}
        else if(io.readRef(leaseRef)===priorSha)releaseOwnedRef(leaseRef,priorSha,io)
      }
      assertAssignmentWasNotTerminallyReleased(request,prior,io)
      const live=io.getPr(prior.pr)
      if(reviewTargetEligible(live,io)&&live?.head?.sha===prior.headSha&&!hasVerdictForHead(prior.issue,prior.pr,prior.headSha,io,{slot:request.slot})){
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        if(!io.createRef(leaseRef,priorSha)&&readRefAfterWrite(leaseRef,priorSha,io)!==priorSha)throw new LaneError(`reviewer ${prior.reviewer} has a conflicting active lease`)
      }
      return {...prior,slot:request.slot,wrapper:REVIEWERS.find((r)=>r.name===prior.reviewer)?.wrapper}
    }
    const cursorSha=io.readRef(REVIEW_CURSOR_REF), current=parseReviewCursor(cursorSha?io.getCommit(cursorSha):null)
    // The cursor adoption shortcut is SKIPPED, not refused, when the cursor's
    // reviewer is durably excluded for this pull request. Its assignment came
    // back with the exclusion (see excludeReviewerForPr), so there is nothing
    // left to adopt, and the ordinary round-robin below draws a fresh reviewer
    // while `notTaken` keeps the excluded one permanently out of the draw.
    //
    // This used to throw. That refusal is what made an exclusion fatal: the
    // cursor keeps pointing at the excluded reviewer for this exact tuple, so
    // every later --assign-reviewer for the head landed here and refused again
    // with no command anywhere that could change the answer.
    if(current&&!exclusions.has(current.reviewer)&&current.issue===request.issue&&current.pr===request.pr&&current.headSha===request.headSha&&(current.slot??1)===request.slot){
      assertReviewRequestEligible(request,io.readReviewStates?.([current]),io)
      // #2079. Mirror the prior-assignment path at the top of this function.
      // This branch used to create the durable assignment ref and RETURN a
      // retired reviewer whenever the global cursor happened to name it for the
      // same issue/PR/head/slot -- no lease was taken, because the eligibility
      // guard below wraps only lease creation, so no verdict could ever result.
      // That is wasted work and an inconsistent refusal, and it named no repair.
      // Refuse here, before any ref is created, with the same repair route.
      if(!eligibleNames.has(current.reviewer))throw new LaneError(ACTIVE_REVIEWERS.some((row)=>row.name===current.reviewer)
        ?`current reviewer ${current.reviewer} conflicts with the live orchestrator engine; assign an independent reviewer`
        :`current reviewer cursor sequence ${current.sequence} belongs to a retired, quarantined or orchestrator-conflicting reviewer ${current.reviewer}; no assignment was recorded and no lease was taken. Record a governed replacement for this exact head`)
      assertAssignmentWasNotTerminallyReleased(request,current,io)
      if(!io.createRef(assignmentRef,cursorSha)&&readRefAfterWrite(assignmentRef,cursorSha,io)!==cursorSha)throw new LaneError('review assignment record could not be proved; retry the same assignment')
      const live=io.getPr(current.pr)
      if(reviewTargetEligible(live,io)&&live?.head?.sha===current.headSha&&!hasVerdictForHead(current.issue,current.pr,current.headSha,io,{slot:request.slot})){
        if(eligibleNames.has(current.reviewer)){
          const leaseRef=reviewLeaseRefForAssignment({...current,slot:request.slot},concurrentLeases),existing=io.readRef(leaseRef)
          if(existing!==cursorSha&&(!io.createRef(leaseRef,cursorSha)||readRefAfterWrite(leaseRef,cursorSha,io)!==cursorSha))throw new LaneError(`reviewer ${current.reviewer} has a conflicting active lease`)
        }
      }
      return {...current,slot:request.slot,wrapper:REVIEWERS.find((r)=>r.name===current.reviewer)?.wrapper}
    }
    const sequence=(current?.sequence??0)+1
    // Ordinary path: round-robin over the active roster. The overflow provider
    // is reached only when EVERY active reviewer is already holding live review
    // work here and the overflow provider itself is free. The rotation position
    // is derived from `sequence`, not from who was last assigned, so spending a
    // sequence on the overflow provider does not move anyone's turn.
    // Slot >=2 additionally excludes whoever slot 1 already holds for this
    // exact head, so the second reviewer is never the same provider as the
    // first -- on top of, never instead of, the ordinary busy exclusion.
    const busy=preflightBusy
    const start=(sequence-1)%ACTIVE_REVIEWERS.length
    // Provider capacity is deliberately not a draw constraint for the exact
    // production protocol.  Lightweight historical fixtures may use short
    // heads, which cannot name a parallel lease and retain old serial rules.
    const notTaken=(row)=>eligibleNames.has(row.name)&&(concurrentLeases||!busy.has(row.name))&&row.name!==excludedProvider&&!exclusions.has(row.name)
    const reviewer=Array.from({length:ACTIVE_REVIEWERS.length},(_,offset)=>ACTIVE_REVIEWERS[(start+offset)%ACTIVE_REVIEWERS.length]).find(notTaken)??OVERFLOW_REVIEWERS.find(notTaken)
    if(!reviewer){
      // #2694 review (slot 2, medium finding 9). The message used to recite a
      // fixed menu of causes, and `notTaken` implements only some of them: for
      // slot 1 `excludedProvider` is null, so "already assigned to this exact
      // head" can never be why; under the production concurrent-lease protocol
      // busyness is not a draw constraint at all. An operator reading a cause
      // the code does not apply looks for a state that is not there. Every
      // provider is now given the reason `notTaken` ACTUALLY rejected it by,
      // tested in the same order the predicate tests them.
      const refusalFor=(name)=>{
        if(unusable.has(name)){const state=unusable.get(name);return `unusable by ai-review-preflight (${state.status??state.failure_class??'unavailable'})`}
        if(!eligibleNames.has(name))return 'conflicts with the live orchestrator engine, or is retired or quarantined'
        if(!concurrentLeases&&busy.has(name))return 'already holds a live review lease (serial-lease protocol)'
        if(name===excludedProvider)return `already holds slot 1 for this exact head`
        if(exclusions.has(name))return `durably excluded for this PR (${exclusions.get(name).reason})`
        return 'unavailable for an unrecorded reason'
      }
      const detail=[...ACTIVE_REVIEWERS,...OVERFLOW_REVIEWERS].map((row)=>`${row.name} ${refusalFor(row.name)}`).join('; ')
      throw new LaneError(`${request.slot===1?'no reviewer is available':`no independent reviewer is available for slot ${request.slot}`}: ${detail}.`)
    }
    const assignmentSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${sequence} reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha}${request.slot!==1?` slot=${request.slot}`:''}`)
    const leaseRef=reviewLeaseRefForAssignment({...request,reviewer:reviewer.name},concurrentLeases)
    const leaseSha=assignmentSha
    const selectedStale=busy.stale.find((row)=>row.ref===leaseRef)
    let staleReleased=false,leaseCreated=false,cursorChanged=false,assignmentCreated=false
    try{
      if(io.atomicReviewRefs){
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        const freshStates=io.readReviewStates([{issue:request.issue,pr:request.pr,headSha:request.headSha},...(selectedStale?[selectedStale.assignment]:[])])
        const fresh=freshStates?.get(`${request.issue}:${request.pr}`)
        const freshVerdict=hasVerdictForHead(request.issue,request.pr,request.headSha,io,{fresh:true,slot:request.slot})
        if(!reviewIssueEligible(fresh?.issue,fresh?.pr,io)||!reviewTargetEligible(fresh?.pr,io)||fresh?.pr?.head?.sha!==request.headSha||freshVerdict)throw new LaneError(`review assignment issue, PR head, or verdict changed after mutex acquisition${freshVerdict?` -- a verdict for issue #${request.issue}, PR #${request.pr}, head ${request.headSha} already exists`:reviewEligibilityCause(request,fresh?.issue,fresh?.pr)}`)
        if(selectedStale){
          const revived=freshStates?.get(`${selectedStale.assignment.issue}:${selectedStale.assignment.pr}`)
          const verdict=hasVerdictForHead(selectedStale.assignment.issue,selectedStale.assignment.pr,selectedStale.assignment.headSha,io,leaseVerdictOptions(selectedStale.assignment,{fresh:true}))
          if(revived?.pr?.state==='open'&&revived?.pr?.head?.sha===selectedStale.assignment.headSha&&!verdict)throw new LaneError('selected reviewer lease became live after mutex acquisition')
        }
        io.atomicReviewRefs([
          {ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},
          {ref:leaseRef,expected:selectedStale?.sha??null,sha:leaseSha},
          {ref:REVIEW_CURSOR_REF,expected:cursorSha,sha:assignmentSha},
          {ref:assignmentRef,expected:null,sha:assignmentSha},
        ])
        const refs=io.readReviewRefs([MUTEX_REF,leaseRef,REVIEW_CURSOR_REF,assignmentRef])
        if(refs.get(MUTEX_REF)!==ownerSha||refs.get(leaseRef)!==leaseSha||refs.get(REVIEW_CURSOR_REF)!==assignmentSha||refs.get(assignmentRef)!==assignmentSha)throw new LaneError('atomic review assignment readback mismatch')
        return {sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request}
      }
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      if(selectedStale){
        if(io.readReviewRefs){const current=io.readReviewRefs([MUTEX_REF,leaseRef]);if(current.get(MUTEX_REF)!==ownerSha||current.get(leaseRef)!==selectedStale.sha)throw new LaneError('selected stale reviewer lease changed after preflight');io.deleteRef(leaseRef);staleReleased=true}
        else if(io.readRef(leaseRef)===selectedStale.sha){releaseOwnedRef(leaseRef,selectedStale.sha,io);staleReleased=true}
      }
      if(!io.createRef(leaseRef,leaseSha)&&readRefAfterWrite(leaseRef,leaseSha,io)!==leaseSha)throw new LaneError(`reviewer ${reviewer.name} acquired a conflicting live lease`)
      leaseCreated=true
      if(cursorSha)io.updateRef(REVIEW_CURSOR_REF,assignmentSha);else if(!io.createRef(REVIEW_CURSOR_REF,assignmentSha))throw new LaneError('reviewer cursor was created concurrently; retry the same assignment')
      cursorChanged=true
      if(!io.readReviewRefs&&readRefAfterWrite(REVIEW_CURSOR_REF,assignmentSha,io)!==assignmentSha)throw new LaneError('reviewer cursor advancement could not be proved; retry the same assignment')
      if(!io.createRef(assignmentRef,assignmentSha)&&(!io.readReviewRefs&&readRefAfterWrite(assignmentRef,assignmentSha,io)!==assignmentSha))throw new LaneError('review assignment record could not be proved; retry the same assignment')
      assignmentCreated=true
      if(io.readReviewRefs){const refs=io.readReviewRefs([MUTEX_REF,leaseRef,REVIEW_CURSOR_REF,assignmentRef]);if(refs.get(MUTEX_REF)!==ownerSha||refs.get(leaseRef)!==leaseSha||refs.get(REVIEW_CURSOR_REF)!==assignmentSha||refs.get(assignmentRef)!==assignmentSha)throw new LaneError('batched review assignment readback mismatch')}
      return {sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request}
    }catch(error){
      const rollback=[]
      try{if(assignmentCreated&&io.readRef(assignmentRef)===assignmentSha)releaseOwnedRef(assignmentRef,assignmentSha,io)}catch(e){rollback.push(e.message)}
      try{if(cursorChanged&&io.readRef(REVIEW_CURSOR_REF)===assignmentSha){if(cursorSha){io.updateRef(REVIEW_CURSOR_REF,cursorSha);if(readRefAfterWrite(REVIEW_CURSOR_REF,cursorSha,io)!==cursorSha)throw new LaneError('cursor rollback could not be proved')}else releaseOwnedRef(REVIEW_CURSOR_REF,assignmentSha,io)}}catch(e){rollback.push(e.message)}
      try{if(leaseCreated&&io.readRef(leaseRef)===leaseSha)releaseOwnedRef(leaseRef,leaseSha,io)}catch(e){rollback.push(e.message)}
      try{if(staleReleased&&!io.readRef(leaseRef)&&!io.createRef(leaseRef,selectedStale.sha))throw new LaneError('stale reviewer lease rollback could not be proved')}catch(e){rollback.push(e.message)}
      if(rollback.length)throw new LaneError(`review assignment failed (${error.message}) and rollback was incomplete: ${rollback.join('; ')}`)
      throw error
    }
  }finally{finalizeReviewMutex(ownerSha,io)}
}

// The review mutex is shared with author acquisition and is held only for seconds.
// "is occupied" is thrown by createRef before any write, so the whole draw is safe
// to repeat; everything else propagates unchanged. Owner rate-limit rule
// (2026-09-11, marker #2758): lock-contention retries wait at least five minutes,
// so the default is one retry after five minutes plus jitter.
export const MUTEX_RETRY_WAIT_MS = 300000
export function assignWithMutexRetry(request,io=githubIo,{attempts=2,wait=(ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
  for(let attempt=1;;attempt++){
    try{return assignNextReviewer(request,io)}
    catch(error){
      if(attempt>=attempts||error?.message!==`${MUTEX_REF} is occupied`)throw error
      wait(MUTEX_RETRY_WAIT_MS+Math.floor(Math.random()*30000))
    }
  }
}

export function assignNextReviewer(request,io=githubIo){
  const normalized={...request,issue:Number(request.issue),pr:Number(request.pr),slot:Number(request.slot??1),headSha:String(request.headSha??'')}
  if(!io.enableReviewerQueue)return withReviewRequestBudget(()=>assignNextReviewerOperation(normalized,reviewOperationIo(io)))
  return withReviewRequestBudget(()=>{const operationIo=reviewOperationIo(io),ticket=ensureReviewerQueueTurn(normalized,operationIo);try{return assignNextReviewerOperation(normalized,operationIo)}finally{finishReviewerQueueTurn(ticket,operationIo)}},REVIEW_QUEUE_ASSIGNMENT_REQUEST_LIMIT)
}
function parseSilenceRelease(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination reviewer-silence-release reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{40}) sequence=(\d+) code=silent_worker_observed probe=([0-9a-f]{7,40}) observed-at=([^ ]+) confirmed-at=([^ ]+) verdict=none artifact=none replacement=none$/i.exec(message)
  if(!match)throw new LaneError('reviewer silence release evidence is unreadable')
  return {reviewer:match[1],issue:Number(match[2]),pr:Number(match[3]),headSha:match[4],sequence:Number(match[5]),probeSha:match[6],observedAt:match[7],confirmedAt:match[8]}
}

function replaceClaimVersion(body,oldVersion,newVersion){
  const fence=/```db-claim\s*\n([\s\S]*?)```/.exec(String(body??''))
  if(!fence||!new RegExp(`^version: ${oldVersion}$`,'m').test(fence[1])||(fence[1].match(/^version:/gm)??[]).length!==1)throw new LaneError('claim fenced version is missing or ambiguous')
  return body.slice(0,fence.index)+fence[0].replace(`version: ${oldVersion}`,`version: ${newVersion}`)+body.slice(fence.index+fence[0].length)
}

function parseVersionSupersession(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination claim-version-superseded issue=(\d+) claim=(\d+) pr=(\d+) old=(\d{14}) new=(\d{14}) old-ref=([0-9a-f]{7,40}) head=([0-9a-f]{40})$/i.exec(message)
  if(!match)throw new LaneError('version supersession ref is unreadable')
  return {issue:Number(match[1]),claim:Number(match[2]),pr:Number(match[3]),oldVersion:match[4],newVersion:match[5],oldReservation:match[6],newHead:match[7]}
}

export function supersedeActiveClaimVersion(options,now=new Date(),io=githubIo){
  const request={issue:Number(options.issue),claim:Number(options.claim),pr:Number(options.pr),owner:String(options.owner??''),branch:String(options.branch??''),worktree:String(options.worktree??''),headSha:String(options.headSha??''),oldVersion:String(options.oldVersion??'')}
  if(!Number.isInteger(request.issue)||!Number.isInteger(request.claim)||!Number.isInteger(request.pr)||!request.owner||!request.branch||!request.worktree||!/^[0-9a-f]{40}$/i.test(request.headSha)||!/^\d{14}$/.test(request.oldVersion))throw new LaneError('version supersession requires exact issue, claim, owner, branch, worktree, PR, head, and current version')
  const supersessionRef=`refs/db-claim-supersessions/${request.claim}-${request.oldVersion}`
  const priorSha=io.readRef(supersessionRef)
  if(priorSha){
    const prior=parseVersionSupersession(io.getCommit(priorSha)),claim=io.getIssue(request.claim),lease=parseAuthorLease(claim?.body??'',now),pr=io.getPr(request.pr)
    if(prior.issue!==request.issue||prior.claim!==request.claim||prior.pr!==request.pr||prior.oldVersion!==request.oldVersion||lease.version!==prior.newVersion||lease.owner!==request.owner||lease.branch!==request.branch||lease.worktree!==request.worktree||pr?.head?.sha!==prior.newHead||pr?.head?.ref!==request.branch||io.readRef(`refs/db-claims/${request.oldVersion}`)!==prior.oldReservation||!io.readRef(`refs/db-claims/${prior.newVersion}`))throw new LaneError('durable version supersession does not match current state')
    return {...prior,supersessionSha:priorSha,idempotent:true}
  }
  const ownerSha=io.makeOwnerCommit(`db-coordination claim-version-supersession issue=${request.issue} claim=${request.claim} pr=${request.pr} head=${request.headSha}`)
  acquireMutex(ownerSha,io)
  let before,rewritten=false,bodyChanged=false,newVersion,newHead,supersessionSha
  try{
    before=io.getIssue(request.claim);if(before?.state!=='open'||Number(before.number)!==request.claim)throw new LaneError(`claim #${request.claim} is not open`)
    const lease=parseAuthorLease(before.body,now)
    if(workstreamKey(before.title)!==`#${request.issue}`)throw new LaneError(`claim title does not identify exact issue #${request.issue}: ${JSON.stringify(before.title??'')}`)
    if(lease.owner!==request.owner)throw new LaneError('claim owner changed')
    if(lease.version!==request.oldVersion)throw new LaneError('claim version changed')
    if(lease.branch!==request.branch)throw new LaneError('claim branch changed')
    if(lease.worktree!==request.worktree)throw new LaneError('claim worktree changed')
    const oldReservation=io.readRef(`refs/db-claims/${request.oldVersion}`);if(!oldReservation)throw new LaneError('old permanent reservation is missing')
    const pr=io.getPr(request.pr);if(pr?.state!=='open'||pr.head?.sha!==request.headSha||pr.head?.ref!==request.branch)throw new LaneError('open PR exact head or branch changed')
    const versions=migrationVersions(io.getPrFiles(request.pr));if(versions.length!==1||versions[0]!==request.oldVersion)throw new LaneError('PR must change exactly one migration at the current reserved version')
    if(!io.localClean(request.worktree)||io.localHead(request.worktree)!==request.headSha)throw new LaneError('target worktree is dirty or not at the exact PR head')
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const reservation=io.reserveVersion();newVersion=String(reservation.version)
    if(!/^\d{14}$/.test(newVersion)||newVersion<=String(io.currentMaxVersion(request.worktree)??'')||newVersion===request.oldVersion)throw new LaneError('manager reservation is not later than current main')
    if(!io.readRef(`refs/db-claims/${newVersion}`))throw new LaneError('new permanent reservation readback failed')
    io.rewriteVersion(request.worktree,request.oldVersion,newVersion);rewritten=true
    newHead=io.commitAndPushReversion(request.worktree,request.oldVersion,newVersion)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const newBody=replaceClaimVersion(before.body,request.oldVersion,newVersion);bodyChanged=true;io.updateIssue(request.claim,{body:newBody})
    const after=io.getIssue(request.claim),afterLease=parseAuthorLease(after.body,now)
    if(after.body!==newBody||afterLease.version!==newVersion||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||afterLease.objects.join('|')!==lease.objects.join('|'))throw new LaneError('claim readback changed fields outside its fenced version')
    const livePr=readPrAfterPush(request.pr,{head:newHead,version:newVersion,branch:request.branch,staleHead:request.headSha,staleVersion:request.oldVersion},io)
    if(!livePr)throw new LaneError('PR did not expose exactly the new reserved migration')
    if(io.readRef(`refs/db-claims/${request.oldVersion}`)!==oldReservation||!io.readRef(`refs/db-claims/${newVersion}`))throw new LaneError('permanent reservation readback changed')
    supersessionSha=io.makeOwnerCommit(`db-coordination claim-version-superseded issue=${request.issue} claim=${request.claim} pr=${request.pr} old=${request.oldVersion} new=${newVersion} old-ref=${oldReservation} head=${newHead}`)
    if(!io.createRef(supersessionRef,supersessionSha)||readRefAfterWrite(supersessionRef,supersessionSha,io)!==supersessionSha)throw new LaneError('durable version supersession evidence could not be created and read back')
    return {issue:request.issue,claim:request.claim,pr:request.pr,oldVersion:request.oldVersion,newVersion,oldReservation,newHead,supersessionSha,idempotent:false}
  }catch(error){
    if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
    const failures=[]
    if(supersessionSha)try{if(io.readRef(supersessionRef)===supersessionSha)releaseOwnedRef(supersessionRef,supersessionSha,io)}catch(e){failures.push(e.message)}
    if(bodyChanged)try{io.updateIssue(request.claim,{body:before.body})}catch(e){failures.push(e.message)}
    if(rewritten)try{io.rewriteVersion(request.worktree,newVersion,request.oldVersion);io.commitAndPushReversion(request.worktree,newVersion,request.oldVersion)}catch(e){failures.push(e.message)}
    if(failures.length)throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${failures.join('; ')}`)
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export const reversionActiveClaim=supersedeActiveClaimVersion

function parseMergedClaimReissue(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination merged-claim-reissued issue=(\d+) claim=(\d+) source-pr=(\d+) old=(\d{14}) new=(\d{14}) old-ref=([0-9a-f]{7,40}) new-ref=([0-9a-f]{7,40}) merge=([0-9a-f]{40})$/i.exec(message)
  if(!match)throw new LaneError('merged claim reissue ref is unreadable')
  return {issue:Number(match[1]),claim:Number(match[2]),sourcePr:Number(match[3]),oldVersion:match[4],newVersion:match[5],oldReservation:match[6],newReservation:match[7],mergeSha:match[8]}
}

export function reissueMergedStrandedClaim(options,now=new Date(),io=githubIo){
  const request={issue:Number(options.issue),claim:Number(options.claim),sourcePr:Number(options.sourcePr),owner:String(options.owner??''),targetBranch:String(options.targetBranch??''),targetWorktree:String(options.targetWorktree??''),oldVersion:String(options.oldVersion??''),leaseHours:Number(options.leaseHours)}
  if(!Number.isInteger(request.issue)||!Number.isInteger(request.claim)||!Number.isInteger(request.sourcePr)||!request.owner||!request.targetBranch||!request.targetWorktree||!/^[0-9]{14}$/.test(request.oldVersion)||!Number.isFinite(request.leaseHours)||request.leaseHours<=0||request.leaseHours>24)throw new LaneError('merged claim reissue requires exact issue, claim, source PR, owner, target branch, target worktree, old version, and a lease of no more than 24 hours')
  const evidenceRef=`refs/db-claim-retirements/${request.claim}-${request.oldVersion}`
  const priorSha=io.readRef(evidenceRef)
  let prior=null
  if(priorSha){
    prior=parseMergedClaimReissue(io.getCommit(priorSha));const claim=io.getIssue(request.claim),lease=parseAuthorLease(claim?.body??'',now)
    if(prior.issue!==request.issue||prior.claim!==request.claim||prior.sourcePr!==request.sourcePr||prior.oldVersion!==request.oldVersion||lease.owner!==request.owner||io.readRef(`refs/db-claims/${request.oldVersion}`)!==prior.oldReservation||io.readRef(`refs/db-claims/${prior.newVersion}`)!==prior.newReservation)throw new LaneError('durable merged claim reissue does not match current state')
    if(lease.version===prior.newVersion&&lease.branch===request.targetBranch&&lease.worktree===request.targetWorktree)return {...prior,retirementSha:priorSha,idempotent:true}
    if(lease.version!==request.oldVersion)throw new LaneError('durable merged claim reissue exists but the claim is neither original nor exactly reissued')
  }
  const ownerSha=io.makeOwnerCommit(`db-coordination merged-claim-reissue-lock issue=${request.issue} claim=${request.claim} source-pr=${request.sourcePr}`)
  acquireMutex(ownerSha,io)
  let before,newVersion,newReservation,retirementSha,bodyChanged=false,evidenceCreated=false
  try{
    before=io.getIssue(request.claim)
    if(before?.state!=='open'||Number(before.number)!==request.claim)throw new LaneError(`claim #${request.claim} is not open`)
    const lease=parseAuthorLease(before.body,now)
    if(workstreamKey(before.title)!==`#${request.issue}`)throw new LaneError(`claim title does not identify exact issue #${request.issue}: ${JSON.stringify(before.title??'')}`)
    if(lease.owner!==request.owner)throw new LaneError('claim owner changed')
    if(lease.version!==request.oldVersion)throw new LaneError('claim stranded version changed')
    if(lease.branch===request.targetBranch||lease.worktree===request.targetWorktree)throw new LaneError('merged claim reissue requires a fresh target branch and worktree')
    const oldReservation=io.readRef(`refs/db-claims/${request.oldVersion}`)
    if(!oldReservation)throw new LaneError('old permanent reservation is missing')
    const pr=io.getPr(request.sourcePr),mergeSha=String(pr?.merge_commit_sha??pr?.mergeCommit?.oid??'')
    if(!(pr?.merged===true||pr?.merged_at||String(pr?.state).toLowerCase()==='merged')||!/^[0-9a-f]{40}$/i.test(mergeSha))throw new LaneError('source pull request is not merged with an exact merge commit')
    const versions=migrationVersions(io.getPrFiles(request.sourcePr))
    if(versions.length!==1||versions[0]!==request.oldVersion)throw new LaneError('source pull request must contain exactly the stranded migration version')
    const mainSha=io.mainSha?.()??io.readRef('refs/heads/main')
    assertMergeCommitInMainHistory(mergeSha,mainSha,io)
    if(prior&&(prior.mergeSha!==mergeSha||prior.oldReservation!==oldReservation||prior.newVersion<=request.oldVersion))throw new LaneError('durable merged claim reissue does not match source merge or reservations')
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    if(prior){newVersion=prior.newVersion;newReservation=prior.newReservation;retirementSha=priorSha}
    else{
      const reservation=io.reserveVersion();newVersion=String(reservation.version);newReservation=io.readRef(`refs/db-claims/${newVersion}`)
      if(!/^[0-9]{14}$/.test(newVersion)||newVersion<=request.oldVersion||!newReservation)throw new LaneError('new permanent reservation is not later than the stranded version or failed readback')
    }
    const expiresAt=new Date(now.valueOf()+request.leaseHours*3600000)
    let newBody=replaceClaimVersion(before.body,request.oldVersion,newVersion)
    newBody=replaceLeaseLocation(newBody,request.targetBranch,request.targetWorktree)
    newBody=replaceLeaseExpiry(newBody,expiresAt)
    if(!prior){
      retirementSha=io.makeOwnerCommit(`db-coordination merged-claim-reissued issue=${request.issue} claim=${request.claim} source-pr=${request.sourcePr} old=${request.oldVersion} new=${newVersion} old-ref=${oldReservation} new-ref=${newReservation} merge=${mergeSha}`)
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      if(!io.createRef(evidenceRef,retirementSha)||readRefAfterWrite(evidenceRef,retirementSha,io)!==retirementSha)throw new LaneError('immutable retirement and supersession evidence could not be created and read back')
      evidenceCreated=true
    }
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    bodyChanged=true;io.updateIssue(request.claim,{body:newBody})
    const after=io.getIssue(request.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.body!==newBody||afterLease.version!==newVersion||afterLease.owner!==lease.owner||afterLease.branch!==request.targetBranch||afterLease.worktree!==request.targetWorktree||afterLease.objects.join('|')!==lease.objects.join('|'))throw new LaneError('reissued claim readback changed its object lock or identity')
    if(io.readRef(`refs/db-claims/${request.oldVersion}`)!==oldReservation||io.readRef(`refs/db-claims/${newVersion}`)!==newReservation||io.readRef(evidenceRef)!==retirementSha)throw new LaneError('reissue reservations or retirement evidence changed during readback')
    return {issue:request.issue,claim:request.claim,sourcePr:request.sourcePr,oldVersion:request.oldVersion,newVersion,oldReservation,newReservation,mergeSha,retirementSha,expiresAt:expiresAt.toISOString(),idempotent:false}
  }catch(error){
    if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
    const failures=[]
    if(bodyChanged)try{io.updateIssue(request.claim,{body:before.body});if(io.getIssue(request.claim)?.body!==before.body)throw new LaneError('claim rollback readback mismatch')}catch(e){failures.push(e.message)}
    if(evidenceCreated)try{if(io.readRef(evidenceRef)===retirementSha)releaseOwnedRef(evidenceRef,retirementSha,io)}catch(e){failures.push(e.message)}
    if(failures.length)throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${failures.join('; ')}`)
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

function parseReviewReplacement(commit) {
  const message=commit?.message ?? commit?.commit?.message ?? ''
  const match=/^db-coordination reviewer-replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=\d+)? failed-sequence=(\d+) prior-sequence=(\d+) failure-ref=([0-9a-f]{7,40})$/i.exec(message)??/^db-coordination reviewer-failure-replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})(?: slot=\d+)? failed-sequence=(\d+) prior-sequence=(\d+) failure-ref=(self) /i.exec(message)
  if(!match)throw new LaneError('reviewer replacement ref does not point to a recognized replacement')
  return {sequence:Number(match[1]),reviewer:match[2],issue:Number(match[3]),pr:Number(match[4]),headSha:match[5],failedSequence:Number(match[6]),priorSequence:Number(match[7]),failureSha:match[8]}
}

function requireReplacementEvidence(replacement,io,records=null){
  const ref=`${REVIEW_FAILURE_REF_PREFIX}/${replacement.issue}-${replacement.pr}-${replacement.headSha}-${replacement.failedSequence}`
  const expected=replacement.failureSha==='self'?replacement.recordSha:replacement.failureSha
  const recorded=records?.has(ref)?records.get(ref)?.sha??null:io.readRef(ref)
  if(!expected||recorded!==expected)throw new LaneError('immutable reviewer failure evidence is missing or changed')
}

// THE PREFLIGHT MUST PROVE THE PROVIDER ANSWERS, NOT JUST THAT A FILE EXISTS.
//
// It used to check `commandAvailable(wrapper)` and nothing more -- the wrapper
// binary is on PATH, so the preflight passed. Every review then died at
// execution with a generic `provider_unavailable`: a message about the MODEL
// that was actually about a stopped local service on this machine.
//
// That misdiagnosis benched glm-5.3 for two days (2026-08-18 to 2026-08-20) on
// three `provider_unavailable` failures at sequences 161, 164 and 167. The
// provider was fine the whole time; its local OpenCode server was not running,
// and `ai-glm doctor` said so in one line. During that window the rotation was
// effectively one reviewer, and a rotation of one is not a rotation.
//
// So the probe runs the wrapper's own `doctor` and QUOTES the failing check.
// Never soften this into a warning and never drop the check name: a pause that
// cannot say what failed is a guess, and the last guess cost two days.
export function reviewerExecutionPreflight({reviewer,wrapper,worktree,headSha,skipDoctor},io=githubIo){
  const approved=reviewersForOrchestrator(io.resolveOrchestratorEngine?.()).find((row)=>row.name===reviewer)
  if(!approved||approved.wrapper!==wrapper)throw new LaneError('reviewer preflight requires an approved reviewer and its exact wrapper')
  if(!/^[0-9a-f]{40}$/i.test(String(headSha??''))||!worktree)throw new LaneError('reviewer preflight requires an exact 40-character head SHA and worktree')
  if(!io.commandAvailable?.(wrapper))throw new LaneError(`reviewer preflight cannot execute ${wrapper}`)
  if(io.localHead(worktree)!==headSha)throw new LaneError('reviewer preflight worktree is not at the exact assigned head')
  if(!io.localClean(worktree))throw new LaneError('reviewer preflight worktree is dirty')
  let doctor=null
  if(!skipDoctor){
    // No doctor probe available is NOT a pass. Say so rather than reporting
    // ready:true on evidence that was never collected.
    if(typeof io.reviewerDoctor!=='function')throw new LaneError(`reviewer preflight cannot probe ${wrapper}: this io has no reviewerDoctor. Nothing was proved about the provider; do not record a failure against the reviewer.`)
    doctor=io.reviewerDoctor(wrapper)
    if(!doctor?.ok){
      const checks=(doctor?.failingChecks??[]).map((c)=>`"${c}"`).join(', ')||'an unnamed check'
      throw new LaneError(`reviewer preflight: ${wrapper} doctor reports ${checks} -- this is a LOCAL dependency fault on this machine, not a ${reviewer} provider fault. Fix the local service and retry the same reviewer. Do NOT pause ${reviewer} and do NOT record provider_unavailable against it.`)
    }
  }
  return {reviewer,wrapper,worktree,headSha,ready:true,doctorChecked:!skipDoctor,failingChecks:doctor?.failingChecks??[]}
}

function validateTerminalReviewerFailure(options,label='reviewer failure'){
  const request={issue:Number(options.issue),pr:Number(options.pr),headSha:String(options.headSha??''),failedSequence:Number(options.failedSequence),slot:Number(options.slot??1)}
  if(!Number.isInteger(request.issue)||!Number.isInteger(request.pr)||!/^[0-9a-f]{40}$/i.test(request.headSha)||!Number.isInteger(request.failedSequence))throw new LaneError(`${label} requires exact issue, PR, 40-character head SHA, and failed sequence`)
  if(!Number.isInteger(request.slot)||request.slot<1)throw new LaneError(`${label} slot must be a positive integer (1 = first reviewer, 2 = second independent reviewer)`)
  if(!TERMINAL_FAILURE_CODES.includes(String(options.failureCode??'')))throw new LaneError(`${label} requires a recognized terminal provider/tool failure code (${TERMINAL_FAILURE_CODES.join(', ')})`)
  if(String(options.failureCode)==='local_dependency_unavailable'){
    if(!String(options.failingCheck??'').trim())throw new LaneError('local_dependency_unavailable requires --failing-check naming the exact doctor check that failed. A failure record that cannot name the failing check is a guess.')
    if(!options.confirmLocalDependencyUnfixable)throw new LaneError(`this is a LOCAL dependency fault ("${String(options.failingCheck).trim()}"), not a provider fault. Fix it on this machine and retry the SAME reviewer. If it genuinely cannot be fixed here, re-run with --confirm-local-dependency-unfixable.`)
  }else if(String(options.failingCheck??'').trim())throw new LaneError('--failing-check applies only to local_dependency_unavailable')
  if(!options.confirmNoVerdict||!options.confirmNoArtifact)throw new LaneError(`${label} requires explicit confirmation that the failed session produced no verdict and no artifact`)
  return request
}

export function failedReviewerReleaseCommand(request,{failureCode,failingCheck}={}){
  const local=String(failureCode)==='local_dependency_unavailable'
    ?` --failing-check ${JSON.stringify(String(failingCheck))} --confirm-local-dependency-unfixable`
    :''
  return `--release-failed-reviewer --issue ${request.issue} --pr ${request.pr} --head-sha ${request.headSha} --failed-sequence ${request.failedSequence} --review-slot ${request.slot} --failure-code ${String(failureCode)}${local} --confirm-no-verdict --confirm-no-artifact`
}

function reviewerFailureRef(request){return `${REVIEW_FAILURE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${request.failedSequence}`}

function parseReviewRelease(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination reviewer-failure-release reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{40}) failed-sequence=(\d+) code=([a-z_]+)(?: failing-check=([^ ]+))? verdict=none artifact=none replacement=none$/i.exec(message)
  if(!match)throw new LaneError('reviewer release evidence is unreadable')
  return {reviewer:match[1],issue:Number(match[2]),pr:Number(match[3]),headSha:match[4],failedSequence:Number(match[5]),failureCode:match[6],failingCheck:match[7]??null}
}

function assertAssignmentWasNotTerminallyReleased(request,assignment,io){
  if(io.enableReviewerSilence){const silenceRef=silenceReleaseRef({...request,sequence:assignment.sequence}),silenceSha=io.readRef(silenceRef)
    if(silenceSha)throw new LaneError(`reviewer ${assignment.reviewer} silent lease was reclaimed with immutable evidence; assignment retry will not recreate its lease. Draw a new reviewer for this exact head and slot.`)}
  const ref=reviewerFailureRef({...request,failedSequence:assignment.sequence}),sha=io.readRef(ref)
  if(!sha)return
  const released=parseReviewRelease(io.getCommit(sha))
  if(released.issue===request.issue&&released.pr===request.pr&&released.headSha===request.headSha&&released.failedSequence===assignment.sequence&&released.reviewer===assignment.reviewer)throw new LaneError(`reviewer ${assignment.reviewer} terminal failure was released with immutable evidence; assignment retry will not recreate its lease. Use --replace-failed-reviewer for this sequence after capacity is available.`)
  throw new LaneError('reviewer failure evidence exists but does not match the durable assignment; assignment retry refused')
}

function resolveFailedReviewRecord(request,io){
  const slotSuffix=reviewSlotSuffix(request.slot),assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${slotSuffix}`,assignmentSha=io.readRef(assignmentRef)
  if(!assignmentSha)throw new LaneError(`no durable reviewer assignment exists for issue #${request.issue} PR #${request.pr} at the exact head`)
  const initial=parseReviewCursor(io.getCommit(assignmentSha)),replacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${slotSuffix}`
  const replacementRows=io.listRefs?.(replacementBase)??[]
  const replacements=replacementRows.filter((row)=>inReviewReplacementNamespace(row.ref,replacementBase)||(request.slot===1&&row.ref===replacementBase)).map((row)=>{const parsed=parseReviewReplacement(row.commit??io.getCommit(row.sha));return {...parsed,failureSha:parsed.failureSha==='self'?row.sha:parsed.failureSha}})
  for(const replacement of replacements)requireReplacementEvidence(replacement,io)
  const predecessors=replacements.filter((row)=>row.sequence===request.failedSequence)
  const original=request.failedSequence===initial.sequence?initial:predecessors.length===1?predecessors[0]:null
  if(!original||original.issue!==request.issue||original.pr!==request.pr||original.headSha!==request.headSha)throw new LaneError('durable reviewer assignment or replacement does not match the failure request')
  return original
}

export function releaseFailedReviewer(options,io=githubIo){
  return withReviewRequestBudget(()=>{
    io=reviewOperationIo(io)
    const request=validateTerminalReviewerFailure(options,'reviewer release'),failureRef=reviewerFailureRef(request)
    const original=resolveFailedReviewRecord(request,io),priorFailureSha=io.readRef(failureRef)
    if(priorFailureSha){
      const prior=parseReviewRelease(io.getCommit(priorFailureSha))
      if(prior.issue!==request.issue||prior.pr!==request.pr||prior.headSha!==request.headSha||prior.failedSequence!==request.failedSequence||prior.reviewer!==original.reviewer||prior.failureCode!==String(options.failureCode))throw new LaneError('immutable reviewer release evidence does not match this request')
      if(reviewLeaseRefCandidates({...original,slot:request.slot},Boolean(io.requiresExactReviewHeadSha)).some((candidate)=>leaseRefHoldsAssignment(candidate,{...original,slot:request.slot},io)))throw new LaneError('reviewer release evidence exists but the active lease is still present; reconciliation requires manual audit')
      throw new LaneError(`reviewer ${original.reviewer} terminal failure was already released with immutable evidence ${priorFailureSha}`)
    }
    const preflightBusy=findBusyReviewers(io,[request])
    if(!preflightBusy)throw new LaneError('active reviewer leases are unreadable; reviewer release refused before mutex acquisition')
    const state=preflightBusy.states?.get(`${request.issue}:${request.pr}`),issueRow=state?.issue??io.getIssue(request.issue),prRow=state?.pr??io.getPr(request.pr)
    if(!reviewIssueEligible(issueRow,prRow,io)||!reviewTargetEligible(prRow,io)||prRow?.head?.sha!==request.headSha)throw new LaneError('reviewer release requires the exact eligible PR head')
    if(hasVerdictForHead(request.issue,request.pr,request.headSha,io,{slot:request.slot}))throw new LaneError('an existing verdict for the exact head forbids reviewer release')
    const cached=activeLeaseRecordForAssignment(preflightBusy,{...original,slot:request.slot}),leaseRefForRelease=resolveAssignmentLeaseRef({...original,slot:request.slot},Boolean(io.requiresExactReviewHeadSha),io,preflightBusy),failedLeaseSha=cached?.sha??io.readRef(leaseRefForRelease),failedLease=failedLeaseSha?(cached?.sha===failedLeaseSha?cached.lease:parseReviewLease(io.getCommit(failedLeaseSha))):null
    // State the SLOT explicitly (#2694 review). The tuple compared here omitted the
    // slot, and was only safe because the single global sequence cursor keeps
    // sequences unique across slots. `leaseMatchesAssignment` already compares the
    // slot, so reuse it rather than depend on that invariant.
    if(!failedLease||!leaseMatchesAssignment(failedLease,{issue:request.issue,pr:request.pr,headSha:request.headSha,sequence:request.failedSequence,reviewer:original.reviewer,slot:request.slot}))throw new LaneError('failed reviewer active lease does not match the terminal failure evidence')
    if(typeof io.atomicReviewRefs!=='function'||typeof io.readReviewRefs!=='function')throw new LaneError('reviewer release requires atomic compare-and-swap ref support')
    const checkNote=String(options.failingCheck??'').trim()?` failing-check=${String(options.failingCheck).trim().replace(/\s+/g,'_')}`:''
    const failureSha=io.makeOwnerCommit(`db-coordination reviewer-failure-release reviewer=${original.reviewer} issue=${request.issue} pr=${request.pr} head=${request.headSha} failed-sequence=${request.failedSequence} code=${String(options.failureCode)}${checkNote} verdict=none artifact=none replacement=none`)
    const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-release-lock issue=${request.issue} pr=${request.pr} head=${request.headSha} failed-sequence=${request.failedSequence}`)
    let acquired=false
    try{
      requireReviewWireCapacity(8);acquireReviewMutex(ownerSha,io);acquired=true;requireOwnedRef(MUTEX_REF,ownerSha,io)
      const freshStates=io.readReviewStates([original]),fresh=freshStates?.get(`${request.issue}:${request.pr}`)
      if(!reviewIssueEligible(fresh?.issue,fresh?.pr,io)||!reviewTargetEligible(fresh?.pr,io)||fresh?.pr?.head?.sha!==request.headSha||hasVerdictForHead(request.issue,request.pr,request.headSha,io,{fresh:true,slot:request.slot}))throw new LaneError('reviewer release issue, PR head, or verdict changed after mutex acquisition')
      const locked=io.readReviewRefs([MUTEX_REF,failureRef,leaseRefForRelease])
      if(locked.get(MUTEX_REF)!==ownerSha||locked.get(failureRef)!==null||locked.get(leaseRefForRelease)!==failedLeaseSha)throw new LaneError('reviewer release ownership changed after preflight')
      io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},{ref:failureRef,expected:null,sha:failureSha},{ref:leaseRefForRelease,expected:failedLeaseSha,sha:null}])
      const after=io.readReviewRefs([MUTEX_REF,failureRef,leaseRefForRelease])
      if(after.get(MUTEX_REF)!==ownerSha||after.get(failureRef)!==failureSha||after.get(leaseRefForRelease)!==null)throw new LaneError('atomic reviewer release readback mismatch')
      return {...request,reviewer:original.reviewer,failureCode:String(options.failureCode),failureSha,releasedLeaseSha:failedLeaseSha}
    }finally{if(acquired)finalizeReviewMutex(ownerSha,io)}
  })
}

function replaceFailedReviewerOperation({issue,pr,headSha,failedSequence,failureCode,failingCheck,confirmLocalDependencyUnfixable,confirmNoVerdict,confirmNoArtifact,slot=1,admissionOptions=null},io){
  io=reviewOperationIo(io)
  const silenceReplacement=String(failureCode)==='silent_worker_observed'
  const request=silenceReplacement
    ?{issue:Number(issue),pr:Number(pr),headSha:String(headSha??''),failedSequence:Number(failedSequence),slot:Number(slot??1)}
    :validateTerminalReviewerFailure({issue,pr,headSha,failedSequence,failureCode,failingCheck,confirmLocalDependencyUnfixable,confirmNoVerdict,confirmNoArtifact,slot},'reviewer replacement')
  if(silenceReplacement&&(!Number.isInteger(request.issue)||!Number.isInteger(request.pr)||!/^[0-9a-f]{40}$/i.test(request.headSha)||!Number.isInteger(request.failedSequence)||!Number.isInteger(request.slot)||request.slot<1||!confirmNoVerdict||!confirmNoArtifact||String(failingCheck??'').trim()))throw new LaneError('silent reviewer replacement requires exact issue, PR, 40-character head SHA, failed sequence, review slot, no failing check, and explicit confirmation of no verdict and no artifact')
  const concurrentLeases=Boolean(io.requiresExactReviewHeadSha)
  const {eligible}=allocatableReviewers(io)
  const eligibleNames=new Set(eligible.map((row)=>row.name))
  // A LOCAL fault is not the reviewer's fault. Replacing on one spends a
  // rotation slot and records permanent evidence against a provider that was
  // working, which is exactly how glm-5.3 was benched for two days. The named
  // failing check is required so the evidence says what actually broke, and a
  // replacement is only issued once the operator states plainly that the local
  // fault cannot be fixed on this machine right now.
  const preflightBusy=findBusyReviewers(io,[request])
  if(!preflightBusy)throw new LaneError('active reviewer leases are unreadable; reviewer replacement refused before mutex acquisition')
  const preflightExclusions=reviewerExclusions(request.issue,request.pr,io)
  // Slot-aware, in the SAME namespaces assignment writes: a replacement request
  // for slot N resolves the failed sequence against slot N's own records and
  // nothing else. Slot 1 is byte-for-byte its historical unsuffixed namespace.
  // This is the gap #1832 reported -- the matcher below is unchanged and still
  // fails closed; it simply now gets shown the right records.
  const slotSuffix=reviewSlotSuffix(request.slot)
  const assignmentRef=`${REVIEW_ASSIGNMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${slotSuffix}`
  // Failure evidence stays keyed by the globally monotone sequence, which is
  // unique across slots, so it needs no suffix and older refs keep their names.
  const failureRef=`${REVIEW_FAILURE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${request.failedSequence}`
  const replacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${slotSuffix}`
  const replacementRef=`${replacementBase}-${request.failedSequence}`
  const assignmentVerdictRef=assignmentRef.replace(REVIEW_ASSIGNMENT_REF_PREFIX,REVIEW_VERDICT_REF_PREFIX)
  // Slot >=2 must stay independent of slot 1 after a replacement, not only at
  // first assignment. Resolved read-only, pre-mutex, exactly as assignment does.
  const excludedProvider=request.slot===1?null:resolveSlotOneReviewer(request.issue,request.pr,request.headSha,io)
  const failureBase=`${REVIEW_FAILURE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}`
  const fixedRecords=io.readReviewRecords?.([replacementRef,assignmentRef,REVIEW_CURSOR_REF,assignmentVerdictRef,failureRef],replacementBase,failureBase)??null
  let ownerSha=null,mutexAcquired=false
  try{
    let priorReplacement=fixedRecords?(fixedRecords.get(replacementRef)?.sha??null):io.readRef(replacementRef)
    // The first implementation used one unsuffixed immutable ref. Preserve it
    // as the first link while allowing later links to be appended safely.
    if(!priorReplacement){
      const legacyRow=request.slot===1?(fixedRecords?.matching??io.listRefs?.(replacementBase)??[]).find((row)=>row.ref===replacementBase):null
      if(legacyRow){const parsed=parseReviewReplacement(io.getCommit(legacyRow.sha));if(parsed.failedSequence===request.failedSequence)priorReplacement=legacyRow.sha}
    }
    if(priorReplacement){
      const rawParsed=parseReviewReplacement(fixedRecords?.get(replacementRef)?.sha===priorReplacement?fixedRecords.get(replacementRef).commit:io.getCommit(priorReplacement)),parsed={...rawParsed,failureSha:rawParsed.failureSha==='self'?priorReplacement:rawParsed.failureSha}, reviewer=REVIEWERS.find((r)=>r.name===parsed.reviewer)
      if(parsed.issue!==request.issue||parsed.pr!==request.pr||parsed.headSha!==request.headSha||parsed.failedSequence!==request.failedSequence||!reviewer)throw new LaneError('durable reviewer replacement does not match this retry')
      requireReplacementEvidence(parsed,io,fixedRecords)
      if(!eligibleNames.has(parsed.reviewer))throw new LaneError(`durable replacement sequence ${parsed.sequence} belongs to a retired, quarantined or orchestrator-conflicting reviewer ${parsed.reviewer}; its active lease was not recreated. Record a new governed replacement for this exact head`)
      const failed=activeLeaseRecordForJob(preflightBusy,{issue:request.issue,pr:request.pr,headSha:request.headSha,sequence:request.failedSequence})
      const liveReplacement=concurrentLeases?activeLeaseRecordForAssignment(preflightBusy,{...parsed,slot:request.slot}):preflightBusy.leases.get(parsed.reviewer)
      const replacementLeaseRef=liveReplacement?.ref??resolveAssignmentLeaseRef({...parsed,slot:request.slot},concurrentLeases,io,preflightBusy)
      const staleReplacement=preflightBusy.stale.find((row)=>row.ref===replacementLeaseRef)
      if(liveReplacement&&liveReplacement.sha!==priorReplacement&&!staleReplacement)throw new LaneError(`reviewer ${parsed.reviewer} has an unrelated live lease; idempotent replacement repair refused`)
      ownerSha=io.makeOwnerCommit(`db-coordination reviewer-replacement-lock issue=${request.issue} pr=${request.pr} head=${request.headSha}${request.slot!==1?` slot=${request.slot}`:''}`)
      requireReviewWireCapacity(11);acquireReviewMutex(ownerSha,io);mutexAcquired=true
      if(admissionOptions)requirePrOperationRoute(admissionOptions,io,{pr,headSha,issue,mutexOwner:ownerSha,allowMerged:true,reviewSnapshot:true})
      const freshStates=io.readReviewStates?.([parsed,...(staleReplacement?[staleReplacement.assignment]:[])])
      const freshExclusions=reviewerExclusions(request.issue,request.pr,io,{fresh:true})
      // Same deliberate refusal as the assignment paths: only --exclude-reviewer
      // retires a durable record, and it now does so for both namespaces.
      if(freshExclusions.has(parsed.reviewer))throw new LaneError(`durable replacement reviewer ${parsed.reviewer} is excluded for this PR (${freshExclusions.get(parsed.reviewer).reason}); re-run the identical --exclude-reviewer to return this slot. The returned record is a REPLACEMENT, so --assign-reviewer will not refill it: draw the new reviewer with --replace-failed-reviewer for the same --failed-sequence.`)
      assertReviewRequestEligible(request,freshStates,io)
      const replacementLive=isReviewAssignmentLive({...parsed,slot:request.slot},freshStates,io),replacementTarget=replacementLive?priorReplacement:null
      let failedDeleted=false,staleDeleted=false
      try{if(io.atomicReviewRefs){
          requireOwnedRef(MUTEX_REF,ownerSha,io)
          if(staleReplacement)assertReviewLeaseStillStale(staleReplacement,freshStates,io)
          const changes=[]
          changes.push({ref:MUTEX_REF,expected:ownerSha,sha:ownerSha})
          if(failed)changes.push({ref:failed.ref,expected:failed.sha,sha:null})
          changes.push({ref:replacementLeaseRef,expected:staleReplacement?.sha??(liveReplacement?.sha??null),sha:replacementTarget})
          io.atomicReviewRefs(changes)
          const after=io.readReviewRefs([MUTEX_REF,...(failed?[failed.ref]:[]),replacementLeaseRef])
          if(after.get(MUTEX_REF)!==ownerSha||(failed&&after.get(failed.ref)!==null)||after.get(replacementLeaseRef)!==replacementTarget)throw new LaneError('atomic idempotent replacement readback mismatch')
        }else if(io.readReviewRefs){
          const failedRef=failed?.ref??null,refs=io.readReviewRefs([MUTEX_REF,...(failedRef?[failedRef]:[]),replacementLeaseRef])
          if(refs.get(MUTEX_REF)!==ownerSha||(failed&&refs.get(failedRef)!==failed.sha)||(staleReplacement&&refs.get(replacementLeaseRef)!==staleReplacement.sha))throw new LaneError('idempotent replacement lease state changed after preflight')
          if(failed){io.deleteRef(failedRef);failedDeleted=true}
          if(staleReplacement){io.deleteRef(replacementLeaseRef);staleDeleted=true}
          if(replacementLive&&refs.get(replacementLeaseRef)!==priorReplacement&&!io.createRef(replacementLeaseRef,priorReplacement))throw new LaneError('idempotent replacement lease could not be restored')
          const after=io.readReviewRefs([MUTEX_REF,...(failedRef?[failedRef]:[]),replacementLeaseRef])
          if(after.get(MUTEX_REF)!==ownerSha||(failed&&after.get(failedRef)!==null)||after.get(replacementLeaseRef)!==replacementTarget)throw new LaneError('idempotent replacement lease readback mismatch')
        }else{
          if(failed&&io.readRef(failed.ref)===failed.sha){releaseOwnedRef(failed.ref,failed.sha,io);failedDeleted=true}
          if(staleReplacement&&io.readRef(replacementLeaseRef)===staleReplacement.sha){releaseOwnedRef(replacementLeaseRef,staleReplacement.sha,io);staleDeleted=true}
          if(replacementLive&&!io.createRef(replacementLeaseRef,priorReplacement)&&readRefAfterWrite(replacementLeaseRef,priorReplacement,io)!==priorReplacement)throw new LaneError('idempotent replacement lease could not be restored')
        }
      }catch(error){
        const rollback=[]
        try{if(failedDeleted&&!io.readRef(failed.ref))io.createRef(failed.ref,failed.sha)}catch(e){rollback.push(e.message)}
        try{if(staleDeleted&&!io.readRef(replacementLeaseRef))io.createRef(replacementLeaseRef,staleReplacement.sha)}catch(e){rollback.push(e.message)}
        if(rollback.length)throw new LaneError(`${error.message}; idempotent lease rollback incomplete: ${rollback.join('; ')}`)
        throw error
      }
      return {...parsed,slot:request.slot,wrapper:reviewer.wrapper,failureCode:String(failureCode),replacementSha:priorReplacement,replacementSequence:request.failedSequence,assignmentRef:replacementRef}
    }
    const assignmentSha=fixedRecords?.get(assignmentRef)?.sha??io.readRef(assignmentRef)
    if(!assignmentSha){
      const recordedElsewhere=findPrReviewAssignments(request.issue,request.pr,io)
      if(recordedElsewhere===null)throw new LaneError(`no durable reviewer assignment exists for issue #${request.issue} PR #${request.pr} at head ${request.headSha}`)
      const recorded=recordedElsewhere.find((row)=>row.sequence===request.failedSequence)??recordedElsewhere[0]
      if(recorded)throw new LaneError(describeMovedAssignmentHead(request,recorded))
      throw new LaneError(`no durable reviewer assignment exists for issue #${request.issue} PR #${request.pr} under ANY head; --assign-reviewer was never run for this pull request, so there is nothing to replace`)
    }
    const initial=parseReviewCursor(fixedRecords?.get(assignmentRef)?.sha===assignmentSha?fixedRecords.get(assignmentRef).commit:io.getCommit(assignmentSha))
    const replacementRows=(fixedRecords?.matching??io.listRefs?.(replacementBase)??[]).filter((row)=>inReviewReplacementNamespace(row.ref,replacementBase))
    const parsedReplacements=replacementRows.map((row)=>{const parsed=parseReviewReplacement(row.commit??io.getCommit(row.sha));return {...parsed,ref:row.ref,assignmentSha:row.sha,failureSha:parsed.failureSha==='self'?row.sha:parsed.failureSha}})
    for(const replacement of parsedReplacements)requireReplacementEvidence(replacement,io,fixedRecords)
    const predecessors=parsedReplacements.filter((row)=>row.sequence===request.failedSequence)
    const original=request.failedSequence===initial.sequence?initial:predecessors.length===1?predecessors[0]:null
    if(!original||original.issue!==request.issue||original.pr!==request.pr||original.headSha!==request.headSha)throw new LaneError('durable reviewer assignment or replacement does not match the replacement request')
    if(silenceReplacement){
      const releaseRef=silenceReleaseRef({...request,sequence:request.failedSequence}),releaseSha=io.readRef(releaseRef)
      if(!releaseSha)throw new LaneError('silent reviewer replacement requires immutable silence-release evidence for the exact failed sequence')
      const release=parseSilenceRelease(io.getCommit(releaseSha))
      if(release.issue!==request.issue||release.pr!==request.pr||release.headSha!==request.headSha||release.sequence!==request.failedSequence||release.reviewer!==original.reviewer)throw new LaneError('immutable silence-release evidence does not match the replacement request')
    }
    const releasedFailureSha=fixedRecords?(fixedRecords.get(failureRef)?.sha??null):io.readRef(failureRef)
    let releasedFailure=null
    if(releasedFailureSha){
      releasedFailure=parseReviewRelease(fixedRecords?.get(failureRef)?.sha===releasedFailureSha?fixedRecords.get(failureRef).commit:io.getCommit(releasedFailureSha))
      if(releasedFailure.issue!==request.issue||releasedFailure.pr!==request.pr||releasedFailure.headSha!==request.headSha||releasedFailure.failedSequence!==request.failedSequence||releasedFailure.reviewer!==original.reviewer||releasedFailure.failureCode!==String(failureCode))throw new LaneError('immutable reviewer release evidence does not match the replacement request')
    }
    const cursorSha=fixedRecords?.get(REVIEW_CURSOR_REF)?.sha??io.readRef(REVIEW_CURSOR_REF), cursor=parseReviewCursor(cursorSha?(fixedRecords?.get(REVIEW_CURSOR_REF)?.sha===cursorSha?fixedRecords.get(REVIEW_CURSOR_REF).commit:io.getCommit(cursorSha)):null)
    if(!cursor||cursor.sequence<request.failedSequence)throw new LaneError('reviewer cursor is behind the failed durable assignment')
    const preflightState=preflightBusy.states?.get(`${request.issue}:${request.pr}`)
    const issueRow=preflightState?.issue??io.getIssue(request.issue), prRow=preflightState?.pr??io.getPr(request.pr)
    if(!reviewIssueEligible(issueRow,prRow,io))throw new LaneError('review replacement requires an open issue or a merged pull request whose merge commit is in main')
    // Same eligibility rule as assignment, and it must be applied HERE, pre-mutex, not
    // only at the post-mutex recheck below: an open-only test at this point throws
    // before the merged-eligible gate is ever reached, which would leave replacement
    // impossible for a merged head even though assignment works.
    if(!reviewTargetEligible(prRow,io))throw new LaneError('review replacement requires the exact open PR head')
    // The mirror of the lookup above: here the assignment WAS found under the
    // head that was named, but the pull request has since moved past it. Same
    // truth, said plainly, instead of a technicality.
    if(prRow?.head?.sha!==request.headSha)throw new LaneError(`review replacement requires the exact open PR head: sequence=${initial.sequence} reviewer=${initial.reviewer} IS recorded for issue #${request.issue} PR #${request.pr} under head ${request.headSha}, but the pull request has since moved to head ${String(prRow?.head?.sha??'unknown')}. Nothing is missing. A push replaced the code under review, so a replacement reviewer would be bound to a commit the failed reviewer never saw. Assign a reviewer to the new code instead: --assign-reviewer --issue ${request.issue} --pr ${request.pr} --head-sha ${String(prRow?.head?.sha??'<current head>')}`)
    // #2079 x #2075. Two rules, both required, and neither may weaken the other.
    //
    // #2075 (PR #2080): only a create-only durable artifact is a verdict. Comment
    // prose -- including the governed runner's own findings comment -- is never
    // read here, so `anyVerdictFor(preflightState.evidence, ...)` is gone.
    //
    // #2079: a durable artifact blocks replacement only if the reviewer that
    // produced it could read the repository. `hasVerdictForHead` answers from ref
    // NAMES alone and attributes nothing, so on its own it would let the artifact
    // deepseek-chat left behind forbid the very replacement the refusal message
    // tells the operator to run -- the head would be permanently unreviewable.
    // `headVerdictBlocksReplacement` is `hasVerdictForHead` plus that attribution,
    // resolved through the assignment ref the verdict ref names, and it fails
    // CLOSED whenever attribution cannot be resolved.
    //
    // The artifact answering THIS assignment is a subset of the head-wide
    // listing, so the attributed head-wide check answers for it too and the
    // separate single-ref read it used to do is gone.
    const hasVerdict=headVerdictBlocksReplacement(request.issue,request.pr,request.headSha,io,{slot:request.slot})
    if(hasVerdict)throw new LaneError('an existing verdict for the exact head forbids reviewer replacement')
    // findBusyReviewers returns a complete, fail-closed snapshot of the static
    // reviewer catalog. It evaluates capacity only for today's drawable roster,
    // but it also carries an exact retired-reviewer lease when an older failure
    // names one. That lets replacement prove the historical ref's presence or
    // absence without two extra REST reads. Truly unknown legacy names retain
    // the strict direct-read path.
    const cachedFailed=activeLeaseRecordForAssignment(preflightBusy,{...original,slot:request.slot})
    const failedLeaseRef=cachedFailed?.ref??resolveAssignmentLeaseRef({...original,slot:request.slot},concurrentLeases,io,preflightBusy)
    const snapshotFailed=preflightBusy.leaseSnapshot?.get(failedLeaseRef)??null
    const failedReviewerIsCatalogued=[...REVIEWERS,...OVERFLOW_REVIEWERS].some((row)=>row.name===original.reviewer)
    const catalogAbsenceProved=failedReviewerIsCatalogued&&preflightBusy.leaseSnapshot instanceof Map
    const liveFailedLeaseSha=cachedFailed?.sha??snapshotFailed?.sha??(catalogAbsenceProved?null:io.readRef(failedLeaseRef))
    const liveFailedLease=liveFailedLeaseSha?(cachedFailed?.sha===liveFailedLeaseSha?cachedFailed.lease:snapshotFailed?.sha===liveFailedLeaseSha?parseReviewLease(snapshotFailed.commit):parseReviewLease(io.getCommit(liveFailedLeaseSha))):null
    // ISSUE #2106 -- the SECOND reviewer-pool deadlock mode, distinct from the
    // release-welded-to-replacement one #2075 records.
    //
    // A reviewer holds at most ONE active lease, so if this reviewer's lease ref
    // now names a DIFFERENT issue, PR, head or sequence, the lease this failure
    // is about has already been released and the reviewer has since been drawn
    // onto unrelated work. This used to throw, which made the replacement
    // impossible until that unrelated review finished -- and freeing every OTHER
    // reviewer in the pool could not help, because only this one reviewer being
    // idle would clear it. Two assignments during marker #2074 each needed four
    // draws for exactly this reason.
    //
    // Replacement does not need the failed lease. It needs the failed lease GONE,
    // and an unrelated lease proves it is. So an unrelated lease is now carried
    // through as "already released, not ours to touch": it is never deleted,
    // never rolled back, and every readback below expects it to survive the
    // replacement byte-for-byte. What is NOT relaxed: a lease that matches this
    // failure is still released exactly as before, and nothing about the failure
    // evidence, the verdict gate or the cursor is weakened.
    // The SLOT is part of the tuple (#2694 review): without it this match relied on
    // the single global sequence cursor keeping sequences unique across slots.
    const failedLeaseMatches=Boolean(liveFailedLease)&&leaseMatchesAssignment(liveFailedLease,{issue:request.issue,pr:request.pr,headSha:request.headSha,sequence:request.failedSequence,reviewer:original.reviewer,slot:request.slot})
    const unrelatedFailedLeaseSha=liveFailedLease&&!failedLeaseMatches?liveFailedLeaseSha:null
    const failedLeaseSha=failedLeaseMatches?liveFailedLeaseSha:null
    const failedLease=failedLeaseMatches?liveFailedLease:null
    // What the failed reviewer's lease ref must read AFTER a successful
    // replacement: empty when we released our own lease, unchanged when the ref
    // belongs to somebody else's review.
    const failedLeaseAfter=unrelatedFailedLeaseSha
    // The failing check rides along in the immutable evidence, so a later reader
    // can tell a real provider outage from a stopped local service without
    // re-deriving it from memory.
    const checkNote=String(failingCheck??'').trim()?` failing-check=${String(failingCheck).trim().replace(/\s+/g,'_')}`:''
    let failureSha
    // SKIP, DO NOT REFUSE (#1297). The rotation position is only a starting point.
    // Every provider that already failed on THIS exact head is excluded, and the
    // cursor is advanced past each excluded name so the durable sequence still
    // moves forward monotonically and stays consistent with the sequence this
    // replacement allocates. (Byte-identical retries come from the create-only
    // replacement ref read above, not from this advancement.)
    // Refuse only when no other active reviewer is left.
    const bySequence=new Map([[initial.sequence,initial.reviewer],...parsedReplacements.map((row)=>[row.sequence,row.reviewer])])
    const failedNames=new Set([original.reviewer])
    for(const row of parsedReplacements){const name=bySequence.get(row.failedSequence);if(name)failedNames.add(name)}
    let sequence=null, reviewer=null
    for(let offset=0;offset<ACTIVE_REVIEWERS.length;offset+=1){
      const candidateSequence=cursor.sequence+1+offset, candidate=ACTIVE_REVIEWERS[(candidateSequence-1)%ACTIVE_REVIEWERS.length]
      if(!eligibleNames.has(candidate.name)||failedNames.has(candidate.name)||(!concurrentLeases&&preflightBusy.has(candidate.name))||candidate.name===excludedProvider||preflightExclusions.has(candidate.name))continue
      sequence=candidateSequence;reviewer=candidate;break
    }
    // Compatibility hook for historical configurations that had an overflow
    // provider. The approved 2026-08-28 roster has none.
    if(!reviewer){
      const overflow=OVERFLOW_REVIEWERS.find((row)=>eligibleNames.has(row.name)&&!failedNames.has(row.name)&&(concurrentLeases||!preflightBusy.has(row.name))&&row.name!==excludedProvider&&!preflightExclusions.has(row.name))
      if(overflow){sequence=cursor.sequence+1+ACTIVE_REVIEWERS.length;reviewer=overflow}
    }
    if(!reviewer){
      const failedList=[...failedNames].filter((name)=>ACTIVE_REVIEWERS.some((row)=>row.name===name))
      const busyList=[...preflightBusy].filter((name)=>!failedNames.has(name)).map((name)=>{const rows=preflightBusy.byReviewer?.get(name)??(preflightBusy.leases.get(name)?[preflightBusy.leases.get(name)]:[]);return `${name}${rows.map((row)=>` #${row.lease.issue}/PR #${row.lease.pr}`).join('')}`})
      const unavailable=ACTIVE_REVIEWERS.map((row)=>row.name).filter((name)=>!failedNames.has(name)&&!preflightBusy.has(name)&&(!eligibleNames.has(name)||name===excludedProvider||preflightExclusions.has(name)))
      const releaseCommand=failedReviewerReleaseCommand(request,{failureCode,failingCheck})
      const compatiblePrefix=request.slot===1?'no other reviewer is available':'no other independent reviewer is available for slot '+request.slot
      throw new LaneError(`${compatiblePrefix}; no replacement reviewer is available: ${failedList.length} of ${ACTIVE_REVIEWERS.length} already failed on this exact head (${failedList.join(', ')||'none'}); ${busyList.length} of ${ACTIVE_REVIEWERS.length} hold other live leases (${busyList.join(', ')||'none'}); ${unavailable.length} are otherwise ineligible or excluded (${unavailable.join(', ')||'none'}). If this failed holder must be freed before another terminal holder can be reclaimed, run ${releaseCommand}.`)
    }
    const replacementSha=io.makeOwnerCommit(releasedFailureSha
      ?`db-coordination reviewer-replacement sequence=${sequence} reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha} slot=${request.slot} failed-sequence=${request.failedSequence} prior-sequence=${cursor.sequence} failure-ref=${releasedFailureSha}`
      :`db-coordination reviewer-failure-replacement sequence=${sequence} reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha} slot=${request.slot} failed-sequence=${request.failedSequence} prior-sequence=${cursor.sequence} failure-ref=self failed-reviewer=${original.reviewer} code=${failureCode}${checkNote} verdict=none artifact=none`)
    failureSha=releasedFailureSha??replacementSha;ownerSha=replacementSha
    const cursorReplacementSha=replacementSha
    const replacementLeaseRef=reviewLeaseRefForAssignment({...request,reviewer:reviewer.name,sequence},concurrentLeases)
    const replacementLeaseSha=cursorReplacementSha
    const replacementStale=preflightBusy.stale.find((row)=>row.ref===replacementLeaseRef)
    let failureCreated=false, cursorUpdated=false,failedLeaseReleased=false,replacementStaleReleased=false,replacementLeaseCreated=false
    requireReviewWireCapacity(12);acquireReviewMutex(ownerSha,io);mutexAcquired=true
    try{
      if(admissionOptions)requirePrOperationRoute(admissionOptions,io,{pr,headSha,issue,mutexOwner:ownerSha,allowMerged:true,reviewSnapshot:true})
      const freshExclusions=reviewerExclusions(request.issue,request.pr,io,{fresh:true})
      if(freshExclusions.has(reviewer.name))throw new LaneError(`selected replacement reviewer ${reviewer.name} became excluded for this PR before mutex acquisition; retry to select from the fresh roster`)
      if(io.atomicReviewRefs){
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        const freshStates=io.readReviewStates([original,...(replacementStale?[replacementStale.assignment]:[])])
        const fresh=freshStates?.get(`${request.issue}:${request.pr}`)
        // Same attributed, durable-only rule as the pre-mutex check above (#2079 x
        // #2075). A plain `hasVerdictForHead` here would re-open the exact hole the
        // pre-mutex check closes, one mutex acquisition later.
        const freshVerdict=headVerdictBlocksReplacement(request.issue,request.pr,request.headSha,io,{fresh:true,slot:request.slot})
        if(!reviewIssueEligible(fresh?.issue,fresh?.pr,io)||!reviewTargetEligible(fresh?.pr,io)||fresh?.pr?.head?.sha!==request.headSha||freshVerdict)throw new LaneError('review replacement issue, PR head, or verdict changed after mutex acquisition')
        assertReviewLeaseStillStale(replacementStale,freshStates,io)
        const changes=[
          {ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},
          {ref:failureRef,expected:releasedFailureSha??null,sha:failureSha},
          {ref:REVIEW_CURSOR_REF,expected:cursorSha,sha:cursorReplacementSha},
          {ref:replacementRef,expected:null,sha:replacementSha},
          {ref:replacementLeaseRef,expected:replacementStale?.sha??null,sha:replacementLeaseSha},
        ]
        if(failedLeaseSha)changes.splice(changes.length-1,0,{ref:failedLeaseRef,expected:failedLeaseSha,sha:null})
        else if(unrelatedFailedLeaseSha)changes.splice(changes.length-1,0,{ref:failedLeaseRef,expected:unrelatedFailedLeaseSha,sha:unrelatedFailedLeaseSha})
        io.atomicReviewRefs(changes)
        const refs=io.readReviewRefs([MUTEX_REF,failureRef,REVIEW_CURSOR_REF,replacementRef,failedLeaseRef,replacementLeaseRef])
        if(refs.get(MUTEX_REF)!==ownerSha||refs.get(failureRef)!==failureSha||refs.get(REVIEW_CURSOR_REF)!==cursorReplacementSha||refs.get(replacementRef)!==replacementSha||refs.get(failedLeaseRef)!==failedLeaseAfter||refs.get(replacementLeaseRef)!==replacementLeaseSha)throw new LaneError('atomic review replacement readback mismatch')
        return {sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request,priorSequence:cursor.sequence,failureCode:String(failureCode),failureSha,replacementSha,replacementSequence:request.failedSequence,assignmentRef:replacementRef}
      }
      if(io.readReviewRefs){
        const locked=io.readReviewRefs([MUTEX_REF,REVIEW_CURSOR_REF,failedLeaseRef,...(replacementStale?[replacementLeaseRef]:[])])
        if(locked.get(MUTEX_REF)!==ownerSha||locked.get(REVIEW_CURSOR_REF)!==cursorSha||locked.get(failedLeaseRef)!==liveFailedLeaseSha||(replacementStale&&locked.get(replacementLeaseRef)!==replacementStale.sha))throw new LaneError('review replacement state changed after preflight')
      }else {requireOwnedRef(MUTEX_REF,ownerSha,io);if(io.readRef(REVIEW_CURSOR_REF)!==cursorSha)throw new LaneError('reviewer cursor changed after preflight')}
      if(releasedFailureSha){if(io.readRef(failureRef)!==releasedFailureSha)throw new LaneError('review release evidence changed after preflight')}
      else {if(!io.createRef(failureRef,failureSha))throw new LaneError('review failure evidence already exists without a replacement; manual audit required');failureCreated=true}
      if(!io.readReviewRefs&&readRefAfterWrite(failureRef,failureSha,io)!==failureSha)throw new LaneError('immutable review failure evidence could not be proved')
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      io.updateRef(REVIEW_CURSOR_REF,cursorReplacementSha);cursorUpdated=true
      if(!io.readReviewRefs&&readRefAfterWrite(REVIEW_CURSOR_REF,cursorReplacementSha,io)!==cursorReplacementSha)throw new LaneError('reviewer cursor replacement could not be proved')
      if(!io.createRef(replacementRef,replacementSha))throw new LaneError('review replacement record was created concurrently')
      if(!io.readReviewRefs&&readRefAfterWrite(replacementRef,replacementSha,io)!==replacementSha)throw new LaneError('review replacement record could not be proved')
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      if(failedLeaseSha){if(io.readReviewRefs){io.deleteRef(failedLeaseRef);failedLeaseReleased=true}else if(io.readRef(failedLeaseRef)===failedLeaseSha){releaseOwnedRef(failedLeaseRef,failedLeaseSha,io);failedLeaseReleased=true}}
      if(replacementStale){if(io.readReviewRefs){io.deleteRef(replacementLeaseRef);replacementStaleReleased=true}else if(io.readRef(replacementLeaseRef)===replacementStale.sha){releaseOwnedRef(replacementLeaseRef,replacementStale.sha,io);replacementStaleReleased=true}}
      if(!io.createRef(replacementLeaseRef,replacementLeaseSha)&&readRefAfterWrite(replacementLeaseRef,replacementLeaseSha,io)!==replacementLeaseSha)throw new LaneError(`replacement reviewer ${reviewer.name} has a conflicting active lease`)
      replacementLeaseCreated=true
      if(io.readReviewRefs){
        const refs=io.readReviewRefs([MUTEX_REF,failureRef,REVIEW_CURSOR_REF,replacementRef,failedLeaseRef,replacementLeaseRef])
        if(refs.get(MUTEX_REF)!==ownerSha||refs.get(failureRef)!==failureSha||refs.get(REVIEW_CURSOR_REF)!==cursorReplacementSha||refs.get(replacementRef)!==replacementSha||refs.get(failedLeaseRef)!==failedLeaseAfter||refs.get(replacementLeaseRef)!==replacementLeaseSha)throw new LaneError('batched review replacement readback mismatch')
      }
      return {sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request,priorSequence:cursor.sequence,failureCode:String(failureCode),failureSha,replacementSha,replacementSequence:request.failedSequence,assignmentRef:replacementRef}
    }catch(error){
      const rollback=[]
      try{if(replacementLeaseCreated&&io.readRef(replacementLeaseRef)===replacementLeaseSha)releaseOwnedRef(replacementLeaseRef,replacementLeaseSha,io)}catch(e){rollback.push(e.message)}
      try{if(replacementStaleReleased&&!io.readRef(replacementLeaseRef)&&!io.createRef(replacementLeaseRef,replacementStale.sha))throw new LaneError('replacement stale lease rollback could not be proved')}catch(e){rollback.push(e.message)}
      try{if(failedLeaseReleased&&!io.readRef(failedLeaseRef)&&!io.createRef(failedLeaseRef,failedLeaseSha))throw new LaneError('failed reviewer lease rollback could not be proved')}catch(e){rollback.push(e.message)}
      try{if(io.readRef(replacementRef)===replacementSha)releaseOwnedRef(replacementRef,replacementSha,io)}catch(e){rollback.push(e.message)}
      try{if(cursorUpdated&&io.readRef(REVIEW_CURSOR_REF)===cursorReplacementSha){io.updateRef(REVIEW_CURSOR_REF,cursorSha);if(readRefAfterWrite(REVIEW_CURSOR_REF,cursorSha,io)!==cursorSha)throw new LaneError('cursor rollback could not be proved')}}catch(e){rollback.push(e.message)}
      try{if(failureCreated&&io.readRef(failureRef)===failureSha)releaseOwnedRef(failureRef,failureSha,io)}catch(e){rollback.push(e.message)}
      if(rollback.length)throw new LaneError(`review replacement failed (${error.message}) and rollback was incomplete: ${rollback.join('; ')}`)
      throw error
    }
  }finally{if(mutexAcquired)finalizeReviewMutex(ownerSha,io)}
}

export function replaceFailedReviewer(request,io=githubIo){return withReviewRequestBudget(()=>replaceFailedReviewerOperation(request,reviewOperationIo(io)))}

// REVIEWER-INDEX CUTOVER ACTIVATION (issue #1777 handover). `findBusyReviewers`
// REFUSES outright when `REVIEW_ACTIVE_CUTOVER_REF` is absent (see its
// FAIL-CLOSED comment above), so that ref must never be created bare. Any
// review already live on an open PR's CURRENT head, assigned before this
// activation ran, needs its `REVIEW_ACTIVE_REF_PREFIX` lease backfilled FIRST
// -- otherwise the busy probe would silently lose visibility into it the
// instant cutover flips on, and a second reviewer could be handed a provider
// that is already working.
//
// BOUNDED. The live audit walks every currently OPEN pull request exactly
// once (`io.openPulls()`), which is bounded by this repository's open-PR
// count -- never all history and never every closed assignment ref ever
// written.
//
// FAIL-CLOSED ON AN UNPROVEN AUDIT. Any PR whose number or exact head SHA
// cannot be read, any matching assignment ref that cannot be parsed, any
// reviewer name the audit does not recognize, or any lease creation that
// cannot be proved by readback refuses the ENTIRE activation with no cutover
// ref written. A partially-audited cutover is worse than none: it would look
// active while actually blind to some in-flight review.
//
// IDEMPOTENT ON RETRY. If the cutover ref already exists this returns its
// recorded SHA immediately and performs no writes and no audit, so retrying
// after a network flake or an interrupted run never re-runs the audit and
// never risks a duplicate-ref race. The same race is handled mid-flight too:
// if another activation wins the create between this run's audit and its own
// `createRef`, the loser reads back the winner's SHA instead of erroring.
// A slot-2 assignment ref carries a `-slot{N}` suffix after the
// issue-pr-head tuple (see assignNextReviewerOperation's `slotSuffix`). The
// audit must recognize both shapes, or a live slot-2 review is invisible to
// it and its durable lease is never backfilled (issue #1798, medium finding).
function matchesAssignmentTuple(ref, number, headSha) {
  return new RegExp(`-${number}-${headSha}(?:-slot\\d+)?$`).test(ref)
}

// Replacement refs for the same tuple are written as
// `<issue>-<pr>-<head>[-slotN]` (the original single unsuffixed link) and
// `<issue>-<pr>-<head>[-slotN]-<failedSequence>` for every link after it, so
// both shapes have to match here (see replaceFailedReviewerOperation).

// SLOT-SCOPED, not merely tuple-scoped (issue #1798 round 6, grok-4.6 blocking
// finding). Matching the tuple alone pools slot 1's and slot 2's replacements
// into ONE list, and the highest sequence in that pool then overwrites BOTH
// assignments. A slot-1 replacement would win the slot-2 assignment, leaving the
// live slot-2 reviewer with no lease and invisible to the busy probe -- the
// double-assignment hazard this activation exists to prevent. PR #1838 made the
// replacement WRITER slot-aware; this is the reader, and legacy unsuffixed
// slot-1 refs are still honoured, so the bad state was reachable on today's refs.
// A replacement belongs to an assignment only when the text after the tuple is
// that assignment's own slot suffix, optionally followed by the
// `-<failedSequence>` link number and nothing else.
function matchesReplacementForSlot(ref, number, headSha, slotSuffix) {
  return new RegExp(`-${number}-${headSha}${slotSuffix}(?:-\\d+)?$`).test(ref)
}

// The suffix an assignment ref carries after its tuple: '' for slot 1, `-slotN`
// above it. Read back off the ref itself, so the reader cannot disagree with
// what the writer produced.
function assignmentSlotSuffix(ref, number, headSha) {
  return new RegExp(`-${number}-${headSha}(-slot\\d+)?$`).exec(ref)?.[1] ?? ''
}

function matchesReplacementTuple(ref, number, headSha) {
  return new RegExp(`-${number}-${headSha}(?:-slot\\d+)?(?:-\\d+)?$`).test(ref)
}

function activateReviewCutoverOperation(io) {
  const already = io.readRef(REVIEW_ACTIVE_CUTOVER_REF)
  if (already) return { activated: false, alreadyActive: true, cutoverSha: already, backfilled: [] }
  if (typeof io.openPulls !== 'function' || typeof io.listRefs !== 'function') {
    throw new LaneError('review cutover activation requires openPulls and listRefs; refusing an unproven audit')
  }
  // ENTRY GATE, re-derived (issue #1798 round 6, grok-4.6). This used to reserve
  // a bare 15 -- the in-lock reserve from a slot-2 design that was DELETED when
  // this branch deferred to #1813. It survived the merge as a number attached to
  // nothing, and it sat here rather than at the mutex acquire, so it guaranteed
  // release of nothing. Measured on this head: 3 requests are already spent when
  // control reaches this line, 7 more are spent before the mutex (openPulls, 4
  // assignment ref pages, the active-lease read, the owner commit), and the
  // mutex-held section reserves 11 at its own acquire site below. 7 + 11 is what
  // an operation still has to be able to afford here, so 18 is what it asks for.
  requireReviewWireCapacity(18)
  const openPulls = io.openPulls()
  if (!Array.isArray(openPulls)) throw new LaneError('open PR audit did not return a readable list; cutover activation refused')
  // REF DISCOVERY (issue #1798, round 2). Two production I/O facts drive this
  // shape, both confirmed against githubIo rather than a test double:
  //
  //   1. `readReviewRecords(refs, prefix)` returns commit messages ONLY for the
  //      EXPLICIT `refs` it is given. Its `.matching` rows come from a separate
  //      REST listing and deliberately carry no commit message (see its own
  //      comment). Passing `[]` as `refs` also builds an EMPTY GraphQL
  //      selection set, which is a syntax error GitHub rejects outright. So the
  //      prefix listing cannot be the thing that supplies lease messages.
  //   2. `listRefs` refuses at 100 rows inside a wire budget, and these
  //      namespaces hold the repository's whole review history (370 assignment
  //      refs today), so it can never list them at all.
  //
  // Hence: page the listing explicitly (cheap {ref,sha} rows, counted), narrow
  // to the open-PR tuples LOCALLY for free, then spend ONE GraphQL call to read
  // messages for just that narrowed set. Cost stays flat in the number of live
  // reviews found. 19 is what this walk SPENDS on today's real page counts; the
  // budget is REVIEW_OPERATION_REQUEST_LIMIT, which is 22. Spend and ceiling are
  // different numbers and this comment used to conflate them (issue #1798 round 6).
  const pagedRefs = (prefix) => (typeof io.listReviewRefsPaged === 'function'
    ? io.listReviewRefsPaged(prefix)
    : (io.listRefs(prefix) ?? []))
  const assignmentRows = pagedRefs(REVIEW_ASSIGNMENT_REF_PREFIX)
  // Replacement refs matter for correctness, not just completeness:
  // `--replace-failed-reviewer` does NOT rewrite the assignment ref, so a
  // review that was replaced while live still names its FAILED reviewer there.
  // Backfilling that name would hand the cutover a lease for someone who is not
  // reviewing, and leave the reviewer who actually is invisible to the busy
  // probe -- the same blindness this activation exists to prevent.
  // Deferred: only paged when an open PR actually has a matching assignment,
  // which is the only case where a replacement could supersede its reviewer.
  // On a repository with no pre-cutover live review this listing is never made.
  let replacementRowsCache = null
  const replacementRefs = () => (replacementRowsCache ??= pagedRefs(REVIEW_REPLACEMENT_REF_PREFIX))
  const backfilled = []
  // One call, three jobs (issue #1798 round 2, to buy real headroom under the
  // budget rather than sitting exactly on it): it snapshots every existing
  // active lease, AND its GraphQL query carries defaultBranchRef, which warms
  // `reviewCommitBase` -- so the makeOwnerCommit below costs 1 request instead
  // of 3, and the existing-lease check below costs 0 instead of 1.
  const activeLeases = typeof io.readActiveReviewLeases === 'function' ? io.readActiveReviewLeases() : null
  const ownerSha = io.makeOwnerCommit('db-coordination reviewer-index-cutover-activation-audit')
  // RESERVE THE MUTEX-HELD SECTION, at the acquire site, the way the two sibling
  // acquire sites above do. The replacement ref listing runs INSIDE this lock, so
  // extra replacement pages and per-ref getCommit fallbacks are in-lock spend, and
  // hitting the hard budget wall mid-section is exactly what a reserve prevents.
  // Measured in-lock spend on the real 4+2 page path is 9; 11 leaves two above it,
  // because a reserve must be at least the spend and erring the other way is what
  // strands a held mutex.
  requireReviewWireCapacity(11)
  acquireReviewMutex(ownerSha, io)
  try {
    // Narrow to the open-PR tuples first -- pure local filtering, no requests.
    const narrowed = []
    for (const pr of openPulls) {
      const headSha = pr?.head?.sha
      const number = pr?.number
      if (!Number.isInteger(number) || !/^[0-9a-f]{40}$/i.test(String(headSha ?? ''))) {
        throw new LaneError(`open PR audit could not read an exact number and 40-character head SHA for ${JSON.stringify(pr?.number ?? pr)}; cutover activation refused`)
      }
      const assignments = assignmentRows.filter((row) => matchesAssignmentTuple(row.ref, number, headSha))
      narrowed.push({
        number,
        headSha,
        assignments,
        replacements: assignments.length ? replacementRefs().filter((row) => matchesReplacementTuple(row.ref, number, headSha)) : [],
      })
    }
    // ONE GraphQL call for every narrowed ref's commit message. Explicit refs
    // are the form readReviewRecords actually attaches messages to, and the
    // list is never empty here (the empty-selection-set query is invalid).
    const wantedRefs = [...new Set(narrowed.flatMap((row) => [...row.assignments, ...row.replacements].map((entry) => entry.ref)))]
    const messages = new Map()
    if (wantedRefs.length) {
      if (typeof io.readReviewRecords === 'function') {
        const records = io.readReviewRecords(wantedRefs, null)
        for (const ref of wantedRefs) {
          const record = records.get(ref)
          // `record.commit` is `{message: target.message}` and is TRUTHY even
          // when GraphQL returned no message at all (a non-Commit object, or an
          // empty message). Testing the record alone would let an empty message
          // through as if it had been read; the per-ref fallback below is what
          // must handle it, so the message itself is what is tested (issue
          // #1798 round 3, glm-5.3 High 1).
          if (record?.commit?.message) messages.set(ref, record.commit)
        }
      }
      // Any ref the batched read could not answer for is fetched individually
      // rather than skipped. A missing message must never look like "no live
      // review here" -- that is the fail-open this activation exists to avoid.
      for (const ref of wantedRefs) {
        if (messages.has(ref)) continue
        const row = narrowed.flatMap((entry) => [...entry.assignments, ...entry.replacements]).find((entry) => entry.ref === ref)
        const commit = io.getCommit(row.sha)
        if (!(commit?.message ?? commit?.commit?.message)) throw new LaneError(`review ref ${ref} has no readable commit message; cutover activation refused`)
        messages.set(ref, commit)
      }
    }
    const candidates = []
    for (const { number, headSha, assignments, replacements } of narrowed) {
      for (const row of assignments) {
        let lease
        try { lease = parseReviewCursor(messages.get(row.ref)) }
        catch (error) { throw new LaneError(`assignment ref ${row.ref} is unreadable: ${error.message}; cutover activation refused`) }
        if (!lease) throw new LaneError(`assignment ref ${row.ref} does not hold a readable reviewer cursor; cutover activation refused`)
        if (lease.pr !== number || lease.headSha !== headSha) throw new LaneError(`assignment ref ${row.ref} disagrees with its commit record (PR #${lease.pr}, head ${lease.headSha}); cutover activation refused`)
        // A replacement supersedes the assignment's reviewer for this exact
        // tuple, highest failure sequence winning -- the same precedence
        // resolveSlotOneReviewer and assignNextReviewerOperation already use.
        let reviewer = lease.reviewer
        let leaseSha = row.sha
        // REFUSE, never discard (issue #1798 round 3, glm-5.3 High 1). This half
        // of the loop used to catch a parse failure and drop the row, while the
        // assignment half three lines up refuses on exactly the same failure.
        // The two halves of a symmetric loop had diverged, and the consequence
        // was the original fail-open in a new place: a replacement record that
        // cannot be read makes the FAILED reviewer named on the assignment ref
        // look live, and leaves the reviewer who is actually reviewing invisible
        // to the busy probe -- the double-assignment hazard this whole
        // activation exists to prevent.
        const parsedReplacements = replacements
          .filter((entry) => matchesReplacementForSlot(entry.ref, number, headSha, assignmentSlotSuffix(row.ref, number, headSha)))
          .map((entry) => {
            let parsed
            try { parsed = parseReviewReplacement(messages.get(entry.ref)) }
            catch (error) { throw new LaneError(`replacement ref ${entry.ref} is unreadable: ${error.message}; cutover activation refused`) }
            if (!parsed) throw new LaneError(`replacement ref ${entry.ref} does not hold a readable replacement record; cutover activation refused`)
            return { parsed, sha: entry.sha }
          })
        for (const entry of parsedReplacements) {
          if (entry.parsed.pr !== number || entry.parsed.headSha !== headSha) throw new LaneError(`replacement ref for PR #${number} head ${headSha} disagrees with its commit record (PR #${entry.parsed.pr}, head ${entry.parsed.headSha}); cutover activation refused`)
        }
        if (parsedReplacements.length) {
          const winner = parsedReplacements.sort((a, b) => b.parsed.sequence - a.parsed.sequence)[0]
          reviewer = winner.parsed.reviewer
          leaseSha = winner.sha
        }
        if (!REVIEWERS.some((r) => r.name === reviewer)) throw new LaneError(`review ref ${row.ref} names an unrecognized reviewer ${reviewer}; cutover activation refused`)
        const assignment=parseAssignmentRef(row.ref)
        if(!assignment)throw new LaneError(`assignment ref ${row.ref} is malformed; cutover activation refused`)
        candidates.push({ row: { ref: row.ref, sha: leaseSha }, lease: { ...lease, reviewer, slot:assignment.slot }, number, headSha })
      }
    }
    // BATCHED VERDICT + EXISTING-LEASE CHECK (issue #1798 fix). The old code
    // spent one `getCommit`, three verdict-evidence REST/GraphQL calls, and
    // two ref reads PER MATCHING ASSIGNMENT -- so activation was
    // uncompletable within its own 19-request budget the moment there was an
    // actual live review to protect (the exact case this feature exists
    // for), even though it sailed through on the no-op cases the tests
    // exercised. `readReviewStates` and `readReviewRefs` each answer for
    // every candidate in ONE network call, so the audit's request count no
    // longer grows with the number of live reviews found.
    const states = candidates.length && typeof io.readReviewStates === 'function'
      ? io.readReviewStates(candidates.map((c) => c.lease))
      : null
    // #2694 review (slot 2, low finding 10). The backfill named leases by
    // PROVIDER while every other path now names them by ASSIGNMENT, so two
    // live pre-cutover reviews held by one provider collided here -- the second
    // was reported as "already holds a different active lease" and the whole
    // activation refused. Name them the way the rest of the module does.
    const cutoverParallel = Boolean(io.requiresExactReviewHeadSha)
    const candidateLeaseRef = (lease) => reviewLeaseRefForAssignment(lease, cutoverParallel)
    const leaseRefs = [...new Set(candidates.map((c) => candidateLeaseRef(c.lease)))]
    // Prefer the snapshot already taken above -- it covers every reviewer's
    // active-lease ref, so it answers this without another request.
    const existingLeases = activeLeases
      ? new Map(leaseRefs.map((ref) => [ref, activeLeases.get(ref)?.sha ?? null]))
      : (leaseRefs.length && typeof io.readReviewRefs === 'function' ? io.readReviewRefs(leaseRefs) : null)
    const toCreate = []
    for (const candidate of candidates) {
      const { row, lease, number, headSha } = candidate
      const state = states?.get(`${lease.issue}:${lease.pr}`)
      // Batched path uses the SAME shared predicate as every other consumer
      // (issue #1822, glm-5.3 seq 524 High). This used to carry its own
      // anywhere-in-body verdict test -- the exact defect #1822 exists to
      // delete -- on the path production actually takes, while
      // hasVerdictForHead below (the fallback) already used the shared rule.
      // A false verdict here `continue`s past lease creation, so the reviewer
      // that is genuinely reviewing never gets its protective lease, the busy
      // probe goes blind, and a second reviewer can be handed the same
      // provider: the double-assignment hazard this activation exists to
      // prevent, failing silently.
      const verdict = hasVerdictForHead(lease.issue, lease.pr, lease.headSha, io, leaseVerdictOptions(lease))
      if (verdict) continue
      const leaseRef = candidateLeaseRef(lease)
      const existingLease = existingLeases ? (existingLeases.get(leaseRef) ?? null) : io.readRef(leaseRef)
      if (existingLease === row.sha) continue
      if (existingLease) throw new LaneError(`reviewer ${lease.reviewer} already holds a different active lease at ${leaseRef}; cutover activation refused pending manual audit`)
      toCreate.push({ reviewer: lease.reviewer, issue: lease.issue, pr: number, headSha, ref: leaseRef, sha: row.sha })
    }
    // No read-then-check of the mutex before the ATOMIC path: the push below
    // carries `--force-with-lease=MUTEX_REF:ownerSha`, which GitHub evaluates
    // server-side as part of the same transaction. That is strictly stronger
    // than a separate read (which is TOCTOU by construction) and one request
    // cheaper. The non-atomic fallback below still checks explicitly, because
    // its writes are not transactional.
    if (io.atomicReviewRefs && io.readReviewRefs) {
      const changes = [
        { ref: MUTEX_REF, expected: ownerSha, sha: ownerSha },
        ...toCreate.map((c) => ({ ref: c.ref, expected: null, sha: c.sha })),
        { ref: REVIEW_ACTIVE_CUTOVER_REF, expected: null, sha: ownerSha },
      ]
      try { io.atomicReviewRefs(changes) }
      catch (error) {
        // A raced activation is the ONE expected failure here: another
        // activation won the create between our audit and this push. Read
        // back its winning SHA instead of erroring, same as the
        // non-batched path below.
        const raced = io.readRef(REVIEW_ACTIVE_CUTOVER_REF)
        if (raced && raced !== ownerSha) return { activated: false, alreadyActive: true, cutoverSha: raced, backfilled: [] }
        throw error
      }
      const verify = io.readReviewRefs([MUTEX_REF, REVIEW_ACTIVE_CUTOVER_REF, ...toCreate.map((c) => c.ref)])
      if (verify.get(MUTEX_REF) !== ownerSha || verify.get(REVIEW_ACTIVE_CUTOVER_REF) !== ownerSha || toCreate.some((c) => verify.get(c.ref) !== c.sha)) {
        throw new LaneError('batched review cutover activation readback mismatch')
      }
      backfilled.push(...toCreate.map(({ sha, ...rest }) => rest))
      return { activated: true, alreadyActive: false, cutoverSha: ownerSha, backfilled }
    }
    for (const c of toCreate) {
      requireOwnedRef(MUTEX_REF, ownerSha, io)
      if (!io.createRef(c.ref, c.sha) && readRefAfterWrite(c.ref, c.sha, io) !== c.sha) {
        throw new LaneError(`could not create or prove the active lease for reviewer ${c.reviewer} on PR #${c.pr}; cutover activation refused`)
      }
      backfilled.push({ reviewer: c.reviewer, issue: c.issue, pr: c.pr, headSha: c.headSha, ref: c.ref })
    }
    requireOwnedRef(MUTEX_REF, ownerSha, io)
    if (!io.createRef(REVIEW_ACTIVE_CUTOVER_REF, ownerSha)) {
      const raced = readRefAfterWrite(REVIEW_ACTIVE_CUTOVER_REF, ownerSha, io)
      if (!raced) throw new LaneError('review cutover ref could not be created or proven after the audit; activation refused')
      return { activated: false, alreadyActive: true, cutoverSha: raced, backfilled }
    }
    if (readRefAfterWrite(REVIEW_ACTIVE_CUTOVER_REF, ownerSha, io) !== ownerSha) {
      throw new LaneError('review cutover ref creation could not be proved by readback; activation refused')
    }
    return { activated: true, alreadyActive: false, cutoverSha: ownerSha, backfilled }
  } finally { finalizeReviewMutex(ownerSha, io) }
}

export function activateReviewCutover(io=githubIo){return withReviewRequestBudget(()=>activateReviewCutoverOperation(reviewOperationIo(io)))}

// Issues created at or after this instant must carry change_type and the other
// admission fields; only earlier in-flight work may use the legacy path.
export const ADMISSION_LEGACY_CUTOVER = '2026-09-11T18:00:00Z'

function trustedCompletionComments(comments=[]){return comments.filter((comment)=>{
  const association=String(comment?.author_association??comment?.authorAssociation??'').toUpperCase()
  const author=String(comment?.author??comment?.author_login??'').toLowerCase()
  return association==='OWNER'&&author==='u2giants'
})}

export function admitIssue(number, io = githubIo, { pr = null, actor = 'manage-migration-author-lanes', allowLegacy = false, timestamp } = {}) {
  let issue = io.getIssue(Number(number))
  let livePr=null
  let scope=null
  let reopenAfterValidation=false
  let completedClosedOutcome=false
  try {
    if(pr!==null){
      livePr=io.getPr(Number(pr))
      const linked=io.closingIssuesForPr(Number(pr))
      if(!Array.isArray(linked)||linked.length!==1||Number(linked[0]?.number)!==Number(number))throw new AdmissionError(`pull request #${pr} must close exactly admitted issue #${number}`)
      if(String(issue?.state??'').toLowerCase()==='closed'){
        if(!livePr?.merged_at||typeof io.updateIssue!=='function')throw new AdmissionError(`issue #${number} is closed and cannot be admitted`)
        const completion=typeof io.issueComments==='function'
          ?findCompletionRecord(trustedCompletionComments(io.issueComments(Number(number))))
          :null
        if(completion?.outcome==='live_verified'){
          if(completion.work_issue!==Number(number)||completion.pr!==Number(pr)||completion.merge_sha!==livePr.merge_commit_sha)throw new AdmissionError(`issue #${number} completed outcome does not match merged pull request #${pr}`)
          completedClosedOutcome=true
        }else reopenAfterValidation=true
        issue={...issue,state:'open'}
      }
    }
    scope = parseQueueScope(issue?.body ?? '')
    let admitted
    if(allowLegacy&&scope?.changeType===null){
      const created=Date.parse(String(issue?.created_at??issue?.createdAt??''))
      if(!Number.isFinite(created)||created>=Date.parse(ADMISSION_LEGACY_CUTOVER))throw new AdmissionError(`legacy admission without change_type is limited to issues created before ${ADMISSION_LEGACY_CUTOVER}; issue #${number} must declare the admission fields`)
      if(issue?.state!=='open'||scope.workType!=='structural'||scope.route!=='shared-db-orchestrator'||scope.status!=='ready'||!scope.writes.length)throw new AdmissionError('legacy in-flight work is not an open ready structural issue with exact writes')
      admitted={admitted:true,issue:Number(number),legacy:true,service_class:'standard-application'}
    }else admitted = evaluateAdmission(issue, scope, parseImpactBlock(issue?.body ?? ''))
    if (pr !== null) {
      const head=livePr?.head?.sha
      if(!head)throw new AdmissionError('pull request exact head is unreadable')
      const files=io.getPrFiles(Number(pr)).map((file)=>/^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(String(file?.filename??file?.path??''))&&file?.status!=='removed'
        ?{...file,content:io.getFileAt(file.filename??file.path,head)}:file)
      const inspection=inspectPrStructuralChange(files)
      const declared=[...scope.writes].sort()
      if(inspection.objects.length!==declared.length||inspection.objects.some((value,index)=>value!==declared[index]))throw new AdmissionError(`pull request #${pr} structural objects must exactly match admitted issue #${number} writes`)
      admitted={...admitted,actual_objects:inspection.objects,migrations:inspection.migrations}
    }
    if(reopenAfterValidation){
      io.updateIssue(Number(number),{state:'open'})
      issue=io.getIssue(Number(number))
      if(String(issue?.state??'').toLowerCase()!=='open')throw new AdmissionError(`issue #${number} did not reopen after its linked merge`)
    }
    if(!admitted.legacy&&!completedClosedOutcome&&io.issueComments&&io.commentIssue){
      let history=outcomeHistory(io.issueComments(Number(number)),number)
      if(!history.valid)throw new OutcomeError(`outcome history is invalid: ${history.problems.join('; ')}`)
      for(const state of ['entered','classified']){
        if((history.state?OUTCOME_STATES.indexOf(history.state):-1)>=OUTCOME_STATES.indexOf(state))continue
        advanceOutcome({issue:Number(number),state,actor,...(timestamp?{timestamp:new Date(timestamp).toISOString()}:{})},io)
        history=outcomeHistory(io.issueComments(Number(number)),number)
      }
    }
    return admitted
  } catch (error) {
    if(error instanceof AdmissionError&&!error.result&&/(contains no added or modified migration|(?:content|patch) is unreadable|contain no statement-leading schema DDL|contains unmodelled DDL)/.test(error.message)){
      error.result={reason:error.message,return_to:scope?.applicationReturnTo??'u2giants/shared-db',evidence_required:['readable pull request content containing acknowledged statement-leading schema DDL for the proposed structural change']}
    }
    if (error instanceof AdmissionError && error.result && io.commentIssue) {
      const refusal={event_type:'rejected_non_structural',work_issue:Number(number),actor,result:'refused',detail:error.result.reason,return_to:error.result.return_to,evidence_required:error.result.evidence_required}
      const event = coordinationEvent({
        eventType:refusal.event_type, workIssue:refusal.work_issue, actor:refusal.actor,
        timestamp:new Date().toISOString(), result:refusal.result, detail:refusal.detail,
        return_to:refusal.return_to, evidence_required:refusal.evidence_required,
      })
      io.commentIssue(Number(number), formatEventComment(event))
    }
    throw error
  }
}

function withAuthorMutex(label, io, options, operation) {
  const requestId = options.requestId ?? randomUUID()
  const ownerSha = io.makeOwnerCommit(`db-coordination ${label} ${requestId}`)
  acquireMutex(ownerSha, io, options.mutexAttempts ?? 100)
  try {
    requireOwnedRef(MUTEX_REF, ownerSha, io)
    return operation(ownerSha)
  } finally {
    if (io.readRef(MUTEX_REF) === ownerSha) releaseOwnedRef(MUTEX_REF, ownerSha, io)
  }
}

function admitIssueSerialized(number, io = githubIo, options = {}) {
  return withAuthorMutex('admission',io,options,()=>admitIssue(number,io,options))
}

export function resolveAdmittedIssueForPr(pr, io = githubIo) {
  if (!Number.isInteger(Number(pr)) || Number(pr) < 1) throw new LaneError('--resolve-admitted-issue-for-pr requires a pull request number')
  const linked = io.closingIssuesForPr(Number(pr))
  if (!Array.isArray(linked)) throw new LaneError('pull request closing-issue linkage is unreadable')
  if (linked.length !== 1) throw new LaneError(`pull request must close exactly one structural work issue; found ${linked.length}`)
  const result = admitIssueSerialized(Number(linked[0].number), io, { pr:Number(pr), allowLegacy:true })
  return { issue:Number(linked[0].number), pr:Number(pr), admission:result.admitted ? 'admitted' : 'refused' }
}

const MIGRATION_PATH = /^supabase\/migrations\/[^/]+\.sql$/
const REPOSITORY_MAINTENANCE_CHANGE_TYPES = new Set(['documentation','ci','reviewer-tooling','workflow','repo-maintenance'])

// Merge and reviewer machinery serves both database migrations and ordinary
// repository code. Derive that boundary from the live PR while the operation's
// mutex is held: a caller-provided bypass would turn a routing choice into an
// authority grant. Any migration path, including the old side of a rename,
// stays structural; unreadable inventory stays unknown and refuses. This result
// answers only whether DDL/object admission applies to review and guarded merge.
// It is not NO_DATABASE_PREVIEW evidence: the separate Step 2A impact classifier
// still decides whether executable code can affect database behavior, data, or
// permissions and must enter preview. Repository maintenance keeps every natural
// code gate here; it receives no structural claim or database-stage exemption.
export function derivePrOperationRoute(pr, io = githubIo, { headSha = null, issue = null, allowMerged = false, snapshot = null } = {}) {
  if (!Number.isInteger(Number(pr)) || Number(pr) < 1) throw new LaneError('operation routing requires a pull request number')
  if(snapshot!==null&&(!snapshot||typeof snapshot!=='object'||!Array.isArray(snapshot.files)||!Array.isArray(snapshot.linkedIssues)))throw new LaneError('operation routing snapshot is unreadable')
  const livePr=snapshot?.pr??io.getPr(Number(pr))
  const prState=String(livePr?.state??'open').toLowerCase(),eligibleState=prState==='open'||(allowMerged&&['closed','merged'].includes(prState)&&Boolean(livePr?.merged_at))
  if(!livePr||!eligibleState||!/^[0-9a-f]{40}$/i.test(String(livePr?.head?.sha??'')))throw new LaneError(`pull request #${pr} live head is unreadable or not eligible`)
  if(headSha!==null&&String(livePr.head.sha).toLowerCase()!==String(headSha).toLowerCase())throw new LaneError(`pull request #${pr} exact head changed before operation routing`)
  const files=snapshot?.files??io.getPrFiles(Number(pr))
  if(!Array.isArray(files)||!files.length)throw new LaneError(`pull request #${pr} complete file inventory is empty or unreadable`)
  const paths=[]
  for(const file of files){
    if(!file||typeof file.filename!=='string'||!file.filename.trim()||typeof file.status!=='string'||!file.status.trim())throw new LaneError(`pull request #${pr} complete file inventory contains an unreadable entry`)
    paths.push(file.filename)
    if(file.previous_filename!==undefined){
      if(typeof file.previous_filename!=='string'||!file.previous_filename.trim())throw new LaneError(`pull request #${pr} prior filename is unreadable`)
      paths.push(file.previous_filename)
    }
  }
  const linked=snapshot?.linkedIssues??io.closingIssuesForPr(Number(pr))
  if(!Array.isArray(linked)||linked.length!==1)throw new LaneError(`pull request must close exactly one work issue; found ${Array.isArray(linked)?linked.length:'an unreadable set'}`)
  const linkedNumber=Number(linked[0]?.number)
  if(!Number.isInteger(linkedNumber)||linkedNumber<1)throw new LaneError('pull request linked work issue identity is unreadable')
  if(issue!==null&&Number(issue)!==linkedNumber)throw new LaneError(`operation issue #${issue} does not match pull request #${pr} linked issue #${linkedNumber}`)
  // GraphQL exposes no prior filename. Only the statuses whose current path is
  // a complete description can enter repository-maintenance routing; copies,
  // renames, CHANGED/UNCHANGED, and future enum values stay structural so the
  // DDL admission check either proves them or refuses them.
  const completeCurrentPathStatuses=new Set(['added','modified','removed','deleted'])
  const structural=files.some((file)=>file.previous_filename!==undefined||!completeCurrentPathStatuses.has(String(file.status).toLowerCase()))||paths.some((value)=>MIGRATION_PATH.test(String(value).replace(/\\/g,'/')))
  if(structural)return {route:'structural',issue:linkedNumber,pr:Number(pr),headSha:livePr.head.sha}

  const work=snapshot?.linkedIssues?.[0]??io.getIssue(linkedNumber),scope=parseQueueScope(work?.body??'')
  if(String(work?.state??'open').toLowerCase()!=='open'||scope?.status!=='ready'||scope?.workType!=='repo-maintenance'||scope?.route!=='repo-maintenance'||scope?.writes?.length)throw new LaneError(`pull request #${pr} is not deterministic ready repository-maintenance work with no database objects`)
  let changeType=scope.changeType,legacy=false
  if(changeType===null){
    const created=Date.parse(String(work?.created_at??work?.createdAt??''))
    if(!Number.isFinite(created)||created>=Date.parse(ADMISSION_LEGACY_CUTOVER))throw new LaneError(`repository-maintenance issue #${linkedNumber} must declare a recognized non-structural change_type`)
    changeType='repo-maintenance';legacy=true
  }
  if(!NON_STRUCTURAL_CHANGE_TYPES.includes(changeType)||!REPOSITORY_MAINTENANCE_CHANGE_TYPES.has(changeType))throw new LaneError(`repository-maintenance issue #${linkedNumber} must declare a recognized repository-maintenance change_type`)
  return {route:'repo-maintenance',issue:linkedNumber,pr:Number(pr),headSha:livePr.head.sha,changeType,legacy}
}

// Issue #2802: routing and admission are one gate, and neither half is reviewer work.
// The whole body runs outside the reviewer operation's request accounting; the mutex
// ownership proof below is unchanged, so this still runs under the caller's held mutex.
function requirePrOperationRoute(options,io,args){
  if(io.enforceAdmission!==true)return null
  return withoutReviewRequestBudget(()=>requirePrOperationRouteGate(options,io,args))
}
function requirePrOperationRouteGate(options,io,{pr,headSha,issue,mutexOwner,allowMerged=false,reviewSnapshot=false,resolveStructuralIssue=false}){
  if(mutexOwner)requireOwnedRef(MUTEX_REF,mutexOwner,io)
  const snapshot=reviewSnapshot&&typeof io.readReviewerOperationRoute==='function'?io.readReviewerOperationRoute(pr):null
  const route=derivePrOperationRoute(pr,io,{headSha,issue,allowMerged,snapshot})
  if(route.route==='repo-maintenance')return route
  const admissionOptions=resolveStructuralIssue?{...options,admitIssue:route.issue}:options
  if(!Number.isInteger(Number(admissionOptions?.admitIssue))||Number(admissionOptions.admitIssue)!==route.issue)throw new LaneError(`structural pull request #${pr} requires --admit-issue ${route.issue}`)
  requireAdmission(admissionOptions,io,{pr,mutexOwner})
  return route
}

function requireAdmissionArguments(options,io,{pr=null}={}){
  if (io.enforceAdmission !== true) return null
  if (!Number.isInteger(Number(options.admitIssue)) || Number(options.admitIssue) <= 0) {
    throw new LaneError('--admit-issue <work issue> is required before claim, reviewer assignment, or shared-stage acquisition')
  }
  if (options.issue !== undefined && Number(options.issue) !== Number(options.admitIssue)) {
    throw new LaneError(`--admit-issue #${options.admitIssue} does not match --issue #${options.issue}`)
  }
  if(options.preparePreviewDispatch!==undefined&&Number(options.preparePreviewDispatch)!==Number(options.admitIssue))throw new LaneError(`--admit-issue #${options.admitIssue} does not match --prepare-preview-dispatch #${options.preparePreviewDispatch}`)
  if(pr===null&&(options.acquireExclusive||options.preparePreviewDispatch!==undefined))throw new LaneError('--pr <source pull request> is required so admission can inspect the actual shared-stage change')
}

// Issue #2802: see withoutReviewRequestBudget. Admission's requests are not reviewer
// requests, so they are not charged to a reviewer operation's derived ceiling. Argument
// validation stays outside because it makes no GitHub request at all.
function requireAdmission(options, io, args = {}) {
  requireAdmissionArguments(options,io,{pr:args.pr??null})
  if (io.enforceAdmission !== true) return null
  return withoutReviewRequestBudget(()=>requireAdmissionGate(options,io,args))
}
function requireAdmissionGate(options, io, { pr = null, timestamp, mutexOwner = null } = {}) {
  if(mutexOwner)requireOwnedRef(MUTEX_REF,mutexOwner,io)
  const admitted=mutexOwner
    ? admitIssue(Number(options.admitIssue), io, { pr, allowLegacy:pr!==null, timestamp })
    : admitIssueSerialized(Number(options.admitIssue), io, { pr, allowLegacy:pr!==null, timestamp })
  if(options.claim){
    const requested=validateClaimObjects(options.objects??[]).sort()
    const authorized=[...(admitted.writes??[])].sort()
    if(requested.length!==authorized.length||requested.some((value,index)=>value!==authorized[index]))throw new LaneError(`--claim objects must exactly match admitted issue #${options.admitIssue} writes`)
  }
  return admitted
}

export function acquireAuthorLane(options, now = new Date(), io = githubIo) {
  options = { ...options, objects: validateClaimObjects(options.objects) }
  if(io.enforceAdmission===true&&(!Number.isInteger(Number(options.admitIssue))||Number(options.admitIssue)<=0))throw new LaneError('--admit-issue <work issue> is required before claim, reviewer assignment, or shared-stage acquisition')
  const requestId = options.requestId ?? randomUUID()
  const ownerSha = io.makeOwnerCommit(`db-coordination author-acquisition ${requestId}`)
  acquireMutex(ownerSha, io, options.mutexAttempts ?? 100)
  try {
    const admitted=requireAdmission(options,io,{timestamp:now,mutexOwner:ownerSha})
    if(io.enforceAdmission===true){
      const authorized=[...(admitted?.writes??[])].sort()
      if(options.objects.length!==authorized.length||options.objects.some((value,index)=>value!==authorized[index]))throw new LaneError(`--claim objects must exactly match admitted issue #${options.admitIssue} writes`)
    }
    const claims = io.openClaims()
    const prSources = io.prSources()
    assertLaneAvailable(claims, options.objects, now, { prSources })
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const reservation = io.reserveVersion()
    const expiresAt = new Date(now.valueOf() + options.leaseHours * 3600000)
    const body = claimBody({ ...options, version: reservation.version, expiresAt })
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const url = io.createClaim(options.task, body)
    const dispatchArgs={issue:Number(options.admitIssue),state:'dispatched',actor:options.owner,timestamp:now.toISOString(),evidenceUrls:[url]}
    const expectedDispatch=io.enforceAdmission===true?outcomeEvent(dispatchArgs):null
    try {
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      if(io.enforceAdmission===true)advanceOutcome(dispatchArgs,io)
    }
    catch(error) {
      if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`lost mutex ownership after claim creation; claim ${url} remains protected for explicit recovery: ${error.message}`)
      if(expectedDispatch){
        const delays=[0,250,500,1000,1500,2000]
        for(const delay of delays){
          if(delay)(io.wait??((ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)))(delay)
          requireOwnedRef(MUTEX_REF,ownerSha,io)
          const history=outcomeHistory(io.issueComments(Number(options.admitIssue)),Number(options.admitIssue))
          if(!history.valid)throw new LaneError(`dispatch readback is invalid; claim ${url} remains protected for explicit recovery: ${history.problems.join('; ')}`)
          if(history.events.some((event)=>event.event_id===expectedDispatch.event_id))return { version:reservation.version,claim:url,expiresAt:expiresAt.toISOString(),requestId }
        }
        throw new LaneError(`dispatch readback remained ambiguous after bounded retries; claim ${url} remains protected for explicit recovery: ${error.message}`)
      }
      throw new LaneError(`claim ${url} remains protected for explicit recovery: ${error.message}`)
    }
    return { version: reservation.version, claim: url, expiresAt: expiresAt.toISOString(), requestId }
  } finally {
    // If recovery already replaced us, never delete the successor's lock and
    // never mask the original lost-ownership refusal.
    if (io.readRef(MUTEX_REF) === ownerSha) releaseOwnedRef(MUTEX_REF, ownerSha, io)
  }
}

const SPLIT_REMAINDER = 'index plm.item_upper_trim_item_number_idx'
function workstreamKey(title) {
  const match = /^CLAIM:\s+(?:issue\s+)?#?([0-9]+(?:\/#?[0-9]+)*)\b/i.exec(String(title ?? ''))
  if (!match) throw new LaneError('claim title does not identify one exact issue workstream')
  return match[1].split('/').map((issue) => `#${issue.replace(/^#/, '')}`).join('/')
}
function migrationVersions(files) {
  const namedFiles=files.map((file)=>({file,name:file.filename ?? file.path ?? ''}))
  if(namedFiles.some(({file,name})=>file.status==='removed'&&name.startsWith('supabase/migrations/')))throw new LaneError('pull request removes a migration file; split recovery refuses it')
  return namedFiles.map(({name})=>/^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(name)?.[1]).filter(Boolean)
}
function replaceLeaseLocation(body, branch, worktree) {
  const fence=/```db-author-lease\s*\n([\s\S]*?)```/.exec(body)
  if(!fence)throw new LaneError('active claim has no manager-owned author lease block')
  let block=fence[1]
  if((block.match(/^branch:/gm)??[]).length!==1||(block.match(/^worktree:/gm)??[]).length!==1)throw new LaneError('active claim lease location is ambiguous')
  block=block.replace(/^branch:.*$/m,`branch: ${branch}`).replace(/^worktree:.*$/m,`worktree: ${worktree}`)
  return body.slice(0,fence.index)+fence[0].replace(fence[1],()=>block)+body.slice(fence.index+fence[0].length)
}
function replaceClaimObjects(body, version, objects) {
  const fences=[...body.matchAll(/```db-claim\s*\n[\s\S]*?```/g)]
  if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-claim block')
  const replacement=['```db-claim',`version: ${version}`,'objects:',...objects.map((object)=>`  - ${normalizeObject(object)}`),'```'].join('\n')
  return body.slice(0,fences[0].index)+replacement+body.slice(fences[0].index+fences[0][0].length)
}

function replaceLeaseExpiry(body, expiresAt) {
  const fences=[...body.matchAll(/```db-author-lease\s*\n([\s\S]*?)```/g)]
  if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-author-lease block')
  const block=fences[0][1], matches=block.match(/^expires_at:\s*.+$/gm)??[]
  if(matches.length!==1)throw new LaneError('claim lease expiry is ambiguous')
  const replacement=block.replace(/^expires_at:\s*.+$/m,`expires_at: ${expiresAt.toISOString()}`)
  return body.slice(0,fences[0].index)+fences[0][0].replace(block,()=>replacement)+body.slice(fences[0].index+fences[0][0].length)
}

function replaceCapacityState(body, capacityState, blockedOn = null) {
  if (!AUTHOR_CAPACITY_STATES.includes(capacityState)) throw new LaneError('invalid author capacity state')
  if (capacityState === 'relinquished' && !blockedOn) throw new LaneError('relinquished author capacity requires blocked_on')
  if (capacityState !== 'relinquished' && blockedOn) throw new LaneError('blocked_on is only valid for relinquished capacity')
  const fences=[...body.matchAll(/```db-author-lease\s*\n([\s\S]*?)```/g)]
  if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-author-lease block')
  let block=fences[0][1]
  const capacityMatches=block.match(/^capacity_state:\s*.+$/gm)??[]
  if(capacityMatches.length>1)throw new LaneError('claim capacity state is ambiguous')
  block=capacityMatches.length
    ? block.replace(/^capacity_state:\s*.+$/m,`capacity_state: ${capacityState}`)
    : `${block.replace(/\s*$/,'')}\ncapacity_state: ${capacityState}\n`
  const blockedMatches=block.match(/^blocked_on:\s*.+$/gm)??[]
  if(blockedMatches.length>1)throw new LaneError('claim blocked_on is ambiguous')
  if(blockedMatches.length) block=block.replace(/^blocked_on:\s*.+\r?\n?/m,'')
  if(blockedOn) block=`${block.replace(/\s*$/,'')}\nblocked_on: ${blockedOn}\n`
  return body.slice(0,fences[0].index)+fences[0][0].replace(fences[0][1],()=>block)+body.slice(fences[0].index+fences[0][0].length)
}

function claimTitleIssues(claim) {
  return [...String(claim.title??'').matchAll(/#(\d+)\b/g)].map((match)=>Number(match[1]))
}

function claimTitleWorkIssue(claim) {
  const matches=claimTitleIssues(claim)
  return matches.length===1?matches[0]:null
}

function claimWorkIssue(claim) {
  const issue=claimTitleWorkIssue(claim)
  if(issue===null)throw new LaneError('claim title must identify exactly one work issue for capacity transition events')
  return issue
}

function validateCapacityBlocker(blockedOn, io) {
  const issue=/^issue:#?(\d+)$/.exec(String(blockedOn??''))
  if(issue){
    const blocker=io.getIssue(Number(issue[1]))
    if(!blocker||blocker.state!=='open')throw new LaneError(`blocked_on issue #${issue[1]} is not durably open`)
    return `issue:#${issue[1]}`
  }
  const artifact=/^artifact:(https:\/\/\S+|[0-9a-f]{40,64})$/i.exec(String(blockedOn??''))
  if(!artifact)throw new LaneError('--blocked-on must be issue:#<number> or artifact:<immutable-url-or-hash>')
  return `artifact:${artifact[1]}`
}

function publishCapacityEvents({ workIssue, claim, eventTypes, actor, detail }, now, io) {
  if(!io.commentIssue)return
  for(const eventType of eventTypes){
    const event=coordinationEvent({eventType,workIssue,claimIssue:Number(claim),actor,timestamp:now.toISOString(),detail})
    io.commentIssue(workIssue,formatEventComment(event))
  }
}

export function relinquishAuthorLease(options, now = new Date(), io = githubIo) {
  for(const key of ['claim','owner','blockedOn'])if(!options[key])throw new LaneError(`author-capacity relinquishment requires ${key}`)
  const ownerSha=io.makeOwnerCommit(`db-coordination author-capacity-relinquish claim=${options.claim}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,changed=false
  try{
    const matches=io.openClaims().filter((claim)=>String(claim.number)===String(options.claim))
    if(matches.length!==1)throw new LaneError(`claim #${options.claim} must be uniquely open`)
    before=io.getIssue(options.claim)
    if(before?.state!=='open'||before.body!==matches[0].body)throw new LaneError('claim changed concurrently before capacity relinquishment')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy)throw new LaneError('legacy claim capacity cannot be relinquished')
    if(lease.owner!==options.owner)throw new LaneError('claim belongs to a different owner')
    const blocker=validateCapacityBlocker(options.blockedOn,io)
    if(lease.capacityState==='relinquished'){
      if(lease.blockedOn===blocker)return {claim:Number(options.claim),capacityState:'relinquished',blockedOn:blocker,idempotent:true}
      throw new LaneError('claim is already relinquished for a different blocker')
    }
    if(!io.localClean?.(lease.worktree))throw new LaneError('claim worktree is not clean')
    for(const [kind,ref] of Object.entries(EXCLUSIVE_REFS)){
      const held=io.readRef(ref)
      if(!held)continue
      const message=io.getCommitMessage?.(held)??''
      if(new RegExp(`(?:issue|claim)=${options.claim}(?:\\D|$)`).test(message))throw new LaneError(`claim still holds the ${kind} stage`)
    }
    const expected=replaceCapacityState(before.body,'relinquished',blocker)
    requireOwnedRef(MUTEX_REF,ownerSha,io);changed=true;io.updateIssue(options.claim,{body:expected})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.body!==expected||afterLease.capacityState!=='relinquished'||afterLease.blockedOn!==blocker)throw new LaneError('relinquished capacity readback failed')
    const workIssue=claimWorkIssue(before)
    publishCapacityEvents({workIssue,claim:options.claim,eventTypes:['author_capacity_relinquished','issue_blocked'],actor:options.owner,detail:blocker},now,io)
    return {claim:Number(options.claim),workIssue,capacityState:'relinquished',blockedOn:blocker,idempotent:false}
  }catch(error){
    if(changed&&io.readRef(MUTEX_REF)===ownerSha)try{io.updateIssue(options.claim,{body:before.body})}catch(rollback){throw new LaneError(`${error.message}; rollback failed: ${rollback.message}`)}
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export function resumeAuthorLease(options, now = new Date(), io = githubIo) {
  for(const key of ['claim','owner','leaseHours'])if(options[key]===undefined||options[key]===null||options[key]==='')throw new LaneError(`author-capacity resume requires ${key}`)
  if(!Number.isFinite(options.leaseHours)||options.leaseHours<=0||options.leaseHours>24)throw new LaneError('resume lease hours must be greater than 0 and no more than 24')
  const ownerSha=io.makeOwnerCommit(`db-coordination author-capacity-resume claim=${options.claim}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,changed=false
  try{
    const claims=io.openClaims(),matches=claims.filter((claim)=>String(claim.number)===String(options.claim))
    if(matches.length!==1)throw new LaneError(`claim #${options.claim} must be uniquely open`)
    before=io.getIssue(options.claim);if(before?.state!=='open'||before.body!==matches[0].body)throw new LaneError('claim changed concurrently before capacity resume')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy||lease.owner!==options.owner)throw new LaneError('claim lease is legacy or belongs to a different owner')
    if(lease.capacityState!=='relinquished')throw new LaneError('claim capacity is not relinquished')
    const sources=io.prSources?.()??[],selfPrs=sources.filter((source)=>source.branch===lease.branch)
    if(selfPrs.length>1)throw new LaneError('claim branch has multiple open pull-request sources')
    if(selfPrs.length&&(selfPrs[0].versions?.length!==1||String(selfPrs[0].versions[0])!==lease.version))throw new LaneError('claim branch pull request does not carry the permanent claim version')
    const otherPrs=selfPrs.length?sources.filter((source)=>source!==selfPrs[0]):sources
    assertLaneAvailable(claims.filter((claim)=>String(claim.number)!==String(options.claim)),lease.objects,now,{prSources:otherPrs})
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const expiresAt=new Date(now.valueOf()+options.leaseHours*3600000)
    const expected=replaceLeaseExpiry(replaceCapacityState(before.body,'active'),expiresAt)
    requireOwnedRef(MUTEX_REF,ownerSha,io);changed=true;io.updateIssue(options.claim,{body:expected})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.body!==expected||!afterLease.active||!afterLease.capacityActive||afterLease.capacityState!=='active')throw new LaneError('resumed capacity readback failed')
    const workIssue=claimWorkIssue(before)
    publishCapacityEvents({workIssue,claim:options.claim,eventTypes:['issue_unblocked','author_capacity_resumed'],actor:options.owner,detail:'guarded capacity resume'},now,io)
    return {claim:Number(options.claim),workIssue,capacityState:'active',expiresAt:afterLease.expiresAt.toISOString(),idempotent:false}
  }catch(error){
    if(changed&&io.readRef(MUTEX_REF)===ownerSha)try{io.updateIssue(options.claim,{body:before.body})}catch(rollback){throw new LaneError(`${error.message}; rollback failed: ${rollback.message}`)}
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

function renewalIssueScope(issue, lease, claimIssues=[], { allowClaimSuperset=false }={}) {
  const scope=issue?.state==='open'?parseQueueScope(issue.body):null
  const structural=scope?.status==='ready'&&scope.workType==='structural'&&scope.route==='shared-db-orchestrator'
  const curated=scope?.status==='ready'&&scope.workType==='curated-master-data'&&scope.route==='curated-master-data-governance'
  if(!structural&&!curated)throw new LaneError('renewal issue must be one open ready structural or curated Master Data work item')
  const issueObjects=scope.objects.map(normalizeObject),claimObjects=lease.objects.map(normalizeObject)
  if(curated&&issueObjects.length===0){
    if(claimIssues.length!==1||claimIssues[0]!==Number(issue.number))throw new LaneError('blank curated renewal scope requires a claim title identifying exactly one work issue')
    return claimObjects
  }
  if(issueObjects.some((object)=>!claimObjects.includes(object))||(!allowClaimSuperset&&issueObjects.length!==claimObjects.length))throw new LaneError('renewal issue objects do not exactly match the permanent claim objects')
  return claimObjects
}

export function renewExpiredClaim(options, now = new Date(), io = githubIo) {
  for(const key of ['claim','issue','owner','branch','worktree','pr','headSha','leaseHours'])if(options[key]===undefined||options[key]===null||options[key]==='')throw new LaneError(`claim renewal requires ${key}`)
  if(!Number.isFinite(options.leaseHours)||options.leaseHours<=0||options.leaseHours>24)throw new LaneError('renewal lease hours must be greater than 0 and no more than 24')
  const desiredExpiry=new Date(now.valueOf()+options.leaseHours*3600000)
  const requestId=options.requestId??randomUUID(),ownerSha=io.makeOwnerCommit(`db-coordination claim-lease-renewal ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,possiblyChanged=false
  try {
    const claims=io.openClaims(),matches=claims.filter((claim)=>String(claim.number)===String(options.claim))
    if(matches.length!==1)throw new LaneError(`claim #${options.claim} must be uniquely open`)
    before=io.getIssue(options.claim)
    if(before?.state!=='open'||before.body!==matches[0].body||before.title!==matches[0].title)throw new LaneError('claim changed concurrently before renewal')
    const claimIssues=[...String(before.title??'').matchAll(/#(\d+)\b/g)].map((match)=>Number(match[1]))
    if(!claimIssues.includes(Number(options.issue)))throw new LaneError('renewal issue number is not identified by the claim title')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy)throw new LaneError('legacy claim leases cannot be renewed')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('claim owner, branch, or worktree mismatch')
    const expectedBody=replaceLeaseExpiry(before.body,desiredExpiry)
    if(lease.active){
      if(before.body===expectedBody)return {claim:Number(options.claim),version:lease.version,expiresAt:lease.expiresAt.toISOString(),idempotent:true}
      throw new LaneError('claim has an active lease; refusing unrelated renewal')
    }
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const workIssue=io.getIssue(options.issue),claimObjects=renewalIssueScope(workIssue,lease,claimIssues,{allowClaimSuperset:true})
    const pr=io.getPr(options.pr)
    if(pr?.state!=='open'||pr.head?.ref!==options.branch||pr.head?.sha!==options.headSha)throw new LaneError('open pull request branch or exact head mismatch')
    const fileVersions=migrationVersions(io.getPrFiles(options.pr))
    if(fileVersions.length!==1||fileVersions[0]!==lease.version)throw new LaneError('pull request migration version does not match the permanent claim version')
    const sources=io.prSources(), target=sources.filter((source)=>new RegExp(`^PR #${options.pr}(?:\\s|$)`).test(source.label))
    if(target.length!==1)throw new LaneError('pull request parser source is missing or ambiguous')
    if(target[0].versions?.length!==1||String(target[0].versions[0])!==lease.version)throw new LaneError('parsed pull request version does not match the permanent claim version')
    const claimed=new Set(claimObjects),parsed=(target[0].objects??[]).length?validateClaimObjects(target[0].objects):[]
    const uncovered=parsed.filter((object)=>!claimed.has(object))
    if(uncovered.length)throw new LaneError(`claim does not cover parsed pull request objects: ${uncovered.join(', ')}`)
    const renewalScope=parseQueueScope(workIssue.body)
    if(renewalScope.workType==='structural'){
      const authorized=new Set([...renewalScope.objects.map(normalizeObject),...parsed])
      const unsupported=claimObjects.filter((object)=>!authorized.has(object))
      if(unsupported.length)throw new LaneError(`claim carries objects unsupported by its issue or pull request: ${unsupported.join(', ')}`)
    }
    const others=claims.filter((claim)=>String(claim.number)!==String(options.claim)),otherPrs=sources.filter((source)=>source!==target[0])
    assertLaneAvailable(others,lease.objects,now,{prSources:otherPrs})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const freshWorkIssue=io.getIssue(options.issue)
    if(freshWorkIssue?.state!==workIssue.state||freshWorkIssue?.body!==workIssue.body)throw new LaneError('renewal issue changed concurrently')
    const freshClaim=io.getIssue(options.claim)
    if(freshClaim?.state!==before.state||freshClaim?.body!==before.body||freshClaim?.title!==before.title)throw new LaneError('claim changed concurrently during renewal')
    const freshClaimIssues=[...String(freshClaim.title??'').matchAll(/#(\d+)\b/g)].map((match)=>Number(match[1]))
    renewalIssueScope(freshWorkIssue,lease,freshClaimIssues,{allowClaimSuperset:true})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    possiblyChanged=true;io.updateIssue(options.claim,{body:expectedBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.title!==before.title||after.body!==expectedBody||afterLease.version!==lease.version||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||JSON.stringify(afterLease.objects)!==JSON.stringify(lease.objects))throw new LaneError('renewed claim exact readback failed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during renewal')
    return {claim:Number(options.claim),version:lease.version,expiresAt:afterLease.expiresAt.toISOString(),idempotent:false}
  } catch(error) {
    if(possiblyChanged){
      if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
      try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.claim,{body:before.body});requireOwnedRef(MUTEX_REF,ownerSha,io);if(io.getIssue(options.claim)?.body!==before.body)throw new LaneError('rollback readback mismatch')}
      catch(rollbackError){throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollbackError.message}`)}
    }
    throw error
  } finally {if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

function appendClaimObjects(body, version, objects) {
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

export function recoverExpiredClaimFromPr(options, now = new Date(), io = githubIo) {
  for(const key of ['claim','issue','owner','branch','worktree','pr','headSha','leaseHours'])if(options[key]===undefined||options[key]===null||options[key]==='')throw new LaneError(`expired claim recovery requires ${key}`)
  if(!/^\d+$/.test(String(options.issue))||!/^\d+$/.test(String(options.claim))||!/^\d+$/.test(String(options.pr))||!/^[0-9a-f]{40}$/i.test(String(options.headSha)))throw new LaneError('expired claim recovery requires numeric issue, claim, PR, and an exact 40-character head SHA')
  if(!Number.isFinite(options.leaseHours)||options.leaseHours<=0||options.leaseHours>24)throw new LaneError('recovery lease hours must be greater than 0 and no more than 24')
  const desiredExpiry=new Date(now.valueOf()+options.leaseHours*3600000)
  const requestId=options.requestId??randomUUID(),ownerSha=io.makeOwnerCommit(`db-coordination expired-claim-recovery ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,possiblyChanged=false
  try{
    const claims=io.openClaims(),matches=claims.filter((claim)=>String(claim.number)===String(options.claim))
    if(matches.length!==1)throw new LaneError(`claim #${options.claim} must be uniquely open`)
    before=io.getIssue(options.claim)
    if(before?.state!=='open'||before.body!==matches[0].body||before.title!==matches[0].title)throw new LaneError('claim changed concurrently before expired recovery')
    const claimIssues=claimTitleIssues(before)
    if(claimIssues.length!==1||claimIssues[0]!==Number(options.issue))throw new LaneError('target claim does not belong to the exact issue')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy||lease.active)throw new LaneError('target claim lease must be non-legacy and expired')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('claim owner, branch, or worktree mismatch')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const workIssue=io.getIssue(options.issue)
    renewalIssueScope(workIssue,lease,[Number(options.issue)],{allowClaimSuperset:true})
    const pr=io.getPr(options.pr)
    if(pr?.state!=='open'||pr.head?.ref!==options.branch||pr.head?.sha!==options.headSha)throw new LaneError('open pull request branch or exact head mismatch')
    const fileVersions=migrationVersions(io.getPrFiles(options.pr))
    if(fileVersions.length!==1||fileVersions[0]!==lease.version)throw new LaneError('pull request migration version does not match the permanent claim version')
    const sources=io.prSources(),targets=sources.filter((source)=>new RegExp(`^PR #${options.pr}(?:\\s|$)`).test(source.label))
    if(targets.length!==1)throw new LaneError('pull request parser source is unavailable or ambiguous')
    const target=targets[0]
    if(target.versions?.length!==1||String(target.versions[0])!==lease.version)throw new LaneError('parsed pull request version does not match the permanent claim version')
    const claimed=new Set(lease.objects.map(normalizeObject)),parsed=validateClaimObjects(target.objects??[])
    const uncovered=parsed.filter((object)=>!claimed.has(object))
    if(!uncovered.length)throw new LaneError('pull request has no uncovered objects to recover')
    const expanded=[...lease.objects.map(normalizeObject),...uncovered]
    const others=claims.filter((claim)=>String(claim.number)!==String(options.claim)),otherPrs=sources.filter((source)=>source!==target)
    assertLaneAvailable(others,expanded,now,{prSources:otherPrs})
    const expectedBody=replaceLeaseExpiry(appendClaimObjects(before.body,lease.version,uncovered),desiredExpiry)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const freshWorkIssue=io.getIssue(options.issue),freshClaim=io.getIssue(options.claim),freshPr=io.getPr(options.pr)
    if(freshWorkIssue?.state!==workIssue?.state||freshWorkIssue?.body!==workIssue?.body)throw new LaneError('recovery issue changed concurrently')
    if(freshClaim?.state!==before.state||freshClaim?.body!==before.body||freshClaim?.title!==before.title)throw new LaneError('claim changed concurrently during expired recovery')
    if(freshPr?.state!==pr.state||freshPr?.head?.ref!==pr.head.ref||freshPr?.head?.sha!==pr.head.sha)throw new LaneError('pull request changed concurrently during expired recovery')
    renewalIssueScope(freshWorkIssue,lease,[Number(options.issue)],{allowClaimSuperset:true})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    possiblyChanged=true;io.updateIssue(options.claim,{body:expectedBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.title!==before.title||after.body!==expectedBody||afterLease.version!==lease.version||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||!afterLease.active||JSON.stringify([...afterLease.objects].sort())!==JSON.stringify([...expanded].sort()))throw new LaneError('recovered claim exact readback failed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during expired recovery')
    return {claim:Number(options.claim),version:lease.version,added:uncovered,objects:afterLease.objects,expiresAt:afterLease.expiresAt.toISOString(),idempotent:false}
  }catch(error){
    if(possiblyChanged){
      if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
      try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.claim,{body:before.body});requireOwnedRef(MUTEX_REF,ownerSha,io);if(io.getIssue(options.claim)?.body!==before.body)throw new LaneError('rollback readback mismatch')}
      catch(rollbackError){throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollbackError.message}`)}
    }
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export function expandActiveClaimFromPr(options, now = new Date(), io = githubIo) {
  for(const key of ['issue','claim','pr','owner','headSha','branch','worktree'])if(!options[key])throw new LaneError(`claim expansion requires ${key}`)
  if(!/^\d+$/.test(String(options.issue))||!/^\d+$/.test(String(options.claim))||!/^\d+$/.test(String(options.pr))||!/^[0-9a-f]{7,40}$/i.test(String(options.headSha)))throw new LaneError('claim expansion requires numeric issue, claim, PR, and an exact head SHA')
  const requestId=options.requestId??randomUUID(),ownerSha=io.makeOwnerCommit(`db-coordination claim-object-expansion ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,possiblyChanged=false
  try {
    before=io.getIssue(options.claim)
    if(before?.state!=='open')throw new LaneError('target claim is not open')
    if(workstreamKey(before.title)!==`#${Number(options.issue)}`)throw new LaneError('target claim does not belong to the exact issue')
    const workIssue=io.getIssue(options.issue),scope=parseQueueScope(workIssue?.body??'')
    if(workIssue?.state!=='open'||scope?.status!=='ready'||scope.workType!=='structural'||scope.route!=='shared-db-orchestrator')throw new LaneError('exact work issue is not open ready structural orchestrator work')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy||!lease.active)throw new LaneError('target claim lease is legacy or expired')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('target claim owner, branch, or worktree changed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const pr=io.getPr(options.pr)
    if(pr?.state!=='open'||pr.head?.sha!==options.headSha||pr.head?.ref!==options.branch)throw new LaneError('open pull request head or branch changed')
    const fileVersions=migrationVersions(io.getPrFiles(options.pr))
    if(fileVersions.length!==1||fileVersions[0]!==lease.version)throw new LaneError('pull request files do not contain exactly the immutable migration version')
    const sources=io.prSources(),targetSources=sources.filter((source)=>new RegExp(`^PR #${options.pr}(?:\\s|$)`).test(source.label))
    if(targetSources.length!==1)throw new LaneError('pull request parser source is missing or ambiguous')
    const target=targetSources[0]
    if(target.versions?.length!==1||String(target.versions[0])!==lease.version)throw new LaneError('pull request migration version does not match the immutable claim version')
    const claimed=new Set(lease.objects.map(normalizeObject)),parsed=validateClaimObjects(target.objects??[])
    const uncovered=parsed.filter((object)=>!claimed.has(object))
    if(!uncovered.length)throw new LaneError('pull request has no uncovered objects to add')
    const claims=io.openClaims()
    if(claims.filter((claim)=>String(claim.number)===String(options.claim)).length!==1)throw new LaneError('active claim set is ambiguous')
    const others=claims.filter((claim)=>String(claim.number)!==String(options.claim)),otherPrs=sources.filter((source)=>source!==target)
    assertLaneAvailable(others,uncovered,now,{prSources:otherPrs})
    const expanded=[...lease.objects.map(normalizeObject),...uncovered]
    const updatedBody=replaceClaimObjects(before.body,lease.version,expanded)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    possiblyChanged=true;io.updateIssue(options.claim,{body:updatedBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.body!==updatedBody||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||afterLease.version!==lease.version||JSON.stringify([...afterLease.objects].sort())!==JSON.stringify([...expanded].sort()))throw new LaneError('expanded claim exact readback failed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during claim expansion')
    return {claim:Number(options.claim),version:lease.version,added:uncovered,objects:afterLease.objects}
  } catch(error) {
    if(possiblyChanged){
      if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
      try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.claim,{body:before.body});requireOwnedRef(MUTEX_REF,ownerSha,io);if(io.getIssue(options.claim)?.body!==before.body)throw new LaneError('rollback readback mismatch')}
      catch(rollbackError){throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollbackError.message}`)}
    }
    throw error
  } finally {if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export function expandActiveClaimFromIssue(options,now=new Date(),io=githubIo){
  for(const key of ['issue','claim','owner','branch','worktree'])if(!options[key])throw new LaneError(`issue-scope claim expansion requires ${key}`)
  if(!/^\d+$/.test(String(options.issue))||!/^\d+$/.test(String(options.claim)))throw new LaneError('issue-scope claim expansion requires numeric issue and claim')
  const requestId=options.requestId??randomUUID(),ownerSha=io.makeOwnerCommit(`db-coordination claim-object-expansion ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,possiblyChanged=false
  try{
    before=io.getIssue(options.claim)
    if(before?.state!=='open'||workstreamKey(before.title)!==`#${Number(options.issue)}`)throw new LaneError('target claim is not open or does not belong to the exact issue')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy||!lease.active)throw new LaneError('target claim lease is legacy or expired')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('target claim owner, branch, or worktree changed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const workIssue=io.getIssue(options.issue),scope=parseQueueScope(workIssue?.body??'')
    if(workIssue?.state!=='open'||scope?.status!=='ready'||scope.workType!=='structural'||scope.route!=='shared-db-orchestrator')throw new LaneError('exact work issue is not open ready structural orchestrator work')
    const claimed=new Set(lease.objects.map(normalizeObject)),uncovered=scope.objects.filter((object)=>!claimed.has(object))
    if(!uncovered.length)throw new LaneError('exact work issue has no uncovered objects to add')
    const claims=io.openClaims()
    if(claims.filter((claim)=>String(claim.number)===String(options.claim)).length!==1)throw new LaneError('active claim set is ambiguous')
    const others=claims.filter((claim)=>String(claim.number)!==String(options.claim)),sources=io.prSources()
    assertLaneAvailable(others,uncovered,now,{prSources:sources})
    const expanded=[...lease.objects.map(normalizeObject),...uncovered],updatedBody=replaceClaimObjects(before.body,lease.version,expanded)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    possiblyChanged=true;io.updateIssue(options.claim,{body:updatedBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.body!==updatedBody||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||afterLease.version!==lease.version||JSON.stringify([...afterLease.objects].sort())!==JSON.stringify([...expanded].sort()))throw new LaneError('expanded claim exact readback failed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during claim expansion')
    return {claim:Number(options.claim),version:lease.version,added:uncovered,objects:afterLease.objects}
  }catch(error){
    if(possiblyChanged){
      if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
      try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.claim,{body:before.body});requireOwnedRef(MUTEX_REF,ownerSha,io);if(io.getIssue(options.claim)?.body!==before.body)throw new LaneError('rollback readback mismatch')}
      catch(rollbackError){throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollbackError.message}`)}
    }
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export function recoverSameOwnerSplit(options, now = new Date(), io = githubIo) {
  for(const key of ['releasedClaim','activeClaim','sourcePr','targetPr','targetBranch','targetWorktree'])if(!options[key])throw new LaneError(`split recovery requires ${key}`)
  const requestId=options.requestId??randomUUID(), ownerSha=io.makeOwnerCommit(`db-coordination claim-split-recovery ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let releasedBefore,activeBefore,releasedChanged=false,activeChanged=false
  try {
    if(String(options.releasedClaim)!=='1058'||String(options.activeClaim)!=='1063'||String(options.sourcePr)!=='1060')throw new LaneError('split recovery is pinned to claims #1058/#1063 and source PR #1060')
    if(!/^\d+$/.test(String(options.targetPr)))throw new LaneError('target pull request must be numeric')
    if(String(options.sourcePr)===String(options.targetPr))throw new LaneError('source and target pull requests must differ')
    releasedBefore=io.getIssue(options.releasedClaim);activeBefore=io.getIssue(options.activeClaim)
    if(releasedBefore?.state!=='closed'||activeBefore?.state!=='open')throw new LaneError('split recovery requires one closed original claim and one open active claim')
    if(workstreamKey(releasedBefore.title)!=='#853/#868'||workstreamKey(activeBefore.title)!=='#853/#868')throw new LaneError('claims do not belong to the pinned #853/#868 workstream')
    const closeComments=io.getIssueComments(options.releasedClaim)
    if(!RECOVERABLE_CLAIM_CLOSE_REASONS.has(closeComments.at(-1)?.body))throw new LaneError('closed claim does not have the exact guarded-release reason')
    const released=parseAuthorLease(releasedBefore.body,now),active=parseAuthorLease(activeBefore.body,now)
    if(released.legacy||active.legacy||released.owner!==active.owner)throw new LaneError('claims do not have the same exact manager owner')
    if(!released.active||!active.active)throw new LaneError('split recovery requires both exact leases to remain unexpired')
    if(released.version===active.version)throw new LaneError('split claims must retain two different permanent versions')
    const original=new Set(released.objects.map(normalizeObject)),combined=new Set(active.objects.map(normalizeObject))
    if(original.size>=combined.size||[...original].some((object)=>!combined.has(object)))throw new LaneError('original claim objects are not an exact strict subset')
    const remainder=[...combined].filter((object)=>!original.has(object))
    if(remainder.length!==1||remainder[0]!==SPLIT_REMAINDER)throw new LaneError(`split remainder must be exactly ${SPLIT_REMAINDER}`)
    for(const lease of [released,active])if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError(`permanent reservation for ${lease.version} is unreadable`)
    const source=io.getPr(options.sourcePr),target=io.getPr(options.targetPr)
    if(source?.state!=='open'||source.head?.ref!==released.branch)throw new LaneError('source pull request does not match the original claim branch')
    if(target?.state!=='open'||target.head?.ref!==options.targetBranch)throw new LaneError('target pull request does not match the requested split branch')
    if(options.targetBranch===released.branch)throw new LaneError('split recovery requires two different pull-request branches')
    const sourceVersions=migrationVersions(io.getPrFiles(options.sourcePr)),targetVersions=migrationVersions(io.getPrFiles(options.targetPr))
    if(sourceVersions.length!==1||sourceVersions[0]!==released.version)throw new LaneError('source pull request must contain only the original migration version')
    if(targetVersions.length!==1||targetVersions[0]!==active.version)throw new LaneError('target pull request must contain only the remainder migration version')
    const thirdParty=io.openClaims().filter((claim)=>![String(options.activeClaim),String(options.releasedClaim)].includes(String(claim.number)))
    const incidentPr=new RegExp(`^PR #(?:${options.sourcePr}|${options.targetPr})(?:\\s|$)`)
    const thirdPartyPrs=io.prSources().filter((pr)=>!incidentPr.test(pr.label))
    const reservedVersions=new Set([released.version,active.version])
    const versionCollision=thirdPartyPrs.find((pr)=>(pr.versions??[]).some((version)=>reservedVersions.has(String(version))))
    if(versionCollision)throw new LaneError(`migration version collision with ${versionCollision.label}`)
    assertLaneAvailable(thirdParty,[...combined],now,{prSources:thirdPartyPrs})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const activeBody=replaceLeaseLocation(activeBefore.body,options.targetBranch,options.targetWorktree)
    activeChanged=true;io.updateIssue(options.activeClaim,{body:activeBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    releasedChanged=true;io.updateIssue(options.releasedClaim,{state:'open'})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const activeAfter=io.getIssue(options.activeClaim),releasedAfter=io.getIssue(options.releasedClaim)
    if(activeAfter?.body!==activeBody||activeAfter?.state!=='open'||releasedAfter?.body!==releasedBefore.body||releasedAfter?.state!=='open')throw new LaneError('split recovery readback did not match both exact claims')
    for(const lease of [released,active])if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during split recovery')
    return {restored:Number(options.releasedClaim),rebound:Number(options.activeClaim),owner:active.owner,versions:[released.version,active.version]}
  } catch(error) {
    const rollback=[]
    if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost; manual manager recovery required`)
    if(releasedChanged){try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.releasedClaim,{state:'closed'});rollback.push('released claim')}catch(e){rollback.push(`FAILED released claim: ${e.message}`)}}
    if(activeChanged){try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.activeClaim,{body:activeBefore.body});rollback.push('active claim')}catch(e){rollback.push(`FAILED active claim: ${e.message}`)}}
    if(rollback.some((x)=>x.startsWith('FAILED')))throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollback.join(', ')}`)
    throw error
  } finally { if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io) }
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
export function completeWork({ issue, report }, io = githubIo) {
  const record = validateCompletionRecord(report)
  if (record.work_issue !== Number(issue)) {
    throw new DependencyError(`report is for issue #${record.work_issue} but --issue said #${issue}`)
  }
  const workIssue=io.getIssue?.(Number(issue))
  const scope=workIssue?parseQueueScope(workIssue.body??''):null
  if(record.outcome==='merged'&&scope&&scope.changeType!==null){
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
  if (record.outcome === 'merged') {
    const pr = io.getPr(record.pr)
    if (!pr?.merged_at) throw new DependencyError(`pull request #${record.pr} is not merged`)
    // GitHub's own merge_commit_sha, which is the squash commit when the repo
    // squashes. The source branch head is NOT what lands on main.
    const actual = pr.merge_commit_sha
    if (!actual || !actual.startsWith(record.merge_sha) && !record.merge_sha.startsWith(actual)) {
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
  }

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

// --- FENCED STAGE OPERATIONS (Step 6, issue #1366) -------------------------
//
// EVERY ONE OF THESE TAKES THE GLOBAL MUTEX FIRST. `updateRef` PATCHes with
// force=true and no expected-sha, so there is NO Git-level compare-and-swap here:
// the mutex is the only thing making read-then-write atomic. An unserialised
// release could delete a ref a recovery had already replaced.

/** Read the lease currently on a stage's ref, or null when the lane is free. */
export function readExclusiveLease(kind, io = githubIo) {
  const ref = EXCLUSIVE_REFS[kind]
  if (!ref) throw new LaneError(`unknown exclusive lane: ${kind}`)
  const sha = io.readRef(ref)
  if (!sha) return null
  const message = io.readCommitMessage?.(sha)
  if (!message) throw new LaneError(`the lease on ${ref} is unreadable; refusing to guess who holds it`)
  return { ...parseLeaseMessage(message), ref, sha }
}

/**
 * Fence a side effect. Run IMMEDIATELY before every preview, merge or production
 * write: a check performed at acquisition time proves nothing about the moment
 * the write happens.
 */
export function assertExclusive(kind, expected, io = githubIo) {
  const lease = readExclusiveLease(kind, io)
  assertLease(lease, expected)
  return lease
}

/**
 * Release by HOLDER and GENERATION, not by the sha captured at acquisition.
 *
 * The old contract compared the ref's current sha against the acquisition sha,
 * which every calling workflow stashed at lock time. That is exactly why a
 * heartbeat could not be added without stranding lanes, and it is also why a
 * recovered lane could be released by the holder it replaced. Identity is the
 * right key; the sha is an implementation detail that legitimately moves.
 */
export function releaseExclusive(kind, expected, io = githubIo) {
  const ref = EXCLUSIVE_REFS[kind]
  if (!ref) throw new LaneError(`unknown exclusive lane: ${kind}`)
  const ownerSha = io.makeOwnerCommit(`db-coordination ${kind} release-${randomUUID()}`)
  acquireMutex(ownerSha, io)
  try {
    const lease = readExclusiveLease(kind, io)
    if (!lease) return { kind, ref, released: false, reason: 'the lane was already free' }
    // A legacy lease has no identity to check, so it keeps the old sha contract
    // rather than being releasable by anyone who asks.
    if (lease.legacy) {
      if (!expected.ownerSha) throw new LaneError('this lane holds a pre-Step-6 lease; release it with its acquisition sha')
      requireOwnedRef(MUTEX_REF, ownerSha, io)
      releaseOwnedRef(ref, expected.ownerSha, io)
      return { kind, ref, released: true, legacy: true }
    }
    assertLease(lease, expected)
    requireOwnedRef(MUTEX_REF, ownerSha, io)
    releaseOwnedRef(ref, lease.sha, io)
    return { kind, ref, released: true, holderId: lease.holderId, generation: lease.generation }
  } finally { if (io.readRef(MUTEX_REF) === ownerSha) releaseOwnedRef(MUTEX_REF, ownerSha, io) }
}

/**
 * Take over a crashed job's lane.
 *
 * Refuses unless the recorded run is conclusively finished on a LIVE query, no
 * later attempt or run is active, the grace has elapsed, and the ref still holds
 * the exact lease that was evaluated. Dry run by default: a recovery that turns
 * out to be wrong is the one failure this whole step is trying to avoid.
 */
export function recoverExclusive(kind, { holderId, apply = false, now = new Date(), requestId } = {}, io = githubIo) {
  const ref = EXCLUSIVE_REFS[kind]
  if (!ref) throw new LaneError(`unknown exclusive lane: ${kind}`)
  if (!holderId) throw new LaneError('a recovery must name the holder taking over')

  const observed = readExclusiveLease(kind, io)
  const runState = observed?.githubRunId ? io.runState?.(observed.githubRunId) : null
  const verdict = evaluateRecovery(observed, runState, now)
  if (!verdict.recoverable) return { kind, ref, recovered: false, reason: verdict.reason }
  if (!apply) return { kind, ref, recovered: false, dryRun: true, wouldRecover: true, reason: verdict.reason }

  const ownerCommit = io.makeOwnerCommit(`db-coordination ${kind} recovery-${requestId ?? randomUUID()}`)
  acquireMutex(ownerCommit, io)
  try {
    // RE-READ UNDER THE MUTEX. Everything above was decided outside it, so the
    // lease could have been released or already recovered in between. Acting on
    // the stale observation is the split-ownership bug itself.
    const current = readExclusiveLease(kind, io)
    if (!current) return { kind, ref, recovered: false, reason: 'the lane was released while recovery was being evaluated; nothing to recover' }
    if (current.sha !== observed.sha || current.generation !== observed.generation) {
      return { kind, ref, recovered: false, reason: `the lease changed while recovery was being evaluated (generation ${observed.generation} -> ${current.generation}); refusing rather than racing` }
    }
    const next = recoveredLeaseMetadata(current, {
      holderId,
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      acquiredAt: now.toISOString(),
      previousOwnerSha: current.sha,
      requestId: requestId ?? randomUUID(),
    })
    const replacement = io.makeOwnerCommit(formatLeaseMessage(kind, next))
    requireOwnedRef(MUTEX_REF, ownerCommit, io)
    io.updateRef(ref, replacement)
    const readBack = readExclusiveLease(kind, io)
    if (readBack?.sha !== replacement || readBack.generation !== next.generation) {
      throw new LaneError(`recovery of ${ref} did not read back; do NOT treat this lane as owned`)
    }
    return { kind, ref, recovered: true, holderId, generation: next.generation, previousOwnerSha: current.sha, reason: verdict.reason }
  } finally { if (io.readRef(MUTEX_REF) === ownerCommit) releaseOwnedRef(MUTEX_REF, ownerCommit, io) }
}

export function acquireExclusive(kind, metadata, io = githubIo) {
  const ref = EXCLUSIVE_REFS[kind]
  if (!ref) throw new LaneError(`unknown exclusive lane: ${kind}`)
  if (!metadata.owner || !metadata.headSha || (kind !== 'production' && !metadata.pr)) throw new LaneError('exclusive lane requires owner, exact head SHA, and a PR number except for production')
  const requestId = metadata.requestId ?? randomUUID()
  // STRUCTURED LEASE (Step 6, issue #1366). The first line keeps the exact shape
  // recoverStaleAuthorMutex recognises; the metadata follows. A format that broke
  // that recognition would make a crash DURING acquisition -- mutex held, exclusive
  // ref possibly created -- permanently unrecoverable.
  const holderId = metadata.holderId ?? metadata.owner
  const ownerSha = io.makeOwnerCommit(formatLeaseMessage(kind, {
    requestId,
    holderId,
    githubRunId: metadata.githubRunId ?? process.env.GITHUB_RUN_ID ?? null,
    githubRunAttempt: metadata.githubRunAttempt ?? process.env.GITHUB_RUN_ATTEMPT ?? null,
    owner: metadata.owner,
    pr: metadata.pr,
    headSha: metadata.headSha,
    migrationVersions: metadata.versions ?? metadata.migrationVersions ?? [],
    acquiredAt: (metadata.now ?? new Date()).toISOString(),
    generation: metadata.generation ?? 1,
  }))
  acquireMutex(ownerSha, io)
  try {
    if(metadata.admissionOptions){
      if(kind==='merge')requirePrOperationRoute(metadata.admissionOptions,io,{pr:metadata.pr,headSha:metadata.headSha,issue:metadata.admissionOptions.issue??null,mutexOwner:ownerSha,resolveStructuralIssue:true})
      else requireAdmission(metadata.admissionOptions,io,{pr:metadata.pr??null,mutexOwner:ownerSha})
    }
    if (kind === 'production') {
      if (metadata.headSha !== io.mainSha?.()) throw new LaneError('production lane requires the exact current main SHA')
      if (io.readRef(EXCLUSIVE_REFS.merge)) throw new LaneError('a guarded merge is active; production promotion must wait')
    } else if (kind === 'preview-rehearsal') {
      // POST-MERGE PREVIEW REHEARSAL -- the path that makes "merge first, then
      // rehearse on preview from merged main, then promote" executable. There is
      // no live author claim to point at: the guarded merge released the claim
      // and deleted the branch. Authorisation comes from merge-commit ancestry
      // of the current main tip instead. Every failure below is fail-closed and
      // names exactly what was missing.
      const mainSha = io.mainSha?.()
      if (!mainSha) throw new LaneError('post-merge preview rehearsal cannot read the current main tip; GitHub state is unreadable')
      if (metadata.headSha !== mainSha) throw new LaneError(`post-merge preview rehearsal requires the exact current main SHA (asked for ${metadata.headSha}, main is ${mainSha})`)
      // The version set is validated FIRST and identically for both forms: one
      // source PR, or a version-to-PR map for a batch AGENTS.md 6.5 requires to
      // move as a single bounded event. The map does not weaken anything -- the
      // very same four proofs (merged, real merge commit, that commit contained
      // in the main tip's history, and the version ADDED by that PR) simply run
      // per version instead of once per batch.
      const versions = (metadata.versions ?? []).map((v) => String(v).trim()).filter(Boolean)
      if (!versions.length) throw new LaneError('post-merge preview rehearsal requires the exact migration versions it will apply')
      if (versions.some((v) => !/^\d{14}$/.test(v))) throw new LaneError('post-merge preview rehearsal versions must each be an exact 14-digit migration version')
      // PRESENT-BUT-EMPTY IS A REFUSAL, not a silent fall-back to the single-PR
      // form. An operator who passed a map that evaluated to nothing must be
      // told, never quietly given a different lane than the one they asked for.
      const hasMap = metadata.versionPrMap !== undefined && metadata.versionPrMap !== null
      const readPr = (number) => {
        let pr
        try { pr = io.getPr?.(number) } catch (error) { throw new LaneError(`post-merge preview rehearsal cannot read pull request #${number} (${error.message})`) }
        if (!pr) throw new LaneError(`post-merge preview rehearsal cannot read pull request #${number}`)
        if (pr.merged !== true || !pr.merge_commit_sha) throw new LaneError(`post-merge preview rehearsal requires an already-merged source PR; #${number} is not merged`)
        assertMergeCommitInMainHistory(pr.merge_commit_sha, mainSha, io)
        return pr
      }
      const readAdded = (number) => {
        let files
        try { files = io.getPrFiles?.(number) } catch (error) { throw new LaneError(`post-merge preview rehearsal cannot read the files of pull request #${number} (${error.message})`) }
        return addedMigrationVersions(files)
      }
      if (hasMap) {
        const map = parseVersionPrMap(metadata.versionPrMap, versions)
        // The lane lock is claimed against ONE pull request number, so that
        // number must be a member of the batch it claims to lock. Otherwise the
        // lock would be filed under a pull request the evidence never mentions.
        if (![...map.values()].some((number) => String(number) === String(metadata.pr))) {
          throw new LaneError(`post-merge preview rehearsal lock PR #${metadata.pr} is not one of the pull requests in the version-to-PR map`)
        }
        const addedByPr = new Map()
        for (const [version, number] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          readPr(number)
          if (!addedByPr.has(number)) addedByPr.set(number, readAdded(number))
          if (!addedByPr.get(number).includes(version)) throw new LaneError(`post-merge preview rehearsal version ${version} was not added by pull request #${number}`)
        }
      } else {
        readPr(metadata.pr)
        const added = readAdded(metadata.pr)
        const missing = versions.filter((v) => !added.includes(v))
        if (missing.length) throw new LaneError(`post-merge preview rehearsal versions were not added by pull request #${metadata.pr}: ${missing.join(', ')}`)
      }
    } else if (kind === 'preview-recovery') {
      if (metadata.headSha !== io.mainSha?.()) throw new LaneError('historical preview recovery requires the exact current main SHA')
      const pr = io.getPr?.(metadata.pr)
      // #1211 and #1439 are the proven circular cases: their corrected migrations cannot be
      // previewed (and therefore cannot be merged) until the abandoned preview-only
      // ledger row from the SAME PR is removed. The recovery workflow independently
      // pins the exact issue, claim, versions, run, artifact, and live PR head.
      const pending1211 = Number(metadata.pr) === 1372 && pr?.state === 'open' && pr?.merged !== true && Boolean(pr?.head?.sha)
      const pending1439 = Number(metadata.pr) === 1495 && pr?.state === 'open' && pr?.merged !== true && Boolean(pr?.head?.sha)
      // #1658/PR #1660 is the same circular case: the abandoned preview-only row
      // 20260827134155 blocks EVERY preview apply in the repository, including the
      // replacement 20260827171526 that PR #1660 itself carries, so the PR cannot be
      // previewed and therefore cannot be merged until that row is removed.
      const pending1658 = Number(metadata.pr) === 1660 && pr?.state === 'open' && pr?.merged !== true && Boolean(pr?.head?.sha)
      if (!pending1211 && !pending1439 && !pending1658 && (pr?.merged !== true || !pr?.merge_commit_sha)) throw new LaneError('historical preview recovery requires an already-merged source PR or an exact allowlisted pending-replacement PR')
    } else {
      const pr = io.getPr?.(metadata.pr)
      if (!pr?.head?.sha || pr.head.sha !== metadata.headSha) throw new LaneError('exclusive lane head SHA does not match the live pull request')
      const claims = io.openClaims()
      const matching = claims.map((claim)=>({ ...claim, lease:parseAuthorLease(claim.body) })).filter((claim)=>!claim.lease.legacy && claim.lease.branch===pr.head.ref && claim.lease.active)
      if (kind !== 'merge' && matching.length !== 1) throw new LaneError('exclusive lane requires exactly one live author claim for the pull-request branch')
      if (kind === 'merge' && matching.length > 1) throw new LaneError('exclusive merge lane requires at most one live author claim for the pull-request branch')
      if (kind === 'merge' && matching.length === 0) {
        let files
        try { files = io.getPrFiles?.(metadata.pr) } catch (error) { throw new LaneError(`exclusive merge lane cannot read pull request files (${error.message})`) }
        if (!Array.isArray(files)) throw new LaneError('exclusive merge lane cannot establish whether the pull request changes migrations')
        const changesMigration = files.some((file) => /^supabase\/migrations\/[^/]+\.sql$/.test(String(file?.path ?? file?.filename ?? '')))
        if (changesMigration) throw new LaneError('exclusive merge lane requires exactly one live author claim for a pull request that changes migrations')
      }
      if (kind === 'merge' && pr.base?.sha !== io.mainSha?.()) throw new LaneError('pull request is not based on the current main tip')
      if (kind === 'merge' && io.readRef(EXCLUSIVE_REFS.production)) throw new LaneError('production promotion is active; merges are frozen')
    }
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    acquireRef(ref, ownerSha, io)
    return { kind, ref, ownerSha, requestId, holderId, generation: metadata.generation ?? 1 }
  } finally { if (io.readRef(MUTEX_REF) === ownerSha) releaseOwnedRef(MUTEX_REF, ownerSha, io) }
}

export function authorizeRepositoryMaintenanceStatus(options, io = githubIo) {
  const prNumber=Number(options.pr),headSha=String(options.headSha??''),description=String(options.description??''),targetUrl=String(options.targetUrl??'')
  if(!Number.isInteger(prNumber)||prNumber<=0)throw new LaneError('--authorize-repository-maintenance-status requires --pr <n>')
  if(!/^[0-9a-f]{40}$/.test(headSha))throw new LaneError('--authorize-repository-maintenance-status requires --head-sha <40-char-sha>')
  if(!description)throw new LaneError('--authorize-repository-maintenance-status requires --description <text>')
  if(!/^https:\/\//.test(targetUrl))throw new LaneError('--authorize-repository-maintenance-status requires --target-url <https-url>')
  const context=MERGE_SELF_CONTEXT
  const ownerSha=io.makeOwnerCommit(`db-coordination repository-maintenance-authorization pr=${prNumber} head=${headSha}`)
  let posted=false,operationError=null
  acquireMutex(ownerSha,io)
  try {
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    if(io.readRef(EXCLUSIVE_REFS.production))throw new LaneError('production promotion is active; repository-maintenance authorization is frozen')
    const pr=io.getPr(prNumber),baseSha=String(pr?.base?.sha??'')
    if(!pr?.head?.sha||pr.head.sha!==headSha)throw new LaneError('repository-maintenance authorization head SHA does not match the live pull request')
    if(pr?.base?.ref!=='main'||pr?.base?.repo?.full_name!==REPO)throw new LaneError('repository-maintenance authorization requires the protected main base in this repository')
    if(!/^[0-9a-f]{40}$/.test(baseSha))throw new LaneError('repository-maintenance authorization base SHA is unreadable')
    let files
    try{files=io.comparePullRequestFiles(baseSha,headSha)}catch(error){throw new LaneError(`repository-maintenance authorization cannot read the exact base-to-head comparison (${error.message})`)}
    const verdict=classifyLightweightMergePullRequestFiles(files)
    if(!verdict.documentsOnly)throw new LaneError(`repository-maintenance authorization refused: ${verdict.reason}`)
    const finalPr=io.getPr(prNumber)
    if(finalPr?.base?.sha!==baseSha||finalPr?.base?.ref!=='main'||finalPr?.base?.repo?.full_name!==REPO||finalPr?.head?.sha!==headSha)throw new LaneError('repository-maintenance authorization pull request moved during exact comparison')
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    if(io.readRef(EXCLUSIVE_REFS.production))throw new LaneError('production promotion began during repository-maintenance authorization')
    io.postCommitStatus(headSha,{state:'success',context,description,targetUrl})
    posted=true
    return {pr:prNumber,headSha,context,documentsOnly:true,coordinationRef:MUTEX_REF,structuralStage:null}
  }catch(error){
    operationError=error
    if(io.readRef(MUTEX_REF)===ownerSha){
      let replacesLightweightSuccess=false,statusHistoryUnreadable=false
      if(!options.revokeRequiredStatus){
        try{
          const existing=io.getCommitStatus?.(headSha,context)??null
          replacesLightweightSuccess=existing?.state==='success'&&existing?.description===description
        }catch{statusHistoryUnreadable=true}
      }
      const refusalContext=options.revokeRequiredStatus||replacesLightweightSuccess||statusHistoryUnreadable?context:'Documents-only merge authorization'
      try{io.postCommitStatus(headSha,{state:'failure',context:refusalContext,description:'Lightweight authorization refused; guarded code checks required',targetUrl})}
      catch(statusError){throw new LaneError(`${error.message}; refusal status also failed: ${statusError.message}`)}
    }
    throw error
  }
  finally{
    try{releaseOwnedRef(MUTEX_REF,ownerSha,io)}
    catch(releaseError){
      if(posted){
        try{io.postCommitStatus(headSha,{state:'failure',context,description:'Repository-maintenance mutex release failed; authorization revoked',targetUrl})}
        catch(revokeError){throw new LaneError(`${releaseError.message}; authorization revocation also failed: ${revokeError.message}`)}
      }
      if(!operationError)throw releaseError
    }
  }
}

function parseArgs(argv) {
  const out = { objects: [] }
  const next = (i) => { if (i + 1 >= argv.length) throw new LaneError(`${argv[i]} needs a value`); return argv[i + 1] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--claim') out.claim = true
    else if (a === '--authorize-repository-maintenance-status') out.authorizeRepositoryMaintenanceStatus = true
    else if (a === '--revoke-required-status') out.revokeRequiredStatus = true
    else if (a === '--admit-issue') out.admitIssue = Number(next(i++))
    else if (a === '--resolve-admitted-issue-for-pr') out.resolveAdmittedIssueForPr = Number(next(i++))
    else if (a === '--outcome-status') out.outcomeStatus = Number(next(i++))
    else if (a === '--advance-outcome') out.advanceOutcome = next(i++)
    else if (a === '--complete-outcome') out.completeOutcome = Number(next(i++))
    else if (a === '--audit') out.audit = true
    else if (a === '--queue-audit') out.queueAudit = true
    else if (a === '--complete-work') out.completeWork = true
    else if (a === '--assert-exclusive') out.assertExclusive = next(i++)
    else if (a === '--recover-exclusive') out.recoverExclusive = next(i++)
    else if (a === '--release-exclusive') out.releaseExclusive = next(i++)
    else if (a === '--holder-id') out.holderId = next(i++)
    else if (a === '--generation') out.generation = Number(next(i++))
    else if (a === '--apply-recovery') out.applyRecovery = true
    else if (a === '--report-file') out.reportFile = argv[++i]
    else if (a === '--return-issue') out.returnIssue = Number(argv[++i])
    else if (a === '--assign-reviewer') out.assignReviewer = true
    else if (a === '--exclude-reviewer') out.excludeReviewer = true
    else if (a === '--reinstate-reviewer-exclusion') out.reinstateReviewerExclusion = true
    else if (a === '--activate-review-cutover') out.activateReviewCutover = true
    else if (a === '--replace-failed-reviewer') out.replaceFailedReviewer = true
    else if (a === '--release-failed-reviewer') out.releaseFailedReviewer = true
    else if (a === '--probe-silent-reviewer') out.probeSilentReviewer = true
    else if (a === '--reclaim-silent-reviewer') out.reclaimSilentReviewer = true
    else if (a === '--request-reviewer') out.assignReviewer = true
    else if (a === '--reviewer-capacity') out.reviewerCapacity = true
    else if (a === '--reviewer-preflight') out.reviewerPreflight = true
    else if (a === '--cleanup-stale') out.cleanup = true
    else if (a === '--release-claim') out.releaseClaim = next(i), i++
    else if (a === '--release-duplicate-claim') out.releaseDuplicateClaim = next(i), i++
    else if (a === '--confirm-finished') out.confirmFinished = true
    else if (a === '--recover-author-mutex') out.recoverMutex = true
    else if (a === '--recover-same-owner-split') out.recoverSplit = true
    else if (a === '--expand-active-claim-from-pr') out.expandClaim = true
    else if (a === '--expand-active-claim-from-issue') out.expandClaimFromIssue = true
    else if (a === '--renew-claim') out.renewClaim = true
    else if (a === '--recover-expired-claim-from-pr') out.recoverExpiredClaim = true
    else if (a === '--relinquish-author-lease') out.relinquishAuthorLease = true
    else if (a === '--resume-author-lease') out.resumeAuthorLease = true
    else if (a === '--flow-audit') out.flowAudit = true
    else if (a === '--reconcile-flow') out.reconcileFlow = true
    else if (a === '--prepare-preview-dispatch') out.preparePreviewDispatch = Number(next(i++))
    else if (a === '--repair-preview-ready') out.repairPreviewReady = next(i++)
    else if (a === '--terminalize-historical-preview-ready') out.terminalizeHistoricalPreviewReady = next(i++)
    else if (a === '--json') out.json = true
    else if (a === '--reissue-merged-stranded-claim') out.reissueMergedClaim = true
    else if (a === '--reversion-active-claim' || a === '--supersede-active-claim-version') out.reversionClaim = true
    else if (a === '--confirm-stale') out.confirmStale = true
    else if (/^--acquire-(preview|preview-recovery|preview-rehearsal|merge|production)$/.test(a)) out.acquireExclusive = a.slice(10)
    else if (/^--release-(preview|preview-recovery|preview-rehearsal|merge|production)$/.test(a)) out.releaseExclusive = a.slice(10)
    else if (['--task','--owner','--branch','--worktree','--issue','--pr','--head-sha','--owner-sha','--expected-sha','--released-claim','--active-claim','--source-pr','--target-pr','--target-branch','--target-worktree','--target-url','--description','--claim-number','--failed-sequence','--failure-code','--failing-check','--old-version','--reviewer','--wrapper','--version-pr-map','--blocked-on','--review-slot','--reason','--evidence','--evidence-sha','--verdict','--findings-ref','--replacement-sequence','--run-id','--artifact-id','--artifact-digest','--manifest-digest'].includes(a)) { out[a.slice(2).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = next(i); i++ }
    else if(a==='--confirm-local-dependency-unfixable')out.confirmLocalDependencyUnfixable=true
    else if(a==='--skip-doctor')out.skipDoctor=true
    else if(a==='--confirm-no-verdict')out.confirmNoVerdict=true
    else if(a==='--confirm-no-artifact')out.confirmNoArtifact=true
    else if (a === '--versions') { out.versions = next(i).split(',').map((v)=>v.trim()).filter(Boolean); i++ }
    else if (a === '--objects') { out.objects.push(...next(i).split(',').map((v)=>v.trim()).filter(Boolean)); i++ }
    else if (a === '--lease-hours') { out.leaseHours = Number(next(i)); i++ }
    else throw new LaneError(`unknown argument: ${a}`)
  }
  return out
}

export function main(argv, now = new Date(), io = githubIo) {
  try {
    const o = parseArgs(argv)
    const primaryKeys=['authorizeRepositoryMaintenanceStatus','resolveAdmittedIssueForPr','outcomeStatus','advanceOutcome','completeOutcome','recoverMutex','reconcileFlow','preparePreviewDispatch','repairPreviewReady','terminalizeHistoricalPreviewReady','flowAudit','recoverSplit','expandClaim','expandClaimFromIssue','renewClaim','recoverExpiredClaim','relinquishAuthorLease','resumeAuthorLease','reissueMergedClaim','reversionClaim','replaceFailedReviewer','releaseFailedReviewer','probeSilentReviewer','reclaimSilentReviewer','reviewerCapacity','excludeReviewer','reinstateReviewerExclusion','reviewerPreflight','assignReviewer','activateReviewCutover','acquireExclusive','releaseExclusive','claim','returnIssue','queueAudit','assertExclusive','recoverExclusive','completeWork','releaseClaim','releaseDuplicateClaim','cleanup','audit']
    const selectedPrimary=primaryKeys.filter((key)=>Object.prototype.hasOwnProperty.call(o,key))
    const hasAdmission=Object.prototype.hasOwnProperty.call(o,'admitIssue')
    if(selectedPrimary.length>1)throw new LaneError(`choose exactly one primary operation; received ${selectedPrimary.join(', ')}`)
    if(hasAdmission&&(!Number.isInteger(o.admitIssue)||o.admitIssue<=0))throw new LaneError('--admit-issue requires a positive issue number')
    const numericPrimary=new Set(['resolveAdmittedIssueForPr','outcomeStatus','completeOutcome','preparePreviewDispatch','returnIssue'])
    if(selectedPrimary.length===1&&numericPrimary.has(selectedPrimary[0])&&(!Number.isInteger(o[selectedPrimary[0]])||o[selectedPrimary[0]]<=0))throw new LaneError(`--${selectedPrimary[0].replace(/[A-Z]/g,(value)=>`-${value.toLowerCase()}`)} requires a positive number`)
    const admissionCombined=new Set(['claim','assignReviewer','replaceFailedReviewer','preparePreviewDispatch','acquireExclusive','advanceOutcome'])
    if(hasAdmission&&selectedPrimary.length===1&&!admissionCombined.has(selectedPrimary[0]))throw new LaneError(`--admit-issue cannot be combined with --${selectedPrimary[0].replace(/[A-Z]/g,(value)=>`-${value.toLowerCase()}`)}`)
    if(o.authorizeRepositoryMaintenanceStatus){console.log(JSON.stringify(authorizeRepositoryMaintenanceStatus(o,io),null,2));return 0}
    if(o.resolveAdmittedIssueForPr){console.log(JSON.stringify(resolveAdmittedIssueForPr(o.resolveAdmittedIssueForPr,io),null,2));return 0}
    const admissionOnly=hasAdmission&&selectedPrimary.length===0
    if(admissionOnly){console.log(JSON.stringify(admitIssueSerialized(o.admitIssue,io,{pr:o.pr??null,allowLegacy:o.pr!==undefined&&o.pr!==null}),null,2));return 0}
    if(o.outcomeStatus){console.log(JSON.stringify(outcomeHistory(io.issueComments(o.outcomeStatus),Number(o.outcomeStatus)),null,2));return 0}
    if(o.advanceOutcome){
      if(!o.issue)throw new LaneError('--advance-outcome requires --issue <n>')
      if(!o.evidence)throw new LaneError('--advance-outcome requires --evidence <durable URL>')
      const result=withAuthorMutex('outcome-advance',io,o,(ownerSha)=>{
        requireAdmission(o,io,{pr:o.pr??null,mutexOwner:ownerSha})
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        return advanceOutcome({issue:Number(o.issue),state:o.advanceOutcome,actor:o.owner??'manage-migration-author-lanes',timestamp:now.toISOString(),evidenceUrls:[o.evidence]},io)
      })
      console.log(JSON.stringify(result,null,2));return 0
    }
    if(o.completeOutcome){
      if(!o.evidence)throw new LaneError('--complete-outcome requires --evidence <durable comment URL>')
      const result=withAuthorMutex('outcome-complete',io,o,(ownerSha)=>completeOutcome({issue:o.completeOutcome,evidenceRef:o.evidence,actor:o.owner??'manage-migration-author-lanes',timestamp:now.toISOString()},{...io,parseScope:parseQueueScope,
        commentIssue:(...args)=>{requireOwnedRef(MUTEX_REF,ownerSha,io);return io.commentIssue(...args)},
        updateIssue:(...args)=>{requireOwnedRef(MUTEX_REF,ownerSha,io);return io.updateIssue(...args)},
      }))
      console.log(JSON.stringify(result,null,2));return 0
    }
    if(o.recoverMutex){console.log(JSON.stringify(recoverStaleAuthorMutex({expectedSha:o.expectedSha,confirmStale:o.confirmStale,serializedRecovery:process.env.GITHUB_ACTIONS==='true'&&process.env.AUTHOR_MUTEX_RECOVERY_SERIALIZED==='true',now},io),null,2));return 0}
    if(o.reconcileFlow){
      if(typeof io.orchestratorFlowAdapter!=='function')throw new LaneError('reconcile runtime adapter is unavailable')
      const result=reconcileFlow(io.flowSnapshot(),io.orchestratorFlowAdapter());console.log(JSON.stringify(result,null,2));return result.status==='UNVERIFIABLE'?2:0
    }
    if(o.preparePreviewDispatch){
      if(typeof io.orchestratorFlowAdapter!=='function')throw new LaneError('preview preparation runtime adapter is unavailable')
      requireAdmissionArguments(o,io,{pr:o.pr})
      const result=preparePreviewDispatch(o.preparePreviewDispatch,io.orchestratorFlowAdapter(o.claimNumber,io.enforceAdmission===true?o:null))
      console.log(JSON.stringify(result,null,2));return 0
    }
    if(o.repairPreviewReady){
      if(!o.issue)throw new LaneError('--repair-preview-ready requires --issue <n>')
      if(typeof io.orchestratorFlowAdapter!=='function')throw new LaneError('preview repair runtime adapter is unavailable')
      console.log(JSON.stringify(repairPreviewReady(o.repairPreviewReady,Number(o.issue),io.orchestratorFlowAdapter()),null,2));return 0
    }
    if(o.terminalizeHistoricalPreviewReady){
      console.log(JSON.stringify(terminalizeHistoricalPreviewReady({readyId:o.terminalizeHistoricalPreviewReady,issue:o.issue,runId:o.runId,artifactId:o.artifactId,artifactDigest:o.artifactDigest,manifestDigest:o.manifestDigest},io),null,2));return 0
    }
    if(o.flowAudit){
      if(!o.issue)throw new LaneError('--flow-audit requires --issue <n>')
      const events=(io.getIssueComments(Number(o.issue))??[]).flatMap((comment)=>parseEventComment(comment.body??comment))
      const audit=auditTimeline(events)
      console.log(o.json?JSON.stringify(audit,null,2):renderTimeline(audit))
      return audit.valid?0:2
    }
    if(o.recoverSplit){console.log(JSON.stringify(recoverSameOwnerSplit(o,now,io),null,2));return 0}
    if(o.expandClaim){console.log(JSON.stringify(expandActiveClaimFromPr({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.expandClaimFromIssue){console.log(JSON.stringify(expandActiveClaimFromIssue({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.renewClaim){console.log(JSON.stringify(renewExpiredClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.recoverExpiredClaim){console.log(JSON.stringify(recoverExpiredClaimFromPr({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.relinquishAuthorLease){console.log(JSON.stringify(relinquishAuthorLease({...o,claim:o.claimNumber??o.claim},now,io),null,2));return 0}
    if(o.resumeAuthorLease){console.log(JSON.stringify(resumeAuthorLease({...o,claim:o.claimNumber??o.claim},now,io),null,2));return 0}
    if(o.reissueMergedClaim){console.log(JSON.stringify(reissueMergedStrandedClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.reversionClaim){console.log(JSON.stringify(reversionActiveClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.replaceFailedReviewer){const result=replaceFailedReviewer({...o,slot:o.reviewSlot!==undefined?Number(o.reviewSlot):1,admissionOptions:io.enforceAdmission===true?o:null},io);console.log(JSON.stringify(result,null,2));return 0}
    if(o.releaseFailedReviewer){console.log(JSON.stringify(releaseFailedReviewer({...o,slot:o.reviewSlot!==undefined?Number(o.reviewSlot):1},io),null,2));return 0}
    if(o.probeSilentReviewer){console.log(JSON.stringify(probeSilentReviewer({...o,slot:o.reviewSlot!==undefined?Number(o.reviewSlot):1},now,io),null,2));return 0}
    if(o.reclaimSilentReviewer){console.log(JSON.stringify(reclaimSilentReviewer({...o,slot:o.reviewSlot!==undefined?Number(o.reviewSlot):1},now,io),null,2));return 0}
    if(o.reviewerCapacity){console.log(JSON.stringify(reviewerCapacityReport(io,now),null,2));return 0}
    if(o.excludeReviewer){console.log(JSON.stringify(excludeReviewerForPr(o,io),null,2));return 0}
    if(o.reinstateReviewerExclusion){console.log(JSON.stringify(reinstateReviewerExclusion(o,io),null,2));return 0}
    if(o.reviewerPreflight){console.log(JSON.stringify(reviewerExecutionPreflight(o,io),null,2));return 0}
    if(o.assignReviewer){assertReviewerDrawIsWarranted(o.pr,io);console.log(JSON.stringify(assignWithMutexRetry({issue:o.issue,pr:o.pr,headSha:o.headSha,slot:o.reviewSlot!==undefined?Number(o.reviewSlot):1,admissionOptions:io.enforceAdmission===true?o:null},io),null,2));return 0}
    if(o.activateReviewCutover){console.log(JSON.stringify(activateReviewCutover(io),null,2));return 0}
    if (o.acquireExclusive) { if(o.acquireExclusive!=='merge')requireAdmissionArguments(o,io,{pr:o.pr??null});console.log(JSON.stringify(acquireExclusive(o.acquireExclusive, { owner:o.owner, pr:o.pr, headSha:o.headSha, versions:o.versions, versionPrMap:o.versionPrMap, admissionOptions:o }, io), null, 2)); return 0 }
    if (o.releaseExclusive) { if (!o.ownerSha) throw new LaneError('--owner-sha is required for safe release'); releaseOwnedRef(EXCLUSIVE_REFS[o.releaseExclusive], o.ownerSha, io); return 0 }
    if(o.claim){
      for (const k of ['task','owner','branch','worktree']) if (!o[k]) throw new LaneError(`--${k} is required`)
      if (!o.objects.length) throw new LaneError('--objects must name every database object exactly')
      o.leaseHours ??= DEFAULT_LEASE_HOURS
      if (!Number.isFinite(o.leaseHours) || o.leaseHours <= 0 || o.leaseHours > 24) throw new LaneError('--lease-hours must be greater than 0 and no more than 24')
      const claimed=acquireAuthorLane(o, now, io)
      console.log(JSON.stringify(claimed, null, 2));return 0
    }
    const claims = io.openClaims()
    if (o.returnIssue) { console.log(JSON.stringify(returnIssueToOwner(o.returnIssue, io), null, 2)); return 0 }
    if (o.queueAudit) {
      const issues = io.openWorkIssues()
      const outcomeStates=new Map()
      for(const issue of issues){
        let scope=null
        try{scope=parseQueueScope(issue.body)}catch{continue}
        if(scope?.workType!=='structural'||scope.route!=='shared-db-orchestrator')continue
        const history=outcomeHistory(io.issueComments(issue.number),Number(issue.number))
        if(!history.valid)throw new LaneError(`issue #${issue.number} has invalid authoritative outcome history: ${history.problems.join('; ')}`)
        outcomeStates.set(Number(issue.number),history.state??'entered')
      }
      // Gather dependency state before building the queue so the pure function
      // stays pure. Referenced numbers come from the scope blocks themselves.
      const referenced = new Set()
      for (const issue of issues) {
        let scope = null
        try { scope = parseQueueScope(issue.body) } catch { /* malformed scopes are reported by the audit itself */ }
        for (const number of scope?.dependencies ?? []) referenced.add(number)
      }
      const dependencyStates = referenced.size && io.dependencyStates ? io.dependencyStates([...referenced]) : null
      // Re-derive the merge evidence rather than trusting the record's own claim.
      if (dependencyStates && io.mergeCommitInMain) {
        for (const [number, state] of Object.entries(dependencyStates)) {
          if (state.open || state.unreadable || state.exists === false) continue
          let record = null
          try { record = findCompletionRecord(state.comments) } catch { continue }
          if (['merged','live_verified'].includes(record?.outcome)) state.mergeInMain = io.mergeCommitInMain(record.merge_sha)
        }
      }
      const openPulls = io.openPulls?.() ?? []
      const claimPullStates = new Map()
      for (const claim of claims) {
        const lease = parseAuthorLease(claim.body, now)
        if (lease.legacy || lease.active || !lease.capacityActive) continue
        if (openPulls.some((pull)=>pull.head?.ref === lease.branch)) { claimPullStates.set(claim.number, 'open'); continue }
        const historical = io.branchPulls?.(lease.branch) ?? []
        claimPullStates.set(claim.number, historical.some((pull)=>pull.merged_at) ? 'merged' : historical.length ? 'closed-unmerged' : 'none')
      }
      // Resolve historical authoring only for the bounded set that would be
      // dispatched. This catches merged work without scanning all historical
      // claim refs or spending an unbounded GitHub API budget.
      let result = buildDynamicQueues(issues, claims, now, io.openIssueNumbers(), dependencyStates, claimPullStates,new Set(),outcomeStates)
      const authoredOnMain = new Set()
      if (result.dispatchable.length && io.closedClaimsForWork && io.branchPulls && io.treeFiles && io.mainSha && io.mergeCommitInMain) {
        const main = io.mainSha()
        const mainVersions = new Set(io.treeFiles(main).filter((file)=>/^supabase\/migrations\/\d{14}_/.test(file)).map((file)=>path.basename(file).slice(0,14)))
        const checked = new Set()
        // Removing one already-authored issue can expose the next item in its
        // collision queue. Iterate to a fixed point and inspect each issue at
        // most once so a deeper queue cannot hide another completed authoring.
        while (true) {
          const fresh = result.dispatchable.filter((issue)=>!checked.has(issue))
          if (!fresh.length) break
          for (const issue of fresh) {
            checked.add(issue)
            const completed = io.closedClaimsForWork(issue).some((claim)=>{
              let lease
              try { lease = parseAuthorLease(claim.body, now) } catch { return false }
              if (!mainVersions.has(lease.version)) return false
              return (io.branchPulls(lease.branch)??[]).some((pull)=>pull.merged_at&&pull.merge_commit_sha&&io.mergeCommitInMain(pull.merge_commit_sha))
            })
            if (completed) authoredOnMain.add(issue)
          }
          if (!fresh.some((issue)=>authoredOnMain.has(issue))) break
          result = buildDynamicQueues(issues, claims, now, io.openIssueNumbers(), dependencyStates, claimPullStates, authoredOnMain,outcomeStates)
        }
      }
      for (const issue of result.urgentWaitingCapacity ?? []) {
        const exists=(io.issueComments?.(issue)??[]).flatMap((comment)=>{try{return parseEventComment(comment?.body??'')}catch{return[]}})
          .some((event)=>event.event_type==='urgent_waiting_capacity'&&event.result==='succeeded')
        if(!exists&&io.commentIssue){
          io.commentIssue(issue,formatEventComment(coordinationEvent({eventType:'urgent_waiting_capacity',workIssue:issue,actor:'queue-audit',timestamp:now.toISOString(),service_class:'urgent-application',detail:'all safe author capacity is occupied or object-protected; no active work was preempted'})))
        }
      }
      console.log(JSON.stringify(result,null,2))
      // Printed BEFORE the refill early-return: a queue with any dispatchable
      // work would otherwise hide this list entirely, which is exactly how these
      // items accumulated unseen in the first place.
      if (result.notOrchestratorWork.length) {
        // Split the list by what the orchestrator must DO. The single old
        // heading told the reader to "reject or fork each one", which reads as a
        // worklist even for items the orchestrator has no business touching.
        const actionable = result.notOrchestratorWork.filter((item)=>!OUTSIDE_ORCHESTRATOR_EXITS.includes(item.exit))
        const outside = result.notOrchestratorWork.filter((item)=>OUTSIDE_ORCHESTRATOR_EXITS.includes(item.exit))
        const describe = (item) => {
          const owner = item.blockedOnOwner ? ' [blocked on owner decision]' : ''
          const address = item.exit === 'reject'
            ? (item.returnTo ? ` -> ${item.returnTo}` : ' -> NO RETURN ADDRESS: add `return_to: owner/repo` before returning it')
            : ''
          return `  #${item.issue} ${item.exit.toUpperCase()} — work_type ${item.workType}, route ${item.route}${owner}${address}`
        }
        if (actionable.length) {
          console.error('NOT ORCHESTRATOR WORK: these open issues fail the shape test (AGENTS.md 0.0-C). Reject or fork each one; never work it here.')
          for (const item of actionable) console.error(describe(item))
        }
        if (outside.length) {
          // OWNER RULING 2026-08-21 (issue #1366): the orchestrator handles
          // structure and schema only. These rows are listed so an audit can see
          // them and so nothing accumulates unseen - NOT so the orchestrator can
          // pick them up. There is no orchestrator action for any of them.
          console.error('OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION: listed for audit visibility only (owner ruling 2026-08-21, issue #1366). The orchestrator does structure/schema only. Do NOT work these and do NOT dispatch them; a separately started session owns them.')
          for (const item of outside) console.error(describe(item))
        }
        const unaddressed = result.notOrchestratorWork.filter((item)=>item.needsReturnAddress)
        if (unaddressed.length) console.error(`NO RETURN ADDRESS on ${unaddressed.map((item)=>`#${item.issue}`).join(', ')} — a reject with no forwarding address closes into silence. Return each with --return-issue <n> once addressed.`)
      }
      // A CYCLE CAN NEVER START. Reported separately from "blocked", because a
      // blocked task is waiting for something and a cycle is waiting for itself.
      if (result.dependencyCycles.length) {
        console.error('DEPENDENCY CYCLE: these issues can never start, because each waits on the next. Break the cycle by removing one depends_on edge.')
        for (const cycle of result.dependencyCycles) console.error(`  ${cycle.map((n)=>`#${n}`).join(' -> ')}`)
      }
      // Print WHY a dependency blocked. "depends-on-open:12" was the whole
      // diagnostic before; an invalid or unsuccessfully-completed dependency now
      // says so in words, because those are the cases that used to release work.
      if (result.grandfatheredDependencies?.length) {
        console.error('GRANDFATHERED DEPENDENCIES: closed before completion records were required, so accepted without proof. Countable on purpose; Step 8A retires the cutoff when this list is empty.')
        for (const row of result.grandfatheredDependencies) console.error(`  #${row.issue} — ${row.detail}`)
      }
      const dependencyBlocked = result.skipped.filter((row)=>row.detail)
      if (dependencyBlocked.length) {
        console.error('DEPENDENCIES NOT PROVEN: closure alone is not success (Step 3, issue #1366).')
        for (const row of dependencyBlocked) console.error(`  #${row.issue} — ${row.detail}`)
      }
      if (result.expiredClaims.length) {
        console.error('EXPIRED AUTHOR LEASES: occupancy is locked but no live author lease exists. Inspect and explicitly renew, resume, or close out each claim; expiry never releases object protection.')
        for (const row of result.expiredClaims) console.error(`  claim #${row.claim}, lane ${row.lane}, expired ${row.expires_at}, PR ${row.pr_state}, queued ${row.queued.length ? row.queued.map((number)=>`#${number}`).join(', ') : 'none'}`)
      }
      if (result.dispatchable.length) { console.error(`REFILL REQUIRED NOW: dispatch issue(s) ${result.dispatchable.map((n)=>`#${n}`).join(', ')}`); return 2 }
      if (result.unlabelled.length) console.error(`UNLABELLED ISSUES: add the \`${WORK_LABEL}\` label to ${result.unlabelled.map((n)=>`#${n}`).join(', ')} — an unlabelled issue is invisible to every label-filtered query`)
      if (!result.fullyAudited) { console.error('EMPTY LANE NOT PROVEN: classify and label every open issue before claiming no eligible work exists'); return 2 }
      return result.malformed.length || result.unlabelled.length || result.dependencyCycles.length || result.expiredClaims.some((row)=>row.queued.length) || result.notOrchestratorWork.some((item)=>item.needsReturnAddress) ? 2 : 0
    }
    if (o.assertExclusive) {
      const lease = assertExclusive(o.assertExclusive, {
        holderId: o.holderId, generation: o.generation, kind: o.assertExclusive,
        headSha: o.headSha, pr: o.pr ? Number(o.pr) : undefined,
      }, io)
      console.log(JSON.stringify({ kind: o.assertExclusive, holderId: lease.holderId, generation: lease.generation, headSha: lease.headSha }, null, 2))
      return 0
    }
    if (o.releaseExclusive) {
      const result = releaseExclusive(o.releaseExclusive, { holderId: o.holderId, generation: o.generation, ownerSha: o.ownerSha }, io)
      console.log(JSON.stringify(result, null, 2))
      return 0
    }
    if (o.recoverExclusive) {
      // DRY RUN BY DEFAULT. A recovery that turns out to be wrong produces the
      // split ownership this whole step exists to prevent.
      const result = recoverExclusive(o.recoverExclusive, { holderId: o.holderId, apply: Boolean(o.applyRecovery) }, io)
      console.log(JSON.stringify(result, null, 2))
      if (!result.recovered && !result.dryRun) { console.error(`RECOVERY REFUSED: ${result.reason}`); return 1 }
      if (result.dryRun) console.error(`DRY RUN — would recover: ${result.reason}. Re-run with --apply-recovery to take the lane.`)
      return 0
    }
    if (o.completeWork) {
      if (!o.issue) throw new LaneError('--complete-work requires --issue <n>')
      if (!o.reportFile) throw new LaneError('--complete-work requires --report-file <path>')
      let report
      try { report = JSON.parse(readFileSync(o.reportFile, 'utf8')) }
      catch (error) { throw new LaneError(`--report-file is not readable JSON: ${error.message}`) }
      const published = completeWork({ issue: Number(o.issue), report }, io)
      console.log(JSON.stringify(published, null, 2))
      console.error(`Completion recorded on #${o.issue} as ${published.outcome}. You may now close the issue.`)
      return 0
    }
    if (o.releaseClaim) {
      if (!o.confirmFinished || !o.owner) throw new LaneError('--release-claim requires exact --owner and --confirm-finished')
      const requestId=randomUUID(), ownerSha=io.makeOwnerCommit(`db-coordination claim-release ${requestId}`)
      acquireMutex(ownerSha,io)
      try {
        const fresh=io.openClaims(), claim=fresh.find((x)=>String(x.number)===String(o.releaseClaim))
        if(!claim)throw new LaneError(`claim #${o.releaseClaim} is not open`)
        const lease=parseAuthorLease(claim.body,now)
        if(lease.owner!==o.owner)throw new LaneError(`claim #${o.releaseClaim} belongs to a different owner`)
        if((io.openPulls?.() ?? io.prSources()).some((pr)=>(pr.head?.ref ?? pr.branch)===lease.branch))throw new LaneError(`claim branch ${lease.branch} still has an open pull request`)
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        io.closeClaim(claim.number, CLAIM_CLOSE_REASONS.explicitRelease)
      } finally { if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io) }
      return 0
    }
    // ISSUE #2454 — release a DUPLICATE author claim on a branch that
    // legitimately has an open PR. The ordinary --release-claim guard stays
    // exactly as it is: it cannot tell "the" claim for a branch from "a"
    // duplicate, and widening it would let real in-flight work be released.
    // Instead every precondition below is PROVED from live GitHub state, and
    // there is no caller-supplied override: the tool itself must establish
    // that the claim being closed is not the authority for the branch.
    if (o.releaseDuplicateClaim) {
      if (!o.confirmFinished || !o.owner) throw new LaneError('--release-duplicate-claim requires exact --owner and --confirm-finished')
      const requestId=randomUUID(), ownerSha=io.makeOwnerCommit(`db-coordination duplicate-claim-release ${requestId}`)
      acquireMutex(ownerSha,io)
      try {
        const fresh=io.openClaims(), claim=fresh.find((x)=>String(x.number)===String(o.releaseDuplicateClaim))
        if(!claim)throw new LaneError(`claim #${o.releaseDuplicateClaim} is not open`)
        const lease=parseAuthorLease(claim.body,now)
        if(lease.legacy)throw new LaneError(`claim #${claim.number} is a legacy claim and cannot be proved to be a duplicate`)
        if(lease.owner!==o.owner)throw new LaneError(`claim #${claim.number} belongs to a different owner`)
        // (1) at least one OTHER open non-legacy claim declares the same branch
        const siblings=fresh.filter((x)=>String(x.number)!==String(claim.number))
          .map((x)=>({claim:x,lease:parseAuthorLease(x.body,now)}))
          .filter((row)=>!row.lease.legacy&&row.lease.branch===lease.branch)
        if(siblings.length===0)throw new LaneError(`claim #${claim.number} is the only open claim on branch ${lease.branch}; there is no duplicate to release`)
        // (2)+(3) are proved from a LIVE read of the branch's open pull request
        // and its files. The read is repeated under the mutex immediately before
        // the close, so a push landing between the two reads cannot let a stale
        // snapshot stand in as the authority proof.
        const provePullRequestAuthority=()=>{
          const pulls=((io.openPulls?.() ?? io.prSources())).filter((row)=>(row.head?.ref ?? row.branch)===lease.branch)
          if(pulls.length!==1)throw new LaneError(`branch ${lease.branch} must have exactly one open pull request to prove which claim is the authority; found ${pulls.length}`)
          const pr=pulls[0], versions=[...new Set(migrationVersions(io.getPrFiles(pr.number)))]
          if(versions.length===0)throw new LaneError(`open pull request #${pr.number} changes no migration file, so no authority claim can be proved`)
          // the claim being released must NOT hold a version the PR uses
          if(versions.includes(lease.version))throw new LaneError(`claim #${claim.number} holds migration version ${lease.version}, which open pull request #${pr.number} uses; it is the authority claim for branch ${lease.branch}, not a duplicate`)
          // exactly one OTHER open claim on the branch DOES hold such a version
          const authority=siblings.filter((row)=>versions.includes(row.lease.version))
          if(authority.length!==1)throw new LaneError(`exactly one other open claim on branch ${lease.branch} must hold a migration version used by open pull request #${pr.number}; found ${authority.length}`)
          return {pr,versions,authority}
        }
        const first=provePullRequestAuthority()
        // (4) owner matched above, and the mutex is still ours at the write
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        // (5) re-prove after the ownership check, against a fresh read, and
        // refuse if the branch's pull request or its authority claim moved.
        const proof=provePullRequestAuthority()
        if(String(proof.pr.number)!==String(first.pr.number)||String(proof.authority[0].claim.number)!==String(first.authority[0].claim.number)||proof.authority[0].lease.version!==first.authority[0].lease.version)throw new LaneError(`branch ${lease.branch} changed while the duplicate release was being proved; nothing was closed`)
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        io.closeClaim(claim.number, CLAIM_CLOSE_REASONS.duplicateRelease)
        const {pr,authority}=proof
        console.error(`Closed duplicate claim #${claim.number} on branch ${lease.branch}. Authority claim #${authority[0].claim.number} holds ${authority[0].lease.version}, the version open pull request #${pr.number} uses. The duplicate's migration version ${lease.version} remains permanently reserved.`)
      } finally { if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io) }
      return 0
    }
    if (o.cleanup) {
      const { stale } = assertLaneAvailable(claims, [], now)
      console.log(`${stale.length} expired claim(s) remain locked. Release each explicitly with --release-claim, exact --owner, and --confirm-finished.`); return stale.length ? 2 : 0
    }
    if (o.audit) {
      const malformed=[];let protectedCount=0,occupied=0,relinquished=0,expired=0
      for(const claim of claims){try{const lease=parseAuthorLease(claim.body,now);protectedCount++;if(lease.capacityActive)occupied++;else relinquished++;if(!lease.legacy&&!lease.active)expired++}catch(e){malformed.push(`#${claim.number}: ${e.message}`)}}
      console.log(`${occupied} active-author lease(s) (no cap); ${protectedCount} protected claim(s); ${relinquished} relinquished; ${expired} expired lease(s) remain locked.`)
      for(const problem of malformed)console.error(`MALFORMED ${problem}`)
      return malformed.length ? 2 : 0
    }
    throw new LaneError('choose --admit-issue, --claim, --audit, --queue-audit, --outcome-status, --complete-outcome, --return-issue, --cleanup-stale, --activate-review-cutover, or an exclusive-lane command')
  } catch (error) { console.error(`REFUSED: ${error.message}`); return 2 }
}

export function validateOriginalPreviewApplyEvidence({issue,pr,versions,mergeCommitSha=null},io){
  const runIds=[...new Set((io.issueComments(issue)??[]).flatMap((comment)=>{
    const body=String(comment.body??comment)
    const linked=[...body.matchAll(/actions\/runs\/(\d+)/g)].map((match)=>match[1])
    // Historical operator notes sometimes recorded the successful preview apply
    // as a labelled run id rather than a URL.  Admit only that exact notation;
    // every discovered candidate still has to pass the immutable run, binding,
    // artifact and ledger-delta checks below.
    const labelled=[...body.matchAll(/^\s*-\s*apply\s+`(\d+)`\s+(?:—|-)\s+success\s*$/gim)].map((match)=>match[1])
    return [...linked,...labelled]
  }))]
  const expected=[...versions].map(String).sort(),matches=[]
  for(const runId of runIds){try{
    const {run,artifacts,logs}=io.previewApplyRun(runId)
    if(String(run?.id)!==String(runId)||run?.path!=='.github/workflows/shared-supabase-migrations.yml'||run?.event!=='workflow_dispatch'||run?.status!=='completed'||run?.conclusion!=='success'||run?.run_attempt!==1||!/^[0-9a-f]{40}$/i.test(String(run?.head_sha??'')))continue
    const bindings=String(logs).split(/\r?\n/).flatMap((line)=>{const start=line.indexOf('{"allowlist"'),end=line.lastIndexOf('}');if(start<0||end<start)return[];try{return[JSON.parse(line.slice(start,end+1))]}catch{return[]}}).filter((row)=>row.schema==='shared-db-preview-instance-binding/v1')
    if(bindings.length!==1)continue
    const binding=bindings[0],allowlist=Array.isArray(binding.allowlist)?binding.allowlist.map(String).sort():[]
    if(String(binding.runId)!==String(runId)||binding.previewProjectRef!==PROJECT_REFS.preview||!/^[0-9a-f]{40}$/i.test(String(binding.appliedCommit??''))||JSON.stringify(allowlist)!==JSON.stringify(expected))continue
    const mergedMainRehearsal=Boolean(mergeCommitSha&&binding.rehearsalMode==='merged-main-rehearsal'&&Number(binding.sourcePr)===Number(pr)&&String(binding.mergeCommitSha).toLowerCase()===String(mergeCommitSha).toLowerCase()&&binding.appliedCommit===run.head_sha)
    // A byte-pinned restoration may have one genuine ordinary claim apply that
    // predates its merge.  That immutable apply is the reason the restoration
    // exists: replaying it would be unsafe.  Admit the distinct dispatch/applied
    // checkout only when every identity and the file now in the merge commit
    // exactly matches the restoration registry.  Unregistered claim runs retain
    // the old refusal, as do all malformed or partially pinned bundles.
    let pinnedClaimApply=false
    if(mergeCommitSha&&binding.rehearsalMode==='claim'){
      const records=expected.map((version)=>HISTORICAL_RESTORATIONS[version]).filter(Boolean)
      pinnedClaimApply=records.length===expected.length&&records.length>0&&records.every((record)=>{
        if(String(record.previewApplyRun)!==String(runId)||record.previewAppliedCommit!==binding.appliedCommit||record.previewProject!==binding.previewProjectRef)return false
        try{return validateHistoricalRestorationFile(record.filename,io.getFileAt(record.filename,mergeCommitSha))===record}catch{return false}
      })
    }
    if(mergeCommitSha&&!mergedMainRehearsal&&!pinnedClaimApply)continue
    if(!mergeCommitSha&&binding.appliedCommit!==run.head_sha)continue
    const appliedCommit=pinnedClaimApply?binding.appliedCommit:run.head_sha
    const rows=Array.isArray(artifacts?.artifacts)?artifacts.artifacts:[]
    if(Number(artifacts?.total_count)!==1||rows.length!==1||rows[0].expired!==false||!/^sha256:[0-9a-f]{64}$/i.test(String(rows[0].digest??''))||rows[0].name!==`preview-migration-apply-${appliedCommit}`||String(rows[0].workflow_run?.id)!==String(runId)||rows[0].workflow_run?.head_sha!==run.head_sha)continue
    const ledgerLines=String(logs).split(/\r?\n/).flatMap((line)=>{
      const fields=line.replace(/^\ufeff/,'').split('\t')
      if(fields.length<3||fields[1]!=='Report the preview ledger delta')return[]
      return [fields.slice(2).join('\t').replace(/^\d{4}-\d{2}-\d{2}T\S+Z\s*/, '')]
    })
    // Archived gh display logs may lose every step name. Never relabel that
    // text: require the original ZIP's immutable digest, binding, ledger files,
    // and migration content instead. A present but invalid named step still
    // refuses; the alternate reader cannot conceal contradictory named proof.
    if(ledgerLines.length===0&&typeof io.verifyPreviewApplyArtifact==='function'){
      const artifact=rows[0]
      const proof=io.verifyPreviewApplyArtifact({run,artifact,binding,versions:expected,previewProjectRef:PROJECT_REFS.preview,verificationCommit:mergeCommitSha??appliedCommit})
      if(proof?.verified===true&&proof.runId===run.id&&proof.artifactId===artifact.id&&proof.artifactDigest===artifact.digest&&JSON.stringify(proof.versions)===JSON.stringify(expected))matches.push({type:'preview-apply',run_id:String(runId)})
      continue
    }
    if(ledgerLines.filter((line)=>line==='### Preview ledger delta').length!==1)continue
    const ledgerAdded=ledgerLines.flatMap((line)=>{
      const match=/- added:\s+((?:\d{14})(?:,\s*\d{14})*)\s*$/.exec(line)
      return match?[match[1].split(',').map((value)=>value.trim()).sort()]:[]
    })
    if(ledgerAdded.length!==1||JSON.stringify(ledgerAdded[0])!==JSON.stringify(expected)||ledgerLines.filter((line)=>/- removed:\s+\(none\)\s*$/.test(line)).length!==1)continue
    matches.push({type:'preview-apply',run_id:String(runId)})
  }catch{/* An unreadable candidate cannot become evidence. */}}
  for(const runId of runIds){try{
    const {run,artifacts,logs}=io.previewApplyRun(runId)
    if(expected.length!==1||String(run?.id)!==String(runId)||run?.path!=='.github/workflows/preview-ledger-orphan-reconciliation.yml'||run?.event!=='workflow_dispatch'||run?.status!=='completed'||run?.conclusion!=='success'||run?.run_attempt!==1||!/^[0-9a-f]{40}$/i.test(String(run?.head_sha??'')))continue
    const applied=/PREVIEW LEDGER RECONCILIATION APPLY OK: removed=(\d{14}) replacement=(\d{14})/.exec(String(logs))
    // Only a true rename preserves already-applied status. A same-version
    // rehearsal reset deletes the ledger row so the migration can run again;
    // it is therefore the opposite of immutable no-replay evidence.
    if(!applied||applied[1]===applied[2]||applied[2]!==expected[0])continue
    const exact=(name,value)=>new RegExp(`(?:^|\\s)${name}:\\s+${String(value)}(?:\\s|$)`,'m').test(String(logs))
    if(!exact('ISSUE',issue)||!exact('SOURCE_PR',pr)||!exact('ORPHAN',applied[1])||!exact('REPLACEMENT',applied[2]))continue
    if(mergeCommitSha){const relation=io.compareCommits?.(mergeCommitSha,run.head_sha);if(!relation||!['ahead','identical'].includes(relation.status))continue}
    const rows=Array.isArray(artifacts?.artifacts)?artifacts.artifacts:[]
    if(Number(artifacts?.total_count)!==1||rows.length!==1||rows[0].expired!==false||rows[0].name!==`preview-ledger-orphan-reconciliation-${applied[1]}`||String(rows[0].workflow_run?.id)!==String(runId)||rows[0].workflow_run?.head_sha!==run.head_sha)continue
    matches.push({type:'preview-ledger-reconciliation',run_id:String(runId),orphan_version:applied[1],replacement_version:applied[2]})
  }catch{/* An unreadable candidate cannot become evidence. */}}
  if(matches.length!==1)throw new LaneError(`already-applied versions require exactly one validated immutable preview apply or ledger-reconciliation run; found ${matches.length}`)
  return matches[0]
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2))
