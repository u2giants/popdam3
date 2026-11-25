---
summary: "Issue #945 plan: PopSG crawl completion validates database counts and ids, with contract tests. Read STATUS first."
kind: plan
status: open
read-when: "changing complete-style-guide-crawl in supabase/functions/agent-api or its RPCs upsert_style_guide_crawl_files / count_style_guide_crawl_seen; resolving #945"
---

# Plan: PopSG crawl completion — validate RPC replies and test the contract (u2giants/popdam3#945)

Issue: [#945](https://github.com/u2giants/popdam3/issues/945) — Muse review of PR #944 "PopSG crawl: skip rewriting unchanged style_guide_files rows (#804)", head `94591f0b`.
Handoff: [HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md](../../HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md)
Written 2026-11-25 by Claude (plan only; nothing implemented). Facts checked on `origin/main` `787c20b8`.

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Re-confirm the five findings' state on current main | ⬜ open | |
| 2 | Extract reply parsing into a tested helper; validate count and ids | ⬜ open | |
| 3 | Contract tests for the crawl completion path | ⬜ open | |
| 4 | PR, merge, verify deploy, one crawl's live proof, close #945 | ⬜ open | |

**Where a fresh session starts:** step 1. Steps 2–3 are one PR.

---

## 1. The ultimate goal

PopSG lists every licensor style-guide file on the NAS. A nightly crawl reports what it saw; the system then marks files that disappeared as inactive and queues thumbnails for new ones. If the system misreads the database's reply, it could record wrong file totals or — worst case — treat every file as missing and hide the whole library. When this plan is done, any unexpected reply stops that crawl's completion with a clear error instead of guessing, and tests lock the reply shapes in place.

**If a step conflicts with this goal, the goal wins: stop and flag it.**

## 2. What this application is

- **PopSG** (https://sg.designflow.app) — POP Creations' licensor style-guide library, served by the PopDAM code base [u2giants/popdam3](https://github.com/u2giants/popdam3) (branch `main`, protected).
- The NAS bridge agent (`apps/bridge-agent`) crawls style-guide folders and posts batches to the Supabase edge function `supabase/functions/agent-api` action `complete-style-guide-crawl` (~`index.ts:3400-3560`). Each batch upserts files; the final call (`done=true`) counts accepted files per root, records the crawl run and reconciles stale files.
- Database functions (shared project `qsllyeztdwjgirsysgai`, owned by `popcre/shared-db`; read-only mirror in `shared-db/`):
  - `public.upsert_style_guide_crawl_files(p_run_id uuid, p_rows jsonb) returns table (id uuid)` — writes only changed rows, records every seen active file in side table `public.style_guide_file_crawl_seen`, returns the id of **every** crawled row (`shared-db/supabase/migrations/20261111132448_popsg_crawl_seen_noop_upsert.sql:83-188`).
  - `public.count_style_guide_crawl_seen(p_root_label text, p_run_id uuid) returns bigint` (latest body `20261225080000_popsg_db_side_reconcile_job.sql:46-56`, counts the side table).
  - `public.reconcile_stale_sg_files_batch` reads the side table's `crawl_run_id` (`20261225060000_popsg_reconcile_seq_pass.sql:59-72,140-149`).
  - `public.queue_sg_render_jobs_by_ids(p_file_ids uuid[]) returns integer` — queues only files with no thumbnail, no thumbnail error and no pending/claimed job (`shared-db/supabase/ci-bootstrap/010_pre_adoption_baseline.sql:3481-3496`).

## 3. What triggered this work

Review #945 of PR #944 (merged), five findings:
1. `upsert_style_guide_crawl_files` had no definition → every batch 500s.
2. `count_style_guide_crawl_seen` had no definition → no crawl completes.
3. Reconcile might still key staleness off rewritten `style_guide_files` columns → mass deactivation.
4. Reply shape of the upsert unchecked (`{id}` objects vs scalars); returning every id re-queues every file for render.
5. `Number(count ?? 0)` unchecked → `NaN` poisons totals and the guard ratio.
Plus: no test covers the RPC contract, reply shapes or reconcile interaction.

## 4. Scope

In: findings 4 (shape validation) and 5, and the missing tests. Findings 1–3 and the re-queue half of 4 are **resolved** (§5) and only recorded.

### NOT in this plan
- Any database change.
- Crawl performance, batch sizes, reconcile batching.
- Bridge-agent changes.

## 5. Current state of the code (origin/main `787c20b8`)

- Findings 1–2 **resolved:** both functions exist (§2) with `service_role` grants (`20261111132448…:190-211`).
- Finding 3 **resolved:** the upsert writes the side table for every seen active file (`20261111132448…:170-180`) and reconcile reads it (`20261225060000…:59-72`).
- Finding 4, re-queue half **resolved in effect:** the upsert returns every crawled id, but `queue_sg_render_jobs_by_ids` inserts only files lacking a thumbnail and lacking a live job, so unchanged rendered files are never re-queued; the cost is one indexed query per batch.
- Finding 4, shape half **open:** `agent-api/index.ts:3466-3482` uses `upsertedRows?.length` and `upsertedRows.map((r: { id: string }) => r.id)` with no check; a queue error is only `console.warn`.
- Finding 5 **open:** `index.ts:3500-3508` `acceptedFileCount += Number(count ?? 0)` with no finiteness check; the value feeds `buildSgIngestCompletionUpdate` (files_found and the zero-file / guard logic) and, through the done path, stale cleanup.
- No test references `complete-style-guide-crawl`, `upsert_style_guide_crawl_files` or `count_style_guide_crawl_seen` (`grep -rln` over `supabase/functions` finds only `agent-api/index.ts`).

## 6. Key findings and root cause

The edge function trusts reply shapes from PostgREST. Today's shapes are right, but a future function change (e.g. `returns uuid[]`, or `returns table(count bigint)`) would be silently misread. For the count this matters most: a `NaN` or `0` total feeds the crawl's zero-file guard and file totals.

## 7. Approaches considered and REJECTED

| Approach | Why rejected |
|---|---|
| Change the upsert to return only changed ids | Database change for no live benefit — the render queue already filters; the full list also lets the function log seen counts. |
| Treat a bad count as 0 | 0 accepted files can look like an empty or vanished library to downstream guards; fail the completion instead (retryable on the next call). |
| Integration test against a real database in CI | The shared-db repo owns database tests; here, unit tests over a fake client lock the app side of the contract. |

## 8. Design decisions

- **LOCKED here:** a non-finite, negative or non-integer count → HTTP 500 `Could not count accepted crawl files: invalid reply`, no reconcile in that call. An upsert reply that is not an array of objects with a uuid-shaped string `id` → HTTP 500 `File upsert returned an invalid reply`, no render queueing.
- **LOCKED:** render-queue failure stays non-fatal (it is retried by later crawls and the render sweeper).
- **OPEN:** none.

## 9. The plan

### Step 1 — Re-confirm (`lead-only`)
Re-read §5 locations and the newest definitions of the four functions on fresh `origin/main`. If any signature changed, update §2/§8 first.
**Gate:** §5 confirmed or corrected here.

### Step 2 — Helper with validation (`helper-ok`)
Create `supabase/functions/_shared/sg-crawl-replies.ts` exporting `parseCrawlUpsertIds(value: unknown): string[] | null` (array; every item an object whose `id` matches `/^[0-9a-f-]{36}$/i`; empty array allowed) and `parseCrawlSeenCount(value: unknown): number | null` (accept a number or numeric string from bigint; must be a finite non-negative integer). Use them at `agent-api/index.ts:3466-3482` and `:3500-3508` with the §8 error replies.
**Gate:** the unit tests in §10 pass; `deno check` of `agent-api/index.ts` clean for touched lines.
**Stop-and-ask trigger:** if `agent-api/index.ts` already has a similar validator for another RPC — reuse it and report.

### Step 3 — Contract tests (`helper-ok`)
`supabase/functions/_shared/sg-crawl-replies.test.ts` (Vitest, runs under root `npm run test` because `vitest.config.ts` includes `supabase/functions/**`).
**Gate:** `npx vitest run supabase/functions/_shared/sg-crawl-replies.test.ts` green.

### Step 4 — Land and prove (`lead-only`)
Branch `claude/popsg-crawl-replies-945`; PR "Fixes #945"; merge when required checks pass; confirm `deploy-supabase.yml` deployed `agent-api`. Live proof: after the next nightly PopSG crawl, read-only SQL on `style_guide_crawl_runs` shows the newest run completed with a non-zero `files_found` matching the previous run within normal variation, and no edge log line "invalid reply". Comment on #945 with SHA, deploy run id and the run row (ids and counts only); close it.
**Gate:** #945 closed with evidence.

## 10. Tests required

- `parseCrawlUpsertIds`: accepts `[{id: <uuid>}]` and `[]`; rejects `null`, a uuid string array, objects without `id`, non-uuid ids.
- `parseCrawlSeenCount`: accepts `5`, `"5"`, `0`; rejects `NaN`, `-1`, `1.5`, `{count: 5}`, `[5]`, `null`.
- Must stay green: `npm run test`, `npm run lint`, `npm run typecheck`, `npx -y deno check --config supabase/functions/deno.json supabase/functions/agent-api/index.ts` (pre-existing errors elsewhere are acceptable if unchanged; record the count before and after).

### Adversarial cases (external input: database replies)

| Input | Hostile case | Test |
|---|---|---|
| upsert reply | scalar uuid array instead of objects | `parseCrawlUpsertIds` rejects a uuid string array |
| upsert reply | object missing `id` / non-uuid id | rejects objects without `id`, non-uuid ids |
| count reply | `NaN`, negative, fractional | `parseCrawlSeenCount` rejects NaN, -1, 1.5 |
| count reply | wrapped `{count}` or `[n]` | rejects `{count: 5}`, `[5]` |

## 11. Constraints, standing rules and gotchas

- No DDL; database contracts belong to `popcre/shared-db`.
- `agent-api` serves the NAS and Windows agents; a 500 on completion is retried by the bridge agent on its next call — do not add new retries.
- Never weaken the zero-file guard.
- Branch + PR; AI merges; reviews advisory.

## 12. Access and environment

- `gh` as `u2giants`; Node 20+ and `npx -y deno`.
- Read-only SQL: Supabase MCP `execute_sql` on `qsllyeztdwjgirsysgai` (token required) or `psql` with the read DSN in 1Password `vibe_coding`.
- Edge logs: Supabase dashboard / MCP `get_logs` for `agent-api`.

## 13. Definition of done, risks and open questions

- [ ] Steps 2–3 merged (SHA); tests green in CI.
- [ ] `agent-api` deployed (run id).
- [ ] Next crawl completed normally (run row cited).
- [ ] #945 closed with evidence; STATUS and handoff updated.

Risks: over-strict validation could fail completions if PostgREST returns bigint as string — handled by accepting numeric strings. Rollback: revert PR.

## Self-audit (Mode A)

1. *Fresh session could execute without asking?* Yes — §2 defines the crawl path and the four functions with file:line; §5 states which findings are resolved and why; §9 exact helper names, call sites, replies; §10 tests.
2. *All background including rejected paths?* Yes — §3 all five findings; §5 resolution evidence; §7 rejected options.
3. *Goal clear for judgment?* Yes — §1 in business terms (never hide the library on a misread); §8 locks fail-closed for counts.

## Lead launch prompt

```text
You are the lead for u2giants/popdam3 issue #945. Read AGENTS.md, docs/plans/issue-945-popsg-crawl-rpc-contract.md (STATUS first) and HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md. Work in your own worktree from origin/main.
You do steps 1 and 4. Hand steps 2 and 3 to your helper; review the diff and rerun the tests.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker only; no design decisions; no merges, pushes to main or GitHub posts; bring stop-and-ask triggers to you; taken back after 30 minutes stuck.
Checks you run yourself: npm run test, lint, typecheck, deno check of agent-api, the adversarial table mapped to passing tests, the deploy run and the next crawl's run row.
```
