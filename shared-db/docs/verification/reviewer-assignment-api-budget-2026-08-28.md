# Reviewer assignment API-budget verification — 2026-08-28

Issue: #1767. Scope: repository coordination only; no database, preview, production, or application data changes.

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

## Cutover and live proof

Cutover audit complete before activation: one bounded GraphQL read found five open PRs (#1660, #1670, #1712, #1748, #1749), no GitHub review verdicts, and zero active reviewer refs. Five exact current-head assignment-ref reads, using each PR's linked issue, were all absent. No historical prefix was enumerated and no pre-cutover active lease needed creation.

Live proof on PR #1777's first pushed head succeeded: sequence 454 assigned `glm-5.3` to exact SHA `e2a5a062155ea2498b342fdf1e91846d4ef5692f`; the cursor, active lease, and immutable assignment all pointed to commit `943314fa6d6162317676da3b5e13b79c7bd6a5a3`, and the shared mutex was absent. The first atomic readback was deliberately treated as stale/unknown; an idempotent retry returned the same assignment without advancing. The final amended PR head is assigned again and recorded on the PR before merge so the verdict remains exact-head bound.
