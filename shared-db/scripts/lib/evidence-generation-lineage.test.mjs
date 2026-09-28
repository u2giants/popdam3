import test from 'node:test'
import assert from 'node:assert/strict'
import { contractHash } from '../agent-work-contract.mjs'
import {
  EvidenceLineageError,
  LINEAGE_SCHEMA_VERSION,
  lineageContractHash,
  parseEvidenceParent,
  validateGenerationLineage,
  bindPredecessor,
  verifyPredecessorBinding,
  resolveCurrentPair,
  refuseCommittedMutation,
  planSuccessor,
  assertGenerationWriteAllowed,
  isRealEvidenceRecord,
  classifyAgentPaths,
} from './evidence-generation-lineage.mjs'

const ISSUE = 3380

function v1Root(overrides = {}) {
  return {
    schema_version: 1,
    work_issue: ISSUE,
    work_type: 'repo-maintenance',
    route: 'repo-maintenance',
    goal: 'test root',
    base_sha: 'a'.repeat(40),
    dispatcher: 'test',
    worker: 'test',
    branch: 'codex/test',
    worktree: 'C:/tmp/test',
    allowed_paths: ['.agent/work/3380/1/contract.json'],
    file_writes: ['.agent/work/3380/1/contract.json'],
    db_reads: [],
    db_writes: [],
    prohibited_actions: ['no db'],
    required_checks: ['git diff --check'],
    assumptions: [],
    stop_conditions: [],
    generation: 1,
    ...overrides,
  }
}

function v2Child(parent, overrides = {}) {
  const base = v1Root({
    schema_version: LINEAGE_SCHEMA_VERSION,
    generation: (parent.generation ?? 1) + 1,
    evidence_parent: bindPredecessor(parent),
    ...overrides,
  })
  return base
}

test('lineageContractHash is stable and key-order independent', () => {
  const a = { work_issue: 1, b: 2, a: 1 }
  const b = { a: 1, b: 2, work_issue: 1 }
  assert.equal(lineageContractHash(a), lineageContractHash(b))
  assert.match(lineageContractHash(a), /^[0-9a-f]{64}$/)
})

test('lineageContractHash delegates to contractHash so the two implementations cannot diverge', () => {
  const sample = { schema_version: 1, work_issue: 42, nested: { z: 1, a: [3, 2, 1] }, goal: 'x' }
  assert.equal(lineageContractHash(sample), contractHash(sample))
  assert.equal(lineageContractHash(v1Root()), contractHash(v1Root()))
})

test('v1 authentic root has null evidence_parent and is not rewritten', () => {
  const lineage = validateGenerationLineage(v1Root())
  assert.equal(lineage.schema_version, 1)
  assert.equal(lineage.evidence_parent, null)
  assert.throws(
    () => validateGenerationLineage(v1Root({ evidence_parent: { work_issue: ISSUE, generation: 1, contract_sha256: 'b'.repeat(64) } })),
    /do not retrofit lineage/,
  )
})

test('v2 generation 1 is a root with evidence_parent null', () => {
  const lineage = validateGenerationLineage(v1Root({ schema_version: LINEAGE_SCHEMA_VERSION, evidence_parent: null }))
  assert.equal(lineage.generation, 1)
  assert.equal(lineage.evidence_parent, null)
})

test('v2 generation > 1 requires an explicit predecessor', () => {
  assert.throws(
    () => validateGenerationLineage(v1Root({ schema_version: LINEAGE_SCHEMA_VERSION, generation: 2, evidence_parent: null })),
    /must name its predecessor/,
  )
  assert.throws(
    () => validateGenerationLineage(v1Root({ schema_version: LINEAGE_SCHEMA_VERSION, generation: 2 })),
    /requires an explicit evidence_parent/,
  )
})

test('evidence_parent never crosses issues', () => {
  assert.throws(
    () => parseEvidenceParent({ work_issue: 99, generation: 1, contract_sha256: 'c'.repeat(64) }, { workIssue: ISSUE }),
    /never crosses issues/,
  )
})

test('evidence_parent rejects malformed digests and shapes', () => {
  assert.throws(() => parseEvidenceParent('nope'), /must be null or an object/)
  assert.throws(() => parseEvidenceParent({ work_issue: 1, generation: 1, contract_sha256: 'xyz' }), /64-character/)
  assert.throws(() => parseEvidenceParent({ work_issue: 0, generation: 1, contract_sha256: 'c'.repeat(64) }), /positive integer/)
})

test('evidence_parent refuses extra keys — name exists is not right object', () => {
  assert.throws(
    () => parseEvidenceParent({ work_issue: 1, generation: 1, contract_sha256: 'c'.repeat(64), sneaky: true }),
    /unknown field sneaky/,
  )
  assert.throws(
    () => parseEvidenceParent({ work_issue: 1, generation: 1, contract_sha256: 'c'.repeat(64), workIssue: 1 }),
    /unknown field workIssue/,
  )
})

test('bindPredecessor hashes the parent contract', () => {
  const parent = v1Root()
  const bound = bindPredecessor(parent)
  assert.equal(bound.work_issue, ISSUE)
  assert.equal(bound.generation, 1)
  assert.equal(bound.contract_sha256, lineageContractHash(parent))
})

test('resolveCurrentPair uses contract identity, never filename order', () => {
  const contract = v1Root()
  const ok = resolveCurrentPair(
    ['.agent/work/3380/1/contract.json', '.agent/work/3380/1/completion.json', 'scripts/foo.mjs'],
    contract,
  )
  assert.equal(ok.key, '3380/1')
  assert.equal(ok.generation, 1)

  // A higher-numbered unrelated path must not win.
  assert.throws(
    () => resolveCurrentPair(
      ['.agent/work/3380/1/contract.json', '.agent/work/3380/1/completion.json', '.agent/work/3380/9/contract.json'],
      contract,
    ),
    /more than one evidence pair/,
  )

  // Wrong issue/generation pair is refused even if it is the only pair.
  assert.throws(
    () => resolveCurrentPair(
      ['.agent/work/999/1/contract.json', '.agent/work/999/1/completion.json'],
      contract,
    ),
    /filename order never decides currency/,
  )

  assert.throws(() => resolveCurrentPair(['scripts/foo.mjs'], contract), /carries no evidence pair/)
  assert.throws(
    () => resolveCurrentPair(['.agent/work/3380/1/contract.json'], contract),
    /half an evidence pair/,
  )
})

test('legacy pair is authentic for v1 and refused for v2', () => {
  const v1 = v1Root()
  const legacy = resolveCurrentPair(['.agent/contract.json', '.agent/completion.json'], v1)
  assert.equal(legacy.key, 'legacy')

  const v2 = v1Root({ schema_version: LINEAGE_SCHEMA_VERSION, evidence_parent: null })
  assert.throws(
    () => resolveCurrentPair(['.agent/contract.json', '.agent/completion.json'], v2),
    /must use its keyed pair/,
  )
})

test('committed-record mutation is refused', () => {
  const committed = v1Root()
  assert.equal(refuseCommittedMutation(committed, { ...committed }), true)
  assert.equal(refuseCommittedMutation(null, committed), true)
  assert.throws(
    () => refuseCommittedMutation(committed, v1Root({ goal: 'rewritten' })),
    /immutable|cannot be rewritten/,
  )
  assert.throws(
    () => refuseCommittedMutation(committed, v1Root({ generation: 2 })),
    /publish a successor/,
  )
})

test('planSuccessor appends and skips unused reservations', () => {
  const parent = v1Root()
  const next = planSuccessor({ workIssue: ISSUE, parentContract: parent, knownGenerations: [1] })
  assert.equal(next.generation, 2)
  assert.equal(next.evidence_parent.contract_sha256, lineageContractHash(parent))
  assert.equal(next.evidence_parent.generation, 1)

  // Generation 2 was reserved and abandoned (never committed content) — skip it.
  const skipped = planSuccessor({ workIssue: ISSUE, parentContract: parent, knownGenerations: [1, 2, 3] })
  assert.equal(skipped.generation, 4)

  assert.throws(
    () => planSuccessor({ workIssue: 99, parentContract: parent, knownGenerations: [1] }),
    /belongs to issue/,
  )
})

test('planSuccessor uses published refs/db-contracts/<issue>/* as its source of truth', () => {
  const parent = v1Root()
  // Published generations 1 and 2 exist; the caller forgot to list them.
  const io = {
    listRefs: (prefix) => {
      assert.equal(prefix, `refs/db-contracts/${ISSUE}/`)
      return [
        { ref: `refs/db-contracts/${ISSUE}/1`, sha: 'a'.repeat(40) },
        { ref: `refs/db-contracts/${ISSUE}/2`, sha: 'b'.repeat(40) },
      ]
    },
  }
  const next = planSuccessor({ workIssue: ISSUE, parentContract: parent, io })
  assert.equal(next.generation, 3, 'published refs are known even when knownGenerations is empty')

  // Published refs and knownGenerations are unioned; duplicates across the two
  // are fine (they are the same fact), duplicates within knownGenerations are not.
  const unioned = planSuccessor({ workIssue: ISSUE, parentContract: parent, io, knownGenerations: [2, 3] })
  assert.equal(unioned.generation, 4)

  // An unpublished reservation listed only in knownGenerations is still skipped.
  const withReservation = planSuccessor({ workIssue: ISSUE, parentContract: parent, io, knownGenerations: [3] })
  assert.equal(withReservation.generation, 4)

  assert.throws(
    () => planSuccessor({ workIssue: ISSUE, parentContract: parent, knownGenerations: [1, 1] }),
    /listed twice/,
  )
})

test('planSuccessor ignores published refs from other issues', () => {
  const parent = v1Root()
  const io = {
    listRefs: (prefix) => {
      assert.equal(prefix, `refs/db-contracts/${ISSUE}/`)
      return [
        { ref: `refs/db-contracts/${ISSUE}/1`, sha: 'a'.repeat(40) },
        { ref: `refs/db-contracts/9999/5`, sha: 'c'.repeat(40) },
        { ref: `refs/db-contracts/${ISSUE}/2`, sha: 'b'.repeat(40) },
      ]
    },
  }
  const next = planSuccessor({ workIssue: ISSUE, parentContract: parent, io })
  assert.equal(next.generation, 3, 'generations from other issues are never attributed to this chain')
})

test('assertGenerationWriteAllowed binds write target to contract identity', () => {
  const contract = v1Root()
  const paths = assertGenerationWriteAllowed({ workIssue: ISSUE, generation: 1, nextContract: contract })
  assert.equal(paths.key, '3380/1')
  assert.throws(
    () => assertGenerationWriteAllowed({ workIssue: ISSUE, generation: 2, nextContract: contract }),
    /declares 3380\/1 but the write targets/,
  )
  assert.throws(
    () => assertGenerationWriteAllowed({ workIssue: ISSUE, generation: 1, committedContract: contract, nextContract: v1Root({ goal: 'x' }) }),
    /immutable|cannot be rewritten/,
  )
})

test('arbitrary .agent/ metadata is not inert evidence', () => {
  assert.equal(isRealEvidenceRecord('.agent/work/3380/1/contract.json'), true)
  assert.equal(isRealEvidenceRecord('.agent/contract.json'), true)
  assert.equal(isRealEvidenceRecord('.agent/evil.sh'), false)
  assert.equal(isRealEvidenceRecord('.agent/work/3380/1/notes.md'), false)

  const ok = classifyAgentPaths(['.agent/work/3380/1/contract.json', 'scripts/a.mjs'])
  assert.deepEqual(ok.evidence, ['.agent/work/3380/1/contract.json'])
  assert.throws(
    () => classifyAgentPaths(['.agent/sneaky.js']),
    /not inert evidence/,
  )
  assert.throws(
    () => classifyAgentPaths(['.agent/work/3380/1/payload.sh']),
    /not inert evidence/,
  )
})

test('evidence_parent.generation must be strictly before the successor', () => {
  const parent = v1Root()
  assert.throws(
    () => validateGenerationLineage(v1Root({
      schema_version: LINEAGE_SCHEMA_VERSION,
      generation: 1,
      evidence_parent: { work_issue: ISSUE, generation: 1, contract_sha256: 'c'.repeat(64) },
    })),
    /chain root/,
  )
  assert.throws(
    () => validateGenerationLineage(v1Root({
      schema_version: LINEAGE_SCHEMA_VERSION,
      generation: 2,
      evidence_parent: { work_issue: ISSUE, generation: 2, contract_sha256: 'c'.repeat(64) },
    })),
    /strictly before generation 2/,
  )
  assert.throws(
    () => validateGenerationLineage(v1Root({
      schema_version: LINEAGE_SCHEMA_VERSION,
      generation: 2,
      evidence_parent: { work_issue: ISSUE, generation: 5, contract_sha256: 'c'.repeat(64) },
    })),
    /strictly before generation 2/,
  )
})

test('verifyPredecessorBinding refuses a forged parent digest', () => {
  const parent = v1Root()
  const child = v2Child(parent)
  assert.equal(verifyPredecessorBinding(child, parent), true)

  const forged = v1Root({
    schema_version: LINEAGE_SCHEMA_VERSION,
    generation: 2,
    evidence_parent: { work_issue: ISSUE, generation: 1, contract_sha256: '0'.repeat(64) },
  })
  assert.throws(
    () => verifyPredecessorBinding(forged, parent),
    /forged parent binding|does not match the predecessor/,
  )
  assert.throws(
    () => verifyPredecessorBinding(child, v1Root({ goal: 'different parent' })),
    /does not match the predecessor/,
  )
  assert.throws(
    () => verifyPredecessorBinding(child, null),
    /predecessor contract is not available/,
  )
})

test('requirePositiveInt is strict (no coercion)', () => {
  assert.throws(
    () => parseEvidenceParent({ work_issue: true, generation: 1, contract_sha256: 'c'.repeat(64) }, { workIssue: 1 }),
    /canonical positive integer/,
  )
  assert.throws(
    () => parseEvidenceParent({ work_issue: '01', generation: 1, contract_sha256: 'c'.repeat(64) }, { workIssue: 1 }),
    /canonical positive integer/,
  )
  assert.throws(
    () => parseEvidenceParent({ work_issue: 1, generation: '1e0', contract_sha256: 'c'.repeat(64) }, { workIssue: 1 }),
    /canonical positive integer/,
  )
})

test('real Git-history negative fixtures: in-place record edit, fake parent, highest-filename', () => {
  // Rewrite a committed generation (the original defect class).
  const recorded = v1Root({ goal: 'authentic recorded goal' })
  assert.throws(
    () => refuseCommittedMutation(recorded, v1Root({ goal: 'edited after the fact' })),
    /immutable|cannot be rewritten/,
  )

  // Forged predecessor digest is refused by verifyPredecessorBinding.
  const parent = v1Root()
  const forged = v1Root({
    schema_version: LINEAGE_SCHEMA_VERSION,
    generation: 2,
    evidence_parent: { work_issue: ISSUE, generation: 1, contract_sha256: '0'.repeat(64) },
  })
  assert.throws(
    () => verifyPredecessorBinding(forged, parent),
    /forged parent binding|does not match the predecessor/,
  )

  // Highest filename is not current when the contract says otherwise.
  const contract3 = v1Root({ generation: 3, schema_version: LINEAGE_SCHEMA_VERSION, evidence_parent: bindPredecessor(v1Root({ generation: 2, schema_version: LINEAGE_SCHEMA_VERSION, evidence_parent: bindPredecessor(v1Root()) })) })
  assert.throws(
    () => resolveCurrentPair(
      ['.agent/work/3380/9/contract.json', '.agent/work/3380/9/completion.json'],
      contract3,
    ),
    /filename order never decides currency/,
  )
  const correct = resolveCurrentPair(
    ['.agent/work/3380/3/contract.json', '.agent/work/3380/3/completion.json'],
    contract3,
  )
  assert.equal(correct.generation, 3)
})
