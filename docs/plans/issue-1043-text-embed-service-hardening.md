---
summary: "Issues #1043, #876, #1050, #871 plan: text-embed fails safely, is tested before deploy, has a measured CPU budget and true docs. Read STATUS first."
kind: plan
status: open
read-when: "changing apps/text-embed (main.py, Dockerfile, requirements, tests, publish workflow) or its docs; resolving #1043, #876, #1050 or #871"
---

# Plan: text-embed service hardening (u2giants/popdam3#1043, #876, #1050, #871 findings 3–4)

Issues: [#1043](https://github.com/u2giants/popdam3/issues/1043) (review of PR #1042), [#876](https://github.com/u2giants/popdam3/issues/876) (review of PR #875), [#1050](https://github.com/u2giants/popdam3/issues/1050) (review of PR #1047), [#871](https://github.com/u2giants/popdam3/issues/871) findings 3–4 (review of PR #870). #871 findings 1–2 live in [issue-868-query-embedding-edge-hardening.md](issue-868-query-embedding-edge-hardening.md); #871 closes only when both plans are done.
Handoff: [HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md](../../HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md)
Written 2026-11-25 by Claude (plan only; nothing implemented). Facts checked on `origin/main` `787c20b8`.

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Baseline: live `/health`, container limits, host cores, current p50/p95 | ⬜ open | |
| 2 | Text-meaning (Qwen) failure on a request degrades to "no text vectors", never a 500 | ⬜ open | |
| 3 | Startup assertions; remove `torch.compile` or make it safe | ⬜ open | |
| 4 | Query prefix decision (space after `Query:`) | ⬜ open | |
| 5 | Tests that prove the fast path and the token cap | ⬜ open | |
| 6 | Split runtime vs test dependencies; bound `transformers` | ⬜ open | |
| 7 | Run the test suite inside the built image before push/deploy | ⬜ open | |
| 8 | Measure and set workers × threads; correct the Dockerfile comment | ⬜ open | |
| 9 | Correct the "serialises" docs | ⬜ open | |
| 10 | PR, merge, verify deploy, live proof, close issues | ⬜ open | |

**Where a fresh session starts:** step 1. Steps 2–7 and 9 are one PR. Step 8 needs step 1's measurements and may ride the same PR or a second one.

---

## 1. The ultimate goal

When a POP Creations employee types words into PopDAM search, the words are turned into two kinds of vectors by a small CPU service (**text-embed**): a picture-matching one (SigLIP2) and a meaning one (Qwen3). When this plan is done:

- a fault in the newer meaning model can never take down picture search when the administrator has switched the meaning leg off — the off switch is a real rollback;
- a broken library upgrade is caught by tests **before** the image reaches production;
- the service's CPU use is a measured, recorded choice that leaves headroom for the PopDAM website on the same server;
- its docs describe what actually runs.

**If a step conflicts with this goal, the goal wins: stop and flag it.**

## 2. What this application is

- **PopDAM** (https://dam.designflow.app) — POP Creations' internal licensed-artwork library; **PopSG** (https://sg.designflow.app) — the style-guide library from the same code. Repo [u2giants/popdam3](https://github.com/u2giants/popdam3), release branch `main` (protected).
- **text-embed** is `apps/text-embed/` (FastAPI + PyTorch CPU). It runs on the Hetz VPS under Coolify at `https://text-embed.designflow.app`. Image `ghcr.io/u2giants/popdam-text-embed:<short-sha>` and `:latest`, built and deployed by `.github/workflows/publish-text-embed.yml` on any push to `main` touching `apps/text-embed/**` (build → push → Coolify deploy webhook; no test step).
- Endpoints (`apps/text-embed/main.py`): `GET /health`; `POST /embed-text` (one text, SigLIP2 only); `POST /embed-text-batch` (≤16 texts → SigLIP2 `vectors` [768] **and** Qwen3 `text_vectors` [1024]). Auth header `X-Embed-Key`.
- Caller: Supabase edge function `supabase/functions/dam-search-ai` (`index.ts:330-400` transport, `_shared/query-embed-batch.ts`). When admin_config `SEARCH_TEXT_LEG_MODE` is `on` the search needs `text_vectors` and answers 503 without them (owner decision D4 in [issue-1037 plan](issue-1037-typed-search-meaning-matching.md)); when `off` it uses only `vectors`. The leg has been **on** since Nov 18, 2026, 8:20 PM EST (issue-1037 plan STATUS row 6).

## 3. What triggered this work

Advisory AI reviews of merged PRs (advice only; `fixer-deferred` = not fixed):

- **#1043** (PR #1042 "Qwen3 text-meaning query vectors", head `4ce78d5a`): (1) Qwen is a hard dependency — import-time load and request-time failure 500 the whole batch, so picture search 503s; (2) no test gate before deploy, test deps shipped in the runtime image, `transformers` unbounded; (3) tests do not prove the prefix-cache fast path ran, and the "truncated" test only checks vector length; (4) prefix `Query:` lacks the model card's trailing space; Step 0 completion unverified.
- **#876** (PR #875 "torch.compile and inference_mode", head `cce21487`): `torch.compile` is lazy so the import-time `try/except` protects nothing; the slim image has no C++ compiler for CPU Inductor; `mode="reduce-overhead"` targets CUDA graphs and each worker pays a compile on the first live query.
- **#1050** (PR #1047 "4 torch threads per worker", head `c020dc43`): Dockerfile comment cited unverifiable numbers; 2 workers × 4 threads can occupy all 8 cores of a host that also serves the DAM site; docs say "serialises".
- **#871** findings 3–4 (PR #870, head `6dad9a3d`): docs say requests are serialised although two workers run; two workers double model memory and the thread budget is unvalidated.

## 4. Scope

In: every finding listed in §3.

### NOT in this plan
- Edge-function behaviour (whitespace lookup, chunking to 16, cache keys, name expansion) — [issue-868 plan](issue-868-query-embedding-edge-hardening.md).
- Changing models, dimensions, or the 16-text / 8000-character limits.
- Turning `SEARCH_TEXT_LEG_MODE` off or on (owner-level rollback lever, not a plan step).
- A GPU deployment of text-embed.
- Re-embedding documents. **Exception, see step 4:** if the prefix changes, query vectors change; document vectors (no prefix) do not.

## 5. Current state of the code (origin/main `787c20b8`)

- `main.py:42-49`: SigLIP2 loaded at import; on CPU, `_model = torch.compile(_model, mode="reduce-overhead")` inside `try/except: pass`.
- `main.py:51-67`: Qwen tokenizer/model loaded at import (`padding_side="left"`, fp32), prefix KV cache computed at import with `torch.inference_mode()`. `_pool = ThreadPoolExecutor(max_workers=1)`.
- `main.py:37`: `QUERY_PREFIX = "Instruct: Given a product search query, retrieve matching product descriptions\nQuery:"`; `query_text_for` (`:108-109`) appends the text with no space. `test_main.py:33` `test_query_prefix_exact` pins this.
- `main.py:112-143` `_embed_query_texts` (fast path, reuses prefix cache) falls back to `_embed_query_texts_full` (`:145-160`) when the tokenized prefix does not match; nothing records which path ran. `_text_tokenizer.pad_token_id` used at `:124` with no startup check.
- `main.py:205-235` `/embed-text-batch`: submits Qwen to the pool, runs SigLIP2, `text_future.result()` — any exception becomes HTTP 500; dims checked after.
- `main.py:70-82`: per-item 8000-char bound and `max_length=16` items already enforced (#868 finding 2 is fixed, issue #1105).
- `requirements.txt`: `fastapi>=0.115.0`, `uvicorn[standard]>=0.32.0`, `transformers>=5.20.0`, `torch>=2.6.0`, `pillow>=10.0.0`, `pytest>=8.0.0`, `httpx>=0.27.0` — test deps in runtime, no upper bounds.
- `Dockerfile`: `python:3.12-slim`, installs only `ca-certificates curl` (no compiler); bakes both models; `COPY main.py test_main.py`; `ENV OMP_NUM_THREADS=4 MKL_NUM_THREADS=4`; `uvicorn ... --workers 2`; comment (lines ~27-31) cites "p95 from ~690 to ~500 ms on the 8-core host". The Qwen part of the comment is now true (Step 5 of #1037 landed); the numbers and core count are recorded nowhere else.
- `README.md` (text-embed): says each worker holds both models, about 4 GB resident; tests run with `docker build -t te-test apps/text-embed && docker run --rm te-test python -m pytest -q test_main.py`.
- `docs/INFRASTRUCTURE.md:58`: "The service answers one CPU forward pass per request and serialises concurrent requests" — false with 2 workers. `supabase/functions/_shared/query-embed-batch.ts:1-12` header repeats the claim.
- `publish-text-embed.yml`: no test step; deploy webhook fires right after push.
- `test_main.py` tests: health, key, prefix, batch shape, padding invariance, `test_prefix_cache_matches_full_forward` (`:58`), `test_long_query_truncated` (`:64`), limits.

## 6. Key findings and root cause

1. **Leg-off is not a rollback.** Because the batch route always computes Qwen and 500s on any Qwen error, setting `SEARCH_TEXT_LEG_MODE=off` does not protect picture search from a Qwen fault. With the leg on, failing the search is correct (D4); the defect is only the off case and the 500 shape.
2. **`torch.compile` is a latent outage.** Inductor compiles on first forward; the slim image lacks `gcc/g++`, so CPU codegen can raise on the first live query in each worker, after the guard. `reduce-overhead` gives CPU no benefit. PR #875 recorded no measured gain.
3. **No pre-deploy test.** The fast path depends on `transformers` cache internals (`batch_repeat_interleave`, `copy.deepcopy` of the cache) with no upper bound pin; an upstream release can break every batch with nothing catching it before production.
4. **Tests can pass with the fast path dead**, because `_embed_query_texts` silently falls back.
5. **CPU budget unrecorded.** 2 × 4 threads may equal all host cores; the Coolify container CPU limit and the host core count are not in the repo.

## 7. Approaches considered and REJECTED

| Approach | Why rejected |
|---|---|
| Load Qwen lazily on first request | Moves the startup failure onto a live query; startup failure should be loud and early (health check fails, Coolify keeps the old container). |
| Separate Qwen into its own service | More moving parts; the single batched call is deliberate for latency (#804: one round trip). |
| Keep `torch.compile` with `mode="default"` and a warm-up | Possible, but needs a compiler in the image and a measured win; default to removal unless step 3's measurement shows ≥15% p95 gain (judgment criterion). |
| Run pytest in a separate CI job without the image | The models are baked into the image; testing outside it does not test what ships. |
| Change the prefix without checking document vectors | Query-side only change is safe for documents (they carry no prefix) but shifts score distributions; the 0.45 floor and 0.0925 margin were tuned on the current prefix. |

## 8. Design decisions

- **LOCKED** (#1037 D4): with the text leg on, a missing text vector fails the search with Retry; never a silent keyword or picture-only downgrade. This plan keeps that behaviour — the edge already treats `text_vectors` missing as failure when the leg is on.
- **LOCKED:** model ids, revisions and dims (`main.py:28-36`); 16 texts per batch; 8000 chars per text.
- **LOCKED here:** Qwen failure at request time → `text_vectors: null` + `text_error` field + log line `text_leg_failed`, HTTP 200 with SigLIP2 vectors. Qwen failure at **startup** stays fatal.
- **OPEN:** prefix space (step 4 criteria); `torch.compile` keep/remove (step 3 criterion); final workers × threads (step 8 criteria).

## 9. The plan

### Step 1 — Baseline (`lead-only`: live measurement judgment)
Record in STATUS: `curl -s https://text-embed.designflow.app/health` (model stamps); host cores and container limits via the Coolify API or dashboard for app UUID in GitHub secret `COOLIFY_TEXT_EMBED_APP_UUID` (read-only); memory used per container; and a latency sample: 50 sequential and 50 two-concurrent `/embed-text-batch` calls with 3 short texts each (key from 1Password, see §12), p50/p95. Save the raw timing CSV under `docs/verification/text-embed-<date>/` (no keys, no licensed text — use generic words like "red mug").
**Gate:** STATUS row 1 cites the CSV path.

### Step 2 — Qwen request failure degrades (`lead-only`: changes the production failure contract)
In `embed_text_batch_route` (`main.py:205-235`): wrap `text_future.result()` and the text-dim check; on exception or bad dims set `text_vectors = None`, `text_error = "<ExceptionName>"`, log `{"event":"text_leg_failed","error":...}` to stderr; return 200 with `vectors` valid and `"text_vectors": null`. SigLIP2 failure still 500s.
Then confirm the edge treats `text_vectors: null` as missing: `supabase/functions/dam-search-ai/index.ts` transport parses `payload.text_vectors` (~`:359-390`) and `query-embed-batch.ts` `embedAllWithText` sets meaning `null` when `textVectors?.[index]` is missing → with leg on, `index.ts` returns 503 (D4). If the transport instead marks the whole outcome `failed` on a null `text_vectors`, adjust the transport so null text vectors leave picture vectors usable (only when the leg is off it matters).
**Gate:** tests `test_batch_qwen_failure_returns_picture_vectors` (service) and edge test "text leg off: null text_vectors still searches with pictures" / "text leg on: null text_vectors answers 503" pass.

### Step 3 — Startup checks and `torch.compile` (`helper-ok` for the edit; the keep/remove judgment is the lead's)
- After loading Qwen: `assert _text_tokenizer.pad_token_id is not None` with a clear message.
- Remove the `torch.compile` block (`main.py:45-49`) unless step 1's lead measured, with compile on `mode="default"` plus a startup warm-up forward and a compiler installed, ≥15% lower p95. If kept: install `build-essential` in the Dockerfile, warm up inside a `try` that reverts `_model` to eager on failure, and log which mode is active in `/health` (`"compiled": true|false`).
- Keep `@torch.inference_mode()`.
**Gate:** `test_health_reports_compile_state` (if kept) or no `torch.compile` in `main.py` (`grep -n "torch.compile" apps/text-embed/main.py` empty).
**Stop-and-ask trigger:** helper finds the measurement missing — bring it back, do not decide.

### Step 4 — Query prefix (`lead-only`: changes ranking)
Compare `"...\nQuery:"` vs `"...\nQuery: "` on the private scorecard (`docs/SEARCH_EVAL.md`, set in admin_config `SEARCH_EVAL_SET_V1`): run the eval with the current image, then with a dark build exposing the spaced prefix only through a temporary env flag `QUERY_PREFIX_SPACE=1` on a **local** container pointed at by a local edge run — never production. Criterion: switch only if PopDAM passes ≥ the current 137/137 and text-leg top-10 precision does not drop. Otherwise keep the current prefix and add a code comment citing this comparison and the #1043 finding. Either way update `test_query_prefix_exact` to pin the chosen string and remove the temporary flag.
**Gate:** STATUS row 4 cites the two eval report files and the decision.
If a local edge run is impractical, keep the current prefix, record why, and close the finding as "deliberate: floor and margin were tuned on this prefix" — that is acceptable under the goal.

### Step 5 — Tests that prove behaviour (`helper-ok`)
In `apps/text-embed/test_main.py`:
- add a module counter (e.g. `main._fast_path_hits`) incremented in `_embed_query_texts` when the fast path runs; `test_fast_path_is_used_for_normal_queries` asserts it increments for `["red mug","blue frame"]`;
- `test_long_query_truncated` → assert the tokenized length passed to the model is `≤ len(_prefix_ids) + TEXT_MAX_TOKENS` (monkeypatch `_text_model.__call__` or the tokenizer to capture `input_ids.shape[1]`), not just vector size;
- `test_batch_qwen_failure_returns_picture_vectors` — monkeypatch `_embed_query_texts` to raise → 200, `text_vectors is None`, `len(vectors)==n`.
**Gate:** `docker run --rm te-test python -m pytest -q` shows the new tests passing.
**Stop-and-ask trigger:** if capturing token length needs restructuring `_embed_query_texts` beyond adding a counter.

### Step 6 — Dependencies (`helper-ok`)
Move `pytest` and `httpx` to `apps/text-embed/requirements-dev.txt`. Pin upper bounds in `requirements.txt` to the next major for fastapi/uvicorn/torch/pillow and to `transformers>=5.20.0,<5.<current-minor+1>` (read the installed version in the current image: `docker run --rm ghcr.io/u2giants/popdam-text-embed:latest pip show transformers`). Dockerfile: add a `test` build stage (`FROM runtime AS test`, `pip install -r requirements-dev.txt`, `COPY test_main.py`) so the runtime stage no longer copies `test_main.py`.
**Gate:** `docker build --target runtime` image has no `pytest` (`docker run --rm <img> python -c "import pytest"` fails); `--target test` image passes pytest.
**Stop-and-ask trigger:** if the current image's `transformers` is outside `>=5.20.0`.

### Step 7 — Test before deploy (`lead-only`: protected workflow file)
In `.github/workflows/publish-text-embed.yml` before "Build and push": build `--target test` (load locally, `push: false`) and run `docker run --rm te-test python -m pytest -q`; fail the job on failure. The push and Coolify steps follow only on success. Also add a pull-request trigger on `apps/text-embed/**` that runs only the test stage (no push, no deploy), so failures show on the PR. This check is advisory for merging (owner ruling 2026-10-30: only data-damage or secret-leak checks may be required), but it blocks the deploy step by job order.
**Gate:** the PR run shows the test step green; a deliberately broken local test (not committed) fails the job when run with `act` or a scratch branch.

### Step 8 — Workers × threads (`lead-only`: production capacity judgment)
Using step 1's host/container facts, test 2×2, 2×3, 2×4 locally or on a scratch Coolify deploy is **not** allowed in production during business hours; instead run the step-1 latency script against a local container pinned with `--cpus=<container limit>`. Choose the setting with the lowest two-concurrent p95 whose total threads ≤ container CPU limit − 2 (leaves headroom for the DAM frontend and proxy on the same host). Replace the Dockerfile comment with: what runs (SigLIP2 + Qwen3 per batch request), workers × threads, the container limit and the measurement file path. Record host cores and the container CPU/memory limit in `docs/INFRASTRUCTURE.md` text-embed section. Memory: confirm 2 workers × ~4 GB fits the container limit with ≥20% margin; if not, drop to 1 worker and record it.
**Gate:** Dockerfile comment cites `docs/verification/text-embed-<date>/` and INFRASTRUCTURE.md shows the limits.

### Step 9 — Docs (`helper-ok`)
Replace "serialises concurrent requests" in `docs/INFRASTRUCTURE.md:58` and the header comment in `supabase/functions/_shared/query-embed-batch.ts:1-12` and comments near `dam-search-ai/index.ts:640-648` with: each batch request runs one SigLIP2 and one Qwen3 forward pass; up to <workers> requests run in parallel, further requests queue; batching all variants in one call still saves round trips. Update `apps/text-embed/README.md` tests section to the `--target test` command.
**Gate:** `grep -rn "serialis" docs apps/text-embed supabase/functions` returns nothing.

### Step 10 — Land and prove (`lead-only`)
Branch `claude/text-embed-hardening-1043`; PR body lists the issues; merge when required checks pass. Watch `publish-text-embed.yml` on `main`: test step green, image pushed, Coolify deploy 200. Then `curl https://text-embed.designflow.app/health` shows the new build (add `"build": <git sha>` to `/health` via a `BUILD_SHA` build arg in this PR to make this provable). Run the search scorecard once (`docs/SEARCH_EVAL.md`, workflow `search-eval.yml`, not concurrently with another eval or release): 137/137, zero errors, p95 not worse than step 1's baseline. Comment on #1043, #876, #1050 with evidence and close them; comment on #871 and close it only if the issue-868 plan has also landed.
**Gate:** issues closed with SHA, workflow run id and scorecard run id.

## 10. Tests required

- `apps/text-embed/test_main.py`: `test_fast_path_is_used_for_normal_queries`, `test_long_query_truncated` (token-cap assertion), `test_batch_qwen_failure_returns_picture_vectors`, `test_startup_requires_pad_token` (import-time assertion covered by monkeypatching before reload, or a direct check of `_text_tokenizer.pad_token_id is not None`), `test_query_prefix_exact` (pins the step-4 choice), and `test_health_reports_compile_state` only if compile is kept.
- `supabase/functions/dam-search-ai/index.test.ts`: "text leg off: null text_vectors still searches with pictures"; "text leg on: null text_vectors answers 503".
- Must stay green: `docker run --rm te-test python -m pytest -q`; `npm run test` (root Vitest, includes `supabase/functions/**`); `npx -y deno check --config supabase/functions/deno.json supabase/functions/dam-search-ai/index.ts`.

## 11. Constraints, standing rules and gotchas

- Branch + PR; the AI merges; reviews advisory; only data-damage/secret-leak checks may be required (owner ruling 2026-10-30) — the new test step must not be added to required checks.
- `.github/workflows/*` are protected paths: the automatic fixer never edits them; a person-session must.
- Never send licensed names, product codes or file ids in eval output, commits, issues or verification files (`docs/SEARCH_EVAL.md`).
- Never run two scorecards at once or during a release (timings distort; see `HANDOFF.d/2026-11-22T0217Z-edge-dev3-codex-popdam-search-speed.md` §4). Coordinate with that open search-speed work before running step 10's eval.
- Deploy is automatic on merge; a bad merge ships within minutes. Rollback: Coolify redeploy of the previous `:<sha>` tag.
- No host changes by SSH; Coolify owns the app (AGENTS.md → Host changes).
- Times in EST/EDT.

## 12. Access and environment

- `gh` as `u2giants`; Docker locally for builds and tests.
- `TEXT_EMBED_KEY`: 1Password vault `vibe_coding`, item for the PopDAM text-embed shared key (search "text-embed"); also a Supabase function secret. Never print it.
- Coolify API token and URL: GitHub secrets `COOLIFY_TOKEN`, `COOLIFY_URL`; for local reads the same values are in 1Password `vibe_coding` (search "Coolify").
- Scorecard: `.github/workflows/search-eval.yml` (`workflow_dispatch`, input `label`), guide `docs/SEARCH_EVAL.md`; viewer test login in 1Password `vibe_coding` as described there.

## 13. Definition of done, risks and open questions

- [ ] Steps 2–9 merged (SHA in STATUS), tests passing in the image and in CI.
- [ ] `publish-text-embed.yml` run on `main`: test step green, deploy 200 (run id in STATUS).
- [ ] `/health` shows the merged build SHA.
- [ ] Scorecard after deploy: 137/137, zero errors, p95 no worse than baseline (run id).
- [ ] #1043, #876, #1050 closed with evidence; #871 closed when the issue-868 plan is also done.
- [ ] STATUS and the handoff updated.

Risks: a too-tight `transformers` pin blocks a future security update (acceptable; bump deliberately). Removing compile could slow queries slightly (step 3 criterion guards it). Lowering threads could raise p95 (step 8 chooses by measurement). Rollback: Coolify previous tag; revert PR.

Open: prefix space (step 4), compile (step 3), workers × threads (step 8) — each with criteria above.

## Self-audit (Mode A)

1. *Fresh session could execute without asking?* Yes — §2 explains the service, caller, deploy path and the live leg mode; §5 cites every line; §9 gives edits, criteria and gates; §12 access by location. Gap found: the edge's handling of `text_vectors: null` was unverified — step 2 now makes checking and, if needed, adjusting it explicit with tests.
2. *All background including rejections?* Yes — §3 all four reviews, §6 root causes, §7 rejected options (lazy load, split service, keep compile, test outside image, blind prefix change).
3. *Goal clear for judgment?* Yes — §1 four outcomes; §8 locks D4 so the implementer cannot "fix" finding 1 by weakening it.

## Lead launch prompt

```text
You are the lead for u2giants/popdam3 issues #1043, #876, #1050 and #871 (findings 3-4). Read AGENTS.md, docs/plans/issue-1043-text-embed-service-hardening.md (STATUS first), HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md, and the issue-1037 plan's D4 decision. Work in your own worktree from origin/main.
You do steps 1, 2, 4, 7, 8 and 10, and the keep/remove decision in step 3. Hand steps 3 (edit only), 5, 6 and 9 to your helper, one at a time, and review each diff.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker only; no design decisions; no merges, pushes to main or GitHub posts; bring stop-and-ask triggers to you; taken back after 30 minutes stuck.
Checks you run yourself: pytest inside the built test image, root npm run test, deno check of dam-search-ai, the publish workflow run on main, /health build SHA, and one scorecard not overlapping any other eval or release.
```
