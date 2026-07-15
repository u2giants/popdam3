> ⚠️ **Auto-synced — do not hand-edit the copies.**
>
> [`u2giants/shared-db`](https://github.com/u2giants/shared-db) is the **single source of truth**. Its entire contents are mirrored into the **`shared-db/` folder** of every consumer repo (CRM, DAM, PM/PIM, DesignFlow PLM) on each push to `main`.
>
> **Reading this inside a consumer repo's `shared-db/` folder?** It's a read-only copy — edits here are overwritten on the next sync. Change the canonical repo instead.

---

# AGENTS.md — cross-app coordination playbook

This is the operating contract for **every AI session working on any app that
shares the Supabase database**: PM/PIM `poppim-web`, CRM `popcrm-web`, DAM
`popdam-web`, and the six `popcre/designflow-*` PLM repos. Read it before
touching code or the database. It exists to stop separate
AI sessions from breaking each other through the one database they all depend on.

## 0. Shared-db gatekeeper rule for consumer repos

`shared-db` is the gatekeeper for every database schema change in the shared
Supabase project, including DesignFlow PLM tables that still appear in app repos
as Sequelize models or legacy inline startup migrations.

Consumer repos must not author schema changes locally. That means no app-repo
inline migrations, no direct SQL runbooks, no dashboard edits, and no model-only
"add the column here" changes for tables that live in the shared database. A
database change starts here with a new timestamped migration under
`supabase/migrations/`, then follows the preview/prod protocol in this document.

App repos may still change app code after the shared migration lands: models,
generated types, query code, API handlers, UI code, tests, and docs are normal
app work. The schema itself belongs here.

DesignFlow consumer guardrails added on 2026-07-10:

- `popcre/designflow-bff`
- `popcre/designflow-frontend`
- `popcre/designflow-backend`
- `popcre/designflow-item-master`
- `popcre/designflow-tracking`
- `popcre/designflow-data-syncing`

Each repo has a checked-in Cursor rule at
`.cursor/rules/shared-db-gatekeeper.mdc`. The rule is intentionally duplicated
across all six repos so Cursor sees it no matter which repo a programmer opens.
If any agent changes that Cursor rule in one repo, that agent must make the same
change to the other five repos in the same session and commit/push all six
together. `designflow-frontend/AGENTS.md` also has a shared-db section near the
top, and `designflow-item-master/AGENTS.md` was created so agents no longer have
to infer this rule from other repos.

Historical warning: older DesignFlow docs and code may still mention
`models/db.js` inline migrations. Treat those as legacy implementation history,
not permission to add new schema changes in app repos.

## Session wrap-up convention

When the user says **"wrap up"**, that means finish the session safely: update
the relevant Markdown docs with durable knowledge from the work, run required
checks, complete branch/PR/merge/apply steps, verify 1Password coverage for any
secrets encountered, and leave the repo handoff-safe. For this repo, do not leave
untracked migrations or docs behind; either finish the shared-db branch + PR +
merge workflow or write an explicit handoff with the next exact action.

## 1. The owner is not a programmer

The repository owner directs the work and judges results, but does **not** review
code, manage branches, or merge pull requests. Therefore:

- **The AI owns all git mechanics.** Branches, commits, pull requests, and merges
  are the AI's job from start to finish. Never leave an open PR for the owner to
  deal with — open it *and* merge it within the same piece of work, once it is
  safe (see §5).
- **The owner reviews behavior, not code.** Their feedback is "the board doesn't
  load," "the dropdown is empty." Translate that into changes yourself.
- **Surface risk in plain English.** Before anything hard to undo (dropping a
  column, applying to production, deleting data), explain the risk in one or two
  plain sentences and ask. Approval for one change does not extend to the next.

## 2. Two workflows — choose by where you are working

| Where | Workflow | Why |
|---|---|---|
| **Non-DesignFlow app repo** (`poppim-web`, `popcrm-web`, `popdam-web`) | Commit straight to **`main`. No branches.** Build must pass, then push; CI deploys. | One app, one owner, a deploy you can watch. Branches add ceremony with no safety gain. Fix-forward or revert on `main`. |
| **DesignFlow app repo** (`popcre/designflow-*`) | Work on **`sandbox-albert`**, push, and open/update a PR to **`develop`**. Do not merge it yourself. | DesignFlow work is reviewed by Uma. Keep schema changes out of these repos; use `shared-db` first. |
| **This repo** (`shared-db`) | **Branch + PR, and the AI merges it** once the §5 checklist passes. | All apps read these tables. A bad change breaks everyone at once. The PR is a safety checkpoint and an undo button — not paperwork for the owner. |

## 2.1 Host/server boundary

This repo owns shared database schema, Supabase migrations, PLM import code, and the `systemd/plm-sync.*` templates. Durable host/OS changes on `hetz` are owned by the canonical Ansible repo at `/worksp/ansible` / [`u2giants/ansible`](https://github.com/u2giants/ansible), then applied by GitHub Actions.

Route packages, users, firewall, SSH/sudo, Docker engine or daemon config, systemd units/timers, cron, `/etc`, `/usr/local/bin`, `/usr/local/sbin`, Cloudflare Tunnel 1, Coolify host glue, and backup/DNS watchdogs through an Ansible PR. Do not SSH, sudo, or hand-edit the host directly for durable infrastructure changes. App/database code and templates that belong to `shared-db` still change here; deploying those templates onto the host belongs in Ansible. Break-glass direct host repair must be explicit and followed by an Ansible PR that captures or reconciles the drift.

## 3. Why `shared-db` is the dangerous one

Every app reads and writes the **same tables in the same Supabase project**. A
single schema change here can break an app that a different session built months
ago. The database has no "just this app" — it is always shared. That is why the
four rules below are non-negotiable for any database change.

## 4. The four anti-collision rules (shared database)

1. **One schema change in flight at a time.** Before starting database work,
   check whether another change is already in progress (§6). If so, finish or
   land that one first, or coordinate with the owner. Two simultaneous schema
   edits are the number-one cause of a broken shared database.
2. **Preview database first. Production never receives untested schema.** Apply
   every migration to the preview branch (`xjcyeuvzkhtzsheknaiu`), prove it
   works, *then* promote to production (`qsllyeztdwjgirsysgai`).
3. **Additive by default (expand, then contract).** Adding a column or table
   cannot break another app. **Renaming or dropping** one that another app reads
   *will*. Default to additive changes. Only rename/drop after explicit owner
   sign-off and a checked deprecation across all dependent apps.
4. **New timestamped migration files only.** Each change is a new
   `YYYYMMDDHHMMSS_*.sql` file. Never edit a migration that has already been
   applied anywhere — that is how two sessions silently clobber each other.

## 5. The `shared-db` merge protocol (the checklist the AI runs)

Merge a `shared-db` PR **only when every item is true**:

1. `scripts/check-sql.sh` passes.
2. `supabase db push --dry-run` against the preview branch is clean (only the
   intended changes, no surprise drops/renames).
3. The migration is applied to the **preview** branch and works there.
4. Every app that depends on the change has been tested against preview and the
   owner has confirmed the behavior is correct.
5. The change is additive, or any removal was explicitly approved.

Then: merge to `main` (this auto-syncs the `shared-db/` folder into all apps) and
promote to **production only in an approved window**. Docs-only PRs (no schema
change) need just items 1 and "it reads correctly" — merge them promptly.

## 6. How to tell if a change is already in flight

Before starting database work, run these and read the result:

```bash
gh pr list                      # open shared-db PRs
git branch -a && git ls-remote  # in-progress branches
ls supabase/migrations          # files not yet applied to production
git status --short              # uncommitted migration files in the working tree
```

If anything looks like in-progress database work, **stop and serialize** — land
it (or ask the owner) before adding your own schema change.

**Currently in flight (as of 2026-07-15): the ERP mirror relocation.** The
Coldlion ERP pull tables (`public.erp_*`, `public.prod_order_*`) are being moved
out of `public` into the designed `ingest` / `plm` / `api` layers. The full
5-phase plan, current state, and rationale live in
[`fix_schema_for_api.md`](fix_schema_for_api.md) (repo root). **Phase 1 is done
and live in production** (`api.plm_item_list` serving view + `style_tracker_rows_with_bridge`
repointed; migration `20260715193000_erp_phase1_api_plm_item_list.sql`). Phases
2–5 are pending. Before touching `erp_*`, `prod_order_*`, `api.plm_item_list`,
`plm.item`, `plm.production_order*`, or `plm.refresh_style_tracker_item_bridge()`,
read that plan first and continue it in order — do not start a parallel ERP
schema change. Note the still-open source decision (keep sourcing **through
dflow** for free enrichment vs. pull **Coldlion directly**) documented in
[`docs/coldlion-erp-to-supabase-field-mapping.md`](docs/coldlion-erp-to-supabase-field-mapping.md);
it affects Phase 3.

## 7. When two apps need conflicting database changes

Serialize, do not parallelize. Land one change, let it sync, test it, then start
the next. Where possible, prefer one **additive** change that satisfies both apps
rather than two competing edits. If they genuinely conflict, explain the trade-off
to the owner in plain English and let them choose order.

## 8. Project references

```text
Preview project ref:  xjcyeuvzkhtzsheknaiu   (Supabase branch "shared-db-schema-rehearsal")
Production project ref: qsllyeztdwjgirsysgai
```

Never commit anon keys, service-role keys, database passwords, or `.env` files.

## 9. Supabase CLI and database credential runbook

Use the canonical credentials in 1Password. Do not work around auth failures with
manual SQL, dashboard edits, copied browser tokens, embedded remote URLs, or
one-off connection strings. If the normal path fails, fix the credential/tool
login path and then prove it with `supabase projects list`, `supabase link`, and
`supabase db push --dry-run`.

Production items in the `vibe_coding` vault:

```text
Supabase CLI Personal Access Token
Supabase DB Password - shared POP database
Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)
```

Canonical production login/link flow:

```bash
SUPABASE_ACCESS_TOKEN="$(op read 'op://vibe_coding/Supabase CLI Personal Access Token/SUPABASE_ACCESS_TOKEN')"
supabase login --token "$SUPABASE_ACCESS_TOKEN"
supabase projects list

PROD_DB_PASSWORD="$(op read 'op://vibe_coding/Supabase DB Password - shared POP database/password')"
supabase link --project-ref qsllyeztdwjgirsysgai --password "$PROD_DB_PASSWORD"
supabase db push --dry-run
```

Important gotchas from the 2026-07-08 PopDAM style-group repair:

- Setting `SUPABASE_ACCESS_TOKEN=...` for one command may still leave the
  installed CLI unauthorized. Run `supabase login --token ...` and verify with
  `supabase projects list` before deciding the PAT is bad.
- A DB password that works through `supabase link --password` can look rejected
  if a child process reads an unexported shell variable. Export or pass the
  variable in the same command before building URLs or invoking Node scripts.
- Direct IPv6 database connections can fail from some hosts. Prefer the linked
  Supabase CLI path for migrations. If a direct connection is required, use the
  Supabase pooler host `aws-1-us-east-1.pooler.supabase.com`, port `6543`, user
  `postgres.qsllyeztdwjgirsysgai`, database `postgres`, with the same production
  DB password.
- After fixing or rotating any credential, update the matching 1Password item
  notes so the next AI session sees the durable usage path.

Preview branch credentials live in 1Password item
`Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)`.
Use the same pattern: authenticate the CLI with the Supabase PAT, then link to
preview project `xjcyeuvzkhtzsheknaiu` with that branch's database password
before running preview dry-runs or pushes.

## 10. Where to read more

- App rewrite guides: [`docs/ai-session-instructions/`](docs/ai-session-instructions/README.md)
- Shared branch workflow: [`docs/ai-session-instructions/shared-supabase-branch-workflow.md`](docs/ai-session-instructions/shared-supabase-branch-workflow.md)
- Schema ownership map: [`docs/unified-supabase-schema-map.md`](docs/unified-supabase-schema-map.md)
- Migration risks: [`docs/unified-supabase-migration-gaps.md`](docs/unified-supabase-migration-gaps.md)
- CRM production cutover (migrations promoted, Azure OAuth, auto-provision, data import): [`docs/app-migration-notes/popcrm-web-production-cutover-20260621.md`](docs/app-migration-notes/popcrm-web-production-cutover-20260621.md)

## 11. Hosted-Supabase gotchas (do not relearn these the hard way)

These bit the CRM production cutover (2026-06-21). PM/PIM will hit the same ones.

- **PostgREST schema exposure is control-plane config, NOT SQL.** The
  `alter role authenticator set pgrst.db_schemas = ...` + `notify pgrst,'reload config'`
  statements in `20260621151419_crm_rls_realtime.sql` do **not** take effect on
  hosted Supabase — the platform overrides them. To expose non-default schemas
  (`api, crm, pim, core`) you must call the Management API:
  `PATCH https://api.supabase.com/v1/projects/{ref}/postgrest`
  with `{"db_schema":"public,graphql_public,api,crm,pim,core"}`. It is a per-project
  setting; **re-confirm it after any project restore/clone**, and set it on the
  preview branch too. If supabase-js suddenly 404s on `api.*`/`crm.*`, check this first.
- **`service_role` has no rights on non-`public` schemas by default.** Server-side
  scripts/workers using the service-role key get "permission denied for schema core/crm"
  until granted. The grants live in `20260621164759_service_role_grants.sql`
  (usage + ALL on tables/sequences for `app, core, crm, pim, plm, ingest, api`,
  plus default privileges). Re-run/verify after adding new schemas.
- **Supabase Auth has one `site_url`; every app needs explicit redirect allowlist entries.**
  The production project's Auth `site_url` is `https://crm.designflow.app`, so OAuth
  flows for PM/DAM/SG/master-data apps must pass an explicit app-origin `redirectTo`
  and that origin must be in `uri_allow_list`. Keep bare origin, trailing-slash origin,
  and `/**` wildcard entries for `crm`, `crm-dev`, `pm`, `pm-dev`, `pm-ci`, `dam`,
  `sg`, and `master` designflow hosts. If Microsoft SSO from one app lands on CRM,
  check `GET /v1/projects/qsllyeztdwjgirsysgai/config/auth` before changing frontend
  routing.
- **Ingested domains are never customers.** `crm.ingested_domain` is CRM-private
  email triage data only. It must not FK to, promote into, source-ref, join as,
  feed picker lists for, or otherwise associate with `core.customer`. The
  corrective migration `20260629034500_remove_ingested_domain_customer_association.sql`
  removed `api.customer_list`, `crm.promote_ingested_domain(...)`,
  `crm.ingested_domain.promoted_customer_id`, and all `directus/ingested_domains`
  customer source refs after 3,741 polluted refs were found in production.
- **`unique nulls not distinct (external_source, external_id)`** on `crm.*` and
  `core.*` tables means you cannot bulk-insert many rows with both columns NULL —
  the second NULL/NULL row collides. Importers must set a real
  `external_source` (e.g. `'directus'`) and a unique `external_id` per row.
- **Cross-schema FKs (e.g. `crm.department.company_id → core.company`) are real and
  enforced**, but PostgREST embed syntax (`select=...,company:company_id(...)`)
  may report "no relationship found" because the schema cache does not auto-detect
  cross-schema FKs. The constraint is still there — verify with `pg_constraint`,
  not with a failed embed.
