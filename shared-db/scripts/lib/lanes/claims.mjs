// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { normalizeObject, parseClaimBlock } from '../../check-dispatch-collision.mjs'
import { createTreeReader } from '../../lib/github-tree.mjs'
import { AUTHORABLE_CAPACITY_STATES, AUTHOR_CAPACITY_STATES, WORKTREE_STATES } from './constants.mjs'
import { validateImmutableArtifactReference } from './claim-maintenance.mjs'

export class LaneError extends Error {}

export const CLAIM_KINDS = new Set(['schema','table','column','view','materialized view','function','procedure','trigger','policy','type','domain','sequence','index','publication','storage bucket','role'])
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
    if (kind === 'schema' || kind === 'publication' || kind === 'storage bucket' || kind === 'role') {
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
  const allowedFields = new Set(['owner', 'branch', 'worktree', 'expires_at', 'capacity_state', 'blocked_on', 'worktree_state', 'recovery'])
  for (const key of fields.keys()) if (!allowedFields.has(key)) throw new LaneError(`db-author-lease contains unknown field ${key}`)
  for (const required of ['owner', 'branch', 'worktree', 'expires_at']) {
    if (!fields.get(required)) throw new LaneError(`db-author-lease is missing ${required}`)
  }
  const expiresAt = new Date(fields.get('expires_at'))
  if (Number.isNaN(expiresAt.valueOf())) throw new LaneError('db-author-lease expires_at is not a valid ISO timestamp')
  const declaredCapacityState = fields.get('capacity_state') ?? 'active'
  if (!AUTHOR_CAPACITY_STATES.includes(declaredCapacityState)) throw new LaneError(`db-author-lease capacity_state must be one of ${AUTHOR_CAPACITY_STATES.join(', ')}`)
  const blockedOn = fields.get('blocked_on') ?? null
  const declaredWorktreeState = fields.get('worktree_state') ?? null
  const recoveryArtifact = fields.get('recovery') ?? null
  if (declaredCapacityState === 'relinquished' && !blockedOn) throw new LaneError('relinquished author capacity must name blocked_on')
  if (declaredCapacityState !== 'relinquished' && blockedOn) throw new LaneError('blocked_on is allowed only for relinquished author capacity')
  if (declaredWorktreeState && !WORKTREE_STATES.includes(declaredWorktreeState)) throw new LaneError(`db-author-lease worktree_state must be one of ${WORKTREE_STATES.join(', ')}`)
  if (declaredCapacityState !== 'relinquished' && declaredWorktreeState) throw new LaneError('worktree_state is allowed only for relinquished author capacity')
  if (declaredCapacityState !== 'relinquished' && recoveryArtifact) throw new LaneError('recovery is allowed only for relinquished author capacity')
  if (recoveryArtifact) validateImmutableArtifactReference(recoveryArtifact, 'db-author-lease recovery')
  // Claims written before Phase A did not carry worktree_state. Keep them
  // readable so locks/version reservations remain protected, but make their
  // unknown evidence explicit and refuse mutation until reconciled.
  const relinquishmentMetadataLegacy = declaredCapacityState === 'relinquished' && !declaredWorktreeState
  const worktreeState = relinquishmentMetadataLegacy ? 'unknown-legacy' : declaredWorktreeState
  const active = expiresAt > now
  const capacityState = !active && declaredCapacityState === 'active' ? 'expired-unconfirmed' : declaredCapacityState
  // Clock expiry never frees capacity. Only an explicit relinquished fence does.
  const capacityActive = declaredCapacityState !== 'relinquished'
  return { ...claim, legacy: false, owner: fields.get('owner'), branch: fields.get('branch'), worktree: fields.get('worktree'), expiresAt, active, capacityState, declaredCapacityState, capacityActive, blockedOn, worktreeState, recoveryArtifact, relinquishmentMetadataLegacy }
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

export function claimBody({ version, objects, writes, reads = [], owner, branch, worktree, expiresAt, capacityState = 'active', blockedOn = null, worktreeState = null, recoveryArtifact = null }) {
  // `objects` is the deprecated parameter name for `writes`. Accepting both keeps
  // every existing caller working through the compatibility window; Step 8A drops
  // the alias once no open claim uses it.
  const written = (writes ?? objects ?? []).map((o) => normalizeObject(o))
  const read = (reads ?? []).map((o) => normalizeObject(o)).filter((o) => !written.includes(o))
  const lines = ['```db-claim', `version: ${version}`, 'writes:', ...written.map((o) => `  - ${o}`)]
  // Emit `reads:` only when there is one. An always-present empty header would
  // make every legacy claim look edited in a diff.
  if (read.length) lines.push('reads:', ...read.map((o) => `  - ${o}`))
  // AUTHORABLE vs PARSEABLE (#2775 + Phase A). `expired-unconfirmed` is DERIVED by
  // parseAuthorLease when an 'active' lease outlives its expiry, so it must stay in
  // AUTHOR_CAPACITY_STATES for parsing round-trips. It must never be AUTHORED: a
  // claim that declares itself expired would be durable claim authority for a state
  // no writer is entitled to assert. The write path therefore validates the narrower
  // authorable set.
  if (!AUTHORABLE_CAPACITY_STATES.includes(capacityState)) throw new LaneError(`capacityState must be one of ${AUTHORABLE_CAPACITY_STATES.join(', ')}`)
  if (capacityState === 'relinquished' && !blockedOn) throw new LaneError('relinquished capacity requires blockedOn')
  if (capacityState !== 'relinquished' && blockedOn) throw new LaneError('blockedOn is allowed only for relinquished capacity')
  if (capacityState === 'relinquished' && !WORKTREE_STATES.includes(worktreeState)) throw new LaneError(`relinquished capacity requires worktreeState to be one of ${WORKTREE_STATES.join(', ')}`)
  if (capacityState !== 'relinquished' && worktreeState) throw new LaneError('worktreeState is allowed only for relinquished capacity')
  if (capacityState !== 'relinquished' && recoveryArtifact) throw new LaneError('recoveryArtifact is allowed only for relinquished capacity')
  if (recoveryArtifact) validateImmutableArtifactReference(recoveryArtifact, 'recoveryArtifact')
  lines.push('```', '', '```db-author-lease', `owner: ${owner}`, `branch: ${branch}`, `worktree: ${worktree}`, `expires_at: ${expiresAt.toISOString()}`, `capacity_state: ${capacityState}`)
  if (blockedOn) lines.push(`blocked_on: ${blockedOn}`)
  if (worktreeState) lines.push(`worktree_state: ${worktreeState}`)
  if (recoveryArtifact) lines.push(`recovery: ${recoveryArtifact}`)
  lines.push('```', '',
    'This claim remains authoritative until explicitly released. Only an active author-capacity lease occupies an author slot.',
    'Expiry is an audit warning, not an automatic release. The migration version is permanent and is never reused.',
    'WRITES are exclusive. READS may run in parallel with other reads, and block only against a writer.')
  return lines.join('\n')
}

// Re-exported from the one shared transport (issue #2342) so this repository has
// exactly ONE definition of "transient". Widening it -- notably to 404, which the
// observed production failures were -- is a governed decision documented there.
export const laneTreeReader=createTreeReader({wrapError:(detail)=>new LaneError(detail)})
