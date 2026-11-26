---
issue: 7070
status: OPEN
owner: claude/factory-approvals-coordinator-handoff
---

# Handoff: factory approvals follow-ups, coordinator round 2

Written 2026-11-25 10:03 PM EST by the coordinator session on edge-dev (Claude). It continues
https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-11-25T1649Z-edge-dev3-claude-close-nested-factory-approvals.md
(read that first for §1 app overview, §4 failures, §5 findings).

## 0. Business decisions for Albert
- Blocking task 1 below: **Who is on the production team?** (names, so the AI grants the "production" role for factory approvals). Asked 3 times, unanswered.
- Settled 2026-11-25 (do NOT re-ask): the 5 ambiguous factory pairs are all different factories; keep exactly 1 test factory tied to u2giants@gmail.com; Albert must be able to impersonate it; no audit log of role changes ("No need"); Admin Editor stays for production level (moot once Ilona moved to licensing role); full develop→main DesignFlow release NOT authorized by this work.

## 1. Done and verified (evidence on https://github.com/popcre/shared-db/issues/7070)
- Task 1 mapping: PR #7127 merged, version 20261225141300 in production; done-when count = 0; factories 3 and 65 return linked=true live. Factory 65 "test" is the test factory (vendor 174 email u2giants@gmail.com); 36, 157, 42 set Inactive (revert values in issuecomment-7171067577).
- Task 2: upload policy re-issued as 20261225141200 (PR #7126), live 2:10 PM EST; insert policy has no uploaded_by term. Follow-up PR #7131 (lease refusals no longer burn promotion attempts) merged.
- Task 3: Ilona had no admin; she saw admin-ish screens because licensing users were treated as production. Licensing role + Lic Mgr shipped to main (designflow-backend #597, designflow-frontend #657, plus develop PRs backend #579, tracking #250, item-master #299, frontend #654).
- Task 4: live Factory Approvals menu verified (designflow-frontend #647 comment). Impersonation of factory 65: Admin → Manage Users → User Type "Factories & Reps" → "test" → Impersonate (issuecomment-7171409101).

## 2. Open tasks
1. **Grant production role** — after Albert names the production team. Grant via DesignFlow admin path; prove those users can edit approvals live.
2. **Task 5: live FAMA upload proof** — after a real licensing/production staff upload on designflow.app: confirm the core.factory_approval_form row, Indra filled name/number/expiry, signed link returns the PDF. Do not ask Albert to click.
3. **Vendor RFQ 403 toast fix** — designflow-backend #576 merged to develop only; goes live with the next normal DesignFlow develop→main release. Verify then: impersonating factory 65, the RFQ page shows no 403 toast.
4. **Licensing role live check** — confirm on designflow.app that Ilona (Lic Mgr) sees the licensing screens and not production/Admin Editor screens; if tracking needed the shared role engine (483 develop commits ahead of main), note whether her tracking screens are complete.
5. **Housekeeping** — ai-housekeeping reported 11 stale DesignFlow branches whose work landed; delete only after per-branch PR MERGED proof (cleanup-worktree skill).

## 3. What did not work
- Promotion attempts burned by production-lane lease refusals (fixed by #7131).
- Version collisions: #7127 had to renumber to 20261225141300 after #7126 took 141200.
- Manage Users list mislabels vendor first/last name fields; a save swapped them (restored).
- Albert's email is staff user 76, so it cannot sign in as vendor 174 — impersonation is the path.

## 4. Constraints
Shared-db: claim-first on #7070, merge queue, automatic promotion only. DesignFlow: sandbox-albert → develop → main per GATEKEEPER.md. Never hand-edit types/database.types.ts.

## Self-audit
Newcomer can continue: yes (§1-§2). Every Albert question is in §0. Closeout check for this coordinator: ok, zero claims/stages.
