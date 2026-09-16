// Named holds (programme popcre/ai-devops#401 Step 2, locked decision 15; issue #3027).
//
// WHY
// ---
// On 2026-09-15 green, approved PRs (#2955, #2948) were told to wait "until #2860's
// production run finishes" although they shared no database object with #2860.
// Each hold cost 30-60 minutes. The stage leases already serialize writers, so a
// hold is legitimate only when it names:
//
//   lease:<preview|merge|production>   a stage lease that is HELD RIGHT NOW
//   claim:#N                           an open author claim sharing an object with the held work
//   object:#N:<object>[,<object>...]   exact objects the held work AND claim #N both touch
//   dependency:#N                      an open issue the held work declares in depends_on
//
// Anything else -- free text, another item's pipeline stage, a lease nobody holds,
// a claim with no shared object, an undeclared dependency -- is refused, so
// "wait until X's production finishes" is not expressible as a recorded hold.
//
// This module is pure. Every live fact comes through the injected `facts` reader.

export class HoldReasonError extends Error {}

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

export const HOLD_KINDS = Object.freeze(['lease', 'claim', 'object', 'dependency'])
export const HOLD_STAGES = Object.freeze(['preview', 'merge', 'production'])

const GRAMMAR = 'hold_reason must be lease:<preview|merge|production>, claim:#<n>, object:#<claim>:<object>[,<object>], or dependency:#<issue>'
export const UNRELATED_HOLD = "a hold whose reason is another item's unrelated pipeline stage is refused (locked decision 15)"

/** Parse the CLI spelling. Refuses anything that is not one exact lease or conflict. */
export function parseHoldReason(text) {
  const value = String(text ?? '').trim()
  let match
  if ((match = /^lease:(preview|merge|production)$/.exec(value))) return { kind: 'lease', stage: match[1] }
  if ((match = /^claim:#?(\d+)$/.exec(value))) return { kind: 'claim', claim: Number(match[1]) }
  if ((match = /^dependency:#?(\d+)$/.exec(value))) return { kind: 'dependency', issue: Number(match[1]) }
  if ((match = /^object:#?(\d+):(.+)$/.exec(value))) {
    const objects = [...new Set(match[2].split(',').map((object) => object.trim().toLowerCase()).filter(Boolean))].sort()
    if (objects.length) return { kind: 'object', claim: Number(match[1]), objects }
  }
  throw new HoldReasonError(`${GRAMMAR}; got ${JSON.stringify(value)}; ${UNRELATED_HOLD}`)
}

/** Shape check for a recorded hold_reason event field. */
export function validateHoldReasonRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new HoldReasonError('hold_reason must be an object')
  if (!HOLD_KINDS.includes(record.kind)) throw new HoldReasonError(`hold_reason.kind must be one of ${HOLD_KINDS.join(', ')}`)
  if (typeof record.holder !== 'string' || !record.holder.trim()) throw new HoldReasonError('hold_reason must name its holder')
  if (record.kind === 'lease' && !HOLD_STAGES.includes(record.stage)) throw new HoldReasonError('a lease hold_reason must name its stage')
  if (['claim', 'object'].includes(record.kind) && (!Array.isArray(record.objects) || !record.objects.length)) throw new HoldReasonError(`a ${record.kind} hold_reason must name the shared objects`)
  return record
}

/** One line naming who holds a stage lease, read from its structured lease commit message. */
export function describeLeaseHolder(stage, ownerSha, message) {
  const text = String(message ?? '')
  const fields = new Map()
  for (const line of text.split('\n').slice(1)) {
    const at = line.indexOf(':')
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  const first = text.split('\n')[0]
  const pick = (name, inline = name) => {
    const value = fields.get(name) ?? new RegExp(`(?:^| )${inline}=(\\S+)`).exec(first)?.[1]
    return value && !['none', 'null', 'undefined'].includes(value) ? value : null
  }
  const parts = [`${stage} lease ${String(ownerSha ?? '').slice(0, 12) || 'unknown'}`]
  const holder = pick('holder_id') ?? pick('owner')
  if (holder) parts.push(`holder ${holder}`)
  const pr = pick('pr')
  if (pr) parts.push(`PR #${String(pr).replace(/^#/, '')}`)
  const run = pick('github_run_id')
  if (run) parts.push(`run ${run}`)
  const acquired = pick('acquired_at')
  if (acquired) parts.push(`acquired ${acquired}`)
  return parts.join(', ')
}

/**
 * Prove a hold against live facts and return the record to store as hold_reason.
 *
 * facts.leaseHolder(stage) -> null | { ownerSha, message }
 * facts.claim(n)           -> null | { open, objects: [], reads: [] }
 * facts.issue(n)           -> null | { state, dependencies: [], objects: [], reads: [] }
 */
export function assertNamedHold({ heldIssue, reason }, facts) {
  const parsed = typeof reason === 'string' ? parseHoldReason(reason) : reason
  const held = Number(heldIssue)
  if (!Number.isInteger(held) || held <= 0) throw new HoldReasonError('a hold must name the held work issue')
  if (parsed.kind === 'lease') {
    const lease = facts.leaseHolder(parsed.stage)
    if (!lease?.ownerSha) throw new HoldReasonError(`hold_reason lease:${parsed.stage} names a lease nobody holds; ${UNRELATED_HOLD}`)
    return { kind: 'lease', stage: parsed.stage, holder: describeLeaseHolder(parsed.stage, lease.ownerSha, lease.message), owner_sha: lease.ownerSha }
  }
  const work = facts.issue(held)
  if (!work) throw new HoldReasonError(`held work issue #${held} is unreadable`)
  const lower = (list) => (list ?? []).map((object) => String(object).toLowerCase())
  if (parsed.kind === 'dependency') {
    if (parsed.issue === held) throw new HoldReasonError('a work issue cannot hold on itself')
    if (!(work.dependencies ?? []).map(Number).includes(parsed.issue)) throw new HoldReasonError(`hold_reason dependency:#${parsed.issue} is not declared in #${held} depends_on; ${UNRELATED_HOLD}`)
    const blocker = facts.issue(parsed.issue)
    if (!blocker || String(blocker.state).toLowerCase() !== 'open') throw new HoldReasonError(`hold_reason dependency:#${parsed.issue} is not an open issue`)
    return { kind: 'dependency', holder: `issue #${parsed.issue}` }
  }
  const claim = facts.claim(parsed.claim)
  if (!claim?.open) throw new HoldReasonError(`hold_reason names claim #${parsed.claim}, which is not an open author claim`)
  // A conflict is the lane conflict matrix applied to one shared object.
  const only = (list, object) => lower(list).filter((item) => item === object)
  const conflicting = (object) => conflicts({ writes: only(work.objects, object), reads: only(work.reads, object) }, { writes: only(claim.objects, object), reads: only(claim.reads, object) })
  const shared = [...new Set([...lower(work.objects), ...lower(work.reads)])].filter(conflicting).sort()
  if (parsed.kind === 'claim') {
    if (!shared.length) throw new HoldReasonError(`hold_reason claim:#${parsed.claim} shares no conflicting object with #${held}; ${UNRELATED_HOLD}`)
    return { kind: 'claim', holder: `claim #${parsed.claim}`, objects: shared }
  }
  const unshared = parsed.objects.filter((object) => !conflicting(object))
  if (unshared.length) throw new HoldReasonError(`hold_reason object:#${parsed.claim} names ${unshared.join(', ')}, which #${held} and claim #${parsed.claim} do not conflict on; ${UNRELATED_HOLD}`)
  return { kind: 'object', holder: `claim #${parsed.claim}`, objects: parsed.objects }
}

/** Human line for owner reports and the no-progress alarm. */
export function formatHoldReason(record) {
  if (!record) return null
  if (record.kind === 'lease') return `waiting for ${record.holder}`
  if (record.kind === 'dependency') return `waiting for dependency ${record.holder}`
  return `waiting for ${record.holder} on ${(record.objects ?? []).join(', ')}`
}
