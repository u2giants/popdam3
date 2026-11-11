---
summary: Issue #734 plan: PopSG meaning-based search behind a switch; indexing keeps resuming (#706). Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-734
---

# Plan: Review finding: u2giants/popdam3#730 PopSG meaning-based search behind a switch; indexing keeps resuming (#706) (u2giants/popdam3#734)
Issue: https://github.com/u2giants/popdam3/issues/734
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Re-confirm the bug on current `main` | ⬜ open | |
| 2 | Extract the action body into a tested helper and fix the product-code call | ⬜ open | |
| 3 | Regression tests for the helper | ⬜ open | |
| 4 | Advisory `deno check` for `dam-search-ai` in CI | ⬜ open | |
| 5 | Document the two config keys | ⬜ open | |
| 6 | PR, merge, verify edge deploy, keyword-mode smoke | ⬜ open | |
| 7 | Correct the #706 plan; leave live-proof checklist on #734 | ⬜ open | |

**Where a fresh session starts:** step 1. Steps 2 to 5 belong in one PR.

---

## 1. The ultimate goal

When the administrator eventually turns on meaning-based search for the style-guide library, typing "cute yellow character holding balloons" must really use meaning. Today that switch would do nothing, with no error anywhere: everybody would believe the feature was on while they were still getting keyword results. After this work, turning the switch on actually works, real product codes still skip the meaning search, and the build catches this kind of mistake before it ships.

**If a step conflicts with this goal, the goal wins: stop and flag it.**

## 2. What this application is

PopDAM (https://dam.designflow.app, licensed-art asset manager) and PopSG (https://sg.designflow.app, style-guide library) are POP Creations internal tools used by designers, sales and administrators. Repo `u2giants/popdam3`, default branch `main`. Stack: one React 18 + Vite frontend in `src/` (GHCR image, Coolify app `qxj8a0j3tpa9lq4q5rs6pezy`); Supabase edge functions in `supabase/functions/` (project `qsllyeztdwjgirsysgai`, Virginia; deployed by `.github/workflows/deploy-supabase.yml` on changes to `supabase/functions/**`); a long-running job worker in `apps/worker` on Railway (auto-deploys on every push to `main`, which restarts it); agents on the NAS and Windows machines. Database structure is owned by `popcre/shared-db` (canonical checkout `/worksp/shared-db`); `shared-db/` here is a read-only mirror.

The relevant path: `src/pages/popsg/PopSGLibraryPage.tsx` asks edge function `dam-search-ai` (action `popsg-query-embedding`) to turn the typed words into a 768-number vector (a SigLIP2 "embedding"), then passes it to the database function `search_style_guide_library_v2`.

## 3. What triggered this work

PR #730 (**merged** 2026-11-04 at 22:03 UTC, 5:03 PM EST, commit `9ea3fff3`) added the action. Its advisory DeepSeek review, posted as #734, reported three findings against head `98ee0eb2`. The issue text and the PR comment are both cut off with "[findings truncated]" inside the "Checked and found sound" list; all three numbered findings are complete and the lost text is praise only.

Reproduce without production changes: run `npx -y deno check --config supabase/functions/deno.json supabase/functions/dam-search-ai/index.ts`. On checkout `39e428ef` (2026-11-04, about 6:05 PM EST) it failed with exactly one error, `TS2554: Expected 2 arguments, but got 1`, at `index.ts:130:54`.

## 4. Scope

In: the three findings, namely the broken call, the missing CI and test coverage, and the undocumented keys.

### NOT in this plan
- Turning `POPSG_SEARCH_MODE` on. Activation is gated by coverage, latency and relevance work in [issue-706 plan](issue-706-popsg-semantic-search-restart-and-acceptance.md).
- The silent keyword fallback in the browser (`PopSGLibraryPage.tsx:141-145`). The review called it correct, yet it differs from the November 1 "error + Retry" contract in the #706 plan. It stays #706 step 5's decision; step 7 records it there.
- Any access check on the embedding action (section 11 notes the current behaviour).
- Fixing the 24 other `deno check` errors in other functions (section 6).
- Database changes of any kind.

## 5. Current state of the code

Checkout `39e428ef`; `origin/main` on GitHub had moved to `ef8ca260` (#724, which touches only worker files), so all citations below are unaffected.
- `supabase/functions/dam-search-ai/index.ts:119-137`: the action. **Line 130 is the bug:** `!isProductCodeSearch(query)`, no lookup argument and no `await`.
- `supabase/functions/dam-search-ai/index.ts:189-192`: the correct call in the DAM `search` action.
- `supabase/functions/_shared/product-code.ts:24-43`: `isProductCodeSearch(query, lookup)`, async, fails open. Tests exist in `supabase/functions/_shared/product-code.test.ts`.
- `src/pages/popsg/popsgSearchV2.ts:169-177` `parsePopSGQueryEmbedding`: null vector means keyword only. `:201-204` passes it on.
- `src/pages/popsg/PopSGLibraryPage.tsx:132-146`: the caller.
- `.github/workflows/edge-functions-format.yml:25-61`: `deno fmt` only. `tsconfig.app.json:32-34` includes only `src`, so edge functions are never type-checked.
- `docs/configuration.md:112-115`: neighbouring keys; the two new keys are absent.
- Live, read-only, 2026-11-04 about 6:05 PM EST: `admin_config` has **no rows** for `POPSG_SEARCH_MODE`, `POPSG_SEARCH_MIN_SEMANTIC_SCORE` or `POPSG_SEARCH_AUTO_EMBED_ENABLED`. So mode is `keyword` for everyone and **no user is affected today**.

No fix exists on any branch; the fixer bot has not commented on #734.

## 6. Key findings and root cause

- **Still open on `main`.** Because `isProductCodeSearch` is async, the unawaited call yields a Promise, which is always truthy, so `!Promise` is always `false` and `embedding` is always `null`. The missing `lookup` would throw inside the async function, get caught at `product-code.ts:39-41`, and log a misleading "product code lookup failed" line, though it never resolves in time to matter.
- **Root contributor:** edge functions have no type check. `deno check` catches it instantly.
- **Baseline for a CI gate (measured 2026-11-04):** `deno check` of all `supabase/functions/*/index.ts` reports 25 errors. Location lines, which include related-information lines and so total more than 25: 20 in `agent-api/index.ts`, 3 in `_shared/export-tables.ts`, 2 each in `export-table` and `export-sql-dump`, 1 in `_shared/coldlion.ts`, and the one at `dam-search-ai/index.ts:130`. A check over everything would be red from day one; a check of `dam-search-ai` alone is clean after this fix.
- `deno` is not installed on hetz; `npx -y deno` (2.9.6) works. Set `DENO_DIR` to a scratch folder so the download cache stays out of the repo.

## 7. Approaches considered and REJECTED

- **One-line fix in `index.ts` only:** fixes today's bug, but `index.ts` calls `corsServe` on import and cannot be imported by vitest, so the action stays untested, which is the second finding.
- **Check all edge functions in CI:** 24 unrelated errors, mostly in `agent-api`; fixing those is a separate risk on the agent ingest path.
- **Making the check a required check:** the lean-checks ruling (2026-10-30) allows blocking only for production-data damage or secret leaks. It stays advisory.
- **Source-text test (`expect(source).toContain("await isProductCodeSearch")`):** passes on wrong behaviour.
- **Guessing product codes from query shape:** rejected earlier by `product-code.ts:5-6`; only a code that exists counts.

## 8. Design decisions

- **LOCKED:** product-code lookup stays against `style_groups.sku` via `serviceClient()`, identical to `index.ts:191`. It only decides whether to skip embedding and returns nothing to the caller.
- **LOCKED:** the lookup and the embed run only when mode is hybrid and the query is non-empty, so keyword mode costs no extra query.
- **LOCKED (per #706 plan and `plan_semantic_search_popdam_popsg.md:119`):** SG switch independent of DAM, default keyword; never reuse the DAM floor.
- **LOCKED:** the type-check is advisory and scoped to `dam-search-ai`.
- **OPEN:** exact helper parameter names. Criterion: all database and network effects are injected so the test needs no Deno globals.

## 9. The plan

**Step 1. Re-confirm.** Update your worktree from `origin/main` and run the `deno check` from section 3. You'll know it worked when the same single error appears, or, if it has been fixed, skip step 2's fix and keep only what is missing.

**Step 2. Extract and fix.** Create `supabase/functions/_shared/popsg-query-embedding.ts` exporting `resolvePopSGQueryEmbedding({ query, storedMode, storedFloor, lookupProductCode, embed })`. It returns `{ ok: true, mode, embedding, min_semantic_score }`, the same response as now. Move lines 128-135 into it using `unwrapConfigValue` and `parseSemanticFloor`. Trim the query once; non-string becomes `""`. Evaluate `mode === "hybrid" && query` first, then `await isProductCodeSearch(query, lookupProductCode)`, then `await embed(query)`. In `index.ts` keep lines 123-127 (service-role refusal, config read, 503) and pass `async (pattern) => await serviceClient().from("style_groups").select("id").ilike("sku", pattern).limit(1)` and `embedQueryText`. Consider a shared const for that lookup with line 191; it must be the same query. Depends on nothing. You'll know it worked when `deno check` on `dam-search-ai` exits 0.

**Step 3. Tests.** See section 10. You'll know it worked when `npx vitest run supabase/functions/_shared/popsg-query-embedding.test.ts` passes, and the first test fails if you temporarily drop the `await`.

**Step 4. CI.** In `.github/workflows/edge-functions-format.yml` add a separate job `deno-check` after `deno-fmt`, with the same `route` dependency and runner expression, `contents: read`, same pinned checkout and `setup-deno` actions, running `deno check --config supabase/functions/deno.json supabase/functions/dam-search-ai/index.ts`. Do not change required checks in repository settings. The existing job pushes formatting commits; add `needs: [route, deno-fmt]` only if it does not stop the check from running when formatting pushes, otherwise use `needs: route`. You'll know it worked when the PR shows a green `deno-check` job; prove it can fail by reading the local failure from step 1.

**Step 5. Docs.** In `docs/configuration.md` next to line 114, add `POPSG_SEARCH_MODE` (`keyword` default or `hybrid`; absent means keyword; independent of `SEARCH_MODE`; activation gates in `plan_semantic_search_popdam_popsg.md`) and `POPSG_SEARCH_MIN_SEMANTIC_SCORE` (floor on semantic-only candidates, keyword hits unaffected; absent means no floor; not tuned from the DAM value; no Settings screen yet). You'll know it worked when `grep -n POPSG_SEARCH_M docs/configuration.md` shows both.

**Step 6. Land.** Open the PR with `Fixes` deliberately omitted (live proof remains), wait with `bin/ai-pr-wait <pr>`, merge. `deploy-supabase.yml` deploys all functions. This touches no worker code, so the active tagging run is not restarted. Smoke as the PopSG tester: POST `{action:"popsg-query-embedding",query:"cute yellow character"}`. You'll know it worked when the response is `mode:"keyword", embedding:null`, and the PopSG library page still returns results for that search.

**Step 7. Bookkeeping.** The [issue-706 plan](issue-706-popsg-semantic-search-restart-and-acceptance.md) section 5 says no code references `POPSG_SEARCH_MODE`; #730 made that stale. Update that plan's current state and add the browser-fallback question to its step 5. On #734 post evidence (PR, merge SHA, CI run) and add `- [ ] live proof: with POPSG_SEARCH_MODE=hybrid during #706 activation, the action returns a 768-length embedding for a descriptive query and null for a real SKU`. You'll know it worked when that checklist is on #734.

### Adversarial cases (typed search text and stored config are external input)

| Input | Hostile case | Test |
|---|---|---|
| `query` | non-string, empty, or spaces | `non-text or blank queries never look up or embed` |
| `query` | real SKU with `%` or `_` wildcards | `wildcards in a query are escaped before the lookup` (existing `escapeLikePattern` tests cover the escape; assert the pattern passed through) |
| `query` | very long text | `long queries reach the embedder unchanged and it truncates` (`embedQueryText` slices to 8,000 at `index.ts:65`) |
| Lookup | returns an error or throws | `a failed product-code lookup still embeds` |
| Embedder | returns null | `an embed outage returns null, not an error` |
| `POPSG_SEARCH_MODE` | `"HYBRID"`, number, object, wrapped JSON | `only the exact value hybrid turns the meaning search on` |
| `POPSG_SEARCH_MIN_SEMANTIC_SCORE` | junk | `a junk floor parses to null` |

## 10. Tests required

New `supabase/functions/_shared/popsg-query-embedding.test.ts` (vitest "edge-functions" project), with injected fakes:
- `hybrid mode embeds a descriptive query`: this is the regression; the lookup is called exactly once and the embedding is returned.
- `hybrid mode skips embedding for a real product code`.
- `keyword mode neither looks up nor embeds`.
- All tests named in the adversarial table.

Must stay green: full CI, especially `supabase/functions/_shared/product-code.test.ts` and the `parsePopSGQueryEmbedding` tests in `src`.

## 11. Constraints and gotchas

- Feature branch + PR to `main`; never push to `main`. The AI merges; Albert does not. Albert is not technical: never ask him to click, type, create a credential or approve. Only business-meaning questions go to him.
- CI (`.github/workflows/ci.yml`): `npm ci && npm run lint && npm run typecheck && npm run test` at root; `npm ci --prefix apps/worker && npm run build --prefix apps/worker && npm run test --prefix apps/worker`; `npm ci --prefix apps/windows-agent && npm test --prefix apps/windows-agent`; `npm run build`. Wait with `bin/ai-pr-wait <pr>` in the background; never a sleep loop. AI reviews are advisory and never block; required checks stay lean.
- Database structure changes never go in this repo; they go through `popcre/shared-db`, claim-first on the existing issue, loading the `shared-db-change` skill. Production database is read-only by default; migrations reach production only through shared-db's automatic promotion workflow.
- Secrets live in 1Password vault `vibe_coding`; reference by vault + item title only, never values.
- Sign every GitHub post with `$AI_GH_SIGNATURE`. Quote human times in EST (America/New_York).
- Live proof is required before an outcome is closed. If it cannot happen yet, leave `- [ ] live proof` on this SAME issue; never open a follow-up issue for it.
- No band-aids, no silent failures, nothing hard-coded beyond what this plan names as a locked decision.
- `.schema("core")` and similar calls produce unrelated type errors elsewhere; do not widen the check to chase them.
- Observation, unchanged: any signed-in user can call this action, even without style-guide access, and cause an embed. The RPC enforces access to results. Note it on #706 if a cost or abuse question arises.
- `edge-functions-format.yml` can push a formatting commit to your branch; pull before amending.

## 12. Access and environment

- Machine: hetz (the production VPS). `gh` is authenticated for `u2giants/popdam3`. Supabase read-only SQL is available through the `supabase` MCP (`execute_sql`); if it is unauthorized or hits the old Ohio project, see the memory note on secret and DB access paths. Confirm the project is `qsllyeztdwjgirsysgai`.
- Work in your own git worktree. Test logins: 1Password vault `vibe_coding`, items "PopSG / PopDAM AI tester login" (user role) and `ai-admin@designflow.app` (administrator). See `docs/1password.md`. Never screenshot PopSG Settings -> Setup (it renders the NAS password).
- Local type check: `DENO_DIR=<scratch> npx -y deno check --config supabase/functions/deno.json supabase/functions/dam-search-ai/index.ts`. Local tests: `npx vitest run <file>`.

## 13. Definition of done, risks, open questions

- [ ] Helper, tests, CI job, docs committed on a feature branch; PR merged; CI green.
- [ ] `deploy-supabase.yml` run succeeded for the merge SHA; keyword smoke passed.
- [ ] #706 plan corrected; this STATUS updated with artifacts; `- [ ] live proof` on #734.
- [ ] #734 closes only after that proof, during #706 activation.

**Risks:** all edge functions redeploy on merge. Behaviour is unchanged while the key is absent, so the risk is small. Rollback: revert the PR. **Uncertain:** whether the `needs` wiring in step 4 skips the check after a formatting push; the criterion is given there. No business questions for Albert.

## Self-audit

1. *Could a brand-new session execute this without asking?* Yes: sections 2, 5 and 9 give location, exact call and gates; section 12 gives the tools. Gap found and fixed: the live proof depends on #706, stated in step 7.
2. *Does it carry all background, including what was ruled out?* Yes: sections 3, 6, 7, including the measured 25-error baseline and the truncated review text.
3. *Is the goal clear enough for judgment calls?* Yes: section 1 states that the switch must really work and section 8 says what must not change.
