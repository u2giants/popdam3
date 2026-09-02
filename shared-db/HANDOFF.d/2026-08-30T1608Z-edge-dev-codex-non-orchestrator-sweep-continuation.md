---
issue: 1789
status: OPEN
owner: codex/issue-1789-sweep-handoff
---

# 0. Decisions only the owner can make

None. The owner already authorized completing every eligible repository-maintenance and documentation issue through merge and direct verification, while excluding structural, curated Master Data, application/source-data, and owner-only work. Do not re-ask. Keep #1789 open until a fresh marker resolution and queue audit prove the eligible sweep empty. The live orchestrator has imposed a temporary production freeze; this needs no owner decision, but no merge may occur until that same route sends the exact phrase `PRODUCTION FREEZE RELEASE`.

# 1. What this application is

`u2giants/shared-db` is the governed source of truth for POP Creations' shared database structure, migration tooling, coordination rules, tests, and repository documentation. This workstream is deliberately **not** the live structural orchestrator: it owns only `work_type: repo-maintenance` and `work_type: documentation` issues listed by the queue audit as `REPO-SESSION`.

# 2. What we set out to do this session, and why

Continue issue #1789 and finish all non-orchestrator maintenance/documentation work without absorbing structural, curated Master Data, application/source-data, or owner-only work. The session began from the prior handoff after PR #1804 had been repaired and merged, and continued the queue sweep with isolated branches, full checks, merges, and direct live evidence where applicable.

# 3. Current state — what is true right now

GitHub `main` is at least `e9adafd2a263922f5d7724d7c019ea41b49147da` (PR #1897). Re-fetch before acting because other sessions are active.

Completed in this session segment:

- #1827 closed by PR #1896, merge `de43466349ff50d7ed1d46ad86ab3096423879d4`. The written curated-Master-Data routing rule now says a fork remains outside the orchestrator context but must claim a migration-author lane when it ships `supabase/migrations/*`; all checks and the ephemeral database suite passed.
- #1840 closed by PR #1897, merge `e9adafd2a263922f5d7724d7c019ea41b49147da`. Queue audit now suppresses open structural issues whose closed author claim has a permanently reserved version on current `main` and a merged PR in main history. It iterates to a fixed point so completed work deeper in a collision queue cannot surface after an earlier completed row is removed. All 295 coordination tests and the full GitHub suite passed. Live audit stopped dispatching #1769.
- #1837 closed without a new code change because later merged safeguards already completed it. Live `findPrReviewAssignments(1812,1813,githubIo)` proved assignment sequence 513 remains permanently at `refs/db-review-assignments/1812-1813-fe627a2392b938be5bb5dc59bc95b3b05888dba5-slot2`; the active availability ref overwrite did not erase it. Four focused tests proved moved-head findability, per-head verdict survival, exact-head lease release, and merged-head assignment. Current approval gates require a durable assignment at the same exact head, so sequence 513 cannot authorize the later `f41ed226...` head.
- The live preview orphan cited by #1845 (`20260828113920` -> `20260830013942`) was already reconciled successfully by run `33307904277`. Logs prove preview project `mvpkijzfmfcxhnzqogzs`, check success, and apply success removing only `20260828113920` and retaining replacement `20260830013942`. #1845 remains open because the permanent prevention/reporting defect is not implemented.

Previously completed in the same #1789 sweep and already on main: #1262/#1804, #1235/#1873, #1836/#1878, #1835/#1879, #1830/#1884, #1852 with #1877/#1882/#1885/#1887/#1891, #1816/#1818, #1855/#1841/#1889, #1850/#1892, #1847/#1893, #1843/#1894, and #1844/#1895. Do not redo them; verify live state only if a regression points there.

Clean isolated worktrees intentionally left for continuation, with no uncommitted changes:

- `C:\repos\shared-db-worktrees\issue-1845-preview-orphan`, branch `codex/issue-1845-preview-orphan`.
- `C:\repos\shared-db-worktrees\issue-1833-reviewer-exclusions`, branch `codex/issue-1833-reviewer-exclusions`.
- `C:\repos\shared-db-worktrees\issue-1837-reviewer-attestation`, branch `codex/issue-1837-reviewer-attestation`; issue is closed, so this worktree is cleanup-only after confirming no changes.

The last full audit before PR #1897 used marker #1869, route ID `01a052f3-c9a9-7bf1-a5b0-ea5cd663b6c0`, Codex on EDGE-DEV, and was fully audited with no unclassified, malformed, or unlabelled issues. Re-resolve; that marker can change.

At 2026-08-30 16:09Z, that live orchestrator ordered an immediate shared-db merge freeze while it executes the Albert-authorized #1769 production promotion. It reported that #1895, #1896, and #1897 moved `main` during three exact-head gates, which correctly refused before production. The hold was acknowledged directly to route `01a052f3-c9a9-7bf1-a5b0-ea5cd663b6c0`. Continue branch implementation/checks only; do not merge or otherwise move `main` until the exact release phrase arrives from the current live orchestrator route.

# 4. Everything tried that did not work

- For #1845, a first idea was a reviewed supersession manifest consumed by the preview graph. It was not implemented because silently suppressing an orphan can make the replacement appear absent and invite a duplicate apply unless route selection also performs a safe historical rebind. Do not add a graph-only exception.
- The #1845 hard-coded workflow tuple is duplicated by `SUPPORTED_CASES` in `scripts/preview_ledger_orphan_reconcile.py`. Moving only the shell `case` to data would leave two authorities. A sustainable solution must keep reconciliation safety pins and graph/audit behavior consistent.
- For #1840, checking only the first provisional `dispatchable` list failed live: removing already-authored items exposed #1769 deeper in a collision queue, and it became dispatchable on the second build. The merged fix iterates until stable and checks each exposed issue once.
- Do not detect #1840 by declared object existence alone. #1769 declared only `schema plm`, which existed long before its 26 tables; object existence would create both false completion and false dispatch decisions. The authoritative evidence is closed claim version + migration version on exact current main + merged PR ancestry.
- Do not automatically exclude every reviewer ever assigned to a PR for #1833. Long-lived PRs legitimately need re-review after fixes and would exhaust the roster after a few heads. The missing capability is an explicit, truthful, per-PR unusable disposition or a narrowly justified terminal-failure cooldown, not a blanket historical ban.

# 5. Root causes and key findings

- `scripts/manage-migration-author-lanes.mjs` previously classified dispatchability only from the open issue and live claims. A successful merge normally closes its claim, so completion made an issue look free. PR #1897 now derives completed authoring only for would-be dispatches, preserving the bounded API design.
- `scripts/orchestrator-flow/preview-graph.mjs` treats every preview-only version as a predecessor of every later absent version. The current incident was repaired operationally, but routine future orphans still require source edits in `.github/workflows/preview-ledger-orphan-reconciliation.yml` and `scripts/preview_ledger_orphan_reconcile.py`.
- #1833 remains genuinely open. Current selection in `assignNextReviewerOperation` uses only eligible roster, live busy leases, and same-head earlier-slot exclusion. It cannot record “unusable for this PR” without lying that the provider failed. Existing durable assignment/ref behavior should be preserved.
- #1824 also remains genuinely open. Authenticated comments and exact-head assignment gates fixed false approvals, but the review wrapper still does not atomically emit a create-only durable verdict ref with findings digest, assignment parentage, reviewer identity, and lease proof.

# 6. Exact next steps

1. Re-resolve the live marker. If `PRODUCTION FREEZE RELEASE` has not been sent by that current route, continue branch work and checks but merge nothing. In a fresh isolated checkout of current `origin/main`, run `node scripts/check-orchestrator-marker.mjs --resolve`, then `node scripts/manage-migration-author-lanes.mjs --queue-audit`. Verify the audit is fully classified and use only `REPO-SESSION` rows. You will know this worked when the marker is current and the audit has no unclassified/malformed/unlabelled rows.
2. Confirm PR #1897 is still merged and #1840 closed; confirm #1769 is absent from `dispatchable` in the fresh main audit. You will know the regression remains fixed when #1769 appears as `authored-on-main`, never in `REFILL REQUIRED NOW`.
3. Continue #1845 in its isolated worktree. Design one authority for reviewed reconciliation cases, consumed by both the workflow and Python reconciler, and make queue audit surface a fresh preview-only orphan immediately. If graph suppression is added, route selection must safely rebind equivalent replacement evidence and must never reapply bytes. Add a known-orphan positive control that goes red before the repaired case goes green. You will know it worked when the known orphan is reported immediately, the reconciled live ledger is clean, malformed/unproved supersession is refused, and all graph/selector/reconciler/manager tests pass.
4. Continue #1833 separately. Prefer a durable, explicit per-PR reviewer exclusion/disposition that records who/what/why and is consumed under the reviewer mutex; never fabricate a failure. Preserve idempotency and loud roster exhaustion. Add tests for already-reviewed provider, recent terminal failure if implemented, same-head retry, head movement, and all-reviewers-excluded refusal. You will know it worked when the two issue incidents select a clean provider or refuse with named reasons, without a false failure record.
5. Implement #1824 in its own branch after understanding the wrapper entrypoints. Verdict refs must be create-only, exact-head, assignment-parented, reviewer/slot matched, lease-held at write time, and findings-digest verified. Both exact-head merge and preview gate must consume the same durable object. You will know it worked when deleting each guard causes a regression test to fail and a real review with no verdict ref is refused.
6. Continue remaining `REPO-SESSION` issues one isolated branch at a time, prioritizing current high-priority items (#1851, #1831, then older issues after re-audit). Close an issue only after merge/live proof. Do not touch owner-only, curated, structural, application-data, or source-data rows.
7. Keep #1789 open. Only close it after a fresh marker resolution and queue audit show no eligible repo-maintenance/documentation work remains, including blocked rows whose blockers have cleared. You will know the sweep is complete when every remaining non-orchestrator row is legitimately excluded by scope/owner/blocker and no executable `REPO-SESSION` issue remains.

# 7. Constraints and gotchas in force

- Read `AGENTS.md`, root `HANDOFF.md`, this handoff, then re-fetch live GitHub. Handoffs are context, never current proof.
- Use isolated `codex/` branches and worktrees. Never modify the shared checkout to implement work.
- Never absorb structural work, curated Master Data, application/source-data, or owner-only security/settings work. The live orchestrator alone owns structural routing.
- Preserve exact-head, unauthorized-by-default, lease, mutex, collision, and API-budget guards. Do not fix throughput by weakening safety.
- Documentation-only PRs merge immediately with admin squash after checking every changed file is prose. Any script/config/workflow/test change requires normal checks.
- Before each commit run `git var GIT_COMMITTER_IDENT`; it must be `Albert Hazan <u2giants@users.noreply.github.com>`.
- Do not replay applied migrations or manually mutate coordination refs/ledger rows. Preview and production lanes remain serialized and governed.
- Production completion means direct target/catalog verification, not a green run alone.
- #1789 must remain open until the entire eligible sweep is freshly audited complete.
- Temporary production freeze: merge nothing and do not otherwise move `main` until the current live orchestrator sends the exact phrase `PRODUCTION FREEZE RELEASE`. Re-resolve the marker before trusting the sender.

# 8. Access and environment

- Machine: EDGE-DEV (`C:\repos\shared-db`). PowerShell is the default shell.
- GitHub CLI is authenticated as `u2giants`; GitHub is the source of truth.
- For Git-Bash-only checks use `C:\Program Files\Git\bin\bash.exe`, not bare `bash`.
- Database secrets remain in the configured GitHub Actions/1Password `vibe_coding` paths; never print or copy values. Preview project ref observed in governed evidence: `mvpkijzfmfcxhnzqogzs`. Production ref is different and must never be inferred from preview.
- No sub-agents were used in this session segment.

# 9. Open questions and risks

- #1845 design risk: an orphan marker that merely removes a dependency edge can cause replacement bytes to be reapplied. The solution must connect reconciliation evidence to route selection, or limit itself to immediate reporting plus a sustainable single-source reconciler.
- #1833 design risk: automatic “ever reviewed this PR” exclusion can permanently exhaust reviewers on iterative fixes. Prefer explicit dispositions with immutable evidence and clear expiry/scope.
- #1824 security claim: repository writers can forge refs. The achievable property is tamper-evidence and an ordinary governed path that writes the verdict before returning it, not impossible forgery.
- The structural orchestrator and other repository sessions continue to move `main`; every exact-head finding, marker, audit, and check can become stale after a merge.

## Self-audit

1. Yes: sections 1–3 define the repository, scope, completed merges, live evidence, and exact unfinished state for a newcomer.
2. Yes: sections 4–5 preserve the failed approaches and non-obvious findings needed to continue at the same level.
3. Yes: sections 6–9 provide ordered actions with verification gates, constraints, access, and risks; exact PRs, SHAs, run IDs, refs, branches, and paths are included.
4. Yes: section 0 states there are no new owner decisions and records the already-settled authorization not to re-ask. A line-by-line review of sections 1–9 found no additional owner judgement required.
