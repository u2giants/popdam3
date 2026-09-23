// One place that answers "what revision is this base ref?" for every guard that
// names a base branch rather than a SHA.
//
// ISSUE #3280 GOVERNED REVIEW (grok-4.6, then muse-spark-1.3-contributor).
// On a `merge_group` run the checkout action is handed the queue group commit
// SHA, so no `origin/<branch>` remote-tracking ref is created even at
// `fetch-depth: 0` -- the ancestor objects are present, the ref is not. A guard
// that resolves a base ref BY NAME therefore hard-fails on every queue run,
// while the same guard passes on `pull_request`.
//
// The first round of this fix patched each workflow to `git fetch` before the
// guard ran. That works, but it is invisible to the guard: one refactor of a
// workflow step turns every queue run red, and each new consumer has to
// remember the same dance. So resolution lives HERE, next to the consumers, and
// the workflow-level fetches remain as belt-and-braces on top.
//
// FAIL-CLOSED IS THE POINT. This helper never returns a guess and never lets a
// caller "skip because the base was missing": when the ref cannot be resolved
// and cannot be fetched, it throws. A caller that wants a softer degradation
// must choose it explicitly, in its own code, where a reviewer can see it.

/** A base that is already a SHA or other direct revision needs no branch fetch. */
function branchOf(ref) {
  const value = String(ref ?? '')
  return value.startsWith('origin/') ? value.slice('origin/'.length) : null
}

/**
 * Resolve `ref` to a revision usable in `git diff`/`git show`.
 * Returns `ref` itself when it already resolves, otherwise fetches the branch
 * it names and returns `'FETCH_HEAD'`. Throws when neither works.
 *
 * `git` runs a git command and returns true on success, false on failure.
 */
export function resolveBaseRef(ref, { git }) {
  const value = String(ref ?? '')
  if (!value) throw new Error('resolveBaseRef requires a base ref')
  if (git(['rev-parse', '--verify', '--quiet', value])) return value
  const branch = branchOf(value)
  if (branch && git(['fetch', '--no-tags', 'origin', branch]) && git(['rev-parse', '--verify', '--quiet', 'FETCH_HEAD'])) {
    return 'FETCH_HEAD'
  }
  throw new Error(`could not resolve base ref ${value}: it is not present and could not be fetched`)
}

/** `git` runner built on a command executor that throws on failure. */
export function gitProbe(run) {
  return (args) => { try { run(args); return true } catch { return false } }
}
