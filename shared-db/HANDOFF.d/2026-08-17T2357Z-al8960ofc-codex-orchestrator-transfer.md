---
issue: 1146
status: OPEN
owner: codex/orchestrator-handover-2026-08-17T2357Z
---

# HANDOFF — shared-db orchestrator transfer (2026-08-17 23:57 UTC, al8960ofc/Codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Blocking now

None. The next orchestrator can resume all three active structural workstreams without asking Albert a question.

### Decisions that will be needed later, but do not block resumption

- **#1090 production approval:** after the complete licensing package has current-main review, preview proof, and a production risk report, the production workflow will likely require a new exact approval tied to that future main commit. Do not ask now because the commit and final risk list do not exist yet. Recommendation: finish the full package first, then ask once with the machine-generated approval block.
- **#1115 production approval:** ask only if the governed production risk report stops on a business risk that Albert has not already authorized. Recommendation: do not pre-emptively ask.
- **Sample Tracking Release A:** no new scope decision is needed. Albert already authorized exactly `20260814130000`, `20260814193402`, and then `20260817190000`. Releases B, D, E and unrelated drift remain excluded.

### Already settled — do not re-ask

- 2026-08-17: Qwen is out of reviewer rotation until Albert explicitly restores it. Historical Qwen evidence remains readable.
- 2026-08-17: #975 production scope is exactly the two Release A migrations plus the authorized reconciliation migration, in that order only.
- 2026-08-17: #1113 is not database work. It was closed and must continue privately in `popcre/designflow-item-master`, not shared-db.
- 2026-08-17: #1090 must not be promoted alone. It must ship only as the complete ordered compatibility, held-history, removal, and strict-cleanup package.
- 2026-08-17: preview version `20260817150944` is truthful historical structure, restored to main, and permanently barred from production.

The incoming orchestrator should present the entire section above to Albert in one message only when a listed future decision becomes current. Do not interrupt him piecemeal.

## 1. What this application is

`u2giants/shared-db` is the source of truth for the structure of the shared Supabase database used by POP Creations applications. It owns tables, columns, views, functions, triggers, permissions, indexes, constraints, generated database types, migrations, preview rehearsal, and bounded production promotion.

The shared hosted projects are:

- Preview: `rjyboqwcdzcocqgmsyel`
- Production: `qsllyeztdwjgirsysgai`

This repository uses one orchestrator session and three migration-author lanes. Each structural migration must have an exact GitHub issue, permanent version reservation, protected object list, branch, worktree, pull request, preview evidence, independent review, and production verification. Ordinary application data and offline analysis do not belong here.

The active orchestrator marker for this outgoing session is issue #1085. Close it only after this handoff pull request is merged and all closeout checks pass.

## 2. What we set out to do this session, and why

The session began as the successor orchestrator from `HANDOFF.d/2026-08-16T2118Z-al8960ofc-codex-orchestrator-transfer.md`. Albert required continuous use of all three author lanes, completion of #853 first, then #764, then the classified queue, with no use of retired `COORDINATOR_INTAKE.md`.

The session subsequently received explicit priorities for #1085, #1090, #1097, #1113, #1115, Sample Tracking Release A #975, reviewer-system repair, and removal of Qwen from active review rotation.

Business outcomes completed during this session include:

- #853 closed after production verification of its bridge and index work, with application-row work routed to PopDAM.
- #764 completed in production and closed, including live sequence verification.
- #898 completed in production and closed, removing DELETE permission from the three exact history tables while retaining the other intended permissions.
- #1097 planning completed and closed; its implementation successor #1113 was later identified as misrouted non-database work and closed.
- Qwen removed from new reviewer assignments while historical evidence remains readable.
- Reviewer failure-replacement, claim renewal, claim expansion, claim version supersession, production approval retry, GitHub comparison fallback, coordination retry, atomic migration, and verification recovery tooling were delivered through multiple reviewed pull requests.
- Preview's untracked historical version `20260817150944` was investigated, proven unique, restored truthfully to main, and barred from production without changing preview data.
- A detailed reviewer-system failure report was added to `u2giants/ai-devops/fix_reviewer_system.md`; ai-devops issue #34 tracks the generic reviewer fixes. Commit `d51655a` clarifies that ai-devops owns generic reviewer tools while shared-db owns database-specific scheduling.

The three unfinished business outcomes are #1090, #1115, and Sample Tracking Release A #975. Dedicated handover issues are #1147, #1148, and #1149.

## 3. Current state — what is true right now

### Moving facts, frozen at 2026-08-17 23:57 UTC

- `origin/main`: `d4c1f5a9f2358d74fc62606b6895c484bd8e2a1e`
- Highest migration version present on that main: `20260817225127_fr_owner_ruling_guard_compatibility.sql`
- Three of three author lanes occupied; zero expired claims.
- No preview or production apply was active when agents were stopped.
- One ordinary disposable-database CI job for #1115 was still running: run `32082357083`.
- The outgoing main checkout at `C:\repos\shared-db` is dirty with pre-existing user/other-session files. Do not clean, stage, reset, or commit from it. This handoff is authored from isolated worktree `C:\repos\shared-db-worktrees\orchestrator-handover-2026-08-17T2357Z`.

These facts will change when this docs-only handoff merges. The incoming session must fetch and re-read them rather than treating the values as permanent.

### Preview state

- Preview project identity has repeatedly been proven as `rjyboqwcdzcocqgmsyel` by governed workflows.
- Preview contains licensing guard migration `20260817124545` from #1090's successful earlier preview.
- Preview contains historical migration `20260817150944_sync_dflow_columns_onto_plm_designflow_copies`. It was originally created outside repository governance but its exact authoritative SQL is now on main after PR #1139.
- Verification run `32077713902` reports no preview ledger-only/orphan version after that restoration. This was a read-only proof. It made no database change.
- #1115 version `20260817235348` has not been applied to preview. Its prior attempt stopped before write when the historical file was absent from main. That blocker is now resolved.
- #975 reconciliation version `20260817190000` has not been applied to preview. Its prior attempt also stopped before write on the same now-resolved history mismatch.
- Preview is shared and is not “empty” or pristine. The statements above are the known session-relevant contents; the incoming session must rerun the drift tool before relying on them.

### Production state

- Production project is `qsllyeztdwjgirsysgai`.
- #853 bridge and index changes were applied and verified.
- #764 sequence repair version `20260817041506` was applied exactly once and verified live.
- #898 permission version `20260817031034` was applied exactly once and verified live.
- #1090 migration `20260817124545` is not to be promoted by itself.
- Held licensing migrations `20260802170000` and `20260802171000` remain deliberately unapplied. Their interaction with #1090 is the reason for the forward compatibility package.
- Sample Tracking Release A's two original versions and reconciliation have not been promoted under this session's bounded package.
- Preview-only history version `20260817150944` is explicitly production-held and must never be added to a production allowlist.

### Lane 1: #1090 licensing Master Data

- Parent issue: #1090, open.
- Dedicated handover issue: #1147.
- Active implementation issue: #1143.
- Claim: #1144.
- Reserved version: `20260817232425`.
- Protected objects: `app.enforce_licensing_write_authority`, `core.licensor`, `core.taxonomy_owner_ruling`, `plm.licensing_write_authorization`, `plm.licensing_write_guard_audit`, two indexes, one policy, and one trigger listed in claim #1144.
- Branch: `codex/issue-1143-fr-ruling-forward`.
- Worktree: `C:\repos\shared-db-worktrees\issue-1143-fr-ruling-forward`.
- PR: #1145, exact head `fd5e55835a599eafde803a5e9ede965328730d48`.
- All GitHub checks were green at handoff, including the disposable-database contract test.
- Grok review sequence 154 ended without a verdict. GLM sequence 155 was reported active, then the agent began Grok sequence 157 after interruption. The orchestrator killed the entire sequence-157 process tree. No unfinished review counts as approval. Start a fresh governed exact-head review.
- Predecessor compatibility issue #1140 / PR #1142 merged to main as `d4c1f5a9f2358d74fc62606b6895c484bd8e2a1e`, adding version `20260817225127`.
- After #1145, more work remains: complete FR removal and strict cleanup/proof under fresh claims, then preview and promote only the complete ordered group.

### Lane 2: #1115 bulk OrderList relink

- Parent issue: #1115, open.
- Dedicated handover issue: #1148.
- Claim: #1116.
- Current reserved version in the claim: `20260817235348`.
- Protected objects: function `public.relink_dam_order_lines_bulk` and table `plm.production_order_line`.
- Branch: `codex/issue-1115-bulk-order-relink`.
- Worktree: `C:\repos\shared-db-wt-1115`.
- PR: #1117, exact head `4311a36ed176f78b4cfa83eb6cd9d5b46b526fb2`.
- Earlier head `2deaa8c...` had Kimi approval and all checks green, but that evidence became stale after main advanced.
- The branch was refreshed after the history restoration. At handoff every quick check was green and disposable-database run `32082357083` was still running.
- No current-head independent verdict exists yet. Do not merge based on the stale approval.
- Next successful preview must prove exact project `rjyboqwcdzcocqgmsyel`, exact version, and bounded apply.

### Lane 3: Sample Tracking Release A #975

- Parent issue #975 is closed because the original implementation PR merged, but the production outcome remains outstanding under dedicated handover issue #1149.
- Claim: #1125.
- Reserved reconciliation version: `20260817190000`.
- Branch: `codex/issue-975-release-a-promotion`.
- Worktree: `C:\repos\shared-db-worktrees\issue-975-release-a-promotion`.
- PR: #1126, exact head `f25a24f89b2963795c064e73c2ece3112082ba7a`.
- PR #1126 is behind current main. Its earlier checks and GLM approval were valid for its earlier head only and must be reacquired after refresh.
- The reconciliation migration has passed local and disposable-database tests, including real rollback proof for a partial preview shape.
- Generated types were intentionally not committed because preview lacked the reconciled objects. After preview repair, regenerate the types from preview and commit them through the same normal PR process before production.
- Exact authorized production order: `20260814130000`, `20260814193402`, then `20260817190000`. Nothing else.

### Closed or transferred work

- #1097 closed. Planning PR #1098 merged earlier; cleanup PR #1114 separated implementation into #1113.
- #1113 closed as misrouted. No database or source data was changed. Private work remains at `C:\repos\shared-db-wt-1113\.private\item-mg-taxonomy-20260817`. It contains 3,961 classified parser outputs; 110 accepted, 5 reviewed aliases, 10 placeholders, 3,836 awaiting review, with 245 source rows reviewed. It belongs in private `popcre/designflow-item-master`. Do not publish private contents.
- #1133 closed after guard tooling PR #1135 and exact historical restoration PR #1139. Verification run `32077713902` found no preview orphan. Claim #1134 was released.
- #1085 remains open only because it is this outgoing session's orchestrator marker. It must be closed last after this handoff merges.

### Main checkout and unexplained files

The main checkout contains many pre-existing modified/untracked files, including `.gitignore`, `.agents/`, `.ai/`, temporary JSON files, outputs, old handoff-like files, and `claim-931.md`. They were not created or altered by this closeout. Do not stage them. The incoming orchestrator should use isolated worktrees and the cleanup skill before retiring anything.

## 4. Everything we tried that did NOT work

### Reviewer system failures

- Grok repeatedly consumed 12 or 20 turns, sometimes millions of tokens, and ended without a verdict. Increasing turns did not solve the decision failure.
- Kimi repeatedly waited near 15 minutes and then returned an exhausted-allowance error or no output. Qwen also lacked allowance and was removed from rotation by owner instruction.
- GLM failed when given a linked worktree because its Git metadata lived outside the permitted folder. The permanent operational rule is to use a self-contained review copy.
- GLM also produced empty turns, attempted prohibited web search, or failed on permissions when review copies lacked exact local references.
- Several reviews were invalid because a short commit prefix was manually expanded to the wrong full commit. Review identity must come directly from Git, never transcription.
- Long reviews often finished after main advanced, invalidating exact-head evidence and forcing another review and CI cycle.
- The full failure analysis and fixes are in `u2giants/ai-devops/fix_reviewer_system.md`, tracked by ai-devops issue #34. Do not repair generic provider wrappers inside shared-db.

### GitHub service failures

- GitHub returned repeated 503/504 errors for issue reads, status writes, workflow dispatch, git-reference creation, and GraphQL calls. Local `gh auth status` being green did not prevent workflow-token failures.
- Repeating workflows without transport fixes wasted time. Permanent bounded retry and exact readback were added for specific safe operations.
- GitHub's Compare API returned 404 even for public repository self-comparisons. A complete fallback was added and tested rather than bypassing collision protection.

### #1090 dead ends

- Applying `20260817124545` alone seemed ready after preview, review, merge, and owner evidence. A production review found it would block held migration `20260802171000`, making the settled FR removal sequence impossible. Therefore production promotion correctly stopped.
- A later migration cannot simply “pre-authorize” the older write because authorization is tied to the same database transaction. The compatibility must exist in the same bounded event.
- Claim #1100 could not safely hold new later versions after its migration merged. It was released, and fresh claims were created for the prerequisite phases.
- Preview version `20260817150944` was initially suspected to be an abandoned #1090 duplicate. Governed deletion run `32065562837` refused because the statements differed. Forensics proved it was unrelated PLM mirror structure. Never try to delete it as a #1090 duplicate.

### #1115 and #975 preview failures

- Both bounded preview attempts stopped before database write because preview contained remote version `20260817150944` while main lacked its file. Supabase correctly refused the mismatch.
- A special one-row deletion workflow was built but correctly refused because the version was unique structure, not a duplicate. The safe resolution was to restore its exact historical file to main and bar it from production.
- Retrying #1115 or #975 before the historical restoration would have produced the same failure. That blocker is now resolved by PR #1139.

### Sample Tracking Release A failures

- Preview showed both original Release A ledger versions but lacked several workflow/path objects because the first migration had been applied from an intermediate file that later changed before merge.
- Replaying the current first migration was unsafe and non-idempotent. Albert authorized a new exact reconciliation migration `20260817190000` instead.
- Generated types from the incomplete preview omitted required objects. They were deliberately left uncommitted until preview is repaired.

### Production verification gaps found and repaired

- Expression-index verification originally failed to recognize a valid index after apply. Verification-only recovery tooling was added; the production index was proven valid without reapplying.
- Sequence-only migration verification could not infer catalog targets even though apply succeeded. #764 was independently verified read-only and closed rather than reapplied.
- Production approval comment reads used insufficient retry in the actual apply path. Tooling was corrected so only transient comment-read failures retry and semantic failures still stop immediately.

### Routing failure

- #1113 inherited shared-db ownership from planning issue #1097 even though it was offline Item Master taxonomy work. Repository inheritance was the error. The work was stopped and closed without database changes. Global prevention belongs in ai-devops instructions and routing skills; shared-db should enforce exact structural objects at intake.

## 5. Root causes and key findings

- Review latency was not the sole cause of the 24-hour session. It compounded real GitHub outages, incomplete preview history, safety defects, main-branch churn, and misrouted work.
- Exact-head review is a necessary safety rule. The scheduling failure was starting review before prerequisites and merge order were stable.
- Preview migration history is part of database truth. A ledger row absent from the repository cannot be deleted merely to let tooling proceed. Its stored statements and live catalog effects must be understood first.
- Historical version `20260817150944` adds 21 PLM mirror columns and copied values. Live preview proof found all columns and zero differences against their DesignFlow sources for the matched rows. It is now restored to main and production-held.
- #1090's licensing guard changes who may write licensing records. Held older licensing migrations must either run through a precise compatibility path or remain permanently blocked. The compatibility path must be one-use, exact-purpose, audited, and restored to strict behavior before commit.
- Sample Tracking Release A needs a reconciliation migration because its preview ledger and catalog diverged after an intermediate file was applied. Honest generated types must come from the repaired preview, not current incomplete preview.
- Three migration lanes are useful only when populated with eligible non-colliding structural work. Planning, offline analysis, repository tooling, and ordinary application data must not consume those lanes.
- `ai-devops` owns generic reviewer wrappers and global source routing. `shared-db` owns its own lane scheduling, merge freeze, preview order, and production order.

## 6. Exact next steps

### Start the new orchestrator

1. Open shared-db from a fresh session using the `shared-db-orchestrator` skill. Read this file in full, newest open handoffs, and issues #1146 through #1149. **Verification:** issue #1085 is closed and the new session has created its own fresh orchestrator marker before making changes.
2. Fetch `origin/main`, rerun the lane audit, list open PRs, inspect active GitHub Actions, and prove there are no preview/production locks. Do not trust the 23:57 UTC snapshot. **Verification:** record the new exact main, all three current claims, and any active workflows.
3. Comment on #1146, #1147, #1148, and #1149 that the new orchestrator has ingested them. Keep each open until its work is complete. **Verification:** each issue has a dated takeover comment naming the new session.

### #1115, fastest terminal candidate

4. Inspect run `32082357083`. If green and PR head is still `4311a36...`, obtain a fresh exact-head independent verdict. If main advanced, refresh first, rerun all checks, then review. **Verification:** all required checks and a real exact-head verdict are green on the same commit.
5. Dispatch bounded preview for only claim version `20260817235348`, proving project `rjyboqwcdzcocqgmsyel`. **Verification:** exact ledger addition, function contract, bounded row behavior, and lock release are captured.
6. Guarded-merge #1117 only if main is unchanged; otherwise refresh/review/preview again. Then create current-main evidence, risk report, exact owner evidence only if requested by the gate, and bounded production apply. **Verification:** production project `qsllyeztdwjgirsysgai`, ledger exactly once, function definition and safe behavior verified, issue #1115 closed, claim #1116 released, handover issue #1148 closed.

### Sample Tracking Release A

7. Refresh PR #1126 from exact current main. Re-run the full shared-db suite and actual disposable-database reconciliation tests. Obtain a new exact-head independent verdict. **Verification:** every required check is green on one head.
8. Apply only `20260817190000` to preview after proving exact project `rjyboqwcdzcocqgmsyel`. Then rerun the full Release A SQL contract against preview and verify both original versions plus reconciliation are present exactly once. **Verification:** workflow/path tables, view, functions, triggers, indexes, four carrier seeds, permissions, and integrity protections all pass.
9. Regenerate database types from repaired preview. Commit the truthful generated types through PR #1126 or a normal linked PR as repository rules require, without changing application repositories. **Verification:** generated types include Release A workflow/path objects and all CI remains green.
10. Freeze shared-db merges for the bounded production window. Pin exact main and review production drift without including or modifying unrelated versions. Promote only `20260814130000`, `20260814193402`, then `20260817190000`. **Verification:** exact production project proof appears immediately before each write; no unbounded push; direct live verification covers objects, constraints, functions, triggers, carriers, inventory view, ledger, and integrity protections.
11. Update #975 and #1149 with generated-types commit/PR, merged main, preview evidence, production workflow URL, target proof, exact versions, verification, and untouched unrelated drift. Release claim #1125 and merge freeze. **Verification:** both issues are closed only after production proof.

### #1090 licensing package

12. Start a fresh governed exact-head review of PR #1145. Do not count stopped sequence 157, GLM sequence 155, or Grok sequence 154 as approval. **Verification:** durable verdict explicitly names current head and has no unresolved high-severity finding.
13. Merge #1145 only through the guarded workflow after current checks and verdict. Then create the next fresh classified issue/claim for the complete FR removal and strict cleanup phase. Never leave the freed lane empty. **Verification:** main contains the forward migration, claim #1144 is released, and the successor claim is active with a later permanent version.
14. Implement canonical FRIDA KAHLO provenance, re-point every dependent relationship with exact audited authorization, prove no remaining FR dependents, remove FR last, and restore strict write protection in the same bounded package. Add production-order and partial-bundle refusal tests. **Verification:** disposable production-shaped replay proves the complete order and rejects every partial or out-of-order variant.
15. Preview and review the complete ordered package. Re-derive the exact production risk list and ask Albert once for the future exact-main production block. **Verification:** immutable owner evidence binds the final main and entire ordered allowlist.
16. Promote the entire licensing package in one bounded event, never `20260817124545` alone. Verify ledger, licensing rows/counts without publishing private values, audit consumption, strict guard restoration, and removal postconditions. **Verification:** #1090, #1143 and #1147 close with live production evidence and all related claims release.

### Reviewer and routing follow-up

17. Do not let shared-db absorb generic reviewer-wrapper development. Track it in ai-devops issue #34 and `fix_reviewer_system.md`. Shared-db-specific stable-head scheduling should be a separate shared-db repository-maintenance issue. **Verification:** generic wrapper changes land in ai-devops; only database queue/freeze logic lands here.
18. Keep #1113 out of shared-db. A DesignFlow Item Master session may recover the private folder and continue semantic review, but must not publish it or open a migration claim. **Verification:** work continues only in the private application repository and #1113 stays closed.

## 7. Constraints and gotchas in force

- Qwen is excluded from all new reviewer assignments until explicit owner restoration.
- One orchestrator only. The incoming session creates a fresh marker before any mutation.
- Exactly three structural author lanes; never duplicate a colliding claim and never fill a lane with non-structural work.
- `COORDINATOR_INTAKE.md` is retired. Do not edit or delete it.
- Use branch plus pull request in shared-db. Do not commit from the dirty main checkout.
- Verify Git author before every first commit: `Albert Hazan <u2giants@users.noreply.github.com>`.
- Do not use a raw linked worktree for a sandboxed delegated reviewer. Use the self-contained review-copy helper.
- Exact-head review evidence expires whenever the reviewed head changes.
- Preview and production writes require immediate exact project proof. Preview is `rjyboqwcdzcocqgmsyel`; production is `qsllyeztdwjgirsysgai`.
- Never use unbounded `supabase db push` for these promotions.
- Never include unrelated migration drift to make a bounded apply pass.
- `20260817150944` is preview-history restoration and production-held. Never promote it.
- #975 approval excludes Releases B, D, E and application repository changes.
- #1090 approval/waivers from old heads are expired. Future production evidence must bind the future exact main.
- Do not publish private licensing rows or #1113 Item Master contents in public GitHub.
- The main worktree contains unrelated changes. Never `git add -A`, reset, clean, or remove unknown worktrees.

## 8. Access and environment

- Machine: Windows 11 `al8960ofc`.
- Canonical repo: `C:\repos\shared-db`.
- Handoff worktree: `C:\repos\shared-db-worktrees\orchestrator-handover-2026-08-17T2357Z`.
- GitHub CLI `gh` is authenticated as `u2giants` and successfully read/wrote issues, pull requests, workflows, and branches during closeout.
- Supabase access is through governed GitHub workflows and repository tooling. Do not assume a local environment variable is present; verify access with a real read before claiming it is missing.
- Secrets belong only in 1Password vault `vibe_coding`. No secret values are in this handoff.
- Reviewers are invoked through the governed manager and wrappers. Use self-contained review copies and derive commit identities from Git.
- Preview URL/project reference: `rjyboqwcdzcocqgmsyel`.
- Production URL/project reference: `qsllyeztdwjgirsysgai`.
- Production Cloud SQL is a different system and remains read-only under its separate rules; it is not part of these Supabase promotions.

## 9. Open questions and risks

- GitHub service instability may recur. Retry only operations whose repository tooling explicitly supports safe bounded retry and exact readback. Do not bypass closed gates.
- Main may advance between review, preview, and merge. Recheck before every gate and reacquire evidence when the commit changes.
- #1115's latest disposable-database CI was still running at handoff. Its outcome must be read live.
- #1126 is stale against current main. Old review and preview evidence cannot approve a refreshed head.
- #1090 still needs at least one further structural phase after #1145. The exact successor versions must come from governed claims, never guessed timestamps.
- Production risk gates may generate a future owner decision. Ask only after the exact main and risk list exist.
- The main checkout has many unexplained files and historical worktrees. This closeout deliberately did not delete any because ownership and cleanliness were not proven.
- #1113's private folder may be the only copy of its semantic review progress. Preserve it until the private application session confirms safe receipt.

# Part B — sub-agent reports

## Agent: `/root/resume_853_atomic` / Locke

- **Asked to do:** finish #853 first, then keep a structural lane productive; later handle #898, #1115, and inspect/continue #1097/#1113 simultaneously.
- **Actually did:** completed #853 production bridge and expression-index verification; closed #853 and routed remaining application-row work to PopDAM. Claimed, authored, reviewed, previewed, merged, promoted, and closed #898 with production verification. Audited and closed #1097 planning. Began #1113 offline taxonomy analysis, reproduced the 19,302-row baseline, classified all 3,961 parser outputs, reviewed 245 source rows, then stopped when the work was correctly identified as non-database. Claimed and authored #1115 under claim #1116 and PR #1117; fixed review findings and reached green earlier heads before preview history blocked application.
- **Found:** #853's atomic policy hash and line-ending handling needed correction; the production index applied successfully even though the first catalog verifier could not parse its expression. #898's first permission test incorrectly treated “any privilege” as “all privileges,” and its first live preview overreached by demanding unrelated grants. #1113 belonged to private Item Master, not shared-db. #1115 was blocked only by missing historical version `20260817150944`, now restored.
- **PR / branch:** #1117 / `codex/issue-1115-bulk-order-relink`, current head `4311a36ed176f78b4cfa83eb6cd9d5b46b526fb2`.
- **Worktree:** `C:\repos\shared-db-wt-1115`, live and resumable. `C:\repos\shared-db-wt-1113` contains private preserved work and must not be cleaned until handed to the private app session.
- **Deliberately did NOT do, and why:** did not treat stale review as current; did not retry preview while history was inconsistent; did not publish #1113 private material; did not merge or promote #1115 before a new exact-head verdict and preview.

## Agent: `/root/fix_reviewer_chain` / Herschel

- **Asked to do:** repair reviewer failure replacement, remove Qwen from rotation, advance #1090, repair production approval and GitHub coordination tooling, investigate preview history, and keep the licensing lane active.
- **Actually did:** delivered chained reviewer replacement and Qwen removal; generalized claim expansion and version supersession; delivered production owner-comment retry, GitHub comparison fallback, coordination-ref retry, and preview history forensic/restoration tooling. Merged exact history restoration through PR #1139 without database writes. For #1090, merged compatibility issue #1140 / PR #1142 as main `d4c1f5a9...`, claimed issue #1143 as #1144, and opened PR #1145 at `fd5e558...` with all checks green.
- **Found:** reviewer wrappers routinely ran to long limits without verdicts; exact-head transcription errors invalidated evidence; applying #1090 alone would block held historical licensing migration `20260802171000`; preview `20260817150944` was unique PLM mirror structure, not a #1090 duplicate; deleting it would conceal real schema/data effects.
- **PR / branch:** active #1145 / `codex/issue-1143-fr-ruling-forward`.
- **Worktree:** `C:\repos\shared-db-worktrees\issue-1143-fr-ruling-forward`, live and resumable.
- **Deliberately did NOT do, and why:** did not apply #1090 to production alone; did not delete preview history; did not count failed or stopped reviewers as approvals; did not merge #1145 during handoff. The orchestrator killed the active sequence-157 review process tree during stop.

## Agent: `/root/fix_lease_renewal` / prior inherited worker

- **Asked to do:** repair claim renewal for sequence-only migrations, finish #764, and later complete Sample Tracking Release A #975 through production.
- **Actually did:** added safe claim renewal support; completed #764 production apply and independent live sequence verification; released its claim and closed #764. For #975, audited preview and production, identified incomplete preview Release A structure, obtained Albert's exact reconciliation authorization, claimed #1125/version `20260817190000`, authored PR #1126, added real rollback and full object tests, and reached green reviewed earlier heads.
- **Found:** preview had both original Release A ledger rows but lacked three workflow/path tables, a view, five functions, five triggers, two indexes, and related permissions. Replaying the changed original migration was unsafe. Generated preview types were therefore incomplete. Preview history version `20260817150944` prevented bounded apply until restored to main.
- **PR / branch:** #1126 / `codex/issue-975-release-a-promotion`, head `f25a24f89b2963795c064e73c2ece3112082ba7a`.
- **Worktree:** `C:\repos\shared-db-worktrees\issue-975-release-a-promotion`, live and resumable.
- **Deliberately did NOT do, and why:** did not replay the non-idempotent original migration; did not commit dishonest generated types; did not repair unrelated drift; did not include later Sample Tracking releases; did not write production.

## Agent: root orchestrator

- **Asked to do:** maintain the sole orchestrator, keep all three author lanes occupied, prioritize owner-directed issues, coordinate agents, prevent unsafe merges/writes, report status, and close out comprehensively.
- **Actually did:** maintained lane occupancy and priorities, recorded owner rulings, stopped unsafe/redundant actions, documented reviewer-system failures in ai-devops, corrected ownership boundaries, opened handover issues #1146–#1149, stopped all sub-agents and active review processes, and authored this isolated docs-only handoff.
- **Found:** throughput failure had multiple causes, not only reviewers; global source routing must be fixed in ai-devops, while shared-db scheduling stays here; the dirty main checkout cannot be used safely for closeout.
- **PR / branch:** this handoff branch `codex/orchestrator-handover-2026-08-17T2357Z`; docs-only PR to be merged before marker closure.
- **Worktree:** `C:\repos\shared-db-worktrees\orchestrator-handover-2026-08-17T2357Z`, finished after handoff merge and safe to retire later.
- **Deliberately did NOT do, and why:** did not edit `COORDINATOR_INTAKE.md`; did not clean unrelated files/worktrees; did not merge work PRs merely to make closeout look tidy; did not request premature owner approvals.

# Closeout self-audit

1. **Could a street-new developer continue without asking a question? Yes.** Sections 1–3 define the system, exact repositories/projects, current main, preview/production state, all claims, branches, worktrees, PRs, and evidence. Section 6 gives ordered commands-as-outcomes with verification gates. Part B preserves each agent separately.
2. **Could they continue as effectively as this orchestrator? Yes.** Sections 4–5 preserve the failed approaches and non-obvious findings, including reviewer behavior, GitHub outages, #1090 ordering, preview history forensics, and Sample Tracking partial application.
3. **Is every relevant detail present? Yes.** Background and goals are in §§1–2; live state/evidence in §3; failures in §4; causes in §5; exact actions in §6; constraints in §7; access in §8; risks in §9; agent ownership in Part B.
4. **Would Albert see every needed decision by reading only §0? Yes.** A line-by-line sweep of §§1–9 and Part B found no decision blocking immediate resumption. The three possible future production approvals are indexed in §0 with the instruction not to ask until exact evidence exists. Settled Qwen, #975, #1113, #1090, and preview-history rulings are also indexed so they are not re-asked.

All ten required sections, the mandatory failure history, exact next actions with verification gates, access boundaries, moving-state timestamps, and separate per-agent reports are present. This handoff passes the fresh-developer gate.
