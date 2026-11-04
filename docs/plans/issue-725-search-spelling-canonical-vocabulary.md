# Plan: Review finding: u2giants/popdam3#720 feat(search): scored search test set and spelling help (u2giants/popdam3#725)
Issue: https://github.com/u2giants/popdam3/issues/725
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Confirm PR #720 state; update the branch from `main` | ⬜ open | |
| 2 | Move vocabulary loading to canonical tables, minimal columns, stable order | ⬜ open | |
| 3 | Settle weights with a deterministic tie-break | ⬜ open | |
| 4 | Bound spelling time: parallel counts, word cap, time budget | ⬜ open | |
| 5 | Extend the contract test and add tests | ⬜ open | |
| 6 | CI, measure latency, merge, verify deploy | ⬜ open | |
| 7 | Live proof and close | ⬜ open | |

**Where a fresh session starts:** step 1. Work on the existing PR; do not open a second one.

---

## 1. The ultimate goal

When someone types "captian america" or misspells a licensed name, search should quietly find what they meant, using today's official list of licensors, properties and characters, never retired names. And it must never make search noticeably slower or take it down: spelling help is an extra, so if it is slow or broken, search simply runs as typed.

**If a step conflicts with this goal, the goal wins: stop and flag it.**

## 2. What this application is

PopDAM (https://dam.designflow.app, licensed-art asset manager) and PopSG (https://sg.designflow.app, style-guide library) are POP Creations internal tools used by designers, sales and administrators. Repo `u2giants/popdam3`, default branch `main`. Stack: one React 18 + Vite frontend in `src/` (GHCR image, Coolify app `qxj8a0j3tpa9lq4q5rs6pezy`); Supabase edge functions in `supabase/functions/` (project `qsllyeztdwjgirsysgai`, Virginia; deployed by `.github/workflows/deploy-supabase.yml` on changes to `supabase/functions/**`); a long-running job worker in `apps/worker` on Railway (auto-deploys on every push to `main`, which restarts it); agents on the NAS and Windows machines. Database structure is owned by `popcre/shared-db` (canonical checkout `/worksp/shared-db`); `shared-db/` here is a read-only mirror.

Search runs through edge function `dam-search-ai` and the RPC `search_dam_documents`. "Canonical" taxonomy means the `core` schema; `public.licensors`, `public.properties` and `public.characters` are deprecated (`docs/SCHEMA.md:36-46`).

## 3. What triggered this work

PR #720 is **OPEN and not merged**. Current head `0b14365d`; a test merge with local `origin/main` `39e428ef` had no conflicts. Muse reviewed the earlier head `3330fd25` and filed #725. The fixer deferred because the source moved. **`main` does not contain this code:** `supabase/functions/_shared/search-spelling.ts` does not exist there, so the fix belongs in the PR before merge. All five findings are still present at head `0b14365d`.

## 4. Scope

In: the five findings, plus word-count and access limits found during planning.

### NOT in this plan
- The rest of PR #720 (`scripts/search-eval/`, `.github/workflows/search-eval.yml`, `docs/SEARCH_EVAL.md`); leave them.
- Changing correction rules (`nearestWord`, `editDistance`) beyond the tie-break.
- Database changes or new views. Popularity weights from usage data (rejected, section 7).
- Retiring the legacy tables.
- PopSG semantic search ([issue-734 plan](issue-734-popsg-query-embedding-never-runs.md)), though both edit `dam-search-ai/index.ts`.

## 5. Current state of the code

At PR head `0b14365d`, read with `git show 0b14365d:<path>`; the issue's line numbers are for the older head:
- `supabase/functions/dam-search-ai/index.ts:45-55` `loadNames`; `:48` `.select("*").range(...)`, no schema, no order.
- `:64-66` loads `licensors`, `properties`, `characters`; `:66` weights by `usage_count`.
- `:75` `countDocs`; `:238` search awaits `checkSpelling` before embedding; `:358-361` `spelling` action, no access check.
- `supabase/functions/_shared/search-spelling.ts`: `nearestWord`, `addNameToVocabulary`, `checkSpelling` (sequential `await lookup.countDocs` per word; fails open).
- `src/lib/dam-search.ts` (PR adds a `spelling` call inside `expandFallbackTerms`, used by PopSG at `src/pages/popsg/PopSGLibraryPage.tsx:160` on `main`).

On `main`: `src/test/core-licensor-property-contract.test.ts:10-17` scans only `agent-handlers.ts`. `supabase/functions/_shared/admin-handlers/agent-handlers.ts:1360,1378` shows the `.schema("core")` pattern.

Live, read-only, 2026-11-04 about 6:05 PM EST: `core.licensor` 27 vs `public.licensors` 10; `core.property` 290 vs `public.properties` 500; `core.character` 15,019 (1 archived; 885 match retired-label text such as "Do Not Use", "logo") vs `public.characters` 9,622. `public.characters.usage_count` exists; `core.character` has no such column (columns: id, licensor_id, name, code, status, metadata, timestamps).

## 6. Key findings and root cause

- **Legacy source confirmed** and materially wrong: only 10 of 27 licensors, and 210 surplus legacy properties that can produce retired corrections.
- **Weight:** moving to core makes `usage_count` meaningless; all characters would tie, and ties depend on Map order in `nearestWord`.
- **Unbounded work, beyond the review:** a query of many words means one `countDocs` database call per word, sequentially, with no cap.
- **Cold start:** about 16 sequential pages for 15,000 characters blocks the first search in each isolate.
- **Retired words:** filtering on `status` alone leaves 885 retired-looking labels. Their words ("logo", "general", "elements", "likeness") would enter the vocabulary and could "correct" real words.
- **Access, beyond the review:** the `spelling` action lets any signed-in user learn whether a word appears in `dam_search_documents`, indirectly, through a service client. PopSG-only users legitimately call it and it returns only corrections, so the exposure is low; keep it and record the note on #725 rather than adding a gate that would break PopSG.

## 7. Approaches considered and REJECTED

- **Keep `public.*`:** contradicts `docs/SCHEMA.md` and the contract test.
- **Popularity from counting `asset_licensor_characters`:** an aggregate over a large table on the search path, for a tie-break only.
- **New materialized vocabulary table in shared-db:** the cleanest long-term shape, but a schema project for one extra. Revisit only if step 6 latency fails with the budget in place.
- **Remove the blocking call and run spelling only after results:** then corrected words would not join the same search, defeating the feature.
- **Importing the worker's `NOT_A_CHARACTER`:** edge functions cannot import from `apps/worker`. See section 8.

## 8. Design decisions

- **LOCKED:** source is `core.licensor`, `core.property`, `core.character`, with `status` not in `archived`, `deleted`, selecting `id, name`, ordered by `id`.
- **LOCKED (reversible):** weights are licensors and properties 1,000,000, characters 1; product words stay 1,000,000. Equal distance and weight resolves alphabetically, so results are stable between isolates.
- **LOCKED:** spelling always fails open.
- **LOCKED (reversible; tune with step 6 numbers):** maximum 8 words checked; a longer query skips help (`corrected:null, meaningful:true`). Total time budget 800 ms; over budget means searching as typed, while the vocabulary load carries on for the next request.
- **OPEN:** how to exclude retired labels. Default: export a small `isRetiredCharacterLabel` in `search-spelling.ts` using the same text as `apps/worker/src/handlers/ai-tagging-shared.ts:252`, with a test comparing the two regex sources, since the contract test style already reads other files. Criterion: there must be one tested source of truth, and no drift can go unnoticed. Note this on #708 (duplicate-code work) if a shared home appears.

## 9. The plan

**Step 1. Preflight.** `gh pr view 720 --json state,headRefOid`. Another session owns this PR; check for fresh commits. Worktree of `claude/search-test-set-680`, merge `origin/main`. If #734's fix merged first, conflicts are limited to `index.ts`. You'll know it worked when `npm run test` passes before edits.

**Step 2. Canonical load.** Replace `loadNames(table, ...)` with `loadNames(table, vocabulary, weight, keep?)` calling `serviceClient().schema("core").from(table).select("id, name, status").order("id").range(...)`, with `status` filtered in the loop or query. Tables `licensor`, `property`, `character`. Characters pass `isRetiredCharacterLabel` as the exclusion. You'll know it worked when `deno check` of `dam-search-ai` reports no new error, and the contract test in step 5 passes. `.schema("core")` raises TS2345 in other functions, so match the client type used at `agent-handlers.ts:1360` if needed.

**Step 3. Weights and tie-break.** In `index.ts` pass the constants from section 8. In `nearestWord`, on equal distance and weight, prefer the alphabetically earlier word. You'll know it worked when `equal candidates resolve the same way in any order` passes.

**Step 4. Time bounds** in `checkSpelling`. Dedupe words, return the fail-open result above 8 words, and run `countDocs` with `Promise.all`, preserving output order. Vocabulary and counts race an injected `budgetMs` (default 800) inside the existing `try`. Use a timer that is cleared on completion. `vocabularyCache` already stores the promise, so a timed-out load keeps going in that isolate. You'll know it worked when the budget test passes with a never-resolving fake lookup.

**Step 5. Contract and tests.** See section 10. Extend `src/test/core-licensor-property-contract.test.ts` with `spelling help reads names from core tables` over `dam-search-ai/index.ts`: contains `.schema("core")`, none of `"licensors"`, `"properties"`, `"characters"`, `select("*")`, `usage_count`, and contains `.order("id")`. You'll know it worked when it fails against the old lines.

**Step 6. Land and measure.** Push, `bin/ai-pr-wait 720`. Merge is edge and frontend only, so it does not restart the worker; check that nothing else in the merged PR touches `apps/worker`. Before and after, measure warm and cold `search` times with the tester login for 5 fixed queries, including `captian america` and `xqzvplm`. You'll know it worked when warm p95 rises by no more than 150 ms and no search exceeds its previous time by more than the 800 ms budget on cold start. If not, lower the budget and flag it on #725.

**Step 7. Live proof.** Signed in as the tester at https://dam.designflow.app: `captian america` returns Captain America work; `xqzvplm` returns no lookalikes; a canonical-only licensor name, misspelled, corrects to it (pick one from `core.licensor` missing from `public.licensors`); a name only in legacy `public.properties` is not suggested. Check PopSG too at https://sg.designflow.app. You'll know it worked when screenshots and timings are on #725 (no secrets, no Setup screen). Then close, or leave `- [ ] live proof` on it.

### Adversarial cases (typed text and catalog names are external input)

| Input | Hostile case | Test |
|---|---|---|
| query | 500 words | `a very long query skips spelling and makes no lookups` |
| query | same word repeated | `repeated words are counted once` |
| query | quotes, `&`, `:`, tsquery syntax | `search syntax in a word never reaches the word count` (`/^[\p{L}\p{N}]+$/u` guard) |
| query | non-Latin text | `non-Latin words are left as typed` |
| lookup | never resolves | `a slow lookup stops at the budget and searches as typed` |
| lookup | throws in vocabulary or one count | `a failed lookup searches as typed` |
| catalog name | `Venom - Do Not Use`, `Foo Logo` | `retired labels add no words to the vocabulary` |
| catalog row | `archived` status, null name | `archived or nameless rows add no words` |
| vocabulary order | same candidates shuffled | `equal candidates resolve the same way in any order` |

## 10. Tests required

`supabase/functions/_shared/search-spelling.test.ts`: every row above, plus `counts run in parallel` (a fake that resolves only once all calls have started). `src/test/core-licensor-property-contract.test.ts`: `spelling help reads names from core tables`, and the regex-sync test. Must stay green: full CI and `scripts/search-eval/score.test.mjs` if CI runs it.

## 11. Constraints and gotchas

- Feature branch + PR to `main`; never push to `main`. The AI merges; Albert does not. Albert is not technical: never ask him to click, type, create a credential or approve. Only business-meaning questions go to him.
- CI (`.github/workflows/ci.yml`): `npm ci && npm run lint && npm run typecheck && npm run test` at root; `npm ci --prefix apps/worker && npm run build --prefix apps/worker && npm run test --prefix apps/worker`; `npm ci --prefix apps/windows-agent && npm test --prefix apps/windows-agent`; `npm run build`. Wait with `bin/ai-pr-wait <pr>` in the background; never a sleep loop. AI reviews are advisory and never block; required checks stay lean.
- Database structure changes never go in this repo; they go through `popcre/shared-db`, claim-first on the existing issue, loading the `shared-db-change` skill. Production database is read-only by default; migrations reach production only through shared-db's automatic promotion workflow.
- Secrets live in 1Password vault `vibe_coding`; reference by vault + item title only, never values.
- Sign every GitHub post with `$AI_GH_SIGNATURE`. Quote human times in EST (America/New_York).
- Live proof is required before an outcome is closed. If it cannot happen yet, leave `- [ ] live proof` on this SAME issue; never open a follow-up issue for it.
- No band-aids, no silent failures, nothing hard-coded beyond what this plan names as a locked decision.
- `index.ts` cannot be imported by vitest (it starts serving on import), hence the source-shape contract test and logic in `_shared`. `search-spelling.ts` must stay dependency-free: the browser may share it.
- The `select("*")` fix must keep the `status` column if filtering in the loop.
- Vocabulary pagination must not go through a stale `vocabularyCache`: a failed load already clears it.

## 12. Access and environment

- Machine: hetz (the production VPS). `gh` is authenticated for `u2giants/popdam3`. Supabase read-only SQL is available through the `supabase` MCP (`execute_sql`); if it is unauthorized or hits the old Ohio project, see the memory note on secret and DB access paths. Confirm the project is `qsllyeztdwjgirsysgai`.
- Work in your own git worktree. Test logins: 1Password vault `vibe_coding`, items "PopSG / PopDAM AI tester login" (user role) and `ai-admin@designflow.app` (administrator). See `docs/1password.md`. Never screenshot PopSG Settings -> Setup (it renders the NAS password).
- Local type check: `DENO_DIR=<scratch> npx -y deno check --config supabase/functions/deno.json supabase/functions/dam-search-ai/index.ts`.

## 13. Definition of done, risks, open questions

- [ ] Findings fixed on PR #720; tests added; CI green; merged; edge and frontend deployed at the merge SHA (`deploy-supabase.yml`, `publish-frontend.yml`).
- [ ] Latency and live proof on #725; STATUS updated; #725 closed.

**Risks:** a wrong "correction" adds an extra variant, it does not replace the typed one, since both run. Budget too low means help is simply absent while cold. Rollback: revert the merge. **Uncertain:** real cold-load time for 15,000 rows; step 6 measures it, with the shared-db vocabulary option as fallback.

## Self-audit

1. *Could a brand-new session execute this without asking?* Yes: sections 3, 5 and 9 name the head, lines and values; section 8 settles weights and limits. Gap fixed: PR-head versus `main` line numbers made explicit.
2. *Does it carry all background, including what was ruled out?* Yes: sections 6 and 7, with measured table counts and the three extra risks.
3. *Is the goal clear enough for judgment calls?* Yes: section 1, spelling help is optional and search must never suffer for it.
