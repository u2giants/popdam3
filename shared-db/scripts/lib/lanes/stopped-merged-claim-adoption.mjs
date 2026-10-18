// Narrow, registered stopped-merged custody succession for issue #3618.
// This lane deliberately does not broaden any ordinary recovery path.
import { isDeepStrictEqual } from 'node:util'
import { readFileSync, lstatSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { LaneError, parseAuthorLease, validateClaimObjects, assertLaneAvailable } from './claims.mjs'
import { MUTEX_REF, REPO } from './constants.mjs'
import { EXCLUSIVE_REFS, parseQueueScope } from './queue-routing.mjs'
import { normalizeWorktreePath } from './claim-versions.mjs'
import { workstreamKey, migrationVersions, renewalIssueScope, assertMergeCommitInMainHistory, replaceLeaseLocation, replaceLeaseExpiry, replaceCapacityState } from './claim-maintenance.mjs'
import { assertClaimNotRetired, assertRetirementIdentityAvailable } from './retirement.mjs'
import { acquireMutex, requireOwnedRef, releaseMutexOnExit, readRefAfterWrite } from './holds-and-refs.mjs'
import { GIT_COMMAND_TIMEOUT_MS } from './github-wire.mjs'
import { normalizeObject } from '../../check-dispatch-collision.mjs'
import { canonicalJson, sha256 } from '../../db-flow/evidence-bundle.mjs'
import { githubIo, assertDurableReviewApproval, resetRetirementSnapshot } from '../../manage-migration-author-lanes.mjs'
import { resolveSessionAuthority } from '../../lib/session-authority.mjs'

export const STOPPED_ADOPTION_REF_PREFIX = 'refs/db-stopped-merged-claim-adoptions/'
const RECEIPT_PREFIX = 'db-coordination stopped-merged-claim-author-adoption '
const SHA = /^[0-9a-f]{40}$/
const DIGEST = /^[0-9a-f]{64}$/
const REGISTERED = Object.freeze({ claim: 4158, issue: 2421, pr: 4161, headSha: '09583df0f6d822479e9821234f7071f505a54953', mergeSha: '3ed8c2ed7b1eb8e5b2f7291340a3d35421012072', version: '20261012012727', oldOwner: 'codex/01a12d90-cce8-7131-b1eb-eff6becc806e-2421', originalOwnerSession: '01a12d90-cce8-7131-b1eb-eff6becc806e', actor: '01a14fa2-bd3e-7d62-ba77-7bdfd7976f0e', repository: 'popcre/shared-db' })
const REQUEST_KEYS = ['issue','claim','pr','headSha','oldOwner','newOwner','branch','worktree','targetWorktree','worktreeState','authorizationChatId','authorizationQuote','recoveryArtifact','leaseHours']
const OBS_KEYS = ['schema_version','original_owner_session','state','latest_turn_status','observed_at','actor']
const MANIFEST_PATH = 'docs/verification/claim4158-recovery/manifest.json'
const CAPABILITY_FILES = ['scripts/lib/lanes/stopped-merged-claim-adoption.mjs','scripts/transfer-stopped-merged-claim-author.mjs','scripts/stopped-merged-claim-adoption.test.mjs','docs/agents/stopped-merged-claim-recovery.md']
const refuse = (message) => { throw new LaneError(`stopped merged adoption refused: ${message}`) }

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) refuse(`${label} has missing or extra fields`)
}
function positive(value) { return Number.isSafeInteger(value) && value > 0 }
function readJsonFile(path) { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { refuse(`cannot read ${path}`) } }
function digestObject(value) { return sha256(canonicalJson(value)) }
function parseFence(body, name) {
  const matches = [...String(body ?? '').matchAll(new RegExp('```' + name + '\\s*\\n([\\s\\S]*?)```', 'g'))]
  if (matches.length !== 1) refuse(`exact ${name} fence is absent or ambiguous`)
  const fields = new Map()
  for (const line of matches[0][1].split('\n')) { const m = /^([a-z_][a-z_0-9]*):\s*(.*)$/.exec(line.trim()); if (m) { if (fields.has(m[1])) refuse(`${name} fence repeats ${m[1]}`); fields.set(m[1], m[2]) } }
  return fields
}
function requireAuditFence(issue, manifest) {
  if (issue?.state !== 'open') refuse('custody audit issue is not open')
  const scope = parseQueueScope(issue.body)
  if (!scope || scope.status !== 'ready' || scope.workType !== 'repo-maintenance' || scope.route !== 'repo-maintenance' || scope.writes.length || scope.reads.length) refuse('custody audit issue is not ready repository-maintenance scope')
  const audit = parseFence(issue.body, 'stopped-merged-custody-audit')
  const expected = { claim: String(REGISTERED.claim), source_pr: String(REGISTERED.pr), source_head_sha: REGISTERED.headSha, original_owner: REGISTERED.oldOwner, manifest_sha256: digestObject(manifest) }
  if(audit.size!==Object.keys(expected).length)refuse('custody audit has unrecognized fields')
  for (const [key, value] of Object.entries(expected)) if (audit.get(key) !== value) refuse(`custody audit fence ${key} differs from manifest`)
}
function proveCapabilityHead(context, io, mainSha) {
  const review = io.getPr(context.reviewPr)
  if (!review || !(review.merged === true || review.merged_at || String(review.state).toLowerCase() === 'merged') || review.head?.sha !== context.reviewHeadSha || !SHA.test(review.merge_commit_sha ?? '')) refuse('capability review PR is not genuinely merged at the reviewed head')
  assertMergeCommitInMainHistory(review.merge_commit_sha, mainSha, io)
  if (typeof io.getFileAt !== 'function') refuse('reviewed capability bytes are unreadable')
  for (const file of CAPABILITY_FILES) {
    const reviewed = io.getFileAt(file, context.reviewHeadSha)
    let current; try { current = readFileSync(file, 'utf8') } catch { current = context.currentFiles?.[file] }
    if (typeof current !== 'string' || reviewed !== current || io.getFileAt(file, mainSha) !== reviewed) refuse(`capability file ${file} differs from reviewed head`)
  }
  const reviewedManifest = io.getFileAt(MANIFEST_PATH, context.reviewHeadSha)
  if (reviewedManifest !== context.manifestBytes || io.getFileAt(MANIFEST_PATH, mainSha) !== reviewedManifest) refuse('reviewed manifest bytes differ from supplied manifest file')
}

export function validateStoppedMergedAdoptionRequest(options) {
  const request = Object.fromEntries(REQUEST_KEYS.map((key) => [key, options?.[key]]))
  exactKeys(options, REQUEST_KEYS, 'request')
  for (const key of ['issue','claim','pr']) if (!positive(request[key])) refuse(`exact positive ${key} required`)
  for (const key of ['oldOwner','newOwner','branch','worktree','targetWorktree','authorizationChatId','authorizationQuote']) if (typeof request[key] !== 'string' || !request[key].trim() || request[key] !== request[key].trim() || /[\r\n`]/.test(request[key])) refuse(`invalid ${key}`)
  if (request.issue !== REGISTERED.issue || request.claim !== REGISTERED.claim || request.pr !== REGISTERED.pr || request.oldOwner !== REGISTERED.oldOwner) refuse('unknown registered case')
  if (!SHA.test(request.headSha) || request.headSha !== REGISTERED.headSha || request.oldOwner === request.newOwner || /\s/.test(request.branch) || normalizeWorktreePath(request.worktree) === normalizeWorktreePath(request.targetWorktree) || request.worktreeState !== 'clean' || request.authorizationQuote.length < 20 || !Number.isFinite(request.leaseHours) || request.leaseHours <= 0 || request.leaseHours > 0.5) refuse('exact source, distinct successor, preservation state, quote and bounded lease required')
  if (typeof request.recoveryArtifact !== 'string' || /[\r\n`]/.test(request.recoveryArtifact)) refuse('request recoveryArtifact is malformed')
  if (!/^codex\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-4158$/.test(request.newOwner)) refuse('newOwner must identify the current exact operator session')
  return request
}

export function validateObservation(observation, now, manifest) {
  exactKeys(observation, OBS_KEYS, 'observation')
  if (observation.schema_version !== 1 || observation.original_owner_session !== manifest.original_owner_session || observation.actor !== manifest.actor || observation.state !== 'notLoaded' || observation.latest_turn_status !== 'completed') refuse('operator observation is not the exact completed notLoaded observation')
  const age = now.valueOf() - Date.parse(observation.observed_at)
  if (!Number.isFinite(age) || age < 0 || age > 120000) refuse('operator observation is stale or from the future')
  return observation
}

function adoptionBody(body, request, expiresAt) {
  const fences = [...String(body).matchAll(/```db-author-lease\s*\n([\s\S]*?)```/g)]
  if (fences.length !== 1 || (fences[0][1].match(/^owner:/gm) ?? []).length !== 1) refuse('exact single author lease required')
  const changed = body.slice(0, fences[0].index) + fences[0][0].replace(fences[0][1], (block) => block.replace(/^owner:.*$/m, `owner: ${request.newOwner}`)) + body.slice(fences[0].index + fences[0][0].length)
  return replaceLeaseExpiry(replaceLeaseLocation(replaceCapacityState(changed, 'active'), request.branch, request.targetWorktree), expiresAt)
}

function readReceipt(ref, request, io) {
  const sha = io.readRef(ref); if (!sha) return null
  let record; const message = String(io.getCommit?.(sha)?.message ?? io.readCommitMessage?.(sha) ?? '')
  try { if (!message.startsWith(RECEIPT_PREFIX)) throw Error(); record = JSON.parse(message.slice(RECEIPT_PREFIX.length)) } catch { refuse('immutable receipt unreadable') }
  const fields = ['schema_version','kind','human_identity_authenticated','request','manifest_sha256','observation_sha256','version','source_merge_sha','main_sha','reservation_sha','original_body_sha256','adopted_body_sha256','original_body','adopted_body','created_at']
  if (!record || Object.keys(record).length !== fields.length || fields.some((field) => !Object.hasOwn(record, field)) || record.schema_version !== 1 || record.kind !== 'stopped-merged-operator-adoption' || record.human_identity_authenticated !== false || !isDeepStrictEqual(record.request, request) || !DIGEST.test(record.manifest_sha256) || !DIGEST.test(record.observation_sha256) || record.version !== REGISTERED.version || ![record.source_merge_sha,record.main_sha,record.reservation_sha].every((x) => SHA.test(x)) || ![record.original_body_sha256,record.adopted_body_sha256].every((x) => DIGEST.test(x)) || !Number.isFinite(Date.parse(record.created_at))) refuse('immutable receipt differs from exact request or has invalid fields')
  if (typeof record.original_body !== 'string' || typeof record.adopted_body !== 'string' || sha256(record.original_body) !== record.original_body_sha256 || sha256(record.adopted_body) !== record.adopted_body_sha256 || adoptionBody(record.original_body,request,new Date(Date.parse(record.created_at)+request.leaseHours*3600000)) !== record.adopted_body) refuse('receipt full-body preservation differs')
  return { sha, record }
}

function bundleProof(bundle, io, manifest) {
  if (typeof bundle !== 'string' || !bundle) return false
  try {
    const metadata = io.lstat ? io.lstat(bundle) : lstatSync(bundle)
    if (!metadata?.isFile?.() || metadata.isSymbolicLink?.()) return false
  } catch { return false }
  let actualHash
  try { actualHash = typeof io.fileSha256 === 'function' ? io.fileSha256(bundle) : createHash('sha256').update(readFileSync(bundle)).digest('hex') } catch { return false }
  if (actualHash !== manifest.source_bundle_sha256) return false
  if (typeof io.verifyBundle === 'function') {
    const proof = io.verifyBundle(bundle, REGISTERED.headSha)
    if (!proof) return false
    if (typeof proof === 'object' && proof.headSha && proof.headSha !== REGISTERED.headSha) return false
    return true
  }
  try {
    execFileSync('git', ['bundle','verify',bundle], { stdio: 'ignore', timeout:GIT_COMMAND_TIMEOUT_MS, killSignal:'SIGKILL' })
    const heads = execFileSync('git', ['bundle','list-heads',bundle], { encoding:'utf8', timeout:GIT_COMMAND_TIMEOUT_MS, killSignal:'SIGKILL' }).trim().split(/\r?\n/)
    return heads.some(line => line === `${REGISTERED.headSha} HEAD` || line === `${REGISTERED.headSha} refs/heads/codex/issues-2478-2421-2420`)
  } catch { return false }
}

function worktreeProof(path, io, expectedSha, branch, expectedDigest) {
  if (!io.localClean?.(path) || io.localHead?.(path) !== expectedSha || io.localBranch?.(path) !== branch) return false
  if (sha256(path) !== expectedDigest) return false
  return true
}
function worktreeRepository(path, io) {
  if (typeof io.worktreeRepository === 'function') return io.worktreeRepository(path)
  try {
    const remote = execFileSync('git', ['-C', path, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', timeout:GIT_COMMAND_TIMEOUT_MS, killSignal:'SIGKILL' }).trim()
    const match = /(?:github\.com[/:])([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote)
    return match?.[1] ?? null
  } catch { return null }
}

function physicalCheckoutIdentity(location,io) {
  let identity
  try {
    if (typeof io.physicalCheckoutIdentity === 'function') identity=io.physicalCheckoutIdentity(location)
    else {
      const requested=realpathSync(location)
      const top=realpathSync(execFileSync('git',['-C',requested,'rev-parse','--show-toplevel'],{encoding:'utf8',timeout:GIT_COMMAND_TIMEOUT_MS,killSignal:'SIGKILL'}).trim())
      const gitDir=realpathSync(execFileSync('git',['-C',requested,'rev-parse','--absolute-git-dir'],{encoding:'utf8',timeout:GIT_COMMAND_TIMEOUT_MS,killSignal:'SIGKILL'}).trim())
      if (!lstatSync(top).isDirectory() || !lstatSync(gitDir).isDirectory()) refuse('physical checkout is not a directory')
      identity={requested,top,gitDir}
    }
  } catch { refuse('physical checkout identity is unavailable') }
  if (!identity || !['requested','top','gitDir'].every(key=>typeof identity[key]==='string' && identity[key].startsWith('/')) || identity.requested!==identity.top) refuse('physical checkout does not own requested path')
  return identity
}
function proveDistinctPhysicalCustody(request,io) {
  const old=physicalCheckoutIdentity(request.worktree,io),next=physicalCheckoutIdentity(request.targetWorktree,io)
  if (old.top===next.top || old.gitDir===next.gitDir) refuse('original and successor physical custody aliases')
}

export function proveStoppedMergedAdoption(request, now, io, manifest, observation, prior = null, context = {}) {
  resetRetirementSnapshot()
  const claim = io.getIssue(request.claim); const lease = parseAuthorLease(claim?.body ?? '', now)
  const adopted = Boolean(prior) && lease.owner === request.newOwner && lease.worktree === request.targetWorktree
  if (claim?.state !== 'open' || workstreamKey(claim.title) !== `#${request.issue}` || lease.legacy || lease.version !== REGISTERED.version || lease.branch !== request.branch || (!adopted && (lease.owner !== request.oldOwner || lease.worktree !== request.worktree || lease.capacityState !== 'relinquished' || lease.worktreeState !== 'clean' || lease.expiresAt.valueOf() >= now.valueOf()))) refuse('exact open relinquished stopped claim required; active or expired leases refuse')
  if (!adopted && lease.blockedOn !== 'issue:#2421') refuse('claim is stopped on an unexpected dependency')
  if (sha256(claim.body) !== manifest.original_claim_body_sha256 && !adopted) refuse('original claim body hash differs from manifest')
  if (adopted && (lease.capacityState !== 'active' || !lease.capacityActive || lease.expiresAt.valueOf() <= now.valueOf())) refuse('adopted permission is stopped or expired')
  if (prior && sha256(claim.body) !== (adopted ? prior.record.adopted_body_sha256 : prior.record.original_body_sha256)) refuse('claim body changed from immutable receipt')
  assertClaimNotRetired(lease.version, 'adopted', io); renewalIssueScope(io.getIssue(request.issue), lease, [request.issue], { allowClaimSuperset: true })
  if (REPO !== REGISTERED.repository || worktreeRepository('.',io) !== REGISTERED.repository) refuse('canonical repository identity differs')
  const authority = resolveSessionAuthority({ env: io.env ?? process.env, claimOwner: request.newOwner })
  if (!authority.live || authority.calling_task !== authority.task || authority.task !== manifest.actor || request.authorizationChatId !== manifest.actor) refuse('current session authority does not equal the registered actor')
  if (typeof io.currentAuthorizationQuote === 'function' && io.currentAuthorizationQuote() !== request.authorizationQuote) refuse('current user authorization quote differs from the bound request')
  requireAuditFence(io.getIssue(3618), manifest)
  validateObservation(observation, now, manifest)
  const pr = io.getPr(request.pr); if (!(pr?.merged === true || pr?.merged_at || String(pr?.state).toLowerCase() === 'merged') || pr?.head?.sha !== REGISTERED.headSha || pr?.head?.ref !== request.branch || pr?.merge_commit_sha !== REGISTERED.mergeSha) refuse('exact merged source PR changed')
  const mainSha = io.mainSha?.(); if (!SHA.test(mainSha ?? '')) refuse('exact current main required'); assertMergeCommitInMainHistory(REGISTERED.mergeSha, mainSha, io)
  if (prior) { if (prior.record.source_merge_sha !== REGISTERED.mergeSha) refuse('immutable source merge changed'); assertMergeCommitInMainHistory(prior.record.main_sha,mainSha,io) }
  const versions = migrationVersions(io.getPrFiles(request.pr)); if (versions.length !== 1 || versions[0] !== REGISTERED.version) refuse('source migration does not match permanent version')
  const objects = io.prStructuralObjects?.(request.pr, REGISTERED.headSha); if (!Array.isArray(objects) || !objects.length) refuse('canonical merged-source object parser is empty')
  const held = new Set(lease.objects.map(normalizeObject)); if (validateClaimObjects(objects).some((object) => !held.has(object))) refuse('source writes outside original claim')
  const claims = io.openClaims(); if (claims.filter((row) => Number(row.number) === request.claim).length !== 1 || claims.find(row => Number(row.number) === request.claim)?.body !== claim.body) refuse('claim is not present exactly once in open roster')
  if (claims.some((row) => Number(row.number) !== request.claim && normalizeWorktreePath(parseAuthorLease(row.body, now).worktree) === normalizeWorktreePath(request.targetWorktree))) refuse('successor worktree belongs to another claim')
  assertRetirementIdentityAvailable({ branch: '', worktree: request.targetWorktree }, io); assertLaneAvailable(claims.filter((row) => Number(row.number) !== request.claim), lease.objects, now, { prSources: io.prSources?.() ?? [] })
  const reservationSha = io.readRef(`refs/db-claims/${REGISTERED.version}`); if (!SHA.test(reservationSha ?? '') || !io.getCommit(reservationSha) || (prior && prior.record.reservation_sha !== reservationSha) || reservationSha !== manifest.reservation_sha) refuse('permanent version reservation absent or changed')
  for (const [kind, ref] of Object.entries(EXCLUSIVE_REFS)) if (io.readRef(ref)) refuse(`${kind} stage is held`)
  const readyPrefix = 'refs/db-author-handoff-ready/'
  if (typeof io.listRefs !== 'function') refuse('ready author consent listing is unavailable')
  const readyRefs = io.listRefs(readyPrefix); if (!Array.isArray(readyRefs)) refuse('ready author consent listing is unreadable')
  if (readyRefs.some((row) => String(row.ref ?? '').startsWith(`${readyPrefix}${request.claim}-`))) refuse('ready author consent appeared; use cooperative route')
  if (!worktreeProof(request.worktree, io, REGISTERED.headSha, request.branch, manifest.original_worktree_sha256) || !worktreeProof(request.targetWorktree, io, REGISTERED.headSha, request.branch, manifest.successor_worktree_sha256)) refuse('original and successor worktrees are not clean exact custody')
  proveDistinctPhysicalCustody(request,io)
  if (!bundleProof(context.preservationBundle, io, manifest)) refuse('preservation bundle is missing, unsafe or does not verify')
  if (worktreeRepository(request.worktree, io) !== REGISTERED.repository || worktreeRepository(request.targetWorktree, io) !== REGISTERED.repository || normalizeWorktreePath(request.worktree) === normalizeWorktreePath(request.targetWorktree)) refuse('working copies do not prove distinct canonical custody')
  if (typeof io.getFileAt === 'function' && io.getFileAt(MANIFEST_PATH, context.reviewHeadSha) !== context.manifestBytes) refuse('manifest bytes at reviewed head differ')
  return { claim, lease, adopted, mainSha, reservationSha }
}

function immutableEvidenceIo(source) {
  const cached=Object.create(source),commits=new Map(),files=new Map()
  cached.getCommit=sha=>{if(!SHA.test(sha??''))return source.getCommit(sha);if(!commits.has(sha))commits.set(sha,source.getCommit(sha));return commits.get(sha)}
  cached.getFileAt=(path,ref)=>{if(!SHA.test(ref??''))return source.getFileAt(path,ref);const key=ref+'\0'+path;if(!files.has(key))files.set(key,source.getFileAt(path,ref));return files.get(key)}
  return cached
}
function recordAttempt(request,observation,context,record,adoptionRef,adoptionSha,mainSha,mutex,io) {
  const ref=`refs/db-stopped-merged-claim-attempts/${request.claim}-${digestObject(request).slice(0,24)}-${digestObject(observation).slice(0,24)}`
  const attempt={schema_version:1,kind:'stopped-merged-adoption-attempt',human_identity_authenticated:false,claim:request.claim,request_sha256:digestObject(request),adoption_ref:adoptionRef,adoption_sha:adoptionSha,observation,current_main_sha:mainSha,review_issue:3618,review_pr:context.reviewPr,review_head_sha:context.reviewHeadSha,grant_created_at:record.created_at,grant_expires_at:new Date(Date.parse(record.created_at)+request.leaseHours*3600000).toISOString()}
  const message='db-coordination stopped-merged-adoption-attempt '+JSON.stringify(attempt)
  requireOwnedRef(MUTEX_REF,mutex,io)
  let sha=io.readRef(ref)
  if(sha){if(io.getCommit(sha)?.message!==message)refuse('immutable attempt differs; refresh stopped observation')}
  else{sha=io.makeOwnerCommit(message);if(!io.createRef(ref,sha))refuse('immutable attempt creation failed')}
  if(readRefAfterWrite(ref,sha,io)!==sha||io.getCommit(sha)?.message!==message)refuse('immutable attempt readback failed')
  requireOwnedRef(MUTEX_REF,mutex,io)
  return {attemptRef:ref,attemptSha:sha}
}
export function transferStoppedMergedClaimAuthor(options, now = new Date(), io = githubIo) {
  const realIo=io===githubIo
  if(realIo)io=immutableEvidenceIo(io)
  const request = validateStoppedMergedAdoptionRequest(options.request ?? Object.fromEntries(REQUEST_KEYS.map((key) => [key, options[key]]))); if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) refuse('valid operation clock required')
  const context = options.request ? options : {}
  if (context.manifestFile && context.manifestFile !== MANIFEST_PATH) refuse('manifest path override is not allowed for the registered descriptor')
  const manifest = context.manifest ?? readJsonFile(context.manifestFile ?? MANIFEST_PATH); exactKeys(manifest, ['schema_version','kind','claim','work_issue','source_pr','source_head_sha','source_merge_sha','version','original_owner','original_owner_session','actor','original_claim_body_sha256','reservation_sha','request_sha256','original_worktree_sha256','successor_worktree_sha256','source_bundle_sha256','human_identity_authenticated'], 'manifest')
  if (manifest.schema_version !== 1 || manifest.kind !== 'registered-stopped-merged-claim-adoption' || manifest.claim !== REGISTERED.claim || manifest.work_issue !== REGISTERED.issue || manifest.source_pr !== REGISTERED.pr || manifest.source_head_sha !== REGISTERED.headSha || manifest.source_merge_sha !== REGISTERED.mergeSha || manifest.version !== REGISTERED.version || manifest.original_owner !== REGISTERED.oldOwner || manifest.original_owner_session !== REGISTERED.originalOwnerSession || manifest.actor !== REGISTERED.actor || manifest.human_identity_authenticated !== false || manifest.request_sha256 !== digestObject(request)) refuse('manifest does not bind exact registered request')
  const observation = context.observation ?? readJsonFile(context.observationFile); validateObservation(observation, now, manifest)
  if (context.reviewIssue !== 3618 || !positive(context.reviewPr) || !SHA.test(context.reviewHeadSha) || context.reviewPr === REGISTERED.pr) refuse('new capability review pin is required')
  context.manifestBytes ??= (() => { try { return readFileSync(context.manifestFile ?? MANIFEST_PATH, 'utf8') } catch { refuse('supplied manifest file is unreadable') } })()
  if (JSON.parse(context.manifestBytes) && digestObject(manifest) !== digestObject(JSON.parse(context.manifestBytes))) refuse('supplied manifest bytes do not parse to supplied manifest')
  const clock = () => { const date = typeof io.now === 'function' ? new Date(io.now()) : (realIo ? new Date() : new Date(now.valueOf() + (Date.now() - startedAt))); if (!Number.isFinite(date.valueOf())) refuse('invalid fresh operation clock'); return date }
  const startedAt = Date.now()
  const capabilityProof = () => {
    const freshNow = clock()
    validateObservation(observation, freshNow, manifest)
    if (context.observationFile && !isDeepStrictEqual(readJsonFile(context.observationFile), observation)) refuse('observation file changed')
    const main = io.mainSha(); if (!SHA.test(main ?? '')) refuse('current main unreadable')
    assertDurableReviewApproval(3618, context.reviewPr, context.reviewHeadSha, io, {includeArchived:true})
    proveCapabilityHead(context, io, main)
    return freshNow
  }
  const ref = `${STOPPED_ADOPTION_REF_PREFIX}${request.claim}-${sha256(canonicalJson(request)).slice(0,24)}`
  // Full proof before acquiring a mutation-capable lock, repeated underneath it.
  proveStoppedMergedAdoption(request, capabilityProof(), io, manifest, observation, readReceipt(ref,request,io), context)
  const mutex = io.makeOwnerCommit(`db-coordination claim-author-transfer-mutex claim=${request.claim} operation=stopped-merged-adoption`); acquireMutex(mutex, io)
  let before = null, after = null, changed = false, receiptSha = null, result = null, failure = null
  try {
    const prior=readReceipt(ref,request,io),liveNow=capabilityProof()
    if(prior&&(Date.parse(prior.record.created_at)>liveNow.valueOf()||Date.parse(prior.record.created_at)+request.leaseHours*3600000<=liveNow.valueOf()||prior.record.original_body_sha256!==manifest.original_claim_body_sha256||prior.record.reservation_sha!==manifest.reservation_sha||prior.record.source_merge_sha!==REGISTERED.mergeSha||prior.record.manifest_sha256!==digestObject(manifest)))refuse('immutable receipt expired or evidence changed')
    const proof=proveStoppedMergedAdoption(request,liveNow,io,manifest,observation,prior,context)
    const createdAt=prior?.record.created_at??liveNow.toISOString()
    before=prior?.record.original_body??proof.claim.body
    after=adoptionBody(before,request,new Date(Date.parse(createdAt)+request.leaseHours*3600000))
    const record={schema_version:1,kind:'stopped-merged-operator-adoption',human_identity_authenticated:false,request,manifest_sha256:digestObject(manifest),observation_sha256:prior?.record.observation_sha256??digestObject(observation),version:REGISTERED.version,source_merge_sha:REGISTERED.mergeSha,main_sha:prior?.record.main_sha??proof.mainSha,reservation_sha:proof.reservationSha,original_body_sha256:sha256(before),adopted_body_sha256:sha256(after),original_body:before,adopted_body:after,created_at:createdAt}
    if(prior&&!isDeepStrictEqual(record,prior.record))refuse('immutable receipt differs from current proof')
    receiptSha=prior?.sha
    if(!receiptSha){receiptSha=io.makeOwnerCommit(RECEIPT_PREFIX+JSON.stringify(record));if(!io.createRef(ref,receiptSha))refuse('immutable receipt creation failed');if(readRefAfterWrite(ref,receiptSha,io)!==receiptSha)refuse('immutable receipt readback failed')}
    const readBack=readReceipt(ref,request,io)
    if(!readBack||readBack.sha!==receiptSha||!isDeepStrictEqual(readBack.record,record))refuse('immutable receipt content readback differs')
    const attempt=recordAttempt(request,observation,context,record,ref,receiptSha,proof.mainSha,mutex,io)
    const fresh=proveStoppedMergedAdoption(request,capabilityProof(),io,manifest,observation,{sha:receiptSha,record},context)
    if(fresh.adopted!==proof.adopted||fresh.claim.body!==proof.claim.body||fresh.mainSha!==proof.mainSha)refuse('claim or main moved before mutation')
    if(Date.parse(createdAt)+request.leaseHours*3600000<=clock().valueOf())refuse('receipt grant expired before mutation')
    validateObservation(observation,clock(),manifest);requireOwnedRef(MUTEX_REF,mutex,io)
    if(proof.adopted){result={claim:request.claim,version:REGISTERED.version,owner:request.newOwner,worktree:request.targetWorktree,ref,sha:receiptSha,...attempt,idempotent:true};return result}
    changed=true;io.updateIssue(request.claim,{body:after})
    if(io.getIssue(request.claim)?.body!==after)refuse('claim readback failed')
    if(io.readRef(`refs/db-claims/${REGISTERED.version}`)!==proof.reservationSha||!io.getCommit(proof.reservationSha))refuse('permanent reservation changed after adoption')
    requireOwnedRef(MUTEX_REF,mutex,io)
    const finalProof=proveStoppedMergedAdoption(request,capabilityProof(),io,manifest,observation,{sha:receiptSha,record},context)
    if(!finalProof.adopted||finalProof.claim.body!==after||finalProof.mainSha!==proof.mainSha)refuse('final adopted custody or main differs')
    requireOwnedRef(MUTEX_REF,mutex,io)
    result={claim:request.claim,version:REGISTERED.version,owner:request.newOwner,worktree:request.targetWorktree,ref,sha:receiptSha,...attempt,idempotent:false};return result
  } catch (error) {
    let owned = false, observed = 'unreadable'
    try { observed = sha256(io.getIssue(request.claim)?.body ?? '') } catch {}
    try { owned = io.readRef(MUTEX_REF) === mutex } catch {}
    const evidence = `mutation_attempted=${changed}; receipt_ref=${ref}; receipt_sha=${receiptSha ?? 'none'}; before_sha256=${before === null ? 'none' : sha256(before)}; after_sha256=${after === null ? 'none' : sha256(after)}; observed_sha256=${observed}`
    const errors = []
    if (changed && owned) {
      try {
        // A late foreign edit is not ours to erase even while we hold the mutex.
        const current = io.getIssue(request.claim)?.body
        if (current !== before && current !== after) throw Error('foreign claim body; rollback refused')
        requireOwnedRef(MUTEX_REF,mutex,io)
        if (current !== before) io.updateIssue(request.claim,{body:before})
        if (io.getIssue(request.claim)?.body !== before) throw Error('rollback readback differs')
      } catch (rollback) { errors.push(rollback.message) }
    }
    failure = new LaneError(`${error.message}; ${!owned ? 'ROLLBACK NOT ATTEMPTED: mutex ownership lost or unreadable; ' : ''}${errors.length ? 'ROLLBACK INCOMPLETE: '+errors.join('; ')+'; ' : ''}${evidence}`)
    throw failure
  } finally {
    try { releaseMutexOnExit(mutex,io,{strict:true}) }
    catch (cleanup) {
      const error = new LaneError(`${failure ? failure.message+'; ' : ''}${cleanup.message}${result ? '; OPERATION_COMPLETED '+JSON.stringify(result) : '; outcome incomplete'}`)
      if (result) error.completedResult = result
      throw error
    }
  }
}
