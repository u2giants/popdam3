---
summary: Issue #812 plan: check the image-pin credential before publishing, document COOLIFY_WRITE_TOKEN, test it. Read its STATUS first.
kind: plan
status: open
read-when: implementing #812, or changing publish-frontend.yml, the Coolify image pin, or the frontend secret inventories
---

# Plan: Make frontend image publishing fail cheap and document its credential (u2giants/popdam3#812)

Issue: https://github.com/u2giants/popdam3/issues/812 (review finding on merged PR #810, reviewer deepseek)
Handoff: [HANDOFF.d/2026-11-25T2101Z-al8960ofc-claude-thumbnail-render-plans.md](../../HANDOFF.d/2026-11-25T2101Z-al8960ofc-claude-thumbnail-render-plans.md)
Written 2026-11-25 (about 4:00 PM EST) by Claude. Plan only. Code references are to `origin/main` at `787c20b8`.

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 0 | Secret exists in GitHub | ✅ verified 2026-11-25 | `gh secret list -R u2giants/popdam3` shows `COOLIFY_WRITE_TOKEN` (set 2026-11-05); last 3 `publish-frontend.yml` runs succeeded (2026-11-25) |
| 1 | Move the credential guard before the image build/push | ⬜ open | guard is at `.github/workflows/publish-frontend.yml:123-126`, after push at `:104-115` |
| 2 | Add `COOLIFY_WRITE_TOKEN` to the three secret inventories | ⬜ open | `docs/configuration.md:50-56`, `SELFHOST.md:86-90`, `docs/agents-reference.md:339-341` |
| 3 | Complete `op://` reference in `docs/deployment.md` | ⬜ open | `docs/deployment.md:32` names item + field only |
| 4 | Workflow source-contract test | ⬜ open | none exists |
| 5 | PR, CI, merge, watch the next publish run | ⬜ open | |
| 6 | Live proof on #812, close | ⬜ open | `- [ ] live proof` stays on #812 |

**Where a fresh session starts:** Step 1. All four findings are still open on `main`; finding 1's "the deploy will fail" risk did not happen because the secret was provisioned (row 0).

---

## 1. The ultimate goal

Publishing the web app must never leave production half-updated, and anyone who has to restore or rotate the publishing credential must find it in the documented places. Concretely: if the image-pin credential is missing, publishing stops **before** a new image is pushed (so the `:latest` tag never moves without the matching pin); the credential appears in every secret list with its exact 1Password location; and a test stops anyone from quietly undoing those safety rules.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`https://dam.designflow.app`, also PopSG at `https://sg.designflow.app`) is POP Creations' internal Digital Asset Manager. The React frontend is built by GitHub Actions workflow `.github/workflows/publish-frontend.yml` into a Docker image on GHCR (`ghcr.io/u2giants/popdam-frontend`), then **Coolify** (the self-hosted deploy tool on server `hetz`, API at the `COOLIFY_URL` secret) is told (a) which immutable image tag to run — the "pin", a PATCH to `/api/v1/applications/<uuid>` with token `COOLIFY_WRITE_TOKEN`, scoped to this one app — and (b) to deploy — `/api/v1/deploy` with the shared deploy-only `COOLIFY_TOKEN`. A final step verifies production serves the commit. Repo `u2giants/popdam3`, protected `main`; `.github/workflows/**` is a protected path (the review-fixer may not edit it).

## 3. What triggered this work

PR #810 ("Repair scoped access for frontend image publishing", merged 2026-11-05) introduced the dedicated pin token. The advisory review (ai-review run 42069736734) and fixer (run 42070899265) confirmed:
1. The empty-token guard (`publish-frontend.yml:123-126`) runs after `Build and push image to GHCR` (`:104-115`), which already moved `:latest` and the SHA tags. A missing secret fails the run with a fresh image published and no pin.
2. `docs/configuration.md`, `SELFHOST.md`, `docs/agents-reference.md` (the issue's "AGENTS.md:401" moved there when AGENTS.md became a router) list only `COOLIFY_TOKEN`.
3. `docs/deployment.md:32` gives the 1Password item title and field but not a full `op://vibe_coding/<item>/<field>` reference, which `docs/1password.md` requires.
4. No test asserts the token name, the guard, or that the PATCH response is never printed.

## 4. Scope

In: workflow step order; the three inventories; the deployment doc reference; a source-contract test.
NOT in this plan: changing token scopes or rotating any token; `publish-sandbox.yml` (uses only `COOLIFY_TOKEN` for deploy, no pin); the `Deploy via Coolify` step's `echo "Response: $body"` (deploy-trigger response, not application config — note it in the PR as a possible follow-up only if it is found to contain config); the live-version check step.

## 5. Current state

- `publish-frontend.yml:104-115` build+push (tags `:latest`, `sha_tag`, `sha-<full>`, commit). `:117-145` pin step: env `COOLIFY_TOKEN: ${{ secrets.COOLIFY_WRITE_TOKEN }}`, guard, PATCH, status-only reporting, fail-closed on non-200. `:147-169` deploy step. `:171+` verify production.
- Secret present (STATUS row 0). 1Password item title (from `docs/deployment.md:32`): **Coolify API token - PopDAM frontend immutable image pin (resource scoped)**, field `COOLIFY_WRITE_TOKEN`, vault `vibe_coding`.
- Existing workflow contract-test precedent: `scripts/db-data-admin/check-data-admin-launch-readiness.test.mjs:178` reads a workflow file and asserts on its text; `scripts/windows-agent/tests/task-parity.test.mjs`. CI runs `node --test …` list at `.github/workflows/ci.yml:80`.

## 6. Key findings

- Secrets cannot be read in an `if:` at job level safely, but a dedicated early step with `env: PIN_TOKEN: ${{ secrets.COOLIFY_WRITE_TOKEN }}` and `[ -n "$PIN_TOKEN" ] || exit 1` placed before `Log in to GHCR` works and costs nothing.
- Keep the second check inside the pin step too (defence in depth; harmless).
- The item title contains spaces and parentheses; `op://` references accept the title as-is, or the item ID. Prefer the item ID if it can be read (`op item get "<title>" --vault vibe_coding --format json` → `id`), else the exact title. Never write the value.

## 7. Approaches rejected

- Pushing only SHA tags first and `:latest` after the pin: bigger change to tagging, other consumers of `:latest` (rollback docs) would shift. The early guard solves the finding.
- Making the guard a required check elsewhere: lean-checks ruling (2026-10-30) — only data-damage/secret-leak checks may block merges; this is a publish-time guard, not a merge gate.

## 8. Design decisions

Locked (2026-11-25): early guard step before any GHCR login/build; existing in-step guard kept; inventories list `COOLIFY_WRITE_TOKEN` with purpose "Pin Coolify to the immutable image tag (PATCH, scoped to the PopDAM frontend app)"; deployment doc gets the full `op://` reference; contract test in `scripts/frontend-publish/publish-frontend-contract.test.mjs` run from `ci.yml:80`'s list.
Open: item ID vs title in the reference (prefer ID if retrievable).

## 9. The plan

**Step 1 — Early guard (lead-only: protected workflow, production publishing).**
In `publish-frontend.yml`, insert before `Log in to GHCR` (~`:91`):
```yaml
      - name: Require the image-pin credential before publishing
        env:
          PIN_TOKEN: ${{ secrets.COOLIFY_WRITE_TOKEN }}
        run: |
          if [ -z "${PIN_TOKEN}" ]; then
            echo "Missing dedicated PopDAM image-pin credential (COOLIFY_WRITE_TOKEN); nothing was published."
            exit 1
          fi
```
Gate: the next publish run on `main` shows this step green before `Build and push image to GHCR` (run log step order).

**Step 2 — Inventories (helper-ok: doc rows).**
Add a `COOLIFY_WRITE_TOKEN` row next to `COOLIFY_TOKEN` in: `docs/configuration.md` frontend secrets table (~`:54`), `SELFHOST.md` secrets table (~`:88`, and mention the pin in the step list around `:82`), `docs/agents-reference.md` credentials table (~`:339`, columns as neighbours: `CI → Coolify image pin (PATCH)` | `GitHub secret` | `No` | `Yes`). Gate: `grep -n COOLIFY_WRITE_TOKEN docs/configuration.md SELFHOST.md docs/agents-reference.md` shows three hits.
Stop-and-ask: if a table's columns do not fit the row, bring it back.

**Step 3 — Reference (lead-only: needs 1Password read of the item ID, never the value).**
`docs/deployment.md:32`: add "1Password reference: `op://vibe_coding/<item ID or exact title>/COOLIFY_WRITE_TOKEN`." Gate: `op read` of that reference succeeds locally (output discarded, do not print) — run via the 1Password `op_run` tool so nothing reaches the transcript.

**Step 4 — Contract test (helper-ok).**
New `scripts/frontend-publish/publish-frontend-contract.test.mjs` (node:test) reading `.github/workflows/publish-frontend.yml` as text and asserting: (a) a step named `Require the image-pin credential before publishing` appears **before** `Build and push image to GHCR`; (b) the pin step's env maps `secrets.COOLIFY_WRITE_TOKEN`, and the deploy step maps `secrets.COOLIFY_TOKEN`; (c) the pin step contains `exit 1` for an empty token; (d) the pin step's script does not `echo` `$body` or `$response`. Add the file to the `node --test` list at `.github/workflows/ci.yml:80`.
Gate: `node --test scripts/frontend-publish/publish-frontend-contract.test.mjs` passes, and fails if you move the guard below the push locally (try it, then revert).
Stop-and-ask: if the YAML must be parsed rather than text-matched to be reliable, bring it back (no new dependency without the lead).

**Step 5 — PR (lead-only).** One PR; CI green; merge (workflow change triggers a publish on merge). Watch that run with the repo's bounded waiter (`bin/ai-pr-wait` if present in this checkout, else `gh run watch`) in the background.

**Step 6 — Live proof (lead-only).** The post-merge `publish-frontend.yml` run succeeds with the new step first; production serves the merge SHA (the workflow's verify step). Post run link on #812, close.

## 10. Tests required

New: `scripts/frontend-publish/publish-frontend-contract.test.mjs` (four assertions above). Must stay green: full `ci.yml` (lint, typecheck, tests, build) and the post-merge publish run.

## 11. Constraints and gotchas

Never print any token or the PATCH response. Never widen `COOLIFY_TOKEN` or substitute an admin token. Workflow files are protected: change by PR only. Lean required checks: do not make the new test a required check unless it guards a secret leak (assertion (d) does; leave the required-check list as is unless the owner rules otherwise). Quote times in EST.

## 12. Access and environment

`gh` as `u2giants` (secrets list, runs). 1Password vault `vibe_coding`, item **Coolify API token - PopDAM frontend immutable image pin (resource scoped)** — read only the item ID, via `op_run`/`op item get … --fields id`. No local server needed.

## 13. Definition of done, risks, open questions

Done: four fixes merged, CI green, post-merge publish run green with the guard first, production on the merge SHA, #812 closed with the run link.
Risks: a typo in the new step fails publishing → production stays on the previous image (safe). Rollback: revert the PR.
Open: none for the owner.

## Self-audit (2026-11-25)

1. Executable without asking? Yes — §2 explains Coolify pin vs deploy, §5/§9 give exact lines and YAML.
2. Background and rejected options? Yes — §3 confirmed findings, §6 mechanics, §7 rejected alternatives, STATUS row 0 records the secret check.
3. Goal clear? Yes — §1: never half-publish, credential findable, rules tested.
Checklist passes (13 sections, marks + triggers, named test, secrets by location, handoff links).

## Lead launch prompt

```text
You are the lead implementing u2giants/popdam3#812. Read AGENTS.md, then docs/plans/issue-812-frontend-image-pin-credential.md (STATUS first). Fresh worktree, feature branch from origin/main.
You do steps 1, 3, 5, 6. Hand steps 2 and 4 to your helper. Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker; no design decisions; no merges or posts; bring stop-and-ask triggers to you; taken back after 30 minutes stuck.
Run the contract test (including the negative check), CI, and the post-merge publish run yourself. Never print a token. Update STATUS; sign GitHub posts.
```
