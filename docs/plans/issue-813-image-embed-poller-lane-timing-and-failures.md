---
summary: "Issues #813 and #1049 plan: GPU poller batch sizing, picture searches served in every lane, text-lane cooldown on systemic failure. Read STATUS first."
kind: plan
status: open
read-when: "changing apps/image-embed-worker lane timing, batch tuning, query-lane interleaving or text-lane failure handling; resolving #813 or #1049"
---

# Plan: GPU poller lane timing and failure handling (u2giants/popdam3#813, #1049)

Issues: [#813](https://github.com/u2giants/popdam3/issues/813) (review of PR #811) and [#1049](https://github.com/u2giants/popdam3/issues/1049) (review of PR #1046).
Handoff: [HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md](../../HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md)
Written 2026-11-25 by Claude (plan only; nothing implemented). Facts checked on `origin/main` `787c20b8`.

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Re-confirm the five open findings on current `main` | ⬜ open | |
| 2 | Tune the PopSG batch from rows actually processed, timing only the lane's own work | ⬜ open | |
| 3 | Serve picture searches between saves in the DAM lane too | ⬜ open | |
| 4 | Make the between-saves test deterministic | ⬜ open | |
| 5 | Text lane: systemic failures become one lane error and a cooldown | ⬜ open | |
| 6 | README correction | ⬜ open | |
| 7 | PR, merge, deploy to edge-dev, live proof, issue checklist | ⬜ open | |

**Where a fresh session starts:** step 1. Steps 2–6 are one PR. Step 7 needs the PR merged.

---

## 1. The ultimate goal

PopDAM and PopSG let POP Creations staff find artwork by what it looks like and what it means. A GPU computer ("the poller") turns every thumbnail and every catalog description into numbers ("vectors") that power that search, and it also answers live "find pictures like this upload" requests. When this plan is done:

- the poller indexes the PopSG style-guide library at the fastest steady pace the GPU allows, without overshooting its 20-second round budget when only a few slow documents remain;
- a person who uploads a picture to search never waits for a whole batch of background indexing in any lane;
- if the text-meaning model or its database functions break, the poller logs one clear error, pauses that lane for ten minutes, and does **not** burn through every document's retry allowance.

**If a step conflicts with this goal, the goal wins: stop and flag it.**

## 2. What this application is

- **PopDAM** (https://dam.designflow.app) is POP Creations' internal library of licensed consumer-product artwork. **PopSG** (https://sg.designflow.app) is the licensor style-guide library served by the same code base. Repo: [u2giants/popdam3](https://github.com/u2giants/popdam3), release branch `main` (protected; branch + PR).
- **The poller** is `apps/image-embed-worker/image_embed_poller.py` (Python, PyTorch, psycopg). It runs on the Windows GPU desktop **edge-dev** (RTX 3060 Ti) under Task Scheduler (`PopDAM-ImageEmbedWorker`, `run_service.cmd`), from a copied folder `D:\ai\popdam-image-embed-worker` — it is **not** deployed by CI. Runbook: `apps/image-embed-worker/README.md` §"Install on a GPU Windows box".
- It connects directly to the shared Supabase Postgres (`qsllyeztdwjgirsysgai`) as login role `dam_image_embed_login` (member of `dam_image_embed_worker`) and runs four lanes in one loop (`run_service`, around `image_embed_poller.py:790-835`):
  - **query lane** — live uploaded-image searches, polled every `QUERY_POLL_S = 1.0` s (`config.py:33`);
  - **DAM search lane** — `dam_search_documents` thumbnails, batch 64;
  - **SG search lane** — PopSG `style_guide_search_documents` thumbnails, batch auto-sized 1–32 (`config.py:67-70`);
  - **text lane** — catalog text into `dam.search_text_vectors` with `Qwen/Qwen3-Embedding-0.6B` (#1037).
- A second "text-only" box mode exists (`run_text_only`, ~`:836-857`) and shares the text lane code.

## 3. What triggered this work

Two advisory AI reviews of merged PRs (reviews are advice only; `fixer-deferred` means the automatic fixer could not edit merged source, not that anything was fixed):

- **#813** (Muse review of PR #811 "size indexing batches to a round budget", head `facae27f`): four findings — the SG tuner divides by the *requested* batch, the timing includes query-lane work, only SG serves queries between saves, and a wall-clock test.
- **#1049** (DeepSeek review of PR #1046 "text-meaning lane", head `093d9604`): (High) systemic failures never trip the text-lane cooldown and the README says they do; (High) the database objects the lane calls did not exist.

No production incident has been reported from either; these are correctness and resilience gaps found by review.

## 4. Scope

In:
- #813 findings 1–4.
- #1049 finding 1 (systemic failure handling, README contradiction, `text_mark_error` swallowing its own failure into a hot loop).
- #1049 finding 2 is **already resolved** (see §5); this plan only records the evidence.

### NOT in this plan
- Any database change (claim RPCs, attempt counters, grants). If step 5 shows a database change is needed, stop and open it in `popcre/shared-db`.
- Changing batch sizes, poll cadences or the 600 s cooldowns in `config.py` beyond what a step names.
- The same "embed failure marks every row transient" shape in the **picture** lanes (`process_search_batch`, `:631-637`). The reviewer called it inherited; it is left as is unless step 5's helper can be reused with no behaviour change for those lanes (judgment call, see step 5).
- Adding the poller's Python tests to GitHub CI (no Python job exists in `.github/workflows/ci.yml`; the text-embed plan [issue-1043](issue-1043-text-embed-service-hardening.md) handles CI for a different service). Tests run locally on edge-dev in this plan.
- Any change to the text-embed service (`apps/text-embed`) or the edge function.

## 5. Current state of the code (origin/main `787c20b8`)

- `tune_sg_batch(self, elapsed, claimed)` at `image_embed_poller.py:542-545`: `per_doc = max(elapsed,1e-3)/max(claimed,1)`; `fit = SG_SEARCH_ROUND_BUDGET_S / per_doc`; clamped to `[SG_SEARCH_CLAIM_BATCH, SG_SEARCH_CLAIM_BATCH_MAX]` = `[1, 32]`.
- Its caller, `run_service` ~`:816-822`: `claimed_before = self.sg_batch`, then `poll_search_lane(self.claim_sg_docs, lane="sg")`, then `self.tune_sg_batch(time.time() - last_sg, claimed_before)`. So (a) the divisor is the *requested* size, not `len(rows)`; (b) `elapsed` spans the whole `poll_search_lane` call, which includes `serve_query_lane_between_saves()` work.
- `poll_search_lane` (`:658-670`) claims `rows`, runs `process_search_batch(rows)`, logs `claimed=len(rows)` and returns only a string status; the row count is not returned.
- `process_search_batch` (`:605-656`): at the end of each save, `if row[0] is None: self.serve_query_lane_between_saves()` — `row[0]` is `document_type`, which is `None` only for SG rows. DAM rows (batch 64) never serve the query lane mid-batch.
- `serve_query_lane_between_saves` (`:547-560`) throttles itself by `time.time() - self.last_query_poll < QUERY_POLL_S`.
- Test `test_query_lane_is_served_between_saves` (`tests/test_image_embed_poller.py:399-407`) calls it twice back-to-back and asserts only one job; it depends on the real clock.
- Text lane: `process_text_batch` (`:712-749`) raises only for a model-stamp mismatch; an exception from `self.text_embedder.embed(...)` (which also lazily **loads** the model) marks every row `transient` (`:729-734`); an exception from `text_upsert` marks that row `transient` (`:745-747`). `text_mark_error` (`~:685-699`) catches and logs `text_mark_error_failed`. `poll_text_lane` (`:751-770`) returns `"error"` only for a claim failure or the stamp `RuntimeError`. After `"claimed"` the loop re-polls every `TEXT_POLL_S = 2.0` s (`config.py:83`).
- README `apps/image-embed-worker/README.md:51` says: "A missing grant or RPC logs one `text_lane_error`, cools down 10 minutes and retries" — true only for the claim RPC.
- **#1049 finding 2 is resolved:** the text-lane database objects now exist in the vendored mirror: `shared-db/supabase/migrations/20261204001000_dam_search_text_vectors.sql` and `20261204003429_dam_search_text_vectors_reissue.sql` (table `dam.search_text_vectors`, the three `*_dam_search_text_embedding*` RPCs). Nothing to build for it.

## 6. Key findings and root cause

1. **Tuner divisor** (#813-1). Example from the review: request 32, receive 2 slow rows taking 20 s → true 10 s/doc should tune to 2; the code computes 20/32 = 0.625 s/doc and stays at 32, overshooting the next round 16×. Cause: the caller passes `claimed_before` (requested), because `poll_search_lane` does not return the count.
2. **Polluted timing** (#813-2). `elapsed` includes the query-lane work done between saves, so under query load the SG batch shrinks for the wrong reason.
3. **DAM lane starves queries** (#813-3). Only SG rows trigger between-saves serving; a 64-row DAM batch can delay an uploaded-image search for its full duration. No document explains the asymmetry; PR #811's description was about SG only, so it was an omission, not a decision.
4. **Flaky test** (#813-4). Wall-clock throttle with no clock mock.
5. **Hot loop on systemic text failure** (#1049-1). Model load failure, GPU OOM, or a missing/changed `upsert_`/`mark_` RPC (`psycopg.errors.UndefinedFunction` / `InsufficientPrivilege`, both subclasses of `psycopg.ProgrammingError`) are converted into per-row `transient` marks; the lane returns `"claimed"` and re-polls in 2 s forever, consuming each document's attempt allowance. If `mark_dam_search_text_embedding_error` itself is missing, every row logs `text_mark_error_failed` and nothing is ever marked, so the same rows are re-claimed after their 600 s lease.

## 7. Approaches considered and REJECTED

| Approach | Why rejected |
|---|---|
| Keep passing the requested size but floor `per_doc` | Still wrong on short claims; the real count is available. |
| Measure SG time by subtracting a global "query time" counter from wall time | Fragile; simpler to time only the SG processing and exclude the serve calls explicitly (step 2). |
| Move between-saves serving into a background thread | The poller is deliberately single-threaded on one GPU; concurrency would race the CUDA context and connection. |
| A consecutive-batch-failure circuit breaker only | Treats symptoms; a model-load or missing-function error is knowable on the first occurrence. Use it only as the backstop (step 5c). |
| Pre-flight probe of the three text RPCs at startup | They can be revoked later; the runtime classification in step 5 covers both. |
| Fix the database to stop counting attempts on transient errors | Out of scope and a shared-db change; the poller should not cause the churn in the first place. |

## 8. Design decisions

- **LOCKED** (from PR #811 and config): SG round budget 20 s, SG batch range 1–32, DAM batch 64, cooldowns 600 s (all ≤ 30 minutes, per owner rule 2026-11-20).
- **LOCKED** (#1037 plan): never write a vector under a different model stamp; empty inputs are `permanent`; over-long inputs are truncated, never failed.
- **LOCKED here:** a *systemic* text failure is one where nothing about the individual row is at fault: model load failure, CUDA OOM on the whole batch, `psycopg.ProgrammingError` (missing function / privilege) from upsert or mark, or a connection-level `psycopg.OperationalError`. Systemic → do not mark rows, log one `text_lane_error`, return `"error"` (lane cools down 600 s). Leases expire on their own and the rows return to the queue unconsumed.
- **OPEN (implementer judgment):** whether to apply the same classification to the picture lanes' embed-batch failure. Criteria: do it only if it is the same helper, the existing picture-lane tests stay green unchanged, and the change is called out in the PR. Otherwise leave it.

## 9. The plan

### Step 1 — Re-confirm on current main (`lead-only`: decides whether later steps still apply)
Re-read the five locations in §5 on fresh `origin/main`. If any finding has been fixed by someone else, mark that step "n/a — fixed in <sha>" in STATUS and skip it.
**Gate:** each §5 citation re-verified or updated in this file.

### Step 2 — Tune from real work (`helper-ok`: exact edits named)
- Change `poll_search_lane` (`:658-670`) to record `self.last_lane_rows = len(rows)` (0 when empty) and `self.last_lane_work_s` = seconds spent in `process_search_batch` **minus** time spent inside `serve_query_lane_between_saves`. Implement by having `serve_query_lane_between_saves` add its own elapsed time to `self.query_serve_s` and taking the difference across the batch.
- In `run_service` (~`:816-822`) call `self.tune_sg_batch(self.last_lane_work_s, self.last_lane_rows)` only when `status == "claimed"` and `self.last_lane_rows > 0`. Delete `claimed_before`.
- Behaviour: a 2-row claim taking 20 s of SG work tunes to 2; query work never shrinks the SG batch.
**Gate:** new tests `test_sg_tuner_uses_rows_returned_not_requested` and `test_sg_tuner_excludes_query_lane_time` pass (§10).
**Stop-and-ask trigger:** if `run_drain` or `run_text_only` also call `tune_sg_batch` or rely on `claimed_before`, bring it back.

### Step 3 — DAM lane serves queries between saves (`helper-ok`)
In `process_search_batch` (`:654-655`) remove the `if row[0] is None:` condition so every save calls `serve_query_lane_between_saves()`. The method's own `QUERY_POLL_S` throttle keeps the cost to at most one claim per second. Do **not** call it in `run_drain` mode: drain never touches the query lane (docstring ~`:860`), so guard with the existing mode flag — check how `serve_query_lane_between_saves` already exits for `text_only` (`:549-550`) and add the same early return for drain mode (`self.args.once_drain` or the actual attribute name).
**Gate:** `test_dam_batch_serves_query_lane_between_saves` and `test_drain_mode_never_serves_query_lane` pass.
**Stop-and-ask trigger:** if the drain-mode attribute does not exist under an obvious name.

### Step 4 — Deterministic throttle test (`helper-ok`)
Rewrite `test_query_lane_is_served_between_saves` (`tests/test_image_embed_poller.py:399-407`) to `monkeypatch.setattr(image_embed_poller.time, "time", fake)` with a controllable clock: call at t=100.0 → one job; t=100.5 → still one; t=101.1 → two. Use the module-level `time` reference actually imported by the poller.
**Gate:** the test passes 20 times in a row: `python -m pytest -q tests/test_image_embed_poller.py -k between_saves --count 20` if `pytest-repeat` is installed, otherwise a shell loop of 20 runs.

### Step 5 — Text lane systemic failures (`lead-only`: reshapes failure logic that decides whether documents lose retries)
a. Add `class TextLaneSystemicError(RuntimeError)`. In `process_text_batch`:
   - wrap `self.text_embedder.embed(...)`: on `torch.cuda.OutOfMemoryError`, `OSError`/`EnvironmentError` from model loading, or any exception raised while `not self.text_embedder.loaded` → raise `TextLaneSystemicError` (do not mark rows). Any other embed exception keeps the current per-row `transient` marking (a genuinely bad batch).
   - wrap `self.text_upsert(row, vec)`: `psycopg.ProgrammingError` or `psycopg.OperationalError` → raise `TextLaneSystemicError` immediately (stop the batch; remaining rows stay leased and return when the lease lapses). Other exceptions keep per-row `transient`.
b. `text_mark_error`: re-raise `psycopg.ProgrammingError` as `TextLaneSystemicError` instead of swallowing it; keep swallowing anything else (logged once per row as today).
c. Backstop: count consecutive batches in which **every** row failed (`text_done` unchanged and `text_failed` grew by the batch size); at 3 in a row raise `TextLaneSystemicError`. Reset on any success.
d. `poll_text_lane` (`:751-770`): `except RuntimeError` already catches the subclass; log `text_lane_error` with `kind="systemic"` vs `"stamp"` and return `"error"`. Both `run_service` (~`:823-829`) and `run_text_only` (~`:848-852`) already cool down on `"error"` for `TEXT_LANE_ERROR_COOLDOWN_S = 600` s.
**Gate:** tests `test_text_model_load_failure_cools_down_without_marking_rows`, `test_text_upsert_missing_function_cools_down`, `test_text_mark_error_missing_function_cools_down`, `test_text_three_all_failed_batches_trip_cooldown`, `test_text_single_bad_row_still_marked_transient` pass, and the existing text-lane tests (`tests/test_image_embed_poller.py:467-605` region) stay green.

### Step 6 — README (`helper-ok`)
Replace the sentence at `apps/image-embed-worker/README.md:51` "A missing grant or RPC logs one `text_lane_error`…" with: a missing grant or RPC on claim, save or error-marking, a model that will not load, or three wholly failed batches in a row log one `text_lane_error` (`kind` systemic or stamp), pause the text lane for 10 minutes and leave the documents' retry counts untouched; other lanes keep working. In the SG paragraph (`:49`) say uploaded-image searches are served between saves in **both** picture lanes and that the SG batch is sized from the documents actually processed, excluding query time.
**Gate:** `git diff` shows only those sentences changed.

### Step 7 — Land and prove (`lead-only`: live proof)
1. Branch `claude/poller-lane-timing-813-1049`, PR to `main`, body "Fixes #813, fixes #1049" plus the test run output; merge when required checks pass (reviews are advisory).
2. Deploy to edge-dev per README §"Install" step 1 (update the copied folder from `main`), then end and restart the `PopDAM-ImageEmbedWorker` task. Run `--selftest` first (expect `"ok": true`, `"device": "cuda"`).
3. Live proof (read-only SQL as postgres via Supabase MCP `execute_sql`, project `qsllyeztdwjgirsysgai`): the poller log shows `search_batch lane=sg` lines whose next claim size tracks the real per-document time; `select * from public.get_dam_search_text_embedding_status()` shows the text lane progressing; no `text_mark_error_failed` floods in the log.
4. Post the proof on #813 and #1049, tick their live-proof checkbox, and close them.
**Gate:** both issues closed with a comment citing the merge SHA and the log/SQL evidence.

## 10. Tests required

File `apps/image-embed-worker/tests/test_image_embed_poller.py` (reuse the existing `_search_poller(monkeypatch, rows)` fixture and the text-lane fixtures near `:467`):
- `test_sg_tuner_uses_rows_returned_not_requested` — sg_batch 32, claim returns 2 rows, fake clock advances 20 s of work → `sg_batch == 2`.
- `test_sg_tuner_excludes_query_lane_time` — 4 rows, 4 s SG work + 10 s spent inside a stubbed query serve → tunes from 4 s, not 14 s.
- `test_dam_batch_serves_query_lane_between_saves` — DAM rows (`document_type='asset'`), stubbed clock past `QUERY_POLL_S` between saves → query job processed mid-batch.
- `test_drain_mode_never_serves_query_lane`.
- rewritten `test_query_lane_is_served_between_saves` (mocked clock).
- `test_text_model_load_failure_cools_down_without_marking_rows` — embedder `embed` raises `OSError` while unloaded → `poll_text_lane() == "error"`, zero `mark_` calls.
- `test_text_upsert_missing_function_cools_down` — upsert raises `psycopg.errors.UndefinedFunction` → `"error"`, no further upserts in the batch.
- `test_text_mark_error_missing_function_cools_down`.
- `test_text_three_all_failed_batches_trip_cooldown`.
- `test_text_single_bad_row_still_marked_transient` — one row's upsert raises `ValueError` → that row marked transient, others saved, status `"claimed"`.

Must stay green: `cd apps/image-embed-worker && .venv\Scripts\python -m pytest -q tests` on edge-dev (or any machine with `requirements.txt` installed; the tests monkeypatch the models). Record the pass count in the PR.

## 11. Constraints, standing rules and gotchas

- Branch + PR; never push to `main`. The AI merges; reviews are advisory.
- No database DDL anywhere in this repo (shared-db gatekeeper, `AGENTS.md` → Standing rules).
- No hold, cooldown or retry delay over 30 minutes (owner rule 2026-11-20). The 600 s values comply.
- The poller is a copied folder on edge-dev, not CI-deployed: merging does nothing live until step 7.2.
- `nvidia-smi` lies over RDP; trust `--selftest` / `torch.cuda.is_available()` (README step 4).
- Never put the DSN (`worker.dsn`) or stamp files in git or chat.
- `row[0] is None` means "SG row" only because SG claims return no document type; do not reuse that check elsewhere.
- Keep the text lane's stamp guard exactly as is.

## 12. Access and environment

- GitHub: `gh` authenticated as `u2giants` for `u2giants/popdam3`.
- edge-dev: reachable over the user's normal remote access; the worker folder is `D:\ai\popdam-image-embed-worker` with its `.venv`. Task name `PopDAM-ImageEmbedWorker`.
- Database reads: Supabase MCP (`execute_sql`, read-only queries only) on project `qsllyeztdwjgirsysgai`.
- Worker DSN: 1Password vault `vibe_coding`, the item holding the `dam_image_embed_login` pooler DSN (search the vault for "image embed"); never print it.

## 13. Definition of done, risks and open questions

Done when all are true:
- [ ] Steps 2–6 merged to `main` (SHA recorded in STATUS) with the §10 tests passing (run output in the PR).
- [ ] edge-dev runs the merged code (`--selftest` ok; service restarted; log line shows the new `kind` field on any lane error).
- [ ] Live proof posted on #813 and #1049; both closed.
- [ ] This plan's STATUS updated with artifacts; the handoff marked done.

Risks: misclassifying a per-row error as systemic would pause the text lane needlessly (10 minutes, then retry — recoverable). Serving queries in the DAM lane adds at most one claim per second to a batch (negligible). Rollback: restore the previous folder copy on edge-dev and restart the task; revert the PR.

Open: whether to extend the classification to picture lanes (§8 criteria).

## Self-audit (Mode A)

1. *Could a brand-new session execute this without asking?* Yes — §2 explains the poller, its lanes and where it runs; §5 gives exact lines; §9 names every edit, gate and test; §12 gives access. Gap found during drafting: drain-mode guard attribute name not verified — handled as an explicit stop-and-ask trigger in step 3.
2. *Does it carry all background, including what was ruled out?* Yes — §3 the two reviews, §6 root causes with the worked example, §7 rejected options, §5 records that #1049 finding 2 is already resolved with migration names.
3. *Is the goal clear enough for judgment calls?* Yes — §1 states the three outcomes in business terms; §8 separates locked from open decisions with criteria.

## Lead launch prompt

```text
You are the lead for u2giants/popdam3 issues #813 and #1049. Read AGENTS.md, then docs/plans/issue-813-image-embed-poller-lane-timing-and-failures.md (STATUS first) and HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md. Work in your own worktree on a branch from origin/main.
You do steps 1, 5 and 7 yourself. Hand steps 2, 3, 4 and 6 to your helper, in that order, one at a time, then review each diff and run the tests yourself.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: return finished work or an evidenced blocker; make no design decisions; never merge, push to main or post on GitHub; when a step's stop-and-ask trigger fires, bring it to you; if stuck 30 minutes, you take the step back.
Checks you run yourself: the full poller test suite, the §10 test names present and passing, the diff limited to image_embed_poller.py, tests and README, then step 7 deploy and live proof. Update STATUS with artifacts at each step.
```
