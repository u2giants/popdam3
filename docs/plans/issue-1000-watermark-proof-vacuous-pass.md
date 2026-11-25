---
summary: Issue #1000 plan: the shared-db #2421 watermark live proof must fail on an empty or never-succeeded watermark. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #1000, or changing evaluateWatermark2421 / the 2421 prover in scripts/shared-db-live-proof.mjs
---

# Plan: the #2421 watermark proof must not pass on empty evidence (u2giants/popdam3#1000)

Issue: https://github.com/u2giants/popdam3/issues/1000
Handoff: [HANDOFF.d/2026-11-25T2100Z-al8960ofc-claude-469-review-finding-plans.md](../../HANDOFF.d/2026-11-25T2100Z-al8960ofc-claude-469-review-finding-plans.md)
Written November 25, 2026, 4:00 PM EST on `al8960ofc` by Claude (session b5bcb2fd). Planning only: no code was changed.

## STATUS — read before executing

| Step | State (Nov 25, 2026) | Evidence / artifact |
|---|---|---|
| 1. Require a recorded successful watermark pair | ⬜ open | — |
| 2. Require `watermark_protocol === 1` on a rebuild run with params | ⬜ open | — |
| 3. Add the three vacuous-pass tests | ⬜ open | — |
| 4. Run the proof's tests in CI | ⬜ open | — |
| 5. Live re-run of the 2421 proof, comment, close #1000 | ⬜ open | — |

**Start at Step 1.**

## 1. Ultimate goal

PopDAM keeps a set of "live proof" checks that confirm a database change really works in production before anyone calls it done. One of them (for shared database issue popcre/shared-db#2421, the change that made the nightly style-group rebuild only reprocess changed rows) can today report **success while having checked nothing**: an empty watermark record, or a rebuild that stopped stamping its protocol marker, both pass. The goal is that this proof can only pass when production really shows a completed incremental run. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, default branch `main`) is POP Creations' internal library of licensed product artwork: a React web app, Supabase edge functions, a Railway worker and NAS agents, all on one shared Supabase Postgres project (`qsllyeztdwjgirsysgai`). Database structure is owned by `popcre/shared-db`; this repo only reads it. `scripts/shared-db-live-proof.mjs` is a read-only production checker dispatched by `.github/workflows/shared-db-live-proof.yml` (input `issue`, e.g. `2421`). Each shared-db issue has a `prove<Name>` function and a pure `evaluate<Name>` function that decides pass/fail.

## 3. What triggered this work

The advisory AI reviewer on PR #999 (which added the 2421 option) filed #1000 with three findings, all still true on `main` at 787c20b8:

1. `evaluateWatermark2421` (`scripts/shared-db-live-proof.mjs:1121-1135`) only checks that each id/cutoff pair is "both present or both absent". `{}` passes, and so does a watermark with only a `pending_*` pair — i.e. a run that never completed successfully.
2. `scripts/shared-db-live-proof.mjs:1142-1154`: when `rebuild_op_state.params` exists but has no `watermark_protocol`, every protocol check is skipped (`protocol !== undefined && …`, then `Number(protocol) === 1`). A worker that stopped writing the protocol still passes.
3. `scripts/shared-db-live-proof.test.mjs:347-371` has no test for `{}`, pending-only, or params-without-protocol.

Reproduce: in a Node REPL, `evaluateWatermark2421({...goodState, watermark_state: {}})` returns a summary instead of throwing.

## 4. Scope

In: `evaluateWatermark2421` logic, its tests, adding the test file to CI, one live re-run.
NOT in this plan: the SQL probe `scripts/shared-db-live-proof-2421.sql` (it already returns `watermark_state` and `rebuild_op_state`); any other prover; the worker or the rebuild itself; any database change; reopening popcre/shared-db#2421 (closed).

## 5. Current state of the code

- `scripts/shared-db-live-proof.mjs:1100-1160` — `evaluateWatermark2421`; exported; called by `proveStyleGroupWatermark` (`:1162-1185`).
- `scripts/shared-db-live-proof.test.mjs:311-371` — fixtures `goodInstalled2421`, `goodState2421`, three 2421 tests. The good fixture already carries both pairs and a protocol-1 run, so the new rules do not break it.
- The test file is **not** run by any workflow (`grep` of `.github/workflows` finds no `shared-db-live-proof.test`). `node --test scripts/shared-db-live-proof.test.mjs` passes locally today.
- Nothing is half-done; no branch exists for this.

## 6. Key findings

- `fail()` throws `ProofFailure`; tests assert with `assert.throws(..., ProofFailure)`.
- A legitimate production state after the first successful run always has `last_successful_run_id` + `last_successful_cutoff` (the queue function writes them only on matching successful completion, which is the clause the proof asserts). A pending pair alone is normal *in addition* to it, never instead of it.
- `rebuild_op_state` may legitimately be `null`/absent (no rebuild row yet) or have no `params` (older row shape); only "params present but protocol missing" is the hole.

## 7. Rejected approaches

- **Rejecting any watermark without a pending pair** — wrong: between runs the pending pair is cleared; only the successful pair is mandatory.
- **Requiring `rebuild_op_state` to exist** — would fail a valid state right after a cleanup of old bulk rows; the watermark's successful pair already proves a run happened.
- **Closing #1000 as moot because #2421 is closed** — rejected: the prover stays registered in `PROVERS` and selectable in the workflow, so it can be re-run and would still pass vacuously.

## 8. Decisions

Locked: pass requires a non-empty `last_successful_run_id`/`last_successful_cutoff` pair; params without `watermark_protocol` fail with a named message. Open (implementer's judgment): exact failure message wording, as long as it names the missing key.

## 9. Steps

1. **Successful pair required** — in `evaluateWatermark2421`, after the pair loop, `if (!(typeof watermark.last_successful_run_id === "string" && watermark.last_successful_run_id && typeof watermark.last_successful_cutoff === "string" && watermark.last_successful_cutoff)) fail("2421 watermark has no recorded successful run (last_successful_run_id/last_successful_cutoff)")`. Gate: `{}` and pending-only states throw. `helper-ok` — one exact edit. Stop-and-ask: if the good fixture starts failing.
2. **Protocol required** — replace `if (protocol !== undefined && Number(protocol) !== 1)` with `if (Number(protocol) !== 1) fail(...)` inside the existing `op.params` branch, so a missing protocol fails. Gate: params without protocol throws; good fixture passes. `helper-ok`. Stop-and-ask: if a live production row is known to lack the marker legitimately.
3. **Tests** — add `test("2421 rejects an empty watermark, a pending-only watermark and run params without watermark_protocol", …)` in `scripts/shared-db-live-proof.test.mjs` after line 371 with three `assert.throws(..., ProofFailure)` cases: `watermark_state: {}`; `watermark_state: { pending_run_id, pending_cutoff, pending_mode }` only; `rebuild_op_state.params` with `watermark_protocol` deleted. Gate: `node --test scripts/shared-db-live-proof.test.mjs` green; reverting step 1 or 2 makes the new test fail. `helper-ok`. Stop-and-ask: any other existing test fails.
4. **CI** — append `scripts/shared-db-live-proof.test.mjs` to the `node --test` list at `.github/workflows/ci.yml:80`. Gate: the PR's CI log shows the file's tests run. `helper-ok`. Stop-and-ask: if that job's runner lacks dependencies the file imports.
5. **Live proof** — after merge, dispatch `shared-db-live-proof.yml` with `issue=2421` (`gh workflow run shared-db-live-proof.yml -f issue=2421 …` with the workflow's other required inputs). Gate: run is green and its summary shows `watermark_keys` including `last_successful_cutoff`. If it fails, read the message: a genuine production gap is reported on #1000 as a finding, not patched in the proof. `lead-only` — live-proof judgment. Then comment the run link on #1000 and close it.

## 10. Tests

New: the test in step 3. Must stay green: `node --test scripts/shared-db-live-proof.test.mjs` (all provers), and the existing `ci.yml` node-test job.

## 11. Constraints and gotchas

Feature branch + PR to `main`; the AI merges; reviews are advisory. No database writes; the proof is read-only. Never print `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ACCESS_TOKEN`. Do not loosen any other prover. Sign GitHub comments with the `$AI_GH_SIGNATURE` format.

## 12. Access

`gh` authenticated as `u2giants`. The workflow uses repository secrets `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN` (no local secret needed). Local run: Node 22, repo root.

## 13. Definition of done, risks

Done: steps 1-4 merged with CI green; step 5 run green and linked on #1000; #1000 closed; this plan's STATUS updated and handoff closed. Risk: production watermark genuinely lacks a successful pair → the proof now fails, which is the correct report; rollback is reverting the PR. Uncertainty: none material.

## Self-audit

1. Fresh session could execute without questions? Yes — §3 gives exact lines, §9 gives exact edits and gates, §12 access.
2. All background carried, including rejected options? Yes — §6 explains which states are legitimate, §7 lists three rejected approaches.
3. Goal clear enough for judgment calls? Yes — §1: pass only on a real completed incremental run; §9 step 5 says what to do if production itself fails.

## Lead launch prompt

```
Implement docs/plans/issue-1000-watermark-proof-vacuous-pass.md in u2giants/popdam3. Read the plan fully first, then its STATUS.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Give the helper steps 1-4 in order (helper-ok). The helper returns finished work or an evidenced blocker, makes no design decisions, never merges or posts, asks you when a stop-and-ask trigger fires, and is taken back after 30 minutes stuck.
You do step 5 yourself, and you re-run `node --test scripts/shared-db-live-proof.test.mjs` and check the CI log yourself before merging.
Branch, PR to main, merge when required checks pass, then update the plan STATUS and close the handoff.
```
