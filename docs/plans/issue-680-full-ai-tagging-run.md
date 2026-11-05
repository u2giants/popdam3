# Plan: Full AI tagging run after Indra PDF rescan (u2giants/popdam3#680)
Issue: https://github.com/u2giants/popdam3/issues/680
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).
Predecessor handoffs (read for history, not for state): [2026-11-03T2208Z tagging](../../HANDOFF.d/2026-11-03T2208Z-hetz-claude-tagging-after-indra-rescan.md), [2026-11-04T2359Z coordinator](../../HANDOFF.d/2026-11-04T2359Z-hetz-claude-close-nested-tagging-followups.md). Related plan: `plan_openrouter_batch_restart_recovery.md` (batch restart survival; not the parallel lane).

**Drift note (Nov 4, 2026, 5:00 PM EST):** PR #727 merged to `main` at 4:53 PM EST as `4720dd2e` (guard at `apps/worker/src/handlers/ai-tagging.ts` now skips the asset-ID check for discover runs). Treat any step that says "merge #727" as done pending worker heartbeat SHA ≥ `4720dd2e`; re-verify the remaining findings against that commit.

## STATUS (live state read 4:46 PM EST Nov 4, 2026 — re-read before acting)

| # | Step | State | Evidence |
|---|------|-------|----------|
| P1 | Tagging rules built and live (group shot, paired labels, asset-type words, sheet facts, junk filter, named characters) | ✅ done (prior sessions) | PRs #691 #694–#697 #700 #710 #712 #721 merged; worker heartbeat `admin_config.WORKER_HEARTBEAT.sha = 4409e2d3` at 4:46 PM EST |
| P2 | Indra rescan finished | ✅ done | `admin_config.PDF_BACKFILL.status = completed`, 19,434 processed, 1,043 failed, `completed_at 2026-11-04T21:24Z` |
| P3 | Backup model saved and failover proven | ✅ done | `AI_TASK_MODELS.vision_tagging_fallback = openai/gpt-6-luna`; issue comment 4:40 PM EST Nov 4 (live 503 proof) |
| 0 | Owner go for the paid run confirmed in Albert's words | ✅ done | #680 comment 5:00 PM EST Nov 4: "Start the full run", relayed by the coordinator |
| 1 | Fix the guard that failed the run at 4:43 PM EST (PR #727) merged and running on the worker | ✅ done | Merged `4720dd2e` 4:53 PM EST; run started on it |
| 2 | Run re-queued from cursor 0 and tagging files | ✅ done | Started 4:55 PM EST: 117,535 files, 8 at a time, GLM, force; 48 files by 5:00 PM EST, 0 failed |
| 3 | First-hour check: throughput, failures, backup use, quality sample | ⬜ open | — |
| 4 | Daily checks until done; nightly-grouping yield observed | ⬜ open | — |
| 5 | Completion: leftovers retried, setting disabled, live sample passes, review page updated | ⬜ open | — |
| 6 | Closeout: issue comment, handoff, docs, undo backups released | ⬜ open | — |
| 7 | Rescan follow-ups and leftovers each have a named owner on #680 | ⬜ open | — |

Where a fresh session starts: section 9 step 0 (re-read live state), then step 3. Steps 0–2 are done; the section 0 question, section 5 live data and PR #727 text below are history from before the start.

---

## 0. The only owner question

Albert said on Nov 3: "wait until the rescan finishes." The rescan finished at 4:24 PM EST Nov 4. The run costs real money (GLM estimate $38–$87 for ~117,500 files; backup use adds a little) and about 4–7 days of worker time. **Ask Albert for his go before the run tags files, unless his go is already recorded in his own words.** Evidence that someone believed he had given it: PR #717's body says "Albert released the full run"; the 4:26 PM EST issue comment speaks of "the run ordered at 4:16 PM EST"; the setting `AI_TAG_PARALLEL_RUN` was enabled at 4:43 PM EST by a session with `requested_by: issue-680-full-run`. None of those quotes Albert. The implementer checks #680 and the coordinator chat for Albert's words; if found, step 0 is done — record the quote on #680. If not, the coordinator puts one question to him: *"Rescan is done and the fixes are live at about 83% character accuracy. Start the ~$40–$90, 4–7 day tagging run now?"* Recommendation: go. Everything else in this plan is technical and never waits on him.

Already settled, do not re-ask: GLM `z-ai/glm-5.3-flash` primary; backup `openai/gpt-6-luna`; "group shot" is a character; costing/licensing sheet stay one paired label; sheet designer names replace existing; Child merged into Grogu; Eli active, Tan/Cliff/Hana/Uta/Ira inactive; character and licensor data come from licensing records, never guesses; DC and Harry Potter sit under Warner.

## 1. The ultimate goal

POP Creations staff find product art by character, product type, customer and descriptive words. Most of the ~117,500 library files carry old or inconsistent AI tags. **The goal: every in-scope file gets fresh tags, a description and character links from one consistent rule set, paid for once, with a measured quality sample that Albert can see — and search is trustworthy afterwards.** "In scope" = not deleted, has a thumbnail (the candidate RPC's rule), which was 117,535 files when the run was queued.

If a step conflicts with this goal, the goal wins — stop and flag it. In particular: never run tagging in a way that loses already-good tags without replacement, never let the run block nightly grouping for days, and never spend on a second pass without evidence the first pass failed.

## 2. What this application is

PopDAM, repo `u2giants/popdam3`, live at https://dam.designflow.app, database Supabase `qsllyeztdwjgirsysgai` (Virginia). Tagging runs in the Railway worker (`apps/worker/`, auto-deploys on every push to `main`; its running commit is in `admin_config.WORKER_HEARTBEAT.sha`). The model call goes through OpenRouter; prompt and schema live in `supabase/functions/_shared/tag-asset-contract.js` with an identical copy at `apps/worker/vendor/tag-asset-contract.js` (verified identical with `cmp`). Model choice: `admin_config.AI_TASK_MODELS` (`vision_tagging`, `vision_tagging_fallback`). Bulk operations are rows in `admin_config.BULK_OPERATIONS`, written through the RPC `update_bulk_operation(p_op_key, p_op_state)` and read every second by the worker's `tick()` in `apps/worker/src/operation-loop.ts`. Model and lane rules: `docs/MODEL_RULES.md` (line 38 documents `AI_TAG_PARALLEL_RUN`, including `discover`).

## 3. What triggered this work

Albert asked on Nov 3 for trustworthy tags before paying for the whole library (handoff 2208Z §2): group shots, every selected character in tags and description, paired sheet labels, clear asset-type words, sheet facts in descriptions and metadata. Those rules were built and proven on samples (issue comments Nov 3–4). A session queued the full run at 4:43 PM EST Nov 4; it **failed on its first tick** with "Single-asset tag operation has no asset ID" and tagged nothing (live `BULK_OPERATIONS["ai-tag-parallel"]`: status `failed`, `started_at 2026-11-04T21:43:52Z`, `progress.total 117535`, tagged 0). Another session opened PR #727 at 4:44 PM EST with the fix.

## 4. Scope

In: landing the guard fix, re-queueing and running the whole-library run to completion, monitoring, live quality proof, disabling the setting, closeout on #680.

**NOT in this plan** (each stays tracked on #680 or its own issue; do not pick up while babysitting the run)
- Rescan failures: 634 live files (438 moved/renamed on the NAS, 192 over 100 MB, 4 empty). PR #718 (merged) raises the agent limit to 1 GB; still needs the NAS/Windows-agent update path (#681 owns agent updates) and a requeue without pressing start.
- Loading missing character records (Care Bears, Paw Patrol, NBC, Viacom, Asha alias) — `popcre/shared-db`, claim-first, `shared-db-change` skill; largest remaining accuracy gain, but a second tagging pass would be needed to use them.
- Group-shot under-counting and crowded-art variance (model behaviour, not fixed).
- Albert in the technical designer field: **done, not open.** Albert ruled Nov 4; 1,462 files and 964 style groups cleared 5:05 PM EST, PR #732 merged. Step 3 checks it stays clear.
- Albert's identity answers on the 21 remaining designer names — pending with him, tracked on #680 (step 7).
- Review-finding issues from this stream: #722 (PR 717), #723 (PR 718), #715 (PR 712), #711 (PR 710), #698 (PR 697) — fixer bot or separate sessions.
- Parser findings #671 and #673 — their own plans in `docs/plans/`.
- PR #726 is an Entire "shadow" draft PR backing a trail — never merge or close it by hand.
- Search test set (PR #720) and image-embed worker (PR #728) — unrelated streams.

## 5. Current state of the code and data

Code on `origin/main` `4409e2d3` (worktree used for this plan is 3 commits behind: lacks #717, #721, one shared-db sync; line numbers below are from `origin/main`):
- `apps/worker/src/handlers/ai-tag-parallel.ts:1-20`: `parallelTagRun` accepts `discover: true` with no explicit IDs (PR #717) and validates `concurrency` 2–32, 1–4 OpenRouter models, `force`.
- `apps/worker/src/handlers/ai-tagging.ts:1113-1119` `handleBulkAiTag(opState, tagAll, deps, requireAssetIds, requireParallel)`; `operation-loop.ts:903-904` dispatches `ai-tag-parallel` with **`requireAssetIds = true`**; `ai-tagging.ts:1191-1193` fails any op without `params.asset_ids` **before** the `discover` path is reached. That is the bug. PR #717 added the discover paging (`ai-tagging.ts:1139` sets `BATCH_SIZE = concurrency`; `1256-1262` keyset `get_ai_tag_candidates` with `p_mode: "all"`; `~1300` passes `parallelModel(...)` and the failover list) but left the guard.
- PR #727 (branch `claude/full-run-discover-fix`) changes line 1191 to `if (requireAssetIds && !parallel?.discover && (!assetIds || assetIds.length === 0))` and adds test `a whole-library run tags a candidate page instead of demanding asset IDs` in `ai-tagging.test.ts`. Status at 4:47 PM EST: open, mergeable, `lint-test-build` running.
- `operation-loop.ts:1221-1229` (PR #717): a running `ai-tag-parallel` is set to `queued` with `queue_position = MAX_SAFE_INTEGER` when `rebuild-style-groups` is queued, keeping its cursor; test `a running tagging run steps aside for queued nightly grouping, keeping its cursor` in `apps/worker/src/parallel-tag-conflicts.test.ts`.
- Failover (PR #710, in worktree at `ai-tagging.ts:1015-1020, 1092-1103`): a parallel run keeps its assigned model and uses the saved backup on model-specific or outage errors; never on account faults.
- Finishing rules: `apps/worker/src/handlers/tag-finish.ts` (`GROUP_SHOT_CHARACTER_ID` line 7, paired sheet labels 153–155, `JUNK_TAG`, customer-season collapse, licensing names always tagged, named characters as search tags) and `ai-tagging-shared.ts` `addNamedCharacters` (PR #721: exact-name match against the licensor's `core.character` records).
- Scope RPC: `get_ai_tag_candidates` (shared-db migration `20260714180000_ai_tagging_keyset_candidates.sql`): `is_deleted = false and thumbnail_url is not null`, keyset by tier/id; `p_mode 'all'` with `force: true` re-tags already-tagged files.

Live data (4:46 PM EST Nov 4):
- `AI_TAG_PARALLEL_RUN = {"force":true,"models":["z-ai/glm-5.3-flash"],"run_id":"full-run-680-20261104","discover":true,"concurrency":8}` (set 4:43:47 PM EST).
- `BULK_OPERATIONS["ai-tag-parallel"]`: `status failed`, `run_id full-run-680-20261104`, `cursor 0`, `params {}`, `requested_by issue-680-full-run`, `progress.total 117535`, all counters 0.
- `AI_TASK_MODELS`: `vision_tagging z-ai/glm-5.3-flash`, `vision_tagging_fallback openai/gpt-6-luna`, provider pin empty.
- `assets`: 113,063 with `ai_tagged_at`; 135,514 not deleted with a thumbnail (includes files outside the two skipped groups and other exclusions the RPC applies — use `progress.total`, not this, as the denominator); 61 tagged in the last 24 h, last at 4:39 PM EST (the 2-file failover proof).
- Undo copies that must survive until the run proves out: `admin_config.NULL_DESIGNER_CLEANUP_BACKUP_2026_11_04`, `admin_config.DESIGNER_SPELLING_CLEANUP_BACKUP_2026_11_04`, table `asset_designer_sheet_backup`, `archive.*_20261102` (removed links), `admin_config.ALBERT_TECHNICAL_REMOVAL_BACKUP_2026_11_04`.
- Review page for Albert: https://claude.ai/artifact/PLsjGCL8kMPu12NKdrqwdT (private until shared).

## 6. Key findings

- The failure is deterministic and cheap: no file was touched, no spend. Re-queueing before the fix is on the worker will fail the same way within a second.
- Throughput expectation: GLM averaged 22 s per file in the bake-off at concurrency 8 → ~0.36 files/s ≈ 31,000/day ≈ 3.8 days for 117,535; earlier handoffs said 6.5–6.9 days from a slower sample. Plan for 4–7 days; alarm only if an hourly count falls under 400 for two consecutive hours outside the 1:00 AM EST grouping window. **Measured at the real start: about 10 files a minute (600/h), so about 8 days, not 4–7** (#680, 5:00 PM EST Nov 4).
- Cost: bake-off measured $0.00032/file on GLM → ~$38; the standing estimate is $87. Backup Luna is $0.00161/file; if every file fell to Luna it would be ~$192 — a sign of a GLM outage worth stopping for.
- Quality baseline to compare against: 163-file picture audit — 82.8% character-correct after PR #721, junk tags 9 of 7,400, 0 runs missing licensor/property tags (issue comment 4:26 PM EST Nov 4). Known residual errors: Jellyfish, Pico, House The Encanto, Loki, Trace-E, group-shot misses.
- Grouping: nightly `rebuild-style-groups` is queued around 1:00 AM EST; the run yields and resumes from its cursor (PR #717). Expect a dip in that hour, not a stall.
- `force: true` means every in-scope file is re-tagged, including the 113,063 already tagged — intended (one consistent rule set). A follow-up pass with `force` absent skips completed same-model files, which is how leftovers are retried without paying twice.
- Over 8 concurrent calls overloaded saves in an earlier trial; concurrency 8 is the ceiling.

## 7. Approaches considered and rejected

- Passing 117,535 explicit asset IDs in `params.asset_ids` — rejected in PR #717: the operations record is polled every second and would bloat.
- Letting the run hold nightly grouping — rejected (PR #717 yield); grouping must not wait days.
- Muse as primary — rejected by Albert ("GLM is better than Muse in every case").
- Gemini 3.5 Flash Lite as backup — same accuracy as Luna at ~3× the cost; Luna chosen (issue comment 4:40 PM EST).
- Starting the run from a UI button — the admin UI has no "discover" control; the run is started by writing the setting and the operation row through the RPC, exactly as the 4:43 PM session did.
- Skipping already-tagged files to save money — rejected: old tags come from older prompts and models; the point is one rule set.

## 8. Design decisions

LOCKED: GLM primary, Luna backup; concurrency 8; `force: true`; `discover: true`; one run id `full-run-680-20261104` (keep it so the op and setting match); disable the setting with `{"enabled":false}` afterwards (a `null` upsert is unsupported — MODEL_RULES line 38); no new issue for leftovers — everything on #680.
OPEN: whether to retry leftovers once or twice (criterion: retry once with `force` absent; a second time only if the first retry succeeded on > 50% of leftovers); when to release the undo backups (criterion: after the live sample passes and Albert has seen the page).

## 9. The plan

**Step 0 — re-read live state (read-only).** Supabase MCP (confirm URL contains `qsllyeztdwjgirsysgai`): the four `admin_config` keys in section 5, `WORKER_HEARTBEAT.sha`, `gh pr view 727 --json state,mergedAt`. Also confirm Albert's go per section 0. Gate: you can state, with timestamps in EST, whether the op is still `failed`, whether #727 is merged, and whether the worker runs a SHA at or after it. Do not continue past step 1 without the owner go recorded.

**Step 1 — land the guard fix.** If #727 is still open: `bin/ai-pr-wait 727` in the background; when green, merge it (the AI merges; no reviewer gate; `lint-test-build` must pass — reviews are advisory). If CI fails, fix on that branch (the change is one condition at `ai-tagging.ts:1191` plus its test); do not open a competing PR. Then wait for Railway: `WORKER_HEARTBEAT.sha` must equal the merge commit (or a later `main` commit) — usually within 10 minutes. Gate: `WORKER_HEARTBEAT.sha` contains the fix (verify with `git merge-base --is-ancestor <727 merge sha> <heartbeat sha>`), status `running`.

**Step 2 — re-queue the run.** Keep `AI_TAG_PARALLEL_RUN` as it is (run id must match). Write the op through the RPC from the live failed row, changing only: `status: "queued"`, `cursor: 0`, `error: null`, `interruption_reason_code: null`, `progress` counters 0 (keep `total`), `updated_at` now, `queue_position: 1`, `started_at` now; keep `run_id`, `requested_by`, `params: {}`. SQL shape: `select public.update_bulk_operation('ai-tag-parallel', <jsonb>)` — this is an application-data write to `admin_config`, not a schema change, so it is in the app session's authority (declare class `production` with `ai-task-gates` first). Never do this during the 1:00 AM EST grouping window. Gate: within 2 minutes `status = running`, `progress.tagged` rising, and `select count(*) from assets where ai_tagged_at > <queue time>` > 0; `ai_model = 'z-ai/glm-5.3-flash'` on those rows.

**Step 3 — first-hour check (about 60 minutes after step 2).** Read-only queries: files tagged since start (expect about 600/h, as measured), `progress.failed` and `failure_samples`, count of `ai_model = 'openai/gpt-6-luna'` since start (expect near 0; > 10% means GLM trouble — read `failure_samples`, check OpenRouter status, do not change models), `visual_analysis_unavailable`. Quality: pick 20 files tagged in that hour across licensors, view their thumbnails, check tags, description and characters against the section 6 baseline; post the numbers on #680. Also confirm on run-tagged files: PR #721's named-character links appear (not yet re-checked on live files as of 4:41 PM EST), and no file has Albert as technical designer (PR #732). Gate: throughput ≥ 400/h, failures < 2%, sample has no junk tags and licensor/property tags present on every licensed file.

**Step 4 — daily checks until done.** Once per day (not a polling loop; a scheduled check or a fresh session each day): tagged count, failed count, backup share, cursor advancing, and after 1:00 AM EST that the op went `queued` then back to `running` (the yield; PR #717 is not yet seen live, so the first night's result is its proof, posted on #680). If the op shows `failed` or `interrupted`: read `error`/`interruption_reason_code`; a transport or statement-timeout failure is re-queued from its `last_successful_cursor` (same RPC, keep cursor); a code failure gets a PR first. Thirty minutes with no cursor movement outside the grouping window is broken — diagnose from worker logs (Railway connector has failed on hetz; use `WORKER_HEARTBEAT` and the op's `last_stage`, `failure_samples`), never just wait again. Gate per day: numbers posted on #680 with EST times.

**Step 5 — completion.** When `status = completed`: (a) count in-scope files whose `ai_tagged_at` is older than the run start — these are leftovers; (b) if > 0, set `AI_TAG_PARALLEL_RUN` to the same JSON **without** `force` and re-queue the op with a new `run_id` (`full-run-680-retry-1`) in both places; completed same-model files are skipped, so only leftovers cost money; (c) set `AI_TAG_PARALLEL_RUN` to `{"enabled":false}`; (d) live sample: re-score the 163-file audit set and the 59 review-page files from live data (characters right / missing / wrong, junk tags, paired labels, asset-type words), update the review page, compare with the section 6 baseline; (e) confirm search: three searches on dam.designflow.app a tester would run (a character, a customer, a product word) return tagged results. Gate: leftovers ≤ 0.5% or each remaining one has a recorded reason (no thumbnail, refused content); setting disabled; sample numbers posted; `- [ ] live proof` on #680 ticked by the person who viewed the files.

**Step 6 — closeout.** Comment on #680 with totals, cost (OpenRouter dashboard figure), duration, sample result, leftovers, and that the setting is disabled — signed `$AI_GH_SIGNATURE`. Decide the undo backups (section 8 OPEN) and record it. Update this plan's STATUS, the handoff linked at the top, and `docs/MODEL_RULES.md` only if the run taught something new about the lane. Close #680 only when every "NOT in this plan" item has its own issue or a line on #680 saying who owns it; otherwise leave #680 open with those as the remaining checklist.

**Step 7 — account for what #680 still tracks.** #680's body says it also tracks the rescan's follow-ups, and they are not part of the paid run, so each gets one line on #680 naming its owner and state: the 634 failed rescan files (requeue, without pressing start); missing character records and the Asha and Lucky aliases (`popcre/shared-db`; say whether files already tagged need another pass, which is a spending question for Albert); `HXP83WBNE01` filed under Warner Bros though it shows Michael Myers; Albert's answers on the 21 names; the Group Shot under-count; Fish still offered as a character; sheets scanned after the one-time `pdf_sheet` style-tag load. Gate: every line has an owner, or the item has its own issue; #680 closes only then (run proof alone does not clear these).

## 10. Tests required

- PR #727's test `a whole-library run tags a candidate page instead of demanding asset IDs` (`apps/worker/src/handlers/ai-tagging.test.ts`) must pass; existing `parallel operation refuses to infer without its matching configuration` (line 272) and `required asset scope fails closed before querying the whole library` (line 210) must stay green — they protect the non-discover paths.
- `apps/worker/src/parallel-tag-conflicts.test.ts` yield test must stay green.
- Worker suite: `npm ci --prefix apps/worker && npm run build --prefix apps/worker && npm run test --prefix apps/worker` (CI job). Root `npm run lint && npm run typecheck && npm run test` and `npm run build` also run in CI.
- No new tests unless a step-4 failure needs a code fix; then the fix carries a test named for the failure.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR for any code; never push to `main`; the AI merges; PopDAM has no reviewer gate; reviews are advisory. Sign GitHub posts with `$AI_GH_SIGNATURE`. Human-facing times in EST, computed from the clock.
- Production DB is read-only by default; the two writes here (`update_bulk_operation`, `AI_TAG_PARALLEL_RUN` upsert) are application data, declared with `ai-task-gates` class `production`. No schema changes in this repo; shared-db is claim-first via `shared-db-change`.
- Never start or re-queue during nightly grouping (1:00 AM EST). Heavy jobs slow search.
- Do not press any "start" on the PDF backfill; it clears rescan mode.
- Do not update the NAS agent or restart NAS containers as part of this plan.
- Concurrency stays 8. Do not change models mid-run; a run's assignment is by asset-id hash and must stay stable.
- Wait with `bin/ai-pr-wait <pr>` in the background; never a sleep loop; one probe per state change.
- Thirty minutes without progress is broken (reroute/diagnose, never report "still waiting" twice).
- Replies to Albert: his format, 120 words, business questions only — the only one is section 0.
- PR #717 merged before its CI finished once before (PR #691 broke main); wait for green.
- Keep private capture off; Entire is for public ai-devops tasks only — ignore PR #726.

## 12. Access and environment

- Machine hetz. `gh` as `u2giants`. Supabase MCP for `qsllyeztdwjgirsysgai` (confirm URL). Railway MCP failed to connect on hetz; worker state comes from `admin_config.WORKER_HEARTBEAT` and `BULK_OPERATIONS`.
- Secrets: 1Password vault `vibe_coding`; OpenRouter key item for spend lookup; PopDAM tester/admin logins are per-role items in that vault (see `docs/1password.md`, references `op://vibe_coding/<item>/<field>`). Never paste values.
- Worker runs locally with `npm ci --prefix apps/worker && npm run test --prefix apps/worker` (tests stub Supabase with `SUPABASE_URL=http://localhost`). No local worker run against production is needed for this plan.
- Review page artifact: https://claude.ai/artifact/PLsjGCL8kMPu12NKdrqwdT (update with the Artifact tool; read it first).

## 13. Definition of done, risks, open questions

Done when:
- [ ] Albert's go quoted on #680 (or confirmed already recorded).
- [ ] PR #727 merged, CI green, `WORKER_HEARTBEAT.sha` at/after it.
- [ ] Run completed; leftovers retried once; `AI_TAG_PARALLEL_RUN = {"enabled":false}`.
- [ ] Live sample scored and posted; review page updated; `- [ ] live proof` on #680 ticked.
- [ ] Cost and duration posted; undo-backup decision recorded; STATUS table, handoff, docs updated.

Risks and rollback: an OpenRouter outage takes both models down → files record as failed, retried by the no-force pass. A bad rule discovered mid-run (e.g. junk tags reappearing) → set the setting to `{"enabled":false}` (the op fails closed with "Parallel operation requires its exact-run model configuration"), fix with a PR, re-enable with the same run id and the op re-queued from `last_successful_cursor`. Old tags are replaced per file as it is tagged; there is no bulk undo of tags — the earlier `archive.*_20261102` backups cover removed character links only.

Open questions: none technical. The owner question is in section 0.

## Self-audit

1. Executable without questions? Yes — section 5 gives the exact live rows and code lines, section 9 gives each write's shape and gate, section 12 the access; the single non-technical question is isolated in section 0 with the exact wording and recommendation.
2. All background and rejected paths carried? Yes — sections 3, 6, 7 (explicit IDs, Muse, Gemini, UI start, skip-tagged), section 4's long out-of-scope list with owners, and the undo-backup inventory.
3. Goal clear enough for judgment calls? Yes — section 1 names the three things never to do (lose good tags, block grouping, pay twice without evidence), which decide every step-4/5 judgment.
