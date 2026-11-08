---
issue: 804
status: OPEN
owner: next #804 session (ZCode successor on hetz; previous owner was ZCode coordinator sess_9becfd68-594c-4218-a0ad-a6821443741e)
---

## §0 Business decisions only the owner can make

None blocking. Settled, do NOT re-ask:

- (a) Nov 6, Albert in chat: "keep the ~half-second slower search" — `POPSG_SEARCH_MODE` stays `hybrid` permanently.
- (b) Nov 5: database upgraded to Medium by Albert; any further PAID upgrade is his call — bring ONE recommendation with cost and measured benefit, never a menu (only if p95 3 s proves unreachable without it).

No technical approvals belong to Albert; the AI handles them.

## §1 What this application is

PopDAM (`u2giants/popdam3`) is POP Creations' licensed-artwork library; PopSG (`sg.designflow.app`) is its style-guide mode (~235k files, Harry Potter, Mickey, Star Wars…). Shared Supabase project `qsllyeztdwjgirsysgai`; database structure lives in `popcre/shared-db`. Search runs through edge function `dam-search-ai` (https://github.com/u2giants/popdam3/blob/main/supabase/functions/dam-search-ai/index.ts) and DB function `search_style_guide_library_v2`.

## §2 What we set out to do

- #706: turn on meaning-based (hybrid) search behind a config switch once it passed relevance/speed gates — DONE and closed.
- #804: shared-database slowness; search p95 target ≤ 3 s — still open; this handoff carries its remainder.

## §3 Current state

1. `admin_config.POPSG_SEARCH_MODE` = jsonb `"hybrid"` since Nov 5, 11:55:24 PM EST (the row previously did not exist = `keyword`; revert = set `"keyword"` or delete the row).
2. #706 closed COMPLETED Nov 6 12:09 AM EST (closing comment https://github.com/u2giants/popdam3/issues/706#issuecomment-6677475014; live proof "harry poter" → 23 Harry Potter guides, "xqzvplm" → empty; final judged run https://github.com/u2giants/popdam3/issues/706#issuecomment-6676812130). All #706 checkboxes ticked except "Re-measure latency" which rides with #804.
3. PR #837 merged (c0c37b67, Nov 6 12:23 AM EST): both old handoff files deleted from main.
4. Speed readings: Nov 7 6:43 PM EST PopDAM 111/119 passed, p50 2.0 s / p95 4.6 s (https://github.com/u2giants/popdam3/issues/804#issuecomment-6714616660); after shared-db PR #5891 (truncation shortcut, migration 20261106161604) acceptance run "issue-5747-trunc-final2": 118/119, p50 2.43 s / p95 3.83 s (verified live Nov 7 9:11 PM EST, https://github.com/popcre/shared-db/issues/5747#issuecomment-6716047562). Target 3 s NOT met for PopDAM; PopSG legs are under 3 s.
5. #804 has a standing owner — the closing coordinator session — which now ends; the reader of this file is the successor.
6. shared-db#5747: 7-day reading due ~9:47 PM EST Nov 12 and index re-check Nov 18 are owned by OTHER sessions named on that issue; do not collide.

## §4 What did NOT work (carried + this session)

- Picture vectors for text search (dropped in #832; ef_search caps recall, 10–14 s).
- Semantic floor sweep (harness NaN bug; probe 2 min/query).
- Names+pictures combined (+2–3 s, precision 0.94).
- Silent `git push -q` lost a commit — always confirm push prints `->`.
- ai-pr-wait gives up on the always-failing advisory "Supabase Preview" check — merge once real checks pass.
- Trusting session notes as fact — verify live.
- Hand-written PR polling loops are blocked by a hook — use `bin/ai-pr-wait`.
- The eval harness copy on hetz under /var/tmp/ai-sessions-1000/popsg-706-eval has its DAM leg disabled (`if (false)` at run.mjs:172) — use the repo harness https://github.com/u2giants/popdam3/blob/main/scripts/search-eval/run.mjs instead.
- `pkill -f` matched and killed its own command line.
- Albert's in-chat speed question initially returned no answer — session proceeded on the handoff's recorded recommendation and Albert later confirmed it (Nov 6) — assumption was named, not hidden.

## §5 Root causes and key findings

- Spelling help never worked before #827 (rare-word count hit `dam_search_documents.search_tsv` whose index was dropped Oct 22 by shared-db migration 20261022191243; `dam_search_keys` has the GIN index — use COUNT not LIMIT).
- The file gate fails on RECALL not ranking (needs total ≥ 0.5 × expected_total per docs/SEARCH_EVAL.md https://github.com/u2giants/popdam3/blob/main/docs/SEARCH_EVAL.md).
- Name-vector thresholds were tuned on the judged set SEARCH_EVAL_SET_V1 — unseen queries may widen wrongly (symptom: one property floods the top).
- Residual p95 (3.83 s) is OUTSIDE the count stage — remaining time sits in keyword-embedding service variance (100–1500 ms/call), an expand-split probe, a broad GIN scan, and an anchor duplicate sort (per https://github.com/popcre/shared-db/issues/5747#issuecomment-6716047562).
- ai-doc-safety in full-tree mode flags a pre-existing placeholder at https://github.com/popcre/shared-db/blob/main/scripts/test_preview_ledger_orphan_reconcile.py#L708 — NOT introduced by this work, deliberately not touched.

## §6 Exact next steps

1. Comment on #804 claiming standing ownership (signed `Posted by ZCode chat <id> on <machine>`; $ZCODE_SESSION_ID or `unknown`).
2. Take the keyword-embedding variance lever first (largest single contributor): measure per-call variance of the text-embedding service in https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/popsg-query-embedding.ts; then cap retries/time-budget it or batch the name-vector match into one call. You'll know it worked when the standard eval pair's PopDAM p95 ≤ 3 s.
3. After each change rerun the repo harness (https://github.com/u2giants/popdam3/blob/main/scripts/search-eval/run.mjs; one warm-up pass first — a DB restart empties memory; back-to-back runs vary ±2 cases).
4. Post a ranked before/after on #804 (p50/p95 + pass counts, method, flags, EST times).
5. If 3 s is unreachable without paid infrastructure, bring Albert ONE recommendation with cost and measured benefit (§0).
6. Do NOT touch shared-db#5747's Nov 12 / Nov 18 readings (owned elsewhere).

## §7 Constraints and gotchas

- Never push to protected main; branch + PR + `gh pr merge --squash --admin` after `bin/ai-doc-safety` passes on the exact head (prose PRs).
- "Supabase Preview" check is advisory and always fails.
- Edge functions deploy on merge to main (verify the workflow run before testing).
- Database STRUCTURE changes only via popcre/shared-db claim-first PR + automatic promotion.
- `admin_config` rows are application data, writable directly (prove the target row first).
- Sign every GitHub post `Posted by ZCode chat <id> on <machine>`.
- Re-run https://github.com/u2giants/popdam3/blob/main/scripts/popsg-name-vectors.mjs after new licensors/properties arrive (SEARCH_SPELLING_NAMES self-refreshes hourly).
- Quote every human-facing time in EST computed from `TZ=America/New_York date`.

## §8 Access and environment

- Database: psql via pooler `aws-1-us-east-1.pooler.supabase.com:6543`, user `postgres.qsllyeztdwjgirsysgai`; password = 1Password vault `vibe_coding` item "Supabase DB Password - shared POP database" (item id 246sf23gymd64yudpmhswcnyle) — pipe through a chmod-600 file, never a command line.
- Site tester login = same vault, item "DAM AI tester login - PopDAM (administrator, dam.designflow.app, production)" (id 7s5uzpbjenka4fpvrqogh44bre).
- Judged eval set lives in `admin_config` key `SEARCH_EVAL_SET_V1` (hash 13cdb9a0, 65 guide + 65 file cases).
- Never commit raw hit files (licensed data).

## §9 Open questions and risks

- Hybrid name-widening on unseen queries may flood one property into results (watch in #804 readings).
- PopDAM p95 3.83 s vs 3 s target — unmet.
- Ownership transfer of #804 happens via this file + a claim comment (not automatic).
- Counts drift a few rows between readings (live corpus, nightly rebuilds).

## Part (b) — sub-agents

All finished; worktrees all removed (none remaining):

- **Agent config-write**: asked to set POPSG_SEARCH_MODE; found row absent (absence = keyword), INSERTed jsonb `"hybrid"` 11:55:24 PM EST Nov 5; did NOT touch other rows; no GitHub posts.
- **Agent live-proof**: Playwright headless against live sg.designflow.app with the 1Password tester login; PASS both queries; screenshots kept only on hetz /tmp (ephemeral, not evidence of record); verified live build 574e4fe; did NOT change site settings.
- **Agent 804-takeover**: posted ownership claim https://github.com/u2giants/popdam3/issues/804#issuecomment-6677322105; found PR #825 already merged 7:07 PM EST Nov 5; deliberately did NOT touch #706/#837.
- **Agent 706-closeout**: ticked boxes, closed #706 (12:09 AM EST), pushed handoff deletion to PR #837 head a471fdd3, merged squash c0c37b67 (12:23 AM EST); deliberately left "Re-measure latency" unticked (owned by #804).
- **Agent account-cleanup**: test account sg-qa-semantic-20261028@popcre.com already deleted Nov 4; ticked that box with evidence https://github.com/u2giants/popdam3/issues/706#issuecomment-6687370427; did NOT delete anything.
- **Agent claim-timeout-box**: proved done via #799/#811 + finished indexing; ticked box, evidence https://github.com/u2giants/popdam3/issues/706#issuecomment-6687457627; posted Albert's speed ruling https://github.com/u2giants/popdam3/issues/706#issuecomment-6687531131.
- **Agent overdue-reading**: took the 24-h reading (Nov 7 6:43 PM EST), used the repo harness (the /var/tmp copy's DAM leg is disabled); one existing vault credential appeared in a local shell error line on hetz only — redacted on the spot, NOT rotated (standing owner rule); posted https://github.com/u2giants/popdam3/issues/804#issuecomment-6714616660.
- **Agent probe-check**: found shared-db#5747 Step 5 already finished by a sibling (PR #5891, results 7:27 PM EST Nov 7); verified live read-only; posted https://github.com/popcre/shared-db/issues/5747#issuecomment-6716047562 and cross-ref https://github.com/u2giants/popdam3/issues/804#issuecomment-6716050501; deliberately did NOT claim anything on shared-db.
- **Agent 804-standing-owner**: posted https://github.com/u2giants/popdam3/issues/804#issuecomment-6715956625 naming the closing coordinator session as standing owner (now ends — successor reads this file).
- **Agent 804-status-check**: verified #804 stalled 96 min, no assignee (Nov 5 11:51 PM EST); read-only.

All sub-agents: worktrees removed; no shared-db claims held (closeout-check receipts in session evidence).
