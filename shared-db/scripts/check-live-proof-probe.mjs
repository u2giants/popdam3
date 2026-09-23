#!/usr/bin/env node
// Issue #3127 (#3029 acceptance target 8): live proof within 30 minutes of
// production_applied.
//
// WHY THIS EXISTS
// The Shared DB Live Proof workflow runs the probe committed on main at
// `.github/live-proofs/<work_issue>.sql`. In the Step 10 trial, #3043's probe
// was written only AFTER production applied, as its own pull request (#3055).
// That pull request sat idle and then went through three governed review rounds
// before it could merge: production applied 13:40, live proof ran 15:52. The
// live check itself took 21 seconds.
//
// So the probe must ride in the implementation pull request, reviewed together
// with the migration. This guard, run by the guarded migration merge, refuses a
// structural migration pull request whose work issue returns to this repository (shared-db)
// when the probe is absent from both the pull request tree and main. An outcome
// returning to an application repository proves itself from that repository and
// is not judged here.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolveBaseRef, gitProbe } from './lib/resolve-base-ref.mjs'
import { pathToFileURL } from 'node:url'
import { runGitHubCommand } from './lib/github-transport.mjs'
import { validateHistoricalRestorationFile } from './historical-migration-restorations.mjs'
import { currentRepository, isThisRepositoryOrHistorical } from './lib/repository-identity.mjs'
import { LEGACY_CONTRACT_PATH, resolveEvidencePair } from './lib/agent-evidence-paths.mjs'

const SCOPE_FENCE = /```db-work-scope\s*\n([\s\S]*?)```/g

export class ProbeCheckError extends Error {}

export function scopeField(body, name) {
  const blocks = [...String(body ?? '').matchAll(SCOPE_FENCE)].map((m) => m[1])
  if (blocks.length !== 1) throw new ProbeCheckError('work issue must carry exactly one db-work-scope block')
  const values = blocks[0].split(/\r?\n/).filter((l) => l.startsWith(`${name}:`)).map((l) => l.slice(name.length + 1).trim())
  if (values.length > 1) throw new ProbeCheckError(`db-work-scope repeats ${name}`)
  return values[0] || null
}

export function probePath(workIssue) { return `.github/live-proofs/${workIssue}.sql` }

// Offline shape check, mirroring what scripts/shared_db_live_proof.py accepts:
// ONE read statement whose result is a column named `passed`. Its row count,
// sole-column shape and value are proven only at live-proof time, on production.
// Returns null when usable, otherwise the reason it is not.
const WRITE_WORD = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|vacuum)\b/i
export function stripSqlNoise(sql) {
  return String(sql ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, (m) => (/^"passed"$/i.test(m) ? 'passed' : '""'))
}
export function probeShapeProblem(sql) {
  const text = stripSqlNoise(sql).trim().replace(/;\s*$/, '').trim()
  if (!text) return 'is empty'
  if (text.includes(';')) return 'holds more than one statement'
  if (!/^(select|with)\b/i.test(text)) return 'does not start with SELECT or WITH'
  if (WRITE_WORD.test(text)) return 'contains a write keyword'
  if (!/\bas\s+passed\b/i.test(text) && !/^select\s+passed\s+from\b/i.test(text)) return 'returns no column named "passed"'
  return null
}
export function probeLooksUsable(sql) { return probeShapeProblem(sql) === null }

// Pure decision; inputs are gathered by the caller so the rule is testable offline.
// Fail closed: a migration pull request with no contract, a structural outcome with
// no return address, or a probe that cannot pass all refuse here.
export function evaluateProbe({ contract, changedFiles, removedFiles = [], readIssueBody, readProbe, isCodeTruthRestoration = () => false, repository }) {
  const migrations = changedFiles.filter((f) => f.startsWith('supabase/migrations/') && f.endsWith('.sql'))
  if (!migrations.length) return { relevant: false, reason: 'no migration file changed' }
  // Same exemption as the lease gate: a code-truth restoration re-records history
  // that is already applied and has no outcome of its own to prove.
  if (migrations.length === 1 && isCodeTruthRestoration(migrations[0])) return { relevant: false, reason: 'historical code-truth restoration' }
  if (!contract) throw new ProbeCheckError('migration pull request has no .agent/contract.json; cannot tell which outcome it proves')
  if (contract.work_type !== 'structural') return { relevant: false, reason: 'contract is not structural' }
  const issue = contract.work_issue
  if (!Number.isInteger(issue) || issue <= 0) throw new ProbeCheckError('structural contract has no valid work_issue')
  const returnTo = scopeField(readIssueBody(issue), 'application_return_to')
  if (!returnTo) throw new ProbeCheckError(`structural outcome #${issue} has no application_return_to in its db-work-scope`)
  // Resolved only here, so a pull request with no structural outcome never needs an identity (#2530).
  repository ??= currentRepository()
  if (!isThisRepositoryOrHistorical(returnTo, repository)) return { relevant: false, reason: `outcome #${issue} returns to ${returnTo}` }
  const path = probePath(issue)
  // Without this, a pull request deleting (or renaming away) its own probe still
  // passed through the main fallback, and merging it would remove the probe.
  if (removedFiles.includes(path)) {
    throw new ProbeCheckError(`#${issue} returns to ${repository} but this pull request deletes or renames ${path}; the merge would leave no live-proof probe`)
  }
  const sql = readProbe(path)
  if (sql === null || sql === undefined) {
    throw new ProbeCheckError(`#${issue} returns to ${repository} but ${path} is not in this pull request or on main. ` +
      'Commit the read-only live-proof probe (one row with a boolean "passed" column) in this migration pull request, ' +
      'so the live proof can run the moment production applies instead of waiting on a separate reviewed pull request.')
  }
  const problem = probeShapeProblem(sql)
  if (problem) throw new ProbeCheckError(`${path} ${problem}; the live proof needs one read-only statement returning a boolean "passed" column`)
  return { relevant: true, issue, path }
}

function defaultGit(args) { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }

// Parses `git diff --name-status` output. Deleted paths and rename sources are removed.
export function parseNameStatus(text) {
  const changed = []
  const removed = []
  for (const line of String(text ?? '').split(/\r?\n/).filter(Boolean)) {
    const [status, ...paths] = line.split('\t')
    const kind = status[0]
    if (kind === 'D') removed.push(paths[0])
    else if (kind === 'R') { removed.push(paths[0]); changed.push(paths[1]) }
    else if (kind === 'C') changed.push(paths[1])
    else if (kind === 'A' || kind === 'M' || kind === 'T') changed.push(paths[0])
  }
  return { changed, removed }
}

// The I/O layer. Every dependency is injectable so it is tested offline.
export function main({
  git = defaultGit,
  fileExists = existsSync,
  readFile = (p) => readFileSync(p, 'utf8'),
  gh = runGitHubCommand,
  log = console.log,
  error = console.error,
} = {}) {
  try {
    // Issue #3280 governed review round 2 (muse-spark-1.3-contributor): this was
    // the most dangerous base-ref consumer on the merge queue path -- origin/main
    // hardcoded, with no --base flag to override it. On a merge_group run that ref
    // does not exist. Resolve it through the shared resolver, which fetches the
    // branch when the ref is absent and throws (never skips) when it cannot.
    const base = resolveBaseRef('origin/main', { git: gitProbe(git) })
    const { changed, removed } = parseNameStatus(git(['diff', '--name-status', '-M', `${base}...HEAD`]))
    // #2708: the contract lives at its generation-keyed path, or at the legacy
    // fixed one. Read whichever this pull request actually carries; the changed
    // file list is what names it, so a pull request never reads another one's.
    const contractPath = [resolveEvidencePair(changed).contract, LEGACY_CONTRACT_PATH].find((path) => path && fileExists(path))
    const contract = contractPath ? JSON.parse(readFile(contractPath)) : null
    const result = evaluateProbe({
      contract,
      changedFiles: changed,
      removedFiles: removed,
      readIssueBody: (n) => gh(['api', `repos/${currentRepository()}/issues/${n}`, '--jq', '.body'],
        { wrapError: (d) => new ProbeCheckError(`GitHub read failed: ${d}`) }),
      // main may have moved past this branch under the --contains freshness rule.
      readProbe: (p) => {
        if (fileExists(p)) return readFile(p)
        try { return git(['show', `${base}:${p}`]) } catch { return null }
      },
      isCodeTruthRestoration: (f) => {
        try { return validateHistoricalRestorationFile(f, readFile(f)).codeTruthOnly === true } catch { return false }
      },
    })
    log(result.relevant ? `Live-proof probe present: ${result.path}.` : `Live-proof probe check not applicable: ${result.reason}.`)
    return 0
  } catch (e) {
    error(`REFUSED: ${e.message}`)
    return 2
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main()
