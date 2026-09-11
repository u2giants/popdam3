---
issue: 2530
status: OPEN
owner: codex/plan-popcre-transfer-merge-queue
---

# Handoff — transfer `shared-db` to `popcre` and activate its merge queue

Implementation plan: [`../plan_shared_db_popcre_transfer_merge_queue.md`](../plan_shared_db_popcre_transfer_merge_queue.md)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert in one message before implementation; do not ask one item at a time.

### Blocking

1. Authorize the exact transfer of public `u2giants/shared-db` to `popcre/shared-db`, understanding that GitHub may retire the old owner/name and exact transfer-back is not guaranteed. **Recommendation:** authorize only after plan Steps 1–3 prove the recovery pack and quiescent window.
2. Confirm post-transfer roles: `u2giants` admin, `devopswithkube` write, everyone else governed by the existing `popcre` default. **Recommendation:** approve; the repository is already public, while explicit roles preserve operation.
3. Authorize the exact one-PR `ALLGREEN` merge-queue ruleset and additive required `Merge queue gate` context after the transfer is proven. **Recommendation:** approve only after direct guarded merging works at `popcre/shared-db`.

### Already settled — do not re-ask

- 2026-08-25: destination `popcre`, repository name `shared-db`, visibility public.
- Native GitHub queue, not custom queue or ordinary auto-merge.
- No database mutation, no weakened checks, one PR per group, merge commits retained.

## 1. What this application is

`shared-db` is POP Creations' public schema and coordination source for the shared Supabase/Postgres database used by CRM, DAM, PM/PIM, and DesignFlow. Its `main` branch also mirrors the shareable root into nine consumer repositories. It currently lives at `u2giants/shared-db`; the plan moves the existing repository object to `popcre/shared-db` and then activates GitHub's native merge queue.

## 2. What this session set out to do and why

Albert asked for a much more robust plan. The previous queue issue #1435 and PR #1950 stopped because native merge queues require an organization-owned public repository and the code would have broken direct merges before activation. This session created a standalone, execution-grade plan covering authority, transfer, settings recovery, repository identity, queue implementation, live canaries, migration preview serialization, and rollback.

## 3. Current state

- Plan and handoff are authored on `codex/plan-popcre-transfer-merge-queue` from `origin/main` `85015041f660bdebc5474751e63e12618d275b03`; neither is implemented by this handoff.
- Tracking issue #2530 is open. It authorizes planning only, not ownership transfer, settings mutation, database work, or production work.
- Live 2026-09-07 state: source is public and personal-owner; destination does not resolve; no rulesets/queue; 11 required checks; Actions enabled; eight repo secret names; six variables; two empty environments; no hooks/deploy keys; direct collaborators are Albert admin and `devopswithkube` write.
- Current runtime code still has old-owner hard-codes. The direct guarded merge lane works and must remain working until queue activation.
- Closed PR #1950 remains at `3792a968...` as design history only. No settings or database were changed.

## 4. What did NOT work

1. Ordinary auto-merge was rejected because it is not a queue and preserves the race.
2. PR #1950 was closed because the personal-owned repo is ineligible and its unconditional `--auto` would stop merges while auto-merge is disabled.
3. Cherry-picking #1950 is rejected because it predates and reverses later transport, freshness, preview-binding, production-freeze, and test repairs.
4. Blindly recreating secrets/settings is rejected: current GitHub docs say they remain attached; compare and repair only proven drift.
5. Transfer-back is not a dependable rollback because GitHub may retire the old owner/name combination.
6. Inventing a migration for queue testing is rejected; wait for the next genuine migration.

## 5. Root causes and key findings

- Eligibility requires organization ownership; transfer is the prerequisite.
- Required Actions checks must run on `merge_group` or the queue deadlocks.
- Review stays pinned to the PR head while GitHub tests a synthetic group SHA; the queue gate must bind both.
- GitHub serialization alone does not enforce the shared-preview rule. The next group must wait for successful preview status on the exact preceding migration merge SHA.
- Operational repository identity must be dynamic before transfer; canonical docs switch after transfer.
- GitHub documents preserved repository objects/redirects, but organization access defaults and credential functionality still require live proof.

## 6. Exact next steps

1. Merge this rulebook plan through the normal exact-head review and guarded merge path; `plan_*.md` and `AGENTS.md` are intentionally not eligible for the documents-only exemption. **Worked when:** plan, router link, and this handoff are on `main`, with #2530 still open.
2. Start a fresh repo-maintenance session at plan Step 0 and consolidate the three owner decisions. **Worked when:** #2530 records exact authorization and the change window.
3. Execute plan Phase A in a clean worktree. **Worked when:** redacted baseline exists and transfer-compatible identity code is merged without changing queue behavior.
4. Execute Phase B only inside the authorized quiescent window. **Worked when:** same immutable repository ID/SHA is at `popcre/shared-db`, settings/access/credentials compare cleanly, canonical identity is updated, and all nine sync jobs pass.
5. Execute Phase C from fresh current `main`. **Worked when:** queue code lands without cherry-picking #1950, exact ruleset is active, and a documents-only canary passes every synthetic-group check.
6. Leave migration acceptance open until the next genuine migration. **Worked when:** ordering, exact-head ancestry, exact-SHA preview status, and next-group hold/release are proven live.
7. Complete Phase D. **Worked when:** all STATUS rows cite artifacts, #2530 closes, and this handoff is deleted in the closing change.

## 7. Constraints and gotchas

- Isolated worktrees only; preserve the dirty canonical checkout and other sessions' files.
- No database or production mutation is authorized.
- No transfer/settings write before current exact owner authorization.
- Do not create/fork the old repository name after transfer; redirects can be lost.
- Keep all required checks, exact-head review, preview/production locks, and direct guarded merge capability.
- No `--admin` queue bypass, no multi-PR group, no invented migration, no secret output.
- Use current official GitHub documentation immediately before transfer/activation.
- Update the plan STATUS after every step; it becomes stale as soon as execution starts.

## 8. Access and environment

- GitHub CLI is currently authenticated with source repository administration; re-prove it live.
- Destination organization: `popcre`; source/destination URLs and API endpoints are in plan §12.
- Secret contingency source: 1Password vault `vibe_coding`; use the private mapping from #1435 and pipe values without logging. Never commit item IDs or values.
- Work in a fresh current-upstream worktree. The local canonical checkout is landing-only.

## 9. Open questions and risks

Owner questions are fully consolidated in §0. Engineering drift is bounded by the plan: current GitHub API schema and check-runtime evidence may alter payload shape or timeout but not the locked queue behavior. Main risks are old-name retirement, role drift, unusable secrets, missing merge-group contexts, stale #1950 regressions, and preview bypass; plan §13 names controls and rollback for each.

### Handoff self-audit

1. Fresh developer can continue without chat: **yes**—§§1–9 define purpose, state, failures, findings, steps, constraints, access, and risks, with the full build spec linked.
2. They have all session knowledge: **yes**—§§3–5 include the live baseline, #1435/#1950 history, transfer-doc correction, and rollback limitation.
3. Every detail needed for flawless execution is present: **yes**—§6 provides gated next actions and the linked plan supplies file-level steps/tests/evidence.
4. Owner sees every decision from §0 alone: **yes**—the only owner-dependent items in §§1–9 are the transfer, access model, and ruleset authorization, all consolidated in §0 with recommendations and consequences.
