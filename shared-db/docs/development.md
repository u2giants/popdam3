# Development

How to work in this repository on a machine with git, Node.js, and (optionally)
Python 3. There is no `package.json` and no application server to run.

## Prerequisites

| Tool | Used for |
|---|---|
| `git` + `gh` | worktrees, PRs, issues |
| Node.js (LTS) | `scripts/*.mjs`, `tools/*.mjs`, `node --test` |
| Python 3.10+ | `scripts/*.py` guards and tests (`python -m unittest` / `pytest` where present) |
| Supabase CLI | `supabase db push`, `supabase link`, dry-runs (see runbook) |
| `bash` or PowerShell | `scripts/check-sql.sh` (CI runs it in bash) |
| 1Password CLI `op` | credentials from vault `vibe_coding` (never commit secrets) |

`psql` is **not** required on Windows dev machines (use Node + `pg` via the
pooler — see [`docs/agents/runbooks-credentials-cli-and-gotchas.md`](agents/runbooks-credentials-cli-and-gotchas.md)).

## Worktree rule (mandatory)

Every write-capable task uses its **own** `git worktree` cut from `origin/main`
(AGENTS.md §2.1-W). The shared checkout is for reading and `git fetch` only.

```bash
git fetch origin main
git worktree add ../shared-db-wt-<topic> origin/main -b <you>/<topic>
```

Declare the task class first: `ai-task-gates start --class <class>`
(`prose`, `code`, `reviewer-safety`, or `shared-db` — see
`.ai-devops/task-gates.json`).

## What to run locally

### Catch failures before expensive review (#5033)

Run `node scripts/check-delivery-local.mjs --base <full-base-sha>` before paid
review or a full performance qualification. `--plan` prints its exact existing
CI guards without executing them. The offline run checks sidecars and pinned
detector baseline first, then the truth audit, native merge-coordination/workflow tests, the complete throughput guard
family, all four RLS families and the live-proof parser, and focused Python
catalogue/proof tests. It stops at the first failure, at 60 seconds per step or
180 seconds overall; it never retries, fetches, reviews, or accesses a database.
It requires the installed native source-identity helper and refuses changed
inputs. This early check does not replace the full CI matrix below.

Before a large physical performance run, use the existing harness's small
capability/cost smoke first. Prove its dependencies, target custody and first
measurement before scheduling the full case matrix. Keep real fixture cleanup
and application acceptance on the original work issue.

Prepare native completion prerequisites early: the actual work issue and PR,
prospective contract publication, producer workflow/artifact availability,
required live-proof shape and issue linkage. A genuine prose-only incident or
acceptance draft may open the actual draft PR before implementation; publish
no code under a prose exemption. Commit the final ready completion pair before
the finished candidate's independent review so PR-number bookkeeping does not
create an avoidable extra source-review cycle.

A detached review request ID alone does not prove a worker started. In the same
parent shell that launches `ai-review ... --detach`, immediately read its native
`ai-review outcome <id> --wait 5` and verify a worker acknowledgement/PID or a
terminal result. An empty log plus no worker acknowledgement is an unstarted
request: diagnose and use the documented supported fallback immediately instead
of waiting on it. Never retry a failed/skipped provider during observation week.
Keep the reviewed worktree, HEAD, branch and files unchanged until the terminal
result is adopted; do not swap its branch while the paid worker runs.

For delivery, distinguish queue admission from an actual merged PR. Check the
fresh effective required contexts through the native required-check preflight;
an optional integration failure does not become a required failure. The queue
hold monitors the exact group's server-reported required flags with read-only
credentials only to abort a failed, ejected or replaced group. Missing/pending
checks retain the healthy 15-minute budget. This monitor never authorizes a
merge: the existing full required-check preflight, review and owned-lane checks
remain mandatory. Busy owned-lane acquisition uses the existing bounded waiter;
all non-occupancy refusals still stop immediately. The guarded job preserves
its original 20-minute post-acquisition execution margin after that wait.

### Node tool tests (primary)

```bash
node --test scripts/check-lane-route-sync.test.mjs
node --test scripts/check-review-parallelism-brief.test.mjs
node --test scripts/check-handoff-contract.test.mjs
node --test scripts/check-documents-only-pull-request.test.mjs
node --test scripts/check-self-service-additive-lane.test.mjs
# …each scripts/*.test.mjs can run alone; CI also batches them in
# tools-offline-tests.yml and pr-guards.yml
```

### SQL shape check (before any migration)

```bash
scripts/check-sql.sh
```

### Python guards (when touching migration / promotion logic)

```bash
python -m unittest scripts/test_production_migration_guard.py
python -m unittest scripts/test_production_business_risk_gate.py
# or the repository's pytest suite under scripts/ where configured
```

### Workflow policy / rulebook consistency

```bash
node --test scripts/check-current-workflow-policy.test.mjs
node scripts/check-skill-drift.mjs
node scripts/check-business-rule-library.mjs
```

CI is the authority for the full matrix (`tools-offline-tests.yml`,
`database-contract-tests.yml`, `pr-guards.yml`, `guarded-migration-merge.yml`).
Do not assume a green laptop equals a green PR.

### Generated database types

The ordinary `database-types` download is generated from the configured preview
project for a reviewed consumer update; it is not production completion evidence.
Only the optional issue-bound production mode of
`.github/workflows/generate-database-types.yml` emits `db-generated-types-proof.json`.
That mode requires an open shared-db issue with `generated_types: required`, binds
to the exact current `main` commit, verifies the canonical production project
through the Supabase Management API, and hashes the fresh TypeScript bytes in its
temporary output. It uses `SUPABASE_ACCESS_TOKEN` from the workflow environment
and runs only `supabase gen types`; it does not link a project or run a migration.

## Authoring a migration

1. Confirm it is **structure** (or gated curated Master Data), not ordinary rows.
2. Check in-flight work: [`docs/agents/in-flight-check.md`](agents/in-flight-check.md).
3. Reserve a version: `node scripts/manage-migration-author-lanes.mjs --claim …`
4. Write only the new `supabase/migrations/<timestamp>_<name>.sql`.
5. Run `scripts/check-sql.sh` and the relevant `scripts/*.test.mjs`.
6. Branch + PR; start CI **and** the governed review in parallel
   (AGENTS.md §5.0-C). Batch fixes into one head.
7. Merge via the guarded merge lane when §5 checks pass — the AI merges, not Albert.

Self-service additive path: if every change is a **new** additive migration
wholly inside `{crm, pim, dam, plm}` (and documents), you may use
`route: self-service-additive` and the merge-time classifier
`scripts/check-self-service-additive-lane.mjs`. Anything else stays on the
conservative path.

## Tests and evidence

- Unit/contract tests live beside the code (`scripts/*.test.mjs`,
  `scripts/test_*.py`, `supabase/tests/`).
- `tests/verification/` and `docs/verification/` hold acceptance write-ups and
  artifacts for specific issues. Add evidence there under the issue name; do not
  treat old evidence as current proof.
- Live proof for a change is a checklist item on the **same** issue
  (`.github/live-proofs/<issue>.sql` when applicable).

## Lint / formatting

There is no single repo-wide formatter. Keep Node scripts as ESM `.mjs`, do not
hand-edit `types/database.types.ts`, and make new guards fail closed. If you add
a linter, record the command here and in `AGENTS.md` documentation map.

## Windows traps

- Never route 1Password `op_run` through bare `bash` (it is WSL and drops env).
- A Node CLI in `tools/` that hand-builds a direct-invocation guard may exit 0
  without doing work (§10.3) — verify the real operation ran.
- Prefer `cmd.exe`, PowerShell, or `node` for secret-bearing commands.

## Scratch files

Put session scratch under your session temp or `.ai/` (gitignored). Durable
knowledge goes in `AGENTS.md`, `docs/`, or the issue — not in root draft files.

## DesignFlow consumer environment tests

These rules concern the four DesignFlow database services, not a new npm runtime
in shared-db. Run commands in the owning application's isolated worktree and
follow that app's development guide. The verified rollout and remaining source
PRs are recorded in [the release guide](designflow-db-release.md#dependency-locks-and-environment-safe-tests).

- Business-behavior tests must work in develop and production. Assert the intended
  table identity or an environment-appropriate qualified name; retain transaction,
  audit and parameter assertions.
- Schema-mapping contract tests must keep independently expected schema values for
  each supported environment. Do not replace those with table-only assertions or
  compare a resolver to itself. Explicitly set and restore relevant environment
  variables so ambient production settings cannot change the test's intended case.
- Use the committed lock and verified package-manager version. Install all test
  dependencies before applying production environment variables; never resolve
  fresh packages, delete the lock, skip an environment or weaken a failing test
  just to release. Deliberate upgrades change the manifest and lock together.
- Before promotion, run the complete mocked suite under both settings below. The
  automatic PR/sandbox matrix does the same; no production credentials or database
  writes are needed. Existing production readiness checks remain mandatory.

```bash
NODE_ENV=develop SCHEMA= npm test -- --runInBand
NODE_ENV=production SCHEMA=dflow_prod npm test -- --runInBand
```

Do not invoke these app commands in the shared-db repository. Its own Node and
SQL tool tests remain those documented above.
