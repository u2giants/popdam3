---
issue: 1789
status: OPEN
owner: codex/issue-1789-closeout-20260829
---

# Non-orchestrator repository-maintenance sweep continuation

## 0. Owner decisions and external blockers

- Keep issue #1789 open. The repository-maintenance sweep is not complete.
- Issue #1663 remains blocked by Supabase reporting the production default branch as `MIGRATIONS_FAILED` even though the direct production ledger audit is clean. Continue read-only diagnosis. Any production setting mutation requires Albert's exact authorization.
- Owner-only items remain outside this session: #1353 (non-production applications bound to production Supabase), #870 (atomic ordered-batch recovery policy), and #696 (Uma-owned production catalog decision). Do not absorb them.
- Structural work, curated Master Data, application/source-data work, and the live schema orchestrator remain outside this session.

## 1. Scope and governing contract

Continue issue #1789 as the separate repository-maintenance/documentation session. Re-read `AGENTS.md`, root `HANDOFF.md`, this handoff, and the predecessor `HANDOFF.d/2026-08-28T2258Z-edge-dev-codex-non-orchestrator-issue-sweep.md`. Before every action, fetch GitHub, resolve the live orchestrator marker, and rerun the queue audit. Work only repo-maintenance/documentation issues in isolated branches, add regression tests for code changes, merge owned PRs, and verify production directly when an issue makes a production claim.

## 2. Live coordination state at closeout

- Last resolved marker: issue #1786, Claude session `shared-db.orch EDGE-DEV worktree-3feb07`, route `local_c1427a16-d952-4c64-9a44-9ee637469b2e`, handover #1764. This is only a fresh routing declaration; re-resolve it.
- The latest queue audit was not fully audited. Unclassified: #1816, #1814, #1812. Malformed included #1817, #1772, #1693, #1671, #974, #748, #718, #652, #552, and #508.
- Latest repo-session worklist: #1798, #1789, #1690, #1689, #1688, #1663, #1435, #1403, #1391, #1356, #1322, #1286, #1285, #1262, #1235, #1224, #1223, #1201, #1182, #1161, #1158, #1031, #943, #880, #810, #771, #770, #620, and #519.
- Rejections/non-sweep: #1681 belongs to `popcre/designflow-backend`; #1661 belongs to `u2giants/licensor-source-data`. Curated Master Data: #933, #640, #562, #505.

## 3. Completed and verified work

- Issue #1268 was fixed, tested, merged in PR #1802, and closed. Merge commit: `e4bae96748426665fba8e25669ffd8cbdfd38581`. The guard now permits ignored Supabase CLI machine state while preserving committed runtime-surface detection; regression coverage and the truth-audit inventory moved together.
- A direct read-only production ledger check found 558 versions on main, 540 applied, and 18 intentionally retired/held: no actionable drift. Issue #1675 was closed with sanitized evidence.
- Issue #1663 was kept open after the live Supabase Management API still returned `MIGRATIONS_FAILED`; no production setting was changed.
- #1258 was correctly reclassified structural/blocked. #1235 was moved to ready after its dependencies closed. #1694 was closed as a superseded stale umbrella.
- Scope/classification repairs were made on #1798, #1690, #1689, #1688, #1769, #1681, #1675, #1663, and #1661. The latest audit still identifies the malformed items listed in Section 2; do not assume attempted edits repaired them.

## 4. In-progress work and failed approaches

- PR #1804 for issue #1262 is open at head `d002a04addec04a3bbbf6b86f7dd01a5b0958194`. It removes blanket licensing authorization from database contract tests, makes legitimate legacy contracts opt in by exact filename, and adds a regression test proving guard/refusal tests remain unauthorized by default.
- Its latest ephemeral-database run #33220312478 failed. The log's terminal candidate-defect list names `db_data_admin_read_contracts.sql`, `dam_order_list_contract.sql`, and `wb_grants_rls_and_dam_order_list_invoker.sql`; inspect the complete per-test results/artifact before changing the allowlist. Preserve valid legacy behavior and the refusal guard together.
- The first #1262 attempt removed all default authorization and exposed ten legitimate legacy contracts. The exact-file allowlist is deliberate; do not restore a blanket wrapper authorization.
- A clean worktree exists at `C:\repos\shared-db-worktrees\issue-1235-expected-count-guard` on branch `codex/issue-1235-expected-count-guard`, but it has no changes. Re-fetch before using it.
- PowerShell `bash` invoked WSL on this machine. Use `C:\Program Files\Git\bin\bash.exe` for Git-Bash checks.

## 5. Durable findings

- GitHub/main/live systems are proof; handoffs are only context.
- Claims and worker capacity are separate. Never free or overwrite a protected structural claim from this repo-maintenance session.
- Production completion needs direct target/catalog evidence. A merge, green preview, table existence, or successful command alone is insufficient.
- Queue repairs must preserve valid scope facts. Duplicate or malformed scope blocks are hard failures; edit the issue body deliberately and rerun the audit.
- Test repair must keep legitimate legacy setup through a small auditable allowlist while guard/refusal tests default to unauthorized.

## 6. Exact next actions and verification gates

1. Fetch GitHub, resolve the marker, rerun `node scripts/manage-migration-author-lanes.mjs --queue-audit`, and save the fresh worklist. Gate: no action based solely on Section 2.
2. Finish PR #1804 first. Inspect run #33220312478 and artifact #9704951839, identify every failing contract, change only the explicit authorization list or the owned regression test as evidence supports, run the focused Node test and full relevant suite, push, wait for all code checks, merge, confirm the merge commit, and close #1262 only with passing evidence.
3. Classify #1816, #1814, and #1812 and repair malformed repo-maintenance/documentation issues. Route structural items to the orchestrator, application/source-data items through their guarded return path, and owner-only items to Albert. Gate: queue audit parses each changed issue cleanly.
4. Continue ready repo-session issues in isolated branches, starting with #1235 only if the fresh audit still classifies it ready. One issue per branch/PR unless the issue itself proves a single inseparable change. Code changes require regression tests and green checks; prose-only PRs merge immediately with admin after verifying the file list.
5. For any production claim, prove the exact target and verify the resulting catalog/service state read-only. Never mutate production settings or database structure from this session.
6. Close #1789 only after a fresh audit shows no actionable repo-maintenance/documentation item and every completed issue has merged and, where applicable, direct production proof. Then retire both sweep handoffs using the handoff-writer rules.

## 7. Non-negotiable guardrails

- Do not perform structural/schema work, curated Master Data work, owner-only work, or routine application/source-data work.
- Do not edit the root `HANDOFF.md` or another session's handoff.
- Use isolated `codex/` branches and stage only owned files. Preserve unrelated dirty worktrees.
- Never weaken, disable, bypass, or replace a guard to make a check pass. Preserve the capability and prove it still works.
- Never expose secrets, project refs, licensed rows, or private evidence in logs, issues, commits, PRs, or handoffs.

## 8. Authentication and environment

- Repository: `C:\repos\shared-db`; GitHub identity: `u2giants`.
- Committer identity verified at closeout: `Albert Hazan <u2giants@users.noreply.github.com>`.
- Use authenticated `gh` for GitHub. Use 1Password vault `vibe_coding` only through protected pipes/files when a credential is required; serialize access and never print values.
- Use the production-bound read-only route for production verification and prove the target immediately before any permitted operation.

## 9. Risks and closeout audit

- Highest immediate risk: broadening #1262's authorization allowlist until tests turn green, which would recreate the false-positive defect.
- Queue state changes rapidly while the structural orchestrator and other sessions work. Re-fetch and re-audit before every issue.
- #1789 is an umbrella proof issue, not permission to absorb other ownership classes.

Self-audit: (1) Every unfinished item has an exact next action and verification gate in Section 6. (2) All owner/external blockers are grouped in Section 0. (3) Failed approaches and the current failing CI evidence are in Section 4. (4) Scope, branch discipline, authentication, production boundaries, and secret handling are explicit in Sections 1, 7, and 8.
