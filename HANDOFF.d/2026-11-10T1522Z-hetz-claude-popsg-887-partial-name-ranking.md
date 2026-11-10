---
issue: 887
status: OPEN
owner: next #887 session (successor to Claude chat on hetz, branch claude/handoff-887)
---

## §0 Business decisions only the owner can make

None — nothing in this workstream needs the owner. Put nothing to Albert before starting.

Already settled — do NOT re-ask:

- Nov 10, 2026, Albert, asked whether style-guide results should include guides that only contain a character, after the guide named for it: "Keep all five". Guides that merely contain or mention the searched character stay listed; the guide named for it must be first.
- Nov 10, 2026, Albert, on this issue: "Yes, fix it" (authorizes #887).
- Nov 6, 2026, Albert: "keep the ~half-second slower search" — `POPSG_SEARCH_MODE` stays `hybrid`.

## §1 What this application is

PopDAM (https://github.com/u2giants/popdam3, live at https://dam.designflow.app) is POP Creations' licensed-artwork library. PopSG (https://sg.designflow.app) is its style-guide library mode: about 235,000 files of licensor style guides. Staff type a character, property or licensor name and expect the right guides and files first. Both run on one shared Supabase project (`qsllyeztdwjgirsysgai`); database structure lives in https://github.com/popcre/shared-db and reaches production only through that repository's automatic promotion.

PopSG search path:
1. Page: https://github.com/u2giants/popdam3/blob/main/src/pages/popsg/PopSGLibraryPage.tsx (`fetchPopSGV2Page`).
2. Edge function `dam-search-ai`, action `popsg-query-embedding`: https://github.com/u2giants/popdam3/blob/main/supabase/functions/dam-search-ai/index.ts — returns `expansion` (a licensor/property name the words clearly mean) and `fallback` (see §3).
3. Database function `public.search_style_guide_library_v2` (shared-db). Migration lineage: https://github.com/popcre/shared-db/blob/main/supabase/migrations/20260907131610_popsg_search_style_guide_library_v2.sql through https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261105023331_popsg_search_pdf_body_breaks_ties.sql. Read the LIVE definition (`pg_get_functiondef`) before editing; later migrations may exist.

## §2 What we set out to do, and why

Albert asked where reliable, accurate meaning-based search for library items stands, then asked for each gap to be fixed. Everything except one judged case is done. The remaining case is #887: https://github.com/u2giants/popdam3/issues/887.

Business terms: a person types a character name plus one extra word the library does not use (judged case `mis-090`; the actual words are in the private set, see §8). PopSG returns four unrelated files instead of the roughly 300 files for that character.

Technical objective: make `search_style_guide_library_v2` list files/guides matching ALL words first, then those matching the known name alone, without widening ordinary narrowing searches.

## §3 Current state — what is true right now

All merged to `main` and live (site build `f79dfac` at verification; later merges are harness/docs only):

- https://github.com/u2giants/popdam3/pull/881 — Production Canary alarms when the GPU indexing worker heartbeat goes stale.
- https://github.com/u2giants/popdam3/pull/882, https://github.com/u2giants/popdam3/pull/884, https://github.com/u2giants/popdam3/pull/885 — empty-result retry: when a PopSG search returns zero, the page searches `fallback` instead (longest known name inside the words, else nearest known spelling; code in https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/popsg-query-embedding.ts `zeroResultFallback`). The Search test set harness now mirrors the live page.
- https://github.com/u2giants/popdam3/pull/886 — PopSG guide pass rule = a guide named for the search is first (owner ruling above); documented in https://github.com/u2giants/popdam3/blob/main/docs/SEARCH_EVAL.md.
- Judged set `admin_config` key `SEARCH_EVAL_SET_V1` is version `2026-11-10b` (PopSG legs fully judged; PopDAM judgments untouched). Previous set: key `SEARCH_EVAL_SET_V1_BACKUP_20261110`.
- Indexing worker on `edge-dev` (`PopDAM-ImageEmbedWorker`): restarted Nov 9, 10:20 PM EST after 3.5 days down; now S4U principal plus a 5-minute repeating trigger; kill drill passed. Search documents pending reached 0 at 12:05 AM EST Nov 10.

Official scores, run https://github.com/u2giants/popdam3/actions/runs/42838886337 (10:00 AM EST Nov 10): PopDAM 118/119 (p95 2137 ms), PopSG guides 64/65 (p95 3199 ms), PopSG files 64/65 (p95 2367 ms). The only PopSG failure in both modes is `mis-090`.

Not started: any shared-db work for #887. No claim has been posted. Nothing is uncommitted; this handoff's branch is `claude/handoff-887`.

Full record: https://github.com/u2giants/popdam3/issues/804#issuecomment-6758087190, https://github.com/u2giants/popdam3/issues/804#issuecomment-6759078532, https://github.com/u2giants/popdam3/issues/804#issuecomment-6770011039, https://github.com/u2giants/popdam3/issues/804#issuecomment-6770740805.

## §4 What did NOT work

- Trusting the PopSG scores before Nov 10: the harness called `search_style_guide_library_v2` without the `popsg-query-embedding` step, so it scored a retired keyword-only path. Ten "misses" were misspelling cases with zero judgments that could never pass.
- A one-row probe search before every query that had a fallback (#882): added a round trip to most searches. Replaced in #885 by retrying only an empty first page.
- Reusing `nearestWord` from https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/search-spelling.ts for the fallback: ties break alphabetically and all weights are equal, so a misspelling resolved to the joined form of a two-word character name and still found nothing. #884 prefers a candidate that is a complete known name.
- Rule-judging PopDAM hits with `label.py` in the same pass: it marked two passing PopDAM character cases as failing (the picture-checked judgments override the rule). PopDAM judgments were therefore left untouched; do not bulk-judge them.
- Considered and rejected for #887, do not build: (a) always OR-ing the contained known name into the query — a character plus an ordinary word would return the whole character set and inflate totals; (b) triggering the retry on "few" results — arbitrary threshold; (c) merging two RPC calls in the page — breaks totals and paging, which the function owns.
- Process traps hit: `pkill -f` on a waiter killed the calling shell; `ai-pr-wait` refuses to start until the task class covers every file changed since the session base (`ai-task-gates start --class deployment` once edge functions are in the change set); `gh run watch` and hand-written PR polling are blocked by hooks; the session `$TMPDIR` was removed overnight, so recreate it; a scored run launched within seconds of an edge deploy can hit an old warm instance.

## §5 Root causes and key findings

- PopSG keyword matching requires every word. The empty-result retry covers zero results only. `mis-090` returns 4 because four files contain both words inside extracted PDF text.
- For `mis-090`, `popsg-query-embedding` already returns `fallback` = the contained known character name, but the page ignores it because the first page is not empty. The full name-only result (about 300 files, 21 guides) is what the case expects: pass needs total ≥ half the stored `expected_total` (313 files, 21 guides) and a relevant result in the top ten.
- Known names come from `admin_config` key `SEARCH_SPELLING_NAMES` (licensor, property and character names); `knownFullNames` in the edge function. PopSG name vectors (`POPSG_NAME_VECTORS`) hold only 309 licensor/property folder names and did not match this case.
- Pass rules: https://github.com/u2giants/popdam3/blob/main/scripts/search-eval/score.mjs.
- The Production Canary's "every 15 minutes" schedule actually fires every few hours on GitHub.

## §6 Exact next steps

1. Load the `shared-db-change` skill and read https://github.com/popcre/shared-db/blob/main/AGENTS.md. Claim `public.search_style_guide_library_v2` on a shared-db issue that references #887 (claim-first; no coordinator needed). You'll know it worked when the claim comment is posted and no other open claim names that function.
2. Read the live function definition and decide the smallest contract change. Suggested: a new optional argument (for example `p_fallback_query text default null`) that, when present, appends rows matching the fallback query but not the main query AFTER all main-query rows, with `total` counting both. Existing callers that omit it must behave exactly as today. You'll know the design is sound when a preview call without the argument returns byte-identical results to production for five judged queries.
3. Implement and test in shared-db per its promotion path (preview rehearsal, tests, automatic promotion; no manual production command). You'll know it worked when the migration is in the production ledger and `pg_get_functiondef` shows the new argument.
4. In popdam3: send `fallback` as the new argument ONLY when it is a contained known name, not a nearest-spelling guess. That needs the edge function to say which kind it returned (add a field such as `fallback_kind: "name" | "spelling"` in https://github.com/u2giants/popdam3/blob/main/supabase/functions/dam-search-ai/index.ts and `zeroResultFallback`). Update `buildPopSGV2Args`/`parsePopSGQueryEmbedding` in https://github.com/u2giants/popdam3/blob/main/src/pages/popsg/popsgSearchV2.ts, the page, and mirror it in https://github.com/u2giants/popdam3/blob/main/scripts/search-eval/run.mjs. Keep the empty-result retry. You'll know it worked when unit tests pass and the edge deploy workflow is green (rerun once on the known esm.sh integrity error).
5. Judge new PopSG hits: run the harness with `--raw <private file>`, run `scripts/search-eval/label.py`, keep the existing PopDAM judgments, save as a new `version` in `SEARCH_EVAL_SET_V1`. You'll know it worked when the unjudged share for PopSG is under 2%.
6. Run Actions → "Search test set" on `main` at least 5 minutes after the last deploy. Done when PopSG guides and files are both 65/65, PopDAM is not below 118/119, and PopSG file p95 is not above the 2367 ms reading by more than normal variation (compare two runs).
7. Regression check by hand as the viewer tester: a character plus a product word still returns only the narrowed set on page one, and its total does not jump to the whole character.
8. Post scores on #887 and #804, close #887, and delete this file in the same pull request.
9. At the end, re-read https://github.com/u2giants/popdam3/blob/main/plan_vector_consolidation.md STATUS and every later phase, and report any drift this work caused. Its STATUS table still describes Nov 5–6; Steps 1 (watchdog) and 2 (durable runner) advanced in this session per the #804 comments and the table was NOT updated — update it.

## §7 Constraints and gotchas in force

- Never push to protected `main`; branch and pull request; merge with `gh pr merge --squash` once real checks pass. "Supabase Preview" always fails and is advisory.
- Database structure changes only through popcre/shared-db; production is reached only by its automatic promotion.
- Sign every GitHub post with `$AI_GH_SIGNATURE`. Quote times in EST from `TZ=America/New_York date`.
- Licensed names, product codes and file ids never go in this public repo, issues or reports: case ids and counts only. Raw harness files stay private.
- Do not touch the shared-db#5747 readings scheduled for Nov 12 (9:47 PM EST) and Nov 18.
- Wait on pull requests with `ai-pr-wait <n> --timeout-minutes N` in the background; it exits only on merge/failure/deadline, so read check state when it returns.
- Do not change the indexing worker task on `edge-dev`; its previous definition is saved beside the script as `task-backup-20261109.xml`.

## §8 Access and environment

- 1Password vault `vibe_coding` (use the `op_run` tool; never print values): viewer tester item `mbspkosvp2rf25qxhqufipxqca` (fields `username`, `password`); publishable key item `3hhxwrljnaq2tykxi7hplq5ryi` field `SUPABASE_PUBLISHABLE_KEY`; database password item `246sf23gymd64yudpmhswcnyle` field `password`.
- Harness env: `SUPABASE_URL=https://qsllyeztdwjgirsysgai.supabase.co`, `SUPABASE_PUBLISHABLE_KEY`, `SEARCH_EVAL_EMAIL`, `SEARCH_EVAL_PASSWORD`. `label.py` needs `PGPASSWORD`; psql via pooler `aws-1-us-east-1.pooler.supabase.com:6543`, user `postgres.qsllyeztdwjgirsysgai`.
- `op_run` cannot read the Claude scratchpad folder; put private files under the session `$TMPDIR`.
- `edge-dev` is reachable by `ssh edge-dev` from hetz (Windows, elevated).
- The case text for `mis-090`: `select c->>'query', c->>'truth' from admin_config, jsonb_array_elements(value->'cases') c where key='SEARCH_EVAL_SET_V1' and c->>'id'='mis-090'`.

## §9 Open questions and risks

- Appending name-only rows changes `total` for searches that send the argument; confirm the page's paging (`getPopSGV2ContinuationOffsets`) still lines up (Nov 10).
- The fallback is silent: the page does not tell the person their words were widened. Not requested; left as is (Nov 10).
- PopSG licensor-wide searches reach 6–12 s at p95 within their kind; overall guide p95 is 3.2–4.8 s against a 3 s target. Tracked on #804, out of scope here.
- PopDAM `com-075` has failed in every reading since before this session; not investigated.
- `SEARCH_SPELLING_NAMES` refreshes hourly; a newly added character is unknown to the fallback until then.

## Self-audit

1. Newcomer can continue: §1 explains the app and path, §3 the exact state, §6 ordered steps with gates. Yes.
2. As effectively as the author: §4 and §5 carry every dead end and finding; §8 the access. Yes.
3. Every needed detail: goal §2, state §3, failures §4, decisions §0/§9, constraints §7, verification gates §6. Yes.
4. Owner decisions: walked §1–§9; none need Albert; settled rulings listed in §0. Yes.
