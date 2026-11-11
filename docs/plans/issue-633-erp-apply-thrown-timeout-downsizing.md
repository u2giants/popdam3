---
summary: Issue #633 plan: Classify lock timeouts as transient statement-cap failures (#630). Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-633
---

# Plan: Review finding: u2giants/popdam3#632 Classify lock timeouts as transient statement-cap failures (#630) (u2giants/popdam3#633)
Issue: https://github.com/u2giants/popdam3/issues/633
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Re-confirm the three findings on `main` | ⬜ open | — |
| 2 | Treat a *thrown* transient timeout as a downsizable page failure | ⬜ open | — |
| 3 | Persist the floor page size when the op parks after the last halving | ⬜ open | — |
| 4 | Tests: RPC-error downsizing, thrown-error downsizing, floor persisted on park | ⬜ open | — |
| 5 | Loop-level test: parked failure state carries `retry_page_size` = floor | ⬜ open | — |
| 6 | Docs (`docs/BULK_JOBS.md`), PR, CI, merge, Railway deploy | ⬜ open | — |
| 7 | Live proof on the production `erp-enrichment` operation; close #633 | ⬜ open | — |

**Where a fresh session starts:** step 1 (quick grep), then step 2. All three findings are confirmed still present on `main` as of 2026-11-04 (section 5).

---

## 1. The ultimate goal

The nightly **ERP enrichment** job copies ColdLion item data (category codes, descriptions, licensor/property/division) onto PopDAM assets and style groups so the library shows the right product facts. The job must **finish on its own** even when the database is busy: when a page of work is cancelled by a timeout, the worker must retry that same page in smaller pieces, remember the size that worked, and never go back to re-burning four timeouts at the full size on every retry. Today two gaps mean certain timeouts bypass the shrinking logic entirely, and once the job parks it forgets the small size and restarts at 100 items every time — so under load it can loop for hours, costing database time and finishing nothing.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Do not "fix" this by widening the database statement timeout, changing the shared RPC, or disabling the DAM-search refresh triggers; those are shared-database decisions outside this repo.

## 2. What this application is

PopDAM — internal digital asset manager for licensed product art; read `AGENTS.md`. This plan is about the **Railway cloud worker** in `apps/worker/` (Node.js/TypeScript) that runs long bulk operations one "tick" at a time against the shared Supabase backend (`qsllyeztdwjgirsysgai`, Virginia). The `erp-enrichment` operation lives in `apps/worker/src/handlers/erp.ts`; the generic tick loop, cursor checkpointing, auto-resume and failure persistence live in `apps/worker/src/operation-loop.ts` and `apps/worker/src/operation-retry.ts`. Docs: `docs/BULK_JOBS.md` (operation catalogue and the #630 paragraph at lines ~136-146), `docs/WORKER_LOGIC.md`, `docs/ERP_ENRICHMENT_PLAN.md`. The worker auto-deploys from `main` to Railway on merge. Repo `u2giants/popdam3`.

## 3. What triggered this work

Issue #630 (2026-11-01) reported that `erp-enrichment` could never auto-resume (its UUID cursor was not on the allow-list) and that the 100-item apply page runs at the statement cap once the per-row DAM-search refresh triggers fire, so under concurrent load it cancels with `canceling statement due to statement timeout` / `lock timeout`. PR #631 (`752382fb`) added the cursor allow-list entry and the page-downsizing loop; PR #632 (merged 2026-11-01 as `1a0f6094`) classified lock timeouts as the same transient class. The advisory review of #632 (reviewer: muse, run 41354026579) found three gaps, recorded as #633 (`review-finding`, `fixer-deferred` because the source PR was closed):

1. The downsizing loop only handles `runErpApplyPage` **returning** `{ok:false}`; `canonicalItemIdMap` **throws** on a DB error, so a transient timeout on the `api.pim_item_picker` lookup (same 100-id `IN` page) escapes the loop with no downsizing and no `retry_page_size`.
2. After exhausting `ERP_APPLY_MAX_DOWNSIZE_STEPS` the handler returns the bare failed result with **no `retry_page_size`**, so the persisted state keeps the old size (100) and the next tick re-burns four timeouts.
3. Tests only exercise the initial `plm_item_list` fetch error path; neither the `apply_erp_item_updates` RPC error nor the thrown-error path is covered.

Observed environment: production worker (Railway), op key `erp-enrichment`, 2026-11-01 — three spaced resumes advanced 2,202 → 4,427 rows, then the same page cancelled twice on a quiet DB (from #630).

## 4. Scope

**In:**
- `apps/worker/src/handlers/erp.ts` — `handleApplyErpEnrichment` loop (lines ~300-322) and, if needed, a small wrapper around the page attempt.
- `apps/worker/src/handlers/erp.test.ts` — new tests.
- `apps/worker/src/operation-loop.test.ts` — one persistence test (if the loop already has an erp fixture, extend it; it currently has none for `erp-enrichment`).
- `docs/BULK_JOBS.md` — the #630 paragraph.

**NOT in this plan:**
- Changing `apply_erp_item_updates`, DAM-search triggers, statement timeouts, or any other database object (all `popcre/shared-db`).
- Per-item batching inside the RPC (the "operability note" in #630) — a separate shared-db discussion.
- Changing `classifyError` (`operation-loop.ts:746-762`) — lock timeouts are already classified as `statement_timeout` (that was #632 and is landed).
- The classify path (`handleClassifyErpItems`, `erp.ts:~500-660`) which also calls `canonicalItemIdMap` at `erp.ts:515` — different op, different page semantics; leave it.
- The `isValidAutoResumeCursor` allow-list (landed in #631, `operation-retry.ts:30`).

## 5. Current state of the code (worktree at `01fcfc34`, contains `origin/main`)

All three findings are **still present**:

- `apps/worker/src/handlers/erp.ts:300-322` — `handleApplyErpEnrichment`: computes the starting `pageSize` from `opState.progress.retry_page_size` (clamped to `[ERP_APPLY_MIN_PAGE_SIZE=10, ERP_APPLY_PAGE_SIZE=100]`, lines 304-309) then `for (;;) { const result = await runErpApplyPage(...); if (result.ok) return {...result, retry_page_size: pageSize}; if (!isErpTransientDbTimeout(result.error) || pageSize <= MIN || downsizeSteps >= MAX) return result; pageSize = nextErpApplyPageSize(pageSize); downsizeSteps += 1; }`. **No `try/catch`** around `runErpApplyPage`; the park branch (`return result`, line 317) carries **no `retry_page_size`**.
- `apps/worker/src/canonical-erp-items.ts:23-37` — `canonicalItemIdMap` does `if (error) throw new Error(\`Failed to resolve canonical item IDs: ${error.message}\`)` (line 30). Called from `runErpApplyPage` at `erp.ts:346` with the whole page's `source_id`s (`.in("item_number", sourceIds)`).
- `apps/worker/src/handlers/erp.ts:292-295` — `isErpTransientDbTimeout(message)` matches `/statement timeout|lock timeout|57014/i`.
- `apps/worker/src/operation-loop.ts:613-621` — `mergeProgress` for `erp-enrichment` keeps `retry_page_size: batch.retry_page_size ?? prev.retry_page_size`.
- `apps/worker/src/operation-loop.ts:1653-1686` — failed-batch persistence: `retry_page_size: result.retry_page_size ?? currentState.retry_page_size`, status `interrupted` when `isTransientInterruption(reason)`; the tick-level `catch` for a thrown handler error is elsewhere in `runTick` (search `catch` near line 1700+) and goes through the same `classifyError` path, so a thrown timeout becomes `interrupted` + auto-resume — but with the stale page size.
- `apps/worker/src/operation-loop.ts:1733,1755,1797` — `retry_page_size: undefined` on fresh start / completion / reset (correct; untouched).
- `apps/worker/src/handlers/erp.test.ts:82-165` — `TimeoutThenEmptyClient` fakes only `schema().from()` chains that resolve via `then`; `rpc` is not implemented; the four #630 tests cover: halving then success, non-transient returns immediately, bounded halving parks, persisted size is tried first. No RPC-error test, no thrown-error test, no assertion on `retry_page_size` in the park test (line 150-156 only checks `ok:false` and the message).
- `apps/worker/src/operation-loop.test.ts` — no `erp-enrichment` cases (grep returns nothing).
- `docs/BULK_JOBS.md:136-146` describes the downsizing behaviour and `retry_page_size` persistence.

Nothing on a branch; no PR open for #633.

## 6. Key findings and root cause

- **Finding 1 mechanism:** `runErpApplyPage` has two failure styles — most reads `return {ok:false, error}` (lines 338, 361, 384-385, 395-399, 420-422), but `canonicalItemIdMap` throws. The loop at line 312 only inspects returned results. A throw propagates to the tick loop, which persists `interrupted` with `currentState.retry_page_size` (unchanged) and schedules auto-resume; the resume re-runs at the same size. Any thrown network/transport error (e.g. a fetch rejection from supabase-js) has the same bypass.
- **Finding 2 mechanism:** on the fifth transient failure (sizes 100,50,25,12,10) the loop returns the bare result. `mergeProgress` and the failure persist both fall back to the previous value (section 5). The op therefore remembers 100 (or whatever it started with), and each auto-resume replays the whole ladder — 5 timeouts per tick, 5 auto-resume attempts (`AUTO_RESUME_DELAYS_MS`, `operation-retry.ts:5`) → up to 25 wasted timeouts before it finally stays `interrupted`.
- **Why "persist the floor" is right:** the floor (10) is the smallest page the handler will ever run; starting the next attempt there gives the best chance of progress and costs nothing if the DB has recovered (the handler never grows the page back up — see section 8, OPEN item).
- **Memory `project_prod_cold_warm_statement_ceiling`:** on this database the first (cold) call of a heavy statement regularly hits SQLSTATE 57014 while warm repeats pass. The ladder exists precisely for that; a cold first call on a resumed op is the normal case, not an edge case.
- `isErpTransientDbTimeout` operates on the **message string**; a thrown `Error` from `canonicalItemIdMap` carries `Failed to resolve canonical item IDs: canceling statement due to statement timeout`, which already matches the regex — so the classification function needs no change, only the loop's catch.

## 7. Approaches considered and rejected

| Approach | Why rejected |
|---|---|
| Change `canonicalItemIdMap` to return `{error}` instead of throwing | It is shared with the classify handler (`erp.ts:515`) and `canonical-erp-items.test.ts`; changing its contract touches two ops. A `try/catch` in the apply loop handles throws from *any* source (transport errors too), which the reviewer explicitly asked for. |
| Catch inside `runErpApplyPage` only around `canonicalItemIdMap` | Misses thrown transport errors from other awaited calls; the reviewer's point was "any thrown exception has the same bypass". Catch at the loop. |
| Reset `retry_page_size` to the default (100) on park so the next tick "tries fresh" | That is the current (broken) behaviour; it guarantees four more timeouts under the same load. |
| Grow the page back up after N successful pages | Nice-to-have, not in the finding; adds state. Listed as OPEN in section 8 for a later issue, not this one. |
| Make the loop retry at the floor more than once before parking | Changes the bounded contract (`ERP_APPLY_MAX_DOWNSIZE_STEPS`); the tick-level auto-resume already provides spaced retries. |
| Convert `erp.test.ts` to a full fake Supabase client | Over-engineering; extend `TimeoutThenEmptyClient` with an `rpc()` and a `throwOn` option. |

## 8. Design decisions

- **LOCKED (2026-11-04):** the page attempt is wrapped in `try/catch` inside the `for(;;)`; a thrown error whose message passes `isErpTransientDbTimeout` is treated exactly like a returned transient `{ok:false}` (downsize and retry); a thrown non-transient error is **re-thrown** unchanged (the tick loop already classifies and logs thrown errors; swallowing them into a result would change the logged `stage`/stack).
- **LOCKED:** when the loop parks after the last allowed halving, it returns `{...result, retry_page_size: ERP_APPLY_MIN_PAGE_SIZE}` — the size that will be tried first on resume. When it parks because the error is non-transient, it returns the result unchanged (no `retry_page_size`), preserving existing behaviour and the existing test "non-transient page errors return immediately without downsizing".
- **LOCKED:** `isErpTransientDbTimeout`, `nextErpApplyPageSize`, the constants, `classifyError`, and `mergeProgress` are unchanged.
- **OPEN (implementer):** whether to also return `retry_page_size: pageSize` on a thrown-transient park (it equals the floor by construction, so both expressions are equivalent — pick the clearer one).
- **OPEN (future, not this plan):** page re-growth after sustained success.

## 9. The plan

### Step 1 — Re-confirm on the implementation branch
- Fresh worktree, branch e.g. `fix/633-erp-apply-thrown-timeouts`.
- `sed -n 300,322p apps/worker/src/handlers/erp.ts` shows the loop without `try`; `sed -n 150,156p apps/worker/src/handlers/erp.test.ts` shows the park test without a `retry_page_size` assertion.
- **Gate:** both confirmed (or, if already fixed, cite the commit and jump to step 4 to add any missing test).

### Step 2 — Catch thrown transient timeouts in the loop
- `apps/worker/src/handlers/erp.ts` `handleApplyErpEnrichment`: replace the body of the `for(;;)` with:
  ```ts
  let result: BatchResult;
  try {
    result = await runErpApplyPage(mode, afterId, opState, client, pageSize);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isErpTransientDbTimeout(message)) throw error;
    result = { ok: false, done: false, error: message };
  }
  if (result.ok) return { ...result, retry_page_size: pageSize };
  if (!isErpTransientDbTimeout(result.error)) return result;
  if (pageSize <= ERP_APPLY_MIN_PAGE_SIZE || downsizeSteps >= ERP_APPLY_MAX_DOWNSIZE_STEPS) {
    return { ...result, retry_page_size: ERP_APPLY_MIN_PAGE_SIZE };   // step 3
  }
  pageSize = nextErpApplyPageSize(pageSize);
  downsizeSteps += 1;
  ```
- Update the doc comment above the constants (lines 276-285) with one sentence: "A thrown transient timeout (for example from the canonical-id lookup) is downsized the same way; after the last halving the floor is persisted so a resume starts there."
- Intended behaviour: a timeout from `pim_item_picker`, the RPC, or any read in the page shrinks the page; a schema/contract error still fails the op immediately and loudly.
- **Gate:** `npm run build --prefix apps/worker` compiles; step 4 tests pass.

### Step 3 — Persist the floor on park
- Included in the code above (`retry_page_size: ERP_APPLY_MIN_PAGE_SIZE` on the transient-exhausted branch).
- Confirm the persisted value flows: `mergeProgress` (`operation-loop.ts:620`) and the failure persist (`:1682`) both take `result.retry_page_size` first — no loop change needed.
- Intended behaviour: after a park, `operations.progress.retry_page_size` and `operations.retry_page_size` (whichever the loop persists — both are written, see `:1664,1682`) read `10`; the next auto-resume tries 10 first (existing test "a persisted working page size is the first size tried" proves the read side).
- **Gate:** new test in step 4 asserts `result.retry_page_size === 10` on park.

### Step 4 — Handler tests (`apps/worker/src/handlers/erp.test.ts`)
Extend `TimeoutThenEmptyClient`:
- Add `rpc(name, args)` that records `name` and, when a `rpcFailures` counter is > 0, resolves `{ data: null, error: { message: "canceling statement due to statement timeout" } }`, else `{ data: [], error: null }`. To reach the RPC the fake must return a non-empty `plm_item_list` page and a `pim_item_picker` answer: give the builder a `rows` option so `then` resolves `{ data: rows.slice(0, lastLimit) }` for the first `from()` and `[]` for later tables (track the table name passed to `from(name)`; `canonicalItemIdMap` reads `pim_item_picker` via `schema("api").from(...)`, `product_category_predictions`/`assets`/`style_groups` via `client.from(...)`). Keep it minimal: with `mode: "dry-run"` the RPC is skipped, so use `mode: "apply"` and give `assets`/`style_groups` reads empty data.
- Add `throwOn: { table: "pim_item_picker", message, times }` so the `then` for that table **rejects** (`reject(new Error(message))`) `times` times — this is the thrown path (`canonicalItemIdMap` itself throws after seeing `error`; rejecting the query promise models the transport-throw case, and setting `error` on the resolved value models the DB-error-throw case — cover both).

Tests (names are the behaviour):
1. **"a transient RPC failure on apply_erp_item_updates retries the same cursor at a halved size"** — `rpcFailures = 1`, expect `pageSizes` `[100, 50]`, `ok: true`, `retry_page_size: 50`, and the RPC called twice.
2. **"a thrown transient timeout from the canonical-id lookup is downsized, not escaped"** — `pim_item_picker` resolves with `error.message = "canceling statement due to lock timeout"` once; expect `pageSizes` `[100, 50]` and `ok: true`.
3. **"a rejected query promise with a transient message is downsized too"** — same as 2 but the promise rejects; same expectations.
4. **"a thrown non-transient error still escapes the loop unchanged"** — `pim_item_picker` rejects with `new Error("relation does not exist")`; `await assert.rejects(handleApplyErpEnrichment(...), /relation does not exist/)`; `pageSizes` `[100]`.
5. **"parking after the last halving persists the floor page size"** — reuse `TimeoutThenEmptyClient(99)`; assert `result.retry_page_size === ERP_APPLY_MIN_PAGE_SIZE` in addition to the existing checks (extend the existing test at line 150 rather than duplicating).
6. **"a non-transient park carries no retry_page_size"** — extend the test at line 142: `assert.equal(result.retry_page_size, undefined)`.
- **Gate:** `npm run test --prefix apps/worker` green; tests 1-3 and 5 fail if step 2/3 code is reverted (verify once by stashing nothing — simply comment out the `try/catch` locally and run).

### Step 5 — Loop-level persistence test (`apps/worker/src/operation-loop.test.ts`)
- Look at how existing tests drive `runTick`/`persistOpState` with a fake handler and fake state store (there are many; pick the closest pattern, e.g. a test that asserts `status: "interrupted"` after a transient failure).
- Add **"an erp-enrichment page that parks at the floor persists retry_page_size 10 and schedules auto-resume"**: register a fake handler for `erp-enrichment` returning `{ ok: false, done: false, error: "apply_erp_item_updates failed: canceling statement due to statement timeout", retry_page_size: 10 }` with prior state `progress.retry_page_size: 100`; assert the persisted state has `status: "interrupted"`, `interruption_reason_code: "statement_timeout"`, `retry_page_size: 10`, `progress.retry_page_size: 10`, and `next_auto_resume_at` set.
- If wiring a handler into the loop's registry is awkward in tests, the minimum acceptable is a direct `mergeProgress("erp-enrichment", { retry_page_size: 100 }, { ok:false, retry_page_size: 10 })` assertion → `retry_page_size: 10` (the function is exported at `operation-loop.ts:511`).
- **Gate:** test passes; `npm run test --prefix apps/worker` green.

### Step 6 — Docs, PR, CI, merge, deploy
- `docs/BULK_JOBS.md` #630 paragraph (lines ~136-146): add "A thrown transient timeout (for example in the canonical-id lookup) is downsized the same way. When the ladder is exhausted the floor size (10) is persisted, so the auto-resume starts there instead of replaying the ladder."
- Commit as Albert's verified identity; push; PR to `main`: `fix(worker): downsize thrown ERP timeouts and persist the floor on park (#633)`, body `Closes #633` + attribution lines. Sign posts with `$AI_GH_SIGNATURE`.
- `bin/ai-pr-wait <pr>` in background; CI includes `npm run build --prefix apps/worker && npm run test --prefix apps/worker`.
- Merge; Railway auto-deploys `apps/worker` from `main`. Confirm the Railway deployment shows the merge SHA (worker logs print the build on start; `docs/deployment.md` → worker).
- **Gate:** merged, CI green, Railway running the merge SHA.

### Step 7 — Live proof and close
- Read the production `operations` row for `erp-enrichment` (read-only SQL via the Supabase MCP or `supabase` CLI runbook in `/worksp/shared-db/AGENTS.md`): note `status`, `retry_page_size`, `progress.retry_page_size`, `cursor`.
- Start (or let the nightly schedule start) an `erp-enrichment` apply run from Settings → Bulk Operations (admin tester login, 1Password `vibe_coding`). Watch the worker log for `tick: batch failed` lines with `page_size` (logged at `operation-loop.ts:1664`): under a timeout the sequence must read 100 → 50 → 25 → 12 → 10, then after an auto-resume the first attempt must be 10, never 100.
- If no timeout occurs during the proof window, the evidence is: the run completes, and the handler tests above cover the ladder. State that explicitly on the issue; do not fabricate a timeout.
- Post evidence (signed) on #633, tick `- [ ] live proof`, close.
- **Gate:** issue closed with log excerpt or completed-run evidence.

## 10. Tests required

New in `apps/worker/src/handlers/erp.test.ts` (section 9 step 4, six names). New in `apps/worker/src/operation-loop.test.ts` (step 5, one name). Must stay green: `npm run test --prefix apps/worker` (node:test via `tsx --test`), `npm run build --prefix apps/worker` (tsc), the existing #630 tests at `erp.test.ts:82-165`, and `apps/worker/src/operation-retry.test.ts`.

Adversarial cases (external input = database error messages and thrown transport errors):

| Input | Hostile case | Test |
|---|---|---|
| RPC `error.message` | transient text (`statement timeout`, `lock timeout`, `57014`) | test 1 |
| `pim_item_picker` resolved `error` | transient text → thrown by `canonicalItemIdMap` | test 2 |
| rejected query promise | transient text in `Error.message` | test 3 |
| rejected query promise | non-transient text | test 4 (must re-throw) |
| thrown non-`Error` value (string) | `String(error)` still classified; non-transient string re-thrown | add to test 4 as a second assertion |
| `retry_page_size` in state | absent / `NaN` / 5 / 1000 | existing clamp at `erp.ts:304-309`; add **"an out-of-range persisted page size falls back to 100"** (`retry_page_size: 1000` → `pageSizes[0] === 100`) |

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; the AI merges; one worktree per task.
- **No database changes here.** `apply_erp_item_updates`, `api.pim_item_picker`, triggers and timeouts belong to `popcre/shared-db`; if the live proof shows the RPC itself needs splitting, open that as shared-db work (claim-first on the existing shared-db issue, load `shared-db-change`), not here.
- Production DB is read-only by default; reading the `operations` row is fine, writing it is not.
- Worker tests use `node:test` + `tsx`, not vitest; fakes resolve via a `then` method on the builder chain (see `TimeoutThenEmptyClient`). `rpc` must be a method on the client object itself, not the builder.
- Never swallow a non-transient throw into `{ok:false}`: the loop's thrown-error path logs the stack and stage; a converted result loses that.
- Do not touch the classify handler or `canonicalItemIdMap`'s contract.
- Lean required checks; reviews advisory; wait on CI only with `bin/ai-pr-wait`.
- Times for humans in EST.

## 12. Access and environment

- Implement in a fresh worktree of `u2giants/popdam3`; `gh` authenticated as `u2giants`.
- Worker local: `npm ci --prefix apps/worker`, `npm run test --prefix apps/worker` (sets dummy `SUPABASE_URL`/key itself), `npm run build --prefix apps/worker`.
- Production worker: Railway (auto-deploy from `main`); logs via the Railway dashboard or `railway` CLI/MCP (the Railway MCP failed to connect in the planning session — fall back to the dashboard).
- DB reads: Supabase MCP against project `qsllyeztdwjgirsysgai` (memory `project_supabase_virginia_cutover`: ensure the MCP targets Virginia, not the old Ohio project), or the CLI runbook in `/worksp/shared-db/AGENTS.md`.
- Admin UI: https://dam.designflow.app → Settings → Bulk Operations; admin tester login in 1Password `vibe_coding` (item titles in `docs/1password.md`).

## 13. Definition of done, risks, open questions

Done when:
- [ ] Loop catches thrown transient timeouts and downsizes; non-transient throws re-thrown.
- [ ] Park after the last halving returns `retry_page_size: 10`.
- [ ] Seven new/extended tests pass; worker build and test green in CI.
- [ ] `docs/BULK_JOBS.md` updated.
- [ ] PR merged; Railway running the merge SHA.
- [ ] Live proof (log excerpt or completed run) on #633; issue closed; this plan's STATUS updated with artifacts.

Risks and rollback:
- Catching too broadly could hide a real error as "transient" — mitigated by the strict regex and the re-throw for everything else (test 4).
- Starting resumes at 10 items makes a fully healthy resume ~10× more ticks until the op completes; acceptable because the op is nightly and unattended, and `retry_page_size` is cleared on completion (`operation-loop.ts:1755`) so the next run starts at 100 again. Rollback: revert the single commit.

Open questions: none for Albert. Page re-growth is deliberately deferred (section 8).

## Self-audit

1. **Executable by a fresh session without questions?** Yes — section 5 pins every line, section 9 gives the exact replacement code and the fake-client extensions, section 12 names tools and access by location.
2. **All background and rejected paths captured?** Yes — section 6 explains both bypass mechanisms and the cold-call memory; section 7 records six alternatives and why each loses.
3. **Goal clear enough to steer by?** Yes — section 1 states the business outcome (the nightly job finishes on its own under load without replaying timeouts) and names the forbidden "fixes" (widening timeouts, touching the shared RPC/triggers).
