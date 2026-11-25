---
summary: "Issues #868, #871, #833 plan: spacing, long variant lists or a bad PopSG name list never break search; cache is model-safe. Read STATUS first."
kind: plan
status: open
read-when: "changing dam-search-ai query embedding (query-embed-batch.ts, the search and popsg-query-embedding actions, nameExpansion); resolving #868, #871 or #833"
---

# Plan: query-embedding edge hardening (u2giants/popdam3#868, #871 findings 1–2, #833)

Issues: [#868](https://github.com/u2giants/popdam3/issues/868) (review of PR #867), [#871](https://github.com/u2giants/popdam3/issues/871) findings 1–2 (review of PR #870; findings 3–4 are in [issue-1043-text-embed-service-hardening.md](issue-1043-text-embed-service-hardening.md)), [#833](https://github.com/u2giants/popdam3/issues/833) (review of PR #832).
Handoff: [HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md](../../HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md)
Written 2026-11-25 by Claude (plan only; nothing implemented). Facts checked on `origin/main` `787c20b8`.

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Reproduce the double-space 503 and the >16-text case locally in tests | ⬜ open | |
| 2 | Normalize the typed query once before building the embedding list | ⬜ open | |
| 3 | Chunk batched embedding calls to ≤16 texts | ⬜ open | |
| 4 | Cache keyed by model; text vectors checked against the configured stamp | ⬜ open | |
| 5 | Name expansion fails open and validates the stored list | ⬜ open | |
| 6 | Name-vector builder refuses empty or malformed input | ⬜ open | |
| 7 | Test helpers honour the transport contract; distinct vectors per variant | ⬜ open | |
| 8 | PR, merge, verify edge deploy, live proof, close issues | ⬜ open | |

**Where a fresh session starts:** step 1. Steps 1–7 are one PR.

---

## 1. The ultimate goal

Staff type searches like `red, mug` or `mug (blue)` into PopDAM, or a misspelled name into PopSG. Search must answer them. When this plan is done:

- punctuation, extra spaces or a query that expands into many product-phrase variants never turns a working search into "Search unavailable";
- a damaged optional setting (the PopSG name list) only skips the optional help — it never breaks every PopSG search;
- the speed cache can never hand back vectors from a model other than the one search is configured for.

**If a step conflicts with this goal, the goal wins: stop and flag it.**

## 2. What this application is

- **PopDAM** (https://dam.designflow.app) — POP Creations' internal licensed-artwork library; **PopSG** (https://sg.designflow.app) — the licensor style-guide library, same code base. Repo [u2giants/popdam3](https://github.com/u2giants/popdam3), branch `main` (protected).
- **`dam-search-ai`** is a Supabase Deno edge function (`supabase/functions/dam-search-ai/index.ts`, 864 lines), deployed by `.github/workflows/deploy-supabase.yml` on merge. Relevant actions: `search` (PopDAM typed search, ~`:584-830`) and `popsg-query-embedding` (~`:505-560`, returns a vector the PopSG page sends to the database itself).
- It calls the **text-embed** service (`https://text-embed.designflow.app`, `apps/text-embed`) through the transport at `index.ts:330-440` (`/embed-text-batch`, ≤16 texts, and `/embed-text` single), wrapped by `supabase/functions/_shared/query-embed-batch.ts` (`createQueryEmbedder`, a per-isolate LRU cache of 256 entries).
- **Product-phrase variants:** `supabase/functions/_shared/search-query-expand.ts` (`expandProductQueries`, `PRODUCT_PHRASES` at `:15-36`) rewrites phrases ("floor covering" → "mat", "rug"), and the spelling correction doubles the list (`index.ts:640-641`).
- **PopSG name expansion:** admin_config `POPSG_NAME_VECTORS` = `{model, names[], vectors[][]}` built by `scripts/popsg-name-vectors.mjs`; `nameExpansion` in `supabase/functions/_shared/popsg-query-embedding.ts:49-64` picks the licensor/property name a query clearly means (cosine ≥ `NAME_MATCH_MIN` 0.92 and margin ≥ 0.05).

## 3. What triggered this work

Advisory AI reviews of merged PRs (advice only; `fixer-deferred` = not fixed):

- **#868** (PR #867 "batch query-embedding fan-out", head `9c353e73`): (1) batches never chunked to the service limit of 16 → 422 → `failed` → 503; (2) no per-item length bound server-side (**since fixed**, see §5); (3) cache keyed only by text, bypassing the model check; (4) test helper `recorder().transport.embedBatch` returns `null`, violating the type; `batchTransport` said to be unused.
- **#871** findings 1–2 (PR #870 "one embed round trip per search", head `6dad9a3d`): (1) the typed query is only trimmed, but variants are space-collapsed, so `embeddings.get(query)` misses and the search 503s for `"red  mug"` — reachable from the UI because hooks replace `(),` with spaces (`src/hooks/useAssets.ts:347,478,514`, `src/hooks/useStyleGroups.ts`); (2) tests use identical zero vectors and cannot detect a variant-mapping bug; no whitespace test.
- **#833** (PR #832 "meaning-based search adds the property a query clearly means", head `5c5960e9`): `nameExpansion(...)` runs outside the try/catch, so a corrupt `POPSG_NAME_VECTORS` throws and 500s every hybrid PopSG search; no validation of model, dims, lengths or finiteness; the builder script writes an empty list without warning.

## 4. Scope

In: #868 findings 1, 3, 4; #871 findings 1, 2; #833 findings 1–3. #868 finding 2 is recorded as fixed.

### NOT in this plan
- The text-embed service itself (Qwen failure handling, threads, compile, docs) — issue-1043 plan.
- Ranking rules, floors, margins, the named-character rule, product phrases themselves.
- Turning `POPSG_SEARCH_MODE` or `SEARCH_TEXT_LEG_MODE` on/off.
- Rebuilding `POPSG_NAME_VECTORS` data in production (step 6 only hardens the script; rebuild only if step 8's check finds the stored value invalid).
- Database changes.

## 5. Current state of the code (origin/main `787c20b8`)

- `index.ts:584` `const query = typeof body.query === "string" ? body.query.trim() : ""` (search action). `:640-641` builds `expanded` from `expandProductQueries(query)` (+ corrected spelling). `search-query-expand.ts:38` `normalizeSpaces` and `:58` `const query = normalizeSpaces(rawQuery)` — every variant key is space-collapsed.
- `index.ts:650` `semanticTexts` = unique semantic variant strings; `:681` `const embedding = embeddings?.get(query) ?? null` (raw key) → `:688-690` `if (usePictures && !embedding) return err("Search unavailable", 503)`. `:696-699` variants are looked up by their (normalized) keys correctly.
- `index.ts:345-352` batch call sends all texts in one request, no chunking; `:354` only 404/405 → `absent`; any other non-OK (including 422 for >16 texts) → `failed`.
- `apps/text-embed/main.py:70-82`: per-item 8000-char limit and `max_length=16` items — **#868 finding 2 fixed** (issue #1105).
- `query-embed-batch.ts:48-90`: `cache` and `textCache` keyed by text only. The transport rejects a response whose `model` ≠ `SIGLIP2_MODEL` (`index.ts:376-379`, `:434-437`), so a wrong picture model is never cached, and `SIGLIP2_MODEL` is a code constant (changing it redeploys the function, which clears isolate caches). Text vectors are cached as `{vector, model}`; whether the reader compares `model` to the configured `SEARCH_TEXT_EMBEDDING_MODEL` on a cache hit must be checked in step 4.
- `query-embed-batch.test.ts:6-19` `recorder()` returns `null` from `embedBatch`; `batchTransport` (`:21-28`) **is** used (e.g. `:109`) — the "dead code" half of #868-4 is wrong.
- `index.test.ts:75-81` `embedFetch` returns `Array(768).fill(0)` for every text; `:213` asserts with zeros.
- `index.ts:221-233` `popsgNameVectors()` accepts any object with array `names` and `vectors`. `index.ts:532` calls `nameExpansion(semantic.embedding, await popsgNameVectors())` outside the try/catch that ends at `:527`. `popsg-query-embedding.ts:36-44` `cosine` loops to `a.length` only.
- `scripts/popsg-name-vectors.mjs:15,27,30-32`: reads `process.argv[2]` and `TEXT_EMBED_URL` without validation and writes `{model, names, vectors}` even when empty.

## 6. Key findings and root cause

1. **Raw-vs-normalized key** (#871-1): the refactor in PR #870 replaced a separate `embedQueryText(query)` call with a lookup into the batch map, whose keys are normalized. Any internal whitespace run ≥ 2 in the typed query misses. The UI produces such queries for every comma or parenthesis followed by a space.
2. **No chunking** (#868-1): many `PRODUCT_PHRASES` matches plus the spelling-corrected duplicate can exceed 16 texts; the service returns 422; the transport maps it to `failed`; the search 503s where it used to work with per-text calls.
3. **Optional help not isolated** (#833-1/2): a structurally valid but numerically bad name list (null entries, short vectors, mismatched lengths) throws inside `cosine`, outside any catch.
4. **Weak tests** (#871-2, #868-4): identical vectors mask mapping bugs; a helper violating its own type.

## 7. Approaches considered and REJECTED

| Approach | Why rejected |
|---|---|
| Normalize `query` in the browser hooks | Fixes one caller only; other callers (eval harness, API) still hit it. Normalize once in the edge function. |
| Raise the service limit above 16 | Fixed padding cost and memory per pass; the 16 cap is deliberate in `main.py:80-82`. Chunk on the caller. |
| Map 422 to `absent` (per-text fallback) | Hides real validation errors and multiplies round trips (#804). |
| Drop the cache | Costs latency for repeated searches and the eval warm-up; the fix is a safer key. |
| Validate `POPSG_NAME_VECTORS` with a database constraint | Shared-db change for an optional, script-built value; edge validation is enough. |

## 8. Design decisions

- **LOCKED** (Nov 1 contract, `plan_vector_consolidation.md` Reconciliation): a required embedding failure answers 503 with Retry — never a partial keyword answer. This plan removes *false* failures; it does not weaken real ones.
- **LOCKED:** one batched call per search where possible (#804). Chunking issues the chunks **in parallel** and merges; total failure of any chunk = `failed` for the whole set (never mix partial).
- **LOCKED:** name expansion is optional help: any problem → `expansion: null`, logged once per isolate.
- **OPEN:** whether to also dedupe variants case-insensitively (only if a test shows duplicates differing by case; otherwise leave).

## 9. The plan

### Step 1 — Failing tests first (`helper-ok`: tests named exactly)
Add to `supabase/functions/dam-search-ai/index.test.ts` (use the existing harness around `:130-220`):
- "a typed query with a double space searches normally" — body `{query: "red  mug"}` → 200, `p_query_embedding` equals the vector returned for `"red mug"`.
- "a query with more than 16 embedding texts is chunked" — stub `expandProductQueries` output or choose a query matching enough phrases; assert every `/embed-text-batch` request has ≤16 texts and the search answers 200.
Both must fail on current main.
**Gate:** `npx vitest run supabase/functions/dam-search-ai/index.test.ts` shows exactly these two failing.
**Stop-and-ask trigger:** if no real query reaches >16 texts with current `PRODUCT_PHRASES`, report the maximum reachable count instead of inventing phrases.

### Step 2 — Normalize once (`helper-ok`)
Export `normalizeSpaces` from `search-query-expand.ts` and in the search action (`index.ts:584`) set `const query = normalizeSpaces(rawTrimmed)` before anything uses it (spelling, scope, expansion, lookup). Apply the same in `popsg-query-embedding` (`index.ts:515`) for consistency.
**Gate:** step 1's double-space test passes; all existing `index.test.ts` tests pass.

### Step 3 — Chunk to ≤16 (`helper-ok`)
In the transport `embedBatch` (`index.ts:330-400`), add `const BATCH_LIMIT = 16` (comment: mirrors `apps/text-embed/main.py` `max_length=16`); split `texts` into chunks, `Promise.all` the requests, concatenate `vectors` and `text_vectors` in order; if any chunk returns `absent` → whole `absent`; any `failed` → whole `failed`. Keep the 4000 ms timeout per chunk.
**Gate:** step 1's chunk test passes; new unit test "chunked responses are merged in input order" passes.

### Step 4 — Model-safe cache (`lead-only`: the reader-side check decides whether wrong vectors can reach ranking)
In `query-embed-batch.ts`: key `textCache` by `${model}\u0000${text}` and make `embedAllWithText(texts, expectedTextModel)` read only entries for `expectedTextModel`; the caller (`index.ts:656`) passes `textLeg.model`. Picture cache: key by `SIGLIP2_MODEL` too (cheap, future-proof). If, on reading the current code, the caller already rejects a text vector whose `model` ≠ `textLeg.model`, still key by model (removes stale entries from LRU competition) and cite the existing check in a comment.
**Gate:** tests "a cached text vector from another model is not reused" and "cache hit for the configured model avoids a call" pass.

### Step 5 — Name expansion fails open and validates (`helper-ok`)
- `popsgNameVectors()` (`index.ts:221-233`): accept only `stored.model === SIGLIP2_MODEL`, `names.length === vectors.length > 0`, every name a non-empty string, every vector an array of length 768 of finite numbers; otherwise log `POPSG_NAME_VECTORS invalid: <reason>` once per cache period and return null.
- `index.ts:532`: wrap the `nameExpansion(...)` call in try/catch → `null`.
- `nameExpansion` (`popsg-query-embedding.ts:49-64`): return null if `embedding.length` ≠ any vector length or a score is not finite.
**Gate:** tests in `supabase/functions/_shared/popsg-query-embedding.test.ts` and `index.test.ts` (§10) pass.

### Step 6 — Builder refuses bad input (`helper-ok`)
`scripts/popsg-name-vectors.mjs`: exit 1 with a message when `process.argv[2]` is missing/unreadable, when `TEXT_EMBED_URL` is unset, when the names file yields zero names, or when any returned vector is not 768 finite numbers. Never write SQL on failure.
**Gate:** `node scripts/popsg-name-vectors.mjs` (no args) exits 1 with no stdout; with an empty file exits 1.

### Step 7 — Honest test helpers (`helper-ok`)
- `query-embed-batch.test.ts` `recorder()`: `embedBatch` returns `{ status: "absent" }` (the per-text path it exists to exercise) and its type is satisfied without casts.
- `index.test.ts` `embedFetch` (`:75-81`): return a distinct vector per text (e.g. first element = index+1 or a hash of the text) and update `:213`-style assertions so each variant's `p_query_embedding` is its own vector.
**Gate:** `npm run test` green; a deliberately broken mapping (local only, reverted) makes the variant test fail.

### Step 8 — Land and prove (`lead-only`)
Branch `claude/query-embed-edge-868-871-833`; PR body lists findings; merge when required checks pass; confirm `deploy-supabase.yml` deployed `dam-search-ai` (run id). Live proof, signed in as the viewer tester (1Password, §12), on https://dam.designflow.app: search a generic two-word query with a comma (e.g. `red, mug`) → results, no "Search unavailable"; in browser devtools the `dam-search-ai` response is 200. Read-only check of `POPSG_NAME_VECTORS` validity (model, equal lengths, dims) via SQL; if invalid, rebuild with the hardened script (that is an application data write by the app owner session — allowed, not DDL) and record it. Run one scorecard (`search-eval.yml`) not overlapping other evals or releases: no new failures vs the last recorded run. Close #868 and #833 with evidence; comment on #871 and close it only if the issue-1043 plan has landed.
**Gate:** issues closed citing merge SHA, deploy run id, scorecard run id.

## 10. Tests required

- `supabase/functions/dam-search-ai/index.test.ts`: "a typed query with a double space searches normally"; "a query with more than 16 embedding texts is chunked"; "each variant uses its own vector" (distinct vectors); "a corrupt POPSG_NAME_VECTORS row leaves PopSG search working with no expansion"; "a POPSG_NAME_VECTORS row from another model is ignored".
- `supabase/functions/_shared/query-embed-batch.test.ts`: "chunked responses are merged in input order" (if chunking is placed in the embedder rather than the transport, put it here); "a cached text vector from another model is not reused"; "cache hit for the configured model avoids a call"; recorder fix.
- `supabase/functions/_shared/popsg-query-embedding.test.ts`: `nameExpansion` returns null for mismatched dims, non-finite values, null vector entries.
- Must stay green: `npm run test`; `npx -y deno check --config supabase/functions/deno.json supabase/functions/dam-search-ai/index.ts`; `npm run lint`; `npm run typecheck`.

### Adversarial cases (external inputs: user query text, stored admin_config value, service responses)

| Input | Hostile case | Test |
|---|---|---|
| `body.query` | internal double/triple spaces, tabs, leading/trailing punctuation-turned-space | "a typed query with a double space searches normally" |
| `body.query` | phrase-dense query → >16 variants | "a query with more than 16 embedding texts is chunked" |
| `POPSG_NAME_VECTORS` | `vectors` contains `null` / short arrays / NaN | "a corrupt POPSG_NAME_VECTORS row leaves PopSG search working…" + `nameExpansion` null tests |
| `POPSG_NAME_VECTORS` | `names.length ≠ vectors.length`, wrong `model` | "…from another model is ignored" |
| text-embed response | fewer vectors than texts in one chunk | existing "bad vectors count" path + "chunked responses are merged in input order" (assert a short chunk → `failed`) |
| text-embed response | text vector from another model stamp | "a cached text vector from another model is not reused" |

## 11. Constraints, standing rules and gotchas

- Branch + PR; AI merges; reviews advisory.
- No DDL; `admin_config` writes only for the name-vector rebuild in step 8, and only if invalid.
- Never put licensed names, product codes or file ids in tests, commits or issues (`docs/SEARCH_EVAL.md`). Use generic words (`red mug`, `blue frame`) in tests.
- Do not run two scorecards at once or during a release.
- Edge functions deploy automatically on merge; rollback = revert PR (redeploys).
- The search action must keep using the caller-scoped client for the ranking RPC (`index.ts` comment ~`:692-694`): access is enforced from `auth.uid()`.

## 12. Access and environment

- `gh` as `u2giants`. Node 20+, `npm ci` at repo root; Deno via `npx -y deno`.
- Viewer test login: 1Password vault `vibe_coding`, the PopDAM viewer tester item referenced in `docs/SEARCH_EVAL.md`.
- Read-only SQL: Supabase MCP `execute_sql` on `qsllyeztdwjgirsysgai` (needs a valid access token; if refused, use `psql` with the DSN from 1Password `vibe_coding`, item for the shared Supabase read connection).
- Scorecard: `.github/workflows/search-eval.yml` (`workflow_dispatch`, input `label`).

## 13. Definition of done, risks and open questions

- [ ] Steps 1–7 merged (SHA in STATUS); all §10 tests pass in CI.
- [ ] `dam-search-ai` deployed from the merge (run id).
- [ ] Live comma query proof and name-vector validity check recorded on the issues.
- [ ] Scorecard shows no regression (run id).
- [ ] #868 and #833 closed; #871 closed when the issue-1043 plan has also landed.
- [ ] STATUS and handoff updated.

Risks: normalizing the query changes cache keys and log text only; ranking inputs were already normalized for variants. Parallel chunks add concurrent load on text-embed (2 workers) — still fewer calls than the pre-#867 per-text fan-out. Rollback: revert PR.

Open: case-insensitive dedupe (§8).

## Self-audit (Mode A)

1. *Fresh session could execute without asking?* Yes — §2 defines the function, transport, variants and name list; §5 gives exact lines; §9 steps name edits, gates, triggers; §12 access. Gap found: #868-4's "dead code" claim was wrong — recorded in §5 so nobody deletes a used helper.
2. *All background, including rejected paths?* Yes — §3 the three reviews, §6 root causes, §7 rejected options; §5 notes #868-2 already fixed.
3. *Goal clear for judgment?* Yes — §1 three outcomes; §8 locks the 503-on-real-failure contract so "fail open" is applied only to the optional name help.

## Lead launch prompt

```text
You are the lead for u2giants/popdam3 issues #868, #871 (findings 1-2) and #833. Read AGENTS.md, docs/plans/issue-868-query-embedding-edge-hardening.md (STATUS first) and HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md. Work in your own worktree from origin/main.
You do steps 4 and 8 yourself. Hand steps 1, 2, 3, 5, 6 and 7 to your helper in that order, one at a time; review each diff and rerun the tests.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker only; no design decisions; no merges, pushes to main or GitHub posts; bring stop-and-ask triggers to you; taken back after 30 minutes stuck.
Checks you run yourself: npm run test, lint, typecheck, deno check of dam-search-ai, the adversarial table rows all mapped to passing tests, the deploy run, live comma-query proof and one non-overlapping scorecard.
```
