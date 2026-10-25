# DesignFlow production: Cloud SQL → Supabase (adopted plan)

**Status:** ADOPTED by the owner on 2026-10-13. Author: Uma (plan dated 2 October 2026), reproduced below unchanged after the owner decisions.

## Owner decisions (Albert Hazan, chat 2026-10-13)

- Verbatim: "yes adopt Uma's plan, keep samples together, create the issues".
- Decision 5 (sample cluster): the whole sample cluster stays together on `dflow_prod` (Tracking's rule). Backend and Item Master maps must point those seven tables at `dflow_prod` in production, not `plm`.
- Added by the owner (verbatim): "customers, artists, characters, factories and users should be core.* tables for all the applications to access". This is a **later phase after Step 2** (Phase 5 below), so the host and schema cutovers stay safe; Uma's plan §9 lists it as out of scope for Steps 1–2.
- Decisions 1–4 and 6–8: Uma's recommendations, as written.

## Phase tracking

Parent: [#4248](https://github.com/popcre/shared-db/issues/4248). Children: Phase 0 pre-flight [#4249](https://github.com/popcre/shared-db/issues/4249); Phase 1 rehearsal [#4250](https://github.com/popcre/shared-db/issues/4250); Phase 2 / Step 1 host cutover [#770](https://github.com/popcre/shared-db/issues/770); Phase 3 / Step 2 multi-schema [#4251](https://github.com/popcre/shared-db/issues/4251); Phase 4 Cloud SQL retirement [#4252](https://github.com/popcre/shared-db/issues/4252); Phase 5 canonical `core.*` [#4253](https://github.com/popcre/shared-db/issues/4253). #770 is Phase 2 (Step 1, host cutover); its rehearsal and the four production runtime credentials (issued 2026-10-12) are already done.

Phase 5 (added): move `customers`, `artists`, characters (`properties_and_characters`), `Factory` and `users` into canonical `core.*` tables readable by every application, with compatibility for DesignFlow during transition, after Step 2 is stable.

---

Production Cloud SQL → Supabase multi-schema migration
For: Albert Hazan review, before any production cutover
Date: 2 October 2026
Status: Analysis and recommended plan. No database change, no secret change, and no deploy is authorized by this document.
Scope: DesignFlow production runtime. Schema SQL, if later approved, belongs in `u2giants/shared-db`, not in the app repos.
This plan is based on the application connection contracts and schema maps in this workspace, plus the shared-db segregation notes. It does not include a live read of Cloud SQL or of either Supabase project. Row counts, replication lag, and whether production `dflow` / `dflow_prod` are current must be measured in a pre-flight before anyone cuts over.
________________________________________
Decision asked
Approve a two-step move of DesignFlow production off Cloud SQL and onto the shared production Supabase project, ending in the same multi-schema layout Develop already runs.
Step	What changes	What stays the same	User impact
1. Host cutover	Apps connect to Supabase instead of Cloud SQL	One schema. Table names unchanged. `MULTI_SCHEMA` stays off	No browse outage. Writes pause for under a minute at the flip
2. Schema cutover	Apps use the Develop table map (`plm`, `core`, `app`, `dflow`/`dflow_prod`, `public`)	Same Supabase database from step 1	No browse outage. Same short write pause, and only after step 1 has been stable
Do not combine these steps. A single flip of host and schema is how this migration loses data or takes the site down.
________________________________________
Recommendation
1.	Keep production on Cloud SQL until a rehearsal proves a catch-up copy, a rollback, and the four database services moving together.
2.	Land production data 1:1 into Supabase schema `dflow_prod`. That name is already what the production connection contract requires. Develop’s equivalent writable schema is named `dflow`. They are the same role, different names, so production data never lands in a non-production schema.
3.	Leave `MULTI_SCHEMA` off for that first cutover. Production code already forces single-schema whenever `NODE_ENV=production`.
4.	Turn multi-schema on only after `dflow_prod` has been the live write target long enough to trust it, and only after the sample-tracking map disagreement below is resolved.
5.	Never `ALTER TABLE … SET SCHEMA` on a table the live app still reads under the old name. That already broke sample creation on 21 July 2026.
Shared master data already living in production Supabase (`core`, `app`, and anything DAM, CRM, or PM write) is not a dump target for the Cloud SQL `designflow` schema. DesignFlow-shaped tables stay DesignFlow-shaped. Canonical shared tables stay canonical.
________________________________________
1. Current production
Production DesignFlow still runs on Google Cloud SQL, one Postgres schema named `designflow`.
The runtime check in `designflow-backend/config/database-connection-contract.js` accepts production only when all of the following are true:
Setting	Production Cloud SQL (live today)
`DB_PROVIDER`	`cloud-sql`
Port	`5432`
`DB_SSL`	`false`
Network	Private VPC (`private-ip` or a Cloud SQL socket). A Supabase hostname is rejected
`SCHEMA`	`designflow` exactly. `dflow` and `dflow_prod` are rejected on this path
Secrets	Unsuffixed `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, pinned to a numeric secret version
Pool user	A normal database user. A Supabase pooler user (`postgres.<ref>` or `<role>.<ref>`) is rejected
`NODE_ENV=production` turns multi-schema off. Every Sequelize model is pinned to that one `SCHEMA` value. `MULTI_SCHEMA=true` can override this, and it must stay unset on the Cloud SQL service.
Who talks to the database
These four Cloud Run services share one database and must move in the same cutover. If only one moves, writes split across two databases.
Service	Database	Production behavior today
`designflow-backend`	Yes	Single schema `designflow`
`designflow-item-master`	Yes	Same
`designflow-tracking`	Yes	Same
`designflow-data-syncing`	Yes	Same. This is the ERP/ColdLion writer. If it stays on Cloud SQL after the APIs move, new ERP rows never appear in the app
`designflow-bff`	No	Proxies to the APIs. No database cutover
`designflow-frontend`	No	Browser app. No database cutover
Cloud Build already threads `SCHEMA`, `DB_PROVIDER`, `DB_SSL`, port, network path, and the five DB secrets as trigger substitutions. The cutover is a substitution change plus a rolling deploy, not a rewrite of the query layer.
What “single schema” means in practice
All DesignFlow tables — items, RFQ, samples, production orders, users, customers, merch groups — sit in `designflow`. SQL that says `"itemHeader"` means `designflow."itemHeader"`. Foreign keys point at tables in that same schema.
There is a second, optional database binding for HTS RAG (`HTS_RAG_DB_`). It is off unless `HTS_RAG_DB_ENABLED=true`. Leave it alone during this migration. Production duty-research has a separate open gap (shared-db #3218: production missing the `hts_rag` schema). Do not fold that fix into the cutover window.
________________________________________
2. Current Develop (already Supabase, already multi-schema)
Develop, staging, and the Albert sandboxes are already rejected unless they look like Supabase:
Setting	Develop / staging / sandbox
`DB_PROVIDER`	`supabase`
Port	`6543` (transaction pooler)
`DB_SSL`	`true`
Network	Public pooler host ending in `.pooler.supabase.com`
Secrets	Suffixed: `DB__DEV`, `DB__STAGING`, or `DB__SANDBOX`
Pool user	`postgres.<project-ref>`
`SCHEMA`	Must not be `dflow_prod`
`NODE_ENV` is not `production`, so multi-schema turns on with no extra flag. Each model is given a schema from `config/table-schema-map.js`. On connect, the service runs:
```text
SET search_path TO dflow, plm, core, app, public
```
`dflow` is first so an unqualified staff/auth name still hits the writable DesignFlow copy.
Where Develop puts tables
Counts below are the keys in each service’s `TABLE_SCHEMA` as of this workspace. They are the app’s map, not a live `\dt` of the database.
Service	Mapped tables	`dflow`	`plm`	`core`	`app`	`public`
Backend	113	13	71	10	10	9
Item Master	106	11	71	13	10	1
Tracking	136	46	66	13	10	1
Data Syncing	53	3	40	6	4	0
The map is intentionally not “move every Cloud SQL table to a new name.” Same-name operational tables go to `plm` (`itemHeader`, `RFQItem`, production orders, most grids). Shared-looking reference tables go to `core` (`merchGroup`, `vendor`, `age_group`, …). App support goes to `app` (`AuditLog`, `RolePermissions`, `user_notification`, …).
These stay in `dflow` on purpose, because the shared canonical tables are a different shape:
•	`users` (staff office and language live here, not on `app.profile`)
•	`Roles`, `comments`, `Factory`, `artists`
•	`customers` (legacy shape; `core.customer` is not a drop-in replacement)
•	Sample-import and some sample-movement tables
`public` in the backend map is the HTS RAG family (`hts_rag_rulings` and related). Tracking and Item Master only map `hts_rag_rulings`.
Develop can run this way because its Supabase project was built as the multi-schema database. The app and the data already agree.
Production Supabase already exists, and it is not Develop
The shared production Supabase project is `qsllyeztdwjgirsysgai`. DAM, CRM, PM, and the shared schemas (`core`, `app`, `plm`, `api`, `dam`, `pim`, `crm`, `ingest`) already live there. The production connection contract also already allows a DesignFlow cutover onto that project, but only as:
Setting	Production Supabase (allowed, not the live DesignFlow path)
`DB_PROVIDER`	`supabase`
Port	`6543`
`DB_SSL`	`true`
Network	`public-pooler`
`SCHEMA`	`dflow_prod` exactly. `designflow` is rejected on this path
Pool user	A service-specific role such as `designflow_prod_runtime.<project-ref>`. The `postgres.<ref>` admin role is rejected
Secrets	Still the unsuffixed production secrets, numeric versions
A rehearsal environment (`production-rehearsal`) is Supabase-only and also uses `SCHEMA=dflow_prod`, with `DB__REHEARSAL` secrets.
So the platform split is already designed:
```text
Cloud SQL production schema designflow ← live app writes today
Develop Supabase schemas dflow, plm, core, app, public
Production Supabase shared schemas already live for other products
schema dflow_prod reserved for DesignFlow production
```
`dflow` on the production project is a historical/staging copy used by catalog checks. It is not the schema the production app is allowed to set as `SCHEMA`. Treat its rows as untrusted until a pre-flight compares them to Cloud SQL.
________________________________________
3. The three challenges
Challenge A — Production is one schema, Develop is five
Cloud SQL `designflow."itemHeader"` and Develop `plm."itemHeader"` are the same table name in different schemas. The SQL text in the models is already schema-aware when multi-schema is on. When it is off, every name is forced into `SCHEMA`.
That flag is the whole application half of “become multi-schema.” The database half is: the table must actually exist in the schema the map names, with the same columns, keys, and grants.
Turning `MULTI_SCHEMA=true` on today’s production Supabase before the rows are in those schemas will not migrate anything. The app will read `dflow` / `plm` / `core` / `app` and miss `dflow_prod` entirely, because the search path is:
```text
dflow, plm, core, app, public
```
`dflow_prod` is not on that list. A flag flip without a data placement step looks like an empty DesignFlow.
Challenge B — Shared schemas are already in use
Develop’s `core` and `app` schemas are DesignFlow’s neighbors, not empty buckets. On production Supabase they are also the live home for customers, factories, profiles, and taxonomy used by other products.
The segregation document’s long-term homes (`designflow.customers` → `core.customer`, `designflow.users` → `app.profile`) are a data model change. They are not this cutover. Develop itself has not done that rename: it still reads and writes `dflow.customers` and `dflow.users`.
Loading Cloud SQL into `core.customer` or `app.profile` would collide with live shared rows. Out of scope for both steps of this plan.
Challenge C — Zero downtime
“Zero downtime” here means users can keep working, and a bad deploy can be undone without restoring a backup.
It does not mean two databases both accepting writes for a long time. Dual-write across Cloud SQL and Supabase fails on sequences, foreign keys, and “which row won.” Do not build it.
What works:
•	Reads stay up the whole time. Cloud Run keeps the old revision on Cloud SQL until the new revision is healthy, then shifts traffic.
•	Writes pause once, briefly, at the flip (target under 60 seconds). During that pause, replication catches up, sequences are moved past `max(id)`, and the new revision becomes the only writer.
•	Rollback is “send traffic back to the previous Cloud Run revision,” which still points at Cloud SQL. That is safe only until the first user write lands on Supabase. After that, Cloud SQL is behind. The rollback window should be a clock the operator watches (recommend 30 minutes), not an open-ended promise.
A rolling deploy of one service is not a rollback plan if the other three services already write to the new database.
Why moving tables is not the cutover
On 21 July 2026, sample-tracking tables were moved with `ALTER TABLE … SET SCHEMA` into `plm` while the app still expected `dflow.<table>`. Sample creation failed with `relation "dflow.<table>" does not exist`. They were restored by migration `20260721201500_restore_dflow_sample_tracking_tables.sql`.
The rule from that incident: do not remove a table from the schema the running app uses. Copy or replicate first, switch the app, and only then retire the old name.
________________________________________
4. How production becomes multi-schema
Same layout as Develop, with one name substitution the production contract already enforces.
Develop schema	Production schema after step 2	What lives there
`dflow`	`dflow_prod`	Staff users, roles, comments, factories, artists, legacy customers, and any table the map still calls `dflow`
`plm`	`plm`	Items, RFQ, production orders, grids, licensing, art pieces
`core`	`core`	Same-name reference tables the map already points at `core` (`merchGroup`, `vendor`, `age_group`, …). Not a reload of `core.customer`
`app`	`app`	Same-name app tables (`AuditLog`, tokens, notifications, permissions)
`public`	`public`	HTS RAG tables the backend map already pins here. Do not use this step to invent the missing `hts_rag` schema
Search path after step 2, production only:
```text
dflow_prod, plm, core, app, public
```
That requires a small, explicit production branch in `table-schema-map.js`: every Develop `dflow` entry is `dflow_prod` when `DEPLOY_ENV=production`. Develop stays `dflow`. Do not rename the production schema to `dflow` to avoid the code change. The connection contract forbids non-production from using `dflow_prod`, and forbids production Supabase from using `designflow`, specifically to keep those copies apart.
Physical placement for step 2:
1.	Step 1 has already put a full, current copy of Cloud SQL in `dflow_prod`.
2.	For each table whose map target is `plm`, `core`, or `app`, confirm the destination relation is the DesignFlow same-name table and is not a live shared table with a different shape.
3.	Replicate rows from `dflow_prod."Table"` into that destination while `dflow_prod` is still the only writer.
4.	At the step-2 write pause, catch up, advance sequences, deploy `MULTI_SCHEMA=true` with the production search path above.
5.	Keep `dflow_prod."Table"` in place until the new path has been clean. Dropping or moving it is a later, separate change.
Tables that stay in `dflow` on Develop stay in `dflow_prod` on production. No second copy.
________________________________________
5. Blocker before step 2: sample tracking does not agree
The four maps agree on every shared table except these seven. Backend and Item Master send them to `plm`. Tracking keeps the whole sample cluster on `dflow`.
Table	Backend	Item Master	Tracking
`sample`	`plm`	`plm`	`dflow`
`sample_attachment`	`plm`	`plm`	`dflow`
`sample_box`	`plm`	`plm`	`dflow`
`sample_comments`	`plm`	`plm`	`dflow`
`sample_event`	`plm`	`plm`	`dflow`
`sample_factory_group`	`plm`	`plm`	`dflow`
`sample_shipment_item`	`plm`	`plm`	`dflow`
Tracking’s comment says the sample cluster (tables, foreign keys, and RPCs) stays on one schema until a governed shared-db migration moves all of it together. Backend’s comment says some of those tables already have same-name `plm` relations, so it points at `plm`.
Step 1 hides this, because every service still uses one schema. Step 2 would make Tracking write `dflow_prod.sample` while Backend reads `plm.sample`. That is a split brain inside one database.
Resolve before step 2, with one owner decision: the sample cluster stays together on `dflow_prod` (Tracking’s rule), or the entire cluster moves to `plm` in one change (tables, FKs, and RPCs). Do not leave the seven tables split.
Data Syncing does not map these tables.
________________________________________
6. Execution plan
Phase 0 — Review and pre-flight (no production write)
Albert approves or rejects the decisions in section 7.
Engineering then measures, read-only:
1.	Cloud SQL `designflow`: table list, row counts, sequence values, extensions, roles, and objects that are not tables (functions, triggers, views).
2.	Production Supabase `dflow_prod` and `dflow`: same measurements, plus whether `dflow` is a stale copy.
3.	Production Supabase `plm` / `core` / `app`: for every name in the map, is the relation missing, empty, same-shape, or a different live table?
4.	Grants: the future service roles can use only `dflow_prod` plus the schemas step 2 will read. They do not get the `postgres` admin role. This matches open shared-db work on least-privilege `dflow_prod` identities (#2873 and the related parity issues).
5.	A written diff of Cloud SQL versus `dflow_prod`. Anything only on one side is a stop, not a surprise for cutover day.
Schema differences found here are fixed in `shared-db` through the normal migration lane, rehearsed on preview, then applied to production Supabase before the app flip. App repos do not gain a `supabase/migrations` folder for this.
Phase 1 — Rehearsal
Use `production-rehearsal` (Supabase, `SCHEMA=dflow_prod`, `DB__REHEARSAL`). The contract already refuses Cloud SQL for that environment.
Rehearse the real procedure, not a diagram:
1.	Load a Cloud SQL snapshot into rehearsal `dflow_prod` (or replicate, if the rehearsal can see Cloud SQL).
2.	Run the four services against it with `MULTI_SCHEMA` off. Exercise login, item open, RFQ list and save, a production-order read, a sample create, and one data-sync dry run.
3.	Flip `MULTI_SCHEMA` on only after the sample decision is applied on rehearsal. Repeat the same clicks. Confirm Tracking and Backend hit the same sample table.
4.	Practice the rollback: traffic back to a revision whose secrets still point at the source database.
5.	Record how long catch-up and the write pause actually took. The production pause target is under 60 seconds; if rehearsal cannot make that, the production window gets longer on purpose, not by hope.
Phase 2 — Step 1, host cutover (production)
Still single schema.
1.	Start continuous copy from Cloud SQL `designflow` into production Supabase `dflow_prod`. Same table names, same ids. Sequences are not yet used for writes.
2.	Let it run until lag is measured and boring. Cloud SQL remains the only writer. The live site does not change.
3.	Deploy the four new Cloud Run revisions without shifting traffic. They must boot, pass the connection contract (`supabase`, port `6543`, SSL on, `SCHEMA=dflow_prod`, service-specific user), and fail closed if any of that is wrong. The existing `validateRuntimeConnection` check is that fail-closed.
4.	Write pause. Stop writers (scale the four services to zero, or a maintenance flag that rejects POST/PUT/PATCH). Confirm replication lag is zero. Set every `dflow_prod` sequence to `max(id) + 1` at minimum. The production catalog already tracks ceilings for the high-volume sequences (`itemHeader`, `RFQItem`, `externalCustomer`, `AuditLog`, and others). Use the live `max(id)`, not the old ceiling.
5.	Shift traffic to the new revisions. Confirm one write and one read on each service (item, RFQ, sample, sync heartbeat).
6.	Keep Cloud SQL up, read-only, for the rollback window. Previous revisions stay available.
7.	End the write pause. Users were blocked from saving for the pause only. Reads on the new database start as soon as traffic shifts.
If the new revision fails its health check, traffic never leaves Cloud SQL. That is the zero-downtime property of step 1.
Do not decommission Cloud SQL in this phase.
Phase 3 — Step 2, multi-schema (production, later)
Only after step 1 has been the live writer through a normal business day, the sample decision is shipped, and the Phase 0 relation check is still true.
1.	While `dflow_prod` is the writer, copy each table that the agreed map sends to `plm`, `core`, or `app` into that schema. Skip tables that stay in `dflow_prod`. Skip any destination that the pre-flight marked as a different live shared table.
2.	Catch up continuously.
3.	Deploy the four services with `MULTI_SCHEMA=true` and search path `dflow_prod, plm, core, app, public`, again without shifting traffic until they boot clean.
4.	Same write pause, same sequence advance on the destination schemas, same traffic shift, same rollback rule: previous revision still has `MULTI_SCHEMA` off and still writes `dflow_prod`.
5.	Leave the `dflow_prod` copies in place. Retiring them is a later shared-db change, after a catalog check shows every reader uses the new schema.
Phase 4 — Cloud SQL retirement
Separate decision, after at least one full business cycle on Supabase and a tested backup/restore of the Supabase project. Until then Cloud SQL is the rollback copy, then a cold backup, then it can be shut down. Shutting it down is not part of the cutover approval.
________________________________________
7. Decisions for Albert
#	Decision	Recommendation
1	One cutover, or two?	Two. Host first (`dflow_prod`, single schema). Multi-schema second
2	Dual-write, or a short write pause?	Write pause under 60 seconds. No dual-write
3	Production writable schema name	`dflow_prod`, matching Develop’s `dflow` role. Do not reuse `dflow` or `designflow` for live production writes
4	Reload `core.customer` / `app.profile` from Cloud SQL?	No. Keep legacy `customers` and `users` in `dflow_prod`, as Develop keeps them in `dflow`
5	Sample cluster home	Pick one before step 2. Either the whole cluster stays on `dflow_prod`, or the whole cluster moves to `plm` with its FKs and RPCs. The current seven-table split is not acceptable
6	Rollback window	30 minutes after the traffic shift, then forward-fix only. Cloud SQL stays read-only through that window
7	Who moves together	Backend, Item Master, Tracking, and Data Syncing. BFF and frontend stay as they are
8	When Cloud SQL is turned off	Not in this cutover. A later explicit approval
________________________________________
8. What failure looks like, and the guard
Failure	Guard
App looks at `dflow` while rows are in `dflow_prod`	Step 1 keeps `MULTI_SCHEMA` off and `SCHEMA=dflow_prod`. The connection contract rejects any other production Supabase schema
`SET SCHEMA` removes a live table	Forbidden until the app has been on the new name and the old name is unused
One service writes Cloud SQL, another writes Supabase	All four database services shift in one traffic change. Data Syncing is in that set
Sequence restarts and new rows collide	Sequence set from live `max(id)` during the write pause, before writes open
Cloud SQL dump overwrites shared `core` / `app` rows	Destinations limited to same-name DesignFlow tables that pre-flight marked safe. `customers` and `users` stay in `dflow_prod`
Admin pooler user on production	Contract rejects `postgres.<ref>` for production Supabase
Develop secrets pointed at production, or the reverse	Contract checks the secret name suffix (`DB__DEV` vs unsuffixed `DB_`) before connect
Rollback after Supabase has newer writes	Rollback clock. After it expires, fix forward. Do not silently point traffic back at a stale Cloud SQL
Sample rows split across `plm` and `dflow_prod`	Step 2 blocked until section 5 is decided and rehearsed
HTS duty research changes behavior in the same window	HTS binding stays as deployed. Not part of this flip
________________________________________
9. Out of scope
•	Renaming `dflow.customers` into `core.customer`, or `dflow.users` into `app.profile`
•	Moving DAM, CRM, or PM
•	Creating the production `hts_rag` schema (shared-db #3218)
•	Deleting `designflow_frozen_20260710` or any frozen copy
•	New tables, columns, or grants invented in an app repo
•	A maintenance page, unless the rehearsal shows the write pause cannot stay under a minute
________________________________________
10. After approval
Engineering comes back with the Phase 0 measurements (row counts, sequence gaps, and the safe/unsafe destination list) before any production traffic shift. Step 1 does not start on the day this document is approved. It starts when the rehearsal record exists and the write-pause time has been seen, not estimated.
________________________________________
Sources in this workspace
•	`designflow-backend/config/database-connection-contract.js` — production Cloud SQL vs production Supabase vs Develop
•	`designflow-backend/tests/unit/database-connection-contract.test.js` — the same rules as executable checks
•	`designflow-backend/config/table-schema-map.js` — Develop multi-schema map and the production single-schema switch
•	Matching maps in `designflow-item-master`, `designflow-tracking`, and `designflow-data-syncing`
•	`designflow-backend/models/db.js` — `search_path` is set only when multi-schema is on
•	`designflow-backend/shared-db/docs/designflow-master-data-migration/designflow-schema-segregation.md` — target homes, and the 21 July 2026 `SET SCHEMA` incident
•	`designflow-backend/shared-db/docs/unified-supabase-schema-map.md` — production project `qsllyeztdwjgirsysgai` and why `users` / `customers` are not dumped into `app` / `core`

## Value-mapping decisions (owner rulings)

Detail and live match rates: `docs/verification/cloudsql-piecemeal-cutover-20261002/designflow-legacy-column-crosswalk.md`.

- 2026-10-23, Albert: every field the DesignFlow code uses must have a home; where Supabase production already has a table for the same data, its design is used and extended, or the legacy values are only mapped into it.
- 2026-10-23, Albert: legacy license `NU` (NBCUniversal) → licensor `NB` NBC.
- 2026-10-23, Albert: legacy license `NK` (Nick) → licensor `VM` Viacom Multi.
- 2026-10-23, Albert: legacy licenses `GC` (Generic) and `MP` (Multiple) → licensor `ZZ` DTR - No License.
- 2026-10-23, Albert: Disney, Marvel and Star Wars are three separate licensors regardless of ownership. Legacy `DS` (Dis/Mrv/SW) has no items in production (checked live 2026-10-23), so it maps to nothing and is retired.
- 2026-10-23, Albert: licensed and non-licensed divisions use different MG05 and MG06 codes and meanings; value mapping is done per division, never across divisions. Division comes from ColdLion (`plm.item.raw->>'divisionCode'`), not DesignFlow `div_code_fk`, which disagrees for about 3,700 items (checked live 2026-10-23).
- 2026-10-23, Albert: division EP001 is a different company that will not be in the system; its 451 DesignFlow items and their codes (`00 BK CO FB1 HCE KK KK1 LE RK SA SA2 SA3 SA4 SO SO1` …) are not migrated.
- 2026-10-23, Albert: Roaring Brook (`RB`), Frida Kahlo (`FK`) and ZAG (`ZG`) are inactive licensors; they are kept as inactive, not active, licensors. Friends TV (`FR`) is not kept.
- Live 2026-10-23: `GC` Global Culture (6 items) occurs only in ColdLion division EH001, together with the other non-licensed theme codes (`AB AN BA DF FA FP HD KS KT MS ND PH ST WM`); in EH001 slot MG05 is a theme, not a licensor. The earlier `GC` → `ZZ` ruling applies only to the license list entry "Generic", not to these items.
- Auto-mapped by name (no ruling needed): `NA` → NASA (`X-NASA`), `PF` → Paul Frank, `SB` → Steal-A-Brainrot, `DMC` → Miller Coors (`X-MILLERCOORS`).
- 2026-10-23, Albert: ColdLion division codes are right: SP001 = Spruce Licensed, EH001 = Spruce non-Licensed, CW001 = POP. DesignFlow `divisionCode.external_divisoncode` has SP001/EH001 swapped and is not used.
- 2026-10-23, Albert: POP (CW001) leftover licensor codes go to a review list. Live: only 16 CW001 items — `MM`/`ABMM` Marilyn Monroe (13), `GEN` (2: invoicing, lenticular), `BK` (1: ticketing). `BK`'s other 111 items are EP001 and not migrated.
- 2026-10-23, Albert: Marilyn Monroe (`MM`, `ABMM`; 13 POP items) is an old inactive licensor; kept as an inactive licensor.
- 2026-10-23, Albert: items marked non-inventory are not imported. Authority is ColdLion `nonInventoryItem` (`plm.item.raw`); DesignFlow `non_inv_item` disagrees and is not used. Live: 50 DesignFlow items are non-inventory in ColdLion, including `TICKETING` (`BK`). The two `GEN` items (invoicing, lenticular) are inventory items in ColdLion, so they stay on the POP review list.
- 2026-10-23, Albert: do not import the two `GEN` items (invoicing, lenticular). POP licensor review list is now closed.
- Live 2026-10-23 (imported scope: CW001, EH001, SP001, inventory items only = 18,048 items): item size (MG04) codes map to `core.product_size` for 17,149 items (95%); 708 blank; the 38 distinct codes on the rest (1.1%) are written-out dimensions (for example `15X15`) instead of the size code; each matches exactly one active `core.product_size` label (`12X12` matches active `21` and inactive historical `TT`; use `21`). They map by label; no owner review needed (resolved 2026-10-25). DesignFlow's own `itemSize` list (metric labels) is not used for mapping.
- Live 2026-10-23: production-order vendor codes map to `core.factory` codes for 3,412 of 3,622 orders (94%). DesignFlow's `Factory` list (181 rows, 4 test rows) matches ColdLion vendors by name for only 34 rows; open question to Albert.
- 2026-10-23, Albert (factories): DesignFlow factories and ColdLion vendors overlap but are not the same list. ColdLion holds the legal name (who POP pays); DesignFlow refers to a factory by trade name or, more often, the factory rep's name. Design: one canonical `core.factory`, ColdLion legal name kept as is, extended with:
  - trade name;
  - nickname — the name shown everywhere in the apps (existing `display_name` is its home unless review finds it used otherwise);
  - rep names, one or more per factory (child table, not a list column);
  - vendor user accounts, one or more per factory (`core.vendor` logins linked to the canonical factory id).
  Factories POP has not yet done business with exist only in DesignFlow and are created without a ColdLion source reference; ColdLion attaches later by source identity. Mapping the 181 DesignFlow factories: automatic where name/trade name/nickname matches (34 today), the rest on a licensing-style review list; the 4 test rows are not imported.
- 2026-10-23, Albert: delete Friends TV (`FR`). Consistent with the earlier erase ruling: `FR` is already absent from `core.licensor`; the 2 DesignFlow items that still carry `FR` map to no licensor.
- 2026-10-23, Albert (party type): the party POP deals with is called "the factory" even when it is a trading company. `core.factory` gets a party type (factory, trading company, or both) and a link from a factory to the trading company or companies that represent it (many-to-many link table).
- 2026-10-23, Albert (future quality metrics): per factory, add fields for orders completed and orders with a problem, so failure rates can be calculated later. Unused at first; the production-order area decides whether they are stored counts or derived from order rows.
- 2026-10-23, Albert (review tool): the factory review is a private workbook with dropdowns that links each DesignFlow factory to a ColdLion vendor, sets party type and representing trading company, and assigns each DesignFlow vendor login to its factory. Kept logins move to Supabase sign-in later (passwords are never copied).
- 2026-10-25, Albert (product categories): each factory or trading company carries one or more product categories it produces (link table to a product-category list; 22 categories from the owner's list). Nickname left blank in the review keeps the DesignFlow nickname; a blank trading company means POP deals with the factory directly.
