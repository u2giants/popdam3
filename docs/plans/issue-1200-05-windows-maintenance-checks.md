---
summary: "Keep maintenance from interrupting active file work while allowing normal work to resume."
kind: plan
status: open
read-when: "implementing cleanup 05 on windows maintenance checks"
---

# 05. Windows maintenance checks

[Tracking issue](https://github.com/u2giants/popdam3/issues/1200) · [Handoff and all twenty plans](../../HANDOFF.d/2026-11-19T1750Z-edge-dev3-codex-cleanup-plans.md)

## STATUS

| Step | State on 2026-11-19 | Evidence to record |
|---|---|---|
| 1. Establish current behavior | ✅ established | Main 9b74161a and before/after fixtures in the implementation PR |
| 2. Make the scoped change | ✅ implemented | Existing TIFF and hygiene polling delays, readiness checks and lease accounting were preserved. The Windows suite passed 171 tests. An existing native launcher test requires Windows. 131,072 before/after comparisons matched. Windows package and installed maintenance proof are pending. |
| 3. Verify and land | ✅ merged | [#1207](https://github.com/u2giants/popdam3/pull/1207) at `cdc1c343`. Implementation checks passed. |
| 4. Accept in use | ⬜ live proof open | The installed Windows host responded. Its maintenance task is on demand only and the idle receipt was absent. **Next** — Codex Windows release owner should observe the next authorized controller maintenance window, correlate the trusted zero-work receipt with the claim history, and confirm work resumes after the lease. See the [tracking issue](https://github.com/u2giants/popdam3/issues/1200) for receipts. |

Albert authorized implementation and release of this item in the November 19 cleanup portfolio. See #1200 for release and live evidence.

## 1. Ultimate goal

Keep maintenance from interrupting active file work while allowing normal work to resume. If a step conflicts with this goal, the goal wins — stop and flag it.

## 2. Application

PopDAM manages licensed artwork, and PopSG serves licensor style guides. Designers and administrators use these systems to find, review and maintain production art. This plan touches Windows render agent. The source is [u2giants/popdam3](https://github.com/u2giants/popdam3), release branch main.

## 3. Trigger

The November 19 source audit ranked this item high impact. Reproduce the finding by inspecting the definitions and callers in §5 at [the audited revision](https://github.com/u2giants/popdam3/tree/0009728fd16fd8f79dcc9b24a557efd58f904997). This was a source comparison. Production failure frequency was never established.

## 4. Scope

Change only the responsibilities, callers and packaging required by §5–6. Exclude other numbered cleanups, shared database structures, model selection, permissions policy, unrelated formatting, and production data repair.

## 5. Current state and source evidence

`apps/windows-agent/src/index.ts:949,1070,1181,1283` repeats the same long predicate around maintenance, active requests, configuration, health and per-loop work. Extract `canStartAuxiliaryClaim(alreadyRunning): boolean` beside the live state. Replace only those four checks. Preserve per-loop flags and delays, increment the in-flight count before the request, and release it through the existing cleanup. Test pending maintenance alongside a heartbeat, outstanding claim, active job, unhealthy agent and update. A future missing condition in one copy could start file work during maintenance.

The cited application files were unchanged at planning baseline d097a6a934ae. No implementation or deployment is claimed by this plan. Locate renamed symbols on current main before editing.

## 6. Root cause and target design

Add canStartAuxiliaryClaim beside live claim counters in index.ts. Supply each of the four existing local busy flags. Keep counters and scheduling in the four original loops.

## 7. Rejected approach

Do not unify or remove behavior based only on matching text. In this item, the specific boundaries and exceptions in §5 would be lost. The alternative considered was leaving the implementations untouched; that retains the maintenance burden described there. No implementation was attempted in planning.

## 8. Decisions

Locked on November 19, 2026: preserve the observable outcomes in §5 and §10, including existing errors and compatibility behavior. Open to the lead: exact internal filenames or dependency injection if current packaging requires them. Choose the smallest change passing all named cases. Any intentional behavior change is a separate decision.

## 9. Ordered implementation

1. **Lead-only — establishes the contract.** In a current-main worktree, trace the §5 entry points and packaging from `apps/windows-agent/src/index.ts`. Record current outcomes for §10 and compare current source against the cited revision. Gate: every consumer and baseline case is accounted for on the tracking issue. If already delivered, verify the installed result before retiring this proposal.
2. **Lead-only — owns the behavior change risk.** After step 1 implement §6 at the named §5 callers. Add canStartAuxiliaryClaim beside live claim counters in index.ts. Supply each of the four existing local busy flags. Keep counters and scheduling in the four original loops. Gate: the same test inputs give the §10 outputs before and after. Inspect the diff for any surface outside §4.
3. **Helper-ok — repeatable suite and packaging checks.** After step 2 run the §12 commands and named §10 fixtures against the modified callers. Return finished results or the failing test and exact error. Stop and ask the lead if any baseline differs, a case skips, or an affected build lacks a test runner. The lead inspects the complete diff and repeats decisive tests, then commits, pushes and lands through the repo queue.
4. **Lead-only — live acceptance and rollback decisions.** After landing, verify publish-windows-agent release and installed Windows build_sha. Observe a scheduled maintenance window on the installed Windows build and verify work pauses and resumes with no overlapping claim. Gate: record both revision and observed result, update this STATUS table, then close only this item's checklist entry.

## 10. Required tests and adversarial cases

Add named parameterized cases to the closest existing test suite for the §5 production entry points. Use controlled fixtures and record the exact pre-change values where the assertion calls for parity. Each row is an observable acceptance test.

| Input or hostile condition | Required observation | Proposed test name |
|---|---|---|
| unhealthy or unconfigured host | skips claim | windows-maintenance-checks_case_1 |
| pending maintenance with heartbeat | respects current lease | windows-maintenance-checks_case_2 |
| claim in flight | holds auxiliary count through completion | windows-maintenance-checks_case_3 |
| local loop already running | reschedules with original delay | windows-maintenance-checks_case_4 |

## 11. Constraints

Use an isolated worktree and the repository task gates, then a reviewed diff and normal PR. Preserve old callers and persisted records. No app-side migration, bypass, suppressed error, or direct server edit. UI changes require visual proof on the affected screens. Keep live-proof evidence on the same issue.

## 12. Access and environment

Read AGENTS.md and use docs/INDEX.md to locate the component and deployment instructions. GitHub access was verified for planning. Release, test-account and runtime access must be checked on the execution host. Use existing authorized test identities via the documented 1Password references in the vibe_coding vault. Fixtures need no production secrets. Do not include credential values in evidence.

- Windows render agent. From the repository root in a separate shell: cd apps/windows-agent && npm ci && npm test && npm run build.

## 13. Done, risks and rollback

Done requires all four STATUS rows to cite independently checkable evidence, including a merged revision, passing checks, installed revision, and this observation: Observe a scheduled maintenance window on the installed Windows build and verify work pauses and resumes with no overlapping claim. The primary risk is losing one of the distinctions in §5 or §10. On a regression, revert only the owning change through a PR, redeploy the previous verified behavior to every affected consumer and repeat the failed case. Keep `- [ ] live proof` on the same issue while acceptance is outstanding.

## Self-audit

1. Can a fresh session execute this? Sections 5–6 identify the baseline and callers; sections 9–12 name the sequence, tests, environment and observed outputs.
2. Is the reasoning recoverable? Sections 3–8 distinguish the audit evidence, compatibility constraints, rejected approach and the remaining implementation judgment.
3. Can the lead resolve a conflict? Section 1 states the business outcome, section 8 bounds discretion, and section 13 gives acceptance and rollback. Self-audit passed for this scoped plan.

## Lead launch prompt

```text
Execute only approved cleanup 05, Windows maintenance checks, in u2giants/popdam3. Read AGENTS.md, docs/INDEX.md, this plan’s STATUS and linked handoff. Do step 1 and step 2 yourself. Delegate step 3 verification only. Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Follow https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md . Require finished work or a blocker with the exact evidence. The helper makes no design decisions, merges or posts, and stops at the step 3 trigger. Take the work back after 30 minutes stuck. Personally verify the tests and diff, own landing, carry out step 4 and update STATUS and the tracking issue.
```
