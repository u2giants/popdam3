---
summary: Issues #791 and #1287 plan: make the Railway worker's deploy configuration true in docs, gated, validated and live-proven. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #791 or #1287, or changing how the Railway worker deploys (.railway/railway.ts, watch patterns, IPv6)
---

# Plan: Railway worker deploy configuration — truthful docs, gates, validation, live proof (u2giants/popdam3#791, #1287)

Handoff registration: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md)

Covers two open review-finding issues, planned together because they describe one
configuration: **#791** (findings on merged PR #786, "watch only actual Railway build
inputs") and **#1287** (findings on merged PR #1286, "migrate worker Railway config to
Infrastructure as Code"). #1286 replaced the `apps/worker/railway.toml` that #786 edited,
so #791's TOML-specific findings now apply to `.railway/railway.ts`.

## STATUS

| Step | State | Evidence |
|---|---|---|
| 1 Read live Railway config | ⬜ open | — |
| 2 Rewrite stale deploy docs | ⬜ open | — |
| 3 Route `.railway/**` to deployment gates | ⬜ open | — |
| 4 Type-check + invariant test for `.railway/railway.ts` | ⬜ open | — |
| 5 Document the apply procedure | ⬜ open | — |
| 6 Live proof (worker-only + unrelated push) | ⬜ open | — |

Fresh session starts at step 1. Nothing is implemented yet (planned 2026-11-25).

## 1. Ultimate goal

The cloud worker (the always-on background program that runs bulk jobs such as AI tagging)
must redeploy exactly when its own code changes and never otherwise, keep the internet
setting (IPv6) that lets it reach Meta's AI models, and every document a person or AI reads
must describe that behaviour truthfully. Today the docs contradict each other and nobody has
proven the live Railway service actually uses the new configuration, so a future session
could "fix" a correct deploy, miss a broken one, or edit the config with no safety routing.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`, release branch `main`) is POP Creations' internal Digital Asset
Manager for licensed product art. Parts: React web app (`src/`, served by Coolify at
`https://dam.designflow.app`), Supabase edge functions, and the **cloud worker** in
`apps/worker/` — a Node.js process hosted on **Railway** (project `popdam`, service
`popdam3`, region `us-east4-eqdc4a`, 1 replica). Railway builds the worker from
`apps/worker/Dockerfile` whenever a push to `main` matches the watch pattern.

The Railway service configuration is now Railway "Infrastructure as Code" in
`.railway/railway.ts` (root of the repo), which is **only applied by an authenticated
`railway config apply`** — merging an edit does not apply it.

## 3. What triggered this work

Advisory AI reviews on two merged PRs opened review-finding issues; the automatic fixer
deferred both to the owner because it cannot edit deployed config or prove live behaviour.

- #791 (review of PR #786, head `105641a6`): (1) `docs/deployment.md` contradicts itself
  (watch-pattern paragraph vs "every push" paragraphs); (2) other docs and the quirks
  registry still say "every push"; (3) an unsupported "December 1, 2026 cutoff" claim;
  (4) the watch-pattern semantics were never proven live.
- #1287 (review of PR #1286, head `b29ea4f1`): (1) the IaC file was never applied or
  evidenced, and the TOML Railway read automatically was deleted; (2) `.railway/**` matches
  no task-gate rule, so edits fall to the light `prose` route; (3) nothing type-checks or
  tests the file (root CI runs Node 20; `railway@3.17.0` needs Node ≥ 22); (4) docs edited
  in that PR are wrong/stale.

## 4. Scope

In: the docs listed in §5, `.ai-devops/task-gates.json` + `scripts/test-task-gates.sh`,
a validation test for `.railway/railway.ts`, a documented apply/rollback procedure, and live
proof on Railway.

NOT in this plan: moving the worker to another host; changing the worker's Node version or
`undici` (that is #1285, `docs/plans/issue-1285-worker-node-runtime.md`); changing what the
worker does; Railway service variables/secrets; root CI's Node version for the whole suite
(#1285 owns that — this plan only needs a Node ≥ 22 step for its own check if required).

## 5. Current state of the code (origin/main `787c20b8`, 2026-11-25)

- `.railway/railway.ts` exists: service `popdam3`, `github("u2giants/popdam3", {branch:"main",
  checkSuites:false, rootDirectory:"/apps/worker"})`, `build: {builder:"DOCKERFILE",
  dockerfilePath:"Dockerfile", watchPatterns:["/apps/worker/**"]}`, `deploy:
  {ipv6EgressEnabled:true, restartPolicyType:"ON_FAILURE", restartPolicyMaxRetries:5}`,
  `replicas: {"us-east4-eqdc4a":1}`, project `popdam` with `variables: {managed:false}`.
- `apps/worker/railway.toml` no longer exists on main.
- `package.json:78` has `"railway": "^3.17.0"` (devDependency providing `railway/iac`).
- Docs that are **correct** now: `docs/deployment.md:21`, `docs/INFRASTRUCTURE.md:72`
  (except "includes … the Railway configuration", which is false — the file is outside
  `/apps/worker/**`), `docs/agents-reference.md:265`, `docs/deployment.md:243`.
- Docs that are **wrong** now:
  - `docs/deployment.md:21` and `docs/INFRASTRUCTURE.md:72` — "includes … Railway configuration".
  - `docs/deployment.md:23` — says TOML is legacy with a "December 1, 2026 cutoff" and asks
    for a migration (already done by #1286; the date was never sourced).
  - `docs/deployment.md:237` — "Railway auto-deploys on every push … does not support path filters".
  - `docs/deployment.md:323` — "rebuilds on every push — there is no path filter".
  - `docs/idiosyncrasies.md:160-164` — quirk "Railway worker deploys on every push to `main`".
  - `docs/architecture.md:51` and `:218` — "auto-deploys from every push to `main`".
  - `plan_ai_model_interaction_reliability.md:80`, `plan_hybrid_search_rollout.md:91` — same claim (plans; one-line fix).
- `.ai-devops/task-gates.json:138-139` routes `apps/worker/**` to `deployment`; no rule for
  `.railway/**`. `scripts/test-task-gates.sh` has `expect_class apps/worker/src/index.ts deployment` but nothing for `.railway/railway.ts`.
- `tsconfig.app.json:32` includes only `src`; `tsconfig.node.json:21` only `vite.config.ts`.
  `.github/workflows/ci.yml:32` uses Node 20.
- No live evidence anywhere that Railway's service matches the file.

## 6. Key findings and root cause

- Root cause of the doc drift: #786 changed deploy behaviour and updated one paragraph; the
  "every push" statements predate Railway watch patterns and were never revisited. #1286
  then moved the config without updating `deployment.md:23` or the "includes Railway
  configuration" sentences.
- Because `.railway/railway.ts` sits outside `/apps/worker/**`, editing it triggers **no**
  worker deploy — the change only lands through `railway config apply`. This is the
  important new fact the docs must carry.
- `managed: false` at project level means Railway IaC does not manage variables; the review
  asked to confirm that an apply preview plans no variable deletions (service secrets live
  as Railway service variables).

## 7. Approaches considered and rejected

- **Restore `apps/worker/railway.toml`** — rejected: #1286 deliberately moved to IaC; two
  sources of truth would drift. (Decision recorded in PR #1286.)
- **Delete the IPv6/watch config and rely on Railway dashboard defaults** — rejected: Meta
  model discovery only works over IPv6 (`docs/deployment.md:243`, proven 2026-10-11).
- **Auto-apply `.railway/railway.ts` from CI on merge** — rejected for this plan: needs a
  Railway token in CI and is a new deploy path; out of scope. Manual authenticated apply by
  the AI session (documented) is the route.
- **Keep the "December 1" sentence with a citation** — rejected: the migration is done, so
  the sentence is moot; remove it rather than source it.

## 8. Design decisions

- LOCKED (PR #1286, 2026-11-23): `.railway/railway.ts` is the single source of the worker's
  Railway config.
- LOCKED: watch pattern stays `["/apps/worker/**"]`; IPv6 egress stays on.
- LOCKED: `.railway/**` is deployment-class work (same as `apps/worker/**`).
- OPEN (implementer judgment): how to type-check the file — a dedicated
  `tsconfig.railway.json` + `npx tsc -p tsconfig.railway.json --noEmit`, or a Vitest test
  that imports the default export. Choose whichever runs in CI without changing root Node;
  if `railway/iac` refuses to load on Node 20, run that one step with `setup-node` 24 in a
  small separate job (advisory, not required).

## 9. Steps

1. **Read the live Railway config** — `lead-only` (live-proof judgment).
   Use the Railway MCP (`get-service-config` / `describe-service` for project `popdam`,
   service `popdam3`) or `railway config` preview from a checkout of `main`. Record: watch
   patterns, builder, dockerfile path, root dir, IPv6 egress, restart policy, region/replicas,
   and whether a `railway config apply` preview plans any change or **any variable deletion**.
   If the preview shows differences, apply from `main` (never from a branch) and record output.
   You'll know it worked when: a dated note in this plan's STATUS row 1 lists every field
   matching `.railway/railway.ts`, with the preview/apply output saved under
   `docs/verification/` (no secrets).
2. **Rewrite stale deploy docs** — `helper-ok` (exact lines given).
   Edit the lines in §5 "wrong now": remove "every push / no path filter" claims; say Railway
   rebuilds only for pushes touching `/apps/worker/**`; delete `deployment.md:23`'s TOML/December
   sentence and replace with "Config lives in `.railway/railway.ts`; edits there deploy
   nothing until applied — see Applying Railway configuration"; fix "includes … Railway
   configuration" in `deployment.md:21` and `INFRASTRUCTURE.md:72`; rewrite or delete the
   `docs/idiosyncrasies.md:160` quirk (replace with "Worker rebuilds only on `/apps/worker/**`
   pushes; `.railway/railway.ts` changes need an explicit apply"). Then run
   `ai-doc-health --repo . --fix-index`.
   Stop-and-ask: any other doc found that states deploy behaviour differently.
   You'll know it worked when: `grep -rn -i "every push\|no path filter\|December 1" docs *.md
   --include=*.md | grep -v archive | grep -iv "functions"` returns no worker-deploy claims.
3. **Route `.railway/**` to deployment gates** — `helper-ok`.
   Add `{ "glob": ".railway/**", "class": "deployment" }` next to the `apps/worker/**` rule in
   `.ai-devops/task-gates.json` (~line 138) and `expect_class .railway/railway.ts deployment
   'Railway IaC is protected deployment work'` in `scripts/test-task-gates.sh` near the
   worker line. Stop-and-ask: the test script fails for any other reason.
   You'll know it worked when: `bash scripts/test-task-gates.sh` passes.
4. **Validate `.railway/railway.ts` in CI** — `lead-only` (choice in §8 OPEN).
   Add `src/test/railway-iac-config.test.ts` (or a `scripts/tests/` equivalent) that asserts,
   by reading the file text or importing it: branch `main`, `rootDirectory` `/apps/worker`,
   `watchPatterns` exactly `["/apps/worker/**"]`, `ipv6EgressEnabled: true`, builder
   `DOCKERFILE`, `dockerfilePath` `Dockerfile`. Add a type check (see §8). The check must be
   advisory — not added to required checks (owner ruling 2026-10-30).
   You'll know it worked when: the test passes locally (`npx vitest run src/test/railway-iac-config.test.ts`)
   and fails if you temporarily change the watch pattern.
5. **Document the apply procedure** — `helper-ok` (text below).
   Add a "Applying Railway configuration" subsection to `docs/deployment.md` worker section:
   who applies (the AI session that merged the change), when (right after merge, from
   `main`), preview first (`railway config` preview / MCP staged changes), confirm no variable
   deletions, apply, verify with step 1's read, rollback = revert the commit on a branch +
   PR, merge, re-apply. Never wait more than 30 minutes for anything in this procedure.
   You'll know it worked when: the subsection exists and step 2's docs link to it.
6. **Live proof** — `lead-only`.
   After the PR for steps 2-5 merges (it touches no `apps/worker/**`), confirm in Railway
   deployments that **no** worker deploy started for that merge commit. Then find (or wait for
   another session's) next merged commit touching `apps/worker/**` and confirm Railway built
   that exact SHA and the service is healthy, and Meta model discovery still works (worker log
   or Settings → AI models shows Meta models). Do not create a dummy worker commit just for
   proof unless none lands within the session; if you must, use a comment-only change in
   `apps/worker/README.md`.
   You'll know it worked when: two deployment records (one absent, one present) are cited
   by Railway deployment id + SHA in STATUS row 6 and on both issues.

Steps 2, 3, 5 can run in parallel; 4 after 3; 6 last. One PR for 2-5.

## 10. Tests required

- New: `src/test/railway-iac-config.test.ts` — "pins worker watch pattern to /apps/worker/**",
  "keeps IPv6 egress on", "builds from apps/worker Dockerfile on main".
- Extended: `scripts/test-task-gates.sh` — `.railway/railway.ts` → deployment.
- Must stay green: `npm run lint`, `npm run typecheck`, `npm run test`, `bash scripts/test-task-gates.sh`.

## 11. Constraints and gotchas

- Feature branch + PR to protected `main`; the AI merges once required checks pass; reviews
  are advisory and never waited on (owner rulings 2026-10-29). Only checks that stop
  production-data damage or secret leaks may be required (2026-10-30) — keep new checks advisory.
- No wait, hold or retry longer than 30 minutes.
- Never hand Albert a step; never ask him to approve.
- `railway config apply` is a production change: run it only from `main`, after a preview, and
  never with planned variable deletions.
- Railway tokens live in 1Password `vibe_coding`; never print them.
- Docs: every new Markdown file needs the four-key header; regenerate `docs/INDEX.md`.

## 12. Access and environment

- `gh` authenticated as `u2giants`. Railway MCP (`mcp__railway__*`) or Railway CLI logged in;
  Railway token item in 1Password vault `vibe_coding` (search "Railway").
- Local: `npm ci` at repo root; tests via `npx vitest run`.

## 13. Definition of done, risks, open questions

Done when: steps 1-6 rows cite artifacts; PR merged with checks green; live proof recorded on
#791 and #1287; both issues closed with evidence comments signed with the GitHub signature.
Risks: an apply with wrong values stops worker deploys (rollback: re-apply previous file);
an apply deleting variables would break the worker — preview blocks this. Open: whether
`railway/iac` loads on Node 20 (decide in step 4).

## Self-audit

1. Fresh session executes without questions? Yes — §5 lists every wrong line, §9 gives exact
   edits and gates, §12 access.
2. Carries background and rejected paths? Yes — §3, §6, §7.
3. Goal clear enough to steer? Yes — §1 states the deploy-exactly-when-needed + truthful-docs goal.

## Lead launch prompt

```
Read docs/plans/issue-791-1287-worker-railway-config.md in u2giants/popdam3 (STATUS first) and AGENTS.md.
You are the lead. Do steps 1, 4 and 6 yourself. Hand steps 2, 3 and 5 to your helper in that order.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol,
GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges, pushes
or GitHub posts; bring stop-and-ask triggers to you; if stuck 30 minutes, take the step back.
You verify every helper step against its gate, open one PR, merge it when required checks pass
(reviews are advisory), run the live proof, update STATUS, and close #791 and #1287 with evidence.
```
