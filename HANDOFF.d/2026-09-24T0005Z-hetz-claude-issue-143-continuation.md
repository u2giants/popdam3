---
issue: 143
status: BLOCKED
owner: claude/handoff-issue-143
---

# PopDAM umbrella #143 — continuation (pilot, Muse Contributor, #92, shared-db queue)

> **UPDATE 2026-09-24 00:20Z — read first.** The paused profiling op auto-resumed and finished: **28/28 SKUs are group-profiled.** File tagging (§6 step 3) **cannot start**. `update_bulk_operation` refuses to write `ai-tag-groups` ("legacy write … refused -- it would drop a protected external_job (phase=pending, provider_batch_id=batch-1787870422-7WbTdynaky0EnPVlcqI9)"). That key, and `ai-tag-all` plus two `ai-tag-single-*` keys, still hold 2026-08-27 OpenRouter batch jobs with `phase: pending` and `provider_status: failed`. Current main code can't finalize a failed provider batch. That is exactly #92 finding (2), fixed on branch `4db3c4bd`. So the pilot's file tagging now **depends on #92 shipping**, which depends on shared-db #3464 and #3418 reaching production, which needs an orchestrator (§0.1). Do not force-clear these jobs by hand.

Supersedes and retires `HANDOFF.d/2026-09-22T2124Z-hetz-codex-open-issues-closeout.md`
(every open obligation, decision and dead end from it is carried below; its commits
are on `main`). Sessions reading this: put the whole of §0 to Albert in ONE message
before starting work.

## 0. DECISIONS ONLY THE OWNER CAN MAKE

### Blocking

1. **Start a shared-db orchestrator.** As of 2026-09-23 ~23:50Z no orchestrator marker is
   open in `popcre/shared-db` (`node scripts/check-orchestrator-marker.mjs` printed
   "Open `orchestrator-marker` issues: 0"). Without one, nobody works the queued database
   items in §3.4. Five items across #92, #97 and #107 depend on it.
   *Recommendation:* Albert opens a session in `/worksp/shared-db` running the
   `shared-db-orchestrator` skill, or tells a session to start one. It blocks #92
   shipping, #97 hybrid search and #107 closure.
2. **Approve two PDF job restarts, once shared-db #3282 (the PDF claim fix) is live in
   production.** The actions are: restart the paused DAM PDF backfill (158 files left),
   then start the one PopSG style-guide PDF extraction. *Recommendation:* approve both
   together once #3282 is live. It blocks #107.
3. **#92 production proof** (already approved by Albert on 2026-09-23 for asset
   `7f4d0404-9f3f-4ffa-8f5b-4be9295fe44e`; see Already settled). It still needs #92
   shipped first. Nothing new to ask unless the asset changes.

### A wrong guess is recoverable

4. None open. The 2026-09-23 decision that malformed batch answers go through JSON repair
   on the same model (never a different model) was taken by the session as a reversible
   in-scope choice. Albert may overrule it.

### Not part of this work, and nobody is on it

5. **Muse Spark 1.3 Contributor capacity.** Albert filed a Meta/Muse support ticket on
   2026-09-23. The other POP apps (ai-devops reviewers, DesignFlow classification) need
   the fix prompt Albert was given (text in §5.3). *Recommendation:* Albert gives that
   prompt to each repo's session.
6. **edge-alien remote login and outage cause.** Albert was given a standalone diagnosis
   prompt (text in §5.4) to run in a separate session. Its SSH service is stopped, and
   the fix command was given to him. *Recommendation:* run that separate session; don't
   do it in #143.

### Already settled — do NOT re-ask

- 2026-09-23: Albert **authorized the narrow shared-db lease-reset request** (routed as
  popcre/shared-db#3418, merged as PR #3426).
- 2026-09-23: Albert **approved the #96 pilot on the 28 posted SKUs** (list in §3.1) and
  the **#92 Gemini proof on asset `7f4d0404-9f3f-4ffa-8f5b-4be9295fe44e`**. The full
  approved sequence (handoff 2026-09-22 §0) is: group-profile the pilot, then file-tag the
  same pilot, then human scorecard. After acceptance: `refresh-group-metadata`, the full
  `ai-tag-group-profiles` + `ai-tag-all` rollout, then resume `embed-dam-search` run
  `0e63843f-e8b1-4ce3-a921-321d7d8d6dcb` at cursor 4298. For #92: temporarily select
  Direct Gemini Batch for Image Tagging, run the proof asset across one controlled Railway
  worker restart, and restore Muse 1.3 Contributor straight after.
- 2026-09-23: **Muse Spark 1.3 Contributor is the only acceptable model** for Image
  Tagging, profiling and PDF text. Albert: "not interested in any other model." Never
  switch, fall back or add another model. Reviewers for *code review* may be non-Muse
  (Albert: "if you can't use muse contributor use another reviewer").
- 2026-09-23: Albert: **only send things to the shared-db orchestrator when 100% sure it
  is database STRUCTURE.** Everything filed so far changes a function signature or body.
- 2026-09-20 (from prior handoff): the ColdLion credential cannot be rotated by POP;
  don't reopen it. Every LLM task must stay selectable in Settings.
- 2026-09-23: Albert: "DON'T HOLD THINGS BACK." Keep every unblocked stream moving in
  parallel, and use helpers.

## 1. What this application is

PopDAM is POP Creations' internal digital asset manager for licensed artwork, at
`https://dam.designflow.app`. The same repo serves the PopSG style-guide library at
`https://sg.designflow.app`. The React/Vite frontend and Supabase edge functions are in
`u2giants/popdam3` (local `/worksp/popdam`). A persistent Node/TypeScript worker on
Railway (`apps/worker`) runs AI tagging, Style Group profiling, embedding and other bulk
operations. Railway redeploys the worker on every push to `main`, including the frequent
automated `chore: sync shared-db` commits. Production data lives in Supabase project
`qsllyeztdwjgirsysgai` (Virginia). Shared database structure is owned by
`popcre/shared-db` (local `/worksp/shared-db`, `gh` redirects `u2giants/shared-db` →
`popcre/shared-db`).

Bulk operations live in `admin_config` row key `BULK_OPERATIONS`, a JSON map of op key →
state. They are started by writing `{status:"running",cursor:0,params:{...}}` through RPC
`public.update_bulk_operation(p_op_key, p_op_state, p_only_if_status, p_expected_revision)`.
That is what admin-api `update-bulk-op` does, after checking cross-lane conflicts:
`supabase/functions/admin-api/index.ts` `handleUpdateBulkOp`. Group profiling honours
`params.group_ids` (`apps/worker/src/handlers/ai-style-group-profile.ts` ~L751). File
tagging honours `params.group_ids` / `params.asset_ids`
(`apps/worker/src/handlers/ai-tagging.ts` ~L680). The model selector is
`admin_config.AI_TASK_MODELS.vision_tagging`, currently
`meta-direct/muse-spark-1.3-contributor`, shown in **Settings → AI Models → Image
Tagging**.

## 2. What we set out to do, and why

Albert asked to continue umbrella #143 from the 2026-09-22 handoff. The order was:
recheck production alert #142 first, preserve the #92 WIP and the #97 rejected worktree,
get authorization for the #92 shared-db request, and then advance every child issue
without holding things back.

## 3. Current state — true at 2026-09-24 00:05Z

### 3.1 #96 pilot (Style Group profiling, then file tagging)

- The cohort is pinned by **SKU**, not Style Group ID. The nightly `rebuild-style-groups`
  (~06:54-08:06Z) recreates **all** style_groups rows with new UUIDs. The first 26 IDs
  posted on #96 were destroyed that way. The 28 approved SKUs are:
  `3DWC01JK 3FZ66VMNT02 AA866HDPET01 AAA66SSSS01 AAD57DFBNK02 AAH62WBNE03 BGQ55DYCP01 GF162WSEN01 HGP0FDYLS01 HSB88DYLS01 HSR68DYMM01 MDD4FMVSP02 MDX00CBCC02 MEZH1MVSP01 MEZH7DCJG01 MF162DYPN06 MFZ62SWSV01 MFZ96SWMD01 MQZ05DYDV02 MTP57DYMM05 VKP3SCBCC03 VS162WREG01 VSZ21VMPP02 VSZ36HPHP03 VSZ36NBJR02 VSZ4RNBHN01 VSZ66DYLS04 WDT4DDYLS01`
  (also posted on #96). Strata: single-asset, 10-60 assets, largest, tech-pack
  pdf+source, jpg/png photo, product+art_piece, 3+ characters, missing thumbnails.
  Selection was deterministic by `md5(id)`.
- **21 of 28 group-profiled** (`group_ai_description_source is not null`). The op
  `ai-tag-group-profiles` is **`interrupted`** ("paused by operator at session handoff").
  No other op is running. Re-running is idempotent: already-profiled groups are skipped by
  provenance (`defaultFetchGroups`, ~L284-292).
- File tagging (`ai-tag-groups` with the same group_ids) has **not started**. Nor has the
  human scorecard.
- Everything is blocked on Muse Contributor capacity (§5.1).

### 3.2 Code shipped to `main` this session (all green CI, deployed to Railway worker)

- PR #147 `01b7ca52`: removed `uniqueItems` from the Style Group profile schema. Meta
  rejects that keyword. The files are `supabase/functions/_shared/tag-style-group-contract.js`
  and `apps/worker/vendor/tag-style-group-contract.js`.
- PR #158 `cd9ff7ff`: `apps/worker/src/meta-model-api.ts` now calls
  `https://api.meta.ai/v1/responses`, not chat/completions. **This was NOT the fix** for
  the 404s; both endpoints behave the same. It is harmless and kept. It maps images to
  `input_image`, JSON schema to `text.format`, tools to flat function tools, and reserves
  16k extra output tokens for reasoning.
- PR #159 `5c6d4e43`: retries 404 `model_not_found` and 503 with delays of
  1, 2, 4, 8, 15 and 30 s, and names the outage when retries run out.
- PR #160 `b4b4294d`: caps in-flight Contributor calls at 2 per worker
  (`META_CONTRIBUTOR_CONCURRENCY`) and adds jitter.
- PR #161 `6072c6f2`: exhausted retries are terminal, so the structured-output method
  cascade stops, and the group page size drops from 10 to 4 to stay under the worker's
  10-minute stale guard (`operation-loop.ts` `STALE_RUN_MINUTES`).

### 3.3 #92 direct Gemini Batch — branch ready except for the review

- Worktree `/worksp/popdam-issue92-gemini-batch`, branch `codex/issue-92-direct-gemini-batch`,
  **head `4db3c4bd5accae4ad953ba106a9611483560b5ba` (pushed)**. It is rebased on main,
  with the original WIP `653cb150` kept underneath.
- Done: uses shared-db `reset_bulk_operation_submission_lease` on a definitive 400/422
  rejection; terminal provider states fail once; batch-only models are allowed only as the
  primary Image Tagging model; transient poll errors resume the same job ID; the cached
  catalog is kept alongside warnings; malformed batch answers go through same-model JSON
  repair (both Gemini and OpenRouter batch paths); a missing RPC (PGRST202) fails visibly as
  `reset_contract_unavailable`; plus about 25 other review fixes.
- Evidence: worker `# pass 222 # fail 0`, tsc clean, settings `Tests 18 passed (18)`,
  frontend build passed, diff/secret scan clean.
- Last Codex review (`ai-codex-review diff-review --base origin/main`, round 13):
  **`REJECT`**. Its one finding: no governed release for "never submitted" failures or for
  401/402/403/429 refusals. That is filed as **shared-db #3464**.
- **No PR, merge or deploy.** Don't open one until #3464 is merged **and live in
  production**, #3418's function is live in production, and an exact-head review returns
  APPROVE.

### 3.4 shared-db queue (all confirmed STRUCTURE; nothing moves without an orchestrator)

| Issue | What | State 2026-09-23 | Blocks | BlockerWatch |
|---|---|---|---|---|
| popcre/shared-db#3418 | `reset_bulk_operation_submission_lease` (migration `20260923040630_…`) | PR #3426 **merged** 17:55Z; **not in prod** (`schema_migrations` lacks `20260923040630`) | #92 ship | registered for popdam3#92 |
| popcre/shared-db#3464 | widen that reset to `not_submitted` + 401/402/403/429 | open, not started | #92 review APPROVE | registered for popdam3#92 |
| popcre/shared-db#3457 | `search_dam_documents` optional `p_min_semantic_score` (semantic leg only, before blending) | open | #97 hybrid activation | registered for popdam3#97 |
| popcre/shared-db#3458 | `refresh_style_guide_matviews` times out on nights with library changes | open (scope block format fixed by this session) | #107 nightly gate | not registered |
| popcre/shared-db#3282 / PR #3301 | PDF claim fix | merged; auto production step **refused for engineer sign-off** | #107 PDF drain | not registered |

Check them with `ai-blocker-watch list`. Two BlockerWatch rows point at this session
(8c95a983); after a fresh start they may need re-registering from the new session.

### 3.5 Other child issues

- **#142** (canary: windows-render heartbeat stale): **CLOSED** automatically when the
  canary passed at 2026-09-23T01:11Z, after Albert brought edge-alien back online. Cause
  unknown; that work is in the separate edge-alien session (§5.4).
- **#141**: closed by another session (stale bridge container on edgesynology2).
- **#107**: frontend is live. The remaining gates are the shared-db items #3282 and #3458
  (§3.4), the two PDF job restarts (§0.2), and then two clean nights *with library
  changes*. No app code is needed.
- **#97**: the embedding run `0e63843f-…` resumes at cursor 4298 only after #96
  acceptance. The semantic floor waits on #3457. The rejected experiment in
  `/tmp/popdam-issue97-score` (branch `codex/issue-97-search-score`, 4 uncommitted files)
  is **preserved untouched**. Never ship it.
- **#95**: still externally blocked. The canonical Exorcist property row is absent from
  curated Master Data, which is not structural. Nothing done this session.

## 4. Everything that did NOT work

1. **"Contributor needs the Responses API"** (#158). One `/v1/responses` call succeeded
   right after chat 404s, so I concluded chat/completions was the problem. Later,
   responses 404'd too, and chat succeeded again. Both endpoints flap. Don't re-diagnose
   the endpoint.
2. **Picking the pilot by Style Group ID.** The nightly rebuild recreates every group with
   new IDs, so approvals and params must use **SKU**, resolved to IDs right before the run.
3. **Retries alone.** With 5-120 s backoff, pages exceeded the 10-minute stale guard and
   the op was marked stale (20:06Z). With short retries and a 2-in-flight cap, some passes
   still auto-stopped ("Last 20 failures share the same error: … 404 model_not_found").
4. **"It's only burst concurrency."** 12 parallel calls gave 3×200 and 9×404, which
   suggested a concurrency cap. But at ~21:15Z, with PopDAM idle, 8 sequential calls 3 s
   apart **all** returned 404, while 1.2-contributor and 1.3 standard returned 8/8 200.
   So there is also a sustained cap or window.
5. **1Password as the cause.** Ruled out. A bad or missing key returns 401
   `invalid_api_key`, as the item's wrong field `credential` does. The right field is
   `api key`. One key read once produced both 200s and 404s.
6. **Reading the 1Password item's first concealed field.** The item "Meta ai Muse Spark
   API Key" has a `credential` field that returns 401. Use the field **`api key`**.
7. **Plain `ssh edge-alien` from hetz.** MagicDNS doesn't resolve on hetz; port 22 timed
   out because sshd is stopped. Use `100.65.60.70`.
8. Carried from the 2026-09-22 handoff, still true:
   - OpenRouter's only vision batch route rejects images.
   - A masked admin-config key is not a usable key.
   - Reviews must run against the exact current base.
   - The #97 `min_rank` app-only threshold is wrong: it filters blended rank.

## 5. Root causes and key findings

### 5.1 Muse Spark 1.3 Contributor 404s (tracked popcre/ai-devops#683)

- The model is listed by `GET /v1/models` and `GET /v1/models/muse-spark-1.3-contributor`.
- Failing calls return **instantly**, with body
  `{"error":{"code":"model_not_found","message":"The requested model was not found.",…}}`
  (sometimes 503), and **no `x-ratelimit-*` headers**. Successful calls carry
  `x-ratelimit-limit-requests: 150`, `x-ratelimit-limit-tokens: 3000000`.
- `muse-spark-1.2-contributor` and `muse-spark-1.3` never failed in any test.
- Meta docs (dev.meta.ai/docs/pricing-rate-limits) say limits are **per team, not per
  key**: Contributor 100 RPM / 3M TPM, and overflow should be a 429. dev.meta.ai
  error-handling says to retry 503 when the "registry lookup was inconclusive". Third-party
  coverage describes Contributor usage "capped by tokens in a rolling 5-hour window".
- Leading hypothesis: a team-wide Contributor cap shared by all POP apps, reported
  wrongly as 404. Albert has a support ticket open. The evidence timeline is posted on
  ai-devops#683.
- Probe command, with the key via `op run` (never print it). Env file line:
  `K=op://vibe_coding/czggiabkpo7dt7ojep4btdvq5i/api key`. Then
  `op run --env-file=<file> -- bash -c 'curl -s -o /dev/null -w "%{http_code}" https://api.meta.ai/v1/chat/completions -H "Authorization: Bearer $K" -H "Content-Type: application/json" -d "{\"model\":\"muse-spark-1.3-contributor\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":100,\"reasoning_effort\":\"low\"}"'`
- The worker gets its key from Railway env `META_API_KEY`. It is presumed to be the same
  key; that isn't proven, since Railway isn't readable from here.

### 5.2 Style Group IDs are not stable

`rebuild-style-groups` (nightly) recreates all ~10,901 rows. `select min(created_at)` was
2026-09-23 02:54 -04. Always pin by `sku` (unique among the 28, verified).

### 5.3 Prompt given to Albert for the other Muse repos

The text was sent as a file. Key points: keep Contributor; cap concurrent Contributor
calls at 2; treat 404 `model_not_found` and 503 as transient, with jittered retry
1-30 s; show a named error "Muse Contributor unavailable (Meta 404) — see
popcre/ai-devops#683"; add tests; comment results on ai-devops#683; the key is valid,
so no rotation. The reference implementation is popdam3 PR #160.

### 5.4 edge-alien (separate session; do not do it here)

sshd is installed and set Automatic, but **Stopped**. `sshd_config` has
`ListenAddress 100.65.60.70`, and the firewall rules already allow Tailscale. The
hypothesis: sshd starts before Tailscale has its IP and exits, which implies a reboot
around 2026-09-22 21:25Z. Albert was given this fix to run himself:
`sc.exe config sshd start= delayed-auto; sc.exe failure sshd reset= 86400 actions= restart/60000/restart/60000/restart/60000; Start-Service sshd`.

### 5.5 Read-only production SQL without the Supabase MCP

The MCP is unauthorized in these sessions; a separate task was started to fix its token
wiring. Working route: `TOKEN=$(cat ~/.supabase/access-token)`, then POST
`{"query": "..."}` to
`https://api.supabase.com/v1/projects/qsllyeztdwjgirsysgai/database/query`.
This route can also call `update_bulk_operation`, which is how this session started ops
after checking there were no running conflicts. Worker deploy SHA:
`admin_config` key `WORKER_HEARTBEAT` → `.sha`.

## 6. Exact next steps

1. Put §0 to Albert in one message. *Done when* he has answered 0.1 (orchestrator) or
   said he is handling it.
2. **Resume the pilot as soon as Contributor answers.** Probe (§5.1) until you get 200.
   Check no op is `running`/`queued`. Resolve the 28 SKUs to current IDs
   (`select id from style_groups where sku in (…)`). Write
   `{status:"running",cursor:0,params:{group_ids:[…]},started_at,updated_at,progress:{}}`
   to `ai-tag-group-profiles` via `update_bulk_operation`. Poll every 30 s. If it
   auto-stops on 404s, probe again and rerun. *Done when*
   `count(*) filter (where group_ai_description_source is not null)` over the 28 SKUs = 28.
3. **File-tag the same cohort.** Resolve the IDs again and start `ai-tag-groups` with the
   same `params.group_ids` (the same write pattern). *Done when* the op completes and
   every non-deleted asset in the 28 groups has `ai_tagged_at` after the run start.
4. **Human scorecard** (`plan_style_group_scoped_ai_metadata.md` §9 Step 8): 100% manual
   and identity preservation, zero sibling leakage. Write
   `verification/ai-tagging-scope/<UTC>/pilot-summary.md` with aggregates only and
   protected internal IDs. Show it to Albert for pass/fail. *Done when* Albert records
   pass. Then run the approved rollout (§0 Already settled), then resume `embed-dam-search`
   run `0e63843f-e8b1-4ce3-a921-321d7d8d6dcb` from cursor 4298 (don't restart it at zero).
5. **#92, when shared-db #3464 merges** (BlockerWatch resumes the owner): rebase `4db3c4bd`
   onto main, use `not_submitted` and 401/402/403/429 per the merged SQL, run all tests,
   and run `ai-codex-review diff-review --base origin/main` until APPROVE. Once #3418 and
   #3464 are **live in production**, open the PR, merge, and verify
   `WORKER_HEARTBEAT.sha` plus the frontend deploy. Then do the approved proof: prove both
   AI tagging lanes are idle; select Direct Gemini Batch for Image Tagging; wait more than
   60 s for the worker's model cache; submit asset `7f4d0404-…`; record the provider batch
   ID; restart the Railway worker while it's pending (Railway MCP is broken here, so find a
   working route or ask); prove the same ID is resumed with no second POST and applied
   exactly once; restore `meta-direct/muse-spark-1.3-contributor` and wait more than 60 s.
   *Done when* that artifact is on #92, and then #92 closes.
6. **#97, when shared-db #3457 merges:** add the Settings control and pass
   `p_min_semantic_score` into search. Hybrid activation stays separately gated. *Done
   when* it is shipped behind the setting with tests.
7. **#107**: after #3282 is live in production, get Albert's approval for §0.2, restart the
   jobs, and watch two clean nights once #3458 lands. *Done when* #107's acceptance
   evidence is posted.
8. Close umbrella #143 and delete this file only when #92, #95, #96, #97 and #107 are all
   closed or removed by an owner ruling.

**End-of-phase rule for every implementing session:** when you finish your phase,
re-read all downstream steps in this §6, `plan_openrouter_batch_restart_recovery.md`
(Step 8-9) and `plan_style_group_scoped_ai_metadata.md` (Steps 8-10), and report any
drift, meaning anything you did or learned that changes a later step.

## 7. Constraints and gotchas

- Albert's standing rules apply:
  - Replies to Albert stay under 150 words.
  - Production is read-only except for actions he named.
  - No PopDAM migrations; database structure goes only through shared-db, and only when
    it is definitely structure.
  - Muse Contributor is the only tagging model.
- Protected `main`: branch, then PR, then green checks, then `gh pr merge --squash`. You
  merge your own PRs.
- Every push to `main`, including `chore: sync shared-db`, redeploys the Railway worker.
  That interrupts running ops (status `interrupted`), and they auto-resume, sometimes
  appearing as "BUSY" to your own starter.
- 10-minute stale guard: a page that makes no progress for 10 minutes is killed.
- Never persist images, prompts, keys or provider bodies in ops, logs, issues or commits.
- Preserve `/worksp/popdam-issue92-gemini-batch` and `/tmp/popdam-issue97-score`.

## 8. Access and environment

- Machine: hetz. `gh` is authenticated for u2giants/popdam3 and popcre/shared-db.
  `op` uses a service account for vault `vibe_coding`.
- Muse key: item id `czggiabkpo7dt7ojep4btdvq5i`, field `api key`.
- Supabase CLI token at `~/.supabase/access-token`.
- Supabase MCP unauthorized; Railway MCP broken ("cmd not found"); devops-mcp and
  synology-monitor rejected their tokens.
- `ai-blocker-watch`, `ai-codex-review` and `ai-task-gates` are installed.
- Railway worker deploy is verified through `WORKER_HEARTBEAT.sha`.

## 9. Open questions and risks (dated 2026-09-23)

- Is the Contributor cap team-wide, token-window or Meta-side? Albert's ticket and
  ai-devops#683 are pending. If the reply names a specific limit, set
  `META_CONTRIBUTOR_CONCURRENCY` accordingly and adjust the retries.
- `META_API_KEY` in Railway is unverified as the same key.
- The shared-db production lane may need engineer sign-off for #3418 as well (it did for
  #3282).
- BlockerWatch rows are registered to session 8c95a983; confirm they still resume the
  right session.
- File tagging runs with up to 50 concurrent assets but only 2 Contributor slots. Large
  groups may approach the stale guard; watch the first batch.

## Sub-agent records (this session)

- **edge-alien probe** (read-only): proved Tailscale reachability, only port 445 open,
  22 timed out. Changed nothing.
- **#92 finisher**: produced `4db3c4bd` as above (13 Codex rounds). Made no PR or deploy.
  Its worktree is live and clean.
- **#107 gates**: shipped nothing (no app change needed). Filed shared-db #3458 and posted
  evidence on #107.
- **#97 semantic floor**: filed shared-db #3457 (object `function public.search_dam_documents`;
  the real name, not `dam_search_documents`), commented on #97, registered BlockerWatch.
  Touched no code.

## Self-audit

1. Can a newcomer pick up without a beat? **Yes.** §1 covers the app and mechanics, §3
   gives exact state with SHAs and counts, and §6 gives ordered steps with gates.
2. Can they continue as well as I could? **Yes.** §4 and §5 hold every dead end and
   finding: SKU pinning, the Muse evidence, the 1Password field, the stale guard, and
   the SQL route.
3. Is every relevant detail present? **Yes.** Goals are in §2, constraints in §7, access
   in §8, risks in §9, and verification gates in §6.
4. Does §0 alone show every owner decision? **Yes.** I walked §3-§9: orchestrator (0.1),
   PDF restarts (0.2), the #92 proof already approved (0.3), the Muse ticket and prompt
   (0.5), and edge-alien (0.6). The malformed-answer choice is in 0.4, and the settled
   rulings are listed.
