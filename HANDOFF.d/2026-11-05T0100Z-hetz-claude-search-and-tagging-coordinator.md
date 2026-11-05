---
issue: 680
status: OPEN
owner: claude/vector-consolidation-phases-b12b00 (closed); next coordinator session takes over
---
# Handoff: one coordinator for PopDAM tagging follow-ups and the vector consolidation plan

Merges and replaces the 2026-11-04T2359Z tagging coordinator handoff and the 20261104T2205Z vector plan handoff. Second tracking issue: [#706](https://github.com/u2giants/popdam3/issues/706). Tagging state below was checked Nov 4, 2026, 6:58 PM EST; vector state 7:59 PM EST. Counts go stale within the hour; re-check before acting.

## 0. Business decisions only the owner can make
Put all of these to Albert in ONE message, before starting work.

None open. Both earlier questions were answered Nov 4, 2026, about 10:40 PM EST.

**Already settled, do not re-ask (all Nov 2026 unless noted):**
- Designer names: DS is Derrick Smith; Marta Zabolotnaya is Marcel Zabolotniy (use the spelling in `core.creative_designer`); Shane is a customer who sometimes designs; the other 18 are not designers. Applied to 27 files and 6 groups; undo key `DESIGNER_OWNER_ANSWERS_BACKUP_2026_11_04`.
- The four empty PDFs (0 bytes, 2023-2024) are disregarded: "old enough that they can be disregarded."
- "Start the full run" (Albert, Nov 4, 4:16 PM EST). Running.
- "new sheets should automatically get the free tags" (Albert, Nov 4). Live.
- GLM 5.3 Flash is the primary tagging model. Backup GPT-6 Luna was chosen by bake-off.
- Eli is an active freelancer/illustrator; other non-staff listed earlier are inactive. "group shot" is itself a character tag. "costing sheet / licensing sheet" stays paired.
- Albert is not a technical designer: removed and guarded against return.
- A failed search shows an error and Retry, never a false result (Albert, Nov 1). Unknown code-shaped searches keep picture guesses (Albert, Nov 3).
- DC and Harry Potter sit under Warner (ruling 2026-11-01). Character data comes from licensing records, never guesses.

The DigitalOcean key (task 7) is a technical access block, not a question for Albert.


## 1. What this application is
PopDAM is POP Creations' digital asset library for product art, tech packs and licensing sheets; staff search by character, product and tag. PopSG is the style-guide library in the same codebase (sg.designflow.app). Repo https://github.com/u2giants/popdam3. Live app dam.designflow.app. Database: Supabase project `qsllyeztdwjgirsysgai`, whose structure is changed through https://github.com/popcre/shared-db. Tagging and PopSG indexing run in the Railway worker. A Windows PC (`edge-dev`) runs the GPU poller for DAM search vectors and a Windows agent reads PDFs. A bridge agent on NAS `edgesynology1` scans files.

## 2. Goal
Trustworthy search and AI tags across the library, kept true every day without anyone restarting anything. Two tracks share one database, one worker and one coordinator: Track T finishes #680 (tags and records), Track V executes [plan_vector_consolidation.md](https://github.com/u2giants/popdam3/blob/main/plan_vector_consolidation.md). That plan's STATUS table and "Reconciliation" section govern all vector work. The coordinator starts sub-sessions, verifies against live evidence, and does no task work.

## 3. Current state
**Running, do not stop or restart:** full tagging run. `admin_config.AI_TAG_PARALLEL_RUN` = run_id `full-run-680-20261104`, GLM, `discover: true`, concurrency 8. My live check at 6:49 PM EST: 192 assets tagged in the last 15 minutes, 1,229 in 2 hours, last at 6:49 PM EST. Task 1 reported at 6:33 PM EST: 1,029 tagged, 3 failed of 117,535, about 7.7 days left, started 4:55 PM EST. It may step aside for nightly grouping at 1:00 AM EST; this has not yet been observed.

**Running:** NAS full scan requested Nov 4, 1:48 PM EST, id `41e79a01`, 13,129 updated at 6:33 PM EST. Task 4 waits for it.

**Landed and verified by each session's report; merged state checked by me on GitHub:**
- Tagging rules and full-run enablement: PRs [691](https://github.com/u2giants/popdam3/pull/691), [694](https://github.com/u2giants/popdam3/pull/694), [717](https://github.com/u2giants/popdam3/pull/717), [727](https://github.com/u2giants/popdam3/pull/727). Review page https://claude.ai/artifact/PLsjGCL8kMPu12NKdrqwdT.
- Picture audit fixes: [721](https://github.com/u2giants/popdam3/pull/721), live per worker heartbeat b19fac79. On 163 files, 489 runs each: characters 78.1% to 82.8%; junk tags 139 to 9; missing licensor/property tags 106 to 0; stability unchanged (134 to 135 stable files). [Verdicts](https://github.com/u2giants/popdam3/issues/680#issuecomment-6642526535). [Missing characters list](https://github.com/u2giants/popdam3/issues/680#issuecomment-6642834919), test files only.
- Backup model: [710](https://github.com/u2giants/popdam3/pull/710), [724](https://github.com/u2giants/popdam3/pull/724). `vision_tagging_fallback` = `openai/gpt-6-luna`. [Comparison](https://github.com/u2giants/popdam3/issues/680#issuecomment-6642792648). The switch was proven in a simulated outage from hetz against live data, NOT on the live worker.
- Designer cleanup: [712](https://github.com/u2giants/popdam3/pull/712), [732](https://github.com/u2giants/popdam3/pull/732). 268 unknown spellings fell to 23. Albert removed from 1,462 files and 964 style groups. Undo keys `DESIGNER_SPELLING_CLEANUP_BACKUP_2026_11_04`, `ALBERT_TECHNICAL_REMOVAL_BACKUP_2026_11_04`. The junk-tag numbers are a replay over stored tags, not a model run. [Spellings](https://github.com/u2giants/popdam3/issues/680#issuecomment-6642386751), [Albert](https://github.com/u2giants/popdam3/issues/680#issuecomment-6643348805).
- Free tags: shared-db [5575](https://github.com/popcre/shared-db/pull/5575), [5579](https://github.com/popcre/shared-db/pull/5579), [5593](https://github.com/popcre/shared-db/pull/5593). Tags grew 5,149 to 5,201 with 52 arriving after 6:00 PM EST; those sheets were not individually inspected.
- Failed rescan files: [718](https://github.com/u2giants/popdam3/pull/718), Windows agent 0.17.0.196. Of 634: 192 oversized read, 5 re-read (3 paths corrected), 207 current copy under its own record and read, 226 gone, 4 empty. [Evidence](https://github.com/u2giants/popdam3/issues/680#issuecomment-6645599811). `PDF_BACKFILL` completed per Task 7; my 6:49 PM EST read still showed running with 11 left, so re-check. The rest of the 1,043 failed count was not separately reconciled in these reports.
- October audit: [713](https://github.com/u2giants/popdam3/pull/713), merged 5:12 PM EST. Keyless render calls get 401 and agents heartbeat; a real agent claim, agent and helper fixes on machines, and the worker Stop change in production are unverified. CI on its merge commit failed one OrderList grid test the change did not touch; later main CI not rechecked by me.
- Search test: [720](https://github.com/u2giants/popdam3/pull/720) merged; edge deploy NOT verified. Saved as `SEARCH_EVAL_SET_V1` (119 cases). [Baseline](https://github.com/u2giants/popdam3/issues/680#issuecomment-6645194328): main library 106 of 119; PopSG figures there. Workflow never yet run in Actions.
- Earlier tasks: #687 and shared-db#5522 closed (PR 692); product-code search #689 closed (PRs 690, 699); promotion repair PRs 5559, 5561, 5562, 5572 merged, recorded on shared-db#5532.
- NAS agent `synology-bridge-1` is 1.16.21, above the 1.16.20 target, so no update was run.

**Superseded by this merge:** PR 726 closed (same work landed as PR 717).

**Not landed:**
- Character records: shared-db [5590](https://github.com/popcre/shared-db/pull/5590) is merged, but review finding [5592](https://github.com/popcre/shared-db/issues/5592) is open and holds promotion, so production rows are unproven. Its automatic fixer deferred because the branch is deleted. [PR 731](https://github.com/u2giants/popdam3/pull/731) (aliases) open; branch `fix/680-worker-reads-character-aliases`. The helper stopped on the usage limit without a final report.
- Search ranking fixes: shared-db PR [5582](https://github.com/popcre/shared-db/pull/5582) closed and parked with conflicts; branch `fix/search-eval-ranking-680`, head 1f4a1949. Nothing applied. Notes on [5581](https://github.com/popcre/shared-db/issues/5581), which is open with no owner.

**Claims:** none held by this tree; closeout check ok at 6:59 PM EST for this session; each child reported none or a passing check.


**Vector state, 7:59 PM EST:** DAM groups 11,237 of 11,247, 0 pending, 10 errored; DAM files 135,134 of 136,236, 0 pending, 1,102 errored; PopSG 162,115 of 234,795, 72,680 pending, 21,888 written in the last hour, so about 3.5 hours left. Plan Step 0 done: shared-db PRs 5588, 5585 and 5594 merged and in the production ledger.

## 4. What did NOT work
- Pressing start on the rescan clears rescan mode. Never press it.
- More than 8 tagging calls at once overload saves.
- First full-run queue at 4:43 PM EST did not work: older code could not run the whole library; fixed and requeued at 4:55 PM EST.
- Qwen as backup candidate: 220 seconds a file. Two other candidates were unavailable on the account.
- Setting a backup model alone did nothing: the full run ignored it and outages never triggered a switch; PR 710 fixed that.
- Merging before CI: PR 691 broke main until PR 694.
- A claim recorded only as a comment is not a native claim; the closeout check will not see it.
- App rule: on a turn triggered by another session's message, starting a session is refused; only proposal cards work.
- `gh` read loops over PRs are refused by a hook. Use `ai-pr-wait` in the background.
- Sessions' "full run not started" lines were stale. Always read live data.
- Usage limits killed three sessions mid-closeout at 6:34 PM EST; two helpers lost state, others recovered.

- The plan's "keyword fallback when embedding fails" contradicted Albert's Nov 1 rule; error and Retry wins.
- The plan's public scorecard fixture would have put licensed names in a public repo; the private `SEARCH_EVAL_SET_V1` is extended instead.

## 5. Key findings
- The largest cause of wrong characters was missing records, not the model: Paw Patrol, Care Bears, Michael Myers, Chucky, Dwight absent; Venom, Dumbo, Marie under the licensor but not linked to a property. Unmatched names now become search tags, tested but not re-run on the sample.
- Characters vary between runs, and the fixes did not improve that. Grogu was missed on GFZ52SWMD06 in Task 1's report.
- Picture verdicts were one AI's judgment, and interim numbers shifted; 82.8% is final.
- The 634-file failure fix belonged to the Windows agent, not the NAS agent.
- 49 of 400 sampled live records were not found at their path: real, or file-name characters? Unresolved.
- Exposed DigitalOcean Spaces key: live fingerprint equals the July 23 snapshot, last changed March 11, 2026.

- Open review findings hold shared-db promotion, so Track T task 1 gates every Track V database step.
- In the 3 hours to 7:59 PM EST, 12,990 DAM file records were re-indexed and 8,731 re-embedded, more than the 2,414 pending at 4:58 PM EST. Something beyond the nightly rebuild is causing re-embedding; plan Step 3 measures tagging and scanning too.

## 6. Exact next steps (one sub-session each)
Sessions must not edit each other's files. Never restart tagging from 1:00 to 3:30 AM EST. Every merge touching the worker restarts it, so none in that window.

### Track T (tasks keep their old numbers)
Sessions must not edit each other's files. Never restart tagging from 1:00 to 3:30 AM EST.
1. **Character records live.** Resolve finding [5592](https://github.com/popcre/shared-db/issues/5592) on a fresh shared-db PR, claim-first; confirm production has the rows; merge [PR 731](https://github.com/u2giants/popdam3/pull/731) outside 1:00 to 3:30 AM EST. Findings 5591 and 5595 are closed. Finding [5583](https://github.com/popcre/shared-db/issues/5583) is also open and may hold promotion: if it does, resolve it here against parked branch `fix/search-eval-ranking-680`. Migration `20261105002300` is merged but not in the production ledger at 7:59 PM EST, which is the proof that promotion is held. You'll know it worked when a new character is offered and linked on a live file, via an alias match.
2. **Relink.** After task 1. Relink files tagged before records went live. You'll know it worked when sample files link Chase, Cheer Bear, Chucky, Michael Myers and Dwight.
3. **Full run watch, then finish.** Read the first full-run files after b19fac79: licensor and property tags present, no season words, unmatched names tagged. Check grouping completes on the first night after 1:00 AM EST. Do not sit polling: check at those two moments, then at about Nov 12. At completion, set `AI_TAG_PARALLEL_RUN` to `{"enabled":false}`, prove a live sample, and re-tag any of the 197 re-read files tagged before their re-read (5 at 4:24 PM EST; 192 from 6:03 to 6:57 PM EST). You'll know it worked when all files are tagged, each re-read file's tag timestamp follows its re-read, and grouping completes nightly.
4. **Stale-record proof, [#681](https://github.com/u2giants/popdam3/issues/681), and [#684](https://github.com/u2giants/popdam3/issues/684)'s remainder.** Gate: `SCAN_PROGRESS` shows scan 41e79a01 completed. Rerun `scripts/list-missing-pdfs.sql` (baseline 498), recheck new-record twins and retirement rows since 1:48 PM EST. Then scan to ingest test copies in `Decor/Generic Decor/Unused/_ai_test_681/{a,b}`, move the a/ copy to c/, scan again, then remove test files and records. Recheck the 49 records. Source: [2209Z handoff](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-03T2209Z-hetz-claude-stale-retirement-activation.md), [2210Z handoff](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-03T2210Z-hetz-claude-missing-pdf-records.md), and [#681's latest note](https://github.com/u2giants/popdam3/issues/681#issuecomment-6645209873). You'll know it worked when the old record is `is_deleted=true` with a retired-stale-duplicate history row, no new stale duplicates are found, the 49's cause is recorded, and both handoffs are retired.
5. **433 leftover records.** After task 4. Apply retirement rules to the 207 and 226 in `outcomes.csv`, at `/volume1/docker/popdam/manual-scans/pdf-index-20261104-rescan-failures/` on NAS `edgesynology1`. You'll know it worked when each is retired or kept with a reason on #680.
6. **Moved:** search fixes and after-score are now Vector plan Step 5 (Track V below).
7. **Blocked: exposed DigitalOcean Spaces key, [#714](https://github.com/u2giants/popdam3/issues/714).** No token in the vault or on hetz; signed out in all 3 connected browsers about 4:30 PM EST. When access exists: create a new key, update admin_config, Railway worker, edge functions and 1Password, prove thumbnail upload and delete, revoke the old key, delete `fix_admin_config_secret_rotation.md`. You'll know it worked when the old key is rejected and the new one proven in use.
8. **Other spellings of the two designers.** Answers are applied. Deferred at wrap-up: files still carry variants such as Marz Zabolotniy (97), Maria Zabolotnaya (49), Marz Zabolotnaya (27), MARCEL, DERRICK (920). Albert said "use whatever is in the Creative Designers table." Map unambiguous variants to `core.creative_designer` names, with a backup; leave pairs like ERICA/MARCEL, and investigate oddities such as Marcel Hazan and Albert Zabolotniy. You'll know it worked when no unambiguous variant remains.
9. **Audit backlog.** Fix in order [#469](https://github.com/u2giants/popdam3/issues/469) (rich-pdf failed extractions needs a shared-db function change; Download all; unordered export paging; StylesPage over-invalidation), then [#470](https://github.com/u2giants/popdam3/issues/470) and [#471](https://github.com/u2giants/popdam3/issues/471); prove agent and helper fixes and close [#468](https://github.com/u2giants/popdam3/issues/468) once machines update. Verify the OrderList test on main. You'll know it worked when each is fixed or dropped with evidence.

### Track V (exact wording, gates and files are in the plan)
- **V-A. Plan Phase 1: Steps 1 to 4, one session.** Depends on T task 1 clearing promotion, for the database parts; worker, poller and watchdog-page code may start now. You'll know it worked when each step's gate in the plan passes and STATUS names the artifacts.
- **V-B. Plan Phase 2: Step 5, one session.** Start after T task 1. You'll know it worked when ranking fixes are promoted, #725 is closed, and a before-and-after score is on #680 and #706.
- **V-C. Plan Phase 3: Step 6, one session.** After V-B and PopSG indexing is under 1% pending. You'll know it worked when PopSG meaning search is on and proven, or held with the measured speed gap on #706.
- **V-D. Plan Step 8.** Last. You'll know it worked when #706 and #663 close with live proof.

`dam-search-ai` is shared by V-B and V-C: never in parallel. #680 closes when Track T gates pass.

## 7. Constraints
Feature branch and PR; the AI merges; PopDAM has no reviewer gate. Shared-db via claim-first with promotion workflow only. Do not restart NAS containers during a scan. Heavy jobs slow search. Concurrency stays at 8. The test folder under `_ai_test_681` stays on the NAS on purpose. Albert's replies follow his format, 120 words maximum, times in EST, business questions only.


## 8. Access
Supabase MCP (confirm URL contains `qsllyeztdwjgirsysgai`). Secrets in 1Password vault `vibe_coding`. NAS SSH alias `edgesynology1`. Railway connector failed on hetz. Machine: hetz. Preserved worktrees: audit data for the picture check is untracked in `loving-rubin-2129f2` on hetz, ignored by git; `search-eval-680` in the shared-db checkout holds the parked search work (also on GitHub).


## 9. Open questions and risks (Nov 4, 2026)
- Files tagged before task 1 lands get search tags, not links, for missing characters; task 2 repairs that.
- The missing list covers test files only, so the wider library may have more gaps. Task 1's helper was asked to measure; no result reached this session.
- Backup switching is unproven on the live worker.
- Run cost estimate was about $87 for 119,176 files, not re-measured.

- PopSG meaning search measured 10 to 11 seconds against a 3 second target; if unchanged at full coverage it stays off (plan Step 6).

## Part (b): sub-sessions
All preserved worktrees are clean unless noted and removable after review; none removed by this closeout.
### [Task 1: tagging rules](claude://claude.ai/epitaxy/local_36180fb1-c4c7-4140-af97-c7778e251326)
Asked: rules, review page, full run. Did: all live, run started. Found: section 3. Worktree `angry-moser-354be3`. Helper worktree `agent-a224d21c32180547d` preserved with PR 731. Not done: tasks 1 to 3.
### [Task 2](claude://claude.ai/epitaxy/local_ff4b7eb3-f35b-4a9a-ba1e-1d8e3d30ebe9)
Asked: agent update, proof. Did: confirmed update unnecessary. Worktree `reverent-mayer-2663a4`. No PR. Not done: task 4, scan unfinished.
### [Task 3](claude://claude.ai/epitaxy/local_e4bf75ef-50af-4276-9afc-13432b7fdb81)
Asked: missing-record finish. Did: 2 corrected assets show replaced. Worktree `strange-franklin-10f6f6`. No PR. Not done: task 4's duplicate check.
### [Task 7](claude://claude.ai/epitaxy/local_bc4fb79a-ffa2-4738-b4e1-e0d2cd3fa1a8)
Asked: failed files. Did: PR 718, 634 sorted. Worktree `youthful-euler-5e3545`. Not done: tasks 3, 5.
### [Picture check](claude://claude.ai/epitaxy/local_361fe4b9-548b-486d-9964-d7e8cd41b9a1)
PR 721, verdicts. Worktree `loving-rubin-2129f2`. Did not verify fixes on live files (task 3).
### [Designer names](claude://claude.ai/epitaxy/local_e62de494-facb-4621-9446-b4ee578ec427)
PRs 712, 732. Worktree `distracted-lichterman-13ff23`. Not done: task 8. Entire Gates failed on 712, not required, cause not investigated.
### [Search test](claude://claude.ai/epitaxy/local_a9087004-83f9-480c-9822-92360ee78186)
PR 720; parked 5582. Worktree `reverent-faraday-d39ea9`. Not done: task 6.
### [Backup model](claude://claude.ai/epitaxy/local_8b59bbe0-b932-489e-bec7-ee17eccf2dc4)
PRs 710, 724. Worktree `cool-leavitt-cb46c1`. No open tasks.
### [October audit](claude://claude.ai/epitaxy/local_7970ddcd-d1c9-4e79-b284-89706ac54ece)
PR 713. Worktree `objective-cannon-c75936`. Not done: tasks 7, 9.
### Tasks 4, 5 and [Task 6](claude://claude.ai/epitaxy/local_366207b5-bbba-4310-983c-7dc7fe26a0ba)
Closed earlier, with nested promotion-trigger-fix and trace-5539-dispatch; outcomes in section 3.

**Child handoffs:** none new. Existing: [2208Z](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-03T2208Z-hetz-claude-tagging-after-indra-rescan.md) (successor review once task 3 ends), 2209Z and 2210Z (task 4 retires them).


### Vector plan author (closed)
Wrote the plan, PR 735, no execution. Its handoff is merged here.

## Self-audit
1. Newcomer could continue: yes, sections 1 to 3 and 6 plus the plan. 2. As well as I could: yes, sections 4, 5, 9 and part (b). 3. Every detail: yes, with limits stated in sections 3 and 9. 4. Section 0 complete: walked all sections; nothing needs Albert; the DigitalOcean key is listed as blocked, and the search-failure behaviour is settled by his Nov 1 rule.
