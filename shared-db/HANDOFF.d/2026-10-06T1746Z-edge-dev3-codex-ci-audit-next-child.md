---
issue: 3536
status: OPEN
owner: Codex chat 01a111e8-4c90-7df0-9106-4547392130ce on edge-dev3
---

# CI audit deferred cuts: next-session handoff and copyable prompt

Facts below were checked against GitHub and `origin/main` on October 6, 2026 at 1:46 PM EDT unless a different time is stated. Recheck live state before acting; other shared-db sessions can change it quickly.

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

None. The next checklist item is a technical acceptance check under an existing parent issue. Albert's standing instruction is that AI handles technical review, GitHub mechanics, and merging; do not ask him for a technical approval. No database or production action is requested by this handoff.

## 1. What this application is

`popcre/shared-db` is POP Creations' canonical shared Supabase database repository and also owns the migration authoring, preview, guarded merge, and CI machinery used by several applications. GitHub `main` is authoritative. Its repository maintenance issues do not authorize changes to database structure or rows. The current task is CI workflow maintenance only.

Start at the repository's `AGENTS.md` router, then `docs/agents/current-workflow.md`, `docs/agents/standing-facts.md`, `docs/agents/in-flight-check.md`, and `docs/agents/merge-protocol.md` only as the chosen work requires. Current project instructions supersede historical marker/orchestrator text elsewhere.

## 2. What this session set out to do, and why

The inherited CI audit sought to make the scheduled Author Lane Abandonment Audit return a trustworthy 0 (clean) or 2 (expired claims) rather than 3 (unverifiable), then advance the CI cut list on parent [#3536](https://github.com/popcre/shared-db/issues/3536). The audit follow-up [#3541](https://github.com/popcre/shared-db/issues/3541) is now closed. The parent directs each session to take the **first unticked independently actionable child only**, complete it, tick it, comment which child is next, and stop. Deferred items with active owners stay with those owners.

The first unticked child at this handoff is **Documents-only merge authorization redesign**, linked to [#3383](https://github.com/popcre/shared-db/issues/3383) and [PR #3523](https://github.com/popcre/shared-db/pull/3523). Both are already closed/merged, but parent #3536 still has the child unticked. The next session should reconcile its acceptance with current live evidence; do not start the later cuts in the same session.

## 3. Current state — verified outcomes and unfinished work

- [PR #3964](https://github.com/popcre/shared-db/pull/3964) merged October 6 at 12:52 PM EDT, exact PR head `c1b2f4b965548fe4741b9f46c59d68f10ce131ed`, merge commit `4763e6894a173a74c36531d6fe100e73a162883a`. It made `--abandonment-audit` capacity-only in `scripts/manage-migration-author-lanes.mjs:4400` and `scripts/orchestrator-flow/reconcile.mjs:244-290`; preview remains a separate full-reconciliation gate. It added tests and updated the live anti-collision documentation. Required tests and governed exact-head review passed before merge.
- The **scheduled**, workflow-token main run [37502077707](https://github.com/popcre/shared-db/actions/runs/37502077707) started October 6 at 1:15 PM EDT on head `8f366d9c91c34ac7c9d02e89c543dc96e47ce077`, descendant of that merge. It exited **2** by design: capacity `REPORT_ONLY`, 15 expired actions, zero unverifiable capacity records, preview `NOT_EVALUATED`. This met #3541's live-proof criterion. The issue was updated with run ID and closed.
- [PR #3979](https://github.com/popcre/shared-db/pull/3979) merged October 6 at 1:19 PM EDT, merge commit `ca623396bf57566d0342c1fbafb5ee9e6965ce53`. It removed the completed predecessor handoff. The removed file is absent on main.
- Five other sessions' expired, absent-worktree claims were put into **reversible capacity quarantine**: claim #3738 → [evidence #3971](https://github.com/popcre/shared-db/issues/3971), #3739 → [#3972](https://github.com/popcre/shared-db/issues/3972), #3728 → [#3974](https://github.com/popcre/shared-db/issues/3974), #3705 → [#3975](https://github.com/popcre/shared-db/issues/3975), #3704 → [#3978](https://github.com/popcre/shared-db/issues/3978). Readback showed `capacity_state: relinquished` and each matching `blocked_on` issue. Claims, exclusive object protections, reserved migration versions, branches, and work remain. Draft [PR #3962](https://github.com/popcre/shared-db/pull/3962) and [PR #3963](https://github.com/popcre/shared-db/pull/3963) preserve committed work for the first two; **do not merge them as part of CI maintenance**. Remaining expired claims were *reported*, not presumed abandoned.
- On #3536, the historical merchandise-group workflow retirement was the first unticked child handled this session. Its [PR #3606](https://github.com/popcre/shared-db/pull/3606) was already merged; 45 relevant tests and the throughput truth audit passed. Its checklist box was ticked, child #3605 closed, and a signed parent comment named the documents-only item as next. #3536 remains OPEN.
- For the next documents-only item: [#3383](https://github.com/popcre/shared-db/issues/3383) is CLOSED; [PR #3523](https://github.com/popcre/shared-db/pull/3523) is MERGED at `92c7897c3b7b70b9d6e6c11cdb1aa2e8dfff32dc`. A later real prose-only [PR #3979](https://github.com/popcre/shared-db/pull/3979) passed `Documents fast CI route` in 13 seconds, `Documents-only merge authorization` in 26 seconds ([run 37502454942](https://github.com/popcre/shared-db/actions/runs/37502454942)), `Handoff contract` in 15 seconds, and the prose-only guarded authorization. It merged without waiting for the full engineering matrix. Inspect its exact files and check results before deciding that the parent child is accepted.
- The two temporary worktrees this session created for #3541 were clean, their PRs merged, and they were removed. The Codex desktop worktree was left clean. No preview or production database writes were made. No sub-agents were dispatched. No new secret appeared in this session. The handoff file itself is the only new change this prompt-writing session intends to make.

## 4. Everything tried that did not work

1. Before PR #3964, a local abandonment audit and earlier scheduled run returned exit 3 even though author-capacity reads succeeded. The audit unnecessarily derived historical preview readiness, including unreadable old run evidence. A fresh token permission was not the remaining fix. The capacity-only mode repaired this without weakening preview preparation.
2. A manual main workflow dispatch [37499380040](https://github.com/popcre/shared-db/actions/runs/37499380040) exited 2 under the workflow token, but #3541 explicitly required a **scheduled** run. Do not cite that dispatch alone as acceptance; run 37502077707 is the scheduled proof.
3. For PR #3964 the first assigned StepFun review timed out without a verdict; the allocator's guarded failed-reviewer replacement selected GLM. GLM's first output said `APPROVE (provisional)` and was non-authorizing; a continued GLM session produced the durable exact-head APPROVE. Do not reuse an earlier head's review after new code changes.
4. An active concurrent claim #3976 briefly made the local audit exit 3 because its title omitted its work issue number. Its title was corrected to identify #3973 without touching lease or object scope; the audit returned 2 before any further claim mutation. Do not treat exit 3 as evidence of abandonment.
5. The first immediate admin merge attempt for prose-only PR #3979 was rejected while required statuses were expected. The documents-only authorization and handoff guard completed shortly afterward; a second merge succeeded. The prose shortcut does not bypass an actually pending GitHub protection status.

## 5. Root causes and key findings

- `scripts/orchestrator-flow/reconcile.mjs:244-250` now refuses a purported capacity-only audit unless report-only capacity and a genuinely unevaluated, zero-action preview are explicit. `scripts/manage-migration-author-lanes.mjs:4400-4402` selects that mode only for `--abandonment-audit`; full preview reconciliation remains strict.
- Expiry is **not** abandonment. `docs/agents/section-4-anti-collision-rules.md:80-185` and `.github/ISSUE_TEMPLATE/author-lane-abandonment.md` require a separate evidence issue and exact claim/PR/head/owner tuple before guarded capacity relinquishment. Releasing capacity is reversible; releasing a claim is a different, terminal act.
- Parent #3536's checklist can lag merged child work. The documents-only child is the current example: #3383 and PR #3523 landed, but the parent remains unticked. The parent execution rule calls for *one* child reconciliation and then a stop, not a sweep of all remaining cuts.
- [PR #3979](https://github.com/popcre/shared-db/pull/3979) supplies a recent real prose-only trace for the #3383 acceptance criterion. Its merged status, check timings, changed-file list, and authorization run are stronger evidence than the old issue text saying “in flight.” The next session must verify that trace rather than assume acceptance.

## 6. Exact next steps for a fresh session

1. Create a **fresh worktree from current `origin/main`** for any edits; do not write in a shared checkout. Run `ai-task-gates start --class prose` if only issue/document reconciliation is needed, or redeclare `code` if a real code gap is found. Verify `git status` clean and current issue/PR state. **Success:** the session is anchored to current main and no other session's files are touched.
2. Open [parent #3536](https://github.com/popcre/shared-db/issues/3536) and read its first unticked child and execution rule. Recheck [#3383](https://github.com/popcre/shared-db/issues/3383), [PR #3523](https://github.com/popcre/shared-db/pull/3523), and the current documents-only workflow/check implementation. **Success:** the child is still first and its acceptance text is understood; if another session already ticked it, do not duplicate work—take the then-first unticked independently actionable child under the same rule.
3. Verify the **real prose-only trace** in [PR #3979](https://github.com/popcre/shared-db/pull/3979): exact changed file was only the retired Markdown handoff, fast route and documents-only authorization passed, the PR merged, and no full engineering wait was required. Recheck negative tests and required-status names if evidence is ambiguous. **Success:** the child’s mode/rename/deletion/instruction safety and live prose route are supported by merged code/tests plus a real PR trace; if not, repair only this child through normal branch/PR/review/merge gates, never weaken checks to make it green.
4. If accepted, edit only the #3536 body to tick **Documents-only merge authorization redesign** with links to #3383, PR #3523, and the live trace PR/run; preserve all prior signatures and add `Posted by Codex chat <CODEX_THREAD_ID> on <hostname>`. Add a signed parent comment naming the **next** first unticked child, presently ledger-drift main-reddening (#2508 / PR #3518). Then stop. **Success:** one newly ticked box, one next-child comment, all later boxes still unticked, parent still open.
5. Leave the five quarantine records and preservation PRs under their **own** work issues. They are not part of #3536's next child. **Success:** no claim/object/branch/database mutation from this CI checklist reconciliation.

## 7. Constraints and gotchas in force

- Project AGENTS.md §0.0-D supersedes older orchestrator/marker language: structural work is claim-first; this task is repository maintenance. The parent #3536 first-child rule is binding and says stop after one child.
- GitHub is code truth. A write-capable task gets its own current-upstream worktree; protected main is not pushed directly. Before a first commit verify `git var GIT_COMMITTER_IDENT` is Albert Hazan's noreply identity. Stage only owned files. Use repository PR and gate paths for any code change.
- Recheck `ai-task-gates` before review, PR wait, ship, infrastructure, database, or production action. Never work around a refusal. Technical approvals come from the assigned AI reviewer, never Albert.
- All GitHub text this session posts must carry the `Posted by Codex chat <id> on <machine>` signature. Human-facing clock times must say EDT/EST. Do not expose credentials in prompts, comments, logs, or commits.
- Do not merge draft preservation PRs #3962/#3963, terminally release quarantined claims, or mistake an audit exit 2 for a failing repair. Exit 2 is the truthful expired-lane report.
- Avoid broad tests or a new PR when existing live proof satisfies the documents-only child. If a gap is found, change only that child and follow the code review/merge lane.

## 8. Access and environment

- Repository: `https://github.com/popcre/shared-db`; this handoff is in `HANDOFF.d/2026-10-06T1746Z-edge-dev3-codex-ci-audit-next-child.md`. Created from `origin/main` `eb53599bac94accdbd23ab89c94265bd490dc47f` at 1:46 PM EDT on October 6, 2026; this SHA is a snapshot, **not** a base to reuse later.
- `gh` and `git` authenticated successfully on `edge-dev3` for read, issue edit/comment, PR create, guarded merge dispatch, and prose-only merge. `node` and `ai-task-gates` are installed. A new session should verify its own host and identity.
- No secret value or connection string is needed for the next checklist child. If a later task needs one, the company vault is 1Password `vibe_coding`; never copy values into this handoff.
- No production or shared preview database write occurred. Do not infer either database is clean from this statement; it only describes this session.

## 9. Open questions and risks

- No business decision is waiting on Albert. Whether #3383's live acceptance is complete is a technical evidence check for the next session; the recommendation is to use PR #3979's real trace and existing negative tests, tick if they satisfy the documented criterion, and avoid new code if so.
- The #3536 parent currently labels the documents-only item “in flight” despite #3383 being closed and PR #3523 merged. This wording is stale as of 1:46 PM EDT October 6, 2026; verify before editing because another session may reconcile it first.
- Five quarantined claims remain **protective** and their own work is not complete. Their evidence issues are the durable recovery cards. Other expired claims remained report-only because expiry alone does not prove absence.
- Draft PRs #3962/#3963 must stay draft until their structural workstream decides recovery or terminal retirement. They were opened to preserve existing branch heads, not to authorize a database change.

## Copy-paste prompt for the next session

```text
In popcre/shared-db, work from a fresh worktree cut from current origin/main. Read AGENTS.md and HANDOFF.d/2026-10-06T1746Z-edge-dev3-codex-ci-audit-next-child.md first. Parent issue #3536 is the CI audit cut list. Its execution rule is to take the first unticked independently actionable child, complete ONLY that child, tick it, comment the next child, and stop. Do not sweep later cuts or change the database.

As last verified October 6, 2026 at 1:46 PM EDT, the first unticked child is Documents-only merge authorization redesign (#3383 / PR #3523). Issue #3383 is closed and PR #3523 merged, but the parent box remains unticked. Inspect their acceptance evidence and a real prose-only merged trace: PR #3979 changed only a Markdown handoff, passed Documents fast CI route and Documents-only merge authorization (run 37502454942), and merged without a full engineering wait. Recheck live states, required status names, negative safety tests, and the exact changed-file inventory. If acceptance is satisfied, tick only this child in #3536, cite #3383, PR #3523, PR #3979 and the run; sign the edit and comment which child is next (currently ledger-drift main-reddening #2508 / PR #3518), then stop. If evidence fails, repair only this documents-only child through the repository's normal guarded branch/PR/review/merge route and verify the outcome before ticking.

The Author Lane Abandonment Audit repair is finished: PR #3964 merged; scheduled run 37502077707 exited 2 with zero unverifiable capacity records; issue #3541 closed; handoff removal PR #3979 merged. Do not reopen it for an expected exit 2. Five absent-worktree claims were quarantined with recovery issues #3971, #3972, #3974, #3975, #3978; their work and object protections remain. Draft PRs #3962 and #3963 preserve old branch heads and must not be merged as part of this CI task. No production or preview writes were made by the predecessor session. Ask Albert only a genuine business-meaning question, never for technical approval.

Success check: parent #3536 has exactly this one additional box ticked with signed proof and a signed comment naming the next child, while later boxes and the five recovery workstreams remain untouched. Follow the handoff's failure notes, constraints, and current-state links before acting.
```

## Self-audit

1. **Can a newcomer continue without questions? Yes.** Sections 1–3 name the repo, parent rule, current first child, merged proof, and separate protective claims; section 6 supplies ordered actions and a gate for each.
2. **Can they continue as effectively as this session? Yes.** Sections 4–5 record the failed audit, reviewer, claim-title, and prose-merge paths and the non-obvious distinction between expired and abandoned claims.
3. **Are goals, state, decisions, constraints, risks, next actions, and evidence present? Yes.** Sections 2–9 give those items with issue/PR/run identifiers and explicit deployment/write status; the copy-paste prompt gathers the operational sequence.
4. **Are all business-owner decisions consolidated? Yes.** A line-by-line check of sections 1–9 found no business decision. Section 0 explicitly says none; all remaining decisions are technical evidence or assigned AI review gates.
