---
summary: Issues #802 and #949 plan: finish deploy proof for the production frontend and bring the sandbox site to the same build, pin and live-version standard, with truthful docs. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #802 or #949, or changing publish-frontend.yml, publish-sandbox.yml, nginx.conf version.json, or frontend deploy docs
---

# Plan: Frontend and sandbox deploy proof (u2giants/popdam3#802, #949)

Handoff registration: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md)

Two review-finding issues on the same pair of workflows, planned together:
**#802** (review of merged PR #801 "deploy: prove the live version after every deploy") and
**#949** (review of merged PR #948 "Sandbox site on the preview database").

## STATUS

| Step | State | Evidence |
|---|---|---|
| 1 Security headers on `/version.json` | ⬜ open | — |
| 2 `publish-frontend.yml` paths include its scripts | ⬜ open | — |
| 3 Frontend deploy docs say "pinned sha tag" | ⬜ open | — |
| 4 Sandbox build stamp | ⬜ open | — |
| 5 Sandbox credential checks | ⬜ open | — |
| 6 Sandbox trigger paths match production | ⬜ open | — |
| 7 Sandbox lint/script gate | ⬜ open | — |
| 8 Sandbox immutable pin + live-version check | ⬜ open | — |
| 9 "No staging" docs scoped | ⬜ open | — |
| 10 Live proof on both sites | ⬜ open | — |

Fresh session starts at step 1 (planned 2026-11-25; nothing implemented). Stale automatic
branch `review-fix/802` (tip `566c22cd`, PR #803 closed unmerged) exists — read it for ideas,
do not merge it; delete it once this plan's PR merges.

## 1. Ultimate goal

Every time the web app is published — the real site `https://dam.designflow.app` (and
`https://sg.designflow.app`) or the test copy `https://dam-sandbox.designflow.app` — the
automatic pipeline must prove the site is now running exactly the code just merged, keep the
browser security protections on every page, and the written runbooks must match how deploys
really work so an emergency deploy follows instructions that actually work. The sandbox must
be a faithful rehearsal of production, just pointed at the test database.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`, branch `main`): React/Vite web app built by GitHub Actions into
Docker image `ghcr.io/u2giants/popdam-frontend` (nginx serving `dist/`, `Dockerfile.ci`,
`nginx.conf`), deployed by Coolify on the VPS (production app `qxj8a0j3tpa9lq4q5rs6pezy`;
sandbox app id in secret `COOLIFY_SANDBOX_APP_UUID`). Production workflow:
`.github/workflows/publish-frontend.yml`. Sandbox workflow:
`.github/workflows/publish-sandbox.yml` — same code built against the shared-db **preview**
Supabase project (never production `qsllyeztdwjgirsysgai`), showing an amber
"non-production database" banner; owner request 2026-11-11.

`vite.config.ts` emits `dist/version.json` = `{git_sha, commit, date}`; `getGitInfo()`
(`vite.config.ts:22-34`) uses `APP_COMMIT` **only when both `APP_COMMIT` and `APP_DATE` are
set**, else `git rev-parse --short HEAD`. `scripts/verify-live-version.sh --url … --expected
<sha> --attempts 60 --interval 10` polls the live `version.json` (≤10 minutes) and fails on
mismatch; `scripts/test-verify-live-version.sh` proves it.

## 3. What triggered this work

Advisory reviews (fixer could not fix — workflows are protected from the automatic fixer):

#802 findings (PR #801, head `c5c930cf`):
1. `nginx.conf:85-88` `location = /version.json` has its own `add_header`, so it drops the five
   server-level security headers (`nginx.conf:94-98`); every other such block repeats them (#236).
2. Docs still say Coolify pulls `:latest`, but the workflow pins Coolify to `sha-<full sha>`;
   the GHCR-outage runbook (build locally as `:latest`, recreate) no longer deploys the built image.
3. `publish-frontend.yml:7-20` `paths:` lacks `scripts/verify-live-version.sh` and
   `scripts/test-verify-live-version.sh`, so a change to the check itself triggers no run.

#949 findings (PR #948, head `2dfd96f3`):
1. Build stamp: `APP_COMMIT: sandbox-${{ github.sha }}` without `APP_DATE` is ignored → sandbox
   header and `version.json.commit` look like production.
2. Only `SANDBOX_SUPABASE_URL` is checked; a missing anon key or one equal to production's
   publishable key is not, so CI can deploy an unbootable or production-pointed bundle
   (`src/lib/app-mode.ts:59-63` throws on half config).
3. Sandbox `paths:` omit `tailwind.config.ts`, `postcss.config.js`, `tsconfig*.json`,
   `Dockerfile` that trigger production.
4. Sandbox pushes mutable `:sandbox` and triggers Coolify with no immutable pin and no live-version poll.
5. Sandbox has no lint / live-check-script gate like production's `verify` job.
6. `docs/deployment.md` keeps "There is no staging environment" while describing the sandbox.

## 4. Scope

In: `nginx.conf`, `.github/workflows/publish-frontend.yml` (paths only),
`.github/workflows/publish-sandbox.yml`, `docs/deployment.md`, `docs/agents-reference.md`,
`SELFHOST.md`, live proof on production and sandbox.

NOT in this plan: changing the sandbox's database or auto-login, the `dam-search-ai` preview
deploy step, Coolify host configuration, GHCR permissions, making any of these checks
required for merging.

## 5. Current state (origin/main `787c20b8`, 2026-11-25)

- `nginx.conf:85-88`: `location = /version.json { add_header Cache-Control "no-store"; try_files $uri =404; }` — no security headers. Pattern to copy: `nginx.conf:76-81`.
- `publish-frontend.yml`: paths `:7-20`; `verify` job `:37-52` (lint + `test-verify-live-version.sh`);
  `build-and-push` main-only `:57`; pushes `:latest`, `:sha-<short>`, `:<short>`, `:sha-<full>`
  (`:113`); pins Coolify via PATCH `docker_registry_image_tag` = `sha-${{ github.sha }}`
  using `secrets.COOLIFY_WRITE_TOKEN` (`:117-145`); deploy `:147-169`; verify live `:171-176`.
- `publish-sandbox.yml`: paths `:13-24` (has `supabase/functions/dam-search-ai/**` and
  `_shared/**` which production lacks — keep them); production-target refusal `:47-53`
  (URL only); search-function deploy `:58-75`; build `:76-84` with `APP_COMMIT: sandbox-${{ github.sha }}`,
  `APP_COMMIT_FULL`, no `APP_DATE`; pushes `:sandbox` and `:sandbox-<full sha>`; Coolify deploy
  `:97-105` with `secrets.COOLIFY_TOKEN`, no pin, no live check.
- Docs claiming `:latest` is what Coolify pulls: `docs/deployment.md:16-17, 41, 77, 109, 128,
  137-138, 151, 166, 180`; `docs/agents-reference.md:226, 245`; `SELFHOST.md:47, 54, 56, 80`.
- "No staging" claims: `docs/deployment.md:204, 235, 347`.

## 6. Key findings and root cause

- nginx: any `add_header` in a `location` cancels inheritance of server-level `add_header`
  (known issue #236) — the new block was written without the repeat.
- #801 changed the deploy contract (immutable pin) but touched no docs.
- #948 copied part of production's workflow; the `APP_DATE` coupling in `vite.config.ts` is
  non-obvious, so the prefix silently vanished.

## 7. Approaches rejected

- **Make the sandbox reuse `publish-frontend.yml` via `workflow_call`** — rejected for now:
  sandbox has extra preview-project steps and different secrets; a shared reusable workflow is
  a larger refactor. Copy the production steps instead.
- **Drop the immutable pin and go back to `:latest`** — rejected: the pin is what makes
  rollback and live-version proof exact (#801).
- **Use `include /etc/nginx/security-headers.conf` snippet** — acceptable alternative but
  rejected for this change to keep the file's existing repeat-the-headers pattern; open to the
  implementer only if they convert every block in one go.
- **Make the sandbox deploy block merges** — rejected: owner ruling 2026-10-30 (only
  production-data/secret-leak checks may block).

## 8. Design decisions

- LOCKED: production pin tag format `sha-<full sha>`; sandbox pin tag `sandbox-<full sha>`
  (already pushed by the workflow).
- LOCKED: sandbox build stamp `APP_COMMIT=sandbox-<short sha>`, `APP_DATE=<commit ISO date>`,
  `APP_COMMIT_FULL=<full sha>`; the sandbox header must visibly differ from production.
- LOCKED: the sandbox refuses to build when the anon key is empty, or equals the production
  publishable key (read production's from repository variable/secret already used by
  `publish-frontend.yml`'s build — the implementer finds the name in the "Build" step; if the
  production key is not available to the workflow, compare against a hard check that the key's
  JWT `ref` claim / project ref is not `qsllyeztdwjgirsysgai`).
- OPEN: whether the sandbox pin uses `COOLIFY_WRITE_TOKEN` (production's image-pin credential)
  — verify it can PATCH the sandbox app; if it cannot, the step fails closed and the lead
  stores a sandbox-scoped write token in 1Password `vibe_coding` + GitHub secret.
- OPEN: break-glass runbook wording — must say: build locally, tag
  `ghcr.io/u2giants/popdam-frontend:sha-<full sha>` (or set Coolify's image tag to the locally
  built tag), recreate, verify `version.json`.

## 9. Steps

1. **Headers on `/version.json`** — `helper-ok`. Add the five `add_header … always;` lines
   plus the `#236` comment from `nginx.conf:76-81` into the `/version.json` block.
   Stop-and-ask: nginx syntax test fails. Gate: `docker run --rm -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t`
   passes (adjust mount path to match `Dockerfile.ci`), and after deploy
   `curl -sI https://dam.designflow.app/version.json` shows `X-Frame-Options` and `Strict-Transport-Security`.
2. **Production paths** — `helper-ok`. Add `"scripts/verify-live-version.sh"` and
   `"scripts/test-verify-live-version.sh"` to `publish-frontend.yml` `paths:`.
   Gate: YAML parses (`npx -y js-yaml .github/workflows/publish-frontend.yml > /dev/null`).
3. **Production docs** — `helper-ok`. At every line in §5's `:latest` list, state that CI pushes
   `:latest`, `:sha-<short>`, `:<short>` and `:sha-<full>` and **Coolify is pinned to
   `:sha-<full>`**; rewrite the GHCR-outage runbook (`deployment.md:128`) per §8 OPEN.
   Stop-and-ask: a line whose meaning is unclear. Gate: `grep -rn "pulls \`:latest\`\|pull.*:latest" docs SELFHOST.md`
   finds no claim that Coolify pulls `:latest`.
4. **Sandbox stamp** — `lead-only` (must read `vite.config.ts` `resolveFullHash` to be sure
   `git_sha` stays the full sha). Add a "Capture git metadata" step like production's and set
   `APP_COMMIT: sandbox-${{ steps.meta.outputs.commit }}`, `APP_DATE: ${{ steps.meta.outputs.date }}`,
   `APP_COMMIT_FULL: ${{ github.sha }}`. Gate: a local `APP_COMMIT=sandbox-abc1234 APP_DATE=2026-11-25T00:00:00Z APP_COMMIT_FULL=<sha> npm run build`
   produces `dist/version.json` with `commit` `sandbox-abc1234` and `git_sha` the full sha.
5. **Sandbox credential checks** — `lead-only` (safety check). Extend "Refuse a production
   target" (`:47-53`) to also take `KEY: ${{ vars.SANDBOX_SUPABASE_ANON_KEY }}` and fail when
   empty or production's (per §8). Gate: run the step's script locally with empty key → exit 1;
   with production URL → exit 1; with preview values → exit 0.
6. **Sandbox paths** — `helper-ok`. Add `tailwind.config.ts`, `postcss.config.js`,
   `tsconfig*.json`, `Dockerfile`, `supabase/functions/_shared/operation-policy.js` and `.d.ts`
   (already covered by `_shared/**` — leave), and the two `scripts/*verify-live-version.sh` files.
   Gate: every entry of production's `paths:` is present in the sandbox's.
7. **Sandbox gate** — `helper-ok`. Before the Supabase steps add `npm run lint` and
   `bash scripts/test-verify-live-version.sh`. Gate: workflow run shows both steps green.
8. **Sandbox pin + live check** — `lead-only`. Before "Deploy via Coolify" add a pin step like
   `publish-frontend.yml:117-145` with `IMAGE_TAG: sandbox-${{ github.sha }}` and app
   `COOLIFY_SANDBOX_APP_UUID`; after deploy add `bash scripts/verify-live-version.sh --url
   https://dam-sandbox.designflow.app/version.json --expected "${GITHUB_SHA}" --attempts 60 --interval 10`.
   Gate: a `workflow_dispatch` run on `main` after merge passes the live check.
9. **"No staging" docs** — `helper-ok`. Change `deployment.md:204, 235, 347` to: "There is no
   staging-to-production promotion. The sandbox (`dam-sandbox.designflow.app`, preview
   database) is built from the same `main` commit for testing only." Gate: grep for
   "no staging" finds only the scoped wording.
10. **Live proof** — `lead-only`. After merge: production run green with
   `curl -s https://dam.designflow.app/version.json` = merge sha and headers present;
   sandbox run green, `curl -s https://dam-sandbox.designflow.app/version.json` `commit` starts
   `sandbox-`, sandbox page shows the amber banner (screenshot). Record run ids in STATUS and
   on both issues.

Order: 1-3 and 6, 7, 9 parallel (helper); 4, 5, 8 lead; one PR; then 10.

## 10. Tests required

- `bash scripts/test-verify-live-version.sh` stays green.
- New `src/test/publish-workflows-contract.test.ts` asserting by text: production `paths:`
  includes both scripts; every production path is in the sandbox `paths:`; sandbox build sets
  `APP_DATE`; sandbox has a pin step with `sandbox-${{ github.sha }}` and a
  `verify-live-version.sh` call for `dam-sandbox.designflow.app`; nginx `/version.json`
  block contains `X-Frame-Options`.
- `npm run lint`, `npm run typecheck`, `npm run test` green.

## 11. Constraints and gotchas

- Branch + PR; AI merges after required checks; reviews advisory; new checks advisory only;
  no wait over 30 minutes (the live poll is 10 minutes); never ask Albert to approve.
- The sandbox must never build against production `qsllyeztdwjgirsysgai`.
- Workflow files are protected from the automatic fixer — that is why these are open; a normal
  session may edit them.
- Coolify tokens (`COOLIFY_TOKEN`, `COOLIFY_WRITE_TOKEN`) and GHCR PAT live in GitHub secrets
  and 1Password `vibe_coding`; never print. The PATCH response may contain config — print status only.

## 12. Access and environment

`gh` as `u2giants` (can dispatch workflows). Coolify API credentials in 1Password `vibe_coding`
(search "Coolify"). Browser: Albert's Chrome is signed in to the sites.

## 13. Definition of done, risks, open questions

Done: steps 1-10 cite artifacts; PR merged green; both live checks pass; `review-fix/802`
deleted; #802 and #949 closed with evidence. Risks: pin PATCH on the sandbox app fails (fails
closed; fix token per §8); nginx typo breaks the site (gate 1 `nginx -t` before merge; rollback =
redeploy previous `sha-` tag in Coolify). Open: §8 OPEN items.

## Self-audit

1. Executable without questions? Yes — §5 lines, §8 locked choices, §9 gates.
2. Background and rejected paths? Yes — §3, §6, §7.
3. Goal steers? Yes — §1 (prove the running code, keep headers, truthful runbooks, faithful sandbox).

## Lead launch prompt

```
Read docs/plans/issue-802-949-frontend-and-sandbox-deploy-proof.md in u2giants/popdam3 (STATUS first) and AGENTS.md.
You are the lead: do steps 4, 5, 8 and 10 yourself; hand 1, 2, 3, 6, 7, 9 to your helper.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol,
GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker only; no design decisions; no merges, pushes or
posts; bring stop-and-ask triggers to you; take a step back after 30 minutes stuck.
Verify every gate, open one PR, merge when required checks pass (reviews advisory), do live proof,
delete review-fix/802, update STATUS, close #802 and #949 with evidence.
```
