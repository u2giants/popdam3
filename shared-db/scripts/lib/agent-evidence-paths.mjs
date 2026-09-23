// Where a pull request's agent work-contract evidence pair lives (#2708).
//
// THE DEFECT THIS EXISTS TO REMOVE. Every agent-authored pull request used to
// write its own per-pull-request evidence into the same two fixed paths,
// `.agent/contract.json` and `.agent/completion.json`. The contents are private
// to one pull request; the paths were shared by all of them. So any merge to
// main put every other open pull request into conflict on those files even when
// the two changes had nothing to do with each other, and because governed
// reviews are pinned to an exact head, resolving that conflict voided every
// durable verdict and forced a full re-review. One unrelated merge cost every
// other open pull request a re-review round, and with more than a couple open it
// did not converge.
//
// THE PATH. Evidence is now keyed by the work issue and the contract generation
// the durable contract ref already uses:
//
//   .agent/work/<work_issue>/<generation>/contract.json
//   .agent/work/<work_issue>/<generation>/completion.json
//
// mirroring `refs/db-contracts/<work_issue>/<generation>`. Two pull requests can
// collide there only if they claim the same issue AND the same generation, which
// is the one case where a collision is real information rather than noise.
//
// THE LEGACY PAIR IS STILL ACCEPTED, DELIBERATELY. Every pull request open when
// this landed carries the old pair, and making them all rewrite their evidence
// would have caused exactly the re-review storm this change exists to stop. The
// old pair stays valid; nothing here relaxes what the evidence must prove.
//
// NOTHING HERE WIDENS THE STANDARD. This module answers "which two files" and
// nothing else. Every validity rule still lives in
// `scripts/agent-work-contract-git-evidence.mjs`.

export const LEGACY_CONTRACT_PATH = '.agent/contract.json'
export const LEGACY_COMPLETION_PATH = '.agent/completion.json'
export const LEGACY_PAIR = Object.freeze([LEGACY_COMPLETION_PATH, LEGACY_CONTRACT_PATH])
export const KEYED_EVIDENCE_PATTERN = /^\.agent\/work\/([1-9]\d*)\/([1-9]\d*)\/(contract|completion)\.json$/

export class EvidencePathError extends Error {}

function positiveInteger(value, what) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^[1-9]\d*$/.test(String(value))) throw new EvidencePathError(`${what} must be a canonical positive integer, not ${JSON.stringify(value)}`)
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new EvidencePathError(`${what} must be a safe positive integer, not ${JSON.stringify(value)}`)
  return number
}

/** The keyed pair for one work issue and contract generation. */
export function evidencePaths(workIssue, generation = 1) {
  const issue = positiveInteger(workIssue, 'work_issue')
  const gen = positiveInteger(generation, 'generation')
  const directory = `.agent/work/${issue}/${gen}`
  return { key: `${issue}/${gen}`, directory, contract: `${directory}/contract.json`, completion: `${directory}/completion.json` }
}

export function isEvidencePath(path) {
  if (path === LEGACY_CONTRACT_PATH || path === LEGACY_COMPLETION_PATH) return true
  const match = KEYED_EVIDENCE_PATTERN.exec(String(path ?? ''))
  if (!match) return false
  try { evidencePaths(match[1], match[2]); return true } catch { return false }
}

/**
 * Classify the evidence a pull request's changed-file list carries, and say
 * exactly which two paths it is.
 *
 * inherited  - the pull request changes no evidence file; main's copy is not its
 *              evidence.
 * current    - exactly one complete pair.
 * partial    - only one half of a pair. Always an error upstream.
 * conflicted - two or more distinct pairs in one pull request. Fail closed: a
 *              gate that cannot tell which pair to judge must not pick one.
 */
export function resolveEvidencePair(changedFiles) {
  const groups = new Map()
  for (const raw of changedFiles ?? []) {
    const path = String(raw)
    if (path === LEGACY_CONTRACT_PATH || path === LEGACY_COMPLETION_PATH) {
      const group = groups.get('legacy') ?? { key: 'legacy', contract: LEGACY_CONTRACT_PATH, completion: LEGACY_COMPLETION_PATH, seen: new Set() }
      group.seen.add(path === LEGACY_CONTRACT_PATH ? 'contract' : 'completion')
      groups.set('legacy', group)
      continue
    }
    const match = KEYED_EVIDENCE_PATTERN.exec(path)
    if (!match) continue
    const paths = evidencePaths(match[1], match[2])
    const group = groups.get(paths.key) ?? { ...paths, seen: new Set() }
    group.seen.add(match[3])
    groups.set(paths.key, group)
  }
  if (groups.size === 0) return { state: 'inherited', contract: null, completion: null, key: null }
  if (groups.size > 1) return { state: 'conflicted', contract: null, completion: null, key: [...groups.keys()].sort().join(', ') }
  const [group] = groups.values()
  return { state: group.seen.size === 2 ? 'current' : 'partial', contract: group.contract, completion: group.completion, key: group.key }
}

/**
 * The pair a checked-in contract declares it should live at. A pull request may
 * use the keyed path for its own issue/generation, or the legacy pair; it may
 * never write another pull request's keyed path.
 */
export function acceptableEvidencePairs(contract) {
  const pairs = [LEGACY_PAIR]
  try {
    const keyed = evidencePaths(contract?.work_issue, contract?.generation ?? 1)
    pairs.unshift(Object.freeze([keyed.completion, keyed.contract].sort()))
  } catch {
    // A contract with no usable work_issue fails its own validation elsewhere;
    // it does not get a keyed path here.
  }
  return pairs
}
