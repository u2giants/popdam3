#!/usr/bin/env node
//
// DISPATCH-TIME COLLISION CHECK — prevent the collision BEFORE the work is done.
//
// WHY THIS EXISTS, AND WHY THE MERGE-TIME GUARD IS NOT ENOUGH.
//
//   scripts/check-pr-object-collisions.mjs is a MERGE-time guard. It compares
//   open pull requests, so it can only see work that has already been written,
//   committed and pushed. By the time it fires, two agents have each spent a
//   full session producing the same object and one of those sessions is going
//   in the bin. It prevents corruption; it does not prevent waste.
//
//   The 2026-07-31 incident is the case in point: FOUR independent sessions each
//   authored `create or replace function plm.promote_coldlion_source_owned`.
//   At the moment each was DISPATCHED, none of them had a pull request, so
//   there was nothing for a cross-PR guard to compare. Three of those four
//   sessions were wasted no matter which guard caught it later.
//
//   This script closes that window. It answers ONE question, before any work
//   starts: "if I hand out a task that writes these objects, does it collide
//   with anything already in flight?"
//
// WHAT COUNTS AS "IN FLIGHT" — two sources, because either alone has a hole:
//
//   1. CLAIMS — open GitHub issues labelled `db-claim`, each carrying a
//      machine-readable block naming the objects a dispatched agent intends to
//      write. This is the half that covers work with no pull request yet.
//   2. OPEN PULL REQUESTS — migrations already pushed. This covers work whose
//      claim was never filed, including sessions no coordinator dispatched.
//      Nine such pull requests (#442-#450) merged outside coordinator control,
//      so this half is not optional.
//
// WHY A GITHUB ISSUE AND NOT A FILE IN THE REPO.
//
//   A claims FILE would be a single-writer document edited by many concurrent
//   sessions — the exact design that made COORDINATOR_INTAKE.md a merge-conflict
//   magnet. Issues are append-only from the client's point of view, need no
//   clone, no branch and no merge, and survive the death of the session that
//   filed them. Durability matters more than tidiness here: a claim must outlive
//   the context window of the coordinator that made it.
//
// THE HONEST LIMIT — READ THIS BEFORE TRUSTING IT.
//
//   This can only protect work whose write targets are DECLARABLE UP FRONT.
//   "Rewrite the promotion function" is declarable. "Investigate why the sync is
//   slow" is not. The rule that makes the limit safe rather than dangerous:
//   **a task that cannot declare its objects must be dispatched READ-ONLY.**
//   A read-only task cannot collide, so an undeclarable task is never a gap.
//   This script does not enforce that rule; the coordinator does.
//
//   It is therefore a PREVENTION control, layered on top of — never replacing —
//   the merge-time guard, which remains the backstop for everything that was
//   never declared.
//
// DESIGN POSTURE — mirrors check-pr-object-collisions.mjs deliberately.
//
//   A false clear is the dangerous answer, so anything this script cannot
//   determine is reported as UNKNOWN and exits non-zero. It never guesses in
//   the reassuring direction.
//
//   For the same reason THIS SCRIPT PRINTS NO VERDICT. It reports what it
//   compared and, explicitly, which DDL classes it cannot read at all. Exit 0
//   means "completed, no overlap in the classes I can see" — evidence for the
//   coordinator's judgement, never clearance. The earlier "SAFE TO DISPATCH"
//   line was removed for exactly this reason: agents grep for the word and act
//   on it regardless of any caveat printed after it.
//
// NO DATABASE CONTACT: reads GitHub metadata and committed .sql text only.
// It needs no database credentials and must never be given any.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The DISPATCH policy's parser, not the merge guard's (plan step 3b). Same
// file, deliberately broader reading: `describeCoverage`/`extractObjects` model
// whole-object REPLACEMENT for the merge guard, and were the reason this check
// was blind to `alter table`, `create table`, `create index`, `grant`,
// `comment on` and `create type` — a migration doing nothing but an
// `alter table` reported as touching NO OBJECTS, which read as a clear.
import {
  describeDispatchCoverage,
  dispatchObjectKeys,
} from './check-pr-object-collisions.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const CLAIM_LABEL = 'db-claim'
export const MIGRATIONS_DIR = 'supabase/migrations'

/** Thrown when an input cannot be gathered. Never swallowed into a green result. */
export class Unknown extends Error {}

// ---------------------------------------------------------------------------
// Pure logic — no network, no filesystem. Unit-tested in the .test.mjs sibling.
// ---------------------------------------------------------------------------

/**
 * Parse the machine-readable block out of a `db-claim` issue body.
 *
 * Expected form (fenced, so it survives Markdown rendering intact):
 *
 *   ```db-claim
 *   version: 20260806120000
 *   objects:
 *     - function plm.promote_coldlion_source_owned
 *     - table core.licensor
 *   ```
 *
 * `version` is optional; `objects` may be empty (a read-only claim). A body with
 * no block at all returns null, which the caller treats as UNKNOWN rather than
 * as "claims nothing" — an unparseable claim must never read as harmless.
 *
 * @returns {{version: string|null, objects: string[]}|null}
 */
export function parseClaimBlock(body) {
  if (typeof body !== 'string') return null
  const fence = /```db-claim\s*\n([\s\S]*?)```/.exec(body)
  if (!fence) return null

  const lines = fence[1].split(/\r?\n/)
  let version = null
  const objects = []
  let inObjects = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const versionMatch = /^version:\s*(\S+)?$/i.exec(line)
    if (versionMatch) {
      const value = versionMatch[1]
      version = value && value.toLowerCase() !== 'none' ? value : null
      inObjects = false
      continue
    }
    if (/^objects:\s*$/i.test(line)) {
      inObjects = true
      continue
    }
    if (inObjects) {
      const item = /^[-*]\s+(.*\S)\s*$/.exec(line)
      if (item) objects.push(normalizeObject(item[1]))
      else inObjects = false
    }
  }

  return { version, objects: [...new Set(objects)].sort() }
}

/**
 * Canonical form for comparison. `extractObjects` already emits
 * `"<kind> <schema>.<name>"` lowercased; hand-typed declarations should match
 * regardless of spacing or case.
 */
export function normalizeObject(text) {
  return String(text).trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Compare a proposed task against everything in flight.
 *
 * A holder carries `versions` (an ARRAY). A pull request may contain several
 * migrations, and the earlier scalar `version` field exposed only the first of
 * them to comparison — a false clear in its own right (plan step 2b, defect 2).
 *
 * The result field is named `overlapFound`, NOT `safe`, and it STAYS that way
 * now that the parser reads every DDL class in `KNOWN_DDL_CLASSES` (#563).
 * Full class coverage is not omniscience: the parser still cannot see DDL built
 * by dynamic SQL, hidden behind `do $$ … $$` blocks, or written into a file this
 * branch has not committed yet. "No overlap in what I could read" remains
 * evidence, never clearance. A field called `safe` invited callers to keep the
 * old meaning after the printed wording changed.
 *
 * @param {{objects: string[], version?: string|null}} proposed
 * @param {{label: string, objects: string[], versions?: string[], url?: string, draft?: boolean}[]} inFlight
 * @returns {{objectConflicts: object[], versionConflicts: object[], overlapFound: boolean}}
 */
export function findDispatchConflicts(proposed, inFlight) {
  const wanted = new Set((proposed.objects ?? []).map(normalizeObject))
  const objectConflicts = []
  const versionConflicts = []

  for (const holder of inFlight) {
    const overlap = (holder.objects ?? [])
      .map(normalizeObject)
      .filter((object) => wanted.has(object))
    if (overlap.length > 0) {
      objectConflicts.push({
        label: holder.label,
        url: holder.url ?? null,
        objects: [...new Set(overlap)].sort(),
      })
    }
    if (proposed.version) {
      for (const held of holder.versions ?? []) {
        if (held && String(held) === String(proposed.version)) {
          versionConflicts.push({ label: holder.label, url: holder.url ?? null, version: String(held) })
        }
      }
    }
  }

  return {
    objectConflicts,
    versionConflicts,
    overlapFound: objectConflicts.length > 0 || versionConflicts.length > 0,
  }
}

/**
 * The next free migration version, given the versions already on disk and any
 * already handed out to in-flight claims.
 *
 * ⚠️ THIS FUNCTION RESERVES NOTHING, and an earlier version of this comment
 * claimed it "kills the duplicate-timestamp class". It does not. It reads what
 * is taken and returns a candidate; between that read and anyone writing the
 * file, a second agent doing the same read gets the same answer.
 *
 * That read-then-write window is exactly why `--allocate-version` was WITHDRAWN
 * on 2026-08-07: it printed this candidate as a suggestion, so two orchestrators
 * running it in the same minute were handed the same number.
 *
 * It is kept because `reserveVersion` below uses it to pick the CANDIDATE that
 * the atomic create-if-absent then tries to acquire. On its own it is a guess.
 */
export function nextFreeVersion(stamp, taken) {
  const used = new Set(taken.filter(Boolean).map(String))
  let candidate = String(stamp)
  while (used.has(candidate)) candidate = String(BigInt(candidate) + 1n)
  return candidate
}

// ---------------------------------------------------------------------------
// ATOMIC VERSION RESERVATION (#670, plan step 6).
//
// THE GAP THIS CLOSES. Supabase keys its migration ledger on the 14-digit
// version ALONE, not the filename, so two files sharing a version means one is
// NEVER APPLIED while the ledger reports success. It has already happened twice
// (20260722220000 and 20260728160000), and on 2026-08-10 two dispatched agents
// both landed on 20260810130000 — caught only because a human read an open pull
// request's file list.
//
// NOTHING MECHANICAL COVERED THIS AXIS, and it is worth being precise about why
// each existing guard missed it:
//   - Guard A (scripts/check-sql.sh) sees ONE branch's file list at a time.
//     Both branches were green in isolation.
//   - The `Cross-PR object collision` required check compares OBJECT names. The
//     two migrations shared no objects, so it correctly passed.
//   - This script's own version check compares against open claims, open PRs and
//     the files on disk — all READS. Two agents reading in the same minute both
//     get a clear.
//
// WHY A GIT REF AND NOT A FILE, AN ISSUE, OR A LOCK TABLE. `POST /git/refs` is a
// server-side create-if-absent: it returns `422 Reference already exists` if the
// ref is there, and there is no window between the check and the create. It
// needs no database, no new service, and no credentials this tool does not
// already have.
//
// ⚠️ DO NOT REIMPLEMENT THIS WITH `git push`. A push of a DESCENDANT commit
// fast-forwards over an existing ref and silently steals the reservation —
// which is the very failure being fixed, reintroduced in a subtler form. The
// plan (R3) records this explicitly.
//
// ⚠️ RESERVATIONS ARE PERMANENT. There is deliberately NO release step. The
// preview database's ledger holds EVERY version that ever ran `db push`,
// including from abandoned branches, so freeing a number for reuse could
// collide with one preview has already recorded. A kept ref costs one integer
// out of an effectively unbounded space and `refs/db-claims/*` never appears in
// the branch list. Do not add rollback, ownership metadata, or stale-ref
// reconciliation — see plan step 6.
// ---------------------------------------------------------------------------

export const VERSION_REF_PREFIX = 'refs/db-claims'

/** Deterministic ref name for a version. One version, one ref. */
export function versionRef(stamp) {
  const value = String(stamp)
  if (!/^\d{14}$/.test(value)) {
    throw new Unknown(`a migration version must be exactly 14 digits, got ${JSON.stringify(stamp)}`)
  }
  return `${VERSION_REF_PREFIX}/${value}`
}

/** A UTC `YYYYMMDDHHMMSS` stamp — the conventional starting candidate. */
export function utcStamp(now = new Date()) {
  return now.toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

/**
 * Acquire a migration version ATOMICALLY, or report that it could not be done.
 *
 * Walks forward from `stamp` and tries to create `refs/db-claims/<candidate>`.
 * The FIRST candidate the server accepts is genuinely reserved: `POST /git/refs`
 * is create-if-absent, so a second agent racing on the same number receives
 * `422 Reference already exists` and moves on. There is no read-then-write
 * window anywhere in this loop.
 *
 * `io.createRef` MUST return `'created'` or `'exists'` and throw `Unknown` for
 * anything else. An error that cannot be classified must NEVER be treated as
 * `'exists'`: that would silently skip a version that is in fact free, and worse,
 * it would let a network failure masquerade as a successful reservation attempt.
 *
 * @returns {{version: string, ref: string, attempts: number, skipped: string[]}}
 */
export function reserveVersion({ stamp, repo, sha, io, maxAttempts = 60, unavailableVersions = [] }) {
  const skipped = []
  const unavailable = new Set(unavailableVersions.map(String))
  let candidate = String(stamp)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (unavailable.has(candidate)) {
      skipped.push(candidate)
      candidate = String(BigInt(candidate) + 1n)
      continue
    }
    const ref = versionRef(candidate)
    const outcome = io.createRef(repo, ref, sha)
    if (outcome === 'created') return { version: candidate, ref, attempts: attempt, skipped }
    if (outcome !== 'exists') {
      // Fail loudly rather than guessing. A createRef that answers anything
      // else is a bug in the io layer, and the reassuring interpretation
      // ("assume it exists, try the next one") would hand out a number whose
      // status is unknown.
      throw new Unknown(
        `createRef returned ${JSON.stringify(outcome)} for ${ref}; expected 'created' or 'exists'.`,
      )
    }
    skipped.push(candidate)
    candidate = String(BigInt(candidate) + 1n)
  }
  // Bounded, and the exhaustion is an error rather than a fallback to an
  // unreserved number. Handing back an unreserved version here would recreate
  // the exact defect this function exists to remove.
  throw new Unknown(
    `could not reserve a migration version: ${maxAttempts} consecutive candidates from ` +
      `${stamp} are unavailable or reserved. That many occupied candidates is not normal — ` +
      'check migrations, open PRs, claims, and refs/db-claims before raising the limit.',
  )
}

export function formatReport({ proposed, inFlight, result }) {
  const coverage = describeDispatchCoverage()
  const lines = []
  lines.push(`Proposed task: ${proposed.task || '(unnamed)'}`)
  lines.push(`Objects it will write: ${proposed.objects.length ? proposed.objects.join(', ') : '(none — read-only)'}`)
  if (proposed.version) lines.push(`Migration version: ${proposed.version}`)
  if (inFlight.length === 0) {
    lines.push('Checked against 0 in-flight item(s) — NOTHING WAS FOUND TO COMPARE AGAINST.')
    lines.push('That is a statement about the inputs, not a clearance.')
  } else {
    lines.push(`Checked against ${inFlight.length} in-flight item(s).`)
  }
  lines.push('')

  if (!result.overlapFound) {
    const notChecked = [...coverage.notChecked]
    if (!coverage.alterModelled) notChecked.push('and every ALTER form')
    lines.push(
      'No overlap found in the object classes this tool can see.',
      `  CHECKED:     ${coverage.checked.join(', ')}`,
      `  NOT CHECKED: ${notChecked.length ? notChecked.join(', ') : '(no DDL class is unmodelled)'}`,
      '',
      // Still no verdict, and the reason is unchanged even though the class
      // list is now complete: agents grep for a reassuring word and act on it
      // regardless of any caveat printed after it.
      'This is EVIDENCE, not clearance. Full DDL-class coverage is not omniscience:',
      'DDL built by dynamic SQL is invisible; literal DDL inside `do $$ … $$` is read,',
      'and so is any file not yet committed to a branch this tool can read. The',
      'coordinator still confirms before dispatching.',
    )
    return lines.join('\n')
  }

  lines.push('DO NOT DISPATCH — this task collides with work already in flight.')
  for (const conflict of result.objectConflicts) {
    lines.push('', `  Collides with ${conflict.label}${conflict.url ? ` (${conflict.url})` : ''}`)
    for (const object of conflict.objects) lines.push(`    - ${object}`)
  }
  for (const conflict of result.versionConflicts) {
    lines.push(
      '',
      `  Migration version ${conflict.version} is already held by ${conflict.label}` +
        `${conflict.url ? ` (${conflict.url})` : ''}.`,
      '    Two migrations sharing a version means one is SILENTLY SKIPPED (AGENTS.md rule 5).',
    )
  }
  lines.push(
    '',
    'What to do instead: wait for that work to merge, fold this into it, or',
    'narrow this task so it writes different objects. Dispatching anyway means',
    'one of the two sessions is thrown away.',
  )
  return lines.join('\n')
}

/**
 * The exact command that records this dispatch as a claim, so the NEXT dispatch
 * can see it. Printed rather than run: filing a claim creates a GitHub issue,
 * and this script is otherwise read-only.
 */
export function claimCommand(proposed) {
  // Single source of truth with `--claim-body-file`, so the two filing routes can
  // never drift into producing different claim bodies.
  const body = claimBody(proposed)

  // A heredoc, NOT a JSON-escaped string. `--body "…\n…"` would put the two
  // literal characters backslash-n into the issue, and parseClaimBlock would
  // then reject the very claim this command just filed.
  return [
    'File the claim so the next dispatch can see it:',
    '',
    '  ⚠️ THIS RECIPE IS BASH-ONLY AND DOES NOT WORK IN POWERSHELL. Pasting it',
    '     into pwsh mangles the body, and this is a PowerShell-first machine —',
    '     which is part of why zero claims have ever been filed. Run it in Git',
    '     Bash. On PowerShell use the shell-independent route instead: re-run',
    '     this command adding `--claim-body-file claim.md`, which writes the body',
    '     to a file and prints a one-line `gh issue create --body-file` command',
    '     that behaves identically in bash, PowerShell and cmd (#669).',
    '     Plan step 5 removes this recipe entirely: the tool will acquire the',
    '     claim itself as an atomic git ref.',
    '',
    `  gh issue create --label ${CLAIM_LABEL} \\`,
    `    --title ${JSON.stringify(proposed.task || 'db claim')} \\`,
    '    --body "$(cat <<\'CLAIM\'',
    body,
    'CLAIM',
    '    )"',
  ].join('\n')
}

/**
 * Recover the issue body from a `claimCommand` string. Exists so the tests can
 * prove the emitted command round-trips through parseClaimBlock — the bug this
 * guards against (JSON-escaped `\n` reaching the issue verbatim) was real.
 */
export function bodyFromClaimCommand(command) {
  const match = /<<'CLAIM'\n([\s\S]*?)\nCLAIM\n/.exec(command)
  return match ? match[1] : null
}

// ---------------------------------------------------------------------------
// I/O — GitHub and the working tree.
// ---------------------------------------------------------------------------

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch (error) {
    throw new Unknown(`\`gh ${args.join(' ')}\` failed: ${error.shortMessage || error.message}`)
  }
}

function ghJson(args) {
  const paginated = args.includes('--paginate')
  const actualArgs = paginated && !args.includes('--slurp') ? [...args.slice(0, args.indexOf('--paginate') + 1), '--slurp', ...args.slice(args.indexOf('--paginate') + 1)] : args
  const raw = gh(actualArgs)
  try {
    const parsed = JSON.parse(raw)
    if (!paginated) return parsed
    if (!Array.isArray(parsed) || parsed.some((page) => !Array.isArray(page))) throw new Error('paginated response is not an array of pages')
    return parsed.flat()
  } catch {
    throw new Unknown(`\`gh ${actualArgs.join(' ')}\` did not return complete paginated JSON`)
  }
}

/** Open `db-claim` issues, as in-flight sources. */
export function gatherClaims(repo) {
  const issues = ghJson([
    'api',
    '--paginate',
    `repos/${repo}/issues?state=open&labels=${CLAIM_LABEL}&per_page=100`,
  ])
  return issues
    .filter((issue) => !issue.pull_request) // the issues API also returns PRs
    .map((issue) => {
      const parsed = parseClaimBlock(issue.body)
      if (!parsed) {
        throw new Unknown(
          `issue #${issue.number} is labelled \`${CLAIM_LABEL}\` but has no parseable ` +
            '```db-claim block. Fix or unlabel it; an unreadable claim cannot be ignored.',
        )
      }
      return {
        label: `claim #${issue.number} "${issue.title}"`,
        url: issue.html_url,
        objects: parsed.objects,
        versions: parsed.version ? [parsed.version] : [],
      }
    })
}

/**
 * Percent-encode a repository path for a GitHub API URL, one SEGMENT at a time.
 *
 * ⚠️ Do NOT switch this to `encodeURI`. `encodeURI` leaves `#` alone, so a path
 * containing one truncates at the fragment and the file silently reads as
 * empty — a false clear for that pull request's DDL. `encodeURIComponent` per
 * segment encodes `#`, and rejoining with `/` keeps the path structure.
 */
export function encodeRepoPath(filename) {
  return String(filename).split('/').map(encodeURIComponent).join('/')
}

/**
 * Every open pull request that touches migrations.
 *
 * DRAFTS ARE INCLUDED, and that differs from the merge-time guard on purpose.
 * A draft is not competing to merge, so the merge guard rightly skips it — but
 * at DISPATCH time a draft is somebody actively writing that object right now.
 * Excluding it was a false clear. Including it over-blocks, which fails safe.
 */
export function gatherOpenPrObjects(repo, io = defaultIo) {
  const open = io.listPulls(repo)
  const sources = []
  for (const pr of open) {
    const files = io.listPullFiles(repo, pr.number)
    if (!Array.isArray(files)) throw new Unknown(`PR #${pr.number} returned an unreadable file list`)
    if (!Number.isInteger(pr.changed_files) || pr.changed_files < 0) throw new Unknown(`PR #${pr.number} has no trustworthy changed_files count`)
    if (pr.changed_files >= 3000) throw new Unknown(`PR #${pr.number} reaches GitHub's 3000-file limit; refusing incomplete coverage`)
    if (files.length !== pr.changed_files) throw new Unknown(`PR #${pr.number} returned ${files.length} of ${pr.changed_files} changed files`)
    const objects = new Set()
    const versions = new Set()
    for (const file of files) {
      if (!file.filename.startsWith(`${MIGRATIONS_DIR}/`)) continue
      if (!file.filename.endsWith('.sql')) continue
      // A file this pull request DELETES is not work in flight on that object.
      if (file.status === 'removed') continue
      const stamp = path.basename(file.filename).slice(0, 14)
      // Every migration in the pull request, not just the first: a pull request
      // carrying three migrations previously exposed one version to comparison.
      if (/^\d{14}$/.test(stamp)) versions.add(stamp)
      const sql = io.readFileAtRef(repo, file.filename, pr.head.sha)
      if (!String(sql ?? '').trim()) {
        throw new Unknown(
          `${file.filename} at ${pr.head.sha} came back EMPTY. A migration file that ` +
            'exists cannot be empty; refusing to report it as touching no objects.',
        )
      }
      for (const object of dispatchObjectKeys(sql)) objects.add(object)
    }
    if (objects.size === 0 && versions.size === 0) continue
    sources.push({
      label: `PR #${pr.number}${pr.draft ? ' [DRAFT]' : ''} "${pr.title}"`,
      url: pr.html_url,
      draft: Boolean(pr.draft),
      branch: pr.head?.ref ?? null,
      objects: [...objects].sort(),
      versions: [...versions].sort(),
    })
  }
  return sources
}

/**
 * The real GitHub calls, isolated so the gathering LOGIC above can be unit
 * tested. `readFileAtRef` reads RAW text: the JSON Contents API used here
 * before can return a null or truncated `content` for a large file WITHOUT an
 * error, which yields an empty object set and a false clear for that pull
 * request. The raw accept header (what the merge guard already uses) has no
 * such mode.
 */
export const defaultIo = {
  listPulls: (repo) => ghJson(['api', '--paginate', `repos/${repo}/pulls?state=open&per_page=100`]),
  listPullFiles: (repo, number) =>
    ghJson(['api', '--paginate', `repos/${repo}/pulls/${number}/files?per_page=100`]),
  readFileAtRef: (repo, filename, ref) =>
    gh([
      'api',
      '-H',
      'Accept: application/vnd.github.raw',
      `repos/${repo}/contents/${encodeRepoPath(filename)}?ref=${encodeURIComponent(ref)}`,
    ]),

  /** The commit a reservation ref points at. Never a purpose-built commit (plan step 6). */
  baseSha: (repo) => {
    const head = ghJson(['api', `repos/${repo}/commits/HEAD`])
    if (!head?.sha) throw new Unknown(`could not resolve a base commit sha for ${repo}`)
    return head.sha
  },

  /**
   * Server-side CREATE-IF-ABSENT. This one call is the whole atomicity guarantee.
   *
   * Returns 'created' or 'exists'. EVERYTHING ELSE THROWS — a 403, a 404, a rate
   * limit or a dropped connection must never be read as 'exists', because that
   * would skip a version that is actually free and, on the last attempt, would
   * turn a network failure into a confident-looking reservation.
   */
  createRef: (repo, ref, sha) => {
    try {
      execFileSync('gh', ['api', '-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=${ref}`, '-f', `sha=${sha}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return 'created'
    } catch (error) {
      const text = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`
      // GitHub answers a duplicate ref with `422 Reference already exists`.
      // Matched on BOTH the status and the message so a different 422 (an
      // invalid sha, a malformed ref name) is not mistaken for a taken version.
      if (/reference already exists/i.test(text)) return 'exists'
      throw new Unknown(`creating ${ref} failed, and the failure is NOT "already exists": ${text.trim()}`)
    }
  },
}

export function versionsOnDisk(dir = path.join(repoRoot, MIGRATIONS_DIR)) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.slice(0, 14))
      .filter((stamp) => /^\d{14}$/.test(stamp))
  } catch (error) {
    throw new Unknown(`could not read ${dir}: ${error.message}`)
  }
}

/**
 * The versions already written in THIS CHECKOUT, as an in-flight source.
 *
 * ⚠️ #670. `versionsOnDisk()` existed and was EXPORTED but was never called by
 * `main`, so the version check only ever compared against OPEN PULL REQUESTS and
 * OPEN CLAIMS. A version already sitting in `supabase/migrations/` — merged, or
 * written on this branch and not yet pushed — was invisible, and
 * `--version <stamp>` returned a confident clear for it.
 *
 * That is the exact axis of the 2026-08-10 near-miss: two agents both landed on
 * 20260810130000, and it was caught only because a human read a PR file list.
 * Supabase keys its ledger on the 14-digit version ALONE, so two files sharing a
 * version means one is NEVER APPLIED while the ledger reports success — it has
 * already happened twice (20260722220000, 20260728160000).
 *
 * This does NOT make allocation atomic, and must not be described as if it did.
 * Nothing is reserved between this read and anyone writing the file, so two
 * agents checking in the same minute still both get a clear. The atomic
 * reservation is still open work on #670. What this closes is the far more
 * common case: the version is ALREADY TAKEN and nothing said so.
 */
export function localVersionSource(versions = versionsOnDisk()) {
  if (versions.length === 0) return []
  return [
    {
      label: `${MIGRATIONS_DIR}/ in this checkout (${versions.length} migration file(s))`,
      url: null,
      objects: [],
      versions: [...new Set(versions)].sort(),
    },
  ]
}

/**
 * The claim body alone, for `gh issue create --body-file`.
 *
 * ⚠️ #669. `claimCommand` prints a BASH HEREDOC. These are PowerShell-first
 * machines, so dispatchers routinely re-typed the claim by hand and lost the
 * fenced ```db-claim block — which is exactly what happened to claim #666, and a
 * claim without the block makes `gatherClaims` throw UNKNOWN and renders the gate
 * unusable for EVERY subsequent dispatch until someone hand-edits the issue.
 *
 * A file cannot lose the fence to a shell quoting rule. `--claim-body-file <path>`
 * writes this and prints a one-line `gh` command that is identical in bash,
 * PowerShell and cmd.
 */
export function claimBody(proposed) {
  return [
    '```db-claim',
    `version: ${proposed.version || 'none'}`,
    'objects:',
    ...(proposed.objects.length ? proposed.objects.map((o) => `  - ${o}`) : ['  # none — read-only task']),
    '```',
    '',
    'Close this issue when the work merges or is abandoned. An open claim blocks',
    'other agents from being dispatched onto the same objects.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    objects: [],
    task: '',
    version: null,
    sql: null,
    json: false,
    allocate: false,
    reserve: false,
    claimBodyFile: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[(i += 1)]
    if (arg === '--objects') options.objects.push(...String(next()).split(',').map((s) => s.trim()).filter(Boolean))
    else if (arg === '--task') options.task = next()
    else if (arg === '--version') options.version = next()
    else if (arg === '--sql') options.sql = next()
    else if (arg === '--allocate-version') options.allocate = true
    else if (arg === '--reserve-version') options.reserve = true
    else if (arg === '--claim-body-file') options.claimBodyFile = next()
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Unknown(`unknown argument: ${arg}`)
  }
  return options
}

const USAGE = `
Ask BEFORE dispatching: would this task collide with work already in flight?

  node scripts/check-dispatch-collision.mjs --task "rewrite promotion fn" \\
      --objects "function plm.promote_coldlion_source_owned"

  node scripts/check-dispatch-collision.mjs --sql draft.sql

Options:
  --task <text>        Name of the task about to be dispatched (for the report).
  --objects <list>     Comma-separated objects it will WRITE, e.g.
                       "function plm.foo,table core.licensor". Repeatable.
  --sql <path>         Parse a draft migration instead of listing objects.
  --version <stamp>    The 14-digit migration version you intend to use. Checked
                       against open claims, open pull requests AND the migration
                       files already in this checkout (#670).
  --claim-body-file <path>
                       On a clear result, write the fenced db-claim block to <path>
                       and print a "gh issue create --body-file" command. Use
                       this on PowerShell: the heredoc recipe is bash-only, and
                       hand-retyping a claim is how #666 lost its fenced block
                       and jammed the gate for every later dispatch (#669).
  --reserve-version    ACQUIRE a migration version atomically (#670). Creates
                       refs/db-claims/<version> server-side, which is a
                       create-if-absent, so two orchestrators racing in the same
                       minute CANNOT both receive the same number. Starts at
                       --version if given, else the current UTC stamp, and walks
                       forward past any unavailable or already reserved. THIS MUTATES THE
                       REMOTE REPOSITORY, which is why the flag says "reserve"
                       and not "allocate".
  --allocate-version   WITHDRAWN — it reserved nothing. Exits 2. Use
                       --reserve-version. See below.
  --json               Machine-readable output.

Exit 0 = the check completed and found NO OVERLAP IN WHAT IT COULD READ.
         Since #563 the parser reads every DDL class this repo uses, including
         "alter table", "create table", "create index", "grant", "comment on"
         and "create type", which it was previously blind to. It is still not
         clearance: DDL built by dynamic SQL is invisible. Literal DDL inside
         a do-block is read. Any file not yet committed is also invisible.
         The report names exactly what was checked — read it.
Exit 1 = collision. Exit 2 = could not determine.

A task that cannot declare its objects must be dispatched READ-ONLY.
`.trim()

/**
 * The `--reserve-version` path. Kept out of `main` because it is the only route
 * in this script that MUTATES anything; everything else is read-only.
 */
function runReserveVersion(options, io = defaultIo) {
  const repo = process.env.GITHUB_REPOSITORY || 'u2giants/shared-db'
  let reservation
  try {
    const start = options.version ? String(options.version) : utcStamp()
    // Validate before touching the network so a typo fails instantly and
    // cannot create a junk ref.
    versionRef(start)
    const sources = [...gatherClaims(repo), ...gatherOpenPrObjects(repo), ...localVersionSource()]
    const unavailableVersions = sources.flatMap((source) => source.versions ?? [])
    reservation = reserveVersion({
      stamp: start,
      repo,
      sha: io.baseSha(repo),
      io,
      unavailableVersions,
    })
  } catch (error) {
    if (!(error instanceof Unknown)) throw error
    console.error(`UNKNOWN: ${error.message}`)
    console.error('')
    console.error('NOTHING WAS RESERVED. Do not pick a version by hand as a workaround —')
    console.error('that is the read-then-write allocation this flag exists to replace.')
    return 2
  }

  if (options.json) {
    console.log(JSON.stringify(reservation, null, 2))
    return 0
  }

  console.log(`RESERVED migration version ${reservation.version}`)
  console.log(`  ref:      ${reservation.ref}`)
  console.log(`  attempts: ${reservation.attempts}`)
  if (reservation.skipped.length) {
    console.log(`  unavailable on disk/PR/claim, or already reserved: ${reservation.skipped.join(', ')}`)
  }
  console.log('')
  console.log('This number is now YOURS. No other agent can be handed it, including one')
  console.log('running this command in the same second — the ref is created server-side')
  console.log('with a create-if-absent, so there is no read-then-write window.')
  console.log('')
  console.log('The reservation is PERMANENT and is never released. Preview\'s ledger holds')
  console.log('every version that ever ran db push, including from abandoned branches, so')
  console.log('freeing a number for reuse could collide with one preview already recorded.')
  console.log('')
  console.log('⚠️ THE VERSION IS RESERVED BUT YOUR OBJECT WORK IS STILL INVISIBLE to other')
  console.log('   agents. That is the one genuinely dangerous state. Before dispatching,')
  console.log('   file the claim so the next dispatch can see what you intend to write:')
  console.log('')
  console.log(`     node scripts/check-dispatch-collision.mjs --task "…" \\`)
  console.log(`       --objects "…" --version ${reservation.version} --claim-body-file claim.md`)
  console.log('')
  console.log('   Name the file supabase/migrations/' + reservation.version + '_<slug>.sql.')
  return 0
}

function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(String(error.message))
    console.error(USAGE)
    return 2
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }

  // WITHDRAWN, deliberately BEFORE any network call so the failure is instant
  // and unmistakable. The flag read the versions in use and PRINTED a
  // suggestion; nothing was reserved between that read and anyone writing the
  // file, so two coordinators dispatching in the same minute were handed the
  // same number — the exact class its own comment claimed to have killed.
  if (options.allocate) {
    console.error('--allocate-version is WITHDRAWN. It never reserved anything.')
    console.error('')
    console.error('It read the versions already in use and printed a suggestion. Two')
    console.error('coordinators running it in the same minute both received the same')
    console.error('number, which is the duplicate-timestamp incident it claimed to prevent')
    console.error('(2026-07-22 and 2026-07-28; AGENTS.md rule 5).')
    console.error('')
    console.error('Use --reserve-version instead (#670). It creates refs/db-claims/<version>')
    console.error('server-side, which is a create-if-absent, so the number it returns is')
    console.error('genuinely yours. Duplicates are still caught at merge by')
    console.error('scripts/check-sql.sh, but that is a backstop, not the allocator.')
    return 2
  }

  if (options.reserve) return runReserveVersion(options)

  const repo = process.env.GITHUB_REPOSITORY || 'u2giants/shared-db'

  let objects = options.objects.map(normalizeObject)
  if (options.sql) {
    try {
      objects = [...new Set([...objects, ...dispatchObjectKeys(readFileSync(options.sql, 'utf8'))])]
    } catch (error) {
      console.error(`UNKNOWN: could not read --sql ${options.sql}: ${error.message}`)
      return 2
    }
  }

  let inFlight
  try {
    // #670: the migrations already on disk are a version source too. Without
    // them, `--version` compared only against open claims and open PRs, so a
    // stamp already merged into main — or already written on this very branch —
    // came back clear.
    inFlight = [...gatherClaims(repo), ...gatherOpenPrObjects(repo), ...localVersionSource()]
  } catch (error) {
    if (!(error instanceof Unknown)) throw error
    console.error(`UNKNOWN: ${error.message}`)
    console.error('')
    console.error('Refusing to report "safe to dispatch" on inputs that could not be')
    console.error('gathered. Fix the above, or dispatch the task READ-ONLY.')
    return 2
  }

  const proposed = { task: options.task, objects: [...new Set(objects)].sort(), version: options.version }
  const result = findDispatchConflicts(proposed, inFlight)

  if (options.json) {
    console.log(JSON.stringify({ proposed, inFlight, ...result }, null, 2))
  } else {
    console.log(formatReport({ proposed, inFlight, result }))
    if (!result.overlapFound) console.log('\n' + claimCommand(proposed))
  }

  // Written only on a CLEAR result: a body file for a dispatch that must not
  // happen would be an invitation to file the claim anyway.
  if (options.claimBodyFile && !result.overlapFound) {
    try {
      writeFileSync(options.claimBodyFile, `${claimBody(proposed)}\n`, 'utf8')
    } catch (error) {
      // Loud, and fail-closed: silently not writing the file sends the dispatcher
      // straight back to hand-retyping the block, which is the #669 defect.
      console.error(`UNKNOWN: could not write --claim-body-file ${options.claimBodyFile}: ${error.message}`)
      return 2
    }
    console.log('')
    console.log(`Claim body written to ${options.claimBodyFile}. File it with (any shell):`)
    console.log('')
    console.log(
      `  gh issue create --label ${CLAIM_LABEL} ` +
        `--title ${JSON.stringify(proposed.task || 'db claim')} ` +
        `--body-file ${options.claimBodyFile}`,
    )
  }

  return result.overlapFound ? 1 : 0
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exit(main(process.argv.slice(2)))
