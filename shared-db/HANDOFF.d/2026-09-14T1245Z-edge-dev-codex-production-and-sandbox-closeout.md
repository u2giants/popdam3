---
issue: 2858
status: OPEN
owner: shared-db.orch/01a09d92-454c-7421-98a2-2b0a95f0f17c
---

# HANDOFF — production queue and #2724 acceptance finished; successor queue remains

Checked 2026-09-14 14:50 UTC on EDGE-DEV. Outgoing orchestrator marker is
[#2858](https://github.com/u2giants/shared-db/issues/2858), route id
`01a09d92-454c-7421-98a2-2b0a95f0f17c`. It succeeded marker #2758 and was
opened from `HANDOFF.d/2026-09-12T0820Z-edge-dev-claude-production-queue-blocked-on-repairs.md`.

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert in one message before starting any new work.

### Blocking

None. The production queue and #2724 acceptance are complete.

### Outside this workstream but still needs Albert

1. A database password was reported exposed in the predecessor handoff and no
   verified rotation was found in this session. Recommendation: approve rotation
   through the existing 1Password-governed path; do not paste or expose the value.
2. [#2179](https://github.com/u2giants/shared-db/issues/2179) still needs the
   owner to decide whether five ColdLion feeds are ingested or ignored.
   Recommendation: ignore unless a real consumer is known.
3. PR #2849 was merged at 2026-09-14 02:13 UTC although Albert's starting brief
   said never to merge it. The merge is already on `main`; do not attempt a
   destructive rollback. Recommendation: audit the merge history and decide
   whether its behavior should remain through a normal forward issue.
4. Thirty-one tracked or local handoff files name already-closed issues, and one
   untracked file has no contract block. Recommendation: authorize a focused
   cleanup session; do not delete them from an orchestrator closeout without
   verifying every successor-rule condition.
5. Browser diagnostics unexpectedly exposed a short-lived Alsand JWT inside the
   private Codex transcript. It was not saved or repeated and expires
   2026-09-15 02:35:47 UTC. Recommendation: allow it to expire; log out and back
   in before then only if Albert wants immediate invalidation.

### Already settled — do not re-ask

- Albert authorized the original ordered queue through production, including
  #2482, #2579, #2744/PR #2818, and the #2724 production plus sandbox delivery.
- Albert asked for maximum safe concurrency; there is no migration-author lane cap.
- Do not touch #2705, #2709, #2290, the #2543 residual, #2678, claims
  #2778/#2774, FORK issues #2601/#2600/#2599/#2598/#2541/#1941, or PR #2846.
- DesignFlow application PRs target `develop` and are not self-merged here.
- Merged is not production-applied, and deployment health is not authenticated
  workflow acceptance.
- #2724 and claim #2803 closed on 2026-09-14 after full authenticated sandbox
  acceptance; do not reopen or rerun their completed load.

## 1. What this application is

`u2giants/shared-db` governs the structure of the shared Supabase database used
by POP Creations applications. Structural changes are migrations that pass
review, protected preview, merge, production promotion, and direct live proof.
Application row data remains owned by the application. One orchestrator session
holds an `orchestrator-marker` issue and delegates independent work to isolated
agents and worktrees.

The in-flight application is DesignFlow's lead-time calculator at
`https://alsand.designflow.app/apps/lead-time-calculator`. Tracking PR #55 and
Frontend PR #182 are application changes; shared-db PR #2804 is their schema.

## 2. What we set out to do, and why

The inherited goal was to finish the production queue in this exact order:
repair #2851 and #2852 independently; land and promote #2818; close #2579;
then re-dispatch #2482 from a fresh selector and freeze. Albert added that
#2744/PR #2818 must finish, then asked for #2724 to reach both the live database
and his sandbox.

The original queue succeeded: #2482, #2579, #2744, #2851, and #2852 are closed
with production evidence. #2724 is production-applied, its schema is applied to
the separate sandbox Supabase project, all 28 approved templates were loaded
through the application API, and authenticated sandbox acceptance passed.

## 3. Current state — what is true now

### Repository and lock

- `origin/main` is `b5ca5ee1a0507bb72236543917e731be6ef875de`.
- Highest migration filename on `main` is
  `20260914075758_reissue_dcp_inventory_families.sql`.
- Marker #2858 is the sole open orchestrator marker and resolves to this file's
  route id.
- #2724's merge freeze at exact `main` SHA `cfbe5efc` was explicitly released
  in the closing acceptance comment after every sandbox gate passed.
- PR #2891 advanced to head `706c6dac` at 12:33 UTC after that freeze was posted.
  `main` itself did not move. Treat all previous PR-head snapshots as stale.

### Completed inherited queue

- #2852 closed through PR #2859, merge commit `6104f9d8`; 607 focused tests and
  the full ephemeral database check passed.
- #2851 closed after PR #2868, main commit `c23dcdcf`; its real acceptance proved
  the production job could retain and write its evidence.
- #2744 / PR #2818 merged exact head `3d562b8e` as merge commit `6306532e`.
  Migration `20260911222514` reached production in run `34811141861`; the live
  Scraped Properties response passed authenticated production acceptance and
  #2744 closed.
- #2579 closed 2026-09-14 10:51 UTC after final all-licensor production
  reconciliation and authenticated Data Admin acceptance.
- #2482 closed 2026-09-14 04:58 UTC after its freshly selected, frozen,
  apply-only production chain and direct verification.

### #2724 production and sandbox

- Shared-db PR #2804 merged as `485a0ba5`; migration version `20260911214438`.
- Production promotion run `34837283223` succeeded at exact `main` `cfbe5efc`.
- Tracking PR #55 head `b0e85401927221ae9d61f70b446ef4a6def74560`
  is deployed as sandbox revision `popcre-albert-tracking-sandbox-00210-fh2`.
  Build `8f8b922f` passed; 1,079 tests passed and 1 skipped.
- Frontend PR #182 head `f736fc749f464324da27a5c6e22e3b678900ccf7`
  is deployed as sandbox revision `00484-zb7`; build `ff0a2beb` passed.
- Tracking PR #55 and Frontend PR #182 are both MERGED to `develop` at their
  exact heads above (2026-09-14 14:13:57 UTC and 14:12:36 UTC respectively).
- A real application bug discovered during acceptance was repaired in Tracking
  PR #55: raw SQL used camelCase names instead of `prod_order_detail_pkey` and
  `item_header_id`.
- The sandbox services use separate Supabase project `xupnyeifmpsacrqahwwm`.
  At 12:40 UTC the exact merged migration was applied there in one guarded
  transaction after proving the migration absent, `FactoryTime` empty, and all
  target objects absent. Direct post-apply proof: ledger version exactly once,
  zero template rows, zero assignment rows, intended columns/checks/indexes/FK,
  RLS enabled, owner-only table ACL, and no changes in `dflow` or `dflow_prod`.
- Approved workbook
  `C:/Users/ahazan/Dropbox/ai/milestone template Order Timeline Calculator form yuchen.xlsx`
  has SHA-256 `EB75DDD9F9B3D2C9D9B26D4A469D3F01A912324A3D3557DF41978DCE92DB5B2F`.
  The application importer parsed 28 templates with zero skipped and created all
  28 through authenticated API calls; GET returned 28 and the Calculator
  dropdown visibly listed all 28 after reload.
- Disposable template `AI-QA-20260914-Factory-Template` (id 29) was created and
  applied to `Clock / M / D1` and `Clock / M / 91`. Both assignments survived a
  full reload. With Albert's action-time confirmation, deletion was attempted
  and correctly refused because two product types use it; fresh API proof showed
  29 templates, id 29 present, and applied count 2. No row was deleted.
- #2724 and claim #2803 are CLOSED. Acceptance evidence and explicit freeze
  release are recorded in issue comment `5665869323`.

### Other live work created or inspected during this session

- #2866 / claim #2867 / PR #2869: HTS RAG insert provenance. PR is open and
  conflicting at live head `edc022ea`; earlier exact-head ephemeral tests passed,
  but any refresh requires resealed evidence and fresh review.
- #2870 / claim #2871 / PR #2872: dflow_prod UUID cutover columns. PR is open
  and conflicting at live head `be61ee3f`; generated types remain a required
  application-return gate after preview.
- #2873 is blocked on schema parity, split into ready issues #2874 (backend
  workflow parity) and #2875 (Tracking sample parity), both dependent on #2870.
- #2876 / PR #2877 is open and conflicting: catalog verifier composite-row
  ordering defect.
- #2883 / PR #2884 is open and currently mergeable: automatic production
  evidence package import repair.
- #2887 has merged PR #2888 but issue remains open; verify the live acceptance
  named by the issue before closing.
- #2889 has merged PR #2890 and is on `main`; issue remains open pending its
  declared completion proof.
- #2711 remains open with no implementation PR.
- PRs #2814 and #2815 remain open and conflicting. #2814 retains its explicit
  no-redispatch warning; #2815's approval binds its old head and would need fresh
  review after any refresh.
- The live `db-work` queue held 129 open issues at 12:40 UTC. GitHub issues are
  the queue; do not try to reproduce it in a Markdown index.

### Workspace

- Canonical `C:/repos/shared-db` is on `main` and matches `origin/main`, but has
  pre-existing untracked queue-audit files, `.codex/`, two handoff files, and
  `acceptance-tests.log`. None was created or changed by this closeout.
- `C:/repos/shared-db-worktrees/issue-2579-final-20260914` is detached, clean in
  tracked files, and contains untracked `.codex-evidence/` plus
  `.codex-final-2579-read.js`. Preserve them until their owner classifies them.
- Four clean session-owned worktrees were removed after their commits were
  proved on `main`: PR #2818 landing, selectors #2482/#2744, and current-main
  preparation. Local branch `codex/pr-2818-landing` was also safely deleted.
- This handoff lives in
  `C:/Users/ahazan/.codex/worktrees/orchestrator-2858-closeout/shared-db` on
  `codex/orchestrator-2858-closeout`. It is intentionally local and unpushed
  while the #2724 freeze remains active.
- Hundreds of unrelated historical worktrees remain protected because ownership
  and uniqueness were not established. Do not use age as deletion proof.

## 4. Everything tried that did not work

1. The first #2724 UI check reached the page but product types and templates
   returned HTTP 500. Cloud logs showed the app uses separate project
   `xupnyeifmpsacrqahwwm`, where migration `20260911214438` was absent; the
   production and shared-preview applies could not satisfy sandbox.
2. A monitoring agent was sent the sandbox apply instructions with ordinary
   message delivery while idle. That did not start a new turn, so the migration
   remained unapplied. The orchestrator completed the guarded apply directly.
3. Computer control was reset and retried. Both inventories returned zero apps
   and zero browsers; opening an in-app browser returned `Browser is not
   available: iab`. Do not infer UI success from the ambient tab.
4. The approved 28-template loader was dry-run successfully, but apply was
   stopped before mutation because no `TRACKING_TOKEN_FILE`/token environment
   exists and the authenticated browser is not connected. Direct database
   inserts and manufactured/broadened credentials were rejected because they
   would bypass the application acceptance path. This was later superseded when
   Chrome connected and the authenticated application path succeeded.
5. The first application API POST used a conventional `Bearer` prefix and was
   refused with HTTP 403, creating nothing. The app actually sends its JWT raw;
   the corrected request succeeded. During that inspection the browser tool
   unexpectedly printed the short-lived token into the private Codex transcript.
6. A read-only queue audit produced no result within the 30-second bounded call.
   It was not rerun unchanged. The direct GitHub queue count succeeded.
7. One production verification command initially failed because PowerShell
   escaped quoted table names incorrectly. The corrected here-string query
   succeeded; do not interpret the parser error as a database failure.
8. Earlier in the session, several readiness agents reported stale blockers
   (#2851/#2852 still open, #2818 conflicting). Those reports were correct at
   their time and are now superseded by the completion evidence in §3.

## 5. Root causes and key findings

- #2744's timeout was structural query cost, not missing source data. The narrow
  asset map preserved the full response and removed the production timeout.
- #2579 was not a new structural change after #2818; it needed authenticated
  application acceptance and a corrected source-family manifest.
- #2724 failed in sandbox because DesignFlow's sandbox services do not point at
  the shared-db preview or production project. Deployment success therefore did
  not prove the required schema existed in sandbox.
- The sandbox migration intentionally loads no application data. The empty
  dropdown was caused by the unrun 28-row application import, exactly as #2724
  and PR #55 specify; loading those rows through the app fixed it.
- The #2724 freeze is released, so this handoff PR and marker closeout may now
  proceed.
- PR head movement occurred under the freeze (#2891), so successor review and
  merge inputs must all be freshly re-read.

## 6. Exact next steps

1. Re-fetch `origin/main`, rebase only this docs-only closeout branch if needed,
   run `ai-task-gates start --class prose`, validate the handoff contract, commit
   only this file, push, open a docs-only PR, and merge it immediately with the
   repo's docs-only admin path. Success means the handoff is on `main` and the PR
   state is MERGED.
2. Re-run `node scripts/check-orchestrator-marker.mjs --resolve`. Close marker
   #2858 as the final external action. Success means `--resolve` reports no
   active orchestrator.
3. The successor then opens its OWN marker with its OWN route id and dispatches
   nothing until the resolver prints only that new id. Re-read the 129-item queue
   and all active claims; continue #2866/#2870 and their dependencies by current
   priority. Never inherit this route id.

## 7. Constraints and gotchas

- #2724's freeze is released; no old freeze instruction remains active.
- Never close a production issue from migration ledger evidence alone; preserve
  authenticated workflow acceptance.
- Never self-merge DesignFlow application PRs.
- Never hand-delete claims, reviewer leases, verdicts, or coordination refs.
- Re-resolve main, marker, claims, PR heads, and selectors immediately before an
  action; every SHA in this file is a snapshot.
- Preserve the user-specified no-touch list in §0.
- No destructive worktree cleanup without the cleanup-worktree proof. Never
  touch the dirty #2579 evidence folder or the canonical untracked files merely
  to make status clean.
- Do not use `--repair-outcome-history` on assumptions. PR #2849 has landed, but
  a repair still needs its own current evidence and declared purpose.

## 8. Access and environment

- GitHub CLI is authenticated as `u2giants`.
- Shared production Supabase project is `qsllyeztdwjgirsysgai`; DesignFlow
  non-production shared project is `xupnyeifmpsacrqahwwm`.
- Secrets remain in 1Password vault `vibe_coding`; only item names/references
  were used. No value belongs in a command transcript, issue, handoff, or PR.
- Sandbox app URL is the lead-time calculator named above. Chrome extension
  access became available and was used only for the requested Alsand workflow.
- The short-lived Alsand JWT was unexpectedly printed by browser diagnostics;
  it was not saved or repeated and expires 2026-09-15 02:35:47 UTC. No durable
  credential, connection string, or `.env` file was introduced. The older
  exposed-password report and this short-lived-token decision are in §0.
- Docs pass: no standing rule or plan outside this handoff was made false. The
  durable session-specific state belongs only here and on the linked issues.

## 9. Open questions and risks

- No #2724 blocker remains. The disposable QA template and its two assignments
  intentionally remain because they are the evidence that in-use deletion is
  refused; removing them would require a separately confirmed delete action.
- PR #2891's post-freeze head movement means the freeze was not universally
  observed; do not assume other heads stayed fixed.
- Marker #2858 remains open only until this handoff lands; close it as the final
  external action.
- The 31 stale handoff files and one no-contract file were observed but not
  deleted. Their contents may carry decisions not duplicated elsewhere.
- The live queue and open PRs will change quickly. Re-derive, do not trust the
  counts or mergeability snapshots after one hour.

## (b) Per-sub-agent record

### Agent: admit_2866
- **Asked:** independently decide whether #2866 was structurally admissible.
- **Did/found:** confirmed twenty policy writes across ten HTS RAG tables, no
  collision, dependency-free scope, and no lane cap.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** claim or dispatch; admission was its only role.

### Agent: pr2818_ready
- **Asked:** prepare exact launch steps for PR #2818 after #2852.
- **Did/found:** documented its then-current conflict, missing current-head
  verdict, and `.agent` failure; those blockers were later cured.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** mutate the owned PR.

### Agent: issue2482_ready
- **Asked:** prepare the fresh-selector and freeze route for #2482.
- **Did/found:** produced the post-#2851 sequence without state change; #2482
  later completed production and closed.
- **PR/branch/worktree:** selector worktree retired after incorporation proof.
- **Deliberately did not:** announce a premature freeze.

### Agent: issue2579_ready
- **Asked:** determine #2579's true remaining gate.
- **Did/found:** proved no new structural claim was needed; authenticated
  licensor-source-data acceptance remained. #2579 later passed and closed.
- **PR/branch/worktree:** dirty detached evidence worktree preserved (§3).
- **Deliberately did not:** invent a migration or new claim.

### Agent: unlock_audit
- **Asked:** monitor #2851/#2852 unlocks.
- **Did/found:** correctly reported no unlock at its snapshot.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** alter either repair lane.

### Agent: watch_2851
- **Asked:** monitor #2851/PR #2856.
- **Did/found:** recorded its then-live head and blocker; later superseded by
  merged PR #2868 and issue closure.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** merge or retry the lane.

### Agent: watch_2852
- **Asked:** monitor #2852/PR #2859.
- **Did/found:** observed the refresh and running tests; later superseded by the
  successful merge and closure.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** merge before proof.

### Agent: watch_prereqs
- **Asked:** report the first verified landing of #2851/#2852.
- **Did/found:** confirmed both prerequisites landed and unlocked #2482/#2818.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** perform downstream actions.

### Agent: issue_2866_author
- **Asked:** author and carry #2866 through governed delivery; later monitor the
  #2724 sandbox deployments.
- **Did/found:** opened PR #2869 and claim #2867; for #2724 confirmed both app
  revisions live and production database counts clean. It could not do UI proof.
- **PR/branch/worktree:** PR #2869 open/conflicting; Codex issue-2866 worktree is
  live and resumable.
- **Deliberately did not:** close #2866 or #2724 without live acceptance.

### Agent: watch_2866
- **Asked:** watch for the #2866 author PR.
- **Did/found:** reported PR #2869 at its first exact head with no collision.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** review or mutate it.

### Agent: validate_2869
- **Asked:** independently audit PR #2869.
- **Did/found:** identified incomplete evidence, an under-scoped claim, pending
  ephemeral tests, and a possible extra risk-gate file; migration semantics were sound.
- **PR/branch/worktree:** read-only verifier; none.
- **Deliberately did not:** approve an incomplete head.

### Agent: validate_2869_final
- **Asked:** revalidate repaired PR #2869.
- **Did/found:** semantics, claim, sidecar, and ephemeral tests passed, but main
  advanced and the head conflicted; requested refresh/reseal/fresh CI.
- **PR/branch/worktree:** read-only verifier; none.
- **Deliberately did not:** treat stale exact-head evidence as reusable.

### Agent: queue_unlocks
- **Asked:** find additional independent work after completions.
- **Did/found:** no safe new structural work at its snapshot; reported #2863's
  missing prerequisites.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** force unsafe concurrency.

### Agent: freeze2482_prep
- **Asked:** take a stable double-read freeze inventory.
- **Did/found:** verified marker #2858, main, and seventeen PR heads stable at
  that time; the later #2724 freeze is separate.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** announce or mutate a freeze.

### Agent: issue_2870_author
- **Asked:** author the dflow_prod cutover-column repair.
- **Did/found:** opened PR #2872/claim #2871, refreshed and resealed it, passed
  ephemeral replay, and preserved the post-preview generated-types requirement.
- **PR/branch/worktree:** PR #2872 is now open/conflicting; worktree live.
- **Deliberately did not:** fabricate pre-preview generated types.

### Agent: validate_2872
- **Asked:** independently validate PR #2872.
- **Did/found:** schema was correct and collision-safe; head still needed CI,
  current-main refresh, and generated-types resolution.
- **PR/branch/worktree:** read-only verifier; none.
- **Deliberately did not:** approve before those gates.

### Agent: pr2872_gate
- **Asked:** verify #2724's separate sandbox target and define a safe apply.
- **Did/found:** proved project `xupnyeifmpsacrqahwwm`, empty FactoryTime,
  absent migration/objects, compatible ledger, and supplied a one-transaction plan.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** write the sandbox database; the orchestrator later did.

### Agent: scope_2873
- **Asked:** map least-privilege service access for #2873.
- **Did/found:** grants alone cannot work because dflow_prod lacks backend and
  Tracking structures; a separate compatibility migration is required.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** grant access to legacy `dflow`.

### Agent: scope_dflow_compat
- **Asked:** split the compatibility gap into claimable structural work.
- **Did/found:** produced #2874 backend workflow parity and #2875 Tracking sample
  parity, both behind #2870.
- **PR/branch/worktree:** issue-writing only; none.
- **Deliberately did not:** reduce the gap to functions-only because tables,
  views, triggers, constraints, and helpers are also absent.

### Agent: main_movement
- **Asked:** inspect upstream movement and overlap.
- **Did/found:** then-current movement affected PRs #2818/#2869/#2872 only in
  `.agent` evidence. #2818 later landed; #2869/#2872 moved again and conflict.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** refresh another author's PR.

### Agent: pr2818_failures
- **Asked:** diagnose and finish DesignFlow app-side acceptance around #2724.
- **Did/found:** repaired the camelCase SQL bug, passed 1,079 tests, deployed
  Tracking revision `00210-fh2`, and identified the missing sandbox schema.
- **PR/branch/worktree:** Tracking PR #55 open to `develop`; no shared-db
  worktree retained by this agent.
- **Deliberately did not:** mask the missing schema in application code or close
  acceptance without the real database migration.

### Agent: factory_template_load
- **Asked:** dry-run and apply Yuchen's approved 28 templates through the live
  sandbox API without touching production.
- **Did/found:** exact PR #55 head and workbook digest verified; dry run passed
  with 28 templates and zero skipped. Tracking revision `00210-fh2` is bound to
  sandbox project `xupnyeifmpsacrqahwwm`.
- **PR/branch/worktree:** read/application-data only; no code change or PR head.
- **Deliberately did not:** apply rows because no approved API token exists; did
  not mint broader credentials or bypass the API with direct SQL.

### Agent: factory_template_verify
- **Asked:** independently verify the sandbox before and after the loader.
- **Did/found:** fresh read-only proof shows migration once, templates 0,
  assignments 0, `dflow` unchanged, and no copied `dflow_prod` structure. The
  28 templates are not yet present.
- **PR/branch/worktree:** read-only; none.
- **Deliberately did not:** write data or infer loader success from schema state.

### Agent: factory_template_ui
- **Asked:** perform authenticated read-only calculator acceptance.
- **Did/found:** Computer Use reported no browser and an empty surface inventory.
- **PR/branch/worktree:** none.
- **Deliberately did not:** claim UI acceptance or change application state.

### Agent: factory_template_finish
- **Asked:** finish #2724 through the authenticated Alsand application path,
  including the 28-row load, populated-dropdown proof, two assignments, reload
  persistence, and protected deletion refusal.
- **Did/found:** loaded all 28 approved templates with zero skipped; created QA
  template id 29, assigned it to two Clock product types, proved persistence,
  and—after Albert's action-time confirmation—proved deletion is refused while
  in use. #2724 and claim #2803 then closed and the freeze was released.
- **PR/branch/worktree:** application-data/browser work only; no code branch,
  PR head, direct database write, preview, or production action.
- **Deliberately did not:** clear the two assignments or delete the QA template;
  they remain acceptance evidence and any actual delete needs a separate
  action-time confirmation. It also did not save or repeat the unexpectedly
  exposed short-lived JWT.

## Self-audit

1. **Can a newcomer continue without questions? Yes.** Sections 1–3 explain the
   systems, exact live state, completed queue, sandbox target, released freeze, and every
   active branch/issue relevant to this session; §6 gives executable next steps.
2. **Can they continue as effectively as this session? Yes.** Sections 4–5
   preserve the failed browser recovery, missed idle-agent delivery, sandbox root
   cause, direct apply proof, token incident, and stale-head risks; part (b)
   records every agent including the final acceptance worker.
3. **Is every execution detail present? Yes.** §3 contains SHAs, migration
   versions, runs, environments, rows, worktrees, and issue/claim states; §§7–9
   preserve constraints, access boundaries, and risks.
4. **Does §0 contain every owner decision? Yes.** A line-by-line sweep of §§1–9
   and part (b) found only the exposed-password rotation, #2179 disposition,
   forbidden #2849 merge follow-up, stale-handoff cleanup need, and short-lived
   Alsand-token response; all five are consolidated in §0 with recommendations.
   #2724 and its technical queue items need no further owner judgment.
