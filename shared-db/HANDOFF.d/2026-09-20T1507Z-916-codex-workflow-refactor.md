---
issue: 3306
status: OPEN
owner: codex/orchestrator-workflow-refactor-plan
---

# Shared-db workflow refactor — implementation has not started

## 0. Decisions only the owner can make

**No new owner answer is needed for this planning delivery or the non-policy implementation steps.** Albert requested a detailed plan covering all workflow bottlenecks; he did not request production mutation during this planning session. The [implementation plan](../plan_shared_db_workflow_refactor.md) §8 and §13 consolidate the future decision boundaries.

Two possible later changes need explicit policy adoption before activation: reducing two migration reviewers to one for a proven low-risk class, and extending automatic production promotion to a direct isolated-rehearsal route without the currently required preview-triggered transition. Recommendation: implement independent artifact/completion/check/probe fixes first, gather evidence, and present any exact proposed policy changes together to the authority required by Albert's standing instructions. Technical production approvals follow his independent-reviewer ruling, not an uninformed owner click. Until adopted, retain two reviewers and the existing governed release route. These proposals do not block the other steps.

Automatic closure of other sessions' issues is not authorized. It is unnecessary for truthful dependency readiness: record proven acceptance stages, keep administrative closeout visible, and let the permitted owner close. Do not silently grant closure authority to a scheduled reporter.

**Already settled — do not re-ask:** no author/reviewer count caps; exact-object/version protection remains; maintenance is outside the structural orchestrator; read-only inspection is permitted; self-service additive work inside `crm/pim/dam` already exists; ordinary scoped planning/publishing is authorized. The program tracker is never a prerequisite for application delivery. No persistent personal memory update was requested.

## 1. What this application is

`popcre/shared-db` is POP Creations' canonical PostgreSQL/Supabase schema and delivery-control repository serving CRM, PIM/product management, DAM and DesignFlow PLM. It contains migrations, Node.js coordination tools, Python production guards, GitHub Actions and operating instructions. GitHub `main` is the delivery source. The public repository moved from `u2giants` on September 18; use canonical identity helpers. Consumers receive read-only mirrors.

The plan §2 defines the environments, scopes and terminology. Production's documented project is `qsllyeztdwjgirsysgai`; preview identity comes from the live `PREVIEW_PROJECT_REF` repository variable, not historical literals. Verify target identity immediately before any write. This session made no database connection.

## 2. Session goal and trigger

Albert reported days/weeks of application delay behind nested orchestrator blockers and requested a procedural audit. He then invoked `implementation-plan-writer` and asked: **“write a detailed plan to fix ALL the problems.”** The deliverable is the standalone plan, supporting audit, registration links, this handoff and published repository history. It is not implementation or production activation.

The business goal is safe, independently progressing application delivery, with truthful completion and no artificial paperwork dependencies. Plan §1 states how to decide when a specific instruction conflicts with that goal.

## 3. Current state

Investigation baseline: upstream `57269b19416ccca6c20a0053ed05e397b1bd0e19`, September 20 around 15:00 UTC. Planning branch: `codex/orchestrator-workflow-refactor-plan`, isolated worktree `C:/Users/ahazan2/.codex/worktrees/orchestrator-workflow-audit/shared-db`. The plan, audit and handoff are published together in the planning PR; its exact final head and merge receipt are recorded on [3306 — non-orchestrator maintenance tracker](https://github.com/popcre/shared-db/issues/3306). Resolve the containing commit from file history rather than treating the investigation SHA as the publication SHA.

Artifacts:

- [Plan](../plan_shared_db_workflow_refactor.md): all 13 required sections, STATUS for Steps 0–14, exact file/behavior targets, dependency map, acceptance gates, negative tests, compatibility, rollback and final self-audit.
- [Audit](../docs/verification/shared-db-workflow-bottleneck-audit-20260920.md): seven findings, live examples and measurement limits. It was initially a local `bugs.md` and moved to this scoped publication path; do not search for a separate implementation in `bugs.md`.
- Routing links in `AGENTS.md` and the shared Supabase branch workflow guide point to the plan. Root `HANDOFF.md` is unchanged.

**No executable implementation has started. Every STATUS step is open.** No migrations, settings, production workflows, review-count policy, issue closure or automatic promotion authority were changed. The new tracker is a program index with `db-work`, explicit maintenance scope and current planning ownership. It does not own a migration claim and must not enter the structural work queue.

At the audit snapshot: 124 open issues, 75 declaring maintenance, 29 structural and 6 curated; 68 older than seven days. These are issue records, not independently verified outstanding feature counts. No active rulesets were returned; branch protection had 13 contexts, strict=false; the committed mirror had 12. Live state must be refreshed.

## 4. Attempts and approaches that did not work

- The installed task gate does not accept `read-only` or `documentation` as classes; `prose` is the actual documentation class. Its `start --help` form is not supported; use top-level `--help`.
- The plan filename/scope triggered protected `reviewer-safety` classification despite containing prose. The session redeclared that class and `check --before review` then permitted review, listing exact-head independent review, local tests, branch/PR and rulebook treatment. Do not rename the plan to evade a gate.
- The repository has no root `package.json`, no `.github/ISSUE_TEMPLATE/db-work.yml`, and no `.claude/` or `skills/` directory at the inspected baseline. Use actual Node/Python workflow entrypoints and documented scope fences; do not invent npm commands or edit nonexistent local skill sources.
- A first broad AGENTS read produced excessive output. Use its headings/router and relevant long-form sections. Preserve needed source context, not raw dumps.
- An initial hypothesis placed task-evidence validation in ai-devops. The follow-up search found the concrete validator in shared-db and no corresponding ai-devops runtime in the inspected paths. Do not make unrelated cross-repo code a prerequisite; canonical skill prose is a separate concern.
- The audit initially classified parent 3179 as structural; live scope verification showed `source-data`. The published audit and plan correct it to non-orchestrator work. Never infer scope from predecessor names.

Rejected technical approaches are fully recorded in plan §7: removing safety locks/claims, deleting preview edges, treating green ephemeral CI as universal production proof, “ours” evidence merges, bulk disposition regeneration, mass issue closure, restoring strict refresh, new duplicate watchers, immediate reviewer reduction, or silently authorizing no-preview auto-production.

## 5. Root causes and key findings

Plan §§5–6 give exact modules and baseline line references. Most important:

1. Every task writes the same `.agent` evidence pair, and freshness validation still refuses its Git conflicts even though implementation digests exclude metadata. Two recent failed merge runs confirm impact.
2. The call-site truth audit has a single global digest/count, requiring unrelated source changes to edit one file. Existing maintenance issue 2832 records it; retain substantive per-site review while partitioning records.
3. Shared preview's timestamp graph creates unrelated waits. This is a ledger consistency constraint; isolate qualifying rehearsal rather than delete the guard.
4. Entire workflow groups serialize preparation and combine preview with production. Locks must be narrowed without losing cross-lane invariants, cancellation safety or production/main freshness guarantees.
5. Open/closed issue state cannot represent the stage a consumer needs. Four open maintenance children had merged while their parent had recorded live acceptance. Inspect exact child assertions before reconciling.
6. A possible modern maintenance completion gap needs a reproducing fixture: `completeWork` redirects populated `change_type`, but `completeOutcome` is structural-only. Do not publish it as a proven live defect without that test.
7. Probe syntax checks do not qualify runtime permission/data/performance. A real chain applied a structural fix, then a permission fix, then needed a timeout repair.
8. Current procedure text contradicts unlimited reviewers, activation state and the lightweight documents route. Completed plans still say restart at their first step.
9. Existing self-service admission, content-equivalence reuse, scheduler/reporting and isolated-route machinery must be extended, not duplicated. The hop table explicitly treats some remaining actions as deliberate authorization/judgment.

## 6. Exact next steps

1. Read the plan STATUS and §§8–9 in full; fetch current upstream and inspect the live tracker and overlap issues. Verify planning publication is on main through its actual PR/merge receipt. **Gate:** distinguish the publication SHA from the baseline and identify ready work without rerunning completed steps.
2. Accept ownership of one implementation outcome, with a dedicated current-upstream worktree and correct task class. Refresh the corresponding existing issue; do not take another active owner's files. **Gate:** one named owner, concrete file set and one acceptance claim.
3. Execute Step 0's bounded baseline/ownership work, then choose an independent ready fix using the dependency map. Recommended first implementation: Step 1 task evidence, or Step 2 dispositions if Step 1 is actively owned. **Gate:** dated evidence and explicit per-step live proof, not an umbrella promise.
4. Implement the selected step with negative tests first, compatibility/rollback and a whole-class self-audit. Follow the plan's concrete test suites and current repository review/merge policy. **Gate:** reviewed exact content, passing required checks, merged implementation and proven behavior.
5. Update the plan's exact STATUS row with artifacts; if code is landed but proof is not accepted, create exactly one owned live-proof issue immediately and mark partial. Retire this handoff only under the successor rule when all obligations are carried forward. **Gate:** no unowned residual or falsely done row.

Do not implement all fifteen steps in one session. Do not route this program to the structural orchestrator. Each natural phase cut requires a downstream drift check and the applicable fresh-session procedure.

## 7. Constraints and gotchas

Read current AGENTS, task gates and plan §11. Use current-upstream worktrees; branch/PR only; verify committer identity; stage only owned files. Sign GitHub bodies with actual chat/machine. All issues need valid scope plus label; maintenance object lists stay empty. Issue opener owns closure under current rules. No production mutation or policy activation is granted by this handoff.

Required safeguards remain: exact target, immutable versions, exact-object collision protection, actual independent review/refusals, dependency closure, one writer per shared target, bounded production allowlist and post-apply verification. Read-only reports must retain stripped mutation capability. Unknown/truncated/stale evidence never means success. No hidden fallbacks and no suppression of real failures.

Public repository: do not publish secrets, licensed rows, actual order/customer content, private transcripts or raw data. No arbitrary worktree cleanup, lease deletion or migration history rewrite. Existing completed work is a reference, not a new assignment.

## 8. Access and environment

Host `916-ALIEN`, PowerShell 7; Git, Node/Python tools and authenticated GitHub CLI. Repository `https://github.com/popcre/shared-db`, target `main`. The plan §12 gives concrete environment and credential discovery instructions. No app login is needed for this maintenance plan.

Secrets, if later required, are in 1Password vault `vibe_coding`; load the secrets skill and current database runbook before resolving an exact item. No credential item or value was accessed in planning, so none is fabricated here. Do not assume interactive GitHub access implies identical workflow-token permissions.

## 9. Risks and remaining decisions

All implementation remains open, owned for tracking by the planning issue until a successor explicitly accepts a specific step. This is not a claim that an implementation session is running. Plan §13 enumerates each decision, owner and safe default; Section 0 above consolidates authority changes.

The principal technical risks are wrong-task/wrong-baseline evidence reuse, baseline incompleteness, lock races after concurrency changes, unsafe stage advancement and accidental authority expansion. Each has required adversarial cases and an explicit rollback. Performance improvement is unmeasured until comparable samples exist; claims of a percentage speedup are not supported.

## Read-only contributor record

- **procedure_audit:** reviewed operating instructions and existing plan status, then specified policy consolidation, probe qualification and review-tier decisions. Found contradictory concurrency/activation instructions and the deliberate no-preview hop policy. No changes, issue, PR or private worktree; no continuing assignment.
- **pipeline_audit:** traced workflow/code queues, preview edges, shared evidence conflicts and check fallback, then mapped exact implementation/test targets. Clarified adopted baseline limitations and the actual shared-db evidence validator. No changes, issue, PR or private worktree; no continuing assignment.
- **queue_audit:** inspected live issue/PR/acceptance records and mapped completion/dependency code, existing owners/issues and report tools. Corrected parent 3179's route and flagged the maintenance completion gap for reproduction. No live writes, PR or private worktree; no continuing assignment.

These were bounded audit/planning agents, not structural workers or an orchestrator role. Their findings are incorporated in the plan and supporting audit; no hidden worker is expected to finish implementation.

## Handoff self-audit

1. **Can a new developer pick up without session context? Yes:** §§1–3 establish purpose/current state, §6 gives the exact next action, and the linked plan supplies every edit/test boundary.
2. **Can they continue with the reasoning held here? Yes:** §§4–5 preserve failed attempts, corrected assumptions and non-obvious root causes; the contributor record and plan preserve the technical evidence.
3. **Are background, goals, failures, constraints, risks, actions and proof covered? Yes:** all required sections 0–9 are present, with the plan's fifteen STATUS outcomes, transition/rollback details and acceptance artifacts.
4. **Does Section 0 expose every owner decision without requiring the full handoff? Yes:** it covers possible reviewer-count and production-automation adoption, preserves closure authority, names defaults and states no new decision is needed for planning or ordinary fixes. A full sweep of the handoff/plan found no other undisclosed owner ask.

**PASS for handoff completeness.** This records an open implementation program; it does not claim the program is done.
