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

## Track 1 — Image-similarity product build-out (u2giants/popdam3 #486)

**Read `plan_image_similarity_upload_search.md` STATUS first.** Steps 0–2 done (schema live, whole-library vectors loaded). You are building Steps 3–7:

1. **Step 3 — GPU poller service** `apps/image-embed-worker/` per plan: pooler TLS TCP 5432, `dam_image_embed_login` (password in 1Password vault `vibe_coding`, item "dam_image_embed_login DB password (PopDAM image-embed worker, qsllyeztdwjgirsysgai)"; DSN user MUST be `dam_image_embed_login.qsllyeztdwjgirsysgai` — bare username fails with `no tenant identifier`), heartbeat every 30 s, query cadence 1 s/lease 30 s, index batch 32/lease 300 s, stamp read from `admin_config.IMAGE_SIM_EMBEDDING_MODEL` only, `config.py` defaults module, HF token not needed (models cached). **A working reference implementation already exists on edge-dev:** `D:\ai\siglip2-embed\image_embed_poller.py` (claim/heartbeat/complete/fail loop, border-crop, dual-tower embed, selftest — GPU-proven 2026-10-25). Port it; don't rewrite the math.
   - SSH: `ssh -i ~/.ssh/916-alien ahazan@100.75.135.31` (Windows). Batch/schtasks pattern for detached runs; `nvidia-smi` broken over RDP — use `torch.cuda.is_available()`.
2. **Step 4 — flip `IMAGE_EMBED_ENABLED` true** (admin_config) once the poller drains; incremental proof: new ingest searchable within ~5 s + embed time.
3. **Step 5 — edge function** `supabase/functions/image-similarity/` + UI (drop zone in LibraryTopBar, results card, `IMAGE_SIM_ENABLED` flag). Never call `dam.*` over PostgREST — public wrappers only.
4. **Step 6 — tunables** (floor/bands/weight/top_k/stamps pass-through).
5. **Step 7 — acceptance on production**: 20 real pairs incl. bordered + white-ground, calibrate cutoffs on fp16 scores, tick `- [ ] live proof` on #486.

**Known data gap:** 55 assets lack vectors because their thumbnail files are absent at Spaces (HTTP 403, spot-verified). Not this feature's bug; they self-heal via the delta recipe once thumbnails exist (enumerate missing → `stage_embeddings.py` → `write_staged.py`, both on edge-dev).

## Track 2 — shared-db queue hardening PR #4786 (secondary)

Fix: `awaitPreviewRehearsal` accepts a descendant-tip rehearsal success (deadlock class observed 2026-10-25). Branch `zcode/queue-descendant-rehearsal`, clean worktree `/worksp/shared-db/.wt-queue-rehearsal-fix`, evidence pair `.agent/work/4787/3` + issue #4787 (contract refs `db-contracts/4787/{1,2,3}`, gen 3 current), tests 37/0. Full instructions in PR comment 6408936877. Blocker when parked: PR Guards stopped auto-triggering on the branch (runner starvation); a push that touches a real file, or `gh workflow run "PR Guards" --ref <branch>` (contract job needs `agent_contract_pr_number=4786`), then Guarded Merge dispatch on the exact head. Not urgent — the live deadlock cleared.

## Track 3 — repo blocker file (any session, one minute)

`/worksp/popdam/.ai/deepseek-sessions/20261009-104446-2040840.usage.jsonl` (another session's raw transcript) trips the `never-open-raw-transcript-archives` gate on repo-wide checks. Owner session: delete or archive it. Do not read its contents.

## Machine/access facts

- This handoff was written on `hetz`. GPU work happens on `edge-dev` (Windows, RTX 3060 Ti). Read-only prod DB: 1Password "Supabase DB Password - shared POP database", pooler `aws-1-us-east-1.pooler.supabase.com`, user `postgres.qsllyeztdwjgirsysgai`.
- All shared-db structure changes go through the canonical repo branch+PR lane (never app-side DDL). Times in EST.
- Evidence trail for tonight: #486 comment 6408936634 (live proof), runs 40263309536 (preview rehearsal) and 40264183001 (production apply, OWNER-OVERRIDE).

Posted by ZCode chat ${ZCODE_SESSION_ID:-unknown} on hetz
