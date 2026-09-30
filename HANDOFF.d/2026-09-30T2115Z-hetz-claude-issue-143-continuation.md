---
issue: 143
status: BLOCKED
owner: claude/handoff-issue-143-0930
---

# PopDAM umbrella #143 — continuation (2026-09-30)

Supersedes and retires `HANDOFF.d/2026-09-24T0005Z-hetz-claude-issue-143-continuation.md`.
Every still-open obligation, decision and dead end from it is carried below; git
history keeps its full text. Plans that stay authoritative for later phases:
`plan_openrouter_batch_restart_recovery.md` (Steps 8-9, #92) and
`plan_style_group_scoped_ai_metadata.md` (Steps 8-10, #96). All times are EDT
(America/New_York) unless marked Z (UTC).

**Every implementing session:** when you finish a phase, re-read ALL downstream
steps in §6 below, plus plan_openrouter_batch_restart_recovery.md Steps 8-9 and
plan_style_group_scoped_ai_metadata.md Steps 8-10, **through the end of each plan**.
Report any drift, meaning anything you did or learned that changes a later step, on
the issue and in your own handoff.

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert in ONE message before starting work. Technical
approvals are never asked of him; an assigned AI reviewer gates them (owner ruling
2026-09-28, verbatim: "never ask a human to approve").

### Blocking
1. **Risk acceptance for the PopSG nightly-refresh database fix** (shared-db #3458;
   the reissued migration 20260930185929, PR #3847). Its automatic production run
   36767281228 stopped with "ENGINEER ACTION REQUIRED … access or permissions
   materially change; data may be lost; users interrupted". The "Shared-db
   structural work continuation" session already asked Albert (evidence: #3458
   comment 5918402322). *Recommendation:* accept, if that session's explanation
   shows the only change is the refresh function. It blocks #107 closing.
2. **Style Group pilot scorecard pass/fail** (#96, §6 step 4). This comes up only
   after file tagging runs. *Recommendation:* judge it against the 28-SKU aggregates
   when they are shown. It blocks the full rollout and #97 hybrid search.

### A wrong guess is recoverable
3. The 2026-09-23 choice that malformed batch answers go through JSON repair on the
   same model (never a different model) still stands. Albert may overrule it.

### Not part of this work, and nobody is on it
4. The Muse Spark 1.3 Contributor capacity support ticket with Meta (filed by
   Albert 2026-09-23; tracked as popcre/ai-devops#683). There is nothing to decide
   unless Meta replies.

### Already settled — do NOT re-ask
- 2026-09-30: Albert, in chat: "you're in 'bypass permissions' mode now. proceed".
  The two PDF job restarts were done under that.
- 2026-09-30: Albert opened the NAS docker-sudo window twice for bridge work. Both
  windows were closed by this session.
- 2026-09-28: never ask a human to approve; AI reviewers gate technical actions.
- 2026-09-23: #96 pilot on the 28 SKUs approved. #92 Gemini proof on asset
  `7f4d0404-9f3f-4ffa-8f5b-4be9295fe44e` approved. Muse Spark 1.3 Contributor is the
  ONLY model for Image Tagging, profiling and PDF text. Albert: "not interested in
  any other model."
- 2026-09-23: send only true database STRUCTURE to shared-db.
- Shared-db structural work is claim-first. Claim the exact objects on the issue and
  start; no orchestrator chat or marker is needed. The one exception: the
  merged-main preview step still needs the live orchestrator marker (see §4).
- 2026-09-20: the ColdLion credential cannot be rotated. Every LLM task stays
  selectable in Settings.

## 1. What this application is

PopDAM is POP Creations' internal digital asset manager for licensed artwork, at
https://dam.designflow.app. PopSG, the style-guide library at
https://sg.designflow.app, comes from the same repo, `u2giants/popdam3`
(canonical checkout `/worksp/popdam`; never edit it, use a worktree).
- **Frontend:** React/Vite, served on Coolify.
- **Supabase edge functions:** `supabase/functions/**`.
- **Railway worker** (`apps/worker`): AI tagging, profiling and embedding bulk ops.
  It redeploys on every push to `main`, including the automated
  `chore: sync shared-db` commits.
- **NAS bridge agent** (`apps/bridge-agent`): a Docker container `popdam-bridge` on
  Synology `edgesynology1` that scans the NAS and makes thumbnails.
- **Windows render agent** on edge-alien: PDF text extraction.
- **Database:** Supabase project `qsllyeztdwjgirsysgai` (Virginia). Its structure is
  owned by `popcre/shared-db` (local `/worksp/shared-db`).

**Bulk ops** live in `admin_config.BULK_OPERATIONS` (a JSON map of op key → state).
They are started through RPC `public.update_bulk_operation`, which admin-api
`update-bulk-op` calls.

## 2. What we set out to do (2026-09-30)

Albert asked to continue #143:
- recheck production alerts first;
- preserve the #92 WIP (commit 653cb150) and the #97 rejected worktree;
- do shared-db structural work claim-first ourselves;
- no #92 PR or deploy until every blocker is fixed and an exact-head review approves.

## 3. Current state — true at 2026-09-30 5:15 PM EDT

### Done today (verified)
- **Alert #167** (bridge heartbeat 8,447 minutes old): the bridge container was "Up"
  but hung, and had sent no heartbeat since Sep 24 2:29 PM. It was restarted at
  2:47 PM, and heartbeats resumed.
  - **PR #174** (merge `cea870f`, bridge **v1.16.14**) adds a heartbeat watchdog.
    If no successful heartbeat arrives for 10 minutes, the agent logs one diagnostic
    line and exits so Docker restarts it; a second hard-freeze guard does the same.
    The heartbeat can no longer block behind a hung NAS mount.
  - **4:50 PM:** the NAS was recreated on v1.16.14 with the json-file log driver
    (20m × 5, self-rotating), and the heartbeat was confirmed in the database. NAS
    backups: `/volume1/docker/popdam/docker-compose.yml.bak-20260930-167` and
    `previous-image-before-1.16.14.txt`. The sudo window is revoked and verified.
  - **PR #176** set the repo compose mount to the live `/volume1/mac`;
    `/volume1/nas-share` does not exist. It was merged with a failing test.
    **PR #177** (`be34ec00`) fixed that test; main CI is green.
  - #167 will auto-close on the next passing canary.
- **#97 semantic floor:** PR #173 (merge `cb7bbeb0`) is deployed (run 36767178665).
  - The search function reads `admin_config.SEARCH_MIN_SEMANTIC_SCORE` and passes
    it as `p_min_semantic_score`. Settings → AI Tagging has a "Semantic match floor"
    card.
  - SEARCH_MODE is still `keyword`, so there is no live effect yet. #97 has an
    unticked `- [ ] live proof`.
- **#107 PDF jobs:**
  - The DAM PDF backfill finished at 3:21 PM: 231 processed (213 extracted,
    16 failed, 2 skipped).
  - The PopSG style-guide PDF extraction (`admin_config.POPSG_PDF_BACKFILL`) is
    **running**: 1,880 of 4,347 at 5:15 PM, 0 refused. At this rate it finishes
    around **7:45 PM**.
  - PR #175 fixed the Windows agent not being told about the PopSG job: its key
    was missing from the heartbeat config list.
- **#92 branch** `codex/issue-92-direct-gemini-batch` in worktree
  `/worksp/popdam-issue92-gemini-batch`:
  - It was rebased onto main; its head is now
    **`b29d0cd1e369b2819fb25a60be5a2c35cb2bb79d`** (pushed).
  - Worker tests 261/261, tsc clean, frontend 440 passed / 1 skipped, build clean.
  - Preservation: tag `preserve/issue-92-wip-653cb150` (pushed) and local branch
    `backup/issue-92-86a2e8ec`. 653cb150 is also on
    `origin/codex/92-provider-refusal-classification`.
  - There is **NO review verdict** on b29d0cd1: every reviewer failed (see §4).
    No PR, merge or deploy.
- **shared-db #3543** (orchestrator work; it changes database structure): governed
  clear of a terminal `external_job` after lease expiry.
  - PR #3845 merged `b687b3dd`, migration **20260930193549**, claim #3844 (still open).
  - It has two exact-head APPROVEs.
  - **Not in production.**
- **shared-db #3418 and #3464** (orchestrator work) are LIVE in production:
  migrations 20260923040630 and 20260924183947.
- **shared-db #3457** (orchestrator work) is LIVE: `search_dam_documents` has
  `p_min_semantic_score`.
- **shared-db #3282** (orchestrator work) is LIVE (migration 20260923173715).
- **Reviewer failures logged** with `ai-reviewer-issue`: 20260930T191153Z-hetz-{grok,gemini,qwen,muse,deepseek}-*.
  - A separate session, "Repair ai-review reviewer pool on hetz", is repairing them.
  - DeepSeek works in `--code-only` mode (key store refreshed with
    `ai-deepseek-agent store-key`). It approved PRs #173, #174 and #175.

### Still true from before
- #96 pilot: **28/28 SKUs are group-profiled.** File tagging has NOT started. The
  reason: `ai-tag-groups`, `ai-tag-all` and two `ai-tag-single-*` op keys hold
  protected 2026-08-27 OpenRouter batch jobs (phase pending, provider_status failed).
  `update_bulk_operation` correctly refuses to overwrite them. Only #92's code (which
  fails terminal provider states once) finalizes them. **Never force-clear them.**
- #95 is externally blocked: the Exorcist property row is missing in curated Master
  Data, which is not structural.
- #153 (style-group reconciler drift alert) is open and not worked here. Its own
  text says to keep the clear/rebuild cycle and wait for a clean week.
- The #97 rejected experiment in `/tmp/popdam-issue97-score` is preserved. **Never
  ship it.**

## 4. What did NOT work (with why)

1. **Merged-main preview for shared-db changes from a non-orchestrator session.**
   `node scripts/manage-migration-author-lanes.mjs --prepare-preview-dispatch …`
   refuses with "REFUSED: matching live sole-orchestrator marker is required". It
   compares `ORCHESTRATOR_ROUTE_ID` with the live marker (#3832). Setting that
   variable yourself would be impersonating the orchestrator, so don't. Marker #3832
   names session `local_c2c4b8ff-e007-4b90-9326-e70e83c0ebcb`, which **no longer
   exists** (SendMessage: "session not found").
2. **Reissuing a skipped migration with a later timestamp** doesn't avoid the
   preview step. #3458 was reissued as 20260930185929 (PR #3847), previewed by
   the orchestrator lane, and then stopped at production for risk acceptance. The
   original 20260929040458 is now hard-blocked, so do not prepare it.
3. **gh 2.45** (`/usr/bin/gh` on hetz) lacks `--slurp`, so the lane tool fails.
   gh 2.102.0 is at `~/.local/opt/gh_2.102.0_linux_amd64/bin`; put it first on PATH.
   `gh issue view` cannot combine `--comments` with `--json`.
4. **Reviewers, 2026-09-30:**
   - Grok hit its 32-turn limit on the large #92 diff.
   - Gemini and Qwen are quarantined (live-qualification-required).
   - Muse is quarantined (provider-unhealthy; its pinned version, catalog and key
     store are missing on hetz).
   - DeepSeek refuses prose files. With `--code-only --paths-file` it works for
     small diffs but ran out of room on #92.
   - Earlier, `/usr/local/bin/ai-review-pool` was missing (exit 127). It is now
     symlinked to `/worksp/ai-devops/bin/ai-review-pool`.
5. **NAS docker without a sudo window:** `ahazan` needs a password, and it is not in
   1Password. `ssh edge1` does not resolve; use `edgesynology1` (100.107.131.35,
   key `~/.ssh/916-alien`). Albert must run
   `sudo sh /volume1/docker/popdam/ai-docker-sudo-enable.sh`. Check it printed
   `ENABLED` on edgesynology1; the first attempt today didn't take.
6. **The repo compose file is not the source of truth for the NAS mount.** Copying
   it blindly would have remounted `/volume1/nas-share`, which doesn't exist. Only
   the logging block was applied.
7. **A PDF restart subagent died on an API safety-filter error.** It was re-run on
   Sonnet and succeeded.
8. Carried from 2026-09-24:
   - Contributor 404s are not an endpoint problem; don't re-diagnose.
   - Pin the pilot by SKU, never by Style Group ID (the nightly rebuild recreates
     all IDs).
   - Retries alone trip the 10-minute stale guard.
   - Muse 1Password field: use `api key`, not `credential`.
   - OpenRouter's vision batch rejects images.
   - #97's `min_rank` filters blended rank, not semantic score.

## 5. Root causes and key findings

- **Bridge hang:** `docker top` showed node at 45% CPU for 6 days with no
  heartbeat. The Synology "db" log driver lost the evidence on restart, so the
  cause is unknown. v1.16.14 now makes a future hang self-heal and leaves logs.
  The watchdog is in `apps/bridge-agent` (see PR #174 for the exact files).
- **The NAS does not auto-update** to a new bridge image. It moves only when
  someone clicks "apply update" in PopDAM, which runs the self-updater (don't
  modify the self-updater), or by a manual `docker compose up -d` in a sudo window.
- **#3543 requires a #92 app change.** In
  `apps/worker/src/handlers/ai-tagging-batch-state.ts` (~L45), a stored `completed`
  job with no lease token is routed to a claim, and the database will never
  re-issue a receipt. `clearCompletedJobNow` in `operation-loop.ts` needs a receipt.
  After a crash, the worker must call the new receipt-less governed clear through
  `update_bulk_operation`. Conditions: lease expired, phase terminal, provider ID
  bound, no ambiguity markers, and an exact revision match. A repeat call returns
  `already_cleared`. Read PR #3845's SQL and test
  `supabase/tests/popdam_expired_lease_terminal_clear_contracts.sql` for the exact
  call shape.
- **Read-only production SQL:** POST `{"query": …}` to
  `https://api.supabase.com/v1/projects/qsllyeztdwjgirsysgai/database/query` with
  bearer `$(cat ~/.supabase/access-token)`.
  - Bridge health: `agent_registrations` where `agent_type='bridge'`.
  - Worker SHA: `admin_config.WORKER_HEARTBEAT.sha`.
- **Muse Contributor capacity** (ai-devops#683) is still unexplained.

## 6. Exact next steps

1. **Put §0 to Albert** in one message. *Done when* he has answered 0.1, or said
   he's handling it.
2. **PopSG PDF run.** After about 7:45 PM Sep 30, check `POPSG_PDF_BACKFILL`
   `status='completed'`. List the failed files and post their counts and reasons
   (no content) on #107. *Done when* it's completed and the evidence is on #107.
3. **Get #3543 and #3458 into production.**
   - If a live orchestrator marker appears, check with
     `node scripts/check-orchestrator-marker.mjs` in `/worksp/shared-db`. Then ask
     that session (ListAgents → SendMessage) to run the merged-main preview for
     #3543 / PR #3845.
   - For #3458, after Albert's risk acceptance, the automatic promotion continues.
   - If no orchestrator exists, #3543 stays `Blocked —`.
   - *Done when* 20260930193549 and 20260930185929 appear in production
     `supabase_migrations.schema_migrations`. Then release claim #3844.
4. **#92, once #3543 is live:**
   - Rebase `b29d0cd1` onto main and add the receipt-less expired-lease clear call
     (§5), with tests.
   - Run the worker and frontend tests.
   - Get an exact-head review (`ai-review <provider> diff-review --base origin/main
     --assert-head <sha> --implementer claude`) from a working reviewer until
     APPROVE. If DeepSeek runs out of room, split the review by path.
   - Open the PR, merge, and verify `WORKER_HEARTBEAT.sha`.
   - Check that the old 2026-08-27 stuck jobs are finalized.
   - Then the approved proof (plan Step 8):
     - prove both AI tagging lanes are idle;
     - select Direct Gemini Batch for Image Tagging;
     - wait more than 60 s;
     - submit asset `7f4d0404-…`;
     - restart the Railway worker once while the job is pending;
     - prove the same batch ID resumes with no second POST and is applied once;
     - restore `meta-direct/muse-spark-1.3-contributor` and wait more than 60 s.
   - *Done when* that evidence is on #92 and #92 closes. Plan Step 9 then finishes
     the Direct Gemini route.
5. **#96 file tagging, after #92 clears the stuck jobs:**
   - Resolve the 28 SKUs (listed on #96) to their current `style_groups.id`.
   - Check no op is running.
   - Start `ai-tag-groups` with `params.group_ids`.
   - *Done when* every non-deleted asset in those groups has `ai_tagged_at` after
     the run start.
   - Then the scorecard (plan_style_group_scoped_ai_metadata.md §9 Step 8), written
     to `verification/ai-tagging-scope/<UTC>/pilot-summary.md` with aggregates only.
     Albert records pass/fail (§0.2).
   - Then Steps 9-10: `refresh-group-metadata`, the full `ai-tag-group-profiles` +
     `ai-tag-all` rollout, and resuming `embed-dam-search` run
     `0e63843f-e8b1-4ce3-a921-321d7d8d6dcb` at cursor 4298 (never at zero).
6. **#97:** after #96 acceptance and the embedding, activate hybrid search as its
   own gated step. Set a floor, then run a live proof: weak semantic matches drop,
   keyword matches stay. Tick `- [ ] live proof` on #97.
7. **#107:** after #3458 is live, watch two clean nights *with library changes*.
   Then post the acceptance evidence. PR #172 (draft, `d81f7e99`) must be refreshed
   from main, reviewed and merged once the production function signature is
   verified (see #107's 2026-09-29 comment).
8. **#167:** confirm the canary auto-closed it after 1.16.14.
9. Close #143 and delete this file only when #92, #95, #96, #97 and #107 are closed
   or removed by an owner ruling.

## 7. Constraints and gotchas

- Replies to Albert:
  - 120 words at most, plain English.
  - A closing "Still open" block.
  - EDT times.
- Protected `main`: branch → PR → green checks → `gh pr merge --squash` (you merge).
  A docs-only PR may use `--admin`.
- Never merge with a failing check. #176 did, and it broke main CI.
- Every push to `main` redeploys the Railway worker and interrupts running ops.
  They auto-resume.
- The 10-minute worker stale guard.
- No migrations in this repo. Structure goes only through shared-db, claim-first.
- Never force-clear protected `external_job`s. Never switch AI models.
- Never persist images, prompts, keys or provider bodies in ops, logs, issues or
  commits.
- NAS docker sudo: one window per block of work, then revoke with
  `ai-docker-sudo-disable.sh` and verify it's closed. `scp` fails on the NAS; pipe
  files with `ssh … 'cat > file'` instead.
- Sign GitHub posts `Posted by Claude chat <session id> on hetz`.

## 8. Access and environment

- **hetz:** `gh` is authed (use gh 2.102 for the lane tool). `op` has a service
  account for vault `vibe_coding`.
- **Supabase:** CLI token in `~/.supabase/access-token`.
- **Tools:** `ai-review`, `ai-pr-wait`, `ai-task-gates`, `ai-blocker-watch` and
  `ai-reviewer-issue` are installed.
- **Broken here:** the Railway MCP, devops-mcp and synology-monitor MCP.
- **Muse key:** 1Password item `czggiabkpo7dt7ojep4btdvq5i`, field `api key`.
- **NAS:** `ssh edgesynology1` (user `ahazan`, key `~/.ssh/916-alien`). There is no
  sudo password in 1Password.

## 9. Open questions and risks (2026-09-30)

- Who restarts the shared-db orchestrator role? Marker #3832's session is gone,
  which blocks every merged-main preview, including #3543.
- The bridge hang's root cause is unknown. Watch the json-file logs for the
  watchdog's fatal line.
- The reviewer pool is degraded; the repair session's result is pending. A large
  #92 diff may need path-split reviews.
- `META_API_KEY` in Railway is still unverified as the same key as 1Password's.

## Part (b) — sub-agents this session

- **#3543 structural:** did PR #3845 (merged), fixed `/worksp/shared-db` origin to
  popcre, installed gh 2.102. Blocked at preview (§4.1). Changed no production data.
- **#3458 promotion:** claimed and released #3483. Found the reissue by the other
  session. No PR and no writes.
- **#97 floor:** PR #173 merged and deployed. Restored the `ai-review-pool` symlink
  and the DeepSeek key store.
- **#92 rebase:** head b29d0cd1; preservation tag. The review was blocked. No PR.
- **#107 PDF restarts (Sonnet rerun):** both jobs restarted after DeepSeek APPROVE;
  PR #175 merged.
- **Bridge watchdog:** PR #174 merged, image v1.16.14 published.
- **Spawned sessions:** "Repair ai-review reviewer pool on hetz" (running) and
  "Reconcile bridge compose mount drift" (produced #176; #177 fixed its test).

## Self-audit

1. **Can a newcomer pick up?** Yes. §1 covers the app, §3 the exact state with SHAs
   and counts, §6 ordered gated steps.
2. **Can they continue as well as I could?** Yes. §4 and §5 hold the preview/marker
   trap, the gh version, the compose drift, the reviewer states, the #3543 call
   requirement and the NAS access path.
3. **Is every detail present?** Yes. Goals (§2), constraints (§7), access (§8),
   risks (§9), and verification gates on each §6 step.
4. **Does §0 show every owner decision?** Yes. I walked §3-§9 and part (b). The
   #3458 risk acceptance (0.1) and the pilot scorecard (0.2) are the only business
   rulings; the malformed-answer choice is 0.3; the Meta ticket is 0.4. Technical
   blockers (the orchestrator, reviewers, NAS sudo) are listed as blocked, not asks.
