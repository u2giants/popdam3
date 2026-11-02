#!/usr/bin/env node
import {hostname, homedir} from 'node:os'
import {parseStrictJson} from './proofs/shared-db-2870-observation.mjs'
import {recoveryCodeUnchangedAt} from './lib/claim-recovery-dependencies.mjs'
import {recoverCompletedForeignClaim,recoveryDigest,RECOVERY_CODE_PATHS} from './lib/lanes/completed-claim-recovery.mjs'
import { createStageEvidenceVerifier } from './lib/work-stage-evidence.mjs'
import { resolveEvidencePair, isEvidencePath } from './lib/agent-evidence-paths.mjs'
import { isProductionInertPath, classifyMainTip } from './check-main-tip-freshness.mjs'
import { contractHash, validateContract, validateCompletionReport, validatePullRequestCompletion, reconcileReportWithContract } from './agent-work-contract.mjs'
import { verifyGitEvidence, gitIo, readPublishedContractFromGit } from './agent-work-contract-git-evidence.mjs'

import { execFileSync } from 'node:child_process'
import { runGitHubCommand as sharedRunGitHubCommand, isTransientGitHubTransport, hostQuotaLatch, ghCommandTimeoutMs } from './lib/github-transport.mjs'
import { createTreeReader } from './lib/github-tree.mjs'
import { reviewCallerEnvironment } from './lib/reviewer-caller-env.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants, closeSync, existsSync, fstatSync, openSync, readFileSync, renameSync, writeFileSync, lstatSync, realpathSync, readdirSync } from 'node:fs'
import { readZipEntries } from './lib/zip-entries.mjs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gatherOpenPrObjects, normalizeObject, parseClaimBlock } from './check-dispatch-collision.mjs'
import { dependencyIssue, parseDependencyDeclarations, classifyDependencies, findCompletionRecord, findDependencyCycles, validateCompletionRecord, validateDependencyDeclaration, COMPLETION_FENCE, DependencyError } from './lib/work-dependencies.mjs'
import { assertLease, evaluateRecovery, formatLeaseMessage, parseLeaseMessage, recoveredLeaseMetadata, LeaseError } from './lib/exclusive-lease.mjs'
import { coordinationEvent, formatEventComment, parseEventComment, auditTimeline, renderTimeline } from './db-coordination-events.mjs'
import { reconcileFlow, persistInitialReady, preparePreviewDispatch, repairPreviewReady, terminalizeReady, readyRecord, MODE_SEQUENCE, parseAbandonmentAudit, reportOnlyFlowIo, abandonmentAuditExit, AUDIT_EXIT_UNVERIFIABLE } from './db-flow/reconcile.mjs'
import { MERGE_SELF_CONTEXT } from './lib/merge-self-context.mjs'
import { selectPreviewArtifacts } from './db-flow/preview-artifact-selection.mjs'
import { requalifiedPreviewRun, requalifiedPreviewArtifact } from './db-flow/requalified-preview-runs.mjs'
import { currentRepository, isThisRepositoryOrHistorical, isTrustedOperatorComment, repositoryCommentApiPath } from './lib/repository-identity.mjs'
import { readRequiredCheckContexts } from './lib/required-check-readback.mjs'
import { readSessionId, resolveSessionAuthority, sessionAuthorityRefusal } from './lib/session-authority.mjs'
import { authorityReadEnv } from './lib/authority-token-read.mjs'
import { buildEvidenceBundle, canonicalJson, sha256 } from './db-flow/evidence-bundle.mjs'
import { assertDeliveryPreflightBeforeReview, runDeliveryPreflightGate } from './db-flow/delivery-preflight-gate.mjs'
import { trustedEvidenceRegistryReader } from './db-flow/delivery-preflight.mjs'
import { bindSenderPreviewClassification, databasePreviewRequiredFromEvidenceBundle, selectPreviewRoute, validatePreviewClassification } from './db-flow/select-preview-route.mjs'
import { PROJECT_REFS } from './db-flow/read-preview-ledger.mjs'; import { verdictOpensLine as sharedVerdictOpensLine, evidenceTiedToHead as sharedEvidenceTiedToHead, isApprovalFor as sharedIsApprovalFor, isVerdictFor as sharedIsVerdictFor, anyVerdictFor as sharedAnyVerdictFor } from './lib/review-verdict.mjs'
import { REVIEW_VERDICT_REF_PREFIX, REVIEW_VERDICT_REPLACEMENT_REF_PREFIX, REVIEW_VERDICTS, assertFindingsRefForPr, findingsDigest, formatVerdictMessage, parseVerdictCommit, parseVerdictRef, validateVerdictArtifact, verdictRef } from './lib/review-verdict-artifact.mjs'
import { changedPathsFromPullRequestFiles, classifyChangedPaths, classifyLightweightMergePullRequestFiles } from './lib/documents-only-change.mjs'
import { HISTORICAL_RESTORATIONS, validateHistoricalRestorationFile } from './historical-migration-restorations.mjs'
import { resolveGeneratedTypesConsumerBinding, matchesGeneratedTypesWorkflowRun, selectGeneratedTypesArtifactEntries } from './generated-types-proof.mjs'
import { AdmissionError, SERVICE_CLASSES, CHANGE_TYPES, NON_STRUCTURAL_CHANGE_TYPES, STRUCTURAL_ROUTES, parseImpactBlock, evaluateAdmission, inspectPrStructuralChange, structuralWritesMatch, structuralWritesCovered } from './db-flow/admission.mjs'
import { assertNamedHold, conflicts, describeLeaseHolder, formatHoldReason, HoldReasonError } from './lib/hold-reason.mjs'
import { OUTCOME_STATES, OutcomeError, advanceOutcome, completeOutcome, verifyOutcomeAcceptance, outcomeEvent, outcomeHistory, repairOutcomeHistory } from './db-flow/outcome-lifecycle.mjs'
import { assertPaidReviewCapacity, pauseActualReviewFailure, derivePaidContentProof, RETRYABLE_RELEASED_FAILURE_CODES, paidStart } from './lib/lanes/review-circuit-breaker.mjs'
export { RETRYABLE_RELEASED_FAILURE_CODES }
const paidBudgetContractCaches=new WeakMap()
import { createPhaseTrace, formatPhaseTraceSummary } from './lib/lanes/phase-trace.mjs'
import { isContentPreservingRefresh, prContentDigest, verifiedEvidencePaths } from './lib/pr-content-equivalence.mjs'
import { wrapperEmitsGovernedVerdict } from './lib/reviewer-capabilities.mjs'
import { classifyBranchFreshness } from './check-main-tip-freshness.mjs'
import { MigrationTrainError, TRAIN_REF_PREFIX, assertDispatchMatchesTrain, assertRecordedTrain, assertTrainProductionEvidence, proposeTrain, trainRecordRef, transitionTrain, validateTrain } from './db-flow/migration-train.mjs'
import { assertDrawPromptContract, collectHandoffCollisions, preDrawHandoffChecks } from './lib/reviewer-draw-readiness.mjs'
// Cohesive modules split out of this file (issue #3726). This entrypoint keeps
// the CLI, githubIo and the shared wire state, and re-exports every public name.
import { MERGE_ADVISORY_CONTEXT, pendingRequiredContexts, selectNewestCommitStatus, REPO, AUTHOR_CAPACITY_STATES, AUTHORABLE_CAPACITY_STATES, WORKTREE_STATES, DEFAULT_LEASE_HOURS, MAX_AUTHOR_LEASE_HOURS, AUTHOR_CHECKIN_INTERVAL_MINUTES, MUTEX_STALE_AFTER_MS, MUTEX_REF, MUTEX_RECOVERY_ACTIVE_REF, RETIRED_CLAIM_REF_PREFIX, RETIREMENT_SCHEMA_VERSION, RETIREMENT_RECORD_PREFIX, RETIREMENT_DECISIONS, RETIREMENT_REF_ROW_LIMIT, REVIEW_CURSOR_REF, REVIEW_FAILURE_REF_PREFIX, REVIEW_REPLACEMENT_REF_PREFIX, REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_ACTIVE_REF_PREFIX, REVIEW_ACTIVE_PARALLEL_REF_PREFIX, REVIEW_SILENCE_PROBE_REF_PREFIX, REVIEW_SILENCE_RELEASE_REF_PREFIX, REVIEW_QUEUE_REF_PREFIX, REVIEW_EXCLUSION_REF_PREFIX, REVIEW_EXCLUSION_REASONS, RETIRED_EXCLUSION_REASONS, RECORDABLE_EXCLUSION_REASONS, REVIEW_REINSTATEMENT_REF_PREFIX, REINSTATABLE_EXCLUSION_REASONS, REVIEW_RETURN_REF_PREFIX, REVIEW_RETIRED_VERDICT_REF_PREFIX, REVIEW_ACTIVE_CUTOVER_REF, REVIEW_SILENT_RECLAIM_REQUEST_LIMIT, REVIEW_SILENT_RECLAIM_MUTEX_SECTION_RESERVE, REVIEW_QUEUE_ASSIGNMENT_REQUEST_LIMIT, REVIEW_CAPACITY_REQUEST_LIMIT, REVIEW_QUOTA_RESERVE, REVIEW_LEASE_SUSPECT_HOURS, SILENCE_MIN_AGE_HOURS, SILENCE_CONFIRM_HOURS, REVIEW_STARTED_REF_PREFIX, UNSTARTED_MIN_AGE_HOURS, reviewStartedMarkerRef, reviewStartMarkerPresent, REVIEW_QUEUE_TTL_HOURS, REVIEW_QUEUE_ROW_LIMIT, REVIEW_REF_ROW_LIMIT, markReviewRefListingRefusal, isReviewRefListingRefusal, markLeaseReadFailure, isLeaseReadFailure, isCommandSizeFailure, RETIREMENT_LEGACY_SCHEMA_VERSIONS, RETIREMENT_PRESERVATION_FIELDS, RETIREMENT_PRESERVATION_STATES, REPO_OWNER, REPO_NAME } from './lib/lanes/constants.mjs'
export { MERGE_ADVISORY_CONTEXT, pendingRequiredContexts, selectNewestCommitStatus, REPO, AUTHOR_CAPACITY_STATES, AUTHORABLE_CAPACITY_STATES, WORKTREE_STATES, DEFAULT_LEASE_HOURS, MAX_AUTHOR_LEASE_HOURS, AUTHOR_CHECKIN_INTERVAL_MINUTES, MUTEX_STALE_AFTER_MS, MUTEX_REF, MUTEX_RECOVERY_ACTIVE_REF, RETIRED_CLAIM_REF_PREFIX, RETIREMENT_SCHEMA_VERSION, RETIREMENT_RECORD_PREFIX, RETIREMENT_DECISIONS, RETIREMENT_REF_ROW_LIMIT, REVIEW_CURSOR_REF, REVIEW_FAILURE_REF_PREFIX, REVIEW_REPLACEMENT_REF_PREFIX, REVIEW_ASSIGNMENT_REF_PREFIX, REVIEW_ACTIVE_REF_PREFIX, REVIEW_ACTIVE_PARALLEL_REF_PREFIX, REVIEW_SILENCE_PROBE_REF_PREFIX, REVIEW_SILENCE_RELEASE_REF_PREFIX, REVIEW_QUEUE_REF_PREFIX, REVIEW_EXCLUSION_REF_PREFIX, REVIEW_EXCLUSION_REASONS, RETIRED_EXCLUSION_REASONS, RECORDABLE_EXCLUSION_REASONS, REVIEW_REINSTATEMENT_REF_PREFIX, REINSTATABLE_EXCLUSION_REASONS, REVIEW_RETURN_REF_PREFIX, REVIEW_RETIRED_VERDICT_REF_PREFIX, REVIEW_ACTIVE_CUTOVER_REF, REVIEW_SILENT_RECLAIM_REQUEST_LIMIT, REVIEW_SILENT_RECLAIM_MUTEX_SECTION_RESERVE, REVIEW_QUEUE_ASSIGNMENT_REQUEST_LIMIT, REVIEW_CAPACITY_REQUEST_LIMIT, REVIEW_QUOTA_RESERVE, REVIEW_LEASE_SUSPECT_HOURS, SILENCE_MIN_AGE_HOURS, SILENCE_CONFIRM_HOURS, REVIEW_STARTED_REF_PREFIX, UNSTARTED_MIN_AGE_HOURS, reviewStartedMarkerRef, reviewStartMarkerPresent, REVIEW_QUEUE_TTL_HOURS, REVIEW_QUEUE_ROW_LIMIT, REVIEW_REF_ROW_LIMIT, markReviewRefListingRefusal, isReviewRefListingRefusal, markLeaseReadFailure, isLeaseReadFailure, isCommandSizeFailure, RETIREMENT_LEGACY_SCHEMA_VERSIONS, RETIREMENT_PRESERVATION_FIELDS, RETIREMENT_PRESERVATION_STATES }
import { REVIEWERS, RETIRED_REVIEWERS, QUARANTINED_REVIEWERS, reviewerReadsRepository, reviewerEmitsGovernedVerdict, reviewerKnownNonReading, OVERFLOW_REVIEWERS, ACTIVE_REVIEWERS, canonicalReviewerAllowlist, ENGINE_REVIEWER_EXCLUSION, reviewersForOrchestrator, reviewerAdmissionAllowed, reconcilePreflightRows, allocatableReviewers, reviewerAllowlistSuffix, inheritReviewerAllowlist, isReviewerAllowlistSuperset, sameReviewerAllowlist, reviewerAllowed, assertReviewerAllowlistConsistency, inheritReturnedReviewerAllowlist, REVIEWER_FALLBACK_PROVIDERS, authorEngineFromEnv, knownAuthorEngines, orderedReviewers, readSessionIdOrUnknown, drawOrder } from './lib/lanes/reviewer-roster.mjs'
export { REVIEWERS, RETIRED_REVIEWERS, QUARANTINED_REVIEWERS, reviewerReadsRepository, reviewerEmitsGovernedVerdict, reviewerKnownNonReading, OVERFLOW_REVIEWERS, ACTIVE_REVIEWERS, canonicalReviewerAllowlist, ENGINE_REVIEWER_EXCLUSION, reviewersForOrchestrator, reviewerAdmissionAllowed, reconcilePreflightRows, allocatableReviewers, inheritReviewerAllowlist, isReviewerAllowlistSuperset, sameReviewerAllowlist, REVIEWER_FALLBACK_PROVIDERS, authorEngineFromEnv, knownAuthorEngines, orderedReviewers }
import { EXCLUSIVE_REFS, REVIEW_TARGET_SUPERSEDED, SLOT_INDEPENDENCE_CONFLICT, TERMINAL_FAILURE_CODES, QUEUE_STATUSES, QUEUE_WORK_TYPES, QUEUE_ROUTES, ROUTES_BY_WORK_TYPE, NON_STRUCTURAL_EXITS, OUTSIDE_ORCHESTRATOR_EXITS, RETURN_ADDRESS_PATTERN, RETURNED_MARKER, RETURNED_COPY_MARKER, LEGACY_RETURNED_COPY_PATTERN, RETURNED_COPY_HEADER_LINES, returnedCopyProvenance, requiresReturnAddress, queueExit, parseQueueScope, COORDINATION_LABELS, WORK_LABEL, buildDynamicQueues, returnIssueToOwner, reviewTargetSuperseded, CLAIM_FIRST_ROUTES, readDependencyStates } from './lib/lanes/queue-routing.mjs'
export { EXCLUSIVE_REFS, REVIEW_TARGET_SUPERSEDED, SLOT_INDEPENDENCE_CONFLICT, TERMINAL_FAILURE_CODES, QUEUE_STATUSES, QUEUE_WORK_TYPES, QUEUE_ROUTES, ROUTES_BY_WORK_TYPE, NON_STRUCTURAL_EXITS, OUTSIDE_ORCHESTRATOR_EXITS, RETURN_ADDRESS_PATTERN, RETURNED_MARKER, RETURNED_COPY_MARKER, LEGACY_RETURNED_COPY_PATTERN, RETURNED_COPY_HEADER_LINES, returnedCopyProvenance, requiresReturnAddress, queueExit, parseQueueScope, COORDINATION_LABELS, WORK_LABEL, buildDynamicQueues, returnIssueToOwner, CLAIM_FIRST_ROUTES, readDependencyStates }
import { LaneError, validateClaimObjects, parseAuthorLease, assertLaneAvailable, claimBody, laneTreeReader } from './lib/lanes/claims.mjs'
export { LaneError, validateClaimObjects, parseAuthorLease, assertLaneAvailable, claimBody }
import { EXPECTED_REF_ABSENCE, EXPECTED_REF_PRESENCE, createRefWithReadback, deleteRefWithReadback, parseGitRemoteRefs, parseGitCommitBatch, readGitCommits, parseGhIncludeResponse, parseLinkHeader, hasNextPageLink, isConfirmedRefAbsence, currentMainMaxVersion, reviewRecordRefs, assertReviewerDrawIsWarranted, assertReviewerDrawReadiness, gh, hasLabel, ghJson, ghRefListing, reviewStateEntry, completeReviewStatePages, gitRemoteRefRows, GIT_COMMAND_TIMEOUT_MS, authorityGhJson } from './lib/lanes/github-wire.mjs'
export { EXPECTED_REF_ABSENCE, EXPECTED_REF_PRESENCE, createRefWithReadback, deleteRefWithReadback, parseGitRemoteRefs, parseGitCommitBatch, readGitCommits, parseGhIncludeResponse, parseLinkHeader, hasNextPageLink, isConfirmedRefAbsence, currentMainMaxVersion, reviewRecordRefs, assertReviewerDrawIsWarranted, assertReviewerDrawReadiness, GIT_COMMAND_TIMEOUT_MS }
import { LEGACY_GUARDED_CLEANUP_CLOSE_REASON, CLAIM_CLOSE_REASONS, RECOVERABLE_CLAIM_CLOSE_REASONS, RETIREMENT_CLOSE_REASON, retiredClaimRef, normalizeRetirementIdentity, validateRetirementRecord, formatRetirementRecord, parseRetirementRecord, isVersionRetired, readRetirementRecord, assertClaimNotRetired, assertRetirementIdentityAvailable, createRetirementTombstone, retiredReopenedClaims, matchesLiveProof, matchesGeneratedTypesProof, matchesGeneratedTypesArtifact, requireClaimCloseReason, assertReviewerDrawHandoff } from './lib/lanes/retirement.mjs'
export { LEGACY_GUARDED_CLEANUP_CLOSE_REASON, CLAIM_CLOSE_REASONS, RECOVERABLE_CLAIM_CLOSE_REASONS, RETIREMENT_CLOSE_REASON, retiredClaimRef, normalizeRetirementIdentity, validateRetirementRecord, formatRetirementRecord, parseRetirementRecord, isVersionRetired, readRetirementRecord, assertClaimNotRetired, assertRetirementIdentityAvailable, createRetirementTombstone, retiredReopenedClaims, matchesLiveProof, matchesGeneratedTypesProof, matchesGeneratedTypesArtifact, assertReviewerDrawHandoff }
import { flowCapacityFacts, deriveLiveNoDatabasePreview, databasePreviewAdmission, readDatabasePreviewClassificationFile, withDatabasePreviewClassificationFile, deriveLivePreviewCandidate, terminalizeHistoricalPreviewReady, livePreviewLedger } from './lib/lanes/preview-admission.mjs'
export { flowCapacityFacts, deriveLiveNoDatabasePreview, databasePreviewAdmission, readDatabasePreviewClassificationFile, withDatabasePreviewClassificationFile, deriveLivePreviewCandidate, terminalizeHistoricalPreviewReady }
import { REVIEWER_DOCTOR_TIMEOUT_MS, REVIEWER_PREFLIGHT_TIMEOUT_MS, parseDoctorFailures, summarizeDoctorOutput, unnamedDoctorFailure, doctorSpawnPlan, doctorTimeoutFailingChecks, pickExecutableCandidate, resolveCommandPath } from './lib/lanes/reviewer-doctor.mjs'
export { REVIEWER_DOCTOR_TIMEOUT_MS, REVIEWER_PREFLIGHT_TIMEOUT_MS, parseDoctorFailures, summarizeDoctorOutput, unnamedDoctorFailure, doctorSpawnPlan, doctorTimeoutFailingChecks, pickExecutableCandidate, resolveCommandPath }
import { leaseHoldText, holdFacts, namedHold, urgentHoldReason, urgentHoldDetail, acquireRef, readRefAfterWrite, readPrAfterPush, acquireMutex, requireOwnedRef, recoverStaleAuthorMutex, releaseOwnedRef, releaseMutexOnExit, releaseRefOnExit, releaseRefOverGit, noteHeldMutex, clearHeldMutex, releaseHeldMutexOnProcessExit } from './lib/lanes/holds-and-refs.mjs'
export { leaseHoldText, holdFacts, namedHold, urgentHoldReason, urgentHoldDetail, acquireRef, readRefAfterWrite, readPrAfterPush, acquireMutex, requireOwnedRef, recoverStaleAuthorMutex, releaseOwnedRef, releaseMutexOnExit, releaseRefOnExit, releaseRefOverGit, noteHeldMutex, clearHeldMutex, releaseHeldMutexOnProcessExit }
import { parseReviewCursor, sameVerdictRecord, recordReviewVerdict, nonVerdictReviewerReplacementCommand, nonReadingReviewerReplacementCommand, readReviewVerdicts, reviewActiveRef, parseReviewLease, parseReviewExclusion, REVIEW_EXCLUSION_GENERATION_LIMIT, reviewExclusionRef, reviewReinstatementRef, REVIEW_EXCLUSION_GENERATIONS, countDoctorPassLines, parseReviewReinstatement, parseReviewReturn, parseAssignmentRef, reviewReturnRef, readReviewReturns, retiredVerdictRef, reviewReturnsHeldBy, reviewLeaseRefForAssignment, activeLeaseRecordForAssignment, activeLeaseRecordForJob, reviewLeaseRefCandidates, leaseMatchesAssignment, leaseRefHoldsAssignment, resolveAssignmentLeaseRef, reviewerExclusions, retireVerdictsOrphanedByReturn, outstandingRetirements, reviewExclusionGenerationRows, liveExclusionGeneration } from './lib/lanes/review-records.mjs'
export { parseReviewCursor, sameVerdictRecord, recordReviewVerdict, nonVerdictReviewerReplacementCommand, nonReadingReviewerReplacementCommand, readReviewVerdicts, reviewActiveRef, parseReviewLease, parseReviewExclusion, REVIEW_EXCLUSION_GENERATION_LIMIT, reviewExclusionRef, reviewReinstatementRef, REVIEW_EXCLUSION_GENERATIONS, countDoctorPassLines, parseReviewReinstatement, parseReviewReturn, parseAssignmentRef, reviewReturnRef, readReviewReturns, retiredVerdictRef, reviewReturnsHeldBy }
import { findPrReviewAssignments, verdictOpensLine, evidenceTiedToHead, isApprovalFor, isVerdictFor, anyVerdictFor, gateAuthorizes, withArchivedVerdictMirror, DURABLE_VERDICT_REF_NAMESPACE, hasVerdictForHead, headVerdictBlocksReplacement, mergedReviewComparisonBase, resolveLaneApprovalBase, assertDurableReviewApproval, MUTEX_RELEASE_READBACK_DELAYS_MS, readDurableVerdictRefs, leaseVerdictOptions, assertReviewLeaseStillStale, isReviewAssignmentLive, mergedPrReviewerReuseAllowed } from './lib/lanes/review-approval.mjs'
export { findPrReviewAssignments, verdictOpensLine, evidenceTiedToHead, isApprovalFor, isVerdictFor, anyVerdictFor, gateAuthorizes, withArchivedVerdictMirror, DURABLE_VERDICT_REF_NAMESPACE, hasVerdictForHead, headVerdictBlocksReplacement, mergedReviewComparisonBase, resolveLaneApprovalBase, assertDurableReviewApproval, mergedPrReviewerReuseAllowed }
import { findBusyReviewers, reviewLeaseAgeHours, OWN_START_ONLY_ACTIVITY, REVIEW_REAP_REQUEST_LIMIT, REVIEW_REAP_BATCH, legacyLeaseTerminalReason, REVIEW_ARCHIVED_VERDICT_REF_PREFIX, REVIEW_VERDICT_ARCHIVE_BATCH, archivedVerdictRef, classifyVerdictForArchive, describeMovedAssignmentHead, pickReviewer, reviewSlotSuffix, inReviewReplacementNamespace, newestActivityTimestamp, silenceProbeRef, silenceReleaseRef, parseSilenceProbe, resolveSilentLease, abandonedLeases, verdictArchiveScan, readPullStateMap, countReasons, selectArtifactFiles, selectArtifactJson } from './lib/lanes/review-leases.mjs'
export { findBusyReviewers, reviewLeaseAgeHours, OWN_START_ONLY_ACTIVITY, REVIEW_REAP_REQUEST_LIMIT, REVIEW_REAP_BATCH, legacyLeaseTerminalReason, REVIEW_ARCHIVED_VERDICT_REF_PREFIX, REVIEW_VERDICT_ARCHIVE_BATCH, archivedVerdictRef, classifyVerdictForArchive, describeMovedAssignmentHead, pickReviewer, reviewSlotSuffix, inReviewReplacementNamespace, selectArtifactFiles, selectArtifactJson }
import { projectReviewPr, projectReviewerOperationRouteSnapshot, completeReviewerOperationRouteSnapshot, reconcileReviewerOperationRouteFiles, reviewStateGraphqlFields, MUTEX_RETRY_WAIT_MS, resolvePeerSlots, MERGE_ANCESTRY_MEMO, reviewEligibilityCause, reviewerQueueRef, parseReviewerQueueTicket, reviewerQueueTicketExpired, liveReviewerQueue, finishReviewerQueueTurn } from './lib/lanes/review-assignment.mjs'
export { projectReviewPr, projectReviewerOperationRouteSnapshot, completeReviewerOperationRouteSnapshot, reconcileReviewerOperationRouteFiles, reviewStateGraphqlFields, MUTEX_RETRY_WAIT_MS }
import { CLAIM_WORKTREE_REBIND_REF_PREFIX, normalizeWorktreePath, claimWorktreeRebindRef, parseSilenceRelease, replaceClaimVersion, parseVersionSupersession, parseClaimWorktreeRebind, leaseWithoutWorktree, parseMergedClaimReissue } from './lib/lanes/claim-versions.mjs'
export { CLAIM_WORKTREE_REBIND_REF_PREFIX, normalizeWorktreePath, claimWorktreeRebindRef }
import { reviewerExecutionPreflight, failedReviewerReleaseCommand, parseReviewReplacement, requireReplacementEvidence, validateTerminalReviewerFailure, reviewerFailureRef, parseReviewRelease, assertAssignmentWasNotTerminallyReleased, resolveFailedReviewRecord, matchesAssignmentTuple, matchesReplacementForSlot, assignmentSlotSuffix, matchesReplacementTuple, parseTerminalFailureEvidence } from './lib/lanes/review-replacement.mjs'
export { reviewerExecutionPreflight, failedReviewerReleaseCommand }
import { ADMISSION_LEGACY_CUTOVER, admitIssue, parseMergedPrIssueBinding, verifyMergedPrIssueBinding, withMergedPrIssueBinding, reviewTargetIsRecordable, derivePrOperationRoute, assertUnambiguousClaimTitle, requireAdmissionArguments } from './lib/lanes/admission.mjs'
export { ADMISSION_LEGACY_CUTOVER, admitIssue, parseMergedPrIssueBinding, verifyMergedPrIssueBinding, withMergedPrIssueBinding, reviewTargetIsRecordable, derivePrOperationRoute, assertUnambiguousClaimTitle }
import { workIssuesFromRows, openIssueNumbersFromRows, memoizePrFiles, closedClaimAuthoredOnMain, RELINQUISH_ONLY_LEASE_FIELDS, wrongOwnerMessage, renewalIssueScope, claimCoversObject, addedMigrationVersions, parseVersionPrMap, assertMergeCommitInMainHistory, completeWork, SPLIT_REMAINDER, workstreamKey, migrationVersions, replaceLeaseLocation, replaceClaimObjects, replaceLeaseExpiry, replaceCapacityState, relinquishOnlyFieldsIn, stripRelinquishOnlyFields, claimTitleIssues, claimWorkIssue, validateCapacityBlocker, requireDereferenceableRecoveryArtifact, requestedWorktreeState, observedWorktreeState, resolveRelinquishmentWorktreeState, publishCapacityEvents, laneCommand, appendClaimObjects, replaceScopeStatus, validateImmutableArtifactReference } from './lib/lanes/claim-maintenance.mjs'
// Claude Code owner labels exist in two spellings for the same exact session:
// `claude-chat-<uuid>@<machine>` (the claim path) and `Claude chat <uuid> on <machine>`
// (the GitHub signature form). Both name one UUID and one machine; nothing else
// is treated as equal, so an alias, a different UUID or machine never matches.
export { workIssuesFromRows, openIssueNumbersFromRows, memoizePrFiles, closedClaimAuthoredOnMain, RELINQUISH_ONLY_LEASE_FIELDS, wrongOwnerMessage, renewalIssueScope, claimCoversObject, addedMigrationVersions, parseVersionPrMap, assertMergeCommitInMainHistory, completeWork }
import { readExclusiveLease, assertExclusive, assertNoPromotionFreeze, acquireExclusive, releaseExclusive, recoverExclusive, acquirePromotionFreeze, releasePromotionFreeze } from './lib/lanes/exclusive-locks.mjs'
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
// Issue #4414 phase timing (local only; see scripts/lib/lanes/phase-trace.mjs).
let reviewPhaseTrace=null,reviewPhaseSourceTuple=null,reviewPhaseInvocation=null
function notePhase(name,meta=null){reviewPhaseTrace?.startPhase?.(name,meta)}
function endPhase(name,extra=null){return reviewPhaseTrace?.endPhase?.(name,extra)??null}
function notePhaseRelease(state){reviewPhaseTrace?.setReleaseState?.(state)}
function notePhaseForeignOwner(observed){reviewPhaseTrace?.noteForeignMutexOwner?.(observed)}
function setPhaseContext(sourceTuple,invocation=null){
  reviewPhaseSourceTuple=sourceTuple&&typeof sourceTuple==='object'?{...sourceTuple}:null
  reviewPhaseInvocation=invocation==null?null:String(invocation)
  reviewPhaseTrace?.setSourceTuple?.(reviewPhaseSourceTuple)
  reviewPhaseTrace?.setInvocation?.(reviewPhaseInvocation)
}
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
// Issue #4414 step 4: the owned mutex section has one operation deadline on a
// MONOTONIC clock. Every gh/git child launched while the mutex is held gets
// min(its own per-call bound, the time left), and a child whose remaining time
// is zero or unreadable is refused BEFORE it launches. Release/cleanup gets its
// own reserved allowance, started when cleanup begins, so an exhausted section
// can still attempt its release. This is an operation budget, never a lease TTL:
// no timer deletes a ref or cancels anyone else's writer. The values are a
// provisional bound (step 7 measures real holds); they widen no request ceiling.
export const REVIEW_MUTEX_SECTION_DEADLINE_MS=5*60*1000, REVIEW_MUTEX_CLEANUP_ALLOWANCE_MS=2*60*1000
let reviewMonotonicNow=()=>performance.now()
export function setReviewMonotonicClock(clock){const previous=reviewMonotonicNow;reviewMonotonicNow=typeof clock==='function'?clock:()=>performance.now();return previous}
// The deadline lives beside, not inside, the request budget: every reviewer-mutex
// holder gets it, including archiveOldReviewVerdicts, which runs without a budget.
let reviewSectionDeadline=null
function startReviewSectionDeadline(){reviewSectionDeadline={sectionAt:reviewMonotonicNow()+REVIEW_MUTEX_SECTION_DEADLINE_MS,cleanupAt:null,cleanup:0}}
function clearReviewSectionDeadline(){reviewSectionDeadline=null}
// Release, failed-acquire cleanup and ambiguous-batch reconciliation run on the
// reserved allowance, never on what is left of the (possibly exhausted) section.
function withReviewCleanupAllowance(fn){
  const deadline=reviewSectionDeadline
  if(!deadline)return fn()
  deadline.cleanup+=1
  try{return fn()}finally{deadline.cleanup-=1}
}
// defaultMs undefined means "unbounded outside ownership": the call keeps its old
// behaviour there and is bounded only while the mutex is held.
export function reviewChildTimeoutMs(defaultMs){
  const deadline=reviewSectionDeadline
  if(!deadline)return defaultMs
  const now=reviewMonotonicNow()
  let at=deadline.sectionAt,what='mutex-held section'
  if(deadline.cleanup>0){
    if(deadline.cleanupAt==null)deadline.cleanupAt=now+REVIEW_MUTEX_CLEANUP_ALLOWANCE_MS
    at=deadline.cleanupAt;what='mutex release/cleanup allowance'
  }
  const remaining=Math.floor(at-now)
  if(!Number.isFinite(remaining)||remaining<=0)throw new LaneError(`reviewer operation '${reviewWireBudget?.operation??'reviewer-operation'}' exhausted its ${what} deadline; refused before launching another GitHub/git child (issue #4414). Nothing further was written by this call`)
  return defaultMs==null?remaining:Math.min(defaultMs,remaining)
}
const boundedGit=(options={})=>{const timeout=reviewChildTimeoutMs(options?.timeout);return timeout==null?options:{...options,timeout,killSignal:'SIGKILL'}}
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
  // Issue #4414: phase timing is local public-safe metadata. It never performs a
  // remote read, never writes during ownership, and never invents a release.
  // After release (or a recovery-required decision) the summary is written to
  // stderr so acquisition→release data actually exists for step-7 measurement.
  reviewPhaseTrace=createPhaseTrace({
    operation,
    sourceTuple: reviewPhaseSourceTuple,
    invocation: reviewPhaseInvocation,
    sink: (payload)=>{
      try{process.stderr.write(`review-phase-trace ${formatPhaseTraceSummary(payload)}\n`)}
      catch{/* lost telemetry is not a mutation failure */}
    },
  })
  try{return fn(reviewWireBudget)}
  finally{
    try{reviewPhaseTrace?.flush?.()}catch{/* lost telemetry is not a mutation failure */}
    reviewPhaseTrace=null
    reviewPhaseSourceTuple=null
    reviewPhaseInvocation=null
    reviewWireBudget=null;reviewCommitBase=null;freshDurableVerdictRefs=null;observedReviewQuota={};primedReviewStates=new Map()
  }
}
// Issue #2802: the structural-admission gate (scripts/db-flow/admission.mjs,
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
    // Issue #4414 step 4: bounded by the owned-section deadline while the mutex is held.
    timeoutMs:reviewChildTimeoutMs(ghCommandTimeoutMs()),
    // Issue #2773: the real binary shares the host-wide exhaustion latch; a fixture executor never does. A latched refusal sends no request, so it is deliberately not charged to the wire budget above.
    quotaLatch:executor===execFileSync?hostQuotaLatch():null,
    wrapError:(detail)=>new LaneError(`GitHub command failed: ${detail}`),
  })
}
const ADMISSION_ISSUE_COMMENT_MAX_PAGES=5, GITHUB_REST_PAGE_SIZE=100
function isAdmissionIssueCommentEndpoint(endpoint){
  const value=String(endpoint)
  return value.startsWith(`repos/${REPO}/issues/`)&&/^repos\/[^/]+\/[^/]+\/issues\/[1-9]\d*\/comments\?per_page=100$/.test(value)
}
function readAdmissionIssueCommentPages(endpoint,readJson){
  const comments=[],commentIds=new Set(),pageSignatures=new Set()
  for(let pageNumber=1;pageNumber<=ADMISSION_ISSUE_COMMENT_MAX_PAGES;pageNumber++){
    const pageEndpoint=`${endpoint}&page=${pageNumber}`
    const page=readJson(['api',pageEndpoint])
    if(!Array.isArray(page)||page.length>GITHUB_REST_PAGE_SIZE)throw new LaneError(`GitHub admission comment page ${pageNumber} for ${endpoint} was incomplete or malformed`)
    const ids=page.map((comment)=>{
      const id=String(comment?.id??'')
      if(!/^[1-9]\d*$/.test(id))throw new LaneError(`GitHub admission comment page ${pageNumber} for ${endpoint} contains a row without a valid comment id`)
      return id
    })
    const signature=JSON.stringify(ids)
    if(pageSignatures.has(signature))throw new LaneError(`GitHub admission comment page ${pageNumber} for ${endpoint} repeats an earlier page`)
    pageSignatures.add(signature)
    for(const id of ids){
      if(commentIds.has(id))throw new LaneError(`GitHub admission comment pages for ${endpoint} contain duplicate comment id ${id}`)
      commentIds.add(id)
    }
    comments.push(...page)
    if(page.length<GITHUB_REST_PAGE_SIZE)return comments
  }
  throw new LaneError(`GitHub admission comment history for ${endpoint} reached the ${ADMISSION_ISSUE_COMMENT_MAX_PAGES}-page limit without a short final page; refusing incomplete history`)
}
export function ghPaginated(endpoint,{readJson=ghJson}={}) {
  if(reviewWireBudget){
    if(String(reviewWireBudget.operation??'').endsWith('-admission-gate')&&isAdmissionIssueCommentEndpoint(endpoint))return readAdmissionIssueCommentPages(endpoint,readJson)
    // Pull-request file inventories may exceed one REST page (a large docs or
    // catalogue sweep). Follow pages for that endpoint only, fail closed past a
    // small page cap, and keep every other endpoint single-page.
    if(/\/pulls\/\d+\/files/.test(endpoint)){
      const rows=[]
      for(let page=1;page<=10;page+=1){
        const sep=endpoint.includes('?')?'&':'?'
        const chunk=readJson(['api',`${endpoint}${sep}page=${page}`])
        if(!Array.isArray(chunk))throw new LaneError(`GitHub page for ${endpoint} was incomplete or malformed`)
        rows.push(...chunk)
        if(chunk.length<GITHUB_REST_PAGE_SIZE)return rows
      }
      throw new LaneError(`GitHub page for ${endpoint} exceeded the 10-page file-inventory cap; reviewer operation refuses an unreadable inventory`)
    }
    const page=readJson(['api',endpoint])
    if(!Array.isArray(page))throw new LaneError(`GitHub page for ${endpoint} was incomplete or malformed`)
    if(page.length>=GITHUB_REST_PAGE_SIZE)throw new LaneError(`GitHub page for ${endpoint} reached 100 rows; reviewer operation refuses possible pagination`)
    return page
  }
  const pages = readJson(['api', '--paginate', '--slurp', endpoint])
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
    try{url=String(run('git',['remote','get-url','origin'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:reviewChildTimeoutMs(GIT_COMMAND_TIMEOUT_MS),killSignal:'SIGKILL'})).trim()}
    catch(error){if(error instanceof LaneError)throw error;throw new LaneError(`git origin remote is unreadable; refusing git ref reads (${String(error?.message??error).split('\n')[0]})`)}
    const slug=url.replace(/\.git$/i,'').replace(/\/+$/,'').replace(/^.*github\.com[:/]/i,'')
    if(!/github\.com[:/]/i.test(url)||slug.toLowerCase()!==String(REPO).toLowerCase())throw new LaneError(`git origin remote does not point at ${REPO}; refusing git ref reads`)
    gitRemoteRepositoryProved=true
  }
  let lastError
  // Issue #4414 step 4: under ownership a ref read is ONE attempt bounded by the section deadline.
  if(reviewSectionDeadline)attempts=1
  for(let attempt=1;attempt<=attempts;attempt++){
    let text
    try{text=run('git',['ls-remote','origin',...patterns],{encoding:'utf8',maxBuffer:256*1024*1024,stdio:['ignore','pipe','pipe'],timeout:reviewChildTimeoutMs(GIT_COMMAND_TIMEOUT_MS),killSignal:'SIGKILL'})}
    catch(error){if(error instanceof LaneError)throw error;lastError=error;if(attempt<attempts)wait(500*attempt);continue}
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

// Owner: exact paid-review provenance. Complete source blobs can exceed the
// Node default1MiB. This process bound does not change semantic evidence limits.
export const PAID_REVIEW_GIT_MAX_BYTES = 4 * 1024 * 1024
export function paidReviewGitReader(args) {
  return execFileSync('git', args, boundedGit({encoding:'utf8', stdio:['ignore','pipe','pipe'], maxBuffer:PAID_REVIEW_GIT_MAX_BYTES}))
}

// #4048: a partial maintenance PR must retain its authentic work issue without
// pretending to close that unfinished parent. Refs only selects the proof;
// immutable canonical evidence and normal Git validation supply authority.
export function verifyNonclosingMaintenanceBinding({pr,headSha,files,issue=null,structural=false},io,git=gitIo,{gitRunner=(args,options)=>execFileSync('git',args,boundedGit({...options,encoding:'utf8',stdio:['ignore','pipe','pipe']}))}={}){
  const refuse=(reason)=>{throw new LaneError(`nonclosing maintenance binding refused: ${reason}`)}
  const live=io.getPr(pr),main=io.mainSha?.()
  if(!live||Number(live.number)!==pr||live.state!=='open'||live.head?.sha!==headSha||
    live.head?.repo?.full_name!==REPO||live.base?.repo?.full_name!==REPO||live.base?.ref!=='main'||
    !/^[0-9a-f]{40}$/.test(main??'')||!/^[0-9a-f]{40}$/.test(live.base?.sha??'')||!live.head?.ref)refuse('exact live PR, head, repository or protected main changed')
  const identity=JSON.stringify({number:live.number,state:live.state,head:live.head.sha,branch:live.head.ref,headRepo:live.head.repo.full_name,base:live.base.sha,baseRef:live.base.ref,baseRepo:live.base.repo.full_name,user:live.user?.login,association:live.author_association,body:live.body})
  if(!isTrustedOperatorComment({author:live.user?.login,author_association:live.author_association},REPO)||
    !/^Posted by [A-Za-z][A-Za-z0-9 -]* chat [A-Za-z0-9-]+ on [A-Za-z0-9_.-]+\s*$/m.test(live.body??''))refuse('trusted signed attribution missing')
  const refs=[...String(live.body??'').matchAll(/\bRefs\s+#([1-9]\d*)\b/gi)].map(m=>Number(m[1]))
  if(refs.length!==1||issue!==null&&Number(issue)!==refs[0])refuse('exactly one consistent Refs work issue is required')
  if(/\b(?:closes?|fix(?:es)?|resolves?)\s+#([1-9]\d*)\b/i.test(live.body??''))refuse('nonclosing binding cannot declare a closing issue')
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
    contract.branch!==live.head.ref||
    (structural ? contract.work_type!=='structural'||!CLAIM_FIRST_ROUTES.has(contract.route)||!contract.db_writes.length
      : contract.work_type!=='repo-maintenance'||contract.route!=='repo-maintenance'||contract.db_reads.length||contract.db_writes.length))refuse('canonical work issue, branch, route or no-database scope disagrees')
  if(typeof io.prepareNonclosingEvidenceGit!=='function')refuse('exact source Git reader unavailable')
  io.prepareNonclosingEvidenceGit(headSha,main)
  // GitHub's PR base snapshot may lag protected main. Prove the same actual
  // main through ancestry, the existing clean-merge/diff gate and canonical
  // evidence; the API snapshot itself never supplies freshness authority.
  try{
    if(git.isAncestor(live.base.sha,main)!==true)refuse('API base is not a proven ancestor of captured protected main')
    if(live.base.sha!==main){
      const freshness=classifyBranchFreshness({headSha,tipSha:main,gitRunner})
      if(freshness?.ok!==true)refuse(`branch freshness failed (${freshness?.reason??'unreadable proof'})`)
    }
  }catch(error){refuse(`API base or branch freshness proof failed (${error.message})`)}
  try{verifyGitEvidence({contract,report,prBaseSha:main,prHeadSha:headSha},git)}
  catch(error){refuse(`published contract or exact Git proof failed (${error.message})`)}
  const work=io.getIssue(refs[0])
  if(Number(work?.number)!==refs[0])refuse('authentic work issue unavailable')
  if(structural){
    let scope
    try{scope=parseQueueScope(work?.body??'')}catch(error){refuse(`structural scope is unreadable (${error.message})`)}
    if(work.state!=='open'||scope?.status!=='ready'||scope?.workType!=='structural'||!CLAIM_FIRST_ROUTES.has(scope.route)||
      scope.route!==contract.route||JSON.stringify([...scope.writes].sort())!==JSON.stringify([...contract.db_writes].sort()))refuse('structural issue, route or exact writes disagrees')
  }
  const finalPr=io.getPr(pr),finalMain=io.mainSha?.()
  const finalIdentity=JSON.stringify({number:finalPr?.number,state:finalPr?.state,head:finalPr?.head?.sha,branch:finalPr?.head?.ref,headRepo:finalPr?.head?.repo?.full_name,base:finalPr?.base?.sha,baseRef:finalPr?.base?.ref,baseRepo:finalPr?.base?.repo?.full_name,user:finalPr?.user?.login,association:finalPr?.author_association,body:finalPr?.body})
  if(finalMain!==main||finalIdentity!==identity)refuse('exact live PR identity or protected main moved during proof')
  return {issue:refs[0],work,headSha,route:structural?'structural':'repo-maintenance',contractRef:report.contract_ref,contractHash:contractHash(contract)}
}

function readCompleteReviewStates(repository,leases){
  const issueCache=new Map(),prCache=new Map(),states=new Map()
  leases.forEach((lease,index)=>{
    const {pr,issue}=completeReviewStatePages(repository?.[`p${index}`],repository?.[`i${index}`],lease,(query)=>ghJson(['api','graphql','-f',`query=${query}`]),{issueCache,prCache})
    states.set(`${lease.issue}:${lease.pr}`,reviewStateEntry(pr,issue))
  })
  return states
}
export const githubIo = {
  releaseRefOverGit(ref, ownerSha) { return releaseRefOverGit(ref, ownerSha) },
  // popcre/ai-devops#2172 stage C2: claim-first admission is retired.
  enforceAdmission:false,
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
  // (the retired exact-head approval gate, deleted #2074) build the list the SAME way: paginate,
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
    const evidence=reviewWireBudget?' number updatedAt comments(first:100){totalCount pageInfo{hasNextPage endCursor} nodes{id updatedAt body authorAssociation}} reviews(first:100){totalCount pageInfo{hasNextPage endCursor} nodes{id updatedAt body state authorAssociation commit{oid}}} mergeCommit{oid}':''
    const issueEvidence=reviewWireBudget?' updatedAt comments(first:100){totalCount pageInfo{hasNextPage endCursor} nodes{id updatedAt body authorAssociation}}':''
    const query=`query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){state merged mergedAt headRefOid${evidence} files(first:100){pageInfo{hasNextPage} nodes{path changeType}} closingIssuesReferences(first:2){pageInfo{hasNextPage} nodes{... on Issue{number state body createdAt${issueEvidence}}}}}}}`
    const data=ghJson(['api','graphql','-f',`query=${query}`,'-F',`owner=${REPO_OWNER}`,'-F',`name=${REPO_NAME}`,'-F',`pr=${Number(pr)}`])
    // The caller's admission gate uses its own request counter, while the
    // bounded-pagination refusal and mutex single-attempt policy remain active.
    const snapshot=completeReviewerOperationRouteSnapshot(data,()=>githubIo.getPrFiles(Number(pr)))
    const row=data.data.repository.pullRequest,linked=row.closingIssuesReferences.nodes
    if(reviewWireBudget&&linked.length===1&&Number.isInteger(linked[0]?.number)){
      primeReviewStates([...readCompleteReviewStates({p0:row,i0:linked[0]},[{issue:linked[0].number,pr:Number(pr)}])])
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
    if(data?.errors!==undefined&&(!Array.isArray(data.errors)||data.errors.length))throw new LaneError('active reviewer lease snapshot returned GraphQL errors')
    recordReviewGraphQuota(data?.data?.rateLimit)
    const repo=data?.data?.repository
    if(!repo)throw new LaneError('active reviewer lease snapshot is unreadable')
    const base=repo?.defaultBranchRef?.target
    if(!base?.oid||!base?.tree?.oid)throw new LaneError('review commit base is unreadable')
    reviewCommitBase={head:base.oid,tree:base.tree.oid}
    const states=readCompleteReviewStates(repo,unique)
    primeReviewStates([...states])
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
    if(data?.errors!==undefined&&(!Array.isArray(data.errors)||data.errors.length))throw new LaneError('active reviewer lease snapshot returned GraphQL errors')
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
    if((data?.errors!==undefined&&(!Array.isArray(data.errors)||data.errors.length))||!data?.data?.repository)throw new LaneError('batched reviewer PR/verdict evidence returned GraphQL errors')
    return readCompleteReviewStates(data.data.repository,unique)
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
      try{execFileSync('git',['cat-file','-e',`${sha}^{commit}`],{stdio:'ignore',timeout:reviewChildTimeoutMs(GIT_COMMAND_TIMEOUT_MS),killSignal:'SIGKILL'})}
      catch(error){if(error instanceof LaneError)throw error;try{execFileSync('git',['fetch','--no-tags','origin',sha],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:reviewChildTimeoutMs(GIT_COMMAND_TIMEOUT_MS),killSignal:'SIGKILL'})}catch(error){throw new LaneError(`atomic reviewer ref transition could not hydrate commit ${sha}: ${String(error.stderr??error.message??error).trim()}`)}}
    }
    const args=['push','--atomic','origin']
    for(const change of changes)args.push(`--force-with-lease=${change.ref}:${change.expected??''}`)
    for(const change of changes)args.push(change.sha?`${change.sha}:${change.ref}`:`:${change.ref}`)
    // Issue #4414 step 4: the deadline is checked before launch, never mid-batch.
    // A killed push may still have landed; callers reconcile by exact readback.
    const timeout=reviewChildTimeoutMs(GIT_COMMAND_TIMEOUT_MS)
    try{execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,killSignal:'SIGKILL'})}catch(error){const failure=new LaneError(`atomic reviewer ref transition failed${error?.code==='ETIMEDOUT'?' (timed out; result unknown until readback)':''}: ${String(error.stderr??error.message??error).trim()}`);failure.atomicOutcomeUnknown=true;throw failure}
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
    try{return execFileSync('git',['diff','--name-only',`${sha}^1`,sha],boundedGit({encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:32*1024*1024})).split(/\r?\n/).some((line)=>line.startsWith('supabase/migrations/'))}
    catch(error){if(error instanceof LaneError)throw error;return null}
  },
  // AGENTS.md section 4 rule 2 is merge-first: the rehearsal happens AFTER the PR
  // merges, so the lane must still be able to find that PR once it is closed.
  // `openPulls()` cannot see it; this looks the branch up across every state.
  branchPulls(branch) { return ghPaginated(`repos/${REPO}/pulls?state=all&head=${REPO.split('/')[0]}:${encodeURIComponent(branch)}&per_page=100`) },
  verifyNonclosingMaintenanceBinding(request){return verifyNonclosingMaintenanceBinding(request,this)},
  verifyNonclosingStructuralBinding(request){return verifyNonclosingMaintenanceBinding({...request,structural:true},this)},
  prepareNonclosingEvidenceGit(head,base){execFileSync('git',['fetch','--no-tags','--quiet','origin',head,base],boundedGit({stdio:['ignore','pipe','pipe']}))},
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
  // #5141 — the two read-only ledger reads behind the unapplied-migration-edit
  // subset proof in db-flow/admission.mjs. They run in a child node process
  // because admission (and every lane command that runs it) is synchronous
  // while the Supabase Management API client is async fetch; the child runs the
  // SAME library code (db-flow/read-preview-ledger.mjs and the edit guard's
  // fetchLedgerStatements), so there is no second HTTP implementation, and any
  // failure — absent token, unreachable API, malformed row — is rethrown so
  // the subset proof fails closed exactly like every other ledger guard.
  appliedMigrationVersions(){
    const out=this.runLedgerQuery([
      'const out={}',
      'for(const [name,ref] of Object.entries(PROJECT_REFS)){',
      '  try{out[name]=await fetchAppliedVersions(ref)}catch(error){fail(error)}',
      '}',
      'process.stdout.write(JSON.stringify(out))',
    ].join('\n'))
    const ledgers={}
    for(const name of ['preview','production']){
      if(!Array.isArray(out[name])||!out[name].length)throw new LaneError(`the ${name} applied-migration ledger came back unreadable or empty`)
      ledgers[name]=new Set(out[name].map(String))
    }
    return ledgers
  },
  previewLedgerStatements(version){
    if(!/^\d{14}$/.test(String(version??'')))throw new LaneError('preview ledger statements require an exact 14-digit migration version')
    const out=this.runLedgerQuery([
      `const version=${JSON.stringify(String(version))}`,
      'let statements',
      'try{statements=await fetchLedgerStatements(PROJECT_REFS.preview,version)}catch(error){fail(error)}',
      'process.stdout.write(JSON.stringify(statements))',
    ].join('\n'))
    if(!Array.isArray(out))throw new LaneError(`preview ledger statements for ${version} came back unreadable`)
    return out
  },
  runLedgerQuery(script){
    const here=path.dirname(fileURLToPath(import.meta.url))
    const importer=[
      `import {fetchAppliedVersions,PROJECT_REFS} from ${JSON.stringify(pathToFileURL(path.join(here,'db-flow','read-preview-ledger.mjs')).href)}`,
      `import {fetchLedgerStatements} from ${JSON.stringify(pathToFileURL(path.join(here,'check-applied-migration-edit.mjs')).href)}`,
      'const fail=(error)=>{process.stderr.write(String((error&&error.message)||error));process.exit(3)}',
    ].join('\n')
    let stdout
    try{
      stdout=execFileSync(process.execPath,['--input-type=module','--eval',`${importer}\n${script}`],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024,env:process.env})
    }catch(error){
      throw new LaneError(`the applied-migration ledger read failed: ${String(error.stderr||error.message).slice(0,400)}`)
    }
    try{return JSON.parse(stdout)}catch{throw new LaneError('the applied-migration ledger read returned malformed JSON')}
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
    // Review is advice only (owner ruling 2026-10-29, ai-devops#2074 stage F
    // deleted the durable verdict refs). Preview admission instead holds while
    // a blocking review-finding issue references this PR -- the same rule 8.6
    // query production promotion uses (scripts/review_finding_hold.py).
    try{execFileSync('python3',['scripts/review_finding_hold.py','--pr',String(pr),'--repo',REPO],{encoding:'utf8',timeout:180000,maxBuffer:1024*1024})}
    catch(error){throw new LaneError(error?.status===3?`a blocking review-finding issue references PR #${pr}`:`review-finding hold query failed: ${error?.message??error}`)}
    const states=dependencies.length?this.dependencyStates(dependencies):{},closure=classifyDependencies(issue,dependencies,states)
    if(!closure.satisfied)throw new LaneError(`migration dependency closure is incomplete: ${closure.blocked.map((row)=>`#${row.number}`).join(', ')}`)
    return {full_ci_success:true,review_approved:true,review_finding_hold:'clear',dependency_closure_complete:true}
  },
  getIssue(number) { return ghJson(['api', `repos/${REPO}/issues/${number}`]) },
  getIssueComments(number) { return ghPaginated(`repos/${REPO}/issues/${number}/comments?per_page=100`) },
  getPrReviews(number) { return ghPaginated(`repos/${REPO}/pulls/${number}/reviews?per_page=100`) },
  readLeaseActivity(lease,{readJson=ghJson}={}) {
    const connectionFields='totalCount pageInfo{hasNextPage} nodes'
    const query=`query{repository(owner:${JSON.stringify(REPO_OWNER)},name:${JSON.stringify(REPO_NAME)}){nameWithOwner pullRequest(number:${Number(lease.pr)}){number headRefOid comments(first:100){${connectionFields}{id updatedAt}} reviews(first:100){${connectionFields}{id submittedAt updatedAt}} reviewThreads(first:100){${connectionFields}{comments(first:100){${connectionFields}{id updatedAt}}}}} object(oid:${JSON.stringify(String(lease.headSha))}){__typename ... on Commit{oid statusCheckRollup{contexts(first:100){${connectionFields}{__typename ... on CheckRun{databaseId status conclusion startedAt completedAt} ... on StatusContext{id state createdAt}}}}}}}}`
    const response=readJson(['api','graphql','-f',`query=${query}`])
    if(!response||typeof response!=='object'||response.errors!==undefined&&(!Array.isArray(response.errors)||response.errors.length))throw new LaneError('reviewer activity snapshot returned GraphQL errors or unreadable data')
    const data=response.data?.repository,pr=data?.pullRequest,commit=data?.object
    if(data?.nameWithOwner!==REPO||pr?.number!==Number(lease.pr)||pr?.headRefOid!==lease.headSha||commit?.__typename!=='Commit'||commit?.oid!==lease.headSha)throw new LaneError('reviewer activity repository, PR or Commit identity is unreadable or mismatched')
    const completeConnection=(connection)=>connection&&Array.isArray(connection.nodes)&&Number.isInteger(connection.totalCount)&&connection.totalCount>=0&&connection.totalCount===connection.nodes.length&&connection.pageInfo?.hasNextPage===false
    const contexts=commit.statusCheckRollup?.contexts
    if(!completeConnection(contexts))throw new LaneError('reviewer activity check rollup is unreadable or paginated')
    if(!completeConnection(pr.comments)||!completeConnection(pr.reviews)||!completeConnection(pr.reviewThreads))throw new LaneError('reviewer comment or review activity is unreadable or paginated')
    const reviewComments=[]
    for(const thread of pr.reviewThreads.nodes){if(!completeConnection(thread?.comments))throw new LaneError('reviewer review-comment activity is unreadable or paginated');reviewComments.push(...thread.comments.nodes)}
    const workflows=readJson(['api',`repos/${REPO}/actions/runs?head_sha=${lease.headSha}&per_page=100`])
    if(!Array.isArray(workflows?.workflow_runs)||!Number.isInteger(workflows.total_count)||workflows.total_count<0||workflows.total_count!==workflows.workflow_runs.length||workflows.workflow_runs.some(run=>run?.head_sha!==lease.headSha))throw new LaneError('reviewer activity workflow runs are unreadable, mismatched or paginated')
    return {issueComments:pr.comments.nodes,reviewComments,reviews:pr.reviews.nodes,checkRuns:contexts.nodes,workflowRuns:workflows.workflow_runs}
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
  // #4290: the merge base a newer reviewed head had with the PR base, so an older head
  // can be classified against it exactly as when that newer head was drawn.
  reviewContentComparison(before,after,pr,context={}) {
    const base=context.base??this.getPr(pr)?.base?.sha
    context.base=base
    if(!/^[0-9a-f]{40}$/.test(base??''))throw new LaneError('review circuit breaker: exact protected comparison base unreadable')
    execFileSync('git',['fetch','--no-tags','-q','origin',before,after,base],boundedGit({stdio:['ignore','pipe','pipe']}))
    // Issue #4414 step 5: local digest helpers are bounded too while the mutex is held.
    const gitRunner=(args)=>execFileSync('git',args,boundedGit({encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:512*1024*1024}))
    const excludePaths=verifiedEvidencePaths(before,after,{gitRunner})
    let contracts=paidBudgetContractCaches.get(context);if(!contracts){contracts=new Map();paidBudgetContractCaches.set(context,contracts)}
    const readContract=ref=>{
      if(!contracts.has(ref))contracts.set(ref,readPublishedContractFromGit(ref,(command,args,options)=>{
        if(command==='git' && ['ls-remote','fetch'].includes(args[0]))consumeReviewWireRequest()
        return execFileSync(command,args,boundedGit(options))
      }))
      return contracts.get(ref)
    }
    const budgetProof=derivePaidContentProof(before,after,base,paidReviewGitReader,excludePaths,pr,readContract)
    return {before:prContentDigest(before,base,{excludePaths,gitRunner}),after:prContentDigest(after,base,{excludePaths,gitRunner}),budgetProof}
  },
  contentPreservingRefresh(approvedHead,head,pr=null,context=null,gitRunner=paidReviewGitReader){
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
    if(reviewWireBudget&&/^[0-9a-f]{40}$/i.test(String(sha))){const c=readGitCommits([sha]).get(String(sha).toLowerCase());if(!c)throw new LaneError(`commit ${sha} is unreadable`);const tree=c.tree??null;return {sha:String(sha).toLowerCase(),message:c.message,committer:{date:c.committedDate},author:{date:c.committedDate},...(tree?{tree}:{}),commit:{message:c.message,committer:{date:c.committedDate},author:{date:c.committedDate},...(tree?{tree}:{})}}}
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
  issueComments(number,{readJson=ghJson}={}) { return ghPaginated(`repos/${REPO}/issues/${number}/comments?per_page=100`,{readJson}).map((c)=>({ body:c.body, author_association:c.author_association, author:c.user?.login, id:c.id, created_at:c.created_at, updated_at:c.updated_at })) },
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
  verifyGeneratedTypes(evidence,{readJson=ghJson,readEntries=(repository,id)=>readZipEntries(gh(['api',`repos/${repository}/actions/artifacts/${Number(id)}/zip`],{encoding:null,maxBuffer:20*1024*1024}))}={}){
    const match=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/.exec(String(evidence?.generated_types_evidence??''))
    if(!match||match[1].toLowerCase()!==REPO.toLowerCase())return false
    const run=readJson(['api',`repos/${match[1]}/actions/runs/${match[2]}`])
    if(!matchesGeneratedTypesWorkflowRun(run,evidence))return false
    const artifacts=readJson(['api',`repos/${match[1]}/actions/runs/${match[2]}/artifacts`])?.artifacts
    const artifact=Array.isArray(artifacts)?artifacts.find((row)=>Number(row.id)===Number(evidence.generated_types_artifact_id)):null
    let producerBinding
    if(String(evidence.application_repository).toLowerCase()!==REPO.toLowerCase()){
      try{
        const issue=readJson(['api',`repos/${REPO}/issues/${Number(evidence.work_issue)}`])
        const consumer=resolveGeneratedTypesConsumerBinding(issue,evidence.work_issue,evidence.application_commit_sha,readJson,{allowClosed:true})
        if(consumer.application_repository!==evidence.application_repository)return false
        producerBinding={producer_repository:REPO,producer_commit_sha:String(run.head_sha).toLowerCase(),application_default_branch:consumer.application_default_branch}
      }catch{return false}
    }
    const expectedName=`shared-db-generated-types-${evidence.work_issue}-${String(evidence.application_commit_sha).toLowerCase()}`
    if(!(artifact?.name===expectedName&&artifact.expired===false&&String(artifact.digest??'').toLowerCase()===String(evidence.generated_types_artifact_digest).toLowerCase()))return false
    let entries
    try{entries=readEntries(match[1],artifact.id)}catch{return false}
    const selected=selectGeneratedTypesArtifactEntries(entries)
    if(!selected)return false
    return matchesGeneratedTypesArtifact(selected.proof,selected.typescriptBytes,evidence,producerBinding)
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
  // Close only. The branch is never deleted, so a parked pull request stays reopenable.
  closePull(number, comment) { gh(['pr', 'close', String(number), '--repo', REPO, '--comment', String(comment)]) },
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
  // reviewer assignment no longer reads the claim-first session identity. Reviewer
  // independence now follows the AUTHORING session's engine, declared in
  // SHARED_DB_AUTHOR_ENGINE (e.g. claude, codex, glm, zcode). Unset, blank or
  // unknown values refuse (fail closed); see authorEngineFromEnv.
  resolveReviewEngine(){
    return authorEngineFromEnv(process.env.SHARED_DB_AUTHOR_ENGINE)
  },
  flowAdapter(claimNumber,admissionOptions=null){ return githubFlowAdapter(this,claimNumber,admissionOptions) },
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


function claimFirstAuthority(io,claimOwner){
  if(typeof io?.resolveSessionAuthority==='function')return io.resolveSessionAuthority({claimOwner})
  if(typeof io?.resolveMarker==='function')return io.resolveMarker()
  if(typeof io?.flowAdapter==='function'){
    const adapter=io.flowAdapter()
    if(adapter){
      if(typeof adapter.resolveSessionAuthority==='function')return adapter.resolveSessionAuthority({claimOwner})
      if(typeof adapter.resolveMarker==='function')return adapter.resolveMarker()
      if(typeof adapter.resolveSession==='function')return adapter.resolveSession()
    }
  }
  return resolveSessionAuthority(claimOwner===undefined?{}:{claimOwner})
}
function githubFlowAdapter(io,claimNumber=null,admissionOptions=null){
  const payload=(sha)=>{const message=io.getCommit(sha)?.message??'';const match=/^db-preview-(?:ready|outcome) ([\s\S]+)$/.exec(message);if(!match)throw new LaneError('preview coordination ref does not point to a recognized immutable payload');return JSON.parse(match[1])}
  return {
    // Claim-first session identity (issue #3874). Same shape
    // ({live, task, calling_task, state}), fail closed: an undeclared
    // SHARED_DB_SESSION_ID, or a named claim whose lease owner is not this
    // session, is never live. There is no role marker.
    resolveMarker(){
      if(claimNumber===null||claimNumber===undefined)return resolveSessionAuthority()
      const actor=resolveSessionAuthority()
      if(!actor.live)return actor
      const claim=io.getIssue(Number(claimNumber))
      const lease=parseAuthorLease(claim?.body??'')
      if(claim?.state==='closed'){
        // A closed selector chooses immutable merged proof, never author custody.
        // Reuse the full candidate proof before admitting the declared operator,
        // both before and under the preparation mutex. Open claims keep ownership.
        const issue=claimWorkIssue(claim)
        if(io.openClaims().some((row)=>claimTitleIssues(row).includes(issue)))throw new LaneError(`closed claim #${claimNumber} cannot select historical proof while work issue #${issue} has an open claim`)
        const candidate=this.selectCurrent(issue)
        if(!['merged_rehearsal','historical_rebind'].includes(candidate.route))throw new LaneError('closed claim selector requires a qualified merged preview source')
        return actor
      }
      if(claim?.state!=='open')throw new LaneError('named preview claim state is unreadable')
      return resolveSessionAuthority({claimOwner:lease.owner})
    },
    actor:()=>readSessionIdOrUnknown(),now:()=>new Date().toISOString(),
    appendEvent(event){io.commentIssue(event.work_issue,formatEventComment(event))},
    createRef(ref,digest,record){const kind=ref.startsWith('refs/db-preview-ready-outcomes/')?'outcome':'ready',sha=io.makeOwnerCommit(`db-preview-${kind} ${JSON.stringify({digest,record})}`);return io.createRef(ref,sha)},
    readRef(ref){const sha=io.refreshRef?.(ref)??io.readRef(ref);return sha?payload(sha):null},
    listReady(issue){return io.listRefs('refs/db-preview-ready/').map((row)=>payload(row.sha)).filter((row)=>Number(row.record?.issue)===Number(issue))},
    selectCurrent(issue){const candidate=deriveLivePreviewCandidate(Number(issue),io,{claimNumber});if(admissionOptions&&(Number(candidate.issue)!==Number(admissionOptions.admitIssue)||Number(candidate.pr)!==Number(admissionOptions.pr)))throw new LaneError(`preview candidate issue #${candidate.issue} pull request #${candidate.pr} is not the admitted issue #${admissionOptions.admitIssue} pull request #${admissionOptions.pr}`);return candidate},
    // Claim capacity transitions are retired with the migration author lease
    // (popcre/ai-devops#2172 Stage C2). The flow reconciler's mutating hooks
    // refuse rather than silently no-op; the scheduled --abandonment-audit runs
    // report-only and never reaches these.
    relinquishCapacity(){throw new LaneError('claim capacity relinquish is retired: the migration author lease no longer exists (popcre/ai-devops#2172)')},
    resumeCapacity(){throw new LaneError('claim capacity resume is retired: the migration author lease no longer exists (popcre/ai-devops#2172)')},
    persistReady(row){return persistInitialReady(deriveLivePreviewCandidate(Number(row.issue),io),this)},
    withMutex(fn){const ownerSha=io.makeOwnerCommit(`db-coordination preview-ready-preparation issue=0`);acquireMutex(ownerSha,io);try{if(admissionOptions)requireAdmission(admissionOptions,io,{pr:admissionOptions.pr??null,mutexOwner:ownerSha});return fn()}finally{releaseMutexOnExit(ownerSha,io)}},
    events(issue){return (io.issueComments(issue)??[]).flatMap((comment)=>parseEventComment(comment.body??comment))},
  }
}

// Reinstate a reviewer whose per-PR `terminal-unavailable` exclusion is
// demonstrably no longer true. Refuses on every other reason, refuses without
// fresh positive proof, and is a clean idempotent no-op on a re-run.


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
  // Close any still-open owned phase cleanly before release so traces can
  // distinguish completed commit/readback from an abandoned section.
  endPhase('ref_commit_readback')
  endPhase('fresh_validation')
  notePhase('release')
  const previous=reviewWireBudget?.cleanup
  if(reviewWireBudget)reviewWireBudget.cleanup=true
  if(reviewSectionDeadline)reviewSectionDeadline.cleanup+=1
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
      if(!released){
        notePhaseRelease('unknown')
        endPhase('release',{result:'recovery_required'})
        throw new LaneError(`release of ${MUTEX_REF} could not be proved after atomic deletion`)
      }
      // A successor owner inside the window still means our mutex was released.
      notePhaseRelease('proved_released')
      endPhase('release',{result:'proved_released'})
      return true
    }
    const released=releaseOwnedRef(MUTEX_REF,ownerSha,io)
    // releaseOwnedRef returns false when the ref is already absent — still a
    // proved release of OUR mutex, but never claim more than the result shows.
    notePhaseRelease(released===false?'successor_seen':'proved_released')
    endPhase('release',{result:released===false?'already_absent':'proved_released'})
    return released
  }catch(error){
    // #4255 / issue #3791 for the reviewer path: the atomic/API release failed.
    // Fall back to the owner-verified git-protocol delete (no API quota) before
    // declaring RECOVERY REQUIRED. A ref that is gone or owned by a successor is
    // a proved release -- an orphaned mutex must never be assumed released, but
    // one we no longer own is not ours to recover.
    let gitError=null
    try{
      if(typeof io.releaseRefOverGit==='function'&&io.releaseRefOverGit(MUTEX_REF,ownerSha)){
        notePhaseRelease('proved_released')
        endPhase('release',{result:'proved_released_git_fallback'})
        return true
      }
    }catch(fallback){gitError=fallback}
    try{
      const still=typeof io.readRef==='function'?io.readRef(MUTEX_REF):ownerSha
      if(still!==ownerSha){
        // Absent or successor-owned is a proved release of OUR mutex.
        notePhaseRelease(still==null?'proved_released':'successor_seen')
        endPhase('release',{result:still==null?'proved_released':'successor_seen'})
        return true
      }
    }catch{/* unreadable ownership keeps the original refusal */}
    notePhaseRelease('unknown')
    endPhase('release',{result:'recovery_required'})
    if(gitError)throw new LaneError(`${error.message}; git release fallback failed (${String(gitError?.message??gitError).split('\n')[0]}); RECOVERY REQUIRED: ${MUTEX_REF} expected SHA ${ownerSha}. Use the guarded recover-author-mutex.yml procedure and do not retry blindly`)
    throw new LaneError(`${error.message}; RECOVERY REQUIRED: ${MUTEX_REF} expected SHA ${ownerSha}. Use the guarded recover-author-mutex.yml procedure and do not retry blindly`)
  }
  finally{
    clearHeldMutex(ownerSha)
    if(reviewWireBudget){reviewWireBudget.cleanup=previous;reviewWireBudget.releaseProofAllowance=0}
    clearReviewSectionDeadline()
  }
}
// Issue #4414 step 4: classify a failed atomic multi-ref batch by reading back
// EVERY intended ref (never only the cursor). 'committed' => all refs at desired;
// 'uncommitted' => all refs still at expected, a retryable no-write refusal;
// anything else (partial or unreadable) is RECOVERY REQUIRED. Never redraws.
export function reconcileAtomicReviewBatch(changes,io,cause){
  const detail=String(cause?.message??cause).split('\n')[0]
  let refs
  try{refs=withReviewCleanupAllowance(()=>io.readReviewRefs(changes.map((change)=>change.ref)))}
  catch(readError){throw new LaneError(`${detail}; the atomic batch outcome is UNKNOWN (readback failed: ${String(readError?.message??readError).split('\n')[0]}); RECOVERY REQUIRED for refs ${changes.map((change)=>change.ref).join(', ')}: do not retry blindly`)}
  const at=(change,key)=>(refs.get(change.ref)??null)===(change[key]??null)
  if(changes.every((change)=>at(change,'sha')))return 'committed'
  if(changes.every((change)=>at(change,'expected'))){const refusal=new LaneError(`${detail}; readback proved the atomic batch did NOT commit -- no write happened, the same request may be retried`);refusal.retryableNoWrite=true;throw refusal}
  throw new LaneError(`${detail}; readback shows a PARTIAL or foreign state for the atomic batch (${changes.map((change)=>`${change.ref}=${refs.get(change.ref)??'absent'} expected ${change.expected??'absent'} desired ${change.sha??'absent'}`).join('; ')}); RECOVERY REQUIRED: do not retry blindly`)
}
function requireReviewWireCapacity(required,when='refused before mutex acquisition'){const limit=reviewWireBudget?.limit??REVIEW_OPERATION_REQUEST_LIMIT;if(reviewWireBudget&&reviewWireBudget.count+required>limit)throw new LaneError(`reviewer operation cannot fit ${required} remaining requests inside the ${limit}-request budget; ${when}`)}
// Issue #4414: after paid-start classification moves outside the lock, the
// mutex-section reserve must shrink by that prepare spend or the entry gate
// over-refuses. Exported for tests that pin the formula.
export function mutexSectionReserveAfterPrepare(capacitySpend,base=REVIEW_MUTEX_SECTION_RESERVE){
  return Math.max(4,base-Number(capacitySpend||0))
}
function acquireReviewMutex(ownerSha,io){
  if(reviewWireBudget){reviewWireBudget.cleanupReserve=io.atomicReviewMutexRelease?2:8;reviewWireBudget.locked=true}
  startReviewSectionDeadline()
  io.__requireReviewQuota?.()
  primedReviewStates=new Map()
  let acquired
  try{acquired=io.createRef(MUTEX_REF,ownerSha)}
  catch(error){
    const previous=reviewWireBudget?.cleanup
    if(reviewWireBudget)reviewWireBudget.cleanup=true
    if(reviewSectionDeadline)reviewSectionDeadline.cleanup+=1
    try{
      const actual=io.readRef(MUTEX_REF)
      // Observed foreign owner (if any) for cross-domain wait attribution.
      if(actual&&actual!==ownerSha)notePhaseForeignOwner({sha:actual,ref:MUTEX_REF})
      if(actual===ownerSha)finalizeReviewMutex(ownerSha,io)
    }catch(cleanup){throw new LaneError(`${error.message}; ${cleanup.message}; RECOVERY REQUIRED: ${MUTEX_REF} expected SHA ${ownerSha}. Use the guarded recover-author-mutex.yml procedure`)}
    finally{if(reviewWireBudget)reviewWireBudget.cleanup=previous}
    if(reviewPhaseTrace&&reviewPhaseTrace.releaseState==='not_acquired')notePhaseRelease('not_acquired')
    clearReviewSectionDeadline()
    throw error
  }
  if(!acquired){
    // Ordinary contention: createRefWithReadback returns false without throwing
    // and discards the observed owner SHA. One lock-read here names the foreign
    // owner for cross-domain attribution; it is bounded and only on the rare
    // contended path.
    try{
      const actual=io.readRef(MUTEX_REF)
      if(actual&&actual!==ownerSha)notePhaseForeignOwner({sha:actual,ref:MUTEX_REF})
    }catch{/* unreadable owner stays unknown */}
    notePhaseRelease('not_acquired')
    clearReviewSectionDeadline()
    throw new LaneError(`${MUTEX_REF} is occupied`)
  }
  noteHeldMutex(ownerSha,io)
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
function normalizedReviewerActivity(name,rows,fields){
  const metadataFields=['id','databaseId','__typename','status','state','conclusion',...fields]
  return rows.map((row)=>{
    if(!row||typeof row!=='object')throw new LaneError(`reviewer ${name} metadata is unreadable`)
    const metadata={}
    let timestampCount=0
    for(const field of metadataFields){
      const value=row[field]
      if(value===undefined||value===null)continue
      if(fields.includes(field)){
        if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new LaneError(`reviewer ${name} activity timestamp is unreadable`)
        metadata[field]=new Date(value).toISOString();timestampCount++
      }else{
        if(!['string','number','boolean'].includes(typeof value))throw new LaneError(`reviewer ${name} metadata is unreadable`)
        metadata[field]=value
      }
    }
    if(timestampCount===0)throw new LaneError(`reviewer ${name} activity timestamp is missing`)
    if(name==='checkRuns'||name==='workflowRuns'){
      if(name==='checkRuns'&&!['CheckRun','StatusContext'].includes(row.__typename))throw new LaneError('reviewer checkRuns object type is unreadable or unknown')
      const legacyContext=name==='checkRuns'&&row.__typename==='StatusContext'
      const status=legacyContext?row.state:row.status
      if(typeof status!=='string')throw new LaneError(`reviewer ${name} status is missing or unreadable`)
      if(legacyContext?!['SUCCESS','FAILURE','ERROR'].includes(status.toUpperCase()):status.toUpperCase()!=='COMPLETED')throw new LaneError(`reviewer ${name} status is nonterminal or unknown`)
    }
    return metadata
  }).sort((left,right)=>{const a=canonicalJson(left),b=canonicalJson(right);return a<b?-1:a>b?1:0})
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
  const normalized=groups.map(([name,rows,fields])=>[name,normalizedReviewerActivity(name,rows,fields)])
  const maxima=groups.map(([name,rows,fields])=>[name,newestActivityTimestamp(rows,fields)])
  const last=maxima.map(([,value])=>value).filter(Boolean).sort((a,b)=>b.time-a.time)[0]??null
  const facts={issue:Number(lease.issue),pr:Number(lease.pr),headSha:String(lease.headSha).toLowerCase(),slot:Number(lease.slot??1),sequence:Number(lease.sequence),prState:String(pr.state).toLowerCase(),currentHead:String(pr.head.sha).toLowerCase(),draft:pr.draft===true,verdictPresent:hasVerdictForHead(lease.issue,lease.pr,lease.headSha,io,leaseVerdictOptions(lease)),activity:Object.fromEntries(maxima.map(([name,value])=>[name,{count:activity[name].length,max:value?.value??null}])),metadataDigest:createHash('sha256').update(canonicalJson(Object.fromEntries(normalized))).digest('hex')}
  return {fingerprint:createHash('sha256').update(canonicalJson(facts)).digest('hex'),lastActivityIso:last?.value??'none',facts}
}





export function reviewLeaseStillHeld(request,io=githubIo){
  const busy=findBusyReviewers(reviewOperationIo(io),[],{keepUnreadableLeases:true})
  if(!busy)throw new LaneError('active reviewer leases are unreadable; review start refused')
  // Returns the exact held lease (with its draw sequence) or null.
  const staleRefs=new Set((busy.stale??[]).map((row)=>row.ref))
  const hit=[...(busy.byAssignment?.values()??[])].find(({lease,ref})=>!staleRefs.has(ref)&&Number(lease.issue)===Number(request.issue)&&Number(lease.pr)===Number(request.pr)&&String(lease.headSha).toLowerCase()===String(request.headSha).toLowerCase()&&Number(lease.slot??1)===Number(request.slot??1)&&(!request.reviewer||lease.reviewer===request.reviewer)&&(request.sequence===undefined||Number(lease.sequence)===Number(request.sequence)))
  return hit?{...hit.lease,slot:Number(hit.lease.slot??1)}:null
}
























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

// popcre/ai-devops#2172 stage C2: the claim-first admission contract is retired.
// The work issue is read from the pull request itself (its one closing issue, or
// the verified structural route of an open nonclosing PR); nothing is admitted.
export function resolveAdmittedIssueForPr(pr, io = githubIo) {
  if (!Number.isInteger(Number(pr)) || Number(pr) < 1) throw new LaneError('--resolve-admitted-issue-for-pr requires a pull request number')
  const linked = io.closingIssuesForPr(Number(pr))
  if (!Array.isArray(linked)) throw new LaneError('pull request closing-issue linkage is unreadable')
  if(linked.length>1)throw new LaneError(`pull request must close exactly one structural work issue; found ${linked.length}`)
  if(linked.length===0){
    const candidate=io.getPr(Number(pr))
    if(candidate?.merged_at){
      // Merged without a closing keyword: its title's trailing "(#N)" names the work issue.
      const titled=String(candidate.title??'').match(/\(#([1-9][0-9]*)\)\s*$/)
      if(titled)return {issue:Number(titled[1]),pr:Number(pr),admission:'not-required'}
    }
    if(!candidate||candidate.merged_at||String(candidate.state??'open').toLowerCase()!=='open')throw new LaneError('pull request must close exactly one structural work issue; found 0')
  }
  const route=linked.length===0?derivePrOperationRoute(Number(pr),io):null
  if(route&&route.route!=='structural')throw new LaneError('nonclosing PR resolution requires verified structural work')
  const number=route?.issue??Number(linked[0].number)
  return {issue:number,pr:Number(pr),admission:'not-required'}
}

// Issue #2802: routing and admission are one gate, and neither half is reviewer work.
// The whole body runs outside the reviewer operation's request accounting; the mutex
// ownership proof below is unchanged, so this still runs under the caller's held mutex.
export function requirePrOperationRoute(options,io,args){
  if(io.enforceAdmission!==true)return null
  return withoutReviewRequestBudget(()=>requirePrOperationRouteGate(options,io,args))
}
function proveLightweightDocumentsOnlyMerge(prNumber,headSha,io){
  // Preserve the existing owner exemption for ordinary prose merges without
  // supplying database authority. Every uncertainty falls through to normal
  // structural/nonclosing routing, which remains fail-closed.
  try{
    const identity=(pr)=>({number:pr?.number,state:pr?.state,headSha:pr?.head?.sha,headRef:pr?.head?.ref,
      headRepo:pr?.head?.repo?.full_name,baseSha:pr?.base?.sha,baseRef:pr?.base?.ref,baseRepo:pr?.base?.repo?.full_name})
    const first=io.getPr?.(prNumber),before=identity(first),baseSha=before.baseSha
    if(Number(before.number)!==Number(prNumber)||before.state!=='open'||before.headSha!==headSha||
      !/^[0-9a-f]{40}$/.test(String(headSha))||!before.headRef||before.headRepo!==REPO||
      !/^[0-9a-f]{40}$/.test(String(baseSha))||before.baseRef!=='main'||before.baseRepo!==REPO)return false
    const closing=io.closingIssuesForPr?.(prNumber)
    if(!Array.isArray(closing)||closing.length!==0)return false
    const files=io.comparePullRequestFiles?.(baseSha,headSha)
    if(!Array.isArray(files)||!classifyLightweightMergePullRequestFiles(files).documentsOnly)return false
    const after=identity(io.getPr?.(prNumber))
    return JSON.stringify(after)===JSON.stringify(before)
  }catch{return false}
}
function requirePrOperationRouteGate(options,io,{pr,headSha,issue,mutexOwner,allowMerged=false,reviewSnapshot=false,resolveStructuralIssue=false}){
  if(mutexOwner)requireOwnedRef(MUTEX_REF,mutexOwner,io)
  if(resolveStructuralIssue&&proveLightweightDocumentsOnlyMerge(pr,headSha,io)){
    requireOwnedRef(MUTEX_REF,mutexOwner,io)
    return {route:'documents-only',issue:null,headSha}
  }
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
export function requireAdmission(options, io, args = {}) {
  requireAdmissionArguments(options,io,{pr:args.pr??null})
  if (io.enforceAdmission !== true) return null
  return withoutReviewRequestBudget(()=>requireAdmissionGate(options,io,args))
}
// #2599: a curated Master Data issue declares no db-work-scope objects (its admission
// returns writes: []), yet its data-only migration still needs a lane, a reserved
// version and an exact claim that preview preparation checks against the migration's
// row writes. The claim may therefore name only curated tables (core.*, plus
// plm.source_resolution written through plm.set_source_resolution()); preview
// admission still proves every row write is covered.
export function requireCuratedClaimObjects(requested,issue){
  if(!requested.length)throw new LaneError(`curated issue #${issue} claim requires at least one exact core.* table`)
  const bad=requested.filter((object)=>!/^table core\.[a-z_][a-z0-9_]*$/.test(object)&&object!=='table plm.source_resolution')
  if(bad.length)throw new LaneError(`curated issue #${issue} claim may name only curated core.* tables and table plm.source_resolution: ${bad.join(', ')}`)
  if(!requested.some((object)=>/^table core\.[a-z_][a-z0-9_]*$/.test(object)))throw new LaneError(`curated issue #${issue} claim requires at least one exact core.* table`)
}
function requireAdmissionGate(options, io, { pr = null, timestamp, mutexOwner = null } = {}) {
  if(mutexOwner)requireOwnedRef(MUTEX_REF,mutexOwner,io)
  const admitted=mutexOwner
    ? admitIssue(Number(options.admitIssue), io, { pr, allowLegacy:pr!==null, timestamp })
    : admitIssueSerialized(Number(options.admitIssue), io, { pr, allowLegacy:pr!==null, timestamp })
  if(options.claim){
    const requested=validateClaimObjects(options.objects??[]).sort()
    if(admitted?.curated===true)requireCuratedClaimObjects(requested,options.admitIssue)
    else{
    const authorized=[...(admitted.writes??[])].sort()
    if(requested.length!==authorized.length||requested.some((value,index)=>value!==authorized[index]))throw new LaneError(`--claim objects must exactly match admitted issue #${options.admitIssue} writes`)
    }
  }
  return admitted
}
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
  const authority=claimFirstAuthority(io)
  if(!authority?.live||authority.calling_task!==authority.task)throw new LaneError(`acting on abandonment evidence: ${sessionAuthorityRefusal(authority)}`)
  return audit
}








// Author check-in receipt helpers. The check-in writer (checkInAuthor) is
// retired with the migration author lease (popcre/ai-devops#2172), but
// check-migration-pr-lease.mjs still validates historical check-in receipts.
export const AUTHOR_CHECKIN_MESSAGE='db-coordination author-checkin '
export function authorCheckinRef(claim,body){const lease=parseAuthorLease(body);return `refs/db-author-checkins/${claim}-${lease.version}-${sha256(body).slice(0,24)}`}
export function validateAuthorCheckin(record,claim,now=new Date(),{pr,headSha}={}){
  if(!Number.isSafeInteger(Number(pr))||Number(pr)<=0||!/^[0-9a-f]{40}$/.test(String(headSha)))throw new LaneError('author check-in requires exact positive PR and40-character head binding')
  const lease=parseAuthorLease(claim.body,now),fields=['schema_version','kind','human_identity_authenticated','claim','issue','pr','head_sha','owner','branch','worktree','version','body_sha256','expires_at','author_session','checked_in_at']
  if(!record||Array.isArray(record)||Object.keys(record).length!==fields.length||fields.some(k=>!Object.hasOwn(record,k))||record.schema_version!==1||record.kind!=='author-checkin'||record.human_identity_authenticated!==false||!['claim','issue','pr'].every(k=>Number.isSafeInteger(record[k])&&record[k]>0)||!/^[0-9a-f]{40}$/.test(record.head_sha)||record.claim!==Number(claim.number)||record.owner!==lease.owner||record.branch!==lease.branch||record.worktree!==lease.worktree||record.version!==lease.version||record.body_sha256!==sha256(claim.body)||record.expires_at!==lease.expiresAt.toISOString()||!resolveSessionAuthority({env:{SHARED_DB_SESSION_ID:record.author_session},claimOwner:record.owner}).live||(pr!==undefined&&record.pr!==Number(pr))||(headSha!==undefined&&record.head_sha!==headSha))throw new LaneError('author check-in confirmation differs from exact owner, source or claim')
  const checked=Date.parse(record.checked_in_at)
  if(!Number.isFinite(checked)||checked>now.valueOf()||now.valueOf()-checked>AUTHOR_CHECKIN_INTERVAL_MINUTES*60000)throw new LaneError(`author check-in confirmation is missing, future or older than ${AUTHOR_CHECKIN_INTERVAL_MINUTES} minutes`)
  if(lease.expiresAt.valueOf()-checked>MAX_AUTHOR_LEASE_HOURS*3600000||lease.expiresAt.valueOf()<=checked)throw new LaneError(`author permission exceeds ${MAX_AUTHOR_LEASE_HOURS*60} minutes or is expired`)
  return record
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
// Exclusive lock code extracted to scripts/lib/lanes/exclusive-locks.mjs (issue #5382).
// Re-exported here so the CLI and tests work unchanged.
export {
  releaseExclusive,
  recoverExclusive,
  acquireExclusive,
  PROMOTION_FREEZE_REF,
  PROMOTION_FREEZE_MAX_TTL_MINUTES,
  readPromotionFreeze,
  productionPrefixOk,
  freezeTolerantMerge,
  assertNoPromotionFreeze,
  acquirePromotionFreeze,
  releasePromotionFreeze,
} from './lib/lanes/exclusive-locks.mjs'

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
    if (a === '--acquire-promotion-freeze') out.acquirePromotionFreeze = true
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
    else if (a === '--delivery-preflight') out.deliveryPreflight = true
    else if (['--preflight-input','--evidence-bundle','--prior-evidence-bundle','--prior-preflight-record','--integration-facts','--changed-files-file','--delivery-preflight-record'].includes(a)) { out[a.slice(2).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = next(i); i++ }
    else if (a === '--reviewer-preflight') out.reviewerPreflight = true
    else if (a === '--cleanup-stale') out.cleanup = true
    else if (a === '--recover-completed-claim') out.recoverCompletedClaim = Number(next(i++))
    else if (a === '--recovery-review-issue') out.recoveryReviewIssue = Number(next(i++))
    else if (a === '--recovery-review-pr') out.recoveryReviewPr = Number(next(i++))
    else if (a === '--recovery-review-head') out.recoveryReviewHead = next(i++)
    else if (a === '--owner-decision' || a === '--review-approval') throw new LaneError(`${a} is retired (#3675, owner ruling 2026-09-28: never ask a human to approve)`)
    else if (a === '--recover-author-mutex') out.recoverMutex = true
    else if (a === '--flow-audit') out.flowAudit = true
    else if (a === '--reconcile-flow') out.reconcileFlow = true
    else if (a === '--abandonment-audit') out.abandonmentAudit = true
    else if (a === '--prepare-preview-dispatch') out.preparePreviewDispatch = Number(next(i++))
    else if (a === '--repair-preview-ready') out.repairPreviewReady = next(i++)
    else if (a === '--terminalize-historical-preview-ready') out.terminalizeHistoricalPreviewReady = next(i++)
    else if (a === '--json') out.json = true
    else if (['--propose-train','--validate-train','--authorize-train','--dispatch-train','--close-train','--verify-train-dispatch','--train-proof','--authorization-digest','--target-identity','--target','--commit-sha','--allowlist','--failed-applied-prefix'].includes(a)) { out[a.slice(2).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = next(i); i++ }
    else if (a === '--confirm-stale') out.confirmStale = true
    else if (/^--acquire-(preview|preview-recovery|preview-rehearsal|merge|production)$/.test(a)) out.acquireExclusive = a.slice(10)
    else if (/^--release-(preview|preview-recovery|preview-rehearsal|merge|production)$/.test(a)) out.releaseExclusive = a.slice(10)
    else if (['--task','--owner','--branch','--worktree','--issue','--pr','--head-sha','--owner-sha','--expected-sha','--released-claim','--active-claim','--source-pr','--target-pr','--target-branch','--target-worktree','--target-url','--description','--claim-number','--failed-sequence','--failure-code','--failing-check','--historical-terminal-failure-log','--historical-source-receipt','--old-version','--reviewer','--reviewer-allowlist','--status','--wrapper','--version-pr-map','--blocked-on','--review-slot','--reason','--evidence','--evidence-sha','--verdict','--findings-ref','--replacement-sequence','--run-id','--artifact-id','--artifact-digest','--manifest-digest','--database-preview-classification-file','--worktree-state','--recovery-artifact','--hold-reason','--prompt','--prompt-file','--old-owner','--new-owner','--recipient-chat-id','--request-id','--handoff-ready-ref','--abandonment-issue','--authorization-chat-id','--authorization-quote-file','--owner-quote-file'].includes(a)) { out[a.slice(2).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = next(i); i++ }
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
    if(String(process.env.SHARED_DB_MERGED_PR_ISSUE_BINDING??'').trim())io=withMergedPrIssueBinding(io,process.env.SHARED_DB_MERGED_PR_ISSUE_BINDING)
    const primaryKeys=['proposeTrain','validateTrain','authorizeTrain','dispatchTrain','closeTrain','verifyTrainDispatch','authorizeRepositoryMaintenanceStatus','resolveAdmittedIssueForPr','outcomeStatus','advanceOutcome','repairOutcomeHistory','completeOutcome','recoverMutex','reconcileFlow','abandonmentAudit','preparePreviewDispatch','repairPreviewReady','terminalizeHistoricalPreviewReady','flowAudit','reviewerPreflight','deliveryPreflight','acquireExclusive','releaseExclusive','acquirePromotionFreeze','releasePromotionFreeze','returnIssue','queueAudit','assertExclusive','recoverExclusive','completeWork','setScopeStatus','recoverCompletedClaim','cleanup','audit']
    const selectedPrimary=primaryKeys.filter((key)=>Object.prototype.hasOwnProperty.call(o,key))
    const hasAdmission=Object.prototype.hasOwnProperty.call(o,'admitIssue')
    if(selectedPrimary.length>1)throw new LaneError(`choose exactly one primary operation; received ${selectedPrimary.join(', ')}`)
    if(hasAdmission&&(!Number.isInteger(o.admitIssue)||o.admitIssue<=0))throw new LaneError('--admit-issue requires a positive issue number')
    const numericPrimary=new Set(['resolveAdmittedIssueForPr','outcomeStatus','repairOutcomeHistory','completeOutcome','preparePreviewDispatch','returnIssue'])
    if(selectedPrimary.length===1&&numericPrimary.has(selectedPrimary[0])&&(!Number.isInteger(o[selectedPrimary[0]])||o[selectedPrimary[0]]<=0))throw new LaneError(`--${selectedPrimary[0].replace(/[A-Z]/g,(value)=>`-${value.toLowerCase()}`)} requires a positive number`)
    const admissionCombined=new Set(['preparePreviewDispatch','acquireExclusive','advanceOutcome'])
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
      if(typeof io.flowAdapter!=='function')throw new LaneError('reconcile runtime adapter is unavailable')
      const result=reconcileFlow(io.flowSnapshot(now),io.flowAdapter());console.log(JSON.stringify(result,null,2))
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
        if(typeof io.flowAdapter!=='function')throw new LaneError('reconcile runtime adapter is unavailable')
        if(io.previewLedger===undefined)io={...io,previewLedger:()=>livePreviewLedger({workflowPreviewRef:process.env.PREVIEW_PROJECT_REF})}
        const result=reconcileFlow(io.flowSnapshot(now,{capacityOnly:true}),reportOnlyFlowIo(io.flowAdapter()),{capacityOnly:true})
        console.log(JSON.stringify(result,null,2))
        return abandonmentAuditExit(result)
      }catch(error){
        console.error(`REFUSED: ${error.message}`)
        return AUDIT_EXIT_UNVERIFIABLE
      }
    }
    if(o.preparePreviewDispatch){
      if(typeof io.flowAdapter!=='function')throw new LaneError('preview preparation runtime adapter is unavailable')
      requireAdmissionArguments(o,io,{pr:o.pr})
      const result=preparePreviewDispatch(o.preparePreviewDispatch,io.flowAdapter(o.claimNumber,io.enforceAdmission===true?o:null))
      console.log(JSON.stringify(result,null,2));return 0
    }
    if(o.repairPreviewReady){
      if(!o.issue)throw new LaneError('--repair-preview-ready requires --issue <n>')
      if(typeof io.flowAdapter!=='function')throw new LaneError('preview repair runtime adapter is unavailable')
      console.log(JSON.stringify(repairPreviewReady(o.repairPreviewReady,Number(o.issue),io.flowAdapter()),null,2));return 0
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
    if(o.reviewerPreflight){console.log(JSON.stringify(reviewerExecutionPreflight(o,io),null,2));return 0}
    if (o.acquireExclusive) { if(o.acquireExclusive!=='merge')requireAdmissionArguments(o,io,{pr:o.pr??null});console.log(JSON.stringify(acquireExclusive(o.acquireExclusive, { owner:o.owner, pr:o.pr, headSha:o.headSha, versions:o.versions, versionPrMap:o.versionPrMap, admissionOptions:o }, io), null, 2)); return 0 }
    // Issue #3779 step 8a: the direct `releaseOwnedRef` CLI fast path is gone.
    // Every --release-<lane> call, legacy SHA callers included, is handled below
    // by `releaseExclusive` under the coordination mutex.
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
          console.error('OUTSIDE STRUCTURAL WORK: these open issues fail the shape test (AGENTS.md 0.0-C). Reject or fork each one; never work it here.')
          for (const item of actionable) console.error(describe(item))
        }
        if (outside.length) {
          // OWNER RULING 2026-08-21 (issue #1366): the orchestrator handles
          // structure and schema only. These rows are listed so an audit can see
          // them and so nothing accumulates unseen - NOT so the orchestrator can
          // pick them up. There is no orchestrator action for any of them.
          console.error('OWNED BY REPO SESSION: listed for audit visibility only (owner ruling 2026-08-21, issue #1366). The structural lane covers structure/schema only. Do NOT work these and do NOT dispatch them; a separately started session owns them.')
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
        console.error('SELF-SERVICE ADDITIVE LANE: structural work admitted claim-first (issue #3199); each author claims the lane, draws reviewers and dispatches the guarded merge through the same guarded machinery.')
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
        sessionAuthority:()=>claimFirstAuthority(io),
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
    throw new LaneError('choose --admit-issue, --audit, --queue-audit, --abandonment-audit, --outcome-status, --repair-outcome-history, --complete-outcome, --return-issue, --cleanup-stale, or an exclusive-lane command')
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
    const requalified=requalifiedPreviewRun(run)
    if(requalified&&JSON.stringify([...versions].map(String).sort())!==JSON.stringify([requalified.version])){reject(runId,lane,`pinned re-qualified run covers only ${requalified.version}`);continue}
    if(run?.run_attempt!==1&&!requalified){reject(runId,lane,`run attempt is ${run?.run_attempt}, not 1`);continue}
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
    const pinnedPreview=requalified?requalifiedPreviewArtifact(run,artifacts):null
    if(requalified&&!pinnedPreview){reject(runId,lane,'pinned re-qualified run artifacts do not match the pinned preview artifact and companions');continue}
    const rows=pinnedPreview?[pinnedPreview]:selectPreviewArtifacts({run,jobs,artifacts})
    const tolerated=Boolean(pinnedPreview)||(allRows.length===2&&rows.length===1)
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
