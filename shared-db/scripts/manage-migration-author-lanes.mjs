#!/usr/bin/env node
import {hostname} from 'node:os'
import {parseStrictJson} from './proofs/shared-db-2870-observation.mjs'
import {recoveryCodeUnchangedAt} from './lib/claim-recovery-dependencies.mjs'
import {recoverCompletedForeignClaim,recoveryDigest,RECOVERY_CODE_PATHS} from './lib/lanes/completed-claim-recovery.mjs'
import { createStageEvidenceVerifier } from './lib/work-stage-evidence.mjs'
import { resolveEvidencePair, isEvidencePath } from './lib/agent-evidence-paths.mjs'
import { contractHash, validateContract, validateCompletionReport, validatePullRequestCompletion, reconcileReportWithContract } from './agent-work-contract.mjs'
import { verifyGitEvidence, gitIo, readPublishedContractFromGit } from './agent-work-contract-git-evidence.mjs'

import { execFileSync } from 'node:child_process'
import { runGitHubCommand as sharedRunGitHubCommand, isTransientGitHubTransport, hostQuotaLatch } from './lib/github-transport.mjs'
import { createTreeReader } from './lib/github-tree.mjs'
import { reviewCallerEnvironment } from './lib/reviewer-caller-env.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { readZipEntries } from './lib/zip-entries.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gatherOpenPrObjects, normalizeObject, parseClaimBlock } from './check-dispatch-collision.mjs'
import { dependencyIssue, parseDependencyDeclarations, classifyDependencies, findCompletionRecord, findDependencyCycles, validateCompletionRecord, validateDependencyDeclaration, COMPLETION_FENCE, DependencyError } from './lib/work-dependencies.mjs'
import { assertLease, evaluateRecovery, formatLeaseMessage, parseLeaseMessage, recoveredLeaseMetadata, LeaseError } from './lib/exclusive-lease.mjs'
import { coordinationEvent, formatEventComment, parseEventComment, auditTimeline, renderTimeline } from './db-coordination-events.mjs'
import { reconcileFlow, persistInitialReady, preparePreviewDispatch, repairPreviewReady, terminalizeReady, readyRecord, MODE_SEQUENCE, parseAbandonmentAudit, reportOnlyFlowIo, abandonmentAuditExit, AUDIT_EXIT_UNVERIFIABLE } from './orchestrator-flow/reconcile.mjs'
import { MERGE_SELF_CONTEXT } from './lib/merge-self-context.mjs'
import { selectPreviewArtifacts } from './orchestrator-flow/preview-artifact-selection.mjs'
import { currentRepository, isThisRepositoryOrHistorical, isTrustedOperatorComment, repositoryCommentApiPath } from './lib/repository-identity.mjs'
import { readRequiredCheckContexts } from './lib/required-check-readback.mjs'
import { readSessionId, resolveSessionAuthority, sessionAuthorityRefusal } from './lib/session-authority.mjs'
import { authorityReadEnv } from './lib/authority-token-read.mjs'
import { buildEvidenceBundle, canonicalJson, sha256 } from './orchestrator-flow/evidence-bundle.mjs'
import { assertDeliveryPreflightBeforeReview, runDeliveryPreflightGate } from './orchestrator-flow/delivery-preflight-gate.mjs'
import { trustedEvidenceRegistryReader } from './orchestrator-flow/delivery-preflight.mjs'
import { bindSenderPreviewClassification, databasePreviewRequiredFromEvidenceBundle, selectPreviewRoute, validatePreviewClassification } from './orchestrator-flow/select-preview-route.mjs'
import { PROJECT_REFS } from './orchestrator-flow/read-preview-ledger.mjs'; import { verdictOpensLine as sharedVerdictOpensLine, evidenceTiedToHead as sharedEvidenceTiedToHead, isApprovalFor as sharedIsApprovalFor, isVerdictFor as sharedIsVerdictFor, anyVerdictFor as sharedAnyVerdictFor } from './lib/review-verdict.mjs'
import { REVIEW_VERDICT_REF_PREFIX, REVIEW_VERDICT_REPLACEMENT_REF_PREFIX, REVIEW_VERDICTS, assertFindingsRefForPr, findingsDigest, formatVerdictMessage, parseVerdictCommit, parseVerdictRef, validateVerdictArtifact, verdictRef } from './lib/review-verdict-artifact.mjs'
import { changedPathsFromPullRequestFiles, classifyChangedPaths, classifyLightweightMergePullRequestFiles } from './lib/documents-only-change.mjs'
import { HISTORICAL_RESTORATIONS, validateHistoricalRestorationFile } from './historical-migration-restorations.mjs'
import { AdmissionError, SERVICE_CLASSES, CHANGE_TYPES, NON_STRUCTURAL_CHANGE_TYPES, STRUCTURAL_ROUTES, parseImpactBlock, evaluateAdmission, inspectPrStructuralChange, structuralWritesMatch, structuralWritesCovered } from './orchestrator-flow/admission.mjs'
import { assertNamedHold, conflicts, describeLeaseHolder, formatHoldReason, HoldReasonError } from './lib/hold-reason.mjs'
import { OUTCOME_STATES, OutcomeError, advanceOutcome, completeOutcome, verifyOutcomeAcceptance, outcomeEvent, outcomeHistory, repairOutcomeHistory } from './orchestrator-flow/outcome-lifecycle.mjs'
import { assertPaidReviewCapacity, pauseActualReviewFailure, derivePaidContentProof } from './lib/lanes/review-circuit-breaker.mjs'
const paidBudgetContractCaches=new WeakMap()
import { isContentPreservingRefresh, prContentDigest, verifiedEvidencePaths } from './lib/pr-content-equivalence.mjs'
import { wrapperEmitsGovernedVerdict } from './lib/reviewer-capabilities.mjs'
import { classifyBranchFreshness } from './check-main-tip-freshness.mjs'
import { MigrationTrainError, TRAIN_REF_PREFIX, assertDispatchMatchesTrain, assertRecordedTrain, assertTrainProductionEvidence, proposeTrain, trainRecordRef, transitionTrain, validateTrain } from './orchestrator-flow/migration-train.mjs'
import { assertDrawPromptContract, collectHandoffCollisions, preDrawHandoffChecks } from './lib/reviewer-draw-readiness.mjs'
// Cohesive modules split out of this file (issue #3726). This entrypoint keeps
// the CLI, githubIo and the shared wire state, and re-exports every public name.
import { MERGE_ADVISORY_CONTEXT, pendingRequiredContexts, selectNewestCommitStatus, REPO, AUTHOR_CAPACITY_STATES, AUTHORABLE_CAPACITY_STATES, WORKTREE_STATES, DEFAULT_LEASE_HOURS, MUTEX_STALE_AFTER_MS, MUTEX_REF, MUTEX_RECOVERY_ACTIVE_REF, RETIRED_CLAIM_REF_PREFIX, RETIREMENT_SCHEMA_VERSION, RETIREMENT_RECORD_PREFIX, RETIREMENT_DECISIONS, RETIREMENT_REF_ROW_LIMIT, REVIEW_CURSOR_REF, REVIEW_FAILURE_REF_PREFIX, REVIEW_REPLACEMENT_REF_PREFIX, REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_ACTIVE_REF_PREFIX, REVIEW_ACTIVE_PARALLEL_REF_PREFIX, REVIEW_SILENCE_PROBE_REF_PREFIX, REVIEW_SILENCE_RELEASE_REF_PREFIX, REVIEW_QUEUE_REF_PREFIX, REVIEW_EXCLUSION_REF_PREFIX, REVIEW_EXCLUSION_REASONS, RETIRED_EXCLUSION_REASONS, RECORDABLE_EXCLUSION_REASONS, REVIEW_REINSTATEMENT_REF_PREFIX, REINSTATABLE_EXCLUSION_REASONS, REVIEW_RETURN_REF_PREFIX, REVIEW_RETIRED_VERDICT_REF_PREFIX, REVIEW_ACTIVE_CUTOVER_REF, REVIEW_SILENT_RECLAIM_REQUEST_LIMIT, REVIEW_SILENT_RECLAIM_MUTEX_SECTION_RESERVE, REVIEW_QUEUE_ASSIGNMENT_REQUEST_LIMIT, REVIEW_CAPACITY_REQUEST_LIMIT, REVIEW_QUOTA_RESERVE, REVIEW_LEASE_SUSPECT_HOURS, SILENCE_MIN_AGE_HOURS, SILENCE_CONFIRM_HOURS, REVIEW_STARTED_REF_PREFIX, UNSTARTED_MIN_AGE_HOURS, reviewStartedMarkerRef, reviewStartMarkerPresent, REVIEW_QUEUE_TTL_HOURS, REVIEW_QUEUE_ROW_LIMIT, REVIEW_REF_ROW_LIMIT, markReviewRefListingRefusal, isReviewRefListingRefusal, markLeaseReadFailure, isLeaseReadFailure, isCommandSizeFailure, RETIREMENT_LEGACY_SCHEMA_VERSIONS, RETIREMENT_PRESERVATION_FIELDS, RETIREMENT_PRESERVATION_STATES, REPO_OWNER, REPO_NAME } from './lib/lanes/constants.mjs'
export { MERGE_ADVISORY_CONTEXT, pendingRequiredContexts, selectNewestCommitStatus, REPO, AUTHOR_CAPACITY_STATES, AUTHORABLE_CAPACITY_STATES, WORKTREE_STATES, DEFAULT_LEASE_HOURS, MUTEX_STALE_AFTER_MS, MUTEX_REF, MUTEX_RECOVERY_ACTIVE_REF, RETIRED_CLAIM_REF_PREFIX, RETIREMENT_SCHEMA_VERSION, RETIREMENT_RECORD_PREFIX, RETIREMENT_DECISIONS, RETIREMENT_REF_ROW_LIMIT, REVIEW_CURSOR_REF, REVIEW_FAILURE_REF_PREFIX, REVIEW_REPLACEMENT_REF_PREFIX, REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_ACTIVE_REF_PREFIX, REVIEW_ACTIVE_PARALLEL_REF_PREFIX, REVIEW_SILENCE_PROBE_REF_PREFIX, REVIEW_SILENCE_RELEASE_REF_PREFIX, REVIEW_QUEUE_REF_PREFIX, REVIEW_EXCLUSION_REF_PREFIX, REVIEW_EXCLUSION_REASONS, RETIRED_EXCLUSION_REASONS, RECORDABLE_EXCLUSION_REASONS, REVIEW_REINSTATEMENT_REF_PREFIX, REINSTATABLE_EXCLUSION_REASONS, REVIEW_RETURN_REF_PREFIX, REVIEW_RETIRED_VERDICT_REF_PREFIX, REVIEW_ACTIVE_CUTOVER_REF, REVIEW_SILENT_RECLAIM_REQUEST_LIMIT, REVIEW_SILENT_RECLAIM_MUTEX_SECTION_RESERVE, REVIEW_QUEUE_ASSIGNMENT_REQUEST_LIMIT, REVIEW_CAPACITY_REQUEST_LIMIT, REVIEW_QUOTA_RESERVE, REVIEW_LEASE_SUSPECT_HOURS, SILENCE_MIN_AGE_HOURS, SILENCE_CONFIRM_HOURS, REVIEW_STARTED_REF_PREFIX, UNSTARTED_MIN_AGE_HOURS, reviewStartedMarkerRef, reviewStartMarkerPresent, REVIEW_QUEUE_TTL_HOURS, REVIEW_QUEUE_ROW_LIMIT, REVIEW_REF_ROW_LIMIT, markReviewRefListingRefusal, isReviewRefListingRefusal, markLeaseReadFailure, isLeaseReadFailure, isCommandSizeFailure, RETIREMENT_LEGACY_SCHEMA_VERSIONS, RETIREMENT_PRESERVATION_FIELDS, RETIREMENT_PRESERVATION_STATES }
import { REVIEWERS, RETIRED_REVIEWERS, QUARANTINED_REVIEWERS, reviewerReadsRepository, reviewerEmitsGovernedVerdict, reviewerKnownNonReading, OVERFLOW_REVIEWERS, ACTIVE_REVIEWERS, canonicalReviewerAllowlist, ENGINE_REVIEWER_EXCLUSION, reviewersForOrchestrator, reviewerAdmissionAllowed, reconcilePreflightRows, allocatableReviewers, reviewerAllowlistSuffix, inheritReviewerAllowlist, reviewerAllowed, assertReviewerAllowlistConsistency, inheritReturnedReviewerAllowlist, REVIEWER_FALLBACK_PROVIDERS, authorEngineFromEnv, knownAuthorEngines, orderedReviewers, readSessionIdOrUnknown, drawOrder } from './lib/lanes/reviewer-roster.mjs'
export { REVIEWERS, RETIRED_REVIEWERS, QUARANTINED_REVIEWERS, reviewerReadsRepository, reviewerEmitsGovernedVerdict, reviewerKnownNonReading, OVERFLOW_REVIEWERS, ACTIVE_REVIEWERS, canonicalReviewerAllowlist, ENGINE_REVIEWER_EXCLUSION, reviewersForOrchestrator, reviewerAdmissionAllowed, reconcilePreflightRows, allocatableReviewers, REVIEWER_FALLBACK_PROVIDERS, authorEngineFromEnv, knownAuthorEngines, orderedReviewers }
import { EXCLUSIVE_REFS, REVIEW_TARGET_SUPERSEDED, SLOT_INDEPENDENCE_CONFLICT, TERMINAL_FAILURE_CODES, QUEUE_STATUSES, QUEUE_WORK_TYPES, QUEUE_ROUTES, ROUTES_BY_WORK_TYPE, NON_STRUCTURAL_EXITS, OUTSIDE_ORCHESTRATOR_EXITS, RETURN_ADDRESS_PATTERN, RETURNED_MARKER, RETURNED_COPY_MARKER, LEGACY_RETURNED_COPY_PATTERN, RETURNED_COPY_HEADER_LINES, returnedCopyProvenance, requiresReturnAddress, queueExit, parseQueueScope, COORDINATION_LABELS, WORK_LABEL, buildDynamicQueues, returnIssueToOwner, reviewTargetSuperseded, CLAIM_FIRST_ROUTES, readDependencyStates } from './lib/lanes/queue-routing.mjs'
export { EXCLUSIVE_REFS, REVIEW_TARGET_SUPERSEDED, SLOT_INDEPENDENCE_CONFLICT, TERMINAL_FAILURE_CODES, QUEUE_STATUSES, QUEUE_WORK_TYPES, QUEUE_ROUTES, ROUTES_BY_WORK_TYPE, NON_STRUCTURAL_EXITS, OUTSIDE_ORCHESTRATOR_EXITS, RETURN_ADDRESS_PATTERN, RETURNED_MARKER, RETURNED_COPY_MARKER, LEGACY_RETURNED_COPY_PATTERN, RETURNED_COPY_HEADER_LINES, returnedCopyProvenance, requiresReturnAddress, queueExit, parseQueueScope, COORDINATION_LABELS, WORK_LABEL, buildDynamicQueues, returnIssueToOwner, CLAIM_FIRST_ROUTES, readDependencyStates }
import { LaneError, validateClaimObjects, parseAuthorLease, assertLaneAvailable, claimBody, laneTreeReader } from './lib/lanes/claims.mjs'
export { LaneError, validateClaimObjects, parseAuthorLease, assertLaneAvailable, claimBody }
import { EXPECTED_REF_ABSENCE, EXPECTED_REF_PRESENCE, createRefWithReadback, deleteRefWithReadback, parseGitRemoteRefs, parseGitCommitBatch, readGitCommits, parseGhIncludeResponse, parseLinkHeader, hasNextPageLink, isConfirmedRefAbsence, currentMainMaxVersion, reviewRecordRefs, assertReviewerDrawIsWarranted, assertReviewerDrawReadiness, gh, hasLabel, ghJson, ghRefListing, reviewStateEntry, gitRemoteRefRows, GIT_COMMAND_TIMEOUT_MS, authorityGhJson } from './lib/lanes/github-wire.mjs'
export { EXPECTED_REF_ABSENCE, EXPECTED_REF_PRESENCE, createRefWithReadback, deleteRefWithReadback, parseGitRemoteRefs, parseGitCommitBatch, readGitCommits, parseGhIncludeResponse, parseLinkHeader, hasNextPageLink, isConfirmedRefAbsence, currentMainMaxVersion, reviewRecordRefs, assertReviewerDrawIsWarranted, assertReviewerDrawReadiness, GIT_COMMAND_TIMEOUT_MS }
import { LEGACY_GUARDED_CLEANUP_CLOSE_REASON, CLAIM_CLOSE_REASONS, RECOVERABLE_CLAIM_CLOSE_REASONS, RETIREMENT_CLOSE_REASON, retiredClaimRef, normalizeRetirementIdentity, validateRetirementRecord, formatRetirementRecord, parseRetirementRecord, isVersionRetired, readRetirementRecord, assertClaimNotRetired, assertRetirementIdentityAvailable, createRetirementTombstone, retiredReopenedClaims, matchesLiveProof, matchesGeneratedTypesProof, requireClaimCloseReason, assertReviewerDrawHandoff } from './lib/lanes/retirement.mjs'
export { LEGACY_GUARDED_CLEANUP_CLOSE_REASON, CLAIM_CLOSE_REASONS, RECOVERABLE_CLAIM_CLOSE_REASONS, RETIREMENT_CLOSE_REASON, retiredClaimRef, normalizeRetirementIdentity, validateRetirementRecord, formatRetirementRecord, parseRetirementRecord, isVersionRetired, readRetirementRecord, assertClaimNotRetired, assertRetirementIdentityAvailable, createRetirementTombstone, retiredReopenedClaims, matchesLiveProof, matchesGeneratedTypesProof, assertReviewerDrawHandoff }
import { flowCapacityFacts, deriveLiveNoDatabasePreview, databasePreviewAdmission, readDatabasePreviewClassificationFile, withDatabasePreviewClassificationFile, deriveLivePreviewCandidate, terminalizeHistoricalPreviewReady, livePreviewLedger } from './lib/lanes/preview-admission.mjs'
export { flowCapacityFacts, deriveLiveNoDatabasePreview, databasePreviewAdmission, readDatabasePreviewClassificationFile, withDatabasePreviewClassificationFile, deriveLivePreviewCandidate, terminalizeHistoricalPreviewReady }
import { REVIEWER_DOCTOR_TIMEOUT_MS, REVIEWER_PREFLIGHT_TIMEOUT_MS, parseDoctorFailures, summarizeDoctorOutput, unnamedDoctorFailure, doctorSpawnPlan, doctorTimeoutFailingChecks, pickExecutableCandidate, resolveCommandPath } from './lib/lanes/reviewer-doctor.mjs'
export { REVIEWER_DOCTOR_TIMEOUT_MS, REVIEWER_PREFLIGHT_TIMEOUT_MS, parseDoctorFailures, summarizeDoctorOutput, unnamedDoctorFailure, doctorSpawnPlan, doctorTimeoutFailingChecks, pickExecutableCandidate, resolveCommandPath }
import { leaseHoldText, holdFacts, namedHold, urgentHoldReason, urgentHoldDetail, acquireRef, readRefAfterWrite, readPrAfterPush, acquireMutex, requireOwnedRef, recoverStaleAuthorMutex, releaseOwnedRef, releaseMutexOnExit, releaseRefOnExit, releaseRefOverGit } from './lib/lanes/holds-and-refs.mjs'
export { leaseHoldText, holdFacts, namedHold, urgentHoldReason, urgentHoldDetail, acquireRef, readRefAfterWrite, readPrAfterPush, acquireMutex, requireOwnedRef, recoverStaleAuthorMutex, releaseOwnedRef, releaseMutexOnExit, releaseRefOnExit, releaseRefOverGit }
import { parseReviewCursor, sameVerdictRecord, recordReviewVerdict, nonVerdictReviewerReplacementCommand, nonReadingReviewerReplacementCommand, readReviewVerdicts, reviewActiveRef, parseReviewLease, parseReviewExclusion, REVIEW_EXCLUSION_GENERATION_LIMIT, reviewExclusionRef, reviewReinstatementRef, REVIEW_EXCLUSION_GENERATIONS, countDoctorPassLines, parseReviewReinstatement, parseReviewReturn, parseAssignmentRef, reviewReturnRef, readReviewReturns, retiredVerdictRef, reviewReturnsHeldBy, reviewLeaseRefForAssignment, activeLeaseRecordForAssignment, activeLeaseRecordForJob, reviewLeaseRefCandidates, leaseMatchesAssignment, leaseRefHoldsAssignment, resolveAssignmentLeaseRef, reviewerExclusions, retireVerdictsOrphanedByReturn, outstandingRetirements, reviewExclusionGenerationRows, liveExclusionGeneration } from './lib/lanes/review-records.mjs'
export { parseReviewCursor, sameVerdictRecord, recordReviewVerdict, nonVerdictReviewerReplacementCommand, nonReadingReviewerReplacementCommand, readReviewVerdicts, reviewActiveRef, parseReviewLease, parseReviewExclusion, REVIEW_EXCLUSION_GENERATION_LIMIT, reviewExclusionRef, reviewReinstatementRef, REVIEW_EXCLUSION_GENERATIONS, countDoctorPassLines, parseReviewReinstatement, parseReviewReturn, parseAssignmentRef, reviewReturnRef, readReviewReturns, retiredVerdictRef, reviewReturnsHeldBy }
import { findPrReviewAssignments, verdictOpensLine, evidenceTiedToHead, isApprovalFor, isVerdictFor, anyVerdictFor, gateAuthorizes, withArchivedVerdictMirror, DURABLE_VERDICT_REF_NAMESPACE, hasVerdictForHead, headVerdictBlocksReplacement, mergedReviewComparisonBase, resolveLaneApprovalBase, assertDurableReviewApproval, MUTEX_RELEASE_READBACK_DELAYS_MS, readDurableVerdictRefs, leaseVerdictOptions, assertReviewLeaseStillStale, isReviewAssignmentLive, mergedPrReviewerReuseAllowed } from './lib/lanes/review-approval.mjs'
export { findPrReviewAssignments, verdictOpensLine, evidenceTiedToHead, isApprovalFor, isVerdictFor, anyVerdictFor, gateAuthorizes, withArchivedVerdictMirror, DURABLE_VERDICT_REF_NAMESPACE, hasVerdictForHead, headVerdictBlocksReplacement, mergedReviewComparisonBase, resolveLaneApprovalBase, assertDurableReviewApproval, mergedPrReviewerReuseAllowed }
import { findBusyReviewers, reviewLeaseAgeHours, OWN_START_ONLY_ACTIVITY, REVIEW_REAP_REQUEST_LIMIT, REVIEW_REAP_BATCH, legacyLeaseTerminalReason, REVIEW_ARCHIVED_VERDICT_REF_PREFIX, REVIEW_VERDICT_ARCHIVE_BATCH, archivedVerdictRef, classifyVerdictForArchive, describeMovedAssignmentHead, pickReviewer, reviewSlotSuffix, inReviewReplacementNamespace, newestActivityTimestamp, silenceProbeRef, silenceReleaseRef, parseSilenceProbe, resolveSilentLease, abandonedLeases, verdictArchiveScan, readPullStateMap, countReasons, reviewerCapacityReportOperation, reviewerStartWatchLeasesOperation, selectArtifactFiles, selectArtifactJson } from './lib/lanes/review-leases.mjs'
export { findBusyReviewers, reviewLeaseAgeHours, OWN_START_ONLY_ACTIVITY, REVIEW_REAP_REQUEST_LIMIT, REVIEW_REAP_BATCH, legacyLeaseTerminalReason, REVIEW_ARCHIVED_VERDICT_REF_PREFIX, REVIEW_VERDICT_ARCHIVE_BATCH, archivedVerdictRef, classifyVerdictForArchive, describeMovedAssignmentHead, pickReviewer, reviewSlotSuffix, inReviewReplacementNamespace, selectArtifactFiles, selectArtifactJson }
import { projectReviewPr, projectReviewerOperationRouteSnapshot, completeReviewerOperationRouteSnapshot, reconcileReviewerOperationRouteFiles, reviewStateGraphqlFields, MUTEX_RETRY_WAIT_MS, assignWithMutexRetry, resolvePeerSlots, MERGE_ANCESTRY_MEMO, reviewEligibilityCause, reviewerQueueRef, parseReviewerQueueTicket, reviewerQueueTicketExpired, liveReviewerQueue, finishReviewerQueueTurn } from './lib/lanes/review-assignment.mjs'
export { projectReviewPr, projectReviewerOperationRouteSnapshot, completeReviewerOperationRouteSnapshot, reconcileReviewerOperationRouteFiles, reviewStateGraphqlFields, MUTEX_RETRY_WAIT_MS, assignWithMutexRetry }
import { CLAIM_WORKTREE_REBIND_REF_PREFIX, normalizeWorktreePath, claimWorktreeRebindRef, parseSilenceRelease, replaceClaimVersion, parseVersionSupersession, parseClaimWorktreeRebind, leaseWithoutWorktree, parseMergedClaimReissue } from './lib/lanes/claim-versions.mjs'
export { CLAIM_WORKTREE_REBIND_REF_PREFIX, normalizeWorktreePath, claimWorktreeRebindRef }
import { reviewerExecutionPreflight, failedReviewerReleaseCommand, parseReviewReplacement, requireReplacementEvidence, validateTerminalReviewerFailure, reviewerFailureRef, parseReviewRelease, assertAssignmentWasNotTerminallyReleased, resolveFailedReviewRecord, matchesAssignmentTuple, matchesReplacementForSlot, assignmentSlotSuffix, matchesReplacementTuple, parseTerminalFailureEvidence } from './lib/lanes/review-replacement.mjs'
export { reviewerExecutionPreflight, failedReviewerReleaseCommand }
import { ADMISSION_LEGACY_CUTOVER, admitIssue, parseMergedPrIssueBinding, verifyMergedPrIssueBinding, withMergedPrIssueBinding, reviewTargetIsRecordable, derivePrOperationRoute, assertUnambiguousClaimTitle, requireAdmissionArguments } from './lib/lanes/admission.mjs'
export { ADMISSION_LEGACY_CUTOVER, admitIssue, parseMergedPrIssueBinding, verifyMergedPrIssueBinding, withMergedPrIssueBinding, reviewTargetIsRecordable, derivePrOperationRoute, assertUnambiguousClaimTitle }
import { workIssuesFromRows, openIssueNumbersFromRows, memoizePrFiles, closedClaimAuthoredOnMain, RELINQUISH_ONLY_LEASE_FIELDS, wrongOwnerMessage, renewalIssueScope, claimCoversObject, addedMigrationVersions, parseVersionPrMap, assertMergeCommitInMainHistory, completeWork, SPLIT_REMAINDER, workstreamKey, migrationVersions, replaceLeaseLocation, replaceClaimObjects, replaceLeaseExpiry, replaceCapacityState, relinquishOnlyFieldsIn, stripRelinquishOnlyFields, claimTitleIssues, claimWorkIssue, validateCapacityBlocker, requireDereferenceableRecoveryArtifact, requestedWorktreeState, observedWorktreeState, resolveRelinquishmentWorktreeState, publishCapacityEvents, laneCommand, appendClaimObjects, replaceScopeStatus, validateImmutableArtifactReference } from './lib/lanes/claim-maintenance.mjs'
export { workIssuesFromRows, openIssueNumbersFromRows, memoizePrFiles, closedClaimAuthoredOnMain, RELINQUISH_ONLY_LEASE_FIELDS, wrongOwnerMessage, renewalIssueScope, claimCoversObject, addedMigrationVersions, parseVersionPrMap, assertMergeCommitInMainHistory, completeWork }
import { readExclusiveLease, assertExclusive } from './lib/lanes/exclusive-locks.mjs'
export { readExclusiveLease, assertExclusive }
import { trainIo, assertTrainLiveOnMain, runTrainCommand } from './lib/lanes/cli-train.mjs'
import { verifyMergedWorkRecord } from './lib/lanes/claim-maintenance.mjs'
export { trainIo, assertTrainLiveOnMain, runTrainCommand }
export function pauseProviderFailure(record,{resolveCommand=resolveCommandPath,execute=execFileSync,platform=process.platform,env=process.env,now=Date.now}={}) {
    const reviewer=REVIEWERS.find(row=>row.name===record.reviewer)
    if(!reviewer?.provider)throw new LaneError('provider pause reviewer registry binding unreadable')
    const resolved=resolveCommand('ai-review-preflight')
    if(!resolved)throw new LaneError('supported monotonic pause command unavailable')
    const invoke=(args)=>{
      const plan=platform==='win32'&&/\.(cmd|bat)$/i.test(resolved)
        ?{file:env.ComSpec||'cmd.exe',args:['/d','/s','/c',resolved,...args]}:{file:resolved,args}
      let text
      try{text=execute(plan.file,plan.args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:REVIEWER_PREFLIGHT_TIMEOUT_MS});return JSON.parse(text)}
      catch(error){throw new LaneError(`supported provider pause/status command failed or returned unreadable JSON: ${String(error.message).split('\n')[0]}`)}
    }
    const result=invoke(['pause',reviewer.provider,record.failureCode,'--seconds','3600','--observed',String(record.observedEpoch)])
    const actual=invoke(['pause-status',reviewer.provider])
    const currentEpoch=Math.floor(now()/1000), expiry=record.observedEpoch+3600
    if(result?.status==='expired'){
      if(result.provider!==reviewer.provider||result.observed_epoch!==record.observedEpoch||result.expires_epoch!==expiry||expiry>currentEpoch)throw new LaneError('historical provider pause result unreadable')
      if(actual!==null&&(!actual||actual.provider!==reviewer.provider||typeof actual.record_id!=='string'||!Number.isInteger(actual.expires_epoch)))throw new LaneError('historical provider pause status unreadable')
      return result
    }
    if(!actual||JSON.stringify(actual)!==JSON.stringify(result)||actual.provider!==reviewer.provider||!Number.isInteger(actual.created_epoch)||!Number.isInteger(actual.expires_epoch)||actual.expires_epoch<expiry||actual.expires_epoch<=currentEpoch||typeof actual.record_id!=='string'||!actual.record_id)throw new LaneError('provider pause protected persisted readback mismatch')
    return actual
}

export const REVIEW_OPERATION_REQUEST_LIMIT = 25, REVIEW_MUTEX_SECTION_RESERVE = 15 // slot 2 = 10 pre-mutex + this reserve; slot 1 = 7 + reserve. RE-DERIVED, NOT WIDENED (issue #2075): every reviewer operation now proves 'a verdict exists for this head' from the create-only durable verdict refs instead of from comment prose. That costs exactly ONE listing of refs/db-review-verdict pre-mutex (cached for the rest of the operation by reviewOperationIo) and ONE uncached re-listing inside the mutex section, so each half grew by exactly one request. Measured totals moved 21->23 (slot-2 assignment), 18->20 (slot-2 replacement), and 8->9 pre-mutex for the first replacement, with the post-mutex replacement section going 10->11. Issue #2550 keeps this ceiling fixed by carrying predecessor failure refs in the replacement batch and treating absence in the complete active-lease snapshot as proved absence. The bounded per-PR exclusion read is inside the mutex so it cannot race assignment. This entry gate refuses to acquire the mutex unless the whole mutex-held section still fits. Release is guaranteed separately by cleanupReserve. Derivation: docs/verification/reviewer-assignment-api-budget-2026-08-28.md (#1812, #1833, #2550)

// The conflict matrix lives in ./lib/hold-reason.mjs so named holds and lane
// placement share one rule; re-exported here for existing callers.
export { conflicts }

export { isTransientGitHubTransport }
let reviewWireBudget=null,reviewCommitBase=null,freshDurableVerdictRefs=null
// Issue #3187 (Refs #2773): quota facts observed on responses this reviewer operation
// already makes -- x-ratelimit-* headers on the owner-commit POST (REST core) and the
// rateLimit field folded into the active-lease GraphQL snapshot (GraphQL) -- so the
// quota gate needs no separate rate_limit request. Scoped to one operation.
let observedReviewQuota={}
export function recordReviewQuotaHeaders(headers){
  if(!reviewWireBudget||!headers)return
  const resource=String(headers['x-ratelimit-resource']??'core').toLowerCase(),remaining=Number(headers['x-ratelimit-remaining']),reset=Number(headers['x-ratelimit-reset'])
  if(headers['x-ratelimit-remaining']===undefined||!Number.isFinite(remaining)||!Number.isFinite(reset))return
  if(resource==='core')observedReviewQuota.core={remaining,reset}
  else if(resource==='graphql')observedReviewQuota.graphql={remaining,reset}
}
function recordReviewGraphQuota(rateLimit){
  if(!reviewWireBudget||!rateLimit)return
  const remaining=Number(rateLimit.remaining),reset=Math.floor(new Date(rateLimit.resetAt).getTime()/1000)
  if(rateLimit.remaining!==undefined&&rateLimit.remaining!==null&&Number.isFinite(remaining)&&Number.isFinite(reset))observedReviewQuota.graphql={remaining,reset}
}
function consumeReviewWireRequest(){
  if(!reviewWireBudget)return
  // Issue #2844: proving the mutex release is not a derived-budget consumer. It runs
  // only after every counted request of the operation is already spent, it is hard
  // bounded by this allowance, and being squeezed out of it is exactly what reported
  // a successful draw as RECOVERY REQUIRED. The ceiling itself is NOT widened: no
  // request outside the release proof may borrow from this allowance.
  if(reviewWireBudget.releaseProofAllowance>0){reviewWireBudget.releaseProofAllowance-=1;return}
  const limit=reviewWireBudget.limit??REVIEW_OPERATION_REQUEST_LIMIT
  const usable=reviewWireBudget.locked&&!reviewWireBudget.cleanup?limit-(reviewWireBudget.cleanupReserve??0):limit
  if(reviewWireBudget.count>=usable)throw new LaneError(`reviewer operation '${reviewWireBudget.operation??'reviewer-operation'}' exhausted its derived ${limit}-request budget before request ${reviewWireBudget.count+1}${usable!==limit?` (${limit-usable} held back as the mutex-release reserve)`:''}. This ceiling is DERIVED for this operation, not a global default: see the derivation cited beside its constant in scripts/manage-migration-author-lanes.mjs. Re-derive it from a written measurement rather than widening it (issue #2075)`)
  reviewWireBudget.count+=1
}
export function withReviewRequestBudget(fn,limit=REVIEW_OPERATION_REQUEST_LIMIT,operation='reviewer-operation'){
  if(reviewWireBudget)return fn(reviewWireBudget)
  reviewWireBudget={count:0,limit,operation}
  try{return fn(reviewWireBudget)}finally{reviewWireBudget=null;reviewCommitBase=null;freshDurableVerdictRefs=null;observedReviewQuota={};primedReviewStates=new Map()}
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
    // Issue #2773: the real binary shares the host-wide exhaustion latch; a fixture executor never does. A latched refusal sends no request, so it is deliberately not charged to the wire budget above.
    quotaLatch:executor===execFileSync?hostQuotaLatch():null,
    wrapError:(detail)=>new LaneError(`GitHub command failed: ${detail}`),
  })
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
// Issue #3187 (Refs #2773): inside a reviewer operation, ref reads go over the git
// protocol instead of the REST/GraphQL API. `git ls-remote` spends no API quota and
// returns the COMPLETE matching set in one round trip (no pagination and no
// truncation ceiling to guess at), so the mutex proofs, readbacks, cursor and
// assignment lookups and the verdict listings stop costing API requests. It fails
// closed: an unreadable, malformed or wrong-repository answer throws and never
// reads as "ref absent".
let gitRemoteRepositoryProved=false
export function gitRemoteRefs(patterns,{run=execFileSync,attempts=3,wait=(ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
  if(!gitRemoteRepositoryProved){
    let url
    try{url=String(run('git',['remote','get-url','origin'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:GIT_COMMAND_TIMEOUT_MS,killSignal:'SIGKILL'})).trim()}
    catch(error){throw new LaneError(`git origin remote is unreadable; refusing git ref reads (${String(error?.message??error).split('\n')[0]})`)}
    const slug=url.replace(/\.git$/i,'').replace(/\/+$/,'').replace(/^.*github\.com[:/]/i,'')
    if(!/github\.com[:/]/i.test(url)||slug.toLowerCase()!==String(REPO).toLowerCase())throw new LaneError(`git origin remote does not point at ${REPO}; refusing git ref reads`)
    gitRemoteRepositoryProved=true
  }
  let lastError
  for(let attempt=1;attempt<=attempts;attempt++){
    let text
    try{text=run('git',['ls-remote','origin',...patterns],{encoding:'utf8',maxBuffer:256*1024*1024,stdio:['ignore','pipe','pipe'],timeout:GIT_COMMAND_TIMEOUT_MS,killSignal:'SIGKILL'})}
    catch(error){lastError=error;if(attempt<attempts)wait(500*attempt);continue}
    return parseGitRemoteRefs(text)
  }
  throw new LaneError(`git ref listing failed: ${String(lastError?.stderr??lastError?.message??lastError).trim().split('\n')[0]}`)
}
// Issue #3187: PR/issue review states read inside a GraphQL snapshot this operation
// already makes are primed here and answer exactly ONE later readReviewStates call
// that asks for nothing else. The next read of the same key goes to the wire again.
let primedReviewStates=new Map()
function primeReviewStates(entries){if(reviewWireBudget)for(const [key,value] of entries)primedReviewStates.set(key,value)}
function takePrimedReviewStates(unique){
  if(!reviewWireBudget||!unique.length||!unique.every((lease)=>primedReviewStates.has(`${lease.issue}:${lease.pr}`)))return null
  const result=new Map(unique.map((lease)=>{const key=`${lease.issue}:${lease.pr}`;return [key,primedReviewStates.get(key)]}))
  for(const key of result.keys())primedReviewStates.delete(key)
  return result
}

// ONE bounded listing per command, not one API call per claim. `--audit` reads
// every open claim, so a per-claim `readRef` turned a single audit into dozens of
// requests against the same rate limit that issue #2301's own parallel sessions
// already exhaust. The snapshot is cached for the life of the process and reset
// explicitly in tests.
let retirementSnapshotCache = null
export function resetRetirementSnapshot() { retirementSnapshotCache = null }
export function retirementSnapshot(io = githubIo) {
  if (retirementSnapshotCache) return retirementSnapshotCache
  const rows = io.listRefs(RETIRED_CLAIM_REF_PREFIX) ?? []
  if (rows.length >= RETIREMENT_REF_ROW_LIMIT) throw new LaneError(`${RETIRED_CLAIM_REF_PREFIX} returned ${rows.length} refs, at or past the ${RETIREMENT_REF_ROW_LIMIT}-ref ceiling; refusing a possibly truncated retirement audit rather than reading a truncated listing as "not retired"`)
  const versions = new Map()
  for (const row of rows) {
    const version = String(row.ref ?? '').slice(`${RETIRED_CLAIM_REF_PREFIX}/`.length)
    if (!/^\d{14}$/.test(version)) throw new LaneError(`malformed retirement ref ${row.ref}`)
    versions.set(version, row.sha)
  }
  retirementSnapshotCache = { versions, shas: new Map([...versions].map(([version, sha]) => [sha, version])) }
  return retirementSnapshotCache
}

export function buildDatabasePreviewFileSnapshot(files,base,head,readContent){
  const allowed=new Set(['added','modified','removed','renamed','copied','changed','unchanged']),seen=new Set()
  const inspect=(tree,path,side)=>{
    const entry=tree.get(path)
    if(!entry?.blob_sha||!/^[0-9a-f]{40}$/i.test(String(entry.blob_sha))||typeof entry.mode!=='string'||typeof entry.type!=='string')throw new LaneError(`live Git identity is unavailable for ${side} file ${path}`)
    let content
    try{content=readContent(path,side)}catch(error){throw new LaneError(`live Git content is unavailable for ${side} file ${path}: ${error.message}`)}
    if(typeof content!=='string')throw new LaneError(`live Git content is not text for ${side} file ${path}`)
    return {mode:entry.mode,type:entry.type,blob_sha:entry.blob_sha,sha256:sha256(content),content}
  }
  return files.map((file)=>{
    const path=String(file?.filename??'').replaceAll('\\','/'),status=String(file?.status??''),previousPath=String(file?.previous_filename??path).replaceAll('\\','/')
    if(!path||seen.has(path)||!allowed.has(status)||((status==='renamed'||status==='copied')&&!file?.previous_filename))throw new LaneError(`live Git identity is unavailable for changed file ${path||'(missing path)'}`)
    seen.add(path)
    const oldSide=status==='added'?null:inspect(base,previousPath,'base'),newSide=status==='removed'?null:inspect(head,path,'head')
    const sides=[oldSide,newSide].filter(Boolean),regular=sides.every((side)=>side.type==='blob'&&side.mode==='100644'),text=sides.every((side)=>!side.content.includes('\0'))
    const databaseSignal=sides.some((side)=>/(?:\b(?:create|alter|drop|grant|revoke|insert|update|delete)\b[\s\S]{0,40}\b(?:table|view|function|policy|role|schema|into|from)\b|\bsupabase\b|\bpsql\b|\bapply_migration\b|\bdb\s+push\b)/i.test(side.content))
    const databasePath=[path,previousPath].some((candidate)=>/(?:^|\/)(?:supabase|migrations?|policies)(?:\/|$)|\.sql$/i.test(candidate)),safeDocumentation=/^(?:docs\/.*\.(?:md|txt)|HANDOFF\.d\/.*\.md|plan_[^/]*\.md|README\.md)$/i.test(path)
    const unsafeHistory=['renamed','removed'].includes(status)||!regular||!text
    const impact=databaseSignal||databasePath?'database-behavior':unsafeHistory?'ambiguous':safeDocumentation?'documentation':'ambiguous'
    const selected=newSide??oldSide
    return {path,status,...(previousPath!==path?{previous_path:previousPath}:{}),mode:selected.mode,blob_sha:selected.blob_sha,sha256:selected.sha256,base:oldSide?{mode:oldSide.mode,type:oldSide.type,blob_sha:oldSide.blob_sha,sha256:oldSide.sha256}:null,head:newSide?{mode:newSide.mode,type:newSide.type,blob_sha:newSide.blob_sha,sha256:newSide.sha256}:null,impact}
  }).sort((a,b)=>a.path.localeCompare(b.path))
}

// #4048: a partial maintenance PR must retain its authentic work issue without
// pretending to close that unfinished parent. Refs only selects the proof;
// immutable canonical evidence and normal Git validation supply authority.
export function verifyNonclosingMaintenanceBinding({pr,headSha,files,issue=null},io,git=gitIo){
  const refuse=(reason)=>{throw new LaneError(`nonclosing maintenance binding refused: ${reason}`)}
  const live=io.getPr(pr),main=io.mainSha?.()
  if(!live||Number(live.number)!==pr||live.state!=='open'||live.head?.sha!==headSha||
    live.head?.repo?.full_name!==REPO||live.base?.repo?.full_name!==REPO||live.base?.ref!=='main'||
    !/^[0-9a-f]{40}$/.test(main??'')||live.base.sha!==main||!live.head?.ref)refuse('exact live PR, head, repository or protected main changed')
  if(!isTrustedOperatorComment({author:live.user?.login,author_association:live.author_association},REPO)||
    !/^Posted by [A-Za-z][A-Za-z0-9 -]* chat [A-Za-z0-9-]+ on [A-Za-z0-9_.-]+\s*$/m.test(live.body??''))refuse('trusted signed attribution missing')
  const refs=[...String(live.body??'').matchAll(/\bRefs\s+#([1-9]\d*)\b/gi)].map(m=>Number(m[1]))
  if(refs.length!==1||issue!==null&&Number(issue)!==refs[0])refuse('exactly one consistent Refs work issue is required')
  if(!Array.isArray(files)||!files.length)refuse('complete actual file inventory unavailable')
  const pair=resolveEvidencePair(files.map(f=>f.filename),{readFile:path=>io.getFileAt(path,headSha)})
  if(pair.state!=='current'||pair.key==='legacy')refuse('one current keyed canonical evidence pair is required')
  let contract,report
  try{
    contract=validateContract(JSON.parse(io.getFileAt(pair.contract,headSha)))
    report=JSON.parse(io.getFileAt(pair.completion,headSha))
    validateCompletionReport(report,{validateCompletionRecord})
    const reconciliation=reconcileReportWithContract(report,contract)
    if(!reconciliation.satisfied)throw new LaneError(reconciliation.problems.join("; "))
    validatePullRequestCompletion(report,{pr,headSha})
  }catch(error){refuse(`canonical evidence validation failed (${error.message})`)}
  if(contract.work_issue!==refs[0]||report.work_issue!==refs[0]||pair.key!==`${refs[0]}/${contract.generation}`||
    contract.branch!==live.head.ref||contract.work_type!=='repo-maintenance'||contract.route!=='repo-maintenance'||
    contract.db_reads.length||contract.db_writes.length)refuse('canonical work issue, branch, route or no-database scope disagrees')
  if(typeof io.prepareNonclosingEvidenceGit!=='function')refuse('exact source Git reader unavailable')
  io.prepareNonclosingEvidenceGit(headSha,main)
  try{verifyGitEvidence({contract,report,prBaseSha:main,prHeadSha:headSha},git)}
  catch(error){refuse(`published contract or exact Git proof failed (${error.message})`)}
  const work=io.getIssue(refs[0])
  if(Number(work?.number)!==refs[0])refuse('authentic work issue unavailable')
  return {issue:refs[0],work,headSha,contractRef:report.contract_ref,contractHash:contractHash(contract)}
}

export const githubIo = {
  releaseRefOverGit(ref, ownerSha) { return releaseRefOverGit(ref, ownerSha) },
  enforceAdmission:true,
  // Owner ruling 2026-09-11 (marker #2758): no global FIFO for reviewer draws. Any PR
  // draws any usable provider immediately. There is NO per-reviewer concurrency
  // limit (owner rule): a provider already holding live leases is drawn again,
  // because the exact-head protocol below keeps one lease ref per review. Engine
  // exclusions and exact-head binding in assignNextReviewerOperation still apply.
  enableReviewerQueue:false,
  enableReviewerSilence:true,
  requiresExactReviewHeadSha: true,
  databasePreviewClassification(issue){
    const evidence=this.databasePreviewClassificationEvidence
    if(evidence===undefined||evidence===null)return null
    if(evidence.decision===undefined&&Number(evidence.issue)!==Number(issue))throw new LaneError(`database preview evidence is for issue #${evidence.issue}, not #${issue}`)
    return evidence
  },
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
  // ISSUE #2998 — the cross-PR collision reads ride on this io so a test double
  // without the hook skips the check, while the real CLI always runs it. The
  // scan makes zero API calls unless this pull request edits a protected source
  // and then reads under a counted logical-read ceiling.
  handoffCollisions(pr,rows){return collectHandoffCollisions({repo:REPO,pr,rows})},
  readReviewerOperationRoute(pr){
    // Issue #3187: inside a reviewer operation the same snapshot also reads the PR's and
    // its single linked issue's review evidence, primed for the fresh state read that
    // follows under the same held mutex, so that read costs no second request.
    const evidence=reviewWireBudget?' comments(first:100){pageInfo{hasNextPage} nodes{body authorAssociation}} reviews(first:100){pageInfo{hasNextPage} nodes{body state authorAssociation commit{oid}}} mergeCommit{oid}':''
    const issueEvidence=reviewWireBudget?' comments(first:100){pageInfo{hasNextPage} nodes{body authorAssociation}}':''
    const query=`query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){state merged mergedAt headRefOid${evidence} files(first:100){pageInfo{hasNextPage} nodes{path changeType}} closingIssuesReferences(first:2){pageInfo{hasNextPage} nodes{... on Issue{number state body createdAt${issueEvidence}}}}}}}`
    const data=ghJson(['api','graphql','-f',`query=${query}`,'-F',`owner=${REPO_OWNER}`,'-F',`name=${REPO_NAME}`,'-F',`pr=${Number(pr)}`])
    // The caller's admission gate uses its own request counter, while the
    // bounded-pagination refusal and mutex single-attempt policy remain active.
    const snapshot=completeReviewerOperationRouteSnapshot(data,()=>githubIo.getPrFiles(Number(pr)))
    const row=data.data.repository.pullRequest,linked=row.closingIssuesReferences.nodes
    if(reviewWireBudget&&linked.length===1&&Number.isInteger(linked[0]?.number)){
      try{primeReviewStates([[`${linked[0].number}:${Number(pr)}`,reviewStateEntry(row,linked[0])]])}catch{}
    }
    return snapshot
  },
  countLogicalReviewRequests:true,
  // Issue #3206 (Refs #2773): the silent-reclaim pre-mutex PR read. One GraphQL request
  // carries the PR facts the activity fingerprint needs, the main commit base the
  // owner commits are built on, and the GraphQL quota, replacing a REST PR read, a
  // main ref read, a main commit read and the explicit rate_limit pair.
  readPrWithReviewContext(number){
    const data=ghJson(['api','graphql','-f','query=query($owner:String!,$name:String!,$pr:Int!){rateLimit{remaining limit resetAt} repository(owner:$owner,name:$name){defaultBranchRef{target{oid ... on Commit{tree{oid}}}} pullRequest(number:$pr){state merged isDraft headRefOid}}}','-F',`owner=${REPO_OWNER}`,'-F',`name=${REPO_NAME}`,'-F',`pr=${Number(number)}`])
    if(data?.errors?.length)throw new LaneError('reviewer PR snapshot returned GraphQL errors')
    recordReviewGraphQuota(data?.data?.rateLimit)
    const base=data?.data?.repository?.defaultBranchRef?.target,row=data?.data?.repository?.pullRequest
    if(reviewWireBudget&&base?.oid&&base?.tree?.oid)reviewCommitBase={head:base.oid,tree:base.tree.oid}
    if(!row?.headRefOid||!row?.state)return null
    const state=String(row.state).toLowerCase()
    return {state:state==='merged'?'closed':state,merged:row.merged===true,draft:row.isDraft===true,head:{sha:String(row.headRefOid)}}
  },
  observedReviewQuota(){
    const {core,graphql}=observedReviewQuota
    return core&&graphql?{remaining:core.remaining,reset:core.reset,graphRemaining:graphql.remaining,graphReset:graphql.reset}:null
  },
  getRateLimit(){
    const rest=ghJson(['api','rate_limit'])?.resources?.core
    const graphRaw=gh(['api','-i','graphql','-f','query=query{rateLimit{limit remaining resetAt}}'])
    const graphText=/\{[\s\S]*$/.exec(graphRaw)?.[0]
    let graph
    try{graph=JSON.parse(graphText)?.data?.rateLimit}catch{return null}
    return rest&&graph?{remaining:Number(rest.remaining),limit:Number(rest.limit),reset:Number(rest.reset),graphRemaining:Number(graph.remaining),graphLimit:Number(graph.limit),graphReset:Math.floor(new Date(graph.resetAt).getTime()/1000)}:null
  },previewApplyRun(runId){return{run:ghJson(['api',`repos/${REPO}/actions/runs/${runId}`]),jobs:ghJson(['api',`repos/${REPO}/actions/runs/${runId}/jobs`]),artifacts:ghJson(['api',`repos/${REPO}/actions/runs/${runId}/artifacts`]),logs:runGitHubCommand(['run','view',String(runId),'--repo',REPO,'--log'])}},
  verifyPreviewApplyArtifact(request){
    return JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',[path.join(path.dirname(fileURLToPath(import.meta.url)),'verify_preview_apply_artifact.py')],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']}))
  },
  readActiveReviewLeases(){
    if(reviewWireBudget)return this.readActiveReviewLeasesOverGit()
    return this.readActiveReviewLeasesOverGraphql()
  },
  // Issue #3187: identical snapshot and identical refusals, but the ref listing and the
  // lease commit messages come over git, and the ONE GraphQL request carries the main
  // base, the GraphQL quota and every lease's PR/issue review state (primed for the
  // readReviewStates call findBusyReviewers makes next).
  readActiveReviewLeasesOverGit(){
    const names=[...new Set([...REVIEWERS,...OVERFLOW_REVIEWERS].map((row)=>row.name))]
    const allowed=new Set(names)
    const listed=gitRemoteRefs([`${REVIEW_ACTIVE_REF_PREFIX}/*`,`${REVIEW_ACTIVE_PARALLEL_REF_PREFIX}/*`])
    const legacyRefs=new Set(names.map((name)=>`${REVIEW_ACTIVE_REF_PREFIX}/${name}`))
    const present=[...listed].filter(([ref])=>legacyRefs.has(ref)||ref.startsWith(`${REVIEW_ACTIVE_PARALLEL_REF_PREFIX}/`)).sort(([a],[b])=>a<b?-1:a>b?1:0)
    const commits=readGitCommits(present.map(([,sha])=>sha))
    const entries=[],leases=[]
    for(const [ref,sha] of present){
      const commit=commits.get(sha)
      if(!commit?.message)throw markLeaseReadFailure(new LaneError('active reviewer lease snapshot is unreadable'),{read:'lease snapshot commit',ref,kind:'determinate',cause:'commit has no message'})
      let lease
      try{lease=parseReviewLease({message:commit.message})}
      catch(error){throw markLeaseReadFailure(new LaneError(`active reviewer lease snapshot is unreadable: ${error.message}`),{read:'lease snapshot parse',ref,kind:'determinate',cause:error.message})}
      if(!lease||!allowed.has(lease.reviewer))throw markLeaseReadFailure(new LaneError('active reviewer lease snapshot is unreadable'),{read:'lease snapshot reviewer',ref,kind:'determinate',cause:`reviewer ${lease?.reviewer??'unknown'} not in allowed set`})
      const legacy=reviewActiveRef(lease.reviewer),parallelRef=/^[0-9a-f]{40}$/i.test(lease.headSha)?reviewLeaseRefForAssignment(lease,true):null
      if(ref!==legacy&&ref!==parallelRef)throw markLeaseReadFailure(new LaneError('active reviewer lease ref does not match its durable assignment identity'),{read:'lease ref identity',ref,kind:'determinate',cause:`ref ${ref} does not match reviewer ${lease.reviewer} assignment identity`})
      entries.push([ref,{sha,commit:{message:commit.message,committedDate:commit.committedDate??null}}])
      leases.push(lease)
    }
    const unique=[...new Map(leases.filter((lease)=>Number.isInteger(Number(lease.issue))&&Number.isInteger(Number(lease.pr))).map((lease)=>[`${lease.issue}:${lease.pr}`,lease])).values()]
    const fields=unique.map(reviewStateGraphqlFields).join(' ')
    const data=ghJson(['api','graphql','-f',`query=query($owner:String!,$name:String!){rateLimit{remaining limit resetAt} repository(owner:$owner,name:$name){defaultBranchRef{target{oid ... on Commit{tree{oid}}}} ${fields}}}`,'-F',`owner=${REPO_OWNER}`,'-F',`name=${REPO_NAME}`])
    if(data?.errors?.length)throw new LaneError('active reviewer lease snapshot returned GraphQL errors')
    recordReviewGraphQuota(data?.data?.rateLimit)
    const repo=data?.data?.repository
    if(!repo)throw new LaneError('active reviewer lease snapshot is unreadable')
    const base=repo?.defaultBranchRef?.target
    if(!base?.oid||!base?.tree?.oid)throw new LaneError('review commit base is unreadable')
    reviewCommitBase={head:base.oid,tree:base.tree.oid}
    const states=[]
    unique.forEach((lease,index)=>{try{states.push([`${lease.issue}:${lease.pr}`,reviewStateEntry(repo[`p${index}`],repo[`i${index}`])])}catch{}})
    if(states.length===unique.length)primeReviewStates(states)
    return new Map(entries)
  },
  readActiveReviewLeasesOverGraphql(){
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
    const query=`query($owner:String!,$name:String!){rateLimit{remaining limit resetAt} repository(owner:$owner,name:$name){defaultBranchRef{target{oid ... on Commit{tree{oid}}}} ${fields}}}`
    let data
    try{data=ghJson(['api','graphql','-f',`query=${query}`,'-F',`owner=${REPO_OWNER}`,'-F',`name=${REPO_NAME}`])}
    catch(error){
      if(isCommandSizeFailure(error))throw markReviewRefListingRefusal(new LaneError(`active reviewer lease snapshot of ${refs.length} refs exceeds the process argument limit; retire abandoned leases with --reap-abandoned-review-leases --apply-recovery (${error.message})`),{refs:refs.length,cause:'command-size'})
      throw error
    }
    if(data?.errors?.length)throw new LaneError('active reviewer lease snapshot returned GraphQL errors')
    recordReviewGraphQuota(data?.data?.rateLimit)
    const repo=data?.data?.repository
    if(!repo)throw new LaneError('active reviewer lease snapshot is unreadable')
    const base=repo?.defaultBranchRef?.target
    if(!base?.oid||!base?.tree?.oid)throw new LaneError('review commit base is unreadable')
    reviewCommitBase={head:base.oid,tree:base.tree.oid}
    const entries=[]
    refs.forEach((ref,index)=>{
      const target=repo[`r${index}`]
      if(target===undefined)throw markLeaseReadFailure(new LaneError('active reviewer lease snapshot is unreadable'),{read:'lease snapshot target',ref,kind:'transient',cause:'GraphQL target is undefined'})
      if(target===null)return
      if(!target?.oid||!target?.message)throw markLeaseReadFailure(new LaneError('active reviewer lease snapshot is unreadable'),{read:'lease snapshot target',ref,kind:'determinate',cause:'target has no oid or message'})
      let lease
      try{lease=parseReviewLease({message:target.message})}
      catch(error){throw markLeaseReadFailure(new LaneError(`active reviewer lease snapshot is unreadable: ${error.message}`),{read:'lease snapshot parse',ref,kind:'determinate',cause:error.message})}
      if(!allowed.has(lease.reviewer))throw markLeaseReadFailure(new LaneError('active reviewer lease snapshot is unreadable'),{read:'lease snapshot reviewer',ref,kind:'determinate',cause:`reviewer ${lease?.reviewer??'unknown'} not in allowed set`})
      const legacy=reviewActiveRef(lease.reviewer),parallelRef=/^[0-9a-f]{40}$/i.test(lease.headSha)?reviewLeaseRefForAssignment(lease,true):null
      if(ref!==legacy&&ref!==parallelRef)throw markLeaseReadFailure(new LaneError('active reviewer lease ref does not match its durable assignment identity'),{read:'lease ref identity',ref,kind:'determinate',cause:`ref ${ref} does not match reviewer ${lease.reviewer} assignment identity`})
      entries.push([ref,{sha:target.oid,commit:{message:target.message,committedDate:target.committedDate??null}}])
    })
    return new Map(entries)
  },
  readReviewStates(leases){
    const unique=[...new Map(leases.map((lease)=>[`${lease.issue}:${lease.pr}`,lease])).values()]
    if(!unique.length)return new Map()
    const primed=takePrimedReviewStates(unique)
    if(primed)return primed
    const fields=unique.map(reviewStateGraphqlFields).join(' ')
    const data=ghJson(['api','graphql','-f',`query=query{repository(owner:${JSON.stringify(REPO_OWNER)},name:${JSON.stringify(REPO_NAME)}){${fields}}}`])
    if(data?.errors?.length||!data?.data?.repository)throw new LaneError('batched reviewer PR/verdict evidence returned GraphQL errors')
    const result=new Map()
    unique.forEach((lease,index)=>{
      result.set(`${lease.issue}:${lease.pr}`,reviewStateEntry(data.data.repository[`p${index}`],data.data.repository[`i${index}`]))
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
    if(reviewWireBudget){const found=gitRemoteRefs(refs);return new Map(refs.map((ref)=>[ref,found.get(ref)??null]))}
    const fields=refs.map((ref,index)=>`r${index}:object(expression:${JSON.stringify(ref)}){oid}`).join(' ')
    const data=ghJson(['api','graphql','-f',`query=query{repository(owner:${JSON.stringify(REPO_OWNER)},name:${JSON.stringify(REPO_NAME)}){${fields}}}`])
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
  readReviewRecords(refs,prefix,dependentFailurePrefix=null,extraPrefix=null){
    // Same `object(expression:...)` fix as readReviewRefs above, applied here
    // too: `ref(qualifiedName:...)` silently answered null for every one of
    // these custom-namespace refs (replacementRef, assignmentRef,
    // REVIEW_CURSOR_REF), which would have made every caller of this method
    // treat a real record as absent.
    // Both peer namespaces are read in one git wire operation during reviewer
    // allocation. A fixed number of slot probes would miss a higher live slot.
    const prefixes=[prefix,extraPrefix].filter(Boolean)
    const matches=reviewWireBudget&&prefixes.length>1
      ?[...gitRemoteRefs(prefixes.map((value)=>`${value}*`))].filter(([ref])=>prefixes.some((value)=>ref.startsWith(value))).map(([ref,sha])=>({ref,sha}))
      :prefixes.flatMap((value)=>this.listRefs(value))
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
    // Issue #3187: inside a reviewer operation the same exact refs and their commit
    // messages are read over git (ls-remote + cat-file, fetching absent commits by
    // SHA). Unreadable answers throw exactly as the GraphQL form does. The commit
    // base is left as the lease snapshot of this same operation already set it.
    if(reviewWireBudget){
      const found=allRefs.length?gitRemoteRefs(allRefs):new Map()
      const commits=readGitCommits([...found.values()])
      const result=new Map(allRefs.map((ref)=>{const sha=found.get(ref),message=sha?commits.get(sha)?.message:null;if(sha&&typeof message!=='string')throw new LaneError('review record preflight is unreadable');return [ref,sha?{sha,commit:{message}}:null]}))
      Object.defineProperty(result,'matching',{value:matches.map((row)=>{const record=result.get(row.ref);return{ref:row.ref,sha:row.sha,commit:record?.sha===row.sha&&record?.commit?.message?record.commit:undefined}}),enumerable:false})
      return result
    }
    const fields=allRefs.map((ref,index)=>`r${index}:object(expression:${JSON.stringify(ref)}){oid ... on Commit{message}}`).join(' ')
    const data=ghJson(['api','graphql','-f',`query=query{repository(owner:${JSON.stringify(REPO_OWNER)},name:${JSON.stringify(REPO_NAME)}){base:defaultBranchRef{target{... on Commit{oid tree{oid}}}} ${fields}}}`])
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
  openClaims(pager = ghPaginated, search = (query) => ghJson(['api', `search/issues?q=${encodeURIComponent(query)}&per_page=100`])) {
    // #2958: GitHub's `labels=` filtered listing returned [] while the same issues
    // were open and labelled. List unfiltered and filter the label client-side.
    const rows = pager(`repos/${REPO}/issues?state=open&per_page=100`)
    if (!Array.isArray(rows)) throw new LaneError('open issue listing was unreadable; refusing to treat open claims as empty')
    const issues = rows.filter((x) => !x.pull_request)
    const claims = issues.filter((x) => hasLabel(x, 'db-claim')).map((x) => ({ number: x.number, title: x.title, body: x.body, url: x.html_url }))
    const listing = `open issue listing returned ${rows.length} rows (${rows.length - issues.length} pull requests, ${issues.length - claims.length} issues without db-claim, ${claims.length} claims)`
    // #2958 run 34985444563: the merge lane read ZERO claims in CI while the lease check
    // in the same run, same token and same call, read #2957. An empty or PR-only read
    // must never pass as "no open claims": refuse, or prove absence a second way.
    if (issues.length === 0) throw new LaneError(`${listing}; no issues at all is not a readable answer, refusing to treat open claims as empty`)
    if (claims.length === 0) {
      const found = search(`repo:${REPO} is:issue is:open label:db-claim`)
      if (!Number.isInteger(found?.total_count)) throw new LaneError(`${listing}; the db-claim search cross-check was unreadable, refusing to treat open claims as empty`)
      if (found.total_count !== 0) throw new LaneError(`${listing}; but GitHub search reports ${found.total_count} open db-claim issues (${(found.items ?? []).map((x) => `#${x.number}`).join(', ')}); refusing to treat open claims as empty`)
    }
    return Object.defineProperty(claims, 'listing', { value: listing, enumerable: false })
  },closedClaimsForWork(issue,pager=ghPaginated){const rows=pager(`repos/${REPO}/issues?state=closed&labels=db-claim&per_page=100`)
    // #2958: GitHub's labels= listing has returned [] for labelled issues. Closed claim
    // history only ever grows, so an empty or unreadable listing is a GitHub fault;
    // treating it as "no history" could make a consumed version or object look free.
    if(!Array.isArray(rows)||rows.length===0)throw new LaneError('closed db-claim history listing returned no rows; refusing to treat claim history as empty')
    return rows.filter((x)=>!x.pull_request&&[...String(x.title??'').matchAll(/#(\d+)\b/g)].map((match)=>Number(match[1])).filter((number)=>number===Number(issue)).length===1&&[...String(x.title??'').matchAll(/#(\d+)\b/g)].length===1).map((x)=>({number:x.number,title:x.title,body:x.body,url:x.html_url,state:x.state}))},
  // EVERY open issue is audited, not just the ones somebody remembered to
  // label. Filtering on `labels=db-work` here is what let issues #1188, #1238,
  // #1242, #1266 and #1268 sit unlabelled and therefore invisible to the queue
  // audit while carrying a valid db-work-scope block. Coordination issues
  // (db-claim, orchestrator-marker) are the only exclusions; a missing db-work
  // label on anything else is now a reported defect, never a silent skip.
  openWorkIssues(pager = ghPaginated) { return workIssuesFromRows(pager(`repos/${REPO}/issues?state=open&per_page=100`)) },
  openIssueNumbers(pager = ghPaginated) { return openIssueNumbersFromRows(pager(`repos/${REPO}/issues?state=open&per_page=100`)) },
  // #2787: the queue audit lists open issues ONCE and derives claims, work issues and
  // open numbers from that single listing.
  openIssueRows() { const rows=ghPaginated(`repos/${REPO}/issues?state=open&per_page=100`); if(!Array.isArray(rows))throw new LaneError('open issue listing was unreadable; refusing to treat open claims and work issues as empty'); return rows },
  // DEPENDENCY STATE (Step 3, issue #1366). Fetch every REFERENCED dependency, not
  // just the ones that happen to be open, because a nonexistent number and an
  // unreadable issue must both BLOCK rather than release. Any failure is recorded
  // as `unreadable` and never collapsed into "fine".
  dependencyStates(declarations) { return readDependencyStates(declarations, this) },
  mergeCommitInMain(sha) {
    try { assertMergeCommitInMainHistory(sha, this.readRef('refs/heads/main'), this); return true }
    catch { return false }
  },
  prSources() { return gatherOpenPrObjects(REPO) },
  openPulls() { return ghPaginated(`repos/${REPO}/pulls?state=open&per_page=100`) },
  // #2987 verdict archive: every pull request's state in one paginated listing.
  readPullStates() { return new Map(ghPaginated(`repos/${REPO}/pulls?state=all&per_page=100`).map((row)=>[Number(row.number),{state:row.state,merged:Boolean(row.merged_at),mergeCommitSha:row.merged_at?row.merge_commit_sha??null:null,mergedAt:row.merged_at??null}])) },
  // true/false from the local object store; null (kept, never guessed) when the
  // commit is absent or unreadable here.
  mergeTouchesMigrations(sha) {
    if(!/^[0-9a-f]{40}$/i.test(String(sha)))return null
    try{return execFileSync('git',['diff','--name-only',`${sha}^1`,sha],{encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:32*1024*1024}).split(/\r?\n/).some((line)=>line.startsWith('supabase/migrations/'))}
    catch{return null}
  },
  // AGENTS.md section 4 rule 2 is merge-first: the rehearsal happens AFTER the PR
  // merges, so the lane must still be able to find that PR once it is closed.
  // `openPulls()` cannot see it; this looks the branch up across every state.
  branchPulls(branch) { return ghPaginated(`repos/${REPO}/pulls?state=all&head=${REPO.split('/')[0]}:${encodeURIComponent(branch)}&per_page=100`) },
  verifyNonclosingMaintenanceBinding(request){return verifyNonclosingMaintenanceBinding(request,this)},
  prepareNonclosingEvidenceGit(head,base){execFileSync('git',['fetch','--no-tags','--quiet','origin',head,base],{stdio:['ignore','pipe','pipe']})},
  getPr(number) { return ghJson(['api', `repos/${REPO}/pulls/${number}`]) },
  getPrFiles(number) { return ghPaginated(`repos/${REPO}/pulls/${number}/files?per_page=100`) },
  databasePreviewFileSnapshot(pr,baseSha,headSha){
    const readTree=(ref)=>{const body=ghJson(['api',`repos/${REPO}/git/trees/${ref}?recursive=1`]);if(body?.truncated===true||!Array.isArray(body?.tree))throw new LaneError(`live Git tree is incomplete for ${ref}`);return new Map(body.tree.map((row)=>[row.path,{blob_sha:row.sha,mode:row.mode,type:row.type}]))}
    const base=readTree(baseSha),head=readTree(headSha),files=this.getPrFiles(pr)
    if(!Array.isArray(files)||!files.length)throw new LaneError('live pull request changed-file set is empty or unreadable')
    return buildDatabasePreviewFileSnapshot(files,base,head,(path,side)=>this.getFileAt(path,side==='base'?baseSha:headSha))
  },
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
    const query=`query{repository(owner:${JSON.stringify(REPO_OWNER)},name:${JSON.stringify(REPO_NAME)}){pullRequest(number:${Number(number)}){closingIssuesReferences(first:10){nodes{number state} pageInfo{hasNextPage}}}}}`
    const data=ghJson(['api','graphql','-f',`query=${query}`])
    const connection=data?.data?.repository?.pullRequest?.closingIssuesReferences
    if(!connection||!Array.isArray(connection.nodes)||connection.pageInfo?.hasNextPage!==false)throw new LaneError('pull request closing-issue linkage is unreadable or paginated')
    return connection.nodes
  },
  prStructuralObjects(number,headSha){
    return this.prStructuralInspection(number,headSha).objects
  },
  prStructuralInspection(number,headSha){
    const files=this.getPrFiles(Number(number)).map((file)=>/^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(String(file?.filename??file?.path??''))&&file?.status!=='removed'
      ?{...file,content:this.getFileAt(file.filename??file.path,headSha)}:file)
    return inspectPrStructuralChange(files)
  },
  // Issue #2342: the caller reads a whole SET of files at one ref, which used to
  // be a Contents call each. One recursive tree read now answers every path, and
  // blobs are cached by SHA, so a file unchanged across refs is fetched once.
  getFileAt(file,ref){const text=laneTreeReader.readFileAtRef(REPO,file,ref);if(text===null)throw new LaneError(`could not read ${file} at ${ref}`);return text},
  treeFiles(ref){return laneTreeReader.pathsAtRef(REPO,ref)},
  previewGateProof(issue,pr,head,bundleId,dependencies=[]){
    const protectedContexts=readRequiredCheckContexts({
      // The two authority reads need admin-level access a workflow token can
      // never have (issue #3857): they run with AUTHORITY_TOKEN when it is
      // present -- the same SYNC_TOKEN pattern guarded-migration-merge.yml
      // uses -- and fail closed unchanged when it is not.
      protectedChecks:()=>authorityGhJson(['api',`repos/${REPO}/branches/main/protection/required_status_checks`]),
      branch:()=>authorityGhJson(['api',`repos/${REPO}/branches/main`]),
      repository:()=>ghJson(['api',`repos/${REPO}`]),
      branchRules:()=>ghJson(['api','--paginate','--slurp',`repos/${REPO}/rules/branches/main?per_page=100`]),
      confirmRulesEnd:(page)=>ghJson(['api',`repos/${REPO}/rules/branches/main?per_page=100&page=${page}`]),
    })
    const checks=JSON.parse(gh(['pr','checks',String(pr),'--repo',REPO,'--json','name,state']))
    const byName=new Map(checks.map((row)=>[row.name,String(row.state).toUpperCase()]))
    const failed=pendingRequiredContexts(protectedContexts,byName)
    if(failed.length)throw new LaneError(`required full CI is not successful on the current head: ${failed.join(', ')}`)
    // #3806: the post-merge rehearsal route judges a merged PR whose verdict may be archived.
    assertDurableReviewApproval(issue,pr,head,this,{includeArchived:true})
    const states=dependencies.length?this.dependencyStates(dependencies):{},closure=classifyDependencies(issue,dependencies,states)
    if(!closure.satisfied)throw new LaneError(`migration dependency closure is incomplete: ${closure.blocked.map((row)=>`#${row.number}`).join(', ')}`)
    return {full_ci_success:true,review_approved:true,dependency_closure_complete:true}
  },
  getIssue(number) { return ghJson(['api', `repos/${REPO}/issues/${number}`]) },
  getIssueComments(number) { return ghPaginated(`repos/${REPO}/issues/${number}/comments?per_page=100`) },
  getPrReviews(number) { return ghPaginated(`repos/${REPO}/pulls/${number}/reviews?per_page=100`) },
  readLeaseActivity(lease) {
    const query=`query{repository(owner:${JSON.stringify(REPO_OWNER)},name:${JSON.stringify(REPO_NAME)}){pullRequest(number:${Number(lease.pr)}){comments(first:100){totalCount nodes{updatedAt}} reviews(first:100){totalCount nodes{submittedAt updatedAt}} reviewThreads(first:100){totalCount nodes{comments(first:100){totalCount nodes{updatedAt}}}}} object(oid:${JSON.stringify(String(lease.headSha))}){... on Commit{statusCheckRollup{contexts(first:100){totalCount nodes{... on CheckRun{startedAt completedAt}}}}}}}}`
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
    const repo=ghJson(['api','graphql','-f',`query=query{repository(owner:${JSON.stringify(REPO_OWNER)},name:${JSON.stringify(REPO_NAME)}){${fields}}}`])?.data?.repository
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
  // #3411: a MERGED pull request is judged against its guarded merge commit's
  // first parent (main as the merge saw it). The guarded migration lane uses
  // two-parent --merge; a squash has no reviewed second parent and cannot carry
  // a prior approval here. The broader merge gate also serves prose-only PRs.
  readReviewFailureCommit(sha) { return readGitCommits([sha]).get(sha) },
  pauseReviewerFailure(record) { return pauseProviderFailure(record) },
  readPaidReviewStarts(prefix,pr) {
    if(!Number.isInteger(pr)||pr<1)throw new LaneError('review circuit breaker: exact positive PR number required')
    const rows=[...gitRemoteRefs([`${prefix}*-${Number(pr)}-*`])].map(([ref,sha])=>({ref,sha}))
    if(rows.length>=REVIEW_REF_ROW_LIMIT)throw new LaneError('review circuit breaker: complete start history reaches bounded row ceiling; possibly truncated history refused')
    const commits=readGitCommits(rows.map(row=>row.sha))
    return rows.map(row=>({...row,commit:commits.get(row.sha)}))
  },
  reviewContentComparison(before,after,pr,context={}) {
    const base=context.base??this.getPr(pr)?.base?.sha
    context.base=base
    if(!/^[0-9a-f]{40}$/.test(base??''))throw new LaneError('review circuit breaker: exact protected comparison base unreadable')
    execFileSync('git',['fetch','--no-tags','-q','origin',before,after,base],{stdio:['ignore','pipe','pipe']})
    const excludePaths=verifiedEvidencePaths(before,after)
    let contracts=paidBudgetContractCaches.get(context);if(!contracts){contracts=new Map();paidBudgetContractCaches.set(context,contracts)}
    const readContract=ref=>{
      if(!contracts.has(ref))contracts.set(ref,readPublishedContractFromGit(ref,(command,args,options)=>{
        if(command==='git' && ['ls-remote','fetch'].includes(args[0]))consumeReviewWireRequest()
        return execFileSync(command,args,options)
      }))
      return contracts.get(ref)
    }
    const budgetProof=derivePaidContentProof(before,after,base,args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}),excludePaths,pr,readContract)
    return {before:prContentDigest(before,base,{excludePaths}),after:prContentDigest(after,base,{excludePaths}),budgetProof}
  },
  contentPreservingRefresh(approvedHead,head,pr=null,context=null,gitRunner=(args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})){
    const key=`${Number(pr)}:${String(head).toLowerCase()}`
    if(context?.key!==undefined&&context.key!==key)return{ok:false,reason:'review comparison context was reused for a different pull request or head'}
    if(context?.refusal)return context.refusal
    const refuse=(result)=>{if(context){context.key=key;context.refusal=result}return result}
    let prepared=context?.prepared
    if(!prepared){
      let base
      try{base=resolveLaneApprovalBase(pr,head,this)}catch(error){return refuse({ok:false,reason:`could not resolve pull request comparison base: ${String(error?.message??error).split('\n')[0]}`})}
      if(!base.ok)return refuse(base)
      try{gitRunner(['fetch','--no-tags','-q','origin',String(head),base.fetch,...(base.currentMain?[base.currentMain]:[])])}
      catch(error){return refuse({ok:false,reason:`could not fetch the heads to compare: ${String(error?.message??error).split('\n')[0]}`})}
      let mainRef=base.fetch
      if(base.firstParentOf){
        try{mainRef=mergedReviewComparisonBase({mergeCommitSha:base.firstParentOf,head,main:base.currentMain,gitRunner})}
        catch(error){return refuse({ok:false,reason:String(error?.message??error).split('\n')[0]})}
      }
      prepared={mainRef}
      if(context){context.key=key;context.prepared=prepared}
    }
    try{return isContentPreservingRefresh({approvedHead,head,mainRef:prepared.mainRef,gitRunner})}
    catch(error){return{ok:false,reason:`could not compare the pull request diff: ${String(error?.message??error).split('\n')[0]}`}}
  },
  getCommit(sha) {
    // Issue #3187: a reviewer operation reads commit objects over git; same shape.
    if(reviewWireBudget&&/^[0-9a-f]{40}$/i.test(String(sha))){const c=readGitCommits([sha]).get(String(sha).toLowerCase());if(!c)throw new LaneError(`commit ${sha} is unreadable`);return {sha:String(sha).toLowerCase(),message:c.message,committer:{date:c.committedDate},author:{date:c.committedDate},commit:{message:c.message,committer:{date:c.committedDate},author:{date:c.committedDate}}}}
    return ghJson(['api', `repos/${REPO}/git/commits/${sha}`]) },
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
    let commit
    if(reviewWireBudget){const response=parseGhIncludeResponse(gh(['api', '-i', '-X', 'POST', `repos/${REPO}/git/commits`, '-f', `message=${message}`, '-f', `tree=${tree}`, '-f', `parents[]=${head}`]));recordReviewQuotaHeaders(response.headers);commit=response.rows}
    else commit = ghJson(['api', '-X', 'POST', `repos/${REPO}/git/commits`, '-f', `message=${message}`, '-f', `tree=${tree}`, '-f', `parents[]=${head}`])
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
    const match=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/\d+#issuecomment-(\d+)$/.exec(String(url??''))
    if(!match||!isThisRepositoryOrHistorical(match[1],REPO))throw new LaneError('findings-ref must be a durable shared-db issue or PR comment URL')
    return ghJson(['api',`repos/${REPO}/issues/comments/${match[2]}`])?.body??null
  },
  createRef(ref, sha) {
    return createRefWithReadback(ref,sha,{readRef:(target)=>this.readRef(target)})
  },
  // Issues #2457/#2844: a confirmation read that never comes from the git replica.
  // Used only to confirm an apparently-unreleased mutex before refusing, so it is
  // paid once, from the mutex-release reserve, on a path that is already failing.
  readRefOverApi(ref) {
    const short = ref.replace(/^refs\//, '')
    try { return ghJson(['api', `repos/${REPO}/git/ref/${short}`],{expectedFailure:EXPECTED_REF_ABSENCE})?.object?.sha ?? null }
    catch (error) { if (isConfirmedRefAbsence(error)) return null; throw error }
  },
  readRef(ref) {
    if(reviewWireBudget)return gitRemoteRefs([ref]).get(ref)??null
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
    if(reviewWireBudget)return gitRemoteRefRows(prefix)
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
    if(reviewWireBudget&&fetch===ghRefListing)return gitRemoteRefRows(prefix)
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
  issueComments(number) { return ghPaginated(`repos/${REPO}/issues/${number}/comments?per_page=100`).map((c)=>({ body:c.body, author_association:c.author_association, author:c.user?.login, id:c.id, created_at:c.created_at, updated_at:c.updated_at })) },
  readOutcomeEvidence(ref) {
    let path
    try{path=repositoryCommentApiPath(ref,REPO)}catch(error){throw new LaneError(`outcome evidence refused: ${error.message}`)}
    return ghJson(['api',path])?.body??''
  },
  applicationCommitInDefaultBranch(repository,sha) {
    const repo=ghJson(['api',`repos/${repository}`]),branch=repo?.default_branch
    if(!branch)return false
    const comparison=ghJson(['api',`repos/${repository}/compare/${sha}...${encodeURIComponent(branch)}`])
    return comparison?.behind_by===0&&['identical','ahead'].includes(comparison?.status)
  },
  verifyProductionApply(evidence){
    const match=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/.exec(String(evidence?.production_evidence??''))
    if(!match||!isThisRepositoryOrHistorical(match[1],REPO))return false
    const run=ghJson(['api',`repos/${REPO}/actions/runs/${match[2]}`])
    if(run?.conclusion!=='success'||run?.event!=='workflow_dispatch'||run?.path!=='.github/workflows/shared-supabase-migrations.yml'||String(run?.head_sha??'').toLowerCase()!==String(evidence.production_commit_sha).toLowerCase())return false
    const ancestry=ghJson(['api',`repos/${REPO}/compare/${evidence.merge_sha}...${evidence.production_commit_sha}`])
    if(!['identical','ahead'].includes(ancestry?.status)||Number(ancestry?.behind_by)!==0)return false
    const artifacts=ghJson(['api',`repos/${REPO}/actions/runs/${match[2]}/artifacts`])?.artifacts
    const artifact=Array.isArray(artifacts)?artifacts.find((row)=>Number(row.id)===Number(evidence.production_artifact_id)):null
    if(!(artifact?.name===`production-migration-apply-${String(evidence.production_commit_sha).toLowerCase()}`&&artifact.expired===false&&String(artifact.digest??'').toLowerCase()===String(evidence.production_artifact_digest).toLowerCase()))return false
    const files=this.readArtifactFiles(REPO,artifact.id,['production-apply.txt','production-ledger-after.txt','migration-content-manifest.json','production-catalog-verification.json'])
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
    const entries=readZipEntries(gh(['api',`repos/${repository}/actions/artifacts/${Number(id)}/zip`],{encoding:null,maxBuffer:20*1024*1024}))
    return selectArtifactJson(entries,expectedFile)
  },
  readArtifactFiles(repository,id,expectedFiles){
    const entries=readZipEntries(gh(['api',`repos/${repository}/actions/artifacts/${Number(id)}/zip`],{encoding:null,maxBuffer:20*1024*1024}))
    return selectArtifactFiles(entries,expectedFiles)
  },
  closeIssue(number) { gh(['issue','close',String(number),'--repo',REPO]) },
  closeClaim(number, reason) { gh(['issue', 'close', String(number), '--repo', REPO, '--comment', requireClaimCloseReason(reason)]) },
  reversionFiles(worktree,oldVersion) {
    let referenced=[];const riskGatePath=['scripts','production_business_risk_gate.py'].join('/')
    try{referenced=execFileSync('git',['-C',worktree,'grep','-l',oldVersion,'--','supabase/migrations','supabase/tests',riskGatePath,'config/production-verification-sidecar-registry.json','docs'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean)}
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
    execFileSync('git',['-C',worktree,'add','--all','--','supabase/migrations','supabase/tests','scripts/production-verification-sidecars',riskGatePath,'config/production-verification-sidecar-registry.json','docs'])
    execFileSync('git',['-C',worktree,'commit','-m',`migration: re-reserve ${oldVersion} as ${newVersion}`],{stdio:'pipe'})
    execFileSync('git',['-C',worktree,'push','origin','HEAD'],{stdio:'pipe'})
    return execFileSync('git',['-C',worktree,'rev-parse','HEAD'],{encoding:'utf8'}).trim()
  },
  localHead(worktree){return execFileSync('git',['-C',worktree,'rev-parse','HEAD'],{encoding:'utf8'}).trim()},
  localBranch(worktree){return execFileSync('git',['-C',worktree,'symbolic-ref','--quiet','--short','HEAD'],{encoding:'utf8'}).trim()},
  localWorktreeState(worktree){
    if(!existsSync(worktree))return {state:'absent'}
    const clean=execFileSync('git',['-C',worktree,'status','--porcelain'],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean).every((line)=>line.slice(3).replaceAll('\\','/').startsWith('.ai/'))
    return {state:clean?'clean':'dirty'}
  },
  localClean(worktree){return existsSync(worktree)&&execFileSync('git',['-C',worktree,'status','--porcelain'],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean).every((line)=>line.slice(3).replaceAll('\\','/').startsWith('.ai/'))},
  // A recovery artifact is only worth anything if it can actually be READ back.
  // Shape validation alone (40-64 hex characters) accepts invented digits, which
  // makes a recovery gate assertion-only. This dereferences the reference as a
  // git object in this repository; anything that cannot be resolved is refused.
  verifyArtifact(reference){
    const hash=/^artifact:([0-9a-f]{40,64})$/i.exec(String(reference??''))
    if(!hash)return null
    try{
      const type=execFileSync('git',['cat-file','-t',hash[1]],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
      return type?{kind:'git-object',type,id:hash[1].toLowerCase()}:null
    }catch{return null}
  },
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
    // ISSUE #2678. A credentialed wrapper refuses to run at all unless its own
    // `AI_<PROVIDER>_CALLER` names the assistant calling it, and it refuses
    // BEFORE printing any check line. Probing it without that variable made two
    // completely healthy reviewers read as a local dependency fault. Tell the
    // wrapper who is calling; never invent a caller the environment does not
    // support (`required:false` leaves it unset rather than guessing).
    const callerEnv=reviewCallerEnvironment(wrapper,process.env,{required:false})
    let output=''
    try{output=execFileSync(file,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:REVIEWER_DOCTOR_TIMEOUT_MS,env:{...process.env,...callerEnv}})}
    catch(error){
      if(error?.code==='ETIMEDOUT')return {ok:false,failingChecks:doctorTimeoutFailingChecks(wrapper)}
      output=`${error?.stdout??''}${error?.stderr??''}`
      const failed=parseDoctorFailures(output)
      if(failed.length)return {ok:false,failingChecks:failed}
      return {ok:false,failingChecks:[unnamedDoctorFailure(wrapper,error,error?.stderr??output)],output}
    }
    // The raw output rides alongside the summary so the one caller that must
    // RECORD the proof (reinstateReviewerExclusion) quotes the wrapper verbatim
    // instead of paraphrasing it. Nothing else reads it.
    return {...summarizeDoctorOutput(output),output}
  },
  reviewerAdmissionOverrides(reviewer){
    return {profile:process.env.AI_REVIEW_ADMISSION_PROFILE||undefined,model:process.env.AI_REVIEW_ADMISSION_MODEL||(reviewer.provider==='kimi'?process.env.AI_KIMI_MODEL:undefined)||undefined}
  },
  reviewerUsability(reviewers){
    const command='ai-review-preflight',resolved=resolveCommandPath(command)
    if(!resolved)throw new LaneError(`${command} is not on PATH; reviewer assignment cannot prove the reconciled provider state`)
    const args=['usable'], spawn=process.platform==='win32'&&/\.(cmd|bat)$/i.test(resolved)
      ?{file:process.env.ComSpec||'cmd.exe',args:['/d','/s','/c',resolved,...args]}
      :{file:resolved,args}
    let output=''
    try{output=execFileSync(spawn.file,spawn.args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:REVIEWER_PREFLIGHT_TIMEOUT_MS})}
    catch(error){output=String(error?.stdout??'');if(error?.code==='ETIMEDOUT'||error?.signal)return reconcilePreflightRows(output,reviewers,{complete:false})}
    return reconcilePreflightRows(output,reviewers)
  },
  // The orchestrator role is retired (owner ruling 2026-10-02, issue #3874), so
  // reviewer assignment no longer reads the orchestrator marker. Reviewer
  // independence now follows the AUTHORING session's engine, declared in
  // SHARED_DB_AUTHOR_ENGINE (e.g. claude, codex, glm, zcode). Unset, blank or
  // unknown values refuse (fail closed); see authorEngineFromEnv.
  resolveOrchestratorEngine(){
    return authorEngineFromEnv(process.env.SHARED_DB_AUTHOR_ENGINE)
  },
  orchestratorFlowAdapter(claimNumber,admissionOptions=null){ return githubFlowAdapter(this,claimNumber,admissionOptions) },
  flowSnapshot(now=new Date(),{capacityOnly=false}={}){
    const claims=this.openClaims()
    // QUEUED-BEHIND IS COMPUTED ONCE, AND ONLY IF SOMETHING IS ACTUALLY EXPIRED.
    // It is the count the report exists to show -- how many tasks are waiting on
    // a lane whose lease ran out -- and it comes from the same pure queue builder
    // the audit uses, not from a second guess at what a lane holds.
    let queuedBehind=null
    const queuedBehindFor=(claimNumber)=>{
      if(queuedBehind===null){
        queuedBehind=new Map()
        try{
          for(const lane of buildDynamicQueues(this.openWorkIssues(),claims,now,this.openIssueNumbers()).queues)
            if(lane.active)queuedBehind.set(Number(lane.active),lane.queued.length)
        }catch{/* an unreadable queue leaves the count unknown rather than zero */}
      }
      return queuedBehind.has(Number(claimNumber))?queuedBehind.get(Number(claimNumber)):null
    }
    return {issues:claims.map((claim)=>{
      // THE CLAIM-IDENTITY READ IS ITS OWN FAILING LEG. A live claim whose title
      // predates the `#<number>` convention -- #2871 "CLAIM: issue-2870-cutover-columns"
      // was one on 2026-09-16 -- used to throw out of this map and blank the entire
      // snapshot, so the hourly read-only audit reported nothing at all about the
      // other seven lanes. One unreadable claim is now one unreadable row: both
      // domains report it as unverifiable, which is what the exit code already
      // means, instead of one legacy title silencing the whole instrument.
      let issue=null,identity_error=null
      try{issue=claimWorkIssue(claim)}catch(error){identity_error=error.message}
      if(identity_error!==null)return {issue:null,claim:claim.number,capacity_error:`claim #${claim.number}: ${identity_error}`,preview_edge_satisfied:false,preview_error:capacityOnly?null:`claim #${claim.number}: ${identity_error}`}
      // THE TWO DOMAINS ARE DERIVED INDEPENDENTLY AND FAIL INDEPENDENTLY. A throw
      // while reading capacity evidence must not blank the preview answer, and a
      // preview edge that cannot be derived must not make capacity look unreadable.
      // Each leg therefore carries its own try/catch and its own error field.
      let capacity=null,capacity_error=null
      try{capacity=flowCapacityFacts(claim,issue,now,this,queuedBehindFor)}catch(error){capacity_error=error.message}
      let preview_edge_satisfied=false,preview_error=null
      if(!capacityOnly)try{deriveLivePreviewCandidate(issue,this);preview_edge_satisfied=true}catch(error){preview_error=error.message}
      return {issue,claim:claim.number,...(capacity??{}),capacity_error,preview_edge_satisfied,preview_error}
    })}
  },
}

function githubFlowAdapter(io,claimNumber=null,admissionOptions=null){
  const payload=(sha)=>{const message=io.getCommit(sha)?.message??'';const match=/^db-preview-(?:ready|outcome) ([\s\S]+)$/.exec(message);if(!match)throw new LaneError('preview coordination ref does not point to a recognized immutable payload');return JSON.parse(match[1])}
  return {
    // Claim-first session authority (issue #3874) replaces the retired
    // sole-orchestrator marker. Same shape ({live, task, calling_task, state}),
    // fail closed: an undeclared SHARED_DB_SESSION_ID, or a named claim whose
    // lease owner is not this session, is never live.
    resolveMarker(){
      if(claimNumber===null||claimNumber===undefined)return resolveSessionAuthority()
      let owner=null
      try{owner=parseAuthorLease(io.getIssue(Number(claimNumber))?.body??'').owner}catch{owner=null}
      return resolveSessionAuthority({claimOwner:owner})
    },
    actor:()=>readSessionIdOrUnknown(),now:()=>new Date().toISOString(),
    appendEvent(event){io.commentIssue(event.work_issue,formatEventComment(event))},
    createRef(ref,digest,record){const kind=ref.startsWith('refs/db-preview-ready-outcomes/')?'outcome':'ready',sha=io.makeOwnerCommit(`db-preview-${kind} ${JSON.stringify({digest,record})}`);return io.createRef(ref,sha)},
    readRef(ref){const sha=io.refreshRef?.(ref)??io.readRef(ref);return sha?payload(sha):null},
    listReady(issue){return io.listRefs('refs/db-preview-ready/').map((row)=>payload(row.sha)).filter((row)=>Number(row.record?.issue)===Number(issue))},
    selectCurrent(issue){const candidate=deriveLivePreviewCandidate(Number(issue),io,{claimNumber});if(admissionOptions&&(Number(candidate.issue)!==Number(admissionOptions.admitIssue)||Number(candidate.pr)!==Number(admissionOptions.pr)))throw new LaneError(`preview candidate issue #${candidate.issue} pull request #${candidate.pr} is not the admitted issue #${admissionOptions.admitIssue} pull request #${admissionOptions.pr}`);return candidate},
    relinquishCapacity(row){return relinquishAuthorLease({claim:row.claim,owner:row.owner,blockedOn:row.blocker.reference},new Date(),io)},
    resumeCapacity(row){return resumeAuthorLease({claim:row.claim,owner:row.owner,leaseHours:DEFAULT_LEASE_HOURS},new Date(),io)},
    persistReady(row){return persistInitialReady(deriveLivePreviewCandidate(Number(row.issue),io),this)},
    withMutex(fn){const ownerSha=io.makeOwnerCommit(`db-coordination preview-ready-preparation issue=0`);acquireMutex(ownerSha,io);try{if(admissionOptions)requireAdmission(admissionOptions,io,{pr:admissionOptions.pr??null,mutexOwner:ownerSha});return fn()}finally{releaseMutexOnExit(ownerSha,io)}},
    events(issue){return (io.issueComments(issue)??[]).flatMap((comment)=>parseEventComment(comment.body??comment))},
  }
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

export function excludeReviewerForPr({issue,pr,reviewer,reason,evidenceSha},io=githubIo){
  return withReviewRequestBudget(()=>{
    io=reviewOperationIo(io);issue=Number(issue);pr=Number(pr);reviewer=String(reviewer??'');reason=String(reason??'');evidenceSha=String(evidenceSha??'')
    if(!Number.isInteger(issue)||!Number.isInteger(pr)||!REVIEWERS.some((row)=>row.name===reviewer)||!RECORDABLE_EXCLUSION_REASONS.has(reason)||!/^[0-9a-f]{7,40}$/i.test(evidenceSha))throw new LaneError(RETIRED_EXCLUSION_REASONS.has(reason)?`reviewer exclusion reason ${reason} is retired: reusing a reviewer on the same pull request is allowed (#2893)`:'reviewer exclusion requires issue, PR, known reviewer, allowed reason, and durable evidence SHA')
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
      // #3866: an assignment whose lease was already released (e.g. by a prior
      // replacement that was later returned) is stranded. Without this, exclude
      // reports returned:[] forever and assign-reviewer refuses because the
      // durable assignment still names the excluded reviewer. A lease-less
      // assignment with no verdict is still outstanding and must be returned;
      // one with a verdict is an old approved assignment and stays.
      if(!leaseRef){
        const vref=verdictRef({issue,pr,headSha:named.headSha,slot:named.slot,replacementSequence:named.replacementSequence})
        if(io.readRef(vref))continue
      }
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
    let completedResult=null
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
      return completedResult={issue,pr,reviewer,reason,evidenceSha,ref,sha,releasedLease:releaseLease,
        returned:returns.map((row)=>({assignmentRef:row.ref,assignmentSha:row.sha,headSha:row.headSha,slot:row.slot,replacementSequence:row.replacementSequence,ref:row.returnRef,sha:row.returnSha}))}
    }
    finally{finalizeReviewMutexPreservingResult(ownerSha,io,completedResult)}
  })
}

function requireReviewQuota(quota){
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
}
function reviewOperationIo(io){
  if(io?.__reviewOperation)return io
  // Issue #3187: an io that observes quota on responses it already makes (githubIo)
  // defers this gate to the moment before the mutex is taken -- see
  // acquireReviewMutex -- instead of paying a separate rate_limit request. Nothing
  // is skipped: with no observed facts it falls back to getRateLimit.
  const deferQuota=typeof io.observedReviewQuota==='function'
  if(!deferQuota)requireReviewQuota(typeof io.getRateLimit==='function'?io.getRateLimit():{remaining:5000,graphRemaining:5000,reset:0,graphReset:0})
  const cache=new Map()
  const proxy=new Proxy(io,{get(target,key){
    if(key==='__reviewOperation')return true
    if(key==='__requireReviewQuota')return ()=>{if(deferQuota)requireReviewQuota(target.observedReviewQuota()??(typeof target.getRateLimit==='function'?target.getRateLimit():null))}
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
      const result=value.apply(key==='reviewContentComparison'?proxy:target,args)
      if(cacheable)cache.set(cacheKey,result)
      if(['createRef','updateRef','deleteRef'].includes(key))cache.delete(`readRef:${JSON.stringify([args[0]])}`)
      return result
    }
  }})
  return proxy
}
// Issue #2457: an operation that COMPLETED must never lose its result because the
// mutex release that follows it could not be proved. The completed result is carried
// on the thrown error and printed by the caller, so the operator learns which reviewer
// was drawn instead of having to read refs/db-review-active by hand -- and learns that
// a retry would draw a SECOND reviewer.
function finalizeReviewMutexPreservingResult(ownerSha,io,completed){
  try{return finalizeReviewMutex(ownerSha,io)}
  catch(error){
    if(completed===undefined||completed===null)throw error
    const preserved=new LaneError(`${error.message}; THE OPERATION ITSELF COMPLETED -- do not retry it, a retry would repeat a draw that already succeeded. Its result: ${JSON.stringify(completed)}`)
    preserved.completedResult=completed
    throw preserved
  }
}
function finalizeReviewMutex(ownerSha,io){
  const previous=reviewWireBudget?.cleanup
  if(reviewWireBudget)reviewWireBudget.cleanup=true
  try{
    if(io.atomicReviewMutexRelease){
      if(reviewWireBudget)reviewWireBudget.releaseProofAllowance=MUTEX_RELEASE_READBACK_DELAYS_MS.length+2
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      io.atomicReviewMutexRelease(ownerSha)
      // Issue #3187: the atomic deletion was accepted against ownerSha, so release is proved once
      // the ref no longer names OUR owner commit. A rival acquiring it inside the readback window
      // (seen live on #3192) is still a proved release; a lagging read is re-read, never assumed.
      // Issues #2457/#2844: the readback above is served by a git replica that has been
      // seen lagging the accepted deletion by several seconds, which reported a SUCCESSFUL
      // assignment as RECOVERY REQUIRED against a mutex that was already gone. The refusal
      // is kept -- an orphaned mutex must never be assumed released -- but the readback now
      // waits on the same bounded ladder releaseOwnedRef uses, and an answer that still
      // names our owner commit is confirmed once against GitHub's ref API before refusing,
      // because that read does not come from the lagging git replica.
      let released=false
      for(const delay of MUTEX_RELEASE_READBACK_DELAYS_MS){
        if(delay)(io.wait ?? ((ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)))(delay)
        released=io.readReviewRefs([MUTEX_REF]).get(MUTEX_REF)!==ownerSha
        if(released)break
      }
      if(!released&&typeof io.readRefOverApi==='function')released=io.readRefOverApi(MUTEX_REF)!==ownerSha
      if(!released)throw new LaneError(`release of ${MUTEX_REF} could not be proved after atomic deletion`)
      return true
    }
    return releaseOwnedRef(MUTEX_REF,ownerSha,io)
  }catch(error){throw new LaneError(`${error.message}; RECOVERY REQUIRED: ${MUTEX_REF} expected SHA ${ownerSha}. Use the guarded recover-author-mutex.yml procedure and do not retry blindly`)}
  finally{if(reviewWireBudget){reviewWireBudget.cleanup=previous;reviewWireBudget.releaseProofAllowance=0}}
}
function requireReviewWireCapacity(required,when='refused before mutex acquisition'){const limit=reviewWireBudget?.limit??REVIEW_OPERATION_REQUEST_LIMIT;if(reviewWireBudget&&reviewWireBudget.count+required>limit)throw new LaneError(`reviewer operation cannot fit ${required} remaining requests inside the ${limit}-request budget; ${when}`)}
function acquireReviewMutex(ownerSha,io){
  if(reviewWireBudget){reviewWireBudget.cleanupReserve=io.atomicReviewMutexRelease?2:8;reviewWireBudget.locked=true}
  io.__requireReviewQuota?.()
  primedReviewStates=new Map()
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
export function listDurableVerdictRefs(io,{fresh=false}={}){
  if(!fresh)return readDurableVerdictRefs(io)
  if(freshDurableVerdictRefs)return freshDurableVerdictRefs
  const rows=typeof io?.__freshDurableVerdictRefs==='function'?io.__freshDurableVerdictRefs():readDurableVerdictRefs(io)
  if(!Array.isArray(rows))throw new LaneError('durable reviewer verdict refs are unreadable; a verdict can only be proved by its create-only artifact, never by comment text')
  if(reviewWireBudget)freshDurableVerdictRefs=rows
  return rows
}
export function activityFingerprintForLease(lease,io,{freshPr=false,ownStartOnly=false}={}){
  if(typeof io?.readLeaseActivity!=='function')throw new LaneError('reviewer activity is unreadable; silence cannot be observed')
  const pr=freshPr&&typeof io.__freshGetPr==='function'?io.__freshGetPr(lease.pr):reviewWireBudget&&typeof io.readPrWithReviewContext==='function'?io.readPrWithReviewContext(lease.pr):io.getPr(lease.pr)
  if(!pr?.state||!pr?.head?.sha)throw new LaneError('reviewer PR activity is unreadable; silence cannot be observed')
  if(ownStartOnly){
    const facts={issue:Number(lease.issue),pr:Number(lease.pr),headSha:String(lease.headSha).toLowerCase(),slot:Number(lease.slot??1),sequence:Number(lease.sequence),prState:String(pr.state).toLowerCase(),currentHead:String(pr.head.sha).toLowerCase(),draft:pr.draft===true,verdictPresent:hasVerdictForHead(lease.issue,lease.pr,lease.headSha,io,leaseVerdictOptions(lease)),activity:OWN_START_ONLY_ACTIVITY}
    return {fingerprint:createHash('sha256').update(canonicalJson(facts)).digest('hex'),lastActivityIso:OWN_START_ONLY_ACTIVITY,facts}
  }
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

function probeSilentReviewerOperation(options,now,io){
  io=reviewOperationIo(io)
  let resolved
  try{resolved=resolveSilentLease(options,io)}
  catch(error){
    // A resumed start-watch dispatch re-runs the probe after its own reclaim removed the lease.
    // Only on that failure path, pay one read to report the existing probe as already done.
    if(options.unstarted===true&&error instanceof LaneError){
      let probed=null
      try{probed=io.readRef(silenceProbeRef({issue:Number(options.issue),pr:Number(options.pr),headSha:String(options.headSha??'').toLowerCase(),sequence:Number(options.failedSequence)}))}catch{}
      if(probed)throw new LaneError('reviewer silence probe already exists and is immutable')
    }
    throw error
  }
  // Budget (issue #2075 rule): the unstarted probe is the reclaim's measured 14-request
  // pre-mutex half minus the reclaim-only reads, plus ONE marker readRef below -- at most 15
  // of REVIEW_OPERATION_REQUEST_LIMIT=25. The failure-path read above never runs on success.
  const {request,original,lease}=resolved,probeRef=silenceProbeRef(request)
  if(io.readRef(probeRef))throw new LaneError('reviewer silence probe already exists and is immutable')
  const pr=io.getPr(request.pr)
  if(pr?.state!=='open'||pr?.head?.sha!==request.headSha||hasVerdictForHead(request.issue,request.pr,request.headSha,io,{slot:request.slot}))throw new LaneError('silence probe requires a live lease at the exact open PR head')
  const age=reviewLeaseAgeHours(lease.heldSince,now),unstarted=options.unstarted===true,minAge=unstarted?UNSTARTED_MIN_AGE_HOURS:SILENCE_MIN_AGE_HOURS
  if(age===null||age<minAge)throw new LaneError(unstarted?'unstarted probe requires a lease at least 10 minutes old':`silence probe requires a lease at least ${SILENCE_MIN_AGE_HOURS} hours old`)
  const heldSince=lease.heldSince
  if(unstarted&&reviewStartMarkerPresent({...lease,sequence:request.sequence,slot:request.slot},io))throw new LaneError('unstarted probe refused because the review has a durable start marker')
  const observed=activityFingerprintForLease({...lease,slot:request.slot},io,{ownStartOnly:unstarted})
  if(!unstarted&&observed.lastActivityIso!=='none'&&Date.parse(observed.lastActivityIso)>Date.parse(heldSince))throw new LaneError('silence probe refused because reviewer activity occurred after the lease was drawn')
  const message=`db-coordination reviewer-silence-probe reviewer=${original.reviewer} issue=${request.issue} pr=${request.pr} head=${request.headSha} sequence=${request.sequence} slot=${request.slot} observed-at=${new Date(now).toISOString()} lease-held-since=${new Date(heldSince).toISOString()} last-activity=${observed.lastActivityIso} fingerprint=${observed.fingerprint}`
  const sha=io.makeOwnerCommit(message)
  if(!io.createRef(probeRef,sha)||io.readRef(probeRef)!==sha)throw new LaneError('reviewer silence probe create-only write could not be proved')
  return {...request,reviewer:original.reviewer,probeRef,probeSha:sha,...observed}
}

export function probeSilentReviewer(options,now=new Date(),io=githubIo){return withReviewRequestBudget(()=>probeSilentReviewerOperation(options,now,io))}

function reclaimSilentReviewerOperation(options,now,io){
  if(!options.confirmNoVerdict||!options.confirmNoArtifact)throw new LaneError('silent reviewer reclaim requires explicit confirmation that the session produced no verdict and no artifact')
  io=reviewOperationIo(io)
  let resolved
  try{resolved=resolveSilentLease(options,io)}
  catch(error){
    // A retry after a completed unstarted reclaim finds no lease. Only then pay one read to
    // tell "already reclaimed" apart from any other refusal; the happy path costs nothing.
    if(options.unstarted===true&&error instanceof LaneError){
      let released=null
      try{released=io.readRef(silenceReleaseRef({issue:Number(options.issue),pr:Number(options.pr),headSha:String(options.headSha??'').toLowerCase(),sequence:Number(options.failedSequence),slot:Number(options.slot??1)}))}catch{}
      if(released)throw new LaneError('silent reviewer lease was already reclaimed with immutable evidence')
    }
    throw error
  }
  const {request,original,leaseRef,leaseSha}=resolved,probeRef=silenceProbeRef(request),releaseRef=silenceReleaseRef(request),probeSha=io.readRef(probeRef)
  if(!probeSha)throw new LaneError('silent reviewer reclaim requires an immutable prior silence probe')
  if(io.readRef(releaseRef))throw new LaneError('silent reviewer lease was already reclaimed with immutable evidence')
  const probe=parseSilenceProbe(io.getCommit(probeSha))
  if(probe.issue!==request.issue||probe.pr!==request.pr||probe.headSha!==request.headSha||probe.sequence!==request.sequence||probe.slot!==request.slot||probe.reviewer!==original.reviewer)throw new LaneError('silence probe does not match the exact active lease')
  const probeAge=reviewLeaseAgeHours(probe.observedAt,now),unstarted=options.unstarted===true
  if(unstarted){const leaseAge=reviewLeaseAgeHours(probe.leaseHeldSince,now);if(probeAge===null||leaseAge===null||leaseAge<UNSTARTED_MIN_AGE_HOURS)throw new LaneError('unstarted reclaim requires a lease at least 10 minutes old')}
  else if(probeAge===null||probeAge<SILENCE_CONFIRM_HOURS)throw new LaneError(`silent reviewer reclaim requires an unchanged readable probe for at least ${SILENCE_CONFIRM_HOURS} hours`)
  const observed=activityFingerprintForLease({...original,slot:request.slot},io,{ownStartOnly:unstarted})
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
    const current=resolveSilentLease(options,io),fresh=activityFingerprintForLease({...original,slot:request.slot},io,{freshPr:true,ownStartOnly:unstarted}),pr={state:fresh.facts.prState,head:{sha:fresh.facts.currentHead}}
    if(current.leaseSha!==leaseSha||pr?.state!=='open'||pr?.head?.sha!==request.headSha||hasVerdictForHead(request.issue,request.pr,request.headSha,io,{fresh:true,slot:request.slot})||fresh.fingerprint!==probe.fingerprint)throw new LaneError('silent reviewer lease or activity changed after mutex acquisition')
    // Unstarted mode claims the lease's start marker in the same atomic push: a runner that
    // already wrote it makes the push fail, and a runner that writes after finds it occupied.
    const markerRef=unstarted?reviewStartedMarkerRef({...request}):null,watched=[MUTEX_REF,releaseRef,leaseRef,...(markerRef?[markerRef]:[])]
    const locked=io.readReviewRefs(watched)
    if(markerRef&&locked.get(markerRef)!==null)throw new LaneError('unstarted reclaim refused because the review has a durable start marker')
    if(locked.get(MUTEX_REF)!==ownerSha||locked.get(releaseRef)!==null||locked.get(leaseRef)!==leaseSha)throw new LaneError('silent reviewer reclaim ownership changed after preflight')
    io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},{ref:releaseRef,expected:null,sha:releaseSha},{ref:leaseRef,expected:leaseSha,sha:null},...(markerRef?[{ref:markerRef,expected:null,sha:releaseSha}]:[])])
    const after=io.readReviewRefs(watched)
    if(after.get(MUTEX_REF)!==ownerSha||after.get(releaseRef)!==releaseSha||after.get(leaseRef)!==null||(markerRef&&after.get(markerRef)!==releaseSha))throw new LaneError('atomic silent reviewer reclaim readback mismatch')
    return {...request,reviewer:original.reviewer,probeSha,releaseSha,releasedLeaseSha:leaseSha}
  }finally{if(acquired)finalizeReviewMutex(ownerSha,io)}
}


export function reclaimSilentReviewer(options,now=new Date(),io=githubIo){return withReviewRequestBudget(()=>reclaimSilentReviewerOperation(options,now,io),REVIEW_SILENT_RECLAIM_REQUEST_LIMIT,'reclaim-silent-reviewer')}
function reapAbandonedReviewLeasesOperation(options,now,io){
  io=reviewOperationIo(io)
  const candidates=abandonedLeases(io)
  if(!options.applyRecovery||!candidates.length)return {generatedAt:new Date(now).toISOString(),applied:false,candidates:candidates.length,reaped:[],leases:candidates}
  if(typeof io.atomicReviewRefs!=='function'||typeof io.readReviewRefs!=='function')throw new LaneError('abandoned lease reap requires atomic compare-and-swap ref support')
  const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-abandoned-lease-reap-lock candidates=${candidates.length} at=${new Date(now).toISOString()}`)
  let acquired=false
  try{
    requireReviewWireCapacity(20)
    acquireReviewMutex(ownerSha,io);acquired=true;requireOwnedRef(MUTEX_REF,ownerSha,io)
    const confirmed=new Map(abandonedLeases(io).map((row)=>[row.ref,row]))
    const reap=candidates.filter((row)=>confirmed.get(row.ref)?.sha===row.sha)
    const reaped=[]
    for(let index=0;index<reap.length;index+=REVIEW_REAP_BATCH){
      const batch=reap.slice(index,index+REVIEW_REAP_BATCH)
      io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},...batch.map((row)=>({ref:row.ref,expected:row.sha,sha:null}))])
      const after=io.readReviewRefs([MUTEX_REF,...batch.map((row)=>row.ref)])
      if(after.get(MUTEX_REF)!==ownerSha||batch.some((row)=>after.get(row.ref)!==null))throw new LaneError(`abandoned lease reap readback mismatch after ${reaped.length} releases`)
      reaped.push(...batch)
    }
    return {generatedAt:new Date(now).toISOString(),applied:true,candidates:candidates.length,skippedChanged:candidates.length-reap.length,reaped,leases:candidates}
  }finally{if(acquired)finalizeReviewMutex(ownerSha,io)}
}
export function reapAbandonedReviewLeases(options={},now=new Date(),io=githubIo){return withReviewRequestBudget(()=>reapAbandonedReviewLeasesOperation(options,now,io),REVIEW_REAP_REQUEST_LIMIT,'reap-abandoned-review-leases')}
export function archiveOldReviewVerdicts(options={},now=new Date(),io=githubIo){
  const pulls=readPullStateMap(io)
  const scan=verdictArchiveScan(io,pulls,new Date(now).getTime())
  const report={generatedAt:new Date(now).toISOString(),limit:REVIEW_REF_ROW_LIMIT,total:scan.total,candidates:scan.candidates.length,archiveReasons:countReasons(scan.candidates),kept:scan.kept}
  // Issue #3806: a scheduled run passes archiveThreshold so it archives only once the
  // namespace has grown past it, well before the REVIEW_REF_ROW_LIMIT refusal.
  const threshold=options.archiveThreshold
  if(threshold!==undefined&&!(Number.isInteger(threshold)&&threshold>=0&&threshold<REVIEW_REF_ROW_LIMIT))throw new LaneError(`--archive-threshold must be an integer from 0 to ${REVIEW_REF_ROW_LIMIT-1}`)
  const belowThreshold=threshold!==undefined&&scan.total<=threshold
  if(threshold!==undefined)report.threshold=threshold
  if(!options.applyRecovery||!scan.candidates.length||belowThreshold)return {...report,applied:false,archived:0,remaining:scan.total,...(belowThreshold?{skipped:'below-threshold'}:{})}
  if(typeof io.atomicReviewRefs!=='function'||typeof io.readReviewRefs!=='function')throw new LaneError('verdict archive requires atomic compare-and-swap ref support')
  const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-verdict-archive-lock candidates=${scan.candidates.length} at=${new Date(now).toISOString()}`)
  let acquired=false
  try{
    acquireReviewMutex(ownerSha,io);acquired=true;requireOwnedRef(MUTEX_REF,ownerSha,io)
    // Re-prove under the mutex: a reopened pull request, a new active lease, or a
    // verdict ref that moved since the preview is skipped, never archived.
    // The pull request state map is re-read here, never reused from the preview:
    // a PR closed unmerged before the lock can be reopened and merged with
    // migrations before it, and its verdict is then promotion evidence (#2992 review).
    const reopened=new Set((typeof io.openPulls==='function'?io.openPulls():[]).map((row)=>Number(row.number)))
    const fresh=new Map([...readPullStateMap(io)].map(([pr,row])=>[pr,reopened.has(pr)?{...row,state:'open'}:row]))
    const confirmed=new Map(verdictArchiveScan(io,fresh,new Date(now).getTime()).candidates.map((row)=>[row.ref,row]))
    const move=scan.candidates.filter((row)=>confirmed.get(row.ref)?.sha===row.sha)
    const archived=[]
    for(let index=0;index<move.length;index+=REVIEW_VERDICT_ARCHIVE_BATCH){
      const batch=move.slice(index,index+REVIEW_VERDICT_ARCHIVE_BATCH)
      io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},...batch.flatMap((row)=>[{ref:row.archiveRef,expected:null,sha:row.sha},{ref:row.ref,expected:row.sha,sha:null}])])
      const after=io.readReviewRefs([MUTEX_REF,...batch.flatMap((row)=>[row.ref,row.archiveRef])])
      if(after.get(MUTEX_REF)!==ownerSha||batch.some((row)=>after.get(row.ref)!==null||after.get(row.archiveRef)!==row.sha))throw new LaneError(`verdict archive readback mismatch after ${archived.length} archived verdicts; every archived object remains under ${REVIEW_ARCHIVED_VERDICT_REF_PREFIX}`)
      archived.push(...batch)
    }
    return {...report,applied:true,archived:archived.length,skippedChanged:scan.candidates.length-move.length,remaining:scan.total-archived.length}
  }finally{if(acquired)finalizeReviewMutex(ownerSha,io)}
}
// Issue #3027 Step 7: the governed runner re-checks, AFTER writing its start marker and
// before launching the provider, that its exact lease is still held. A start-watch reclaim
// that listed markers just before the marker landed has then already removed the lease, and
// the runner refuses to start. Unreadable leases throw: an unknown lease never starts a review.
export function reviewLeaseStillHeld(request,io=githubIo){
  const busy=findBusyReviewers(reviewOperationIo(io),[],{keepUnreadableLeases:true})
  if(!busy)throw new LaneError('active reviewer leases are unreadable; review start refused')
  // Returns the exact held lease (with its draw sequence) or null.
  const staleRefs=new Set((busy.stale??[]).map((row)=>row.ref))
  const hit=[...(busy.byAssignment?.values()??[])].find(({lease,ref})=>!staleRefs.has(ref)&&Number(lease.issue)===Number(request.issue)&&Number(lease.pr)===Number(request.pr)&&String(lease.headSha).toLowerCase()===String(request.headSha).toLowerCase()&&Number(lease.slot??1)===Number(request.slot??1)&&(!request.reviewer||lease.reviewer===request.reviewer)&&(request.sequence===undefined||Number(lease.sequence)===Number(request.sequence)))
  return hit?{...hit.lease,slot:Number(hit.lease.slot??1)}:null
}
export function reviewerStartWatchLeases(io=githubIo,now=new Date(),minAgeHours=UNSTARTED_MIN_AGE_HOURS){return withReviewRequestBudget(()=>reviewerStartWatchLeasesOperation(reviewOperationIo(io),now,minAgeHours),REVIEW_CAPACITY_REQUEST_LIMIT)}

export function reviewerCapacityReport(io=githubIo,now=new Date()){return withReviewRequestBudget(()=>reviewerCapacityReportOperation(reviewOperationIo(io),now),REVIEW_CAPACITY_REQUEST_LIMIT)}

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

function assertReviewRequestEligible(request,states,io){
  if(!states)return null
  const state=states?.get(`${request.issue}:${request.pr}`),issue=state?.issue??io.getIssue(request.issue),pr=state?.pr??io.getPr(request.pr)
  if(!reviewIssueEligible(issue,pr,io)||!reviewTargetEligible(pr,io)||pr?.head?.sha!==request.headSha)throw new LaneError(`review assignment issue, PR head, or merge eligibility changed after mutex acquisition${reviewEligibilityCause(request,issue,pr)}`)
  return state
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

function assignNextReviewerOperation({issue,pr,headSha,slot=1,reviewerAllowlist=null,admissionOptions=null},io){
  const headPattern=io?.requiresExactReviewHeadSha?/^[0-9a-f]{40}$/i:/^[0-9a-f]{7,40}$/i
  if(!Number.isInteger(Number(issue))||!Number.isInteger(Number(pr))||!headPattern.test(String(headSha??'')))throw new LaneError('review assignment requires issue, PR, and exact 40-character head SHA')
  if(!Number.isInteger(Number(slot))||Number(slot)<1)throw new LaneError('review assignment slot must be a positive integer (1 = first reviewer, 2 = second independent reviewer)')
  io=reviewOperationIo(io)
  let requestedAllowlist=canonicalReviewerAllowlist(reviewerAllowlist)
  // REF NAMES ARE LOWERCASE. GitHub SHAs arrive lowercase, but every resolver
  // and ref builder below must agree on the case or a peer slot silently
  // vanishes from the independence set (the head-SHA normalization gap the
  // #3429 review named). Normalize once at the request boundary.
  const request={issue:Number(issue),pr:Number(pr),headSha:String(headSha).toLowerCase(),slot:Number(slot),...(requestedAllowlist?{reviewerAllowlist:requestedAllowlist}:{})}
  const concurrentLeases=Boolean(io.requiresExactReviewHeadSha)
  const {eligible,unusable}=allocatableReviewers(io)
  let effectiveAllowlist=requestedAllowlist,eligibleNames=new Set(eligible.filter((row)=>reviewerAllowed(row.name,effectiveAllowlist)).map((row)=>row.name))
  // Slot >=2 needs a name to exclude BEFORE the mutex is taken: cheap, and it
  // lets an ungoverned "assign slot 2 with no slot 1" request fail fast.
  //
  // This branch reached the same slot-2 defect from the other side and moved
  // this resolve INSIDE the lock. #1813 fixed it by raising the ceiling instead,
  // and its REVIEW_MUTEX_SECTION_RESERVE is derived assuming the resolve is paid
  // here, pre-mutex. Two fixes for one defect is worse than either, so this
  // branch defers to the merged one: the resolve stays here, and the reserve is
  // #1813's (issue #1798 round 3 / issue #1812).
  const {slotOne,peers:otherSlots}=resolvePeerSlots(request.issue,request.pr,request.headSha,request.slot,io)
  const excludedProviders=new Set([slotOne?.reviewer,...[...otherSlots.values()].map((row)=>row.reviewer)].filter(Boolean))
  if(slotOne)requestedAllowlist=inheritReviewerAllowlist(requestedAllowlist,slotOne.reviewerAllowlist)
  const preflightBusy=findBusyReviewers(io)
  if(!preflightBusy)throw new LaneError('active reviewer leases are unreadable; reviewer assignment refused before mutex acquisition')
  const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-assignment-lock issue=${request.issue} pr=${request.pr} head=${request.headSha}${request.slot!==1?` slot=${request.slot}`:''}`)
  requireReviewWireCapacity(REVIEW_MUTEX_SECTION_RESERVE)
  acquireReviewMutex(ownerSha,io)
  let completedResult=null
  try{
    // Owner ruling 2026-10-02 (docs/owner-rulings.md, "One reviewer may be used
    // twice"): only on a MERGED pull request's post-merge slot >= 2.
    let mergedReuseMemo=null
    const mergedReuse=()=>mergedReuseMemo??=mergedPrReviewerReuseAllowed(request,io)
    const assertDistinct=(reviewer)=>{
      if(mergedReuse())return
      const {slotOne:first,peers}=resolvePeerSlots(request.issue,request.pr,request.headSha,request.slot,io)
      if(first?.reviewer===reviewer||[...peers.values()].some((row)=>row.reviewer===reviewer))throw new LaneError(`reviewer ${reviewer} already holds another review slot for this exact head; this slot cannot be assigned or retried. If the conflicting slot has no verdict or artifact, use --replace-failed-reviewer with --failure-code ${SLOT_INDEPENDENCE_CONFLICT} and its current sequence.`)
    }
    if(admissionOptions)requirePrOperationRoute(admissionOptions,io,{pr,headSha,issue,mutexOwner:ownerSha,allowMerged:true,reviewSnapshot:true})
    const exclusions=reviewerExclusions(request.issue,request.pr,io,{fresh:true})
    const returnedPolicy=exclusions.hasRecordedExclusions?inheritReturnedReviewerAllowlist(requestedAllowlist,request,io):null
    if(returnedPolicy)requestedAllowlist=returnedPolicy.allowlist
    effectiveAllowlist=requestedAllowlist
    if(effectiveAllowlist)request.reviewerAllowlist=effectiveAllowlist
    eligibleNames=new Set(eligible.filter((row)=>reviewerAllowed(row.name,effectiveAllowlist)).map((row)=>row.name))
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
      const originalSha=io.readRef(assignmentRef),initial=originalSha?parseReviewCursor(io.getCommit(originalSha)):null
      if(initial&&(initial.issue!==request.issue||initial.pr!==request.pr||initial.headSha!==request.headSha||(initial.slot??1)!==request.slot))throw new LaneError('durable reviewer assignment does not match the assignment request')
      assertReviewerAllowlistConsistency([initial,...replacements,returnedPolicy?.found?{reviewerAllowlist:returnedPolicy.allowlist}:null])
      const replacement=replacements.sort((a,b)=>b.sequence-a.sequence)[0], reviewer=REVIEWERS.find((r)=>r.name===replacement.reviewer)
      effectiveAllowlist=inheritReviewerAllowlist(requestedAllowlist,replacement.reviewerAllowlist)
      eligibleNames=new Set(eligible.filter((row)=>reviewerAllowed(row.name,effectiveAllowlist)).map((row)=>row.name))
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
      assertDistinct(replacement.reviewer)
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
      effectiveAllowlist=inheritReviewerAllowlist(requestedAllowlist,prior.reviewerAllowlist)
      eligibleNames=new Set(eligible.filter((row)=>reviewerAllowed(row.name,effectiveAllowlist)).map((row)=>row.name))
      // Same deliberate refusal as the replacement branch above: the assignment
      // path never retires a slot itself. See the comment there.
      if(exclusions.has(prior.reviewer))throw new LaneError(`durable assignment reviewer ${prior.reviewer} is excluded for this PR (${exclusions.get(prior.reviewer).reason}); re-run the identical --exclude-reviewer to return this slot, then re-run this --assign-reviewer to draw a fresh reviewer for it.`)
      assertDistinct(prior.reviewer)
      const retryStates=io.readReviewStates?.([prior,...(stalePrior?[stalePrior.assignment]:[])])
      assertReviewRequestEligible(request,retryStates,io)
      // Eligibility is re-checked on EVERY retry return below, not only the
      // first one reached: the orchestrator engine backing a retry can differ
      // from the one that made the original assignment (a concurrent
      // orchestrator, or the same one switching engines), so a provider that
      // was independent when assigned can become a same-provider conflict by
      // the time a retry lands here. Every return path below must fail the
      // same way a fresh assignment would, never hand back a stale answer.
      if(!eligibleNames.has(prior.reviewer))throw new LaneError(`durable assignment sequence ${prior.sequence} belongs to a retired, quarantined or orchestrator-conflicting reviewer ${prior.reviewer}; its active lease was not recreated. Record a governed replacement for this exact head. If ${prior.reviewer} is only quarantined (not retired) and already recorded a substantive exact-head verdict, that verdict still counts once the quarantine is cleared: run ai-review-preflight clear (or requalify) for the provider and re-run this check; do not attempt replacement or release while that verdict exists — both refuse by design and must never delete or forge refs.`)
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
      effectiveAllowlist=inheritReviewerAllowlist(requestedAllowlist,current.reviewerAllowlist)
      eligibleNames=new Set(eligible.filter((row)=>reviewerAllowed(row.name,effectiveAllowlist)).map((row)=>row.name))
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
        :`current reviewer cursor sequence ${current.sequence} belongs to a retired, quarantined or orchestrator-conflicting reviewer ${current.reviewer}; no assignment was recorded and no lease was taken. Record a governed replacement for this exact head. If ${current.reviewer} is only quarantined (not retired) and already recorded a substantive exact-head verdict, that verdict still counts once the quarantine is cleared: run ai-review-preflight clear (or requalify) for the provider and re-run this check; do not attempt replacement or release while that verdict exists — both refuse by design and must never delete or forge refs.`)
      assertDistinct(current.reviewer)
      assertAssignmentWasNotTerminallyReleased(request,current,io)
      if(!io.createRef(assignmentRef,cursorSha)&&readRefAfterWrite(assignmentRef,cursorSha,io)!==cursorSha)throw new LaneError('review assignment record could not be proved; retry the same assignment')
      const live=io.getPr(current.pr)
      if(reviewTargetEligible(live,io)&&live?.head?.sha===current.headSha&&!hasVerdictForHead(current.issue,current.pr,current.headSha,io,{slot:request.slot})){
        if(eligibleNames.has(current.reviewer)){
          const leaseRef=reviewLeaseRefForAssignment({...current,slot:request.slot},concurrentLeases),existing=io.readRef(leaseRef)
          if(existing!==cursorSha&&(!io.createRef(leaseRef,cursorSha)||readRefAfterWrite(leaseRef,cursorSha,io)!==cursorSha))throw new LaneError(`reviewer ${current.reviewer} has a conflicting active lease`)
        }
      }
      // #2831: never re-serve an assignment whose wrapper cannot emit a governed verdict.
      if(!reviewerEmitsGovernedVerdict(current.reviewer))throw new LaneError(`reviewer ${current.reviewer} is assigned to this head but its wrapper cannot emit the governed VERDICT line. Draw another reviewer with the exact command: ${nonVerdictReviewerReplacementCommand({issue:current.issue,pr:current.pr,headSha:current.headSha,slot:request.slot},current.sequence)}`)
      return {...current,slot:request.slot,wrapper:REVIEWERS.find((r)=>r.name===current.reviewer)?.wrapper}
    }
    assertPaidReviewCapacity(request,io)
    const sequence=(current?.sequence??0)+1
    // Ordinary path: rotate within the preferred pool. Grok is considered after
    // that pool for this exact assignment (#3592). The durable sequence remains
    // monotone; a fallback draw advances the next preferred starting position by one.
    // Slot >=2 additionally excludes whoever slot 1 already holds for this
    // exact head, so the second reviewer is never the same provider as the
    // first -- on top of, never instead of, the ordinary busy exclusion.
    const busy=preflightBusy
    // Provider capacity is deliberately not a draw constraint for the exact
    // production protocol.  Lightweight historical fixtures may use short
    // heads, which cannot name a parallel lease and retain old serial rules.
    // #2831: a reviewer whose wrapper cannot emit a governed verdict is never drawn.
    const notTaken=(row)=>eligibleNames.has(row.name)&&reviewerEmitsGovernedVerdict(row.name)&&(concurrentLeases||!busy.has(row.name))&&!excludedProviders.has(row.name)&&!exclusions.has(row.name)
    const rotation=drawOrder(sequence,io)
    // Owner ruling 2026-10-02: when no independent reviewer is left for a merged
    // PR's post-merge slot >= 2, reuse one that already holds another slot on
    // this exact head. Every other exclusion still applies; same rotation order.
    const notTakenReuse=(row)=>eligibleNames.has(row.name)&&reviewerEmitsGovernedVerdict(row.name)&&(concurrentLeases||!busy.has(row.name))&&!exclusions.has(row.name)
    const reviewer=rotation.find(notTaken)??OVERFLOW_REVIEWERS.find(notTaken)??(mergedReuse()?rotation.find(notTakenReuse)??OVERFLOW_REVIEWERS.find(notTakenReuse):undefined)
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
        if(!reviewerAllowed(name,effectiveAllowlist))return 'outside the durable task-local reviewer allowlist'
        if(unusable.has(name)){const state=unusable.get(name);return `unusable by ai-review-preflight (${state.status??state.failure_class??'unavailable'})`}
        if(!eligibleNames.has(name))return 'conflicts with the live orchestrator engine, or is retired or quarantined'
        if(!reviewerEmitsGovernedVerdict(name))return 'its wrapper cannot emit the governed VERDICT line (#2831)'
        if(!concurrentLeases&&busy.has(name))return 'already holds a live review lease (serial-lease protocol)'
        if(excludedProviders.has(name))return `already holds another review slot for this exact head`
        if(exclusions.has(name))return `durably excluded for this PR (${exclusions.get(name).reason})`
        return 'unavailable for an unrecorded reason'
      }
      const detail=[...ACTIVE_REVIEWERS,...OVERFLOW_REVIEWERS].map((row)=>`${row.name} ${refusalFor(row.name)}`).join('; ')
      throw new LaneError(`${request.slot===1?'no reviewer is available':`no independent reviewer is available for slot ${request.slot}`}: ${detail}.`)
    }
    const assignmentSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${sequence} reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha}${request.slot!==1?` slot=${request.slot}`:''}${reviewerAllowlistSuffix(effectiveAllowlist)}`)
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
        assertDistinct(reviewer.name)
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
        return completedResult={sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request}
      }
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      assertDistinct(reviewer.name)
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
      return completedResult={sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request}
    }catch(error){
      const rollback=[]
      try{if(assignmentCreated&&io.readRef(assignmentRef)===assignmentSha)releaseOwnedRef(assignmentRef,assignmentSha,io)}catch(e){rollback.push(e.message)}
      try{if(cursorChanged&&io.readRef(REVIEW_CURSOR_REF)===assignmentSha){if(cursorSha){io.updateRef(REVIEW_CURSOR_REF,cursorSha);if(readRefAfterWrite(REVIEW_CURSOR_REF,cursorSha,io)!==cursorSha)throw new LaneError('cursor rollback could not be proved')}else releaseOwnedRef(REVIEW_CURSOR_REF,assignmentSha,io)}}catch(e){rollback.push(e.message)}
      try{if(leaseCreated&&io.readRef(leaseRef)===leaseSha)releaseOwnedRef(leaseRef,leaseSha,io)}catch(e){rollback.push(e.message)}
      try{if(staleReleased&&!io.readRef(leaseRef)&&!io.createRef(leaseRef,selectedStale.sha))throw new LaneError('stale reviewer lease rollback could not be proved')}catch(e){rollback.push(e.message)}
      if(rollback.length)throw new LaneError(`review assignment failed (${error.message}) and rollback was incomplete: ${rollback.join('; ')}`)
      throw error
    }
  }finally{finalizeReviewMutexPreservingResult(ownerSha,io,completedResult)}
}

export function assignNextReviewer(request,io=githubIo){
  const normalized={...request,issue:Number(request.issue),pr:Number(request.pr),slot:Number(request.slot??1),headSha:String(request.headSha??'')}
  if(!io.enableReviewerQueue)return withReviewRequestBudget(()=>assignNextReviewerOperation(normalized,reviewOperationIo(io)))
  return withReviewRequestBudget(()=>{const operationIo=reviewOperationIo(io),ticket=ensureReviewerQueueTurn(normalized,operationIo);try{return assignNextReviewerOperation(normalized,operationIo)}finally{finishReviewerQueueTurn(ticket,operationIo)}},REVIEW_QUEUE_ASSIGNMENT_REQUEST_LIMIT)
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
    assertClaimNotRetired(lease.version,'superseded',io)
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
  }finally{releaseMutexOnExit(ownerSha,io)}
}

export const reversionActiveClaim=supersedeActiveClaimVersion
export function rebindClaimWorktree(options,now=new Date(),io=githubIo){
  const request={issue:Number(options.issue),claim:Number(options.claim),pr:Number(options.pr),owner:String(options.owner??''),branch:String(options.branch??''),worktree:String(options.worktree??''),targetWorktree:String(options.targetWorktree??''),headSha:String(options.headSha??'')}
  if(!Number.isInteger(request.issue)||request.issue<=0||!Number.isInteger(request.claim)||request.claim<=0||!Number.isInteger(request.pr)||request.pr<=0||!request.owner||!request.branch||!request.worktree||!request.targetWorktree||!/^[0-9a-f]{40}$/.test(request.headSha))throw new LaneError('claim worktree rebind requires exact issue, claim, PR, owner, branch, current worktree, target worktree, and 40-character lowercase head')
  if(/[\r\n`]/.test(request.targetWorktree)||request.targetWorktree!==request.targetWorktree.trim())throw new LaneError('target worktree path contains a forbidden character')
  if(/[\s`]/.test(request.branch))throw new LaneError('claim branch contains a forbidden character')
  if(normalizeWorktreePath(request.worktree)===normalizeWorktreePath(request.targetWorktree))throw new LaneError('target worktree must differ from the recorded claim worktree')
  const verifyTarget=()=>{
    if(!io.localClean(request.targetWorktree))throw new LaneError('target worktree is absent or dirty')
    if(io.localHead(request.targetWorktree)!==request.headSha)throw new LaneError('target worktree is not at the exact PR head')
    if(typeof io.localBranch!=='function'||io.localBranch(request.targetWorktree)!==request.branch)throw new LaneError('target worktree is not on the claim branch')
  }
  const verifyPr=()=>{const pr=io.getPr(request.pr);if(pr?.state!=='open'||pr.head?.sha!==request.headSha||pr.head?.ref!==request.branch)throw new LaneError('open PR exact head or branch changed')}
  const proveOwnership=(claim)=>{
    if(claim?.state!=='open'||Number(claim.number)!==request.claim)throw new LaneError(`claim #${request.claim} is not open`)
    if(workstreamKey(claim.title)!==`#${request.issue}`)throw new LaneError(`claim title does not identify exact issue #${request.issue}: ${JSON.stringify(claim.title??'')}`)
    const lease=parseAuthorLease(claim.body,now)
    if(lease.legacy)throw new LaneError('legacy claim leases cannot be rebound')
    if(lease.owner!==request.owner)throw new LaneError('claim owner changed')
    if(lease.branch!==request.branch)throw new LaneError('claim branch changed')
    assertClaimNotRetired(lease.version,'rebound',io)
    return lease
  }
  const current=io.getIssue(request.claim),currentLease=proveOwnership(current),ref=claimWorktreeRebindRef(request.claim,currentLease.version,request.targetWorktree)
  // The evidence ref is keyed by the NORMALIZED target while its digests hash the exact
  // spelling, so a case or slash variant of an already-bound target is refused by name
  // here instead of surfacing as a confusing digest mismatch.
  if(currentLease.worktree!==request.targetWorktree&&normalizeWorktreePath(currentLease.worktree)===normalizeWorktreePath(request.targetWorktree))throw new LaneError('claim already names this target worktree with a different spelling; pass the exact recorded path')
  if(currentLease.worktree===request.targetWorktree){
    const priorSha=io.readRef(ref);if(!priorSha)throw new LaneError('claim already names the target worktree without durable rebind evidence')
    const prior=parseClaimWorktreeRebind(io.getCommit(priorSha))
    if(prior.issue!==request.issue||prior.claim!==request.claim||prior.pr!==request.pr||prior.version!==currentLease.version||prior.fromDigest!==sha256(request.worktree)||prior.toDigest!==sha256(request.targetWorktree))throw new LaneError('durable claim worktree rebind does not match this request')
    if(prior.headSha!==request.headSha)throw new LaneError(`claim was already rebound at head ${prior.headSha}; the PR head has since changed, so this re-run is not the recorded rebind and needs no action`)
    return {...prior,worktree:request.targetWorktree,rebindSha:priorSha,idempotent:true}
  }
  if(currentLease.worktree!==request.worktree)throw new LaneError('claim worktree changed')
  if(!currentLease.active||currentLease.declaredCapacityState!=='active')throw new LaneError('claim lease is expired or not active; renew or resume it before rebinding')
  verifyPr();verifyTarget()
  const ownerSha=io.makeOwnerCommit(`db-coordination claim-worktree-rebind issue=${request.issue} claim=${request.claim} pr=${request.pr} head=${request.headSha}`)
  acquireMutex(ownerSha,io)
  let before,bodyChanged=false,rebindSha,refCreated=false
  try{
    before=io.getIssue(request.claim);const lease=proveOwnership(before)
    if(lease.worktree!==request.worktree)throw new LaneError('claim worktree changed')
    if(!lease.active||lease.declaredCapacityState!=='active')throw new LaneError('claim lease is expired or not active; renew or resume it before rebinding')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    if(io.readRef(ref))throw new LaneError('durable rebind evidence already exists for this target but the claim does not name it')
    verifyPr()
    const versions=migrationVersions(io.getPrFiles(request.pr));if(versions.length>1||(versions.length===1&&versions[0]!==lease.version))throw new LaneError('PR migration does not match the claim version')
    verifyTarget()
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const newBody=replaceLeaseLocation(before.body,request.branch,request.targetWorktree)
    bodyChanged=true;io.updateIssue(request.claim,{body:newBody})
    const after=io.getIssue(request.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.title!==before.title||after.body!==newBody||afterLease.worktree!==request.targetWorktree||leaseWithoutWorktree(afterLease)!==leaseWithoutWorktree(lease))throw new LaneError('rebound claim exact readback failed')
    verifyPr();verifyTarget()
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    rebindSha=io.makeOwnerCommit(`db-coordination claim-worktree-rebound issue=${request.issue} claim=${request.claim} pr=${request.pr} version=${lease.version} head=${request.headSha} from-sha256=${sha256(request.worktree)} to-sha256=${sha256(request.targetWorktree)}`)
    if(!io.createRef(ref,rebindSha))throw new LaneError('durable claim worktree rebind evidence could not be created')
    refCreated=true
    if(readRefAfterWrite(ref,rebindSha,io)!==rebindSha)throw new LaneError('durable claim worktree rebind evidence could not be read back')
    return {issue:request.issue,claim:request.claim,pr:request.pr,version:lease.version,headSha:request.headSha,worktree:request.targetWorktree,rebindSha,idempotent:false}
  }catch(error){
    if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
    const failures=[]
    if(refCreated)try{if(io.readRef(ref)===rebindSha)releaseOwnedRef(ref,rebindSha,io)}catch(e){failures.push(e.message)}
    if(bodyChanged)try{io.updateIssue(request.claim,{body:before.body});if(io.getIssue(request.claim)?.body!==before.body)throw new LaneError('claim body rollback readback failed')}catch(e){failures.push(e.message)}
    if(failures.length)throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${failures.join('; ')}`)
    throw error
  }finally{releaseMutexOnExit(ownerSha,io)}
}

// #3618. Transfer an abandoned claim without releasing its object lock or version.
// The abandonment audit proves the author is unavailable. An operator adoption
// attests to a verbatim current-chat instruction; GitHub's shared login does
// not authenticate the human who wrote an issue comment.
export const CLAIM_AUTHOR_TRANSFER_REF_PREFIX='refs/db-claim-author-transfers/'
function replaceLeaseAuthor(body,owner,worktree,expiresAt){
  const fences=[...String(body).matchAll(/```db-author-lease\s*\n([\s\S]*?)```/g)]
  if(fences.length!==1)throw new LaneError('claim must contain exactly one author lease')
  const block=fences[0][1]
  if((block.match(/^owner:/gm)??[]).length!==1)throw new LaneError('claim author is ambiguous')
  const changed=block.replace(/^owner:.*$/m,`owner: ${owner}`)
  const located=body.slice(0,fences[0].index)+fences[0][0].replace(block,()=>changed)+body.slice(fences[0].index+fences[0][0].length)
  return replaceLeaseExpiry(replaceLeaseLocation(located,parseAuthorLease(located).branch,worktree),expiresAt)
}
function transferRecord(ref,io){
  const sha=io.readRef(ref);if(!sha)return null
  const prefix='db-coordination claim-author-operator-adoption '
  const message=String(io.getCommit(sha)?.message??'')
  if(!message.startsWith(prefix))throw new LaneError('operator adoption record is unreadable')
  let record
  try{record=JSON.parse(message.slice(prefix.length))}catch{throw new LaneError('operator adoption record is malformed')}
  const fields=['kind','human_identity_authenticated','issue','claim','pr','head_sha','version','old_owner','new_owner','branch','old_worktree','target_worktree','abandonment_issue','old_worktree_state','reservation_sha','authorization_chat_id','authorization_quote','recovery_artifact','lease_hours']
  if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).length!==fields.length||Object.keys(record).some((key)=>!fields.includes(key))||record.kind!=='operator-adoption'||record.human_identity_authenticated!==false||!Number.isSafeInteger(record.issue)||record.issue<=0||!Number.isSafeInteger(record.claim)||record.claim<=0||!Number.isSafeInteger(record.pr)||record.pr<=0||!Number.isSafeInteger(record.abandonment_issue)||record.abandonment_issue<=0||!/^[0-9a-f]{40}$/.test(String(record.head_sha))||!/^[0-9a-f]{40}$/.test(String(record.reservation_sha))||!/^\d{14}$/.test(String(record.version))||typeof record.old_owner!=='string'||!record.old_owner||typeof record.new_owner!=='string'||!record.new_owner||record.old_owner===record.new_owner||typeof record.branch!=='string'||!record.branch||typeof record.old_worktree!=='string'||!record.old_worktree||typeof record.target_worktree!=='string'||!record.target_worktree||normalizeWorktreePath(record.old_worktree)===normalizeWorktreePath(record.target_worktree)||!WORKTREE_STATES.includes(record.old_worktree_state)||typeof record.recovery_artifact!=='string'||typeof record.authorization_quote!=='string'||record.authorization_quote.trim().length<20||record.authorization_quote!==record.authorization_quote.trim()||!record.authorization_chat_id||!(record.lease_hours>0&&record.lease_hours<=24))throw new LaneError('operator adoption record has invalid exact fields')
  return {sha,record}
}
export function transferClaimAuthor(options,now=new Date(),io=githubIo){
  const request={issue:Number(options.issue),claim:Number(options.claim),pr:Number(options.pr),headSha:String(options.headSha??''),oldOwner:String(options.oldOwner??''),newOwner:String(options.newOwner??''),branch:String(options.branch??''),oldWorktree:String(options.worktree??''),targetWorktree:String(options.targetWorktree??''),abandonmentIssue:Number(options.abandonmentIssue),oldWorktreeState:String(options.worktreeState??''),authorizationChatId:String(options.authorizationChatId??''),authorizationQuote:String(options.authorizationQuote??''),recoveryArtifact:String(options.recoveryArtifact??''),leaseHours:Number(options.leaseHours)}
  if(![request.issue,request.claim,request.pr,request.abandonmentIssue].every((n)=>Number.isSafeInteger(n)&&n>0)||!/^[0-9a-f]{40}$/.test(request.headSha)||!request.oldOwner||!request.newOwner||request.oldOwner===request.newOwner||!request.branch||!request.oldWorktree||!request.targetWorktree||!WORKTREE_STATES.includes(request.oldWorktreeState)||!(request.leaseHours>0&&request.leaseHours<=24))throw new LaneError('author transfer requires exact issue, claim, PR, head, old/new owner, branch, old/new worktree, old worktree state, abandonment issue, and lease hours')
  if(/[\s`]/.test(request.branch))throw new LaneError('claim branch contains a forbidden character')
  if(/[\r\n`]/.test(request.newOwner+request.targetWorktree)||request.newOwner!==request.newOwner.trim()||request.targetWorktree!==request.targetWorktree.trim()||normalizeWorktreePath(request.oldWorktree)===normalizeWorktreePath(request.targetWorktree))throw new LaneError('successor identity is invalid or reuses the old worktree')
  if(!request.authorizationChatId||request.authorizationQuote.trim().length<20||request.authorizationQuote!==request.authorizationQuote.trim())throw new LaneError('operator adoption requires current-chat ID and verbatim user authorization quote')
  const proofOptions={claim:request.claim,blockedOn:`issue:#${request.abandonmentIssue}`,worktreeState:request.oldWorktreeState}
  const verify=(allowAdopted=false)=>{
    const claim=io.getIssue(request.claim),lease=parseAuthorLease(claim?.body??'',now)
    if(claim?.state!=='open'||workstreamKey(claim.title)!==`#${request.issue}`)throw new LaneError('claim is not open for the exact work issue')
    const adopted=allowAdopted&&lease.owner===request.newOwner&&lease.worktree===request.targetWorktree
    const quarantined=lease.capacityState==='relinquished'&&!lease.active&&!lease.relinquishmentMetadataLegacy
    if(lease.legacy||(!adopted&&(lease.owner!==request.oldOwner||lease.worktree!==request.oldWorktree||(lease.capacityState!=='expired-unconfirmed'&&!quarantined)))||lease.branch!==request.branch)throw new LaneError('claim is not the exact expired old-author lease')
    if(!adopted&&quarantined&&(lease.blockedOn!==proofOptions.blockedOn||lease.worktreeState!==request.oldWorktreeState||(lease.recoveryArtifact&&lease.recoveryArtifact!==request.recoveryArtifact)))throw new LaneError('quarantined claim does not match the exact abandonment blocker, worktree state or recovery artifact')
    assertClaimNotRetired(lease.version,'transferred',io)
    const issue=io.getIssue(request.issue)
    renewalIssueScope(issue,lease,[request.issue],{allowClaimSuperset:true})
    const audit=adopted?true:assertAbandonmentEvidence(proofOptions,lease,proofOptions.blockedOn,io)
    if(!audit)throw new LaneError('exact abandonment audit proof is absent')
    if(!adopted){const observed=observedWorktreeState(request.oldWorktree,io);if(observed!==request.oldWorktreeState&&!(observed==='absent'&&request.oldWorktreeState==='remote'))throw new LaneError('old worktree state differs from explicit declaration')}
    const marker=io.orchestratorFlowAdapter().resolveMarker()
    if(!marker?.live||marker.task!==request.authorizationChatId)throw new LaneError(`operator adoption chat ID does not match this declared session${marker?.live?'':`; ${sessionAuthorityRefusal(marker)}`}`)
    if(request.oldWorktreeState!=='clean')requireDereferenceableRecoveryArtifact(request.recoveryArtifact,io)
    const pr=io.getPr(request.pr)
    if(pr?.state!=='open'||pr.head?.sha!==request.headSha||pr.head?.ref!==request.branch)throw new LaneError('open PR head or branch changed')
    const versions=migrationVersions(io.getPrFiles(request.pr))
    if(versions.length!==1||versions[0]!==lease.version)throw new LaneError('PR migration does not match permanent claim version')
    const sources=io.prSources(),self=sources.filter((source)=>new RegExp(`^PR #${request.pr}(?:\\s|$)`).test(source.label))
    if(self.length!==1||self[0].branch!==request.branch||self[0].versions?.length!==1||String(self[0].versions[0])!==lease.version||!self[0].objects?.length)throw new LaneError('PR parser source is missing or ambiguous')
    const held=new Set(lease.objects.map(normalizeObject))
    if(validateClaimObjects(self[0].objects??[]).some((object)=>!held.has(object)))throw new LaneError('PR writes an object outside the claim')
    const claims=io.openClaims(),matches=claims.filter((row)=>Number(row.number)===request.claim)
    if(matches.length!==1||matches[0].body!==claim.body)throw new LaneError('target claim is missing or changed in the open-claim roster')
    if(claims.some((row)=>Number(row.number)!==request.claim&&normalizeWorktreePath(parseAuthorLease(row.body,now).worktree)===normalizeWorktreePath(request.targetWorktree)))throw new LaneError('successor worktree belongs to another open claim')
    assertRetirementIdentityAvailable({branch:'',worktree:request.targetWorktree},io)
    assertLaneAvailable(claims.filter((row)=>Number(row.number)!==request.claim),lease.objects,now,{prSources:sources.filter((source)=>source!==self[0])})
    const reservationSha=io.readRef(`refs/db-claims/${lease.version}`)
    if(!/^[0-9a-f]{40}$/.test(String(reservationSha))||!io.getCommit(reservationSha))throw new LaneError('permanent version reservation is unreadable')
    for(const [kind,ref] of Object.entries(EXCLUSIVE_REFS))if(io.readRef(ref))throw new LaneError(`cannot transfer while ${kind} stage is held`)
    if(!io.localClean(request.targetWorktree)||io.localHead(request.targetWorktree)!==request.headSha||io.localBranch(request.targetWorktree)!==request.branch)throw new LaneError('successor worktree must be clean on the claim branch at exact PR head')
    return {claim,lease,reservationSha,adopted}
  }
  const ownerSha=io.makeOwnerCommit(`db-coordination claim-author-transfer-mutex claim=${request.claim}`)
  acquireMutex(ownerSha,io)
  let bodyChanged=false,evidenceCreated=false,beforeBody=null,ref=null,transferSha=null
  try{
    const current=io.getIssue(request.claim),currentLease=parseAuthorLease(current?.body??'',now)
    const identity={issue:request.issue,claim:request.claim,pr:request.pr,head_sha:request.headSha,version:currentLease.version,old_owner:request.oldOwner,new_owner:request.newOwner,branch:request.branch,old_worktree:request.oldWorktree,target_worktree:request.targetWorktree,abandonment_issue:request.abandonmentIssue,old_worktree_state:request.oldWorktreeState}
    ref=`${CLAIM_AUTHOR_TRANSFER_REF_PREFIX}${request.claim}-${currentLease.version}-${sha256(canonicalJson(identity)).slice(0,20)}`
    const prior=transferRecord(ref,io),fresh=verify(Boolean(prior))
    if(fresh.lease.version!==identity.version)throw new LaneError('claim version changed during operator adoption')
    const record={kind:'operator-adoption',human_identity_authenticated:false,...identity,reservation_sha:fresh.reservationSha,authorization_chat_id:request.authorizationChatId,authorization_quote:request.authorizationQuote,recovery_artifact:request.recoveryArtifact,lease_hours:request.leaseHours}
    if(prior&&JSON.stringify(prior.record)!==JSON.stringify(record))throw new LaneError('existing operator adoption record differs from exact request')
    if(fresh.adopted){if(!prior)throw new LaneError('claim was adopted without immutable evidence');return {claim:request.claim,version:fresh.lease.version,owner:request.newOwner,worktree:request.targetWorktree,ref,sha:prior.sha,idempotent:true}}
    transferSha=prior?.sha
    if(!transferSha){
      transferSha=io.makeOwnerCommit(`db-coordination claim-author-operator-adoption ${JSON.stringify(record)}`)
      if(!io.createRef(ref,transferSha))throw new LaneError('immutable operator adoption record could not be created')
      evidenceCreated=true
      if(readRefAfterWrite(ref,transferSha,io)!==transferSha)throw new LaneError('immutable operator adoption record could not be read back')
    }
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    beforeBody=fresh.claim.body
    const newBody=replaceLeaseAuthor(replaceCapacityState(fresh.claim.body,'active'),request.newOwner,request.targetWorktree,new Date(now.valueOf()+request.leaseHours*3600000))
    bodyChanged=true;io.updateIssue(request.claim,{body:newBody})
    const after=io.getIssue(request.claim),newLease=parseAuthorLease(after?.body??'',now)
    if(after?.body!==newBody||newLease.owner!==request.newOwner||newLease.worktree!==request.targetWorktree||newLease.version!==fresh.lease.version||newLease.branch!==request.branch||JSON.stringify(newLease.objects)!==JSON.stringify(fresh.lease.objects)||!newLease.active||!newLease.capacityActive||newLease.capacityState!=='active')throw new LaneError('author transfer claim readback failed')
    if(io.readRef(`refs/db-claims/${fresh.lease.version}`)!==fresh.reservationSha||!io.getCommit(fresh.reservationSha))throw new LaneError('permanent version reservation changed after adoption')
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    return {claim:request.claim,version:fresh.lease.version,owner:request.newOwner,worktree:request.targetWorktree,ref,sha:transferSha,idempotent:false}
  }catch(error){
    if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
    const failures=[]
    if(bodyChanged)try{io.updateIssue(request.claim,{body:beforeBody});if(io.getIssue(request.claim)?.body!==beforeBody)throw new LaneError('claim body rollback readback failed')}catch(e){failures.push(e.message)}
    if(evidenceCreated&&/could not be read back/.test(error.message))try{if(io.readRef(ref)===transferSha)releaseOwnedRef(ref,transferSha,io)}catch(e){failures.push(e.message)}
    if(failures.length)throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${failures.join('; ')}`)
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
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
    assertClaimNotRetired(lease.version,'reissued',io)
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
  }finally{releaseMutexOnExit(ownerSha,io)}
}

export function releaseFailedReviewer(options,io=githubIo){
  return withReviewRequestBudget(()=>{
    io=reviewOperationIo(io)
    const request=validateTerminalReviewerFailure(options,'reviewer release')
    request.headSha=String(request.headSha).toLowerCase()
    const failureRef=reviewerFailureRef(request)
    const original=resolveFailedReviewRecord(request,io),priorFailureSha=io.readRef(failureRef)
    if(priorFailureSha){
      const priorCommit=io.getCommit(priorFailureSha),prior=parseTerminalFailureEvidence(priorCommit)
      if(prior.issue!==request.issue||prior.pr!==request.pr||prior.headSha!==request.headSha||prior.failedSequence!==request.failedSequence||prior.reviewer!==original.reviewer||prior.failureCode!==String(options.failureCode))throw new LaneError('immutable reviewer release evidence does not match this request')
      if(prior.selfReplacement){
        const replacement=parseReviewReplacement(priorCommit)
        const base=`${REVIEW_REPLACEMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}${assignmentSlotSuffix(request.slot)}`
        const rows=io.listRefs(base)
        if(!Array.isArray(rows)||rows.length>=REVIEW_REF_ROW_LIMIT)throw new LaneError('immutable replacement pause repair inventory unreadable or incomplete')
        const matching=rows.filter(row=>row.ref===base||row.ref===`${base}-${request.failedSequence}`)
        if(matching.length!==1||matching[0].sha!==priorFailureSha||(replacement.slot??1)!==request.slot||replacement.failedSequence!==request.failedSequence||replacement.issue!==request.issue||replacement.pr!==request.pr||replacement.headSha!==request.headSha||replacement.failureSha!=='self')throw new LaneError('immutable replacement pause repair protected replacement binding mismatch or ambiguity')
      }
      if(reviewLeaseRefCandidates({...original,slot:request.slot},Boolean(io.requiresExactReviewHeadSha)).some((candidate)=>leaseRefHoldsAssignment(candidate,{...original,slot:request.slot},io)))throw new LaneError('reviewer release evidence exists but the active lease is still present; reconciliation requires manual audit')
      if(!['insufficient_quota','provider_unavailable'].includes(prior.failureCode))throw new LaneError(`reviewer ${original.reviewer} terminal failure was already released with immutable evidence ${priorFailureSha}`)
      const pause=pauseActualReviewFailure({...request,reviewer:original.reviewer,failureCode:prior.failureCode,failureSha:priorFailureSha},io)
      return {...request,reviewer:original.reviewer,failureCode:prior.failureCode,failureSha:priorFailureSha,alreadyReleased:true,pause}
    }
    const preflightBusy=findBusyReviewers(io,[request])
    if(!preflightBusy)throw new LaneError('active reviewer leases are unreadable; reviewer release refused before mutex acquisition')
    const state=preflightBusy.states?.get(`${request.issue}:${request.pr}`),issueRow=state?.issue??io.getIssue(request.issue),prRow=state?.pr??io.getPr(request.pr)
    const superseded=String(options.failureCode)===REVIEW_TARGET_SUPERSEDED
    if(superseded){if(!reviewTargetSuperseded(prRow,request.headSha,request,io))throw new LaneError(`${REVIEW_TARGET_SUPERSEDED} requires proof the review target moved: PR #${request.pr} must be closed or its open head must differ from ${request.headSha}. The recorded head is still the open PR head, so this is not a superseded target.`)}
    else if(!reviewIssueEligible(issueRow,prRow,io)||!reviewTargetEligible(prRow,io)||prRow?.head?.sha!==request.headSha)throw new LaneError('reviewer release requires the exact eligible PR head')
    if(hasVerdictForHead(request.issue,request.pr,request.headSha,io,{slot:request.slot}))throw new LaneError('an existing verdict for the exact head forbids reviewer release. That verdict is the authorization of record; do not delete, forge, or replace it. If the reviewer that wrote it is only quarantined (not retired), clear the quarantine with ai-review-preflight clear (or requalify) so the existing exact-head verdict counts again.')
    const cached=activeLeaseRecordForAssignment(preflightBusy,{...original,slot:request.slot}),leaseRefForRelease=resolveAssignmentLeaseRef({...original,slot:request.slot},Boolean(io.requiresExactReviewHeadSha),io,preflightBusy),failedLeaseSha=cached?.sha??io.readRef(leaseRefForRelease),failedLease=failedLeaseSha?(cached?.sha===failedLeaseSha?cached.lease:parseReviewLease(io.getCommit(failedLeaseSha))):null
    // State the SLOT explicitly (#2694 review). The tuple compared here omitted the
    // slot, and was only safe because the single global sequence cursor keeps
    // sequences unique across slots. `leaseMatchesAssignment` already compares the
    // slot, so reuse it rather than depend on that invariant.
    //
    // #3492: a silence-reclaimed lease is already gone (reclaim cleared it and
    // wrote immutable silence-release evidence). When the failure code is
    // `silent_worker_observed` and no lease remains, the silence-release ref IS
    // the proof the lease was properly handled -- release must not demand a
    // lease that reclaim already removed. Absent lease + absent silence-release
    // evidence still refuses (fail closed).
    const silenceReleaseSha=String(options.failureCode)==='silent_worker_observed'?io.readRef(silenceReleaseRef({...request,sequence:request.failedSequence})):null
    if(!failedLease&&silenceReleaseSha){
      // Silence already reclaimed the lease; validate the evidence matches.
      const silenceRelease=parseSilenceRelease(io.getCommit(silenceReleaseSha))
      if(silenceRelease.issue!==request.issue||silenceRelease.pr!==request.pr||silenceRelease.headSha!==request.headSha||silenceRelease.sequence!==request.failedSequence||silenceRelease.reviewer!==original.reviewer)throw new LaneError('immutable silence-release evidence does not match the release request')
    }else if(!failedLease||!leaseMatchesAssignment(failedLease,{issue:request.issue,pr:request.pr,headSha:request.headSha,sequence:request.failedSequence,reviewer:original.reviewer,slot:request.slot}))throw new LaneError('failed reviewer active lease does not match the terminal failure evidence')
    if(typeof io.atomicReviewRefs!=='function'||typeof io.readReviewRefs!=='function')throw new LaneError('reviewer release requires atomic compare-and-swap ref support')
    const checkNote=String(options.failingCheck??'').trim()?` failing-check=${String(options.failingCheck).trim().replace(/\s+/g,'_')}`:''
    const failureSha=io.makeOwnerCommit(`db-coordination reviewer-failure-release reviewer=${original.reviewer} issue=${request.issue} pr=${request.pr} head=${request.headSha} failed-sequence=${request.failedSequence} code=${String(options.failureCode)}${checkNote} verdict=none artifact=none replacement=none`)
    const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-release-lock issue=${request.issue} pr=${request.pr} head=${request.headSha} failed-sequence=${request.failedSequence}`)
    let acquired=false
    try{
      requireReviewWireCapacity(8);acquireReviewMutex(ownerSha,io);acquired=true;requireOwnedRef(MUTEX_REF,ownerSha,io)
      const freshStates=io.readReviewStates([original]),fresh=freshStates?.get(`${request.issue}:${request.pr}`)
      if((superseded?!reviewTargetSuperseded(fresh?.pr,request.headSha,request,io):(!reviewIssueEligible(fresh?.issue,fresh?.pr,io)||!reviewTargetEligible(fresh?.pr,io)||fresh?.pr?.head?.sha!==request.headSha))||hasVerdictForHead(request.issue,request.pr,request.headSha,io,{fresh:true,slot:request.slot}))throw new LaneError('reviewer release issue, PR head, or verdict changed after mutex acquisition')
      const locked=io.readReviewRefs([MUTEX_REF,failureRef,leaseRefForRelease])
      if(locked.get(MUTEX_REF)!==ownerSha||locked.get(failureRef)!==null||locked.get(leaseRefForRelease)!==failedLeaseSha)throw new LaneError('reviewer release ownership changed after preflight')
      io.atomicReviewRefs([{ref:MUTEX_REF,expected:ownerSha,sha:ownerSha},{ref:failureRef,expected:null,sha:failureSha},{ref:leaseRefForRelease,expected:failedLeaseSha,sha:null}])
      const after=io.readReviewRefs([MUTEX_REF,failureRef,leaseRefForRelease])
      if(after.get(MUTEX_REF)!==ownerSha||after.get(failureRef)!==failureSha||after.get(leaseRefForRelease)!==null)throw new LaneError('atomic reviewer release readback mismatch')
      pauseActualReviewFailure({...request,reviewer:original.reviewer,failureCode:String(options.failureCode),failureSha},io)
      return {...request,reviewer:original.reviewer,failureCode:String(options.failureCode),failureSha,releasedLeaseSha:failedLeaseSha}
    }finally{if(acquired)finalizeReviewMutex(ownerSha,io)}
  })
}

function replaceFailedReviewerOperation({issue,pr,headSha,failedSequence,failureCode,failingCheck,confirmLocalDependencyUnfixable,confirmNoVerdict,confirmNoArtifact,slot=1,reviewerAllowlist=null,admissionOptions=null},io){
  io=reviewOperationIo(io)
  const silenceReplacement=String(failureCode)==='silent_worker_observed'
  if(String(failureCode)===REVIEW_TARGET_SUPERSEDED)throw new LaneError(`${REVIEW_TARGET_SUPERSEDED} is release-only: a superseded head needs no replacement reviewer, and replacing would record a healthy provider as failed. Run --release-failed-reviewer with this code, then assign a reviewer at the current PR head.`)
  const request=silenceReplacement
    ?{issue:Number(issue),pr:Number(pr),headSha:String(headSha??''),failedSequence:Number(failedSequence),slot:Number(slot??1)}
    :validateTerminalReviewerFailure({issue,pr,headSha,failedSequence,failureCode,failingCheck,confirmLocalDependencyUnfixable,confirmNoVerdict,confirmNoArtifact,slot},'reviewer replacement')
  if(silenceReplacement&&(!Number.isInteger(request.issue)||!Number.isInteger(request.pr)||!/^[0-9a-f]{40}$/i.test(request.headSha)||!Number.isInteger(request.failedSequence)||!Number.isInteger(request.slot)||request.slot<1||!confirmNoVerdict||!confirmNoArtifact||String(failingCheck??'').trim()))throw new LaneError('silent reviewer replacement requires exact issue, PR, 40-character head SHA, failed sequence, review slot, no failing check, and explicit confirmation of no verdict and no artifact')
  // Same request-boundary normalization as assignNextReviewerOperation: ref
  // names are lowercase and every peer resolver must agree on the case.
  request.headSha=String(request.headSha).toLowerCase()
  let requestedAllowlist=canonicalReviewerAllowlist(reviewerAllowlist)
  let effectiveAllowlist=requestedAllowlist
  const concurrentLeases=Boolean(io.requiresExactReviewHeadSha)
  const {eligible,unusable}=allocatableReviewers(io)
  let eligibleNames=new Set(eligible.filter((row)=>reviewerAllowed(row.name,effectiveAllowlist)).map((row)=>row.name))
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
  const {slotOne,peers:otherSlots}=resolvePeerSlots(request.issue,request.pr,request.headSha,request.slot,io)
  const excludedProviders=new Set([slotOne?.reviewer,...[...otherSlots.values()].map((row)=>row.reviewer)].filter(Boolean))
  const peersNow=()=>{const {slotOne:one,peers}=resolvePeerSlots(request.issue,request.pr,request.headSha,request.slot,io);return new Set([one?.reviewer,...[...peers.values()].map((row)=>row.reviewer)].filter(Boolean))}
  // Owner ruling 2026-10-02 (docs/owner-rulings.md): merged PR post-merge slot >= 2 may reuse a reviewer.
  let mergedReuseMemo=null
  const mergedReuse=()=>mergedReuseMemo??=(String(failureCode)!==SLOT_INDEPENDENCE_CONFLICT&&mergedPrReviewerReuseAllowed(request,io))
  const assertIndependent=(reviewer)=>{if(mergedReuse())return;if(peersNow().has(reviewer))throw new LaneError(`reviewer ${reviewer} already holds another review slot for this exact head; replacement refused. Replace this conflicting assignment with --failure-code ${SLOT_INDEPENDENCE_CONFLICT} and its current sequence.`)}
  if(slotOne)requestedAllowlist=inheritReviewerAllowlist(requestedAllowlist,slotOne.reviewerAllowlist)
  const failureBase=`${REVIEW_FAILURE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}`
  const fixedRecords=io.readReviewRecords?.([replacementRef,assignmentRef,REVIEW_CURSOR_REF,assignmentVerdictRef,failureRef],replacementBase,failureBase)??null
  let ownerSha=null,mutexAcquired=false
  // Issue #2457: the replacement that this function draws is COMPLETED before the
  // mutex is released. Carried on a refused release so the operator learns which
  // reviewer was drawn instead of being sent to a guarded recovery against a
  // mutex that the atomic deletion already removed.
  let completedResult=null
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
      const originalSha=fixedRecords?.get(assignmentRef)?.sha??io.readRef(assignmentRef)
      const initial=originalSha?parseReviewCursor(fixedRecords?.get(assignmentRef)?.commit??io.getCommit(originalSha)):null
      if(initial&&(initial.issue!==request.issue||initial.pr!==request.pr||initial.headSha!==request.headSha||(initial.slot??1)!==request.slot))throw new LaneError('durable reviewer assignment does not match the replacement request')
      const history=(fixedRecords?.matching??io.listRefs?.(replacementBase)??[]).filter((row)=>inReviewReplacementNamespace(row.ref,replacementBase)).map((row)=>parseReviewReplacement(row.commit??fixedRecords?.get(row.ref)?.commit??io.getCommit(row.sha)))
      if(history.some((row)=>row.issue!==request.issue||row.pr!==request.pr||row.headSha!==request.headSha))throw new LaneError('durable reviewer replacement does not match the replacement request')
      assertReviewerAllowlistConsistency([initial,...history,parsed])
      effectiveAllowlist=inheritReviewerAllowlist(requestedAllowlist,parsed.reviewerAllowlist)
      eligibleNames=new Set(eligible.filter((row)=>reviewerAllowed(row.name,effectiveAllowlist)).map((row)=>row.name))
      requireReplacementEvidence(parsed,io,fixedRecords)
      assertIndependent(parsed.reviewer)
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
      return completedResult={...parsed,slot:request.slot,wrapper:reviewer.wrapper,failureCode:String(failureCode),replacementSha:priorReplacement,replacementSequence:request.failedSequence,assignmentRef:replacementRef}
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
    if(initial.issue!==request.issue||initial.pr!==request.pr||initial.headSha!==request.headSha||(initial.slot??1)!==request.slot)throw new LaneError('durable reviewer assignment does not match the replacement request')
    const replacementRows=(fixedRecords?.matching??io.listRefs?.(replacementBase)??[]).filter((row)=>inReviewReplacementNamespace(row.ref,replacementBase))
    const parsedReplacements=replacementRows.map((row)=>{const parsed=parseReviewReplacement(row.commit??io.getCommit(row.sha));return {...parsed,ref:row.ref,assignmentSha:row.sha,failureSha:parsed.failureSha==='self'?row.sha:parsed.failureSha}})
    for(const replacement of parsedReplacements){
      if(replacement.issue!==request.issue||replacement.pr!==request.pr||replacement.headSha!==request.headSha)throw new LaneError('durable reviewer replacement does not match the replacement request')
      requireReplacementEvidence(replacement,io,fixedRecords)
    }
    assertReviewerAllowlistConsistency([initial,...parsedReplacements])
    const predecessors=parsedReplacements.filter((row)=>row.sequence===request.failedSequence)
    const original=request.failedSequence===initial.sequence?initial:predecessors.length===1?predecessors[0]:null
    if(!original||original.issue!==request.issue||original.pr!==request.pr||original.headSha!==request.headSha)throw new LaneError('durable reviewer assignment or replacement does not match the replacement request')
    if(String(failureCode)===SLOT_INDEPENDENCE_CONFLICT){
      if(!excludedProviders.has(original.reviewer))throw new LaneError('slot independence conflict recovery requires another live slot at this exact head held by the same reviewer; no such conflict was proved')
      if(headVerdictBlocksReplacement(request.issue,request.pr,request.headSha,io,{slot:request.slot}))throw new LaneError('slot independence conflict recovery cannot replace a slot with a durable verdict')
      if(reviewStartMarkerPresent({...original,slot:request.slot},io))throw new LaneError('slot independence conflict recovery cannot replace a review that already started; stop for an exact-slot audit')
      if(typeof io.atomicReviewRefs!=='function'||typeof io.readReviewRefs!=='function')throw new LaneError('slot independence conflict recovery requires atomic ref support')
    }
    effectiveAllowlist=inheritReviewerAllowlist(requestedAllowlist,original.reviewerAllowlist)
    eligibleNames=new Set(eligible.filter((row)=>reviewerAllowed(row.name,effectiveAllowlist)).map((row)=>row.name))
    if(silenceReplacement){
      const releaseRef=silenceReleaseRef({...request,sequence:request.failedSequence}),releaseSha=io.readRef(releaseRef)
      const failureReleaseCheck=fixedRecords?(fixedRecords.get(failureRef)?.sha??null):io.readRef(failureRef)
      if(releaseSha){
        const release=parseSilenceRelease(io.getCommit(releaseSha))
        if(release.issue!==request.issue||release.pr!==request.pr||release.headSha!==request.headSha||release.sequence!==request.failedSequence||release.reviewer!==original.reviewer)throw new LaneError('immutable silence-release evidence does not match the replacement request')
      }else if(!failureReleaseCheck){
        throw new LaneError('silent reviewer replacement requires immutable silence-release evidence or a prior --release-failed-reviewer record for the exact failed sequence')
      }
      // When only a failure-release exists (the #3492 release-then-replace path),
      // it is validated by the releasedFailure check below; no silence-release
      // record is required when --release-failed-reviewer already proved the
      // terminal failure with immutable evidence.
    }
    const releasedFailureSha=fixedRecords?(fixedRecords.get(failureRef)?.sha??null):io.readRef(failureRef)
    let releasedFailure=null
    if(releasedFailureSha){
      releasedFailure=parseTerminalFailureEvidence(fixedRecords?.get(failureRef)?.sha===releasedFailureSha?fixedRecords.get(failureRef).commit:io.getCommit(releasedFailureSha))
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
    if(hasVerdict)throw new LaneError('an existing verdict for the exact head forbids reviewer replacement. That verdict is the authorization of record; do not delete, forge, or replace it. If the reviewer that wrote it is only quarantined (not retired), clear the quarantine with ai-review-preflight clear (or requalify) so the existing exact-head verdict counts again.')
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
    // belongs to somebody else's review. When the replacement is the SAME
    // reviewer re-drawn onto the same head and slot (a silence-released name
    // restored by the #3492 capacity fix), the failed and replacement lease
    // refs are ONE ref: after the transition it holds the replacement lease,
    // so that is what the readback must expect -- not emptiness.
    // Defined after replacementLeaseRef/replacementLeaseSha below.
    // The failing check rides along in the immutable evidence, so a later reader
    // can tell a real provider outage from a stopped local service without
    // re-deriving it from memory.
    assertPaidReviewCapacity(request,io)
    const checkNote=String(failingCheck??'').trim()?` failing-check=${String(failingCheck).trim().replace(/\s+/g,'_')}`:''
    let failureSha
    // SKIP, DO NOT REFUSE (#1297). The rotation position is only a starting point.
    // Every provider that already failed on THIS exact head is excluded, and the
    // cursor is advanced past each excluded name so the durable sequence still
    // moves forward monotonically and stays consistent with the sequence this
    // replacement allocates. (Byte-identical retries come from the create-only
    // replacement ref read above, not from this advancement.)
    // Refuse only when no other active reviewer is left.
    //
    // A `silent_worker_observed` failure released with immutable evidence is a
    // WORKER silence, not a provider judgment: the provider never produced a
    // review or a verdict, and the release proves the silence was probed,
    // confirmed and the lease reclaimed. Permanently excluding that name -- the
    // #2224 shape, a claim about the world recorded as permanent -- deadlocks
    // the slot once every other name has failed on the same head (#3492 on PR
    // #3309: 4 of 5 failed, the fifth holds the other slot). Such a sequence is
    // re-eligible here. Every other terminal failure code, and any failure whose
    // evidence is the replacement record itself (`failure-ref=self`), stays
    // excluded fail-closed.
    const silenceReleasedSequences=new Set()
    if(releasedFailure?.failureCode==='silent_worker_observed')silenceReleasedSequences.add(request.failedSequence)
    const bySequence=new Map([[initial.sequence,initial.reviewer],...parsedReplacements.map((row)=>[row.sequence,row.reviewer])])
    for(const row of parsedReplacements){
      if(!row.failureSha||row.failureSha===row.assignmentSha)continue
      const record=fixedRecords?.get?.(`${failureBase}-${row.failedSequence}`)??null
      let release=null
      try{release=parseReviewRelease(record?.commit??io.getCommit(row.failureSha))}catch{continue}
      // Bind the predecessor release to its exact identity, exactly as the
      // current-request release is bound above: a record whose issue, PR, head,
      // failed sequence or reviewer differs never restores a name.
      if(release.issue!==request.issue||release.pr!==request.pr||release.headSha!==request.headSha||release.failedSequence!==row.failedSequence||release.reviewer!==bySequence.get(row.failedSequence))continue
      if(release.failureCode==='silent_worker_observed')silenceReleasedSequences.add(row.failedSequence)
    }
    const failedNames=new Set()
    if(!silenceReleasedSequences.has(request.failedSequence))failedNames.add(original.reviewer)
    for(const row of parsedReplacements){const name=bySequence.get(row.failedSequence);if(name&&!silenceReleasedSequences.has(row.failedSequence))failedNames.add(name)}
    let sequence=null, reviewer=null
    for(const [offset,candidate] of drawOrder(cursor.sequence+1,io).entries()){
      const candidateSequence=cursor.sequence+1+offset
      if(!eligibleNames.has(candidate.name)||!reviewerEmitsGovernedVerdict(candidate.name)||failedNames.has(candidate.name)||(!concurrentLeases&&preflightBusy.has(candidate.name))||excludedProviders.has(candidate.name)||preflightExclusions.has(candidate.name))continue
      sequence=candidateSequence;reviewer=candidate;break
    }
    // Owner ruling 2026-10-02: no independent replacement left on a merged PR's
    // post-merge slot >= 2 -> reuse a reviewer holding another slot here. Failed,
    // ineligible, preflight-excluded and retired reviewers stay excluded.
    if(!reviewer&&mergedReuse()){
      for(const [offset,candidate] of drawOrder(cursor.sequence+1,io).entries()){
        const candidateSequence=cursor.sequence+1+offset
        if(!eligibleNames.has(candidate.name)||!reviewerEmitsGovernedVerdict(candidate.name)||failedNames.has(candidate.name)||(!concurrentLeases&&preflightBusy.has(candidate.name))||preflightExclusions.has(candidate.name))continue
        sequence=candidateSequence;reviewer=candidate;break
      }
    }
    // Compatibility hook for historical configurations that had an overflow
    // provider. The approved 2026-08-28 roster has none.
    if(!reviewer){
      const overflow=OVERFLOW_REVIEWERS.find((row)=>eligibleNames.has(row.name)&&reviewerEmitsGovernedVerdict(row.name)&&!failedNames.has(row.name)&&(concurrentLeases||!preflightBusy.has(row.name))&&!excludedProviders.has(row.name)&&!preflightExclusions.has(row.name))
      if(overflow){sequence=cursor.sequence+1+ACTIVE_REVIEWERS.length;reviewer=overflow}
    }
    if(!reviewer&&mergedReuse()){
      const overflow=OVERFLOW_REVIEWERS.find((row)=>eligibleNames.has(row.name)&&reviewerEmitsGovernedVerdict(row.name)&&!failedNames.has(row.name)&&(concurrentLeases||!preflightBusy.has(row.name))&&!preflightExclusions.has(row.name))
      if(overflow){sequence=cursor.sequence+1+ACTIVE_REVIEWERS.length;reviewer=overflow}
    }
    if(!reviewer){
      const failedList=[...failedNames].filter((name)=>ACTIVE_REVIEWERS.some((row)=>row.name===name))
      // #3130 / owner ruling 2026-09-16: with per-review lease refs a live
      // lease never makes a reviewer unavailable, so "busy" is reported only
      // for the legacy single-lease layout, only for ACTIVE (drawable)
      // reviewers, and only when busy is the sole reason. A provider excluded
      // for independence or eligibility is named under that real reason.
      const busyList=(concurrentLeases?[]:[...preflightBusy]).filter((name)=>!failedNames.has(name)&&ACTIVE_REVIEWERS.some((row)=>row.name===name)&&eligibleNames.has(name)&&!excludedProviders.has(name)&&!preflightExclusions.has(name)).map((name)=>{const rows=preflightBusy.byReviewer?.get(name)??(preflightBusy.leases.get(name)?[preflightBusy.leases.get(name)]:[]);return `${name}${rows.map((row)=>` #${row.lease.issue}/PR #${row.lease.pr}`).join('')}`})
      const unavailable=ACTIVE_REVIEWERS.map((row)=>row.name).filter((name)=>!failedNames.has(name)&&(!eligibleNames.has(name)||excludedProviders.has(name)||preflightExclusions.has(name))).map((name)=>`${name} (${!eligibleNames.has(name)?(unusable.has(name)?`unusable by ai-review-preflight (${unusable.get(name)?.status})`:'ineligible'):excludedProviders.has(name)?'holds another slot on this pull request':'excluded for this issue'})`)
      const releaseCommand=failedReviewerReleaseCommand(request,{failureCode,failingCheck})
      const compatiblePrefix=request.slot===1?'no other reviewer is available':'no other independent reviewer is available for slot '+request.slot
      throw new LaneError(`${compatiblePrefix}; no replacement reviewer is available: ${failedList.length} of ${ACTIVE_REVIEWERS.length} already failed on this exact head (${failedList.join(', ')||'none'}); ${busyList.length} of ${ACTIVE_REVIEWERS.length} hold other live leases (${busyList.join(', ')||'none'}); ${unavailable.length} are otherwise ineligible or excluded (${unavailable.join(', ')||'none'}). If this failed holder must be freed before another terminal holder can be reclaimed, run ${releaseCommand}.`)
    }
    const replacementSha=io.makeOwnerCommit(releasedFailureSha
      ?`db-coordination reviewer-replacement sequence=${sequence} reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha} slot=${request.slot}${reviewerAllowlistSuffix(effectiveAllowlist)} failed-sequence=${request.failedSequence} prior-sequence=${cursor.sequence} failure-ref=${releasedFailureSha}`
      :`db-coordination reviewer-failure-replacement sequence=${sequence} reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha} slot=${request.slot}${reviewerAllowlistSuffix(effectiveAllowlist)} failed-sequence=${request.failedSequence} prior-sequence=${cursor.sequence} failure-ref=self failed-reviewer=${original.reviewer} code=${failureCode}${checkNote} verdict=none artifact=none`)
    failureSha=releasedFailureSha??replacementSha;ownerSha=replacementSha
    const cursorReplacementSha=replacementSha
    const replacementLeaseRef=reviewLeaseRefForAssignment({...request,reviewer:reviewer.name,sequence},concurrentLeases)
    const replacementLeaseSha=cursorReplacementSha
    const failedLeaseAfter=unrelatedFailedLeaseSha??(failedLeaseRef===replacementLeaseRef?replacementLeaseSha:null)
    const replacementStale=preflightBusy.stale.find((row)=>row.ref===replacementLeaseRef)
    let failureCreated=false, cursorUpdated=false,failedLeaseReleased=false,replacementStaleReleased=false,replacementLeaseCreated=false
    requireReviewWireCapacity(12);acquireReviewMutex(ownerSha,io);mutexAcquired=true
    try{
      if(admissionOptions)requirePrOperationRoute(admissionOptions,io,{pr,headSha,issue,mutexOwner:ownerSha,allowMerged:true,reviewSnapshot:true})
      const freshExclusions=reviewerExclusions(request.issue,request.pr,io,{fresh:true})
      if(freshExclusions.has(reviewer.name))throw new LaneError(`selected replacement reviewer ${reviewer.name} became excluded for this PR before mutex acquisition; retry to select from the fresh roster`)
      if(String(failureCode)===SLOT_INDEPENDENCE_CONFLICT&&!peersNow().has(original.reviewer))throw new LaneError('slot independence conflict disappeared before mutex acquisition; recovery refused')
      assertIndependent(reviewer.name)
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
        const stoppedStartRef=String(failureCode)===SLOT_INDEPENDENCE_CONFLICT?reviewStartedMarkerRef({...original,slot:request.slot}):null
        if(stoppedStartRef)changes.push({ref:stoppedStartRef,expected:null,sha:replacementSha})
        if(failedLeaseSha)changes.splice(changes.length-1,0,{ref:failedLeaseRef,expected:failedLeaseSha,sha:null})
        else if(unrelatedFailedLeaseSha)changes.splice(changes.length-1,0,{ref:failedLeaseRef,expected:unrelatedFailedLeaseSha,sha:unrelatedFailedLeaseSha})
        io.atomicReviewRefs(changes)
        const refs=io.readReviewRefs([MUTEX_REF,failureRef,REVIEW_CURSOR_REF,replacementRef,failedLeaseRef,replacementLeaseRef,...(stoppedStartRef?[stoppedStartRef]:[])])
        if(refs.get(MUTEX_REF)!==ownerSha||refs.get(failureRef)!==failureSha||refs.get(REVIEW_CURSOR_REF)!==cursorReplacementSha||refs.get(replacementRef)!==replacementSha||refs.get(failedLeaseRef)!==failedLeaseAfter||refs.get(replacementLeaseRef)!==replacementLeaseSha||(stoppedStartRef&&refs.get(stoppedStartRef)!==replacementSha))throw new LaneError('atomic review replacement readback mismatch')
        return completedResult={sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request,...(effectiveAllowlist?{reviewerAllowlist:effectiveAllowlist}:{}),priorSequence:cursor.sequence,failureCode:String(failureCode),failureSha,replacementSha,replacementSequence:request.failedSequence,assignmentRef:replacementRef}
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
      return completedResult={sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request,...(effectiveAllowlist?{reviewerAllowlist:effectiveAllowlist}:{}),priorSequence:cursor.sequence,failureCode:String(failureCode),failureSha,replacementSha,replacementSequence:request.failedSequence,assignmentRef:replacementRef}
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
  }finally{if(mutexAcquired)finalizeReviewMutexPreservingResult(ownerSha,io,completedResult)}
}

export function replaceFailedReviewer(request,io=githubIo){return withReviewRequestBudget(()=>{
  const operationIo=reviewOperationIo(io)
  const result=replaceFailedReviewerOperation(request,operationIo)
  if(result.failureSha&&['insufficient_quota','provider_unavailable'].includes(result.failureCode)){
    pauseActualReviewFailure({issue:Number(result.issue),pr:Number(result.pr),headSha:String(result.headSha).toLowerCase(),slot:Number(result.slot??1),failedSequence:Number(result.failedSequence??result.replacementSequence),failureCode:result.failureCode,failureSha:result.failureSha},operationIo)
  }
  return result
})}

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
        // resolvePeerSlots and assignNextReviewerOperation already use.
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

export function withAuthorMutex(label, io, options, operation) {
  const requestId = options.requestId ?? randomUUID()
  const ownerSha = io.makeOwnerCommit(`db-coordination ${label} ${requestId}`)
  acquireMutex(ownerSha, io, options.mutexAttempts ?? 100)
  try {
    requireOwnedRef(MUTEX_REF, ownerSha, io)
    return operation(ownerSha)
  } finally {
    releaseMutexOnExit(ownerSha,io)
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
  assertUnambiguousClaimTitle(options.task)
  if(io.enforceAdmission===true&&(!Number.isInteger(Number(options.admitIssue))||Number(options.admitIssue)<=0))throw new LaneError('--admit-issue <work issue> is required before claim, reviewer assignment, or shared-stage acquisition')
  const requestId = options.requestId ?? randomUUID()
  const ownerSha = io.makeOwnerCommit(`db-coordination author-acquisition ${requestId}`)
  acquireMutex(ownerSha, io, options.mutexAttempts ?? 100)
  try {
    const admitted=requireAdmission(options,io,{timestamp:now,mutexOwner:ownerSha})
    if(io.enforceAdmission===true){
      const authorized=[...(admitted?.writes??[])].sort()
      // ISSUE #3125 -- compare SORTED against SORTED. `authorized` is already
      // sorted, so comparing caller order against it refused a valid claim whose
      // --objects simply listed the same admitted writes in another order.
      // requireAdmissionGate already sorts both sides; this second, post-mutex
      // re-proof did not, so the refusal landed here instead. Set semantics only:
      // an absent, extra or different object still refuses exactly as before.
      const requested=[...options.objects].sort()
      if(requested.length!==authorized.length||requested.some((value,index)=>value!==authorized[index]))throw new LaneError(`--claim objects must exactly match admitted issue #${options.admitIssue} writes`)
    }
    const claims = io.openClaims()
    const prSources = io.prSources()
    assertLaneAvailable(claims, options.objects, now, { prSources })
    // #2301 Step 3. A retired branch or worktree is never reused, so a successor
    // cannot quietly inherit a dead lane's identity. Checked INSIDE the mutex,
    // before the version is reserved, so a refusal spends no permanent version.
    assertRetirementIdentityAvailable({ branch: options.branch, worktree: options.worktree }, io)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const reservation = io.reserveVersion()
    const expiresAt = new Date(now.valueOf() + options.leaseHours * 3600000)
    const body = claimBody({ ...options, version: reservation.version, expiresAt })
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const url = io.createClaim(options.task, body)
    const dispatchArgs={issue:Number(options.admitIssue),state:'dispatched',actor:options.owner,timestamp:new Date().toISOString(),evidenceUrls:[url]}
    const expectedDispatch=io.enforceAdmission===true?outcomeEvent(dispatchArgs):null
    try {
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      // A re-claim after a released claim (e.g. its PR closed unmerged) finds the
      // work issue already dispatched; dispatch is satisfied, not an illegal advance.
      if(io.enforceAdmission===true){
        const prior=outcomeHistory(io.issueComments(Number(options.admitIssue)),Number(options.admitIssue))
        if(!(prior.valid&&prior.state==='dispatched'))advanceOutcome(dispatchArgs,io)
      }
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
    releaseMutexOnExit(ownerSha,io)
  }
}

// ACTING ON SOMEBODY ELSE'S ABANDONMENT IS A DIFFERENT ACT (issue #2301 Step 4).
// When the blocker is an ordinary durable work dependency, this command means
// "the work is blocked, hand the capacity back" and behaves exactly as it always
// has. When the blocker is an abandonment-audit issue, it means "this author is
// gone, take the lane from them" -- a third party mutating a claim they do not
// own -- and that is the case where the evidence has to be re-proved at the
// moment of the write rather than trusted from whenever the audit was filed.
//
// Returns null for an ordinary blocker, so the ordinary path stays untouched,
// and throws rather than degrading whenever the evidence is present but wrong:
// a stale head, a renumbered pull request, a reclassified or closed audit issue
// and a mismatched owner are each a refusal, never a warning.
export function assertAbandonmentEvidence(options, lease, blocker, io) {
  const number=/^issue:#(\d+)$/.exec(String(blocker??''))?.[1]
  if(!number)return null
  const blockerIssue=io.getIssue(Number(number))
  const audit=parseAbandonmentAudit(blockerIssue?.body??'')
  if(!audit)return null
  if(blockerIssue?.state!=='open')throw new LaneError(`abandonment-audit issue #${number} is not open`)
  let workType=null
  try{workType=parseQueueScope(blockerIssue?.body??'')?.workType??null}catch{workType=null}
  if(workType!=='repo-maintenance')throw new LaneError(`abandonment-audit issue #${number} must be classified repo-maintenance work, not ${workType??'unclassified'}`)
  if(Number(audit.claim)!==Number(options.claim))throw new LaneError(`abandonment-audit issue #${number} names claim #${audit.claim}, not claim #${options.claim}`)
  if(String(audit.owner)!==String(lease.owner))throw new LaneError(`abandonment-audit issue #${number} names owner ${audit.owner}, but claim #${options.claim} is held by ${lease.owner}`)
  const pulls=io.branchPulls?.(lease.branch)??[]
  const named=pulls.find((pull)=>Number(pull.number)===Number(audit.pr))
  if(!named)throw new LaneError(`abandonment-audit issue #${number} names pull request #${audit.pr}, which is not a pull request for branch ${lease.branch}`)
  const head=String(named.head?.sha??'').toLowerCase()
  if(head!==audit.head_sha)throw new LaneError(`abandonment-audit issue #${number} names head ${audit.head_sha}, but pull request #${audit.pr} is now at ${head||'an unreadable head'}`)
  // The worktree observation is the operator's own, stated explicitly. Inferring
  // it here would let a stale audit decide what the disk currently looks like.
  if(!options.worktreeState)throw new LaneError('acting on abandonment evidence requires an explicit --worktree-state')
  const marker=typeof io.orchestratorFlowAdapter==='function'?io.orchestratorFlowAdapter().resolveMarker():null
  if(!marker?.live||marker.calling_task!==marker.task)throw new LaneError(`acting on abandonment evidence: ${sessionAuthorityRefusal(marker)}`)
  return audit
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
    if(lease.owner!==options.owner)throw new LaneError(wrongOwnerMessage({claim:options.claim,onRecord:lease.owner,supplied:options.owner,command:laneCommand(['--relinquish-author-lease','--claim-number',String(options.claim),'--owner',JSON.stringify(String(lease.owner??'')),'--blocked-on','<blocker>','--worktree-state','<clean|dirty|remote|absent>'])}))
    const blocker=validateCapacityBlocker(options.blockedOn,io)
    const evidence=assertAbandonmentEvidence(options,lease,blocker,io)
    const recoveryArtifact=options.recoveryArtifact?requireDereferenceableRecoveryArtifact(options.recoveryArtifact,io):null
    if(lease.capacityState==='relinquished'){
      const replayState=requestedWorktreeState(options.worktreeState)??(lease.worktreeState==='clean'?'clean':null)
      if(!lease.relinquishmentMetadataLegacy&&lease.blockedOn===blocker&&lease.worktreeState===replayState&&lease.recoveryArtifact===recoveryArtifact)return {claim:Number(options.claim),capacityState:'relinquished',blockedOn:blocker,worktreeState:replayState,recoveryArtifact,idempotent:true}
      if(!lease.relinquishmentMetadataLegacy)throw new LaneError('claim is already relinquished with a different blocker, worktree state, or recovery artifact')
      if(lease.blockedOn!==blocker)throw new LaneError('legacy relinquished claim names a different blocker')
    }
    const worktreeState=resolveRelinquishmentWorktreeState(lease.worktree,options.worktreeState,io)
    for(const [kind,ref] of Object.entries(EXCLUSIVE_REFS)){
      const held=io.readRef(ref)
      if(!held)continue
      const message=io.getCommitMessage?.(held)??''
      if(new RegExp(`(?:issue|claim)=${options.claim}(?:\\D|$)`).test(message))throw new LaneError(`claim still holds the ${kind} stage`)
    }
    const currentBlocker=validateCapacityBlocker(options.blockedOn,io)
    if(currentBlocker!==blocker)throw new LaneError('capacity blocker changed concurrently before relinquishment')
    // TOCTOU. The evidence was proved once before the worktree was observed and
    // the exclusive stages were checked; between those reads the audit issue can
    // be closed, reclassified, or edited to name a different head. Re-proving it
    // here, and requiring the SAME record, is what stops a window in which stale
    // evidence authorizes a write that its current state would refuse.
    const currentEvidence=assertAbandonmentEvidence(options,lease,currentBlocker,io)
    if(JSON.stringify(currentEvidence)!==JSON.stringify(evidence))throw new LaneError('abandonment evidence changed concurrently before relinquishment')
    const expected=replaceCapacityState(before.body,'relinquished',blocker,worktreeState,recoveryArtifact)
    requireOwnedRef(MUTEX_REF,ownerSha,io);changed=true;io.updateIssue(options.claim,{body:expected})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.body!==expected||afterLease.capacityState!=='relinquished'||afterLease.blockedOn!==blocker||afterLease.worktreeState!==worktreeState||afterLease.recoveryArtifact!==recoveryArtifact)throw new LaneError('relinquished capacity readback failed')
    const workIssue=claimWorkIssue(before)
    publishCapacityEvents({workIssue,claim:options.claim,eventTypes:['author_capacity_relinquished','issue_blocked'],actor:options.owner,detail:blocker},now,io)
    return {claim:Number(options.claim),workIssue,capacityState:'relinquished',blockedOn:blocker,worktreeState,recoveryArtifact,idempotent:false}
  }catch(error){
    if(changed&&io.readRef(MUTEX_REF)===ownerSha)try{io.updateIssue(options.claim,{body:before.body})}catch(rollback){throw new LaneError(`${error.message}; rollback failed: ${rollback.message}`)}
    throw error
  }finally{releaseMutexOnExit(ownerSha,io)}
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
    // #3050 / ai-devops#498 item 12: these were one combined refusal, so a caller
    // could never tell which of the two facts stopped them. Split, both still refuse.
    if(lease.legacy)throw new LaneError(`claim #${options.claim} carries a legacy lease with no owner field, so capacity cannot be resumed`)
    if(lease.owner!==options.owner)throw new LaneError(wrongOwnerMessage({claim:options.claim,onRecord:lease.owner,supplied:options.owner,command:laneCommand(['--resume-author-lease','--claim-number',String(options.claim),'--owner',JSON.stringify(String(lease.owner??'')),'--lease-hours','<1-24>'])}))
    if(lease.capacityState!=='relinquished')throw new LaneError('claim capacity is not relinquished')
    if(lease.relinquishmentMetadataLegacy)throw new LaneError('legacy relinquished claim must be reconciled with --relinquish-author-lease before resume')
    assertClaimNotRetired(lease.version,'resumed',io)
    const requestedRecovery=options.recoveryArtifact?requireDereferenceableRecoveryArtifact(options.recoveryArtifact,io):null
    if(requestedRecovery&&lease.recoveryArtifact&&requestedRecovery!==lease.recoveryArtifact)throw new LaneError('recovery artifact does not match the relinquished claim')
    if(lease.worktreeState!=='clean'){
      // Every branch below fails closed. The stored reference is re-verified on
      // every resume, never trusted because it was accepted once.
      const recovery=requestedRecovery??(lease.recoveryArtifact?requireDereferenceableRecoveryArtifact(lease.recoveryArtifact,io):null)
      // A `remote` relinquishment says the work lives on another machine. Any
      // local tree at the same literal path is a different tree, so a clean
      // local observation can never satisfy it.
      if(lease.worktreeState==='remote'&&!recovery)throw new LaneError('resume from remote requires --recovery-artifact')
      // An unreadable observation is an unknown state, and an unknown state is
      // never excused by a stored recovery string. This must throw.
      const observed=observedWorktreeState(lease.worktree,io)
      if(lease.worktreeState!=='remote'&&observed!=='clean'&&!recovery)throw new LaneError(`resume from ${lease.worktreeState} requires a proven-clean worktree or --recovery-artifact`)
    }
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
  }finally{releaseMutexOnExit(ownerSha,io)}
}

// #3170. REPAIR A CLAIM A RESUME LEFT UNREADABLE. Narrow on purpose: it only
// removes relinquish-only residue (`blocked_on`, `worktree_state`, `recovery`)
// from a lease that already declares `capacity_state: active`, only for the
// claim's own owner, only when the work issue's latest capacity event for this
// claim is `author_capacity_resumed`, and only when the result parses as an
// active-capacity lease. It never changes capacity, owner, expiry or objects.
export function repairResumedClaim(options, now = new Date(), io = githubIo) {
  for(const key of ['claim','owner'])if(!options[key])throw new LaneError(`resumed-claim repair requires ${key}`)
  const ownerSha=io.makeOwnerCommit(`db-coordination author-capacity-resume claim=${options.claim} repair=relinquish-residue`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,changed=false
  try{
    before=io.getIssue(options.claim)
    if(before?.state!=='open')throw new LaneError(`claim #${options.claim} must be open`)
    const fences=[...String(before.body??'').matchAll(/```db-author-lease\s*\n([\s\S]*?)```/g)]
    if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-author-lease block')
    const block=fences[0][1],lines=block.split('\n')
    const capacity=lines.map((line)=>/^\s*capacity_state\s*:\s*(\S+)\s*$/.exec(line)?.[1]).filter(Boolean)
    if(capacity.length!==1||capacity[0]!=='active')throw new LaneError('resumed-claim repair applies only to a lease declaring capacity_state: active')
    const owner=lines.map((line)=>/^\s*owner\s*:\s*(.+?)\s*$/.exec(line)?.[1]).filter(Boolean)
    if(owner.length!==1)throw new LaneError(`claim #${options.claim} lease declares ${owner.length} owner fields; exactly one is required`)
    if(owner[0]!==options.owner)throw new LaneError(wrongOwnerMessage({claim:options.claim,onRecord:owner[0],supplied:options.owner,command:laneCommand(['--repair-resumed-claim','--claim-number',String(options.claim),'--owner',JSON.stringify(String(owner[0]??''))])}))
    if(!relinquishOnlyFieldsIn(block).length)throw new LaneError('claim carries no relinquish-only residue; nothing to repair')
    const workIssue=claimWorkIssue(before)
    const events=(io.getIssueComments?.(workIssue)??[]).flatMap((comment)=>{try{return parseEventComment(comment.body)}catch{return []}})
      .filter((event)=>Number(event.claim_issue)===Number(options.claim)&&['author_capacity_resumed','author_capacity_relinquished'].includes(event.event_type))
    if(events.at(-1)?.event_type!=='author_capacity_resumed')throw new LaneError('latest capacity event for this claim is not author_capacity_resumed')
    const repairedBlock=stripRelinquishOnlyFields(block)
    const expected=before.body.slice(0,fences[0].index)+fences[0][0].replace(block,()=>repairedBlock)+before.body.slice(fences[0].index+fences[0][0].length)
    const lease=parseAuthorLease(expected,now)
    if(lease.legacy||lease.declaredCapacityState!=='active'||!lease.capacityActive||lease.worktreeState||lease.blockedOn||lease.recoveryArtifact)throw new LaneError('repaired lease does not parse as clean active capacity')
    assertClaimNotRetired(lease.version,'repaired',io)
    requireOwnedRef(MUTEX_REF,ownerSha,io);changed=true;io.updateIssue(options.claim,{body:expected})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim)
    if(after?.body!==expected)throw new LaneError('repaired claim readback failed')
    parseAuthorLease(after.body,now)
    return {claim:Number(options.claim),workIssue,capacityState:lease.capacityState,removedFields:relinquishOnlyFieldsIn(block),repaired:true}
  }catch(error){
    if(changed&&io.readRef(MUTEX_REF)===ownerSha)try{io.updateIssue(options.claim,{body:before.body})}catch(rollback){throw new LaneError(`${error.message}; rollback failed: ${rollback.message}`)}
    throw error
  }finally{releaseMutexOnExit(ownerSha,io)}
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
    if(lease.relinquishmentMetadataLegacy)throw new LaneError('legacy relinquished claim must be reconciled with --relinquish-author-lease before this mutation')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('claim owner, branch, or worktree mismatch')
    assertClaimNotRetired(lease.version,'renewed',io)
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
    // Historical claims may protect more objects than the current issue or PR
    // writes. The forward checks above require every current issue and parsed
    // PR write to be covered; renewal retains the entire existing claim.
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
  } finally {releaseMutexOnExit(ownerSha,io)}
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
    if(lease.relinquishmentMetadataLegacy)throw new LaneError('legacy relinquished claim must be reconciled with --relinquish-author-lease before this mutation')
    assertClaimNotRetired(lease.version,'recovered from expiry',io)
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('claim owner, branch, or worktree mismatch')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const workIssue=io.getIssue(options.issue)
    const issueUncovered=renewalIssueScope(workIssue,lease,[Number(options.issue)],{allowClaimSuperset:true,allowIssueExpansion:true}).uncovered??[]
    const pr=io.getPr(options.pr)
    if(pr?.state!=='open'||pr.head?.ref!==options.branch||pr.head?.sha!==options.headSha)throw new LaneError('open pull request branch or exact head mismatch')
    const fileVersions=migrationVersions(io.getPrFiles(options.pr))
    if(fileVersions.length!==1||fileVersions[0]!==lease.version)throw new LaneError('pull request migration version does not match the permanent claim version')
    const sources=io.prSources(),targets=sources.filter((source)=>new RegExp(`^PR #${options.pr}(?:\\s|$)`).test(source.label))
    if(targets.length!==1)throw new LaneError('pull request parser source is unavailable or ambiguous')
    const target=targets[0]
    if(target.versions?.length!==1||String(target.versions[0])!==lease.version)throw new LaneError('parsed pull request version does not match the permanent claim version')
    const claimed=new Set(lease.objects.map(normalizeObject)),parsed=validateClaimObjects(target.objects??[])
    const uncovered=[...new Set([...parsed,...issueUncovered])].filter((object)=>!claimed.has(object))
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
    renewalIssueScope(freshWorkIssue,lease,[Number(options.issue)],{allowClaimSuperset:true,allowIssueExpansion:true})
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
  }finally{releaseMutexOnExit(ownerSha,io)}
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
    if(workIssue?.state!=='open'||scope?.status!=='ready'||scope.workType!=='structural'||!STRUCTURAL_ROUTES.includes(scope.route))throw new LaneError('exact work issue is not open ready structural work on an admitted structural route')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy||!lease.active)throw new LaneError('target claim lease is legacy or expired')
    if(lease.relinquishmentMetadataLegacy)throw new LaneError('legacy relinquished claim must be reconciled with --relinquish-author-lease before this mutation')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('target claim owner, branch, or worktree changed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    assertClaimNotRetired(lease.version,'expanded',io)
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
  } finally {releaseMutexOnExit(ownerSha,io)}
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
    if(lease.relinquishmentMetadataLegacy)throw new LaneError('legacy relinquished claim must be reconciled with --relinquish-author-lease before this mutation')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('target claim owner, branch, or worktree changed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    assertClaimNotRetired(lease.version,'expanded',io)
    const workIssue=io.getIssue(options.issue),scope=parseQueueScope(workIssue?.body??'')
    if(workIssue?.state!=='open'||scope?.status!=='ready'||scope.workType!=='structural'||!STRUCTURAL_ROUTES.includes(scope.route))throw new LaneError('exact work issue is not open ready structural work on an admitted structural route')
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
  }finally{releaseMutexOnExit(ownerSha,io)}
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
    assertClaimNotRetired(released.version,'recovered by split recovery',io)
    assertClaimNotRetired(active.version,'recovered by split recovery',io)
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
  } finally { releaseMutexOnExit(ownerSha,io) }
}

export function setScopeStatus(options, now = new Date(), io = githubIo) {
  for (const key of ['issue', 'status', 'reason']) {
    if (options[key] === undefined || options[key] === null || options[key] === '') throw new LaneError(`--set-scope-status requires --${key === 'issue' ? 'issue' : key}`)
  }
  const status = String(options.status)
  if (!QUEUE_STATUSES.has(status)) throw new LaneError(`--status must be one of ${[...QUEUE_STATUSES].join(', ')}`)
  const reason = String(options.reason).trim()
  if (/[\r\n]/.test(reason)) throw new LaneError('--reason must be a single line; the audit comment is the only record of why the status moved')
  if (reason.length < 12) throw new LaneError('--reason must be at least 12 characters; "done" is not an audit trail')
  const ownerSha = io.makeOwnerCommit(`db-coordination queue-scope-status issue=${options.issue}`)
  acquireMutex(ownerSha, io, options.mutexAttempts ?? 100)
  let before, changed = false
  try {
    before = io.getIssue(options.issue)
    if (before?.state !== 'open') throw new LaneError(`issue #${options.issue} is not open; a closed issue's scope status is history and is never rewritten`)
    const scope = parseQueueScope(before.body ?? '')
    if (!scope) throw new LaneError(`issue #${options.issue} carries no db-work-scope block; add exactly one before setting its status`)
    if (scope.status === status) return { issue: Number(options.issue), status, previousStatus: status, idempotent: true }
    if (status === 'ready') {
      // FAIL CLOSED. Without a dependency reader we have checked nothing, and an
      // unchecked `ready` is exactly the unaudited hand edit this replaces.
      if (typeof io.dependencyStates !== 'function') throw new LaneError('cannot prove the dependency closure without a dependency reader; refusing to set ready')
      const states = scope.dependencies.length ? io.dependencyStates(scope.dependencies) : {}
      const closure = classifyDependencies(Number(options.issue), scope.dependencies, states)
      if (!closure.satisfied) {
        throw new LaneError(`refusing to set issue #${options.issue} to ready: ${closure.blocked.length} of ${scope.dependencies.length} depends_on entries are not satisfied. ${closure.blocked.map((row) => `#${row.number} (${row.status}): ${row.reason}`).join(' ')} A dependent is released only by a merged or owner-ruling-recorded db-work-completion record published with --complete-work.`)
      }
    }
    const expected = replaceScopeStatus(before.body, status)
    requireOwnedRef(MUTEX_REF, ownerSha, io)
    changed = true
    io.updateIssue(options.issue, { body: expected })
    requireOwnedRef(MUTEX_REF, ownerSha, io)
    // READ BACK. The #2212 precedent is a write that silently did not happen.
    const after = io.getIssue(options.issue)
    if (after?.body !== expected) throw new LaneError(`scope status readback failed on #${options.issue}; the body on GitHub is not what was written. Do NOT assume the status changed.`)
    const afterScope = parseQueueScope(after.body ?? '')
    if (afterScope?.status !== status) throw new LaneError(`scope status read back as ${afterScope?.status ?? 'unreadable'}, expected ${status}`)
    io.commentIssue(Number(options.issue), [
      `db-work-scope \`status\` changed from \`${scope.status}\` to \`${status}\` by \`--set-scope-status\`.`,
      '',
      `- reason: ${reason}`,
      `- at: ${now.toISOString()}`,
      `- mutex owner commit: \`${ownerSha}\``,
      '',
      'This changed the queue status field only. It is not a completion record and it releases no dependent task.',
    ].join('\n'))
    return { issue: Number(options.issue), status, previousStatus: scope.status, reason, idempotent: false }
  } catch (error) {
    if (changed && io.readRef(MUTEX_REF) === ownerSha) {
      try { io.updateIssue(options.issue, { body: before.body }) } catch (rollback) { throw new LaneError(`${error.message}; rollback failed: ${rollback.message}`) }
    }
    throw error
  } finally { releaseMutexOnExit(ownerSha,io) }
}



/** Current-world read side; never closes an issue or publishes a completion. */
export function verifyCompletionAcceptance({ issue, record }, io = githubIo) {
  const work = io.getIssue(Number(issue))
  if (!work || !['open', 'closed'].includes(work.state)) throw new DependencyError('completion issue is unreadable')
  const scope = parseQueueScope(work.body ?? '')
  if (!scope) throw new DependencyError('completion issue has no typed scope')
  const comments = io.issueComments(Number(issue))
  const stored = findCompletionRecord(comments, { requireTrustedAuthor: true, repository: REPO })
  if (!stored) return { status: scope.workType === 'structural' ? 'awaiting-live-proof' : 'incomplete', workType: scope.workType }
  record = validateCompletionRecord(record ?? stored)
  if (record.work_issue !== Number(issue) || [...new Set([...Object.keys(stored), ...Object.keys(record)])].some(key => JSON.stringify(stored[key]) !== JSON.stringify(record[key]))) throw new DependencyError('completion does not match the immutable trusted record')
  if (['cancelled', 'superseded', 'returned', 'failed'].includes(record.outcome)) return { status: 'cancelled-or-superseded', workType: scope.workType, record }
  if (scope.workType === 'structural') {
    if (record.outcome !== 'live_verified') return { status: 'awaiting-live-proof', workType: scope.workType, record }
    const history = outcomeHistory(comments, Number(issue))
    const events = history.events.filter(event => event.event_type === 'live_verified' && !history.superseded.includes(event.event_id))
    if (!history.valid || !events.length) throw new DependencyError('structural completion has no valid live acceptance history')
    for (const event of events) {
      const checked = verifyOutcomeAcceptance({ issue: Number(issue), evidenceRef: event.evidence_urls?.[0] }, { ...io, parseScope: parseQueueScope }).completion
      if (Object.keys(checked).some(key => checked[key] !== record[key])) throw new DependencyError('structural completion differs from rederived acceptance')
    }
  } else if (['repo-maintenance', 'documentation'].includes(scope.workType) && scope.route === 'repo-maintenance' && record.outcome === 'merged') {
    if (scope.liveAssertion) return { status: 'awaiting-live-proof', workType: scope.workType, record }
    verifyMergedWorkRecord(record, io, { verifyLinkage: true })
    if (record.migration_versions.length) throw new DependencyError('maintenance completion cannot claim structural migrations')
  } else return { status: 'unverifiable', workType: scope.workType, record }
  return { status: work.state === 'open' ? 'delivered-closeout-pending' : 'complete', workType: scope.workType, record,
    ...(work.state === 'open' ? { ownerAction: { issue: Number(issue), action: 'opener closes accepted issue', url: `https://github.com/${REPO}/issues/${issue}` } } : {}) }
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
  } finally { releaseMutexOnExit(ownerSha,io) }
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
  } finally { releaseMutexOnExit(ownerCommit, io) }
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
      if (io.readRef(EXCLUSIVE_REFS.merge)) throw new LaneError(`a guarded merge is active; production promotion must wait; ${leaseHoldText('merge',io)}`)
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
      const parsedClaims = claims.map((claim)=>({ ...claim, lease:parseAuthorLease(claim.body) }))
      const matching = parsedClaims.filter((claim)=>!claim.lease.legacy && claim.lease.branch===pr.head.ref && claim.lease.active)
      // Refusals name exactly what the lane saw, so a CI-only mismatch (#2958) is diagnosable from the log.
      const claimsSeen = () => `; PR head branch compared: ${JSON.stringify(pr.head.ref ?? null)}; open claims seen (${parsedClaims.length}): ${parsedClaims.map((claim)=>`#${claim.number} branch=${JSON.stringify(claim.lease.branch ?? null)} active=${claim.lease.active}${claim.lease.legacy ? ' legacy' : ''}`).join(', ') || 'none'}${claims.listing ? `; ${claims.listing}` : ''}`
      if (kind !== 'merge' && matching.length !== 1) throw new LaneError(`exclusive lane requires exactly one live author claim for the pull-request branch${claimsSeen()}`)
      if (kind === 'merge' && matching.length > 1) throw new LaneError(`exclusive merge lane requires at most one live author claim for the pull-request branch${claimsSeen()}`)
      if (kind === 'merge' && matching.length === 0) {
        let files
        try { files = io.getPrFiles?.(metadata.pr) } catch (error) { throw new LaneError(`exclusive merge lane cannot read pull request files (${error.message})`) }
        if (!Array.isArray(files)) throw new LaneError('exclusive merge lane cannot establish whether the pull request changes migrations')
        const changesMigration = files.some((file) => /^supabase\/migrations\/[^/]+\.sql$/.test(String(file?.path ?? file?.filename ?? '')))
        if (changesMigration) throw new LaneError(`exclusive merge lane requires exactly one live author claim for a pull request that changes migrations${claimsSeen()}`)
      }
      if (kind === 'merge' && pr.base?.sha !== io.mainSha?.()) {
        // #2758 (orchestrator marker, 2026-09-11): main may move independently
        // of this pull request. `check-main-tip-freshness.mjs --contains` is the
        // authoritative judge and already ran in guarded-migration-merge before
        // this acquisition. Re-ask the same question here so a direct
        // --acquire-merge cannot skip it. Any classification failure stays a
        // refusal: unreadable git, conflicting file overlap, or a changed
        // pull-request diff all refuse exactly as before.
        const tip = io.mainSha?.()
        const verdict = tip ? classifyBranchFreshness({ headSha: metadata.headSha, tipSha: tip }) : null
        if (!verdict?.ok) throw new LaneError('pull request is not based on the current main tip')
      }
      if (kind === 'merge' && io.readRef(EXCLUSIVE_REFS.production)) throw new LaneError(`production promotion is active; merges are frozen; ${leaseHoldText('production',io)}`)
      if (kind === 'merge') assertNoPromotionFreeze(io, metadata.now ?? new Date())
    }
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    acquireRef(ref, ownerSha, io)
    return { kind, ref, ownerSha, requestId, holderId, generation: metadata.generation ?? 1 }
  } finally { releaseMutexOnExit(ownerSha,io) }
}

// PROMOTION MERGE FREEZE. Owner instruction, Albert Hazan in his chat
// 2026-10-02 (verbatim): "assign someone to pause merges during production runs".
// A session (or the governed rehearsal) sets this bounded, create-only ref BEFORE
// drawing the production-risk assessment, so main stops moving between the
// assessment and the production run. It blocks --acquire-merge (and therefore the
// guarded merge and merge-queue gate) and repository-maintenance authorization.
// It never blocks preview or production. It expires by TTL on its own, so it can
// never wedge merges; the production job's always() cleanup releases it.
export const PROMOTION_FREEZE_REF = 'refs/db-coordination/promotion-freeze'
export const PROMOTION_FREEZE_MAX_TTL_MINUTES = 180
const PROMOTION_FREEZE_HEADER = /^db-coordination promotion-freeze-record pr=(\d+) issue=(\d+)$/

export function readPromotionFreeze(io = githubIo, now = new Date()) {
  const sha = io.readRef(PROMOTION_FREEZE_REF)
  if (!sha) return null
  let message = null
  try { message = io.readCommitMessage?.(sha) ?? null } catch { message = null }
  const [header, ...rest] = String(message ?? '').split('\n')
  const match = PROMOTION_FREEZE_HEADER.exec(header ?? '')
  let body = null
  try { body = JSON.parse(rest.join('\n').trim()) } catch { body = null }
  // An unreadable freeze fails CLOSED (treated as live) and is cleared only by
  // --release-promotion-freeze, never guessed away.
  if (!match || !body || Number.isNaN(Date.parse(body.expiresAt)) || !String(body.owner ?? '').trim()) return { sha, unreadable: true, expired: false }
  return { sha, pr: Number(match[1]), issue: Number(match[2]), owner: String(body.owner ?? ''), acquiredAt: body.acquiredAt, expiresAt: body.expiresAt, expired: Date.parse(body.expiresAt) <= new Date(now).valueOf() }
}

function promotionFreezeText(freeze) {
  return freeze.unreadable ? `promotion freeze ${PROMOTION_FREEZE_REF} at ${freeze.sha} is unreadable; clear it with --release-promotion-freeze --pr <n> (any positive PR number releases an unreadable record)` : `promotion merge freeze held by ${JSON.stringify(freeze.owner)} for PR #${freeze.pr} (issue #${freeze.issue}) until ${freeze.expiresAt}`
}

export function assertNoPromotionFreeze(io = githubIo, now = new Date()) {
  const freeze = readPromotionFreeze(io, now)
  if (freeze && !freeze.expired) throw new LaneError(`merges are paused for a production run; ${promotionFreezeText(freeze)}`)
}

export function acquirePromotionFreeze({ issue, pr, owner, ttlMinutes, now = new Date() }, io = githubIo) {
  issue = Number(issue); pr = Number(pr); ttlMinutes = Number(ttlMinutes)
  if (!Number.isInteger(issue) || issue < 1 || !Number.isInteger(pr) || pr < 1) throw new LaneError('--acquire-promotion-freeze requires --issue <n> and --pr <n>')
  if (!String(owner ?? '').trim()) throw new LaneError('--acquire-promotion-freeze requires --owner <text>')
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > PROMOTION_FREEZE_MAX_TTL_MINUTES) throw new LaneError(`--acquire-promotion-freeze requires --ttl-minutes between 1 and ${PROMOTION_FREEZE_MAX_TTL_MINUTES}`)
  const at = new Date(now), expiresAt = new Date(at.valueOf() + ttlMinutes * 60000).toISOString()
  const record = io.makeOwnerCommit(`db-coordination promotion-freeze-record pr=${pr} issue=${issue}\n${JSON.stringify({ owner: String(owner), acquiredAt: at.toISOString(), expiresAt })}`)
  const ownerSha = io.makeOwnerCommit(`db-coordination promotion-freeze pr=${pr} request=${randomUUID()}`)
  acquireMutex(ownerSha, io)
  try {
    const existing = readPromotionFreeze(io, at)
    if (existing && !existing.expired) throw new LaneError(`a promotion merge freeze is already set; ${promotionFreezeText(existing)}`)
    requireOwnedRef(MUTEX_REF, ownerSha, io)
    if (existing) releaseOwnedRef(PROMOTION_FREEZE_REF, existing.sha, io)
    acquireRef(PROMOTION_FREEZE_REF, record, io)
    return { ref: PROMOTION_FREEZE_REF, sha: record, issue, pr, owner: String(owner), acquiredAt: at.toISOString(), expiresAt, replacedExpired: Boolean(existing) }
  } finally { releaseMutexOnExit(ownerSha, io) }
}

/** Release by owner, or by source PR (the production job's always() cleanup). */
export function releasePromotionFreeze({ owner, pr, now = new Date() }, io = githubIo) {
  if (!String(owner ?? '').trim() && !(Number(pr) > 0)) throw new LaneError('--release-promotion-freeze requires --owner <text> or --pr <n>')
  const ownerSha = io.makeOwnerCommit(`db-coordination promotion-freeze release=${randomUUID()}`)
  acquireMutex(ownerSha, io)
  try {
    const existing = readPromotionFreeze(io, now)
    if (!existing) return { ref: PROMOTION_FREEZE_REF, released: false, reason: 'no promotion freeze is set' }
    const ownerMatches = Boolean(String(owner ?? '').trim()) && existing.owner === String(owner)
    const prMatches = Number(pr) > 0 && existing.pr === Number(pr)
    if (!existing.unreadable && !ownerMatches && !prMatches) {
      if (existing.expired) return { ref: PROMOTION_FREEZE_REF, released: false, reason: `an expired freeze belongs to ${JSON.stringify(existing.owner)}; it no longer blocks merges` }
      throw new LaneError(`refusing to release another holder's freeze; ${promotionFreezeText(existing)}`)
    }
    requireOwnedRef(MUTEX_REF, ownerSha, io)
    releaseOwnedRef(PROMOTION_FREEZE_REF, existing.sha, io)
    return { ref: PROMOTION_FREEZE_REF, released: true, owner: existing.owner ?? null, pr: existing.pr ?? null }
  } finally { releaseMutexOnExit(ownerSha, io) }
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
    if(io.readRef(EXCLUSIVE_REFS.production))throw new LaneError(`production promotion is active; repository-maintenance authorization is frozen; ${leaseHoldText('production',io)}`)
    assertNoPromotionFreeze(io)
    const pr=io.getPr(prNumber),baseSha=String(pr?.base?.sha??'')
    if(!pr?.head?.sha||pr.head.sha!==headSha)throw new LaneError('repository-maintenance authorization head SHA does not match the live pull request')
    if(pr?.base?.ref!=='main'||pr?.base?.repo?.full_name!==REPO)throw new LaneError('repository-maintenance authorization requires the protected main base in this repository')
    if(!/^[0-9a-f]{40}$/.test(baseSha))throw new LaneError('repository-maintenance authorization base SHA is unreadable')
    let files
    try{files=io.comparePullRequestFiles(baseSha,headSha)}catch(error){throw new LaneError(`repository-maintenance authorization cannot read the exact base-to-head comparison (${error.message})`)}
    const verdict=classifyLightweightMergePullRequestFiles(files)
    if(!verdict.documentsOnly)throw Object.assign(new LaneError(`repository-maintenance authorization refused: ${verdict.reason}`),{notApplicable:true})
    const finalPr=io.getPr(prNumber)
    if(finalPr?.base?.sha!==baseSha||finalPr?.base?.ref!=='main'||finalPr?.base?.repo?.full_name!==REPO||finalPr?.head?.sha!==headSha)throw new LaneError('repository-maintenance authorization pull request moved during exact comparison')
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    if(io.readRef(EXCLUSIVE_REFS.production))throw new LaneError(`production promotion began during repository-maintenance authorization; ${leaseHoldText('production',io)}`)
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
      // #3505: the advisory MUST use a context name distinct from any real grant
      // context so a green advisory can never satisfy or stand in for one. The
      // real grant posts to MERGE_SELF_CONTEXT; the workflow check run is named
      // "Documents-only merge authorization". This advisory is a third thing.
      const ADVISORY_CONTEXT=MERGE_ADVISORY_CONTEXT
      const refusalContext=options.revokeRequiredStatus||replacesLightweightSuccess||statusHistoryUnreadable?context:ADVISORY_CONTEXT
      // #2838: an ordinary code PR is not a failure of this advisory check. Report it as
      // not applicable (green) so red here always means a genuine refusal. Revocations of
      // the required context above still post failure and still fail the job.
      const notApplicable=error?.notApplicable===true&&refusalContext!==context
      try{io.postCommitStatus(headSha,notApplicable
        ?{state:'success',context:refusalContext,description:'Not applicable: code change; guarded code checks required',targetUrl}
        :{state:'failure',context:refusalContext,description:'Lightweight authorization refused; guarded code checks required',targetUrl})}
      catch(statusError){throw new LaneError(`${error.message}; refusal status also failed: ${statusError.message}`)}
      if(notApplicable){
        operationError=null
        return {pr:prNumber,headSha,context:refusalContext,documentsOnly:false,notApplicable:true,reason:error.message,coordinationRef:MUTEX_REF,structuralStage:null}
      }
    }
    throw error
  }
  finally{
    try{releaseMutexOnExit(ownerSha,io,{strict:true})}
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
    else if (a === '--acquire-promotion-freeze') out.acquirePromotionFreeze = true
    else if (a === '--release-promotion-freeze') out.releasePromotionFreeze = true
    else if (a === '--ttl-minutes') out.ttlMinutes = Number(next(i++))
    else if (a === '--authorize-repository-maintenance-status') out.authorizeRepositoryMaintenanceStatus = true
    else if (a === '--revoke-required-status') out.revokeRequiredStatus = true
    else if (a === '--admit-issue') out.admitIssue = Number(next(i++))
    else if (a === '--resolve-admitted-issue-for-pr') out.resolveAdmittedIssueForPr = Number(next(i++))
    else if (a === '--outcome-status') out.outcomeStatus = Number(next(i++))
    else if (a === '--advance-outcome') out.advanceOutcome = next(i++)
    else if (a === '--repair-outcome-history') out.repairOutcomeHistory = Number(next(i++))
    else if (a === '--complete-outcome') out.completeOutcome = Number(next(i++))
    else if (a === '--audit') out.audit = true
    else if (a === '--queue-audit') out.queueAudit = true
    else if (a === '--complete-work') out.completeWork = true
    else if (a === '--set-scope-status') out.setScopeStatus = true
    else if (a === '--assert-exclusive') out.assertExclusive = next(i++)
    else if (a === '--recover-exclusive') out.recoverExclusive = next(i++)
    else if (a === '--release-exclusive') out.releaseExclusive = next(i++)
    else if (a === '--holder-id') out.holderId = next(i++)
    else if (a === '--generation') out.generation = Number(next(i++))
    else if (a === '--apply-recovery') out.applyRecovery = true
    else if (a === '--report-file') out.reportFile = argv[++i]
    else if (a === '--return-issue') out.returnIssue = Number(argv[++i])
    else if (a === '--assign-reviewer') out.assignReviewer = true
    else if (a === '--delivery-preflight') out.deliveryPreflight = true
    else if (['--preflight-input','--evidence-bundle','--prior-evidence-bundle','--prior-preflight-record','--integration-facts','--changed-files-file','--delivery-preflight-record'].includes(a)) { out[a.slice(2).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = next(i); i++ }
    else if (a === '--exclude-reviewer') out.excludeReviewer = true
    else if (a === '--reinstate-reviewer-exclusion') out.reinstateReviewerExclusion = true
    else if (a === '--activate-review-cutover') out.activateReviewCutover = true
    else if (a === '--replace-failed-reviewer') out.replaceFailedReviewer = true
    else if (a === '--release-failed-reviewer') out.releaseFailedReviewer = true
    else if (a === '--probe-silent-reviewer') out.probeSilentReviewer = true
    else if (a === '--reclaim-silent-reviewer') out.reclaimSilentReviewer = true
    else if (a === '--request-reviewer') out.assignReviewer = true
    else if (a === '--reviewer-capacity') out.reviewerCapacity = true
    else if (a === '--reviewer-start-watch-leases') out.reviewerStartWatchLeases = true
    else if (a === '--reap-abandoned-review-leases') out.reapAbandonedReviewLeases = true
    else if (a === '--archive-old-review-verdicts') out.archiveOldReviewVerdicts = true
    else if (a === '--archive-threshold') out.archiveThreshold = Number(argv[++i])
    else if (a === '--reviewer-preflight') out.reviewerPreflight = true
    else if (a === '--cleanup-stale') out.cleanup = true
    else if (a === '--recover-completed-claim') out.recoverCompletedClaim = Number(next(i++))
    else if (a === '--recovery-review-issue') out.recoveryReviewIssue = Number(next(i++))
    else if (a === '--recovery-review-pr') out.recoveryReviewPr = Number(next(i++))
    else if (a === '--recovery-review-head') out.recoveryReviewHead = next(i++)
    else if (a === '--release-claim') out.releaseClaim = next(i), i++
    // #2301 Step 3. --retire is a MODIFIER on --release-claim, never a primary
    // operation of its own: retirement is a kind of release, and making it a
    // separate command would let somebody retire a claim without going through
    // the release-path checks (owner match, no open PR on the branch, mutex).
    // The decision is typed at the boundary so an unknown word can never reach
    // the permanent, immutable tombstone payload.
    else if (a === '--retire') {
      const decision = next(i); i++
      if (!RETIREMENT_DECISIONS.includes(decision)) throw new LaneError(`--retire must be one of ${RETIREMENT_DECISIONS.join(', ')}`)
      out.retire = decision
    }
    else if (['--successor-issue','--preservation'].includes(a)) { out[a.slice(2).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = next(i); i++ }
    else if (a === '--owner-decision' || a === '--review-approval') throw new LaneError(`${a} is retired (#3675, owner ruling 2026-09-28: never ask a human to approve). A dirty or remote retirement takes --preservation artifact:<rescue commit or patch object>, and the allocator-assigned AI reviewer's durable exact-head APPROVE for --pr/--head-sha is read automatically`)
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
    else if (a === '--repair-resumed-claim') out.repairResumedClaim = true
    else if (a === '--flow-audit') out.flowAudit = true
    else if (a === '--reconcile-flow') out.reconcileFlow = true
    else if (a === '--abandonment-audit') out.abandonmentAudit = true
    else if (a === '--prepare-preview-dispatch') out.preparePreviewDispatch = Number(next(i++))
    else if (a === '--repair-preview-ready') out.repairPreviewReady = next(i++)
    else if (a === '--terminalize-historical-preview-ready') out.terminalizeHistoricalPreviewReady = next(i++)
    else if (a === '--json') out.json = true
    else if (['--propose-train','--validate-train','--authorize-train','--dispatch-train','--close-train','--verify-train-dispatch','--train-proof','--authorization-digest','--target-identity','--target','--commit-sha','--allowlist','--failed-applied-prefix'].includes(a)) { out[a.slice(2).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = next(i); i++ }
    else if (a === '--reissue-merged-stranded-claim') out.reissueMergedClaim = true
    else if (a === '--rebind-claim-worktree') out.rebindClaimWorktree = true
    else if (a === '--transfer-claim-author') out.transferClaimAuthor = true
    else if (a === '--reversion-active-claim' || a === '--supersede-active-claim-version') out.reversionClaim = true
    else if (a === '--confirm-stale') out.confirmStale = true
    else if (/^--acquire-(preview|preview-recovery|preview-rehearsal|merge|production)$/.test(a)) out.acquireExclusive = a.slice(10)
    else if (/^--release-(preview|preview-recovery|preview-rehearsal|merge|production)$/.test(a)) out.releaseExclusive = a.slice(10)
    else if (['--task','--owner','--branch','--worktree','--issue','--pr','--head-sha','--owner-sha','--expected-sha','--released-claim','--active-claim','--source-pr','--target-pr','--target-branch','--target-worktree','--target-url','--description','--claim-number','--failed-sequence','--failure-code','--failing-check','--old-version','--reviewer','--reviewer-allowlist','--status','--wrapper','--version-pr-map','--blocked-on','--review-slot','--reason','--evidence','--evidence-sha','--verdict','--findings-ref','--replacement-sequence','--run-id','--artifact-id','--artifact-digest','--manifest-digest','--database-preview-classification-file','--worktree-state','--recovery-artifact','--hold-reason','--prompt','--prompt-file','--old-owner','--new-owner','--abandonment-issue','--authorization-chat-id','--authorization-quote-file'].includes(a)) { out[a.slice(2).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = next(i); i++ }
    else if(a==='--confirm-local-dependency-unfixable')out.confirmLocalDependencyUnfixable=true
    else if(a==='--skip-doctor')out.skipDoctor=true
    else if(a==='--confirm-no-verdict')out.confirmNoVerdict=true
    else if(a==='--confirm-no-artifact')out.confirmNoArtifact=true
    else if(a==='--unstarted')out.unstarted=true
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
    if(String(process.env.SHARED_DB_MERGED_PR_ISSUE_BINDING??'').trim())io=withMergedPrIssueBinding(io,process.env.SHARED_DB_MERGED_PR_ISSUE_BINDING)
    const primaryKeys=['proposeTrain','validateTrain','authorizeTrain','dispatchTrain','closeTrain','verifyTrainDispatch','authorizeRepositoryMaintenanceStatus','resolveAdmittedIssueForPr','outcomeStatus','advanceOutcome','repairOutcomeHistory','completeOutcome','recoverMutex','reconcileFlow','abandonmentAudit','preparePreviewDispatch','repairPreviewReady','terminalizeHistoricalPreviewReady','flowAudit','recoverSplit','expandClaim','expandClaimFromIssue','renewClaim','recoverExpiredClaim','relinquishAuthorLease','resumeAuthorLease','repairResumedClaim','reissueMergedClaim','reversionClaim','rebindClaimWorktree','transferClaimAuthor','replaceFailedReviewer','releaseFailedReviewer','probeSilentReviewer','reclaimSilentReviewer','reapAbandonedReviewLeases','archiveOldReviewVerdicts','reviewerCapacity','reviewerStartWatchLeases','excludeReviewer','reinstateReviewerExclusion','reviewerPreflight','deliveryPreflight','assignReviewer','activateReviewCutover','acquireExclusive','releaseExclusive','acquirePromotionFreeze','releasePromotionFreeze','claim','returnIssue','queueAudit','assertExclusive','recoverExclusive','completeWork','setScopeStatus','recoverCompletedClaim','releaseClaim','releaseDuplicateClaim','cleanup','audit']
    const selectedPrimary=primaryKeys.filter((key)=>Object.prototype.hasOwnProperty.call(o,key))
    const hasAdmission=Object.prototype.hasOwnProperty.call(o,'admitIssue')
    if(selectedPrimary.length>1)throw new LaneError(`choose exactly one primary operation; received ${selectedPrimary.join(', ')}`)
    if(hasAdmission&&(!Number.isInteger(o.admitIssue)||o.admitIssue<=0))throw new LaneError('--admit-issue requires a positive issue number')
    const numericPrimary=new Set(['resolveAdmittedIssueForPr','outcomeStatus','repairOutcomeHistory','completeOutcome','preparePreviewDispatch','returnIssue'])
    if(selectedPrimary.length===1&&numericPrimary.has(selectedPrimary[0])&&(!Number.isInteger(o[selectedPrimary[0]])||o[selectedPrimary[0]]<=0))throw new LaneError(`--${selectedPrimary[0].replace(/[A-Z]/g,(value)=>`-${value.toLowerCase()}`)} requires a positive number`)
    const admissionCombined=new Set(['claim','assignReviewer','replaceFailedReviewer','preparePreviewDispatch','acquireExclusive','advanceOutcome'])
    if(hasAdmission&&selectedPrimary.length===1&&!admissionCombined.has(selectedPrimary[0]))throw new LaneError(`--admit-issue cannot be combined with --${selectedPrimary[0].replace(/[A-Z]/g,(value)=>`-${value.toLowerCase()}`)}`)
    if(o.databasePreviewClassificationFile)io=withDatabasePreviewClassificationFile(io,o.databasePreviewClassificationFile)
    // DELIVERY PREFLIGHT (#2728). Both paths run before any GitHub read or write.
    const readJsonArg=(file,label)=>{try{return JSON.parse(readFileSync(file,'utf8'))}catch{throw new LaneError(`${label} is unreadable: ${file}`)}}
    const preflightAdapters=()=>({readEvidenceRegistration:trustedEvidenceRegistryReader(process.env.DELIVERY_EVIDENCE_REGISTRY_ROOT)})
    if(o.deliveryPreflight){
      if(!o.evidenceBundle)throw new LaneError('--delivery-preflight requires --evidence-bundle')
      if(!o.preflightInput&&!o.priorPreflightRecord)throw new LaneError('--delivery-preflight requires --preflight-input, or a prior record to reuse')
      const gate=runDeliveryPreflightGate({currentBundle:readJsonArg(o.evidenceBundle,'--evidence-bundle'),priorBundle:o.priorEvidenceBundle?readJsonArg(o.priorEvidenceBundle,'--prior-evidence-bundle'):null,priorRecord:o.priorPreflightRecord?readJsonArg(o.priorPreflightRecord,'--prior-preflight-record'):null,changedFiles:o.changedFilesFile?readJsonArg(o.changedFilesFile,'--changed-files-file'):[],integration:o.integrationFacts?readJsonArg(o.integrationFacts,'--integration-facts'):null,input:o.preflightInput?readJsonArg(o.preflightInput,'--preflight-input'):null},preflightAdapters())
      if(!gate.reused&&!o.preflightInput)throw new LaneError(`the prior delivery preflight cannot be reused (${gate.plan.reason}); pass --preflight-input to re-run it`)
      console.log(JSON.stringify(gate,null,2));return 0
    }
    // APPROVED-MIGRATION TRAIN (#2729, popcre/ai-devops#401 Step 6).
    if(o.proposeTrain||o.validateTrain||o.authorizeTrain||o.dispatchTrain||o.closeTrain||o.verifyTrainDispatch){
      console.log(JSON.stringify(runTrainCommand(o,trainIo(io),readJsonArg),null,2));return 0
    }
    if(o.assignReviewer&&(o.deliveryPreflightRecord||o.evidenceBundle)){
      if(!o.deliveryPreflightRecord||!o.evidenceBundle)throw new LaneError('--assign-reviewer needs both --delivery-preflight-record and --evidence-bundle')
      assertDeliveryPreflightBeforeReview({record:readJsonArg(o.deliveryPreflightRecord,'--delivery-preflight-record'),bundle:readJsonArg(o.evidenceBundle,'--evidence-bundle'),issue:o.issue,pr:o.pr,headSha:o.headSha,priorBundle:o.priorEvidenceBundle?readJsonArg(o.priorEvidenceBundle,'--prior-evidence-bundle'):null,changedFiles:o.changedFilesFile?readJsonArg(o.changedFilesFile,'--changed-files-file'):[],integration:o.integrationFacts?readJsonArg(o.integrationFacts,'--integration-facts'):null},preflightAdapters())
    }
    const previewAdmission=databasePreviewAdmission(o,io)
    if(previewAdmission.decision==='NO_DATABASE_PREVIEW'){console.log(JSON.stringify(previewAdmission,null,2));return 0}
    if(o.acquirePromotionFreeze){console.log(JSON.stringify(acquirePromotionFreeze({issue:o.issue,pr:o.pr,owner:o.owner,ttlMinutes:o.ttlMinutes},io),null,2));return 0}
    if(o.releasePromotionFreeze){if(o.ttlMinutes!==undefined)throw new LaneError('--ttl-minutes applies only to --acquire-promotion-freeze');console.log(JSON.stringify(releasePromotionFreeze({owner:o.owner,pr:o.pr},io),null,2));return 0}
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
        const holdReason=o.holdReason===undefined?undefined:namedHold(o.issue,o.holdReason,io)
        return advanceOutcome({issue:Number(o.issue),state:o.advanceOutcome,actor:o.owner??'manage-migration-author-lanes',timestamp:new Date().toISOString(),evidenceUrls:[o.evidence],holdReason},io)
      })
      console.log(JSON.stringify(result,null,2));return 0
    }
    if(o.repairOutcomeHistory){
      if(!o.owner)throw new LaneError('--repair-outcome-history requires --owner <actor>')
      if(!o.reason)throw new LaneError('--repair-outcome-history requires --reason "<why this ledger is being repaired>"')
      const result=withAuthorMutex('outcome-repair',io,o,(ownerSha)=>{
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        return repairOutcomeHistory({issue:o.repairOutcomeHistory,actor:o.owner,reason:o.reason,timestamp:now.toISOString(),evidenceUrls:o.evidence?[o.evidence]:[]},{...io,
          commentIssue:(...args)=>{requireOwnedRef(MUTEX_REF,ownerSha,io);return io.commentIssue(...args)},
        })
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
      const result=reconcileFlow(io.flowSnapshot(now),io.orchestratorFlowAdapter());console.log(JSON.stringify(result,null,2))
      // PER DOMAIN, DETERMINISTICALLY. Exit 2 means "some domain's evidence was
      // absent or unreadable" -- either domain on its own is enough, and neither
      // can be masked by the other being fine. Written as an explicit scan of the
      // domain statuses rather than a test of the aggregate word, so that adding a
      // third domain later cannot quietly start exiting 0 on its failures.
      const domains=[result.capacity?.status,result.preview?.status]
      return domains.includes('UNVERIFIABLE')?2:0
    }
    // #2301 Step 5. THE SCHEDULED ENTRY POINT. Same reconciler, same JSON, but
    // the adapter is stripped of its ability to write before the reconciler ever
    // sees it -- so this command cannot mutate even if a marker were present,
    // and no scheduled workflow ever needs to call --reconcile-flow. The exit
    // code separates "a claim expired and somebody must decide" from "the
    // instrument could not read the state", because an hourly job that reported
    // both as one number would train its operator to ignore both.
    if(o.abandonmentAudit){
      // A REFUSAL ON THIS COMMAND IS "UNVERIFIABLE", NOT "EXPIRED". Every other
      // command can let a throw fall through to the generic handler, which exits
      // 2. For this one, 2 already means "an expired author lane was found", so
      // the generic handler announced every read failure as an expiry: the
      // scheduled run on 2026-09-16 logged `REFUSED: claim title must identify
      // exactly one work issue...` and then `Expired author lane(s) detected`,
      // which is a report about lanes that the instrument never managed to read.
      // An instrument that could not read is exactly the unverifiable case, and
      // unverifiable outranks expiry, so the refusal is mapped to 3 here. The
      // message is still printed in full; only the code it is filed under moves.
      try{
        if(typeof io.orchestratorFlowAdapter!=='function')throw new LaneError('reconcile runtime adapter is unavailable')
        if(io.previewLedger===undefined)io={...io,previewLedger:()=>livePreviewLedger({workflowPreviewRef:process.env.PREVIEW_PROJECT_REF})}
        const result=reconcileFlow(io.flowSnapshot(now,{capacityOnly:true}),reportOnlyFlowIo(io.orchestratorFlowAdapter()),{capacityOnly:true})
        console.log(JSON.stringify(result,null,2))
        return abandonmentAuditExit(result)
      }catch(error){
        console.error(`REFUSED: ${error.message}`)
        return AUDIT_EXIT_UNVERIFIABLE
      }
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
    if(o.repairResumedClaim){console.log(JSON.stringify(repairResumedClaim({...o,claim:o.claimNumber??o.claim},now,io),null,2));return 0}
    if(o.reissueMergedClaim){console.log(JSON.stringify(reissueMergedStrandedClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.rebindClaimWorktree){console.log(JSON.stringify(rebindClaimWorktree({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.transferClaimAuthor){console.log(JSON.stringify(transferClaimAuthor({...o,claim:o.claimNumber,authorizationQuote:o.authorizationQuoteFile?readFileSync(o.authorizationQuoteFile,'utf8').trim():''},now,io),null,2));return 0}
    if(o.reversionClaim){console.log(JSON.stringify(reversionActiveClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    // A REPLACEMENT draw spends reviewer capacity exactly like a first draw, so the
    // same readiness pre-conditions apply to it (governed review of PR #3338). Wiring
    // the guard to only one of the two draw paths left the waste class #2998 was filed
    // to stop wide open on the other.
    if(o.replaceFailedReviewer){assertReviewerDrawHandoff(o,io,{path:'replace'});const result=replaceFailedReviewer({...o,slot:o.reviewSlot!==undefined?Number(o.reviewSlot):1,admissionOptions:io.enforceAdmission===true?o:null},io);console.log(JSON.stringify(result,null,2));return 0}
    if(o.releaseFailedReviewer){console.log(JSON.stringify(releaseFailedReviewer({...o,slot:o.reviewSlot!==undefined?Number(o.reviewSlot):1},io),null,2));return 0}
    if(o.probeSilentReviewer){console.log(JSON.stringify(probeSilentReviewer({...o,slot:o.reviewSlot!==undefined?Number(o.reviewSlot):1},now,io),null,2));return 0}
    if(o.reclaimSilentReviewer){console.log(JSON.stringify(reclaimSilentReviewer({...o,slot:o.reviewSlot!==undefined?Number(o.reviewSlot):1},now,io),null,2));return 0}
    if(o.reapAbandonedReviewLeases){console.log(JSON.stringify(reapAbandonedReviewLeases(o,now,io),null,2));return 0}
    if(o.archiveOldReviewVerdicts){console.log(JSON.stringify(archiveOldReviewVerdicts(o,now,io),null,2));return 0}
    if(o.reviewerStartWatchLeases){console.log(JSON.stringify(reviewerStartWatchLeases(io,now),null,2));return 0}
    if(o.reviewerCapacity){console.log(JSON.stringify(reviewerCapacityReport(io,now),null,2));return 0}
    if(o.excludeReviewer){console.log(JSON.stringify(excludeReviewerForPr(o,io),null,2));return 0}
    if(o.reinstateReviewerExclusion){console.log(JSON.stringify(reinstateReviewerExclusion(o,io),null,2));return 0}
    if(o.reviewerPreflight){console.log(JSON.stringify(reviewerExecutionPreflight(o,io),null,2));return 0}
    if(o.assignReviewer){assertReviewerDrawHandoff(o,io,{path:'assign'});console.log(JSON.stringify(assignWithMutexRetry({issue:o.issue,pr:o.pr,headSha:o.headSha,slot:o.reviewSlot!==undefined?Number(o.reviewSlot):1,reviewerAllowlist:o.reviewerAllowlist,admissionOptions:io.enforceAdmission===true?o:null},io),null,2));return 0}
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
    // #2787: the queue audit lists open issues exactly once and reuses the rows.
    const auditRows = o.queueAudit && typeof io.openIssueRows === 'function' ? io.openIssueRows() : null
    const claims = auditRows ? io.openClaims((endpoint) => { if (!/\/issues\?state=open&per_page=100$/.test(endpoint)) throw new LaneError(`queue audit reused the open issue listing for an unexpected endpoint ${endpoint}`); return auditRows }) : io.openClaims()
    if (o.returnIssue) { console.log(JSON.stringify(returnIssueToOwner(o.returnIssue, io), null, 2)); return 0 }
    if (o.queueAudit) {
      const issues = auditRows ? workIssuesFromRows(auditRows) : io.openWorkIssues()
      const openNumbers = auditRows ? openIssueNumbersFromRows(auditRows) : io.openIssueNumbers()
      const outcomeStates=new Map()
      for(const issue of issues){
        let scope=null
        try{scope=parseQueueScope(issue.body)}catch{continue}
        if(scope?.workType!=='structural'||!STRUCTURAL_ROUTES.includes(scope.route))continue
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
        for (const declaration of scope?.dependencies ?? []) referenced.add(declaration)
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
      let result = buildDynamicQueues(issues, claims, now, openNumbers, dependencyStates, claimPullStates,new Set(),outcomeStates)
      const authoredOnMain = new Set()
      if (result.dispatchable.length && io.closedClaimsForWork && io.branchPulls && io.getPrFiles && io.treeFiles && io.mainSha && io.mergeCommitInMain) {
        const main = io.mainSha()
        const mainVersions = new Set(io.treeFiles(main).filter((file)=>/^supabase\/migrations\/\d{14}_/.test(file)).map((file)=>path.basename(file).slice(0,14)))
        const checked = new Set(), filesOnce = memoizePrFiles(io)
        // Removing one already-authored issue can expose the next item in its
        // collision queue. Iterate to a fixed point and inspect each issue at
        // most once so a deeper queue cannot hide another completed authoring.
        while (true) {
          const fresh = result.dispatchable.filter((issue)=>!checked.has(issue))
          if (!fresh.length) break
          for (const issue of fresh) {
            checked.add(issue)
            const completed = io.closedClaimsForWork(issue).some((claim)=>closedClaimAuthoredOnMain(claim,now,mainVersions,filesOnce))
            if (completed) authoredOnMain.add(issue)
          }
          if (!fresh.some((issue)=>authoredOnMain.has(issue))) break
          result = buildDynamicQueues(issues, claims, now, openNumbers, dependencyStates, claimPullStates, authoredOnMain,outcomeStates)
        }
      }
      for (const issue of result.urgentWaitingCapacity ?? []) {
        const exists=(io.issueComments?.(issue)??[]).flatMap((comment)=>{try{return parseEventComment(comment?.body??'')}catch{return[]}})
          .some((event)=>event.event_type==='urgent_waiting_capacity'&&event.result==='succeeded')
        if(!exists&&io.commentIssue){
          io.commentIssue(issue,formatEventComment(coordinationEvent({eventType:'urgent_waiting_capacity',workIssue:issue,actor:'queue-audit',timestamp:now.toISOString(),service_class:'urgent-application',...(urgentHoldReason(result,issue)?{hold_reason:urgentHoldReason(result,issue)}:{}),detail:urgentHoldDetail(result,issue)})))
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
          const address = item.exit !== 'reject'
            ? ''
            : item.returnedCopyOf
              // The classification stays REJECT — it is correct — but this row
              // has already been returned once and must not be returned again
              // (issue #2836).
              ? ` -> ALREADY RETURNED (${item.returnedCopyOf}): do NOT run --return-issue; hand it to the owning session`
              : (item.returnTo ? ` -> ${item.returnTo}` : ' -> NO RETURN ADDRESS: add `return_to: owner/repo` before returning it')
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
      // #3199 Phase B2: the self-service lane is admitted structural work that
      // deliberately never refills the orchestrator. Printed so the audit can
      // SEE it and so nobody re-adds these issues to the refill list, the same
      // visibility discipline as the OUTSIDE ORCHESTRATOR block above.
      if (result.selfServiceLane?.length) {
        console.error('SELF-SERVICE ADDITIVE LANE: structural work admitted without orchestrator triage (issue #3199). The orchestrator never dispatches, refills or reviews these rows; each author claims the lane, draws reviewers and dispatches the guarded merge through the same guarded machinery.')
        for (const item of result.selfServiceLane) console.error(`  #${item.issue} ${item.route} — ${item.title}`)
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
    if (o.setScopeStatus) {
      const result = setScopeStatus({ issue: Number(o.issue), status: o.status, reason: o.reason, mutexAttempts: o.mutexAttempts }, now, io)
      console.log(JSON.stringify(result, null, 2))
      console.error(result.idempotent ? `Issue #${result.issue} was already ${result.status}; nothing was written.` : `Issue #${result.issue} db-work-scope status: ${result.previousStatus} -> ${result.status}. The audit comment is on the issue.`)
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
    if(o.recoverCompletedClaim){
      if(!o.reportFile)throw new LaneError('--recover-completed-claim requires --report-file <reviewed manifest>')
      const manifest=parseStrictJson(readFileSync(o.reportFile,'utf8'))
      if(manifest.claim!==o.recoverCompletedClaim)throw new LaneError('recovery command claim differs from manifest')
      const result=withAuthorMutex('claim-release',io,o,(ownerSha)=>recoverCompletedForeignClaim(manifest,{now,reviewIssue:o.recoveryReviewIssue,reviewPr:o.recoveryReviewPr,reviewHeadSha:o.recoveryReviewHead},{...io,
        repository:REPO,
        assertMutex:()=>requireOwnedRef(MUTEX_REF,ownerSha,io),
        clock:()=>new Date(),
        machineName:()=>hostname(),
        signatureEngine:()=>{const e=authorEngineFromEnv(process.env.SHARED_DB_AUTHOR_ENGINE);return e.charAt(0).toUpperCase()+e.slice(1)},
        recoveryCodeUnchanged(toolSha,mainSha){
          return recoveryCodeUnchangedAt({toolSha,mainSha,extraPaths:RECOVERY_CODE_PATHS,readOnlyGit:args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})})
        },
        sessionAuthority:()=>io.orchestratorFlowAdapter().resolveMarker(),
        recoverySnapshot(sha){
          if(execFileSync('git',['cat-file','-t',sha],{encoding:'utf8'}).trim()!=='commit')return null
          const names=execFileSync('git',['ls-tree','-r','--name-only',sha],{encoding:'utf8'}).trim().split('\n')
          if(names.sort().join('|')!=='catalog.json|pending.patch|pending.sql')return null
          return Object.fromEntries(names.map(name=>[name,execFileSync('git',['show',`${sha}:${name}`],{encoding:'utf8'})]))
        },
        foreignSnapshot(worktree,path){
          const status=execFileSync('git',['-C',worktree,'status','--porcelain','--untracked-files=all'],{encoding:'utf8'}).split('\n').filter(Boolean)
          return {changedPaths:status.filter(x=>!x.startsWith('??')).map(x=>x.slice(3)),untracked:status.filter(x=>x.startsWith('??')),sql:readFileSync(`${worktree}/${path}`,'utf8'),patch:execFileSync('git',['-C',worktree,'diff','--binary','--',path],{encoding:'utf8'})}
        },
        sourceMigration(sha,path){return execFileSync('git',['show',`${sha}:${path}`],{encoding:'utf8'})},
        reviewedManifestMatches({reviewIssue,reviewPr,reviewHeadSha,manifest}){
          const scope=parseQueueScope(io.getIssue(reviewIssue)?.body??'')
          if(scope?.workType!=='repo-maintenance')return false
          const linked=io.closingIssuesForPr(reviewPr)
          if(linked.length!==1||Number(linked[0].number)!==reviewIssue)return false
          const pr=io.getPr(reviewPr)
          if(pr.head?.sha!==reviewHeadSha)return false
          assertDurableReviewApproval(reviewIssue,reviewPr,reviewHeadSha,io,{includeArchived:true})
          const record=io.getFileAt(`config/completed-claim-recovery/${manifest.claim}.json`,reviewHeadSha)
          return recoveryDigest(JSON.stringify(parseStrictJson(record)))===recoveryDigest(JSON.stringify(manifest))
        },
        freshRecoveryCatalog(){return JSON.parse(execFileSync(process.execPath,['scripts/query-completed-claim-catalog.mjs'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))},
        readRecoveryReceipt(sha){const message=io.getCommit(sha)?.message??'';const prefix='db-coordination completed-foreign-claim-release ';if(!message.startsWith(prefix))throw new LaneError('invalid recovery receipt');return JSON.parse(message.slice(prefix.length))},
      }))
      console.log(JSON.stringify(result,null,2));return 0
    }
    if (o.releaseClaim) {
      if (!o.confirmFinished || !o.owner) throw new LaneError('--release-claim requires exact --owner and --confirm-finished')
      const requestId=randomUUID(), ownerSha=io.makeOwnerCommit(`db-coordination claim-release ${requestId}`)
      acquireMutex(ownerSha,io)
      try {
        const fresh=io.openClaims(), claim=fresh.find((x)=>String(x.number)===String(o.releaseClaim))
        if(!claim)throw new LaneError(`claim #${o.releaseClaim} is not open`)
        const lease=parseAuthorLease(claim.body,now)
        if(lease.owner!==o.owner)throw new LaneError(wrongOwnerMessage({claim:o.releaseClaim,onRecord:lease.owner,supplied:o.owner,command:laneCommand(['--release-claim',String(o.releaseClaim),'--owner',JSON.stringify(String(lease.owner??'')),'--confirm-finished'])}))
        if((io.openPulls?.() ?? io.prSources()).some((pr)=>(pr.head?.ref ?? pr.branch)===lease.branch))throw new LaneError(`claim branch ${lease.branch} still has an open pull request`)
        // #2301 Step 3 -- TERMINAL RETIREMENT.
        //
        // ORDERING IS THE WHOLE GUARANTEE: the tombstone is created BEFORE the
        // issue is closed. Closing first and writing the ref second leaves a
        // window in which the claim is closed with no terminal record, and that
        // is precisely the state a reopen resurrects -- closed work that nothing
        // marks as over. Create-first fails safe in the other direction instead:
        // a tombstone with a still-open claim refuses every mutation and is
        // repaired by re-running the identical command, which is idempotent.
        //
        // Retirement is OPT-IN. Without --retire this stays an ordinary release,
        // unchanged, because an ordinary release frees capacity and says nothing
        // about whether the work is finished.
        if(o.retire){
          if(lease.legacy)throw new LaneError('a legacy claim cannot be terminally retired; reconcile its lease first')
          const worktreeState=lease.worktreeState??o.worktreeState
          if(!WORKTREE_STATES.includes(worktreeState))throw new LaneError(`--retire requires --worktree-state to be one of ${WORKTREE_STATES.join(', ')}`)
          if(!o.pr||!o.headSha)throw new LaneError('--retire requires the exact --pr and --head-sha the retired work reached')
          const record={
            schema_version:RETIREMENT_SCHEMA_VERSION,
            claim:Number(claim.number),
            pr:Number(o.pr),
            head_sha:String(o.headSha).toLowerCase(),
            branch:lease.branch,
            version:lease.version,
            worktree:lease.worktree,
            worktree_state:worktreeState,
            decision:o.retire,
            evidence:o.evidence??'',
            successor_issue:o.successorIssue?Number(o.successorIssue):null,
            created_at:now.toISOString(),
          }
          if(RETIREMENT_PRESERVATION_STATES.includes(worktreeState)){
            // #3675: unmerged work is preserved first (a dereferenceable git
            // object in this repository), and the allocator-assigned AI
            // reviewer's durable exact-head APPROVE must exist for the retired
            // PR head. Both are proven here, never typed in as prose.
            if(!o.preservation)throw new LaneError(`--retire from a ${worktreeState} worktree requires --preservation artifact:<rescue commit or patch object>`)
            const preservation=validateImmutableArtifactReference(o.preservation,'--preservation')
            if(!/^artifact:[0-9a-f]{40,64}$/i.test(preservation))throw new LaneError('--preservation must be an immutable object hash this repository can dereference')
            let resolved
            try{resolved=typeof io.verifyArtifact==='function'?io.verifyArtifact(preservation):null}catch(error){throw new LaneError(`preservation artifact verification is ambiguous: ${error.message}`)}
            if(!resolved)throw new LaneError(`preservation artifact ${preservation} cannot be dereferenced`)
            const verdicts=assertDurableReviewApproval(claimWorkIssue(claim),o.pr,record.head_sha,io,{includeArchived:true})
            const approve=(verdicts??[]).find((row)=>row.verdict==='APPROVE')
            // #3806: the validated verdict object itself, never a re-read of its live name,
            // which an archived verdict no longer has.
            const approveSha=approve?String(approve.sha??'').toLowerCase():''
            if(!/^[0-9a-f]{40}$/.test(approveSha))throw new LaneError(`no dereferenceable durable APPROVE verdict for pull request #${o.pr} at ${record.head_sha}`)
            record.preservation=preservation
            record.review_approval=`artifact:${approveSha}`
          }
          requireOwnedRef(MUTEX_REF,ownerSha,io)
          const tombstone=createRetirementTombstone(record,io)
          requireOwnedRef(MUTEX_REF,ownerSha,io)
          io.closeClaim(claim.number, RETIREMENT_CLOSE_REASON)
          console.log(JSON.stringify({claim:Number(claim.number),version:lease.version,retired:true,ref:tombstone.ref,sha:tombstone.sha,idempotent:tombstone.idempotent},null,2))
          return 0
        }
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        io.closeClaim(claim.number, CLAIM_CLOSE_REASONS.explicitRelease)
      } finally { releaseMutexOnExit(ownerSha,io) }
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
        if(lease.owner!==o.owner)throw new LaneError(wrongOwnerMessage({claim:claim.number,onRecord:lease.owner,supplied:o.owner,command:laneCommand(['--release-duplicate-claim',String(claim.number),'--owner',JSON.stringify(String(lease.owner??'')),'--confirm-finished'])}))
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
      } finally { releaseMutexOnExit(ownerSha,io) }
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
      // #2301 Step 3. An OPEN claim whose version carries a tombstone was
      // reopened after its terminal record was written. Every mutation path
      // already refuses it; this is what makes the resurrection visible instead
      // of only surfacing when somebody tries to use the claim. ONE bounded ref
      // listing serves the whole audit -- never one read per claim.
      const reopened=retiredReopenedClaims(claims,now,io)
      for(const row of reopened)console.error(`RETIRED-REOPENED #${row.claim}: version ${row.version} was terminally retired (${row.decision}) and this claim is open again; it can never be resumed, renewed, expanded, or merged${row.successorIssue?`. Successor work is issue #${row.successorIssue}`:'. A successor needs a fresh claim, branch, worktree and migration version'}`)
      return malformed.length||reopened.length ? 2 : 0
    }
    throw new LaneError('choose --admit-issue, --claim, --audit, --queue-audit, --abandonment-audit, --outcome-status, --repair-outcome-history, --complete-outcome, --return-issue, --cleanup-stale, --activate-review-cutover, or an exclusive-lane command')
  } catch (error) { console.error(`REFUSED: ${error.message}`); return 2 }
}

// ISSUE #2491 -- preview apply evidence never matched an already-applied version.
// The preview-apply workflow names BOTH its instance binding's `appliedCommit`
// and its `preview-migration-apply-<sha>` artifact after the commit it actually
// checked out and applied (`steps.commit.outputs.sha`, and
// `name: preview-migration-apply-${{ inputs.commit_sha }}`) -- which for an
// ordinary claim apply is the CLAIM head, not `run.head_sha` (the ref the
// workflow_dispatch ran from). This function compared both against
// `run.head_sha`, so for any version already applied under its claim head the
// two could never agree and `--prepare-preview-dispatch` always refused.
// Fixed on the READER side: when the caller proves the claim head it is
// preparing, that exact head is accepted as the applied commit for a
// `rehearsalMode: 'claim'` binding, and the artifact name is derived from the
// applied commit the binding actually records. Nothing is relaxed -- the
// applied commit must still equal a 40-hex head the caller proved, the artifact
// must still belong to this run at this run head, and every other identity,
// digest, expiry and ledger-delta check is untouched. With no claimHeadSha the
// behaviour is byte-for-byte what it was.
export function validateOriginalPreviewApplyEvidence({issue,pr,versions,mergeCommitSha=null,claimHeadSha=null},io){
  const provenClaimHead=/^[0-9a-f]{40}$/i.test(String(claimHeadSha??''))?String(claimHeadSha).toLowerCase():null
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
  // Every rejected candidate records the first condition it failed (#2729,
  // #401 Step 6). Acceptance is unchanged: a rejection only explains a refusal.
  const rejections=[]
  const reject=(runId,lane,condition)=>{rejections.push(`run ${runId} (${lane}): ${condition}`)}
  for(const runId of runIds){const lane='preview-apply';try{
    const {run,jobs,artifacts,logs}=io.previewApplyRun(runId)
    const jobRows=Array.isArray(jobs?.jobs)?jobs.jobs:[]
    const terminal=(name,conclusion)=>jobRows.filter((job)=>job?.name===name&&job?.status==='completed'&&job?.conclusion===conclusion).length===1
    // A merged-main preview can be immutable and complete even when its downstream
    // automatic-production qualification fails. Admit that failed workflow only
    // when the complete job graph proves guards + preview succeeded, every
    // production job skipped, and the sole failure was the downstream dispatcher.
    const previewSucceededBeforeDownstreamFailure=run?.conclusion==='failure'&&Number(jobs?.total_count)===6&&jobRows.length===6&&terminal('SQL migration guards','success')&&terminal('preview','success')&&terminal('Automatic production qualification and dispatch','failure')&&terminal('Production apply review (immutable evidence + hard guards)','skipped')&&terminal('Production apply (automatic evidence gates)','skipped')&&terminal('production-dry-run','skipped')
    if(String(run?.id)!==String(runId)){reject(runId,lane,`run id is ${run?.id}`);continue}
    if(run?.path!=='.github/workflows/shared-supabase-migrations.yml'){reject(runId,lane,`workflow path is ${run?.path}`);continue}
    if(run?.event!=='workflow_dispatch'){reject(runId,lane,`event is ${run?.event}`);continue}
    if(run?.status!=='completed'){reject(runId,lane,`status is ${run?.status}`);continue}
    if(run?.conclusion!=='success'&&!previewSucceededBeforeDownstreamFailure){reject(runId,lane,`conclusion is ${run?.conclusion} without a proven preview success before a sole downstream dispatcher failure`);continue}
    if(run?.run_attempt!==1){reject(runId,lane,`run attempt is ${run?.run_attempt}, not 1`);continue}
    if(!/^[0-9a-f]{40}$/i.test(String(run?.head_sha??''))){reject(runId,lane,'head sha is not a 40-hex commit');continue}
    const bindings=String(logs).split(/\r?\n/).flatMap((line)=>{const start=line.indexOf('{"allowlist"'),end=line.lastIndexOf('}');if(start<0||end<start)return[];try{return[JSON.parse(line.slice(start,end+1))]}catch{return[]}}).filter((row)=>row.schema==='shared-db-preview-instance-binding/v1')
    if(bindings.length!==1){reject(runId,lane,`found ${bindings.length} preview instance bindings, not 1`);continue}
    const binding=bindings[0],allowlist=Array.isArray(binding.allowlist)?binding.allowlist.map(String).sort():[]
    if(String(binding.runId)!==String(runId)){reject(runId,lane,`binding run id is ${binding.runId}`);continue}
    if(binding.previewProjectRef!==PROJECT_REFS.preview){reject(runId,lane,`binding preview project is ${binding.previewProjectRef}, not ${PROJECT_REFS.preview}`);continue}
    if(!/^[0-9a-f]{40}$/i.test(String(binding.appliedCommit??''))){reject(runId,lane,'binding applied commit is not a 40-hex commit');continue}
    if(JSON.stringify(allowlist)!==JSON.stringify(expected)){reject(runId,lane,`binding allowlist ${JSON.stringify(allowlist)} is not the expected versions ${JSON.stringify(expected)}`);continue}
    // TWO IDENTITIES, NOT ONE (#2549). `run.head_sha` is the commit the WORKFLOW
    // was dispatched from; `binding.appliedCommit` is the commit the workflow
    // actually CHECKED OUT and rehearsed, and the artifact is named for that
    // checkout. A supported merged-main rehearsal may dispatch from current main
    // while checking out the earlier merged commit, so requiring the two to be
    // equal rejected valid evidence. They may differ only along one lineage:
    // merge commit <= applied checkout <= dispatch head. Every other check --
    // trusted workflow path/event/attempt, the artifact's own dispatch producer
    // (`artifact.workflow_run.head_sha === run.head_sha`, below), source PR and
    // merge-commit binding, digest, content manifest and exact ledger delta --
    // is unchanged. An unavailable comparison answers "not proven", never "ok".
    const dispatchHead=String(run.head_sha).toLowerCase(),appliedCheckout=String(binding.appliedCommit).toLowerCase()
    const atOrAfter=(base,head)=>base===head||['ahead','identical'].includes(io.compareCommits?.(base,head)?.status)
    const checkoutLineageProven=appliedCheckout===dispatchHead||Boolean(mergeCommitSha&&atOrAfter(String(mergeCommitSha).toLowerCase(),appliedCheckout)&&atOrAfter(appliedCheckout,dispatchHead))
    const mergedMainRehearsal=Boolean(mergeCommitSha&&binding.rehearsalMode==='merged-main-rehearsal'&&Number(binding.sourcePr)===Number(pr)&&String(binding.mergeCommitSha).toLowerCase()===String(mergeCommitSha).toLowerCase()&&checkoutLineageProven)
    // A byte-pinned restoration may have one genuine ordinary claim apply that
    // predates its merge.  That immutable apply is the reason the restoration
    // exists: replaying it would be unsafe.  Admit the distinct dispatch/applied
    // checkout only when every identity and the file now in the merge commit
    // exactly matches the restoration registry.  Unregistered claim runs retain
    // the old refusal, as do all malformed or partially pinned bundles.
    let pinnedClaimApply=false,claimRejection=null
    if(mergeCommitSha&&binding.rehearsalMode==='claim'){
      const records=expected.map((version)=>HISTORICAL_RESTORATIONS[version]).filter(Boolean)
      if(records.length===0||records.length!==expected.length)claimRejection=`claim-mode apply has ${records.length} of ${expected.length} versions in the historical restoration registry`
      else for(const record of records){
        if(String(record.previewApplyRun)!==String(runId)){claimRejection=`claim-mode apply run is not the registered restoration run ${record.previewApplyRun}`;break}
        if(record.previewAppliedCommit!==binding.appliedCommit){claimRejection=`claim-mode applied commit ${binding.appliedCommit} is not the registered ${record.previewAppliedCommit}`;break}
        if(record.previewProject!==binding.previewProjectRef){claimRejection=`claim-mode preview project ${binding.previewProjectRef} is not the registered ${record.previewProject}`;break}
        let validated
        try{validated=validateHistoricalRestorationFile(record.filename,io.getFileAt(record.filename,mergeCommitSha))}catch(error){claimRejection=`claim-mode migration hash mismatch: ${record.filename} at merge commit ${mergeCommitSha} does not match the registered restoration (${error?.message??error})`;break}
        if(validated!==record){claimRejection=`claim-mode migration hash mismatch: ${record.filename} at merge commit ${mergeCommitSha} resolves to a different restoration record`;break}
      }
      pinnedClaimApply=claimRejection===null
    }
    // #2729 / popcre/ai-devops#401 Step 6. A claim-mode apply that predates its
    // merge and that no registry record covers is accepted only when its own
    // archived artifact binds each migration's hash and the verifier proves that
    // hash equals the file at the merge commit. Run, attempt, project, binding,
    // artifact identity and digest checks all still apply. A partially
    // registered bundle keeps the old refusal.
    const hashBoundClaimApply=Boolean(mergeCommitSha&&binding.rehearsalMode==='claim'&&!pinnedClaimApply&&expected.every((version)=>!HISTORICAL_RESTORATIONS[version]))
    if(hashBoundClaimApply&&typeof io.verifyPreviewApplyArtifact!=='function'){reject(runId,lane,'claim-mode apply outside the restoration registry needs the archived artifact verifier to prove its migration hashes, and no verifier is available');continue}

    if(mergeCommitSha&&!mergedMainRehearsal&&!pinnedClaimApply&&!hashBoundClaimApply){reject(runId,lane,claimRejection??`binding is neither a merged-main rehearsal of pull request #${pr} at merge commit ${mergeCommitSha} with an applied checkout proven to sit between that merge commit and the run head, nor a registered claim-mode apply (rehearsal mode ${binding.rehearsalMode}, applied checkout ${binding.appliedCommit}, dispatch head ${run.head_sha})`);continue}
    // #2491: an ordinary claim apply binds the CLAIM head it checked out, which is
    // not the dispatch run head. Accept it only against the exact claim head the
    // caller proved, and only for a claim-mode binding.
    const provenClaimApply=Boolean(!mergeCommitSha&&provenClaimHead&&binding.rehearsalMode==='claim'&&String(binding.appliedCommit).toLowerCase()===provenClaimHead)
    if(!mergeCommitSha&&!provenClaimApply&&binding.appliedCommit!==run.head_sha){
      // Name the SPECIFIC reason the claim-head path did not accept this binding,
      // so a refusal never reads as "the head was wrong" when the real gate is
      // the binding mode. Acceptance is unchanged.
      const claimNote=!provenClaimHead?'no claim head was proven':binding.rehearsalMode!=='claim'?`binding rehearsal mode ${binding.rehearsalMode} is not claim`:`applied commit does not equal the proven claim head ${provenClaimHead}`
      reject(runId,lane,`binding applied commit ${binding.appliedCommit} is neither the run head ${run.head_sha} nor an accepted claim-head apply: ${claimNote}`)
      continue
    }
    // The ARTIFACT is named for the applied checkout, never for the dispatch head.
    const appliedCommit=(pinnedClaimApply||hashBoundClaimApply||mergedMainRehearsal||provenClaimApply)?binding.appliedCommit:run.head_sha

    const allRows=Array.isArray(artifacts?.artifacts)?artifacts.artifacts:[]
    // A fully proven automatic dispatcher may leave its review companion after
    // success or failure. Selecting it never substitutes for the proof below.
    const rows=selectPreviewArtifacts({run,jobs,artifacts})
    const tolerated=allRows.length===2&&rows.length===1
    if(tolerated?rows.length!==1:(Number(artifacts?.total_count)!==1||rows.length!==1)){reject(runId,lane,`run has ${artifacts?.total_count} artifacts (${allRows.length} listed), not exactly one preview apply artifact`);continue}
    if(rows[0].expired!==false){reject(runId,lane,'preview apply artifact is expired or its expiry is unknown');continue}
    if(!/^sha256:[0-9a-f]{64}$/i.test(String(rows[0].digest??''))){reject(runId,lane,'preview apply artifact has no sha256 digest');continue}
    if(rows[0].name!==`preview-migration-apply-${appliedCommit}`){reject(runId,lane,`artifact name ${rows[0].name} is not preview-migration-apply-${appliedCommit}`);continue}
    if(String(rows[0].workflow_run?.id)!==String(runId)){reject(runId,lane,`artifact belongs to run ${rows[0].workflow_run?.id}`);continue}
    if(rows[0].workflow_run?.head_sha!==run.head_sha){reject(runId,lane,`artifact head ${rows[0].workflow_run?.head_sha} is not the run head ${run.head_sha}`);continue}
    if(hashBoundClaimApply){
      const artifact=rows[0]
      let proof
      try{proof=io.verifyPreviewApplyArtifact({run,jobs,artifact,binding,versions:expected,previewProjectRef:PROJECT_REFS.preview,verificationCommit:mergeCommitSha})}
      catch(error){reject(runId,lane,`claim-mode archived artifact did not verify against merge commit ${mergeCommitSha}: ${String(error?.stderr||error?.message||error).trim()}`);continue}
      if(proof?.verified===true&&proof.runId===run.id&&proof.artifactId===artifact.id&&proof.artifactDigest===artifact.digest&&JSON.stringify(proof.versions)===JSON.stringify(expected))matches.push({type:lane,run_id:String(runId)})
      else reject(runId,lane,`claim-mode archived artifact receipt does not bind run ${run.id}, artifact ${artifact.id}, digest ${artifact.digest} and versions ${JSON.stringify(expected)} at merge commit ${mergeCommitSha}`)
      continue
    }
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
      const proof=io.verifyPreviewApplyArtifact({run,jobs,artifact,binding,versions:expected,previewProjectRef:PROJECT_REFS.preview,verificationCommit:mergeCommitSha??appliedCommit})
      if(proof?.verified===true&&proof.runId===run.id&&proof.artifactId===artifact.id&&proof.artifactDigest===artifact.digest&&JSON.stringify(proof.versions)===JSON.stringify(expected))matches.push({type:'preview-apply',run_id:String(runId)})
      else reject(runId,lane,`archived artifact receipt did not verify (verified=${proof?.verified}, run ${proof?.runId}, artifact ${proof?.artifactId}, digest ${proof?.artifactDigest}, versions ${JSON.stringify(proof?.versions)})`)
      continue
    }
    if(ledgerLines.length===0){reject(runId,lane,'logs have no named preview ledger delta step and no archived artifact verifier is available');continue}
    if(ledgerLines.filter((line)=>line==='### Preview ledger delta').length!==1){reject(runId,lane,'named ledger delta step does not hold exactly one ledger delta heading');continue}
    const ledgerAdded=ledgerLines.flatMap((line)=>{
      const match=/- added:\s+((?:\d{14})(?:,\s*\d{14})*)\s*$/.exec(line)
      return match?[match[1].split(',').map((value)=>value.trim()).sort()]:[]
    })
    if(ledgerAdded.length!==1||JSON.stringify(ledgerAdded[0])!==JSON.stringify(expected)){reject(runId,lane,`ledger delta added ${JSON.stringify(ledgerAdded)}, not exactly the expected versions ${JSON.stringify(expected)}`);continue}
    if(ledgerLines.filter((line)=>/- removed:\s+\(none\)\s*$/.test(line)).length!==1){reject(runId,lane,'ledger delta does not record exactly one "removed: (none)"');continue}
    matches.push({type:'preview-apply',run_id:String(runId)})
  }catch(error){/* An unreadable candidate cannot become evidence. */reject(runId,lane,`unreadable candidate: ${error?.message??error}`)}}
  for(const runId of runIds){const lane='preview-ledger-reconciliation';try{
    if(expected.length!==1){reject(runId,lane,`reconciliation evidence covers exactly one version, not ${expected.length}`);continue}
    const {run,artifacts,logs}=io.previewApplyRun(runId)
    if(String(run?.id)!==String(runId)){reject(runId,lane,`run id is ${run?.id}`);continue}
    if(run?.path!=='.github/workflows/preview-ledger-orphan-reconciliation.yml'){reject(runId,lane,`workflow path is ${run?.path}`);continue}
    if(run?.event!=='workflow_dispatch'){reject(runId,lane,`event is ${run?.event}`);continue}
    if(run?.status!=='completed'){reject(runId,lane,`status is ${run?.status}`);continue}
    if(run?.conclusion!=='success'){reject(runId,lane,`conclusion is ${run?.conclusion}`);continue}
    if(run?.run_attempt!==1){reject(runId,lane,`run attempt is ${run?.run_attempt}, not 1`);continue}
    if(!/^[0-9a-f]{40}$/i.test(String(run?.head_sha??''))){reject(runId,lane,'head sha is not a 40-hex commit');continue}
    const applied=/PREVIEW LEDGER RECONCILIATION APPLY OK: removed=(\d{14}) replacement=(\d{14})/.exec(String(logs))
    // Only a true rename preserves already-applied status. A same-version
    // rehearsal reset deletes the ledger row so the migration can run again;
    // it is therefore the opposite of immutable no-replay evidence.
    if(!applied){reject(runId,lane,'logs have no reconciliation apply OK line');continue}
    if(applied[1]===applied[2]){reject(runId,lane,`reconciliation is a same-version reset of ${applied[1]}, not a rename`);continue}
    if(applied[2]!==expected[0]){reject(runId,lane,`replacement ${applied[2]} is not the expected version ${expected[0]}`);continue}
    const exact=(name,value)=>new RegExp(`(?:^|\\s)${name}:\\s+${String(value)}(?:\\s|$)`,'m').test(String(logs))
    const unrecorded=[['ISSUE',issue],['SOURCE_PR',pr],['ORPHAN',applied[1]],['REPLACEMENT',applied[2]]].find(([name,value])=>!exact(name,value))
    if(unrecorded){reject(runId,lane,`logs do not record ${unrecorded[0]}: ${unrecorded[1]}`);continue}
    if(mergeCommitSha){const relation=io.compareCommits?.(mergeCommitSha,run.head_sha);if(!relation||!['ahead','identical'].includes(relation.status)){reject(runId,lane,`run head ${run.head_sha} is not at or after merge commit ${mergeCommitSha} (comparison ${relation?.status??'unavailable'})`);continue}}
    const rows=Array.isArray(artifacts?.artifacts)?artifacts.artifacts:[]
    if(Number(artifacts?.total_count)!==1||rows.length!==1){reject(runId,lane,`run has ${artifacts?.total_count} artifacts (${rows.length} listed), not exactly one`);continue}
    if(rows[0].expired!==false){reject(runId,lane,'reconciliation artifact is expired or its expiry is unknown');continue}
    if(rows[0].name!==`preview-ledger-orphan-reconciliation-${applied[1]}`){reject(runId,lane,`artifact name ${rows[0].name} is not preview-ledger-orphan-reconciliation-${applied[1]}`);continue}
    if(String(rows[0].workflow_run?.id)!==String(runId)){reject(runId,lane,`artifact belongs to run ${rows[0].workflow_run?.id}`);continue}
    if(rows[0].workflow_run?.head_sha!==run.head_sha){reject(runId,lane,`artifact head ${rows[0].workflow_run?.head_sha} is not the run head ${run.head_sha}`);continue}
    matches.push({type:'preview-ledger-reconciliation',run_id:String(runId),orphan_version:applied[1],replacement_version:applied[2]})
  }catch(error){/* An unreadable candidate cannot become evidence. */reject(runId,lane,`unreadable candidate: ${error?.message??error}`)}}
  if(matches.length!==1){
    const detail=runIds.length===0?'no candidate run was linked from the issue':`rejected candidates: ${rejections.length?rejections.join('; '):'none'}`
    throw new LaneError(`already-applied versions require exactly one validated immutable preview apply or ledger-reconciliation run; found ${matches.length}; ${detail}`)
  }
  return matches[0]
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2))
