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
