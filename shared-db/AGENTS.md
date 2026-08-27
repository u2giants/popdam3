> ⚠️ **Auto-synced — do not hand-edit the copies.**
>
> [`u2giants/shared-db`](https://github.com/u2giants/shared-db) is the **single source of truth**. Its entire contents are mirrored into the **`shared-db/` folder** of every consumer repo (CRM, DAM, PM/PIM, DesignFlow PLM) on each push to `main`.
>
> **Reading this inside a consumer repo's `shared-db/` folder?** It's a read-only copy — edits here are overwritten on the next sync. Change the canonical repo instead.

---

# AGENTS.md — cross-app coordination playbook

## Companywide business rules

Business logic is organized by business topic, not by application. Before
changing behavior, definitions, permissions, workflows, calculations, or source
authority, start at
[`docs/business-rules/application-map.md`](docs/business-rules/application-map.md)
and load only the topics the task touches. Application repos may link to these
rules but must not maintain competing copies. The collection, status, correction,
and dissemination process is
[`docs/business-rules/README.md`](docs/business-rules/README.md).

## Historical item merchandise-group classification

Before interpreting `full_item_master.csv`, changing item-description parsing, or reporting historical MG match counts, read [`docs/item-description-mg-classification-process.md`](docs/item-description-mg-classification-process.md) and the completed [`plan_mg_taxonomy_three_axis_repair.md`](plan_mg_taxonomy_three_axis_repair.md). The implemented method separates MG01 physical form, MG02's family-specific subtype or material, and MG03 explicit embellishment. It validates newer codes independently at each depth, builds three independent post-May-13 maps, and matches historical items from three axes to two to one. Missing embellishment is unreadable, not plain; invalid child evidence never erases a valid parent; and a failed full-key match is never an MG01 failure. The older `plan_item_description_mg_taxonomy_repair.md` is retained as superseded history.

## Active contracts and implementation plans

- PopDAM OrderList linked to Master Data: [`plan_popdam_order_list.md`](plan_popdam_order_list.md). Read its STATUS table first. Do not re-derive or re-plan completed steps.
- **Companywide business rules (read before interpreting business meaning):** start at [`docs/business-rules/application-map.md`](docs/business-rules/application-map.md). Licensing Master Data starts at [`docs/business-rules/licensing-master-data.md`](docs/business-rules/licensing-master-data.md); its detailed architecture remains in [`docs/core-master-data-consolidation-aim.md`](docs/core-master-data-consolidation-aim.md).
- **Licensing Master Data implementation:** [`plan_licensing_master_data_implementation.md`](plan_licensing_master_data_implementation.md). Read its STATUS table first and start at the named fresh-session step. It supersedes conflicting execution assumptions in older Character/Style Guide and ColdLion plans without deleting their historical evidence.
- **ColdLion — anything at all:** start at [`docs/coldlion.md`](docs/coldlion.md). It is a map, not a source. **Before asking ColdLion a question, or concluding a field is broken or unknown, read [`docs/coldlion-open-questions.md`](docs/coldlion-open-questions.md)** — twelve questions are already answered there, and on 2026-08-19 a session wasted an afternoon re-deriving one of them.
- **ColdLion raw landing layer (issue #1184), phases 2-6:** [`docs/plan_coldlion-landing-phases-2-6.md`](docs/plan_coldlion-landing-phases-2-6.md). Read its STATUS table first — do not re-derive its measurements or re-plan its steps. Phase 1 (the spine) is merged; phases 2-6 build the feed tables and loaders. The owner's per-field ingest/ignore decisions are [`docs/coldlion-field-decisions-20260819.csv`](docs/coldlion-field-decisions-20260819.csv) and are authority, not a suggestion. Step 4 is blocked until the `orderHistory` line key is resolved from a live pull; there is no `lineNo` in the payload and every obvious substitute silently merges sales lines.
- **Multi-agent database coordination hardening (issue #1366):** [`plan_multi_agent_database_coordination_hardening.md`](plan_multi_agent_database_coordination_hardening.md). Read its STATUS table first. This is repository-maintenance work outside the structure/schema orchestrator; do not route its implementation to that orchestrator or re-derive the completed research.
- **Paramount capture validation after the 2026-08-24 preview rehearsal:** [`fix_Paramount_capture_against_preview.md`](fix_Paramount_capture_against_preview.md). **Complete — do not re-run it to make the document current.** The three required migrations and the JSON-null repair are on preview, and the full Paramount capture succeeded and was verified there. The JSON-null structural repair alone was later promoted to production under separate owner authorization (issue #1418). No production Paramount *data capture* has been authorized or performed; that remains a separate owner decision.
- OrderList source contract: [`docs/app-migration-notes/popdam-order-list.md`](docs/app-migration-notes/popdam-order-list.md), with formula detail in [`docs/app-migration-notes/popdam-order-list-formula-audit-20260807.md`](docs/app-migration-notes/popdam-order-list-formula-audit-20260807.md). Owner ruling: Google OrderList and future Coldlion rows are the same orders; `plm.item` is the ultimate item list. One canonical order/line must retain separate Google and Coldlion source refs.

This is the operating contract for **every AI session working on any app that
shares the Supabase database**: PM/PIM `poppim-web`, CRM `popcrm-web`, DAM
`popdam-web`, and the six `popcre/designflow-*` PLM repos. Read it before
touching code or the database. It exists to stop separate
AI sessions from breaking each other through the one database they all depend on.

> **Started in `shared-db` and you are not the orchestrator? Stop and hand over.**
> This repo runs **one orchestrator session**, which dispatches every task to
> sub-agents in isolated worktrees.
> **To find out who that is and where to send work, run
> `node scripts/check-orchestrator-marker.mjs --resolve` — §11c.** It is the only
> sanctioned source of a routing target. Never take one from conversation history,
> a `HANDOFF.d/` file, or a closed marker: that is how an authorized request was
> once delegated to an orchestrator session that had already closed.
> **Scope: STRUCTURE, not data (§0.0-B, owner ruling 2026-08-13).** This repo and its
> orchestrator govern the *shape* of the database — schema, tables, columns, views, functions,
> triggers, RLS, indexes, migrations. An application session changing its own *rows* does not
> belong here and must not open an issue for it. The one exception is curated Master Data
> under §6.4. **§0.0-C is the orchestrator's own admission test**: anything that fails the shape
> test is REJECTED (it belongs to another session) or FORKED to a fresh sub-agent — never worked
> in the orchestrator's own context window.
> **Any other session with a STRUCTURE change opens a GitHub issue and stops:**
> `gh issue create --repo u2giants/shared-db --label db-work --title "HANDOVER: …" --body-file <file>`.
> ⛔ **EVERY issue this repo receives carries the `db-work` label AND a `db-work-scope`
> block — no exceptions, including bug reports, tooling defects and CI complaints
> that feel unrelated to the queue.** `--label db-work` is not optional decoration and
> a body block is not a substitute for it: the orchestrator finds work by label, so an
> unlabelled issue is invisible no matter how well its body is written. That is not
> hypothetical — #1188, #1238, #1242, #1266 and #1268 all carried valid scope blocks and
> were still missed for weeks because nobody labelled them. If `gh issue create` fails
> and you retry, re-check the label on the issue you actually created. The queue audit
> (`--queue-audit`) now reads **every** open issue, prints `UNLABELLED ISSUES` and exits
> `2` until each one is labelled.
> ⚠️ **`COORDINATOR_INTAKE.md` is RETIRED** (2026-08-07) and is now a short pointer file.
> **It stays on disk on purpose — retired means "pointer plus guard", not "deleted".** The
> required check `Intake pointer guard` fails any PR that regrows a queue in it **and also fails
> if the file is missing**. Do not write into it and do not delete it; keep it under 40 lines and
> 4 KB. ⚠️ **Do not confuse it with `backlog-queue-sync`**, the deleted check `HANDOFF.md`'s
> `## BACKLOG` note refers to (removed in `534b20f`). Reading that note as "the intake guard is
> gone" leads straight to deleting a file a required check demands (issue #657).
>
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
> Exit 0 = no actionable drift (retired/held versions remain listed), 1 = actionable
> drift, **2 = could not check, which is never "no drift"**. It also
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

## 0.0-C The orchestrator admission test — what it may keep in its own context

§0.0-B says what this repo governs. **This section says what the orchestrator session is allowed
to spend its own context window on**, which is a narrower thing and was never written down. Two
leaks made orchestrator sessions long and slow: other sessions filed anything with "db" in it and
labelled it `db-work`, and orchestrators read those items and did the work themselves instead of
handing it out.

### The test

Before opening, accepting, or acting on any item, answer one question:

> **Does this change the SHAPE of the database** — a schema, table, column, type, view, function
> or RPC, trigger, row-security policy, grant, index, constraint, extension, publication, storage
> policy, or a migration that ships one of those?

**Yes → accept.** It is queue work: `work_type: structural`, `route: shared-db-orchestrator`, exact
objects listed, dispatched to a sub-agent in an isolated worktree as usual.

**No → `accept` is never one of the exits. Each non-structural work type names where it goes
instead.** The machine-readable form of this table is `NON_STRUCTURAL_EXITS` in
`scripts/manage-migration-author-lanes.mjs`; the two must agree.

- **REJECT** — the work belongs to another repository and must leave this queue. `application-data`
  and `source-data`. **Rejection FORWARDS the task; it never merely closes it** — see "A reject is
  a forward" below.
- **FORK** — genuinely this repo's work, dispatched by this orchestrator to a fresh session with an
  empty context window, but never worked in the orchestrator's own window. **This is now curated
  Master Data only** (`curated-master-data`), which §6.4 governs *inside* this repo and which never
  leaves for an application repo. It forks because it must not occupy a migration-author lane, not
  because somebody else owns it. The orchestrator does not read the code, does not debug it, and
  does not "just fix it quickly".
- **REPO-SESSION** — `repo-maintenance` and `documentation`. **Not an orchestrator assignment at
  all, not even to dispatch.** A separately started repository-maintenance session owns this work
  end to end. The orchestrator lists such issues in `--queue-audit` under
  `OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION` purely so nothing accumulates unseen, and then
  takes no action on them.
- **RETURN-TO-OWNER** — `security-settings`. It needs authority the orchestrator does not have.
  Put it to Albert; do not dispatch it to any session.

### OWNER RULING, 2026-08-21 (issue #1366) — the orchestrator does structure and schema ONLY

Albert ruled on 2026-08-21 that **repository-maintenance work is not an orchestrator job**. This
was not a clarification of an existing rule; it narrowed the boundary. Before that date,
`repo-maintenance`, `documentation`, and `security-settings` all exited by FORK, which reads as
"the orchestrator hands this out" — and an orchestrator session had already accepted a
repository-maintenance planning task on that basis. That is the mistake this ruling closes.

The ruling did **not** change how curated Master Data is routed. `curated-master-data` still exits
by FORK and is still governed here by §6.4. Do not extend the ruling to it without a separate
explicit decision from Albert.

There is no size exemption. "It is only a one-line doc fix" is precisely how an orchestrator
context fills up.

### A reject is a forward, not a closed door

A closed issue is not a delivered task. The session that filed it has almost always ended by the
time it is triaged, so a closing comment is read by nobody and the work is simply lost. Rejection
therefore moves the task to the repository that owns it:

1. **Every non-structural issue whose exit is REJECT carries a `return_to:` line** in its
   `db-work-scope` block — the owning repository as an `owner/repo` slug. A malformed slug is a
   hard parse error. A **missing** one is reported by `--queue-audit` as `NO RETURN ADDRESS` and
   makes the audit exit `2`, so an unaddressed reject cannot sit quietly.
2. **Return it with the guarded command**, never by hand:

       node scripts/manage-migration-author-lanes.mjs --return-issue <n>

   It files the full issue body in the owning repository **first**, then comments the new issue's
   URL here, then closes this one. **That order is the safety property** — any failure at any step
   leaves the issue here open and untouched, so a task can never vanish between the two repos. The
   closing comment always carries a live link, and a second return is refused.
3. **Only the return path may close a rejected issue.** Closing one by hand, without a
   `RETURNED TO <url>` comment, is the exact failure this section exists to prevent.

FORK items are never lost either — they stay open, dispatched to a fresh sub-agent like any other
work, and remain in the audit until that work is done.

### What the orchestrator's own window is for

Triage, dispatch, review, merge, and the promotion protocol. Nothing else. Every unit of actual
work — structural or forked — happens in a sub-agent's context, not this one.

### How it is enforced

`node scripts/manage-migration-author-lanes.mjs --queue-audit` prints a **`NOT ORCHESTRATOR WORK`**
block listing every open issue that fails the shape test, each stamped `REJECT` or `FORK`, with
`[blocked on owner decision]` where the route is `owner-only`. These items previously sat silently
in `skipped` and accumulated. The block is a worklist, not a failure — it does not change the exit
code — but an orchestrator that leaves items standing in it is carrying other people's work.

The block prints **before** the refill line, not after it, so a queue that has dispatchable work
cannot hide it — that ordering is deliberate.

An issue with **no** `db-work-scope` block at all is `unclassified`: it is not admitted, it is not
worked, and it already blocks an empty-lane claim. Classify it or send it back.

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

## 0.1-A OWNER RULING — moved

> **0.1-A OWNER RULING — shared-db MAY read production Cloud SQL; it still may not change anything (Albert Hazan, 2026-08-10)**
> Full ruling: [`docs/owner-rulings.md`](docs/owner-rulings.md#01-a-owner-ruling). Moved 2026-08-20 (issue #1331); text unchanged.

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

**Full text, including the whole migration-author-lane and reviewer machinery, the post-merge
preview rehearsal and its recovery lane:
[`docs/agents/section-4-anti-collision-rules.md`](docs/agents/section-4-anti-collision-rules.md).
Read it in full before you claim a lane, author a migration, or rehearse on preview.** The five
rules below are the operative summary.

1. **Up to three unrelated migrations may be authored at once. Preview, merges, and production
   promotion remain one at a time** (owner ruling, 2026-08-14). A fourth author is refused.

   **Do not open a migration file first.** Acquire an author lane, an exact object claim, and a
   centrally reserved 14-digit version as one dispatch operation:

   ```bash
   node scripts/manage-migration-author-lanes.mjs --claim \
     --task "<issue and outcome>" --owner "<agent/session>" \
     --branch "<branch>" --worktree "<absolute isolated worktree>" \
     --objects "<every exact object written, comma-separated>"
   ```

   Allocation is serialized across computers by a GitHub-backed lock and **fails closed**. The
   created issue body is authoritative and machine-readable — **never hand-edit its fenced
   blocks.**

   - **If you cannot list the objects up front, your task is read-only** — and read-only work
     cannot collide.
   - **An open claim is a lock, not a note.** Close it when the work merges or is abandoned.
     **Expiry never unlocks an object**, and a reserved version is never freed for reuse.
   - **Preview and merge need their own exclusive GitHub-backed leases**, acquired separately;
     a clean author lane does not grant preview. Instructions in chat are not a lock.
   - **Never run `supabase migration repair --status reverted`** when preview aborts with
     `Remote migration versions not found in local migrations directory` — those rows are another
     team's applied work. Land or coordinate the other branch instead. A migration left
     rehearsed-but-unmerged blocks everyone, so **open its PR the same session.**
   - Every open `db-work` issue carries one authoritative `db-work-scope` block. Only
     `ready + structural + shared-db-orchestrator` can enter an author lane, and it must name
     every exact object. Outside-sourced writes into curated `core.*` Master Data use
     `curated-master-data` / `curated-master-data-governance` — §6.4 governance, never a lane.
   - **A verdict with no coverage statement is not review evidence** (issue #1220). An `APPROVE`
     with no findings and no statement of what was examined is a wrapper or provider failure, not
     a clean review — treat it as `verdict=none` and use `--replace-failed-reviewer`. **Silence is
     never approval.**
   - Reviewer rotation, the business-risk gate, and the transport-failure rule (**a wrapper that
     cannot authenticate is a transport failure, not a review — replace it, never pause the
     queue; a real `REVISE` is never a transport failure**) are in the full text.

   The `Cross-PR object collision` CI check is only the backstop. By the time it fires, somebody's
   session is already wasted — on 2026-07-31, three of four were.

2. **Preview database first. Production never receives untested schema.** Apply every migration to
   the preview branch, prove it works, *then* promote to production (`qsllyeztdwjgirsysgai`).

   ⚠️ **The preview project ref is deliberately NOT written down here.** Preview is rebuilt from
   time to time and its ref changes when it is — `rjyboqwcdzcocqgmsyel` was deleted on 2026-08-18.
   The current ref lives in the repository variable `PREVIEW_PROJECT_REF`, every workflow that
   targets preview reads it from there, an unset variable is refused rather than defaulted, and
   `scripts/check-workflow-preview-ref.test.mjs` fails the guard job if any workflow pins a literal
   again.

   **Merge first, then rehearse on preview from merged `main`, then promote.** A rehearsal runs
   **once** — an applied version can never be applied again, so a re-dispatch and a GitHub
   "Re-run jobs" are both refused, and both refusals are correct. If a rehearsal must be recovered,
   use the historical-recovery lane, never a weakened guard. ⚠️ **Superseded in part, 2026-08-20
   (#1321): that lane cannot recover a POST-merge rehearsal** — it pins producer files to the
   authoring PR's merge commit, so a later main tip fails the pin, and the only way through is to
   supersede the migration with byte-identical SQL. Read the full text before relying on either.
   ⚠️ **NARROWED, 2026-08-20 (orchestrator marker #1338): the lane DOES recover a post-merge
   rehearsal when the rehearsal ran AT the authoring merge commit.** Recovered cleanly that day for
   `20260820165926` (preview recovery run 32402833543, then production apply 32402996954) with
   `historical_preview_source_pr` + `historical_preview_original_run_map`. **The discriminator is
   not pre-merge versus post-merge — it is whether anything merged BETWEEN the authoring merge
   commit and the rehearsal.** Rehearse in the same breath as the merge and the pin holds; let
   another PR land first and it does not. Do not pay a supersession before trying the lane.

3. **Additive by default (expand, then contract).** Adding a column or table cannot break another
   app. **Renaming or dropping** one another app reads *will*. Only rename/drop after explicit
   owner sign-off and a checked deprecation across all dependent apps.

4. **New timestamped migration files only.** Each change is a new `YYYYMMDDHHMMSS_*.sql` file.
   **Never edit a migration that has already been applied anywhere** — that is how two sessions
   silently clobber each other.

5. **Never reuse a timestamp — a duplicate SILENTLY SKIPS a migration.** The ledger
   (`supabase_migrations.schema_migrations`) keys on the **version alone, not the filename**. If
   two migrations share a timestamp, the first to apply claims the version and **the other is
   treated as already-applied and never runs. No error, no warning.** It has happened twice
   (`20260722220000`, `20260728160000`); the first left `dflow.sample_shipment_item` missing from
   production while the ledger claimed success.

   **A duplicate also blocks every future push forever** with
   `duplicate key value violates unique constraint "schema_migrations_pkey"`.

   Now enforced in CI by `scripts/check-sql.sh`. **Before trusting any migration, confirm the
   OBJECT exists (`to_regclass`) — never just the ledger row.** Fixing a collision: re-timestamp
   the loser if its content has not landed anywhere; **delete** it if the content already landed
   via a later re-issue (re-timestamping would apply stale DDL over the newer fixes). Worked
   detail in the full text.
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

## 4.2 OWNER RULING — moved

> **4.2 OWNER RULING — prove which database you are connected to before any destructive statement (Albert Hazan, 2026-08-02)**
> Full ruling: [`docs/owner-rulings.md`](docs/owner-rulings.md#42-owner-ruling). Moved 2026-08-20 (issue #1331); text unchanged.
>
> **The operative rule, in full, so nobody has to click through to be safe.** Before any statement
> that writes, changes or removes data, schema or privileges — `INSERT`, `UPDATE`, `DELETE`,
> `TRUNCATE`, `DROP`, `ALTER`, `GRANT`, `CREATE`, a mutating function or RPC, a script, a CI
> workflow, or asking a person including the owner to run one — **in ANY environment, preview and
> production alike, prove which database it is about to run against.** Preview being "the safe one"
> is not an exemption, and **§0.0-B does not narrow this**: §0.0-B decides who authorises a
> statement, §4.2 decides that you know where it lands.
>
> **"Prove" means an explicit check of the live connection target, executed immediately before the
> statement** — never an assumption, a memory, an earlier check, a filename, a branch name, or a
> plan that said "preview". One proof covers what is submitted in the same tool call or the
> immediately following one; **any tool call, reconnect or turn boundary in between invalidates it
> — redo it.** It is settled: do not re-ask it and do not weaken it. The full ruling carries the
> incident behind it and the exact queries that count as proof.
## 4.3 OWNER RULING — moved

> **4.3 OWNER RULING — issues, handovers and plans point at the LIVE reading, never at a number (Albert Hazan, 2026-08-11)**
> Full ruling: [`docs/owner-rulings.md`](docs/owner-rulings.md#43-owner-ruling). Moved 2026-08-20 (issue #1331); text unchanged.
>
> In one line: **never paste a measured count into a document.** Name the query, the view, or the
> dashboard that produces it, so the reader gets today's number instead of the day-you-wrote-it
> number.
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

### 5.0-D Declare what a re-derived migration was derived from — `-- derived-from:` (issue #1608, added 2026-08-26)

Loader-style migrations here are authored as a **full re-derivation of the
then-current object body on `main`**. A file that does
`create or replace function|view` therefore depends on its base being present
**in the target database** — and on 2026-08-24 one was promoted to production
without it. The apply did not fail; it replaced the object with a body written
for a different world, and post-apply catalog verification stayed green because
the object still existed. Three migrations were retired over it.

If your migration re-replaces an object an earlier migration also replaces, put
**one machine-readable line** in the header:

```sql
-- derived-from: 20260814223552
```

or, if it writes the object from scratch and depends on no earlier rewrite:

```sql
-- derived-from: none
```

`scripts/migration_derivation.py` reads it. The Python test suite refuses a pull
request that omits it (mandatory for every migration stamped 2026-08-27 or
later), and the promotion lane refuses an allowlist whose member declares a base
the target ledger does not have. The escape hatch is
`--derivation-override VERSION:BASE=<what the database will actually hold>`,
which is recorded verbatim in the run log. The drift report shows such a version
as `[BASE-ABSENT]`, not as ordinary pending work.

Do **not** add the line to an already-merged migration — that changes its bytes.
Merged files that need a declaration get one in `LEGACY_DECLARATIONS`.

### 5.1 Promoting to production when a backlog exists — NEVER `--include-all` on the full repo set, ALWAYS inside the pruned temp checkout (learned 2026-07-23; recipe corrected 2026-07-27; wording made self-consistent 2026-08-09)

> **Moved 2026-08-20** to [`docs/production-promotion-procedure.md`](docs/production-promotion-procedure.md) (issue #1331). Text unchanged; the section number is unchanged, so `AGENTS.md §5.1` still resolves.
>
> **The rule in one line, so nobody promotes without opening it:** when a backlog exists, **NEVER `--include-all`** — promote exactly the intended migration and prove it first.

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

**A THIRD flavour, now removed at the root (2026-08-19, issue #1266).** CI used to
`apt-get install ripgrep` before running the SQL guards. A hosted-runner package-mirror
stall then held `SQL migration guards` `in_progress` for **42 minutes** on a 26-line docs
PR (#1264), and a retry wrapper only turned that into a 6-minute named failure. The guards
never needed ripgrep: `check-sql.sh` used it for five fixed-string searches that plain
`grep -qF` performs identically. **CI installs no packages for the SQL guards any more —
do not reintroduce an `apt-get` step to add a convenience tool.** Every job in every
workflow also now carries a `timeout-minutes` ceiling, so a stalled step fails on its own
budget instead of blocking merges for hours.

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

**Currently in flight: the ERP mirror relocation.** The Coldlion ERP pull tables (`public.erp_*`,
`public.prod_order_*`) are being moved out of `public` into the designed `ingest` / `plm` / `api`
layers. Phase 1 is live in production; phases 2–5 are pending. **Before touching `erp_*`,
`prod_order_*`, `api.plm_item_list`, `plm.item`, `plm.production_order*` or
`plm.refresh_style_tracker_item_bridge()`, read [`fix_schema_for_api.md`](fix_schema_for_api.md)
and continue it in order** — do not start a parallel ERP schema change. Full text, including the
still-open source decision that affects Phase 3:
[`docs/agents/section-6-in-flight-long-form.md`](docs/agents/section-6-in-flight-long-form.md).

**Which entities are on ColdLion vs. still on DesignFlow?** Do not re-derive this by querying — it
has cost multiple sessions already. The answer, with row counts, blockers, and the
`plm.*_import` vs `plm.erp_*` naming rule, is in
[`docs/master-data-cutover-scoreboard.md`](docs/master-data-cutover-scoreboard.md). Short version:
**customer and vendor are cut over to ColdLion; licensor and property are not** (and
`plm.licensor_import` / `plm.property_import` are DesignFlow staging, *not* a ColdLion mirror — a
previous session got this wrong).

**ColdLion — anything at all: start at [`docs/coldlion.md`](docs/coldlion.md)**, and read
[`docs/coldlion-open-questions.md`](docs/coldlion-open-questions.md) before asking ColdLion or
Albert anything or calling a field broken. Twelve questions are already answered there.

**ColdLion purchase/sales history (`prodHistory` / `orderHistory`) — read
[`docs/coldlion-history-endpoints-shape.md`](docs/coldlion-history-endpoints-shape.md) before
writing any loader.** ⚠️ **The default `prodHistory` response is INCOMPLETE**: without `stageCode`
you get only the `ISS` lines, there are exactly three stages (`ISS`, `INTRAN`, `REC`) with **zero
key overlap**, and a stage-blind table triple-counts quantities with no error. The other four traps
— the hard 7-day window cap whose refusal is malformed, the endpoints silently ignoring
`page`/`size`, the `(prodOrderNo, prodLineSeq, prepackItemNo)` row identity, and the fields that
read zero in every sampled row — are stated in full in
[`docs/agents/section-6-in-flight-long-form.md`](docs/agents/section-6-in-flight-long-form.md).

**What the ERP data MEANS** (as opposed to its shape) lives in
[`docs/business-rules-erp-data.md`](docs/business-rules-erp-data.md). **Never infer a business rule
from field populations and write it down as fact** — label it an inference until the owner
confirms it. Three settled facts a session keeps re-deriving: a `prodReferenceNo` ending **`COS`**
marks **sample production** (real cost, no customer revenue — `salesOrderNo = 0` there is correct);
the feed spans **four divisions** (`CW001`, `EH001`, `EP001`, `SP001`), not just `EH001`; and
`1900-01-01` is the empty-date marker (owner-confirmed 2026-08-14 — settled, do not re-raise).

> ### 📕 The rulings themselves moved to [`docs/owner-rulings.md`](docs/owner-rulings.md) on 2026-08-20.
> Nothing was deleted and **the numbers are unchanged** — `§6.4` still means `§6.4`. This index is
> the router entry; the ruling text, its evidence and its reasoning are one click away. `AGENTS.md`
> was 229 KB against its own 80 KB ceiling and this section was 43% of it (issue #1331).

| § | Ruling | |
|---|---|---|
| **6.1** | Merch groups / licensors / properties — read this before touching them | [read](docs/owner-rulings.md#61-merch-groups-licensors-properties-read-this-before-touching-them) |
| **6.1b** | Division codes — TWO encodings, and the one that will bite you (2026-08-17) | [read](docs/owner-rulings.md#61b-division-codes-two-encodings-and-the-one-that-will-bite-you-2026-08-17) |
| **6.2** | Coldlion `/vendors` — wrong table, now FIXED upstream (2026-07-22) | [read](docs/owner-rulings.md#62-coldlion-vendors-wrong-table-now-fixed-upstream-2026-07-22) |
| **6.3** | OWNER RULING — Coldlion ERP data is canonical (Albert Hazan, 2026-07-31) | [read](docs/owner-rulings.md#63-owner-ruling-coldlion-erp-data-is-canonical-albert-hazan-2026-07-31) |
| **6.4** | OWNER RULING — the Master Data import is TRANSITIONAL, and curated data outranks it (Albert Hazan, 2026-08-03) | [read](docs/owner-rulings.md#64-owner-ruling-the-master-data-import-is-transitional-and-curated-data-outranks-it-albert-hazan-2026-08-03) |
| **6.5** | OWNER RULING — PR #408 is HELD and ships as one production change with the FR removal work (Albert Hazan, 2026-08-03) | [read](docs/owner-rulings.md#65-owner-ruling-pr-408-is-held-and-ships-as-one-production-change-with-the-fr-removal-work-albert-hazan-2026-08-03) |
| **6.6** | OWNER RULING — DB Data Admin is the home for licensor→property parentage (Albert Hazan, 2026-08-03) — this REVERSES the previous stance | [read](docs/owner-rulings.md#66-owner-ruling-db-data-admin-is-the-home-for-licensorproperty-parentage-albert-hazan-2026-08-03-this-reverses-the-previous-stance) |
| **6.7** | OWNER RULING — branch protection on `main` is ON, and CI guards are no longer advisory (Albert Hazan, 2026-08-04) | [read](docs/owner-rulings.md#67-owner-ruling-branch-protection-on-main-is-on-and-ci-guards-are-no-longer-advisory-albert-hazan-2026-08-04) |
| **6.8** | OWNER RULING — the six HARD_BLOCKED ColdLion migrations are NOT unblocked individually (Albert Hazan, 2026-08-04) | [read](docs/owner-rulings.md#68-owner-ruling-the-six-hardblocked-coldlion-migrations-are-not-unblocked-individually-albert-hazan-2026-08-04) |
| **6.9** | OWNER RULING — the 33 unmatched ColdLion property codes are NOT admitted before the resolver is fixed (Albert Hazan, 2026-08-04) | [read](docs/owner-rulings.md#69-owner-ruling-the-33-unmatched-coldlion-property-codes-are-not-admitted-before-the-resolver-is-fixed-albert-hazan-2026-08-04) |
| **6.10** | OWNER RULINGS — the licensor/property model, and "the feed should not drop anything" (Albert Hazan, 2026-08-06) | [read](docs/owner-rulings.md#610-owner-rulings-the-licensorproperty-model-and-the-feed-should-not-drop-anything-albert-hazan-2026-08-06) |
| **6.11** | `DY` and `DS` are ONE company — the Disney licensor has two spellings (added 2026-08-07) | [read](docs/owner-rulings.md#611-dy-and-ds-are-one-company-the-disney-licensor-has-two-spellings-added-2026-08-07) |
| **6.12** | CORRECTION to §6.6 rule 5 — there is NO parentage-durability migration (added 2026-08-07) | [read](docs/owner-rulings.md#612-correction-to-66-rule-5-there-is-no-parentage-durability-migration-added-2026-08-07) |
| **6.13** | OWNER RULINGS — Paramount landing tables and sub-licensors (Albert Hazan, 2026-08-07) | [read](docs/owner-rulings.md#613-owner-rulings-paramount-landing-tables-and-sub-licensors-albert-hazan-2026-08-07) |
| **6.13-A** | OWNER RULING — the Paramount five-table cap is lifted and the build hold is released (Albert Hazan, 2026-08-09) | [read](docs/owner-rulings.md#613-a-owner-ruling-the-paramount-five-table-cap-is-lifted-and-the-build-hold-is-released-albert-hazan-2026-08-09) |
| **6.14** | OWNER RULING — this repository is PUBLIC; no personal identifiers in anything you write from now on (Albert Hazan, 2026-08-09) | [read](docs/owner-rulings.md#614-owner-ruling-this-repository-is-public-no-personal-identifiers-in-anything-you-write-from-now-on-albert-hazan-2026-08-09) |
| **6.15** | OWNER RULING — there are exactly TWO kinds of property list, and `core.property` (Universe A) is to be DELETED (Albert Hazan, 2026-08-19) | [read](docs/owner-rulings.md#615-owner-ruling-there-are-exactly-two-kinds-of-property-list-and-coreproperty-universe-a-is-to-be-deleted-albert-hazan-2026-08-19) |
| **6.17** | OWNER RULING — DesignFlow's numeric division ids are WRONG and do NOT come to this database; the ColdLion division CODE is the only division there is (Albert Hazan, 2026-08-19) | [read](docs/owner-rulings.md#617-owner-ruling-designflows-numeric-division-ids-are-wrong-and-do-not-come-to-this-database-the-coldlion-division-code-is-the-only-division-there-is-albert-hazan-2026-08-19) |
| **6.16** | OWNER RULING — licence CONTRACTS are NOT a source for this database, and licence TERM and TERRITORY do not belong in it at all (Albert Hazan, 2026-08-19) | [read](docs/owner-rulings.md#616-owner-ruling-licence-contracts-are-not-a-source-for-this-database-and-licence-term-and-territory-do-not-belong-in-it-at-all-albert-hazan-2026-08-19) |
## 7. When two apps need conflicting database changes

Serialize, do not parallelize. Land one change, let it sync, test it, then start
the next. Where possible, prefer one **additive** change that satisfies both apps
rather than two competing edits. If they genuinely conflict, explain the trade-off
to the owner in plain English and let them choose order.

## 8. Project references

```text
Preview project ref:    read the repository variable PREVIEW_PROJECT_REF — never a literal
Production project ref: qsllyeztdwjgirsysgai
```

⚠️ **Do not write a preview project ref down anywhere.** Preview is rebuilt from time to time and
its ref changes when it is; `rjyboqwcdzcocqgmsyel` was deleted on 2026-08-18 and this block still
named it as current until 2026-08-20. See §4 rule 2.

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

**Full runbook — every credential, the canonical login/link flow, and the Windows traps —
[`docs/agents/runbooks-credentials-cli-and-gotchas.md`](docs/agents/runbooks-credentials-cli-and-gotchas.md).
Read it when you are about to connect, not at session start.** The headlines:

- **Use the canonical credentials in 1Password vault `vibe_coding`.** Never work around an auth
  failure with manual SQL, dashboard edits, copied browser tokens, or one-off connection strings.
  Fix the login path, then prove it with `supabase projects list`, `supabase link`, and
  `supabase db push --dry-run`. **Fetch 1Password items serially — never fan out `op read`.**
- Production project `qsllyeztdwjgirsysgai`. **The preview project ref is not written down** —
  read it from the repository variable `PREVIEW_PROJECT_REF` (see §4 rule 2).
- **`psql` is NOT installed on the Windows dev machines.** Use Node + `pg` against the pooler
  (`aws-1-us-east-1.pooler.supabase.com:6543`, user `postgres.qsllyeztdwjgirsysgai`).
- **Never route the 1Password `op_run` tool through `bash` on Windows** — a bare `bash` there is
  WSL, which does not inherit the injected environment, so secrets arrive empty and it looks like
  a broken tool. Use cmd.exe, PowerShell, or `node`.
- The preview-credentials item title contains parentheses and **cannot be used in an `op://`
  reference** — address it by item ID. IDs can be re-keyed; re-resolve by title if one 404s.
- **Presence is not capability.** A tool answering `--version` proves nothing about whether the
  operation works. Exercise the real operation before trusting it.
## 10. Where to read more

**The long form of this file lives in [`docs/agents/`](docs/agents/) and
[`docs/owner-rulings.md`](docs/owner-rulings.md).** `AGENTS.md` was cut from 234 KB to under 80 KB
across issue #1331 and PR #1212, because it is loaded in full at the start of every session.
**Nothing was resolved or deleted in either move — the full text is verbatim in these files**, and
each section above points at the one that carries it. **Section numbers never change**; supersede
in place, the way §6.13-A supersedes §6.13. CI workflow comments and
`scripts/production_migration_guard.py` cite these numbers.

| File | Carries |
| --- | --- |
| [`docs/agents/section-4-anti-collision-rules.md`](docs/agents/section-4-anti-collision-rules.md) | §4 in full — migration author lanes, object claims, reviewer rotation, the business-risk gate, the preview rehearsal and its recovery lane |
| [`docs/agents/section-6-in-flight-long-form.md`](docs/agents/section-6-in-flight-long-form.md) | The §6 in-flight narrative in full — ERP mirror relocation, cutover scoreboard, the five ColdLion history traps, ERP business meaning |
| [`docs/agents/runbooks-credentials-cli-and-gotchas.md`](docs/agents/runbooks-credentials-cli-and-gotchas.md) | §9, §10.1–§10.3, §11 in full — credentials, CLI, hosted-Supabase traps |
| [`docs/owner-rulings.md`](docs/owner-rulings.md) | §6.1–§6.17, §0.1-A, §4.2, §4.3 in full — every owner ruling with its reasoning, incident and measured numbers |
| [`docs/production-promotion-procedure.md`](docs/production-promotion-procedure.md) | §5.1 in full — the bounded-checkout recipe and the production apply lane |

**Where `AGENTS.md` and a long-form file differ in wording, `AGENTS.md` wins** — it is the
authoritative statement of policy.

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

## 10.1–10.3 and §11 — traps that cost real time (full text in the runbook)

**Full text:
[`docs/agents/runbooks-credentials-cli-and-gotchas.md`](docs/agents/runbooks-credentials-cli-and-gotchas.md).**
Read the relevant part when you hit the situation. The headlines, so you recognise it:

- **§10.1 Clean-slate local replay is unsupported — use the dependency closure.** Applying every
  migration in filename order against an empty local Postgres **cannot work and never could**.
  About 170 files are intentionally **empty markers** lining the ledger up with objects created
  before `shared-db` became canonical; nothing here ever creates them. A full replay produces ~63
  failures of exactly that class. This is by design — not a bug, not something to "fix".
- **§10.2 Grants in `public` are locked down by default (since 2026-07-29) — READ THIS BEFORE
  CREATING A FUNCTION.** An event trigger revokes EXECUTE from PUBLIC and `anon` on every new
  `public` function. **A new function in `public` is reachable by nobody except `postgres` and
  `service_role` unless your migration grants it explicitly.**
- **§10.3 A Node CLI in `tools/` that hand-builds its direct-invocation guard does nothing on
  Windows and exits 0.** A silent success is worse than a failure. Check the entry guard before
  believing a runner "succeeded".
- **§11 Hosted-Supabase gotchas.** **PostgREST schema exposure is control-plane config, NOT SQL** —
  `alter role authenticator set pgrst.db_schemas` does not take effect on hosted Supabase; use the
  Management API `PATCH /v1/projects/{ref}/postgrest`. It is per-project: re-confirm after any
  restore/clone and set it on preview too. If supabase-js suddenly 404s on `api.*`/`crm.*`, check
  this first. **`service_role` has no rights on non-`public` schemas by default.**
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

## 11c. The orchestrator ROUTING CONTRACT — how you find who to send work to

**Added 2026-08-26, issue #1605.** The marker answers "has someone claimed the role". Until this
contract it did **not** answer "where do I send work", and a session with no answer to that
resolved the destination from conversation history and an old handoff — and delegated an
authorized structural request to an orchestrator session that **had already closed**. The
request went nowhere and nobody was told.

### The standard identifier is `shared-db.orch`

Owner instruction, Albert Hazan, 2026-08-26. It is a **fixed constant**, not a naming
suggestion. The orchestrator's session display name must begin with it, so the orchestrator
is identifiable in a session list and by any tool that can only see session titles.

⚠️ **The name is a discovery HINT and never an authority.** Session titles are not unique
and nothing enforces them. **Route on the marker, never on a name.**

### Every open marker carries a routing block

````
```orchestrator-routing
status: active
identifier: shared-db.orch
engine: codex
session_name: shared-db.orch EDGE-DEV resume-1579
route_id: 00000000-0000-7000-8000-00000000a1a1
owner: u2giants
machine: EDGE-DEV
started: 2026-08-26T14:39:25Z
handover_issue: 1579
briefing: HANDOFF.d/2026-08-26T1409Z-edge-dev-codex-orchestrator-1579-fresh-session.md
```
````

`route_id` is the **declared address**, and its shape depends on the engine. The guard validates
that shape and nothing else — see the "what this does NOT do" note at the end of this section:

| `engine` | `route_id` | How another session reaches it |
|---|---|---|
| `codex` | the Codex thread UUID from the session rollout `session_id` | `codex-reply` with that `threadId` |
| `claude` | the Claude `sessionId`, e.g. `local_<uuid>` | a Claude cross-session message to that session |

`handover_issue` is the predecessor marker, or `none` for a cold start. Every field is
required; **blank is never a default** — state a value or `none`.

### Resolve the destination this way, and only this way

```bash
node scripts/check-orchestrator-marker.mjs --resolve
```

It reads the **current open marker and nothing else**. That is what makes closing or handing
over a marker invalidate the old routing target automatically, rather than by everyone
remembering to stop using it. **Re-resolve before every delegation.**

| Exit | State | What it means and what to do |
|---|---|---|
| 0 | `declared` | One valid marker. Its `route_id` is where to TRY. It is not proof anyone is there. |
| 3 | `none` | Zero markers — **no active orchestrator**. **QUEUE the work** until a successor starts. Not permission to dispatch, and not permission to start orchestrating without claiming a marker yourself. |
| 1 | `unsafe` | Anything that fails the marker guard — two or more markers, or the retired `coordinator-marker` label alive. Do not guess which is live; do not route to either. |
| 1 | `invalid` | A marker is open but names no usable target. An orchestrator **may be live and unreachable** — stop. |
| 2 | `unknown` | GitHub could not be read. **Assume a marker exists.** |

⚠️ **`none` and `invalid` are different answers with opposite consequences, and neither may
be collapsed into the other.** `none` means nobody is running. `invalid` means somebody may
be running and you cannot reach them. Treating `invalid` as `none` is how a second
orchestrator starts; treating `none` as a green light is how work gets dispatched to nobody.

⚠️ **Never fall back to conversation history, a closed marker, a `HANDOFF.d/` file, or a
remembered id for a routing target.** Those are precisely what produced the failure this
contract exists to prevent. If `--resolve` will not give you an address, you do not have one.

### Starting as the orchestrator

Open the marker with a complete, valid routing block **recording your own new `route_id`**.
A successor that copies its predecessor's id is rejected by the guard — that copy is exactly
how delegations kept arriving at a closed session.

⚠️ **The inheritance check is a trap, not a proof.** It fires only when the marker declares a
numeric `handover_issue` whose issue is readable and carries a parseable block. It does not
catch a reused id from an older ancestor, a wrong predecessor number, a `handover_issue: none`
that is a lie, or a fabricated id with the right shape. **Recording your own real id is your
obligation; the guard catches the common copy, not every possible one.**

### Handing over

Close your marker. The successor opens its own with **its own new `route_id`**. There is no
edit-in-place handover: the old target must stop resolving the moment you stop running.

### What this does NOT do

It publishes an **address**, and validates only its **shape**. There is no session API here, so
nothing checks that the session exists, is running, belongs to the declared owner or machine,
is the orchestrator, or can receive anything — a fabricated id with otherwise valid fields
resolves exactly like a real one. What a resolved target proves is narrow: **one open marker
declares this address.** Confirm you got a reply; silence is not delivery, and this tool cannot
tell the difference.

It does not invent a delivery channel and it does not promise
delivery. `plan_orchestrator-workflow-gaps.md` §C recorded that nothing here reaches a
running session; that remains true of this repository. Claude cross-session messaging and
Codex `codex-reply` are the channels, they live outside this repo, and both needed an
address the marker never published. **A resolved target means "this is where to send it",
never "it was received".**

⚠️ **Markers opened before 2026-08-27 are grandfathered by the PR guard only** — they could
not carry a block that did not exist. `--resolve` **never** grandfathers: such a marker still
carries no address and still cannot be routed to. Edit it to add the block, or close it.

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
   **Resolve who it is with `--resolve`, never from memory — §11c.**
2. **SUPERSEDED 2026-08-14, RAISED 2026-08-25:** up to **five** unrelated
   migrations may be authored concurrently under exact object claims and atomic
   version reservations. Preview, merges and production promotion remain one at
   a time — the cap is throughput, never isolation. Use §4 rule 1.
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
   `(division, mgTypeCode)`) and `fix_item_taxonomy_wiring.md`.
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
    Rules 1 and 2 above ("one orchestrator", "up to five migration authors") govern changes to the
    *shape* of the database. They do **not** make an application session's ordinary row writes
    into orchestrator work, and a session must not open an issue or hand over merely because its
    feature writes data. The single exception is curated Master Data under §6.4, which stays
    gated. §4.2's connection-target proof still applies to every data write regardless.

16. **REPOSITORY MAINTENANCE IS NOT ORCHESTRATOR WORK (owner ruling, 2026-08-21, issue #1366).**
    The shared-db orchestrator accepts, dispatches, reviews, merges and promotes **structural and
    schema work only**. `repo-maintenance` and `documentation` are performed by a **separately
    started repository session** and are never an orchestrator assignment — not even to dispatch.
    `security-settings` goes to Albert, because it needs authority the orchestrator does not have.
    `--queue-audit` lists these under `OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION` for audit
    visibility only; that list is **not** a worklist.

    This ruling narrowed the boundary rather than restating it. Until 2026-08-21 all three exited
    by `fork`, which reads as "the orchestrator hands this out", and on that basis an orchestrator
    session accepted a repository-maintenance planning task. Do not route such work back to the
    orchestrator, and do not read a `fork` in an old document as current.

    **It did not touch curated Master Data.** `curated-master-data` still exits by `fork` under
    §6.4 and is still governed inside this repository. Extending the ruling to it needs a separate
    explicit decision from Albert. See `NON_STRUCTURAL_EXITS` in
    `scripts/manage-migration-author-lanes.mjs` for the enforced form.

17. **`required_status_checks.strict` is FALSE on purpose (owner ruling, 2026-08-19, issue #1286).**
    Requiring every branch to be up to date before merging restarted the full check suite on every
    open branch after every unrelated merge, costing roughly 50 minutes a day. Albert turned it
    off deliberately. **It is not drift and must not be "fixed".**

    What actually re-checks a migration pull request against current `main` is
    `.github/workflows/guarded-migration-merge.yml`, whose required context
    `Migration guarded merge authorization` re-runs collision and lease validation on a head that
    contains current `main`, while holding the merge lock. A pull request with no migrations is
    auto-authorized by `.github/workflows/migration-author-lease.yml`.

    Older documents — including `docs/owner-rulings.md`'s 2026-08-06/14 entries and
    `plan_orchestrator-workflow-gaps.md` — describe the earlier `strict: true` state. That history
    is real and is preserved; it is **superseded** as a current instruction. Only issue #1286
    governs whether strict mode is ever reconsidered.

---
