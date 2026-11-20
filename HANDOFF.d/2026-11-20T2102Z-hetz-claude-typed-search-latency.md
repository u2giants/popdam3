---
issue: 1252
status: OPEN
owner: claude/1037-latency-handoff
---

# Handoff — typed search works but is too slow (5–18 s per search)

Written November 20, 2026, 4:05 PM EST by Claude on `hetz`, at wrap-up of the coordinator session that ran issue #1037 (typed search by meaning). Issue for this work: https://github.com/u2giants/popdam3/issues/1252

## 0. Business decisions only the owner can make

None — nothing here needs the owner. Carried forward from #1037, ask only if the condition is met, in ONE message:
- **Rented graphics-card server** (plan §8 D10): only if speed cannot be fixed in the database and the text-meaning model itself is the measured bottleneck. Recommendation: not needed.
- **Property names as a hard rule** (plan §13): only if property searches fail. Recommendation: keep the softer rule.

Already settled — do NOT re-ask: naming a character shows only that character (Nov 17); Qwen text meaning on our own cards (Nov 17); close wording by rule (Nov 17); lap-desk-type matches shown lower (Nov 17); 916-alien shares embedding work (Albert, Nov 17); latency fix runs in a new session (Albert, Nov 20, 4:02 PM EST: "fix it in a new session").

## 1. What this application is

PopDAM (https://dam.designflow.app, repo `u2giants/popdam3`, public) is POP Creations' internal library of licensed product artwork, ~11.5k products ("style groups"), ~171k files. Typed search: browser → edge function `dam-search-ai` (https://github.com/u2giants/popdam3/tree/main/supabase/functions/dam-search-ai) → database function `public.search_dam_documents` on shared Supabase project `qsllyeztdwjgirsysgai`. Database structure lives ONLY in `popcre/shared-db`. Plan for the search design: https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-1037-typed-search-meaning-matching.md

## 2. Goal

Make typed searches return in under 3 s for an ordinary signed-in user, without losing any of the #1037 relevance gains (scorecard must stay 137/137).

## 3. Current state (verified Nov 20, 2026, 4:00 PM EST)

- #1037 is CLOSED and complete: character rule, Qwen text-meaning leg (`admin_config.SEARCH_TEXT_LEG_MODE` = `on`), word forms (frame/framed/frames), 24 h drain check passed. Last clean scorecard: run https://github.com/u2giants/popdam3/actions/runs/44609405064 = 137/137, p95 4.0 s (Nov 19, 3:30 PM EST).
- Named-search timeout fix https://github.com/popcre/shared-db/pull/6873 (migration `20261225010417`) is in production (`supabase_migrations.schema_migrations`), promoted ~3:52 PM EST Nov 20. Its release record: https://github.com/popcre/shared-db/issues/6871 (open; boxes "promotion delivered" and "live proof" unticked — owned by a Codex session).
- **Live viewer timing, 4:00 PM EST, two rounds each** (style-group search, limit 50): `marie frame` 9.3 s / 5.1 s (10 results); `mickey mug` 6.7 s / 5.7 s (22); `stitch canvas` 18.3 s / 10.7 s (50). All HTTP 200. Posted: https://github.com/u2giants/popdam3/issues/1037#issuecomment-7050502009
- DB was quiet at the time: 3 active `designflow_hts_alsand_worker` connections (throttled to 4 on Nov 19 via https://github.com/popcre/shared-db/issues/6685, still open for its owner's live follow-through), nothing else heavy. So the slowness is ours.
- Nothing has been changed for latency yet.

## 4. What did NOT work / is already known

- Step 7 word forms raised candidate counts: bare `frame` went from 1,532 to 2,868 candidates and 0.3 s → 14–19 s under load (Nov 18). Suggested fix then: cap word-form-only candidates in `search_dam_documents` — not tried yet.
- Text leg reading 2000 nearest vectors cost 6.1 s cold; it reads 300 now (shared-db #6672).
- The canary warms `frame`, `canvas`, `print` searches (https://github.com/u2giants/popdam3/blob/main/scripts/production-canary.mjs#L43-L65): cold calls are 2–10× warm, so measure twice.
- int8/bf16 text-embed speedups were rejected (quality loss / slower).
- Migrations touching big tables time out at the 2-minute limit; batch them.

## 5. Key findings to start from

- Measure where the time goes first: edge function log timings (spelling, text-embed ~210 ms, anchor, RPC) vs direct `search_dam_documents` call time (read-only `execute_sql`, `EXPLAIN (ANALYZE, BUFFERS)`).
- `stitch canvas` (50 results) is slowest — large candidate sets are the likely cost.
- Only one agent at a time may change `search_dam_documents` (md5 guards; collisions happened before).

## 6. Exact next steps

1. Reproduce: sign in as the viewer tester and time the three searches twice (script shape: POST `/functions/v1/dam-search-ai` body `{action:"search",query,limit:50,offset:0,filters:{},min_rank:0,document_types:["style_group"]}`). Gate: same 5–18 s seen.
2. Break down time per stage (edge logs + direct RPC EXPLAIN). Gate: a written breakdown on #1252 naming the slowest stage.
3. Fix the slowest stage — database changes via `popcre/shared-db` (load `shared-db-change`, claim-first, automatic promotion), edge changes via popdam3 PR (AI merges). Gate: change live.
4. Re-time as viewer, two rounds. Gate: every search < 3 s both rounds.
5. Run workflow `search-eval.yml` (no merges during it). Gate: 137/137, p95 < 3 s.
6. Post proof on #1252, delete this handoff file in the closing PR, close #1252.

## 7. Constraints and gotchas

Public repo: no product codes/ids/thumbnails. DB structure only through popcre/shared-db. Every popdam3 merge redeploys all edge functions — never during a scorecard. Do not restart edge-dev 1:00–3:30 AM EST. Rollback for the text leg: set `SEARCH_TEXT_LEG_MODE` to `off` (instant). Times in EST.

## 8. Access

`gh` as u2giants with popcre access; Supabase MCP `execute_sql` (confirm project qsllyeztdwjgirsysgai). 1Password vault `vibe_coding` via `op_run` only: viewer tester item `mbspkosvp2rf25qxhqufipxqca` (username/password), publishable key item `3hhxwrljnaq2tykxi7hplq5ryi` field `SUPABASE_PUBLISHABLE_KEY`. SSH `edge-dev`, `916`.

## 9. Open questions and risks

- Whether the Nov 19 p95 4.0 s scorecard and today's 5–18 s differ because of #6873 or cache state — unknown (Nov 20).
- Other open items not owned here: shared-db #6871 live-proof boxes (Codex session); shared-db #6685 (HTS load, owner follow-through); handoff https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-19T1747Z-hetz-codex-typed-search-acceptance.md is a SUCCESSOR REVIEW candidate (its issue #1037 is closed; owner u2giants/Codex).

## Self-audit (Nov 20, 2026)

1. Newcomer could continue: yes — §1 app, §3 state, §6 steps with gates, §8 access.
2. As effectively as me: yes — §4 known causes, §5 where to look.
3. Every detail: yes — measurements, ids, links, constraints.
4. Section 0 sweep: no new owner items; carried-forward items listed.
