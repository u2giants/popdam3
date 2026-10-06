// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { sha256, canonicalJson } from '../../orchestrator-flow/evidence-bundle.mjs'
import { LaneError } from './claims.mjs'

export function parseSilenceRelease(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination reviewer-silence-release reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{40}) sequence=(\d+) code=silent_worker_observed probe=([0-9a-f]{7,40}) observed-at=([^ ]+) confirmed-at=([^ ]+) verdict=none artifact=none replacement=none$/i.exec(message)
  if(!match)throw new LaneError('reviewer silence release evidence is unreadable')
  return {reviewer:match[1],issue:Number(match[2]),pr:Number(match[3]),headSha:match[4],sequence:Number(match[5]),probeSha:match[6],observedAt:match[7],confirmedAt:match[8]}
}

export function replaceClaimVersion(body,oldVersion,newVersion){
  const fence=/```db-claim\s*\n([\s\S]*?)```/.exec(String(body??''))
  if(!fence||!new RegExp(`^version: ${oldVersion}$`,'m').test(fence[1])||(fence[1].match(/^version:/gm)??[]).length!==1)throw new LaneError('claim fenced version is missing or ambiguous')
  return body.slice(0,fence.index)+fence[0].replace(`version: ${oldVersion}`,`version: ${newVersion}`)+body.slice(fence.index+fence[0].length)
}

export function parseVersionSupersession(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination claim-version-superseded issue=(\d+) claim=(\d+) pr=(\d+) old=(\d{14}) new=(\d{14}) old-ref=([0-9a-f]{7,40}) head=([0-9a-f]{40})$/i.exec(message)
  if(!match)throw new LaneError('version supersession ref is unreadable')
  return {issue:Number(match[1]),claim:Number(match[2]),pr:Number(match[3]),oldVersion:match[4],newVersion:match[5],oldReservation:match[6],newHead:match[7]}
}

// Issue #3182. A live claim is bound to the worktree it was authored in. When that
// path is later reused by another session, every worktree-bound operation (version
// supersession, reviewer preflight) refuses forever and there was no way to move
// the claim. This moves ONLY the lease `worktree:` line to a fresh clean worktree
// that is on the claim branch at the exact open PR head, after owner proof, under
// the coordination mutex, with an exact readback and create-only evidence. The
// recorded old worktree is never inspected or touched: it may hold another
// session's uncommitted work.
export const CLAIM_WORKTREE_REBIND_REF_PREFIX='refs/db-claim-worktree-rebinds/'
export function normalizeWorktreePath(value){return String(value??'').trim().replaceAll('\\','/').replace(/\/+$/,'').toLowerCase()}
export function claimWorktreeRebindRef(claim,version,targetWorktree){return `${CLAIM_WORKTREE_REBIND_REF_PREFIX}${Number(claim)}-${version}-${sha256(normalizeWorktreePath(targetWorktree)).slice(0,16)}`}
export function parseClaimWorktreeRebind(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination claim-worktree-rebound issue=(\d+) claim=(\d+) pr=(\d+) version=(\d{14}) head=([0-9a-f]{40}) from-sha256=([0-9a-f]{64}) to-sha256=([0-9a-f]{64})$/i.exec(message.split('\n')[0])
  if(!match)throw new LaneError('claim worktree rebind evidence is unreadable')
  return {issue:Number(match[1]),claim:Number(match[2]),pr:Number(match[3]),version:match[4],headSha:match[5],fromDigest:match[6],toDigest:match[7]}
}
export function leaseWithoutWorktree(lease){const {worktree,...rest}=lease;return canonicalJson({...rest,expiresAt:rest.expiresAt?.toISOString?.()??null})}

export function parseMergedClaimReissue(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination merged-claim-reissued issue=(\d+) claim=(\d+) source-pr=(\d+) old=(\d{14}) new=(\d{14}) old-ref=([0-9a-f]{7,40}) new-ref=([0-9a-f]{7,40}) merge=([0-9a-f]{40})$/i.exec(message)
  if(!match)throw new LaneError('merged claim reissue ref is unreadable')
  return {issue:Number(match[1]),claim:Number(match[2]),sourcePr:Number(match[3]),oldVersion:match[4],newVersion:match[5],oldReservation:match[6],newReservation:match[7],mergeSha:match[8]}
}
