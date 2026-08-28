---
issue: 1789
status: OPEN
owner: codex/non-orchestrator-sweep-closeout
---

# HANDOFF — non-orchestrator issue sweep (2026-08-28 22:58 UTC, EDGE-DEV/Codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert in one message before acting on any owner-only item.

### Blocking

- **#1353 — non-production applications currently point at production Supabase.** This is a production security/settings choice, not repository maintenance. Recommendation: keep it blocked until Albert names the exact environment bindings he authorizes changing; it blocks any connection-setting mutation.
- **#870 — production may sit inside a partly applied atomic migration batch.** The guard's behavior is not settled. Recommendation: require the safest fail-closed behavior and a separately reviewed recovery design before implementation; it blocks changing production promotion policy.
- **#696 — DesignFlow production needs the office/language columns and Uma owns the production DDL.** Recommendation: leave it with Uma and require direct catalog proof after her change; it blocks closing #696, but not the repository-maintenance sweep.

### Recoverable

- None.

### Already settled — do not re-ask

- **2026-08-28, #1435:** transfer `u2giants/shared-db` to `popcre` and keep it public. Do not execute while the active orchestrator, claims, or pull requests could be disrupted; refresh the live safety conditions first.
- **2026-08-21, #1366:** repository-maintenance and documentation issues are owned by a separate repo session, not the schema orchestrator.

## 1. What this application is

`u2giants/shared-db` is the public source of truth for the shared database structure and its guarded preview-to-production promotion process. It also contains DB Data Admin, repository coordination tooling, tests, workflows, and documentation. Multiple POP applications depend on it, so structural database work is serialized by one orchestrator while repository-maintenance work is handled separately. GitHub is the code and issue source of truth; production changes are never made by editing a server directly.

## 2. What we set out to do this session, and why

Albert asked to resolve through production every open issue that does not need the schema orchestrator. Issue #1789 is the durable tracker for that sweep. The objective was to classify every candidate from live issue data, close or forward obsolete work, repair genuinely actionable repository defects, merge the fixes, and verify production directly where an issue claimed a production outcome.

## 3. Current state — what is true right now

### Delivered and verified

- Closed, forwarded, or rerouted 33 issues during the sweep. Important closures included stale handovers, obsolete production-promotion tickets, duplicate work, abandoned remote worktrees, and reviewer incidents whose original capability was proven live.
- Forwarded application-owned work through the guarded return command: #851 to `u2giants/popcrm-web#6`, #650 to `u2giants/popdam3#104`, #509 to `popcre/designflow-data-syncing#21`, #854 to `popcre/ai-devops#172`, and #565 to `popcre/ai-devops#173`.
- Reclassified #974, #718, #652, #508, #748, and #552 as structural work so the schema orchestrator—not this repo session—owns them.
- Recovered unique remote commits for #689 to branches `recovered/issue-689-cloudsql-proof` and `recovered/issue-689-cutover-comparisons`, then removed only the exact verified worktrees. Fast-forwarded the clean `/worksp/shared-db` checkout for #557 to the then-current `origin/main`.
- Proved production migration-ledger health directly: 558 merged versions, 540 applied versions, 18 explicitly retired/held versions, and no actionable drift. Closed #506, #678, #680, and #681 only after exact applied-version proof.
- Proved the Muse reviewer live for #1351 and GLM reviewer live for #1627. Their diagnostic reports are local under `.ai/reviews/`; they contain no required source changes. The GLM incident `20260827T002811Z-edge-dev-GLM-4171081` was marked resolved through the supported incident tool.
- Fixed ColdLion pre-link failure alerting in `.github/workflows/coldlion-licensor-property-phase6-parallel.yml` with coverage in `tools/coldlion-licensor-property-phase6.test.mjs`. The workflow now opens a GitHub issue if the database dispatcher cannot read the failure row. Thirty-four targeted tests and all PR checks passed. PR #1794 merged to `main` as `8be72366bd69f4ab5dd418dd8b7a6353e7893ed4`; #536 is closed.

### Still open

The live 2026-08-28 22:58 UTC queue audit lists these repo-session items: #1789, #1435, #1403, #1391, #1356, #1322, #1286, #1285, #1268, #1262, #1258, #1235, #1224, #1223, #1201, #1182, #1161, #1158, #1031, #943, #880, #810, #771, #770, #620, and #519. Of these, #1403, #1391, #1235, and #770 are explicitly blocked; #1286 remains a time-based watch through 2026-09-02; #1789 stays open until the whole sweep is complete.

Owner-only issues #1353, #870, and #696 are listed in §0. Curated Master Data issues #933, #640, #562, and #505 remain governed forks and are not repo-session work. The live structural orchestrator marker is #1786; its exact routing target must be re-resolved before any structural handover.

The audit also reports newly unclassified or malformed queue items. Do not absorb them into this sweep by title: classify each from its body and the shape test. Issue #1792 is malformed and may be repository maintenance, but that is not yet proven by a valid scope block.

### Git and deployment state

- The implementation is merged and live in repository truth via PR #1794.
- This handoff is the only new file on branch `codex/non-orchestrator-sweep-closeout`; its pull request and merge proof are recorded in the issue comment made at closeout.
- The original checkout `C:\repos\shared-db` was dirty and behind; it was deliberately left untouched. Work used the isolated clean worktree `C:\repos\shared-db-worktrees\non-orchestrator-sweep-1789`.

## 4. Everything we tried that did NOT work

- Treating a closed issue or an empty table as sufficient proof was rejected. Production claims were closed only after the live migration ledger or catalog supported them.
- The preview ledger was not clean: it contained nine retired/held versions and orphan version `20260828113920`. That orphan belonged to active structural work (#1722/#1747/#1779), so this session did not alter or claim it.
- A normal cleanup of the disposable local clone `C:\Users\ahazan\AppData\Local\Temp\codex-hiclaw-883` was blocked by local destructive-command policy. The clone has no unique work and remains safe to remove later with an approved recoverable cleanup method.
- The old worktree and report paths named by #558 were absent across `/worksp`; without cited unique output, there was nothing recoverable to preserve. The issue was closed as disposable scratch rather than inventing evidence.
- Issue #1435 cannot safely be executed merely because Albert settled the destination organization. Repository transfer while an orchestrator and open work are active could break routes, claims, and automation, so live safety gates still control timing.
- Issues #1403 and #1391 cannot be forced closed: the former's retirement gates are not met, and the latter needs a suitable low-risk real migration rather than a purchased plan or synthetic claim.

## 5. Root causes and key findings

- The backlog mixed repository maintenance, documentation, owner-only security settings, curated Master Data, structural changes, application work, duplicates, and stale handovers. Live `db-work-scope` classification—not titles—determines ownership.
- Production completion means direct target evidence. Merge, preview success, or a migration filename alone is insufficient.
- Reviewer incidents must be closed only after both the symptom is gone and the original review capability works. Muse and GLM met that bar in live sessions.
- The ColdLion alert gap was caused by the failure handler depending on a readable dispatcher row. When that lookup failed, the workflow logged but created no durable alert. PR #1794 preserves the database path and adds GitHub as the fallback alert surface.
- Remote worktree cleanup required checking exact paths, cleanliness, unique commits, and Git identity before removal. #689 contained unique commits and was recovered; #557 was clean but stale; #558 had no recoverable artifact.
- The queue audit at closeout was not fully audited because it contained unclassified and malformed issues. That prevents any claim that no eligible work exists, but it does not transfer repository-maintenance work to the schema orchestrator.

## 6. Exact next steps

1. Fetch `origin/main`, run `node scripts/check-orchestrator-marker.mjs --resolve`, then run `node scripts/manage-migration-author-lanes.mjs --queue-audit`. Classify every new unclassified or malformed issue before selecting work. **You will know it worked when the audit no longer hides a candidate behind an invalid or missing scope block.**
2. Continue the ready repo-session list in small isolated branches, starting with low-risk guard/test/documentation defects (#1268, #1235 re-evaluation, #1285, #1262, #1258). For each: reproduce, preserve capability, add a regression test, open and merge the PR, verify the live result, then close the issue. **You will know each worked when its test/check passes on the merged commit and the issue is closed with evidence.**
3. Work the coordination-safety group (#943, #1201, #1182, #1161, #1158, #1223, #1224, #880) without weakening any guard. **You will know it worked when the failure mode is covered by a test that fails with the guard disabled and passes on `main`.**
4. Re-evaluate #1235 because its old dependency #1219 is closed; remove `status: blocked` only if the remaining defect reproduces independently. **You will know it worked when the scope block matches live facts and either a tested fix merges or the issue closes with exact supersession evidence.**
5. Leave #1286 open until 2026-09-02, then inspect merges since 2026-08-19 for semantic conflicts before closing. **You will know it worked when the full watch interval has elapsed and the issue records the reviewed evidence.**
6. Keep #1403 blocked until every contract-enforcement retirement gate in its issue is met. Keep #1391 blocked until a real low-risk migration can serve as the branch pilot. Keep #770 blocked until timed rehearsal #771 succeeds. **You will know each gate cleared when its dependency and acceptance evidence are explicit in the issue, not merely closed.**
7. Present §0's three blocking owner-only decisions to Albert together; do not mutate production settings or production Cloud SQL from assumptions. **You will know this worked when each issue records a current owner ruling or direct Uma completion evidence.**
8. After every remaining repo-session issue is resolved or truthfully blocked outside this workstream, close #1789 and retire both this handoff and its predecessor under the successor rule. **You will know the sweep is complete when the live audit has no repo-session item other than genuinely external/time-gated blockers, #1789 is closed, and the handoff files are removed in the finishing commit.**

## 7. Constraints and gotchas in force

- Never perform structural/schema work in this repo-session context; the single orchestrator dispatches it in isolated worktrees.
- Re-resolve the active orchestrator marker immediately before routing; #1786 is only the closeout snapshot.
- Shared-db uses branch, pull request, checks, merge, and direct target verification. Albert does not merge these PRs; the implementing session does.
- Production/shared-cloud infrastructure is read-only unless Albert names the exact resource and action in the current chat. Owner-only issues are not implicit authorization.
- Preserve every guard's intended capability. Do not silence, bypass, delete, or replace a broken check as a substitute for repair.
- Stage only owned files. Before the first commit verify `Albert Hazan <u2giants@users.noreply.github.com>`; this was verified for the closeout branch.
- Do not touch the dirty original checkout or another session's handoff. Never rewrite root `HANDOFF.md`.
- Curated Master Data issues remain gated even though ordinary row data is application-owned.
- Do not expose licensed data, database row contents, project refs, credentials, or reviewer prompts in public issues or commits.

## 8. Access and environment

- Machine: `EDGE-DEV`; shell: PowerShell; clean isolated worktree: `C:\repos\shared-db-worktrees\non-orchestrator-sweep-1789`.
- GitHub CLI is authenticated for `u2giants/shared-db`. Git identity was verified before closeout.
- Node-based queue, marker, and ledger tools work from the repository. Protected database credentials are injected through the repository's approved mechanism; secrets live in 1Password vault `vibe_coding` and must never be printed.
- Remote SSH access to `vps2`/the Hetzner workspace was available for the completed worktree recovery. Re-verify before relying on it in a new session.
- Reviewer wrappers for Muse and GLM passed live capability checks. Local diagnostic reports are under `.ai/reviews/` and are not required for source control.

## 9. Open questions and risks

- **Owner decisions:** #1353, #870, and #696 remain exactly as consolidated in §0.
- **2026-08-28:** #1435's destination is settled, but transfer timing is operationally risky while the active orchestrator and open work remain. Refresh all GitHub settings, automation, claims, and PR facts before execution.
- **2026-08-28:** the queue contains new malformed/unclassified items. Their ownership is unknown until valid scope blocks are established; guessing could steal structural work or leave maintenance invisible.
- **2026-08-28:** #1235 may no longer be blocked because #1219 closed, but closure alone does not prove the deferred defect was fixed.
- **2026-08-28:** #1286 cannot be concluded before 2026-09-02 without truncating the promised observation period.
- **2026-08-28:** the disposable hiclaw clone remains on local disk. It contains no unique work, but broad deletion must remain recoverable and exact-targeted.

## Self-audit

1. **Yes.** §§1–3 explain the product, goal, exact delivered state, live queue, branches, merge, and environments; §6 gives an executable continuation with verification gates.
2. **Yes.** §§4–5 preserve the dead ends and non-obvious findings; §§7–9 preserve the operating rules, access, decisions, uncertainty, and timing gates.
3. **Yes.** Background, intended result, evidence, failures, decisions, constraints, risks, exact actions, commit/push/deploy state, identifiers, and secret boundaries are covered in §§0–9. No gap remained after the checklist pass.
4. **Yes.** A line-by-line sweep of §§1–9 found three current owner judgements (#1353, #870, #696), all present with recommendations and consequences in §0. The settled #1435 choice is also indexed there so it is not re-asked. No sub-agents were dispatched in this session, so there is no part (b) owner decision to promote.
