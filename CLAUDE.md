# Claude Code Notes for PopDAM

Read `AGENTS.md` first. It is the canonical guide for project summary, repo structure, task navigation, deployment, credentials, incidents, quirks, and pending work. This file is only for Claude Code-specific workflow reminders.

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

Use this only for real schema changes. Data queries and one-off DML can use `execute_sql`; DDL must not.

| Path | Records in migration history? | Creates local file? | Use for |
|------|-------------------------------|---------------------|---------|
| `apply_migration` MCP | Yes, with Supabase's recorded timestamp | No | DDL/schema changes |
| `execute_sql` MCP | No | No | Data reads, data fixes, one-off DML |
| `supabase db push` CI | Yes, from local filenames | Reads committed files | Automated deployment only |

Safe migration workflow:

1. Write and review the SQL.
2. Apply it with `apply_migration`.
3. Immediately call `list_migrations`.
4. Create `supabase/migrations/<exact-recorded-timestamp>_<name>.sql`.
5. Commit promptly.

Never create the local migration filename from your own clock guess. Supabase records the actual apply time; a mismatch causes `supabase db push` to fail.

Project IDs:

| Project | ID | Use |
|---------|----|-----|
| PopDAM prod | `qsllyeztdwjgirsysgai` | All PopDAM/PopSG schema and edge functions |
| SynoMon | `qnjimovrsaacneqkggsn` | Separate project; never use for this repo |

---

## After Pushes

After pushing changes under `supabase/migrations/**` or `supabase/functions/**`, check the `Deploy Supabase` GitHub Actions run. The workflow now fails if any edge function deploy fails.

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
