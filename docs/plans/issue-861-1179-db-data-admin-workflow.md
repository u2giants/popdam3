---
summary: Issues #861 and #1179 plan: keep build-tool security advisories visible (advisory) in the DB Data Admin workflow, correct its gate comments, and test its content-equal main-tip rule. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #861 or #1179, or editing .github/workflows/db-data-admin.yml audit or main-tip gates
---

# Plan: DB Data Admin workflow — dev-dependency audit visibility and tip-gate tests (u2giants/popdam3#861, #1179)

Handoff registration: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md)

Two review-finding issues on `.github/workflows/db-data-admin.yml`, planned together:
**#861** (review of merged PR #860 "npm audit fix + scope launch audit to the production tree") and
**#1179** (review of merged PR #1178 "accept a content-equal main tip in the production gate").

## STATUS

| Step | State | Evidence |
|---|---|---|
| 1 Advisory full-tree audit + true comment | ⬜ open | — |
| 2 Gate comments say "committed files only" | ⬜ open | — |
| 3 Extract tip check to a tested script | ⬜ open | — |
| 4 Workflow-content assertions | ⬜ open | — |
| 5 Live proof | ⬜ open | — |

Already resolved (not planned, evidence): #1179 finding 1 (pre-exposure recheck still exact) was
fixed by PR #1180 (`c1ed29b9`): `db-data-admin.yml:361-377` now applies the same ancestor +
no-input-diff rule. #861 finding 2 (unverified root `package-lock.json` bumps) is moot: root CI on
`main` has since passed repeatedly (CI run 45695969527 on `787c20b8`, frontend publish run
45664776663), exercising the root build/lint/test with that lockfile.

Fresh session starts at step 1 (planned 2026-11-25).

## 1. Ultimate goal

The admin site for shared Master Data (`https://data.designflow.app`) must keep deploying safely:
security problems in the tools that build it must stay visible to whoever works on it (without
blocking unrelated work), and the "never deploy stale code" rule must be proven by tests and
described truthfully, so nobody loosens or tightens it by mistake.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

`apps/db-data-admin/` in `u2giants/popdam3` is a small Vite/React admin frontend for the shared
Master Data in the shared Supabase project `qsllyeztdwjgirsysgai`, built as a Docker image
(`apps/db-data-admin/Dockerfile`: full `npm ci` then `npm run build`) and deployed by Coolify app
`zeoy8qfjqffu8ym533cc7dl4` at `https://data.designflow.app`. Its workflow
`.github/workflows/db-data-admin.yml` has jobs `verify` (npm ci, audit, lint, test, build), `container`,
and `deploy-production` (manual `workflow_dispatch` with `project_ref` and a typed `confirmation`,
then main-tip gate, read-only Supabase evidence, Coolify uuid check, readiness script, pre-exposure
recheck, domain attach + `sha-<commit>` tag, deploy, live verification).

## 3. What triggered this work

#861 (PR #860, head `fc97aa4a`): `npm audit --omit=dev` (`db-data-admin.yml:59`) stops reporting
advisories in build tools (vite, esbuild, plugin-react, typescript) that run at image build and shape
the shipped bundle; the comment "Dev-tool advisories … never reach the built app" (`:55-58`) is false.
Reviewer suggestion: keep a **non-blocking** full-tree audit beside the blocking production audit.

#1179 (PR #1178, head `26540592`): (1) fixed later by #1180; (2) the comments at `:224-226` and
`:296-301` claim "the same paths that trigger this workflow" cover everything that feeds the deploy,
but repository variables/secrets and Coolify settings are not in the diff — say "committed files
only"; (3) no test covers ancestor-only rejection, input-path diff rejection, the
`ORIGIN_MAIN_SHA=${GITHUB_SHA}` export, or the recheck rule.

## 4. Scope

In: `.github/workflows/db-data-admin.yml`, a new `scripts/db-data-admin/check-main-tip.sh` (or `.mjs`),
`scripts/db-data-admin/check-data-admin-launch-readiness.test.mjs` and a new test, live proof.

NOT in this plan: making any audit a required merge check; changing which inputs count as DB Data
Admin inputs; the readiness script's Supabase evidence rules; the app's code.

## 5. Current state (origin/main `787c20b8`, 2026-11-25)

- `db-data-admin.yml:5-14` push/PR paths: `apps/db-data-admin/**`, `scripts/db-data-admin/**`, the workflow.
- `:51` Node 24; `:54` `npm ci`; `:55-58` false comment; `:59` `npm audit --omit=dev --audit-level=high`.
- `:224-226` header bullet 2; `:290-318` first tip gate (ancestor + `git diff --quiet` over
  `inputs=(apps/db-data-admin scripts/db-data-admin .github/workflows/db-data-admin.yml)`, exports
  `ORIGIN_MAIN_SHA=${GITHUB_SHA}` and `ORIGIN_MAIN_TIP`); `:361-377` recheck with the same rule
  duplicated inline.
- `scripts/db-data-admin/check-data-admin-launch-readiness.test.mjs:177-185` asserts only dispatch
  inputs, the domain-attach jq, and the "Recheck" step name.

## 6. Key findings

- The two tip checks are the same logic copied twice; a shared script removes drift (#1179 finding 1
  happened precisely because one copy was not updated).
- Build-tool compromise reaches production output, so dev advisories matter — but blocking every PR on
  freshly published dev-only advisories was why #860 narrowed it. Advisory visibility is the balance.

## 7. Approaches rejected

- **Blocking full-tree audit** — rejected: owner ruling 2026-10-30 (only checks preventing
  production-data damage or secret leaks may block) and the PR churn #860 fixed.
- **Remove the audit entirely** — rejected: loses the production-dependency gate.
- **Leave the duplicated inline tip logic and only add regex tests** — acceptable fallback, rejected as
  primary: tests would not exercise behaviour.

## 8. Design decisions

- LOCKED: production audit `--omit=dev --audit-level=high` stays as is.
- LOCKED: add a full-tree `npm audit --audit-level=high` step with `continue-on-error: true` that writes
  its summary to `$GITHUB_STEP_SUMMARY` and an `::warning::` line when it finds issues.
- LOCKED: tip rule = accept when `GITHUB_SHA == tip`, or `GITHUB_SHA` is an ancestor of tip AND no diff
  in the input paths; otherwise exit 1. Same script used in both places.
- OPEN: script language (bash or node). Bash matches the workflow; node is easier to unit-test with a
  temp git repo. Either is fine if §10's cases run.

## 9. Steps

1. **Advisory audit + comment** — `helper-ok`. After `:59` add
   `- name: Full-tree audit (advisory; build tools shape the shipped bundle)` with
   `continue-on-error: true`, `run: npm audit --audit-level=high || { echo "::warning::Dev/build dependency advisories found — see step log"; exit 1; }`.
   Replace the `:55-58` comment with: "Blocking gate covers shipped dependencies; build tools also shape
   `dist/`, so the next step reports full-tree advisories without blocking (#861)."
   Stop-and-ask: the job turns red because of this step. Gate: a PR run shows the step and the job green.
2. **Comments** — `helper-ok`. At `:224-226` and `:296-301` add "(committed files only; repository
   variables, secrets and Coolify settings are not compared)". Gate: grep finds the phrase twice.
3. **Shared tip script** — `lead-only` (production deploy gate logic). Create
   `scripts/db-data-admin/check-main-tip.sh <github_sha> <tip>` implementing §8; call it from both
   steps (`:290-318`, `:361-377`), keeping the `ORIGIN_MAIN_SHA`/`ORIGIN_MAIN_TIP` exports in the first
   step. Gate: §10 tests pass; the workflow still references both step names the readiness test checks.
4. **Tests** — `helper-ok`. Add `scripts/db-data-admin/check-main-tip.test.mjs` (node:test) building a
   temp git repo: equal → pass; tip descends, only `docs/` changed → pass; tip descends, `apps/db-data-admin/x` changed → fail;
   diverged history → fail; workflow file changed → fail. Extend the workflow-content test to assert
   both steps call `check-main-tip.sh` and `ORIGIN_MAIN_SHA=${GITHUB_SHA}` is exported. Gate:
   `node --test scripts/db-data-admin/*.test.mjs` passes. Stop-and-ask: the existing test runner
   wiring for `scripts/db-data-admin` differs (check how `verify` runs it).
5. **Live proof** — `lead-only`. After merge, dispatch `deploy-production` from current `main` with
   the two inputs (`project_ref=qsllyeztdwjgirsysgai`, `confirmation=launch-data-designflow-app`)
   only if a DB Data Admin input changed since the last deploy; otherwise record a green push run of
   `verify` showing the advisory audit step. Gate: run id in STATUS row 5 and on both issues;
   `https://data.designflow.app` loads.

Order: 1, 2 parallel → 3 → 4 → one PR → 5.

## 10. Tests required

New `check-main-tip.test.mjs` (five cases above); extended
`check-data-admin-launch-readiness.test.mjs`. Green: the workflow's `verify` job (`npm run lint`,
`npm test`, `npm run build` in `apps/db-data-admin`).

## 11. Constraints and gotchas

- Branch + PR; AI merges after required checks; reviews advisory; no new required checks; no wait over
  30 minutes; never ask Albert to approve. A production dispatch is allowed for the AI (no human
  approval; owner rulings 2026-09-28, 2026-10-29).
- Production evidence queries are read-only.
- Coolify/Supabase tokens are GitHub secrets mirrored in 1Password `vibe_coding`; never print.

## 12. Access and environment

`gh` as `u2giants` (can dispatch). Local: `cd apps/db-data-admin && npm ci && npm test`; git available for temp-repo tests.

## 13. Definition of done, risks, open questions

Done: rows 1-5 cite artifacts; PR merged green; #861 and #1179 closed with evidence. Risk: a script bug
blocks production launches (fails closed; rollback = revert PR). Open: script language (§8).

## Self-audit

1. Executable without questions? Yes — §5 line refs, §8 locked rules, §9 gates.
2. Background/rejected paths, including already-fixed parts? Yes — STATUS note, §3, §7.
3. Goal steers? Yes — §1.

## Lead launch prompt

```
Read docs/plans/issue-861-1179-db-data-admin-workflow.md in u2giants/popdam3 (STATUS first) and AGENTS.md.
You are the lead: do steps 3 and 5 yourself; hand 1, 2 and then 4 to your helper.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol,
GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker only; no design decisions; no merges, pushes or
posts; bring stop-and-ask triggers to you; take a step back after 30 minutes stuck.
Verify every gate, open one PR, merge when required checks pass (reviews advisory), do live proof,
update STATUS, close #861 and #1179 with evidence.
```
