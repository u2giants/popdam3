---
issue: 1723
status: OPEN
owner: codex/orchestrator-1697-closeout
---

# Orchestrator #1697 Path B handover

## 0. Decisions only the owner can make

### Blocking

- **#1671 database identity proof:** authorize a read of only the develop and staging database host/user identity fields (not passwords), or provide an approved non-secret project-reference assertion. Recommendation: authorize the identity-only read. This blocks applying the already-authored DesignFlow copy-column migration to either non-production target. The issue is labelled `needs-albert`.

### Already settled — do not re-ask

- Kimi must not be invoked before `2026-08-28T18:47:39Z`; its usage limit is expected to reset then.
- No licensed Property rows or private evidence may enter this public repository, GitHub issues, logs, commits, PRs, or outside-review prompts.
- Curated Master Data uses the governed curated route; structural changes use the sole orchestrator.

## 1. What this application is

`u2giants/shared-db` is the public source of truth for the shape of POP Creations' shared databases. One orchestrator owns structural routing at a time. Applications own ordinary row writes; outside-sourced writes to curated `core.*` Master Data remain governed. Preview is the shared rehearsal database and production changes require exact-target proof and governed evidence.

## 2. What we set out to do this session, and why

The owner asked the orchestrator to advance #1684, #1676, #1669, #1671, #1662, #1658, #1607, #1657 and #1645 concurrently, keep #1322 queued, and later dispatch curated #1719. The session also accepted structural dependencies #1713 and #1720. The goal was to clear blockers for other active sessions without leaking licensed data or weakening database governance.

## 3. Current state — what is true right now

Moving facts were checked `2026-08-28T01:48:07Z`: `origin/main` was `9bcbd305251c3739b845ce84744e13f5be031da5`; the maximum migration on that exact tree is `20260827232631`. Marker #1697 was the sole resolved marker. All three local sub-agents were interrupted for this handover. The recurring continuation heartbeat was deleted.

### Finished and verified

- #1607 completed earlier in this orchestrator run.
- #1662: PR #1700 promoted and production verified.
- #1676: PR #1707, merge `4025647d7d2f5c709e812d4ffd646e6dd8b1b9fb`, migration `20260827224547`; preview run 33126006025; production run 33126702528; catalog, RLS and privileges verified.
- #1684 Phase 1: PR #1701, merge `14b9dfde7f894997347832a9dae485714f0bebba`, migration `20260827222039`; preview 33123336538; production 33123588245.
- #1467: PR #1585, migration `20260827183106`; preview reconciliation 33128840004, rehearsal 33128989616, production 33129594947; production index absence and ledger presence verified directly.
- #1657: PR #1715, merge `24cd9176ab31d6f838c8686f55a2eb4458e53073`, migration `20260827232631`; preview 33130426545; production 33132089067; both indexes and ledger verified directly.

### Outstanding work — each remains an open `db-work` issue

- **#1684 Phase 2 / PR #1712 / claim #1711:** live worktree `C:\repos\shared-db-worktrees\issue-1684-character-separation`, branch `codex/issue-1684-character-separation`, head `13cddc0295e551f3d94875519ac16b1ea2973582`. Its migration `20260827224649` is now older than main's `20260827232631`; atomically supersede the active claim to a newly reserved version before any preview action.
- **#1713 / PR #1718 / claim #1717:** live worktree `C:\repos\shared-db-worktrees\issue-1713-creative-submission-resolution`, branch `codex/issue-1713-creative-submission-resolution`, head `96dba8f81d500b612184ecf39070f7ea50d81a01`, migration `20260828003806`. CI was green. Obtain a durable governed exact-head review, then preview, merge and production promotion. This is a private-resolution structure only; do not place licensed labels or rows in public evidence.
- **#1719 + structural #1720:** the curated two-row exact-name insert changed zero rows and rolled back safely because `core.licensor.licensor_code_key` currently treats multiple NULL codes as duplicates. #1720 must first change only the constraint to allow multiple NULLs while retaining non-NULL uniqueness. A clean worktree exists at `C:\Users\ahazan\.codex\worktrees\issue-1720\shared-db`; no claim or migration was created. After #1720 production verification, resume #1719 with exact-name matched-row abstention and NULL codes. Never expose licensed Property rows.
- **#1658 / PR #1660 / claim #1659:** branch `codex/issue-1658-opa-authority-1649`, head `8a3657828686155694f02f18e60e1a1169bedd9b`, migration `20260827214517`. Blocked on repo-maintenance #1709 adding the exact preview-ledger reconciliation allowlist. After #1709 lands, refresh to main, obtain exact-head review, reconcile orphan `20260827134155`, rehearse, merge and promote.
- **#1645:** PR #1664 already merged migration `20260827183011`, but it is stranded after rehearsal and claim #1656 remains held. Repo-maintenance #1692 must add an atomic merged-stranded-claim reissue path; then reserve a successor version and repeat governed evidence before production.
- **#1669:** blocked on #1658 production, #1713 production, and the private sanitized loader/source-coverage proof. #1676 supplies only contract evidence. Keep the public issue free of licensed values.
- **#1671 (`needs-albert`):** migration `20260817150944` is authored but cannot be applied until the owner decision in section 0 proves the develop and staging targets are not an unsafe database.
- **#1322:** still open and queued. It is repository-maintenance/application behavior for the DB Data Admin Property active/inactive control, not a structural author lane.
- **#1709 and #1692:** repository-maintenance prerequisites, deliberately not worked inside the structure-only orchestrator.

### Preview state

Preview is not described as clean. It contains the successful rehearsals listed above plus the failed-but-rolled-back #1684 Phase 2 dry run 33128685066. #1658 also has an orphan preview ledger version `20260827134155` awaiting the guarded reconciliation in #1709. Re-derive the live preview ledger before the next rehearsal.

### Checkout state

The shared checkout contains extensive pre-existing modified and untracked files belonging to other sessions, including `AGENTS.md`, licensing rules, `.ai/`, `.agents/`, `tmp/`, and many old worktrees. None were cleaned or staged. The two active author worktrees above and the clean #1720 worktree are deliberately left resumable. Finished historical worktrees were not removed because the marker remained open and this closeout did not establish that every tree was clean and safe to retire.

## 4. Everything we tried that did not work

- #1684 Phase 2 preview dry-run 33128685066 failed safely because a guard interpreted a trigger on a table being dropped; the migration was adjusted, but later main advanced past its reserved version. Renaming the file or claim separately is forbidden; use the atomic supersession path.
- Muse sequence 440 and GLM sequence 442 did not yield a durable #1684 exact-head verdict. Do not treat them as approval.
- #1713's Grok sequence 441 approved locally, but its durable manager assignment was tied to an older head. Rebind a reviewer to the exact current head.
- The #1719 curated insert attempted two NULL licensor codes in one transaction. The NULLS-NOT-DISTINCT uniqueness constraint rejected the second; the transaction rolled back and post-checks showed zero inserted rows. Do not invent codes or insert one row at a time.
- #1658 cannot use manual ledger deletion or migration renaming. Its orphan/replacement pair must go through #1709's guarded allowlist and reconciliation confirmation.
- GitHub API throttling blocked the final #1684 atomic reversion and #1720 claim. Git transport remained usable, but that is not permission to split an atomic governed operation.

## 5. Root causes and key findings

- Concurrent merges can advance main beyond a reserved migration version; active claims must be superseded atomically.
- The licensor code uniqueness constraint uses NULLS NOT DISTINCT, so two legitimate unknown codes cannot coexist. The structural fix belongs in #1720; curated values stay in #1719.
- #1645 exposes a systemic producer-path pin problem: a successfully merged migration can become stranded before production after unrelated main movement.
- #1671's target cannot be inferred from port or environment name. Exact database identity must be proven without exposing password material.
- The repo's shared checkout and worktree inventory are heavily concurrent. Cleanup based only on ancestry would be unsafe because squash merges rewrite commits.

## 6. Exact next steps

1. A successor opens a new orchestrator marker with its own route ID, resolves it, fetches main, reruns queue audit, and rechecks all PR heads. Success is a sole clean resolution naming the successor.
2. Claim #1720, author the constraint-only migration, prove multiple NULLs and duplicate non-NULL rejection, obtain exact-head review, rehearse, merge and promote. Success is production catalog proof with no row changes.
3. Resume curated #1719: exact-name abstention check, insert the two owner-confirmed licensor names with NULL codes in one transaction, and verify production. Success is exactly two intended licensor rows and no public licensed Property evidence.
4. Atomically supersede #1684 claim #1711 and migration `20260827224649`, push the pure rename plus claim update, rerun CI and exact-head review, then preview/merge/production. Success is the separate canonical Property/Character contract verified in production.
5. Rebind #1713's reviewer to the current head, then preview/merge/promote. Success is production catalog and policy proof without licensed values in public artifacts.
6. Advance repo-maintenance #1709, then finish #1658's governed ledger reconciliation and promotion. Success is the replacement migration applied and the orphan handled without deletion.
7. Advance repo-maintenance #1692, then reissue and promote #1645. Success is a new governed version in production and claim #1656 released.
8. After #1658 and #1713 plus the private loader evidence are complete, finish #1669. Success is the public API structure verified without private row disclosure.
9. Obtain the one #1671 owner decision in section 0, prove both non-production targets, and only then apply. Success is exact target evidence and successful non-production verification.
10. Route #1322 to a repository-maintenance session. Success is implementation and live DB Data Admin verification without consuming a structural lane.

## 7. Constraints and gotchas in force

- One open orchestrator marker only; every successor uses a new route ID.
- Structure work happens in isolated author worktrees with exact object claims. Preview/merge/production gates are serialized.
- Do not invoke Kimi before `2026-08-28T18:47:39Z`.
- No licensed Property rows, private evidence, or secrets in public artifacts or external reviewer prompts.
- Never invent licensor codes; matched curated rows cause abstention rather than overwrite.
- Never manually rename a claimed/applied migration or delete a non-replayable ledger row.
- Prove the exact database target immediately before every write.
- Preserve all unrelated dirty files and unexplained worktrees.

## 8. Access and environment

GitHub CLI and git were authenticated at closeout. Production/preview workflows and the approved read-only database path were usable earlier in the session. Secrets remain in the `vibe_coding` 1Password vault; no secret values belong in this file. The secrets sweep found no new credential or connection string introduced by this orchestrator. Current machine is `edge-dev`, repository `C:\repos\shared-db`.

## 9. Open questions and risks

- #1671 has the sole known owner decision; it is consolidated in section 0.
- Main, PR heads, checks, claims and database ledgers are moving facts; all quoted values must be refreshed before action.
- The shared checkout has many pre-existing untracked files and worktrees; the next session must not assume they belong to this handover or clean them broadly.
- Preview's orphan state can invalidate later rehearsals until #1709 reconciliation completes.
- Docs pass: nothing outside this handover was found to be made stale by this session.

# Part B — sub-agent state

### Agent: Hegel / `C:\repos\shared-db-worktrees\issue-1684-character-separation`

- **Asked to do:** resume and finish #1684 Phase 2.
- **Actually did:** brought PR #1712 to head `13cddc0295e551f3d94875519ac16b1ea2973582`; 216/216 local guard tests and failed-ledger preflight passed.
- **Found:** main's `20260827232631` now exceeds reserved `20260827224649`; the static guard correctly refuses it.
- **PR / branch:** #1712 / `codex/issue-1684-character-separation` / claim #1711.
- **Worktree:** live and resumable.
- **Deliberately did NOT do, and why:** did not separately rename the migration or mutate the claim while GitHub was throttled; the change must be atomic.

### Agent: Ptolemy / `C:\repos\shared-db-worktrees\issue-1713-creative-submission-resolution`

- **Asked to do:** advance the private Creative-to-Submissions resolution structure blocking #1669.
- **Actually did:** produced PR #1718 at `96dba8f81d500b612184ecf39070f7ea50d81a01`, migration `20260828003806`; CI green.
- **Found:** local Grok approval was not durably bound to the final head.
- **PR / branch:** #1718 / `codex/issue-1713-creative-submission-resolution` / claim #1717.
- **Worktree:** live and resumable.
- **Deliberately did NOT do, and why:** did not expose licensed labels or proceed to preview without a durable exact-head governed review.

### Agent: Laplace / `C:\Users\ahazan\.codex\worktrees\issue-1720\shared-db`

- **Asked to do:** establish the structural dependency needed for curated #1719.
- **Actually did:** documented #1720 and prepared a clean branch/worktree; no migration, claim, preview or production change.
- **Found:** `licensor_code_key` blocks two NULL codes because it is NULLS NOT DISTINCT; the curated transaction rolled back with zero rows changed.
- **PR / branch:** no PR; branch `codex/issue-1720-licensor-null-codes` at the pre-authoring base.
- **Worktree:** live and clean.
- **Deliberately did NOT do, and why:** did not invent codes, disclose private data, or author without a claim while the API was throttled.

# Self-audit

1. **Yes:** sections 1–9 define purpose, exact state, failures, findings, executable gates, constraints, access and risks; a new developer can continue without chat context.
2. **Yes:** exact issue, PR, claim, branch, worktree, head, migration and workflow identifiers are preserved, plus one separated block per agent.
3. **Yes:** completed delivery, preview/production state, failed attempts, decisions, privacy constraints, next actions and verification criteria are all explicit.
4. **Yes:** the only owner-dependent sentence found in sections 1–9 and Part B is the #1671 identity authorization; it appears first in section 0 with a recommendation and consequence. Kimi and privacy rulings are recorded as already settled.

Secrets sweep: completed, nothing new. Docs pass: nothing outside this handover is stale. Queue seed: every outstanding item named above already has an open `db-work` issue; #1671 now also has `needs-albert`. Finished worktrees were deliberately not cleaned because their broader ownership and dirtiness were not safely established.
