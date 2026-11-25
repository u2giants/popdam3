---
summary: Issue #815 plan: check DAM access before search's privileged catalog reads; fix the hint's tests. Read its STATUS first.
kind: plan
status: open
read-when: implementing #815, or changing authorization order, the catalog code-format hint, or the request budget in supabase/functions/dam-search-ai
---

# Plan: Check DAM access before search's privileged catalog reads (u2giants/popdam3#815)

Issue: https://github.com/u2giants/popdam3/issues/815 (review finding on merged PR #814, reviewer deepseek)
Handoff: [HANDOFF.d/2026-11-25T2101Z-al8960ofc-claude-thumbnail-render-plans.md](../../HANDOFF.d/2026-11-25T2101Z-al8960ofc-claude-thumbnail-render-plans.md)
Written 2026-11-25 (about 4:00 PM EST) by Claude. Plan only. Code references are to `origin/main` at `787c20b8`.

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 1 | Early `require_dam_access` for user callers on `action === "search"` | ⬜ open | no access call on the search path: `supabase/functions/dam-search-ai/index.ts:580-625`; first service reads at `:605-619` |
| 2 | Test: denied caller → 403 and no service-role read | ⬜ open | `index.test.ts` only checks the final status |
| 3 | Transport test proves request-signal cancellation, not the 1 s deadline | ⬜ open | `supabase/functions/_shared/catalog-code-format.transport.test.ts:27-72` has no elapsed-time assertion |
| 4 | Remote-URL mock (finding 3) | ⬜ verify only | test has run green in CI on every `main` push since 2026-11-05 (e.g. CI for `787c20b8`); record and close the point |
| 5 | Test `err` mock matches the real wire shape `{ ok:false, error }` | ⬜ open | `dam-search-ai/index.test.ts:51` mocks `{ error }`; real `supabase/functions/_shared/http.ts:71-73` |
| 6 | Request-budget comment says what it bounds | ⬜ open | `supabase/functions/_shared/search-request-budget.ts:1-2`; signal now reaches the hint and named-scope lookup only |
| 7 | PR, CI, merge, edge deploy, live proof, close | ⬜ open | `- [ ] live proof` stays on #815 |

**Where a fresh session starts:** Step 1.

---

## 1. The ultimate goal

Only people allowed into PopDAM may cause PopDAM's search to read the private item catalog on their behalf. Today a signed-in user **without** DAM access (for example a PopSG-only licensor user) can make the search function run privileged catalog checks before it finds out they are not allowed; the answer they get is "forbidden" in the end, but the timing/status difference leaks a little about catalog code formats, and it breaks the documented rule for this reader. Done means: access is checked first, denied callers trigger no privileged read, and the tests around the code-format check actually prove what they say. Search results and speed for allowed users stay the same.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`https://dam.designflow.app`) is POP Creations' internal Digital Asset Manager; PopSG (`https://sg.designflow.app`) is a style-guide library served by the same code. Typed search goes to the Supabase edge function `supabase/functions/dam-search-ai/index.ts` (Deno). It authenticates the caller (`authenticateCaller`, `:272-291`): service-role callers (the Railway worker, scripts) get a service client; signed-in users get a client carrying their own token. User searches finally run `search_dam_documents` with the caller's client, which enforces DAM access in the database. Before that, the function does service-role reads: `isProductCodeSearch` (style_groups SKU lookup, `:605-609`), `hasCatalogCodeFormat` (RPC `dam_catalog_code_format_exists`, `:612-619`), spelling and named-scope lookups. `require_dam_access` is an RPC that returns `true` for users with DAM access (used by `loadDamSearchMode`, `supabase/functions/_shared/search-access.ts:14-27`). Repo `u2giants/popdam3`; edge functions deploy by `deploy-supabase.yml` on merge to `main`.

## 3. What triggered this work

Advisory review of PR #814 ("Keep picture guesses for supported unknown complete product codes", merged 2026-11-05; ai-review run 42083836391; fixer run 42085106133 confirmed 1, 2, 4, 5 and called 3 uncertain):
1. Service-role format probe before DAM authorization; the canonical note `shared-db/docs/app-migration-notes/popdam-code-format-existence.md:11-12` says caller authentication **and authorization** must happen before the service read. The reviewer also noted `isProductCodeSearch` and spelling already do service-role work first.
2. Transport test passes even if the request-signal listener (`catalog-code-format.ts:25-26`) were removed, because the 1000 ms internal deadline also aborts.
3. Mocking a remote `https://deno.land/...` specifier might not apply under Vitest.
4. Test `err` mock omits `ok:false`.
5. "30 s request budget" name is broader than its use.

## 4. Scope

In: findings 1–5 for `dam-search-ai` and its `_shared` helpers/tests.
NOT in this plan: search ranking, embeddings, or result changes (other plan sessions own ranking — `docs/plans/issue-1037-*` and the 2026-11-25 search-ranking/indexing plans); the `search-modes`, `popsg-query-embedding`, admin actions (they already check access or admin); changing `search_dam_documents`; the per-isolate spelling-vocabulary warm-up (see §8).

## 5. Current state

- `index.ts:482-491` auth, body parse. `:580-596` `action === "search"` begins; `:589` warms the spelling vocabulary (`void spellingLookup.vocabulary()`), a per-isolate cache of public vocabulary that returns nothing to the caller. `:605-609` product-code service read. `:610-624` format hint (service RPC, `requestSignal`). `:638` spelling. `:668` named scope (`requestSignal`). `:775` `search_dam_documents` with `auth.client` — the only access enforcement for users.
- `catalog-code-format.ts:19-44` `hasCatalogCodeFormat` with request-signal forwarding and `CATALOG_CODE_FORMAT_TIMEOUT_MS = 1000`.
- `catalog-code-format.transport.test.ts` builds a real local HTTP server, aborts the request, asserts 503 and that the read signal aborted, bounded by a 2 s witness.
- `search-request-budget.ts:1-27` 30 s budget; `withSearchRequestBudget` wraps the handler; signal reaches the hint and `loadNamedScope` (`:180-217`).

## 6. Key findings

- The 403 today comes from `search_dam_documents` raising for a user without access; the privileged reads happen first. Moving one `auth.client.rpc("require_dam_access")` before `:605` closes it; cost is one small RPC (tens of ms) per user search. Search speed target from #1196 is "first typed searches under 3 s"; measure in live proof.
- Service-role callers must skip this check: their `client` is the service client, which has no user; `require_dam_access` would deny them and break the worker and scripts (`scripts/search-eval/run.mjs`, `scripts/production-canary.mjs`).
- Finding 3 is answered by evidence: the file is in the `edge-functions` Vitest project (`vitest.config.ts:27-29`) and CI has been green on `main` since it merged, so the mock applies.

## 7. Approaches rejected

- Relying on `search_dam_documents` alone (status quo): violates the documented contract.
- Making the format RPC caller-scoped instead of service-role: needs a shared-db grant change and still leaves `isProductCodeSearch` ahead of authorization.
- Running the access check in parallel with the catalog reads: reads would still start before authorization.

## 8. Design decisions

Locked (2026-11-25):
- User callers: `require_dam_access` first; `error` → `searchAccessStatus(error) ?? 503`; `data !== true` → `403 "DAM access required"`. Service-role callers skip it.
- All caller-specific service reads on the search path (product code, format hint, spelling correction, named scope, embeddings) come after the check.
- The vocabulary warm-up at `:589` stays before the check: it is a shared cache, not a caller-specific read, and moving it costs first-search latency (#1196). Document this in a comment.
- Reuse the access-check helper: extract `requireDamAccess(caller)` from `loadDamSearchMode` in `search-access.ts` and use it in both places.
Open: none.

## 9. The plan

**Step 1 — Access first (lead-only: authorization order on a production endpoint).**
In `supabase/functions/_shared/search-access.ts` export `async function requireDamAccess(caller)` (the first three lines of `loadDamSearchMode`) and have `loadDamSearchMode` call it. In `index.ts` inside the `action === "search"` block, right after the `query` / `limit` validation and before `isProductCodeSearch` (~`:604`):
```ts
if (!auth.serviceRole) {
  try { await timer.time("access", () => requireDamAccess(auth.client)); }
  catch (error) { return err("DAM access required", searchAccessStatus(error) ?? 503); }
}
```
(Keep the 403 message consistent with what the UI shows today for denied users; check `src/` for how a 403 from this function is displayed.)
Gate: step 2 tests; `deno check supabase/functions/dam-search-ai/index.ts`.

**Step 2 — Denied-caller test (helper-ok).**
In `supabase/functions/dam-search-ai/index.test.ts` add "a signed-in user without DAM access gets 403 before any catalog read": mock `require_dam_access` → `{ data: false, error: null }`; search `"ZZZ83MVSP99"`; expect 403, `state.formatRpc` not called, the style_groups SKU read not called, `search_dam_documents` not called. Add "service-role search skips the access RPC" (expect no `require_dam_access` call and normal 200). Update existing search tests so the mock returns `true` for the access RPC.
Stop-and-ask: if the test harness cannot tell user from service-role callers, bring it back.

**Step 3 — Transport test proves the signal path (helper-ok).**
In `catalog-code-format.transport.test.ts`, record `const t0 = performance.now()` at abort time and assert the 503 arrives with `performance.now() - t0 < 500` (well under the 1000 ms deadline). Gate: test passes; temporarily delete the `requestSignal.addEventListener` line in `catalog-code-format.ts`, confirm the test fails, restore.
Stop-and-ask: if timing is flaky in CI (>1 failure in 5 local runs), bring it back — alternative is exporting an injectable deadline for tests.

**Step 4 — Record finding 3 (helper-ok: comment only).** Post on #815 that the remote-specifier mock runs in CI (link a green CI run on `main` that includes the `edge-functions` project). No code change.

**Step 5 — Wire-shape mock (helper-ok).** In `index.test.ts:51` make the `err` mock return `Response.json({ ok: false, error }, { status })`, or import the real `err`/`json` from `../_shared/http` if the mock exists only to avoid the `serve` import (mock only `serve`). Assert one 503 body equals `{ ok: false, error: "Search unavailable" }`.

**Step 6 — Budget comment (helper-ok).** `search-request-budget.ts:1`: "30 s budget for one search request (same as the browser's deadline). It bounds the catalog code-format hint and the named-scope lookup; other steps have their own timeouts." No rename (callers and docs use the name; `docs/SEARCH_EVAL.md:67-68` already describes it accurately).

**Step 7 — Land and prove (lead-only).** PR, CI green, merge, confirm `deploy-supabase.yml` deployed `dam-search-ai` for the merge SHA. Live proof: (a) as a normal DAM user, search `SQX26DYMM02` and a word query in the web UI — results unchanged, response time within the #1196 target (browser network panel); (b) with a test user lacking DAM access (or the edge function logs for a PopSG-only user), the search returns 403 and the logs show no `catalog_format` timer step. Post on #815, close.

## 10. Tests required

New: "a signed-in user without DAM access gets 403 before any catalog read"; "service-role search skips the access RPC"; transport elapsed-time assertion; wire-shape 503 body assertion. Must stay green: root `npm test` (all Vitest projects), `npm run typecheck`, `npm run lint`, `edge-functions-format.yml`, and the search eval workflow if it runs on the PR (`search-eval.yml`).

## 11. Constraints and gotchas

Other sessions are writing search plans in parallel; before editing `dam-search-ai/index.ts`, rebase and read `git log origin/main -- supabase/functions/dam-search-ai` for overlapping changes. Never return the format boolean to callers. Edge functions: `deno fmt` style enforced by `edge-functions-format.yml`. Do not change shared-db grants here (structure goes through `popcre/shared-db`). Quote times in EST.

## 12. Access and environment

`gh` as `u2giants`. Supabase logs via the Supabase MCP or dashboard with the access token in 1Password vault `vibe_coding` (search "Supabase access token"). Web UI: your own PopDAM login. Local: `npm ci`, `npx vitest run --project edge-functions`.

## 13. Definition of done, risks, open questions

Done: steps 1–6 merged, CI green, edge function deployed at the merge SHA, live proof posted, #815 closed.
Risks: an extra RPC adds latency to every user search (measure; if it pushes first searches past 3 s, cache a positive access result per user per isolate for ≤5 minutes — judgment call for the lead, criteria: measured p50 increase > 100 ms). Wrong service-role handling would break the worker/canary — covered by the step-2 test and the production canary run after deploy. Rollback: revert the PR.
Open: none for the owner.

## Self-audit (2026-11-25)

1. Executable without asking? Yes — §2 explains callers and the access RPC; §5/§9 give lines and code.
2. Background incl. rejected options? Yes — §3 all five findings with fixer verdicts, §6, §7.
3. Goal clear for judgment? Yes — §1 (no privileged read before authorization, same results and speed), plus the latency criterion in §13.
Checklist passes: trust boundary here is the caller identity; adversarial cases are covered by named tests (denied user, service role, aborted request, unavailable catalog → 503). Lead/helper marks with triggers, locked decisions, out-of-scope, secrets by location, handoff linked both ways.

## Lead launch prompt

```text
You are the lead implementing u2giants/popdam3#815. Read AGENTS.md, then docs/plans/issue-815-search-access-before-catalog-reads.md (STATUS first). Fresh worktree, feature branch from origin/main; check recent commits to supabase/functions/dam-search-ai first.
You do steps 1 and 7. Hand steps 2, 3, 5, 6 (and the step-4 comment draft) to your helper after step 1. Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker; no design decisions; no merges or posts; bring stop-and-ask triggers to you; taken back after 30 minutes stuck.
Run every gate yourself (including the negative check in step 3), CI, deploy confirmation and live proof. Update STATUS; sign GitHub posts.
```
