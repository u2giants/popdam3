#!/usr/bin/env node
// Prove that the main tip a governed run was dispatched against is still the
// main tip that matters.
//
// WHY THIS EXISTS (issues #2047 and #2030, owner-authorized 2026-09-01)
// ---------------------------------------------------------------------
// Twelve places across seven workflows asserted the tip with a bare
//
//     test "$(git rev-parse origin/main)" = "$MAIN_SHA"
//
// which is exact-equality against a branch that other sessions land on
// continuously. A promotion, a rehearsal, or a piece of review evidence was
// therefore voided by ANY commit reaching main between dispatch and run --
// including a handover document, which cannot change what a single line of SQL
// does. That is a real cost: during orchestrator marker #2026 the promotion had
// to be re-dispatched for exactly this reason, and #2030 records the same defect
// against the historical-recovery lane.
//
// This narrows the assertion and narrows NOTHING else. The tip is accepted when:
//
//   (a) origin/main is exactly MAIN_SHA -- the pre-existing behaviour, unchanged;
//       or
//   (b) origin/main is strictly AHEAD of MAIN_SHA, MAIN_SHA is a real ancestor
//       of it, and EVERY file touched by EVERY commit in between is on the
//       documentation allowlist below.
//
// Everything else is refused exactly as before.
//
// THE ALLOWLIST IS BY EXTENSION, NOT BY DIRECTORY -- READ THIS BEFORE WIDENING IT
// -------------------------------------------------------------------------------
// The obvious implementation is "anything under `docs/` is documentation". It is
// WRONG here and would have punched a hole straight through the promotion
// evidence chain: the REVIEWED DETECTOR BASELINE that
// `check-production-verification-sidecars.mjs` pins the catalog detector
// against is a JSON file that lives under the documentation directory. A directory rule would have let that file --
// the very thing designed to make the detector un-editable without a deliberate
// re-review -- change silently underneath a promotion that had already been
// approved. It is a data file that lives in a documentation folder, and that is
// precisely the case a directory rule cannot see.
//
// So the rule is: a path is documentation only if it ENDS in one of the
// extensions below. A `.json`, `.sql`, `.mjs`, `.py`, or `.yml` is never
// documentation no matter where it sits.
//
// FAIL-CLOSED IS THE WHOLE POINT
// ------------------------------
// Every uncertainty refuses. An unreadable range, a MAIN_SHA that is not an
// ancestor (main was force-pushed, or the run names a commit from a different
// line of history), a rename whose OTHER side is code, an empty commit list that
// contradicts a non-equal tip -- all refuse. A gate that guesses in the
// permissive direction is worse than the bare `test` it replaces.

import { execFileSync } from 'node:child_process'
import { diffDigest } from './lib/pr-content-equivalence.mjs'

// Prose only. Deliberately short, deliberately not directory-based -- see above.
// `.txt` was here and was REMOVED after external review (GLM, 2026-09-01):
// the contract-test QUARANTINE FILE is a plain-text file that CONTROLS WHICH
// CONTRACT TESTS MAY FAIL THE JOB (see QUARANTINE_FILE in the contract-test
// workflow).
// Treating it as prose would have let a quarantine edit land on main during a
// merge window without forcing the branch update and contract-test re-run the
// old exact gate forced. The extension rule does not save you if the extension
// itself is not inert -- so the list is Markdown only.
const DOCUMENTATION_SUFFIXES = ['.md', '.markdown']

// `.github/` is never documentation even when it is Markdown: an issue or pull
// request TEMPLATE is inert, but this directory also carries workflows, actions
// and CODEOWNERS, and a rule that reasons about "the Markdown ones" inside it is
// one refactor away from admitting a workflow edit. Refuse the whole directory
// and keep the reasoning trivial.
const NEVER_DOCUMENTATION_PREFIXES = ['.github/']

export function isDocumentationPath(path) {
  if (typeof path !== 'string' || path.length === 0) return false
  // A path git could not report cleanly is not something to reason about.
  if (path.includes('\n') || path.includes('\0')) return false
  const lower = path.toLowerCase()
  if (NEVER_DOCUMENTATION_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return false
  }
  return DOCUMENTATION_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

function git(args, { cwd } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * Classify a main tip against the SHA a run was dispatched for.
 *
 * Returns `{ ok, reason, movedBy }`. `ok: false` always carries a reason that
 * names what was refused; callers print it verbatim.
 */
export function classifyMainTip({ mainSha, tipSha, cwd, gitRunner = git }) {
  if (!/^[0-9a-f]{40}$/.test(mainSha ?? '')) {
    return { ok: false, reason: 'REFUSED: MAIN_SHA is not a full 40-character commit SHA.' }
  }
  if (!/^[0-9a-f]{40}$/.test(tipSha ?? '')) {
    return { ok: false, reason: 'REFUSED: the live origin/main tip could not be resolved.' }
  }

  if (mainSha === tipSha) {
    return { ok: true, reason: 'origin/main is exactly the dispatched commit.', movedBy: [] }
  }

  // The tip moved. It is only acceptable if it moved FORWARD from this commit.
  // `merge-base --is-ancestor` is the only question worth asking: a tip that
  // does not contain MAIN_SHA is a different line of history, not a newer one.
  let isAncestor
  try {
    gitRunner(['merge-base', '--is-ancestor', mainSha, tipSha], { cwd })
    isAncestor = true
  } catch (error) {
    // git exits 1 for "not an ancestor" and >1 for a real failure. Both refuse,
    // but they refuse with different reasons, because "main was rewritten" and
    // "git is broken" are not the same incident.
    if (error?.status === 1) {
      isAncestor = false
    } else {
      return {
        ok: false,
        reason:
          'REFUSED: could not determine whether the dispatched commit is an ancestor of ' +
          'origin/main, so the tip cannot be proven to have only moved forward.',
      }
    }
  }

  if (!isAncestor) {
    return {
      ok: false,
      reason:
        `REFUSED: origin/main (${tipSha}) does not contain the dispatched commit ` +
        `(${mainSha}). The tip did not simply advance -- this is a different line of ` +
        'history, and no documentation allowance applies to it.',
    }
  }

  let raw
  try {
    // ISSUE #2465 -- CLASSIFY WHAT MAIN MOVED BY, AND NOTHING ELSE.
    //
    // This was `git log --name-only -m <mainSha>..<tipSha>`, and `-m` was the
    // defect. For a merge commit M with parents P1 (main) and P2 (the merged
    // branch), `-m` emits a diff against EACH parent: M-vs-P1 is the branch's
    // own change, but M-vs-P2 is everything main had gained since that branch
    // forked. Main advancing by two Markdown files therefore reported the
    // unrelated code files of whatever pull request was merged, so the
    // documentation exemption could never fire and every open pull request was
    // forced into a new head and a fresh pair of reviewer slots.
    //
    // A two-point `git diff <mainSha> <tipSha>` is the movement the refusal
    // message already describes: the net difference between the dispatched
    // commit and the live tip. It also answers the concern `-m` was reaching
    // for -- a plain `git log --name-only` shows NOTHING for a merge commit, so
    // code could hide behind it, while a two-point diff cannot hide a file
    // whose content differs between the two ends.
    //
    // --name-only, NUL-separated so a path containing a space or a quote cannot
    // be mis-split.
    //
    // --no-renames is LOAD-BEARING (added after external review, GLM 2026-09-01).
    // `diff.renames` defaults to true, and with rename detection on, --name-only
    // reports ONLY THE DESTINATION of a rename. `git mv scripts/foo.mjs
    // docs/foo.md` would therefore have reported one Markdown path and PASSED,
    // while deleting a code file. With --no-renames both sides are reported and
    // the `.mjs` side blocks. Do not remove this flag.
    raw = gitRunner(['diff', '--name-only', '--no-renames', '-z', mainSha, tipSha], {
      cwd,
    })
  } catch {
    return {
      ok: false,
      reason:
        'REFUSED: the commits between the dispatched commit and origin/main could not be ' +
        'read, so they cannot be proven to be documentation.',
    }
  }

  const paths = [...new Set(raw.split('\0').filter((entry) => entry.length > 0))]

  if (paths.length === 0) {
    // Non-equal SHAs with no changed file at all: an empty commit, or a range
    // git declined to describe. Neither is a case worth a permissive answer.
    return {
      ok: false,
      reason:
        'REFUSED: origin/main has advanced past the dispatched commit but reports no changed ' +
        'file, which cannot be proven to be a documentation-only move.',
    }
  }

  const blocking = paths.filter((path) => !isDocumentationPath(path)).sort()
  if (blocking.length > 0) {
    const shown = blocking.slice(0, 10)
    const suffix = blocking.length > shown.length ? `, and ${blocking.length - shown.length} more` : ''
    return {
      ok: false,
      reason:
        `REFUSED: origin/main (${tipSha}) has moved past the dispatched commit ` +
        `(${mainSha}) with changes that are not documentation: ` +
        `${shown.join(', ')}${suffix}. Re-dispatch against the current tip.`,
      movedBy: paths,
    }
  }

  return {
    ok: true,
    reason:
      `origin/main has advanced to ${tipSha}, but every change since ${mainSha} is ` +
      `documentation (${paths.length} file${paths.length === 1 ? '' : 's'}), so the dispatched ` +
      'commit is still current for the purposes of this gate.',
    movedBy: paths,
  }
}

const MIGRATION_PATH = /^supabase\/migrations\/(\d{14})_[^/]+\.sql$/
const REGENERATED_EVIDENCE_PREFIX = '.agent/'

function nulPaths(raw) {
  return [...new Set(String(raw).split('\0').filter((entry) => entry.length > 0))]
}

/**
 * The `--contains` question: may this pull request head merge although main has
 * moved past its merge base with changes that are not documentation?
 *
 * MAIN MOVING IS NOT A REFUSAL BY ITSELF (orchestrator marker #2758, 2026-09-11).
 * A guarded merge round takes ~25 minutes and main moves faster, so PR #2761 lost
 * the race twice while nothing it touched had changed. Main may have moved when
 * ALL of these hold, each proven from git:
 *   - no file the pull request changed was also changed on main since the merge
 *     base (`.agent/` evidence aside -- every pull request regenerates it);
 *   - no migration version the pull request adds or edits exists on the main tip
 *     under a different file name;
 *   - git can merge the main tip and the head with no conflict at all, `.agent/`
 *     included (`git merge-tree`, exactly what the merge button will produce); and
 *   - the pull request's own diff is unchanged by that merge: the diff from the
 *     main tip to the merged tree is identical to the diff from the merge base to
 *     the head (`.agent/` evidence aside).
 * Every other case, and every git error, refuses exactly as before.
 */
export function classifyBranchFreshness({ headSha, tipSha, cwd, gitRunner = git }) {
  if (!/^[0-9a-f]{40}$/.test(headSha ?? '')) return { ok: false, reason: 'REFUSED: the pull request head is not a full 40-character commit SHA.' }
  if (!/^[0-9a-f]{40}$/.test(tipSha ?? '')) return { ok: false, reason: 'REFUSED: the live origin/main tip could not be resolved.' }
  let base
  try { base = String(gitRunner(['merge-base', headSha, tipSha], { cwd })).trim() } catch { base = '' }
  if (!/^[0-9a-f]{40}$/.test(base)) return { ok: false, reason: 'REFUSED: could not compute the merge base of HEAD and origin/main.' }
  const documentation = classifyMainTip({ mainSha: base, tipSha, cwd, gitRunner })
  if (documentation.ok || !Array.isArray(documentation.movedBy)) return documentation
  const refuse = (detail) => ({ ok: false, reason: `${documentation.reason} It cannot merge without an update from main: ${detail}`, movedBy: documentation.movedBy })
  let prPaths, tipMigrations, mergedTree
  try {
    prPaths = nulPaths(gitRunner(['diff', '--name-only', '--no-renames', '-z', base, headSha], { cwd }))
    tipMigrations = nulPaths(gitRunner(['ls-tree', '-r', '-z', '--name-only', tipSha, '--', 'supabase/migrations'], { cwd }))
  } catch { return refuse('the pull request change or the main migration list could not be read.') }
  const mainPaths = new Set(documentation.movedBy)
  const overlap = prPaths.filter((path) => mainPaths.has(path) && !path.startsWith(REGENERATED_EVIDENCE_PREFIX)).sort()
  if (overlap.length) return refuse(`main also changed ${overlap.slice(0, 10).join(', ')}${overlap.length > 10 ? `, and ${overlap.length - 10} more` : ''}.`)
  const collisions = []
  for (const path of prPaths) {
    const version = MIGRATION_PATH.exec(path)?.[1]
    if (!version) continue
    for (const other of tipMigrations) if (other !== path && MIGRATION_PATH.exec(other)?.[1] === version) collisions.push(`${path} and ${other}`)
  }
  if (collisions.length) return refuse(`migration version collision on main: ${collisions.join('; ')}.`)
  try {
    mergedTree = String(gitRunner(['merge-tree', '--write-tree', '--no-messages', tipSha, headSha], { cwd })).trim().split('\n')[0]
  } catch (error) {
    return refuse(error?.status === 1 ? 'merging origin/main into the head conflicts.' : 'git could not trial-merge origin/main into the head.')
  }
  if (!/^[0-9a-f]{40}$/.test(mergedTree)) return refuse('git could not trial-merge origin/main into the head.')
  let before, after
  try {
    before = diffDigest(base, headSha, { gitRunner: (args) => gitRunner(args, { cwd }) })
    after = diffDigest(tipSha, mergedTree, { gitRunner: (args) => gitRunner(args, { cwd }) })
  } catch { return refuse('the pull request diff could not be compared across the trial merge.') }
  if (before !== after) return refuse("the trial merge changes the pull request's own diff.")
  return {
    ok: true,
    reason: `origin/main has advanced to ${tipSha} with non-documentation changes, but none touches a file or migration version this pull request changes, the head merges into it cleanly, and the pull request's own diff is unchanged by that merge.`,
    movedBy: documentation.movedBy,
    independent: true,
  }
}

function resolveTip() {
  // `origin/main` is what every one of the twelve replaced sites resolved, so
  // resolve exactly that and nothing cleverer. A fallback chain here would be a
  // way for this gate to answer from a ref the old `test` never consulted.
  return git(['rev-parse', 'origin/main']).trim()
}

function main() {
  const contains = process.argv.includes('--contains')

  let tipSha
  try {
    tipSha = resolveTip()
  } catch {
    console.error('REFUSED: could not resolve origin/main. Fetch origin/main first.')
    process.exit(1)
  }

  let mainSha
  if (contains) {
    // "May this branch merge into the current main?" -- the question
    // guarded-migration-merge asks. See `classifyBranchFreshness`.
    let headSha
    try { headSha = git(['rev-parse', 'HEAD']).trim() } catch {
      console.error('REFUSED: could not resolve HEAD.')
      process.exit(1)
    }
    const verdict = classifyBranchFreshness({ headSha, tipSha })
    if (!verdict.ok) {
      console.error(verdict.reason)
      console.error('This branch must be updated from origin/main before it can merge.')
      process.exit(1)
    }
    console.log(`OK -- ${verdict.reason}`)
    for (const path of verdict.movedBy ?? []) console.log(`  ${verdict.independent ? 'moved on main' : 'documentation'}: ${path}`)
    return
  } else {
    mainSha = (process.env.MAIN_SHA ?? '').trim()
    if (!mainSha) {
      console.error('REFUSED: MAIN_SHA is unset; this gate never defaults to the live tip.')
      process.exit(1)
    }
  }

  const verdict = classifyMainTip({ mainSha, tipSha })
  if (!verdict.ok) {
    console.error(verdict.reason)
    if (contains) {
      console.error(
        'This branch must be updated from origin/main before it can merge.',
      )
    }
    process.exit(1)
  }
  console.log(`OK -- ${verdict.reason}`)
  if (verdict.movedBy?.length) {
    for (const path of verdict.movedBy) console.log(`  documentation: ${path}`)
  }
}

if (process.argv[1]?.endsWith('check-main-tip-freshness.mjs')) {
  main()
}
