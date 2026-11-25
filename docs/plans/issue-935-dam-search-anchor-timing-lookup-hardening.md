---
summary: "Combined plan for issues #935, #930, #1127 and #1052: dam-search-ai picture-floor anchor (no-score answers, explicit filters), honest per-step timing, a retried name lookup, text-vector cache keyed by model, and bounded scope lists. Read its STATUS first."
kind: plan
status: open
read-when: "implementing issue #935, #930, #1127 or #1052, or changing the dam-search-ai search action's anchor, timing, name lookup or text-vector cache"
---

# Plan: dam-search-ai search action hardening (u2giants/popdam3#935, #930, #1127, #1052)

Issues covered (all are advisory-review findings on merged PRs; "fixer-deferred" labels are not proof of a fix):
- [#935](https://github.com/u2giants/popdam3/issues/935) — review of PR #934 (licensor-scoped picture-floor anchor).
- [#930](https://github.com/u2giants/popdam3/issues/930) — review of PR #929 (per-step search timing, #804).
- [#1127](https://github.com/u2giants/popdam3/issues/1127) — review of PR #1073 (named-character lookup in one database call).
- [#1052](https://github.com/u2giants/popdam3/issues/1052) — review of PR #1051 (text-meaning leg). The reviewer's full findings text was **not saved** (the issue body holds only its closing paragraph; the workflow log does not keep it). Its own summary names four themes: "cache model-keying, scope-array caps, anchor routing, plan/rollout notes". This plan re-derived each against `main` (§6).

One plan because all four change the same `search` branch of `supabase/functions/dam-search-ai/index.ts:581-852`; separate PRs would conflict line by line.

Handoff that registers this plan: [HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-search-group-plans.md](../../HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-search-group-plans.md).
Written November 25, 2026, 3:58 PM EST on `al8960ofc` by Claude Code (worktree `modest-wu-eadf20`), against `origin/main` `787c20b8`. Planning only: nothing was changed.

## STATUS — read before executing

| Step | State (Nov 25, 2026) | Evidence |
|---|---|---|
| 0. Findings already resolved on `main` | ✅ verified in planning | #935 f1 / #1127 f1: RPCs exist in the mirror — `shared-db/supabase/migrations/20261111004721_dam_search_semantic_anchor_scoped.sql`, `20261218084707_dam_search_named_lookup.sql`; #1127 f3: fixer showed aliases were already included; #1052 "plan/rollout notes": #1037 closed, plan STATUS records rollout (`docs/plans/issue-1037-typed-search-meaning-matching.md:16-27`) |
| 1. Preflight, live measurements | ⬜ open | |
| 2. Anchor: "no score" is not an error (#935 f2) | ⬜ open | |
| 3. Anchor: explicit sidebar filters scope the anchor (#935 f3, #1052 anchor routing) | ⬜ open | |
| 4. Name lookup: one retry inside its budget (#1127 f2) | ⬜ open | |
| 5. Text-vector cache keyed by model (#1052) | ⬜ open | |
| 6. Bounded scope lists (#1052) | ⬜ open | |
| 7. Timing: counts not durations, failures logged, retries timed, header readable (#930) | ⬜ open | |
| 8. Tests (#935 f4, #930 f5) | ⬜ open | |
| 9. Land, deploy, scorecard, live proof, close all four | ⬜ open | |

**Start at Step 1.** Steps 2–7 are independent edits in one file; do them in order to keep the diff readable.

---

# Part 1 — Why

## 1. Ultimate goal

A POP Creations employee who searches PopDAM — with or without a licensor, property or character picked in the sidebar — gets the right products, and gets an honest "Search unavailable, Retry" only when something really failed. A search must never fail just because the chosen licensor has no picture fingerprints, never fail on one slow database moment that a retry would have survived, and never keep failing after an admin changes the text model. Engineers diagnosing slow or failed searches must be able to trust the timing numbers.

**If a step conflicts with this goal, the goal wins — stop and flag it on the issue concerned.**

## 2. What this application is

- **PopDAM** ([u2giants/popdam3](https://github.com/u2giants/popdam3), branch `main`, public): internal library of licensed consumer-product art at https://dam.designflow.app. Products are "style groups" holding files ("assets").
- The browser calls the Supabase edge function `dam-search-ai`, action `search` (`src/lib/dam-search.ts`), which calls database function `public.search_dam_documents`. Edge functions deploy on every merge to `main` (`.github/workflows/deploy-supabase.yml`) — **all** functions redeploy.
- Search legs: exact words (keyword), picture fingerprints (SigLIP2, 768 numbers per product), and text meaning (Qwen3 text vectors, 1024 numbers, on when `admin_config.SEARCH_TEXT_LEG_MODE = 'on'`). Query vectors come from the `apps/text-embed` service (`TEXT_EMBED_URL`).
- **Picture floor / anchor**: before searching, the function asks the database for the best picture score inside the search's scope (the "anchor"), then keeps only picture matches within a margin of it (`supabase/functions/_shared/semantic-floor.ts:38-45`). Three anchor functions: `dam_search_semantic_anchor` (no scope), `dam_search_semantic_anchor_scoped` (licensor ids), `dam_search_semantic_anchor_named` (named character/property scope keys).
- **Named scope** (#1037 owner decision D1): a search that names a character shows only products with that character; one that names a property scopes picture-only matches to it. Built from `get_dam_search_named_rows` (`index.ts:180-219`) and `supabase/functions/_shared/named-characters.ts`.
- Shared database: Supabase `qsllyeztdwjgirsysgai`; structure only through `popcre/shared-db`. **This plan changes no database structure.**

## 3. What triggered this work

Advisory reviews of merged PRs #929, #934, #1051, #1073. Open on `main` `787c20b8`:

- **#935 f2**: `index.ts:768-769` — an anchor that answers with no number (`null`) is treated as an error, so the whole search returns 503. The anchor contract says null means "no anchor, apply no relative floor" (`shared-db/supabase/migrations/20261029094242_dam_search_semantic_anchor.sql:14-15`; the scoped function returns `null` for an empty scope, `20261111004721_...:55-58`). A licensor with no picture fingerprints in the requested document types therefore breaks every picture search naming it.
- **#935 f3 / #1052 anchor routing**: an explicit sidebar licensor filter makes `withSemanticLicensorScope` return the filters unchanged (`supabase/functions/_shared/named-licensors.ts:35`), so the anchor runs unscoped (`index.ts:743-752`) while the search is scoped — another licensor's closer picture raises the floor past every in-scope picture match. The same holds for explicit `propertyId` / `characterId` filters, which `withNamedScope` skips (`named-characters.ts:210-220`) and `pickScopeKeys` drops (`:237-239`).
- **#1127 f2**: `loadNamedScope` (`index.ts:180-219`) makes one attempt with a 5 s timeout (`:56`) and any failure returns 503 (`:676-679`); every other required call gets one retry (`:763-767`, `:796-800`).
- **#1052 cache model-keying**: the per-instance text-vector cache (`supabase/functions/_shared/query-embed-batch.ts:70-85,93-96`) returns a cached vector stamped with the old model after an admin changes `SEARCH_TEXT_EMBEDDING_MODEL`; `index.ts:719-721` then fails that query with 503 until the entry is evicted or the instance restarts.
- **#1052 scope-array caps**: `namedCharacterScope` (`named-characters.ts:168-205`) sends every character id linked to a named property (`semanticPropertyCharacterIds`) with no size limit; a large property sends thousands of ids into `p_filters` on every variant call.
- **#930 f1**: `timer.add("variants", queryVariants.length)` (`index.ts:804`) emits a count as `variants;dur=3.0` in `Server-Timing` and as a millisecond step in the log line.
- **#930 f2**: a thrown error inside the `search` block skips `timer.finish` (`index.ts:582-851`), so failed requests produce no timing log.
- **#930 f3**: retries (`index.ts:766`, `:799`) are not timed.
- **#930 f4**: `Server-Timing` is not in `CORS_EXPOSE_HEADERS` (`supabase/functions/_shared/http.ts:22`), so browsers cannot read it.
- **#935 f4 / #930 f5**: no tests for null anchors, explicit-filter anchors, or the timing header shape. (Today `index.test.ts:544` only checks some step names are absent.)

Reproduce #935 f2 (read-only): pick a licensor id with no `dam.search_group_vectors` rows and call `select public.dam_search_semantic_anchor_scoped(<any 768 vector>, array['style_group'], array['<id>']::uuid[]);` → `null`. A UI search naming that licensor plus a picture word returns "Search unavailable".

## 4. Scope

In: the items in §3, tests, docs line in `docs/SEARCH_EVAL.md` or this plan, live proof.

NOT in this plan:
- Any shared-db function change. If Step 1 shows a property scope list too large to send, the server-side expansion is a **separate** shared-db plan (§8).
- Spelling vocabulary work ([issue-795 plan](issue-795-spelling-vocabulary-retired-names.md)).
- Changing the named-character rule's meaning, the floor margin, or the text-leg floor values.
- The PopSG search path (`popsg-query-embedding`).
- Frontend changes, except none are needed (the timing header is for DevTools and scripts).

# Part 2 — What we already know

## 5. Current state of the code (`main` `787c20b8`)

- `supabase/functions/dam-search-ai/index.ts`
  - `:56` `NAME_SCOPE_TIMEOUT_MS = 5000` (raised after Nov 18 live 503s at ~1.5 s). `:180-219` `loadNamedScope`; returns `{}` when no phrases, `null` on any failure.
  - `:456-480` `stepTimer()` (`add`, `time`, `finish`). `finish` writes `Server-Timing` and logs `{event:"dam_search_timing", status, steps}`.
  - `:581-852` `search` action inside `return timer.finish(await (async () => {...})())`.
  - `:659-670` prepare phase: embed, floor config, licensor names, named scope in parallel.
  - `:731-802` `callSearch(variant)`: anchor choice `:743-752`, anchor call + one retry `:753-771`, search call + one retry `:774-800`.
  - `:804` `timer.add("variants", ...)`.
- `supabase/functions/_shared/query-embed-batch.ts:53-85` two LRU caches (picture vectors; text vectors stored as `{vector, model}`), `:88-118` `embedAllWithText`.
- `supabase/functions/_shared/named-characters.ts:60-62` caps typed phrases (8 words, 500 chars), `:86` 4,000 lookup keys; **no cap on output id lists**.
- `supabase/functions/_shared/named-licensors.ts:30-37` `withSemanticLicensorScope`.
- `supabase/functions/_shared/semantic-floor.ts:38-45` `effectiveSemanticFloor(adminFloor, best)` already handles `best = null` (returns the admin floor).
- Database (mirror, read-only): `dam_search_named_scope` (`shared-db/supabase/migrations/20261225010417_dam_named_anchor_group_scope_only.sql:82-101`) unions groups by `semanticPropertyIds` **and** by `semanticPropertyCharacterIds`; an empty character list with a property id still scopes to that property's groups. NULL key = no scope; empty array = scope that allows nothing (`:47`).
- Tests: `supabase/functions/dam-search-ai/index.test.ts` (Vitest, mocked clients; anchor mock at the top of the file matches any RPC name starting with `dam_search_semantic_anchor`), `_shared/query-embed-batch.test.ts`, `_shared/named-characters.test.ts`, `_shared/named-licensors.test.ts`.

## 6. Key findings

- #935 f1 and #1127 f1 ("RPC does not exist") were true at review time and are moot now: both functions are in the mirror and live search uses them (Step 0).
- #1127 f3 (aliases suppress character scoping) — the fixer proved the old code already included aliases; no change.
- #1052's four themes, re-derived: (a) model-keyed cache — real, §3; (b) scope-array caps — real, size unknown until Step 1 measures; (c) anchor routing — the explicit-filter gap, merged with #935 f3; (d) plan/rollout notes — moot, #1037 closed with its rollout recorded.
- A null anchor cannot "flood" results: null means no in-scope product has a picture fingerprint, so there are no in-scope picture-only matches to flood. The admin floor still applies.
- The 30 s request budget (`supabase/functions/_shared/search-request-budget.ts:2`) bounds everything; a retry must also respect `requestSignal`.

## 7. Approaches considered and REJECTED

- **Fail open on name-lookup failure (search without the named rule):** shows wrong characters, which owner decision D1 forbids; the current fail-closed answer stays, it just gets a retry.
- **Longer single timeout instead of a retry:** a stuck connection waits the whole time; two shorter attempts recover from one bad round trip, matching the other calls.
- **Clear the whole text cache when the model setting changes:** needs change detection; checking the stamp per hit is simpler and exact.
- **Truncating `semanticPropertyCharacterIds` silently:** drops real products from the scope — a wrong answer. Rejected; see §8.
- **Putting the count in `steps` with a unit suffix:** consumers parse `steps` as milliseconds; keep counts in a separate field.

## 8. Design decisions

- **LOCKED (anchor contract, shared-db migration comment):** anchor `null` → no relative floor; the admin floor (`SEARCH_MIN_SEMANTIC_SCORE`) still applies; an anchor **error** after its retry still fails the search (the Nov 2026 "288 groups for spiderman coir" flood rule, `index.ts:733-736`).
- **LOCKED (owner D1/D4, #1037):** a failed name lookup still answers "Search unavailable" after its retry.
- **LOCKED:** explicit sidebar filters scope the anchor the same way they scope the search: `licensorId` → `dam_search_semantic_anchor_scoped` with that id (when no named-licensor scope already applies); `characterId` → named anchor with `requiredCharacterIds: [characterId]`; `propertyId` → named anchor with `semanticPropertyIds: [propertyId]`, `semanticPropertyCharacterIds: []`. If both a named scope and explicit filters exist, the named anchor receives the union of keys. The web app sends `licensorId` and `propertyId` as single id strings (`src/lib/dam-search.ts:47-48`); it never sends `characterId`, which only API callers (the worker, scripts) can pass — handle it when present, the same way.
- **LOCKED:** name lookup = up to two attempts, each with its own 4 s timeout, both bound to `requestSignal`; no wait between attempts.
- **LOCKED:** `Server-Timing` entries are durations only; the variant count goes to `variants;desc="N"` in the header (no `dur`) and `counts: { variants: N }` in the log line.
- **OPEN — scope-list cap (decide from Step 1's numbers):** if the largest property's linked-character list and the largest same-named character list are both ≤ 2,000 ids, add a guard that logs `named scope list large` above 2,000 and a test pinning the behaviour, and send as today. If either exceeds 2,000, stop: open a shared-db plan for server-side expansion (send property ids only) and note it on #1052; do not truncate.

# Part 3 — How to build it

## 9. Steps

**Step 1 — Preflight and live measurements.** `lead-only` (read-only live judgment).
- Worktree from `origin/main`; `npm ci`; `npm run test` green before edits.
- Read-only SQL: (a) `select max(n) from (select property_id, count(*) n from core.property_character_associations_current group by 1) x;` (b) largest same-name character group: `select max(n) from (select lower(name), count(*) n from core.character group by 1) x;` (c) count of licensors whose style groups have no row in `dam.search_group_vectors` (shows how common #935 f2 is). Post the numbers on #1052 and #935.
- You'll know it worked when: three numbers are posted and §8's OPEN cap is decided in a comment.

**Step 2 — Null anchor is "no floor", not an error.** `lead-only` (decides a production outcome).
- `index.ts:768-770`: `if (anchor.error) anchorError = anchor.error; else if (anchor.data === null) bestSemanticScore = null; else if (typeof anchor.data !== "number") anchorError = ...; else bestSemanticScore = anchor.data;` Log `console.info("anchor returned no score; admin floor only")` once per call.
- You'll know it worked when: test "a scoped anchor with no score keeps the admin floor and returns results" passes and "an anchor error after its retry still fails the search" passes.

**Step 3 — Explicit filters scope the anchor.** `lead-only`.
- Add a pure helper `anchorScope(filters, licensorScope, namedFilters)` in `supabase/functions/_shared/named-characters.ts` (or a new `_shared/anchor-scope.ts`) returning `{ rpc, args }` per §8. Replace `index.ts:743-762` with it. Keep `pickScopeKeys` for the named keys.
- You'll know it worked when: tests "an explicit licensor filter anchors on that licensor", "an explicit character filter anchors inside it", "an explicit property filter anchors inside it" pass, and existing tests at `index.test.ts:343,364,387,396,405` stay green.

**Step 4 — Name lookup retry.** `helper-ok` — stop-and-ask if `requestSignal` handling differs from what §8 says.
- In `loadNamedScope`, wrap the RPC in an `attempt()` with its own `AbortController` (4 s, also aborted by `requestSignal`); on error/timeout/malformed payload, `console.error("named lookup failed; retrying once")` and call `attempt()` again; return `null` only after the second failure. Rename `NAME_SCOPE_TIMEOUT_MS` to `NAME_SCOPE_ATTEMPT_MS = 4000` and update the comment at `:54-55`.
- You'll know it worked when: tests "the name lookup retries once and then searches" and the existing "returns Retry when the name lookup reaches its deadline" (`index.test.ts:169`, updated for two attempts) pass.

**Step 5 — Model-keyed text cache.** `helper-ok` — stop-and-ask if any caller other than `index.ts:656` uses `embedAllWithText`.
- `query-embed-batch.ts`: `embedAllWithText(texts, expectedModel?: string)`; treat a cached text vector whose `model !== expectedModel` as a miss. `index.ts:656` passes `textLeg.model`.
- You'll know it worked when: test "a cached text vector from another model is re-embedded" passes in `query-embed-batch.test.ts`.

**Step 6 — Scope-list bound.** `lead-only` (outcome of the §8 OPEN decision).
- Implement whichever branch Step 1 decided. In the ≤ 2,000 branch: a `MAX_SCOPE_IDS = 2000` constant in `named-characters.ts`, `console.warn` above it, and the test below; no truncation.
- You'll know it worked when: test "a property with many characters is sent whole and logged" passes, or a shared-db plan is linked from #1052.

**Step 7 — Honest timing.** `helper-ok` — stop-and-ask if `finish` must change the response body.
- `stepTimer`: add `count(name, n)` storing into a separate `counts` map; `finish` writes `name;desc="n"` entries for counts and logs `{ event, status, steps, counts }`. Add `fail(error)` that logs `{ event, status: "thrown", steps, error: message }`.
- Wrap the search block: `try { return timer.finish(await (...)()); } catch (e) { timer.fail(e); throw e; }`.
- Time retries: `timer.time("anchor_rpc_retry", anchorCall)` and `timer.time("search_rpc_retry", invoke)`.
- `http.ts:22`: `CORS_EXPOSE_HEADERS = "X-Row-Count, Content-Disposition, Server-Timing"`.
- Check `scripts/search-eval/step-timing.mjs` still parses the header (its parser at `step-timing.mjs:45` matches only `name;dur=` entries, so `desc` entries are skipped) and add a case to `step-timing.test.mjs` proving a `variants;desc="3"` entry is ignored.
- You'll know it worked when: tests "Server-Timing carries only durations and reports the variant count separately" and "a thrown search still logs its timing" pass.

**Step 8 — Tests.** `helper-ok` for writing the cases named in §10 — stop-and-ask if a mock cannot express a case.

**Step 9 — Land and prove.** `lead-only`.
- Rebase on `main` (other search plans land in parallel), PR, required checks green, merge (AI merges; reviews advisory). Confirm `deploy-supabase.yml` succeeded for the merge SHA.
- Run the "Search test set" workflow (`.github/workflows/search-eval.yml`, manual) and compare with the last AFTER score in `docs/plans/issue-1037-typed-search-meaning-matching.md` (137/137): no case may regress.
- Live (viewer at https://dam.designflow.app): a picture-word search naming a licensor found in Step 1(c) returns results, not "Search unavailable"; a search with a licensor picked in the sidebar returns its picture matches; DevTools Network shows a `Server-Timing` header with no `variants;dur`.
- Comment on each of #935, #930, #1127, #1052 with the merge SHA, deploy run, scorecard run and the live check that covers it; close all four.

## 10. Tests required

`supabase/functions/dam-search-ai/index.test.ts`:
- "a scoped anchor with no score keeps the admin floor and returns results" — scoped anchor mock returns `{data:null}`; response 200; `search_dam_documents` called with `p_min_semantic_score` = admin floor.
- "a named anchor with no score keeps the admin floor".
- "an anchor error after its retry still fails the search" — 503.
- "an explicit licensor filter anchors on that licensor" — asserts `dam_search_semantic_anchor_scoped` with `p_licensor_ids: [id]`.
- "an explicit character filter anchors inside it"; "an explicit property filter anchors inside it" — assert `dam_search_semantic_anchor_named` args.
- "the name lookup retries once and then searches"; update "returns Retry when the name lookup reaches its deadline" for two attempts.
- "Server-Timing carries only durations and reports the variant count separately" — every entry with `dur` parses as a number and no `variants;dur` exists.
- "a thrown search still logs its timing" — spy on `console.log`/`console.error` for `dam_search_timing` with `status: "thrown"`.
`supabase/functions/_shared/query-embed-batch.test.ts`: "a cached text vector from another model is re-embedded".
`supabase/functions/_shared/named-characters.test.ts`: "a property with many characters is sent whole and logged" (≤ 2,000 branch only).
New `supabase/functions/_shared/http.test.ts` (none exists today): "browsers may read Server-Timing".
Must stay green: `npm run test`; CI `node --test` step; `scripts/search-eval/step-timing.test.mjs`.

## 11. Constraints and gotchas

- Feature branch + PR; never push to protected `main`; the AI merges once required checks pass.
- No DDL, no migrations here, no Dashboard SQL; read-only SQL only for measurement.
- Every merge redeploys **all** edge functions; a broken `search` action is a site-wide outage — run the full suite and the scorecard.
- Owner rule: a required failure answers "Search unavailable" with Retry, never silently fewer results (D4). Do not convert errors into empty results.
- No waits longer than 30 minutes anywhere; the retry has no delay.
- Parallel work: the [issue-795 plan](issue-795-spelling-vocabulary-retired-names.md) edits the same file's top half; rebase and re-test before merging.

## 12. Access and environment

- `gh` as `u2giants`. Supabase MCP or read-only database connection: 1Password vault `vibe_coding`, shared Supabase project item (search "qsllyeztdwjgirsysgai"). Viewer login: `vibe_coding`, PopDAM test viewer item. Never paste values.
- Search scorecard: `.github/workflows/search-eval.yml` (manual `workflow_dispatch`, report-only); `docs/SEARCH_EVAL.md` explains it.
- Local: `npm ci`, `npm run test`.

# Part 4 — Landing it

## 13. Definition of done, risks, open questions

Done when: Steps 1–9 ✅ with artifacts; PR merged with checks green; deploy run succeeded for the merge SHA; scorecard shows no regression; live checks recorded; #935, #930, #1127, #1052 closed; plan `status: done`.

Risks: (1) treating null as "no floor" could let weak picture matches through if an anchor function wrongly returns null for a populated scope — the admin floor still applies and the scorecard catches floods; rollback is reverting the PR. (2) A second name-lookup attempt adds up to 4 s on a failing database — acceptable within the 30 s budget and better than a 503. (3) Exposing `Server-Timing` reveals step durations to signed-in users — no data, low risk.

Open: §8 scope-list cap, decided by Step 1.

## Self-audit (Mode A gate)

1. *New session could execute without asking?* Yes — §2 defines anchor, scope, legs; §5 gives every line; §8 locks each behaviour; §9 names edits and gates; §12 access by location.
2. *All background, including ruled-out paths?* Yes — §6 records which findings are moot and why, including #1052's lost text and how it was re-derived; §7 rejected options.
3. *Goal clear enough to steer?* Yes — §1: right products, honest failures only, trustworthy timing; goal wins over steps.

## Lead launch prompt

```
Read docs/plans/issue-935-dam-search-anchor-timing-lookup-hardening.md in u2giants/popdam3 (STATUS first), then AGENTS.md.
You are the lead. Do Steps 1, 2, 3, 6 and 9 yourself. Hand Steps 4, 5, 7 and 8 to your helper, one at a time, after Step 3 is done, and verify each gate yourself.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges, pushes or GitHub posts; bring back any stop-and-ask trigger; if stuck 30 minutes, the lead takes the step back.
Lead checks: npm run test green with every §10 test present; CI green; deploy run for the merge SHA; search scorecard with no regression; live checks on dam.designflow.app; close #935, #930, #1127, #1052 with evidence.
Delegation sheet: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
```
