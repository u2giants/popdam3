---
issue: 680
status: OPEN
owner: claude/popdam-search-tagging-coordinator-61e721 (closed); next coordinator session takes over
---
# Handoff: PopDAM tagging and PDF cleanup, coordinator for all open work

Replaces the 2026-11-03T0021Z coordinator handoff, whose tasks A to F are finished or carried below. State checked Nov 3, 2026, 5:40 PM EST. Re-check every item before acting.

## 0. Business decisions only the owner can make
Put these to Albert in one message, at the moment stated.

**Blocking the full run (task 1, last step):** Albert said "wait until the rescan finishes". He has not separately said go. Show him the review page and cost/time (about 6.9 days), then ask for go. Recommendation: go if the review page shows each rule working.

**A wrong guess is recoverable:**
- 31 files name a designer whose first name is not on the known-names list. Should these be added? Show him the distinct names once. Recommendation: add the real people.
- Asset-type words: use his list exactly. Recommendation: "costing sheet / licensing sheet" stays one paired label.

**Already settled, do not re-ask:** GLM over Muse. Sheet designer names replace existing ones. Missing files get a nested session using SSH to `edgesynology1`. Tag pairing happens after the model call. Licensor and property ownership come from licensing records and scrapes. DC and Harry Potter sit under Warner.

## 1. What this application is
PopDAM is POP Creations' digital asset library for product art, tech packs and licensing sheets; staff search by character, product and tag. Repo https://github.com/u2giants/popdam3. Live app dam.designflow.app. Database: Supabase project `qsllyeztdwjgirsysgai`. Tagging runs in the Railway worker. A Windows agent reads PDFs. A bridge agent on NAS `edgesynology1` scans files.

## 2. Goal
Albert wants search and AI tags trustworthy before paying to tag the whole library. The successor is **only a coordinator**: it starts one linked sub-session per task, verifies results against live evidence, relays them, and does no task work.

## 3. Current state
**Finished and verified (do not redo):**
- Old task C: "spiderman coir" stays on main search, 15 groups, under 4 seconds ([#665](https://github.com/u2giants/popdam3/pull/665)). All-files search sped up ([shared-db#5527](https://github.com/popcre/shared-db/pull/5527)).
- Old task D: 32,581 is the correct removed-links count. Removed 3,545 more wrong links and 58 tags, with `archive.*_20261102` backups. Full-run scope is 119,176 files (not deleted, has a thumbnail, not in two skipped groups); 110,500 was an old estimate.
- Old task E: closeout fix installed on hetz, proven on test data ([note](https://github.com/popcre/ai-devops/issues/2172#issuecomment-6592263238)). Old task F: already done, recorded on ai-devops#2172, which stays open for wider work we do not own.
- Old task A: character load live through shared-db PRs 5539, 5544, 5546. `core.character` is 15,018; `public.characters` is 9,622 (different tables, which explains earlier conflicting counts).
- Watch item shared-db#5188 is closed.

**Running:** Indra PDF rescan. `admin_config.PDF_BACKFILL` at 5:40 PM EST: status running, 7,360 processed, 12,026 remaining, 637 failed, about 20 files a minute, expected finish about 4:00 AM EST Nov 4. Not started: full tagging (`AI_TAG_PARALLEL_RUN` is `{"enabled":false}`).

**Not confirmed:** I did not find old task A's formal 163-file report (before/after, wrong characters, odd names, cause of 67 files with links but no character). 188 files were tagged in the prior 26 hours, ending 8:52 AM EST, and Albert then redirected to a quality review. Task 1 answers this from its sample re-run.

No claims held; closeout check passed at 5:40 PM EST. Latest migration 20261103174555. `origin/main` was b2550c5e before this handoff merged.

## 4. What did NOT work
- Character load 20261102225602 failed rehearsal (missing type `core.source_confidence`) and never applied; it was removed and replaced. A rename gets skipped by the queue: use a removal plus a new file.
- Pressing start on the rescan clears rescan mode. Never press it.
- Designer backfill without a known-name rule let junk overwrite names.
- More than 8 tagging calls at once overload saves.
- Hand-written PR polling loops are refused by a hook; use `ai-pr-wait` (on PATH, not in `bin/`).
- Coordinator lesson: sub-sessions go idle while waiting, and a closed sub-session's "done" can hide a gap. Read their final messages and check live data.

## 5. Key findings
- Issues #681 and #684 both need the same one NAS agent update. Run it once only (task 2 owns it; task 3 waits for it).
- #681's step 4 lint fix landed in [#686](https://github.com/u2giants/popdam3/pull/686). Its review finding #687 says the fix suppressed the warning rather than removing the escape.
- Task C found a product-code search also returned 7 unrelated lookalikes. Nobody owns this. The original one-time fallback never recurred; its cause stays unproven.
- Promotion repair [shared-db#5536](https://github.com/popcre/shared-db/pull/5536) merged 2:02 PM UTC Nov 3. Later production applies for 5544 and 5546 succeeded, which appears to be the real-change proof its session lacked; PR 5539's production apply run shows one success and one failure.

## 6. Exact next steps (one linked sub-session each)
Start tasks 1, 4, 5 and 6 now; tasks 2, 3 and 7 when the rescan finishes. Give each sub-session its source file. Never restart tagging during nightly grouping at 1:00 AM EST.
1. **Tagging rules and full run, #680.** Source: [handoff](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-03T2208Z-hetz-claude-tagging-after-indra-rescan.md), its section 6 steps 3 and 5, then 6. Include old task A's missing numbers. You'll know it worked when Albert has the review page; after his go, the run finishes at concurrency 8 and a live sample passes.
2. **Agent update and stale-record proof, #681.** Source: [handoff](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-03T2209Z-hetz-claude-stale-retirement-activation.md). Gate: `PDF_BACKFILL.status` completed. You'll know it worked when `synology-bridge-1` reports 1.16.20 and the moved test file retires its old record.
3. **Missing-record finish, #684.** Source: [handoff](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-03T2210Z-hetz-claude-missing-pdf-records.md). Gate: task 2's update. Do not request a second update. You'll know it worked when the 2 corrected assets show `replaced` and the lookup shows no new stale duplicates after a full scan.
4. **Review findings from this work:** popdam3 #687 and shared-db#5522. Fix or close with evidence if the automatic fixer has not. You'll know it worked when both are closed.
5. **Product-code search lookalikes.** Reproduce on the live app; fix if real, through a PR. You'll know it worked when that search shows only true matches, or evidence shows they are legitimate.
6. **Promotion repair proof.** Confirm from run logs that #5536 held on a real migration, and explain 5539's failed run. Read-only. You'll know it worked when the outcome is noted on its issue.
7. **Missing files, #680 section 6 step 2.** Gate: rescan finished. SSH to `edgesynology1`, relocate, re-read. Coordinate with task 3. You'll know it worked when each failure is relocated or proven gone.

Done when all seven meet their gates, Albert has decided the full run, and each sub-session has passed its closeout check.

## 7. Constraints
Do not update the NAS agent or restart NAS containers during the rescan. Heavy jobs slow search. Feature branch and PR; the AI merges; PopDAM has no reviewer gate. Shared-db changes go through popcre/shared-db claim-first. Character data comes from licensing records, never guesses. Albert's replies follow his format, 120 words maximum, times in EST, business questions only.

## 8. Access
Supabase MCP (confirm URL contains `qsllyeztdwjgirsysgai`). Secrets in 1Password vault `vibe_coding`. NAS: SSH alias `edgesynology1`. Railway connector failed on hetz. Machine: hetz.

## 9. Risks (Nov 3, 2026)
Counts go stale within the hour. Indra misreads could reach descriptions; check samples. The 2208Z handoff still mentions the retired 0021Z file; ignore that reference.

## Part (b): sub-sessions
### A: Character load (zen-mendel-20be8a)
Asked: load, re-run 163, report. Did: load live; Albert redirected to rescan work; PRs 667-679 and 5539-5546. Worktree finished. Did not: full run, or the items in the 2208Z file.
### C: Search fallback (agitated-wescoff-ebc326)
Did: #665 live. Worktree finished. Did not: lookalike search (task 5).
### D: Label audit (competent-almeida-69b9f9)
Did: audit, cleanup, backups. Worktree finished. Did not: touch files the full run overwrites.
### E and F
Did: closeout install; lane-lock verified with no change. Finished and archived.
### Nested: find-missing-files, retire-stale-duplicates, speed-up-all-files, fix-promotion-picker
PRs 675, 677, 5527, 5536. Finished. Leftovers: tasks 2, 3, 6, 7.

## Self-audit
1-3. Yes: sections 1-3 give context and state, 4-5 failures and findings, 6 gated actions, part (b) each session. 4. Yes: walked all sections; the only owner items (full-run go, 31 names, asset labels) are in section 0, and no technical approval is there.
