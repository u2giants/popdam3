# Implementation plan — bounded reviewer leases and GitHub API budget

**Repository:** `u2giants/shared-db`

**Tracking issue:** [#1767](https://github.com/u2giants/shared-db/issues/1767)

**Created:** 2026-08-28

**Work class:** repository maintenance; never route this plan to the structural/schema orchestrator

**Session handoff:** retired after the implementation was fully consumed.

## STATUS — read this before doing anything

| Step | Outcome | State | Evidence |
|---|---|---|---|
| 0 | Start only after GitHub REST quota has reset and create a fresh isolated repository-maintenance worktree | ✅ done | Live core quota was 5000/5000; isolated branch `codex/1767-reviewer-api-budget` started from current `origin/main`. |
| 1 | Add a counted, quota-aware GitHub operation context | ✅ done (ceiling amended 2026-08-29) | Header preflight, New York reset display, command cache, and past-the-ceiling refusal are covered by tests. Ceiling raised 19 → 22 for `--review-slot 2` (issue #1812, PR #1813). |
| 2 | Add one active lease ref per reviewer and preserve immutable history | ✅ done | Fixed active refs and strict lease parsing preserve permanent evidence formats. |
| 3 | Replace the historical availability scan with bounded live reconciliation | ✅ done | The 10,000-history fixture proves identical fixed cost and zero historical availability reads. |
| 4 | Make assignment and replacement transactional, including lease release and mutex cleanup | ✅ done | Exact release/replacement uses the existing mutex and SHA readback/rollback guards. |
| 5 | Update operator documentation and add durable verification evidence | 🟨 landing | Code/docs/tests complete and independently reviewed; push, CI, merge, and final live proof remain. |

**Implementation is complete through Step 4.** Step 5 landing evidence is updated by the implementing session.

> **Amendment 2026-08-29 — the ceiling is 22, not 19 (issue #1812, PR #1813).**
> This plan was written for a single reviewer slot. The mandatory second
> independent reviewer (`--review-slot 2`, added in #1793) costs 3 more
> pre-mutex requests than slot 1, so the original 19 refused every slot-2
> assignment outright. `REVIEW_OPERATION_REQUEST_LIMIT` is now **22**, with the
> per-call arithmetic recorded in §8 and the raise authorized as an
> orchestrator decision under the 2026-08-18 owner ruling (see "Open questions").
> Read every "19"/"request 20" below as historical unless it is marked current.

## 1. Ultimate goal

Reviewer assignment must remain fast and safe no matter how much history the repository accumulates. Ten thousand old assignments must cost no more than ten old assignments: the manager looks only at the at-most-five reviewers who could be busy now, stays below a strict per-command GitHub request ceiling, and refuses before taking the shared mutex when quota is too low.

Historical assignment, replacement, and failure evidence remains immutable and queryable for audits. A verdict, terminal reviewer failure, moved pull-request head, merged pull request, or closed pull request makes that reviewer available again. Every exit must either prove the shared mutex is clear or identify the exact recovery action required.

**If a step conflicts with this goal, the goal wins — stop and flag it.** In particular, never regain speed by deleting history, skipping exact-head verification, weakening reviewer rotation, or suppressing a mutex-cleanup failure.

## 2. What this application is

`u2giants/shared-db` is the public source of truth for POP Creations' shared-database structure and its cross-session coordination controls. `scripts/manage-migration-author-lanes.mjs` is a dependency-free Node ESM command-line manager used by repository sessions to coordinate author claims, exclusive database stages, and independent AI reviewer assignments through GitHub refs.

The affected commands are `--assign-reviewer` and `--replace-failed-reviewer`. They run locally through the authenticated `gh` CLI against GitHub; they do not run against Supabase, preview, or production. The implementation branch must be created from current `origin/main` in a clean isolated worktree and merged by pull request to `main` after required checks pass.

## 3. What triggered this work

On 2026-08-28, the local authenticated GitHub user exhausted the shared 5,000-request/hour REST allowance. The final exhaustion was triggered by reviewer availability discovery. `findBusyReviewers()` called `listRefs(REVIEW_ASSIGNMENT_REF_PREFIX)`, so every historical assignment ref was paginated. For every returned ref it then fetched the assignment commit, the pull request, issue comments, PR comments, and PR reviews. The cost therefore grew with permanent history and repeated evidence reads for the same PR.

The incident is reproduced without touching GitHub by constructing an in-memory `io` with 10,000 historical assignment refs and counting calls while invoking the assignment path. The current implementation scales with the fixture size; the corrected implementation must complete with fewer than 20 counted GitHub calls. Do not reproduce the incident against live GitHub.

## 4. Scope

### In this plan

- Bound `--assign-reviewer` and `--replace-failed-reviewer` GitHub usage with a command-scoped request counter, cache, and quota preflight.
- Add a tiny live-review index: one fixed active-lease ref per assignable reviewer, including the paid overflow reviewer; at the current roster this is at most five refs.
- Reconcile only those active leases against current PR/head/verdict state.
- Release active leases on verdict, terminal failure/replacement, moved head, merged PR, or closed PR.
- Preserve permanent assignment, replacement, failure, and cursor records.
- Make mutex acquisition conditional on preflight budget/quota and make all mutex exits auditable.
- Add deterministic unit, performance, concurrency, and failure-injection tests.
- Update the reviewer operator documentation and publish a rerunnable verification artifact.

### NOT in this plan

- No database schema, migration, row-data, Supabase, preview, production, or infrastructure change.
- No structural-orchestrator issue, marker, dispatch, claim, or author lane.
- No deletion, compaction, rewriting, or migration of historical reviewer evidence.
- No change to reviewer roster, order, overflow policy, wrapper selection, exact-head verdict rules, or terminal failure codes.
- No global coordination across repositories; reviewer busy state remains repository-local.
- No background poller, scheduled cleanup job, TTL-only expiry, or lease heartbeat.
- No broader rewrite of `manage-migration-author-lanes.mjs` beyond extraction needed to make request accounting and lease reconciliation testable.

## 5. Current state of the code

Re-anchor every named function on current `origin/main` before editing; line numbers move frequently.

- `REVIEW_ASSIGNMENT_REF_PREFIX` points to permanent refs under `refs/db-review-assignments`. These records are correct historical evidence and must remain.
- `findPrReviewAssignments(issue, pr, io)` deliberately searches permanent records for one PR when diagnosing an assignment recorded under an older head. This targeted diagnostic is not the availability algorithm and may remain, but it must receive a request budget when called.
- `hasVerdictForHead(issue, pr, headSha, io)` separately fetches issue comments, PR comments, and PR reviews every time it is called. It has no operation cache.
- `findBusyReviewers(io)` lists every permanent assignment ref, fetches every referenced commit, then reads PR and verdict evidence per assignment. This is the root unbounded scan.
- `pickReviewer(sequence, io)` calls `findBusyReviewers`; on an unreadable scan it deliberately falls back to ordinary rotation so it does not silently send all work to the paid overflow reviewer. Preserve that business intent while making quota/budget failures fail before locking rather than masquerade as availability.
- `assignNextReviewer()` creates an owner commit and acquires `MUTEX_REF` before it determines availability. It writes the round-robin cursor and permanent assignment record, but no separate active lease.
- `replaceFailedReviewer()` creates a failure record, advances the cursor, and writes a replacement record. It must also release the failed reviewer's active lease and acquire the replacement reviewer's lease as one mutex-serialized state transition.
- `githubIo` exposes uncached REST helpers. `ghPaginated()` can silently turn one logical read into many requests, and there is no command-scoped counter or remaining-quota preflight.
- Both assignment functions use `finally` to release `MUTEX_REF` only when the ref still equals their owner SHA. Existing tests cover some recovery behavior, but there is no exhaustive failure injection proving every new pre-lock and post-lock path.
- `scripts/manage-migration-author-lanes.test.mjs` already contains reviewer rotation, overflow, verdict, moved-head, idempotency, replacement, and stranded-mutex tests. Extend these; do not create a competing test harness.
- `docs/agents/section-4-anti-collision-rules.md` is the operator-facing reviewer procedure. `AGENTS.md` routes active repository-maintenance plans.

As of this plan, no implementation code is committed, pushed, deployed, or activated. Only the planning issue and documentation branch exist.

## 6. Key findings and root cause

1. **Availability is derived from an append-only archive.** Permanent history grows without bound, so even perfect pagination cannot make the algorithm safe.
2. **The scan multiplies calls.** One assignment can cause a commit read, PR read, two issue-comment reads, and a PR-review read; multiple historical heads of the same PR repeat identical reads.
3. **The expensive discovery happens after lock preparation.** `makeOwnerCommit()` itself consumes GitHub calls, and `assignNextReviewer()` then acquires the shared mutex before availability is known. Exhaustion can strand or unnecessarily occupy the mutex.
4. **The right index cardinality is the reviewer roster, not assignment history.** One fixed ref per assignable reviewer bounds live state at five today.
5. **A lease needs exact review identity.** Its commit message must carry reviewer, issue, PR, exact head SHA, assignment sequence, and a generation or equivalent fence. The fixed ref identifies the reviewer; the commit identifies the work.
6. **Verdict and PR liveness can be batched.** A command needs current data for at most five leases. Fetch all needed PR/head/state and verdict evidence once, then share it across reconciliation, availability, assignment, and replacement.
7. **Quota and request budget are different guards.** Remaining quota says whether the account can safely start; a local counter prevents this command from exceeding its own design envelope even when the account has plenty left.
8. **Cleanup failures are safety failures.** A `finally` that attempts release is insufficient if the release itself fails silently or loses ownership. The command must report the owned mutex SHA and the guarded recovery workflow when cleanup cannot be proved.

## 7. Approaches considered and rejected

- **Rejected: paginate permanent assignment refs more efficiently.** Fewer pages delay the same asymptotic failure; 10,000 becomes 100,000.
- **Rejected: delete or compact old assignment refs.** That destroys durable audit evidence and violates the explicit requirement to preserve history.
- **Rejected: inspect only recent assignments by date or sequence.** A genuinely live old assignment can be missed, and a time window is an unproven availability rule.
- **Rejected: infer availability from the round-robin cursor.** The cursor records the last allocation, not all active work.
- **Rejected: TTL-only leases or heartbeats.** Time does not prove a review ended; heartbeats add API traffic and introduce stale-holder races. Release is based on live verdict/PR/head/failure facts.
- **Rejected: a background cleanup workflow.** It adds another quota consumer and leaves assignment dependent on eventual cleanup. Reconciliation belongs in the bounded foreground operation.
- **Rejected: silently continue when quota or budget state is unreadable.** The command could lock and then fail. Preflight uncertainty must stop before mutex acquisition.
- **Rejected: count only high-level helper calls.** Pagination, retries, and readbacks are real API requests. The counter must sit at the lowest GitHub invocation boundary used by these commands.
- **Rejected: cache across processes or indefinitely.** Availability is safety-sensitive. Cache only within one command invocation; mutation invalidates affected entries.
- **Rejected: release an active lease without the shared mutex.** Fixed refs are read-modify-write coordination state; every mutation must remain serialized and ownership-fenced.

## 8. Design decisions

### Locked decisions — do not relitigate

- **2026-08-28:** Fixed active refs live under a new prefix such as `refs/db-review-active/<reviewer>`, one per assignable reviewer. Historical prefixes remain unchanged.
- **2026-08-28:** The active-ref commit message carries reviewer, issue, PR, exact head, sequence, and generation; parsing is strict and unknown formats fail closed.
- **2026-08-28:** Availability reads only the active prefix. No availability code may call `listRefs(REVIEW_ASSIGNMENT_REF_PREFIX)` or enumerate historical assignment/replacement/failure refs.
- **2026-08-28:** The complete `--assign-reviewer` command, including quota preflight, live reconciliation, locking, writes, readbacks, and mutex release, must use fewer than 20 counted GitHub requests in the worst tested five-lease case. Set an explicit constant no greater than 19 and make the counter throw before request 20.
- **SUPERSEDED 2026-08-29 (issue #1812, PR #1813):** the ceiling is now **22**, not 19,
  and `REVIEW_OPERATION_REQUEST_LIMIT = 22`. The 19 above was correct only for a
  single reviewer slot. `--review-slot 2` (the mandatory second independent
  reviewer, added in #1793) calls `resolveSlotOneReviewer`, which costs **3 extra
  pre-mutex requests** (`listRefs` + `readRef` + `getCommit`) to find which
  provider already holds slot 1. Worst-case accounting, verified empirically by
  instrumenting the live counter:
  - `getRateLimit` = 2 (REST `rate_limit` + GraphQL `rateLimit`)
  - `resolveSlotOneReviewer` = 3 (slot >= 2 only)
  - `findBusyReviewers` = 3 (cutover `readRef` + batched `readActiveReviewLeases` + batched `readReviewStates`)
  - `makeOwnerCommit` = 1
  - pre-mutex total: **6 for slot 1, 9 for slot 2**; then `requireReviewWireCapacity(13)`
    reserves the mutex-acquisition body, so slot 1 needs 19 (exactly the old
    ceiling, zero headroom) and slot 2 needs **22**.
  Slot 2 was therefore refused 100% of the time with `REFUSED: reviewer operation
  cannot fit 13 remaining requests inside the 19-request budget`, blocking every
  migration PR that requires two independent reviewers. Even perfect batching
  cannot fit slot 2 under 19 (8 + 13 = 21), so raising the ceiling was the only
  correct fix, not a workaround.
- **2026-08-28:** Quota sufficiency is checked before owner-commit creation and before mutex acquisition. Required remaining quota is the command budget plus a named safety reserve; start with a 20-request reserve unless current repository policy defines a larger one. The reserve is configurable by a constant/environment input for tests, never silently disabled.
- **2026-08-28:** One command-scoped cache supplies PR, issue-comment, PR-comment, review, ref, and commit reads. Mutations invalidate or replace the corresponding cache entry.
- **2026-08-28:** Terminal failure/replacement releases the failed reviewer's lease; the replacement receives its own lease. Verdict, moved head, merged PR, and closed PR are reconciled as releases.
- **2026-08-28:** Active-lease changes, cursor changes, and permanent evidence writes occur while holding `MUTEX_REF`, with ownership rechecked before each mutation.
- **2026-08-28:** Historical evidence remains append-only and exact-head-bound.

### Open implementation judgment

- Use one bounded GraphQL query or a small number of REST reads to fetch the at-most-five active refs, commit messages, PR state/head, and verdict evidence. Choose the simpler implementation that proves the full command stays below 20 calls and fails on partial/malformed results.
- Extract a dependency-free module under `scripts/lib/` if request accounting, active-lease parsing, or batched reconciliation would otherwise make the main CLI difficult to test. Keep the CLI entrypoint and public command names stable.
- Choose rollback ordering after modelling all partial writes. The required outcome is fixed: no leaked mutex, no two active leases for one reviewer, no cursor advancement without durable assignment evidence, and an explicit recovery-required error if rollback cannot restore the prior state.

## 9. Executable implementation plan

### Step 0 — fresh-session and quota preflight

Start a new repository-maintenance session after the shared REST quota has reset. Fetch `origin`, create a clean isolated worktree and `codex/` branch from current `origin/main`, read `AGENTS.md`, this plan's STATUS table, and the reviewer section of `docs/agents/section-4-anti-collision-rules.md`. Run `git var GIT_COMMITTER_IDENT`; it must be `Albert Hazan <u2giants@users.noreply.github.com>`.

Use one `gh api rate_limit` read to record current core `remaining`, `limit`, and reset time. Do not run queue audits or historical ref scans. Re-anchor `findBusyReviewers`, `pickReviewer`, `assignNextReviewer`, `replaceFailedReviewer`, `hasVerdictForHead`, `findPrReviewAssignments`, `githubIo`, `ghJson`, and `ghPaginated` by function name.

**Verification gate — you'll know it worked when:** the worktree is clean at current `origin/main`, identity is correct, issue #1767 is open and labelled `db-work`, quota remaining exceeds the planned budget plus reserve, and no orchestrator marker/claim was created for this repository-maintenance task.

### Step 1 — add counted, quota-aware operation context

In `scripts/manage-migration-author-lanes.mjs` or a new dependency-free `scripts/lib/github-request-budget.mjs`, add a command-scoped object that:

- counts every real GitHub request at the lowest call boundary, including pagination pages, retries, writes, and readbacks;
- has an immutable maximum of at most 22 for reviewer assignment (19 when this
  plan was written; raised to 22 on 2026-08-29 for `--review-slot 2` — see the
  SUPERSEDED entry in the decisions list above);
- refuses the next request before the counter would exceed the maximum;
- performs and records a remaining-quota preflight before `makeOwnerCommit()` and `acquireMutex()`;
- requires `remaining >= requestBudget + safetyReserve` and produces a plain error naming remaining, required, reset time, and that no mutex was acquired;
- caches identical safe reads within the command and invalidates affected entries after writes;
- exposes the count and cache statistics to tests without printing credentials or response bodies.

Thread this operation context through the reviewer commands and their `io` calls. Do not silently impose the reviewer budget on unrelated manager commands until separately measured.

**Verification gate — you'll know it worked when:** unit tests prove the request past the ceiling is never issued (request 20 under the original 19-request ceiling; request 23 under the current 22 — the tests read `REVIEW_OPERATION_REQUEST_LIMIT` rather than hardcoding either), pagination/retry calls are counted, duplicate reads hit cache, low/unreadable quota fails with zero mutex create attempts, and ordinary non-reviewer tests remain green.

### Step 2 — add the bounded active-review lease index

Add constants and strict parser/formatter helpers for `refs/db-review-active/<reviewer>`. Validate reviewer names against the existing registry and permit only assignable active/overflow reviewers. The lease's immutable owner commit must record reviewer, issue, PR, exact head SHA, assignment sequence, and generation.

Add helpers to read at most the current five fixed refs, batch their commit/PR/verdict data, and classify each lease as:

- `active`: PR open, exact head unchanged, no exact-head verdict, no terminal failure;
- `releasable-verdict`;
- `releasable-failure`;
- `releasable-moved-head`;
- `releasable-closed-pr` (including merged);
- `unreadable`: fail closed before assignment.

Creating an assignment must create the permanent assignment record exactly as today and set the chosen reviewer's active ref. Idempotent retry for the same issue/PR/head/sequence returns the same assignment and lease. A conflicting live lease for that reviewer prevents overwriting it.

Do not backfill historical refs. At activation, absent active refs mean free reviewers. This is safe because activation must occur only after a one-time bounded cutover check of currently open coordination work, recorded in the verification artifact; if live pre-cutover reviews exist, create only their active refs under the mutex before enabling the new availability path.

**Verification gate — you'll know it worked when:** parser round-trips and malformed-lease tests pass; at most five active refs are read; immutable history remains byte-for-byte unchanged; idempotent retry is stable; and a conflicting lease cannot be overwritten.

### Step 3 — replace historical scanning with bounded reconciliation

Rewrite `findBusyReviewers` (rename internally if clearer while keeping exported compatibility for tests) so it consumes only the active-lease snapshot. Remove `listRefs(REVIEW_ASSIGNMENT_REF_PREFIX)` from availability. Keep `findPrReviewAssignments` only for explicit targeted diagnostics and replacement recovery, under the request budget.

Batch PR and verdict evidence for all occupied active leases once per operation. Reuse the same snapshot in `pickReviewer`, assignment validation, and replacement validation. While holding the mutex, revalidate the selected lease/ref immediately before mutation so a preflight snapshot cannot overwrite a concurrent assignment.

Release a conclusively stale lease under the mutex, with owner/generation proof and readback, before that reviewer can be selected. Reconcile only the selected reviewer per operation so cleanup remains constant-cost; later operations release other stale leases before selecting those reviewers. Never sweep all stale refs in one command. If any required PR/verdict fact is unreadable, do not treat the reviewer as free and do not acquire/retain the mutex unnecessarily.

**Verification gate — you'll know it worked when:** the 10,000 historical-assignment fixture plus five active leases performs fewer than 20 total counted GitHub calls; changing the historical fixture from 0 to 10,000 does not change the count; PR/verdict reads occur once per unique PR; and no test path enumerates the historical prefix for availability.

### Step 4 — make assignment/replacement and mutex cleanup transactional

Update `assignNextReviewer()` and `replaceFailedReviewer()` so the state transition is explicit and rollback-aware:

1. validate input;
2. quota/budget preflight and bounded live snapshot, with no mutex;
3. prepare owner commits within budget;
4. acquire `MUTEX_REF`;
5. re-read/revalidate affected fixed refs and cursor;
6. release conclusively stale leases;
7. write permanent evidence, cursor, and selected active lease in an order whose rollback preserves the prior valid state;
8. read back every mutation;
9. release and prove the mutex clear.

Replacement must release the failed reviewer's active lease only when issue/PR/head/sequence/reviewer match the permanent failure evidence, then lease the replacement reviewer. A moved head or closed PR must not receive a replacement.

Centralize mutex finalization so success, early return, validation throw, budget throw, API throw, readback mismatch, rollback throw, and unexpected exception all pass through one cleanup routine. If ownership was lost, never delete another holder's mutex. If owned release cannot be proved, throw a recovery-required error containing the exact mutex ref and expected SHA and naming the guarded `recover-author-mutex.yml` procedure.

**Verification gate — you'll know it worked when:** the full failure-injection matrix in §10 proves zero leaked owned mutexes, no successor mutex is deleted, partial reviewer state is rolled back or explicitly marked recovery-required, and idempotent retries converge to one active lease and one permanent assignment.

### Step 5 — documentation, verification, and landing

Update `docs/agents/section-4-anti-collision-rules.md` to explain the live index, quota/budget preflight, release reasons, exact-head behavior, failure message, and recovery procedure. Update this STATUS table after each merged step with commit SHA plus a rerunnable artifact—never a bare call count.

Create `docs/verification/reviewer-assignment-api-budget-2026-08-28.md` containing the exact commands, test output summary, 10,000-history call-count result, low-quota zero-lock proof, failure-injection matrix result, cutover audit, and final live `gh api rate_limit` delta from one controlled assignment dry-run or test-safe operation. Do not include licensed data, secrets, tokens, or unrelated issue content.

Run focused tests, then the repository's full required suite. Commit only owned files, push, open a PR to `main`, wait for all required checks, merge it, verify `state=MERGED` and the merge SHA on `origin/main`, then close #1767 with the repository's required completion evidence. Delete this handoff in the closing PR only when implementation and activation are proven complete.

**Verification gate — you'll know it worked when:** all Definition of Done items in §13 are checked, required CI is green, the PR is merged, issue #1767 is closed with evidence, the handoff is retired, and the original shared checkout remains untouched.

## 10. Tests required

Add focused tests to `scripts/manage-migration-author-lanes.test.mjs`; create a new test module only if a new `scripts/lib/` module warrants it.

### Request-budget and cache tests

- `low quota refuses before owner commit and mutex acquisition` — zero create/update/delete ref calls.
- `unreadable quota refuses before mutex acquisition`.
- `wire-level request budget counts every retry and refuses the request past the limit` —
  observed count never exceeds `REVIEW_OPERATION_REQUEST_LIMIT` (22 since 2026-08-29;
  the test reads the constant instead of hardcoding a number, so the ceiling can move
  without silently invalidating the assertion).
- `complete slot-2 assignment stays inside the real wire-attempt budget (issue #1812)` —
  a full `--review-slot 2` assignment with the roster's leases held, driven through the
  real wire-counting path. This is the regression test for the slot-2 refusal.
- `pagination pages and retry attempts each consume budget`.
- `duplicate PR and verdict reads are cached per operation`.
- `cache invalidates an active ref after create/update/delete`.

### Active-lease state tests

- `one fixed active lease per assignable reviewer` — no sixth or duplicate reviewer lease.
- `lease parser round-trips exact reviewer issue PR head sequence generation`.
- `unknown reviewer malformed head and malformed generation fail closed`.
- `verdict releases exact-head lease`.
- `terminal failure releases failed reviewer and leases replacement`.
- `moved head releases old lease and requires a fresh assignment`.
- `closed and merged PRs release leases`.
- `unreadable PR or verdict evidence never frees a reviewer`.
- `idempotent retry preserves one history record and one live lease`.
- `conflicting live lease is never overwritten`.
- `retired reviewer history remains readable but receives no active lease`.

### Performance regression test

- Construct 10,000 historical assignment refs plus five active leases. Invoke the complete assignment operation with a lowest-boundary request spy. Assert fewer than 20 total GitHub requests, at most five active-lease reads, zero availability reads against `REVIEW_ASSIGNMENT_REF_PREFIX`, and identical request count with 0 and 10,000 historical refs.

### Mutex and rollback failure-injection matrix

Inject a failure at every GitHub boundary: quota read; active-ref snapshot; batched PR/verdict read; owner commit; recovery-marker read; mutex create; mutex readback; cursor read; history create/readback; stale-lease delete/readback; cursor update/readback; selected-lease create/readback; failure-record create/readback; replacement-record create/readback; rollback mutation; mutex delete/readback. For each row assert one of:

- mutex was never acquired;
- owned mutex is proven absent;
- a different holder remains untouched; or
- the thrown error names exact recovery ref/SHA and no further mutation occurred.

### Commands

Run at minimum:

`node --test scripts/manage-migration-author-lanes.test.mjs`

Then run the repository's current required test command from `package.json`/CI on current `origin/main`; record the exact command and run artifact in the verification document rather than copying an old test count from this plan.

## 11. Constraints, standing rules, and gotchas

- This is repository maintenance outside the structural orchestrator. Do not run `check-orchestrator-marker --resolve`, create an orchestrator marker, or request a structural author lane for implementation.
- Use a fresh isolated worktree from current `origin/main`; preserve the dirty shared checkout and every unrelated worktree.
- Before the first commit, verify the committer identity required by `AGENTS.md`. Stage only owned files.
- GitHub REST quota is shared across local sessions and apps. Avoid exploratory API loops; use fixtures for scale testing.
- The rate-limit endpoint's response is a preflight signal, not permission to spend the account down. Preserve the safety reserve.
- Count actual requests below pagination and retry helpers. A logical helper call is not a request budget.
- Do not turn a 403, malformed response, partial GraphQL result, or transport error into “reviewer free.”
- Do not use the paid overflow reviewer merely because busy-state evidence is unreadable.
- Preserve current round-robin order, overflow policy, exact-head verdict rule, permanent evidence, and targeted moved-head diagnostics.
- Every fixed-ref mutation uses the existing global mutex and ownership checks; do not invent a second mutex.
- Never delete a mutex after ownership changes. Cleanup must be precise and recoverable.
- No secrets or licensed data belong in tests, logs, plan evidence, issue comments, commits, or PR text.
- No production/database writes are authorized by this plan.
- This plan may be updated by the implementing session as work lands. Do not mark rows done without an artifact.

## 12. Access and environment

- Repository: `C:\repos\shared-db`; implementation must use a new isolated worktree, not the shared checkout.
- Remote: `https://github.com/u2giants/shared-db`; target branch `main`; implementation branch prefix `codex/`.
- Authentication: local `gh` CLI uses Albert's authenticated `u2giants` credential. Its 5,000-request/hour core allowance is shared across sessions and apps.
- Git identity: `Albert Hazan <u2giants@users.noreply.github.com>`.
- Runtime: project-owned Node.js used by existing scripts; no new runtime dependency is expected.
- Secrets: N/A. The implementation must not retrieve or add a secret. GitHub authentication stays inside the existing `gh` credential store.
- Database/browser/test login: N/A. This work has no database, UI, preview, production, or browser path.
- Issue: #1767. The issue is `repo-maintenance` / `route: repo-maintenance`, labelled `db-work` only so repository queue auditing can see and correctly exclude it from orchestrator work.

## 13. Definition of done, risks, rollback, and open questions

### Definition of done

- [ ] Availability reads only at-most-five active reviewer leases, never historical assignment refs.
- [ ] Permanent assignment, replacement, failure, and cursor evidence remains readable and unchanged.
- [ ] Verdict, terminal failure, moved head, merged PR, and closed PR release the correct lease.
- [ ] Remaining quota and strict request budget are checked before mutex acquisition.
- [ ] Complete assignment with 10,000 historical records uses fewer than 20 counted GitHub requests.
- [ ] PR/verdict reads are batched or command-cached.
- [ ] Every failure-injection row proves no leaked owned mutex or produces exact recovery-required evidence.
- [ ] Existing reviewer rotation, overflow, exact-head, idempotency, replacement, and historical-reader tests remain green.
- [ ] Documentation and rerunnable verification artifact are current.
- [ ] Code is committed, pushed, reviewed by required CI, merged to `main`, and merge SHA verified on `origin/main`.
- [ ] Issue #1767 has successful completion evidence and is closed.
- [ ] The handoff is deleted in the closing PR; this plan's STATUS table names final artifacts.

### Risks and mitigations

- **Cutover misses a review already in flight.** Mitigation: bounded one-time audit of currently open coordination work and creation of active refs before activation; record exact evidence.
- **GraphQL partial data is mistaken for absence.** Mitigation: validate every requested node/ref and fail closed on errors or missing fields.
- **Budget is too tight for safe readbacks.** Mitigation: optimize batching/caching, not safety checks. If the operation cannot fit under the current ceiling, stop and report the design conflict rather than raise the budget *as a convenience*. Raising it is legitimate only when the added cost is real, irreducible, and documented with a per-call worst-case breakdown — as was done on 2026-08-29 for `--review-slot 2` (19 → 22, issue #1812), where the 3 extra pre-mutex calls cannot be batched away and no ceiling below 22 admits a second independent reviewer at all. Never raise it to paper over an unbounded or accidentally-quadratic path; that is the failure this risk names.
- **Rollback creates contradictory cursor/history/lease state.** Mitigation: model write ordering, use create-only permanent evidence, read back each mutation, and exhaustively inject failures.
- **Stale lease release races another assignment.** Mitigation: revalidate and mutate only while holding the existing mutex, with holder/generation checks.
- **Quota resets during the operation.** Mitigation: local budget remains authoritative even if GitHub's remaining value changes.

### Rollback

If defects appear after merge, disable only the new live-index activation path through a documented, code-reviewed compatibility switch if one is added; retain all new refs and evidence. Do not restore the unbounded historical scan. The safe rollback is to fail reviewer assignment closed with a clear message while a forward fix is prepared. Revert the code through a normal PR only if tests prove historical evidence and active refs remain interpretable.

### Open questions

No owner decision is currently required. The implementation may choose GraphQL versus bounded REST and the module extraction boundary using the criteria in §8. Changing reviewer policy, deleting history, weakening exact-head checks, or bypassing mutex cleanup is not an implementation judgment; stop and return it to Albert.

**Correction, 2026-08-29 (issue #1812).** This paragraph previously also listed
"any need to exceed 19 requests" as a return-to-Albert item. That was wrong and
is withdrawn. The request ceiling is an internal GitHub API call budget with no
business, cost, or data-risk dimension — it is exactly the kind of technical
judgment the owner has ruled he does not make. Per the standing owner ruling of
**2026-08-18** ("Albert does not sign off on technical risk. He is not a
programmer and cannot evaluate the SQL a risk flag refers to. Never gate on a
human judgement the human cannot make") and `AGENTS.md` §1 ("The owner reviews
behavior, not code"), routing a call-budget constant to Albert would be a
rubber-stamp gate — worse than no gate, because it manufactures false
authorization. The ceiling is an **orchestrator** decision, taken with an
independent model review as the technical gate. The 19 → 22 raise was authorized
that way on 2026-08-29. Genuine business rulings and material production risk
still go to Albert; this is neither.

## Mandatory self-audit

1. **Could a brand-new AI session execute this without asking a question? Yes.** §§2–6 explain the system, incident, exact root cause, and current functions; §§8–10 fix the state model, ordered edits, verification gates, and tests; §12 defines access and routing.
2. **Does the plan carry all background, nuance, and rejected paths? Yes.** §§3, 6, and 7 preserve the outage mechanism, why history must remain, why caching alone is insufficient, and why TTL, polling, deletion, recent-only scans, and silent fallback are rejected.
3. **Is the goal clear enough for correct judgment when a step is wrong? Yes.** §1 makes bounded cost, preserved evidence, correct lease release, quota safety, and mutex cleanup the controlling outcome; §8 separates locked decisions from implementation judgment.

All 13 required sections are present. Every implementation step names concrete functions/files and ends in a verification gate; tests, constraints, access, landing, rollback, and Definition of Done are explicit. The self-audit passes.
