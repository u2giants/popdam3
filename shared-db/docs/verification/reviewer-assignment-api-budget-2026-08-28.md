# Reviewer assignment API-budget verification — 2026-08-28

Issue: #1767. Scope: repository coordination only; no database, preview, production, or application data changes.

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
| Idempotent replacement retry, pre-mutex | 9 | 10 |

The mutex entry gate still refuses to acquire the mutex unless the whole mutex-held section fits, and the behavioural test that adds one extra counted pre-mutex call and requires a refusal BEFORE the mutex exists is unchanged and still passes.
