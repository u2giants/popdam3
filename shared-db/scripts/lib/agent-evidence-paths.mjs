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

import { execFileSync } from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Host toolchain (setup-python, node, etc.) may set loader/interpreter vars for
// its own binaries. PR-data validation and any PR-data child must not inherit
// them. Callers that pass an explicit env still get the strict refusal below;
// the process.env default is sanitized so runner Python keeps working while PR
// data still cannot smuggle loaders.
const PR_DATA_UNSAFE_ENV = ['NODE_OPTIONS','NODE_PATH','BASH_ENV','ENV','LD_PRELOAD','LD_LIBRARY_PATH','PYTHONPATH','PYTHONHOME','GIT_EXTERNAL_DIFF']

export function sanitizePrDataEnv(env = process.env) {
  const cleaned = { ...env }
  for (const name of PR_DATA_UNSAFE_ENV) delete cleaned[name]
  delete cleaned.GIT_CONFIG_PARAMETERS
  if (cleaned.GIT_CONFIG_COUNT && cleaned.GIT_CONFIG_COUNT !== '0') delete cleaned.GIT_CONFIG_COUNT
  for (const name of ['GIT_CONFIG_GLOBAL','GIT_CONFIG_SYSTEM']) {
    if (cleaned[name] && cleaned[name] !== '/dev/null') delete cleaned[name]
  }
  return cleaned
}

// Existing evidence paths now also bind the PR checkout as data, never executable
// source. Callers must carry explicit immutable identities; ambient overrides do
// not select a data root.
export function validatePrDataRoot({ root, headSha, sourceRoot, sourceSha }, env = sanitizePrDataEnv(process.env)) {
  const fail = (message) => { throw new EvidencePathError(`PR data boundary: ${message}`) }
  for (const name of PR_DATA_UNSAFE_ENV) if (env[name]) fail(`unsafe ${name}`)
  if (env.GIT_CONFIG_PARAMETERS || env.GIT_CONFIG_COUNT && env.GIT_CONFIG_COUNT !== '0') fail('unsafe injected Git configuration')
  for (const name of ['GIT_CONFIG_GLOBAL','GIT_CONFIG_SYSTEM']) if (env[name] && env[name] !== '/dev/null') fail(`unsafe ${name}`)
  if (![headSha, sourceSha].every(value => /^[0-9a-f]{40}$/.test(value ?? ''))) fail('immutable head and source identities required')
  const checked = value => {
    if (typeof value !== 'string' || !path.isAbsolute(value) || realpathSync(value) !== path.resolve(value) || lstatSync(value).isSymbolicLink()) fail('canonical absolute directory required')
    return path.resolve(value)
  }
  const data = checked(root), source = checked(sourceRoot)
  if (data === source || source.startsWith(`${data}${path.sep}`) && path.basename(source) !== 'trusted-policy') fail('source/data directory ambiguity')
  const git = (cwd, args) => execFileSync('git', ['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args], { cwd, encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim()
  for (const [directory, sha] of [[data,headSha],[source,sourceSha]]) {
    if (git(directory,['rev-parse','--show-toplevel']) !== directory || git(directory,['rev-parse','HEAD']) !== sha) fail('checkout root or immutable head mismatch')
    const config = git(directory,['config','--local','--list'])
    if (/^(core\.(hooksPath|fsmonitor)|filter\.|diff\..*\.(command|textconv)|include\.|includeif\.)/im.test(config)) fail('unsafe repository configuration')
  }
  if (git(source,['status','--porcelain'])) fail('protected source checkout dirty')
  const entries = git(data,['ls-files','--stage','-z']).split('\0').filter(Boolean)
  for (const entry of entries) {
    const match = /^(\d+) [0-9a-f]+ \d+\t([\s\S]+)$/.exec(entry)
    if (!match || !['100644','100755'].includes(match[1])) fail('linked or nonregular tracked data')
    const file = path.resolve(data,match[2])
    if (!file.startsWith(`${data}${path.sep}`) || realpathSync(file) !== file) fail('data path escape')
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.nlink !== 1) fail('linked or nonregular data file')
  }
  return data
}

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
 * use the keyed path for its own issue/generation, or the legacy pair when the
 * contract is a schema_version 1 generation-1 root; it may never write another
 * pull request's keyed path.
 *
 * A schema_version 2 contract must use its keyed pair only (the same rule
 * resolveCurrentPair enforces). The legacy pair stays acceptable for a v1
 * generation-1 root so open pull requests need not all rewrite at once. A
 * schema_version 1 contract at generation > 1 is NOT given the legacy paths:
 * pair↔generation binding is enforced even for v1 (#3380).
 */
export function acceptableEvidencePairs(contract) {
  const pairs = []
  let generation = 1
  try {
    const keyed = evidencePaths(contract?.work_issue, contract?.generation ?? 1)
    generation = Number(contract?.generation ?? 1)
    pairs.push(Object.freeze([keyed.completion, keyed.contract].sort()))
  } catch {
    // A contract with no usable work_issue fails its own validation elsewhere;
    // it does not get a keyed path here.
    generation = Number(contract?.generation ?? 1)
  }
  if (contract?.schema_version !== 2 && Number.isInteger(generation) && generation === 1) {
    pairs.push(LEGACY_PAIR)
  }
  return pairs
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 8 || args[0] !== '--data-root' || args[2] !== '--head-sha' || args[4] !== '--source-root' || args[6] !== '--source-sha') throw new EvidencePathError('explicit data/source roots and immutable heads required')
    console.log(validatePrDataRoot({root:args[1],headSha:args[3],sourceRoot:args[5],sourceSha:args[7]}))
  } catch (error) { console.error(error.message); process.exit(2) }
}
