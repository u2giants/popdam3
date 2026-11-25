---
summary: "Issues #795 and folded #835 plan: keep retired and archived names out of search spelling help, refresh the exact-name list, report a failed save, skip useless work on keyword-only PopSG searches, and run the evaluator tests in CI. Read its STATUS first."
kind: plan
status: open
read-when: "implementing issue #795 or #835, or changing how dam-search-ai builds its spelling vocabulary or exact-name list"
---

# Plan: spelling help uses only live names (u2giants/popdam3#795, folded #835)

Issues: [#795](https://github.com/u2giants/popdam3/issues/795) (review of PR #794) and the folded [#835](https://github.com/u2giants/popdam3/issues/835) (review of PR #834).
Handoff that registers this plan: [HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-search-group-plans.md](../../HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-search-group-plans.md).
Written November 25, 2026, 3:58 PM EST on `al8960ofc` by Claude Code (worktree `modest-wu-eadf20`), checked against `origin/main` at `787c20b8`. Planning only: no code, database or setting was changed.

## STATUS — read before executing

| Step | State (Nov 25, 2026) | Evidence |
|---|---|---|
| 0. Findings already fixed on `main` (word cap, time budget, deterministic tie-break, saved name row) | ✅ verified in planning | `supabase/functions/_shared/search-spelling.ts:15-23,106,122-144,75`; tests `search-spelling.test.ts:137,146,169` |
| 1. Preflight and live counts | ⬜ open | |
| 2. Load only live names (status + retired-label filter) | ⬜ open | |
| 3. Rebuild the exact-name set on every vocabulary refresh | ⬜ open | |
| 4. Report a failed save of the saved name row | ⬜ open | |
| 5. Skip the vocabulary on keyword-only PopSG searches | ⬜ open | |
| 6. Run the search evaluator tests in CI | ⬜ open | |
| 7. Land, refresh the saved row, live proof, close #795 | ⬜ open | |

**Start at Step 1.**

---

# Part 1 — Why

## 1. Ultimate goal

When someone at POP Creations mistypes a search in PopDAM or PopSG ("captian amercia"), the site quietly fixes it to a real, current licensor, property or character name and finds the right products. It must **never** "fix" a word into a retired or junk catalog label ("logo", "general", "do not use", "likeness"), never keep treating a deleted name as current, and never make an ordinary search slower.

**If a step below conflicts with this goal, the goal wins — stop and flag it on #795.**

## 2. What this application is

- **PopDAM** ([u2giants/popdam3](https://github.com/u2giants/popdam3), release branch `main`, public repository): internal library of licensed consumer-product artwork. Web app at https://dam.designflow.app. **PopSG** is the style-guide mode of the same code at https://sg.designflow.app.
- Search runs in the Supabase edge function `dam-search-ai` (`supabase/functions/dam-search-ai/index.ts`), deployed automatically by `.github/workflows/deploy-supabase.yml` when `main` changes.
- Shared database: Supabase project `qsllyeztdwjgirsysgai`. All database structure lives in `popcre/shared-db`; this repo's `shared-db/` folder is a read-only copy. **This plan needs no database structure change.**
- Catalog names live in `core.licensor`, `core.property`, `core.character` (each has `id`, `name`, `status`).

## 3. What triggered this work

The advisory AI reviewer on PR #794 (merged Nov 5, 2026) and PR #834 filed findings. Still open on `main` at `787c20b8`:

1. **Retired names enter the vocabulary** (#795 finding 1). `loadNames` (`index.ts:87-99`) selects only `name`, with no `status` filter and no retired-label filter. About 885 of ~15,000 characters are retired-looking labels ("Mickey - No Character Likeness", "Marvel Logo", "Venom - Do Not Use") and nearly all are `status = 'active'` (see `docs/plans/issue-652-retired-character-labels-dnu.md`). Their words ("logo", "general", "likeness", "elements") can become spelling corrections.
2. **`knownFullNames` only grows** (#835 finding 3). The module-level set (`index.ts:82`) is added to at `index.ts:246` and never cleared, so a renamed or retired name stays "known" for the life of the server instance and suppresses PopSG name expansion for that exact query.
3. **Silent save failure** (#835 finding 4). `rebuildSpellingNames` (`index.ts:102-114`) ignores the `error` returned by the `admin_config` upsert, so a failed write leaves every cold start re-reading ~17 pages without anyone knowing.
4. **Useless work on keyword PopSG searches** (#835 finding 2). The `popsg-query-embedding` action always awaits `spellingLookup.vocabulary()` (`index.ts:531`) even when `POPSG_SEARCH_MODE` is `keyword`, where the vocabulary cannot change the answer.
5. **Evaluator tests never run** (#795 finding 5). `scripts/search-eval/*.test.mjs` (run, score, step-timing, viewer-session) are not run by `.github/workflows/ci.yml` (Vitest includes only `src/`, `supabase/functions/` and `apps/**/src/**/*.vitest.ts`, `vitest.config.ts:21,29,54`; the `node --test` step at `ci.yml:80` lists other files).

Reproduce 1 read-only: `select count(*) from core.character where status not in ('archived','deleted') and name ~* '(do not use|\mlogo\M|no character likeness|\(general\))';` — a non-zero count means junk words are loaded today.

## 4. Scope

In: items 1–5 above, their tests, the docs line, live proof.

NOT in this plan:
- Retiring or renaming the junk character rows themselves (that is #652's work).
- Any change to the named-character search rule (`get_dam_search_named_rows`, #1037, closed) — note that its name lookup reads the database directly, not this vocabulary.
- Changing the spelling budgets, word cap or concurrency (already fixed; Step 0).
- The open items of plan `docs/plans/issue-725-search-spelling-canonical-vocabulary.md` (issue #725, outside this group). This plan **delivers its Steps 2–3** (status filter, retired-label exclusion); tell #725's owner in the Step 7 comment.
- Weighting characters lower than licensors (see §8).

# Part 2 — What we already know

## 5. Current state of the code (`main` at `787c20b8`)

- `supabase/functions/dam-search-ai/index.ts`
  - `:53` `VOCABULARY_TTL_MS` = 1 hour. `:80` `vocabularyCache`. `:82` `knownFullNames` (module-level `Set`). `:83` `normalizeName`. `:85` `SPELLING_NAMES_KEY = "SEARCH_SPELLING_NAMES"`.
  - `:87-99` `loadNames(table, signal)`: head count, then parallel 1,000-row pages selecting `name` ordered by `id`.
  - `:102-114` `rebuildSpellingNames`: loads three tables, upserts `admin_config` row `SEARCH_SPELLING_NAMES` = `{ built_at, names }`; upsert error ignored.
  - `:120-132` `spellingNames`: reads the saved row; missing → rebuild inline; older than 1 h → background rebuild via `EdgeRuntime.waitUntil`.
  - `:237-255` `spellingLookup.vocabulary()`: product words at weight 1,000,000, every saved name at 1,000,000 via `addNameToVocabulary`, and `knownFullNames.add(...)`.
  - `:505-547` `popsg-query-embedding` action; `:531` unconditional `await spellingLookup.vocabulary()`; `:532` exact-name check; `:535` `zeroResultFallback(..., knownFullNames, vocabulary, ...)` used only in hybrid mode.
  - `:191` the named-character lookup also passes `knownFullNames` to `namedLookupKeys` (spacing variants such as "spider man"). Rebuilding the set in Step 3 must keep it populated.
- `supabase/functions/_shared/search-spelling.ts`: word cap 16 (`:15,106`), two-stage budget 4 s / 1.5 s (`:16-23,122-124`), 4 concurrent counts (`:14,141`), alphabetical tie-break (`:75`). Tests in `search-spelling.test.ts`.
- `apps/worker/src/handlers/ai-tagging-shared.ts:259` `NOT_A_CHARACTER` — the canonical retired-label pattern used by tagging (`:296,478` also drop `archived`/`deleted`). Tested at `apps/worker/src/handlers/tag-finish.test.ts:163`.
- `src/test/core-licensor-property-contract.test.ts` — source-shape contract test reading `index.ts` as text.
- `supabase/functions/dam-search-ai/index.test.ts` — Vitest harness with a mocked `serviceClient`.

## 6. Key findings and root cause

- A status filter alone does not help: the junk labels are `active` (#652 measured 885, all but one active). Both filters are required.
- Edge functions cannot import from `apps/worker` (different deploy unit), so the regex must be copied, and a test must prove the two copies stay identical.
- The saved row is written by whichever instance rebuilds; if the key stayed the same, the row would keep old (unfiltered) names for up to one hour after deploy and the refresh is keyed to `built_at`, not the deploy. Step 2 therefore renames the key, which forces an immediate rebuild without any wait.
- `knownFullNames` must be replaced atomically: clearing it while a concurrent request is reading it would briefly empty it. Build a new `Set` and swap the reference.

## 7. Approaches considered and REJECTED

- **Filter in SQL with a regex in `.select()` (PostgREST `not.imatch`)**: works, but splits the rule between a JS regex and a URL filter string; keep one JS regex tested against the worker's.
- **Retire the junk rows first (#652)**: correct long term but a data project with owner decisions; spelling must be safe now.
- **Lower character weight to 1** (#725 plan's old locked decision): with the alphabetical tie-break already deterministic, the only effect would be preferring licensor/property words over characters at equal distance. Not needed for this goal; see §8.
- **New shared-db vocabulary table**: a schema project for a small list; the saved `admin_config` row already solves cold starts.
- **Clearing `knownFullNames` in place** (`.clear()` then refill): creates an empty window; swap instead.

## 8. Design decisions

- **LOCKED:** a name is excluded when `status` is `archived` or `deleted`, or the name matches the retired-label pattern. Applies to all three tables (licensor and property junk is rare, but the rule is uniform and cheap).
- **LOCKED:** the retired-label pattern is a copy of `NOT_A_CHARACTER` exported from a new dependency-free file `supabase/functions/_shared/retired-labels.ts` as `RETIRED_LABEL`, with a test that fails if its `.source`/`.flags` differ from the worker's.
- **LOCKED:** spelling always fails open (a failure searches as typed). A failed save is logged with `console.error`, never thrown to the caller.
- **LOCKED:** equal weights stay (1,000,000 for every canonical name); the alphabetical tie-break already makes results identical across instances. Reopen only if Step 7's scorecard shows a character outranking a licensor wrongly.
- **OPEN (implementer):** whether to filter `status` in the query (`.not("status","in","(archived,deleted)")`) or in the loop. Criterion: the page count used for paging must match the rows paged; if filtering in the query, the head count must use the same filter.

# Part 3 — How to build it

## 9. Steps

**Step 1 — Preflight and live counts.** `lead-only` (live read-only judgment).
- New worktree from `origin/main`; `npm ci`; `npm run test` passes before edits.
- Read-only SQL (Supabase MCP `execute_sql` or `psql` with the read-only connection in 1Password, see §12): counts of rows per table that the new rule would drop. Record the three numbers on #795.
- You'll know it worked when: the suite is green and the three counts are posted.

**Step 2 — Load only live names.** `helper-ok` — exact edits named; stop-and-ask if the head count and paged rows cannot use the same filter.
- Create `supabase/functions/_shared/retired-labels.ts`: `export const RETIRED_LABEL = /.../i` (copied from `ai-tagging-shared.ts:259`), `export const isLiveName = (name: string, status: unknown) => !["archived","deleted"].includes(String(status ?? "")) && !RETIRED_LABEL.test(name)`.
- In `index.ts:87-99` select `name,status`; return only names passing `isLiveName`.
- In `index.ts:85` rename the key to `SEARCH_SPELLING_NAMES_V2`, so no instance keeps serving the old unfiltered saved row for up to an hour after deploy (§6). Keep the constant name `SPELLING_NAMES_KEY`.
- Update `src/test/core-licensor-property-contract.test.ts` to assert `select("name,status")` (or the query filter chosen) and the `isLiveName` call.
- You'll know it worked when: tests in §10 named "retired labels" pass and `npm run test` is green.

**Step 3 — Rebuild the exact-name set on each refresh.** `helper-ok` — stop-and-ask if any other reader of `knownFullNames` appears.
- Change `const knownFullNames = new Set()` to `let knownFullNames: ReadonlySet<string> = new Set()`. In `vocabulary()` build `const names = new Set<string>()`, fill it, and assign `knownFullNames = names` only after the loop succeeds. Every reader (`:191`, `:210`, `:532`, `:535`) reads the variable at call time, so it sees the swap.
- You'll know it worked when: test "a name removed from the saved list is no longer an exact name after refresh" passes.

**Step 4 — Report a failed save.** `helper-ok` — none.
- In `rebuildSpellingNames` read `{ error }` from the upsert; on error `console.error("spelling name save failed", error.message)` and still return `names`. Pass the abort signal to the upsert (`.abortSignal(signal)`).
- You'll know it worked when: test "a failed save is logged and still returns the names" passes.

**Step 5 — Skip the vocabulary on keyword PopSG searches.** `lead-only` (changes a response a user sees).
- In the `popsg-query-embedding` branch, when `mode !== "hybrid"` or `semantic.embedding` is null: return `expansion: null`, `fallback: null` without awaiting `vocabulary()` or `popsgNameVectors()`. Hybrid behaviour unchanged.
- You'll know it worked when: test "keyword PopSG search reads no vocabulary" passes and the existing PopSG tests (`popsg-query-embedding.test.ts`) stay green.

**Step 6 — Run evaluator tests in CI.** `helper-ok` — stop-and-ask if any of the four files fails on `main` before your change.
- Add `scripts/search-eval/run.test.mjs scripts/search-eval/score.test.mjs scripts/search-eval/step-timing.test.mjs scripts/search-eval/viewer-session.test.mjs` to the `node --test` line at `.github/workflows/ci.yml:80` (or a sibling step named "Search evaluator tests").
- You'll know it worked when: the CI log of the PR shows those four files passing.

**Step 7 — Land and prove.** `lead-only`.
- Branch, PR to `main`, required checks green, merge (the AI merges; reviews are advisory). Confirm `deploy-supabase.yml` ran for the merge SHA.
- The new saved row is built at once because Step 2 renamed the key (`SEARCH_SPELLING_NAMES_V2`): the first search after deploy finds no row and rebuilds inline. Record the new row's `built_at` (read-only SQL). After the live proof below passes, delete the old `SEARCH_SPELLING_NAMES` row: nothing reads it any more and it is rebuildable from the core tables (record its `built_at` and name count on #795 first, so the deletion is documented).
- Live proof (signed in as a viewer at https://dam.designflow.app): searching `logoo` must not be corrected to "logo"; `captian amercia` must still correct to "captain america"; `batmn` still corrects. Read-only SQL: the saved row contains no name matching the retired pattern.
- Comment on #795 with merge SHA, deploy run, saved-row check and the three searches; close #795. Tell #725 that its Steps 2–3 are delivered.

## 10. Tests required

New, in `supabase/functions/_shared/retired-labels.test.ts`:
- "matches the worker's retired-label pattern exactly" — reads `apps/worker/src/handlers/ai-tagging-shared.ts` as text and compares the regex source and flags.
- "drops archived, deleted and retired-label names and keeps live ones" — `isLiveName` table: ("Mickey Mouse","active")→true, ("Marvel Logo","active")→false, ("Venom - Do Not Use","active")→false, ("Elsa","archived")→false, ("Elsa","deleted")→false, ("Elsa",null)→true.

New, in `supabase/functions/dam-search-ai/index.test.ts`:
- "retired labels never become spelling corrections" — saved row missing, core pages return "Marvel Logo" (active) and "Captain America"; `spelling` action on `logoo` returns `corrected: null`; on `captian` returns "captain".
- "a name removed from the saved list is no longer an exact name after refresh".
- "a failed save is logged and still returns the names".
- "keyword PopSG search reads no vocabulary" — asserts no `admin_config` read of `SEARCH_SPELLING_NAMES`.

Must stay green: `npm run test` (root Vitest), `npm run test --prefix apps/worker`, the CI `node --test` step.

## 11. Constraints and gotchas

- Feature branch and PR; never push to protected `main`. The AI merges after required checks; reviews never block.
- No database structure change; never add a migration to this repo. Writing the `admin_config` row is application data the function already writes.
- Every merge to `main` redeploys **all** edge functions; keep the PR to this scope.
- `index.ts` is edited by other search plans in parallel ([issue-935 plan](issue-935-dam-search-anchor-timing-lookup-hardening.md)); rebase before merging and re-run tests.
- Never quote times in UTC to the owner; use EST.

## 12. Access and environment

- `gh` authenticated as `u2giants`. Supabase MCP or the read-only database connection: 1Password vault `vibe_coding`, item for the shared Supabase project (search "qsllyeztdwjgirsysgai"). Never paste values.
- Viewer login for live proof: 1Password `vibe_coding`, the PopDAM test viewer item (search "popdam viewer").
- Local: `npm ci`, `npm run test`. Edge function tests run under Vitest; no Deno needed.

# Part 4 — Landing it

## 13. Definition of done, risks, open questions

Done when: Steps 1–7 are ✅ with artifacts in STATUS; PR merged; required checks green; `deploy-supabase.yml` succeeded for the merge SHA; live searches recorded on #795; #795 closed; this plan's `status` set to `done`.

Risks and rollback: over-filtering a real name whose text contains "logo" as a word (e.g. a property actually named "... Logo Collection") — the Step 1 counts show what is dropped; if a real name is lost, narrow the pattern in both copies together. Rollback: revert the PR; the saved row self-heals within an hour.

Open: none beyond §8's OPEN item.

## Self-audit (Mode A gate)

1. *Could a new session execute this without asking?* Yes — §2 defines the app and data, §5 gives every line, §9 names each edit and gate, §12 names access by location.
2. *Does it carry all background, including ruled-out paths?* Yes — §3 lists each open finding with source, §6 the non-obvious facts (active junk rows, atomic swap, stale saved row), §7 the rejected options.
3. *Is the goal clear enough to steer by?* Yes — §1 says live names only, never slower, and that the goal wins over the steps.

## Lead launch prompt

```
Read docs/plans/issue-795-spelling-vocabulary-retired-names.md in u2giants/popdam3 (STATUS first), then AGENTS.md.
You are the lead. Do Steps 1, 5 and 7 yourself. Hand Steps 2, 3, 4 and 6 to your helper in that order, one at a time, and verify each gate yourself before the next.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges, pushes or GitHub posts; bring back any stop-and-ask trigger; if stuck 30 minutes, the lead takes the step back.
Lead checks: npm run test green, the new tests named in §10 present and passing, CI green on the PR, deploy run for the merge SHA, live searches on dam.designflow.app.
Delegation sheet: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
```
