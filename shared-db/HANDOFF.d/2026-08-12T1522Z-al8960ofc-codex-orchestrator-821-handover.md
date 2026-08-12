# Orchestrator handover: B3 production, OrderList preview, and production-lane follow-through

**Session:** Codex orchestrator `369cc7d3-eee4-4bc6-9a10-14e3b09dc6b7`, marker issue **#821**, machine `al8960ofc`.  
**Written:** 2026-08-12T15:22Z. **Repo:** `u2giants/shared-db`.  
**Queue:** GitHub `db-work` issues. `COORDINATOR_INTAKE.md` remained untouched and retired.

## 1. What this application is

`shared-db` is the canonical schema, migration, import, verification, and DB Data Admin repository for the one Supabase database shared by PopDAM, PopCRM, PopPIM and DesignFlow PLM. Production Supabase is `qsllyeztdwjgirsysgai`; the shared rehearsal branch is `rjyboqwcdzcocqgmsyel`. DB Data Admin is built here and will run at `https://data.designflow.app` after its production schema gates are satisfied. A schema mistake can break several applications, so work uses branches, PRs, preview rehearsal, exact-version production promotion, and one orchestrator.

## 2. What we set out to do, and why

The user opened this as the single shared-db orchestrator, asked to pull latest, then directed GLM 5.2 workstreams to make the licensor-scrape schema live in production, fix B3's unsafe `service_role` TRUNCATE grant, continue issues #729, #782, #614-617 and #727, and replace Albert's manual protected-production approval with durable automatic gates. Later the user specifically delegated #727 completion to Claude Code. This session completed B3 and several supporting fixes, completed the OrderList preview import, built the safe DB Data Admin launch gate, and left the remaining promotion sequence and automatic-gate change explicitly queued.

## 3. Current state

### Git and queue facts, rechecked 2026-08-12T15:22Z

- `origin/main`: **`f82fc0b0e254eee3b70ec29a950b75568215170f`**.
- Migration files on main: **435**; maximum version **`20260812020000`**; duplicate versions **none**.
- Open PRs: only **draft PR #804**, head `b6d3a171065e6a1fc4998fa5422b8a35b6bc4f2b`; known unsafe and not mergeable as written.
- Open `db-claim` issues: **none**.
- Marker #821 must be closed only after this handoff PR merges.
- There are **26 pre-existing open handoff files** before this one, far above the limit of five. Issue #658 already tracks retention. Never delete another session's file casually.

### Database truth, observed read-only 2026-08-12T15:23-15:24Z

- **Preview `rjyboqwcdzcocqgmsyel`: 428 versions.** It is a strict subset of main, no extras, missing exactly: `20260810140000`, `20260810180000`, `20260810190000`, `20260810190100`, `20260811050000`, `20260811060000`, `20260811070000`. It contains `20260812020000`.
- **Production `qsllyeztdwjgirsysgai`: 392 versions.** It has no versions absent from main and is missing 43 main versions. Use issue #809 and a fresh exact ledger read for the ordered batches; never use the high-water mark.
- **B3 is complete in production.** All 11 exact versions are present: `20260729230000`, `20260729234500`, `20260729235500`, `20260730000500`, `20260731150000`, `20260731153000`, `20260731163000`, `20260731180000`, `20260731190000`, `20260731200000`, `20260812020000`.
- Live B3 ACL proof: four tables, 32 probes, zero mismatches. `service_role` lacks `MAINTAIN`, `REFERENCES`, `TRIGGER`, `TRUNCATE`; retains `DELETE`, `INSERT`, `SELECT`, `UPDATE`; anon/PUBLIC grants zero.
- One repeat production observation at 15:24:51Z had a connection/tool failure and returned no rows. Ignore it; the successful 15:23:31Z observation above is the valid evidence.

### Completed and merged this session

- **PR #823**, merge `dfa1a14970e41185e54c42aceed6c0052c2996bb`: new forward migration `20260812020000` removes unsafe B3 TRUNCATE privileges. Preview rehearsed and production applied.
- **PR #824**, merge `ff858825da68d8934e1045fbc3c9b844f98f10f4`: pins migration content digests so reviewed SQL cannot change before apply. Closed remaining #617 gap.
- **PR #825**, merge `748669002fed6fa7f9d5540f53181466f7d4799a`: fixes production catalog verification to calculate the net effect of ordered GRANT and REVOKE statements.
- **PR #826**, merge `aa430c1d5da5fef1fc418715498285a0e3dd5ebd`: safe, guarded DB Data Admin launch mechanism. It does not launch on merge.
- **PR #827**, merge `070acc5`: Claude-authored OrderList current-workbook profile/importer correction.
- **PR #829**, merge `f82fc0b`: secret-free OrderList preview reconciliation and status evidence.
- **Issue #727 closed:** preview inserted 3,212 orders and 24,010 lines; second run changed zero business rows; all ten checks passed; production untouched.
- **Issue #782 closed:** PR #801/migration `20260812010000` already satisfied the durable Outlook cursor contract; independent review approved closure. Production promotion remains a separate batch task.
- **Issues #614-617 reconciled:** #614 complete; #615 superseded by bounded batch lane; #616 intentionally closed/unbuilt; #617's real digest gap fixed by PR #824.

### Outstanding queue, all covered by open issues

- **#809:** continue production batches **B4 -> B6 -> B7 -> B8 -> B9 -> B10a-d**. B3 is done. Fresh state comment added at handover.
- **#729:** launch DB Data Admin automatically after exact production membership proves both B8 and B9. Safe launch workflow is merged; site remains intentionally offline.
- **#830:** permanently remove Albert's manual GitHub `production` reviewer click and replace it with provider/model-neutral automatic gates. The environment is unchanged today and still requires reviewer `u2giants` id `55610577`.
- **#831:** resolve or close unsafe parked draft PR #804. Never merge it as written.
- Other older outstanding `db-work` issues remain open and were not re-triaged wholesale by this session. The startup survey found about 120; issue titles contain stale/duplicate records, so verify live before dispatch.

## 4. Everything tried that did not work

1. **B3 production run looked failed even though apply succeeded.** Run `31558201593` applied all 11 versions; only post-apply catalog verification failed because it kept earlier `GRANT ALL` expectations after the later intentional `REVOKE`. We did not rerun, repair the ledger, or re-grant unsafe privileges. PR #825 fixed the general ordered net-ACL model.
2. **Several GLM implementation turns timed out with no changes.** Automatic-production-gate jobs `automatic-production-gates-neutral`, `automatic-production-gates-neutral-v2`, and `automatic-gates-repo-neutral-compact` ended exit 124 / `timed-out-no-changes`, with no patch or incomplete artifact. Do not repeat one large prompt. Split implementation by file and concern. GLM was this session's worker only and must not become a durable dependency.
3. **GLM reviews tried forbidden web/external paths.** Those attempts failed closed, were aborted/deleted, and were relaunched with local-only prompts. No unsafe permission was granted.
4. **The first #727 assumption was wrong.** The current workbook did not merely have five fewer rows. Its SHA matched the owner-approved file, but the importer counted 12,354 populated rows because column AR mirrors direct Style values on 8,441 direct rows. Claude fixed the root cause narrowly: ignore AR as an assortment signal only when it exactly mirrors direct Style and has no component separator. Real assortment/multiline values remain.
5. **Old #727 export was unavailable locally.** The five historical deleted rows could not be identified. No identities were invented or published. The current owner-approved workbook was re-profiled honestly instead.
6. **PR #804's deny-list design repeatedly failed security review.** Each patch found another bypass; four known bypass classes remain. Keep it parked or close it after current-main reconciliation. Do not keep patching the deny-list.
7. **A PowerShell GitHub environment update attempt for #729 encoded fields incorrectly.** GitHub rejected it and the environment remained unchanged. #830 owns the next narrow, verified API change.

## 5. Root causes and key findings

- `GRANT ALL` plus a later `REVOKE` must be evaluated in migration order. Assertions built as an unordered union produce a false failure against a secure live state. PR #825 is the durable fix.
- `service_role` TRUNCATE bypasses row triggers. A row-trigger append-only design is not immutable while TRUNCATE is granted. Migration `20260812020000` removes that path and asserts the final effective privileges.
- The production ledger is applied out of order. Exact set membership, not maximum version, is the only valid promotion evidence.
- The user's production approval click adds no review value. Albert explicitly ruled it should be removed permanently, but the replacement must retain automatic exact-SHA, CI, allowlist/dependency, preview, ledger, bounded-apply and post-apply evidence. Durable rules must be model/provider neutral.
- DB Data Admin launch is now mechanically safe but intentionally waits for B8 and B9. Launching before those exact schema/grant batches would expose an incomplete app.
- OrderList source identity is subtle: copied helper columns can make a direct row look like an assortment. The merged importer now distinguishes a mirrored direct value from a real component list, and the preview double-run proves idempotency.

## 6. Exact next steps

1. **Take over marker and read this file plus issues #809, #729, #830, #831.** Gate: live `origin/main`, PRs, claims and ledgers match or differences are recorded before dispatch.
2. **Implement #830 in small pieces.** First a repo-only, provider-neutral evidence contract and offline tests; merge it after independent review and exact-head CI. Then remove only GitHub environment rule `required_reviewers` for `u2giants`; verify every other environment setting is unchanged. Gate: a dry/staged production workflow passes or fails solely on automatic evidence, with no human approval wait.
3. **Continue #809 at B4.** For every batch: fresh production set membership, exact allowlist, dependencies, current-main SHA, required CI/review/preview evidence, bounded workflow, and object/behavior verification. Gate: exact batch versions appear and behavior passes before the next batch.
4. **At B7, handle the data-only `20260807030000` verifier problem honestly.** Reconcile #831/PR #804 first. Do not merge the draft. Gate: either a proven narrow allowlist or a documented safe adjudication path that does not claim unperformed verification.
5. **After exact B8 and B9 production membership, resume #729 automatically.** Use merged guarded workflow, attach `https://data.designflow.app`, deploy exact current main SHA, verify TLS, health, build SHA, authentication and rollback. Gate: live site evidence and issue closure.
6. **Promote B10a-d in order after B9.** Respect NBCU's hard B9-before-B10d count edge. Gate: exact ledger/object/behavior evidence for each.
7. **Worktree retention is separate issue #682/#658 territory.** Inspect dirty/live ownership before cleanup. Never force-remove. Gate: branch merged, no process, clean tree, no unique evidence.

## 7. Constraints and gotchas

- Production/shared cloud remains read-only by default except the bounded owner-approved workflow. No direct DDL/DML, no Terraform apply/destroy, no mutating gcloud.
- Prove Supabase target before every call. MCP may point at production; preview work uses CLI/psql with ref `rjyboqwcdzcocqgmsyel`.
- Never use full-repo `--include-all`; use the bounded temp-checkout recipe.
- Migration versions are unique and immutable. Never edit an applied migration.
- Licensed workbook/source rows never enter git, issues, prompts to outside services, logs or chat. Hashes/counts and secret-free reconciliation only.
- User ordered automatic production gates to be model-neutral. Do not mention or require GLM, Claude, Z.ai, Anthropic or a fixed model in durable workflow policy.
- `COORDINATOR_INTAKE.md` is a retired pointer. Do not write into or delete it.
- More than five handoff files is a warning condition. There were 26 before this file; tracked by #658.

## 8. Access and environment

- `gh` authenticated as `u2giants`; git author/committer verified as `Albert Hazan <u2giants@users.noreply.github.com>`.
- Supabase preview and production read access worked through approved credentials. Secrets live only in 1Password vault `vibe_coding`; no values are recorded here.
- Claude Code `2.1.217` was authenticated and authored #727. GLM 5.2 sessions were used for this session's delegated reviews/patches only, never as a durable runtime dependency.
- GitHub production environment still contains the manual reviewer rule described in #830.
- Secrets sweep: checked session diffs, issue bodies and untracked review artifacts; **nothing new to store**. No secret value surfaced or was committed.
- Docs pass: durable changes are captured by merged PRs and this handoff. No live document outside this handoff was knowingly made false; issue #809 received the corrected B3 state. Root `HANDOFF.md` and `COORDINATOR_INTAKE.md` were not edited.

## 9. Open questions and risks

- **No owner decision remains for #830.** Albert explicitly approved removing his reviewer click permanently. The risk is replacing it with something weaker; preserve every automatic evidence gate.
- #804 is an unsafe draft with a large experimental diff. Leaving it open indefinitely invites accidental use; #831 makes the decision explicit.
- Production remains 43 migrations behind current main. Batch ordering and exact membership are more important than speed.
- The five historical OrderList row deletions remain unidentified because the old export was not found. This does not invalidate the completed import of the later owner-approved workbook, but it is an unresolved historical data-change explanation.
- Worktree inventory is large and includes old branches. No destructive cleanup was attempted during this handoff.

## Per-sub-agent record

### Agent: startup-summary-821 / `codex-orch-summary-821`
- **Asked to do:** summarize current handoff, backlog, issues and PR #804.
- **Actually did:** found current priority, stale/duplicate issue facts and unsafe parked PR #804.
- **Found:** issue titles are not an ordered plan; current handoff and live repo must be reconciled.
- **PR / branch:** none; detached read-only worktree.
- **Worktree:** finished, safe to inspect/clean after process check.
- **Deliberately did NOT do:** no edits, DB or GitHub mutation.

### Agent: preview-observer-821 / `codex-preview-observer-821`
- **Asked to do:** establish preview state.
- **Actually did:** proved preview target and exact ledger; later handover observer refreshed it to 428 versions.
- **Found:** no preview-only versions; seven main versions missing.
- **PR / branch:** none.
- **Worktree:** finished.
- **Deliberately did NOT do:** no data rows or DB writes.

### Agent: GLM B3/verifier/cluster operator / `b3-truncate-fix-821`, `issues-614-617-reconcile`, `automatic-production-gates`
- **Asked to do:** fix unsafe B3 TRUNCATE, promote B3, repair verifier, complete #614-617, design automatic gates.
- **Actually did:** PRs #823, #824, #825 merged; B3 preview and production applied/verified; #617 gap closed.
- **Found:** B3 red run was verifier false negative; automatic-gate implementation repeatedly timed out with no changes.
- **PR / branch:** merged PRs named above; automatic-gates branch has no PR.
- **Worktree:** finished code worktrees contain review artifacts; automatic-gates worktree is unfinished/resumable only after inspection.
- **Deliberately did NOT do:** did not repair/replay B3, re-grant TRUNCATE, remove environment reviewer, or promote B4+.

### Agent: issue-729 GLM operator / `issue-729-glm-821`
- **Asked to do:** complete DB Data Admin launch.
- **Actually did:** merged safe launch gate PR #826 and recorded dependency state on #729.
- **Found:** prior workflow lacked manual dispatch and domain attachment; fixed both with exact-SHA and B8/B9 gates.
- **PR / branch:** PR #826 merged; branch/worktree remains for inspection.
- **Worktree:** finished, safe to clean after merge/process verification.
- **Deliberately did NOT do:** did not launch, expose domain, deploy or change DB; B8/B9 not live.

### Agent: issue-782 GLM operator / `codex-issue-782-final`
- **Asked to do:** complete #782.
- **Actually did:** verified PR #801/migration/tests already complete and closed #782 with evidence.
- **Found:** no duplicate implementation was needed.
- **PR / branch:** none new; detached read-only worktree.
- **Worktree:** finished.
- **Deliberately did NOT do:** did not reapply preview or touch production.

### Agent: issue-727 Claude operator / `issue-727-claude-821`
- **Asked to do:** finish OrderList re-profile, importer correction and preview import with Claude.
- **Actually did:** Claude-authored PR #827; independent Claude review; preview dry run/import/double-run; reconciliation PR #829; closed #727 and claim #828.
- **Found:** AR mirrored direct Style on 8,441 rows; recorded 12,323 count did not match the importer's populated-row logic; root cause fixed without weakening assortment parsing.
- **PR / branch:** #827 and #829 merged.
- **Worktree:** finished; branch `codex/issue-727-preview-report` points at pre-merge head and is safe to retire only after normal checks.
- **Deliberately did NOT do:** no production, no workbook commit, no licensed rows published, no invented identities for the five historical deletions.

### Agent: final handover DB observer
- **Asked to do:** refresh preview/production ledger facts read-only.
- **Actually did:** produced the timestamped 428/392 ledger evidence and exact B3 membership.
- **Found:** preview seven behind, production 43 behind, no extras.
- **PR / branch:** none.
- **Worktree:** sub-agent only, no separate persistent worktree.
- **Deliberately did NOT do:** no DB or GitHub mutation.

## Self-audit gate

1. **Can a street-new developer continue with no questions? YES.** Sections 1-3 identify the applications, projects, exact main/ledger/PR state and queue issues. Sections 6-8 give executable next steps, gates, constraints and access.
2. **Can they continue as effectively as this session? YES.** Sections 4-5 preserve the failed approaches and root causes; the per-agent blocks preserve ownership and deliberate omissions; issue links carry live work.
3. **Did this include what failed and why? YES.** Section 4 records the B3 false failure, three automatic-gate timeouts, permission failures, #727 wrong source-shape assumption, missing old export, PR #804 bypass history and PowerShell API failure.
4. **Is every next step concrete and verifiable? YES.** Section 6 numbers the exact issue/order/action and gives a success gate for each.
5. **Is every term/path/URL explained? YES.** Sections 1, 7 and 8 define the repo, apps, refs, workflow boundaries and relevant worktree paths. Gap found during audit: the repeated failed production read could have been mistaken for a changed state; Section 3 now says explicitly which timestamped observation is valid.
