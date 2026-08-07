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

> **Started in `shared-db` and you are not the coordinator? Stop and hand over.**
> This repo runs **one coordinator session**, which dispatches every task to
> sub-agents in isolated worktrees. Any other session writes its handover into
> the intake queue in [`COORDINATOR_INTAKE.md`](COORDINATOR_INTAKE.md) and stops.
> That file also carries the standing facts an incoming session needs (silent
> duplicate-version skips, the production-bound Supabase MCP, preview as a shared
> mutable resource) and the ban on background task chips in this repo. Skills:
> `shared-db-orchestrator` to run a coordinator session, `shared-db-handover` to
> close one out.

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

## 0.1 Database schema ownership is not deployment-secret ownership

`shared-db` is authoritative for shared Supabase schema and cross-app data
contracts. It is **not** the source of truth for GCP Secret Manager IAM, Cloud
Build substitutions/triggers, Cloud Run database bindings, VPC routing, or
production secret-version pins. Those belong to
[`popcre/infrastructure`](https://github.com/popcre/infrastructure).

The 2026-07-17 DesignFlow outage proved why this boundary matters. A sandbox
Supabase pooler assumption (`6543`) was generalized to production, where the
application actually uses Cloud SQL (`5432`). Before any database connection or
secret-related work, classify the environment and validate the complete tuple:

| Environment | Provider/port | Secret IDs |
|---|---|---|
| Develop | hosted Supabase pooler / `6543` | complete `_DEV` tuple |
| Staging | hosted Supabase pooler / `6543` | complete `_STAGING` tuple |
| Sandbox | hosted Supabase pooler / `6543` | complete `_SANDBOX` tuple |
| Production | Cloud SQL / `5432` | complete unsuffixed tuple |

Unsuffixed DB secrets are production-only. Never read, version, enable,
disable, destroy, rebind, or repoint them unless Albert clearly asks for that
specific production change. A request about connection pooling, sandbox,
staging, schema, or application code is not production-secret authorization.
For current safeguards, incident evidence, the Uma approval boundary, and the
remaining Google Cloud organization blocker, read
[`docs/incidents/20260717-designflow-production-db-port.md`](docs/incidents/20260717-designflow-production-db-port.md)
and then the canonical infrastructure runbook it links.

## 0.2 `data.designflow.app` means DB Data Admin — never the retired system

`https://data.designflow.app` is the permanent production hostname of **DB Data
Admin**, implemented in this repository at `apps/db-data-admin/`. The retired
legacy application previously used that DNS name, but it has no remaining
runtime, credential, database, API, import, rollback, proxy, or ownership
relationship to it.

Historical `source_system='directus'` values may remain as data-provenance
labels, and applied migrations may retain historical comments. Those are not
live dependencies. Never infer current architecture from them, old transcripts,
old DNS history, or cached TLS state. Before changing the hostname, its routing,
or DB Data Admin deployment, read
[`docs/db-data-admin-domain-ownership.md`](docs/db-data-admin-domain-ownership.md)
and run `node scripts/check-domain-ownership.mjs`.

## 0.3 The grid column Multi Filter already exists — reuse it, don't rebuild it

DB Data Admin's grid headers already implement the **AG Grid Multi Filter
equivalent (Text Filter + Set Filter with a searchable checkbox list of distinct
values)**. The reusable, framework-free logic is
`apps/db-data-admin/src/lib/grid-filters.ts`; the React header UI is
`FilterHeader` in `apps/db-data-admin/src/DataAdmin.tsx`.

Before building any column-filter UI in ANY POP app, read
[`docs/db-data-admin-column-multi-filter.md`](docs/db-data-admin-column-multi-filter.md).
A 2026-07-23 audit of the Markdown in all 28 `u2giants` repos confirmed this is the
org's **first and only** reusable Text+Set filter logic — PopCRM's `DataTable` is
bespoke and legacy, and PopDAM's `filterable-table-head.tsx` is text-only. If a
second app needs this, promote `grid-filters.ts` into a shared package instead of
copy-pasting it a third time.

Do not "add set filters later" — they shipped. Older text in `DB_Data_Admin.md`
that described set filters as future work refers to the pre-2026-07-23 design.

## 0.4 Master Data (style tracker) editing is OPEN to every signed-in user — by design

**`public.style_tracker_rows` INSERT/UPDATE are intentionally permissive
(`using (true) with check (true)`, any authenticated user). That is the whole point
of the Master Data / Styles grid at `dam.designflow.app/styles` — the team edits it.
Do NOT "harden" this policy.**

This is not an oversight and not a security hole, even though it looks like one next
to `public.assets` and `public.style_groups` (which DO require
`has_role(auth.uid(),'admin')` and should stay that way).

Learned the hard way on **2026-07-26**: an AI session provisioning role-tiered DAM test
accounts noticed a "viewer" could edit Master Data, judged it a gap, and shipped
`20260726190000_style_tracker_rows_restrict_writes.sql` restricting writes to
admin/administrator/designer/licensing. That locked **all 33 plain `user` accounts** out
of Master Data — i.e. it broke the feature for essentially the entire company. Reverted
the same day by `20260726200000_style_tracker_rows_restore_open_writes.sql`.

Two traps that made it look safe to tighten:
- `public.style_tracker_audit_log` was **empty**, which reads as "nobody edits this."
  It is empty because the audit trigger is recent and backfills ran with it disabled —
  NOT because the grid is unused. Do not use that table as a blast-radius proxy.
- PopDAM's own role enum (`public.app_role`) has only `admin | user`. There is no
  "editor" role to grant, so restricting writes to admins is not a smaller change —
  it removes the capability from every non-admin.

If a genuinely read-only DAM tester is needed, express it with the **app-schema** roles
that gate the shared `api.*`/`dam.*` contracts. Never narrow `style_tracker_rows`.

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

## 4. The five anti-collision rules (shared database)

1. **One schema change in flight at a time.** Before starting database work,
   check whether another change is already in progress (§6). If so, finish or
   land that one first, or coordinate with the owner. Two simultaneous schema
   edits are the number-one cause of a broken shared database.

   **Do not judge this by reading documents — run the check.** It compares what
   you intend to write against every open `db-claim` and every open pull request:

   ```bash
   node scripts/check-dispatch-collision.mjs \
     --task "<what you are about to do>" \
     --objects "<every object you will WRITE, comma-separated>" \
     --allocate-version
   ```

   Exit `0` safe (file the claim it prints, then start), `1` collision (**stop**),
   `2` undetermined (**stop**, or proceed READ-ONLY). **If you cannot list the
   objects up front, your task is read-only** — and read-only work cannot
   collide. Close your claim when the work merges or is abandoned; an open claim
   is a lock on those objects, not a note.

   This runs BEFORE the work. The `Cross-PR object collision` CI check is the
   backstop AFTER it, and by the time that one fires, somebody's session is
   already wasted — on 2026-07-31, three of four were.
   **The concrete symptom when this rule is broken:** the preview branch is
   persistent, so its ledger holds every branch that ever ran `db push` —
   including unmerged ones. A `main`-based checkout then cannot dry-run against
   preview at all; it aborts with `Remote migration versions not found in local
   migrations directory` and suggests `supabase migration repair --status
   reverted …`. **Never run that repair** — those rows belong to another team's
   applied work, and clearing them leaves the objects in place so their next
   push collides. Land or coordinate the other branch instead. Full procedure:
   [`docs/ai-session-instructions/shared-supabase-branch-workflow.md`](docs/ai-session-instructions/shared-supabase-branch-workflow.md)
   → "When preview holds another workstream's unmerged rehearsal". A migration
   left rehearsed-but-unmerged blocks everyone, so **open its PR the same
   session** (seen 2026-07-27: 17 PopPIM migrations blocked all preview
   dry-runs until PR #271 landed).
2. **Preview database first. Production never receives untested schema.** Apply
   every migration to the preview branch (`rjyboqwcdzcocqgmsyel`), prove it
   works, *then* promote to production (`qsllyeztdwjgirsysgai`).
3. **Additive by default (expand, then contract).** Adding a column or table
   cannot break another app. **Renaming or dropping** one that another app reads
   *will*. Default to additive changes. Only rename/drop after explicit owner
   sign-off and a checked deprecation across all dependent apps.
4. **New timestamped migration files only.** Each change is a new
   `YYYYMMDDHHMMSS_*.sql` file. Never edit a migration that has already been
   applied anywhere — that is how two sessions silently clobber each other.
5. **Never reuse a timestamp — a duplicate SILENTLY SKIPS a migration.**
   Supabase's ledger (`supabase_migrations.schema_migrations`) keys on the
   **version (the timestamp) alone — not the filename**. If two migrations share
   one timestamp, whichever applies first claims that version and **the other is
   treated as already-applied and never runs**. No error, no warning.
   *This actually happened (2026-07-22):* `20260722220000` was used by BOTH the
   PopSG trigram-index migration and the Sample Tracking
   `restore_dflow_sample_shipment_item` migration. Production recorded 220000 as
   the PopSG one and skipped the table restore, so `dflow.sample_shipment_item`
   never existed in production and the whole dependent feature (movements,
   closeouts, views) could never apply — while the ledger claimed success.
   *It happened again (2026-07-28):* `20260728160000` was used by BOTH
   `clickup_incremental_task_import` and `popdam_user_tables_foreign_keys`. See
   the second-order failure below.
   **This is now enforced in CI** — `scripts/check-sql.sh` fails the PR on any
   duplicate version, so you no longer have to remember the manual check
   (`ls supabase/migrations | cut -c1-14 | sort | uniq -d`, which must print
   nothing). **Before trusting a migration:** confirm the OBJECT exists
   (`to_regclass`), never just the ledger row.

   **A duplicate has a SECOND failure mode that outlives the skip: it blocks
   every future push.** The ledger holds one row per version, so the CLI matches
   that row to one of the two files and reports the other as pending *forever*.
   Every `supabase db push` then tries to re-insert the version and aborts:

   ```text
   ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
   Key (version)=(20260728160000) already exists.
   ```

   `supabase migration list` shows it plainly — the same version twice, once
   matched and once with an empty REMOTE column.

   Fixing a collision — choose by whether the loser's content has landed yet:
   - **Not yet applied anywhere:** re-timestamp the loser (pure rename) so it
     sorts after the winner, keeping dependent migrations in order.
   - **Already landed via a later re-issue:** **delete** the superseded file.
     Re-timestamping it would apply stale DDL *after* the newer fixes and
     `create or replace` the corrected objects back to their old bodies. This
     was the 2026-07-29 resolution for `20260728160000`: the ClickUp half had
     been re-issued as `20260728174500` and then fixed by `20260728181500`, so
     renumbering it would have reverted the fixes.

   Deleting the loser is safe for the ledger **only because the winner keeps the
   version** — the CLI still finds a local file for every `schema_migrations`
   row, so it does not abort with `Remote migration versions not found in local
   migrations directory`.

## 4.1 App-specific attributes go in per-app extension tables (decided 2026-07-17)

When an app needs a field on a shared canonical entity (`core.customer`,
`core.factory`, etc.) that other apps don't care about, **do NOT add a column to
the shared `core.*` table.** Put it in a per-app **extension table** in that app's
own schema: `crm.customer_ext`, `dam.customer_ext`, `pim.factory_ext`, etc.

- **Shape:** 1:1 with the core row — `customer_id uuid primary key references
  core.customer(id) on delete cascade` (no surrogate id). A missing ext row means
  "all defaults"; consumers LEFT JOIN it.
- **RLS/grants:** the ext table lives in the app's schema and follows that app's
  existing policy pattern. Remember: an RLS policy is **not** a GRANT — a
  browser-writable app table needs both.
- **Views:** each app's own `api.*` view joins core + *its* ext table. Never one
  mega-view joining every app's ext tables.
- **A column stays on `core.*` only if** two+ apps need it, or it's
  identity/classification (name, status, domain, address), or it feeds cross-app
  joins/shared pickers. Provenance/sync bookkeeping stays in `core.*_source_ref`.
  No jsonb bags for structured fields; **no EAV, ever.**
- The grandfathered CRM-ish columns already on `core.customer`
  (`customer_status`, `chain_type`, `routing_aliases`, `so_patterns`, …) are left
  as-is — do not migrate them out now; just don't add more.

Full implementation guide (DDL template, per-app sections, rollout order):
[`docs/per-app-extension-tables-plan.md`](docs/per-app-extension-tables-plan.md).

## 4.2 OWNER RULING — prove which database you are connected to before any destructive statement (Albert Hazan, 2026-08-02)

> "agents should be required to prove which database they're connected to before any delete or update"
> — Albert Hazan, 2026-08-02

This is a standing rule, ruled by the owner. **It is settled — do not re-ask it, do not
treat it as an AI's preference, and do not weaken it.** (It was raised once before and the
owner did not answer; that non-answer was correctly recorded as *not* approval. He has now
ruled.)

**Why it exists.** It was proposed after a 442-row `DELETE FROM ingest.raw_record` ran
against **production** `qsllyeztdwjgirsysgai` on 2026-07-31 while the session believed it
was on preview. The owner has separately ruled that **that delete was intended and correct
and is NOT an incident** (§6.3) — no restore, no PITR, no corrective migration. The rule
exists because, to everyone watching, a correct delete on production was *indistinguishable
from an accidental one*: nothing in the record proved which database the statement hit. The
rule closes that evidence gap, not a mistake.

**The rule.**

1. **Before every `DELETE`, `UPDATE`, `DROP`, `TRUNCATE`, `ALTER`, or any other statement
   that writes, changes, or removes data, schema, or privileges (including `INSERT`, `GRANT`
   and `CREATE`), or any action that sets such a change in motion indirectly — calling a
   mutating function or RPC, a REST request, a script, a CI workflow, or asking another
   person, including the owner, to run it — in ANY environment, preview and production
   alike, the agent must prove which database the statement is about to run against. One
   proof covers everything submitted in the same tool call as the check or in the
   immediately following tool call (a batch, a migration file, a `db push`); it never
   carries further.** Preview being "the safe one" is not an exemption: the proof
   requirement is unconditional.
2. **"Prove" means an explicit check of the live connection target, executed immediately
   before the statement.** It is not an assumption, not a memory, not a check made earlier in
   the session, not a `.sql` filename, not a branch name, not a doc, not a plan that said
   "preview". Any tool call, environment change, reconnect, or turn boundary between the
   check and the statement invalidates the check — redo it.
3. **The proof must be stated in the agent's report** — the message it gives the owner (or
   the coordinator) at the end of the turn — quoting the value it actually
   observed (the project ref or URL) and the statement it authorised. A report of a
   destructive statement without a quoted, immediately-preceding target proof is an
   incomplete report.

**The concrete mechanisms this repo has — use these, not a substitute:**

- **Supabase MCP:** call `get_project_url` **FIRST**, in the same turn, immediately before
  the statement. Note the trap: `get_project_url` takes **no project parameter** — it
  reports whatever project the MCP server is bound to, and in this repo that binding **may
  be PRODUCTION**. Passing a project ref to `execute_sql`/`apply_migration` does not make
  those tools target it; the server binding wins. This is exactly why the check must be a
  call, not an inference.
- **CLI / `psql` / Node `pg` work:** read `cat supabase/.temp/project-ref` and verify it
  **before EVERY push or connection**, not once per session. `supabase link` can be re-run
  by any other step, worktree, or concurrent session, so a ref read ten minutes ago proves
  nothing about the connection you are about to use.

**The two refs, in full — compare against these characters, not against "looks like preview":**

```text
Production: qsllyeztdwjgirsysgai
Preview:    rjyboqwcdzcocqgmsyel   (Supabase branch "shared-db-schema-rehearsal")
```

**Trap that has misled sessions:** preview is a Supabase **branch**, not a standalone
project, so `rjyboqwcdzcocqgmsyel` **does not appear in `supabase projects list`**. Its
absence from that listing is evidence of nothing — it is not proof that you are on
production, and it is not proof that preview is gone. Use `supabase branches list` /
`list_branches` if you need to see it, and use the checks above to establish where you
actually are.

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

### 5.1 Promoting to production when a backlog exists — NEVER `--include-all` on the full repo set (learned 2026-07-23; recipe corrected 2026-07-27)

Production almost always has **pending migrations from other workstreams that sit *before* your
own** (e.g. DB Data Admin write paths, DAM taxonomy cutover, PopSG — several deliberately
unpromoted). When that is true, `supabase db push` **refuses to run** and suggests
`--include-all`. **Do not use `--include-all`** — it promotes *every* pending migration at once,
including work another team has deliberately kept off production.

Apply **only your own** migration with a bounded temp checkout:

1. `git worktree add --detach <tmp> origin/main`
2. In the temp checkout, delete **only the PENDING migration files you are not promoting**
   (repo copy is untouched — you only shrink the local set the CLI compares).
   **Do NOT delete the already-applied files.** The CLI compares the local folder against
   *every* `schema_migrations` row, so removing applied files makes `db push` abort with
   `Remote migration versions not found in local migrations directory` and suggest
   `supabase migration repair --status reverted …` — do **not** run that repair; restore the
   files instead (`git checkout -- supabase/migrations`, then delete just the pending ones).
   *(Corrected 2026-07-27 — "delete everything except your own file" does not work.)*
3. `supabase link --project-ref qsllyeztdwjgirsysgai --password "$PROD_DB_PASSWORD"`
4. `supabase db push --dry-run` → **confirm it lists only your migrations**.
   If your file sorts *before* the remote max, the dry run says "Found local migration files to
   be inserted before the last migration on remote database" and asks for `--include-all`.
   **In this bounded temp checkout that flag is the correct and safe way to finish** — the
   migrations you must not promote are no longer on disk, so it cannot reach them. Run
   `supabase db push --include-all --dry-run` first and confirm it names **exactly** your files,
   then drop `--dry-run`. The §5.1 prohibition is on `--include-all` against the **full repo
   set**, never against a verified bounded set.
5. Verify the real objects in the DB (`pg_constraint`/`pg_trigger`/`pg_get_viewdef`), **not** just
   `supabase_migrations.schema_migrations` — the ledger can record a migration whose object is
   absent (seen on preview 2026-07-23).
6. Remove the temp worktree.

Two traps: (a) "pending" is **not** "filename version > remote max" — production had gaps far
below its highest version; diff the full local file list against every `schema_migrations` row.
(b) This shared working copy is actively churned by other sessions — its branch and untracked
files shift between turns; do sensitive git work (branch off `origin/main`, apply) in a dedicated
`git worktree`, not the main checkout.

A third habit worth breaking: **promote the original file — do not hand-copy it into a new
"bounded forward" migration.** Copying the SQL under a fresh timestamp does reach production,
but the original stays pending forever and hundreds of lines get duplicated. Two sessions did
this in July 2026 (`20260723183000_step11_bounded_production_forward.sql`,
`20260727154500_db_data_admin_bounded_production_forward.sql`), which is why three already-live
migrations still had to be replayed as no-ops on 2026-07-27 just to close the ledger gap. Full
worked example, including the verification queries:
[`docs/migration-backlog-triage-2026-07-27.md`](docs/migration-backlog-triage-2026-07-27.md).

### 5.2 A red check on `main` can be a STALE verdict — the domain-ownership guard scans more than its trigger watches (learned 2026-07-31)

**Read this before you debug a failing check on `main`.** The `DB Data Admin` workflow
(`.github/workflows/db-data-admin.yml`) has a `verify` job whose first step,
*"Enforce DB Data Admin domain ownership"*, runs `scripts/check-domain-ownership.mjs`. That
script enumerates **every tracked text file** in the repo via `git ls-files` — all `.md`,
`.yml`, `.json`, `.mjs`, `.ts`, `.html`, `.css`, … including `HANDOFF.md`, `docs/**`,
`supabase/**` and the workflow files themselves.

But the workflow's `on: pull_request` / `on: push` `paths:` filter lists only:
`apps/db-data-admin/**`, `AGENTS.md`, `DB_Data_Admin.md`, `README.md`,
`docs/db-data-admin-domain-ownership.md`, `scripts/check-domain-ownership.mjs`,
`.github/workflows/db-data-admin.yml`.

**The scanner is repo-wide; the trigger is narrow.** So a violation can be introduced by a file
the filter ignores (e.g. `HANDOFF.md`) and get flagged the next time the workflow happens to
run — and, worse, *fixing that file does not re-run the workflow*, so `main` keeps displaying the
old failure forever.

Both halves were proven on 2026-07-31:

- **PR #328** corrected the offending wording in `HANDOFF.md` and merged as `53f849f`.
  **No workflow run fired at all.** `main` stayed red on the stale result.
- **PR #307**, an unrelated docs edit to `AGENTS.md` (which *is* in the filter), merged as
  `f1b9e8b` and **did** trigger the run — which passed. That, not the actual fix, is what turned
  `main` green.

**How to recognise it.** Either symptom means "stale verdict", not "still broken":
(a) a red check on `main` whose reported content is already corrected in the current tree —
check the run's commit SHA, not just the red X; or (b) a guard that never fires on a file you
know it scans.

**How to respond.**

1. Don't re-fix code that is already correct. Re-run the check against the current tip: use
   `gh workflow run` (manual dispatch) where the workflow allows it, or `gh run rerun <id>`
   against the newest run, or push a no-op touch to a file that *is* inside the `paths:` filter
   (`AGENTS.md` is the usual one).
2. Confirm green against the **current** `main` SHA — `gh run list --branch main --limit 5`
   shows which commit each verdict belongs to.
3. **When adding any repo-wide checker, make its trigger cover everything it scans.** If the
   checker rides inside a heavy job, split it into its own cheap workflow rather than widening
   the heavy job's filter — see the note below.

The obvious fix here (adding `HANDOFF.md` and friends to the filter) is **not** safe as written:
that same filter also gates the `container` build, Playwright browser tests and the Coolify
`deploy-development` job, so widening it would run a full build-and-deploy on every unrelated
docs PR. The correct permanent fix is a separate, tiny `domain-ownership` workflow with no
`paths:` filter, running only the two `node` commands. Not yet built — do it the next time this
bites.

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

**Which entities are on ColdLion vs. still on DesignFlow?** Do not re-derive this by
querying — it has cost multiple sessions already. The answer, with row counts, blockers,
and the `plm.*_import` vs `plm.erp_*` naming rule, is in
[`docs/master-data-cutover-scoreboard.md`](docs/master-data-cutover-scoreboard.md).
Short version: **customer and vendor are cut over to ColdLion; licensor and property are
not** (and `plm.licensor_import` / `plm.property_import` are DesignFlow staging, *not* a
ColdLion mirror — a previous session got this wrong).

### 6.1 Merch groups / licensors / properties — read this before touching them

Anything involving licensor, property, big theme, little theme, style guide, art type,
art source, artist, age group, or `mgTypeCode` must start at
[`docs/merch-group-taxonomy-architecture.md`](docs/merch-group-taxonomy-architecture.md).

For the active ColdLion Licensor/Property source cutover, read the STATUS table in
[`plan_coldlion_licensor_property_accelerated_cutover.md`](plan_coldlion_licensor_property_accelerated_cutover.md)
before re-deriving or re-planning anything.

**Step 7A (the real recurring feed) is BUILT and preview-proven as of 2026-07-29; the next action
is Step 8, Albert's production approval.** Two rules that catch sessions out:

- **A one-time 542-link run is NOT the feed switch.** The recurring lane is
  `.github/workflows/coldlion-licensor-property-production.yml` (production-only, currently
  **DISABLED**), driven by `tools/promote-coldlion-source-owned.mjs` in mode
  `promote_source_owned`. It is the deliberate mirror image of the preview-only
  `coldlion-licensor-property-phase6-parallel.yml`: each hard-refuses the other's project.
  **Never edit one into the other.**
- **Do not "simplify" the promotion collision rule.** Quarantining any canonical row reachable
  from more than one typed key quarantines **542 of 542 approved rows — the entire feed** —
  because the approved mapping deliberately fans 542 source rows into 271 canonical rows. Fan-in
  quarantines only when the arms propose *different* names. This is enforced by a regression test.

- **A skipped promotion cycle is NOT a failed one.** Since 2026-07-31 the promotion is
  serialized by transaction-scoped advisory lock `720260729` (registry:
  [`docs/advisory-lock-registry.md`](docs/advisory-lock-registry.md)), because the scheduled
  lane and a manual drill could otherwise promote the same rows at once and leave an
  unreadable audit trail. A caller that loses that race records an `ingest.sync_run` row with
  `status = 'cancelled'` and `metadata.outcome = 'skipped_already_running'`, and the runner
  exits **3**. Never "tidy" that into `failed` or into exit 1: the two-consecutive-**failed**-row
  `pg_notify` breaker in `tools/coldlion-sync-common.mjs` would then trip on two perfectly
  healthy overlapping cycles and block promotion until an authorized reset.

Evidence and the full defect list:
[`docs/verification/coldlion-licensor-property-step7a-recurring-feed-20260729/README.md`](docs/verification/coldlion-licensor-property-step7a-recurring-feed-20260729/README.md). Albert decided on 2026-07-26 to replace the original
14-day elapsed-time gate with an invariant-based readiness gate plus rapid post-cutover monitoring.
The existing production prohibition remains in force until that plan's preview rehearsal,
readiness, and explicit production-approval gates pass.

For **PopSG folder-derived Property matching and reconciliation**, the single
bounded execution plan is
[`fix_popsg_property_taxonomy_reconciliation.md`](fix_popsg_property_taxonomy_reconciliation.md).
It applies the ColdLion and style-guide architecture decisions without replacing
either authority document. Its phases are named `PSG-0` through `PSG-7` to
avoid collision with ColdLion phases. `PSG-0`–`PSG-4` are preparation only;
`PSG-5` requires a recorded ColdLion checkpoint and owner sign-off, and `PSG-6`
must not overlap ColdLion Phase 7.

**If your work touches characters, style guides, or royalty rates, read
[`docs/style-guides-characters-and-royalties.md`](docs/style-guides-characters-and-royalties.md)
FIRST.** It documents a layer the merch-group doc does not cover. There are **two axes, and chaining
them is the classic bug**: ownership is linear — **Licensor → Property → Character** (a
character has exactly one property) — while style is many-to-many — **a style guide holds many
characters and a character appears in many style guides**. A style guide is *not* a level
between property and character. The legacy table
`dflow.properties_and_characters` is misleadingly named — its `type='PROPERTY'` rows are
**style guides**, not properties, and its `type='CHARACTER'` rows are character *appearances*
(one per style guide), not distinct characters — those 9,622 rows are the **style-guide ↔
character bridge**, not a character list. Batman is one character, under one property, appearing
in 15 style guides, each with its own external id. That doc also records the Marvel-only +2% talent-likeness
royalty rule and the fact that likeness attaches to a **style guide asset (file)**, never to a
character. Two AI sessions have already corrupted their understanding by reading those column
names literally — do not be the third.

The three rules that cause the most damage when ignored:

1. **`mgTypeCode` has no fixed meaning.** `05` is Licensor in CW001/SP001 but "Big Theme" in
   EH001 and "Product Line" in EP001. Always resolve through
   `(divisionCode, mgTypeCode) → mgTypeDesc`. Keying on the number alone corrupts the taxonomy.
2. **Coldlion has no licensor→property relationship and no active/inactive flag.** Both are
   DesignFlow-owned. A direct Coldlion sync cannot reproduce either.
3. **Merch-group codes are unique only within `(division, mgTypeCode)`.** `FR` is a licensor
   in our DB and a *property* in Coldlion. Never look up by `mg_code` alone.

### 6.2 Coldlion `/vendors` — wrong table, now FIXED upstream (2026-07-22)

`core.factory` = **merchandise vendors (factories)**. Coldlion's `/vendors` endpoint was returning a
mixed population (factories PLUS freight/government/banks/couriers/real-estate). **Coldlion corrected
it 2026-07-22 — `/vendors` now serves 97 factory-only records.** This is **DONE** (2026-07-22):
`core.factory` reconciled to **93 rows (91 active / 2 inactive)** (`fix_vendor_reconcile.md`), the silver
mirror `plm.erp_vendor` refreshed to 97 (migration `20260722171500`), and a **guarded recurring importer**
is live — `plm.sync_coldlion_vendors` via `public.sync_coldlion_vendors`, with `plm.vendor_exclusion`
(435 seeded) + `plm.vendor_quarantine`, status app-owned (set on INSERT only), upsert by
`(source_system,source_table,source_id)` (migration `20260722213000`). **Never re-introduce the old
`plm.import_coldlion_vendors` pattern** (it clobbered curated status; it was dropped). Recurring
**scheduling (Phase B — Edge Function + alerting) is NOT built yet**; the importer runs on demand. Full
design/state: [`fix_vendor_sync.md`](fix_vendor_sync.md). Detail:
[`docs/coldlion-erp-api-reference.md`](docs/coldlion-erp-api-reference.md) (✅ box).

### 6.3 OWNER RULING — Coldlion ERP data is canonical (Albert Hazan, 2026-07-31)

> **Coldlion ERP data is canonical.** When Coldlion inactivates or removes a vendor, property or
> licensor, **follow it** — do not preserve the old value on the grounds that the raw/bronze record
> is immutable. Ruled by Albert Hazan, 2026-07-31.

Why this is written down: on 2026-07-31 a session deleted 442 ColdLion vendor rows from bronze
`ingest.raw_record` on **production** `qsllyeztdwjgirsysgai` (539 → 97 surviving rows;
`pg_stat_all_tables.n_tup_del` for `ingest.raw_record` reads exactly 442). The owner reviewed it and
confirmed it was **intended and correct** — those vendors had been inactivated in the ERP. **This is
not an incident. Do not propose a restore, a PITR, or a corrective migration for it.**

**What this ruling supersedes.** Two migrations that are already **applied to production** carry
comments asserting the opposite. They are applied, the ledger records their versions, and the CLI
will never re-run them — so **do not edit them**; editing changes nothing in the database and
desynchronises file from ledger. Read them as historical, and read this ruling as the current
policy:

| Applied migration | Stale comment it carries |
| --- | --- |
| `20260722171500_refresh_erp_vendor_mirror_to_corrected_vendors.sql` | "Bronze `ingest.raw_record` is intentionally left untouched — it is the immutable [record]" |
| `20260722213000_vendor_sync_guarded_importer.sql` | "Bronze `ingest.raw_record` still holds the original payload"; "Bronze: always land the raw row (nothing is ever lost)" |

Scope note: this ruling is about **ColdLion-sourced master data** (vendors, properties, licensors)
following the ERP. It does **not** relax the append-only rule for **evidence and audit** tables
(`plm.coldlion_promotion_audit`, `plm.coldlion_promotion_quarantine`,
`plm.taxonomy_parallel_observation`, `plm.taxonomy_circuit_breaker_event`,
`app.db_data_admin_audit_event`) — those stay append-only and must not be deleted.

### 6.4 OWNER RULING — the Master Data import is TRANSITIONAL, and curated data outranks it (Albert Hazan, 2026-08-03)

> "importing Master Data info from Google Sheets is a temporary thing until all the employees
> are ready to do all work in our Master Data and then Google Sheets version gets deprecated
> and never touched again. so any improvements we've made should no longer be overwritten by
> the imports from Google Sheets. those imports should only be data that gets us up to date
> until we're ready to cut-over (hopefully soon)."
> — Albert Hazan, 2026-08-03

This is a standing rule, ruled by the owner. **It is settled — do not re-ask it, do not treat it
as an AI's preference, and do not weaken it.**

**The rule, in three parts.**

1. **The import is transitional, not an integration.** It exists only to carry us to cut-over,
   after which the spreadsheet-era source is **deprecated and never touched again**. Do not
   build durable architecture on it, do not extend it, and do not design any long-lived feature
   that assumes it keeps running. When a choice is between hardening the import and shortening
   the road to cut-over, choose cut-over.
2. **Curated beats imported — our Master Data is the winner.** An import may **never** overwrite
   an improvement made in our Master Data. It is a **catch-up feed**: it may fill a gap and
   bring in a record we do not have, and it may create a new row. It may **not** revert, reset,
   re-parent, rename, or re-status anything a human has deliberately set here.
3. **Direction of authority is per FIELD, not per row.** Decide field by field. **On a MATCHED
   row**, the question for each field is only "has a human deliberately set this here?" — if
   yes, the import loses that field, even while it wins the neighbouring fields on the same
   row. A **matched** row is never wholly imported or wholly curated. (A genuinely new row is
   the separate case governed by the row-level rule below.)

**The two loopholes to close, not to use.**

**Field level — "it was missing, so I filled it."** An importer must not be free to *decide* that
a field was merely absent. **Absence is not a licence.** A field counts as deliberately set — and
is therefore off-limits to the import — whenever a human touched it, including when the human's
decision was to set it to `NULL`, to `inactive`, or to blank. That means the "deliberately set"
state must be **recorded**, not inferred from the current value: a value that happens to equal
the default is not evidence that nobody chose it. An importer that cannot tell curated from empty
must abstain, not guess.

**Row level — "we don't have this record, so I created it."** The same dodge works one level up:
fail to match an existing curated row, declare it absent, and INSERT a fresh, fully-imported
duplicate. That defeats curation just as completely — the curated original is orphaned while a
new `active` row supersedes it — and it is **not** what "bring in a record we do not have"
licenses. **An importer must justify "we do not have it" as rigorously as "this field was
unset."** If the matching keys disagree — if one lookup key finds a row that another key would
not — that is a **possible match, not an absence**: quarantine it as evidence for a human, and
never resolve it by inserting.

**What this means in practice TODAY.** No per-field curation record exists in this database, and
no importer can currently tell curated from untouched. So the operative rule right now is not
advisory: **an import writes a curated field only on INSERT of a genuinely new row, and writes no
curated field at all on a matched row.** Gap-filling a matched row becomes permissible only once
"deliberately set" is recorded per field and the importer actually consults that record.

**This ruling is currently VIOLATED in production — read before running any import.**
`plm.import_master_data(jsonb, jsonb)` on production (`qsllyeztdwjgirsysgai`) force-sets
`core.property.licensor_id`, `core.licensor.status = 'active'` and `core.property.status =
'active'` on every matched row of every re-pull. The corrective migration
`20260802170000_plm_import_preserve_curated_licensor_property_status.sql` is merged to `main`
but is **NOT applied to production**. Until it is, a single re-run silently reverts every
curated ruling, **including the 2026-08-02 FRIENDS TV / FRIDA KAHLO decision (§6.3 neighbours)**.
The daily `systemd/plm-sync.timer` lane still exists; it has simply not succeeded since
2026-07-08. **Do not run, re-enable, or repair that lane before the fix is applied.**
Full evidence, every overwrite path, and the scoped proposal (not an implementation):
[`docs/google-sheets-import-authority-20260803.md`](docs/google-sheets-import-authority-20260803.md).

**The compliant reference already exists — copy it, do not reinvent it.** `plm.sync_coldlion_vendors`
refreshes non-status fields only and states in-line that status/name are app-owned;
`tools/promote-coldlion-source-owned.mjs` documents an explicit can/cannot list and refuses
`core.property.licensor_id`, lifecycle status and canonical codes outright. That shape is what
honouring this ruling looks like.

**Scope note.** Albert names "Google Sheets". No importer in this repository carries that name;
the live mechanism that carries this Master Data content is the DesignFlow PLM master-data pull
(`getLicensorsWithProperties` / `getCustomers` → `plm.import_master_data`). This ruling is
recorded as governing **any catch-up import into Master Data**, which is the behaviour he
described. Whether he also intends a separate spreadsheet-era feed outside this repo is the one
open scoping question and is flagged in the linked document — it does not soften the rule for
the importer we do have.

**Relationship to §6.3 (ColdLion ERP data is canonical).** These do not conflict; they cover
different sources. ColdLion is a **system of record** we follow, so a ColdLion inactivation is
authoritative. The Master Data import is a **transitional catch-up feed** with no such standing,
so it never outranks curation. If a future source claims both roles, that is an owner question,
not an agent's judgement call.

#### 6.4-C CORRECTION — the "Google Sheets import" is an AI SESSION, not a pipeline (Albert Hazan, 2026-08-03)

**This subsection corrects the SCOPE of §6.4 above. Everything above stands; this widens what it
binds. The "Scope note" above — which flagged that no importer in this repository carries the name
"Google Sheets" and left that as the one open scoping question — is now ANSWERED. Do not re-open it.**

> "Google Sheets imports are just done when i open an ai session and tell it to take the data from
> Google Sheets and dump it into our Master Data"
> — Albert Hazan, 2026-08-03

**What this changes.** The thing §6.4 governs is not a coded pipeline with a schedule, a repo file,
a workflow, or a code path anyone can review. It is **an AI session performing ad-hoc writes on
instruction**. The search for "the Google Sheets importer" was therefore looking for an artefact
that does not exist and never will.

**The corrected rule.**

1. **§6.4 binds AI SESSIONS DOING AD-HOC DATA LOADS, not only automated importers.** An agent told
   to "take this spreadsheet and dump it into Master Data" is squarely inside §6.4 and is the
   *primary* addressee of it. Read every occurrence of "the import" and "an importer" in §6.4 as
   including **you, right now, typing the statement**. There is no "I am not an importer" exemption.

   **The trigger is the SOURCE, not the verb, and it is not yours to adjudicate.** §6.4 binds you
   whenever the content you are about to write into Master Data (`core.licensor`, `core.property`,
   `core.character`, `core.customer`, `core.factory` and their `*_ext` tables) **originated outside
   this database** — a spreadsheet, a CSV, an export, a pasted block of rows, a screenshot, a chat
   message, an API pull. It is irrelevant whether you call it a load, a dump, an import, a sync, a
   backfill, a correction, a cleanup, a one-off, or "just applying what Albert sent me". It is
   irrelevant whether you write one row or ten thousand, and irrelevant whether you use INSERT,
   UPDATE, MERGE, an RPC, or a migration. **None of these labels create an exemption; only §6.4's
   own INSERT-a-genuinely-new-row allowance does.** If you find yourself reasoning about whether
   your activity counts as an "import", the answer is yes.

   **"The spreadsheet IS the curation" is not an exit either.** A human saying "the team curated
   this sheet, put it in" does not convert outside content into curated data. Curation, for the
   purposes of §6.4, is a decision recorded **in this database**. A claim about a spreadsheet's
   provenance is exactly the kind of unverifiable assertion §6.4 exists to stop you from acting on.
   The only thing that changes this is an owner ruling naming the specific rows, recorded here or
   in `core.taxonomy_owner_ruling`.
2. **The operative rule of §6.4 applies to you unchanged:** on a **matched** row you write **no
   curated field at all**; you may INSERT a genuinely new row; and you must justify "we do not have
   this record" as rigorously as "this field was unset". If your lookup keys disagree about whether
   a row exists, that is a **possible match — quarantine it as evidence for a human, never resolve
   it by inserting**. Since no per-field curation record exists in this database, an ad-hoc session
   has **no way to tell curated from untouched** and must therefore abstain on every matched row.

   **Two clarifications, because the wording above has been read loosely.**
   - **"No curated field at all" means, TODAY, no field at all.** The abstention sentence is the
     operative one, not a summary of the first. Because nothing in this database records which
     fields a human set, you cannot identify a non-curated field, so **on a matched row an ad-hoc
     session writes NOTHING**. "I did not believe that field was curated" is not compliance — the
     rule already tells you that you cannot form that belief.
   - **You do not get to pick a weak matching key.** "If your lookup keys disagree" is not
     permission to use one key and never see a disagreement. Before you may claim a row is absent
     you must probe **every identifying key the entity has** — canonical code, name (normalised:
     case, whitespace, punctuation), any alias table (`core.licensor_alias`), and
     `core.taxonomy_source_ref` — and get a miss on **all** of them. A hit on any one is a match. A
     disagreement between any two is a quarantine. Anything less is not "we do not have this
     record", it is an unexamined guess, and the resulting INSERT duplicates a curated row and
     silently supersedes it downstream — the row-level loophole §6.4 already names.
3. **The control cannot be code review — there is no code.** It is (a) this rule, which the agent
   reads and follows, and (b) wherever it can be built, **database-side protection that does not
   care who is writing** — a constraint, trigger, or `SECURITY DEFINER` write function that refuses
   the curated columns regardless of caller. Prefer (b) over (a) whenever (b) is available:
   a rule an agent can forget is weaker than a database that says no. Building (b) is in-scope
   work for a future session; until it exists, (a) is all that stands between a spreadsheet dump
   and every curated ruling in Master Data.
4. **§4.2 interacts directly with this and is not optional here.** An ad-hoc spreadsheet dump is
   precisely the shape of operation §4.2 exists for: bulk writes, typed by hand, in a session that
   believes it knows which database it is on. **Prove the connection target immediately before every
   statement §4.2 covers** — that is §4.2's own scope, unchanged and not widened here: every write,
   change, or removal of data, schema, or privileges, including `INSERT`. §4.2's batching allowance
   applies as written (one proof covers what is submitted in the same tool call as the check or the
   immediately following one), so a single dump does not need a proof per row — it needs a proof per
   submission, and any tool call, reconnect, or turn boundary in between invalidates it. Quote that
   proof in your report. A spreadsheet dump aimed at preview that lands on production
   `qsllyeztdwjgirsysgai` is unrecoverable in exactly the way §4.2 describes.

**What has NOT changed.** §6.4's three parts, its two loopholes, the production violation warning
(`plm.import_master_data` still force-sets curated status on production; `20260802170000` is merged
but **not applied there**), and the compliant reference implementations all stand exactly as written
above. This subsection adds addressees; it removes nothing.

### 6.5 OWNER RULING — PR #408 is HELD and ships as one production change with the FR removal work (Albert Hazan, 2026-08-03)

> "hold it and ship it together with the removal work"
> — Albert Hazan, 2026-08-03, answering whether to promote the two merged migrations
> `20260802170000` (durable curated licensor/property status) and `20260802171000`
> (the FRIENDS TV / FRIDA KAHLO ruling) to production now, or hold them and combine them
> with the `FR` removal work as ONE production change.

This is a standing decision, ruled by the owner. **It is settled — do not re-ask it, do not treat
it as an AI's preference.**

**What is forbidden, stated so it cannot be read narrowly:** **neither `20260802170000` nor
`20260802171000` may reach production by ANY route until the FR removal work is ready to go with
them.** Not alone, not as a pair, not as part of a wider backlog sweep, not via `--include-all`, not
re-issued under a fresh timestamp as a "bounded forward" copy (§5.1 already forbids that habit
separately). The permitted event is exactly one: a single bounded production apply that carries
`20260802170000`, `20260802171000` **and** the removal migrations together, in dependency order.

**Why this is the right answer, so a future session does not "helpfully" unblock it.**

- Albert's ruling on `FR` "FRIENDS TV" is that it **was never a real licensor and must be REMOVED**
  — not kept, not merely flagged. FRIENDS has always been a *property* under `WB` WARNER BROS, so
  genuine FRIENDS items already have a correct home.
- Migration `20260802171000` sets `core.licensor` `FR` to **`status = 'inactive'`**. That is a
  *different remedy*, written before the removal ruling existed, and the removal ruling
  **supersedes** it.
- So promoting #408 alone would change production master data **twice**: once into `inactive` — a
  state the owner has said he does not want — and again later into removed. Every production change
  here is **forward-only with no undo**; buying an extra irreversible step to reach a state nobody
  asked for is strictly worse than waiting.
- Combining them means production moves once, from today's state to the intended end state.

**How `20260802171000` reaches production without leaving `FR` inactive — read this before you
conclude the ruling is impossible.** `20260802171000` is applied on preview, so §4 rule 4 freezes
its text: it cannot be edited to drop the `inactive` statement, and it must not be skipped in the
ledger. It therefore **does** apply to production as written, inside the combined push. What the
ruling forbids is not the statement executing — it is production **coming to rest** in a state the
owner rejected. Inside one bounded `db push`, `FR` passes from `active` to `inactive` to removed
without ever being an observable steady state, and no application, sync, or human sees `FR` as an
inactive licensor. That is the "moves once" the ruling means: one promotion event, one end state.
An agent that promotes `20260802171000` on its own produces the forbidden thing — a production that
sits at `inactive`, indefinitely, until a second irreversible change.

**The consequence you must NOT report as a bug.** Until the combined change ships, **production and
preview DISAGREE about `FR`**: production has `FR` **active**, preview has `FR` **inactive**. This
divergence is **KNOWN, EXPECTED and ACCEPTED** — it is the direct result of this ruling. Do not
"fix" it, do not promote #408 to close it, and do not re-report it as drift, as a failed promotion,
or as an incident. It resolves when the removal work ships, and only then.

**What "the removal work" is.** A single ordered change in which nothing is orphaned at any step:
bring the real FRIDA KAHLO licensor in from ColdLion with proper `core.taxonomy_source_ref`
provenance; re-point property `FK` FRIDA KAHLO onto it; re-home **every remaining row that still
references `FR`** to its correct home — in practice the FRIENDS property under `WB`, which is where
anything genuinely about the TV series belongs (as measured on 2026-08-02, `FK` was the *only*
property under `FR`, with zero characters, so this step is expected to move nothing; **prove that
again at the time rather than assuming it**) — and **remove `FR` LAST, only after proving zero
dependents**. There is no judgement call hidden in the word "genuinely": `FR` was never a real
licensor, so **nothing** may remain pointed at it. The
curated-status durability of `20260802170000` must be in the same production change, or the data
corrections revert on the next PLM sync.

### 6.6 OWNER RULING — DB Data Admin is the home for licensor→property parentage (Albert Hazan, 2026-08-03) — this REVERSES the previous stance

> "DB Data Admin screen should be where we monitor and establish the licensor→property parent-child
> relationship. It sits in designflow now but we all agreed it should not be only in 1 particular
> application."
> — Albert Hazan, 2026-08-03

This is a standing rule, ruled by the owner. **It is settled — do not re-ask it, do not treat it as
an AI's preference, and do not weaken it.**

**This is a REVERSAL. The repository currently says the opposite in two places, and both are now
superseded by this section:**

| Where it still says the opposite | Exact text | Status |
| --- | --- | --- |
| `supabase/migrations/20260722170000_db_data_admin_single_record_updates.sql`, lines 36–38 | `-- Refused here: name/code (source vocabulary), is_potential (trigger-owned), PLM status (…), aliases, source refs, related Customer, Licensor/Property, merge, bulk, deletion.` | **Applied migration — DO NOT EDIT IT.** |
| `apps/db-data-admin/src/LicensorTree.tsx`, line 152 (orphan panel copy) | "The relationship is DesignFlow-owned; do not repair it here." | Superseded; correct by a FORWARD change when the curation path is built. |

Both were verified verbatim against the tree on 2026-08-03. Near-identical "the edge is
DesignFlow-owned" wording also appears in `20260722203000_db_data_admin_licensor_property_tree.sql`
(lines 11 and 382), in `20260727154500_db_data_admin_bounded_production_forward.sql` (line 1601),
and in `apps/db-data-admin/tests/browser/grid.spec.ts` (line 17). All of it is superseded as
**policy**; the migrations remain accurate as **history**.

**The never-edit-an-applied-migration rule still wins.** `20260722170000` is applied. An applied
migration never re-runs, so editing its text changes **nothing** in the database and desynchronises
the file from the ledger (§4 rule 4). **Leave it alone.** `AGENTS.md` — this section — is the
governing statement of policy. The application copy in `LicensorTree.tsx` and the behaviour it
describes are corrected by a **forward** change, authored when the curation path is actually built,
never by rewriting history.

**The rule.**

1. **DB Data Admin (`apps/db-data-admin/`, `https://data.designflow.app`) is the home for both
   MONITORING and ESTABLISHING the licensor→property parent-child relationship.** "Refused here" no
   longer describes the intended product; it describes the state of the code before this ruling.
   **"The home" means the cross-application curation surface, NOT an exclusive owner.** Albert's
   objection is to the capability living inside one *line-of-business application* (DesignFlow);
   DB Data Admin is the shared administrative surface over `core.*` that every app's data flows
   through, which is why it is the answer rather than a second lock-in. The authority that matters
   is the **curated data in `core.*`**, which any app may read; DB Data Admin is where a human
   establishes it. Do not read this section as a licence to forbid some future second curation
   surface, and do not read it as permission to leave the capability in DesignFlow.
2. **The relationship is no longer DesignFlow-owned.** Any doc, comment, UI string, or agent
   assumption that says "DesignFlow is the single writer of `core.property.licensor_id`, repair it
   there" is stale from 2026-08-03 onward.
   **This deposes DesignFlow as the OWNER, not as today's mechanism.** Until the DB Data Admin
   curation path actually ships, DesignFlow PLM remains the **interim writer of record** and a
   parentage repair made there is legitimate. Do not disable, block, or "clean up" the DesignFlow
   path on the strength of this ruling — that would leave no repair path at all (see rule 4).
3. **This does not by itself authorise a write path.** It sets the destination. The actual editing
   capability is new work: it needs a bounded write contract in the shape of §6.1/§4.2 (whitelisted
   typed parameters, optimistic concurrency, audit rows, the existing
   `app.db_data_admin_feature_gate`), plus durability so the PLM importer cannot revert it — see the
   related rulings below. **Do not ship a raw editable `licensor_id` column in the grid.**
   **The refusal in `20260722170000` is executable, not merely documentary.** That migration's
   comment records a refusal the shipped write contract actually enforces, so DB Data Admin will
   *reject* a parentage write today no matter what this section says. That is correct and expected
   — policy moved first, capability follows. **A rejection from that contract is NOT a bug to route
   around**, and it must never be routed around with direct SQL, a service-role write, or an ad-hoc
   session (§6.4-C forbids that last one outright). It is removed only by the forward migration that
   builds the new bounded contract.
4. **Until that path ships, here is the ONLY compliant way to repair a wrong parent** — stated
   explicitly because three rules read together otherwise appear to forbid every route. In order of
   preference: **(a)** fix it in DesignFlow PLM, still the interim writer per rule 2, and let it
   flow through; **(b)** if it cannot be fixed upstream, author it as a **shared-db migration** in
   this repo — branch, PR, preview first, §5 checklist — recording the human decision, and where the
   decision is the owner's, record it in `core.taxonomy_owner_ruling` too. A migration that encodes a
   named human's decision **is** hand curation, and is exactly what §6.5's removal work does for
   property `FK`; it is not the "inferred from product data" thing that is banned. What is never
   permitted is **(c)** an ad-hoc session typing the fix straight into Master Data. Note the
   durability caveat in rule 5 applies to (a) and (b) alike on production.
5. **Durability is not yet in force on production, and §6.5 deliberately holds the fix.**
   `20260802170000` — the migration that stops `plm.import_master_data` force-setting
   `core.property.licensor_id` — is merged but **held from production by §6.5** until the FR removal
   work ships. So on production today, any parentage set by any route is still reverted on the next
   successful PLM master-data sync. Two consequences: **do not treat "we have a durability
   migration" as "curated parentage is durable"** when scoping the DB Data Admin write path — the
   write path must not be enabled on production before `20260802170000` is applied there; and do not
   try to unblock it by promoting `20260802170000` early, which §6.5 forbids. (The lane has not
   succeeded since 2026-07-08 — see §6.4 — which is currently masking the problem, not fixing it.)

**How this sits with the related standing rulings.**

- **Parentage is HAND-CURATED, never inferred.** Albert ruled on 2026-08-03 that the
  property→licensor parent link must live in a curated Supabase table — which today **is
  `core.property.licensor_id`**, the existing canonical column; the ruling requires that it be set
  by hand, not that a new table be invented, and no session should design one on the strength of
  this wording — and must **never** be derived
  from product data. Item/style co-occurrence is an **audit tool only** — it may flag a suspicious
  parent for a human to look at; it may never set one. A curation *screen* is exactly what a
  hand-curated link requires, so the hand-curation ruling and this section point the same way.
  (Recorded in the
  coordinator intake as ruling 4.)
- **`dflow.*` is being retired; `core.*` becomes the source of truth for all applications**, fed
  from ColdLion as the ultimate upstream. (Recorded in the coordinator intake as ruling 6.)
  **§6.6 is the direct consequence of this.** If `core.*` serves every app, the surface on which
  humans curate `core.*` must not be locked inside one application — which is precisely Albert's
  "it should not be only in 1 particular application". Building further curation into DesignFlow
  would deepen a dependency the plan of record removes.
- **§6.4 protects the result.** Curated parentage set in DB Data Admin is exactly the kind of
  deliberate human decision an import may never revert or re-parent. Note that
  `plm.import_master_data` on production **still force-sets `core.property.licensor_id` on every
  matched row** (§6.4), so until `20260802170000` is applied to production, parentage curated
  anywhere — DB Data Admin included — is not durable there.

**The one question this section MUST answer: ColdLion says one parent, a human curated another —
who wins?** §6.3 makes ColdLion ERP data canonical; §6.4 makes curated data outrank imported data.
For **licensor→property parentage specifically, the curated value wins**, and this is not an agent's
judgement call — it follows from §6.1's rule 2, verified against the source: **ColdLion has no
licensor→property relationship at all.** It cannot state a parent, so there is nothing for §6.3 to
make canonical. Any parent that appears to come "from ColdLion" is in fact something a POP system
inferred — from `mgTypeCode`, `mg_code`, co-occurrence, or a prior guess — and inference is exactly
what the hand-curation ruling bans.

**This carves out ONLY the parent edge. §6.3 is otherwise untouched and still wins:** when ColdLion
inactivates or removes a licensor or property, **follow it**. Names, codes, and lifecycle status
remain ColdLion's. If ColdLion ever begins transmitting a genuine licensor→property relationship,
this carve-out stops being self-evident and becomes an owner question — escalate it, do not decide
it.

### 6.7 OWNER RULING — branch protection on `main` is ON, and CI guards are no longer advisory (Albert Hazan, 2026-08-04)

Albert turned branch protection **ON** for `main` on 2026-08-04. This is a standing decision, ruled
by the owner. **It is settled — do not re-ask it, do not treat it as an AI's preference, and do not
weaken it.**

**The verified fact, not a claim.** Read back live at 2026-08-04 12:00 UTC with
`gh api repos/u2giants/shared-db/branches/main/protection`, after PR #442 (agent `ci-check-names`)
gave every job a unique `name:` and the coordinator added the newly-disambiguated contexts:

| Setting | Value |
| --- | --- |
| `required_status_checks.contexts` | `["Promotion contract tests (offline)", "Backlog / queue sync", "Cross-PR object collision", "Tools offline tests"]` |
| `required_status_checks.strict` | `false` |
| `enforce_admins.enabled` | **`true`** |
| `allow_force_pushes.enabled` | `false` |
| `allow_deletions.enabled` | `false` |

**The rule.**

1. **CI guards on this repository are no longer advisory.** Merging through a red *required* check
   is now **mechanically impossible**, including for admins — `enforce_admins` is `true`, so there
   is no "coordinator override". The event that motivated this ruling was real: on 2026-08-03 PR
   #431 was merged through a **red** `verify` check (run `30846938009`, job `91797438635`). That
   route is closed.
2. **`main` cannot be force-pushed or deleted.** Any recovery plan that assumes a rewrite of `main`
   is invalid. Fix forward.
3. **Branch protection must not be removed or weakened without an explicit, per-change owner
   instruction naming the setting.** "Unblock the merge", "CI is stuck", "fix the pipeline", or a
   deadline is **not** approval. If a required check is wrong, fix the check — never the protection.
   This mirrors the standing production-infrastructure rule: an AI session does not relax a control
   in order to get past it.
4. **Every PR to `main` — including a docs-only PR — must now pass all FOUR required contexts
   before it is mergeable:** `Promotion contract tests (offline)`, `Backlog / queue sync`,
   `Cross-PR object collision`, `Tools offline tests`. Confirm with `gh pr checks` before reporting
   a PR as ready, and check the run's `head_sha` — a green tick can be a **stale verdict from an
   older commit**. A green PR page is not the same as a satisfied required context.

**KNOWN LIMITATION — state this honestly, do not claim protection is complete. The gap is the
migrations lane itself.** The two workflows that actually **touch the database** —
`.github/workflows/shared-supabase-migrations.yml` and `.github/workflows/db-data-admin.yml` — are
**`paths:`-filtered**, and a path-filtered workflow reports **NO check at all** on a PR that misses
its paths. GitHub treats a required context that never reports as *pending forever*, so making
either one required would **deadlock every unrelated PR** in the repository. Neither can therefore
join the required list as things stand.

Say the consequence plainly, because it is the opposite of reassuring: **the riskiest path in this
repository — migrations — is currently the one guard that CANNOT block a merge.** The four required
contexts above are the cheap, always-run guards; the expensive, genuinely dangerous one is advisory.
This is **backlog item B2** ("repo-wide checkers gated behind narrow `paths:` filters") and it is
**UNFIXED**. Until it is fixed, do not describe branch protection on this repository as complete,
and do not let "protection is on" stand in for "a bad migration cannot be merged" — it can.

### 6.8 OWNER RULING — the six HARD_BLOCKED ColdLion migrations are NOT unblocked individually (Albert Hazan, 2026-08-04)

This is a standing **DO-NOT**, ruled by the owner. **It is settled — do not re-ask it, do not treat
it as an AI's preference, and do not read it narrowly.**

**What is forbidden.** Unblocking any `HARD_BLOCKED` ColdLion migration **on its own** — one at a
time, a few at a time, or "just the safe ones". There is no size of subset that makes it allowed.

**What is permitted — one event, carrying all three parts together.** Any unblocking ships bundled
with:

1. **its negative test that proves the guard actually FIRES** (the backlog **B7** standard — an
   assertion that the guard *rejects* the bad input, not merely that the happy path passes); **and**
2. **a whole-batch pre-flight check that proves the ENTIRE promotion batch can run end to end** —
   not that the individual migration applies.

**Why, so a future session does not "helpfully" unblock one.** The production promotion lane
currently **ABORTS AT FILE 3 OF 14** — found by agent `prod-lane-design`, PR #403. A migration
unblocked on its own would therefore be handed to a lane that stops a third of the way through, and
production would be left **PARTIALLY PROMOTED**: some ColdLion migrations applied, the rest not,
with no undo (production changes here are forward-only). A half-applied taxonomy batch is worse than
an un-promoted one, because it looks finished. The pre-flight requirement exists precisely to catch
that before the first irreversible write, not after it.

**The count is SIX, not four — correct any document that says four.** Agent `hardblock-archaeology`
(PR #407) found **six** `HARD_BLOCKED` entries and confirmed the **42P01 (undefined table)** chain
behind them. Older docs say four. **A promotion list built from the old count ships a partial fix**
— which is the exact failure this ruling exists to prevent. Confirm the real scope live before
acting; do not inherit either number on trust.

### 6.9 OWNER RULING — the 33 unmatched ColdLion property codes are NOT admitted before the resolver is fixed (Albert Hazan, 2026-08-04)

> "Fix the attachment logic first, then admit the codes."
> — Albert Hazan, 2026-08-04

This is a standing **DO-NOT**, ruled by the owner. **It is settled — do not re-ask it, do not treat
it as an AI's preference, and do not reorder it.**

**The rule.**

1. **The 33 unmatched ColdLion property codes must NOT be admitted until the status-blind resolver
   is fixed first.** The order is not negotiable and is not a preference about sequencing
   convenience: the resolver is what decides which status each admitted code lands on, so admitting
   first means admitting **against the wrong statuses**, and every one of those rows then has to be
   found and corrected by hand.
2. **In that order, in ONE reviewed change — never the admission alone.** A PR that only admits the
   codes is out of compliance with this ruling even if the resolver fix is "planned next". The fix
   and the admission are reviewed together so the reviewer can see the codes land against a resolver
   that is already correct.
3. **When they are admitted, they go in as `potential`, NOT `inactive`.** This is Kimi's
   recommendation and it is **already accepted** — it is not open for re-litigation. Marking an
   unmatched code `inactive` silently hides what may be a real, live property; `potential` says
   truthfully that it exists and has not yet been reconciled.

**A count caveat, stated so nobody launders it into a fact.** The figure was **66** at the
2026-07-31 handover and is recorded as **33** now. That reduction has **not** been independently
re-verified. Re-derive the real count at the time of the work; do not build the admission list from
this section's number.

### 6.10 OWNER RULINGS — the licensor/property model, and "the feed should not drop anything" (Albert Hazan, 2026-08-06)

Five rulings, all given the same day, all **settled**. Do not re-ask them, do not treat them as an
AI's preference, and do not reorder ruling 5.

**1. Coco IS a Disney license.** This closes the long-open question of whether `Coco` sitting under a
"NO LICENSE" licensor was deliberate. It was not. Detail and the resulting open technical question
live in [`fix_characters_style_guides.md`](fix_characters_style_guides.md).

**2. The CODE alone is meaningless — the DESCRIPTION decides the licensor.**

> "If the CC is connected to a description that says Coco, it's Disney. If it says Coca Cola, it's
> under the Coca Cola licensor."
> — Albert Hazan, 2026-08-06

Never resolve a licensor from a property/item code by itself. Read the description that travels with
the row.

**3. Licensor → Property is parent-child, and property codes are NOT globally unique.** The same code
may exist under many licensors. `core.property` is keyed `(licensor_id, code)`
(`20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql`, and see
[`docs/licensor-property-parent-child-design-20260802.md`](docs/licensor-property-parent-child-design-20260802.md) §2.1).

> **This corrected a wrong assumption the coordinator held on 2026-08-06, and that assumption is
> baked into at least one committed tool.** `tools/validate-licensing-answers.mjs` (the property
> lookup around lines 86–92) resolves a property with `where p.code = any($1)` — no licensor scope.
> It selects the licensor name and then discards it; only `r.code` is used. It is safe **only**
> because today's `core.property` copy is crippled (256 rows, one row per code). **Repairing the feed
> before fixing that query would introduce silent wrong-licensor binding.** Fix the scoping FIRST.
> This is the same ordering principle as §6.9.
>
> Phrases like *"re-parent CC to Disney"* are not meaningful instructions and must not be planned in
> those words — say which `(licensor_id, code)` row you mean.

**4. "The feed should not drop anything."** The master-data feed must stop silently discarding rows.
There must be a **licensor/property triage page in DB Data Admin** (the app that serves
`data-dev.designflow.app`) where Albert fixes the problems the feed finds, instead of the feed
throwing them away. Requirement:
`docs/licensor-property-triage-page-requirement-20260806.md` (added 2026-08-06 on branch
`docs/licensor-property-triage-page-20260806`).

**5. STOP THE DATA LOSS FIRST — ordering ruling.** Asked whether to settle the storage question for
an ownerless property (nullable FK vs. a holding licensor vs. a quarantine table) before shipping, or
to stop the loss first, Albert chose **stop the loss first**. Ship quarantine/triage before settling
the model.

#### 6.10-A What was measured on 2026-08-06 (production `qsllyeztdwjgirsysgai`, read-only)

Recorded so nobody re-measures it, and so nobody quotes the one number that is **not** verified.

| Finding | Value |
|---|---|
| Supabase `core.*` vs DesignFlow | 26 licensors / 256 properties / 256 parent edges **vs** 82 / 614 / 503 |
| Why roughly half the tree never arrives | **By design** — the feed drops inactive properties, unparented properties, and childless licensors. This is the loss ruling 4 forbids |
| Parent data staleness | Every property row carries the same `updated_at`, **2026-07-08** — the day the PLM sync died. **29 days stale** as of 2026-08-06 |
| Sync ledger | All 15 sync runs recorded **"succeeded"**. The 502 is invisible in the ledger — never trust `sync_run` status as proof of freshness |
| Unparented properties in DesignFlow | 111, of which 51 active — VERIFIED live, matches the docs |
| `core.character` | **EMPTY on production** (0 rows) |
| `plm.item` | **EMPTY** (0 rows) — the modeled item master was built and never populated |
| `public.erp_items_current` vs `plm."itemHeader"` | 17,703 vs 19,563 rows; **14 items exist only in `plm."itemHeader"`** |
| The `CC` case | `core.property` holds one `CC` row named `COCO` under licensor `ZZ` (DTR - NO LICENSE). All **14** items filed there are Coca-Cola merchandise **by description**. Seven items under licensor `DY` (Disney) + property `CC` are genuinely Coco. The real COCA COLA licensor exists but is **INACTIVE with zero items** |
| Item numbering | `AAA00LLPP00` — chars 6-7 licensor, 8-9 property — holds for **~77%** of items |
| Parent edges pointing at a non-active licensor | **499 of 503.** Nobody knows what "inactive" means in this data — do not infer it |
| ⚠️ "241 of 322 property codes (75%) under more than one licensor" | **UNVERIFIED.** This figure has been quoted verbally but is recorded **nowhere** in the repo and was not reproduced on 2026-08-06. **Do not state 75% as fact.** Re-measure before using it |

#### 6.10-B Three corrections to statements already in this repo (2026-08-06)

1. **DB Data Admin lives in THIS repo**, at `apps/db-data-admin/`, despite serving a
   `designflow.app` hostname. Only the feed **endpoint** change is DesignFlow work. (Verified: the
   directory exists here.)
2. **The `NOT NULL` on `core.property.licensor_id` came from
   `20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql` lines 71–72**, not from the
   original `20260621150815` migration. (Verified against the file.)
3. **Blocker 8 was mis-stated across the handover docs.** The endpoint they cite is a **READ**
   endpoint. The real writer is `PATCH /api/admin/updateMerchGroup`
   (`designflow-backend/routes/admin.router.js:87`), and its real defect is that it is **type-blind**.
   Detail: `docs/licensor-property-cloudsql-cutover-plan-20260806.md` (branch
   `docs/licensor-property-cutover-plan-20260806`).

## 7. When two apps need conflicting database changes

Serialize, do not parallelize. Land one change, let it sync, test it, then start
the next. Where possible, prefer one **additive** change that satisfies both apps
rather than two competing edits. If they genuinely conflict, explain the trade-off
to the owner in plain English and let them choose order.

## 8. Project references

```text
Preview project ref:  rjyboqwcdzcocqgmsyel   (Supabase branch "shared-db-schema-rehearsal")
Production project ref: qsllyeztdwjgirsysgai
```

Never commit anon keys, service-role keys, database passwords, or `.env` files.

### 8.1 API-exposed schemas (PostgREST) — `dam` is NOT exposed (2026-07-15)

`pgrst.db_schemas` on prod = `public, graphql_public, api, crm, pim, core, app`.
An app schema is exposed only when that app queries it from the browser (`crm`,
`pim`, `core`). **`dam` is intentionally absent** — it holds PopDAM worker-internal
tables (`dam.sku_human_description`, `dam.pdf_rich_extraction`) that the DAM
frontend never touches (DAM queries `public`). Any PostgREST call to `dam.*` —
even with `service_role` — fails with **`Invalid schema: dam`**. Reach `dam.*`
from workers/edge through **`public` `SECURITY DEFINER` functions granted to
`service_role`** (e.g. `public.get_pdf_rich_extraction_hashes`,
`public.upsert_pdf_rich_extraction`, `public.refresh_style_group_rich_metadata`).
Do **not** add `dam` to `pgrst.db_schemas` to "fix" this — it broadens the shared
API surface for every app and would require RLS on every `dam` table.

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

## 10. Where to read more

- App rewrite guides: [`docs/ai-session-instructions/`](docs/ai-session-instructions/README.md)
- Shared branch workflow: [`docs/ai-session-instructions/shared-supabase-branch-workflow.md`](docs/ai-session-instructions/shared-supabase-branch-workflow.md)
- Schema ownership map: [`docs/unified-supabase-schema-map.md`](docs/unified-supabase-schema-map.md)
- Migration risks: [`docs/unified-supabase-migration-gaps.md`](docs/unified-supabase-migration-gaps.md)
- CRM production cutover (migrations promoted, Azure OAuth, auto-provision, data import): [`docs/app-migration-notes/popcrm-web-production-cutover-20260621.md`](docs/app-migration-notes/popcrm-web-production-cutover-20260621.md)
- CRM crm.* direct-write DML grants (fixes Triage 42501 on department create; RLS ≠ grant): [`docs/app-migration-notes/popcrm-web-20260716.md`](docs/app-migration-notes/popcrm-web-20260716.md)
- **`public` schema anon lockdown (2026-07-29) — read before creating a function or a view in `public`:** [`docs/security/public-schema-execute-audit.md`](docs/security/public-schema-execute-audit.md) (EXECUTE grants; 88 of 99 SECURITY DEFINER functions were anon-callable) and [`docs/security/public-schema-anon-read-audit.md`](docs/security/public-schema-anon-read-audit.md) (table/view reads; ~27,000 rows were anon-readable). Summarised as a standing rule in §10.2 above.
- **PopDAM access — read before granting/revoking/debugging a user's access:** [`docs/popdam-access-provisioning.md`](docs/popdam-access-provisioning.md). Permissions run on **three independent axes across two schemas**. `public.app_access('popdam')` alone lets someone log in and **see nothing**: every `core.*`/`api.*` policy is **app-schema** gated (`app.has_any_role(...)`), so a user with no active `app.user_role` gets `HTTP 200` with an empty array — success-shaped and data-free. On 2026-07-26, **18 of 35 PopDAM users** were in exactly that state.

- **Cross-workflow take-over (2026-07-31):** [`coordinator_take_over.md`](coordinator_take_over.md).
  Splits four in-flight threads — characters/style guides, ColdLion source-of-truth, licensing
  coordination, shared-db hygiene — into what is done, what is verified vs merely documented, what
  blocks each, and the failed paths not to repeat. **Read its §1 table before picking up any of
  those four.** Characters/style guides has its own STATUS table in
  [`fix_characters_style_guides.md`](fix_characters_style_guides.md) — **read that table first; do
  not re-derive or re-plan the phases.**

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
