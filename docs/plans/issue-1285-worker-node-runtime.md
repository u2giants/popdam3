---
summary: Issue #1285 plan: keep the worker's Meta connection correct on the newer Node runtime and test worker and bridge agent on the Node they ship with. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #1285, changing the worker or bridge-agent Node version, undici, or CI Node versions
---

# Plan: Worker and bridge agent on their shipped Node version — undici pairing and CI coverage (u2giants/popdam3#1285)

Handoff registration: [HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md](../../HANDOFF.d/2026-11-25T2057Z-al8960ofc-claude-deploy-ci-docs-plans.md)

## STATUS

| Step | State | Evidence |
|---|---|---|
| 1 Pair `fetch` with the undici `Agent` | ⬜ open | — |
| 2 Run worker + bridge tests on the shipped Node | ⬜ open | — |
| 3 Lift the root CI job off Node 20 | ⬜ open | — |
| 4 Live proof: Meta models still discovered | ⬜ open | — |

Fresh session starts at step 1 (planned 2026-11-25, nothing implemented).

## 1. Ultimate goal

The cloud worker must keep reaching Meta's AI models after its runtime upgrade, and the
automatic checks must test the worker and the NAS bridge agent on the same Node version
they actually run in production, so a runtime incompatibility is caught before it ships
instead of breaking AI tagging silently.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`, branch `main`) is POP Creations' internal Digital Asset Manager.
The **cloud worker** (`apps/worker/`, hosted on Railway, deployed automatically for pushes
touching `/apps/worker/**`) runs bulk jobs including AI tagging, and talks to Meta's Model API
for some models. The **bridge agent** (`apps/bridge-agent/`) runs in Docker on the Synology NAS
and scans files; it ships via `publish-bridge-agent.yml` with a version bump. CI is
`.github/workflows/ci.yml` (single job `lint-test-build`).

## 3. What triggered this work

PR #1283 ("move bridge agent and worker to Node 24", merged 2026-11-23, head `f89859cb`) got
an advisory review that opened #1285: (1) the worker pins `undici` 6.29.0 and passes its
`Agent` as `dispatcher` into Node's **built-in** `fetch`, which on the new Node comes from a
newer undici major — mixing majors crosses a dispatcher interface boundary and risks breaking
Meta requests; (2) `ci.yml` still runs worker and bridge-agent tests on Node 20, so nothing
tests them on the shipped runtime. The fixer deferred it to the owner.

## 4. Scope

In: `apps/worker/src/meta-model-api.ts`, `apps/worker/src/meta-connection.ts`,
`apps/worker/package.json` (undici), `.github/workflows/ci.yml`, and live proof.

NOT in this plan: Windows agent or Helper Node versions (`publish-windows-agent.yml`,
`publish-popdam-helper.yml` stay on Node 20 — their runtimes are separate); Railway config
(`docs/plans/issue-791-1287-worker-railway-config.md`); any other Meta API behaviour.

## 5. Current state (origin/main `787c20b8`, 2026-11-25)

- `apps/worker/Dockerfile:5,39` and `apps/bridge-agent/Dockerfile:8,59` use
  `node:26.13.1-bookworm-slim` (the PR titled "Node 24" ended on 26.13.1).
  `publish-bridge-agent.yml:51` tests on `26.13.1`.
- `apps/worker/package.json:16` — `"undici": "6.29.0"`.
- `apps/worker/src/meta-connection.ts:2` imports `Agent` from `undici`; `:17` exports
  `metaDispatcher`. `apps/worker/src/meta-model-api.ts:4` imports it; `:326`, `:408`, `:454`
  pass `dispatcher: metaDispatcher` to the **global** `fetch`.
- `apps/worker/src/meta-connection.test.ts` exists (node:test, IPv6 local server).
- `.github/workflows/ci.yml:32` — `node-version: 20` for the whole `lint-test-build` job,
  which runs root lint/typecheck/test, windows-agent tests, bridge-agent pretest, worker
  build and worker tests.
- Frontend publish uses Node 24 (`publish-frontend.yml:45,78`). Root `package.json` has
  `railway@^3.17.0` which needs Node ≥ 22.

## 6. Key findings and root cause

- The global `fetch` uses Node's bundled undici; an external undici `Agent` from a different
  major is not guaranteed compatible. Importing `fetch` from the same `undici` package as the
  `Agent` removes the dependency on Node's bundled version entirely.
- CI coverage gap root cause: #1283 updated only `publish-bridge-agent.yml`, not `ci.yml`.

## 7. Approaches rejected

- **Only bump `undici` to the bundled major** — rejected as sole fix: it re-breaks on every
  Node upgrade. (May be done in addition if the package's own `fetch` needs it.)
- **Revert the runtime to Node 20** — rejected: #1283's runtime move is the owner-intended
  direction and Node 20 is end-of-life.
- **Drop the custom dispatcher** — rejected: IPv6-first lookup is how Meta discovery works
  (`docs/deployment.md:243`).
- **Move all of `ci.yml` to 26.13.1** — rejected: frontend ships on Node 24; root tests should
  match that.

## 8. Design decisions

- LOCKED: Meta requests use `fetch` imported from `undici`, paired with the `undici` `Agent`.
- LOCKED: worker and bridge-agent tests run in CI on the exact Node of their Dockerfiles.
- OPEN: whether to also upgrade `undici` from 6.29.0 (decide by whether the package's own
  `fetch` + `Agent` work on Node 26.13.1 in tests; prefer the smallest change that passes).
- OPEN: whether the new CI job is a separate job or a second `setup-node` inside the existing
  job. Keep the existing job name `lint-test-build` unchanged so required-check settings do
  not break; the new job must not be added to required checks (owner ruling 2026-10-30).

## 9. Steps

1. **Pair fetch with the Agent** — `lead-only` (changes production network path).
   In `apps/worker/src/meta-model-api.ts` import `{ fetch as undiciFetch }` from `undici` and
   use it at the three call sites (`:326`, `:408`, `:454`) that pass `metaDispatcher`; keep
   types compatible (undici `fetch` returns undici `Response`; adjust `.json()`/`.text()` usage
   only if typecheck complains). Add a test in `apps/worker/src/meta-connection.test.ts`
   (or new `meta-model-api-dispatcher.test.ts`) that runs a real request through
   `undiciFetch` + `createMetaDispatcher()` against a local server.
   You'll know it worked when: `npm run build --prefix apps/worker` and
   `npm test --prefix apps/worker` pass on Node 26.13.1.
2. **Shipped-Node CI job** — `helper-ok` (exact YAML below).
   Add job `agents-on-shipped-node` to `.github/workflows/ci.yml`: checkout, `setup-node`
   `26.13.1` (same pinned action SHA as the existing job), `npm ci --prefix apps/bridge-agent`,
   `npm run pretest --prefix apps/bridge-agent`, `npm test --prefix apps/bridge-agent`,
   `npm ci --prefix apps/worker`, `npm run build --prefix apps/worker`,
   `npm test --prefix apps/worker`. Add a comment: "Must match apps/worker/Dockerfile and
   apps/bridge-agent/Dockerfile node tags."
   Stop-and-ask: tests fail on 26.13.1 for a reason other than step 1.
   You'll know it worked when: the job shows green on the PR.
3. **Root job off Node 20** — `helper-ok`.
   Change `ci.yml:32` to `node-version: 24`. Stop-and-ask: any windows-agent or root test
   fails only on 24.
   You'll know it worked when: `lint-test-build` is green on the PR and `npm ci` prints no
   engine warning for `railway`.
4. **Live proof** — `lead-only`.
   After merge, confirm Railway deployed the merge SHA (Railway MCP `list-deployments`), then
   confirm Meta model discovery returns models (worker logs or the Settings AI-model catalog
   on `https://dam.designflow.app`). You'll know it worked when: deployment id + SHA and a
   dated observation of Meta models are recorded in STATUS row 4 and on #1285.

Order: 1 → 2 → 3 (2 and 3 can share the PR) → 4.

## 10. Tests required

- New: dispatcher pairing test ("Meta dispatcher works with undici fetch over IPv6-first lookup").
- Existing must stay green: `npm test --prefix apps/worker`, `npm test --prefix apps/bridge-agent`,
  `npm run lint`, `npm run typecheck`, `npm run test`.

## 11. Constraints and gotchas

- Feature branch + PR; AI merges after required checks; reviews advisory; only safety checks
  may block a merge; no wait over 30 minutes; never ask Albert to approve.
- A worker merge auto-deploys to production Railway — run worker tests locally first.
- Bridge agent changes need a `apps/bridge-agent/package.json` version bump to ship; this plan
  changes no bridge source, so no bump.
- Secrets (Meta key, Railway token) in 1Password `vibe_coding`; never print.

## 12. Access and environment

`gh` as `u2giants`; Railway MCP or CLI; Node 26.13.1 locally (e.g. `npx -y node@26.13.1`) for
step 1 checks. App URL `https://dam.designflow.app` (Google sign-in as Albert's account in the
browser).

## 13. Definition of done, risks, open questions

Done: steps 1-4 cite artifacts; PR merged green; Railway on the merge SHA; Meta models observed;
#1285 closed with evidence. Risk: undici `fetch` response type differences — caught by typecheck
and tests; rollback = revert PR (auto-redeploys worker). Open: undici upgrade (see §8).

## Self-audit

1. Executable without questions? Yes — §5 exact lines, §9 exact edits and gates.
2. Background and rejected paths? Yes — §3, §6, §7.
3. Goal steers judgment? Yes — §1: Meta still reachable + tests on shipped Node.

## Lead launch prompt

```
Read docs/plans/issue-1285-worker-node-runtime.md in u2giants/popdam3 (STATUS first) and AGENTS.md.
You are the lead: do steps 1 and 4 yourself; hand steps 2 then 3 to your helper.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol,
GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helper rules: finished work or an evidenced blocker only; no design decisions; no merges, pushes or
posts; bring stop-and-ask triggers to you; take the step back after 30 minutes stuck.
Verify each gate yourself, open one PR, merge when required checks pass (reviews are advisory),
do the live proof, update STATUS, close #1285 with evidence.
```
