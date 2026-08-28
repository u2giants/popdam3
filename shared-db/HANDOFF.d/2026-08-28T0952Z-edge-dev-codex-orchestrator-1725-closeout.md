---
issue: 1735
status: OPEN
owner: codex/orchestrator-1725-closeout
---

# Orchestrator #1725 Path B handover

## 0. Decisions only the owner can make

### Blocking

- **#1671 non-production database identity:** authorize a read of only the develop and staging database host/user identity fields, not passwords, or provide an approved non-secret project-reference assertion. Recommendation: authorize the identity-only read. This blocks applying the already-authored DesignFlow copy-column migration to either non-production target. #1671 already carries `needs-albert`.

### Already settled — do not re-ask

- #1609's FK design was settled on 2026-08-27. Its remaining Universe B target question is carried by #1238; do not add `needs-albert` back to #1609 for the settled FK question.
- #1353 was de-escalated on 2026-08-27: DesignFlow production is Cloud SQL, while dev, staging and sandbox share a non-production Supabase project. It is not an owner-blocking production risk; do not add `needs-albert` back.
- Never expose licensed rows or private source evidence in this public repository, GitHub, logs, commits, pull requests, or outside-review prompts.
- Never replay a non-replayable migration or delete its ledger row.

The next session should put the complete blocking list above to Albert in one message before attempting #1671. No other item in this handover needs an owner decision.

## 1. What this application is

`u2giants/shared-db` is the public source of truth for the shape of POP Creations' shared databases. One orchestrator owns structural routing at a time. Structural changes use isolated author worktrees and exact object claims; preview, merge and production gates are serialized. Applications own ordinary row writes, while outside-sourced writes to curated `core.*` Master Data remain separately governed.

## 2. What we set out to do this session, and why

Albert asked this orchestrator to keep five structural lanes occupied and prioritize #1658, #1662, #1676, #1684, #1669, #1645, #1722, #1692, #1656, #1657 and #1703. This session inherited marker #1697's work, finished the private-resolution structure #1713, advanced #1720 and #1646 through governed production gates, repaired #1722 intake, and preserved every blocked claim rather than weakening recovery rules.

## 3. Current state — what is true right now

Moving facts were checked at `2026-08-28T09:51:38Z`. `origin/main` was `49d4aa4793db51f5caca56562a4a83d18b6b6181`; the maximum migration on that exact tree was `20260828030532`. Marker #1725 was the sole resolved marker. Queue audit showed 5/5 author lanes occupied, zero empty lanes and no dispatchable structural item. No current preview, merge or production exclusive ref was present. Old queued workflow runs exist, but no current deployment run was in progress.

### Finished and verified this session

- **#1713:** PR #1718 merged as `9b851ddbd9c9d2175666cf4dbce03e3f6e730cd7`, migration `20260828003806`. Preview recovery run 33137736435, production evidence 33137918854, dry-run 33137955955 and production apply 33138027160 succeeded. Production catalog verification passed; issue and claim #1717 were closed/released. No licensed values entered public evidence.
- **#1676 and #1657:** inherited as production-complete. #1676 production run 33126702528; #1657 production run 33132089067. Their issues are closed.
- **#1722 intake:** its missing machine-readable scope was repaired. It is eligible only after dependency #1657 and a lane opening; no claim or migration was created.

### Outstanding structural work — each has an open `db-work` issue

- **#1720 / claim #1726 / PR #1727 merged:** migration `20260828021051` was previewed and applied to production in run 33139377193. The ledger and constraint apply succeeded, but the run ended red because the catalog lexer derived no object from constraint-only guarded SQL. Do not replay. Repo-maintenance #1732 must add a strict hash-bound read-only catalog recovery contract, then run recovery and close #1720. Worktree: `C:\Users\ahazan\.codex\worktrees\issue-1720\shared-db`; branch `codex/issue-1720-licensor-null-codes`.
- **#1646 / claim #1730 / PR #1731 merged:** migrations `20260827095753` and `20260828030532` were previewed and reviewed. Production run 33140236764 stopped before any database write because the original preview commit is not an ancestor of exact main after governed supersession. Repo-maintenance #1733 must teach the risk gate to validate the supersession evidence; then recover and promote the ordered pair. Worktree: `C:\repos\shared-db-worktrees\issue-1646-admin-clear-domain`; branch `codex/issue-1646-admin-clear-domain`.
- **#1684 Phase 2 / PR #1712 / claim #1711:** branch `codex/issue-1684-character-separation`, worktree `C:\repos\shared-db-worktrees\issue-1684-character-separation`, head `95e298f538f3243fe1f0dae89d277ef7ec55f186`, old version `20260827224649`. Atomic supersession is blocked because the manager rejects removal of a non-migration test file before filtering. Repo-maintenance #1729 owns that repair. Phase 1 migration `20260827222039` is already production-complete.
- **#1658 / PR #1660 / claim #1659:** branch `codex/issue-1658-opa-authority-1649`, worktree `C:\repos\shared-db-worktrees\issue-1658-1649`, head `8a3657828686155694f02f18e60e1a1169bedd9b`, migration `20260827214517`. It remains blocked on repo-maintenance #1709 for guarded orphan reconciliation. Queue audit also cannot prove dependency #1655 because #1655 is a pull request, not a work issue. Never delete the orphan ledger row or rename the migration manually.
- **#1645 / claim #1656:** the merged/previewed version `20260827183011` must never be promoted or rehearsal-reset. Repo-maintenance #1692 must provide atomic merged-stranded-claim reissue and hard retirement, after which a new governed version can be rehearsed and promoted. Worktree `C:\repos\shared-db-worktrees\issue-1645-effective-filters-1649` remains live.
- **#1662 production / #1736:** PR #1700 merged migration `20260827213024` and previewed it, but #1662's closing comment explicitly left production promotion separate. #1736 is the newly seeded production item. Re-derive both ledgers and promote only through the governed serialized path.
- **#1669:** remains blocked on #1658 production and private loader/coverage proof. #1713 and #1676 structural predecessors are complete. Keep licensed source values private.
- **#1703:** overlaps `public.get_filter_counts` and remains blocked behind #1645/claim #1656.
- **#1722:** covering-index follow-up is open and scope-correct, but cannot start while all five lanes are occupied.
- **#1671 (`needs-albert`):** authored DesignFlow copy-column migration remains blocked on the single identity-only owner authorization in section 0.

### Repository-maintenance blockers deliberately not worked or dispatched

- #1692, #1709, #1729, #1732 and #1733 are open `db-work` issues owned by separately started repository sessions. The structural claims depending on them remain locked. This orchestrator neither implemented nor dispatched repository-maintenance work.

### Preview state

Preview is not clean. It contains successful rehearsals for migrations `20260827213024`, `20260827214517`, `20260827224649`, `20260828003806`, `20260828021051`, `20260827095753` and `20260828030532`, plus inherited applied work. #1658 also has orphan ledger version `20260827134155` awaiting #1709. Re-derive the live preview ledger before any rehearsal; this list describes known session history, not a current database query.

### Checkout and worktree state

The shared checkout has extensive pre-existing modified and untracked files owned by other sessions, including `AGENTS.md`, licensing rules, `.ai/`, `.agents/`, `tmp/`, and many historical worktrees. None were staged, cleaned or changed by this closeout. Live claimed worktrees are listed above. The merged #1713 worktree is finished and safe to assess for cleanup after the marker closes; it was deliberately not removed because the supported reaper refuses while a marker is open. All other unexplained historical worktrees remain the responsibility of their existing issues/owners.

## 4. Everything we tried that did not work

- **#1720 production verification:** the migration applied, but generic catalog derivation found no object inside constraint-only guarded SQL. Replaying would be unsafe and is forbidden; #1732 must supply exact-byte, read-only recovery.
- **#1646 production promotion:** the risk gate rejected the original preview commit because governed supersession made it diverge from exact main. No database write occurred. Bypassing the gate or replaying either migration is forbidden; #1733 must prove the supersession tuple fail-closed.
- **#1684 supersession:** the atomic manager rejected removal of a non-migration test file before it filtered migration files. No claim or branch mutation occurred. Do not split the rename from claim mutation; fix #1729 first.
- **#1658 dependency audit:** #1655 is a pull request rather than a work issue, so closure/success cannot be proven by the dependency parser. Treat it as unresolved until the issue contract is corrected.
- **#1662 inherited handoff claim:** the predecessor briefing called it production-verified, but live issue #1662 says production remained separate and names no production proof. Live GitHub evidence wins, so #1736 was opened rather than carrying forward the stale completion claim.
- Broad worktree cleanup was not attempted. The shared checkout is dirty and squash merges make ancestry-only cleanup unsafe.

## 5. Root causes and key findings

- Production application and production catalog verification are distinct gates. A red post-apply verifier can mean the migration is already applied; recovery must inspect exact statement identity and must never replay.
- Governed supersession can make valid preview evidence diverge from main without changing migration intent. The risk gate needs explicit supersession proof, not a bypass.
- Claim recovery must be atomic across migration version, branch contents and remote claim ref. Pre-filter validation currently breaks legitimate test-file removal.
- Closed implementation issues are not proof of production. #1662 required a new open production issue because its own closing record stopped at merge/preview.
- Queue audit uses live GitHub issue contracts. A PR number in `depends_on` is not a successful work dependency.

## 6. Exact next steps

1. The successor opens a new marker with its own route ID, resolves it, fetches main and reruns claim/queue audits. Success: one marker resolves to the successor and 5/5 claims match live GitHub.
2. Start separate repository sessions for #1732 and #1733; do not dispatch them from the orchestrator. Success: each repair lands with tests and preserves fail-closed exact-byte validation.
3. Use #1732 recovery to verify #1720's already-applied constraint, then close #1720 and release claim #1726. Success: production catalog and ledger prove the intended constraint without replay.
4. Use #1733 to recover the ordered #1646 evidence and promote `20260827095753,20260828030532`. Success: production function verification passes and claim #1730 is released.
5. After #1729 lands, atomically supersede #1684 claim #1711, rerun exact-head review, preview, merge and promote. Success: separate Property/Character contracts verify in production.
6. After #1709 lands and the dependency contract is corrected, reconcile #1658's orphan through the guarded path, refresh/review PR #1660, rehearse, merge and promote. Success: replacement applied, orphan reconciled without deletion, claim #1659 released.
7. After #1692 lands, atomically reissue #1645 and repeat governed evidence. Success: successor version verifies in production and claim #1656 is released; then #1703 may proceed.
8. Promote #1662 via #1736. Success: production ledger and exact function behavior prove the cutoff with no item-row writes.
9. Dispatch #1722 into the first genuinely free structural lane. Success: the covering index is reviewed, rehearsed and production-verified after dependency #1657.
10. Finish #1669 only after #1658 and private loader/coverage evidence. Success: public source-purpose structure verifies without exposing licensed values.
11. Obtain the #1671 decision from section 0, prove the two non-production targets and only then apply. Success: exact target evidence and successful non-production verification.

## 7. Constraints and gotchas in force

- One open orchestrator marker only; a successor uses a new route ID. Zero markers means queue only.
- Keep all five structural lanes occupied only with eligible structural work. Repository maintenance is not orchestrator work and must not be dispatched by it.
- Keep blocked structural claims locked when recovery depends on separately owned maintenance.
- Preview, merge and production are serialized exclusive stages. Re-derive main, exact PR head, claims, target and ledger immediately before action.
- Never replay a non-replayable migration, manually rename a claimed/applied migration, delete a ledger row, or bypass a failed-closed verifier.
- Prove the exact database target immediately before every write.
- Never expose licensed rows, private evidence, credentials or secret values.
- Preserve unrelated dirty files and worktrees.

## 8. Access and environment

Git and GitHub CLI were authenticated at closeout. Current machine is `edge-dev`; canonical checkout is `C:\repos\shared-db`. Preview and production workflows were usable earlier in the session. Secrets remain in 1Password vault `vibe_coding`; no values are included here. Secrets sweep: inspected the closeout diff and untracked body files; nothing new was introduced and no credential appeared in session-owned artifacts.

## 9. Open questions and risks

- #1671 is the only known owner decision and is consolidated in section 0.
- Main, PR heads, claims, workflow state and database ledgers are moving facts; refresh every quoted value before action.
- #1720 is already applied despite a red workflow conclusion. Treating red as “nothing happened” would cause a prohibited replay.
- #1662 production status was stale in the predecessor handoff; #1736 is now the live source for that promotion.
- The old queued workflow runs are not current deployment work, but should not be mistaken for a clean Actions queue.
- Docs pass: no standing document outside this handover was made false by this session. The predecessor handoff is retired because all unfinished obligations are carried here.

# Part B — sub-agent state

### Agent: Pascal / `C:\repos\shared-db-worktrees\issue-1646-admin-clear-domain`

- **Asked to do:** repair and promote Admin-only customer-domain clearing.
- **Actually did:** authored the correction, obtained review, merged PR #1731 and carried ordered preview/recovery evidence through the production preflight.
- **Found:** production risk validation rejects the original preview commit after governed supersession even though no migration bytes were replayed.
- **PR / branch:** PR #1731 merged; branch `codex/issue-1646-admin-clear-domain`; claim #1730 remains held.
- **Worktree:** live and resumable after #1733.
- **Deliberately did NOT do, and why:** did not bypass the risk gate or write to production after the preflight refusal.

### Agent: Planck / `C:\repos\shared-db-worktrees\issue-1713-creative-submission-resolution`

- **Asked to do:** independently review the exact #1713 structure blocking #1669.
- **Actually did:** delivered durable exact-head GLM approval and green verification; the coordinator then previewed, merged and promoted PR #1718.
- **Found:** migration bytes were unchanged and public evidence could remain free of licensed values.
- **PR / branch:** PR #1718 merged as `9b851ddbd9c9d2175666cf4dbce03e3f6e730cd7`; claim #1717 released.
- **Worktree:** finished; safe to assess for supported cleanup after marker closure.
- **Deliberately did NOT do, and why:** did not apply, merge or promote independently because those gates are serialized by the orchestrator.

### Agent: Averroes / `C:\Users\ahazan\.codex\worktrees\issue-1720\shared-db`

- **Asked to do:** author the constraint change allowing multiple unknown licensor codes while preserving known-code uniqueness.
- **Actually did:** authored and verified PR #1727; the coordinator previewed, merged and applied it to production.
- **Found:** the post-apply catalog lexer cannot derive a constraint object from the guarded SQL, leaving a recovery-only verification gap.
- **PR / branch:** PR #1727 merged as `c7f27f66384719129fc32f15c987c89bed096266`; branch `codex/issue-1720-licensor-null-codes`; claim #1726 remains held.
- **Worktree:** live for recovery closeout after #1732.
- **Deliberately did NOT do, and why:** did not replay the already-applied migration or expose the private curated rows that motivated it.

# Self-audit

1. **Yes:** sections 1–9 define the repository purpose, exact live state, preview/production outcomes, failures, findings, ordered next actions, constraints, access and risks. A new developer can continue without chat context.
2. **Yes:** every live issue, PR, claim, branch, worktree, migration and important workflow run from this session is named, and Part B separates all three sub-agents.
3. **Yes:** background, intended outcomes, incomplete work, failed attempts, owner decisions, privacy/governance boundaries and verification gates are explicit. The stale #1662 production claim is corrected with live evidence and #1736.
4. **Yes:** the only sentence requiring Albert's judgment is #1671's identity-only authorization; it is indexed first in section 0 with a recommendation and consequence. #1609 and #1353 are explicitly recorded as settled so they are not re-asked.

Secrets sweep: completed, nothing new. Docs pass: nothing outside this handover is stale. Queue seed: every unfinished item has an open `db-work` issue; #1736 was added for the previously unqueued #1662 production step. #1671 already has `needs-albert`. Sweep: completed issues were checked against live GitHub, claimed worktrees were deliberately preserved, and unrelated dirty state was not touched.
