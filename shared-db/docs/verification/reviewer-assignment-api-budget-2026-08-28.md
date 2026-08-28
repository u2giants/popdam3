# Reviewer assignment API-budget verification — 2026-08-28

Issue #1767 replaces permanent-history availability scans with a five-reviewer live lease index.

## Rerunnable checks

- `node --test scripts/manage-migration-author-lanes.test.mjs`
- `git diff --check`
- `ai-codex-review diff-review`

The focused manager suite passed 211/211 tests and the full required coordination suite passed 369/369 before landing. The scale fixture supplies 10,000 historical assignments and proves availability never lists the permanent assignment prefix. Budget tests prove quota failure occurs before owner-commit or mutex creation, every retry consumes the 19-request assignment ceiling, the evidence-heavy replacement path has a separate 39-request ceiling, cleanup reserve is available before the final mutex read, and unreadable live evidence fails closed.

The independent review found two high-risk gaps during implementation: stale lease state was not refreshed under the mutex, and activation had no executable path. Both were repaired. Stale candidates now receive a fresh batched state read under the mutex before deletion. Activation is an explicit bounded CLI operation that requires the exact issue, PR, and 40-character head for every currently open PR and rolls back partial active refs.

## Cutover evidence

The final cutover audit found five open PRs: #1660/#1658, #1712/#1684, #1748/#1722, #1749/#1645, and #1670/#778. Their exact heads matched the explicit command inputs, and no exact-head reviewer assignment ref existed for any of them. Activation therefore created zero active leases and the durable `refs/db-coordination/reviewer-index-cutover` marker. Live readback proved the marker exists, the active-ref count is zero, and the shared mutex count is zero. The command refuses if the open set or any head changes, creates live leases only for exact existing assignments, and rolls back partial active refs.

No database, preview, production, licensed data, historical reviewer evidence, or reviewer policy is changed.
