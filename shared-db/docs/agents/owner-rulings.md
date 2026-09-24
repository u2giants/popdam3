# AGENTS.md — §0, §0.0-A, §0.0-B, §0.1 to §0.4 (gatekeeper rule and owner rulings)

> Moved verbatim from `AGENTS.md` by issue #3481 so that file stays a short router. Section numbers and headings are unchanged; a citation of "AGENTS.md §X" resolves here. Relative link targets were re-pointed from this folder; no rule text changed.

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
[`docs/incidents/20260717-designflow-production-db-port.md`](../../docs/incidents/20260717-designflow-production-db-port.md)
and then the canonical infrastructure runbook it links.

## 0.1-A OWNER RULING — moved

> **0.1-A OWNER RULING — shared-db MAY read production Cloud SQL; it still may not change anything (Albert Hazan, 2026-08-10)**
> Full ruling: [`docs/owner-rulings.md`](../../docs/owner-rulings.md#01-a-owner-ruling). Moved 2026-08-20 (issue #1331); text unchanged.

## 0.2 `data.designflow.app` means DB Data Admin — never the retired system

`https://data.designflow.app` is the permanent production hostname of **DB Data
Admin**, implemented in `u2giants/popdam3` at `apps/db-data-admin/` (moved
from this repository on 2026-09-16, popdam3 PR #135). The retired
legacy application previously used that DNS name, but it has no remaining
runtime, credential, database, API, import, rollback, proxy, or ownership
relationship to it.

Historical `source_system='directus'` values may remain as data-provenance
labels, and applied migrations may retain historical comments. Those are not
live dependencies. Never infer current architecture from them, old transcripts,
old DNS history, or cached TLS state. Before changing the hostname, its routing,
or DB Data Admin deployment, read
[`docs/db-data-admin-domain-ownership.md`](../../docs/db-data-admin-domain-ownership.md)
and run `node scripts/check-domain-ownership.mjs`.

## 0.3 The grid column Multi Filter already exists — reuse it, don't rebuild it

DB Data Admin's grid headers already implement the **AG Grid Multi Filter
equivalent (Text Filter + Set Filter with a searchable checkbox list of distinct
values)**. The reusable, framework-free logic is
`apps/db-data-admin/src/lib/grid-filters.ts`; the React header UI is
`FilterHeader` in `apps/db-data-admin/src/DataAdmin.tsx` — both in `u2giants/popdam3`
since 2026-09-16.

Before building any column-filter UI in ANY POP app, read
[`docs/db-data-admin-column-multi-filter.md`](../../docs/db-data-admin-column-multi-filter.md).
A 2026-07-23 audit of the Markdown in all 28 `u2giants` repos confirmed this is the
org's **first and only** reusable Text+Set filter logic — PopCRM's `DataTable` is
bespoke and legacy, and PopDAM's `filterable-table-head.tsx` is text-only. If a
second app needs this, promote `grid-filters.ts` into a shared package instead of
copy-pasting it a third time.

Do not "add set filters later" — they shipped. Older text in `DB_Data_Admin.md`
that described set filters as future work refers to the pre-2026-07-23 design.

## 0.3-A Scraped Properties source-purpose and mapping rules

Before changing or interpreting the Scraped Properties page, read
[`docs/db-data-admin-scraped-properties.md`](../../docs/db-data-admin-scraped-properties.md).
Every section identifies one Licensor and exactly one source purpose,
`Submissions` or `Creative`. Creative and Submissions identities remain
separate; only authoritative mappings connect them. Unmapped Creative rows stay
visible and are highlighted red.

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
