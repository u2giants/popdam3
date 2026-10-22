# Deployment

This repository does not deploy an application. It **ships rules, migrations,
and a mirrored tree** to every consumer.

## What “release” means here

1. **Merge to `main`** through the branch + PR + guarded merge lane
   ([`docs/agents/merge-protocol.md`](agents/merge-protocol.md)).
2. **Tree sync** — on each push to `main`, `.github/workflows/sync.yml` copies
   the entire repository into the `shared-db/` folder of every consumer repo
   (CRM, DAM, PM/PIM, `popcre/designflow-*`). That copy is read-only; edits in
   consumers are overwritten on the next sync.
3. **Schema apply** — migrations are applied to preview first, then to
   production through the bounded production apply workflow
   (`shared-supabase-migrations.yml`, production apply evidence, promotion
   procedure). Never run `supabase db push` by hand against production.
4. **No containers, no SSH.** There is no image tag and no host deploy from this
   repo. Coolify / Cloud Build / app deploys belong to each application.

## Deploy trigger methods

| Mechanism | Trigger | Owner workflow |
|---|---|---|
| Consumer tree mirror | push to `main` | `.github/workflows/sync.yml` |
| Guarded migration merge | PR merge to `main` | `guarded-migration-merge.yml` + merge queue |
| Preview apply | claim / rehearsal lane | `shared-supabase-migrations.yml` (preview mode) |
| Production apply | authorized promotion | production apply workflows + `config/production-risk-policy-activation.json` |
| Automatic promotion (narrow) | merged-main preview qualification | owner-authorized lane (AGENTS.md safety rules) |
| Types regeneration | generate workflow | `generate-database-types.yml` |

## Production apply safety (summary)

Full text: [`docs/production-promotion-procedure.md`](production-promotion-procedure.md)
and AGENTS.md / runbook chapters.

- Pin the apply to an exact `origin/main` SHA.
- **Freeze merges** for the whole apply window (`--acquire-promotion-freeze` /
  release / TTL). The pin has refused approved runs when merges landed mid-window.
- Prove the target database immediately before every write.
- Serial exclusive lanes: preview, merge, production.
- Post-apply verification against production objects is mandatory; preview
  green does not prove production green.
- Live proof is a checklist item on the same issue.

## Rollback

| Failure | Recovery |
|---|---|
| Bad documentation / rulebook | Revert the merge commit on `main`; sync mirrors the fix |
| Bad migration already applied | **Fix forward** with a new migration (applied files are immutable) |
| Bad migration not yet applied | Remove it from the promotion batch before apply; update the claim |
| Consumer saw a bad mirror | Consumers pick up the next `sync.yml` run after `main` is corrected |
| Production apply refused | Nothing was written; re-run under a freeze once `main` is stable |

There is no rollback of production schema via down-migration. Treat every
migration as forward-only.

## Environment layout

| Environment | Role | How addressed |
|---|---|---|
| Developer worktree | author migrations, run offline tests | local |
| Preview (`PREVIEW_PROJECT_REF`) | shared mutable rehearsal (full clone of production data at creation) | Supabase branch |
| Production (`qsllyeztdwjgirsysgai`) | live shared DB for all apps | Supabase |
| Consumer repos | apps + mirrored `shared-db/` folder | GitHub |

## What is *not* deployed from here

- DB Data Admin UI (`u2giants/popdam3` `apps/db-data-admin/`, host
  `https://data.designflow.app`) — ownership contract:
  [`docs/db-data-admin-domain-ownership.md`](db-data-admin-domain-ownership.md).
- Application CI/CD in other repos.
- Host systemd units / PLM importer (retired — see README).

## Verify a release

1. PR checks + merge-queue result on `main`.
2. `sync.yml` success on the consumer tree.
3. For schema: preview apply evidence, then production apply result + live proof
   on the issue.
4. Do not treat a green workflow as live proof without the issue checklist.
