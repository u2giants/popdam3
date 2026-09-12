# Reviewer assignment API-budget verification — 2026-08-28

Issue: #1767. Scope: repository coordination only; no database, preview, production, or application data changes.

> **The admission gate is not reviewer work, 2026-09-11 (issue #2802).** The
> 25-request ceiling below is UNCHANGED and the mutex-release reserve is
> untouched. What changed is what the ceiling is charged for. Everything
> measured in this document was measured for a draw with NO structural-admission
> step; that gate (`scripts/orchestrator-flow/admission.mjs`) landed later, in
> e7bec2fe on 2026-09-11, and its GitHub reads — the pull request, the linked
> work issue, the complete file list, file contents at the exact head, the
> closing-issue link and the outcome history — were being billed against this
> ceiling. Charged against it, a structural draw exhausted the budget at request
> 24 (2 held back as the mutex-release reserve). That refusal fired from INSIDE
> the held mutex section — it was not a cheap fail-fast before the mutex was
> taken. The mutex-release reserve is only subtracted once `acquireReviewMutex`
> has marked the budget locked, and the admission step runs after that, so the
> lane had already acquired the reviewer mutex and made admission's reads under
> it before the refusal, and then had to unwind and release. Every migration
> author lane in the fleet was blocked.
> Admission now runs outside the reviewer operation's request accounting
> (`withoutReviewRequestBudget`), which is how it is already accounted for at
> every other call site — `acquireAuthorLane`, the guarded merge gate and
> preview preparation all invoke it with no reviewer budget installed. It still
> runs, still refuses identically, and still runs under the same held mutex
> before the draw proceeds. Nothing below is re-derived, because nothing below
> changed: the reviewer half of the operation costs exactly what it did.

> **Queue and capacity budgets, 2026-09-04 (issue #2345).** The 25-request
> ceiling still governs the assignment transaction itself. When FIFO admission
> is enabled, the complete public command has one honest 75-request ceiling
> covering ticket admission, assignment, and ticket release; it no longer
> resets the counter between those phases. The read-only capacity census has a
> separate 64-request ceiling so a fully occupied reviewer pool remains
> observable. Queue reads remain bounded to 32 tickets, and an unchanged ticket
> expires after two hours so an abandoned caller cannot block every successor.

> **Replacement-chain repair, 2026-09-07 (issue #2550).** The 25-request
> ceiling is unchanged. A released slot-2 chain could exceed the pre-mutex gate
> because every predecessor replacement reread its immutable failure ref and a
> failed reviewer already covered by the lease snapshot was read again. Suffixed
> replacement refs now pull their corresponding failure refs into the same
> GraphQL record snapshot. The one bounded lease query also carries every name
> in the static historical reviewer catalog, so a retired failed reviewer's
> exact lease presence or absence is reused without making that reviewer
> drawable again; unknown legacy names retain the strict direct-read fallback.
> A production-cost fixture covers slot-1 durable approval, a retired slot-2
> predecessor with an unrelated live lease, reviewer reinstatement, independent
> selection, exact assignment readback and idempotent retry within 25 requests.
> Immutable-evidence, exact-head, verdict,
> independence, fresh mutex recheck, atomic transition and cleanup refusals are
> unchanged.

> **Silent-reclaim budget, 2026-09-10 (issue #2697).** The 25-request ceiling
> here is unchanged and still governs assignment and replacement. It never
> governed `--reclaim-silent-reviewer`, which was added later and whose request
> count was never derived; charged against 25 it refused at request 24 every
> time, so a dead reviewer lease could not be released. That path is now
> initially measured at 28 on the current-key path (14 pre-mutex plus a
> 14-request mutex-held section), with one duplicate fresh PR read removed;
> the later legacy fallback measurement is 30 (15 plus 15) and controls the ceiling
> rather than paid for, in
> `docs/verification/reviewer-silent-reclaim-api-budget-2026-09-10.md`.

> **Superseded ceiling, 2026-08-29 (issue #1812, PR #1813).** Everything below
> was verified against a **19**-request ceiling, which was correct for a single
> reviewer slot only. The mandatory second independent reviewer
> (`--review-slot 2`, #1793) costs 3 more pre-mutex requests
> (`resolveSlotOneReviewer`: `listRefs` + `readRef` + `getCommit`), needing 22
> and so refusing 100% of slot-2 assignments. The enforced ceiling is now
> **22** (`REVIEW_OPERATION_REQUEST_LIMIT = 22`); the counter refuses API
> request **23**, not 20. Normal path: 2 (`getRateLimit`) + 3
> (`resolveSlotOneReviewer`, slot >= 2) + 3 (`findBusyReviewers`) + 1
> (`makeOwnerCommit`) = 9 pre-mutex, plus the 13-request mutex-body reserve =
> 22. Slot 1 remains 6 + 13 = 19. `resolveSlotOneReviewer` costs more than 3
> when slot 1 has recorded replacement refs (one `getCommit` per replacement
> row); that path fails **closed** with a clean `REFUSED` before the mutex, so
> 22 is the normal-path ceiling, not an absolute upper bound. Raised as an
> orchestrator decision under the
> 2026-08-18 owner ruling that technical risk is not routed to the owner; see
> `plan_reviewer_assignment_api_budget.md` "Open questions". The historical
> numbers in this document are left intact as the record of what was measured
> on 2026-08-28.

> **Current ceiling, 2026-08-30 (issue #1833).** The bounded PR-local reviewer
> exclusion lookup adds one request to both slot paths. The enforced ceiling is
> therefore **23**: slot 2 is 9 pre-mutex requests plus a 14-call mutex-section
> reserve; slot 1 is 6 plus 14. The exclusion read is inside the mutex so a
> concurrent exclusion cannot be missed. The one request past the ceiling
> is still refused before mutex acquisition, and assignment history is never
> scanned to decide availability.

## Preflight

- GitHub core quota: 5,000 remaining of 5,000; reset `2026-08-28 3:06:26 PM EDT` (`America/New_York`).
- Branch: `codex/1767-reviewer-api-budget`, created from current `origin/main` in the delegated isolated worktree.
- Committer: `Albert Hazan <u2giants@users.noreply.github.com>`.

## Rerunnable tests

`node --test scripts/manage-migration-author-lanes.test.mjs`

Result: 237 passed, 0 failed. The fixture runs the complete assignment operation with both zero and 10,000 immutable historical assignment refs. Both use exactly 18 lowest-boundary test-I/O operations, including the durable cutover marker, read the active index once, and make zero availability calls to the historical assignment prefix. Wire-level tests run complete assignment and replacement operations with occupied reviewers inside the 19-request GitHub API ceiling, reserve cleanup capacity after locking, and prove every REST/GraphQL retry consumes budget and API request 20 is refused. The atomic Git transport does not consume the shared REST or GraphQL quota. Concurrent-successor, revived-stale assignment and replacement leases, exact-head verdict release on assignment and replacement retries, retired assignment and replacement restoration refusal, cursor-only recovery, missing failed-lease replacement, unrelated-live-lease, post-lock assignment/replacement PR-close, delayed visibility, lost mutex-create response, acquisition-proof failure, atomic-push failure, lost readback, crash-retry, and verification-sidecar preservation regressions prove newer leases survive, mutable reads are not cached, external PR changes block mutation, partial mutations never publish, and retries converge safely.

`node --test scripts/check-migration-pr-lease.test.mjs scripts/manage-migration-author-lanes.test.mjs scripts/historical-migration-restorations.test.mjs scripts/lib/work-dependencies.test.mjs scripts/agent-work-contract.test.mjs scripts/db-coordination-events.test.mjs scripts/coordination-scenarios.test.mjs scripts/lib/exclusive-lease.test.mjs scripts/apply-lane-advisory-lock.test.mjs`

Result: 395 passed, 0 failed.

The focused suite covers low and unreadable quota before owner-commit/mutex acquisition, wire-level request-20 refusal including retries, strict lease parsing, verdict/head/closed-PR stale release, exact failure/replacement release, idempotency, conflicting leases, historical-reader compatibility, assignment/replacement rollback, mutex ownership loss, successor preservation, and bounded release readback.

Issue #1911 preserves the 22-request ceiling while making merged-head replacement fit it. The target issue, pull request, comments, and reviews now ride in the same bounded state snapshot already used for active leases, and the exact-record GraphQL read also carries the current main commit/tree used to create the immutable replacement commit. The live #1684/#1712 probe reached the mutex entry gate with mutation disabled; before this change the identical command exhausted all 22 requests before that gate. Separate target/evidence reads remain forbidden by regression coverage, and merge ancestry is still checked independently.

## Cutover and live proof

Cutover audit complete before activation: one bounded GraphQL read found five open PRs (#1660, #1670, #1712, #1748, #1749), no GitHub review verdicts, and zero active reviewer refs. Five exact current-head assignment-ref reads, using each PR's linked issue, were all absent. No historical prefix was enumerated and no pre-cutover active lease needed creation.

Live proof on PR #1777's first pushed head succeeded: sequence 454 assigned `glm-5.3` to exact SHA `e2a5a062155ea2498b342fdf1e91846d4ef5692f`; the cursor, active lease, and immutable assignment all pointed to commit `943314fa6d6162317676da3b5e13b79c7bd6a5a3`, and the shared mutex was absent. The first atomic readback was deliberately treated as stale/unknown; an idempotent retry returned the same assignment without advancing. The final amended PR head is assigned again and recorded on the PR before merge so the verdict remains exact-head bound.

## Re-derivation 2026-09-01 (issue #2075): the durable-verdict listing

Ceiling `REVIEW_OPERATION_REQUEST_LIMIT` 23 -> 25 and `REVIEW_MUTEX_SECTION_RESERVE` 14 -> 15. This is a RE-DERIVATION, not a widening: the operation genuinely does one more read on each side of the mutex, and the headroom above the most expensive measured operation is unchanged at 2.

Cause. Every reviewer operation used to answer "does a verdict exist for this head?" by scanning issue comments, PR comments, and PR reviews for a decision word. Issue #2075 is what that costs: a governed review posted its findings, failed to record its create-only artifact, and the surviving comment made the lease look finished in both directions -- replacement and release refused, nothing authorized. `hasVerdictForHead` now reads only the create-only refs under `refs/db-review-verdicts/` and `refs/db-review-verdict-replacements/`.

Why it is exactly two requests. `git/matching-refs` is a plain string-prefix match, so the single shared prefix `refs/db-review-verdict` returns both namespaces in one call, and it answers for every (issue, PR, head) tuple an operation asks about rather than one call per lease. `reviewOperationIo` caches that listing for the rest of the operation, so the pre-mutex half costs one. The post-mutex recheck must not answer from the pre-mutex snapshot -- a verdict landing during mutex acquisition is precisely what it looks for -- so it takes one uncached listing through `__freshDurableVerdictRefs`, memoised for the remainder of the mutex section.

Measured, by the wire-attempt fixtures in `scripts/manage-migration-author-lanes.test.mjs`:

| Operation | Before | After |
|---|---|---|
| Slot-2 assignment, complete | 21 | 23 |
| Slot-2 replacement, complete | 18 | 20 |
| First replacement, pre-mutex | 8 | 9 |
| First replacement, post-mutex section | 10 | 11 |
| Idempotent replacement retry, pre-mutex | 9 | 10 (reduced back to 9 by #2550 batching) |

The mutex entry gate still refuses to acquire the mutex unless the whole mutex-held section fits, and the behavioural test that adds one extra counted pre-mutex call and requires a refusal BEFORE the mutex exists is unchanged and still passes.

Successor verification (2026-09-11, #2697): the current lease-key path remains 28 requests; legacy fallback under parallel mode costs 30 (15 pre-mutex plus 15 held). The silent-reclaim ceiling is derived as 30, with mutex reserve 15. See the successor section of `reviewer-silent-reclaim-api-budget-2026-09-10.md`; the shared ceiling remains 25.
