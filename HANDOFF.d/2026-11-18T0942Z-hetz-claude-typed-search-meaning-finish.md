---
issue: 1037
status: OPEN
owner: claude/popdam-typed-search-meaning-0977e5
---

# Handoff — typed search by meaning: built and live except the meaning leg (switched off), Step 7 landing, Step 8 open

Written November 18, 2026, 4:45 AM EST by Claude on `hetz` (coordinator session that ran Steps 0–7 through sub-agents).
Plan (governs everything, read its STATUS table first): https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-1037-typed-search-meaning-matching.md
Issue (all evidence is posted there as comments): https://github.com/u2giants/popdam3/issues/1037
This file supersedes the predecessor https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-17T1834Z-hetz-claude-typed-search-meaning-matching.md — it is deleted in the same PR as this file (successor rule: its work is on `main`, its obligations are carried here and in the plan, its decisions are in plan §8).

## 0. Business decisions only the owner can make

None block the work. Carried forward, ask only when the condition is met, all in ONE message:

- **Rented graphics-card server** (plan §8 D10): ask only if the Step 8 AFTER score shows a measured shortfall a larger model would plausibly fix. Recommendation today: not needed.
- **Property names as a hard rule** (plan §13): should "aristocats frame" hide exact-word matches from other properties, like a named character does? Ask only if property cases still fail after Step 8. Recommendation: keep the current softer rule.

Already settled — do NOT re-ask: naming a character shows only that character (Nov 17); embed descriptions + folder tree with Qwen on our own cards (Nov 17); close wording by rule, never word lists (Nov 17); lap-desk-type matches are shown, ranked lower (Nov 17); 916-alien may share embedding work (Albert, Nov 17, 9:14 PM EST: "i now have 2 machines that can do embeddings: edge-dev and 916-alien. you can break up jobs between the 2").

## 1. What this application is

PopDAM (https://dam.designflow.app, repo `u2giants/popdam3`, public) is POP Creations' internal library of licensed product artwork, ~11.5k products ("style groups") and ~171k files. Typed search goes browser → edge function `dam-search-ai` → database function `public.search_dam_documents` on the shared Supabase project `qsllyeztdwjgirsysgai` (structure lives in `popcre/shared-db`, never in popdam3). Full description: plan §2.

## 2. What we set out to do, and why

Owner report Nov 17: "marie frame" missed framed Marie products and showed other characters. Goal (plan §1): a character + product-type search shows every such product first and no other character; close wording (frame/framed/frames) works by rule. Approach: plan Steps 0–8 — character rule, Qwen text-meaning vectors on edge-dev, a text-meaning leg in search, demoted picture guesses, word forms.

## 3. Current state (verified Nov 18, 2026, ~4:45 AM EST)

Live in production and verified:
- **Text model** Qwen/Qwen3-Embedding-0.6B @ `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`, 1024 dims (Step 0, #1037 comment 6960263298).
- **Test set** `admin_config.SEARCH_EVAL_SET_V1` version `2026-11-17-1037`, 137 cases; BEFORE run 44203103018 = PopDAM 128/137 (PR https://github.com/u2giants/popdam3/pull/1044). "marie frame" must-find is **7** products (lap desk + planter excluded), not the plan's 9.
- **Storage/queue** `dam.search_text_vectors`, `dam.search_text_embed_jobs`, RPCs `claim/upsert/mark_dam_search_text_embedding*`, `get_dam_search_text_embedding_status()` (service role is NOT granted it; read `dam.search_text_vectors` counts instead). shared-db https://github.com/popcre/shared-db/pull/6622.
- **Embedding**: 182,726 / 182,726 documents embedded at 12:48 AM EST Nov 18. Workers: edge-dev full worker (PR https://github.com/u2giants/popdam3/pull/1046) and **916-alien** text-only worker (PR https://github.com/u2giants/popdam3/pull/1058, scheduled task `PopDAM-TextEmbedWorker`, worker id `916-alien-rtx5060-text`, `ssh 916`). Both keep running for new/changed products.
- **Query side** `apps/text-embed` returns `text_vectors` (PRs https://github.com/u2giants/popdam3/pull/1042, https://github.com/u2giants/popdam3/pull/1047); adds ~210 ms typical.
- **Canary** alarms on a stalled text lane (https://github.com/u2giants/popdam3/pull/1053); health function made fast (shared-db https://github.com/popcre/shared-db/pull/6631, 63 s → <2 s). Canary green at 9:07 PM EST Nov 17 (run 44220821013).
- **Named-character rule (Step 2)** live: migrations `20261204003329`, `003530`, `003633` + edge reland https://github.com/u2giants/popdam3/pull/1057 (merge `58f73601`). Measurements (collisions, 20.9% untagged-but-named → text-name fallback ON, thin property index) on #1037; foreign tags on #680.
- **Text-meaning leg (Step 6)** shipped: migrations `20261204003632`, `20261218043336`, `20261218084103`; edge https://github.com/u2giants/popdam3/pull/1051. **`admin_config.SEARCH_TEXT_LEG_MODE` = `off`** (set by this session at ~3:50 AM EST; was on 3:40–3:50).

In progress:
- **Step 7 word forms**: shared-db https://github.com/popcre/shared-db/pull/6674, in merge queue at 4:42 AM EST, owned by a sub-agent of this session whose report will not reach a new session. Check its state directly.

Not started: Step 8 (AFTER score, screenshots, docs, close); alarm drill; refresh-on-edit live proof.

## 4. What did NOT work

- **One-shot queue backfill** of 183k rows (shared-db #6606): rolled back in production at the 2-minute statement limit. Reissued with in-claim seeding (#6622). Any migration touching big tables must be batched.
- **First named-character landing** (#1045): character searches returned "Search unavailable" (search 16 s, anchor 4–42 s vs 5 s limit; names not loaded within 1.5 s on cold isolates). Reverted (#1055), fixed set-based (003633), relanded (#1057).
- **Two migrations merged minutes apart** (003632 Step 6, 003633 Step 2) collided on md5 guards; two helpers built competing fixes (#6642 closed, #6643 chosen). Only one agent at a time may change `search_dam_documents`.
- **Scorecard with mode on** (run 44268209376, 3:35 AM EST): "success" but `report.json` engines `{}` — nothing scored. Live probe as viewer then: `marie frame` 503 after 72 s. With mode off: 9–13 s per search, `batmn` still 503. Root cause = DB load (§5), so the run proves nothing about the leg.
- **Canary check first version** called a 63 s health function → canary red ~1 h (fixed by #6631).
- Text-embed int8/bf16 speedups rejected (quality < 0.99 / slower).

## 5. Key findings

- **Shared DB overload by the DesignFlow HTS worker**: role `designflow_hts_alsand_worker` holds 16 concurrent active connections running `hts_rag.hts_rag_nearest_products` / `hts_rag_search_rulings` (statements up to 11 s), seen Nov 17 evening and still at 4:42 AM EST Nov 18. This made all PopDAM search slow/503 and broke the misspelling cases (spelling budget). Reported on https://github.com/popcre/designflow-backend/issues/278#issuecomment-6973908907. Not ours to change (DesignFlow PRs go to `develop`, never self-merged).
- With mode on and a quiet DB (3:26–3:40 AM EST), `marie frame` = 12 results, all Marie, all 7 must-find; lap desk/planter ranked 1st and 5th above four "Framed"-only products. Exact-word ~0.5 beats 0.6×text, so only Step 7 fixes the ordering.
- Text leg reads nearest 300 vectors (2000 cost 6.1 s cold).
- `get_dam_search_text_embedding_status()` is not callable from the SQL MCP; count `dam.search_text_vectors` instead.

## 6. Exact next steps

1. **Check Step 7** (`gh pr view 6674 -R popcre/shared-db`). If not merged, finish it per plan §9 Step 7 (load `shared-db-change`). Gate: migration listed in `supabase_migrations.schema_migrations` on production and the frame/framed/frames cases pass with mode off by direct read-only `search_dam_documents` calls (posted on #1037).
2. **Wait for a quiet DB**: `select count(*) from pg_stat_activity where usename='designflow_hts_alsand_worker' and state='active'` ≤ 4. Check #278 for a reply. If it stays loud past 9:00 AM EST, raise it on popcre/shared-db as a shared-resource issue. Gate: viewer probe of 4 searches each < 3 s, no 503.
3. **Mode on + AFTER score**: set `SEARCH_TEXT_LEG_MODE` to `on` (`update public.admin_config set value=to_jsonb('on'::text), updated_at=now() where key='SEARCH_TEXT_LEG_MODE'`), wait 2 min, run workflow `search-eval.yml` with label `after-1037` (no merges during it), download the artifact and confirm `engines` is non-empty. Gate: plan §13 — new cases pass, original 119 pass, p95 < 3 s. If anything regresses, set mode `off` immediately (instant, no deploy).
4. **Live proof**: as the viewer tester, screenshots of `marie frame` + two other Step 1 searches on https://dam.designflow.app, posted on #1037 with no product codes. Gate: all 7 framed Marie products before lap desk/planter, no other character.
5. **Alarm drill** (outside business hours, needs pending work): stop both text workers (edge-dev text lane via `--no-text-lane` restart only outside 1:00–3:30 AM EST; 916 task `PopDAM-TextEmbedWorker`) while documents are pending ≥ 120 min; canary must go red; restart. Gate: canary alert issue opened then auto-closed.
6. **Docs** (plan Step 8 list): SEARCH_PERFORMANCE.md (drop stale gte-small/384), SEARCH_EVAL.md, image-embed-worker README (two boxes), text-embed README, plan_vector_consolidation.md STATUS line, this plan's STATUS, docs/INDEX.md.
7. **Close**: 24 h unattended drain verified, delete this handoff file in the closing PR, close #1037 with live proof.

## 7. Constraints and gotchas

Public repo: no product codes/ids/thumbnails. DB structure only via popcre/shared-db (claim-first, automatic promotion; md5 guards; one agent per function). Branch + PR; AI merges its own popdam3 PRs. Every popdam3 merge redeploys all edge functions — never during a scorecard run. Statement limit 2 min in migrations; 8 s platform ceiling. Do not restart edge-dev 1:00–3:30 AM EST; restarting pauses picture-upload search. Times in EST. Plan §11 has the rest.

## 8. Access

`gh` as u2giants (popdam3) with popcre access; Supabase MCP `execute_sql` (confirm URL qsllyeztdwjgirsysgai). SSH: `ssh edge-dev`, `ssh 916` (config in `~/.ssh/ai-devops.conf`). 1Password vault `vibe_coding`: viewer tester item `mbspkosvp2rf25qxhqufipxqca` (username/password), publishable key item `3hhxwrljnaq2tykxi7hplq5ryi` field `SUPABASE_PUBLISHABLE_KEY` — use via `op_run`, never print.

## 9. Open questions and risks

- Is the text leg itself fast under normal load? Unproven until step 3 (Nov 18).
- Misspelling cases mis-088/mis-092 depend on backend speed; #1057 added a 4 s vocabulary budget.
- 916-alien is powered on intermittently; edge-dev alone keeps up with edits.
- Step 4 "edit a product, see it refresh" was proven only in preview rehearsal (no sanctioned live edit path).

## Self-audit (Nov 18, 2026)

1. Newcomer could continue: yes — §1 app, §3 state with URLs, §6 exact steps with gates, §8 access.
2. As effectively as me: yes — §4 dead ends and §5 findings carry everything this session learned (DB load, md5 collisions, scorecard false-success).
3. Every detail: yes — goal §2, state §3, failures §4, decisions plan §8 + §0, constraints §7, risks §9, verification gates §6.
4. Section 0 sweep: walked §1–§9; the only owner items are D10 and the property rule, both in §0; the HTS load is a technical item routed to its owner (#278), not an owner ask.
