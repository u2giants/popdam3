# Vector consolidation — one durable pipeline, one search contract, two apps

Created November 4, 2026, 5:05 PM EST on `hetz` by Claude (session
`vector-strategy-review-2c428b`). Owner request (Albert, Nov 4, 2026): *"take a
bird-eye view of everything we're trying to do with vector and tell me why
we're failing"* → *"Yes, write plan"* (a single consolidation plan that fixes the
embedding pipeline first, then PopSG).

**Handoff:** [HANDOFF.d/2026-11-05T0100Z-hetz-claude-search-and-tagging-coordinator.md](HANDOFF.d/2026-11-05T0100Z-hetz-claude-search-and-tagging-coordinator.md)
**Tracking issues:** PopDAM [#706](https://github.com/u2giants/popdam3/issues/706)
(PopSG indexing + acceptance), [#663](https://github.com/u2giants/popdam3/issues/663)
(excluded DAM documents), [#107](https://github.com/u2giants/popdam3/issues/107)
(PopSG library parent); shared-db [#4437](https://github.com/popcre/shared-db/issues/4437),
[#5584](https://github.com/popcre/shared-db/issues/5584). Steps that need a new
issue say so.

## STATUS — read before executing

| Step | State (Nov 4, 2026, 7:59 PM EST) | Evidence / artifact |
|---|---|---|
| 0. Absorb in-flight work | ✅ done | shared-db PR 5588 merged 5:19 PM EST (ledger `20261104214917`); PR 5585 merged 6:38 PM EST (`20261104231008`); PR 5594 merged 6:47 PM EST (`20261104231707`). Follow-up `20261105002300` is merged, NOT yet in the ledger: promotion held by open findings #5592 / #5583 |
| 1. Watchdog alarm | 🔄 implementation underway; live drill open | shared-db PR 5623 (health RPC and compact indexes), app PR 758 (health card), monitor PR 23 merged (dashboard alert/clear). Runtime configuration and two-hour poller drill remain open; no off-page push claim |
| 2. Durable runner | 🔄 partial; unattended acceptance open | O1 is GPU thumbnail lane (PRs 741, 747, 750), not Railway text embedding. Active photo-indexing session owns poller custody (#662). Read-only scheduler XML verified BootTrigger and PT0S on Nov 4, 2026, 11:16 PM EST; 24 hours near zero remains unverified |
| 3. Stop re-starving | 🔄 outside active custody | shared-db #5609 owns value-based asset-trigger scoping; do not duplicate its edits. Nightly/tagging/scan measurements and next 6:00 AM EST / two-hour recovery acceptance remain open |
| 4. Errored-document reset | 🔄 bounded reset prepared; live run open | shared-db PR 5623 adds thumbnail-aware reset bounded to 5,000, preserving live leases and old overload. App PR 758 reuses existing reset control. One-time execution and actual-thumbnail / persisted-vector proof on #663 remain open |
| 5. Scorecard (extends search test set) | 🔄 partial | `SEARCH_EVAL_SET_V1` and PR 720 landed; takes over old tagging task 6 |
| 6. PopSG activation | 🔄 partial | Wiring landed behind switch (#730); #734 and error/Retry open; tester already deleted |
| 7. Retire superseded plans/handoffs | ✅ done | This reconciliation PR |
| 8. Live proof, close #706 / #663 | ⬜ open | — |

**Fresh session starts at Step 1**, after reading "Reconciliation" below. Re-read the downstream phase before starting each one.

## Reconciliation with the tagging coordinator work (Nov 4, 2026). Overrides anything below it.

Tagging (#680) stays out of this plan's scope, but shares its database, worker and search results:

1. **Promotion gate.** Open shared-db review findings hold all promotion. Tagging task 1 (#5592, #5583) goes first; database parts of Steps 1, 3, 4 and 5 wait on it.
2. **Worker restarts.** A merge touching the worker restarts it during the 7.7-day tagging run and PopSG indexing. Allowed, except 1:00 to 3:30 AM EST. Deliberately stopping or restarting the run is never allowed. Concurrency stays 8.
3. **One test set.** Step 5 extends `SEARCH_EVAL_SET_V1` (`docs/SEARCH_EVAL.md`, `scripts/search-eval/`). No public fixture: licensed names stay out of this public repo. Add latency p50/p95 and the plan's missing query kinds to that set.
4. **Failure behaviour.** In hybrid mode a failed embedding shows error and Retry, never keyword results (Albert, Nov 1; D4). Only a product code skips embedding on purpose. Replaces Step 6a's fallback sentences and the "stay available (keyword)" line in the #706 plan.
5. **Pending now excludes rows waiting for a thumbnail.** Step 1 reuses the definition in `get_dam_search_embedding_status` (migration `20261105002300`), or the alarm fires on rows that can never drain. The §5 SQL overcounts.
6. **Step 1 drill.** Stopping the poller also pauses picture search, so run it outside business hours.
7. **Step 2 gate.** PopSG will drain within hours, so "24 hours falling" cannot be measured. Pass: drained with no manual resume, then 24 hours unattended holding near zero.
8. **Step 3 scope.** Measure nightly rebuild, tagging and scan writes. Tagging changes search documents all week; if unchanged pictures lose vectors, that is the same defect.
9. **Step 4.** One run only, shared with `docs/plans/issue-663-*` step 1. Rows without thumbnails stay excluded.
10. **Step 5 order.** (a) rebase `fix/search-eval-ranking-680`, re-stamp, reopen on #5581, promote; it overlaps merged PR 5594, so re-judge the conflict; (b) finish #725 spelling; (c) verify PR 720's deploy and run the workflow; (d) add latency and kinds; (e) save the score on #680 and #706. Tagging changes results: judge unjudged hits before comparing, and rescore at tagging end.
11. **Step 6.** The adapter exists: action `popsg-query-embedding`, `PopSGLibraryPage.tsx`, `popsgSearchV2.ts`. Do not add `sg-embed-query` or `popsgSemanticSearch.ts`. Remaining: execute `docs/plans/issue-734-*`, then error/Retry, then floor, latency and the switch. Tester account is already deleted. Hybrid p95 was 10-11 s against 3 s: if still over at full coverage, stay on keyword and record the gap.
12. **Other plans.** `docs/plans/issue-706-*` and `issue-663-*` remain checklists; where they overlap, this plan wins.

---

# Part 1 — Why

## 1. The ultimate goal

A POP Creations employee types words ("spiderman outdoor mat", "cute yellow
character") or drops a picture into PopDAM or PopSG, and within about three
seconds sees the right products or style-guide pages first. That keeps being
true every day, after every nightly rebuild, password change, reboot or bulk
edit, with nobody restarting anything by hand. If search gets worse, someone
is told within hours, not discovered weeks later during a drill.

Today that is true for **picture upload in PopDAM only**. Word search in PopDAM
works but has needed a repair every few days. PopSG semantic search is not
reachable from its UI at all.

**If any step below conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

- **PopDAM** (`u2giants/popdam3`, branch `main`, React + Vite front end on
  Coolify at dam.designflow.app, Deno edge functions on Supabase, a Node
  worker on Railway `apps/worker/`, a Python GPU poller `apps/image-embed-worker/`
  on the Windows PC `edge-dev`). Digital asset library: ~136k files in ~11k
  style groups (products). Search table `public.dam_search_documents`
  (one row per file and per group) with `embedding vector(768)`.
- **PopSG** (same repo, pages under `src/pages/popsg/`, site
  sg.designflow.app): the licensor style-guide library, ~235k PDF pages in
  `public.style_guide_search_documents`, also `vector(768)`.
- **Shared database**: Supabase project `qsllyeztdwjgirsysgai` (Virginia),
  PostgreSQL 17, pgvector 0.8. **All structure lives in `popcre/shared-db`**
  (vendored read-only copy under `shared-db/` here). Never add a migration to
  this repo.
- **Text-embed tower** `apps/text-embed/` (SigLIP2 text side) hosted on
  Coolify at the URL in `admin_config.TEXT_EMBED_URL`; edge function
  `supabase/functions/dam-search-ai/index.ts:51-56` reads it.
- **Model** (locked, shared-db #4664): `google/siglip2-base-patch16-naflex`,
  768-dim, for both documents (thumbnail → image tower) and queries (text →
  text tower). Image similarity additionally stores DINOv3 in `dam.*` tables.

## 3. What triggered this work

A Nov 4, 2026 review of every vector effort since August. Findings (plain):

1. Three efforts ran in parallel across two repos, five AI engines and three
   machines. Only image similarity (#486, one owner, one week) finished.
2. Embeddings never stayed current. The DAM corpus was embedded once by a
   one-off GPU script (Oct 23). The nightly style-group rebuild invalidates
   group vectors; nothing refilled them, so real products vanished from
   search (#616 Spider-Man coir). The only runner crashed on a rotated DB
   password (Nov 2); the always-on poller had been dead since Oct 29 because
   Windows Task Scheduler's 72-hour limit killed it; its search lane lacked
   grants (#663). PopSG backfill died Oct 28 on claim timeouts and sat with
   ~80k pending for a week.
3. Text queries go through a picture model. Product codes matched random
   lookalikes (#689), fixed by five successive patches (#577, #579, #586,
   #690, #699).
4. The database's 8-second statement ceiling is hit constantly (cold
   HNSW scans, claim queries, high-frequency keywords): 81 search/vector
   migrations in shared-db, most of them firefighting.
5. Process overhead: parked PRs, claim ceremonies, reviewer-draw tooling
   failures (#4797), handoffs that supersede handoffs. No single document
   says what is true now.

## 4. Scope

**In**
- One durable embedding runner covering both corpora, with an alarm.
- Rebuild/bulk-write behaviour that preserves unchanged vectors.
- A bounded reset path for documents marked permanently failed.
- A fixed scorecard (relevance + latency) run the same way in both apps.
- PopSG UI wiring, mode switch, activation with the scorecard as gate.
- Retiring the superseded plan/handoff documents into this plan.

**NOT in this plan**
- Changing the embedding model, dimensions or vector extension (VectorChord,
  pgvecto.rs, external vector DB). Rejected in §7.
- Raising any statement timeout.
- Treating code-shaped queries not in the catalog as codes. **Owner ruled
  Nov 3, 2026: "Keep picture guesses."** Closed on #689.
- Image similarity (upload-to-find). It works; leave it (plan_image_similarity_upload_search.md).
- AI tagging (#680), ERP enrichment, HTS/customs RAG search (`hts_rag_*`
  migrations are a different product).
- The DAM keyword relevance contract on shared-db #4508 beyond measuring it.

---

# Part 2 — What we already know

## 5. Current state (live, read-only, Nov 4, 2026, 4:58 PM EST)

| Corpus | Total | Embedded | Pending | Errored | Last write |
|---|---|---|---|---|---|
| DAM style groups | 11,247 | 11,237 | 0 | 10 | 4:57 PM EST today |
| DAM assets | 136,236 | 132,708 | 2,414 | 1,114 | 4:58 PM EST today |
| PopSG pages | 234,795 | 140,227 | 94,568 | 0 | 4:49 PM EST today |

Re-derive with:
```sql
select document_type, count(*), count(embedding),
       count(*) filter (where embedding is null and embedding_error_category is null) pending,
       count(*) filter (where embedding_error_category is not null) errored,
       max(embedding_updated_at)
from public.dam_search_documents group by 1;
select count(*), count(embedding),
       count(*) filter (where embedding is null and embedding_error_category is null),
       count(*) filter (where embedding_error_category is not null),
       max(embedding_updated_at)
from public.style_guide_search_documents;
select public.image_embed_status();
```

- `admin_config`: `SEARCH_MODE = "hybrid"`, `IMAGE_EMBED_ENABLED = true`,
  `TEXT_EMBED_URL` set. No PopSG search-mode key exists yet.
- GPU poller `PopDAM-ImageEmbedWorker` on `edge-dev`: heartbeat fresh
  (`workers_fresh: true`), three lanes (query, index, search-doc). Search-doc
  lane config `apps/image-embed-worker/config.py:59-62` (poll 5 s, lease 900 s,
  batch 64). Missing thumbnail is marked **permanent** at
  `apps/image-embed-worker/image_embed_poller.py:545` — this is what
  #663 measured as 1,139 excluded, 414 of which now have thumbnails.
- PopSG embedding runs as Railway worker operation `sg-embed-search`
  (`apps/worker/src/operation-loop.ts`; claim RPC
  `public.claim_sg_search_embedding_documents`, shared-db migration
  `20261027012301`). It restarted at 4:46 PM EST today (session
  `popsg-indexing`, PR #5588) at ~690 pages per 15 minutes; at that rate the
  94,568 backlog takes ~34 hours if nothing interrupts it. It interrupted
  itself on Oct 28 after 10 auto-resume attempts.
- PopSG search RPC `public.search_style_guide_library_v2` already accepts
  `p_query_embedding` (migration `20261027183509`); with null it is pure
  keyword. The app (`src/pages/popsg/popsgSearchV2.ts`) never passes one. No
  PopSG semantic adapter file exists.
- DAM query path: `src/lib/dam-search.ts:77-88` probes `search-modes` from
  the edge function; `dam-search-ai` embeds the query via the text tower and
  calls `search_dam_documents` (exact group vectors in
  `dam.search_group_vectors`, migrations `20261101005850`, `20261102003027`).
  Exact catalog SKUs and SKU prefixes skip the picture leg (#690, #699).
- Error contract (#564/#641): a failed search shows "Search unavailable" +
  Retry; never a false zero.

## 6. Key findings and root causes

1. **No owner process for freshness.** Every runner so far was a session's
   side effect (one-shot script, a Task Scheduler job written by hand, a
   worker operation someone had to press Resume on). Nothing watched them.
   Evidence: #646 diagnosis comment Nov 2 (`password authentication failed`
   66 s after start; poller dead since Oct 29 10:48 AM EDT, 72-hour limit).
2. **Nightly invalidation outpaces embedding.** `style_groups` update trigger
   re-indexes every group doc nightly; the content-hash refresh nulls the
   vector when the hash changes. Group docs starved behind asset backlog
   until groups-first claiming (migration `20261101005850`). The backlog
   regrew 1,995 → 6,082 in two days with zero writes (#646).
3. **Permanent errors are forever.** `mark_dam_search_embedding_error(...,'permanent')`
   excludes the row from `claim_*` (`20261023184940:87`); no reset RPC exists.
   414 docs now have thumbnails and are still excluded (#663, Nov 4).
4. **Claims hit the 8-second ceiling.** PopSG claim 57014 on Oct 28 (dead
   tuples on a 235k-row table; PR #5588 sets aggressive autovacuum). DAM
   claim index rewrite planned in `shared-db/plan_dam-embedding-claim-speed.md`
   (not started).
5. **Picture vectors for text queries are noisy by nature.** Zero-shot
   SigLIP2 text→image similarity is good for "yellow character", bad for
   codes, customer names and program names. Every patch so far narrows when
   the picture leg runs; nobody has a fixed scorecard, so each patch is
   checked on the query that complained.
6. **Latency.** PopSG broad queries measured 4–12 s against a 3 s target
   (#706); DAM `spiderman` 5.2 s (#689 comment Nov 4). Cold HNSW scans and
   `ef_search` are the usual cause; keyword-only queries skip HNSW since
   `20261103013924`.

## 7. Approaches considered and REJECTED

| Approach | Why rejected |
|---|---|
| Move to VectorChord / pgvecto.rs / Timescale vectorsearch / external vector DB | Not installable on hosted Supabase; no measured bottleneck that pgvector 0.8 + HNSW cannot meet at 150k–235k rows. Plan_semantic_search §7. |
| Raise `statement_timeout` | Hides the problem; viewer ceiling is a product rule. plan_semantic_search §4. |
| Switch text search back to `gte-small/384` text embeddings | Would mean two models and two columns; #4664 locked one mechanism. Mixing already caused "never mixes gte-small with SigLIP2" guards. Re-opening is a model-change plan, out of scope. |
| Format-match product codes (regex) to skip the picture leg | Owner ruled Nov 3: keep picture guesses for unknown codes. |
| A separate Railway CPU embedder for DAM documents | Railway has no GPU; 150k thumbnails at CPU speed is days per full pass. The GPU poller does 5–26 docs/s. |
| Bigger claim batches to finish faster | Known to time out (plan_semantic_search step 7: "never jump back to known timeouting batch sizes"). |
| Nightly one-shot Task Scheduler job as the runner | Already failed twice (password rotation; 72 h limit). Only an always-on, heartbeating, credential-isolated service counts. |
| Waiting on a reviewer before merging anything | Reviews are advisory only (owner ruling Oct 29, 2026). |

## 8. Design decisions

**Locked (do not relitigate):**
- D1 (Oct 23, #4664): one embedding mechanism, SigLIP2 768, both corpora.
- D2 (Oct 25, image plan): shared-db `public` SECURITY DEFINER wrappers for
  every edge/worker call; `dam` schema is not exposed to PostgREST.
- D3 (Nov 2, #646): the GPU poller on `edge-dev` with its own DB login
  `dam_image_embed_login` is the durable DAM runner; it must never depend on
  the shared `postgres` password.
- D4 (Nov 1, #564): failures are shown, never masked as empty results.
- D5 (Nov 3, #689): exact SKU and SKU-prefix queries skip the picture leg;
  unknown code-shaped queries keep it.
- D6 (this plan): **no activation without the scorecard in §9 step 5
  passing**, and no scorecard without a fixed query list checked into the
  repo.

**Open (implementer decides, with the rule):**
- O1 DECIDED Nov 4, 2026 (#706): GPU poller lane. The Railway operation embedded file names through the text tower, against D1; nonsense outscored real searches. Original rule, superseded: Where the PopSG lane runs. Rule: if the Railway `sg-embed-search`
  operation (CPU, text-embed tower over HTTP) sustains ≥ 2,000 pages/hour
  for 24 h without interruption after PR #5588, keep it and add the watchdog.
  Otherwise add a fourth lane to the GPU poller mirroring the search-doc
  lane (page thumbnails are PNGs in Spaces like DAM thumbnails).
- O2 Semantic score floor per corpus. Rule: choose the floor that keeps the
  no-match query set (§10) at zero rows while every must-find case stays
  in the top five. Record the number and the scorecard run that chose it.

---

# Part 3 — How to build it

## 9. The plan

### Phase 0 — Absorb in-flight work (same day)

**Step 0.** Read PR #5588 and PR #5585 on `popcre/shared-db`. If merged and
promoted, note the ledger versions here and skip to Step 1. If open, do not
touch `claim_sg_search_embedding_documents`, `style_guide_search_documents`
reloptions, or `claim_dam_search_embedding_documents` — those objects are
claimed by sessions `popsg-indexing` and `excluded-search-docs`. Send the
owning session a message instead of re-doing the work.
*Gate:* STATUS row 0 names both PR states with a timestamp.

### Phase 1 — Pipeline that cannot silently die

**Step 1. Watchdog.** New shared-db RPC `public.get_search_embedding_health()`
(security definer, grant `service_role` + `authenticated` admins) returning
one row per corpus: pending, errored, last write, minutes since last write,
`stale` boolean = pending > 0 and no write for 120 min. Wire it to the
existing monitor app (`AGENTS.md` → "monitor", a Coolify app on hetz) as a
check that posts to the standing alert channel the monitor already uses.
Also surface it on the PopDAM Settings → Diagnostics page next to the
existing `ImageEmbedCard` (`src/components/settings/diagnostics/`).
*Gate:* stop the poller for 2 h in a drill → alert arrives; restart → clears.
Record the drill time on #706.

**Step 2. One durable runner.** Per O1. Either way:
- GPU poller: confirm the Task Scheduler task has `ExecutionTimeLimit`
  disabled (README documents the fix) and a boot trigger; prove by reading
  `schtasks /query /xml PopDAM-ImageEmbedWorker` on edge-dev; add the XML
  check to `apps/image-embed-worker/README.md`.
- Railway operation: remove the 10-attempt auto-resume cap for
  `sg-embed-search` in `apps/worker/src/operation-loop.ts` in favour of
  exponential backoff with no ceiling, and make a claim timeout (57014)
  classify as transient. Unit test: `operation-loop.test.ts` →
  "sg-embed-search resumes after the 11th claim timeout".
*Gate:* both corpora show pending = 0 (DAM) and pending falling
monotonically (PopSG) over 24 h via Step 1's RPC; no manual resume.

**Step 3. Stop re-starving.** Measure first: run the nightly style-group
rebuild on preview, count group docs whose `content_hash` changed versus
whose vector was nulled. If vectors are nulled for unchanged hashes, fix the
refresh trigger in shared-db (`dam_search_documents` content-hash refresh,
migration lineage `20260825010603` → `20261101005850`) so only changed
hashes null the vector. New issue on shared-db, claim the trigger function.
*Gate:* after one nightly rebuild, group pending at 6:00 AM EST < 500 and
back to 0 within 2 h (Step 1 RPC).

**Step 4. Reset path.** After PR #5585 lands: one shared-db RPC
`public.reset_dam_search_embedding_errors(p_category text, p_limit int)`
(service_role only, bounded to 5,000) that clears `embedding_error*` for
rows whose thumbnail now exists; expose it as a bulk operation
`reset-embedding-errors` in `apps/worker/` with a Diagnostics button. Run
once; record counts on #663.
*Gate:* #663 errored count drops from 1,114 to the rows with no thumbnail
in Spaces; those remain errored with category `permanent`.

**Context cut point.** Write a handoff here before Phase 2.

### Phase 2 — Know whether search is good

**Step 5. Scorecard.** Add `src/test/fixtures/search-scorecard.json`: 30
DAM queries and 30 PopSG queries, each with `must_find` (entity ids or
page ids known to the catalog), `must_not_find_any` for nonsense tokens, and
a latency budget (3 s PopSG, 8 s DAM viewer ceiling, 3 s target). Include at
least: 5 exact SKUs, 5 SKU prefixes, 5 character+product phrases
("spiderman coir", "stitch blanket"), 5 descriptive phrases with no catalog
words ("cute yellow character", "red race car"), 5 customer/program names,
5 nonsense. A script `scripts/search-scorecard.ts` runs them through the
live edge functions as the viewer tester (1Password `vibe_coding`, item
"PopDAM viewer tester" / "PopSG tester") and prints pass/fail per row plus
p50/p95 latency. Commit the output to
`docs/verification/search-scorecard/<date>.md` every time it runs.
*Gate:* first run committed; failures listed on #706 (PopSG) and a new
PopDAM issue "DAM search scorecard failures" for DAM.

### Phase 3 — PopSG activation

**Step 6a. Adapter.** New `src/pages/popsg/popsgSemanticSearch.ts`: embeds
the trimmed query once through `dam-search-ai` action `sg-embed-query`
(add to `supabase/functions/dam-search-ai/index.ts`, same text tower, same
auth helper, corpus as closed enum), passes `p_query_embedding` and the
floor to `search_style_guide_library_v2`, 6 s AbortController timeout. On
embed failure: run the keyword call for the whole page (never mix pages).
On 401/403: existing login UI, never keyword fallback. Mode comes from a
new `admin_config.POPSG_SEARCH_MODE` (`keyword` | `hybrid`), read through
the existing `search-modes` action extended with a `corpus` field.
Tests: `popsgSemanticSearch.test.ts` — "falls back to keyword for the whole
page when embed times out", "auth denial never falls back", "hybrid off →
no embed call".
**Step 6b. Activate.** Set `POPSG_SEARCH_MODE=hybrid` only when PopSG
pending < 1% and Step 5 passes for PopSG. Delete test account
`sg-qa-semantic-20261028@popcre.com` and its invitation row.
*Gate:* signed in as the PopSG tester on sg.designflow.app, the five
descriptive queries return relevant pages first; screenshot into
`docs/verification/popsg-semantic-activation-<date>/`.

### Phase 4 — One source of truth

**Step 7.** Mark `plan_semantic_search_popdam_popsg.md` and
`plan_hybrid_search_rollout.md` as historical in their STATUS headers,
pointing here; move the HANDOFF.d files they reference under
`HANDOFF.d/archive/` per the existing retirement convention (see commit
`c912e609`). Update `AGENTS.md` → plans list and the "Work on search" router
row to point here first.

**Step 8. Live proof and close.** Tick `- [ ] live proof` on #706 and #663
with the scorecard file and the watchdog drill. Close both. Update this
STATUS table.

## 10. Tests required

- `apps/worker/src/operation-loop.test.ts`: sg-embed-search unlimited
  resume; 57014 is transient.
- `apps/image-embed-worker/tests/`: existing 17 stay green on edge-dev;
  add "missing thumbnail is transient after PR #5585" if the poller changes.
- `src/pages/popsg/popsgSemanticSearch.test.ts`: the three cases in Step 6a.
- shared-db `supabase/tests/`: contract for `get_search_embedding_health`
  (grants, one row per corpus, stale flag) and for
  `reset_dam_search_embedding_errors` (bounded, service_role only, never
  resets rows whose thumbnail is still null).
- Scorecard script run = the acceptance test; nonsense rows must return 0.
- Existing: `npm test`, `npm run lint`, `npm run typecheck` in the app;
  `database-contract-tests.yml` in shared-db.

**Adversarial cases (query text is an external input):**

| Input | Hostile case | Test |
|---|---|---|
| Query string | 10,000 chars | `popsgSemanticSearch.test.ts` "query truncated to 512 chars before embed" |
| Query string | SQL/HTML in text | existing RPC parameterization; scorecard nonsense row `'; drop table` returns 0 |
| Corpus field | `"dam; popsg"` / unknown | `dam-search-ai` test "unknown corpus → 400" |
| Embedding vector | wrong dimension from tower | `dam-search-ai` test "non-768 vector → semantic leg skipped, keyword page served" |
| Mode config | missing key | `search-modes` returns `keyword` for PopSG |

## 11. Constraints and gotchas

- All structure in `popcre/shared-db`; claim exact objects on the owning
  issue first; migrations promote automatically after preview + tests. No
  human approval anywhere; reviews are advisory.
- Never edit `shared-db/` inside this repo; it is a vendored sync.
- PostgREST exposes `public` only; `dam.*` needs public wrappers.
- Statement ceiling 8 s on RPCs; HNSW `ef_search` and candidate limits are
  tuned in `20261027010904` / `20261027114004`; do not raise timeouts.
- The poller login cannot read `admin_config`; stamps are copied at install.
- Windows Task Scheduler default 72 h `ExecutionTimeLimit` kills always-on
  tasks; the README documents the fix.
- Nightly NAS scan and tagging runs share the database; schedule bulk
  resets outside 2–6 AM EST.
- Never write the shared `postgres` password into a runner; use the
  dedicated login.
- Commit as Albert's verified identity; feature branch + PR; never push to
  `main`. Sign GitHub posts with `$AI_GH_SIGNATURE`.
- Quote every time in EST.

## 12. Access and environment

- Supabase MCP here is bound to `qsllyeztdwjgirsysgai` (verified
  `get_project_url`). Read-only queries are fine; structure goes via shared-db.
- `gh` is authenticated for `u2giants/popdam3` and `popcre/shared-db`.
- `edge-dev` (Windows GPU PC): reach per `AGENTS.md` host table; poller
  install per `apps/image-embed-worker/README.md`.
- Secrets: 1Password vault `vibe_coding` — "dam_image_embed_login DB
  password (PopDAM image-embed worker, qsllyeztdwjgirsysgai)", the PopDAM
  and PopSG tester logins (see memory `project_popsg_tester_login`), text-embed
  key item referenced from `AGENTS.md` secrets table.
- Local run: `npm install && npm run dev` (app); worker `apps/worker/`;
  poller needs the GPU box.

---

# Part 4 — Landing it

## 13. Definition of done, risks, open questions

**Done when**
- Step 1 alarm exists and was drilled; Step 2 runner survived 24 h unattended
  on both corpora; Step 3 nightly rebuild leaves < 500 pending; Step 4 reset
  ran once with counts on #663.
- Scorecard committed and passing for DAM; passing for PopSG before
  `POPSG_SEARCH_MODE=hybrid`.
- PopSG hybrid live with screenshots; test account deleted.
- All PRs merged, CI green, deployed SHAs verified in the served build
  stamp; shared-db migrations show in the production ledger.
- STATUS table updated; superseded plans point here; #706 and #663 closed
  with live-proof boxes ticked.

**Risks and rollback**
- Hybrid PopSG slower than 3 s: keep `POPSG_SEARCH_MODE=keyword` (instant
  rollback, no deploy) and open a shared-db latency issue with the EXPLAIN.
- GPU box offline: alarm fires within 2 h; DAM search keeps working on stale
  vectors (keyword leg unaffected).
- Reset RPC floods the queue: bounded to 5,000 per call.

**Open questions**
- O1 and O2 in §8, decided by their rules.
- Whether DAM descriptive queries need a text-side rerank (a later model
  plan) — the scorecard decides; not this plan.

---

## Self-audit (Nov 4, 2026, 5:10 PM EST)

1. *Could a fresh session execute this without asking?* Yes: §2 names repos,
   hosts, tables and the model; §5 gives live numbers with re-derive SQL and
   `file:line` anchors; every step in §9 names files, RPCs, config keys and a
   gate; §12 names access by location.
2. *Does it carry every piece of background, including what was ruled
   out?* Yes: §3 and §6 record the five root causes with issue evidence; §7
   lists eight rejected approaches with reasons; §8 separates locked from open
   decisions with rules.
3. *Is the goal clear enough to steer by when a step is wrong?* Yes: §1 is in
   business words with the "goal wins" instruction, and D6 ties activation to
   the scorecard rather than to any step's letter.

Gap found and fixed during audit: Step 0 originally lacked the instruction
not to touch objects claimed by the two running sessions; added.
