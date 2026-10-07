// Step 10 (#3781) — target-qualified preview/production queues with intact interlocks.
//
// This module is intentionally pure: no GitHub I/O, no workflow YAML, no lock
// mutation. It owns the decisions the later workflow/lock split must call so
// those decisions can be proven here without taking shared workflow files
// (PR #3736 owns shared-supabase-migrations.yml; Step 8/9 own the merge/lock
// surfaces). Wiring is a later change on accepted current main.
//
// Fail-closed is the whole point. Unknown target identity, free-form workflow
// input that could rename a database, same-target concurrent mutation, and
// promotion-manifest drift all refuse.

import { isDocumentationPath, isProductionInertPath } from './check-main-tip-freshness.mjs'

export class TargetQueueError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TargetQueueError'
  }
}

const refuse = (message) => {
  throw new TargetQueueError(message)
}

// ---------------------------------------------------------------------------
// Target identity
// ---------------------------------------------------------------------------
//
// TRUSTED CATALOG is the only source of database identity. A workflow_dispatch
// input, PR title, or free-form string must never manufacture a name for the
// same database: two inputs that resolve to the same project ref must collide
// into one queue, and an input that invents a new name must refuse.

export const TARGET_ROLES = Object.freeze(['preview', 'production'])

/**
 * Build a trusted target catalog from closed, reviewed entries only.
 * Each entry: { role: 'preview'|'production', targetId, projectRef, aliases? }
 */
export function buildTargetCatalog(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    refuse('target catalog must be a non-empty array of reviewed entries')
  }
  const byTargetId = new Map()
  const byProjectRef = new Map()
  const byAlias = new Map()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') refuse('each catalog entry must be an object')
    const { role, targetId, projectRef, aliases } = entry
    if (!TARGET_ROLES.includes(role)) refuse(`unknown target role: ${role}`)
    if (typeof targetId !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(targetId)) {
      refuse(`targetId must be a stable lowercase slug: ${JSON.stringify(targetId)}`)
    }
    if (typeof projectRef !== 'string' || projectRef.length < 8) {
      refuse(`projectRef must be a real Supabase project ref for ${targetId}`)
    }
    if (byTargetId.has(targetId)) refuse(`duplicate targetId in catalog: ${targetId}`)
    if (byProjectRef.has(projectRef)) {
      refuse(`duplicate projectRef in catalog: ${projectRef} maps to both ${byProjectRef.get(projectRef)} and ${targetId}`)
    }
    byTargetId.set(targetId, { role, targetId, projectRef })
    byProjectRef.set(projectRef, targetId)
    for (const alias of aliases ?? []) {
      if (typeof alias !== 'string' || alias.length === 0) refuse(`invalid alias for ${targetId}`)
      if (byAlias.has(alias)) refuse(`duplicate alias in catalog: ${alias}`)
      byAlias.set(alias, targetId)
    }
  }
  return { byTargetId, byProjectRef, byAlias }
}

/**
 * Resolve untrusted input to a catalog target. Never invents identity.
 * `input` may be a targetId, a projectRef, or a catalog alias — all other
 * spellings refuse rather than guess.
 */
export function resolveTargetIdentity(catalog, input, role) {
  if (!catalog?.byTargetId) refuse('a trusted target catalog is required')
  if (!TARGET_ROLES.includes(role)) refuse(`unknown target role: ${role}`)
  if (typeof input !== 'string' || input.trim().length === 0) {
    refuse('target identity input is empty')
  }
  const raw = input.trim()
  const targetId = catalog.byTargetId.has(raw)
    ? raw
    : catalog.byAlias.has(raw)
      ? catalog.byAlias.get(raw)
      : catalog.byProjectRef.has(raw)
        ? catalog.byProjectRef.get(raw)
        : null
  if (!targetId) {
    refuse(`target identity is not in the trusted catalog: ${raw}`)
  }
  const entry = catalog.byTargetId.get(targetId)
  if (entry.role !== role) {
    refuse(`target ${targetId} is a ${entry.role} resource; refusing ${role} mutation against it`)
  }
  return entry
}

// ---------------------------------------------------------------------------
// Concurrency / mutation groups
// ---------------------------------------------------------------------------
//
// Distinct preview and production resources get distinct groups. PR validations
// stay per-ref and never share a mutation group. Untrusted input cannot choose
// the group: the group is derived only from role + trusted catalog targetId.

export function mutationConcurrencyGroup(role, target) {
  if (!TARGET_ROLES.includes(role)) refuse(`unknown target role: ${role}`)
  if (!target?.targetId) refuse('mutation concurrency group requires a trusted catalog target')
  if (target.role !== role) refuse(`target role mismatch: ${target.role} vs requested ${role}`)
  return `shared-supabase-migrations-${role}-${target.targetId}`
}

export function pullRequestValidationConcurrencyGroup(ref) {
  if (typeof ref !== 'string' || ref.length === 0) refuse('PR validation group requires a ref')
  if (ref.includes('\n') || ref.includes(' ')) refuse('PR validation ref must be a single token')
  return `shared-supabase-migrations-pr-${ref}`
}

/**
 * workflow_dispatch concurrency group for shared-supabase-migrations.yml.
 * Derived only from the closed target enum (preview|production) — the same
 * closed set the workflow `options:` already enforce — never from free-form
 * input. Preview and production therefore occupy distinct queues while
 * same-target dispatches still serialize.
 */
export function dispatchConcurrencyGroup(target) {
  if (target !== 'preview' && target !== 'production') {
    refuse(`dispatch target must be the closed enum preview|production, not ${JSON.stringify(target)}`)
  }
  return `shared-supabase-migrations-${target}`
}

// ---------------------------------------------------------------------------
// Compatibility matrix
// ---------------------------------------------------------------------------
//
// preview/preview same target forbidden
// production/production forbidden
// merge/production forbidden during protected freeze
// preview/production distinct targets allowed only when lock ordering and
// shared evidence/ref mutations are disjoint (proven by the caller's plan)

export const PAIR_DECISIONS = Object.freeze({
  ALLOW: 'ALLOW',
  FORBID_SAME_TARGET: 'FORBID_SAME_TARGET',
  FORBID_SAME_ROLE: 'FORBID_SAME_ROLE',
  FORBID_FREEZE: 'FORBID_FREEZE',
  FORBID_LOCK_ORDER: 'FORBID_LOCK_ORDER',
  FORBID_SHARED_EVIDENCE: 'FORBID_SHARED_EVIDENCE',
})

/**
 * @param {object} left  { kind: 'preview'|'production'|'merge', target?, freeze? }
 * @param {object} right { kind: 'preview'|'production'|'merge', target?, freeze? }
 * @param {object} plan  { sharedEvidenceRefs: string[], lockOrder: string[] }
 *   lockOrder is the global lock acquisition order (e.g. ['merge','production']).
 *   Two mutations may overlap only if every lock they take appears in one total
 *   order and they do not both take the same exclusive lock kind.
 */
export function evaluatePairCompatibility(left, right, plan) {
  const kinds = [left?.kind, right?.kind]
  for (const kind of kinds) {
    if (!['preview', 'production', 'merge'].includes(kind)) {
      refuse(`unknown mutation kind: ${kind}`)
    }
  }
  const leftRole = left.kind === 'merge' ? 'merge' : left.kind
  const rightRole = right.kind === 'merge' ? 'merge' : right.kind

  if (leftRole === rightRole) {
    // Same exclusive lane: always forbidden (same role serialises).
    return { decision: PAIR_DECISIONS.FORBID_SAME_ROLE, reason: `two ${leftRole} mutations cannot run together` }
  }

  // merge/production freeze interlock (retained from acquireExclusive).
  const freezeSide = left.freeze ?? right.freeze ?? false
  const mergeProduction = [leftRole, rightRole].includes('merge') && [leftRole, rightRole].includes('production')
  if (mergeProduction && freezeSide) {
    return {
      decision: PAIR_DECISIONS.FORBID_FREEZE,
      reason: 'protected freeze forbids merge/production overlap; production promotion must wait for the guarded merge',
    }
  }

  // Same physical database under different roles is still one target.
  const leftTarget = left.target?.projectRef ?? left.target?.targetId ?? null
  const rightTarget = right.target?.projectRef ?? right.target?.targetId ?? null
  if (leftTarget && rightTarget && leftTarget === rightTarget && leftRole !== rightRole) {
    return {
      decision: PAIR_DECISIONS.FORBID_SAME_TARGET,
      reason: `same database ${leftTarget} cannot take both ${leftRole} and ${rightRole} concurrently`,
    }
  }

  // Shared evidence/ref mutations require disjoint writers.
  const shared = Array.isArray(plan?.sharedEvidenceRefs) ? plan.sharedEvidenceRefs : null
  if (!shared) refuse('compatibility plan must list sharedEvidenceRefs (possibly empty)')
  const leftRefs = new Set(left.evidenceRefs ?? [])
  const rightRefs = new Set(right.evidenceRefs ?? [])
  for (const ref of shared) {
    if (leftRefs.has(ref) && rightRefs.has(ref)) {
      return {
        decision: PAIR_DECISIONS.FORBID_SHARED_EVIDENCE,
        reason: `both sides write shared evidence ref ${ref}`,
      }
    }
  }

  // Lock ordering: both sides must draw locks in the same global order.
  const order = Array.isArray(plan?.lockOrder) ? plan.lockOrder : null
  if (!order || order.length === 0) refuse('compatibility plan must list a non-empty lockOrder')
  const leftLocks = left.locks ?? []
  const rightLocks = right.locks ?? []
  const rank = (lock) => {
    const i = order.indexOf(lock)
    if (i < 0) refuse(`lock ${lock} is not in the declared order`)
    return i
  }
  const leftSeq = leftLocks.map(rank)
  const rightSeq = rightLocks.map(rank)
  const sorted = (seq) => seq.every((v, i) => i === 0 || seq[i - 1] <= v)
  if (!sorted(leftSeq) || !sorted(rightSeq)) {
    return {
      decision: PAIR_DECISIONS.FORBID_LOCK_ORDER,
      reason: 'lock acquisition is not in the declared global order',
    }
  }
  // Overlapping exclusive lock kinds still serialise even with good order.
  const leftSet = new Set(leftLocks)
  const rightSet = new Set(rightLocks)
  for (const lock of leftSet) {
    if (rightSet.has(lock)) {
      return {
        decision: PAIR_DECISIONS.FORBID_LOCK_ORDER,
        reason: `both sides take exclusive lock ${lock}`,
      }
    }
  }

  return { decision: PAIR_DECISIONS.ALLOW, reason: 'distinct targets, disjoint shared evidence, compatible lock order' }
}

// ---------------------------------------------------------------------------
// Production freshness (unified policy)
// ---------------------------------------------------------------------------
//
// Workflow tip checks and acquireExclusive('production') must call one policy.
// The path classifier is the carefully reviewed production-inert rule that
// `check-main-tip-freshness.mjs` owns (`isProductionInertPath`): documentation
// by extension, plus `.agent/` evidence pairs and test-only scripts that no
// production step executes. Production-inert drift may reuse a promotion;
// substantive/unknown drift never reuses a promotion manifest. Importing the
// classifier from there keeps one source of truth for both gates.

/** Thin wrapper kept for callers that ask the documentation-only question. */
export function isDocumentationOnlyPath(path) {
  return isDocumentationPath(path)
}

/**
 * @param {object} state
 *   dispatchMainSha — SHA the promotion was authorized against
 *   currentMainSha  — SHA on main now
 *   changedPaths    — every path touched between dispatchMainSha and currentMainSha
 *   exactMatch      — true when the tips are equal
 */
export function evaluateProductionFreshness(state) {
  const { dispatchMainSha, currentMainSha, changedPaths, exactMatch } = state ?? {}
  if (typeof dispatchMainSha !== 'string' || typeof currentMainSha !== 'string') {
    refuse('production freshness requires dispatch and current main SHAs')
  }
  if (!Array.isArray(changedPaths)) refuse('production freshness requires the changed path list')
  if (exactMatch === true) {
    return { fresh: true, reuseManifest: true, reason: 'exact current main tip' }
  }
  if (dispatchMainSha === currentMainSha) {
    return { fresh: true, reuseManifest: true, reason: 'exact current main tip' }
  }
  if (changedPaths.length === 0) {
    refuse('main moved with an empty changed-path list; refusing rather than guessing')
  }
  const substantive = changedPaths.filter((p) => !isProductionInertPath(p))
  if (substantive.length > 0) {
    return {
      fresh: false,
      reuseManifest: false,
      reason: `main moved with substantive paths: ${substantive.slice(0, 5).join(', ')}`,
      substantive,
    }
  }
  return {
    fresh: true,
    reuseManifest: true,
    reason: 'main moved only with production-inert paths (documentation, .agent evidence or test files)',
  }
}

// ---------------------------------------------------------------------------
// Promotion manifest binding
// ---------------------------------------------------------------------------
//
// Bind to exact selected migration bytes, producer/policy inputs and effective
// dependencies. "Same migration filenames" is never enough. Only explicitly
// proven inert main changes may reuse a manifest.

export function digestManifestInputs({ migrations, producer, policy, dependencies }) {
  if (!Array.isArray(migrations) || migrations.length === 0) {
    refuse('promotion manifest requires the exact selected migration list')
  }
  const parts = []
  for (const m of migrations) {
    if (!m?.version || !m?.bytesSha256) {
      refuse('each selected migration needs version and bytesSha256')
    }
    parts.push(`m:${m.version}:${m.bytesSha256}`)
  }
  if (!producer?.id || !producer?.sha256) refuse('promotion manifest requires producer id and sha256')
  parts.push(`producer:${producer.id}:${producer.sha256}`)
  if (!policy?.id || !policy?.sha256) refuse('promotion manifest requires policy id and sha256')
  parts.push(`policy:${policy.id}:${policy.sha256}`)
  const deps = Array.isArray(dependencies) ? [...dependencies].map(String).sort() : []
  parts.push(`deps:${deps.join(',')}`)
  return parts.join('\n')
}

export function promotionManifestBinding(inputs) {
  const binding = digestManifestInputs(inputs)
  return {
    binding,
    migrationVersions: inputs.migrations.map((m) => m.version),
    reusableOnlyIfInert: true,
  }
}

export function canReusePromotionManifest(manifest, state) {
  if (!manifest?.binding) refuse('a prior promotion manifest binding is required')
  const freshness = evaluateProductionFreshness(state)
  if (!freshness.reuseManifest) {
    return { reusable: false, reason: freshness.reason }
  }
  let rebinding
  try {
    rebinding = digestManifestInputs(manifest.inputs)
  } catch (error) {
    return { reusable: false, reason: `manifest inputs no longer digestible: ${error.message}` }
  }
  if (rebinding !== manifest.binding) {
    return {
      reusable: false,
      reason: 'substantive/unknown drift requalifies the promotion manifest (not "same migration filenames")',
    }
  }
  return { reusable: true, reason: freshness.reason }
}
