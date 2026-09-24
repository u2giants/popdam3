# AGENTS.md — §5, §5.0-D, §5.0-E, §5.1, §5.2, §5.2-A, §5.2-B (merge protocol)

> Moved verbatim from `AGENTS.md` by issue #3481 so that file stays a short router. Section numbers and headings are unchanged; a citation of "AGENTS.md §X" resolves here. Relative link targets were re-pointed from this folder; no rule text changed.

## 5. The `shared-db` merge protocol (the checklist the AI runs)

Merge a `shared-db` PR **only when every item is true**:

1. `scripts/check-sql.sh` passes.
2. `supabase db push --dry-run` against the preview branch is clean (only the
   intended changes, no surprise drops/renames).
3. The migration is applied to the **preview** branch and works there.
4. Every app that depends on the change has been tested against preview and the
   owner has confirmed the behavior is correct.
5. The change is additive, or any removal was explicitly approved.

Then: merge to `main` (this auto-syncs the `shared-db/` folder into all apps) and
run the governed merged-main preview rehearsal. For one source PR, a successful
rehearsal automatically qualifies and dispatches the existing serial production
lane. No session or owner names migration versions or artifact IDs for that
ordinary path. Missing, stale, multi-source, failed, or ambiguous evidence stops
before dispatch with **ENGINEER ACTION REQUIRED**. The production job still
re-proves current main, the durable exact-head verdict, guarded merge, immutable
preview evidence, the one open independently admitted structural work issue linked
by GitHub to the source PR, exact target, bounded allowlist, fresh dry-run,
all five machine-derived business-risk conclusions clear, exclusive lock, and
post-apply ledger/catalog result. This narrow path authorizes no manual
production command, manual workflow dispatch, other repository, or bypass.
Docs-only PRs (no schema change) need just items 1 and "it reads correctly" —
merge them promptly.

### 5.0-D Declare what a re-derived migration was derived from — `-- derived-from:` (issue #1608, added 2026-08-26)

Loader-style migrations here are authored as a **full re-derivation of the
then-current object body on `main`**. A file that does
`create or replace function|view` therefore depends on its base being present
**in the target database** — and on 2026-08-24 one was promoted to production
without it. The apply did not fail; it replaced the object with a body written
for a different world, and post-apply catalog verification stayed green because
the object still existed. Three migrations were retired over it.

If your migration re-replaces an object an earlier migration also replaces, put
**one machine-readable line** in the header:

```sql
-- derived-from: 20260814223552
```

or, if it writes the object from scratch and depends on no earlier rewrite:

```sql
-- derived-from: none
```

`scripts/migration_derivation.py` reads it. The Python test suite refuses a pull
request that omits it (mandatory for every migration stamped 2026-08-27 or
later), and the promotion lane refuses an allowlist whose member declares a base
the target ledger does not have. The escape hatch is
`--derivation-override VERSION:BASE=<what the database will actually hold>`,
which is recorded verbatim in the run log. The drift report shows such a version
as `[BASE-ABSENT]`, not as ordinary pending work.

Do **not** add the line to an already-merged migration — that changes its bytes.
Merged files that have a real earlier migration base get a pinned entry in
`LEGACY_DECLARATIONS`. A merged file whose source is provably pre-ledger rather
than another migration uses an exact-version, exact-source-text entry in
`IMMUTABLE_NON_LEDGER_DERIVATIONS`; this narrow path was added for
`20260909005945` on 2026-09-10. Never use either registry to excuse unknown or
unproved ancestry, and never broaden the normal parser to accept prose.

### 5.0-E Declare a pure-data migration before it merges — `-- catalog-verification: no-op`

Post-apply catalog verification derives its targets by lexing the migration
text. If it cannot derive any catalog object, enforcing mode fails deliberately:
a green result must not imply that the job verified something it never checked.

A migration containing only data statements may declare this in its header:

```sql
-- catalog-verification: no-op <specific reason of at least 20 characters>
```

The declaration is verified, not trusted. Every statement must begin with one
of `insert`, `update`, `delete`, `merge`, `with`, `select`, `values`, `set`,
`reset`, or `analyze`. Any DDL, grant, or `do $$ ... $$` block disqualifies the
whole file. Do not mention the literal declaration token in explanatory prose
inside a migration: the verifier scans comments as well as SQL.

Decide this **before merge**. Pure-data backfills and sequence-state changes are
the usual cases. Once the migration applies, its bytes are immutable, so a
missing declaration leaves a permanently red production run rather than a file
that may be edited after the fact.

### 5.1 Promoting to production when a backlog exists — NEVER `--include-all` on the full repo set, ALWAYS inside the pruned temp checkout (learned 2026-07-23; recipe corrected 2026-07-27; wording made self-consistent 2026-08-09)

> **Moved 2026-08-20** to [`docs/production-promotion-procedure.md`](../../docs/production-promotion-procedure.md) (issue #1331). Text unchanged; the section number is unchanged, so `AGENTS.md §5.1` still resolves.
>
> **The rule in one line, so nobody promotes without opening it:** when a backlog exists, **NEVER `--include-all`** — promote exactly the intended migration and prove it first.

### 5.2 A red check on `main` can be a STALE verdict — the domain-ownership guard scans more than its trigger watches (learned 2026-07-31)

> **Moved 2026-09-16:** the DB Data Admin application, its deploy workflow and its launch-readiness check now live in [`u2giants/popdam3`](https://github.com/u2giants/popdam3) at `apps/db-data-admin`, `.github/workflows/db-data-admin.yml` and `scripts/db-data-admin/` (popdam3 PR #135). This repository no longer builds or deploys it. The history below is kept; the only domain-ownership run in this repository is now `domain-ownership.yml`.

**Read this before you debug a failing check on `main`.** The `DB Data Admin` workflow
(`.github/workflows/db-data-admin.yml`) has a `verify` job whose first step,
*"Enforce DB Data Admin domain ownership"*, runs `scripts/check-domain-ownership.mjs`. That
script enumerates **every tracked text file** in the repo via `git ls-files` — all `.md`,
`.yml`, `.json`, `.mjs`, `.ts`, `.html`, `.css`, … including `HANDOFF.md`, `docs/**`,
`supabase/**` and the workflow files themselves.

But the workflow's `on: pull_request` / `on: push` `paths:` filter lists only:
`apps/db-data-admin/**`, `AGENTS.md`, `DB_Data_Admin.md`, `README.md`,
`docs/db-data-admin-domain-ownership.md`, `scripts/check-domain-ownership.mjs`,
`.github/workflows/db-data-admin.yml`.

**The scanner is repo-wide; the trigger is narrow.** So a violation can be introduced by a file
the filter ignores (e.g. `HANDOFF.md`) and get flagged the next time the workflow happens to
run — and, worse, *fixing that file does not re-run the workflow*, so `main` keeps displaying the
old failure forever.

Both halves were proven on 2026-07-31:

- **PR #328** corrected the offending wording in `HANDOFF.md` and merged as `53f849f`.
  **No workflow run fired at all.** `main` stayed red on the stale result.
- **PR #307**, an unrelated docs edit to `AGENTS.md` (which *is* in the filter), merged as
  `f1b9e8b` and **did** trigger the run — which passed. That, not the actual fix, is what turned
  `main` green.

**How to recognise it.** Either symptom means "stale verdict", not "still broken":
(a) a red check on `main` whose reported content is already corrected in the current tree —
check the run's commit SHA, not just the red X; or (b) a guard that never fires on a file you
know it scans.

**How to respond.**

1. Don't re-fix code that is already correct. Re-run the check against the current tip: use
   `gh workflow run` (manual dispatch) where the workflow allows it, or `gh run rerun <id>`
   against the newest run, or push a no-op touch to a file that *is* inside the `paths:` filter
   (`AGENTS.md` is the usual one).
2. Confirm green against the **current** `main` SHA — `gh run list --branch main --limit 5`
   shows which commit each verdict belongs to.
3. **When adding any repo-wide checker, make its trigger cover everything it scans.** If the
   checker rides inside a heavy job, split it into its own cheap workflow rather than widening
   the heavy job's filter — see the note below.

The obvious fix here (adding `HANDOFF.md` and friends to the filter) is **not** safe as written:
that same filter also gates the `container` build, Playwright browser tests and the Coolify
`deploy-development` job, so widening it would run a full build-and-deploy on every unrelated
docs PR. The correct permanent fix is a separate, tiny `domain-ownership` workflow with no
`paths:` filter, running only the two `node` commands.

✅ **That fix IS BUILT and has been since 2026-08-05.** It is
[`.github/workflows/domain-ownership.yml`](../../.github/workflows/domain-ownership.yml): no `paths:`
filter, `on: pull_request` plus `on: push` to `main`, one job that runs
`scripts/check-domain-ownership.test.mjs` and then `scripts/check-domain-ownership.mjs`. Its
check-run name is **`Domain ownership`** and it is one of the six required contexts on `main`
(§6.7). Verified green against the `main` tip on 2026-08-09. (The former duplicate invocation inside
`db-data-admin.yml` left this repository with that workflow on 2026-09-16.)

*(This paragraph said "Not yet built" until 2026-08-09, four days after it was built, while
§6.7 of this same file already relied on the workflow existing. Issue #657. If you are adding
a repo-wide guard, the pattern to copy is `domain-ownership.yml` or
`intake-pointer-guard.yml`: own workflow, no `paths:` filter, unique check-run name, required
context.)*

**The stale-verdict trap itself is NOT retired.** Everything above about reading the run's SHA
before believing a red X still applies, to every `paths:`-filtered workflow in this repo.

### 5.2-A A SECOND flavour of false red: the job never ran at all (hosted-runner starvation, added 2026-08-12, issue #513)

**A THIRD flavour, now removed at the root (2026-08-19, issue #1266).** CI used to
`apt-get install ripgrep` before running the SQL guards. A hosted-runner package-mirror
stall then held `SQL migration guards` `in_progress` for **42 minutes** on a 26-line docs
PR (#1264), and a retry wrapper only turned that into a 6-minute named failure. The guards
never needed ripgrep: `check-sql.sh` used it for five fixed-string searches that plain
`grep -qF` performs identically. **CI installs no packages for the SQL guards any more —
do not reintroduce an `apt-get` step to add a convenience tool.** Every job in every
workflow also now carries a `timeout-minutes` ceiling, so a stalled step fails on its own
budget instead of blocking merges for hours.

Dated evidence: on **2026-08-06**, `Cross-PR object collision` on **PR #466** went **red after 44
minutes without ever executing a step**. The job annotation read:

> *"The job was not acquired by Runner of type hosted even after multiple attempts."*

That is **GitHub hosted-runner starvation, not a collision**, and not a fault in your PR.
`gh run rerun --failed <run-id>` cleared it.

**Before you believe any red required check, read the job annotations**, not just the red X:

```bash
gh run view <run-id> --log-failed
gh api repos/popcre/shared-db/actions/runs/<run-id>/jobs --jq '.jobs[] | {name, conclusion, steps: [.steps[].conclusion]}'
```

A job whose steps are all `null`/empty never ran. Re-run it; do not go looking for a code defect,
and above all do not "fix" a guard that never executed.

**A FOURTH flavour: NO `pull_request` runs at all after a push — the PR is conflict-dirty
(observed 2026-09-17, PR #3200).** When a push leaves a pull request with unresolvable
conflicts, GitHub cannot build `refs/pull/<n>/merge`, so **no `pull_request` workflow starts at
all**; only the `pull_request_target` ones run, because they check out the base. The symptom is
not a red X — it is `gh pr checks` looking oddly **green**, with one or two contexts present and
every guard that judges the merge tree silently absent. **That is indistinguishable from "checks
passed" unless you count the contexts.** On 2026-09-17 three consecutive pushes to PR #3200
(`6b32d131`, `987a446f`, `721cbd38`) produced only `Documents-only merge authorization`, and an
empty-commit re-push did nothing at all; after merging current `main` into the branch and
resolving the conflict, the very next push (`1819ad5d`) created all 19 check runs at once.
**Know the discriminator:** a PR that merely LAGS `main` but still auto-merges cleanly runs
everything normally — only the unresolvable-conflict state suppresses runs. This bit routinely
here while every merged PR wrote its own `.agent/` evidence into the same two shared paths, so
each such merge conflicted every open PR that also carried a pair; issue #2708 moved that evidence
to `.agent/work/<issue>/<generation>/` on 2026-09-20, which removes that particular cause but not
this failure mode, which any conflict produces. Before concluding that checks were lost, run:

```bash
gh pr view <n> --json mergeable,mergeStateStatus
```

`mergeable: CONFLICTING` / `mergeStateStatus: DIRTY` is this flavour. The cure is refreshing the
branch against current `main` and resolving the conflict — never another re-push, and never a
retry of a guard that never started.


### 5.2-B Every governed gate reaches GitHub the same way (added 2026-09-04, issue #2342)

Three consecutive production-apply runs (`33920952504`, `33921168245`, `33921406952`)
each refused promotion while naming a **different** file that demonstrably existed. That
is the signature of a spurious read, not a real fault. The survey that followed found
**eight** independently hand-rolled `gh` wrappers under `scripts/`, of which exactly two
retried anything, plus workflow steps making bare `gh api` calls under `set -euo pipefail`
— two of them while holding the merge lock. Nothing caught that: there was no lint rule,
no conformance test, and no written rule anywhere in this file, `docs/`, or any `plan_*.md`.

**The primary fix is batching, not retrying.** Read §5.2-A above before proposing a retry:
a retry wrapper there turned a fast failure into a slower, identically-named failure. Each
collision and lease gate resolved file content with a per-file Contents call
(`repos/:repo/contents/:path?ref=:sha`), so comparing every open pull request cost up to
112 sequential calls and **any one** of them could refuse promotion. Retrying a read you
should not be making 112 times is §5.2-A's mistake with a longer wall clock. The exposure
is removed by asking GitHub once per ref.

The rule, in four parts:

1. **One governed transport.** Node gates under `scripts/` reach GitHub through
   `scripts/lib/github-transport.mjs`. Retry policy, the transient/semantic classifier and
   the never-replay-a-write rule are decided in one place. Pass `wrapError` to keep your
   gate's own named refusal. Local maintenance utilities that do not produce or validate
   governed evidence are outside this rule and must not be mistaken for gate transport.
2. **One tree read per ref.** File content comes from `scripts/lib/github-tree.mjs`:
   `git/trees/<ref>?recursive=1` once, then blobs **by SHA**. A file identical across
   twelve pull-request heads has one blob SHA and is fetched once; path existence is
   answered from the tree already in hand and costs nothing. **No gate may build a
   per-file Contents URL.** A truncated tree is refused outright — it would make present
   files look absent, which in a gate whose job is to refuse is a silent false clear.
3. **Workflows call a script, not `gh api`.** A read in a `run:` block goes through
   `node scripts/gh-read.mjs api …`. A **write** stays a direct `gh api` call and that is
   deliberate: neither `gh` nor any wrapper can tell "the request never landed" from "it
   landed and the response was lost", so a write gets exactly one attempt whichever door
   it goes through, and `gh-read.mjs` refuses mutations outright.
4. **404 is not transient, and must not be made one.** It is tempting to widen the
   classifier because the spurious failures were 404s. Across this repository a 404 is an
   *answer* ("does this ref exist yet?"), and a gate that concludes "absent" only after
   exhausting a retry budget has made its absence proof depend on a timeout — fail-open,
   which is worse than fail-closed. Retries are for HTTP 5xx and connection or TLS failures
   only. The one bounded exception is a **primary quota exhaustion** ("rate limit
   exceeded" with HTTP 403/429) on a read: it waits once for the reset GitHub states (via
   the free `rate_limit` endpoint), only when that reset is 15 minutes away or less, then
   re-reads. A further reset, an unreadable reset, a second exhaustion, a write, a
   secondary rate limit, or any other 403 still fails closed. The wait is **opt-in**: only
   a step that holds no lock sets `GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS` (at most 900).
   Unset means no wait, so a lock-holding step never waits. Never set it on a step that
   holds the author mutex, a merge lane, or the production lane.

**This is enforced, not advised.** `scripts/check-github-transport-conformance.mjs` fails
the build on direct Node `gh` process calls, literal shell-wrapped governed `gh` calls, a
bare workflow `gh api` read, or a per-file Contents URL, and runs in
`tools-offline-tests.yml`. Its own tests feed it a known-dirty tree containing each
forbidden shape and assert it refuses, *before* asserting anything about the real tree —
a green run on clean input proves nothing.
