// Append-only versioned evidence generations with explicit predecessor binding
// (issue #3380, workflow-refactor Step 1).
//
// WHY THIS EXISTS. Evidence pairs are keyed by work issue and generation
// (`scripts/lib/agent-evidence-paths.mjs`). That stopped cross-PR path collisions,
// but nothing yet refused rewriting a committed generation, nothing bound a
// successor to its predecessor, and a refresh could silently replace a recorded
// pair in place. A reader that picked "the highest filename" would also accept a
// forged generation number as current truth.
//
// WHAT THIS LAYER GUARANTEES.
//   * A committed generation is immutable. Mutation of a recorded pair is refused.
//   * A successor generation names its predecessor explicitly (`evidence_parent`).
//   * The current pair is resolved from contract identity and the changed-file
//     set, never from filename ordering. The pair↔generation binding is
//     enforced: a schema_version 2 contract must use its keyed pair, and the
//     legacy paths are only the schema_version 1 generation-1 root pair.
//   * v1 pairs (no `evidence_parent`, schema_version 1) remain readable as
//     historical records. They do not claim a verified predecessor binding.
//   * Unused reserved generations are skipped, never reused.
//   * Arbitrary metadata under `.agent/` is not inert and is not a generation.
//
// WHAT THIS LAYER DOES NOT DO. It does not prove who published a ref (see
// `scripts/agent-work-contract.mjs`). It does not invent a global mutable index.
// It does not replace the validity rules in
// `scripts/agent-work-contract-git-evidence.mjs`.

import { contractHash } from '../agent-work-contract.mjs'
import { evidencePaths, isEvidencePath, resolveEvidencePair } from './agent-evidence-paths.mjs'

export class EvidenceLineageError extends Error {}

export const LINEAGE_SCHEMA_VERSION = 2
export const EVIDENCE_PARENT_FIELD = 'evidence_parent'

/**
 * Strict canonical positive integer. Exported so agent-work-contract's
 * validateContract uses the identical rule — Number.isInteger and this parser
 * disagree on string integers, and two layers that disagree on what counts as
 * a valid generation will disagree on whether a contract is publishable.
 */
export function requirePositiveInt(value, what) {
  // Strict: no boolean/array coercion, no leading zeros, no scientific notation.
  // Mirrors positiveInteger in agent-evidence-paths.mjs.
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^[1-9]\d*$/.test(String(value))) {
    throw new EvidenceLineageError(`${what} must be a canonical positive integer, not ${JSON.stringify(value)}`)
  }
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1) throw new EvidenceLineageError(`${what} must be a positive integer, not ${JSON.stringify(value)}`)
  return n
}

/** Stable sha256 of a contract object. Delegates to agent-work-contract's
 * canonical hash so the two implementations can never diverge. */
export function lineageContractHash(contract) {
  if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new EvidenceLineageError('contract must be a JSON object to hash')
  }
  return contractHash(contract)
}

/**
 * Parse and validate an evidence_parent binding.
 *
 * null                          — v1 authentic root (no predecessor).
 * { work_issue, generation, contract_sha256 } — v2 explicit predecessor.
 *
 * Anything else is refused. A parent that names a different issue is refused:
 * generations are per-issue append-only chains, not a global soup.
 */
export function parseEvidenceParent(raw, { workIssue } = {}) {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new EvidenceLineageError('evidence_parent must be null or an object with work_issue, generation, and contract_sha256')
  }
  const known = new Set(['work_issue', 'generation', 'contract_sha256'])
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      throw new EvidenceLineageError(`evidence_parent has unknown field ${key}; a parent binding carries exactly work_issue, generation, and contract_sha256`)
    }
  }
  const parentIssue = requirePositiveInt(raw.work_issue, 'evidence_parent.work_issue')
  const parentGen = requirePositiveInt(raw.generation, 'evidence_parent.generation')
  const digest = String(raw.contract_sha256 ?? '')
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new EvidenceLineageError('evidence_parent.contract_sha256 must be a 64-character lowercase hex sha256')
  }
  if (workIssue !== undefined && parentIssue !== requirePositiveInt(workIssue, 'work_issue')) {
    throw new EvidenceLineageError(`evidence_parent names issue #${parentIssue} but this chain is issue #${workIssue}; a generation chain never crosses issues`)
  }
  return Object.freeze({ work_issue: parentIssue, generation: parentGen, contract_sha256: digest })
}

/**
 * Validate one generation record's lineage shape.
 *
 * schema_version 1: evidence_parent must be absent or null; generation is 1 unless
 *   the contract already used a higher one for a pre-lineage reservation.
 * schema_version 2: evidence_parent is required and must be an explicit binding
 *   (null only for generation 1, which is the chain root).
 */
export function validateGenerationLineage(contract) {
  if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new EvidenceLineageError('contract must be a JSON object')
  }
  const workIssue = requirePositiveInt(contract.work_issue, 'work_issue')
  const generation = requirePositiveInt(contract.generation ?? 1, 'generation')
  const schemaVersion = contract.schema_version
  if (schemaVersion === 1) {
    if (contract[EVIDENCE_PARENT_FIELD] !== undefined && contract[EVIDENCE_PARENT_FIELD] !== null) {
      throw new EvidenceLineageError('schema_version 1 authentic roots carry no evidence_parent; do not retrofit lineage onto a v1 record')
    }
    return Object.freeze({ work_issue: workIssue, generation, schema_version: 1, evidence_parent: null })
  }
  if (schemaVersion === LINEAGE_SCHEMA_VERSION) {
    if (!(EVIDENCE_PARENT_FIELD in contract)) {
      throw new EvidenceLineageError('schema_version 2 requires an explicit evidence_parent (null only for generation 1)')
    }
    const parent = parseEvidenceParent(contract[EVIDENCE_PARENT_FIELD], { workIssue })
    if (generation === 1 && parent !== null) {
      throw new EvidenceLineageError('generation 1 is the chain root and must carry evidence_parent null')
    }
    if (generation > 1 && parent === null) {
      throw new EvidenceLineageError(`generation ${generation} must name its predecessor in evidence_parent; only generation 1 is a root`)
    }
    if (parent !== null && parent.generation >= generation) {
      throw new EvidenceLineageError(`evidence_parent.generation ${parent.generation} must be strictly before generation ${generation}; an append-only chain never points at itself or a successor`)
    }
    return Object.freeze({ work_issue: workIssue, generation, schema_version: LINEAGE_SCHEMA_VERSION, evidence_parent: parent })
  }
  throw new EvidenceLineageError(`unsupported contract schema_version ${JSON.stringify(schemaVersion)}; lineage understands 1 and ${LINEAGE_SCHEMA_VERSION}`)
}

/**
 * Build the explicit predecessor binding from the parent contract object.
 * The digest is over the parent contract's canonical form, so a rewritten parent
 * cannot be silently accepted as the same predecessor.
 */
export function bindPredecessor(parentContract) {
  if (parentContract === null || typeof parentContract !== 'object' || Array.isArray(parentContract)) {
    throw new EvidenceLineageError('parent contract must be a JSON object')
  }
  const parentIssue = requirePositiveInt(parentContract.work_issue, 'parent.work_issue')
  const parentGen = requirePositiveInt(parentContract.generation ?? 1, 'parent.generation')
  return Object.freeze({
    work_issue: parentIssue,
    generation: parentGen,
    contract_sha256: lineageContractHash(parentContract),
  })
}

/**
 * Resolve the unique current pair for a work issue from a complete changed-file
 * set plus contract identity. Never picks "the highest filename".
 *
 * Rules:
 *   * Exactly one complete pair may claim the issue among the changed files.
 *   * The pair must be the contract's own (issue + generation), or the legacy
 *     pair when the contract is a schema_version 1 generation-1 root.
 *   * A higher generation number in an unrelated path is not "more current".
 *   * Partial and multi-pair lists are refused.
 *   * Pair↔generation binding is enforced even for v1: a schema_version 1
 *     contract at generation > 1 may not keep its evidence at the fixed legacy
 *     paths while its immutable ref names a higher generation (#3380).
 */
export function resolveCurrentPair(changedFiles, contract) {
  const resolved = resolveEvidencePair(changedFiles)
  if (resolved.state === 'inherited') {
    throw new EvidenceLineageError('the changed-file set carries no evidence pair; main\'s copy is not this work\'s evidence')
  }
  if (resolved.state === 'partial') {
    throw new EvidenceLineageError(`half an evidence pair cannot be current (${resolved.key}); a contract and a completion report travel together`)
  }
  if (resolved.state === 'conflicted') {
    throw new EvidenceLineageError(`more than one evidence pair claims this work (${resolved.key}); exactly one current pair is allowed`)
  }
  const lineage = validateGenerationLineage(contract)
  const expected = evidencePaths(lineage.work_issue, lineage.generation)
  if (resolved.key !== expected.key && resolved.key !== 'legacy') {
    throw new EvidenceLineageError(`the current pair is ${resolved.key} but the contract declares ${expected.key}; filename order never decides currency`)
  }
  if (resolved.key === 'legacy') {
    if (lineage.schema_version !== 1) {
      throw new EvidenceLineageError('a schema_version 2 contract must use its keyed pair, not the legacy paths')
    }
    if (lineage.generation !== 1) {
      throw new EvidenceLineageError(`a schema_version 1 generation ${lineage.generation} contract must use its keyed pair ${expected.key}; the legacy paths are only the generation-1 v1 root pair`)
    }
  }
  return Object.freeze({
    key: resolved.key,
    contract: resolved.contract,
    completion: resolved.completion,
    work_issue: lineage.work_issue,
    generation: lineage.generation,
    schema_version: lineage.schema_version,
    evidence_parent: lineage.evidence_parent,
  })
}

/**
 * Verify an evidence_parent binding against the actual parent contract object.
 * A forged digest is refused: the recorded parent hash must equal the hash of
 * the parent contract that is actually present.
 */
export function verifyPredecessorBinding(contract, parentContract) {
  const lineage = validateGenerationLineage(contract)
  if (lineage.evidence_parent === null) {
    if (parentContract != null) throw new EvidenceLineageError('a root generation has no predecessor to verify')
    return true
  }
  if (parentContract == null || typeof parentContract !== 'object' || Array.isArray(parentContract)) {
    throw new EvidenceLineageError('evidence_parent is set but the predecessor contract is not available to verify')
  }
  const expected = bindPredecessor(parentContract)
  if (expected.work_issue !== lineage.evidence_parent.work_issue
    || expected.generation !== lineage.evidence_parent.generation
    || expected.contract_sha256 !== lineage.evidence_parent.contract_sha256) {
    throw new EvidenceLineageError(`evidence_parent digest does not match the predecessor contract (recorded ${lineage.evidence_parent.contract_sha256}, actual ${expected.contract_sha256}); a forged parent binding is refused`)
  }
  return true
}

/**
 * Refuse mutation of a committed generation record.
 *
 * `committed` is the previously recorded object (from the published ref or the
 * merged commit). `next` is what a writer is about to record. Any difference in
 * the lineage-identity fields is a mutation. Content fields that are already
 * immutable-by-ref (the whole contract) cannot change at all.
 */
export function refuseCommittedMutation(committed, next) {
  if (committed == null) return true
  if (next == null || typeof next !== 'object' || Array.isArray(next)) {
    throw new EvidenceLineageError('the replacement record is not a JSON object')
  }
  const before = lineageContractHash(committed)
  const after = lineageContractHash(next)
  if (before === after) return true
  const committedLineage = validateGenerationLineage(committed)
  const nextLineage = validateGenerationLineage(next)
  if (committedLineage.work_issue !== nextLineage.work_issue
    || committedLineage.generation !== nextLineage.generation
    || JSON.stringify(committedLineage.evidence_parent) !== JSON.stringify(nextLineage.evidence_parent)) {
    throw new EvidenceLineageError(`committed generation ${committedLineage.work_issue}/${committedLineage.generation} cannot be rewritten; publish a successor generation instead of mutating a recorded record`)
  }
  throw new EvidenceLineageError(`committed generation ${committedLineage.work_issue}/${committedLineage.generation} is immutable (recorded sha256 ${before}, proposed ${after}); publish a successor generation with evidence_parent bound to the recorded hash`)
}

/**
 * Plan a successor generation. Returns the metadata a writer must use: the new
 * generation number (max known + 1, skipping unused reservations) and the
 * explicit predecessor binding.
 *
 * Published refs under `refs/db-contracts/<issue>/*` are the planner's source of
 * truth: pass `io` with a `listRefs` method and every generation that actually
 * exists is known, whether or not the caller remembered it. `knownGenerations`
 * supplements that list (offline tests) and never replaces it. An unused
 * reserved number is skipped, never reused.
 */
export function planSuccessor({ workIssue, parentContract, knownGenerations = [], io = null }) {
  const issue = requirePositiveInt(workIssue, 'work_issue')
  const lineage = validateGenerationLineage(parentContract)
  if (lineage.work_issue !== issue) {
    throw new EvidenceLineageError(`parent contract belongs to issue #${lineage.work_issue}, not #${issue}`)
  }
  const seen = new Set()
  // Published refs are authoritative. A generation that exists on the server is
  // known whether or not the caller listed it.
  if (io && typeof io.listRefs === 'function') {
    const prefix = `refs/db-contracts/${issue}/`
    for (const row of io.listRefs(prefix) ?? []) {
      const ref = String(row?.ref ?? row ?? '')
      const match = new RegExp(`^refs\\/db-contracts\\/${issue}\\/([1-9]\\d*)$`).exec(ref)
      if (match) seen.add(requirePositiveInt(match[1], 'published generation'))
    }
  }
  const known = new Set()
  for (const raw of knownGenerations) {
    const n = requirePositiveInt(raw, 'known generation')
    if (known.has(n)) throw new EvidenceLineageError(`known generation ${n} is listed twice`)
    known.add(n)
    seen.add(n)
  }
  seen.add(lineage.generation)
  let next = 1
  while (seen.has(next)) next += 1
  // If the parent is generation P and P+1 is free, use P+1 (normal append).
  // If P+1 was reserved and abandoned, skip forward to the first free number.
  if (next < lineage.generation + 1) next = lineage.generation + 1
  while (seen.has(next)) next += 1
  return Object.freeze({
    work_issue: issue,
    generation: next,
    evidence_parent: bindPredecessor(parentContract),
  })
}

/**
 * Committed-record mutation refusal for a generation directory write.
 * Writers call this before replacing files under `.agent/work/<issue>/<gen>/`.
 */
export function assertGenerationWriteAllowed({ workIssue, generation, committedContract, nextContract }) {
  const issue = requirePositiveInt(workIssue, 'work_issue')
  const gen = requirePositiveInt(generation, 'generation')
  const paths = evidencePaths(issue, gen)
  if (committedContract != null) {
    refuseCommittedMutation(committedContract, nextContract ?? committedContract)
  }
  if (nextContract != null) {
    const lineage = validateGenerationLineage(nextContract)
    if (lineage.work_issue !== issue || lineage.generation !== gen) {
      throw new EvidenceLineageError(`contract declares ${lineage.work_issue}/${lineage.generation} but the write targets ${issue}/${gen}`)
    }
  }
  return paths
}

/**
 * True when a path has a recognized evidence filename. File contents are
 * validated by the contract and Git evidence gates, not by this path helper.
 */
export function isRealEvidenceRecord(path) {
  return isEvidencePath(path)
}

/**
 * Classify every changed path under `.agent/` and refuse anything that is neither
 * a known evidence pair member nor explicitly inert. "Unknown file under .agent/"
 * is never silently inert (issue #3380).
 */
export function classifyAgentPaths(changedFiles) {
  const evidence = []
  const unknown = []
  for (const raw of changedFiles ?? []) {
    const path = String(raw)
    if (!path.startsWith('.agent/')) continue
    if (isRealEvidenceRecord(path)) {
      evidence.push(path)
      continue
    }
    unknown.push(path)
  }
  if (unknown.length) {
    throw new EvidenceLineageError(`unknown path(s) under .agent/ are not inert evidence: ${unknown.join(', ')}; only contract.json and completion.json pairs are evidence records`)
  }
  return Object.freeze({ evidence: [...evidence].sort(), unknown: [] })
}
