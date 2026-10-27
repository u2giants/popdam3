---
issue: 486
status: OPEN
owner: zcode/hetz-remaining-open-tracks
---

# HANDOFF — remaining open tracks after the 2026-10-25/26 DINOv3+SigLIP2 delivery

Written 2026-10-26 ~1:45 AM EDT on `hetz` by ZCode session. Three tracks, in priority order.

## 0. Owner decisions already made — do NOT re-ask

- **2026-10-25 ~8:05 PM EDT (Albert, verbatim):** "forget the review. this repo doesn't need reviews. proceed without one" — recorded on popcre/shared-db#4700. Reviewer gates may be skipped for this workstream's PRs; all CI checks still apply. (Production applies keep using the workflow's built-in OWNER-OVERRIDE confirmation, as run 40264183001 did.)
- Locked plan decisions stand: dual halfvec(768), blend 0.60/0.40, bands 0.98/0.94/0.90 with 90% shown first, tunable via admin_config, **no ScaleDown**, PopSG out.

## NEXT SESSION PICKUP — state as of 2026-10-26 8:45 PM EDT (wrap-up session)

All three tracks below are delivered EXCEPT the tail of Track 1 Step 4b, whose landing sequence was in flight when this session wrapped (background agent mid-sequence; if the session closed, it stopped). GitHub is authoritative — verify each step against it, not this file.

Delivered & verified (do NOT redo): Steps 3–7 live (PRs #503/#506 poller, #505 edge+UI, #508 acceptance; 40/40 acceptance; `- [x] live proof` on #486 comment 6420029612; screenshots `docs/verification/image-similarity-20261026/`); shared-db wrapper **PR #4819 MERGED 7:58 PM EDT** (merge `c5cd0cfdd`, head `c4911a6db`, migration `20261026155459`). The earlier 4427 merge-group ejections were proven (2026-10-26 9:04 PM EDT) to be a **pre-existing nondeterministic instrument flake on main** — byte-identical trees pass/fail across runners and PURE MAIN fails identically (diag runs 40423271893 PASS / 40424613625 FAIL / 40425757150 FAIL-ON-MAIN); NOT this migration's fault. A minimal instrument fix is landing as a separate test-only PR. Track 2 (#4786 superseded → #4799 merged, #4787 closed); Track 3 (blocker archived to `/worksp/.archive/popdam-transcript-blockers/2026-10-26/`); AGENTS.md durable rows via PR #521 (merged 8:25 PM EDT). Production apply of `20261026155459` was still PENDING at 9:04 PM EDT (preview rehearsal run 40430137513 in progress).

Resume in this order:
1. **Verify production apply** of migration `20261026155459` actually ran (shared-db Actions runs; or query prod — wrapper `public.image_embed_stale_assets` exists). If not applied, run the lane's post-merge path (`--prepare-preview-dispatch 4814` → merged-main rehearsal → production apply; renew claim #4818 if needed; `ai-task-gates check --before production`).
2. **popdam PR #510** (head `e66b1297`, backfill op + ImageEmbedCard, code green): if its five runs sit in `action_required`, re-run them (40360002731 / 40360002778 / 40360002736 / 40360002927 / 40360002838), wait green, merge — no reviewers (owner ruling 2026-10-25); CI applies. Railway auto-deploys the worker handler.
3. **Live backfill run**: trigger `rebuild-image-vectors` from Settings → ImageEmbedCard (or the worker op). Expect ≈ 55 stale (assets lacking vectors; their Spaces thumbnails are missing — pre-existing gap, not this feature's bug). The op ENQUEUES ONLY; the edge-dev GPU poller embeds. Watch `public.image_embed_status` drain to pending 0 / leased 0; spot-check the stale count dropped. Some of the 55 may fail on genuinely absent thumbnails (HTTP 403) — report the residual honestly.
4. **Evidence on #486**: comment with backfill numbers, #510 merge SHA, prod-apply run ID; signed `Posted by ZCode chat <id> on <machine>`; EDT times. Verify the plan STATUS Step 4/4b row landed via #510.
5. **Cleanup + retire**: remove worktrees `/worksp/shared-db/.wt-486-stale-assets` and `/worksp/popdam-486-step4b` if present; delete any `/tmp/popdam-sr-486.env`-style cred files; then delete this HANDOFF.d file via a small docs PR — the workstream is closed and #486 keeps the permanent record.

Poller facts: scheduled task `PopDAM-ImageEmbedWorker` on edge-dev (SSH `ssh -i ~/.ssh/916-alien ahazan@100.75.135.31`; `nvidia-smi` broken over RDP — use `torch.cuda.is_available()`). DB login `dam_image_embed_login.qsllyeztdwjgirsysgai` via pooler TLS 5432; password in 1Password vault `vibe_coding`, item "dam_image_embed_login DB password (PopDAM image-embed worker, qsllyeztdwjgirsysgai)".

## Track 1 — Image-similarity product build-out (u2giants/popdam3 #486)

**Read `plan_image_similarity_upload_search.md` STATUS first.** Steps 0–2 done (schema live, whole-library vectors loaded). You are building Steps 3–7:

1. **Step 3 — GPU poller service** `apps/image-embed-worker/` per plan: pooler TLS TCP 5432, `dam_image_embed_login` (password in 1Password vault `vibe_coding`, item "dam_image_embed_login DB password (PopDAM image-embed worker, qsllyeztdwjgirsysgai)"; DSN user MUST be `dam_image_embed_login.qsllyeztdwjgirsysgai` — bare username fails with `no tenant identifier`), heartbeat every 30 s, query cadence 1 s/lease 30 s, index batch 32/lease 300 s, stamp read from `admin_config.IMAGE_SIM_EMBEDDING_MODEL` only, `config.py` defaults module, HF token not needed (models cached). **A working reference implementation already exists on edge-dev:** `D:\ai\siglip2-embed\image_embed_poller.py` (claim/heartbeat/complete/fail loop, border-crop, dual-tower embed, selftest — GPU-proven 2026-10-25). Port it; don't rewrite the math.
   - SSH: `ssh -i ~/.ssh/916-alien ahazan@100.75.135.31` (Windows). Batch/schtasks pattern for detached runs; `nvidia-smi` broken over RDP — use `torch.cuda.is_available()`.
2. **Step 4 — flip `IMAGE_EMBED_ENABLED` true** (admin_config) once the poller drains; incremental proof: new ingest searchable within ~5 s + embed time.
3. **Step 5 — edge function** `supabase/functions/image-similarity/` + UI (drop zone in LibraryTopBar, results card, `IMAGE_SIM_ENABLED` flag). Never call `dam.*` over PostgREST — public wrappers only.
4. **Step 6 — tunables** (floor/bands/weight/top_k/stamps pass-through).
5. **Step 7 — acceptance on production**: 20 real pairs incl. bordered + white-ground, calibrate cutoffs on fp16 scores, tick `- [ ] live proof` on #486.

**Known data gap:** 55 assets lack vectors because their thumbnail files are absent at Spaces (HTTP 403, spot-verified). Not this feature's bug; they self-heal via the delta recipe once thumbnails exist (enumerate missing → `stage_embeddings.py` → `write_staged.py`, both on edge-dev).

**DONE 2026-10-26 ~11:15 AM EDT (owner session, subagent-verified):** Steps 3–7 delivered. Merged: #503 `c0861eb2` (GPU poller `apps/image-embed-worker/`), #506 `ceba6bdc` (bomb-test fix), #505 `068063bf` (edge fn + drop-zone UI + tunables), #508 `66055c26` (acceptance docs + STATUS). Poller live on edge-dev (`PopDAM-ImageEmbedWorker`), queue drained 44/0/0/0, heartbeats fresh. `IMAGE_EMBED_ENABLED` flipped ~10:53 AM, `IMAGE_SIM_ENABLED` ~11:15 AM; incremental self-match 2.4 s refresh, rank 1 at 100%. Acceptance on production fp16: 40/40 degraded-upload pairs found, all ≥ 90.2%; bands 0.98/0.94/0.90 confirmed. Live proof ticked on #486 (comment 6420029612); screenshots in `docs/verification/image-similarity-20261026/`. ONE PIECE REMAINS — Step 4b backfill op (`rebuild-image-vectors`): blocked on a canonical shared-db migration adding `public.image_embed_stale_assets(...)` SECURITY DEFINER wrapper, then the app-side PR; a follow-up subagent is executing exactly that (started 11:38 AM EDT). **State 3:55 PM EDT:** everything delivered and green — shared-db PR #4819 (head `c4911a6db`, migration `20261026155459`) green + Guard-Merge-authorized, popdam PR #510 (head `e66b1297`) green but held for the prod wrapper; blocked ONLY by migration queue order behind another session's open PR #4810 (edge-dev3, claim #4809; expiry never unlocks per anti-collision rules — no takeover). **State 9:04 PM EDT:** #4819 MERGED 7:58 PM EDT (merge `c5cd0cfdd`); the 4427 ejections were a pre-existing main-side instrument flake, not this change (fix landing separately). Remaining tail of Step 4b: see NEXT SESSION PICKUP above. Non-goals left as designed: 55 assets missing Spaces thumbnails (self-heal), cosmetic `hetz-probe` heartbeat row.

## Track 2 — shared-db queue hardening PR #4786 (secondary)

Fix: `awaitPreviewRehearsal` accepts a descendant-tip rehearsal success (deadlock class observed 2026-10-25). Branch `zcode/queue-descendant-rehearsal`, clean worktree `/worksp/shared-db/.wt-queue-rehearsal-fix`, evidence pair `.agent/work/4787/3` + issue #4787 (contract refs `db-contracts/4787/{1,2,3}`, gen 3 current), tests 37/0. Full instructions in PR comment 6408936877. Blocker when parked: PR Guards stopped auto-triggering on the branch (runner starvation); a push that touches a real file, or `gh workflow run "PR Guards" --ref <branch>` (contract job needs `agent_contract_pr_number=4786`), then Guarded Merge dispatch on the exact head. Not urgent — the live deadlock cleared.

**DONE 2026-10-26 10:55 AM EDT (owner session, subagent-verified):** #4786 closed as superseded — the identical fix had already landed via PR #4783 (2026-10-25 9:37 PM EDT, commit `972e3018f`); live proof on the exact deadlock: gate run 40259949636. The one unsuperseded piece (operational docs) landed as PR #4799, merged `ac1a1307`, 10:55 AM EDT. Issue #4787 closed/complete with live proof ticked. Branch tests 37/0 re-verified; worktree removed; canonical checkout clean; no production apply needed (documents-only). PR Guards starvation never recurred.

## Track 3 — repo blocker file (any session, one minute)

`/worksp/popdam/.ai/deepseek-sessions/20261009-104446-2040840.usage.jsonl` (another session's raw transcript) trips the `never-open-raw-transcript-archives` gate on repo-wide checks. Owner session: delete or archive it. Do not read its contents.

**DONE 2026-10-26 9:58 AM EDT (owner session):** archived (moved, not deleted — recoverable) to `/worksp/.archive/popdam-transcript-blockers/2026-10-26/`; no `.usage.jsonl` remains anywhere under `popdam/.ai`; contents never opened.

## Machine/access facts

- This handoff was written on `hetz`. GPU work happens on `edge-dev` (Windows, RTX 3060 Ti). Read-only prod DB: 1Password "Supabase DB Password - shared POP database", pooler `aws-1-us-east-1.pooler.supabase.com`, user `postgres.qsllyeztdwjgirsysgai`.
- All shared-db structure changes go through the canonical repo branch+PR lane (never app-side DDL). Times in EST.
- Evidence trail for tonight: #486 comment 6408936634 (live proof), runs 40263309536 (preview rehearsal) and 40264183001 (production apply, OWNER-OVERRIDE).

Posted by ZCode chat ${ZCODE_SESSION_ID:-unknown} on hetz
