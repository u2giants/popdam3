// One shared GitHub transport for every governed gate (issue #2342).
//
// WHY THIS EXISTS
// ---------------
// Three consecutive production-apply runs (33920952504, 33921168245,
// 33921406952) each refused promotion while naming a DIFFERENT file that
// demonstrably existed. Three different names for the same corrupt state is not
// what a real fault looks like; it is what a spurious per-file read looks like.
// The gate was making up to 112 sequential Contents calls per run and any single
// one of them could stop production.
//
// At that point EIGHT hand-rolled `gh` wrappers existed across scripts/, and
// exactly two of them retried anything. This module is the one wrapper. The
// conformance test (scripts/check-github-transport-conformance.mjs) fails the
// build if a ninth appears.
//
// WHY BATCHING IS THE PRIMARY FIX AND RETRY IS ONLY THE BACKSTOP
// --------------------------------------------------------------
// AGENTS.md records a prior lesson pointing the other way: a retry wrapper that
// turned a fast failure into a slower, identically-named failure. Retrying a
// read you should not have been making 112 times is exactly that mistake with a
// longer wall clock. The exposure is removed by asking GitHub ONCE per ref (a
// recursive tree read) instead of once per file; the retry here only covers the
// genuinely irreducible single call.
//
// WHY 404 IS NOT A TRANSIENT MARKER, EVEN THOUGH THE OBSERVED FAILURES WERE 404s
// ------------------------------------------------------------------------------
// This is the one place it is tempting to widen the classifier, and it must not
// be widened. Across this repository 404 is an ANSWER, not a fault: "does this
// ref exist yet?" is asked with a read whose negative reply is HTTP 404, and
// several gates depend on believing that reply. A classifier that retries 404
// would make every one of those reads spend its full attempt budget on a
// correct answer, and -- far worse -- a gate that concludes "absent" only after
// retrying is a gate whose absence proof now depends on a timeout. That is a
// fail-open shape, and a gate that fails open is worse than one that fails
// closed.
//
// The observed spurious 404s were removed at the source instead: the promotion
// gate no longer makes per-file Contents calls at all, so the read that was
// lying is no longer made. Fixing the caller beats teaching the classifier to
// distrust a true answer.
//
// WHY MUTATIONS ARE NEVER RETRIED
// -------------------------------
// A retried read costs a duplicate read. A retried POST can create a ref twice,
// post a second comment, or double-advance a lease. `gh` reports a transport
// failure identically whether the request never landed or landed and the
// RESPONSE was lost, so a retry here cannot tell "did nothing" from "already
// did it". Mutating calls therefore get exactly one attempt unless a caller
// proves idempotency by passing `idempotentWrite: true`.

import { execFileSync } from 'node:child_process'

export class GitHubTransportError extends Error {}

// Deliberately identical to the classifier this repository already proved in
// manage-migration-author-lanes.mjs. Widening it is a governed decision, not a
// convenience: see the 404 note above.
export const TRANSIENT_TRANSPORT =
  /HTTP 5\d\d|connection (?:reset|timed out)|TLS handshake timeout|No server is currently available/i

export function isTransientGitHubTransport(error) {
  return TRANSIENT_TRANSPORT.test(String(error?.stderr ?? error?.message ?? error ?? ''))
}

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
const MUTATING_SUBCOMMANDS = new Set([
  'merge', 'close', 'edit', 'comment', 'create', 'review', 'cancel', 'rerun', 'delete', 'reopen',
  'set', 'update', 'upload', 'enable', 'disable', 'add', 'remove', 'fork', 'logout', 'refresh',
])

export function isMutatingCall(args) {
  const list = (args ?? []).map((a) => String(a))
  for (let i = 0; i < list.length; i += 1) {
    if ((list[i] === '-X' || list[i] === '--method') &&
        MUTATING_METHODS.has(String(list[i + 1] ?? '').toUpperCase())) return true
    const inline = list[i].match(/^(?:-X|--method=)(.+)$/)
    if (inline && MUTATING_METHODS.has(inline[1].toUpperCase())) return true
  }
  // `gh api -f k=v` / `-F k=v` / `--input` imply POST even with no explicit -X.
  if (list[0] === 'api' &&
      list.some((a) => a === '-f' || a === '-F' || a === '--input' || a === '--field' ||
                       a === '--raw-field')) return true
  // Non-`api` mutating subcommands.
  if (MUTATING_SUBCOMMANDS.has(list[1])) return true
  return false
}

/**
 * Run one `gh` invocation, retrying ONLY transient transport failures.
 *
 * Every option exists so a caller can adopt this module without changing the
 * refusal its own gate emits -- the eight wrappers this replaces each threw a
 * different named error, and those names are what operators read.
 *
 * @param {string[]} args            argv for `gh`
 * @param {object}   [opts]
 * @param {(detail: string, cause: Error) => Error} [opts.wrapError]
 *        Build the caller's own error type. Defaults to GitHubTransportError.
 * @param {number}   [opts.attempts] Max attempts for a retryable call (default 4).
 * @param {boolean}  [opts.idempotentWrite] Allow retries on a mutating call.
 * @param {RegExp}   [opts.expectedFailure] A failure that is an ANSWER, not a
 *        fault (e.g. HTTP 404 for "does this ref exist?"). Never re-printed to
 *        stderr, never retried, still thrown.
 */
export function runGitHubCommand(args, {
  executor = execFileSync,
  wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  attempts = 4,
  idempotentWrite = false,
  expectedFailure = null,
  wrapError = null,
  reportStderr = (text) => process.stderr.write(text),
  maxBuffer = 64 * 1024 * 1024,
  input,
  encoding = 'utf8',
} = {}) {
  const mutating = isMutatingCall(args) || input !== undefined
  const allowed = mutating && !idempotentWrite ? 1 : Math.max(1, attempts)
  // A request BODY only reaches the child through a piped stdin. An earlier
  // hand-rolled wrapper set stdio:['ignore',...] alongside `input`, so gh sent
  // an EMPTY body and GitHub answered `422 ... nil is not an object` — while
  // every unit test passed, because the fake transport read `options.input`
  // directly and never exercised the real stdin path. Naming 'ignore' here
  // would silently discard the body, so it is omitted when input is present.
  const spawnOptions = input === undefined
    ? { encoding, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] }
    : { encoding, maxBuffer, input }
  let attempt = 0
  for (;;) {
    try {
      return executor('gh', args, spawnOptions)
    } catch (error) {
      const transient = isTransientGitHubTransport(error)
      if (!transient || attempt >= allowed - 1) {
        const captured = String(error?.stderr ?? '').trim()
        const detail = captured || String(error?.message ?? '').trim()
        const wrapped = wrapError
          ? wrapError(detail, error)
          : new GitHubTransportError(`GitHub command failed: ${detail}`)
        wrapped.transientTransport = transient
        wrapped.stderr = captured
        // Quieter for the expected answers, LOUDER for real faults.
        if (captured && !(expectedFailure && expectedFailure.test(detail))) {
          reportStderr(`gh ${args.join(' ')}\n${captured}\n`)
        }
        throw wrapped
      }
      wait(2 ** attempt * 1000)
      attempt += 1
    }
  }
}

/**
 * The spawnSync-shaped front door onto the SAME policy.
 *
 * Some callers must inspect `.status` and `.stdout` rather than catch — the
 * governed-review runner posts findings, then voids its own comment if the
 * verdict fails to record, and every branch there turns on the exit status of
 * the previous call. Rewriting that control flow into try/catch to satisfy a
 * lint rule would be changing delicate, proven code for the linter's benefit.
 *
 * So the shape differs and the POLICY does not: this is still the one place
 * that decides what may be replayed. Every call it accepts carries a request
 * body or an explicit method, i.e. it is a mutation, and a mutation is issued
 * exactly once unless the caller proves idempotency. Nothing here retries.
 */
export function spawnGitHub(args, { executor, input, maxBuffer = 64 * 1024 * 1024, idempotentWrite = false } = {}) {
  if (typeof executor !== 'function') {
    throw new GitHubTransportError('spawnGitHub requires an executor with spawnSync semantics')
  }
  if (!isMutatingCall(args) && input === undefined) {
    throw new GitHubTransportError(
      `spawnGitHub is for mutations; use runGitHubCommand for reads so they retry: gh ${args.join(' ')}`,
    )
  }
  if (idempotentWrite) {
    throw new GitHubTransportError('spawnGitHub never replays a write; use runGitHubCommand for a retryable call')
  }
  const options = { encoding: 'utf8', maxBuffer, stdio: ['pipe', 'pipe', 'pipe'] }
  if (input !== undefined) options.input = input
  return executor('gh', args, options)
}

/** runGitHubCommand plus a JSON parse that refuses malformed bodies by name. */
export function ghJson(args, opts = {}) {
  const raw = runGitHubCommand(args, opts)
  try {
    return JSON.parse(raw)
  } catch (cause) {
    const detail = `GitHub returned invalid JSON for: gh ${args.join(' ')}`
    throw opts.wrapError ? opts.wrapError(detail, cause) : new GitHubTransportError(detail)
  }
}
