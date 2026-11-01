// Split from scripts/manage-migration-author-lanes.mjs (issue #3726, #5382).
// Behavior-preserving move: the entrypoint re-exports every public name defined
// here. Edit here, not there.
import { randomUUID } from 'node:crypto'
import { parseLeaseMessage, assertLease, formatLeaseMessage, evaluateRecovery, recoveredLeaseMetadata } from '../../lib/exclusive-lease.mjs'
import { EXCLUSIVE_REFS } from './queue-routing.mjs'
import { LaneError, parseAuthorLease } from './claims.mjs'
import { MUTEX_REF } from './constants.mjs'
import { acquireMutex, releaseMutexOnExit, requireOwnedRef, releaseOwnedRef, acquireRef, leaseHoldText } from './holds-and-refs.mjs'
import { addedMigrationVersions, parseVersionPrMap, assertMergeCommitInMainHistory } from './claim-maintenance.mjs'
import { classifyBranchFreshness, isProductionInertPath, classifyMainTip } from '../../check-main-tip-freshness.mjs'
import { githubIo, requireAdmission, requirePrOperationRoute } from '../../manage-migration-author-lanes.mjs'
import {
  EXCLUSIVE_LOCK_ORDER,
  assertExclusiveAcquisitionPolicy,
  assertExclusivePairCompatibility,
  assertProductionFreshnessForExclusive,
  compatibilityMatrixCases,
  defaultCompatibilityPlan,
  pairKindForExclusiveKind,
} from './exclusive-policy.mjs'

// Pure lock-manager policy (Step 10, issue #3781). Re-exported here so callers
// of the exclusive-lock surface get the compatibility-matrix assertions without
// importing the policy module directly. `assertExclusiveAcquisitionPolicy` is
// the entry point: production freshness under the unified production-inert
// rule, promotion-freeze blocking of merge, and pair compatibility against
// every held exclusive kind (including the merge/production cross-ref
// interlocks). The existing `readExclusiveLease` / `assertExclusive` fencing
// below is unchanged and still required immediately before every write.
export {
  EXCLUSIVE_LOCK_ORDER,
  assertExclusiveAcquisitionPolicy,
  assertExclusivePairCompatibility,
  assertProductionFreshnessForExclusive,
  compatibilityMatrixCases,
  defaultCompatibilityPlan,
  pairKindForExclusiveKind,
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
export function releaseExclusive(kind, expected = {}, io = githubIo) {
  const ref = EXCLUSIVE_REFS[kind]
  if (!ref) throw new LaneError(`unknown exclusive lane: ${kind}`)
  const hasIdentity = expected.holderId !== undefined && expected.holderId !== null && expected.holderId !== ''
  const hasGeneration = expected.generation !== undefined && expected.generation !== null && expected.generation !== ''
  if (hasIdentity !== hasGeneration) throw new LaneError('release by identity needs BOTH --holder-id and --generation')
  if (hasGeneration && (!Number.isInteger(expected.generation) || expected.generation <= 0)) throw new LaneError('--generation must be a positive integer')
  if (!hasIdentity && !expected.ownerSha) throw new LaneError('release needs --holder-id and --generation, or the acquisition --owner-sha')
  if (expected.ownerSha !== undefined && expected.ownerSha !== null && !/^[0-9a-f]{40}$/i.test(String(expected.ownerSha))) throw new LaneError('--owner-sha must be the full 40-hex acquisition sha')
  const ownerSha = io.makeOwnerCommit(`db-coordination ${kind} release-${randomUUID()}`)
  acquireMutex(ownerSha, io)
  try {
    // RE-READ UNDER THE MUTEX. Nothing observed before acquisition counts.
    const lease = readExclusiveLease(kind, io)
    // An absent ref releases idempotently and touches nothing.
    if (!lease) return { kind, ref, released: false, idempotent: true, reason: 'the lane was already free' }
    // A legacy lease has no identity to check, so it keeps the exact-sha
    // contract rather than being releasable by anyone who asks. It is never
    // upgraded implicitly and never taken over.
    if (lease.legacy) {
      if (!expected.ownerSha) throw new LaneError('this lane holds a pre-Step-6 lease; release it with its exact acquisition sha')
      if (lease.sha !== expected.ownerSha) throw new LaneError(`refusing to release ${ref}: it belongs to another owner (legacy lease ${lease.sha}, caller named ${expected.ownerSha})`)
      requireOwnedRef(MUTEX_REF, ownerSha, io)
      releaseOwnedRef(ref, lease.sha, io)
      proveReleased()
      return { kind, ref, released: true, legacy: true }
    }
    // LEGACY SHA CALLER (issue #3779 step 8a): a caller that still passes only the
    // acquisition sha is resolved to holder + generation from THAT commit, under
    // the mutex, and then held to the same identity rule as a modern caller. A
    // lease that has since been recovered carries a new sha, holder and
    // generation, so the old holder's release refuses and the successor is never
    // touched. A different ref sha is NEVER read as "we already released".
    // preview, preview-recovery and preview-rehearsal share ONE ref (issue
    // #4604). The workflows release by ref name (--release-preview), so the
    // caller's kind may legitimately differ from the lease's exact kind. The
    // ref equality is what matters; holder, generation and sha still bind.
    if (EXCLUSIVE_REFS[lease.kind] !== ref) throw new LaneError(`refusing to release ${ref}: it holds a ${lease.kind} lease, which does not live on this ref`)
    const identity = { kind: lease.kind }
    if (hasIdentity) { identity.holderId = String(expected.holderId); identity.generation = expected.generation }
    if (expected.ownerSha) {
      let message = null
      try { message = io.readCommitMessage?.(expected.ownerSha) ?? null } catch { message = null }
      if (!message) throw new LaneError(`refusing to release ${ref}: the acquisition commit ${expected.ownerSha} is unreadable, so its holder and generation cannot be proved`)
      let acquired
      try { acquired = parseLeaseMessage(message) } catch (error) { throw new LaneError(`refusing to release ${ref}: ${expected.ownerSha} is not a lease commit (${error.message})`) }
      if (acquired.legacy) throw new LaneError(`refusing to release ${ref}: ${expected.ownerSha} is a pre-Step-6 lease commit but the lane holds a fenced lease`)
      if (hasIdentity && (acquired.holderId !== identity.holderId || acquired.generation !== identity.generation)) throw new LaneError(`refusing to release ${ref}: --owner-sha ${expected.ownerSha} was acquired by ${acquired.holderId} generation ${acquired.generation}, not ${identity.holderId} generation ${identity.generation}`)
      identity.holderId = acquired.holderId
      identity.generation = acquired.generation
      if (lease.sha !== expected.ownerSha) {
        // Same holder and generation but a moved sha would mean the ref was
        // rewritten outside acquisition/recovery; refuse that too.
        assertLease(lease, identity)
        throw new LaneError(`refusing to release ${ref}: it now points at ${lease.sha}, not the acquisition sha ${expected.ownerSha}; ownership moved and the current holder is untouched`)
      }
    }
    assertLease(lease, identity)
    requireOwnedRef(MUTEX_REF, ownerSha, io)
    releaseOwnedRef(ref, lease.sha, io)
    proveReleased()
    return { kind, ref, released: true, holderId: lease.holderId, generation: lease.generation, ownerSha: lease.sha }
    // Absence is the only proof of our own release. We hold the mutex, so a
    // different sha here means a writer bypassed serialization; say so.
    function proveReleased() {
      const after = io.readRef(ref)
      if (after !== null) throw new LaneError(`release of ${ref} is not proven: it reads back as ${after}; a different sha is not proof that this lease was deleted, and the current owner is untouched`)
    }
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
      // #4845: the dispatched commit may be a verified prefix of main -- main moved
      // only by production-inert paths or migrations appended strictly after its
      // ledger, proven from local git; any other move or git failure refuses.
      const tip = io.mainSha?.()
      if (metadata.headSha !== tip && !(io.productionPrefixOk ?? productionPrefixOk)(metadata.headSha, tip)) throw new LaneError('production lane requires the exact current main SHA or a verified prefix of it')
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
      // #4385/PR #4386 is the same circular case: preview already holds the abandoned
      // row 20261016012631 whose byte-identical replacement 20261016210024 PR #4386
      // carries, so it cannot be previewed until the reconciliation renames that row.
      const pending4385 = Number(metadata.pr) === 4386 && pr?.state === 'open' && pr?.merged !== true && Boolean(pr?.head?.sha)
      // #4827: PR #4772 (#4437, claim #4820) is the same circular case: preview holds its
      // abandoned row 20261025180137, whose byte-identical replacement 20261026162917 it
      // now carries, and every post-merge preview rehearsal fails until that row is renamed.
      const pending4827 = Number(metadata.pr) === 4772 && pr?.state === 'open' && pr?.merged !== true && Boolean(pr?.head?.sha)
      if (!pending1211 && !pending1439 && !pending1658 && !pending4385 && !pending4827 && (pr?.merged !== true || !pr?.merge_commit_sha)) throw new LaneError('historical preview recovery requires an already-merged source PR or an exact allowlisted pending-replacement PR')
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
        // #2758 (claim-first session identity, 2026-09-11): main may move independently
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
      if (kind === 'merge' && !freezeTolerantMerge(io, metadata.pr)) assertNoPromotionFreeze(io, metadata.now ?? new Date())
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
// Owner rule, Albert Hazan in his chat 2026-10-21 (verbatim): "no session is
// allowed to freeze merges for more than 1hr. that's the new rule"
export const PROMOTION_FREEZE_REF = 'refs/db-coordination/promotion-freeze'
export const PROMOTION_FREEZE_MAX_TTL_MINUTES = 60
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

// PATH-SCOPED FREEZE (#4845). The freeze exists so main does not move in a way
// the running production gate would refuse. `check-main-tip-freshness --production`
// tolerates production-inert paths and migrations APPENDED strictly after the
// dispatched ledger, so a merge made only of those cannot disturb the run; it
// merges through the freeze. Version order is re-proven by the production gate
// itself, which refuses (as before) if it does not hold. Gate code, workflows,
// config, modified/removed migrations, and an unreadable file list still wait.
export function productionPrefixOk(headSha, tipSha) {
  try { return classifyMainTip({ mainSha: headSha, tipSha, production: true }).ok === true } catch { return false }
}

export function freezeTolerantMerge(io, pr) {
  let files
  try { files = io.getPrFiles?.(Number(pr)) } catch { return false }
  if (!Array.isArray(files) || files.length === 0) return false
  return files.every((file) => {
    const path = String(file?.filename ?? file?.path ?? '')
    if (isProductionInertPath(path)) return true
    return file?.status === 'added' && /^supabase\/(?:migrations\/\d{14}_[^/]+|tests\/[^/]+)\.sql$/.test(path)
  })
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
