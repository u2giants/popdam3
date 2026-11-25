---
summary: "Issues #781, #874, #995 plan: scorecard harness tests run in CI, finished resumes send no searches, workflow has no dead conditions. Read STATUS first."
kind: plan
status: open
read-when: "changing scripts/search-eval or .github/workflows/search-eval.yml, or wiring script tests into CI; resolving #781, #874 or #995"
---

# Plan: search scorecard harness — CI wiring and cleanup (u2giants/popdam3#781, #874, #995)

Issues: [#781](https://github.com/u2giants/popdam3/issues/781) (review of PR #777), [#874](https://github.com/u2giants/popdam3/issues/874) (review of PR #873), [#995](https://github.com/u2giants/popdam3/issues/995) (review of PR #994).
Handoff: [HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md](../../HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md)
Written 2026-11-25 by Claude (plan only; nothing implemented). Facts checked on `origin/main` `787c20b8`, including a local run of `node --test scripts/search-eval/` (24 tests: 23 pass, 1 fails on Windows only — §5).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Make the one platform-dependent assertion portable | ⬜ open | |
| 2 | Skip the warm-up when nothing is left to search | ⬜ open | |
| 3 | Run every `scripts/search-eval/*.test.mjs` in CI | ⬜ open | |
| 4 | Remove dead `steps.guard` conditions and the one-shot label fallback | ⬜ open | |
| 5 | PR, merge, prove CI runs the tests, close issues | ⬜ open | |

**Where a fresh session starts:** step 1. All steps are one PR.

---

## 1. The ultimate goal

The **search scorecard** is how POP Creations proves search is accurate and fast: it runs ~250 real searches as an ordinary viewer and scores them against private judgments. Its own code decides whether a "pass" is real. When this plan is done, every change to that code is checked automatically, a resumed run never sends needless live searches, and the scorecard workflow file contains nothing misleading.

**If a step conflicts with this goal, the goal wins: stop and flag it.**

## 2. What this application is

- **PopDAM** (https://dam.designflow.app) and **PopSG** (https://sg.designflow.app) — POP Creations' internal artwork and style-guide libraries. Repo [u2giants/popdam3](https://github.com/u2giants/popdam3), branch `main` (protected).
- **Scorecard harness:** `scripts/search-eval/` — `run.mjs` (runs the searches as a viewer, checkpoints, writes a report), `score.mjs` (pass/fail rules), `step-timing.mjs`, `viewer-session.mjs` (token renewal), `label.py`, and tests `run.test.mjs`, `score.test.mjs`, `step-timing.test.mjs`, `viewer-session.test.mjs` (Node's built-in `node:test`). Guide: `docs/SEARCH_EVAL.md`. Cases and judgments live privately in admin_config `SEARCH_EVAL_SET_V1`, never in the repo.
- **Workflow:** `.github/workflows/search-eval.yml` — manual `workflow_dispatch` with required input `label`; one job runs `run.mjs` against production and uploads `report.json`.
- **CI:** `.github/workflows/ci.yml`; its "Measurement observer tests" step (`:77-80`) runs an explicit `node --test <files>` list. Root Vitest (`vitest.config.ts`) only covers `src/**`, `supabase/functions/**`, `apps/**/src/**/*.vitest.ts` — not `scripts/`.

## 3. What triggered this work

Advisory AI reviews of merged PRs (advice only; `fixer-deferred`/`fixer-done` labels are not proof of a fix):

- **#781** (PR #777 "keep long search evaluations authenticated", head `a1163a26`): (1) the new `run.test.mjs` and `viewer-session.test.mjs` are run by no runner; (2) observation only — renewal is proactive, not reactive (no change requested).
- **#874** (PR #873 "warm edge isolates before timed searches", head `1de1780d`): (1) the five warm-up searches broke the fetch-count tests; (2) a resume with every engine already saved still sends five live warm-up searches.
- **#995** (PR #994 "remove one-shot schedule", head `5b8fcf15`): (1) `Summarize` and `upload-artifact` still have `if: steps.guard.outputs.skip != 'true'` referencing a deleted step; (2) obsolete fallback label `|| 'issue-5747-after-7d'`. The fixer refused because workflow files are protected paths.

## 4. Scope

In: #781 finding 1, #874 finding 2, #995 findings 1–2, plus the Windows-only assertion found while verifying.
Recorded as already done: #874 finding 1 (§5). Recorded as no-change: #781 finding 2 (the reviewer asked for none; proactive renewal with a 60 s margin is adequate for a 120-minute job).

### NOT in this plan
- Scoring rules, the private case set, or any live scorecard run beyond a smoke proof.
- Moving script tests into Vitest.
- Reactive 401 re-authentication (#781-2).
- Running the harness against production in CI (it needs secrets and hits production; tests are offline mocks).

## 5. Current state of the code (origin/main `787c20b8`)

- `scripts/search-eval/run.mjs:169-174`: unconditional loop `for (const warm of ["a","b","c","d","e"]) await damSearch(\`warmup ${warm}\`).catch(() => {});` before the case loop at `:175-185`, which skips engines already in `raw` from the checkpoint.
- `run.test.mjs:78` and `:130` now exclude bodies whose `query` starts with `"warmup "` from the counts — **#874 finding 1 fixed**; the counting tests pass.
- Local run `node --test scripts/search-eval/` on Windows: 23 pass, 1 fail — `run.test.mjs:137` `assert.equal(statSync(checkpoint).mode & 0o777, 0o600)` gets `0o666` (438) because Windows ignores POSIX modes. On Linux CI it is expected to pass; it must not be skipped there.
- `.github/workflows/ci.yml:80`: `node --test scripts/lib/indexed-write-measurement.test.mjs scripts/measure-indexed-writes.test.mjs scripts/measure-indexed-writes.pg.test.mjs scripts/orderlist-integration-proof.test.mjs` — no `scripts/search-eval/` file.
- `.github/workflows/search-eval.yml`: `:32` `LABEL: ${{ inputs.label || 'issue-5747-after-7d' }}`; `:35` and `:48` `if: steps.guard.outputs.skip != 'true'`; no step has `id: guard`.

## 6. Key findings and root cause

1. Script tests are opt-in by an explicit file list; new files are silently skipped unless someone edits `ci.yml` (same hazard noted in `docs/plans/issue-723-rescan-1gb-bounded-read.md`).
2. The warm-up was placed before the per-case "already saved?" checks, so it ignores checkpoint state.
3. PR #994 removed the `guard` step but only two of its four references.

## 7. Approaches considered and REJECTED

| Approach | Why rejected |
|---|---|
| Add a glob (`scripts/**/*.test.mjs`) to the CI step | Some script tests need a Postgres fixture (`*.pg.test.mjs`) or are slow; an explicit directory (`scripts/search-eval/`) is predictable. |
| Delete the warm-up | It removes real cold-start skew from timings (PR #873's purpose). Gate it instead. |
| Skip the mode assertion everywhere | Loses the real Linux check that checkpoints are private (`0o600`); skip only on `win32`. |
| Make the new CI step required | Owner ruling 2026-10-30: only checks that stop production-data damage or secret leaks may block a merge. It stays advisory. |

## 8. Design decisions

- **LOCKED:** checkpoints are written `0o600` (they hold raw results); warm-ups never persist or score.
- **LOCKED:** `label` stays a required input; with no schedule there is no fallback.
- **OPEN:** none.

## 9. The plan

### Step 1 — Portable mode assertion (`helper-ok`)
`scripts/search-eval/run.test.mjs:137`: wrap in `if (process.platform !== "win32")`, with a comment that Windows does not report POSIX modes.
**Gate:** `node --test scripts/search-eval/` → 24 pass on Windows; on Linux the assertion still runs.

### Step 2 — Warm-up only when work remains (`helper-ok`)
In `run.mjs` before `:169`: `const pending = set.cases.some((c) => (c.dam && !raw[c.id]?.dam) || (c.sg_guides && !raw[c.id]?.sg_guides) || (c.sg_files && !raw[c.id]?.sg_files));` and run the warm-up loop only `if (pending)`. Optionally, warm only when a DAM search is pending, since the warm-up calls `damSearch` — the lead decides; default: any pending engine (the PopSG path also uses `dam-search-ai` for spelling/embedding).
New test in `run.test.mjs`: "a resume with every engine saved sends no warm-up searches" — run once, then resume; count **all** `dam-search-ai` POSTs including warm-ups on the resume: expect 0.
**Gate:** the new test passes; existing tests unchanged and passing.
**Stop-and-ask trigger:** if `--first-hit` mode (`run.test.mjs` "--first-hit skips warm-ups…") interacts with the gate.

### Step 3 — CI runs the harness tests (`lead-only`: protected workflow file)
`.github/workflows/ci.yml`: add a step after "Measurement observer tests": `- name: Search scorecard harness tests` / `run: node --test scripts/search-eval/`. No secrets, no network (the tests mock `fetch`).
**Gate:** the PR's CI run shows the step with 25 tests passing.

### Step 4 — Workflow cleanup (`lead-only`: protected workflow file)
`.github/workflows/search-eval.yml`: delete both `if: steps.guard.outputs.skip != 'true'` lines; change `:32` to `LABEL: ${{ inputs.label }}`.
**Gate:** `grep -n "guard\|issue-5747" .github/workflows/search-eval.yml` returns nothing; if `actionlint` is available, it reports no errors for the file.

### Step 5 — Land and prove (`lead-only`)
Branch `claude/search-eval-ci-781-874-995`; PR body "Fixes #781, fixes #874, fixes #995"; merge when required checks pass. Proof: the merge-commit CI run on `main` shows "Search scorecard harness tests" green (run id). Do **not** launch a production scorecard just for this; the next scheduled-by-person run exercises the workflow. Close all three issues citing the run id (GitHub closes them on merge via "Fixes"; add an evidence comment).
**Gate:** issues closed with merge SHA and CI run id.

## 10. Tests required

- New: `run.test.mjs` "a resume with every engine saved sends no warm-up searches".
- Changed: the mode assertion at `run.test.mjs:137` (platform-gated).
- Must stay green: `node --test scripts/search-eval/` (all 25), the existing `ci.yml` steps, `npm run test`.

## 11. Constraints, standing rules and gotchas

- `.github/workflows/*` are protected: the automatic fixer never edits them; this session (a person-directed AI session) may.
- The new CI step is advisory, never added to required checks (owner ruling 2026-10-30).
- Never add licensed names, product codes, file ids or real judgments to tests or fixtures (`docs/SEARCH_EVAL.md`); use placeholders like `example`.
- Tests write temporary checkpoint files under the OS temp folder and clean up; keep it that way.
- Branch + PR; AI merges.

## 12. Access and environment

- `gh` as `u2giants`; Node 20+ (`node --test`). No secrets needed for this plan. The live workflow's secrets (`SEARCH_EVAL_*`) are GitHub secrets and are not touched.

## 13. Definition of done, risks and open questions

- [ ] Steps 1–4 merged (SHA in STATUS).
- [ ] CI run on `main` shows the harness tests green (run id in STATUS).
- [ ] #781, #874, #995 closed with evidence.
- [ ] STATUS and handoff updated.

Risks: a future harness test that needs network would fail CI — acceptable, it would be caught on its PR. Rollback: revert PR.
Open: none.

## Self-audit (Mode A)

1. *Fresh session could execute without asking?* Yes — §2 explains the harness, workflow and CI step; §5 gives exact lines and the local test result; §9 names each edit and gate. Gap found during verification: a Windows-only failing assertion — added as step 1.
2. *All background including ruled-out paths?* Yes — §3 the three reviews; §5 records #874-1 fixed and #781-2 no-change; §7 rejected options.
3. *Goal clear for judgment?* Yes — §1; §8 locks the private-checkpoint mode and required label.

## Lead launch prompt

```text
You are the lead for u2giants/popdam3 issues #781, #874 and #995. Read AGENTS.md, docs/plans/issue-781-search-eval-harness-ci-and-cleanup.md (STATUS first), docs/SEARCH_EVAL.md and HANDOFF.d/2026-11-26T0200Z-al8960ofc-claude-search-indexing-plans.md. Work in your own worktree from origin/main.
You do steps 3, 4 and 5 (protected workflow files and landing). Hand steps 1 and 2 to your helper, then review the diff and run node --test scripts/search-eval/ yourself.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker only; no design decisions; no merges, pushes to main or GitHub posts; bring stop-and-ask triggers to you; taken back after 30 minutes stuck.
Checks you run yourself: the full harness test run, grep of search-eval.yml for guard/issue-5747, and the CI run on main showing the new step green.
```
