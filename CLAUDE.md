# Claude Code Notes for PopDAM

Read `AGENTS.md` first. It is the canonical guide for project summary, repo structure, task navigation, deployment, credentials, incidents, quirks, and pending work. This file is only for Claude Code-specific workflow reminders.

## Shared DB Gatekeeper

This repo shares Supabase backend project `qsllyeztdwjgirsysgai` with the other
POP apps. All database/schema changes for that shared backend must be authored
in canonical [`u2giants/shared-db`](https://github.com/u2giants/shared-db) using
a branch + PR + timestamped migration, preview-first, with the AI owning the
merge before any dependent app code is written.

Never make shared database changes from this app repo. That means no app-side
DDL, no inline/startup migrations, no Dashboard SQL, no one-off `execute_sql`,
and no new migration files under this repo's local `supabase/migrations/`
folder. The only allowed copy of shared DB migrations in this repo is the
vendored read-only `shared-db/` mirror that syncs from the canonical repo.

The `.github/workflows/shared-db-guard.yml` workflow runs on `push` and
`pull_request` and fails changes that add database DDL or migrations outside the
vendored `shared-db/` folder. The only override is an explicitly approved
exception: add PR label `db-change-approved`, or include `[db-change-approved]`
in the commit message for direct pushes.

Before any shared Supabase database, schema, migration, or cross-app change,
read and follow `shared-db/AGENTS.md` (the cross-app coordination playbook). App
code here is `main`-only (no branches); `shared-db` changes use branch+PR and
the AI owns the merge.

---

## Session Start

1. Read `AGENTS.md`.
2. Read `HANDOFF.md` if it exists.
3. Check `git status --short` before editing. Do not overwrite or revert changes you did not make.
4. Stay on `main` for normal work in this repo, but do not run destructive sync commands in a dirty worktree.

This repo is trunk-based. When the user asks to commit/push, commit to `main` and push to both configured remotes if possible:

```bash
git push origin main
git push github main
```

If one remote fails, report which one and why.

---

## No Workarounds

When a required tool, credential, or environment is unavailable, stop and say exactly what is missing. Do not substitute a frontend-only change for a DB change, hardcode data for a failed API call, or silently skip deployment/verification steps.

---

## Supabase Migrations

This app repo must not author or apply shared Supabase migrations. The local
`supabase/migrations/` folder is historical only, and CI blocks new app-owned
shared DB migrations.

Safe workflow for any schema, trigger, policy, RPC, pg_cron, view, or data
migration:

1. Stop work in this repo before creating migration SQL.
2. Switch to canonical `/worksp/shared-db`.
3. Create a dedicated `shared-db` branch.
4. Add a new timestamped file under `/worksp/shared-db/supabase/migrations/`.
5. Run the `shared-db/AGENTS.md` preview-first checklist.
6. Open and merge the shared-db PR when safe.
7. Return here only for app/function/type changes that consume the new contract.

Use this repo for Supabase edge-function code under `supabase/functions/**`.
The `.github/workflows/deploy-supabase.yml` workflow deploys functions and
generates types; it does not run `supabase db push`.

Project IDs:

| Project | ID | Use |
|---------|----|-----|
| PopDAM prod | `qsllyeztdwjgirsysgai` | All PopDAM/PopSG schema and edge functions |
| SynoMon | `qnjimovrsaacneqkggsn` | Separate project; never use for this repo |

---

## After Pushes

After pushing changes under `supabase/functions/**`, check the `Deploy Supabase Edge Functions` GitHub Actions run. The workflow now fails if any edge function deploy fails. Do not push new files under `supabase/migrations/**`; use canonical `/worksp/shared-db`.

After pushing `apps/worker/**`, remember Railway rebuilds automatically on every push to `main`, even if GitHub Actions does not run a worker workflow.

After pushing `apps/bridge-agent/**`, make sure the bridge agent version/build metadata is updated as required by `AGENTS.md` and the workflow.

---

## Deployment Ownership

Normal production path is:

```text
commit to main -> GitHub Actions -> GHCR image / Supabase deploy -> Coolify or Supabase
```

Coolify owns runtime configuration for the frontend container: env vars, domain bindings, health checks, restart policy, and lifecycle. Source code, Dockerfiles, workflows, and build behavior belong in git.

SSH into the VPS is emergency break-glass only. If it is used, document the action in the repo or Coolify immediately afterward so the server does not become hidden state.
