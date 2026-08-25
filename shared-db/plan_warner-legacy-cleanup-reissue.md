# Plan: reissue the stranded Warner legacy cleanup

Paired handoff: [`HANDOFF.d/2026-08-25T1540Z-edge-dev-codex-warner-cleanup-reissue-plan.md`](HANDOFF.d/2026-08-25T1540Z-edge-dev-codex-warner-cleanup-reissue-plan.md)

## STATUS

| Step | State | Evidence |
| --- | --- | --- |
| 1. Record the owner rulings and make #1517 dispatch-ready | ⬜ open | Owner ruling in the 2026-08-25 Codex task; must be recorded on #1517 |
| 2. Claim the exact objects and reserve a fresh migration version | ⬜ open | `scripts/manage-migration-author-lanes.mjs` claim output and issue comment |
| 3. Author the fresh migration and retire the stranded original | ⬜ open | New migration, guard entries and tests |
| 4. Reconcile the contradictory operating documentation | ⬜ open | Promotion procedure and Warner status report |
| 5. Review, merge and prove the exact `main` head | ⬜ open | PR checks, merge SHA and `origin/main` ancestry |
| 6. Rehearse only the new version on preview | ⬜ open — separate owner authorization required | Successful bounded preview workflow and post-apply catalog proof |
| 7. Promote only the new version to production | ⬜ open — separate owner authorization required | Immutable review evidence, production apply and post-apply proof |
| 8. Regenerate types and close the governed work | ⬜ open | Types diff/build, completion report and closed #1517 |
| 9. Apply the approved handoff/branch housekeeping rulings | ⬜ open — repository maintenance, not orchestrator work | Separate maintenance PR(s) with evidence |

**Fresh-session starting point:** Step 1. Read this plan end to end, then read the paired handoff and live issue #1517. At the end of every phase, re-read every downstream phase through step 9 and report any drift before continuing.

## 1. Ultimate goal

Remove Warner's retired first-generation capture objects without losing the 4,158 canonical relationships in the normalized tables, without weakening the migration safety gates, and without spending the stranded original migration's one remaining preview opportunity on evidence that production must reject.

When complete, the retired loaders and misleading empty API views will be gone, the current normalized Warner model will still work, generated types will match the live structure, the historical stranded version will be permanently refused, and the repository will explain the exceptional fresh-version route accurately.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

`u2giants/shared-db` is the canonical structural repository for the shared Supabase PostgreSQL backend used by POP Creations applications. `plm` holds private licensor landing structures; `api` is browser-reachable; `core` is canonical master data. Warner's licensed source portal is STARLABS.

- Repository: `u2giants/shared-db`, private.
- Canonical branch: `main`; structural work uses an isolated branch, PR and the single orchestrator route.
- Governed issue: [#1517](https://github.com/u2giants/shared-db/issues/1517).
- Original migration: `supabase/migrations/20260814170749_wb_retire_legacy_capture_paths.sql`.
- Preview and production project refs must be resolved from protected configuration and proved immediately before every write; never copy their values into this public repository.

## 3. Trigger

Migration `20260814170749` merged in PR #979 but was never rehearsed on preview or applied to production. The producer-byte gate now requires rehearsal evidence created by producer files matching the authoring merge. Those files changed, while the authoring-era preview project was deleted on 2026-08-18. The original is therefore structurally stranded even though its SQL is safe.

On 2026-08-25 Albert approved all six Kimi-reviewed recommendations:

1. Reissue the cleanup under a fresh version and hard-block the original.
2. Reconcile the stranded-migration exception inside the existing production procedure.
3. Ship no replacement browser API view in this cleanup.
4. Extend evidence-based stale-handoff retirement to any session; do not delete merely because an issue is closed.
5. Retire the completed Paramount preview-capture handoff through its owner or the evidence-based escape hatch.
6. Drop abandoned commits `26828c9` and `ada0298` after confirming they are obsolete or duplicated. That confirmation was completed in the deciding Codex task.

These rulings authorize planning and normal repository work. They do **not** authorize preview rehearsal or production promotion; each remains a separate owner-named action.

## 4. Scope

### In scope

- A fresh migration carrying the original cleanup SQL without editing the original file.
- Retirement/hard-block metadata and refusal tests for `20260814170749`.
- Reconciliation of the promotion procedure and Warner status report.
- Governed PR, merge, preview rehearsal when separately authorized, production promotion when separately authorized, types regeneration and completion record.
- Evidence-based cleanup of the three approved stale handoffs and two abandoned branches, as separate repository-maintenance work.

### Not in scope

- No replacement direct Warner property-to-character API view.
- No weakening of producer-byte binding, preview co-presence, business-risk gates, or migration guards.
- No edit to `20260814170749`.
- No direct DDL or database write from a developer shell or MCP.
- No preview or production action merely because the code PR merged.
- No change to normalized Warner relationship data.
- No bulk sweep of every pre-2026-08-18 stranded migration; open a separate issue if desired.

## 5. Current state

- `origin/main` contains the original migration and the stranded-work handoff at commit `d6866a5` or later.
- Issue #1517 is OPEN and its scope block still says `status: owner-decision`; that must be updated to `ready` with a comment linking the owner ruling before dispatch.
- Production read-only evidence from 2026-08-25 found all eight legacy tables empty, 4,158 rows in `plm.wb_property_character_normalized`, no legacy capture in flight, and both misleading API views still present and empty. Re-derive these facts before any write.
- The original version is in neither preview nor production's migration ledger; preserve that state.
- `types/database.types.ts:28883` still includes the legacy table definition.
- `docs/verification/unapplied-20260814-migrations-status-20260825.md` contradicts itself: it records the migration as stranded but still says to apply the original after rehearsal.
- `docs/production-promotion-procedure.md:71` says to promote the original, while its warning beginning around line 133 already describes the fresh-version recovery. Reconcile these passages rather than adding a third independent rule.
- Commits `26828c9` and `ada0298` were inspected: the former describes a Paramount production failure since resolved; the latter duplicates LAST RUN evidence already on `main` via PR #1426. Both should be dropped, not merged.

## 6. Key findings and root cause

`scripts/production_business_risk_gate.py`, function `prove_preview_producer_matches_main`, binds qualifying preview evidence to producer files matching the authoring PR merge. PR #979's workflow blob and current `main` differ. Rehearsing the original now would apply it to preview while producing evidence the production gate must reject; an applied version cannot rehearse again.

The original SQL is self-protecting. Its `do $$` preflight takes the Warner capture advisory lock, refuses an in-flight legacy capture, and refuses if any of the eight legacy tables contains a row. It then tightens capture targets and removes eight tables, eighteen functions and two empty API views. Later Warner migrations read normalized objects only and do not recreate the removed structures.

The defect is not unsafe SQL. It is two valid controls colliding: producer-byte binding and replacement of the old preview environment. The supported recovery is a fresh version carrying the same SQL plus permanent retirement of the original.

## 7. Rejected approaches

- **Rehearse the original on current preview:** rejected because it permanently consumes the only rehearsal while producing non-qualifying evidence.
- **Rehearse at PR #979's authoring commit:** impossible because that workflow hard-codes the deleted preview project and asserts it before work begins.
- **Edit the original migration:** rejected because applied migration files are immutable, and existing Warner tests assert its contents.
- **Retire the cleanup entirely:** rejected by owner ruling; it leaves callable retired loaders and misleading empty API views.
- **Bundle a replacement API view:** rejected as scope creep with no current consumer.
- **Weaken the byte-binding gate:** rejected; it protects nine applications sharing one database.
- **Delete handoffs solely because their issue is closed:** rejected; closure can mean duplicate, cancellation or supersession rather than completion.
- **Merge `26828c9` or `ada0298`:** rejected after inspection showed stale or duplicated documentation.

## 8. Locked and open decisions

### Locked on 2026-08-25

- Reissue under a fresh version; permanently retire the original.
- Cleanup only; no new API view.
- Reconcile existing production-procedure passages in place.
- Use evidence-based handoff retirement open to any session, not issue-state-only deletion.
- Drop both abandoned documentation commits.
- Do not weaken any database safety gate.

### Still requires future owner authorization

- Dispatching the preview workflow in apply mode for the **new** version.
- Promoting the **new** version to production.

Those are separate authorizations and must never be bundled or inferred from approval of this plan.

## 9. Implementation plan

### Phase A — make the governed work dispatchable

1. Re-read live `AGENTS.md`, this plan, the paired handoff, #1517, current orchestrator marker and queue audit. Update #1517's scope block from `owner-decision` to `ready`, and add one comment recording all six owner rulings plus the Kimi recommendation summary. Do not claim or author from this repository-maintenance session.
   - **Gate:** `gh issue view 1517` shows `status: ready`, the unchanged structural route/object scope, and the owner-ruling comment.
2. The active shared-db orchestrator dispatches #1517 from scratch. The migration author claims every dropped/changed object named in #1517 and reserves a version above the current maximum using `scripts/manage-migration-author-lanes.mjs`; never select a timestamp casually.
   - **Gate:** queue audit accepts the scope, the claim is live, and the reserved version is unique.

**Context cut:** the migration author may be a fresh sub-session, but must re-read phases B–E before starting and again at phase end.

### Phase B — author the bounded forward repair

3. Create `supabase/migrations/<reserved>_wb_retire_legacy_capture_paths.sql` by copying the SQL bytes from `20260814170749` through a reviewed repository operation. Do not retype it and do not edit the original. Permit only the version/header difference required by repository convention.
   - **Gate:** a normalized byte comparison proves the executable SQL matches; `node --test tools/sync-warner-starlabs.test.mjs` passes.
4. Add `20260814170749` to `RETIRED_VERSION_REASONS` in `scripts/post_batch_app_verification.py` and `HARD_BLOCKED` in `scripts/production_migration_guard.py`, naming the fresh replacement. Add tests proving explicit requests and broad include paths refuse the original while allowing the fresh version.
   - **Gate:** `python -m pytest scripts/test_production_migration_guard.py` and the relevant post-batch tests pass; drift classification reports `[RETIRED]` for the original.
5. Reconcile documentation in the same PR:
   - edit `docs/production-promotion-procedure.md:71` to cross-reference the existing stranded-migration warning and define the narrow trigger;
   - correct every stale Warner heading/table/recommendation in `docs/verification/unapplied-20260814-migrations-status-20260825.md`;
   - record that the new version supersedes the original and no new API view is included.
   - **Gate:** `rg` finds no instruction to rehearse/apply `20260814170749`; the procedure contains one coherent rule rather than competing passages.
6. Run `scripts/check-sql.sh`, focused guard tests, Warner tests, handoff/plan guards and any required repository suite. Obtain one independent review of the reissue mechanics; the unchanged SQL does not need a third safety review unless the byte comparison fails.
   - **Gate:** all local checks pass and the reviewer has no unresolved Critical/High/Medium finding.

### Phase C — merge without applying

7. Open the governed PR, satisfy the exact-object claim and all required checks, use guarded merge, and merge it. Do not rehearse either version during PR authoring unless Albert separately authorizes preview apply.
   - **Gate:** PR is merged, `origin/main` contains the merge SHA, all required checks correspond to that head, and `20260814170749` remains absent from both ledgers.

**Context cut:** stop after merge if preview authorization is absent. Re-read phases D–E before any environment action.

### Phase D — preview rehearsal, only after separate authorization

8. After Albert explicitly names preview rehearsal of the fresh version, freeze competing preview/merge activity as required. Prove the preview target immediately before the write. Dispatch `.github/workflows/shared-supabase-migrations.yml` with `target: preview`, `mode: apply`, a one-version `preview_allowlist`, and the exact claim PR/head SHA. Never include the original.
   - **Gate:** workflow succeeds at exact current `main`; preview ledger contains only the fresh version; all eight legacy tables and both old API views are absent; normalized tables and inferred views still work; no licensed rows are exposed.
9. Regenerate `types/database.types.ts` from the verified preview structure using the repository-supported command and review the diff. Do not hand-edit generated types.
   - **Gate:** the legacy `wb_property_character` table and retired functions are absent, normalized definitions remain, and the type build/tests pass.
10. Commit the generated types through a focused PR if they were not safely included earlier, merge after checks, and re-prove exact `main`.
   - **Gate:** generated types on `main` match the rehearsed preview catalog.

### Phase E — production, only after a second separate authorization

11. After Albert explicitly names production promotion of the fresh version, re-read `docs/production-promotion-procedure.md` and `AGENTS.md` §5.1-A. Freeze merges, prepare the pruned bounded checkout, run the production business-risk review and immutable evidence workflow, and prove the production target immediately before the write. Never use `--include-all` against the full repository.
   - **Gate:** the bounded dry run names only the fresh Warner version; immutable evidence says `APPROVE`; exact-head and environment gates pass.
12. Apply the fresh version through the production workflow and verify in the same window: ledger entry present; eight legacy tables, eighteen functions and two views absent; normalized relationships preserved; inferred Warner views still work; no capture is in flight.
   - **Gate:** a redacted verification artifact binds every claim to the production target and exact deployed head.
13. Publish the structured completion report with `scripts/manage-migration-author-lanes.mjs --complete-work --issue 1517 --report-file <path>`, then close #1517 only after the tool says completion is recorded.
   - **Gate:** completion comment is accepted, issue #1517 is closed, and claim/queue audit is clean.

### Phase F — approved repository housekeeping

14. In separate repository-maintenance work, implement the evidence-based handoff escape hatch in `AGENTS.md`/guard tests: any session may retire an abandoned handoff only when the owner is genuinely gone and the deleting PR states evidence of completion, supersession or intentional abandonment. Closed issue alone is insufficient.
   - **Gate:** tests cover completed, cancelled, duplicate and still-open workstreams; no blanket deletion rule exists.
15. Retire the completed Paramount preview handoff using its owner or the new evidence-based escape hatch. Retire the two stale closed-issue handoffs only after checking each file's own completion contract, especially ColdLion's richer phase condition.
   - **Gate:** deletion PR body cites the required evidence for each file; handoff guard passes.
16. Delete the obsolete remote branches carrying `26828c9` and `ada0298` only after confirming their commits are not merged and contain no unique work. Do not delete the worktree directories in this plan; worktree cleanup is a separate verified operation.
   - **Gate:** remote branches are absent, `main` retains the correct Paramount caveat and LAST RUN evidence, and no filesystem worktree was destructively removed.

## 10. Tests required

- `node --test tools/sync-warner-starlabs.test.mjs`.
- `python -m pytest scripts/test_production_migration_guard.py`.
- Focused post-batch verification tests covering retirement classification.
- `scripts/check-sql.sh`.
- Handoff contract/plan-document guards for new and deleted handoffs.
- A new refusal test that explicitly names `20260814170749`.
- A normalized executable-SQL equivalence check between original and replacement.
- Preview catalog/behavior verification after rehearsal.
- Generated-type build/tests after regeneration.
- Production catalog/behavior verification after promotion.

## 11. Constraints and gotchas

- Structural work routes through the single shared-db orchestrator; repository documentation/housekeeping does not consume a migration-author lane.
- Use isolated worktrees. Never edit another session's worktree, branch, claim or handoff.
- Never rehearse or promote the original version.
- Preview and production apply are separately owner-authorized.
- Prove the exact target immediately before every database write.
- Preview and production diverge; success on one does not prove the other.
- Freeze merges before production staging/apply.
- `db push` is atomic per file, not per batch; use one-version bounded sets.
- Dollar-quoted `do $$` bodies are not fully visible to the static preflight scanner; read the SQL and rely on apply-time preflight plus independent review.
- Do not expose licensed Warner rows in public artifacts or reviewer prompts.
- Before the first commit, `git var GIT_COMMITTER_IDENT` must show `Albert Hazan <u2giants@users.noreply.github.com>`.

## 12. Access and environment

- `gh` is authenticated as `u2giants` for issues, PRs and workflows.
- Supabase access is read-only through MCP; applies go only through governed GitHub workflows.
- Secrets remain in 1Password vault `vibe_coding`; never print values or put them in command arguments, logs, commits or prompts.
- Machine for this plan: `edge-dev`.
- Implementation must start from a fresh isolated worktree at current `origin/main`, not the plan-authoring worktree after this plan lands.

## 13. Definition of done, risks and open questions

### Done means

- Fresh migration merged under a unique reserved version.
- Original version retired and hard-blocked with tests.
- Contradictory docs corrected.
- Preview rehearsal completed only after explicit authorization and verified end to end.
- Types regenerated from verified structure and merged.
- Production promotion completed only after a second explicit authorization and verified end to end.
- Completion report accepted and #1517 closed.
- Approved handoff/branch housekeeping completed with evidence, without deleting unique work.
- This plan and its paired handoff are retired in the finishing PR when every obligation is complete.

### Risks

- Accidental rehearsal of the original permanently strands preview evidence. Mitigation: hard-block before apply and one-version allowlists.
- Legacy tables could receive rows before the window. Mitigation: re-read live state and preserve the migration's apply-time refusal.
- Concurrent merge could invalidate production evidence. Mitigation: merge freeze and exact-head checks.
- Types could be generated from the wrong environment. Mitigation: bind generation to the just-verified preview target and review the diff.
- Housekeeping could erase an unfinished workstream. Mitigation: evidence-based, file-specific completion checks; issue closure alone never suffices.

### Open questions

None for authoring. Preview and production timing remain intentionally undecided until Albert separately authorizes each action.

## Mandatory self-audit

1. **Can a brand-new session execute this without chat context? Yes.** Sections 1–8 define the business goal, repository, root cause, rejected paths and locked rulings; section 9 gives file-specific phases and gates.
2. **Does it preserve all relevant reasoning? Yes.** Sections 5–8 carry the stranded-evidence mechanism, the collision of valid controls, the Kimi corrections, and every rejected alternative.
3. **Is the goal sufficient when a step proves wrong? Yes.** Section 1 prioritizes removing only retired objects while preserving normalized Warner capability and every safety gate.
4. **Does every remaining phase instruct downstream re-reading? Yes.** The STATUS starting point and each context cut require re-reading all downstream phases and reporting drift.
