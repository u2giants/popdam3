> ⚠️ **Auto-synced — do not hand-edit the copies.**
>
> [`u2giants/shared-db`](https://github.com/u2giants/shared-db) is the **single source of truth**. Its entire contents are mirrored into the **`shared-db/` folder** of every consumer repo (CRM, DAM, PM/PIM, DesignFlow PLM) on each push to `main`.
>
> **Reading this inside a consumer repo's `shared-db/` folder?** It's a read-only copy — edits here are overwritten on the next sync. Change the canonical repo instead.

---

# AGENTS.md — cross-app coordination playbook

## Active implementation plan

- PopDAM OrderList linked to Master Data: [`plan_popdam_order_list.md`](plan_popdam_order_list.md). Read its STATUS table first. Do not re-derive or re-plan completed steps.
- **Master-data destination (read before proposing any licensor/property/character/asset/style-guide change):** [`docs/core-master-data-consolidation-aim.md`](docs/core-master-data-consolidation-aim.md). Owner ruling 2026-08-13 — consolidated portal scrapes land in `core.property` / `core.character` / `core.style_guide` / canonical asset; ColdLion supplies only the operational subset and is mapped onto those rows (automated, then manual); canonical properties absent from ColdLion go `inactive`. The licensor -> property edge stays a single foreign key, never a junction table. The mapping screen lives in DB Data Admin.
- OrderList source contract: [`docs/app-migration-notes/popdam-order-list.md`](docs/app-migration-notes/popdam-order-list.md), with formula detail in [`docs/app-migration-notes/popdam-order-list-formula-audit-20260807.md`](docs/app-migration-notes/popdam-order-list-formula-audit-20260807.md). Owner ruling: Google OrderList and future Coldlion rows are the same orders; `plm.item` is the ultimate item list. One canonical order/line must retain separate Google and Coldlion source refs.

This is the operating contract for **every AI session working on any app that
shares the Supabase database**: PM/PIM `poppim-web`, CRM `popcrm-web`, DAM
`popdam-web`, and the six `popcre/designflow-*` PLM repos. Read it before
touching code or the database. It exists to stop separate
AI sessions from breaking each other through the one database they all depend on.

> **Started in `shared-db` and you are not the orchestrator? Stop and hand over.**
> This repo runs **one orchestrator session**, which dispatches every task to
> sub-agents in isolated worktrees.
> **Scope: STRUCTURE, not data (§0.0-B, owner ruling 2026-08-13).** This repo and its
> orchestrator govern the *shape* of the database — schema, tables, columns, views, functions,
> triggers, RLS, indexes, migrations. An application session changing its own *rows* does not
> belong here and must not open an issue for it. The one exception is curated Master Data
> under §6.4.
> **Any other session with a STRUCTURE change opens a GitHub issue and stops:**
> `gh issue create --repo u2giants/shared-db --label db-work --title "HANDOVER: …" --body-file <file>`.
> ⚠️ **`COORDINATOR_INTAKE.md` is RETIRED** (2026-08-07) and is now a short pointer file.
> **It stays on disk on purpose — retired means "pointer plus guard", not "deleted".** The
> required check `Intake pointer guard`
> ([`.github/workflows/intake-pointer-guard.yml`](.github/workflows/intake-pointer-guard.yml))
> fails any PR that regrows a queue in it **and also fails if the file is missing**, because a
> deleted pointer sends the next stale machine looking for somewhere else to append. Do not
> write into it and do not delete it. **Keep it under 40 lines and 4 KB** — the guard enforces
> that too, so do not answer a question by adding prose here; add it to AGENTS.md and link.
>
> ⚠️ **Two different checks, do not confuse them.** `HANDOFF.md`'s `## BACKLOG` note says "the
> CI check that enforced this is deleted". That is TRUE, and it means **`backlog-queue-sync`**
> — the check that required every `B<n>` backlog item to also appear in this file's
> `## REQUEST QUEUE`. It was removed in commit `534b20f`. It is **NOT** the `Intake pointer
> guard`, which is live, required and green. Reading that sentence as "the intake guard is
> gone" leads straight to deleting a file a required check demands. (Issue #657.)
> **The standing facts an incoming session needs — silent duplicate-version skips, the
> production-bound Supabase MCP, preview as a shared mutable resource, and the ban on
> background task chips — are now §12 of THIS file**, re-homed 2026-08-07 ahead of the
> queue file being retired. Skills:
> `shared-db-orchestrator` to run a orchestrator session, `shared-db-handover` to
> close one out.

> ## ⚠️ Before you conclude "this schema object does not exist"
>
> **The live catalog is NOT proof that work was never done.** It is proof of what is
> APPLIED. A migration that is merged to `main` but never applied is invisible in
> `information_schema` and looks exactly like work nobody ever wrote. On 2026-08-13 that
> is precisely what happened: 17 Disney landing tables were reported to the owner as
> "missing" when they existed as reviewed, merged SQL that had never been switched on
> (issue #892).
>
> **Always check the ledger against `main` before reporting a schema gap:**
>
>     SUPABASE_ACCESS_TOKEN=… node scripts/check-migration-ledger-drift.mjs --target production
>
> It reports both directions — merged-but-not-applied, and applied-but-not-on-`main`.
> Exit 0 = no drift, 1 = drift, **2 = could not check, which is never "no drift"**. It also
> runs on every push to `main`, daily, and on demand: workflow `Migration Ledger Drift`
> ([`.github/workflows/migration-ledger-drift.yml`](.github/workflows/migration-ledger-drift.yml)).

> ## ⚠️ Before you report that a scrape or loader "landed nothing"
>
> **An empty table is not proof that a capture never ran — it is proof that *that
> table* is empty.** Table names do not reliably tell you where a loader wrote. On
> 2026-08-13 a session counted `plm.dcp_property` and `plm.wb_property`, found both
> empty, and told the owner "Warner and Disney have landed zero rows". Disney had in
> fact landed **156,644 assets** in `plm.dcp_asset`, 2,967 style guides in
> `plm.dcp_style_guide` and 10,262 rows in `plm.opa_property_character`. The same
> session also understated Paramount and NBCU by roughly 230,000 rows, because it
> counted entity tables and ignored the asset tables entirely.
>
> **Never guess the table. Ask:**
>
>     select * from api.source_capture_inventory order by source_system, retained_row_count desc;
>
> The view separates retained evidence from current complete-capture coverage.
> `row_count` remains a compatibility alias for `retained_row_count`; neither is a
> current-coverage number. Use `latest_complete_row_count` with `count_basis`,
> `latest_complete_status`, and `count_note` when judging source coverage. A NULL
> latest-complete count means the exact count cannot be derived, not zero. Its
> `carries_resolution` column describes a table's shape and never indicates whether
> a scrape ran. Same discipline as the migration-ledger rule above: check the
> authoritative inventory before reporting an absence.

## 0. Shared-db gatekeeper rule for consumer repos

`shared-db` is the gatekeeper for every database schema change in the shared
Supabase project, including DesignFlow PLM tables that still appear in app repos
as Sequelize models or legacy inline startup migrations.

**Scope reminder: this is a STRUCTURE rule, not a data rule.** Ordinary
application row writes belong to the application session that owns the feature —
see §0.0-B, which is the controlling statement of what this repo governs and
what it does not. §0 governs the shape of the database; §0.0-B draws the line.

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

## 0.0-A OWNER RULING — every application repo may INSPECT this database read-only, with no issue and no dispatch (Albert Hazan, 2026-08-10)

> "Read-only database access is allowed from every application repository … Read-only reviews
> do not require a GitHub issue or handoff to shared-db." — Albert Hazan, 2026-08-10

**Why.** This database serves many applications. Each one must be able to see the complete
schema, relationships, functions, policies and structure to judge whether the database fits
its data. Answering "does this fit?" is impossible without looking, so §0's gatekeeper rule
has never applied to looking — and this section says so out loud, because sessions have read
"no database work in app repos" as a blanket that also blocks harmless reads.

**This is global.** It is not limited to Paramount, to any one licensor scraper, or to any
one application.

**PERMITTED from any application repository, by any AI session, with no GitHub issue, no
orchestrator dispatch and no handover** — inspection of:

schemas · tables and columns · keys and relationships · indexes and constraints · views ·
functions and RPCs · triggers · row-security (RLS) policies · migration history · generated
types · metadata · safe sample data when a review genuinely needs it.

And **comparison** of the live structure against application code, scraper output,
source-data shapes, expected business rules and proposed features — reporting the gaps.

**STILL FORBIDDEN from an application repository.** A review that mutates anything has
stopped being a review:

- creating its own shared-database migration (including a Sequelize `models/db.js` startup
  `ALTER`/`CREATE`)
- running `ALTER`, `CREATE`, `DROP` or any other structure-changing SQL — psql, MCP or CLI
- changing shared Supabase data or structure during a review
- bypassing the preview → branch → pull-request process in this repo

**Every STRUCTURAL change is still authored here first** (§0 and §5): schema, tables, columns,
views, functions/RPCs, triggers, RLS policies, indexes, constraints, structural seeds shipped as
migrations, migrations and shared data contracts. **Ordinary application data writes are not on
this list** — see §0.0-B, which supersedes any reading of this paragraph that would route
routine row changes through this repo.

**Nothing else is relaxed.** Production and shared-cloud safety rules are unchanged; use the
approved read-only AI identity wherever one is required, and never use privileged personal
credentials for agent automation. §0.1-A's Cloud SQL conditions and its "never report row
contents" rule are unchanged. Licensed-data protection is unchanged: a schema review may read
private licensor source data inside its approved private repository, but licensed rows must
never be copied into a public repo, a GitHub issue, logs, prompts sent to outside services,
commit messages or pull requests. And §4.2 still stands — prove which project you are pointed
at (`get_project_url` for MCP, `cat supabase/.temp/project-ref` for the CLI) and quote it.

## 0.0-B OWNER RULING — this repo and its orchestrator govern STRUCTURE, not DATA (Albert Hazan, 2026-08-13)

> "shared-db orchestrator is for creating, changing, or deleting the STRUCTURE or schema or
> design of the database, not for creating, changing, or deleting the data inside the database.
> That should be done by the sessions working on the actual application."
> — Albert Hazan, 2026-08-13

**This is the controlling statement of scope.** Where any other section of this document, any
skill, any memory file, any consumer-repo doc, or any global instruction block reads as though
routine row writes must be routed through this repo or its orchestrator, **this section wins**
and that reading is wrong. It resolves a real ambiguity: the earlier rules listed "seeds" and
"data fixes" in the same breath as tables and columns, and several sessions correctly concluded
from that wording that any `INSERT` put them under the orchestrator. That was never the intent.

### What the orchestrator governs — STRUCTURE

Authored here first, on a branch, preview-first, merged by pull request:

schemas · tables · columns · types and enums · views · materialised views · functions and RPCs ·
triggers · row-security (RLS) policies · grants and privileges · indexes · constraints ·
extensions · realtime publications · storage policies · migrations · **structural seed data that
ships as a migration** (lookup/enum/reference rows the schema itself depends on) · shared data
contracts between applications.

### What the orchestrator does NOT govern — DATA

The rows an application creates, edits, or removes in the normal course of doing its job. The
session working on that application owns those writes outright. **No GitHub issue, no
orchestrator dispatch, no handover, no branch, and no migration.** Concretely, and non-exhaustively:

- a feature or bug fix writing, updating, or deleting its own application rows
- a scraper, importer, or sync job writing into the ingest/staging tables it owns
- backfilling, correcting, or cleaning up application data the app itself produced
- test, demo, or fixture data in preview
- operational data: job runs, queue rows, cache entries, audit and log rows

Calling one of these "database work" and refusing it is a mistake. Routing one of them through
an issue and the orchestrator is also a mistake — it wastes the queue and delays the app.

### The one carve-out — CURATED MASTER DATA stays gated

**§6.4 and its 2026-08-03 correction survive this ruling in full and are not relaxed.** Bulk or
ad-hoc loading of outside-sourced content into curated Master Data — `core.licensor`,
`core.property`, `core.character`, `core.customer`, `core.factory` and their `*_ext` tables —
remains gated, still binds the AI session doing the typing, and still carries the matched-row
abstention rule. That gate was bought with an incident: a spreadsheet dump can silently supersede
hand-curated rulings, and nothing in this database records which fields a human set, so an
ad-hoc session cannot tell curated from untouched.

The carve-out is narrow and it is about **provenance and target**, not about volume or verb. It
applies when outside-sourced content (a spreadsheet, CSV, export, pasted rows, screenshot, chat
message, or API pull) is written into those Master Data tables. It does **not** turn an
application's own row writes elsewhere in the database into orchestrator work.

### What is unchanged everywhere

- **§4.2 applies to data writes exactly as before.** Owning your rows does not relax proving your
  connection target. Before any `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`, in preview or production,
  prove which database you are pointed at and quote the proof in your report. §4.2 is a safety
  rule about *where the statement lands*; §0.0-B is a routing rule about *who decides it*. They
  are independent and both bind.
- **Production and shared-cloud safety rules**, the read-only AI identity requirement, and
  licensed-data protection are unchanged.
- **Read-only inspection** stays wide open per §0.0-A.
- **The single-orchestrator rule (§12.1) still governs structure work.** A session that needs a
  schema change in `shared-db` still stops, opens an issue, and hands over.

### The test, in one line

*Am I changing the shape of the database, or the contents of it?* Shape → this repo, orchestrator,
branch, preview, PR. Contents → your own application session, with §4.2 proof, unless the target
is curated Master Data.

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

## 0.1-A OWNER RULING — shared-db MAY read production Cloud SQL; it still may not change anything (Albert Hazan, 2026-08-10)

> "remove from shared-db's own rulebook the rule that says this repo must not connect to Cloud SQL at all."
> — Albert Hazan, 2026-08-10

**What changed.** Until today §0.1 was read across this repo as putting the DesignFlow
production Cloud SQL database entirely out of bounds — no connection, no query, at all.
That reading is **withdrawn**. A shared-db session **may connect to production Cloud SQL
and run read-only queries**, under the conditions below.

**Why.** DesignFlow PLM production is the last environment still on Cloud SQL; every other
DesignFlow environment is already on the shared Supabase project, and the owner has decided
to start moving production over. Three separate migration plans over eight days
([`docs/cloudsql-first-migration-candidate-20260803.md`](docs/cloudsql-first-migration-candidate-20260803.md),
[`docs/age-group-cloudsql-migration-plan-20260804.md`](docs/age-group-cloudsql-migration-plan-20260804.md),
[`docs/licensor-property-cloudsql-cutover-plan-20260806.md`](docs/licensor-property-cloudsql-cutover-plan-20260806.md))
all stalled at the same wall: **nobody has ever looked inside that database**, so every
estimate of effort, downtime and risk was a guess. Reading it is how that stops.

**READ is permitted. WRITE is not.** That is the whole boundary. In detail:

*Permitted:*

- Connecting with a **read-only credential fetched from 1Password vault `vibe_coding` only**.
  Fetch 1Password items **serially** — never fan out `op read` / `op run` / 1Password MCP calls.
  Never write the credential into any file, commit, PR, report, issue, or chat message.
- **The credential must be PROVEN read-only BEFORE you use it.** Check `usesuper`,
  `usecreatedb`, role memberships (`pg_roles` / `pg_auth_members`) and schema/table privileges
  (`has_schema_privilege`, `has_table_privilege`, `information_schema.role_table_grants`).
  **If you cannot prove it is read-only, stop and report.** Never test the question by
  attempting a write. One credential is exempt from this proof, and only one — see §0.1-A.1.
- `SELECT` against `information_schema` and `pg_catalog` only. Nothing that takes a lock
  beyond a plain shared read — no `LOCK`, no `SELECT … FOR UPDATE`, no `VACUUM`/`ANALYZE`,
  no long or unbounded scans. **This is a live production database serving real users.**
- Reporting **counts, object names, data types, sizes, constraints and definitions**.

*Still forbidden — this ruling lifts nothing here:*

- **No DDL and no DML against Cloud SQL from this repo, ever.** Applying schema changes there
  is Uma's job via [`popcre/infrastructure`](https://github.com/popcre/infrastructure);
  issue **#696** is the live example and it stays hers.
- **No Secret Manager IAM, secret versions, or secret repointing.** §0.1 above is unchanged:
  **unsuffixed DB secret IDs are production-only** and are the 2026-07-17 outage boundary.
- **No Cloud Build substitutions or triggers, no Cloud Run bindings, no VPC routing changes.**
- **No changes to the connection contract or `cloudbuild.yaml`** in the four `popcre`
  DesignFlow repos — `popcre` org repos, PRs to `develop`, never self-merged.
- The standing global rules stand untouched: AI sessions are **read-only for production and
  shared cloud infrastructure**; no `terraform apply`/`destroy` against a production GCP
  project; no mutating `gcloud`.

**Never report row contents.** Counts, names, types, sizes and definitions only — never the
values in a row. Issue **#645** exists because vendor emails, phones and addresses were once
published into a repo file. A read permission is not a publication permission.

**This ruling permits reading; it does not require it.** Do not connect unless the task
actually needs a fact only that database holds.

### 0.1-A.1 OWNER RULING — the read-only proof is waived for `albert_read_only`, for reads of the DesignFlow schema and nothing else (Albert Hazan, 2026-08-10, issue #705)

> "ignore the 'read only is not read only' issue."
> — Albert Hazan, 2026-08-10

> "yes, use it to read production."
> — Albert Hazan, 2026-08-10, answering whether that also permits USING the account to read

**The proof rule in §0.1-A stands.** Proving a credential read-only before using it is still
the default and still applies to every other credential and every other database. What
follows is one named, bounded exception, not a relaxation.

**The exception.** Reading the `designflow` schema on the DesignFlow production Cloud SQL
instance with the account `albert_read_only` is permitted, even though that account fails the
attribute test in §0.1-A.

**Why the attribute test fails yet the read is safe.** Check the reasoning rather than
re-deriving it:

- The account holds `SELECT` on **296 relations and ZERO write privileges** in the
  `designflow` schema.
- All **386 relations are owned by `postgres`**, so membership of `cloudsqlsuperuser` is not
  a route to that data.
- For this account, what fails the proof is `rolcreatedb` / `rolcreaterole` / role membership,
  plus `CREATE` on database `postgres` and `CREATE` on schema `public` — the power to create
  **new** objects elsewhere, not the power to write DesignFlow. Those grants are a real
  production-infrastructure exposure and #705 records them; they are simply not a write path
  into `designflow`.
- [`scripts/capture-postgres-schema.sql`](scripts/capture-postgres-schema.sql) line 66 sets
  `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, which is why that particular run
  could not have written. It is a session-scoped guard that the same session can reset to
  `READ WRITE`, so it is **never** a substitute for the proof rule for any other credential.

**Boundary. This permits a READ.** It does not permit writes, DDL, DML, creating a read
replica, starting an export, restoring a backup, changing authorized networks, or any
mutation in `lithe-breaker-323913`. It does not generalise to any other credential, any other
database, or any other task. Everything under "Still forbidden" in §0.1-A is unchanged.

**Closure rule — read this before assuming anything is allowed because it is not listed
above.** This exception waives the read-only proof and **nothing else**. Every other condition
in §0.1-A still binds — catalog-only `SELECT`s against `information_schema` and `pg_catalog`,
no long or unbounded scans, and **no row contents read or reported** — and `pg_stats` is row
contents, not catalog metadata, because `most_common_vals` and `histogram_bounds` hold sampled
values from real columns. Catalog-only is the
scope Albert was asked about and the scope he approved. So a row count, a sample row, a
`SELECT` queued by a migration plan (for example
[`docs/parent-child-answers-20260803.md`](docs/parent-child-answers-20260803.md) or the
age_group plan's Step D1), and a client-side `pg_dump` are all **outside** this exception and
each needs **its own ruling from Albert**. Not from the Cloud SQL instance owner — instance
admin is not business authority here. The list above enumerates; this sentence closes.

**Do NOT fix #705.** Albert ruled the account is to be left alone. Stop proposing privilege
changes for it and do not re-raise it as a blocker.

**Operational specifics — do not rediscover these:**

- **On Cloud SQL the schema is `designflow`, NOT `dflow`.** The direction of the trap matters:
  on **Supabase** production, DesignFlow lives in **`dflow`**, and Supabase *also* has a
  separate schema named `designflow` — a 35-relation decoy. So do not "correct" either name to
  the other. Confirm which host you are on before reading (§4.2).
- Run with `exact_count_max_bytes=0` so the capture reads catalog only and touches no table
  data.
- The credential is in vault `vibe_coding`, item **`tcaf3o3u2cx52g6ivvczxbhola`**
  ("DesignFlow PRODUCTION Cloud SQL - read-only …"). Its title contains parentheses, which are
  invalid in an `op://` reference, so address it by **item ID**:
  `op read 'op://vibe_coding/tcaf3o3u2cx52g6ivvczxbhola/DB_PASSWORD'`. The password is in a
  **custom field named `DB_PASSWORD`**, not `credential`. 1Password item IDs can be re-keyed
  mid-session, so if that ID 404s, re-resolve by title with
  `op item list --vault vibe_coding --format json` (same pattern as §9, `AGENTS.md:1946-1963`).
  Never write the
  value anywhere.

**Evidence.** The completed capture is at
[`docs/verification/cloudsql-designflow-capture-2026-08-10/`](docs/verification/cloudsql-designflow-capture-2026-08-10/);
the ruling and the privilege analysis are on issue **#705**. That capture's README describes
the waiver as "for this capture only" and "not a general waiver"; **this section supersedes
that wording** — the exception is standing, on the terms above.

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

## 2.1-W WORKTREE-ONLY — no session works directly in the shared `shared-db` checkout (standing rule, added 2026-08-12, issue #513)

**The rule.** In this repository, **every session — the orchestrator included — does its work in
its own `git worktree` cut from `origin/main`.** The shared checkout (`C:\repos\shared-db` on the
Windows boxes, and its equivalent elsewhere) is for reading and for `git fetch`. Nobody branches
in it, commits in it, or leaves it checked out on a working branch.

```bash
git -C <shared-checkout> fetch origin --prune
git -C <shared-checkout> worktree add <shared-checkout>/.claude/worktrees/<slug> -b <branch> origin/main
```

**Why it is a rule and not a preference.** Several sessions run this repo concurrently and they
all share one working copy. Observed, dated damage:

- **2026-08-06** — mid-session another session switched the shared checkout off the branch the
  first session was on, onto `docs/plan-dispatch-collision-hardening`, and committed on top. A
  commit landed on the **wrong branch and was pushed there** before anyone noticed. Recovery was
  non-destructive (cherry-pick to the right branch through a temporary worktree; no branch was
  rewritten, reverted, or force-pushed) but it cost a session.
- The same event left PR #467 carrying four files belonging to PR #466, because #467's branch was
  cut from the polluted checkout. The clean fix there was to **merge the earlier PR first** so the
  files drop out of the later diff by themselves — never a rebase or force-push of someone else's
  branch.
- §5.1's own step-2 recipe already says to do sensitive git work in a dedicated worktree. This
  section makes that the general rule rather than one recipe's footnote.

**If you find the shared checkout on a working branch**, do not "fix" it by switching it back —
another live agent may be mid-task on it. Leave it, work in your own worktree, and say so in your
handoff. Remove your own worktree when your branch has merged; never remove one that is dirty,
locked, or held by a live agent.

### 2.1-W.1 Retiring a worktree — and the squash-merge trap that has defeated every attempt

`scripts/reap-merged-worktrees.mjs` does this. Dry run by default; `--apply` to act.

**The trap.** `main` is squash-merged, which rewrites the commit, so **`git branch --merged`
cannot see a merged feature branch.** Measured 2026-08-13: 74 of 130 branches looked unmerged to
git while their pull request was merged. Every reaper keyed on git ancestry therefore reports
live work and cleans nothing, which is why 29 worktrees and 130 branches accumulated here.
**Ask GitHub whether the PULL REQUEST merged. Never judge by git ancestry alone.**

The script refuses to remove a worktree that is dirty, locked, detached, holds unpushed commits,
or is the main checkout — it prints those instead. Uncommitted work is unrecoverable, and no
amount of "its PR merged" makes deleting it safe.

**Branches now delete themselves.** `delete-branch-on-merge` was turned on for this repository on
2026-08-13, so a merged branch disappears without anybody remembering to sweep it.

## 2.1-H The HANDOFF.d contract — the file's own session retires it (issue #658, owner ruling 2026-08-13)

**There is NO limit on how many files `HANDOFF.d/` holds.** Twenty concurrent workstreams across
the five applications sharing this database means twenty files, and that is correct. What is
limited is **stale** files, and the target for those is **zero**.

⛔ **Do not add a check that fails a pull request when the directory exceeds N files.** It was
proposed on 2026-08-13 and rejected by the owner in the same breath:

> "when the 6th file gets there legitimately, if there are five files already there and some are
> stale, the legitimate file will get rejected. The sessions that do the work must take care of
> their own housekeeping. they are better informed than anyone as to whether something is
> finished or not." — Albert Hazan, 2026-08-13

A count cap bills whoever shows up next for somebody else's mess. Any earlier "threshold of 5"
wording, here or in a skill, is **superseded** by this section.

**Every `HANDOFF.d/` file opens with a contract block** naming the issue that would prove it
finished:

```
---
issue: 925                            # bare number; the issue that proves this done
status: OPEN                          # OPEN or BLOCKED — never DONE, see below
owner: codex/wb-scrape-schema-925     # the branch or session that owns it
---
```

**A finished file is DELETED, never marked done.** `status: DONE` is rejected. A file that stays
behind saying "finished" is the same archaeology problem as one that says nothing.

**One line, and "is this finished?" stops costing an hour.** Without it, answering that question
for 30 files meant reading all of them against live GitHub — which is why nobody did, and why 27
finished files sat in this directory for weeks.

**Three checks enforce it, and each can only ever fail the session that owns the file:**

| | What | Where | Blocks? |
|---|---|---|---|
| 1 | A handoff file you **add or modify** must carry a valid contract block | `Handoff Contract Guard` on every PR | yes, only your file |
| 2 | If a file you touched points at a **CLOSED** issue, or this PR **closes** an issue some file points at, retire that file **in this same PR** | same guard | yes, only your file |
| 3 | Files whose issue is already closed are listed weekly, with the owner named | `Handoff Stale Report`, Mondays | **never** |

Check 3 is the backstop for the only gap the other two cannot close: **a session that dies
mid-run never comes back to retire its file.** It reports and never deletes — deciding a
workstream is finished is a judgement, and the report names the file's owner so the ask lands on
the session that created it rather than on a stranger.

**When you inherit somebody's issue, you inherit their handoff file**, including the duty to
retire it. That is the whole mechanism: the duty travels with the work, not with the calendar.

**If the owning session is genuinely gone** and you are confident the work is done, any
orchestrator may retire the file — but say so in the pull request body, with the evidence
(closed issue, merged PR). Never delete another session's file silently.

## 2.1 Host/server boundary

This repo owns shared database schema, Supabase migrations, PLM import code, and the `systemd/plm-sync.*` templates. Durable host/OS changes on `hetz` are owned by the canonical Ansible repo at `/worksp/ansible` / [`u2giants/ansible`](https://github.com/u2giants/ansible), then applied by GitHub Actions.

Route packages, users, firewall, SSH/sudo, Docker engine or daemon config, systemd units/timers, cron, `/etc`, `/usr/local/bin`, `/usr/local/sbin`, Cloudflare Tunnel 1, Coolify host glue, and backup/DNS watchdogs through an Ansible PR. Do not SSH, sudo, or hand-edit the host directly for durable infrastructure changes. App/database code and templates that belong to `shared-db` still change here; deploying those templates onto the host belongs in Ansible. Break-glass direct host repair must be explicit and followed by an Ansible PR that captures or reconciles the drift.

## 3. Why `shared-db` is the dangerous one

Every app reads and writes the **same tables in the same Supabase project**. A
single schema change here can break an app that a different session built months
ago. The database has no "just this app" — it is always shared. That is why the
four rules below are non-negotiable for any database change.

## 4. The five anti-collision rules (shared database)

1. **Up to three unrelated migrations may be authored at once. Preview, merges,
   and production promotion remain one at a time.** This is Albert's owner ruling
   of 2026-08-14. Concurrent authors must use isolated worktrees, exact object
   claims and centrally reserved versions. A fourth author is refused.

   **Do not open a migration file first.** Acquire an author lane, object claim
   and unique 14-digit version as one dispatch operation:

   ```bash
   node scripts/manage-migration-author-lanes.mjs --claim \
     --task "<issue and outcome>" --owner "<agent/session>" \
     --branch "<branch>" --worktree "<absolute isolated worktree>" \
     --objects "<every exact object written, comma-separated>"
   ```

   Allocation is serialized across computers by a GitHub-backed lock. The command
   fails closed if claims are unreadable, objects overlap an open claim or pull
   request, GitHub is unavailable, version reservation fails, or three author
   lanes are occupied. Older claims count until they are explicitly released.
   The created issue body is authoritative and machine-readable. Never hand-edit
   its fenced blocks. The permanent version ref prevents reuse even after a lease
   ends; the lease only controls who occupies an author lane.

   Audit lanes with `node scripts/manage-migration-author-lanes.mjs --audit`.
   Audit and refill the three dynamic queues with
   `node scripts/manage-migration-author-lanes.mjs --queue-audit`. Every open
   `db-work` issue must contain one authoritative block:

   ````text
   ```db-work-scope
   status: ready
   work_type: structural
   route: shared-db-orchestrator
   priority: 100
   depends_on:
   objects:
     - table schema.name
   ````
   ```

   Status, work type, and route are independent. Allowed statuses are `ready`,
   `blocked`, and `owner-decision`. Allowed work types are `structural`,
   `curated-master-data`, `application-data`, `source-data`, `repo-maintenance`,
   `documentation`, and `security-settings`. There is no default route. Only
   `ready + structural + shared-db-orchestrator` can enter a migration-author
   lane, and it must name every exact database object. Non-structural work must
   not claim database objects.

   Outside-sourced writes into curated `core.*` Master Data use
   `work_type: curated-master-data` and
   `route: curated-master-data-governance`. This preserves §6.4 governance but
   never grants a migration-author lane. Source-data review such as NBCU rights
   classification uses `work_type: source-data` and
   `route: source-data-session`, even while `status: owner-decision`. Changing
   only the status after Albert answers can never change its owner route.

   Exact object overlap forms a serial queue; unrelated object
   groups fill up to three author lanes. When a claim releases, rerun the queue
   audit and dispatch every reported `REFILL REQUIRED NOW` issue in the same
   turn. Never wait for Albert to ask or approve routine dispatch. Ask him only
   for a genuine business ruling or material production risk. Recompute after
   every merge. Preview and merge stay globally serialized.

   An empty author lane is valid only when the audit has classified every open
   `db-work` issue and reports no eligible issue for it. Unclassified, malformed,
   blocked, owner-decision, and every non-structural work type never consume a
   lane; unclassified or malformed issues also prevent a claim that no work
   exists. While an author waits for CI, review, preview, or merge, continue safe
   local work or prepare the next queued issue without creating overlapping
   migration files.

   After an issue reaches an exact reviewed head, atomically assign its external
   reviewer with:

   ```bash
   node scripts/manage-migration-author-lanes.mjs --assign-reviewer \
     --issue <issue> --pr <pr> --head-sha <exact-head>
   ```

   The machine-independent cursor rotates Grok 4.6 → GLM 5.2 → Kimi K3 → Qwen
   3.8 Max → repeat. Use only `ai-grok-review`, `ai-glm`, `ai-kimi`, or `ai-qwen`
   and their fixed model settings. Reuse one named session for rebuttals. Require
   a current exact-head re-read and `APPROVE` or `REVISE` with evidence. Verify
   every claim independently. Relay disagreements with
   `templates/delegation/debate-turn.md`, stopping at agreement or the initial
   review plus three rebuttals. If material disagreement remains, stop the merge
   and ask Albert one concise decision. Never send secrets or licensed rows.

   **Reviewer transport failures never pause the queue.** Run reviewer wrappers
   from the full-access orchestrator process, not from a delegated sandbox. Before
   starting, prove the selected wrapper can read its own authentication file and
   create its session directory. A permission denial, missing authentication,
   provider quota error, or wrapper timeout with no verdict is a transport failure,
   not a review. Stop that process, record `verdict=none` and `artifact=none`, and
   immediately use `--replace-failed-reviewer` with the matching terminal failure
   code. Continue with the manager-selected replacement from the full-access
   orchestrator in the same turn. Never leave an author, preview, merge, or
   production lane waiting on a reviewer process that cannot authenticate or
   write its own state. A real `REVISE` verdict is not a transport failure and
   must never be replaced.

   Append objective reviewer evidence through an `ai-devops` PR to
   `models_comparison_grok_kim_glm.md`: issue/PR, requested and proven model,
   verdict, confirmed/disproved findings, defects, false positives, policy/tool
   adherence, continuity, latency, turns, and only metrics the wrapper reports.
   Kimi headless metrics and returned model are unavailable; never invent them.
   After review approval, green checks, preview proof, and guarded merge, the
   production workflow runs `scripts/production_business_risk_gate.py`. It
   derives the result from the exact merged PR and required checks, immutable
   review artifact, pinned preview-apply artifact and ledger, current-main SQL,
   and the activation record. Caller-written booleans or prose are never
   evidence. Automatically promote only when those governed records prove: no
   existing data is deleted or permanently rewritten, no expected user downtime,
   no material access change, a tested credible recovery path, and no unresolved
   material objection. Ambiguous SQL stops for Albert. Ask him one plain
   business-risk question. Never ask him to approve migration numbers, project
   identifiers, SQL, or other technical details. This policy cannot authorize
   its own rollout. `config/production-risk-policy-activation.json` remains
   inactive, and the older exact-approval rule remains binding, until #1015 is
   independently reviewed, both PRs are merged, the installed skill hash matches
   canonical ai-devops, and the forward-test proof hash is recorded. The gate
   verifies those facts again before it can permit automatic promotion.
   Record Qwen High as requested, but never override the wrapper's qualified
   fixed configuration.

   Audit reports malformed claims without hiding the healthy ones; allocation
   still refuses while any malformed claim exists. **Expiry never unlocks an
   object.** Renew active work or explicitly release a claim after proving its
   branch/worktree/PR is finished. Cleanup may report stale work, but it must not
   silently close it. A reserved version is never freed for reuse because an
   abandoned version may already exist in preview's ledger.

   **If you cannot list the objects up front, your task is read-only** — and read-only work cannot
   collide. Close your claim when the work merges or is abandoned; an open claim
   is a lock on those objects, not a note.

   This runs BEFORE the work. The `Cross-PR object collision` CI check is the
   backstop AFTER it, and by the time that one fires, somebody's session is
   already wasted — on 2026-07-31, three of four were.

   Before preview and again before merge, acquire the exclusive GitHub-backed
   `preview` or `merge` lease. Instructions in chat are not a lock. Fetch `origin/main`, update the branch
   from newly merged `main`, and re-run the version/object checks and all existing
   SQL/cross-PR guards. A clean author lane does not grant access to preview.
   The orchestrator grants the single preview lane, then the single merge lane.
   Release each stage lease explicitly when that stage ends. Required CI rejects
   a migration PR unless its exact version and normalized objects match a live,
   branch-bound author claim; merge CI also requires that PR's merge lease.
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
   requirement is unconditional. **§0.0-B does not narrow this.** An application session
   that owns its own data writes still owes the proof on every one of them: §0.0-B decides
   *who authorises* a statement, §4.2 decides *that you know where it lands*. Both bind.
2. **"Prove" means an explicit check of the live connection target, executed immediately
   before the statement.** It is not an assumption, not a memory, not a check made earlier in
   the session, not a `.sql` filename, not a branch name, not a doc, not a plan that said
   "preview". Any tool call, environment change, reconnect, or turn boundary between the
   check and the statement invalidates the check — redo it.
3. **The proof must be stated in the agent's report** — the message it gives the owner (or
   the orchestrator) at the end of the turn — quoting the value it actually
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

## 4.3 OWNER RULING — issues, handovers and plans point at the LIVE reading, never at a number (Albert Hazan, 2026-08-11)

> "Create a standing rule that issues point at the live reading."
> — Albert Hazan, 2026-08-11

`HANDOFF.md` already says no document wins by name or by date — re-derive from `git`/`gh`.
That was never written down for **issues**, which is where sessions actually pick up work,
and the cost showed up in one day: #773 said production was **53** migrations behind when a
live read the same day said **57** of 433 files; #712 said "63 behind, now 53" and both
numbers were already wrong; #712's out-of-order example named **one** version pair when the
live read found **48**; #736 claimed to index every open owner decision and was stale by
~14 hours, missing at least four newer issues; and #710/#773 carried a **B3/B4 overlap** —
two versions listed in both batches — that only a live read caught.

**The rule: state the COMMAND that yields the figure, not the figure.**

**What counts as a live figure** — anything `git`, `gh` or a database query can answer right
now: migration file counts; applied and unapplied counts; ledger position; row counts; batch
membership; open issue and PR lists; branch, worktree and SHA state; "max applied version".
If a number would change without anyone editing the document, it is a live figure.

**Quote these commands instead** (these are the ones proven correct):

```bash
git ls-tree origin/main --name-only supabase/migrations/   # migration files on main
gh issue list --repo u2giants/shared-db --label db-work    # open db work
gh pr list --state open                                    # open PRs
```

⚠️ **Never `ls supabase/migrations/`.** The shared checkout is usually parked on another
branch, so `ls` silently reports that branch's files as if they were `main`'s. This exact
error was made on 2026-08-11. Always `git ls-tree origin/main`, after a `git fetch`.

⚠️ **The production ledger is applied OUT OF ORDER.** The highest applied version implies
NOTHING about what is applied beneath it — on 2026-08-11, 48 unapplied versions sorted below
the max applied one. **Any document that reasons from a high-water mark is wrong.** Compare
the two full lists, never the two maxima.

**When a number genuinely must appear** — for human readability, or because it is a decision
input — stamp it and mark it as perishable:

```text
57 of 433 unapplied [SNAPSHOT 2026-08-11T14:20Z — `git ls-tree origin/main --name-only
supabase/migrations/` + `supabase migration list` on production. RE-DERIVE BEFORE ACTING.]
```

A snapshot without the timestamp, the source command and the re-derive marker is a defect —
fix it when you see it. And no session may act on a snapshot it did not re-derive itself.

⛔ **Do not propose a CI check that compares documents to GitHub issues.** It has been
proposed twice, built once (B13) and deleted once, and three models re-reviewed it on
2026-08-13 and rejected every variant. The reasoning, the verified false-positive rates and
the one narrower check that could earn its place later are in
[`docs/artifact-consistency-checker-rejected-20260813.md`](docs/artifact-consistency-checker-rejected-20260813.md).
The mitigation for unsourced figures is this section plus the plan standard's rule that a
status row marked done must cite an artifact, never a bare number.

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

### 5.1 Promoting to production when a backlog exists — NEVER `--include-all` on the full repo set, ALWAYS inside the pruned temp checkout (learned 2026-07-23; recipe corrected 2026-07-27; wording made self-consistent 2026-08-09)

> ✅ **The #611 gate is DISCHARGED — corrected 2026-08-12.** It **RAN** on 2026-08-10 against
> `main` tip `bc29d36` on the pinned **Supabase CLI 2.105.0**
> ([`scripts/experiment_611_db_push_atomicity.sh`](scripts/experiment_611_db_push_atomicity.sh);
> full result in
> [`docs/verification/issue-611-db-push-atomicity-20260810.md`](docs/verification/issue-611-db-push-atomicity-20260810.md)).
> **Licensor batches are no longer blocked by #611.** This block previously still read *"no
> licensor batch may go until … has been RUN"*, directly contradicting §5.1-A two hundred lines
> below, which has recorded the gate as discharged since 2026-08-10. A reader following the old
> wording would have blocked a promotion that is in fact cleared.
>
> ⚠️ **The gate REOPENS on any Supabase CLI version bump** — the result is pinned to **2.105.0**.
> If you are not on 2.105.0, re-run the script and re-record before promoting. **Read §5.1-A in
> full before you promote anything**: everything else it says still binds, in particular that
> `db push` is atomic **per FILE, not per batch**, and that **"PREFLIGHT OK" is not an approval**.

Production almost always has **pending migrations from other workstreams that sit *before* your
own** (e.g. DB Data Admin write paths, DAM taxonomy cutover, PopSG — several deliberately
unpromoted). When that is true, `supabase db push` **refuses to run** and suggests
`--include-all`.

**The rule has two halves, and they are not in conflict — read both before you run anything:**

- **Forbidden:** `--include-all` against the **full repo set** in `$GITHUB_WORKSPACE` (or any
  checkout that still contains other workstreams' pending files). There it promotes *every* pending
  migration at once, including work another team has deliberately kept off production.
- **Required:** `--include-all` **inside the pruned bounded temp checkout** built in step 2 below,
  once the dry run has confirmed the file list. There the migrations you must not promote are no
  longer on disk, so the flag cannot reach them, and without it the push will not finish.

What decides it is **which set of files is on disk**, never the flag itself.

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

#### 5.1-A The lane is now RUNNABLE — how a production apply actually happens (built 2026-08-10, issue #617/#660)

**Everything in §5.1 above still describes the mechanics.** What changed is that you no longer
perform them by hand. The workflow
[`.github/workflows/shared-supabase-migrations.yml`](.github/workflows/shared-supabase-migrations.yml)
now has an `apply` mode that does the whole bounded-temp-checkout recipe for you, under gates.
Before 2026-08-10 that job opened with a step called `Refuse production apply`, so the lane could
never run at all — which is why four licensor features queued up behind it.

**To promote, dispatch the workflow with:** `target: production`, `mode: apply`, the exact
`origin/main` SHA, the comma-separated allowlist, `confirmation: APPLY <sha>`, and
the successful review-evidence workflow run ID plus its `sha256:` artifact digest (see gate 2).
A wrong confirmation string fails on the first step, before any credential is used.

**Three gates, and NONE of them is sufficient alone:**

1. **`production-apply-review`** — deterministic. The typed string, the exact SHA, and the whole
   guard chain (`parse_allowlist` → hard blocks, the §6.8 all-four bundle, the §6.5 hold, the
   co-presence rules → `validate_candidates` → whole-batch preflight). This job fails the run.
2. **IMMUTABLE REVIEW EVIDENCE.** Dispatch the non-writing
   `production-apply-review-evidence.yml` workflow with the exact current 40-character main SHA,
   exact ordered allowlist, and verdict. GitHub records the authenticated reviewer actor and
   uploads strict canonical JSON. Only `APPROVE` succeeds. The apply dispatch must pin that run by
   its decimal run ID and canonical `sha256:` artifact digest. The verifier rejects URLs, paths,
   stale or failed runs, another repository/workflow/SHA, altered or expired artifacts, unknown
   JSON fields, a non-APPROVE verdict, a different actor, and any missing, duplicate, reordered,
   subset or superset allowlist. It runs both before and after the environment wait. Because
   GitHub artifacts expire, the second check copies the verified JSON into the final apply
   evidence. This contract is provider- and model-neutral. Never add a provider or model name.
3. **`environment: production`.** Keep this binding. It remains the deployment boundary even
   after its separate manual-reviewer rule is removed.

**OWNER RULING, 2026-08-12:** permanently remove Albert's required-reviewer click only after this
repo-side evidence gate merges and passes CI/read-only proof. Albert does not review code, so the
click adds no technical safety. Removing it is not permission to weaken any exact-SHA,
confirmation, dependency, preview, fresh-ledger, bounded-checkout, dry-run, apply, post-ledger,
catalog-verification, or artifact gate. The GitHub environment change is a separate phase and is
not made by this repository patch.

**Issue #646, also fixed here:** `production-dry-run` is **off** the `production` environment.
It used to sit on it, so Albert was asked to approve every practice run — and a gate that fires
on harmless events trains its holder to click approve without reading, which is the last habit
you want on the one run that writes. The dry-run job is now read-only (`link`,
`migration list`, `db push --dry-run`) and ungated. **If you ever add a mutating command to it,
put the environment back first.**

**Customer #1 is a canary, not a licensor feature.** `20260810140000_production_lane_canary.sql`
creates one table, inserts one row, and is read by nothing. It goes through the lane first so a
lane failure can never be confused with a migration failure. This lane has already produced two
failures that looked like migration faults and were neither — both lexer bugs in
`scripts/production_migration_guard.py` (`$$` inside a comment, then prose inside a string
literal). Do not send Disney, Paramount, NBCU or Warner through untested write machinery.

**Three limits you must not read past.**

- ⚠️ **"PREFLIGHT OK" IS NOT AN APPROVAL.** `strip_sql` removes dollar-quoted bodies on purpose
  (names inside a function body resolve at CALL time), which means a `do $$ … $$` block hides its
  apply-time references from the scanner completely. A batch whose real dependency lives inside a
  DO block passes preflight and still aborts on production. The preflight may REJECT; it can never
  certify. The authoritative gate is the rehearsal against a production-shaped database.
- ⚠️ **`db push` is atomic PER FILE, NOT per batch. Issue #611 was MEASURED, and the gate is
  DISCHARGED.** The experiment
  [`scripts/experiment_611_db_push_atomicity.sh`](scripts/experiment_611_db_push_atomicity.sh)
  RAN on the hetz VPS on 2026-08-10 against `main` tip `bc29d36`, on the pinned **Supabase CLI
  2.105.0**, with the tripwires `ledger rows seeded: 424` and `container TLS: on` both confirmed.
  Full result, both binary checksums, every Q1–Q6 block and the complete raw log:
  [`docs/verification/issue-611-db-push-atomicity-20260810.md`](docs/verification/issue-611-db-push-atomicity-20260810.md).
  **Licensor batches are no longer blocked by #611.**

  **What was FOUND — say it this way, and no wider:**
  - A migration's SQL and its `supabase_migrations.schema_migrations` row **are written in one
    transaction, per FILE.** Proven, not inferred: blocking the ledger insert with a `BEFORE
    INSERT` trigger took the file's perfectly valid SQL down with it (exception seen **t**, table
    absent **f**, ledger row absent **f**).
  - **The BATCH is NOT one transaction.** File A stayed applied **with its ledger row** after file
    B failed. **A 63-migration run that dies on file 40 leaves files 1–39 applied and ledgered. A
    mid-batch failure does NOT leave production unchanged.**
  - **The feared state did not appear.** Nothing produced SQL-applied-without-a-ledger-row.

  **The operational consequences — these are the point:**
  - **Promote in SMALL, BOUNDED batches.** The bigger the batch, the more of it is already
    committed and unrecoverable-as-listed after a mid-run failure.
  - **Expect the recovery path to be "the fix ALONE."** The applied files stay applied; the next
    allowlist contains only what still needs to run.
  - **The one-directional co-presence rules below, and the already-applied refusal in
    `validate_candidates` (`scripts/production_migration_guard.py`), are CORRECT AS WRITTEN. The
    experiment confirms the assumption they rest on. DO NOT SOFTEN THEM** and do not "tidy" the
    asymmetry away — the asymmetry is exactly what keeps "the fix alone" a legal recovery.

  **Scope — do not overstate this, which is why the gate existed.** The result is for **CLI
  2.105.0 only** and is **conditional on file contents**, not a universal law about `db push`. A
  CLI version bump **reopens #611**: re-run the script and re-record. During earlier review a
  reviewer asserted this answer by reasoning, was challenged, retracted, and dropped its own
  confidence from 85% to 30% — the answer above is measured, and only what was measured.

  **Why it mattered — the two bad outcomes it ruled out:**
  - *SQL without a ledger row:* a re-run replays the same SQL and dies on duplicate-object
    errors, and a `CREATE` can be left standing on production without the security migration
    that was supposed to follow it.
  - *Ledger row without SQL:* `validate_candidates` refuses that version forever (it rejects any
    allowlist containing an applied version), and preflight starts trusting objects that do not
    exist. Recovery requires manual ledger surgery on production.

- 🚫 **MIGRATION AUTHORS: `CREATE INDEX CONCURRENTLY` CANNOT BE PUSHED AT ALL.** The same
  experiment (Q4) found that CLI 2.105.0 sends a migration file down a **pipeline**, and
  PostgreSQL refuses `CREATE INDEX CONCURRENTLY` inside one:
  `ERROR: CREATE INDEX CONCURRENTLY cannot be executed within a pipeline (SQLSTATE 25001)`.
  The whole file rolls back cleanly — safe, but the migration **fails outright** and takes the
  rest of its batch with it. The same applies to anything else PostgreSQL refuses inside a
  transaction block or pipeline: `REINDEX … CONCURRENTLY`, `VACUUM`,
  `REFRESH MATERIALIZED VIEW … CONCURRENTLY`, `CREATE DATABASE`, `ALTER SYSTEM`. **Write a plain
  `CREATE INDEX`.** If a concurrent build is genuinely required for a large table, it must be run
  as a deliberate out-of-band operation, never as a migration file.
  **Scan result, 2026-08-10 at `bc29d36`:** all **424** migrations were searched
  case-insensitively (multi-line tolerant) — **ZERO hits**, including **zero in the 63-migration
  production backlog `20260724060000` → `20260810140000`**. The promotion plan is unaffected. The
  only matches for the word "concurrently" are prose inside two error messages
  (`20260802140000_acknowledge_taxonomy_sync_alert_rpc.sql`,
  `20260802150000_taxonomy_alert_actor_heuristic_word_anchors.sql`). That is a point-in-time
  result; this bullet is a standing constraint on new migrations.

**The co-presence rules are ONE-DIRECTIONAL, and that is not an oversight.** Three security
pairings are enforced in `parse_allowlist`: `20260810020000` requires `20260810090000` (between
them `service_role` holds TRUNCATE on 23 tables, and TRUNCATE does not fire row-level triggers);
`20260810070000` requires `20260810080000`; `20260810030000` requires both `20260810110000` and
`20260810120000`. **The reverse is deliberately NOT enforced.** `validate_candidates` refuses any
allowlist containing an already-applied version, so if a run dies between a create and its fix,
the fix ALONE is the only legal recovery allowlist. A symmetric rule would refuse that recovery
and force an operator to edit the safety guard under pressure while production sits exposed.
Do not "tidy" it into symmetry.

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
`paths:` filter, running only the two `node` commands.

✅ **That fix IS BUILT and has been since 2026-08-05.** It is
[`.github/workflows/domain-ownership.yml`](.github/workflows/domain-ownership.yml): no `paths:`
filter, `on: pull_request` plus `on: push` to `main`, one job that runs
`scripts/check-domain-ownership.test.mjs` and then `scripts/check-domain-ownership.mjs`. Its
check-run name is **`Domain ownership`** and it is one of the six required contexts on `main`
(§6.7). Verified green against the `main` tip on 2026-08-09. The duplicate invocation still
inside `db-data-admin.yml` is left there deliberately — it is cheap, and removing it would
weaken that workflow's own self-check.

*(This paragraph said "Not yet built" until 2026-08-09, four days after it was built, while
§6.7 of this same file already relied on the workflow existing. Issue #657. If you are adding
a repo-wide guard, the pattern to copy is `domain-ownership.yml` or
`intake-pointer-guard.yml`: own workflow, no `paths:` filter, unique check-run name, required
context.)*

**The stale-verdict trap itself is NOT retired.** Everything above about reading the run's SHA
before believing a red X still applies, to every `paths:`-filtered workflow in this repo.

### 5.2-A A SECOND flavour of false red: the job never ran at all (hosted-runner starvation, added 2026-08-12, issue #513)

Dated evidence: on **2026-08-06**, `Cross-PR object collision` on **PR #466** went **red after 44
minutes without ever executing a step**. The job annotation read:

> *"The job was not acquired by Runner of type hosted even after multiple attempts."*

That is **GitHub hosted-runner starvation, not a collision**, and not a fault in your PR.
`gh run rerun --failed <run-id>` cleared it.

**Before you believe any red required check, read the job annotations**, not just the red X:

```bash
gh run view <run-id> --log-failed
gh api repos/u2giants/shared-db/actions/runs/<run-id>/jobs --jq '.jobs[] | {name, conclusion, steps: [.steps[].conclusion]}'
```

A job whose steps are all `null`/empty never ran. Re-run it; do not go looking for a code defect,
and above all do not "fix" a guard that never executed.

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

**ColdLion purchase/sales history (`prodHistory` / `orderHistory`) — read the shape doc before
writing any loader.** These two endpoints (new to us 2026-08-14) carry order history for buying
and selling. Their payload is documented from live probing in
[`docs/coldlion-history-endpoints-shape.md`](docs/coldlion-history-endpoints-shape.md). Three
traps that will silently corrupt a load if you skip it:

- **They are NOT paged.** They return a plain array and **silently ignore `page`/`size`**
  (`size=5` returned 265 rows). A paging loop re-fetches the same rows forever. Chunk by date.
- **`prodHistory` repeats component rows for two different reasons that look identical** — a
  `last*` lookup fan-out (collapse) and genuinely separate buy lines on one order (keep). Near
  50/50 in the sample, and **there is no line-number field to tell them apart**. The rule, and
  the residual case that must ALERT rather than guess, is in §4.3 of that doc.
- **`lineInvoiceQty` / `lineOpenQty` are zero in all 5,874 sampled rows**, as is `depositPerc`
  on `prodHistory`. A report built on them reads zero and looks like a business fact.

Also: the feed spans **four divisions** (`CW001`, `EH001`, `EP001`, `SP001`), not just `EH001` —
a short window shows only `EH001` and misleads. `1900-01-01` is the empty-date marker
(**owner-confirmed 2026-08-14 — settled, do not re-raise**), and `salesOrderNo = 0` on
`prodHistory` means "no linked sales order", not a broken link.

### 6.1 Merch groups / licensors / properties — read this before touching them

Anything involving licensor, property, big theme, little theme, style guide, art type,
art source, artist, age group, or `mgTypeCode` must start at
[`docs/merch-group-taxonomy-architecture.md`](docs/merch-group-taxonomy-architecture.md).

For the active ColdLion Licensor/Property source cutover, read the STATUS table in
[`plan_coldlion_licensor_property_accelerated_cutover.md`](plan_coldlion_licensor_property_accelerated_cutover.md)
before re-deriving or re-planning anything.

**Step 7A (the real recurring feed) is BUILT and preview-proven as of 2026-07-29; the next action
is Step 8, the production business-risk gate in §4.** Two rules that catch sessions out:

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

**Durable source-resolution decisions.** `plm.source_resolution` is the capture-independent
home for a human decision that a Paramount or NBCU source identity matches a canonical property,
character, style guide, or asset. Source loaders never write it and must leave the deprecated
resolution columns on capture rows unresolved and null. Human tools use
`plm.set_source_resolution()`; a later capture cannot bypass that decision.

**What this means in practice TODAY.** The durable resolution record above does not identify
which ordinary fields on a matched `core.*` row were curated. So the operative rule remains
non-advisory: **an import writes a curated field only on INSERT of a genuinely new row, and writes no
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

**Relationship to §0.0-B (2026-08-13).** §0.0-B hands ordinary application data writes back to the
application sessions, and **explicitly preserves this subsection as its one carve-out**. Nothing
here is relaxed. The scope is unchanged and is defined by **provenance and target**: outside-sourced
content written into curated Master Data (`core.licensor`, `core.property`, `core.character`,
`core.customer`, `core.factory` and their `*_ext` tables). Do not read §0.0-B's "app sessions own
their data" as an exemption from §6.4 — it names §6.4 as the exception to itself. Equally, do not
read §6.4 as reaching an application's own rows in its own tables; it does not, and never did.

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
  orchestrator intake as ruling 4.)
- **`dflow.*` is being retired; `core.*` becomes the source of truth for all applications**, fed
  from ColdLion as the ultimate upstream. (Recorded in the orchestrator intake as ruling 6.)
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

> ### ⛔ READ THIS FIRST — two owner rulings on 2026-08-07 that change everything below
>
> **(1) `u2giants/shared-db` is PUBLIC, and it stays public.** It was made private at
> ~15:10 UTC on 2026-08-07 and **public again at ~16:5x UTC the same day, on Albert's
> explicit and twice-repeated instruction.** Do **not** make it private again, and do not
> re-raise the question.
>
> **(2) OWNER RULING — the Disney OPA property/character extract is NOT sensitive
> (Albert Hazan, 2026-08-07).** `docs/verification/opa-characters-20260806/opa-characters.csv`
> — 10,262 rows of Disney property and character names with Disney's own IDs — may stay in
> this public repository. Albert was told plainly, twice, that making the repo public
> republishes that file and that it had never been moved to `licensor-source-data`. He
> ruled: *"that data is not sensitive."* **He owns the Disney licensee relationship and
> this is his call to make. It is settled.**
>
> **What this supersedes.** Request **R-SEC-1** — in the retired `COORDINATOR_INTAKE.md` queue,
> readable only in history via
> `git show 360b85b3eec79c5f498cf9e669350737db27e6ab:COORDINATOR_INTAKE.md` — asks for that
> CSV to be moved out and scrubbed from git history before the repo can go public. **Its
> premise is overruled.** Parts (a) and (b) — move the file, leave a pointer — are now
> optional tidying, not a blocker. Part (c), the git-history rewrite, is **cancelled**;
> do not rewrite this repository's history for that reason. Part (d) is done.
> The private repo `u2giants/licensor-source-data` exists and holds only a README.
>
> **Why this is written here and not only in the queue.** A future session reading R-SEC-1
> on its own would make the repo private again, which silently destroys branch protection
> (see the note below). This ruling is the stop.
>
> **⚠️ The trap that caused it, worth keeping.** Going private **silently removed all
> branch protection**, because a private repository on this account's plan cannot have it.
> `gh api …/branches/main/protection` returned `403 "Upgrade to GitHub Pro or make this
> repository public"` and `…/branches/main` reported `protected: false`. Nobody noticed for
> about two hours. Protection was **restored in full** at 2026-08-07 after the repo went
> public again, and read back live to the exact table below. **Visibility and protection
> are coupled on this plan. Never change one without checking the other.**

Albert turned branch protection **ON** for `main` on 2026-08-04. This is a standing decision, ruled
by the owner. **It is settled — do not re-ask it, do not treat it as an AI's preference, and do not
weaken it.**

**The verified fact, not a claim.** Read back live and **RE-DERIVED on 2026-08-12** (previous
re-derivation 2026-08-06 16:00 UTC) with:

```bash
gh api repos/u2giants/shared-db/branches/main/protection
```

The 2026-08-14 read matched every row below exactly, including `Migration author lease`,
`Migration guarded merge authorization`, and **not** `Backlog / queue sync`; `strict: true`, `enforce_admins: true`,
`allow_force_pushes: false`, `allow_deletions: false`. **The table is accurate as of that date —
and you must still run the command rather than trust it.**

| Setting | Value |
| --- | --- |
| `required_status_checks.contexts` | `["Promotion contract tests (offline)", "Cross-PR object collision", "Tools offline tests", "SQL migration guards", "Domain ownership", "Intake pointer guard", "Handoff contract", "Migration author lease", "Migration guarded merge authorization"]` (**nine**) |
| `required_status_checks.strict` | **`true`** (changed 2026-08-06 — see below) |
| `enforce_admins.enabled` | **`true`** |
| `allow_force_pushes.enabled` | `false` |
| `allow_deletions.enabled` | `false` |

> **`strict` was turned ON on 2026-08-06, by the owner's explicit instruction.** It had
> been `false`, which left a real hole: `.github/workflows/pr-object-collision.yml` says in
> its own header that it cannot re-run when a *sibling* PR appears later, so the last
> member of a colliding set must be re-checked — and *"require branches to be up to date
> before merging"* is what forces that. With `strict: false`, two PRs could both pass every
> check and both merge, silently erasing one another. That is the 2026-07-31 four-way
> incident's exact mechanism. **Do not turn it back off.**
>
> ⚠️ **This table was stale for two days once already** — it read `strict: false` and four
> contexts after both had changed. A reviewing model (Grok 4.5, 2026-08-06) read it and
> concluded a *correct* document was wrong.
>
> **STANDING INSTRUCTION: never quote this table as fact. Run the `gh api` command above and
> quote the live output**, in any issue, handover, review, or PR description that turns on
> branch protection — and re-read it back whenever you change protection, stamping the new date
> here. This follows §4.3 (point at the live reading, never at a number). Prose asserting mutable
> state goes stale; the command does not. Two rows are **owner rulings you may never weaken to
> make a check pass**: `strict` stays `true` and `enforce_admins` stays `true`.

**The rule.**

1. **CI guards on this repository are no longer advisory.** Merging through a red *required* check
   is now **mechanically impossible**, including for admins — `enforce_admins` is `true`, so there
   is no "orchestrator override". The event that motivated this ruling was real: on 2026-08-03 PR
   #431 was merged through a **red** `verify` check (run `30846938009`, job `91797438635`). That
   route is closed.
2. **`main` cannot be force-pushed or deleted.** Any recovery plan that assumes a rewrite of `main`
   is invalid. Fix forward.
3. **Branch protection must not be removed or weakened without an explicit, per-change owner
   instruction naming the setting.** "Unblock the merge", "CI is stuck", "fix the pipeline", or a
   deadline is **not** approval. If a required check is wrong, fix the check — never the protection.
   This mirrors the standing production-infrastructure rule: an AI session does not relax a control
   in order to get past it.
4. **Every PR to `main` — including a docs-only PR — must now pass all SIX required contexts
   before it is mergeable:** `Promotion contract tests (offline)`, `Cross-PR object collision`,
   `Tools offline tests`, `SQL migration guards`, `Domain ownership`, `Intake pointer guard`.
   *(Corrected 2026-08-07. This line said FOUR and listed four for days after there were six —
   re-derive the list with `gh api`, never from this sentence. `Backlog / queue sync` was
   removed and `Intake pointer guard` added on 2026-08-07 by owner instruction naming both.)* Confirm with `gh pr checks` before reporting
   a PR as ready, and check the run's `head_sha` — a green tick can be a **stale verdict from an
   older commit**. A green PR page is not the same as a satisfied required context.

**PATH FILTERING — where it still applies, and where this document was wrong.**
*(Corrected 2026-08-09, plan item F. This paragraph previously said BOTH database-touching
workflows were `paths:`-filtered and that neither could ever be required. That was stale, and
it discouraged the migrations-lane hardening it should have invited. Re-derive from the
workflow files, never from this sentence.)*

The mechanic is real: a `paths:`-filtered workflow reports **NO check at all** on a PR that
misses its paths, GitHub treats a required context that never reports as *pending forever*, and
making such a workflow required would **deadlock every unrelated PR**.

Measured live on 2026-08-09:

- `.github/workflows/shared-supabase-migrations.yml` is **NOT** path-filtered. Its `on:` block
  (`:4-9`) carries a comment saying the omission is deliberate, for exactly this reason. Its
  cheap `validate` job (`SQL migration guards`) runs on **every** pull request and is **already
  one of the six required contexts**. The expensive `preview` and `production-dry-run` jobs are
  gated on `workflow_dispatch`, not on paths.
- `.github/workflows/db-data-admin.yml` **IS** path-filtered (`:5-12`, `:15-22`) and therefore
  cannot itself become a required context. This does **not** leave domain ownership unguarded:
  the required `Domain ownership` context comes from the separate, unfiltered
  `.github/workflows/domain-ownership.yml` (`:26`).

**What is still honestly true.** The migrations lane's *cheap, static* guards block a merge; its
*expensive* jobs — the ones that talk to a real database — run only on `workflow_dispatch` and so
cannot block a merge. Do not let "protection is on" stand in for "a bad migration cannot be
merged": static SQL checks pass on a migration that is destructive at runtime. But do **not**
repeat the retired claim that path filtering makes hardening this lane impossible. It does not.

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

> **This corrected a wrong assumption the orchestrator held on 2026-08-06, and that assumption is
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

### 6.11 `DY` and `DS` are ONE company — the Disney licensor has two spellings (added 2026-08-07)

**`DY` in `core.licensor` is the canonical Disney licensor code. `DS` in the legacy
`public.licensors` table is the RETIRED spelling of the SAME COMPANY. They must never be treated as
two companies, and no session should re-open the question.**

This is not an inference. `supabase/migrations/20260723113000_dam_core_licensor_property_cutover.sql`
— merged and **already applied to production** — hard-codes the mapping in its own SQL:

```sql
case legacy.external_id
  when 'DS' then 'DY'
  when 'WWE' then 'WW'
  else legacy.external_id
end
```

That migration aborts loudly if any legacy licensor fails to map, and it did not abort. **136,697
`public.assets` rows and 10,618 `public.style_groups` rows were rewritten onto canonical
`core.licensor` UUIDs on that basis.** Current production data depends on `DS` = `DY` being right.

The full census — every Disney-related row in both licensor lists, the per-licensor child counts, the
4,048 `plm.style_tracker_item_bridge` rows that already carry the `DY` and `DS` UUIDs *on the same
row*, and the read/write map per application — is in
[`docs/verification/disney-licensor-identity-20260807/README.md`](docs/verification/disney-licensor-identity-20260807/README.md).
**Read it there; do not duplicate or re-measure those numbers here.**

**The same shape exists for WWE, and nobody has documented it.** `public.licensors` spells it `WWE`;
`core.licensor` spells it `WW`. Identical class of duplicate, mapped by the same `case` expression
above, still undocumented and unfixed. Treat it the same way: one company, two spellings, `WW`
canonical.

**What this section does NOT authorise.** It is paperwork, not surgery (Albert chose "Option 2" of
that document on 2026-08-07). Retiring `public.licensors`, moving the ~500 legacy property records,
or re-parenting MARVEL and STAR WARS under DISNEY are all explicitly **out of scope and declined** —
ColdLion pays royalties off Marvel and Star Wars being separate licensors.

### 6.12 CORRECTION to §6.6 rule 5 — there is NO parentage-durability migration (added 2026-08-07)

**§6.6 rule 5 above says `20260802170000` is "the migration that stops `plm.import_master_data`
force-setting `core.property.licensor_id`". That sentence is WRONG.** Verified against the file on
2026-08-07; its own header block says the opposite:

> "The property UPDATE still sets `licensor_id = parent_core_licensor_id`. Whether our curated
> parentage should outrank DesignFlow PLM's is an owner decision nobody has made."

`20260802170000` preserves curated **`status` only**. **No parentage-durability migration exists
anywhere in this repository — not merged, not held.** So promoting `20260802170000` would not make
curated parentage durable, and §6.5's hold is not what is blocking durability. Any curated
`core.property.licensor_id` — set by DB Data Admin, by DesignFlow, or by a migration — is reverted by
the next **successful** `plm.import_master_data()` run.

The exposure is currently **dormant, not fixed**: the PLM master-data lane has not succeeded since
2026-07-08 (§6.4, §6.10-A), which is why every `core.property` row still carries that `updated_at`.
**Parentage durability must be built before the lane is repaired**, or every curated parent edge
silently reverts the moment it comes back. Do not treat "we have a durability migration" as "curated
parentage is durable".

### 6.13 OWNER RULINGS — Paramount landing tables and sub-licensors (Albert Hazan, 2026-08-07)

> ### ⚠️ TWO OF THESE FIVE RULINGS CHANGED ON 2026-08-09 — read this before quoting any of them
>
> **Owner ruling, Albert Hazan, 2026-08-09** (recorded by orchestrator session `8b3f21c4`,
> marker issue [#622](https://github.com/u2giants/shared-db/issues/622)):
>
> | Ruling | Status as of 2026-08-09 |
> | --- | --- |
> | 1 — per-licensor landing tables | **STANDS UNCHANGED** |
> | 2 — "release 1 is FIVE tables, not fifteen" | **SUPERSEDED.** The five-table cap is **lifted**. |
> | 3 — authorized-title count closed at 26 | **STANDS UNCHANGED** |
> | 4 — "build waits for the second Paramount recon" | **SUPERSEDED.** The hold is **RELEASED**; its condition was met. |
> | 5 — sub-licensors stay flat | **STANDS UNCHANGED** |
>
> The original text of rulings 2 and 4 is kept below, marked, because sessions have been
> quoting it. Do not act on the struck parts. The replacements are in §6.13-A.

Five rulings, all made on the evening of 2026-08-07, **two of them since superseded** (see the box
above and §6.13-A). Full record with the reasoning and the
costs: [`docs/verification/owner-rulings-20260807/README.md`](docs/verification/owner-rulings-20260807/README.md).
Read that file before acting on any of them.

1. **Per-licensor landing tables, not one shared table.** Each licensor's raw scrape data gets its
   own `plm.*` tables. No shared multi-licensor landing table with a discriminator column. A shared
   table would force Disney's hard `CHECK`s to be softened for a licensor they have nothing to do
   with, and the importer's shrink-band guard counts rows in its own table — unscoped, a
   **completely truncated Paramount extract would pass by being measured against Disney's ~10,262
   rows**. Silent wrong answer, not a loud one.

2. ~~**Paramount release 1 is FIVE tables, not fifteen.**~~ **SUPERSEDED 2026-08-09 — see §6.13-A.1.**
   Original text, kept because it has been quoted:
   ~~Ships `plm.pmt_capture`, `pmt_property`,
   `pmt_character`, `pmt_property_character`, `pmt_asset`, plus importer, RLS/grants, one `api` view
   and contract tests. Eleven further tables, four views and the collection trigger are deferred —
   they model structure no capture has proven. **Known consequence: release 1 loads assets that
   connect to nothing.** It can answer which characters a property owns, but not which asset shows a
   character.~~

3. **The Paramount authorized-title list is 26, and the count is CLOSED.** The removed `902010`
   entry was a duplicate. Do not re-open it and do not hunt for a 27th title. The *"Viacom Multi
   (Paramount) — 27 codes"* section of
   [`docs/coldlion-unmatched-properties-by-licensor-20260731.md`](docs/coldlion-unmatched-properties-by-licensor-20260731.md)
   is a **different population** (unmatched ColdLion property codes) — do not reconcile the two.

4. ~~**Build waits for the second Paramount recon.**~~ **SUPERSEDED 2026-08-09 — the hold is
   RELEASED; see §6.13-A.2.** Original text, kept because it has been quoted:
   ~~The five tables are designed, reviewed, revised
   and approved, but implementation is **held** until a targeted second recon returns. Each of its
   four open questions can move a primary key, and a wrong key with rows already in it costs a
   migration **plus** a data repair. Do not start the migration because "the design is approved".~~

5. **Sub-licensors stay FLAT.** ColdLion produced 19 new `- DESPERATE` records (5 licensors, 14
   properties). Desperate is a **sub-licensor, not the brand owner**: POP reports sales to Desperate,
   who files royalty reports upward to the real owner. FanCreations is the same shape for NCAA and
   NFL. `core.licensor` will **NOT** model this; Desperate is stored as an ordinary licensor.
   **Consequence, invisible in the data: any report answering "who is the licensor" for those 14
   properties returns Desperate, not the ultimate brand owner.** Also: `ANHEUSER BUSCH - DESPERATE`
   and the existing `potential` `Anheuser Busch` record are **NOT duplicates** — brand owner vs
   sub-licensed route. A future dedupe pass must not merge them.

### 6.13-A OWNER RULING — the Paramount five-table cap is lifted and the build hold is released (Albert Hazan, 2026-08-09)

Recorded by orchestrator session `8b3f21c4`, marker issue
[#622](https://github.com/u2giants/shared-db/issues/622). This supersedes **parts** of §6.13:
rulings 2 and 4 only. Rulings 1, 3 and 5 stand unchanged and are not reopened by this.

**Evidence anchor for everything below.** The completed second Paramount capture lives in the
**private** repo `u2giants/licensor-source-data`, branch `codex/paramount-creative-library-20260807`,
HEAD **`f340f74a`**, with its manifest. `u2giants/shared-db` is **public**: the counts and the
structural shapes below are cleared for publication; Paramount titles, property names, entity names,
source IDs, asset IDs and filenames are **not** and must never be committed here.

#### 6.13-A.1 — Ruling 2 is superseded: the full landing schema is approved

The **five-table cap is lifted.** Approved for build: the full **21-table** landing schema specified
in GitHub issue [#623](https://github.com/u2giants/shared-db/issues/623), **plus two further tables
the orchestrator approved the same day** — `plm.pmt_capture_expectation` and
`plm.pmt_shrink_override`.

**Why the original reason no longer holds.** Ruling 2 deferred sixteen tables because they
"model structure no capture has proven". The completed capture proves all sixteen. **Every one now
has a nonzero proven row count; none would land empty.** Counts from the capture at `f340f74a`
(258 batches, 25,790 asset records):

| Table | Proven rows | Table | Proven rows |
| --- | ---: | --- | ---: |
| `plm.pmt_capture_batch` | 258 | `plm.pmt_asset_collection` | 27,880 |
| `plm.pmt_authorized_title` | 26 | `plm.pmt_asset_brand` | 25,983 |
| `plm.pmt_authorized_title_property` | 38 | `plm.pmt_property_character` | 52 |
| `plm.pmt_franchise` | 18 | `plm.pmt_property_collection` | 426 |
| `plm.pmt_collection` | 426 | `plm.pmt_property_franchise_evidence` | 51 |
| `plm.pmt_brand` | 7 | `plm.pmt_authorized_property_asset` | 25,858 |
| `plm.pmt_asset` | 25,790 | `plm.pmt_relationship_anomaly` | 4 |
| `plm.pmt_asset_property` | 26,451 | `plm.pmt_property_capture_log` | 33 |
| `plm.pmt_asset_franchise` | 25,116 | `plm.pmt_property` | 60 |
| `plm.pmt_asset_character` | 8,558 | | |

**The original caution was honoured, not overridden.** Two things ruling 2 deferred are
deliberately **still not built**:

- **`plm.pmt_franchise_property` is NOT created.** The capture proves Paramount publishes **no
  direct property-to-franchise pair**. The approved build lands
  `plm.pmt_property_franchise_evidence` instead, hard-checked so it can never present itself as a
  direct relationship.
- **There is NO collection trigger.** Collections are exposed as style guides through a
  **read-only view over one table**, so the two vocabularies cannot drift apart.

**What is no longer true.** Ruling 2's "known consequence — release 1 loads assets that connect to
nothing" is **void**. The approved build ships the asset link tables, so the database can answer
*"which asset shows this character?"* from day one.

#### 6.13-A.2 — Ruling 4 is superseded: the build hold is RELEASED

The hold's condition **has been met**. All four questions the second recon had to answer are
answered, verified against the capture at `f340f74a`:

1. **The property field's full-metadata descriptor is `PROGRAM_ID`.** Exactly **seven** metadata
   field descriptors exist across all 258 batches and 25,790 asset records.
2. **Collections carry a real hidden identifier, not just a display label.** 426 collections, 426
   distinct numeric source IDs, one name each. The ID comes from a `source_id` **attribute on the
   cascade element** — it is not parsed out of a label — and the ID-to-name mapping is proven
   **1:1 across all 25,790 assets**.
3. **No character identifier recurs across more than one property.** 52 explicit property-character
   pairs, 52 distinct character identifiers, **zero** overlap. **This is the question that could
   have moved the `plm.pmt_character` primary key. It confirms the approved design rather than
   changing it.**
4. **The combined property-character value is a structured value, not a delimited string.** It
   carries `raw_value`, `display_value`, and an `elements` array of **exactly two** elements, each
   with `key`, `source_id` and `display_value`. **Four** assets are missing the second element's
   source ID — precisely the **4 preserved anomalies** in the manifest, which is why
   `plm.pmt_relationship_anomaly` shows 4 rows above.

Because no answer moved a key, the "wrong key with rows already in it" risk that justified the hold
did not materialise. Building is now the correct action.

### 6.14 OWNER RULING — this repository is PUBLIC; no personal identifiers in anything you write from now on (Albert Hazan, 2026-08-09)

`u2giants/shared-db` is a **public** GitHub repository. Every file, commit message, PR
description, issue comment and CI log is world-readable, permanently and without warning.

**The forward rule — applies to everything you author from 2026-08-09 onward:**

Never write a person's **email address, full name, phone number, home or personal address,
or any other personal identifier** into:

- any file in this repository (migrations, docs, plans, tests, tooling, fixtures, JSON artifacts);
- any commit message;
- any pull-request title or description;
- any GitHub issue or comment;
- any CI job name, step name, or log line.

**Refer to people by their `app.profile` UUID only.** That is the existing precedent in this
repo and it is unambiguous, stable, and discloses nothing. If a human reader genuinely needs
to know *who* a UUID is, that mapping lives in the database, not in a public file.

If a verification artifact would otherwise embed contact data (a JSON baseline dump, a diff
of a vendor or roster table, a test fixture copied from real rows), **do not commit it**.
Commit row counts, checksums, and UUID-keyed diffs instead.

**What is NOT covered by this rule.** Personal names that are *the data itself* — for example
the designer roster seeded into `core.person`, where the name is the business value being
stored — are legitimate schema content and stay. The rule is about *incidental* disclosure:
identifying a person in a comment, a doc sentence, a commit message, or a debugging note,
where a UUID would have done the same job.

**The already-committed occurrences STAY. Do not "fix" them.**

By owner ruling of 2026-08-09, migrations already merged to `main` that contain personal data
are **left exactly as they are**. This is a *known, accepted exposure*, not an oversight, and
not a task waiting for a volunteer. Two reasons, both hard:

1. **They are applied migrations.** The ledger keys on the version string, so an edited file
   will never re-run — editing changes nothing in any database and desynchronises the file
   from the ledger. One of them is also inside the pending production promotion set, where
   changing a single byte is far more dangerous than the disclosure itself.
2. **History rewriting was explicitly rejected by the owner.** No `filter-repo`, no
   `filter-branch`, no BFG, no force-push. Do not propose it again. The old copies exist in
   the public history regardless; scrubbing the tip would not recall them.

The two files, named here so nobody "discovers" them later and opens a well-meaning PR:

- `supabase/migrations/20260726210000_popdam_access_reconcile_legacy_gmail_and_designer_grants.sql`
  — a UUID followed by a comment naming a live work email address.
- `supabase/migrations/20260809170500_db_data_admin_product_depth_mutations.sql`
  — a person's full name in the header comment.

Both are **untouchable**. If you believe you have found a reason to edit either one, you have
not; re-read this section and stop.

**Wider standing exposure (recorded 2026-08-09, no action taken).** A repo-wide sweep on this
date found personal data far beyond those two migrations: several hundred third-party vendor
contact records (email, phone, address) inside a committed verification baseline under
`docs/verification/`, plus work email addresses in a dozen older docs, incident write-ups and
migrations. All of it predates this rule and all of it is already public. It is listed here so
future sessions know the sweep was done and the result was consciously accepted, not missed.
Removing any of it from the working tree does not remove it from history, so removal buys
nothing and costs review risk. **Do not start a cleanup pass without a fresh owner ruling.**

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

- **Cross-workflow take-over (2026-07-31):** [`orchestrator_take_over.md`](orchestrator_take_over.md).
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

## 11b. The role is called ORCHESTRATOR (renamed 2026-08-07)

**One word for the role, and the word is orchestrator.** Owner instruction, Albert Hazan,
2026-08-07. Renamed throughout this file, `HANDOFF.md`, the plans, the tooling, the three
`shared-db-*` skills, and the marker label.

**"Coordinator" is the OLD word for exactly the same role.** It survives in three places,
all deliberately:

1. **Older GitHub issues and their titles**, including any open marker issue.
2. **`HANDOFF.d/` files.** These are write-once records of what past sessions did. This
   repo's own rule is that you never edit another session's handover — rewriting them to
   change a word would falsify the record of who said what.
3. **Git history and merged PR titles**, which cannot be rewritten.

**Both words mean the same thing, and both still load the `shared-db-orchestrator` skill.**
Do not go looking for a separate coordinator skill; there has never been one.

⚠️ **The marker label was renamed `coordinator-marker` → `orchestrator-marker`.** GitHub
carried the existing issues across. **If `gh issue list --label coordinator-marker` returns
empty, that is the rename, not an empty board** — query `orchestrator-marker`. This matters:
step 0 of the orchestrator skill treats an empty result as permission to start, so reading
the old label would let a second orchestrator start while one is already live.

⚠️ **Two filenames deliberately keep the old spelling**, because renaming them would break
links from the 63 migrated issues and from merged PR bodies:
`COORDINATOR_INTAKE.md` (now a retired pointer) and
`plan_coordinator-queue-to-github-issues.md` (a completed plan).

---

## 12. Standing facts an incoming session must know

> **Re-homed from `COORDINATOR_INTAKE.md` on 2026-08-07, verbatim.** These ten rules
> used to live in the orchestrator queue file, and `AGENTS.md` §2 pointed at that file for
> them. The queue is being retired
> ([`plan_coordinator-queue-to-github-issues.md`](plan_coordinator-queue-to-github-issues.md)
> step 8), so they moved here first — otherwise retiring the file would have deleted live
> safety rules, **including the background-task-chip ban**, which is the rule that stopped
> a repeat of the 2026-07-31 four-way migration collision. Caught in adversarial review by
> Kimi K3 and ranked BLOCKING; it was correct.
>
> **This is a relocation, not a rewrite.** The text below is byte-identical to its last
> revision in `COORDINATOR_INTAKE.md`. Do not tidy it here.

Read these before you write anything. Several of them describe failures that
have already happened in this repo, more than once.

1. **One orchestrator.** All work is dispatched to sub-agents in isolated
   worktrees. If you were not started as the orchestrator, you are not it.
2. **SUPERSEDED 2026-08-14:** up to three unrelated migrations may be authored
   concurrently under exact object claims and atomic version reservations.
   Preview, merges and production promotion remain one at a time. Use §4 rule 1.
3. **Never edit a migration that has already been applied.** The migration
   ledger already records that version as run, so editing the file changes
   nothing on any database that has seen it — it only makes the repo lie. Fix
   forward with a new migration.
4. **Duplicate 14-digit migration versions cause a SILENT SKIP.** Two files with
   the same version prefix: one applies, the other is quietly ignored with no
   error. This has happened twice — `20260722220000` and `20260728160000`. CI
   now blocks duplicate versions and backdated versions, but do not rely on CI
   to save you; reserve the version atomically through
   `scripts/manage-migration-author-lanes.mjs --claim` before creating the file.
5. **Never create background task chips for this repo — banned.** Four
   chip-spawned sessions recently authored competing `CREATE OR REPLACE`
   migrations against the *same* database function, three of them sharing
   version `20260731170000`. Because of rule 4 those would have silently erased
   each other. Chips spawn sessions that cannot see each other; this repo cannot
   survive that.
6. **The Supabase MCP server may be bound to PRODUCTION, and it takes no
   project parameter.** There is no way to aim it at preview. Call
   `get_project_url` FIRST and confirm which project you are actually pointed at
   before any other MCP call. All preview work goes through the Supabase CLI /
   psql, and you must verify `cat supabase/.temp/project-ref` immediately before
   every push.
7. **Preview (`rjyboqwcdzcocqgmsyel`) is a SHARED, MUTABLE resource** holding a
   full clone of production data. It is currently **NOT a clean baseline** —
   other sessions have written to it. Never assume it is empty, never assume it
   matches production, and treat anything you apply there as visible to everyone
   else.
8. **Documents in this repo go stale within the hour.** Verify against the live
   repo, not against what a Markdown file says.
9. **Property codes are NOT globally unique — never resolve a property by code
   alone.** Licensor → Property is a **parent-child** relationship and the *same*
   code can exist as separate property rows under many different licensors at
   once. The schema enforces exactly this:
   `core.property … unique nulls not distinct (licensor_id, code)`
   (`supabase/migrations/20260621150815_app_core.sql:200`). **`core.licensor` is
   different** — it *is* `unique nulls not distinct (code)` (`:188`), so
   **licensor** codes are global. The two are routinely confused, and confusing
   them produces instructions like *"re-parent code `CC` under Disney"* that are
   not meaningful. Owner-confirmed by Albert Hazan, **2026-08-06**. See also
   `AGENTS.md` §6 (merch-group codes are unique only within
   `(division, mgTypeCode)`) and `fix_item_taxonomy_wiring.md:147`.
10. **Worktree counts in this repo are per-MACHINE and go stale immediately — always
    re-measure, never quote.** Measured on **`al8960ofc`, 2026-08-06**:
    **3 worktrees** — the `C:\repos\shared-db` main checkout plus two live
    sub-agent worktrees (`.claude/worktrees/cutover-plan`,
    `.claude/worktrees/stale-sweep`), both **held by running agents**. Verified
    with `git worktree list`. **Every earlier count is SUPERSEDED as a statement
    of today's state** — 18 and 22 (2026-07-31), 23, 33/34 (2026-07-31 late),
    51/52 (2026-08-03/05), 16 (2026-08-05), and 1 (2026-08-06 01:49Z). They were
    each true when written, on the machine that wrote them; they are history, not
    inventory. The drop from 51 to 1 was an **authorised sweep**, not a mystery —
    resolved by intake PR #455 (`9a933c8`) and recorded in
    `HANDOFF.d/2026-08-06T0149Z-al8960ofc-orchestrator-skill-repair.md` §4. **Do
    not sweep or remove any worktree on the strength of a number in a document**,
    and never remove one that is dirty, locked, or held by a live agent (B2.3).

### 12.1 More standing facts, added after the relocation (2026-08-12, issue #772; item 15 added 2026-08-13)

> The ten rules above are a **frozen, byte-identical relocation** from the retired
> `COORDINATOR_INTAKE.md` and must not be tidied. The items below are **new** and are recorded
> here instead. Each one has already misled at least one session. Numbering continues from 10.

11. **Preview and production have diverged IN BOTH DIRECTIONS. Neither predicts the other.**
    Verified by object on **2026-08-11**: preview `rjyboqwcdzcocqgmsyel` holds **all 23
    `plm.pmt_*` tables**, with both prerequisite migrations genuinely applied, and production
    `qsllyeztdwjgirsysgai` holds **ZERO** of them. In the other direction,
    `20260810140000_production_lane_canary` **is applied on production and is NOT applied on
    preview**. Both ledgers are also applied **out of order**, in different ways, so a high max
    applied version does **not** mean everything below it is applied. Any claim of the shape
    *"preview is production minus N migrations"* is wrong. A passing preview rehearsal means
    *"this behaved correctly on preview"* and never *"this will behave correctly in production"* —
    **post-apply verification against production objects and behaviour is not optional.** This has
    misled at least three sessions.

12. **The advisory model review in the production apply is a permanent silent no-op.** The step
    *"Production apply review (advisory model verdict + hard guards)"* reports **"NOT RUN —
    `ANTHROPIC_API_KEY` is not configured on this repository"** and is `continue-on-error`. No HTTP
    request is made. **A green production apply run does NOT mean a model reviewed the
    migrations.** The hard guards in that same job are real; the model verdict is not. Tracked as
    #709 and #737.

13. **The migration history is not self-contained — do not expect a clean replay.** Replaying all
    429 migrations into an empty database **applies 363 and fails 66**, because this repo was
    adopted on top of an already-populated database: `public.assets`, the legacy popdam tables and
    the `dflow.*` mirrors exist in preview and production with **no migration here creating
    them**. A CI bootstrap (PR #759) closes most of the gap — quarantined contract files 26 → 11,
    passing tests 14 → 29, replay failures 66 → 10. It lives at `supabase/ci-bootstrap/` and is
    **deliberately not a migration**: a file inserted at the front of an already-applied sequence
    can never re-run, and a back-dated version is exactly what Guard B exists to stop. See also
    §10.1.

14. **Freeze merges before every production apply.** The production apply is pinned to an exact
    `origin/main` SHA. On **2026-08-11** that pin refused **two separately approved runs**, each
    because PRs merged between staging and the owner's click. Nothing was written either time —
    the guard worked — but two owner approvals were wasted, and the third only landed under a
    deliberate merge freeze. **Announce a freeze, hold every merge from staging until the run
    finishes, then release it.** This is standard practice, not an improvisation.

15. **The single-orchestrator rule is scoped to STRUCTURE (owner ruling §0.0-B, 2026-08-13).**
    Rules 1 and 2 above ("one orchestrator", "up to three migration authors") govern changes to the
    *shape* of the database. They do **not** make an application session's ordinary row writes
    into orchestrator work, and a session must not open an issue or hand over merely because its
    feature writes data. The single exception is curated Master Data under §6.4, which stays
    gated. §4.2's connection-target proof still applies to every data write regardless.

---

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
