# shared-db runbooks — credentials, CLI, and hosted-Supabase gotchas

Relocated from `AGENTS.md` on 2026-08-20 (issue #1331, PR #1212): §9, §10.1, §10.2, §10.3 and §11
in full. **Text unchanged, section numbers unchanged** — `AGENTS.md §10.2` still resolves.
`AGENTS.md` carries the headlines and points here.

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

Gotchas added 2026-07-16 (each cost real time; all verified):

- **`psql` is NOT installed on the Windows dev machines.** Do not plan an ad-hoc
  query path around it. Use Node + the `pg` package (install it into a scratch dir)
  against the pooler above, as user `postgres.qsllyeztdwjgirsysgai`. This is how the
  Coldlion import and its verification were actually run.
- **`op run --env-file <(echo …)` (process substitution) fails on Windows.** The
  native `op.exe` cannot read the msys `/proc/<pid>/fd/<n>` path
  (`The system cannot find the path specified`). Write a real temp env-file holding
  only the `op://` reference. See `docs/coldlion-erp-api-reference.md` → Reproduce.
- **Never route the 1Password MCP `op_run` tool through `bash` on Windows.** A bare
  `bash` there is **WSL**, and WSL does not inherit the injected Windows env, so
  secrets arrive as empty strings and the call fails in a way that looks like a
  broken tool. `op_run` is fine — use a native child: `command` runs via cmd.exe
  (`%VAR%`), or PowerShell (`$env:VAR`), or `node` (`process.env.VAR`). Its `argv`
  form is a direct spawn with **no shell** (no `$VAR`/`%VAR%` expansion, no
  builtins). Resolved secrets are redacted from output as `«REDACTED:NAME»`.
  Background: `u2giants/ai-devops` → `templates/system/machine-atlas.md`.
- **General rule these share:** presence is not capability. A tool answering
  `--version` (or a reference resolving) proves nothing about whether the operation
  works. Exercise the real operation before trusting it — and before blaming a tool
  for an empty result, confirm the platform, resolved executable, shell, cwd, and
  environment boundary you are actually running in.

Preview branch credentials live in 1Password item
`Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)`.
Use the same pattern: authenticate the CLI with the Supabase PAT, then link to
preview project `rjyboqwcdzcocqgmsyel` with that branch's database password
before running preview dry-runs or pushes.

**That title cannot be used in an `op://` reference** (verified 2026-07-29): the
parentheses are invalid in a secret reference and `op read` fails with
`invalid character in secret reference: '('`. Address the item by **ID** instead —
the password lives in the `DB_PASSWORD` field:

```bash
PREVIEW_DB_PASSWORD="$(op read 'op://vibe_coding/qbvfk7umc3n75ejekd65zwd4ty/DB_PASSWORD')"
supabase link --project-ref rjyboqwcdzcocqgmsyel --password "$PREVIEW_DB_PASSWORD"
```

Item IDs can be re-keyed by 1Password, so if that ID 404s, re-resolve it with
`op item list --vault vibe_coding --format json` and match on the title.

## 10.3 A CLI runner that "succeeds" silently on Windows — check the entry guard (added 2026-07-31)

A Node CLI in `tools/` that builds its direct-invocation guard **by hand** does nothing on
Windows and **exits 0**:

```js
// BROKEN — always false on Windows
import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`
```

`import.meta.url` yields `file:///C:/…` (three slashes); the hand-built string yields
`file://C:/…` (two). No output, no error, **no `ingest.sync_run` row** — it reads as success.
`tools/sync-coldlion-vendors.mjs` shipped this and any Windows run since 2026-07-22 imported
nothing while looking fine (fixed 2026-07-31, PR #334). **Always use
`pathToFileURL(process.argv[1]).href`.** Every other tool in `tools/` already did.

Related, unfixed: those runners tell you to install `pg` in a scratch dir and set `NODE_PATH`.
**`NODE_PATH` is CommonJS-only** — `await import("pg")` resolves relative to the tool's own
location, so this does not work for ESM tools.

## 10.1 Clean-slate local replay is unsupported — use the dependency closure

Applying every migration in filename order against an empty local Postgres **cannot
work, and never could**. This is by design, not a bug, and not something to "fix".

Roughly 170 of the migration files are intentionally **empty markers**. They exist so
the Supabase CLI ledger lines up with objects that were created *before* `shared-db`
became canonical (legacy PopDAM/DesignFlow tables). Nothing in this repo ever creates
those objects. So on a from-scratch database, every later migration that references one
fails. A full replay produces ~63 failures of exactly this class: `assets`,
`style_groups`, `style_guide_files`, `style_tracker_rows`, `licensors`, `user_roles`,
`admin_config`, the `dflow.sample*` / `plm.sample*` families, `has_app_access()`, and
`supabase_migrations.schema_migrations`.

**Do not read this as a migration ordering bug.** Two separate AI sessions burned time
concluding that `20260323165935_assets_updated_at_trigger.sql` ran before
`20260326212850_assets_add_updated_at_column.sql`. Both of those files are empty markers.
They cannot fail. The filenames merely look misordered.

**Deploys are not affected.** CI links to a live project and runs `supabase db push`,
which applies only migrations missing from that project's ledger. The markers are already
recorded there, so they are skipped. Production remains dry-run + allowlist bounded.

**To exercise a migration locally**, apply only its dependency closure, not the whole set.
For anything touching the core domain tables that is:

```
20260621150714_foundation.sql
20260621150815_app_core.sql
20260621151024_domain_tables.sql
20260621151155_api_rls_realtime.sql
<your migration>
```

plus a shim for what hosted Supabase provides and stock Postgres does not: schema `auth`
with a minimal `auth.users` table and `auth.jwt()` / `auth.uid()` / `auth.role()`
functions, and the roles `service_role`, `authenticated`, `anon`, `supabase_admin`
(some migrations also want `authenticator`, an `extensions` schema with `pg_trgm`, and
`storage` tables). `scripts/check-sql.sh` plus `supabase db push --dry-run` against
preview remain the authoritative gates.

**Known limitation:** because of the above, this repo alone cannot rebuild the shared
project from nothing. That is a disaster-recovery gap, not a day-to-day one. Closing it
would need a checked-in baseline schema dump (new file outside `migrations/`, so it would
not violate the never-edit-a-prior-migration rule). Not done as of 2026-07-29.

## 10.2 Grants in `public` are locked down by default (added 2026-07-29 — READ THIS BEFORE CREATING A FUNCTION)

**A behaviour change landed on preview AND production on 2026-07-29. It affects every
migration that creates a function in `public`, in every workstream.**

An event trigger, `lock_down_new_public_function_execute_trg`, now fires on every
`CREATE FUNCTION` / `CREATE PROCEDURE` in schema `public` and immediately revokes EXECUTE
from **PUBLIC and `anon`**. The `public`-schema default privileges for role `postgres` no
longer grant EXECUTE to `anon`/`authenticated` either.

**What this means for you:** a new function in `public` is reachable by **nobody except
`postgres` and `service_role`** unless your migration grants it explicitly. Always state
the grant:

```sql
create or replace function public.f(...) ... ;

revoke execute on function public.f(...) from public, anon, authenticated;
grant  execute on function public.f(...) to service_role;   -- and/or authenticated
```

Notes and traps:

- The trigger revokes `anon`/PUBLIC only — **never `authenticated`** — deliberately, so a
  later `create or replace` that merely patches a function body cannot silently strip an
  app-facing grant. Do not "improve" it to include `authenticated`.
- Because `create or replace` reports the `CREATE FUNCTION` tag, it **does** re-strip
  `anon`. If a function must genuinely be anon-callable, re-grant *after* the create.
- Its failures are `raise warning` only, so a failed revoke shows up in the Postgres log
  and nowhere else. There is **no automated alarm yet** that the lockdown still holds.
- `anon` holds schema `USAGE` on **`public` only** — every other schema is closed to it at
  the schema level. That is why `public` is the schema that matters here.
- **Views ignore RLS unless created with `security_invoker = true`.** A view owned by
  `postgres` (which is `BYPASSRLS`) runs as owner and defeats the RLS on its base tables,
  and a view has no RLS of its own — so the GRANT is the only guard. Three views leaked
  ~16,600 rows to `anon` this way. When you add a view over an RLS-protected table, either
  set `security_invoker = true` or revoke `anon`/PUBLIC explicitly, and verify with the
  anon key.

Full background, the audit queries to re-run, and what was deliberately left alone:
[`docs/security/public-schema-execute-audit.md`](docs/security/public-schema-execute-audit.md)
and [`docs/security/public-schema-anon-read-audit.md`](docs/security/public-schema-anon-read-audit.md).

**Still pending on production:** `20260729120000_lock_down_public_security_definer_execute.sql`
hard-codes `revoke ... on function public.sync_clickup_tasks(...)`, which does not exist on
production yet. Promote it **together with or after** the ClickUp migrations
(`20260728174500...`), never before, or the apply aborts with `undefined_function`. Its
production-safe equivalent (`20260729130000`) is already applied, so nothing is exposed in
the meantime.

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
  `crm.ingested_domain.promoted_customer_id`, and all legacy-ingest source refs
  customer source refs after 3,741 polluted refs were found in production.
- **`unique nulls not distinct (external_source, external_id)`** on `crm.*` and
  `core.*` tables means you cannot bulk-insert many rows with both columns NULL —
  the second NULL/NULL row collides. Importers must set a real
  `external_source` and a unique `external_id` per row.
- **Cross-schema FKs (e.g. `crm.department.company_id → core.company`) are real and
  enforced**, but PostgREST embed syntax (`select=...,company:company_id(...)`)
  may report "no relationship found" because the schema cache does not auto-detect
  cross-schema FKs. The constraint is still there — verify with `pg_constraint`,
  not with a failed embed.
- **An RLS policy is NOT a table GRANT.** A `for all`/`crm_write`-style policy lets
  a role write *rows it is allowed to*, but Postgres still checks the table-level
  privilege first. The baseline only ran `grant select on all tables in schema crm
  to authenticated` (reads), and `grant ... on all tables` does not cover tables
  created later. So a browser `insert`/`update`/`delete` against a `crm.*` table that
  has `crm_write` but no DML grant fails with `permission denied for table ... (42501)`
  — distinct from an RLS rejection (`new row violates row-level security policy`).
  Every directly-written `crm.*` table needs an explicit `grant insert, update, delete
  ... to authenticated` alongside its policy; see
  `20260715220500_grant_crm_write_dml_to_authenticated.sql` and
  `docs/app-migration-notes/popcrm-web-20260716.md`.
