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

Before interpreting `full_item_master.csv`, changing item-description parsing, or reporting historical MG match counts, read [`docs/item-description-mg-classification-process.md`](docs/item-description-mg-classification-process.md). The active remediation plan is [`plan_item_description_mg_taxonomy_repair.md`](plan_item_description_mg_taxonomy_repair.md); follow its STATUS table and do not recreate the unsafe provisional/fuzzy method. The permanent rule is: parse every description into product type, size, licensor, property, and artwork; build independent post-May-13 maps for MG01, MG01+MG02, and MG01+MG02+MG03; then match old product types from three levels to two to one. A failed full-key match is never an MG01 failure.

## Active contracts and implementation plans

- PopDAM OrderList linked to Master Data: [`plan_popdam_order_list.md`](plan_popdam_order_list.md). Read its STATUS table first. Do not re-derive or re-plan completed steps.
- **Companywide business rules (read before interpreting business meaning):** start at [`docs/business-rules/application-map.md`](docs/business-rules/application-map.md). Licensing Master Data starts at [`docs/business-rules/licensing-master-data.md`](docs/business-rules/licensing-master-data.md); its detailed architecture remains in [`docs/core-master-data-consolidation-aim.md`](docs/core-master-data-consolidation-aim.md).
- **Licensing Master Data implementation:** [`plan_licensing_master_data_implementation.md`](plan_licensing_master_data_implementation.md). Read its STATUS table first and start at the named fresh-session step. It supersedes conflicting execution assumptions in older Character/Style Guide and ColdLion plans without deleting their historical evidence.
- **ColdLion — anything at all:** start at [`docs/coldlion.md`](docs/coldlion.md). It is a map, not a source. **Before asking ColdLion a question, or concluding a field is broken or unknown, read [`docs/coldlion-open-questions.md`](docs/coldlion-open-questions.md)** — twelve questions are already answered there, and on 2026-08-19 a session wasted an afternoon re-deriving one of them.
- **ColdLion raw landing layer (issue #1184), phases 2-6:** [`docs/plan_coldlion-landing-phases-2-6.md`](docs/plan_coldlion-landing-phases-2-6.md). Read its STATUS table first — do not re-derive its measurements or re-plan its steps. Phase 1 (the spine) is merged; phases 2-6 build the feed tables and loaders. The owner's per-field ingest/ignore decisions are [`docs/coldlion-field-decisions-20260819.csv`](docs/coldlion-field-decisions-20260819.csv) and are authority, not a suggestion. Step 4 is blocked until the `orderHistory` line key is resolved from a live pull; there is no `lineNo` in the payload and every obvious substitute silently merges sales lines.
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

   For new assignments, the machine-independent cursor rotates Grok 4.6 → GLM
   5.2 → Kimi K3 → repeat. Qwen 3.8 Max is paused until an explicit owner
   instruction restores it. Historical Qwen assignments, failures, and
   replacement evidence remain readable and must be recovered or replaced
   through `scripts/manage-migration-author-lanes.mjs`, never hand-edited. Use
   only the wrapper returned by the manager and its fixed model settings. Reuse
   one named session for rebuttals. Require
   a current exact-head re-read and `APPROVE` or `REVISE` with evidence. Verify
   every claim independently. Relay disagreements with
   `templates/delegation/debate-turn.md`, stopping at agreement or the initial
   review plus three rebuttals. If material disagreement remains, stop the merge
   and ask Albert one concise decision. Never send secrets or licensed rows.

   **A verdict with no coverage statement is not review evidence** (issue #1220,
   fixed wrapper-side in `ai-devops` PR #43). Two wrappers could finish a run
   having produced no findings and no verdict at all and still exit 0, and one
   printed a complete five-finding review as a bare two-line `VERDICT: APPROVE`
   because it discarded everything above the verdict heading. The wrappers now
   emit the whole body and exit non-zero when no verdict was reached, so the
   evidence is guaranteed to be PRINTED. Nothing can guarantee it is READ, and
   that half is this repository's job:

   - **Never record a bare verdict.** An `APPROVE` with no findings and no
     statement of what was actually examined is a wrapper or provider failure,
     not a clean review. Treat it as `verdict=none` and use
     `--replace-failed-reviewer` exactly as for a transport failure.
   - **Require the reviewer to say what it covered** — which files, which
     migrations, which conditions — not merely what it concluded. A review whose
     coverage cannot be checked cannot be relied on to have missed nothing.
   - **If a wrapper's stdout looks truncated, read the raw provider stream before
     recording anything.** The failure that prompted this rule was recoverable in
     full from `stream.jsonl` after the wrapper had already printed two lines. Both
     recovered reviews were posted to their PRs in full, with the recovery method
     stated, so the audit trail records what was checked rather than the wrapper's
     summary of it. Do the same.
   - **Silence is never approval.** The failure mode here is silent and biased
     toward "looks approved", which is exactly the shape that gets waved through
     under time pressure.

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
   every migration to the preview branch, prove it works, *then* promote to
   production (`qsllyeztdwjgirsysgai`). The preview project ref is NOT written
   down here: preview is rebuilt from time to time and its ref changes when it
   is — `rjyboqwcdzcocqgmsyel` was deleted on 2026-08-18. The current ref lives
   in the repository variable `PREVIEW_PROJECT_REF`, and **every** workflow that
   targets preview reads it from there. An unset variable is refused, never
   defaulted. The older workflows that used to hard-code the deleted ref
   (`generate-database-types.yml`, `preview-ledger-orphan-reconciliation.yml`,
   the `coldlion-*` workflows) were converted to the same pattern, and
   `scripts/check-workflow-preview-ref.test.mjs` now fails the *Shared Supabase
   Migrations* guard job if any workflow pins a preview ref literal again.

   **Post-merge rehearsal (the normal order).** Merge first, then rehearse on
   preview from merged `main`, then promote. Dispatch *Shared Supabase
   Migrations* with `target=preview`, `mode=apply`,
   `merged_preview_source_pr=<the merged PR>`, `commit_sha=<the current main
   tip>` and `preview_allowlist=<the exact versions>`. Do NOT pass `claim_pr`:
   a merged pull request has no live author claim, and naming both is refused.

   The exclusive preview lock for that run is authorised by **merge-commit
   ancestry of the main tip**, not by a live author claim — the guarded merge
   released the claim and deleted the branch, which is exactly why the rule
   above used to be unexecutable (#1208). It is the same `refs/db-coordination/preview`
   lock, so it is mutually exclusive with an ordinary preview run and with a
   historical recovery — every lane that writes preview holds one ref, and this
   lane adds no second door.

   **What that lock does NOT do, stated exactly.** It does not exclude a merge
   or a production promotion. `EXCLUSIVE_REFS` gives merge and production their
   own refs, and only two cross-checks exist — both inside `acquireExclusive` in
   [`scripts/manage-migration-author-lanes.mjs`](scripts/manage-migration-author-lanes.mjs),
   findable by their refusal text rather than by a line number, which drifts:
   a promotion waits for the merge ref (`a guarded merge is active; production
   promotion must wait`), and a merge waits for the production ref
   (`production promotion is active; merges are frozen`). Nothing in
   either direction reads the preview ref. That is pre-existing behaviour of the
   ordinary preview lane, unchanged here — an earlier draft of this section
   claimed the exclusion existed, and it never did. Promotions are serialised
   among themselves by the workflow `concurrency` group, not by this lock.

   The lock fails closed if the PR is not merged, if its
   merge commit is not carried by the main tip, if the named versions were not
   *added* by that PR, or if GitHub state cannot be read.

   The evidence that run uploads carries the exact commit it checked out and the
   preview project ref it wrote to, and the production gate checks both. A
   rehearsal against a preview database that has since been rebuilt is therefore
   no longer proof for a production write.

   **A rehearsal runs ONCE. Do not re-run it — recover it.** An applied version
   can never be applied again, so there is no second bite. If the versions are
   already in preview's ledger, both ways of trying again are refused, and both
   refusals are correct:

   * **A fresh dispatch** fails at *Hard guard preflight*: the versions are now
     in preview's ledger and the guard refuses to re-apply an applied version.
     The run's conclusion becomes `failure`, and the production gate accepts
     evidence only from a run whose status is `completed` and whose conclusion is
     `success`.
   * **GitHub's "Re-run jobs"** keeps the same run id, so a second
     `preview-migration-apply-<sha>` upload lands on that one run. The gate
     requires *exactly one* apply artifact per run — two make the applied commit
     ambiguous, and an ambiguous commit is not provenance — so it refuses rather
     than pick one.

   ⚠️ **SUPERSEDED IN PART, 2026-08-20 (#1321): the historical-recovery lane
   CANNOT recover a POST-MERGE rehearsal — i.e. evidence produced by the order
   this very document mandates.** The lane pins the original run's producer files
   to the AUTHORING PULL REQUEST'S MERGE COMMIT. A post-merge rehearsal runs from
   a LATER main tip, so any producer file that changed in between (ten did, in one
   day) makes the pin fail. Measured on `20260819011639`: merged, correct,
   six-times reviewed, and refused — *"produced evidence with a different
   .github/workflows/shared-supabase-migrations.yml than the merge commit"*. No
   database write occurred. The only way through was to **supersede** the
   migration with byte-identical SQL (`20260820142402`), which costs a migration
   version and a fresh review round. **The paragraph below is still correct for a
   PRE-merge rehearsal, which is what the lane was built for. Read #1321 before
   relying on it for anything rehearsed after its pull request merged.**

   First check whether you need a second run at all: if the original rehearsal
   completed successfully, its artifact is still the proof, and the promotion
   should simply name that run in `preview_run_id`. If it did not, **the way
   forward is the historical-recovery lane, not a weakened guard.** Dispatch
   `target=preview`, `mode=apply` with `historical_preview_source_pr` (or
   `historical_preview_source_pr_map` for a batch authored across several pull
   requests), **`historical_preview_original_run_map`**, plus
   `commit_sha=<current main tip>` and the same `preview_allowlist`. That lane
   performs **no database write**.

   `historical_preview_original_run_map` is `version:runId` pairs naming the
   preview run that **originally applied** each version, and it is **required**.
   It is not bookkeeping: because a recovery run writes nothing, it can produce
   no content manifest of its own, so the production gate goes and reads the
   named run's manifest and byte-compares the digest it recorded against the file
   on exact main. Find the run id in the Actions history — it is the successful
   `apply` run whose artifact is `preview-migration-apply-<sha>` for that batch.

   **The named run is pinned on BOTH of its commits.** The commit it advertised
   in its artifact name *and* `head_sha`, the ref GitHub read the workflow file
   from, must each be a commit of the authoring pull request or a commit exact
   main contains, and each must carry the **same producer files as the merge
   commit of the pull request that authored that version** — a commit the gate
   re-derives from GitHub, never one the promoter supplies. Without that second
   pin, anyone who can dispatch this workflow could push a branch whose copy of
   it performs no database write, hand-write a ledger delta and a content
   manifest naming exact main's digest, name that run as the "original apply",
   and promote bytes preview never executed. Pinning the two commits **to each
   other** — the #1213 round-5 wording, removed in round 7 — was a no-op: one
   commit used for both pins compared nothing at all (round 6, finding 1).

   A producer file that **did not exist yet** at the merge commit is skipped,
   and only when it is absent from *both* commits. The producer list grows, so
   an old recovery cannot be required to carry files added later; a file present
   on one side only is a real difference in the machinery that ran, and is
   refused. Absence is read from each commit's **git tree**, so it is a proved
   fact rather than an inference from a failed API read, and an unreadable or
   truncated tree refuses (#1213 round 7, finding 1).

   **What this lane proves, stated exactly.** A real, successful run of this
   workflow, whose dispatch ref and whose checkout both carry the producer code
   of the merge commit that landed the version, added each named version to
   *a* preview ledger and recorded a digest equal to the bytes on exact main; and
   a merged pull request added each version.

   **What it does not prove, and do not let anyone tell you otherwise.**
   (a) That preview's *catalog* matches its ledger — a half-applied or
   hand-repaired preview looks identical from here.
   (b) That **today's** machinery produced the evidence. The original run's
   producer code is pinned to the authoring pull request's **merge commit**,
   never to today's main, because an older commit necessarily carries older
   producer files and that rule would refuse every genuine recovery. It is *not*
   pinned to the run's own checkout: round 6 of the #1213 review showed that one
   attacker-chosen pull-request commit used as both the dispatch ref and the
   checkout compares nothing at all, and this repository squash-merges, so every
   commit ever pushed to a pull request stays citable forever.
   (c) **Which preview database it was.** The original run is deliberately not
   required to bind to the current `PREVIEW_PROJECT_REF`: preview
   `rjyboqwcdzcocqgmsyel` was deleted and rebuilt as `mvpkijzfmfcxhnzqogzs` on
   2026-08-18, so requiring it would refuse every recovery that exists, including
   the stranded merges this lane was built for. A binding it *does* carry must be
   readable and must not name the production project. The residual: the ledger
   half of this lane can be satisfied by one database and the byte half by
   another if a version reappears in the current preview by restore, clone, or a
   later apply of different bytes.

   The earlier wording here — "as strong as the claim lane was on the day of that
   rehearsal" — was **withdrawn as false** in #1213 round 5 and must not return in
   any file. The claim lane pins both of a run's commits to exact main, so a
   doctored intermediate commit can never be the promoted rehearsal; this lane
   pins them to the authoring pull request's merge commit, which is weaker at
   least in the specific, named ways listed above. Do NOT read that list as
   exhaustive: no code can establish an exhaustive negative about an attack
   surface, and the "and in no other way" tail this sentence used to carry was
   removed in #1213 round 7 for claiming one.

   **If a version's file changed after its rehearsal, this lane will refuse it,
   and that refusal is correct** — preview never ran the bytes you are asking
   production to apply. The way forward there is a new migration, never a
   recovery.

   If you find yourself editing a guard, an `if:` condition or an artifact name
   to make a re-run go through, stop. That is how the trap this section exists to
   describe was built in the first place (#1194, #1208). Open an issue instead.
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
Preview:    mvpkijzfmfcxhnzqogzs   (Supabase branch "shared-db-schema-rehearsal")
```

⚠️ **`rjyboqwcdzcocqgmsyel` IS THE OLD PREVIEW AND IS DELETED.** It was destroyed and
rebuilt as `mvpkijzfmfcxhnzqogzs` on 2026-08-18, and this block still named it as
current until 2026-08-20 — under a heading telling you to compare against these exact
characters. A session following that literally would have **rejected the real preview as
wrong**. If you find that string anywhere presented as current, it is stale: §4.2 above
and §5 already say it was deleted, and this block disagreed with both of them.

**Preview's ref is CONFIGURED, never a literal.** The authority is the repository
variable `PREVIEW_PROJECT_REF` (`gh variable list --repo u2giants/shared-db`), because
preview gets rebuilt and its ref changes when it does — which is exactly how this block
went stale. Five workflows were once pinned to the deleted ref and could only fail; a
guard now asserts that no workflow carries a literal. **Do the same yourself: read the
variable, do not copy the characters above into anything executable.** They are here to
be compared against, not to be pasted.

**Trap that has misled sessions:** preview is a Supabase **branch**, not a standalone
project, so the preview ref **does not appear in `supabase projects list`**. Its
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
[`docs/coldlion-history-endpoints-shape.md`](docs/coldlion-history-endpoints-shape.md). Five
traps that will silently corrupt a load if you skip it:

- **⚠️ The default `prodHistory` response is INCOMPLETE.** Without `stageCode` you get only the
  `ISS` (issued) lines. **There are exactly three stages — `ISS`, `INTRAN`, `REC`** (authoritative,
  ColdLion 2026-08-19) and all three carry real rows with **zero key overlap** between them.
  Omitting them loses everything about what actually *arrived* — order 22717 ordered 4,800 and
  received 4,548, and only the `ISS` half is in the default. **Fetch all three and record which
  stage each row came from**, because the payload does not say and the keys do not collide, so a
  stage-blind table triple-counts quantities with no error. The pull is 3 stages × N windows.
- **Hard 7-day window cap (since 2026-08-17).** `fromDate`–`toDate` must be **within 7 days,
  inclusive**, on both endpoints; wider is refused outright. Month-wide calls that worked on
  2026-08-14 now fail. **The refusal is malformed** — HTTP 400 on the wire but `"status": 500` /
  `"Internal Server Error"` in the body — so a loader that trusts the body retries a permanent
  input error forever. Branch on the wire status, never the body's.
- **They are NOT paged.** They return a plain array and **silently ignore `page`/`size`**
  (`size=5` returned 265 rows). A paging loop re-fetches the same rows forever. Chunk by date.
- **`prodHistory` row identity is `(prodOrderNo, prodLineSeq, prepackItemNo)`.** `prodLineSeq` was
  added 2026-08-17 and **resolved the old duplicate-row ambiguity** — distinct `prodLineSeq` means
  distinct real buy lines, never merge them. Any remaining duplicate differs only in `last*`
  lookup fields and is safe to collapse (verified: 98 of 98). **Do not build or resurrect the old
  quantity-comparison heuristic** — §4.3 of the doc explains why it is obsolete.
- **`lineInvoiceQty` / `lineOpenQty` are zero in all 5,874 sampled rows**, as is `depositPerc`
  on `prodHistory`. A report built on them reads zero and looks like a business fact.

**Every open ColdLion question lives in one register:**
[`docs/coldlion-open-questions.md`](docs/coldlion-open-questions.md) — what is blocking, what is
merely open, what is already ANSWERED (do not re-ask), and which owner rulings keep getting
re-litigated. Check it before asking Albert or ColdLion anything, and move answers into its §4
rather than deleting them.

**What the ERP data MEANS** (as opposed to its shape) lives in
[`docs/business-rules-erp-data.md`](docs/business-rules-erp-data.md) — a new file, because this
repo documented shape thoroughly and meaning not at all, and a session already inferred a business
rule wrongly from field populations. **That file holds business meaning ONLY** — no
implementation advice, no build notes; those belong on the workstream's GitHub issue. First entry,
an owner ruling: a `prodReferenceNo` ending
**`COS`** marks **sample production** — extra pieces of a customer's item made for the licensor
(contractual samples) or for POP Creations itself (DAVID samples). They carry real cost with no
customer revenue, so classify them separately; `salesOrderNo = 0` on them is correct, not missing
data. **Never infer a business rule from field populations and write it down as fact** — put it in
the shape doc labelled as an inference until the owner confirms it.

Also: the feed spans **four divisions** (`CW001`, `EH001`, `EP001`, `SP001`), not just `EH001` —
a short window shows only `EH001` and misleads. `1900-01-01` is the empty-date marker
(**owner-confirmed 2026-08-14 — settled, do not re-raise**), and `salesOrderNo = 0` on
`prodHistory` means "no linked sales order", not a broken link.

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
