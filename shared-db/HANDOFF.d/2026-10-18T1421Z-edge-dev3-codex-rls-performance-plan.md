---
issue: 4421
status: BLOCKED
owner: codex/rls-performance-plan
---

# RLS permission-check performance repair handoff

## 0. Business decisions only the owner can make

None. Preserve existing access exactly. Already settled October 18, 2026 EDT: Albert requested a plan for the entire warning family after a wider investigation and timing measurements. This planning request does not start database remediation. Technical review, access repair and implementation mechanics belong to the implementing AI, not Albert. If new business questions arise, consolidate them once; do not ask for technical approval.

## 1. What this application is

POP applications share Supabase PostgreSQL. Canonical structural source is popcre/shared-db; no application runtime lives here. Production API observed: https://qsllyeztdwjgirsysgai.supabase.co . Preview comes from current repository variable PREVIEW_PROJECT_REF, never a historical literal. CRM, DAM, PM/PIM and DesignFlow depend on this structure.

## 2. Session goal and trigger

Supabase flagged assets insert policy for repeated auth evaluation. Albert requested wider inspection, measured speed difference, then a self-contained implementation plan. The plan covers 69 policies across 49 tables while retaining existing permissions.

Read [the plan](../plan_rls_request_constant_checks.md) first, especially STATUS. Portable link: [plan_rls_request_constant_checks.md](https://github.com/popcre/shared-db/blob/codex/rls-performance-plan/plan_rls_request_constant_checks.md).
Measured evidence and exact 69-row inventory: [baseline](https://github.com/popcre/shared-db/blob/codex/rls-performance-plan/docs/verification/rls-initplan/2026-10-18-baseline.md).
Owning issue: https://github.com/popcre/shared-db/issues/4421 . Parent broader program: https://github.com/popcre/shared-db/issues/2326 .

## 3. Current state

October 18, 2026 EDT: planning/evidence only. No implementation started, no policy changes, migration reservation, structural claim, preview apply or production apply. New plan, baseline and this handoff are being published on codex/rls-performance-plan from upstream 845a92d77b097a8153baf523ec5291b3bcb29b5d. Use the linked PR/issue for actual merged publication status; this file does not claim an unverified merge.

Production read-only inspection and Supabase advisor both found 69 policies / 49 tables: 46 public-admin, 17 owner-uid, four app-access, two packaging/JWT. The plan STATUS intentionally leaves all implementation steps open. Supabase MCP reads and gh worked; preview/write access not demonstrated. No background worker is executing this plan.

Publication blocker verified October 18, 2026, 10:35 AM EDT: [PR #4423](https://github.com/popcre/shared-db/pull/4423) contains the committed/pushed plan. Repository classification says “all 5 changed file(s) are lightweight prose documents”, but installed task gate escalates the plan/router paths to reviewer-safety and refuses ship without an assigned independent exact-head report. Canonical allocator refused “nonclosing maintenance binding refused: one current keyed canonical evidence pair is required”. No reviewer was assigned and no review ran. The repository documentation route did not require such a pair; publishing one retrospectively would contradict the pre-work guarantee. Do not fabricate it. This session owns resolving supported publication; a successor must re-read the current gates or take a genuinely fresh prospectively contracted publication route without claiming this prior plan was written under that contract.

## 4. Failed or rejected approaches

UID-only wrapping improved assets expression median by only 7.3%; complete request-constant permission wrapping improved 97.2%. These are controlled expression measurements, not end-to-end RLS or app speed. Elevated tests do not prove client access. Never use broad regex rewriting, wrap row-dependent ownership predicates wholesale, consolidate policies, change grants/helper bodies, disable RLS, or run write benchmarks on production.

Task class “read-only” was rejected as unknown; investigation used shared-db. Plan publication initially declared prose, then redeclared reviewer-safety when the installed gate required it. The Claude helper invocation was refused before contact because registry state is absent. An initial allocator attempt also refused ambiguous Refs issue binding; PR body now has exactly Refs #4421, with parent #2326 as a URL. The next allocator attempt refused the missing prospective keyed evidence pair, as recorded in §3. No bypass or fabricated evidence was used. All durable evidence is in the tracked baseline, not a temporary report. See plan §7 for the complete rejected list and reasons.

## 5. Root causes and key findings

The costly permission-table helper can still run per row after wrapping auth.uid() alone. Prefer wrapping the complete proven request-constant helper; owner user_id comparison must remain per-row.

Anchors at planning base: [legacy helper lines 5170–5180](https://github.com/popcre/shared-db/blob/codex/rls-performance-plan/supabase/ci-bootstrap/010_pre_adoption_baseline.sql#L5170), [legacy assets insert line 6635](https://github.com/popcre/shared-db/blob/codex/rls-performance-plan/supabase/ci-bootstrap/010_pre_adoption_baseline.sql#L6635), [style-guide policies lines 773–788](https://github.com/popcre/shared-db/blob/codex/rls-performance-plan/supabase/migrations/20260723170000_popsg_file_tags.sql#L773), [packaging policies lines 30–62](https://github.com/popcre/shared-db/blob/codex/rls-performance-plan/supabase/migrations/20260709144500_core_packaging_type.sql#L30).

Two distinct role systems exist (public and app); do not unify overloads/enums. Packaging transitive JWT/profile helpers need qualification before caching. Fingerprints detect drift, not custody. Live catalog wins over historical migration or bootstrap content. Raw timing values and reproducible SQL are in the baseline.

## 6. Exact next steps

1. Open plan STATUS and §§1–13; fresh upstream isolated worktree, current rules, #4421/#2326/open claims/PR refresh. Gate: every baseline policy has a fresh disposition.
2. Implement plan Step 1 admission, exact-object claims, immutable work contract and new version reservation; planning owns no structural authority. Gate: current write set exactly covered.
3. Execute Steps 2–4: real role-enforced baseline, adversarial fixtures, expression-only forward ALTER POLICY, preview, timings, consumer proof and one allocator-assigned exact-head review. Gate: metadata and allowed/denied behaviors match.
4. Execute Steps 5–7: guarded merge, supported merged-main rehearsal/production lane, live proof and final reconciliation. Gate: immutable ledger/catalog/test/consumer acceptance; same issue remains open until all pass.

Each step's concrete file targets, dependencies, test names, commands/current runner references, thresholds and rollback are in plan §9–§13. No chat reconstruction is needed. Read downstream phases again at each context cut.

## 7. Constraints and gotchas

Use claim-first structural route; never inherit parent #2326's repository-maintenance scope or old orchestrator text. One independent exact-head review, current task gates, reserved forward versions, preview/merge/production exclusive lanes, proof before writes, and supported automatic promotion only. Production SQL fixture/write benchmarks prohibited. Preserve implicit WITH CHECK, OR/restrictive semantics, grants, policy metadata and error behavior. Preview/production diverge both ways. Secret/license data stays protected; public artifacts contain metadata and synthetic values only. Sign every GitHub post with actual chat ID/machine. Human-facing clocks are EST/EDT.

Keep broader program open. No subagents were spawned, so no delegated-agent custody exists to transfer.

## 8. Access and environment

Verified planning access: Supabase production read-only MCP and authenticated gh for popcre/shared-db. Unknown: preview credentials/leases, production promotion eligibility and consumer test accounts. Re-verify at execution. 1Password vault vibe_coding contains references named in plan §12; no secret values in these documents. Read the secrets skill before handling values and serialize retrieval. Current runner and supported commands are in [development](https://github.com/popcre/shared-db/blob/codex/rls-performance-plan/docs/development.md) and [credential runbook](https://github.com/popcre/shared-db/blob/codex/rls-performance-plan/docs/agents/runbooks-credentials-cli-and-gotchas.md).

## 9. Risks and open questions

Technical open items (implementer-owned, October 18, 2026 EDT): fresh collisions, transitive helper stability, preview parity, consumer mapping, real role fixture coverage, actual workload improvement and safe live application write proof. No business choice is pending. Plan §13 gives criteria and recovery through a new forward migration. No implementation item is complete. Retire this file only when #4421's outcome is fully proven and its obligations are carried or finished; leave the root HANDOFF.md untouched.

Handoff audit: all sections 0–9 present, goal/dead ends/evidence/custody/next gates/access/uncertainty retained, no hidden owner question, portable links included, plan backlink present.


## Wrap-up supplement — October 18, 2026 EDT

### Completed issue organization and execution map

Parent [#4421](https://github.com/popcre/shared-db/issues/4421) was updated as the overall tracker. Six native sub-issues and all eleven native dependency links were freshly verified:
- [#4425](https://github.com/popcre/shared-db/issues/4425): publication safety conflict, owned by this closing Codex coordinator, idle/blocked.
- [#4426](https://github.com/popcre/shared-db/issues/4426): read-only inventory/baseline refresh, idle; independent of publication.
- [#4427](https://github.com/popcre/shared-db/issues/4427): 46 admin policies; blocked by #4425/#4426.
- [#4428](https://github.com/popcre/shared-db/issues/4428): 17 ownership policies; blocked by #4425/#4426/#4427.
- [#4429](https://github.com/popcre/shared-db/issues/4429): four app-access policies; blocked by #4425/#4426/#4428.
- [#4430](https://github.com/popcre/shared-db/issues/4430): two packaging policies; blocked by #4425/#4426/#4429.

Each repair child owns its complete claim-to-live-proof lifecycle. No leftover-proof child exists. Table families overlap, so claims and rollouts remain serialized. Update the implementation plan's issue map as work advances; parent is not structural admission. This organization was explicitly requested by Albert and does not itself start database work. Do not close #2326 or any repair outcome on planning publication.

### Closeout custody and safety

No subagents, claims, version reservations or preview/merge/production stage leases were acquired in this session. No migration or application row was written to preview or production. Production timing used read-only transactions with session-local request context and rollback. That is not DDL/DML or actual role-enforced write proof. Preview state and other sessions' reservations were not audited for cleanliness; do not call the shared preview clean.

PR #4423 was freshly verified OPEN and unmerged before closeout; its existing publication blocker remains. Preserve the codex/rls-performance-plan branch and its attached worktree as intentionally resumable. Do not delete or force-reset them. Only this session's plan and handoff were updated for closing; no source/tool/config/database changes were started. Root HANDOFF.md and other sessions' handoffs remain untouched. No additional scope-freeze bug/fix was taken on.

Secrets sweep: inspected the session and owned documentation changes; no credential values, tokens or connection strings appeared. Nothing new needed storing in 1Password. Documentation pass: the issue decomposition was the only new durable fact requiring a plan/handoff update; no external operating rule or evidence was invalidated. Housekeeping is report-only; retain its summary with the final parent closeout note and do not act on unrelated candidates.

Installed ai-shared-db-closeout-check must pass for the actual UUID 01a14f60-0374-7c70-929a-7d8df999d0bc after any ownership operation. The final parent closeout note records the receipt outcome; if it fails or is unreadable, closeout remains blocked. Receipt stays in protected session evidence, not public source.

### Exact next-session prompt

Resume popcre/shared-db from the plan and handoff on codex/rls-performance-plan, carried by unmerged PR https://github.com/popcre/shared-db/pull/4423 . Goal: remove repeated permission work from all 69 baseline policies without changing access. Read https://github.com/popcre/shared-db/blob/codex/rls-performance-plan/HANDOFF.d/2026-10-18T1421Z-edge-dev3-codex-rls-performance-plan.md and https://github.com/popcre/shared-db/blob/codex/rls-performance-plan/plan_rls_request_constant_checks.md first. Refresh parent https://github.com/popcre/shared-db/issues/4421 and all six children. First resolve #4425's supported documentation/review publication path without fabricating prospective evidence or bypassing safeguards; #4426 may proceed read-only independently. Then execute #4427, #4428, #4429, #4430 in order using your own current-upstream worktrees, actual session identity, fresh structural admission/claims and reserved versions. No database repair has started and no predecessor claim exists to inherit. Each repair child remains open until preview, independent review, guarded merge, governed production apply and live equivalent-access/performance/consumer proof pass. Do not touch unrelated work or close parent #2326. Verify the final closeout receipt in the existing parent comment before taking custody.

### Final handoff completeness audit

1. Can a fresh developer continue without project or chat knowledge? Yes: §§1–3 and this execution map identify the system, immutable plan/evidence, untouched implementation, exact current cards and publication blocker; §6 and the prompt specify the first supported action and verification gates.
2. Can they continue with the same background and nuance? Yes: §§4–5 and plan §§6–8 retain weaker UID-only results, controlled-expression limitations, distinct role systems, failed reviewer/admission attempts and forbidden shortcuts; this supplement records the later child decomposition and ownership status.
3. Does it include every execution-relevant detail? Yes: §§0,6–9 plus plan §§9–13 cover settled business intent, dependencies, custody, access/target limits, exact test and rollout gates, recovery, publication conflict, live acceptance and current uncertainty. The parent closeout note carries the final receipt/housekeeping/commit result so no unverified future success is asserted in this file.
